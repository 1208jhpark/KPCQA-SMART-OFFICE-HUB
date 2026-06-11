import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { addMonths } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const categoryCode = searchParams.get('categoryCode');
  const isArchive = searchParams.get('archive') === 'true';

  try {
    const queryCond: any = {
      // is_archived 여부에 따라 분기 (아카이브 모드가 true면 아카이브만, 아니면 활성장비만)
      // 스키마에 is_archived 필드가 추가되어 있다고 가정
    };

    // 카테고리 필터 적용 (예: 'a', 'b', 'c' 등)
    if (categoryCode) {
      queryCond.category = categoryCode;
    }

    const equipments = await prisma.equipment.findMany({
      where: queryCond,
      include: {
        histories: {
          orderBy: { calib_date: 'desc' }, // 모든 이력 포함
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(equipments);
  } catch (error) {
    return NextResponse.json({ error: '데이터 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const newEq = await prisma.equipment.create({
      data: {
        category: body.category || '기본',
        name: body.name || '',
        brand: body.brand || '',
        model_name: body.model_name || '',
        asset_no: body.asset_no || `TMP-${Date.now()}`, // 임시번호 자동생성 로직 추가
        qty: Number(body.qty) || 1,
        spec_summary: body.spec_summary || '',
        department: body.department || '',
        purchase_date: body.purchase_date ? new Date(body.purchase_date) : null,
        replace_cycle_mo: Number(body.replace_cycle_mo) || null,
        last_replace_date: body.last_replace_date ? new Date(body.last_replace_date) : null,
        calib_cycle_mo: Number(body.calib_cycle_mo) || 12,
        calib_memo: body.calib_memo || '',
        thumbnail_url: body.thumbnail_url || '',
        status: '정상',
      },
    });
    return NextResponse.json(newEq);
  } catch (error: any) {
    console.error("장비 등록 실패:", error.message);
    return NextResponse.json({ error: '장비 등록 실패' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, history, deleteHistoryId, ...updateData } = body;

    if (!id) return NextResponse.json({ error: 'ID 필수' }, { status: 400 });

    // 1. 신규 이력 추가
    if (history) {
      const newHistory = await prisma.calibrationHistory.create({
        data: {
          ...history,
          equipment_id: id,
          calib_date: new Date(history.calib_date), 
        },
      });
      return NextResponse.json(newHistory);
    }

    // 2. 이력 삭제
    if (deleteHistoryId) {
       await prisma.calibrationHistory.delete({
         where: { id: deleteHistoryId }
       });
       return NextResponse.json({ message: '이력 삭제 완료' });
    }

    // 3. 일반 장비 정보 수정
    const updatedEq = await prisma.equipment.update({
      where: { id },
      data: updateData,
      include: {
        histories: { orderBy: { calib_date: 'desc' } }
      }
    });

    return NextResponse.json(updatedEq);
  } catch (error) {
    return NextResponse.json({ error: '업데이트 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 필요' }, { status: 400 });
    
    await prisma.equipment.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}