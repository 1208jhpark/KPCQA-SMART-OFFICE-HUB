import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  isPendingSupplyRequest,
  isReadySupplyRequest,
} from '@/utils/supplyRequestStatus';
import {
  isBusinessCardUserApplyPending,
  isBusinessCardUserReadyPickup,
} from '@/lib/businesscard-status';

export const dynamic = 'force-dynamic';

/** /asset 허브 카드 집계 — 신청자 세션 이메일 기준 (마스터 메뉴 불필요) */
const HUB_MENU_PATHS = [
  '/asset',
  '/asset/supplies/inventory',
  '/asset/supplies/dept',
  '/asset/businesscard/my-page',
  '/asset/production/apply/request',
  '/asset/production/apply/history',
  '/asset/it/personal',
];

export async function GET() {
  try {
    const auth = await authorizeAnyMenuPaths(HUB_MENU_PATHS);
    const emailRaw = String(auth.user.email || '').trim();
    if (!emailRaw) {
      return NextResponse.json({ message: '인증 정보가 누락되었습니다.' }, { status: 400 });
    }

    const [supplyRows, bizRows, prodRows] = await Promise.all([
      prisma.supplyRequest.findMany({
        where: { user_email: { equals: emailRaw, mode: 'insensitive' } },
        select: { status: true },
      }),
      prisma.businessCardRequest.findMany({
        where: {
          userEmail: { equals: emailRaw, mode: 'insensitive' },
          isArchived: false,
        },
        select: { adminStatus: true },
      }),
      prisma.productionRequest.findMany({
        where: {
          userEmail: { equals: emailRaw, mode: 'insensitive' },
          isArchived: false,
        },
        select: { status: true, options: true },
      }),
    ]);

    const mySupPending = supplyRows.filter((r) => isPendingSupplyRequest(r.status)).length;
    const mySupReady = supplyRows.filter((r) => isReadySupplyRequest(r.status)).length;

    const myBizPending = bizRows.filter((r) =>
      isBusinessCardUserApplyPending(r.adminStatus)
    ).length;
    const myBizReady = bizRows.filter((r) =>
      isBusinessCardUserReadyPickup(r.adminStatus)
    ).length;

    const myProdAcceptWait = prodRows.filter((r) => {
      const st = String(r.status || '').toUpperCase();
      if (st === 'PENDING' || st === 'ACCEPTED') return true;
      if (st === 'ORDERED') {
        const opts = (r.options || {}) as Record<string, unknown>;
        return opts.vendorDispatched !== true;
      }
      return false;
    }).length;

    const myProdInProgress = prodRows.filter((r) => {
      const st = String(r.status || '').toUpperCase();
      const opts = (r.options || {}) as Record<string, unknown>;
      return st === 'ORDERED' && opts.vendorDispatched === true;
    }).length;

    return NextResponse.json(
      {
        supplies: { myPending: mySupPending, readyPickup: mySupReady },
        bizcard: { myPending: myBizPending, readyPickup: myBizReady },
        production: { myPending: myProdAcceptWait, inProgress: myProdInProgress },
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
