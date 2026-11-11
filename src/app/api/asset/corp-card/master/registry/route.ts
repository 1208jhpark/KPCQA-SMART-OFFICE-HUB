import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/corp-card/master/registry';
const STATUSES = new Set(['ACTIVE', 'SUSPENDED']);
const MEMO_MAX_LEN = 80;
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
  console.error('[corp-card registry]', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

type CardRow = {
  id: string;
  name: string;
  issuer: string | null;
  last4: string;
  unitId: string;
  unitName: string;
  status: string;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
  liveUnitName: string | null;
};

function normalizeLast4(raw: unknown) {
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .slice(0, 4);
}

function normalizeMemo(raw: unknown) {
  return String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MEMO_MAX_LEN);
}

let memoColumnReady: Promise<void> | null = null;

async function ensureMemoColumn() {
  if (!memoColumnReady) {
    memoColumnReady = (async () => {
      try {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "CorpCard" ADD COLUMN IF NOT EXISTS "memo" TEXT NOT NULL DEFAULT ''`
        );
      } catch (error) {
        memoColumnReady = null;
        console.warn('[corp-card registry] memo column ensure skipped', error);
      }
    })();
  }
  await memoColumnReady;
}

function serializeCard(row: CardRow, hasUsage = false) {
  return {
    id: row.id,
    name: row.name,
    issuer: String(row.issuer || '').trim(),
    last4: row.last4,
    unitId: row.unitId,
    unitName: row.liveUnitName || row.unitName,
    status: row.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
    memo: String(row.memo || '').trim(),
    hasUsage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function usageCardIdSet() {
  try {
    const rows = await prisma.$queryRaw<{ cardId: string }[]>`
      SELECT DISTINCT "cardId" FROM "CorpCardUsage"
    `;
    return new Set(rows.map((row) => String(row.cardId)));
  } catch {
    return new Set<string>();
  }
}

async function cardHasUsage(cardId: string) {
  try {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "CorpCardUsage" WHERE "cardId" = ${cardId}
    `;
    return Number(rows[0]?.n || 0) > 0;
  } catch {
    return false;
  }
}

async function resolveUnit(unitId: string) {
  const unit = await prisma.orgUnit.findFirst({
    where: { id: unitId, is_deleted: false, is_active: true },
    select: { id: true, unit_name: true },
  });
  if (!unit) throw new Error('UNIT_NOT_FOUND');
  return unit;
}

async function findCard(id: string) {
  await ensureMemoColumn();
  const rows = await prisma.$queryRaw<CardRow[]>`
    SELECT
      c."id",
      c."name",
      c."issuer",
      c."last4",
      c."unitId",
      c."unitName",
      c."status",
      c."memo",
      c."createdAt",
      c."updatedAt",
      u."unit_name" AS "liveUnitName"
    FROM "CorpCard" c
    LEFT JOIN "OrgUnit" u ON u."id" = c."unitId"
    WHERE c."id" = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function GET() {
  try {
    const auth = await authorizeApi(MENU_PATH);
    await ensureMemoColumn();
    const items = await prisma.$queryRaw<CardRow[]>`
      SELECT
        c."id",
        c."name",
        c."issuer",
        c."last4",
        c."unitId",
        c."unitName",
        c."status",
        c."memo",
        c."createdAt",
        c."updatedAt",
        u."unit_name" AS "liveUnitName"
      FROM "CorpCard" c
      LEFT JOIN "OrgUnit" u ON u."id" = c."unitId"
      ORDER BY c."createdAt" DESC
    `;
    const usedIds = await usageCardIdSet();
    return NextResponse.json({
      ok: true,
      path: MENU_PATH,
      userName: auth.user?.name || '',
      canEdit: Boolean(auth.permission?.isEditor),
      items: items.map((row) => serializeCard(row, usedIds.has(row.id))),
    });
  } catch (error) {
    return toErrorResponse(error, '카드 대장을 불러오지 못했습니다.');
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const issuer = String(body.issuer || '').trim();
    const last4 = normalizeLast4(body.last4);
    const unitId = String(body.unitId || '').trim();

    if (!name) {
      return NextResponse.json({ error: '카드관리명을 입력해 주세요.' }, { status: 400 });
    }
    if (!issuer) {
      return NextResponse.json({ error: '카드사를 선택해 주세요.' }, { status: 400 });
    }
    if (last4.length !== 4) {
      return NextResponse.json({ error: '카드번호 끝 4자리를 입력해 주세요.' }, { status: 400 });
    }
    if (!unitId) {
      return NextResponse.json({ error: '할당부서를 선택해 주세요.' }, { status: 400 });
    }

    const statusRaw = String(body.status || 'ACTIVE').trim().toUpperCase();
    const status = STATUSES.has(statusRaw) ? statusRaw : 'ACTIVE';
    const memo = normalizeMemo(body.memo);

    const unit = await resolveUnit(unitId);
    const id = randomUUID();
    const now = new Date();
    const createdBy = String(auth.user?.email || auth.user?.name || '').trim() || null;

    await ensureMemoColumn();
    await prisma.$executeRaw`
      INSERT INTO "CorpCard" ("id", "name", "issuer", "last4", "unitId", "unitName", "status", "memo", "createdBy", "createdAt", "updatedAt")
      VALUES (${id}, ${name}, ${issuer}, ${last4}, ${unit.id}, ${unit.unit_name}, ${status}, ${memo}, ${createdBy}, ${now}, ${now})
    `;

    const created = await findCard(id);
    return NextResponse.json({ ok: true, item: created ? serializeCard(created) : null });
  } catch (error: any) {
    if (error?.message === 'UNIT_NOT_FOUND') {
      return NextResponse.json({ error: '선택한 부서를 찾을 수 없습니다.' }, { status: 400 });
    }
    return toErrorResponse(error, '카드 등록에 실패했습니다.');
  }
}

export async function PATCH(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    await ensureMemoColumn();
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: '카드 ID가 필요합니다.' }, { status: 400 });
    }

    const existing = await findCard(id);
    if (!existing) {
      return NextResponse.json({ error: '카드를 찾을 수 없습니다.' }, { status: 404 });
    }

    let name = existing.name;
    let issuer = String(existing.issuer || '').trim();
    let last4 = existing.last4;
    let unitId = existing.unitId;
    let unitName = existing.unitName;
    let status = existing.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    let memo = String(existing.memo || '').trim();
    let changed = false;

    if (body.name !== undefined) {
      name = String(body.name || '').trim();
      if (!name) {
        return NextResponse.json({ error: '카드관리명을 입력해 주세요.' }, { status: 400 });
      }
      changed = true;
    }
    const nextIssuer = body.issuer !== undefined ? String(body.issuer || '').trim() : issuer;
    const nextLast4 = body.last4 !== undefined ? normalizeLast4(body.last4) : last4;
    const identityChanged = nextIssuer !== issuer || nextLast4 !== last4;
    if (identityChanged) {
      if (await cardHasUsage(id)) {
        return NextResponse.json(
          { error: '신청·예약 이력이 있는 카드는 카드사와 카드번호를 수정할 수 없습니다.' },
          { status: 400 }
        );
      }
      if (body.issuer !== undefined) {
        if (!nextIssuer) {
          return NextResponse.json({ error: '카드사를 선택해 주세요.' }, { status: 400 });
        }
        issuer = nextIssuer;
        changed = true;
      }
      if (body.last4 !== undefined) {
        if (nextLast4.length !== 4) {
          return NextResponse.json({ error: '카드번호 끝 4자리를 입력해 주세요.' }, { status: 400 });
        }
        last4 = nextLast4;
        changed = true;
      }
    }
    if (body.unitId !== undefined) {
      const nextUnitId = String(body.unitId || '').trim();
      if (!nextUnitId) {
        return NextResponse.json({ error: '할당부서를 선택해 주세요.' }, { status: 400 });
      }
      const unit = await resolveUnit(nextUnitId);
      unitId = unit.id;
      unitName = unit.unit_name;
      changed = true;
    }
    if (body.status !== undefined) {
      const nextStatus = String(body.status || '').trim().toUpperCase();
      if (!STATUSES.has(nextStatus)) {
        return NextResponse.json({ error: '상태는 활성화 또는 정지만 선택할 수 있습니다.' }, { status: 400 });
      }
      status = nextStatus;
      changed = true;
    }
    if (body.memo !== undefined) {
      memo = normalizeMemo(body.memo);
      changed = true;
    }

    if (!changed) {
      return NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 });
    }

    const now = new Date();
    await prisma.$executeRaw`
      UPDATE "CorpCard"
      SET
        "name" = ${name},
        "issuer" = ${issuer},
        "last4" = ${last4},
        "unitId" = ${unitId},
        "unitName" = ${unitName},
        "status" = ${status},
        "memo" = ${memo},
        "updatedAt" = ${now}
      WHERE "id" = ${id}
    `;

    const updated = await findCard(id);
    return NextResponse.json({ ok: true, item: updated ? serializeCard(updated) : null });
  } catch (error: any) {
    if (error?.message === 'UNIT_NOT_FOUND') {
      return NextResponse.json({ error: '선택한 부서를 찾을 수 없습니다.' }, { status: 400 });
    }
    return toErrorResponse(error, '카드 수정에 실패했습니다.');
  }
}

export async function DELETE(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ error: '카드 ID가 필요합니다.' }, { status: 400 });
    }
    const existing = await findCard(id);
    if (!existing) {
      return NextResponse.json({ error: '카드를 찾을 수 없습니다.' }, { status: 404 });
    }
    await prisma.$executeRaw`DELETE FROM "CorpCard" WHERE "id" = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, '카드 삭제에 실패했습니다.');
  }
}
