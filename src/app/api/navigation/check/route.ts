import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawPath = searchParams.get('path') || '';
  
  // 🚀 경로 표준화: 앞뒤 공백 제거 및 끝의 슬래시(/) 제거
  const normalizedPath = rawPath.trim().replace(/\/$/, "");

  try {
    // 1. 현재 경로(/asset/it/master)의 설정을 찾습니다.
    const currentConfig = await prisma.interfaceConfig.findFirst({
      where: {
        OR: [
          { path: normalizedPath },
          { path: normalizedPath + '/' }
        ]
      }
    });

    if (!currentConfig) {
      console.log("❌ DB에서 경로를 찾을 수 없음:", normalizedPath);
      return NextResponse.json({ viewMode: 'DIRECT', subMenus: [] });
    }

    // 2. 해당 노드(Level 3)를 부모로 가진 레벨 4 자식들을 가져옵니다.
    const subMenus = await prisma.interfaceConfig.findMany({
      where: { 
        parent_id: currentConfig.id,
        level: 4,
        is_active: true
      },
      orderBy: { sort_order: 'asc' }
    });

    console.log(`✅ 경로: ${normalizedPath} | 인덱스뷰: ${currentConfig.entry_index_view} | 자식수: ${subMenus.length}`);

    // 🚀 핵심 규칙: 인덱스뷰 설정이 켜져 있고 자식이 있다면 CARD_INDEX 모드 발동
    if (currentConfig.entry_index_view && subMenus.length > 0) {
      return NextResponse.json({
        viewMode: 'CARD_INDEX',
        subMenus: subMenus
      });
    }

    // 설정이 꺼져 있거나 자식이 없으면 직접 관리 모드(DIRECT)
    return NextResponse.json({ viewMode: 'DIRECT', subMenus: [] });
  } catch (error) {
    console.error("Nav Check API Error:", error);
    return NextResponse.json({ viewMode: 'DIRECT', subMenus: [] });
  }
}