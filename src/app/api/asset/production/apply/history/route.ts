import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '@/lib/jwt';

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return NextResponse.json({ message: 'No Token' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);

    // URL에서 조회 조건 파라미터 가져오기 (예: ?scope=dept 또는 본인)
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'OWN';

    let whereClause: any = { isArchived: false }; // 숨김 처리되지 않은 데이터만 조회

    if (scope === 'OWN') {
      whereClause.userEmail = decoded.email;
    } else if (scope === 'DEPT') {
      // 부서 전체 조회를 위해 현재 유저의 부서명을 DB에서 다시 확인
      const user = await prisma.user.findUnique({
        where: { email: decoded.email },
        include: { unit: true }
      });
      whereClause.deptName = user?.unit?.unit_name || 'Unknown';
    }

    // 최신 신청순으로 데이터 가져오기
    const histories = await prisma.productionRequest.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(histories);

  } catch (error) {
    console.error("History Fetch Error:", error);
    return NextResponse.json({ message: '데이터 조회 중 오류 발생' }, { status: 500 });
  }
}

/** 본인 신청 · 대기중(PENDING) — cancel(삭제) / update(수정 확인) */
export async function PATCH(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return NextResponse.json({ message: 'No Token' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const body = await req.json();
    const id = String(body.id || '').trim();
    const action = String(body.action || 'cancel').trim();

    if (!id) return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });

    const row = await prisma.productionRequest.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ message: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
    if (row.userEmail !== decoded.email) {
      return NextResponse.json({ message: '본인 신청만 처리할 수 있습니다.' }, { status: 403 });
    }
    if (row.status !== 'PENDING') {
      return NextResponse.json(
        { message: '대기중(미접수) 상태에서만 처리할 수 있습니다.' },
        { status: 400 }
      );
    }

    if (action === 'cancel') {
      await prisma.productionRequest.delete({ where: { id } });
      return NextResponse.json({ message: '신청이 취소되어 삭제되었습니다.' });
    }

    if (action === 'update') {
      const prevOptions =
        row.options && typeof row.options === 'object' && !Array.isArray(row.options)
          ? (row.options as Record<string, unknown>)
          : {};
      const nextOptions =
        body.options && typeof body.options === 'object' && !Array.isArray(body.options)
          ? { ...prevOptions, ...body.options }
          : prevOptions;

      const title =
        body.title != null ? String(body.title).trim() : row.title;
      if (!title) {
        return NextResponse.json({ message: '관리용 제목은 필수입니다.' }, { status: 400 });
      }
      const quantity =
        body.quantity != null
          ? Math.max(1, Number(body.quantity) || 1)
          : row.quantity;

      const updated = await prisma.productionRequest.update({
        where: { id },
        data: {
          title,
          quantity,
          options: nextOptions,
        },
      });
      return NextResponse.json({ message: '수정이 저장되었습니다.', data: updated });
    }

    return NextResponse.json({ message: '지원하지 않는 동작입니다.' }, { status: 400 });
  } catch (error) {
    console.error('Production history PATCH error:', error);
    return NextResponse.json({ message: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}