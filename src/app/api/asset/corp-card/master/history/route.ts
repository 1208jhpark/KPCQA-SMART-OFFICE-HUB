import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/corp-card/master/history';
const AUTH_ERRORS = new Set([
  'UNAUTHORIZED',
  'UNAUTHORIZED_EXPIRED',
  'USER_NOT_FOUND',
  'FORBIDDEN',
  'FORBIDDEN_EDIT',
  'FORBIDDEN_ADMIN',
  'MENU_NOT_CONFIGURED',
]);

/** 영구 삭제 — 시스템 역할 LV_1만 (메뉴 Master 제외) */
function assertLv1(auth: Awaited<ReturnType<typeof authorizeApi>>) {
  if (auth.permission.myRole === 'LV_1') return;
  throw new Error('FORBIDDEN_ADMIN');
}

type UsageRow = {
  id: string;
  cardId: string;
  unitId: string;
  unitName: string;
  cardName: string;
  issuer: string;
  last4: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  place: string;
  purpose: string;
  reservedAt: Date | null;
  checkoutAt: Date | null;
  expectedReturnAt: Date | null;
  amount: string;
  returnedAt: Date | null;
  userConfirmedBy: string;
  userConfirmedAt: Date | null;
  managerConfirmedBy: string;
  managerConfirmedAt: Date | null;
  pickupType: string;
  pickupName: string;
  returnType: string;
  checkoutConfirmedBy: string;
  checkoutConfirmedAt: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  liveUnitName: string | null;
};

function toErrorResponse(error: unknown, fallback: string) {
  const msg = error instanceof Error ? error.message : String(error);
  if (AUTH_ERRORS.has(msg)) return authErrorToResponse(error);
  console.error('[corp-card master history]', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function serializeUsageDate(value: Date | string | null | undefined) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:00+09:00`;
}

function serializeUsage(row: UsageRow) {
  return {
    id: row.id,
    cardId: row.cardId,
    unitId: row.unitId,
    unitName: row.liveUnitName || row.unitName || '',
    cardName: row.cardName,
    issuer: String(row.issuer || '').trim(),
    last4: row.last4,
    userId: row.userId || '',
    userName: row.userName || '',
    userEmail: row.userEmail || '',
    place: row.place || '',
    purpose: row.purpose || '',
    reservedAt: serializeUsageDate(row.reservedAt),
    checkoutAt: serializeUsageDate(row.checkoutAt),
    expectedReturnAt: serializeUsageDate(row.expectedReturnAt),
    amount: row.amount || '',
    returnedAt: serializeUsageDate(row.returnedAt),
    userConfirmedBy: row.userConfirmedBy || '',
    userConfirmedAt: serializeUsageDate(row.userConfirmedAt),
    managerConfirmedBy: row.managerConfirmedBy || '',
    managerConfirmedAt: serializeUsageDate(row.managerConfirmedAt),
    pickupType: String(row.pickupType || '').toUpperCase() === 'PROXY' ? 'PROXY' : row.pickupType || '',
    pickupName: row.pickupName || '',
    returnType: String(row.returnType || '').toUpperCase() === 'PROXY' ? 'PROXY' : row.returnType || '',
    checkoutConfirmedBy: row.checkoutConfirmedBy || '',
    checkoutConfirmedAt: serializeUsageDate(row.checkoutConfirmedAt),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET() {
  try {
    const auth = await authorizeApi(MENU_PATH);
    let items: UsageRow[] = [];
    try {
      items = await prisma.$queryRaw<UsageRow[]>`
        SELECT
          u.*,
          ou."unit_name" AS "liveUnitName"
        FROM "CorpCardUsage" u
        LEFT JOIN "OrgUnit" ou ON ou."id" = u."unitId"
        WHERE u."status" = 'RETURNED'
        ORDER BY u."createdAt" DESC
      `;
    } catch (error) {
      console.warn('[corp-card master history] usage query skipped', error);
    }
    return NextResponse.json({
      ok: true,
      path: MENU_PATH,
      userName: auth.user?.name || '',
      userId: auth.user?.id || '',
      canEdit: Boolean(auth.permission?.isEditor),
      isLv1: auth.permission?.myRole === 'LV_1',
      cards: [],
      items: items.map(serializeUsage),
    });
  } catch (error) {
    return toErrorResponse(error, '법인카드 반납 이력을 불러오지 못했습니다.');
  }
}

/** [DELETE] 반납 완료 이력 영구 삭제 — LV_1만 */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH);
    assertLv1(auth);

    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const fromQuery = String(searchParams.get('id') || '').trim();
    const rawIds = Array.isArray(body.ids)
      ? body.ids
      : body.id
        ? [body.id]
        : fromQuery
          ? [fromQuery]
          : [];
    const ids = [
      ...new Set(
        rawIds
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean)
      ),
    ];
    if (ids.length === 0) {
      return NextResponse.json({ error: '삭제할 항목을 선택해 주세요.' }, { status: 400 });
    }

    const idSql = Prisma.join(ids.map((id) => Prisma.sql`${id}`));
    const deleted = await prisma.$executeRaw`
      DELETE FROM "CorpCardUsage"
      WHERE "id" IN (${idSql}) AND "status" = 'RETURNED'
    `;

    return NextResponse.json({
      ok: true,
      deleted: Number(deleted) || 0,
      requested: ids.length,
    });
  } catch (error) {
    return toErrorResponse(error, '이력 삭제에 실패했습니다.');
  }
}
