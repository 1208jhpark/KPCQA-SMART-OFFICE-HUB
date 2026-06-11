import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
  
export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';
  
const cleanNum = (val: any) => Number(String(val).replace(/,/g, '')) || 0;
  
// 🚀 1. 마스터 데이터 조회 (GET)
export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    let user = null;
    if (token) {
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        user = await prisma.user.findUnique({ 
          where: { email: decoded.email }, 
          include: { unit: true } 
        });
      } catch (e) {}
    }
  
    const config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    let units: any[] = []; 
    if (config?.unit_category_group) {
      const unitGroup = await prisma.masterGroup.findUnique({
        where: { id: config.unit_category_group },
        include: { codes: { where: { is_active: true }, orderBy: { sort_order: 'asc' } } }
      });
      if (unitGroup) units = unitGroup.codes;
    }
  
    const items = await prisma.supplyItem.findMany({
      where: { is_active: true }, // 활성 아이템만 조회
      include: { 
        purchases: { orderBy: { purchase_date: 'desc' }, take: 1 }, 
        requests: { where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } }
      },
      orderBy: { createdAt: 'desc' }
    });
  
    return NextResponse.json({ units, items, user });
  } catch (error) {
    return NextResponse.json({ error: '대시보드 로드 실패' }, { status: 500 });
  }
}
  
// 🚀 2. 신규 품목 등록 (POST)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const p_qty = cleanNum(body.p_qty) || 1;
    const sub_qty = cleanNum(body.sub_qty) || 1;
    const total_stock = p_qty * sub_qty; 
    const batch_price = cleanNum(body.batch_price);
    const unit_price = Math.floor(batch_price / (total_stock || 1));
  
    const description = JSON.stringify({ 
      p_qty, p_unit: body.p_unit, s_unit: body.s_unit, sub_qty, batch_price, vendor: body.vendor 
    });
  
    const newItem = await prisma.supplyItem.create({
      data: {
        name: body.name, unit_price, current_stock: total_stock, alert_qty: cleanNum(body.alert_qty),
        owner_dept: body.owner_dept || '전사', category: body.category || '일반',
        description, image_url: body.image_url, is_published: false, is_active: true
      }
    });
    return NextResponse.json(newItem);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
  
// 🚀 3. 품목 수정 / 게시 토글 / 폐기 처리 / 복구 처리 (PATCH)
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id } = body;
  
    // [A-1] 폐기 처리 (is_active: false)
    if (body.is_active === false) {
      const item = await prisma.supplyItem.findUnique({ where: { id } });
      let ext = JSON.parse(item?.description || '{}');
      
      ext = { 
        ...ext, 
        disposal_date: body.disposal_date || new Date().toISOString(), 
        disposal_reason: body.disposal_reason, disposer_dept: body.disposer_dept, disposer_name: body.disposer_name 
      };
  
      await prisma.supplyItem.update({
        where: { id },
        data: { is_active: false, is_published: false, description: JSON.stringify(ext) }
      });
      return NextResponse.json({ success: true, message: '폐기 완료' });
    }

    // 🚀 [A-2] 신규 추가: 아카이브에서 대시보드로 복구 처리 (is_active: true)
    if (body.is_active === true && Object.keys(body).length <= 2) {
      const updated = await prisma.supplyItem.update({
        where: { id },
        data: { is_active: true }
      });
      return NextResponse.json({ success: true, message: '복구 완료', data: updated });
    }
  
    // [B] 게시 상태만 토글 (is_published)
    if (body.is_published !== undefined && Object.keys(body).length <= 3) {
      await prisma.supplyItem.update({ where: { id }, data: { is_published: body.is_published } });
      return NextResponse.json({ success: true });
    }
  
    // [C] 전체 정보 수정
    const p_qty = cleanNum(body.p_qty) || 1;
    const sub_qty = cleanNum(body.sub_qty) || 1;
    const batch_price = cleanNum(body.batch_price);
    const unit_price = Math.floor(batch_price / ((p_qty * sub_qty) || 1));
  
    const description = JSON.stringify({ 
      p_qty, p_unit: body.p_unit, s_unit: body.s_unit, sub_qty, batch_price, vendor: body.vendor 
    });
  
    const updated = await prisma.supplyItem.update({
      where: { id },
      data: { 
        name: body.name, unit_price, current_stock: cleanNum(body.current_stock), 
        alert_qty: cleanNum(body.alert_qty), description, image_url: body.image_url 
      }
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
  
// 🚀 4. 품목 삭제 (DELETE)
export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });
  
    const item = await prisma.supplyItem.findUnique({ 
      where: { id }, include: { _count: { select: { requests: true, purchases: true } } } 
    });
  
    if ((item?._count.requests || 0) > 0 || (item?._count.purchases || 0) > 0) {
      return NextResponse.json({ error: '지급/입고 이력이 존재하여 삭제할 수 없습니다. 대신 폐기 처리를 이용하세요.' }, { status: 400 });
    }
  
    await prisma.supplyItem.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}