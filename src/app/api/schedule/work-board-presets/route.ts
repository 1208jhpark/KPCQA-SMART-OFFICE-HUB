import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { SCHEDULE_MENU_PATHS } from '@/lib/schedule-menu';

export const dynamic = 'force-dynamic';

type PresetRow = {
  id: string;
  unit_id: string;
  unit_name: string | null;
  area: string;
  assignee_name: string;
  sort_order: number;
  updated_by_name: string | null;
  createdAt: Date;
  updatedAt: Date;
};

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

let tableReady: Promise<void> | null = null;

function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "ScheduleWorkBoardLinePreset" (
            "id" TEXT NOT NULL,
            "unit_id" TEXT NOT NULL,
            "unit_name" TEXT,
            "area" TEXT NOT NULL,
            "assignee_name" TEXT NOT NULL DEFAULT '',
            "sort_order" INTEGER NOT NULL DEFAULT 0,
            "updated_by_name" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "ScheduleWorkBoardLinePreset_pkey" PRIMARY KEY ("id")
          )`);
        await prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "ScheduleWorkBoardLinePreset_unit_id_sort_order_idx"
            ON "ScheduleWorkBoardLinePreset"("unit_id", "sort_order")`);
      } catch (e) {
        console.warn('[schedule/work-board-presets] table ensure skipped', e);
      }
    })();
  }
  return tableReady;
}

async function listPresets(unitId: string) {
  return prisma.$queryRawUnsafe<PresetRow[]>(
    `SELECT id, unit_id, unit_name, area, assignee_name, sort_order,
            updated_by_name, "createdAt", "updatedAt"
     FROM "ScheduleWorkBoardLinePreset"
     WHERE unit_id = $1
     ORDER BY sort_order ASC, "createdAt" ASC`,
    unitId
  );
}

/** GET — 소속 세부분야·담당자 프리셋 */
export async function GET() {
  try {
    const auth = await authorize();
    await ensureTable();
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }
    const presets = await listPresets(unitId);
    return NextResponse.json({ unitId, unitName, presets });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/work-board-presets GET]', msg);
    return NextResponse.json({ error: '프리셋 조회 실패', details: msg }, { status: 500 });
  }
}

/**
 * PUT — 현재 목록으로 소속 프리셋 전체 교체
 * body: { lines: [{ area, assignee_name }] }
 */
export async function PUT(req: Request) {
  try {
    const auth = await authorize();
    await ensureTable();
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const raw = Array.isArray(body.lines) ? body.lines : Array.isArray(body.presets) ? body.presets : [];
    const lines: Array<{ area: string; assignee_name: string }> = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const area = String(o.area || '').trim().slice(0, 80);
      const assignee = String(o.assignee_name || o.assigneeName || '').trim().slice(0, 80);
      if (!area) continue;
      lines.push({ area, assignee_name: assignee });
    }
    if (!lines.length) {
      return NextResponse.json(
        { error: '저장할 세부분야·담당자 행이 없습니다.' },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM "ScheduleWorkBoardLinePreset" WHERE unit_id = $1`,
        unitId
      );
      for (let i = 0; i < lines.length; i++) {
        const id = randomUUID().replace(/-/g, '').slice(0, 25);
        await tx.$executeRawUnsafe(
          `INSERT INTO "ScheduleWorkBoardLinePreset"
            (id, unit_id, unit_name, area, assignee_name, sort_order,
             updated_by_name, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
          id,
          unitId,
          unitName || null,
          lines[i].area,
          lines[i].assignee_name,
          i,
          auth.user.name || null
        );
      }
    });

    const presets = await listPresets(unitId);
    return NextResponse.json({ unitId, unitName, presets });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/work-board-presets PUT]', msg);
    return NextResponse.json({ error: '프리셋 저장 실패', details: msg }, { status: 500 });
  }
}
