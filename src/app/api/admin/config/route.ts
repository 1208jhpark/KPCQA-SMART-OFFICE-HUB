import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    let config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          id: 'global',
          main_headline: "서비스 센터",
          sub_headline: "AX 기반 스마트 오피스 모듈을 선택하세요.",
          home_grid_cols: 4,
          layout_type: "horizontal"
        }
      });
    }
    return NextResponse.json(config);
  } catch (error) {
    console.error("Config GET Error:", error);
    return NextResponse.json({ main_headline: "시스템 점검 중", sub_headline: "DB 연결을 확인하세요.", home_grid_cols: 4, layout_type: "horizontal" });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const updated = await prisma.systemConfig.update({
      where: { id: 'global' },
      data: body
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Config PATCH Error:", error);
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}