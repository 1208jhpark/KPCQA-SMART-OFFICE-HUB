import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 1. 대시보드에서 [종료 처리] 버튼 누를 때 데이터 저장
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const archive = await prisma.iTAssetArchive.create({
      data: {
        id: body.id,
        category: body.category || '',
        it_type: body.it_type || '',
        dept: body.dept || '',
        user: body.user,
        code: body.code || '',
        model: body.model || '',
        sn: body.sn,
        brand: body.brand,
        spec: body.spec,
        is_rental: body.is_rental || '구매',
        purchase_price: body.purchase_price || 0,
        monthly_fee: body.monthly_fee || 0,
        monthly_sub_fee: body.monthly_sub_fee || 0,
        in_date: body.in_date,
        end_date: body.end_date,
        first_bill: body.first_bill,
        cycle: body.cycle || 0,
        memo: body.memo,
        reg_date: body.reg_date,
        status: body.status || '기타',
        reason: body.reason,
        reseller: body.reseller,
        resellPrice: body.resellPrice || 0,
        terminated_at: body.terminated_at,
      }
    });
    return NextResponse.json(archive);
  } catch (error) {
    console.error("Archive POST Error:", error);
    return NextResponse.json({ message: 'Archive Save Failed', error }, { status: 500 });
  }
}

// 2. 아카이브 페이지에서 데이터 불러오기
export async function GET() {
  try {
    const archives = await prisma.iTAssetArchive.findMany({
      orderBy: { terminated_at: 'desc' }
    });
    return NextResponse.json(archives);
  } catch (error) {
    return NextResponse.json({ message: 'Fetch Failed', error }, { status: 500 });
  }
}

// 3. 아카이브 페이지에서 데이터 영구 삭제
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ message: 'ID required' }, { status: 400 });
    
    await prisma.iTAssetArchive.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ message: 'Delete Failed', error }, { status: 500 });
  }
}