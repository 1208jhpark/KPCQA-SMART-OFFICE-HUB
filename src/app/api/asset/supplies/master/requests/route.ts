import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  isStockOutSupplyRequest,
  normalizeSupplyRequestStatus,
  type SupplyRequestStatus,
} from '@/utils/supplyRequestStatus';
import { migrateLegacySupplyRequestStatus } from '@/lib/migrateSupplyRequestStatus';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/master/requests';

function assertLv1(auth: Awaited<ReturnType<typeof authorizeApi>>) {
  if (auth.permission.isMaster || auth.permission.myRole === 'LV_1') return;
  throw new Error('FORBIDDEN_ADMIN');
}

function sessionDeptName(user: any) {
  return user?.unit?.unit_name || '소속 부서 없음';
}

/** [GET] 전체 신청 내역 */
export async function GET() {
  try {
    await authorizeApi(MENU_PATH);
    await migrateLegacySupplyRequestStatus();

    const requests = await prisma.supplyRequest.findMany({
      include: { item: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(requests);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/requests GET]', error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

/**
 * [PATCH] 상태 변경
 * - admin_name/dept는 세션 고정
 * - 재고 복구는 서버가 기존 status 기준으로만 결정
 * - DB status는 영어만 저장
 */
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();
    const id = String(body.id || '').trim();
    const nextStatus = normalizeSupplyRequestStatus(body.status) as SupplyRequestStatus | null;

    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });
    if (!nextStatus) {
      return NextResponse.json({ error: '허용되지 않은 상태값입니다.' }, { status: 400 });
    }

    const existing = await prisma.supplyRequest.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });

    const prevStatus =
      normalizeSupplyRequestStatus(existing.status) || (existing.status as SupplyRequestStatus);
    if (prevStatus === nextStatus) {
      return NextResponse.json({ success: true, message: '변경 사항 없음' });
    }

    const needRestore =
      isStockOutSupplyRequest(prevStatus) && nextStatus === 'REJECTED';
    const needRededuct =
      prevStatus === 'REJECTED' && isStockOutSupplyRequest(nextStatus);

    const adminOpinion =
      body.admin_opinion !== undefined
        ? String(body.admin_opinion)
        : existing.admin_opinion;

    try {
      await prisma.$transaction(async (tx) => {
        // 1) 이전 status 조건부 선점 — 이미 다른 관리자가 바꿨으면 실패 (재고 손대기 전)
        const claimed = await tx.supplyRequest.updateMany({
          where: { id, status: existing.status },
          data: {
            status: nextStatus,
            admin_opinion: adminOpinion,
            admin_name: auth.user.name || '관리자',
            admin_dept: sessionDeptName(auth.user),
            processedAt: nextStatus === 'PENDING' ? null : new Date(),
          },
        });
        if (claimed.count === 0) {
          throw new Error('STATUS_CONFLICT');
        }

        // 2) 선점 성공 후에만 재고 조정
        if (needRestore) {
          await tx.supplyItem.update({
            where: { id: existing.item_id },
            data: { current_stock: { increment: existing.qty } },
          });
        }

        if (needRededuct) {
          const updated = await tx.supplyItem.updateMany({
            where: {
              id: existing.item_id,
              current_stock: { gte: existing.qty },
            },
            data: { current_stock: { decrement: existing.qty } },
          });
          if (updated.count === 0) {
            throw new Error('STOCK_INSUFFICIENT');
          }
        }
      });
    } catch (e: any) {
      if (e?.message === 'STATUS_CONFLICT') {
        return NextResponse.json(
          { error: '다른 관리자가 이미 처리한 건입니다. 새로고침 후 다시 확인해 주세요.' },
          { status: 409 }
        );
      }
      if (e?.message === 'STOCK_INSUFFICIENT') {
        return NextResponse.json(
          { error: '재고가 부족하여 상태를 변경할 수 없습니다.' },
          { status: 409 }
        );
      }
      throw e;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/requests PATCH]', error);
    return NextResponse.json({ error: '상태 업데이트 중 서버 오류 발생' }, { status: 500 });
  }
}

/**
 * [DELETE] 신청 영구 삭제 — 편집 권한 필요
 * - PENDING / REJECTED: 편집 관리자 가능
 * - COMPLETED: LV_1만
 */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.supplyRequest.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });

    const status = normalizeSupplyRequestStatus(existing.status) || existing.status;

    if (status === 'COMPLETED') {
      assertLv1(auth);
    }

    await prisma.$transaction(async (tx) => {
      if (isStockOutSupplyRequest(status)) {
        await tx.supplyItem.update({
          where: { id: existing.item_id },
          data: { current_stock: { increment: existing.qty } },
        });
      }
      await tx.supplyRequest.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/requests DELETE]', error);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
