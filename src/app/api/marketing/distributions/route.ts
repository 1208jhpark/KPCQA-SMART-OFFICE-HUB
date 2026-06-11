import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 1. 지급 이력 조회 (🚀 sender 또는 dept 필터링 동시 지원)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sender = searchParams.get('sender');
  const dept = searchParams.get('dept'); // 🚀 부서 필터 추가
  
  try {
    const whereClause: any = {};
    if (sender) whereClause.sender_name = sender;
    if (dept) whereClause.sender_dept = dept;

    const distributions = await prisma.marketingDistribution.findMany({
      where: whereClause,
      include: { item: true },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(distributions);
  } catch (error) {
    return NextResponse.json({ error: '데이터 로드 실패' }, { status: 500 });
  }
}

// 2. 지급 등록 (기존 동일)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const item = await prisma.marketingItem.findUnique({ where: { id: body.item_id } });
    if (!item) return NextResponse.json({ error: '물품을 찾을 수 없습니다.' }, { status: 404 });
    if (item.current_stock < Number(body.qty)) {
      return NextResponse.json({ error: '보유 재고가 부족합니다.' }, { status: 400 });
    }
  
    const [newDist] = await prisma.$transaction([
      prisma.marketingDistribution.create({
        data: {
          item_id: body.item_id,
          client_id: body.client_id || null,
          client_name: body.client_name,
          client_dept: body.client_dept || '전사',
          qty: Number(body.qty),
          purpose: body.purpose || '',
          sender_name: body.sender_name,
          sender_dept: body.sender_dept,
          dist_date: body.dist_date ? new Date(body.dist_date) : new Date(),
        }
      }),
      prisma.marketingItem.update({
        where: { id: body.item_id },
        data: { current_stock: { decrement: Number(body.qty) } }
      })
    ]);
  
    if (body.client_id && body.client_dept) {
      const client = await prisma.marketingClient.findUnique({ where: { id: body.client_id } });
      if (client) {
        let currentDepts = Array.isArray(client.departments) ? (client.departments as any[]) : [];
        const existingDeptNames = currentDepts.map(d => typeof d === 'string' ? d : d.name);
        if (!existingDeptNames.includes(body.client_dept)) {
          const updatedDepts = [...currentDepts, { name: body.client_dept, is_hidden: false }];
          await prisma.marketingClient.update({
            where: { id: body.client_id },
            data: { departments: updatedDepts }
          });
        }
      }
    }
    return NextResponse.json(newDist);
  } catch (error: any) {
    return NextResponse.json({ error: '등록 및 재고 처리 실패' }, { status: 500 });
  }
}

// 3. 지급 내역 수정 (기존 동일)
export async function PATCH(req: Request) {
  try {
    const { id, client_name, client_dept, dist_date } = await req.json();
    const updated = await prisma.marketingDistribution.update({
      where: { id },
      data: {
        client_name,
        client_dept,
        dist_date: dist_date ? new Date(dist_date) : undefined
      }
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}

// 4. 지급 취소 (기존 동일)
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });
  
    const dist = await prisma.marketingDistribution.findUnique({ where: { id: id } });
    if (!dist) return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
  
    await prisma.$transaction([
      prisma.marketingDistribution.delete({ where: { id: id } }),
      prisma.marketingItem.update({
        where: { id: dist.item_id },
        data: { current_stock: { increment: dist.qty } }
      })
    ]);
    return NextResponse.json({ message: '취소 및 재고 복구 완료' });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}