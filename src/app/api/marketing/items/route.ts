import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dept = searchParams.get('dept');
  try {
    const items = await prisma.marketingItem.findMany({
      where: dept && dept !== '전체' ? { owner_dept: dept } : {},
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(items);
  } catch (error) { return NextResponse.json({ error: '로드 실패' }, { status: 500 }); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const newItem = await prisma.marketingItem.create({
      data: {
        owner_type: body.owner_type || 'CENTER',
        owner_dept: body.owner_dept,
        name: body.name,
        unit_price: Number(body.unit_price) || 0,
        current_stock: Number(body.current_stock) || 0,
        alert_qty: Number(body.alert_qty) || 0, // 🚀 신규 추가
        description: body.description || '',
        image_url: body.image_url || ''
      }
    });
    return NextResponse.json(newItem);
  } catch (error) { return NextResponse.json({ error: '등록 실패' }, { status: 500 }); }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, name, unit_price, current_stock, alert_qty, description, image_url, owner_dept } = body;
    if (!id) return NextResponse.json({ error: 'ID가 없습니다.' }, { status: 400 });

    const updatedItem = await prisma.marketingItem.update({
      where: { id },
      data: {
        name, owner_dept, description, image_url,
        unit_price: Number(unit_price) || 0,
        current_stock: Number(current_stock) || 0,
        alert_qty: Number(alert_qty) || 0, // 🚀 신규 추가
      }
    });
    return NextResponse.json(updatedItem);
  } catch (error: any) { return NextResponse.json({ error: '수정 실패', details: error.message }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });
    await prisma.marketingItem.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) { return NextResponse.json({ error: '삭제 실패' }, { status: 500 }); }
}