import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/corp-card/dept/board';
const MONITORING_PATH = '/asset/corp-card/master/monitoring';
const MASTER_HISTORY_PATH = '/asset/corp-card/master/history';
const OPEN_STATUSES = new Set(['RESERVED', 'CHECKOUT_PENDING', 'CHECKED_OUT', 'RETURNING']);
const HELD_STATUSES = new Set(['CHECKOUT_PENDING', 'CHECKED_OUT', 'RETURNING']);
const DEPT_CARD_PATHS = [MENU_PATH, MONITORING_PATH, MASTER_HISTORY_PATH];
const AUTH_ERRORS = new Set([
  'UNAUTHORIZED',
  'UNAUTHORIZED_EXPIRED',
  'USER_NOT_FOUND',
  'FORBIDDEN',
  'FORBIDDEN_EDIT',
  'FORBIDDEN_ADMIN',
  'MENU_NOT_CONFIGURED',
]);

function toErrorResponse(error: unknown, fallback: string) {
  const msg = error instanceof Error ? error.message : String(error);
  if (AUTH_ERRORS.has(msg)) return authErrorToResponse(error);
  console.error('[corp-card board]', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

async function authorizeDeptCard(requireEditor = false) {
  const opts = requireEditor ? { requireEditor: true } : undefined;
  let lastError: unknown;
  for (const path of DEPT_CARD_PATHS) {
    try {
      return await authorizeApi(path, opts);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (!AUTH_ERRORS.has(msg)) throw error;
    }
  }
  throw lastError;
}

type OrgUnitRow = { id: string; unit_name: string; parent_id: string | null };
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
};

let tableReady: Promise<void> | null = null;

async function ensureUsageTable() {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "CorpCardUsage" (
            "id" TEXT NOT NULL,
            "cardId" TEXT NOT NULL,
            "unitId" TEXT NOT NULL,
            "unitName" TEXT NOT NULL DEFAULT '',
            "cardName" TEXT NOT NULL DEFAULT '',
            "issuer" TEXT NOT NULL DEFAULT '',
            "last4" TEXT NOT NULL DEFAULT '',
            "userId" TEXT,
            "userName" TEXT NOT NULL DEFAULT '',
            "userEmail" TEXT NOT NULL DEFAULT '',
            "place" TEXT NOT NULL DEFAULT '',
            "purpose" TEXT NOT NULL DEFAULT '',
            "reservedAt" TIMESTAMP(3),
            "checkoutAt" TIMESTAMP(3),
            "expectedReturnAt" TIMESTAMP(3),
            "amount" TEXT NOT NULL DEFAULT '',
            "returnedAt" TIMESTAMP(3),
            "userConfirmedBy" TEXT NOT NULL DEFAULT '',
            "userConfirmedAt" TIMESTAMP(3),
            "managerConfirmedBy" TEXT NOT NULL DEFAULT '',
            "managerConfirmedAt" TIMESTAMP(3),
            "status" TEXT NOT NULL DEFAULT 'RESERVED',
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "CorpCardUsage_pkey" PRIMARY KEY ("id")
          )`);
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "CorpCardUsage_cardId_idx" ON "CorpCardUsage"("cardId")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "CorpCardUsage_unitId_idx" ON "CorpCardUsage"("unitId")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "CorpCardUsage_status_idx" ON "CorpCardUsage"("status")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "CorpCardUsage_createdAt_idx" ON "CorpCardUsage"("createdAt")`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "pickupType" TEXT NOT NULL DEFAULT ''`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "pickupName" TEXT NOT NULL DEFAULT ''`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "checkoutConfirmedBy" TEXT NOT NULL DEFAULT ''`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "checkoutConfirmedAt" TIMESTAMP(3)`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "returnType" TEXT NOT NULL DEFAULT ''`
        );
      } catch (error) {
        tableReady = null;
        console.warn('[corp-card board] table ensure skipped', error);
      }
    })();
  }
  await tableReady;
}

function parseKstDateTime(raw: unknown): Date | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (m) return new Date(`${m[1]}T${m[2]}:00+09:00`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** datetime-local → PG TIMESTAMP 벽시계 문자열 (세션 TZ와 무관하게 10:30을 10:30으로 저장) */
function wallFromInput(raw: unknown): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}:00`;
  return null;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** TIMESTAMP without TZ: Prisma가 UTC로 태그한 벽시계 → KST ISO */
function serializeUsageDate(value: Date | string | null | undefined) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:00+09:00`;
}

function dbWallToMs(value: Date | string | null | undefined) {
  const iso = serializeUsageDate(value);
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function wallOrDbParam(input: unknown, existing: Date | null) {
  const fromInput = wallFromInput(input);
  if (fromInput) return fromInput;
  const fromDb = serializeUsageDate(existing);
  return fromDb ? fromDb.replace('T', ' ').replace('+09:00', '') : null;
}

function tsSql(wall: string | null) {
  if (!wall) return Prisma.sql`NULL`;
  return Prisma.sql`${wall}::timestamp`;
}

function nowWall() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:00`;
}

function clipText(raw: unknown, max = 80) {
  return String(raw ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function occupancyHolderName(row: {
  status?: string | null;
  userName?: string | null;
  pickupName?: string | null;
  userConfirmedBy?: string | null;
}) {
  const reservedBy = String(row.userName || '').trim();
  const checkoutBy = String(row.pickupName || '').trim();
  const returnedBy = String(row.userConfirmedBy || '').trim();
  if (row.status === 'RETURNING') return returnedBy || checkoutBy || reservedBy;
  if (row.status === 'CHECKED_OUT' || row.status === 'CHECKOUT_PENDING') return checkoutBy || reservedBy;
  return reservedBy;
}

function serializeUsage(row: UsageRow) {
  return {
    id: row.id,
    cardId: row.cardId,
    unitId: row.unitId,
    unitName: row.unitName,
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

function collectScopeUnitIds(myUnitId: string) {
  // 법인카드 부서 보드: HQ·Center·Dept 모두 하위 unit 미포함 — 본인 unit만
  return [myUnitId];
}

type BoardAuth = Awaited<ReturnType<typeof authorizeApi>>;

function mapAuthUnits(auth: BoardAuth): OrgUnitRow[] {
  return (auth.unitsList || []).map((u: any) => ({
    id: String(u.id),
    unit_name: String(u.unit_name || ''),
    parent_id: u.parent_id ? String(u.parent_id) : null,
  }));
}

/** GET/쓰기 공통 — TOTAL·Master·LV_1은 전사 unit, 그 외는 view/edit 스코프 */
function resolveBoardScopeIds(auth: BoardAuth): string[] {
  const myUnit = auth.user?.unit as { id?: string } | null | undefined;
  const myUnitId = String(myUnit?.id || auth.user?.unit_id || '').trim();
  const allUnits = mapAuthUnits(auth);
  const isTotal =
    auth.permission.isMaster ||
    auth.permission.myRole === 'LV_1' ||
    String(auth.permission.viewScope || '').toUpperCase() === 'TOTAL' ||
    String(auth.permission.editScope || '').toUpperCase() === 'TOTAL';
  if (isTotal) {
    return allUnits.map((u) => u.id).filter(Boolean);
  }
  if (!myUnitId) return [];
  return collectScopeUnitIds(myUnitId);
}

function assertUnitInBoardScope(unitId: string, scopeIds: string[]) {
  const id = String(unitId || '').trim();
  if (!id || scopeIds.length === 0) return false;
  return scopeIds.includes(id);
}

async function findUsage(id: string) {
  const rows = await prisma.$queryRaw<UsageRow[]>`
    SELECT * FROM "CorpCardUsage" WHERE "id" = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

async function findOpenUsage(cardId: string) {
  const rows = await prisma.$queryRaw<UsageRow[]>`
    SELECT * FROM "CorpCardUsage"
    WHERE "cardId" = ${cardId} AND "status" IN ('RESERVED', 'CHECKOUT_PENDING', 'CHECKED_OUT', 'RETURNING')
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

function usageRangeMs(row: UsageRow) {
  const startMs = dbWallToMs(row.checkoutAt || row.reservedAt);
  if (startMs == null) return null;
  const endMs = dbWallToMs(row.expectedReturnAt || row.returnedAt);
  if (endMs == null) {
    return {
      startMs,
      endMs: HELD_STATUSES.has(row.status) ? Number.POSITIVE_INFINITY : startMs,
    };
  }
  return { startMs, endMs: Math.max(endMs, startMs) };
}

async function findBlockingUsage(
  cardId: string,
  start: Date,
  end: Date,
  excludeId?: string | null
) {
  const rows = await prisma.$queryRaw<UsageRow[]>`
    SELECT * FROM "CorpCardUsage"
    WHERE "cardId" = ${cardId} AND "status" IN ('RESERVED', 'CHECKOUT_PENDING', 'CHECKED_OUT', 'RETURNING')
    ORDER BY "createdAt" DESC
  `;
  const startMs = start.getTime();
  const endMs = end.getTime();
  return (
    rows.find((row) => {
      if (excludeId && row.id === excludeId) return false;
      if (HELD_STATUSES.has(row.status)) return true;
      const range = usageRangeMs(row);
      if (!range) return false;
      return startMs < range.endMs && endMs > range.startMs;
    }) || null
  );
}

async function findCard(id: string) {
  const rows = await prisma.$queryRaw<CardRow[]>`
    SELECT
      c."id", c."name", c."issuer", c."last4", c."unitId", c."unitName", c."status",
      u."unit_name" AS "liveUnitName"
    FROM "CorpCard" c
    LEFT JOIN "OrgUnit" u ON u."id" = c."unitId"
    WHERE c."id" = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

function actorName(auth: { user?: { name?: string | null; email?: string | null } }) {
  return String(auth.user?.name || auth.user?.email || '').trim();
}

export async function GET(_req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH);
    await ensureUsageTable();

    const myUnit = auth.user?.unit as { id?: string; unit_name?: string } | null | undefined;
    const myUnitId = String(myUnit?.id || auth.user?.unit_id || '').trim();
    const scopeIds = resolveBoardScopeIds(auth);

    if (scopeIds.length === 0) {
      return NextResponse.json({
        ok: true,
        path: MENU_PATH,
        userName: auth.user?.name || '',
        userId: auth.user?.id || '',
        canEdit: Boolean(auth.permission?.isEditor),
        myUnitId: '',
        myUnitName: '',
        cards: [],
        items: [],
      });
    }

    const scopeSql = Prisma.join(scopeIds.map((id) => Prisma.sql`${id}`));
    const cards = await prisma.$queryRaw<CardRow[]>`
      SELECT
        c."id", c."name", c."issuer", c."last4", c."unitId", c."unitName", c."status",
        u."unit_name" AS "liveUnitName"
      FROM "CorpCard" c
      LEFT JOIN "OrgUnit" u ON u."id" = c."unitId"
      WHERE c."unitId" IN (${scopeSql})
        AND COALESCE(c."status", 'ACTIVE') <> 'SUSPENDED'
      ORDER BY c."createdAt" ASC, c."id" ASC
    `;
    const items = await prisma.$queryRaw<UsageRow[]>`
      SELECT * FROM "CorpCardUsage"
      WHERE "unitId" IN (${scopeSql})
      ORDER BY "createdAt" DESC
    `;
    const openByCard = new Map<string, UsageRow>();
    for (const row of items) {
      if (!OPEN_STATUSES.has(row.status)) continue;
      if (!openByCard.has(row.cardId)) openByCard.set(row.cardId, row);
    }

    return NextResponse.json({
      ok: true,
      path: MENU_PATH,
      userName: auth.user?.name || '',
      userId: auth.user?.id || '',
      canEdit: Boolean(auth.permission?.isEditor),
      myUnitId,
      myUnitName: myUnit?.unit_name || '',
      cards: cards.map((card) => {
        const open = openByCard.get(card.id);
        let usageStatus: 'AVAILABLE' | 'RESERVED' | 'CHECKOUT_PENDING' | 'CHECKED_OUT' | 'RETURNING' =
          'AVAILABLE';
        if (open?.status === 'RESERVED') usageStatus = 'RESERVED';
        if (open?.status === 'CHECKOUT_PENDING') usageStatus = 'CHECKOUT_PENDING';
        if (open?.status === 'CHECKED_OUT') usageStatus = 'CHECKED_OUT';
        if (open?.status === 'RETURNING') usageStatus = 'RETURNING';
        return {
          id: card.id,
          name: card.name,
          issuer: String(card.issuer || '').trim(),
          last4: card.last4,
          unitId: card.unitId,
          unitName: card.liveUnitName || card.unitName,
          status: card.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
          usageStatus,
          holderName: open ? occupancyHolderName(open) : '',
          openUsageId: open?.id || '',
        };
      }),
      items: items
        .filter((row) => OPEN_STATUSES.has(row.status))
        .map((row) => serializeUsage(row)),
    });
  } catch (error) {
    return toErrorResponse(error, '법인카드 보드를 불러오지 못했습니다.');
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim().toUpperCase();

    /**
     * 반출·반납 확인 — admin/interface 의 monitoring Edit 만 따름.
     * board Access로 먼저 authorizeDeptCard 하면 보드 스코프에 묶여
     * 모니터링 편집자가 타 부서 건을 확인하지 못하는 문제가 생긴다.
     */
    if (action === 'CONFIRM_MANAGER' || action === 'CONFIRM_CHECKOUT') {
      const auth = await authorizeApi(MONITORING_PATH, { requireEditor: true });
      await ensureUsageTable();
      const actor = actorName(auth);
      const now = new Date();
      const nowWallTs = nowWall();
      const scopeIds = resolveBoardScopeIds(auth);
      const id = String(body.id || '').trim();
      if (!id) return NextResponse.json({ error: '항목 ID가 필요합니다.' }, { status: 400 });
      const existing = await findUsage(id);
      if (!existing) {
        return NextResponse.json({ error: '사용 내역을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (!assertUnitInBoardScope(existing.unitId, scopeIds)) {
        return NextResponse.json({ error: '권한이 없는 사용 내역입니다.' }, { status: 403 });
      }

      if (action === 'CONFIRM_MANAGER') {
        if (existing.status !== 'RETURNING') {
          return NextResponse.json(
            { error: '반납 대기중인 건만 담당자확인할 수 있습니다.' },
            { status: 400 }
          );
        }
        await prisma.$executeRaw`
          UPDATE "CorpCardUsage"
          SET
            "managerConfirmedBy" = ${actor},
            "managerConfirmedAt" = ${tsSql(nowWallTs)},
            "status" = ${'RETURNED'},
            "updatedAt" = ${now}
          WHERE "id" = ${id}
        `;
        const updated = await findUsage(id);
        return NextResponse.json({ ok: true, item: updated ? serializeUsage(updated) : null });
      }

      if (existing.status !== 'CHECKOUT_PENDING') {
        return NextResponse.json(
          { error: '반출 대기중인 건만 반출확인할 수 있습니다.' },
          { status: 400 }
        );
      }
      await prisma.$executeRaw`
        UPDATE "CorpCardUsage"
        SET
          "checkoutAt" = ${tsSql(nowWallTs)},
          "checkoutConfirmedBy" = ${actor},
          "checkoutConfirmedAt" = ${tsSql(nowWallTs)},
          "status" = ${'CHECKED_OUT'},
          "updatedAt" = ${now}
        WHERE "id" = ${id}
      `;
      const updated = await findUsage(id);
      return NextResponse.json({ ok: true, item: updated ? serializeUsage(updated) : null });
    }

    const auth = await authorizeDeptCard();
    await ensureUsageTable();
    const actor = actorName(auth);
    const userId = String(auth.user?.id || '').trim() || null;
    const userEmail = String(auth.user?.email || '').trim();
    const now = new Date();
    const nowWallTs = nowWall();
    const scopeIds = resolveBoardScopeIds(auth);

    if (action === 'RESERVE' || action === 'CHECKOUT' || action === 'RETURN') {
      const cardId = String(body.cardId || '').trim();
      if (!cardId) return NextResponse.json({ error: '카드를 선택해 주세요.' }, { status: 400 });
      const card = await findCard(cardId);
      if (!card) return NextResponse.json({ error: '카드를 찾을 수 없습니다.' }, { status: 404 });
      if (!assertUnitInBoardScope(card.unitId, scopeIds)) {
        return NextResponse.json({ error: '권한이 없는 카드입니다.' }, { status: 403 });
      }
      if (card.status === 'SUSPENDED') {
        return NextResponse.json({ error: '정지된 카드는 사용할 수 없습니다.' }, { status: 400 });
      }
      const open = await findOpenUsage(cardId);
      const unitName = card.liveUnitName || card.unitName;

      if (action === 'RESERVE') {
        const reservedAt = parseKstDateTime(body.reservedAt);
        const expectedReturnAt = parseKstDateTime(body.expectedReturnAt);
        const reservedAtWall = wallFromInput(body.reservedAt);
        const expectedReturnAtWall = wallFromInput(body.expectedReturnAt);
        if (!reservedAt || !reservedAtWall) {
          return NextResponse.json({ error: '반출 예정 일시를 선택해 주세요.' }, { status: 400 });
        }
        if (!expectedReturnAt || !expectedReturnAtWall) {
          return NextResponse.json({ error: '반납 예정 일시를 선택해 주세요.' }, { status: 400 });
        }
        if (expectedReturnAt.getTime() <= reservedAt.getTime()) {
          return NextResponse.json(
            { error: '반납 예정 일시는 반출 예정 일시보다 이후여야 합니다.' },
            { status: 400 }
          );
        }
        const blocking = await findBlockingUsage(cardId, reservedAt, expectedReturnAt);
        if (blocking?.status === 'CHECKED_OUT' || blocking?.status === 'CHECKOUT_PENDING') {
          return NextResponse.json(
            {
              error:
                blocking.status === 'CHECKOUT_PENDING'
                  ? '반출 대기중인 카드입니다.'
                  : '이미 대여 중인 카드입니다.',
            },
            { status: 400 }
          );
        }
        if (blocking) {
          return NextResponse.json(
            { error: '선택한 시간에 이미 예약된 카드입니다.' },
            { status: 400 }
          );
        }
        const id = randomUUID();
        const place = clipText(body.place);
        const purpose = clipText(body.purpose);
        await prisma.$executeRaw`
          INSERT INTO "CorpCardUsage" (
            "id", "cardId", "unitId", "unitName", "cardName", "issuer", "last4",
            "userId", "userName", "userEmail", "place", "purpose",
            "reservedAt", "expectedReturnAt", "status", "createdAt", "updatedAt"
          ) VALUES (
            ${id}, ${card.id}, ${card.unitId}, ${unitName}, ${card.name}, ${String(card.issuer || '')}, ${card.last4},
            ${userId}, ${actor}, ${userEmail}, ${place}, ${purpose},
            ${tsSql(reservedAtWall)}, ${tsSql(expectedReturnAtWall)}, ${'RESERVED'}, ${now}, ${now}
          )
        `;
        const created = await findUsage(id);
        return NextResponse.json({ ok: true, item: created ? serializeUsage(created) : null });
      }

      if (action === 'CHECKOUT') {
        const checkoutAt = parseKstDateTime(body.checkoutAt);
        const checkoutAtWall = wallFromInput(body.checkoutAt);
        const expectedReturnAt = parseKstDateTime(body.expectedReturnAt);
        const expectedReturnAtWall = wallFromInput(body.expectedReturnAt);
        const place = clipText(body.place);
        const purpose = clipText(body.purpose);
        if (!checkoutAt || !checkoutAtWall) {
          return NextResponse.json({ error: '수령 일시를 선택해 주세요.' }, { status: 400 });
        }
        if (!expectedReturnAt || !expectedReturnAtWall) {
          return NextResponse.json({ error: '반납 예정일을 선택해 주세요.' }, { status: 400 });
        }
        if (expectedReturnAt.getTime() <= checkoutAt.getTime()) {
          return NextResponse.json(
            { error: '반납 예정일은 수령 일시보다 이후여야 합니다.' },
            { status: 400 }
          );
        }
        if (!place) {
          return NextResponse.json({ error: '사용처를 입력해 주세요.' }, { status: 400 });
        }
        if (!purpose) {
          return NextResponse.json({ error: '사용목적을 입력해 주세요.' }, { status: 400 });
        }
        const pickupType = String(body.pickupType || '').trim().toUpperCase() === 'PROXY' ? 'PROXY' : 'SELF';
        const pickupName =
          pickupType === 'PROXY'
            ? clipText(body.pickupName, 100)
            : actor;
        if (pickupType === 'PROXY' && !pickupName) {
          return NextResponse.json({ error: '대리 수령자를 선택해 주세요.' }, { status: 400 });
        }
        if (open?.status === 'RETURNING') {
          return NextResponse.json({ error: '반납 대기중인 카드입니다.' }, { status: 400 });
        }
        if (open?.status === 'CHECKOUT_PENDING') {
          return NextResponse.json({ error: '수령 대기중인 카드입니다.' }, { status: 400 });
        }
        if (open?.status === 'CHECKED_OUT') {
          return NextResponse.json({ error: '이미 대여 중인 카드입니다.' }, { status: 400 });
        }
        if (open?.status === 'RESERVED') {
          await prisma.$executeRaw`
            UPDATE "CorpCardUsage"
            SET
              "checkoutAt" = ${tsSql(checkoutAtWall)},
              "expectedReturnAt" = ${tsSql(expectedReturnAtWall)},
              "place" = ${place},
              "purpose" = ${purpose},
              "userId" = ${userId},
              "userName" = ${actor},
              "userEmail" = ${userEmail},
              "pickupType" = ${pickupType},
              "pickupName" = ${pickupName},
              "status" = ${'CHECKOUT_PENDING'},
              "updatedAt" = ${now}
            WHERE "id" = ${open.id}
          `;
          const updated = await findUsage(open.id);
          return NextResponse.json({ ok: true, item: updated ? serializeUsage(updated) : null });
        }
        const reservedAtWall = wallFromInput(body.reservedAt) || checkoutAtWall;
        const id = randomUUID();
        await prisma.$executeRaw`
          INSERT INTO "CorpCardUsage" (
            "id", "cardId", "unitId", "unitName", "cardName", "issuer", "last4",
            "userId", "userName", "userEmail", "place", "purpose",
            "reservedAt", "checkoutAt", "expectedReturnAt", "pickupType", "pickupName",
            "status", "createdAt", "updatedAt"
          ) VALUES (
            ${id}, ${card.id}, ${card.unitId}, ${unitName}, ${card.name}, ${String(card.issuer || '')}, ${card.last4},
            ${userId}, ${actor}, ${userEmail}, ${place}, ${purpose},
            ${tsSql(reservedAtWall)}, ${tsSql(checkoutAtWall)}, ${tsSql(expectedReturnAtWall)}, ${pickupType}, ${pickupName},
            ${'CHECKOUT_PENDING'}, ${now}, ${now}
          )
        `;
        const created = await findUsage(id);
        return NextResponse.json({ ok: true, item: created ? serializeUsage(created) : null });
      }

      if (!open || open.status !== 'CHECKED_OUT') {
        return NextResponse.json({ error: '대여 중인 카드만 반납할 수 있습니다.' }, { status: 400 });
      }
      const returnedAtWall = wallFromInput(body.returnedAt);
      const amount = clipText(body.amount, 40);
      const place = clipText(body.place);
      const purpose = clipText(body.purpose);
      const returnType = String(body.returnType || '').trim().toUpperCase() === 'PROXY' ? 'PROXY' : 'SELF';
      const userConfirmedBy =
        returnType === 'PROXY'
          ? clipText(body.returnName ?? body.userConfirmedBy, 100)
          : actor;
      if (!returnedAtWall) {
        return NextResponse.json({ error: '반납 일시를 선택해 주세요.' }, { status: 400 });
      }
      if (!amount.replace(/[^\d]/g, '')) {
        return NextResponse.json({ error: '사용금액을 입력해 주세요.' }, { status: 400 });
      }
      if (!place) {
        return NextResponse.json({ error: '사용처를 입력해 주세요.' }, { status: 400 });
      }
      if (!purpose) {
        return NextResponse.json({ error: '사용목적을 입력해 주세요.' }, { status: 400 });
      }
      if (returnType === 'PROXY' && !userConfirmedBy) {
        return NextResponse.json({ error: '대리 반납자를 선택해 주세요.' }, { status: 400 });
      }
      if (!userConfirmedBy) {
        return NextResponse.json({ error: '사용자확인(실제 카드반납자)이 필요합니다.' }, { status: 400 });
      }
      await prisma.$executeRaw`
        UPDATE "CorpCardUsage"
        SET
          "returnedAt" = ${tsSql(returnedAtWall)},
          "amount" = ${amount},
          "place" = ${place},
          "purpose" = ${purpose},
          "userConfirmedBy" = ${userConfirmedBy},
          "userConfirmedAt" = ${tsSql(nowWallTs)},
          "returnType" = ${returnType},
          "status" = ${'RETURNING'},
          "updatedAt" = ${now}
        WHERE "id" = ${open.id}
      `;
      const updated = await findUsage(open.id);
      return NextResponse.json({ ok: true, item: updated ? serializeUsage(updated) : null });
    }

    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ error: '항목 ID가 필요합니다.' }, { status: 400 });
    const existing = await findUsage(id);
    if (!existing) return NextResponse.json({ error: '사용 내역을 찾을 수 없습니다.' }, { status: 404 });
    if (!assertUnitInBoardScope(existing.unitId, scopeIds)) {
      return NextResponse.json({ error: '권한이 없는 사용 내역입니다.' }, { status: 403 });
    }

    if (action === 'CONFIRM_USER') {
      await prisma.$executeRaw`
        UPDATE "CorpCardUsage"
        SET
          "userConfirmedBy" = ${actor},
          "userConfirmedAt" = ${tsSql(nowWallTs)},
          "updatedAt" = ${now}
        WHERE "id" = ${id}
      `;
      const updated = await findUsage(id);
      return NextResponse.json({ ok: true, item: updated ? serializeUsage(updated) : null });
    }

    if (action === 'CANCEL_RESERVE') {
      if (existing.status !== 'RESERVED' && existing.status !== 'CHECKOUT_PENDING') {
        return NextResponse.json(
          {
            error:
              existing.status === 'CHECKED_OUT'
                ? '반출확인이 완료된 건은 취소할 수 없습니다.'
                : '예약·반출 대기중인 건만 취소할 수 있습니다.',
          },
          { status: 400 }
        );
      }
      await prisma.$executeRaw`DELETE FROM "CorpCardUsage" WHERE "id" = ${id}`;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: '알 수 없는 동작입니다.' }, { status: 400 });
  } catch (error) {
    return toErrorResponse(error, '처리를 완료하지 못했습니다.');
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await authorizeDeptCard();
    await ensureUsageTable();
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ error: '항목 ID가 필요합니다.' }, { status: 400 });
    const existing = await findUsage(id);
    if (!existing) return NextResponse.json({ error: '사용 내역을 찾을 수 없습니다.' }, { status: 404 });
    const scopeIds = resolveBoardScopeIds(auth);
    if (!assertUnitInBoardScope(existing.unitId, scopeIds)) {
      return NextResponse.json({ error: '권한이 없는 사용 내역입니다.' }, { status: 403 });
    }
    if (existing.status === 'RETURNED') {
      return NextResponse.json({ error: '반납이 완료된 건은 수정할 수 없습니다.' }, { status: 400 });
    }
    if (existing.status === 'RETURNING') {
      return NextResponse.json({ error: '반납 대기중인 건은 수정할 수 없습니다.' }, { status: 400 });
    }

    const place = body.place !== undefined ? clipText(body.place) : existing.place;
    const purpose = body.purpose !== undefined ? clipText(body.purpose) : existing.purpose;
    const amount = body.amount !== undefined ? clipText(body.amount, 40) : existing.amount;
    const userConfirmedBy =
      body.userConfirmedBy !== undefined
        ? clipText(body.userConfirmedBy, 300)
        : existing.userConfirmedBy;
    const reservedAt =
      body.reservedAt !== undefined
        ? wallFromInput(body.reservedAt)
        : wallOrDbParam(null, existing.reservedAt);
    // 수령일자(checkoutAt)는 반출신청값 유지 → 마스터 반출확인 시점에 확정 덮어씀
    const checkoutLocked =
      existing.status === 'CHECKOUT_PENDING' || existing.status === 'CHECKED_OUT';
    const checkoutAt = checkoutLocked
      ? wallOrDbParam(null, existing.checkoutAt)
      : body.checkoutAt !== undefined
        ? wallFromInput(body.checkoutAt)
        : wallOrDbParam(null, existing.checkoutAt);
    // 대여중은 반납예정일 고정
    const expectedReturnAt =
      existing.status === 'CHECKED_OUT'
        ? wallOrDbParam(null, existing.expectedReturnAt)
        : body.expectedReturnAt !== undefined
          ? wallFromInput(body.expectedReturnAt)
          : wallOrDbParam(null, existing.expectedReturnAt);
    const returnedAt =
      body.returnedAt !== undefined
        ? wallFromInput(body.returnedAt)
        : wallOrDbParam(null, existing.returnedAt);
    const now = new Date();

    await prisma.$executeRaw`
      UPDATE "CorpCardUsage"
      SET
        "place" = ${place},
        "purpose" = ${purpose},
        "amount" = ${amount},
        "reservedAt" = ${tsSql(reservedAt)},
        "checkoutAt" = ${tsSql(checkoutAt)},
        "expectedReturnAt" = ${tsSql(expectedReturnAt)},
        "returnedAt" = ${tsSql(returnedAt)},
        "userConfirmedBy" = ${userConfirmedBy},
        "updatedAt" = ${now}
      WHERE "id" = ${id}
    `;
    const updated = await findUsage(id);
    return NextResponse.json({ ok: true, item: updated ? serializeUsage(updated) : null });
  } catch (error) {
    return toErrorResponse(error, '수정에 실패했습니다.');
  }
}
