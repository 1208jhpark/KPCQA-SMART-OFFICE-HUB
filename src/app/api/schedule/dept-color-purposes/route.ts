import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { SCHEDULE_MENU_PATHS } from '@/lib/schedule-menu';

export const dynamic = 'force-dynamic';

type PurposeRow = {
  id: string;
  unit_id: string;
  unit_name: string | null;
  label: string;
  color: string;
  sort_order: number;
  updated_by_name: string | null;
  updated_by_email: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 현장실사/외부심사는 공휴일(#e57373)과 겹치지 않도록 보라 계열 */
const DEFAULT_PURPOSES: Array<{ label: string; color: string }> = [
  { label: '현장실사/외부심사', color: '#b39ddb' },
  { label: '심의', color: '#7baaf7' },
  { label: '외부미팅', color: '#81c995' },
];

const LEGACY_INTERNAL_MEETING_LABEL = '내부회의';
const DEFAULT_REVIEW_LABEL = '심의';
const LEGACY_TRIP_LABEL = '출장';
const DEFAULT_FIELD_LABEL = '현장실사/외부심사';

const LEGACY_TRIP_COLOR = '#e57373';
const DEFAULT_TRIP_COLOR = '#b39ddb';

function authorize() {
  return authorizeAnyMenuPaths([...SCHEDULE_MENU_PATHS]);
}

function resolveMyUnit(user: {
  unit_id?: string | null;
  unit?: { id?: string | null; unit_name?: string | null } | null;
}) {
  const unitId = String(user.unit_id || user.unit?.id || '').trim();
  const unitName = String(user.unit?.unit_name || '').trim();
  return { unitId, unitName };
}

function normalizeColor(raw: unknown, fallback = '#7baaf7') {
  const s = String(raw || '').trim();
  return HEX_RE.test(s) ? s : fallback;
}

let tableReady: Promise<void> | null = null;

function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "ScheduleDeptColorPurpose" (
            "id" TEXT NOT NULL,
            "unit_id" TEXT NOT NULL,
            "unit_name" TEXT,
            "label" TEXT NOT NULL,
            "color" TEXT NOT NULL DEFAULT '#7baaf7',
            "sort_order" INTEGER NOT NULL DEFAULT 0,
            "updated_by_name" TEXT,
            "updated_by_email" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "ScheduleDeptColorPurpose_pkey" PRIMARY KEY ("id")
          )`);
        await prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "ScheduleDeptColorPurpose_unit_id_sort_order_idx"
            ON "ScheduleDeptColorPurpose"("unit_id", "sort_order")`);
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "MarketingDeptCalendarEvent"
             ADD COLUMN IF NOT EXISTS "color_purpose_id" TEXT`
        );
        await prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "MarketingDeptCalendarEvent_color_purpose_id_idx"
            ON "MarketingDeptCalendarEvent"("color_purpose_id")`);
      } catch (e) {
        console.warn('[schedule/dept-color-purposes] table ensure skipped', e);
      }
    })();
  }
  return tableReady;
}

async function listPurposes(unitId: string) {
  return prisma.$queryRawUnsafe<PurposeRow[]>(
    `SELECT id, unit_id, unit_name, label, color, sort_order,
            updated_by_name, updated_by_email, "createdAt", "updatedAt"
     FROM "ScheduleDeptColorPurpose"
     WHERE unit_id = $1
     ORDER BY sort_order ASC, "createdAt" ASC`,
    unitId
  );
}

/** 동일 라벨 중복 시 가장 오래된 1건만 남김 (동시 시드 레이스 정리) */
async function dedupePurposes(
  tx: { $executeRawUnsafe: (q: string, ...args: unknown[]) => Promise<unknown> },
  unitId: string
) {
  // 일정 연결을 남길 id로 먼저 옮긴 뒤 중복 삭제
  await tx.$executeRawUnsafe(
    `UPDATE "MarketingDeptCalendarEvent" e
     SET color_purpose_id = keep.id
     FROM "ScheduleDeptColorPurpose" dup
     JOIN LATERAL (
       SELECT id FROM "ScheduleDeptColorPurpose" k
       WHERE k.unit_id = dup.unit_id AND k.label = dup.label
       ORDER BY k."createdAt" ASC, k.id ASC
       LIMIT 1
     ) keep ON true
     WHERE e.unit_id = $1
       AND e.color_purpose_id = dup.id
       AND dup.unit_id = $1
       AND dup.id <> keep.id`,
    unitId
  );
  await tx.$executeRawUnsafe(
    `DELETE FROM "ScheduleDeptColorPurpose" a
     USING "ScheduleDeptColorPurpose" b
     WHERE a.unit_id = $1
       AND b.unit_id = $1
       AND a.label = b.label
       AND (
         a."createdAt" > b."createdAt"
         OR (a."createdAt" = b."createdAt" AND a.id > b.id)
       )`,
    unitId
  );
}

type TxClient = {
  $executeRawUnsafe: (q: string, ...args: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: <T = unknown>(q: string, ...args: unknown[]) => Promise<T>;
};

/** 예전에 휴일과 같던 기본색(#e57373) → 보라로 교정 */
async function migrateLegacyTripColor(tx: TxClient, unitId: string) {
  await tx.$executeRawUnsafe(
    `UPDATE "ScheduleDeptColorPurpose"
     SET color = $2, "updatedAt" = NOW()
     WHERE unit_id = $1 AND label IN ($4, $5)
       AND lower(color) = lower($3)`,
    unitId,
    DEFAULT_TRIP_COLOR,
    LEGACY_TRIP_COLOR,
    LEGACY_TRIP_LABEL,
    DEFAULT_FIELD_LABEL
  );
  await tx.$executeRawUnsafe(
    `UPDATE "MarketingDeptCalendarEvent" e
     SET color = $2, "updatedAt" = NOW()
     FROM "ScheduleDeptColorPurpose" p
     WHERE e.unit_id = $1
       AND e.color_purpose_id = p.id
       AND p.unit_id = $1
       AND p.label IN ($4, $5)
       AND lower(e.color) = lower($3)`,
    unitId,
    DEFAULT_TRIP_COLOR,
    LEGACY_TRIP_COLOR,
    LEGACY_TRIP_LABEL,
    DEFAULT_FIELD_LABEL
  );
}

/** 기본 용도 라벨 교체 (새 라벨이 있으면 구 라벨만 정리) */
async function migratePurposeLabel(
  tx: TxClient,
  unitId: string,
  fromLabel: string,
  toLabel: string
) {
  const existing = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "ScheduleDeptColorPurpose" WHERE unit_id = $1 AND label = $2 LIMIT 1`,
    unitId,
    toLabel
  );

  if (existing.length > 0) {
    await tx.$executeRawUnsafe(
      `UPDATE "MarketingDeptCalendarEvent" e
       SET color_purpose_id = keep.id
       FROM "ScheduleDeptColorPurpose" legacy
       JOIN "ScheduleDeptColorPurpose" keep
         ON keep.unit_id = legacy.unit_id AND keep.label = $2
       WHERE e.unit_id = $1
         AND e.color_purpose_id = legacy.id
         AND legacy.unit_id = $1
         AND legacy.label = $3`,
      unitId,
      toLabel,
      fromLabel
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM "ScheduleDeptColorPurpose"
       WHERE unit_id = $1 AND label = $2`,
      unitId,
      fromLabel
    );
    return;
  }

  await tx.$executeRawUnsafe(
    `UPDATE "ScheduleDeptColorPurpose"
     SET label = $2, "updatedAt" = NOW()
     WHERE unit_id = $1 AND label = $3`,
    unitId,
    toLabel,
    fromLabel
  );
}

async function seedDefaultsIfEmpty(
  unitId: string,
  unitName: string,
  user: { name?: string | null; email?: string | null }
) {
  // 동시 GET(React Strict Mode 등) 시 이중 시드 방지
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, unitId);
    await dedupePurposes(tx, unitId);
    const txClient = tx as TxClient;
    await migrateLegacyTripColor(txClient, unitId);
    await migratePurposeLabel(txClient, unitId, LEGACY_TRIP_LABEL, DEFAULT_FIELD_LABEL);
    await migratePurposeLabel(
      txClient,
      unitId,
      LEGACY_INTERNAL_MEETING_LABEL,
      DEFAULT_REVIEW_LABEL
    );

    const existing = await tx.$queryRawUnsafe<PurposeRow[]>(
      `SELECT id FROM "ScheduleDeptColorPurpose" WHERE unit_id = $1 LIMIT 1`,
      unitId
    );
    if (existing.length > 0) return;

    for (let i = 0; i < DEFAULT_PURPOSES.length; i++) {
      const p = DEFAULT_PURPOSES[i];
      const id = randomUUID().replace(/-/g, '').slice(0, 25);
      await tx.$executeRawUnsafe(
        `INSERT INTO "ScheduleDeptColorPurpose"
          (id, unit_id, unit_name, label, color, sort_order,
           updated_by_name, updated_by_email, "createdAt", "updatedAt")
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM "ScheduleDeptColorPurpose"
           WHERE unit_id = $2 AND label = $4
         )`,
        id,
        unitId,
        unitName || null,
        p.label,
        p.color,
        i,
        user.name || null,
        user.email || null
      );
    }
  });

  return listPurposes(unitId);
}

/** GET — 본인 소속 공용 용도 색상 (없으면 기본 3종 시드) */
export async function GET() {
  try {
    const auth = await authorize();
    await ensureTable();
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const purposes = await seedDefaultsIfEmpty(unitId, unitName, auth.user);
    return NextResponse.json({ unitId, unitName, purposes });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/dept-color-purposes GET]', msg);
    return NextResponse.json({ error: '용도 색상 조회 실패', details: msg }, { status: 500 });
  }
}

/** POST — 용도 추가 */
export async function POST(req: Request) {
  try {
    const auth = await authorize();
    await ensureTable();
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const label = String(body.label || '').trim().slice(0, 40);
    if (!label) {
      return NextResponse.json({ error: '용도명을 입력해 주세요.' }, { status: 400 });
    }
    const color = normalizeColor(body.color);
    const id = randomUUID().replace(/-/g, '').slice(0, 25);

    const maxRows = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
      `SELECT MAX(sort_order) AS max FROM "ScheduleDeptColorPurpose" WHERE unit_id = $1`,
      unitId
    );
    const sortOrder = Number(maxRows[0]?.max ?? -1) + 1;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "ScheduleDeptColorPurpose"
        (id, unit_id, unit_name, label, color, sort_order,
         updated_by_name, updated_by_email, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      id,
      unitId,
      unitName || null,
      label,
      color,
      sortOrder,
      auth.user.name || null,
      auth.user.email || null
    );

    const rows = await prisma.$queryRawUnsafe<PurposeRow[]>(
      `SELECT id, unit_id, unit_name, label, color, sort_order,
              updated_by_name, updated_by_email, "createdAt", "updatedAt"
       FROM "ScheduleDeptColorPurpose" WHERE id = $1`,
      id
    );
    return NextResponse.json(rows[0] || { id, label, color });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/dept-color-purposes POST]', msg);
    return NextResponse.json({ error: '용도 추가 실패', details: msg }, { status: 500 });
  }
}

/** PATCH — 용도명/색상 수정. 색상 변경 시 연결 일정 color 일괄 갱신 */
export async function PATCH(req: Request) {
  try {
    const auth = await authorize();
    await ensureTable();
    const { unitId } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ error: 'ID가 없습니다.' }, { status: 400 });

    const existing = await prisma.$queryRawUnsafe<PurposeRow[]>(
      `SELECT id, unit_id, label, color FROM "ScheduleDeptColorPurpose" WHERE id = $1 LIMIT 1`,
      id
    );
    if (!existing[0]) {
      return NextResponse.json({ error: '용도를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (String(existing[0].unit_id) !== unitId) {
      return NextResponse.json({ error: '다른 소속 용도는 수정할 수 없습니다.' }, { status: 403 });
    }

    const label =
      body.label !== undefined ? String(body.label || '').trim().slice(0, 40) : null;
    if (body.label !== undefined && !label) {
      return NextResponse.json({ error: '용도명을 입력해 주세요.' }, { status: 400 });
    }
    const color =
      body.color !== undefined ? normalizeColor(body.color, existing[0].color) : null;
    const colorChanged = color !== null && color !== existing[0].color;

    await prisma.$executeRawUnsafe(
      `UPDATE "ScheduleDeptColorPurpose" SET
         label = COALESCE($2, label),
         color = COALESCE($3, color),
         updated_by_name = $4,
         updated_by_email = $5,
         "updatedAt" = NOW()
       WHERE id = $1 AND unit_id = $6`,
      id,
      label,
      color,
      auth.user.name || null,
      auth.user.email || null,
      unitId
    );

    let updatedEvents = 0;
    if (colorChanged && color) {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "MarketingDeptCalendarEvent"
         SET color = $1, "updatedAt" = NOW()
         WHERE color_purpose_id = $2 AND unit_id = $3`,
        color,
        id,
        unitId
      );
      updatedEvents = typeof result === 'number' ? result : 0;
    }

    const rows = await prisma.$queryRawUnsafe<PurposeRow[]>(
      `SELECT id, unit_id, unit_name, label, color, sort_order,
              updated_by_name, updated_by_email, "createdAt", "updatedAt"
       FROM "ScheduleDeptColorPurpose" WHERE id = $1`,
      id
    );
    return NextResponse.json({
      ...(rows[0] || { id }),
      updatedEvents,
      colorChanged,
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/dept-color-purposes PATCH]', msg);
    return NextResponse.json({ error: '용도 수정 실패', details: msg }, { status: 500 });
  }
}

/** DELETE ?id= — 용도 삭제 (연결 일정의 color_purpose_id만 해제, 색상 값은 유지) */
export async function DELETE(req: Request) {
  try {
    const auth = await authorize();
    await ensureTable();
    const { unitId } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.$queryRawUnsafe<PurposeRow[]>(
      `SELECT id, unit_id FROM "ScheduleDeptColorPurpose" WHERE id = $1 LIMIT 1`,
      id
    );
    if (!existing[0]) {
      return NextResponse.json({ error: '용도를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (String(existing[0].unit_id) !== unitId) {
      return NextResponse.json({ error: '다른 소속 용도는 삭제할 수 없습니다.' }, { status: 403 });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "MarketingDeptCalendarEvent"
       SET color_purpose_id = NULL, "updatedAt" = NOW()
       WHERE color_purpose_id = $1 AND unit_id = $2`,
      id,
      unitId
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ScheduleDeptColorPurpose" WHERE id = $1 AND unit_id = $2`,
      id,
      unitId
    );
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/dept-color-purposes DELETE]', msg);
    return NextResponse.json({ error: '용도 삭제 실패', details: msg }, { status: 500 });
  }
}
