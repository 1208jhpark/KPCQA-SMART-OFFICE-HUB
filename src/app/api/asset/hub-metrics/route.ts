import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  isPendingSupplyRequest,
  isCompletedSupplyRequest,
} from '@/utils/supplyRequestStatus';
import {
  isBusinessCardUserApplyPending,
  isBusinessCardUserReadyPickup,
} from '@/lib/businesscard-status';
import { getKSTNowYearMonth, getKSTYearMonthParts } from '@/utils/dateUtils';

export const dynamic = 'force-dynamic';

/** /asset 허브 카드 집계 — 신청자 세션 이메일 기준 (마스터 메뉴 불필요) */
const HUB_MENU_PATHS = [
  '/asset',
  '/asset/supplies/inventory',
  '/asset/supplies/dept',
  '/asset/businesscard/my-page',
  '/equipment/it/personal',
];

export async function GET() {
  try {
    const auth = await authorizeAnyMenuPaths(HUB_MENU_PATHS);
    const emailRaw = String(auth.user.email || '').trim();
    if (!emailRaw) {
      return NextResponse.json({ message: '인증 정보가 누락되었습니다.' }, { status: 400 });
    }

    const [supplyRows, bizRows] = await Promise.all([
      prisma.supplyRequest.findMany({
        where: { user_email: { equals: emailRaw, mode: 'insensitive' } },
        select: { status: true, processedAt: true, updatedAt: true },
      }),
      prisma.businessCardRequest.findMany({
        where: {
          userEmail: { equals: emailRaw, mode: 'insensitive' },
          isArchived: false,
        },
        select: { adminStatus: true },
      }),
    ]);

    const nowYm = getKSTNowYearMonth();
    const thisYear = String(nowYm.year);
    const thisMonth = String(nowYm.month).padStart(2, '0');

    const mySupPending = supplyRows.filter((r) => isPendingSupplyRequest(r.status)).length;
    /** 내가 신청 · 마스터 지급승인(COMPLETED) · 이번 달(KST) 처리분만 */
    const mySupMonthlyCompleted = supplyRows.filter((r) => {
      if (!isCompletedSupplyRequest(r.status)) return false;
      const ym = getKSTYearMonthParts(r.processedAt || r.updatedAt);
      return ym?.year === thisYear && ym?.month === thisMonth;
    }).length;

    const myBizPending = bizRows.filter((r) =>
      isBusinessCardUserApplyPending(r.adminStatus)
    ).length;
    const myBizReady = bizRows.filter((r) =>
      isBusinessCardUserReadyPickup(r.adminStatus)
    ).length;

    return NextResponse.json(
      {
        supplies: { myPending: mySupPending, readyPickup: mySupMonthlyCompleted },
        bizcard: { myPending: myBizPending, readyPickup: myBizReady },
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/hub-metrics GET]', error);
    return NextResponse.json({ message: '허브 집계 로드 실패' }, { status: 500 });
  }
}
