import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 1. 전체 실사 내역 및 응답 현황 로드
export async function GET() {
  try {
    const audits = await prisma.iTAudit.findMany({
      include: { responses: true }, // 연결된 응답 데이터까지 한 번에 조인(Join)해서 가져옵니다.
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(audits);
  } catch (error) {
    console.error("Audit GET Error:", error);
    return NextResponse.json({ error: 'Failed to load audits' }, { status: 500 });
  }
}

// 2. 신규 실사 생성
export async function POST(req: Request) {
  try {
    const data = await req.json();
    const audit = await prisma.iTAudit.create({ data });
    return NextResponse.json(audit);
  } catch (error) {
    console.error("Audit POST Error:", error);
    return NextResponse.json({ error: 'Failed to create audit' }, { status: 500 });
  }
}

// 3. 실사 상태 업데이트 (배포, 마감, 보관 등)
export async function PATCH(req: Request) {
  try {
    const { id, ...data } = await req.json();
    const audit = await prisma.iTAudit.update({
      where: { id },
      data
    });
    return NextResponse.json(audit);
  } catch (error) {
    console.error("Audit PATCH Error:", error);
    return NextResponse.json({ error: 'Failed to update audit' }, { status: 500 });
  }
}

// 4. 실사 영구 삭제
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    await prisma.iTAudit.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Audit DELETE Error:", error);
    return NextResponse.json({ error: 'Failed to delete audit' }, { status: 500 });
  }
}