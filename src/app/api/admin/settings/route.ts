import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    return NextResponse.json(config || {});
  } catch (error) {
    return NextResponse.json({ error: '설정 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // global ID로 설정을 생성하거나 업데이트 (upsert)
    const config = await prisma.systemConfig.upsert({
      where: { id: 'global' },
      update: { unit_category_group: body.unit_category_group },
      create: { id: 'global', unit_category_group: body.unit_category_group }
    });
    
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: '설정 저장 실패' }, { status: 500 });
  }
}