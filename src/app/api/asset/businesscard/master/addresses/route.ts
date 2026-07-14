import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const addresses = await prisma.companyAddress.findMany({
      orderBy: { createdAt: 'asc' }
    });
    return NextResponse.json(addresses);
  } catch (error) {
    return NextResponse.json({ message: '주소 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const newAddress = await prisma.companyAddress.create({ data });
    return NextResponse.json(newAddress);
  } catch (error) {
    return NextResponse.json({ message: '주소 생성 실패' }, { status: 500 });
  }
}

// 🚀 [확장] 사용중단 토글뿐만 아니라 전체 필드 수정 트랜잭션 수용
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    const updated = await prisma.companyAddress.update({
      where: { id },
      data: data
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ message: '주소 수정 실패' }, { status: 500 });
  }
}

// 🚀 [신설] 주소지 레코드 시스템 영구 삭제 라우터
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ message: 'ID가 누락되었습니다.' }, { status: 400 });

    await prisma.companyAddress.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    return NextResponse.json({ message: '주소 삭제 실패' }, { status: 500 });
  }
}