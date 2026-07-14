import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const quals = await prisma.businessCardQualification.findMany({
      orderBy: { createdAt: 'asc' }
    });
    return NextResponse.json(quals);
  } catch (error) {
    return NextResponse.json({ message: '자격사항 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const newQual = await prisma.businessCardQualification.create({ data });
    return NextResponse.json(newQual);
  } catch (error) {
    return NextResponse.json({ message: '자격사항 생성 실패' }, { status: 500 });
  }
}

// 🚀 [확장] 자격사항 단어 표준 명칭 수정 데이터 처리
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    const updated = await prisma.businessCardQualification.update({
      where: { id },
      data: data
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ message: '자격사항 수정 실패' }, { status: 500 });
  }
}

// 🚀 [신설] 자격사항 표준 단어 영구 제거 라우터
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ message: 'ID가 누락되었습니다.' }, { status: 400 });

    await prisma.businessCardQualification.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    return NextResponse.json({ message: '자격사항 삭제 실패' }, { status: 500 });
  }
}