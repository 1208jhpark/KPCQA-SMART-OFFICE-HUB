import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { SCHEDULE_MENU_PATHS } from '@/lib/schedule-menu';
import {
  deriveProjectStatus,
  normalizeWorkStatus,
  parseWorkBoardLines,
  serializeWorkBoardLines,
  type WorkBoardLine,
  type WorkStatus,
} from '@/lib/work-board-lines';

export const dynamic = 'force-dynamic';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

type WorkRow = {
  id: string;
  unit_id: string;
  unit_name: string | null;
  title: string;
  note: string | null;
  status: string;
  sort_order: number;
  board_date: string | null;
  due_date: string | null;
  urgent: boolean;
  lines: unknown;
  assignee_name: string | null;
  assignee_email: string | null;
  creator_name: string | null;
  creator_email: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT_COLS = `id, unit_id, unit_name, title, note, status, sort_order,
  board_date, due_date, COALESCE(urgent, false) AS urgent, lines, assignee_name, assignee_email,
  creator_name, creator_email, "createdAt", "updatedAt"`;

function authorizeWorkBoard() {
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

function normalizeYmd(raw: unknown): string | null {
  const s = String(raw || '').trim();
  return YMD_RE.test(s) ? s : null;
}

function newLineId() {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function normalizeIncomingLines(raw: unknown): WorkBoardLine[] {
  if (raw === undefined) return [];
  const parsed = parseWorkBoardLines(raw);
  return parsed.map((l) => ({
    ...l,
    id: l.id || newLineId(),
    status: normalizeWorkStatus(l.status) || 'TODO',
  }));
}

/** 구형 담당자만 있는 카드 → 세부분야 1행으로 보정 */
function hydrateLines(row: WorkRow): WorkBoardLine[] {
  const lines = parseWorkBoardLines(row.lines);
  if (lines.length > 0) return lines;
  const assignee = String(row.assignee_name || '').trim();
  if (!assignee) return [];
  return [
    {
      id: newLineId(),
      area: '세부',
      assignee_name: assignee,
      status: (normalizeWorkStatus(row.status) || 'TODO') as WorkStatus,
    },
  ];
}

function mapItem(row: WorkRow) {
  const lines = hydrateLines(row);
  return {
    ...row,
    lines,
    status: lines.length ? deriveProjectStatus(lines) : row.status || 'TODO',
  };
}

let tableReady: Promise<void> | null = null;

function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "ScheduleWorkBoardItem" (
            "id" TEXT NOT NULL,
            "unit_id" TEXT NOT NULL,
            "unit_name" TEXT,
            "title" TEXT NOT NULL,
            "note" TEXT DEFAULT '',
            "status" TEXT NOT NULL DEFAULT 'TODO',
            "sort_order" INTEGER NOT NULL DEFAULT 0,
            "board_date" TEXT,
            "due_date" TEXT,
            "urgent" BOOLEAN NOT NULL DEFAULT false,
            "lines" JSONB,
            "assignee_name" TEXT,
            "assignee_email" TEXT,
            "creator_name" TEXT,
            "creator_email" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "ScheduleWorkBoardItem_pkey" PRIMARY KEY ("id")
          )`);
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "ScheduleWorkBoardItem" ADD COLUMN IF NOT EXISTS "board_date" TEXT`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "ScheduleWorkBoardItem" ADD COLUMN IF NOT EXISTS "lines" JSONB`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "ScheduleWorkBoardItem" ADD COLUMN IF NOT EXISTS "urgent" BOOLEAN NOT NULL DEFAULT false`
        );
        await prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "ScheduleWorkBoardItem_unit_id_status_sort_order_idx"
            ON "ScheduleWorkBoardItem"("unit_id", "status", "sort_order")`);
        await prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "ScheduleWorkBoardItem_unit_id_board_date_idx"
            ON "ScheduleWorkBoardItem"("unit_id", "board_date")`);
      } catch (e) {
        console.warn('[schedule/work-board] table ensure skipped', e);
      }
    })();
  }
  return tableReady;
}

/** GET ?from=&to= | ?date= */
export async function GET(req: Request) {
  try {
    const auth = await authorizeWorkBoard();
    await ensureTable();
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const date = normalizeYmd(searchParams.get('date'));
    const from = normalizeYmd(searchParams.get('from'));
    const to = normalizeYmd(searchParams.get('to'));

    let items: WorkRow[];
    if (date) {
      items = await prisma.$queryRawUnsafe<WorkRow[]>(
        `SELECT ${SELECT_COLS}
         FROM "ScheduleWorkBoardItem"
         WHERE unit_id = $1 AND board_date = $2
         ORDER BY
           CASE status WHEN 'TODO' THEN 0 WHEN 'DOING' THEN 1 WHEN 'DONE' THEN 2 ELSE 3 END,
           COALESCE(urgent, false) DESC,
           sort_order ASC,
           "createdAt" ASC`,
        unitId,
        date
      );
    } else if (from && to) {
      items = await prisma.$queryRawUnsafe<WorkRow[]>(
        `SELECT ${SELECT_COLS}
         FROM "ScheduleWorkBoardItem"
         WHERE unit_id = $1
           AND board_date IS NOT NULL
           AND board_date >= $2
           AND board_date <= $3
         ORDER BY board_date ASC,
           CASE status WHEN 'TODO' THEN 0 WHEN 'DOING' THEN 1 WHEN 'DONE' THEN 2 ELSE 3 END,
           COALESCE(urgent, false) DESC,
           sort_order ASC,
           "createdAt" ASC`,
        unitId,
        from,
        to
      );
    } else {
      items = await prisma.$queryRawUnsafe<WorkRow[]>(
        `SELECT ${SELECT_COLS}
         FROM "ScheduleWorkBoardItem"
         WHERE unit_id = $1
         ORDER BY
           CASE status WHEN 'TODO' THEN 0 WHEN 'DOING' THEN 1 WHEN 'DONE' THEN 2 ELSE 3 END,
           COALESCE(urgent, false) DESC,
           sort_order ASC,
           "createdAt" ASC`,
        unitId
      );
    }

    return NextResponse.json({
      unitId,
      unitName,
      items: items.map(mapItem),
      date,
      from,
      to,
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/work-board GET]', msg);
    return NextResponse.json({ error: '업무 보드 조회 실패', details: msg }, { status: 500 });
  }
}

/** POST */
export async function POST(req: Request) {
  try {
    const auth = await authorizeWorkBoard();
    await ensureTable();
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const title = String(body.title || body.project_name || body.projectName || '').trim();
    if (!title) {
      return NextResponse.json({ error: '프로젝트명을 입력해 주세요.' }, { status: 400 });
    }
    const note = String(body.note || '').trim().slice(0, 1000);
    const boardDate = normalizeYmd(body.board_date ?? body.boardDate);
    if (!boardDate) {
      return NextResponse.json({ error: '보드 일자를 선택해 주세요.' }, { status: 400 });
    }
    const dueDate = normalizeYmd(body.due_date ?? body.dueDate);
    const urgent = Boolean(body.urgent);
    const lines = normalizeIncomingLines(body.lines);
    const status = lines.length
      ? deriveProjectStatus(lines)
      : normalizeWorkStatus(body.status) || 'TODO';
    const id = randomUUID().replace(/-/g, '').slice(0, 25);
    const linesJson = serializeWorkBoardLines(lines);
    const primaryAssignee = lines.find((l) => l.assignee_name)?.assignee_name || null;

    const maxRows = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
      `SELECT MAX(sort_order) AS max FROM "ScheduleWorkBoardItem"
       WHERE unit_id = $1 AND status = $2 AND board_date = $3`,
      unitId,
      status,
      boardDate
    );
    const sortOrder = Number(maxRows[0]?.max ?? -1) + 1;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "ScheduleWorkBoardItem"
        (id, unit_id, unit_name, title, note, status, sort_order, board_date, due_date, urgent, lines,
         assignee_name, assignee_email, creator_name, creator_email, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,NULL,$13,$14,NOW(),NOW())`,
      id,
      unitId,
      unitName || null,
      title.slice(0, 200),
      note,
      status,
      sortOrder,
      boardDate,
      dueDate,
      urgent,
      linesJson,
      primaryAssignee,
      auth.user.name || null,
      auth.user.email || null
    );

    const rows = await prisma.$queryRawUnsafe<WorkRow[]>(
      `SELECT ${SELECT_COLS} FROM "ScheduleWorkBoardItem" WHERE id = $1`,
      id
    );
    return NextResponse.json(rows[0] ? mapItem(rows[0]) : { id, title, status, board_date: boardDate });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/work-board POST]', msg);
    return NextResponse.json({ error: '카드 등록 실패', details: msg }, { status: 500 });
  }
}

/** PATCH — 수정 / 세부분야 상태 변경 (칸반 열 자동 반영) */
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeWorkBoard();
    await ensureTable();
    const { unitId } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ error: 'ID가 없습니다.' }, { status: 400 });

    const existing = await prisma.$queryRawUnsafe<WorkRow[]>(
      `SELECT ${SELECT_COLS} FROM "ScheduleWorkBoardItem" WHERE id = $1 LIMIT 1`,
      id
    );
    if (!existing[0]) {
      return NextResponse.json({ error: '카드를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (String(existing[0].unit_id) !== unitId) {
      return NextResponse.json({ error: '다른 소속 카드는 수정할 수 없습니다.' }, { status: 403 });
    }

    const titleRaw = body.title ?? body.project_name ?? body.projectName;
    const title =
      titleRaw !== undefined ? String(titleRaw || '').trim().slice(0, 200) : null;
    if (titleRaw !== undefined && !title) {
      return NextResponse.json({ error: '프로젝트명을 입력해 주세요.' }, { status: 400 });
    }
    const note = body.note !== undefined ? String(body.note || '').trim().slice(0, 1000) : null;

    const boardTouched = body.board_date !== undefined || body.boardDate !== undefined;
    const boardDate = boardTouched
      ? normalizeYmd(body.board_date ?? body.boardDate) || ''
      : null;

    const dueTouched = body.due_date !== undefined || body.dueDate !== undefined;
    const dueDate = dueTouched ? String(body.due_date || body.dueDate || '').trim() || '' : null;
    const urgentTouched = body.urgent !== undefined;
    const urgent = urgentTouched ? Boolean(body.urgent) : null;

    let lines: WorkBoardLine[] | null = null;
    if (body.lines !== undefined) {
      lines = normalizeIncomingLines(body.lines);
    } else if (body.line_id || body.lineId) {
      // 카드에서 한 행 상태만 변경
      const lineId = String(body.line_id || body.lineId || '').trim();
      const lineStatus = normalizeWorkStatus(body.line_status ?? body.lineStatus ?? body.status);
      if (!lineId || !lineStatus) {
        return NextResponse.json({ error: '세부분야 상태값이 올바르지 않습니다.' }, { status: 400 });
      }
      const current = hydrateLines(existing[0]);
      const next = current.map((l) => (l.id === lineId ? { ...l, status: lineStatus } : l));
      if (!next.some((l) => l.id === lineId)) {
        return NextResponse.json({ error: '세부분야 행을 찾을 수 없습니다.' }, { status: 404 });
      }
      lines = next;
    }

    const status = lines ? deriveProjectStatus(lines) : null;
    const linesJson = lines ? serializeWorkBoardLines(lines) : null;
    const primaryAssignee = lines
      ? lines.find((l) => l.assignee_name)?.assignee_name || ''
      : null;

    await prisma.$executeRawUnsafe(
      `UPDATE "ScheduleWorkBoardItem" SET
         title = COALESCE($2, title),
         note = COALESCE($3, note),
         status = COALESCE($4, status),
         board_date = CASE WHEN $5::int = 0 THEN board_date
                           WHEN $6 = '' THEN NULL
                           ELSE $6 END,
         due_date = CASE WHEN $7::int = 0 THEN due_date
                         WHEN $8 = '' THEN NULL
                         ELSE $8 END,
         urgent = CASE WHEN $9::int = 0 THEN urgent ELSE $10::boolean END,
         lines = CASE WHEN $11::text IS NULL THEN lines ELSE $11::jsonb END,
         assignee_name = CASE WHEN $12::text IS NULL THEN assignee_name
                              WHEN $12 = '' THEN NULL
                              ELSE $12 END,
         "updatedAt" = NOW()
       WHERE id = $1 AND unit_id = $13`,
      id,
      title,
      note,
      status,
      boardTouched ? 1 : 0,
      boardDate,
      dueTouched ? 1 : 0,
      dueDate === null
        ? null
        : dueDate === ''
          ? ''
          : YMD_RE.test(dueDate)
            ? dueDate
            : null,
      urgentTouched ? 1 : 0,
      urgent,
      linesJson,
      primaryAssignee,
      unitId
    );

    const rows = await prisma.$queryRawUnsafe<WorkRow[]>(
      `SELECT ${SELECT_COLS} FROM "ScheduleWorkBoardItem" WHERE id = $1`,
      id
    );
    return NextResponse.json(rows[0] ? mapItem(rows[0]) : { id });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/work-board PATCH]', msg);
    return NextResponse.json({ error: '카드 수정 실패', details: msg }, { status: 500 });
  }
}

/** DELETE ?id= */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeWorkBoard();
    await ensureTable();
    const { unitId } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.$queryRawUnsafe<Array<{ id: string; unit_id: string }>>(
      `SELECT id, unit_id FROM "ScheduleWorkBoardItem" WHERE id = $1 LIMIT 1`,
      id
    );
    if (!existing[0]) {
      return NextResponse.json({ error: '카드를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (String(existing[0].unit_id) !== unitId) {
      return NextResponse.json({ error: '다른 소속 카드는 삭제할 수 없습니다.' }, { status: 403 });
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM "ScheduleWorkBoardItem" WHERE id = $1 AND unit_id = $2`,
      id,
      unitId
    );
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/work-board DELETE]', msg);
    return NextResponse.json({ error: '카드 삭제 실패', details: msg }, { status: 500 });
  }
}
