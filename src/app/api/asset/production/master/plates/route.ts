import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const plates = await prisma.productionPlateMaster.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    return NextResponse.json(plates);
  } catch (error) {
    return NextResponse.json({ message: '단가 조회 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, code, label, price, size } = body;

    const plate = await prisma.productionPlateMaster.upsert({
      where: { code },
      update: { label, price: Number(price), size },
      create: { code, label, price: Number(price), size }
    });
    return NextResponse.json({ message: '저장 완료', data: plate });
  } catch (error) {
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    if (!code) return NextResponse.json({ message: '코드가 필요합니다.' }, { status: 400 });

    await prisma.productionPlateMaster.update({
      where: { code },
      data: { isActive: false }
    });
    return NextResponse.json({ message: '삭제(비활성화) 완료' });
  } catch (error) {
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}