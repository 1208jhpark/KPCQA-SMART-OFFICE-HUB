import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const clients = await prisma.marketingClient.findMany({
      where: { is_active: true },
      include: { distributions: { include: { item: true } } },
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(clients);
  } catch (error) {
    return NextResponse.json({ error: '고객사 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, location, category } = await req.json();
    const newClient = await prisma.marketingClient.create({
      data: {
        name,
        location,
        category,
        departments: [{ name: "전사", is_hidden: false }]
      }
    });
    return NextResponse.json(newClient);
  } catch (error) {
    return NextResponse.json({ error: '고객사 등록 실패' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, name, location, category, departments, oldDeptName, newDeptName, action, targetDeptName } = body;

    // 1. 기존 정보 확인 (이름 변경 체크용)
    const clientBefore = await prisma.marketingClient.findUnique({ where: { id } });
    if (!clientBefore) return NextResponse.json({ error: '고객사 미존재' }, { status: 404 });

    // [부서 삭제 액션 처리]
    if (action === 'delete_dept' && targetDeptName) {
      const distributionCount = await prisma.marketingDistribution.count({
        where: { client_id: id, client_dept: targetDeptName }
      });
      if (distributionCount > 0) {
        return NextResponse.json({ error: `해당 부서는 ${distributionCount}건의 지급 이력이 있어 삭제할 수 없습니다.` }, { status: 400 });
      }
      const currentDepts = Array.isArray(clientBefore.departments) ? (clientBefore.departments as any[]) : [];
      const updatedDepts = currentDepts.filter(d => (typeof d === 'string' ? d : d.name) !== targetDeptName);
      const updated = await prisma.marketingClient.update({ where: { id }, data: { departments: updatedDepts } });
      return NextResponse.json(updated);
    }

    // 2. 마스터 정보 업데이트
    const updatedClient = await prisma.marketingClient.update({
      where: { id },
      data: { 
        name, 
        location, 
        category,
        departments: departments !== undefined ? departments : undefined 
      }
    });

    // 🚀 [추가] 회사명이 변경된 경우, 과거 모든 지급 이력의 회사명도 동기화
    if (name && clientBefore.name !== name) {
      await prisma.marketingDistribution.updateMany({
        where: { client_id: id },
        data: { client_name: name }
      });
    }

    // 3. 부서명이 변경된 경우 동기화
    if (oldDeptName && newDeptName) {
      await prisma.marketingDistribution.updateMany({
        where: { client_id: id, client_dept: oldDeptName },
        data: { client_dept: newDeptName }
      });
    }

    return NextResponse.json(updatedClient);
  } catch (error) {
    return NextResponse.json({ error: '업데이트 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });
  await prisma.marketingClient.update({ where: { id }, data: { is_active: false } });
  return NextResponse.json({ message: '아카이브 완료' });
}