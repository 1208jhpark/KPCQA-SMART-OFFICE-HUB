import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { withProductionDeptDisplayNames } from '@/lib/production-dept-scope';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/production/apply/request',
  '/asset/production/apply/history',
];

/** [GET] 신청 이력 — 메뉴 Access (본인 / 부서 스코프) */
export async function GET(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS);
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'OWN';

    let whereClause: any = { isArchived: false };

    if (scope === 'OWN') {
      whereClause.userEmail = auth.user.email;
    } else if (scope === 'DEPT') {
      // unitId 우선 + 레거시(null)만 이름/동료 이메일 폴백 — 조직명 변경에 안전
      const unitId = auth.user.unit_id;
      const unitName = String(auth.user.unit?.unit_name || '').trim();
      if (unitId) {
        const peers = await prisma.user.findMany({
          where: { unit_id: unitId },
          select: { email: true },
        });
        const emails = peers.map((p) => p.email).filter(Boolean);
        const or: Prisma.ProductionRequestWhereInput[] = [{ unitId }];
        if (unitName) {
          or.push({ AND: [{ unitId: null }, { deptName: unitName }] });
        }
        if (emails.length > 0) {
          or.push({ AND: [{ unitId: null }, { userEmail: { in: emails } }] });
        }
        whereClause = { isArchived: false, OR: or };
      } else if (unitName) {
        whereClause.deptName = unitName;
      } else {
        whereClause.userEmail = auth.user.email;
      }
    } else {
      whereClause.userEmail = auth.user.email;
    }

    const histories = await prisma.productionRequest.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(await withProductionDeptDisplayNames(histories));
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('History Fetch Error:', error);
    return NextResponse.json({ message: '데이터 조회 중 오류 발생' }, { status: 500 });
  }
}

/** 본인 신청 — cancel / revert-accept / confirm-receive / update — Access + 본인만 */
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS);
    const body = await req.json();
    const id = String(body.id || '').trim();
    const action = String(body.action || 'cancel').trim();

    if (!id) return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });

    const row = await prisma.productionRequest.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ message: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
    if (row.userEmail.toLowerCase() !== String(auth.user.email || '').toLowerCase()) {
      return NextResponse.json({ message: '본인 신청만 처리할 수 있습니다.' }, { status: 403 });
    }

    if (action === 'cancel') {
      if (row.status !== 'PENDING') {
        return NextResponse.json(
          { message: '접수대기(미접수) 상태에서만 신청을 취소할 수 있습니다.' },
          { status: 400 }
        );
      }
      await prisma.productionRequest.delete({ where: { id } });
      return NextResponse.json({ message: '신청이 취소되어 삭제되었습니다.' });
    }

    if (action === 'revert-accept' || action === 'unaccept') {
      if (row.status !== 'ACCEPTED') {
        return NextResponse.json(
          { message: '발주대기 상태인 건만 접수를 취소할 수 있습니다.' },
          { status: 400 }
        );
      }
      const updated = await prisma.productionRequest.update({
        where: { id },
        data: { status: 'PENDING' },
      });
      return NextResponse.json({
        message: '접수를 취소하고 신청 대기 상태로 되돌렸습니다.',
        data: updated,
      });
    }

    if (action === 'confirm-receive') {
      if (row.status !== 'ORDERED') {
        return NextResponse.json(
          { message: '발주 완료 상태의 건만 수령완료할 수 있습니다.' },
          { status: 400 }
        );
      }
      const opts =
        row.options && typeof row.options === 'object' && !Array.isArray(row.options)
          ? (row.options as Record<string, unknown>)
          : {};
      if (opts.vendorDispatched !== true) {
        return NextResponse.json(
          { message: '외주 발주가 완료된 후 수령완료 처리할 수 있습니다.' },
          { status: 400 }
        );
      }
      const updated = await prisma.productionRequest.update({
        where: { id },
        data: { status: 'VERIFIED' },
      });
      return NextResponse.json({
        message: '수령완료 처리되었습니다.',
        data: updated,
      });
    }

    if (action === 'update') {
      if (row.status !== 'PENDING') {
        return NextResponse.json(
          { message: '접수대기(미접수) 상태에서만 수정할 수 있습니다.' },
          { status: 400 }
        );
      }
      const prevOptions =
        row.options && typeof row.options === 'object' && !Array.isArray(row.options)
          ? (row.options as Record<string, unknown>)
          : {};
      const nextOptions =
        body.options && typeof body.options === 'object' && !Array.isArray(body.options)
          ? { ...prevOptions, ...body.options }
          : prevOptions;

      const title = body.title != null ? String(body.title).trim() : row.title;
      if (!title) {
        return NextResponse.json({ message: '관리용 제목은 필수입니다.' }, { status: 400 });
      }
      const quantity =
        body.quantity != null ? Math.max(1, Number(body.quantity) || 1) : row.quantity;

      const updated = await prisma.productionRequest.update({
        where: { id },
        data: {
          title,
          quantity,
          options: nextOptions as Prisma.InputJsonValue,
        },
      });
      return NextResponse.json({ message: '수정이 저장되었습니다.', data: updated });
    }

    return NextResponse.json({ message: '지원하지 않는 동작입니다.' }, { status: 400 });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Production history PATCH error:', error);
    return NextResponse.json({ message: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
