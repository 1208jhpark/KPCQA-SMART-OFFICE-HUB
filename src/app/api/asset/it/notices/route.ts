import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    if (!config || !config.linked_sites) return NextResponse.json({});
    const sitesData: any = config.linked_sites;
    return NextResponse.json(sitesData.it_notice || {});
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load notice' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json(); // { current, history }
    const targetDate = body.current?.targetDate || ""; // 🚀 공지에서 설정한 날짜 추출

    let config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    
    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          id: 'global',
          main_headline: 'SMART OFFICE HUB',
          sub_headline: '서비스 모듈을 선택하세요.',
          linked_sites: {},
          audit_baseline: targetDate, // 🚀 생성 시 반영
          it_category_group: 'GRP_IT_TYPE'
        }
      });
    }

    const currentSites = config.linked_sites ? (config.linked_sites as any) : {};
    const updatedSites = { ...currentSites, it_notice: body };

    // 🚀 [핵심 수정] it_notice 저장 시 audit_baseline 필드도 똑같은 날짜로 동기화!
    await prisma.systemConfig.update({
      where: { id: 'global' },
      data: { 
        linked_sites: updatedSites,
        audit_baseline: targetDate 
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notice API POST Error:', error);
    return NextResponse.json({ error: 'Failed to save notice' }, { status: 500 });
  }
}