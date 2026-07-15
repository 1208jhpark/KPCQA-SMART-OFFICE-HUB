import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const certs = await prisma.productionCertMaster.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    return NextResponse.json(certs);
  } catch (error) {
    return NextResponse.json({ message: '인증 규격 조회 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { certId, type, label, format, jebonFormat, grades } = body;

    const cert = await prisma.productionCertMaster.upsert({
      where: { certId },
      update: { label, format, jebonFormat, grades: grades || [] },
      create: { certId, type, label, format, jebonFormat, grades: grades || [] }
    });
    return NextResponse.json({ message: '저장 완료', data: cert });
  } catch (error) {
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const certId = searchParams.get('certId');
    if (!certId) return NextResponse.json({ message: 'ID가 필요합니다.' }, { status: 400 });

    // 주요 키값 임의 삭제 불가 검사
    const coreIds = ['GSEED', 'BF', 'CONDENDSATION', 'EDUCATIONAL', 'ENERGY', 'OLD_ZEB', 'INTEGRATED_ZEB', 'ISO', 'NORMAL'];
    if (coreIds.includes(certId)) {
      return NextResponse.json({ message: '시스템 핵심 기본값은 삭제할 수 없습니다.' }, { status: 403 });
    }

    await prisma.productionCertMaster.update({
      where: { certId },
      data: { isActive: false }
    });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}