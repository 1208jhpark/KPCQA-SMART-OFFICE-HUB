import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/corp-card/master/monitoring';
const AUTH_ERRORS = new Set([
  'UNAUTHORIZED',
  'UNAUTHORIZED_EXPIRED',
  'USER_NOT_FOUND',
  'FORBIDDEN',
  'FORBIDDEN_EDIT',
  'FORBIDDEN_ADMIN',
  'MENU_NOT_CONFIGURED',
]);

type CardRow = {
  id: string;
  name: string;
  issuer: string | null;
  last4: string;
  unitId: string;
  unitName: string;
  status: string;
  liveUnitName: string | null;
};

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
  console.error('[corp-card monitoring]', error);
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
    let cardRows: CardRow[] = [];
    try {
      items = await prisma.$queryRaw<UsageRow[]>`
        SELECT
          u.*,
          ou."unit_name" AS "liveUnitName"
        FROM "CorpCardUsage" u
        LEFT JOIN "OrgUnit" ou ON ou."id" = u."unitId"
        WHERE u."status" <> 'RESERVED' AND u."status" <> 'RETURNED'
        ORDER BY u."createdAt" DESC
      `;
    } catch (error) {
      console.warn('[corp-card monitoring] usage query skipped', error);
    }
    try {
      cardRows = await prisma.$queryRaw<CardRow[]>`
        SELECT
          c."id",
          c."name",
          c."issuer",
          c."last4",
          c."unitId",
          c."unitName",
          c."status",
          ou."unit_name" AS "liveUnitName"
        FROM "CorpCard" c
        LEFT JOIN "OrgUnit" ou ON ou."id" = c."unitId"
        ORDER BY c."createdAt" ASC, c."id" ASC
      `;
    } catch (error) {
      console.warn('[corp-card monitoring] card query skipped', error);
    }
    return NextResponse.json({
      ok: true,
      path: MENU_PATH,
      userName: auth.user?.name || '',
      userId: auth.user?.id || '',
      canEdit: Boolean(auth.permission?.isEditor),
      cards: cardRows.map((card) => ({
        id: card.id,
        name: card.name,
        issuer: String(card.issuer || '').trim(),
        last4: card.last4,
        unitId: card.unitId,
        unitName: card.liveUnitName || card.unitName,
        status: card.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        usageStatus: 'AVAILABLE',
        holderName: '',
        openUsageId: '',
      })),
      items: items.map(serializeUsage),
    });
  } catch (error) {
    return toErrorResponse(error, '법인카드 모니터링을 불러오지 못했습니다.');
  }
}
