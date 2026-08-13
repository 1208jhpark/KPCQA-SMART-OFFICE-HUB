import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

/** 마스터 Step4 카드 공통 — 어느 카드 Access든 대기 건수만 */
const MASTER_MENU_PATHS = [
  '/asset/supplies/master/dashboard',
  '/asset/supplies/master/requests',
  '/asset/supplies/master/purchase',
  '/asset/supplies/master/archive',
];

const PENDING_STATUSES = ['PENDING', '대기중', '대기'];

/**
 * [GET] 신청 대기 건수 (네비 배지용)
 * - 전체 requests 목록을 받지 않음
 * - requests Access 없이도 다른 마스터 카드 Access면 조회 가능
 */
export async function GET() {
  try {
    await authorizeAnyMenuPaths(MASTER_MENU_PATHS);

    const pendingCount = await prisma.supplyRequest.count({
      where: { status: { in: PENDING_STATUSES } },
    });

    return NextResponse.json({ pendingCount });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/pending-count GET]', error);
    return NextResponse.json({ error: '대기 건수 조회 실패' }, { status: 500 });
  }
}
