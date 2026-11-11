import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { getKSTDateString } from '@/utils/dateUtils';
import { SCHEDULE_MENU_PATHS } from '@/lib/schedule-menu';

export const dynamic = 'force-dynamic';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function authorizeScheduleCalendar() {
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

function normalizeYmd(raw: unknown, fallback = '') {
  const s = String(raw || '').trim();
  if (YMD_RE.test(s)) return s;
  const fromKst = getKSTDateString(typeof raw === 'string' || raw instanceof Date ? raw : undefined);
  return YMD_RE.test(fromKst || '') ? (fromKst as string) : fallback;
}

type CalRow = {
  id: string;
  unit_id: string;
  unit_name: string | null;
  title: string;
  note: string | null;
  location: string | null;
  time_text: string | null;
  attendees: string | null;
  start_date: string;
  end_date: string | null;
  all_day: boolean;
  color: string | null;
  color_purpose_id: string | null;
  creator_name: string | null;
  creator_dept: string | null;
  creator_email: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT_COLS = `id, unit_id, unit_name, title, note,
  COALESCE(location, '') AS location,
  COALESCE(time_text, '') AS time_text,
  COALESCE(attendees, '') AS attendees,
  start_date, end_date, all_day, color,
  color_purpose_id,
  creator_name, creator_dept, creator_email, "createdAt", "updatedAt"`;

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

let columnsReady: Promise<void> | null = null;

/** 로컬 DB에 상세 컬럼이 없으면 보강 (마이그레이션 전 호환) */
function ensureDetailColumns() {
  if (!columnsReady) {
    columnsReady = (async () => {
      try {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "location" TEXT DEFAULT ''`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "time_text" TEXT DEFAULT ''`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "attendees" TEXT DEFAULT ''`
        );
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "color_purpose_id" TEXT`
        );
      } catch (e) {
        console.warn('[schedule/dept-calendar] column ensure skipped', e);
      }
    })();
  }
  return columnsReady;
}

async function resolveEventColor(
  unitId: string,
  body: { color?: unknown; color_purpose_id?: unknown; colorPurposeId?: unknown },
  opts: { requireColor?: boolean } = {}
): Promise<{ color: string | null; colorPurposeId: string | null } | { error: string }> {
  const purposeRaw = body.color_purpose_id ?? body.colorPurposeId;
  const purposeId =
    purposeRaw === null || purposeRaw === ''
      ? null
      : purposeRaw !== undefined
        ? String(purposeRaw).trim() || null
        : undefined;

  if (purposeId) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; color: string; unit_id: string }>>(
      `SELECT id, color, unit_id FROM "ScheduleDeptColorPurpose" WHERE id = $1 LIMIT 1`,
      purposeId
    );
    if (!rows[0] || String(rows[0].unit_id) !== unitId) {
      return { error: '부서 공용 용도를 찾을 수 없습니다.' };
    }
    return { color: rows[0].color, colorPurposeId: purposeId };
  }

  if (purposeId === null) {
    const color =
      body.color !== undefined
        ? String(body.color || '#7baaf7').trim().slice(0, 32) || '#7baaf7'
        : opts.requireColor
          ? '#7baaf7'
          : null;
    if (color !== null && !HEX_RE.test(color) && !color.startsWith('#')) {
      return { color: '#7baaf7', colorPurposeId: null };
    }
    return { color, colorPurposeId: null };
  }

  // purpose 미전달 — 기존 개인 색상 로직
  if (body.color !== undefined) {
    const color = String(body.color || '#7baaf7').trim().slice(0, 32) || '#7baaf7';
    return { color, colorPurposeId: null };
  }
  if (opts.requireColor) {
    return { color: '#7baaf7', colorPurposeId: null };
  }
  return { color: null, colorPurposeId: undefined as unknown as null };
}

async function listEvents(unitId: string, from: string, to: string): Promise<CalRow[]> {
  await ensureDetailColumns();
  return prisma.$queryRawUnsafe<CalRow[]>(
    `SELECT ${SELECT_COLS}
     FROM "MarketingDeptCalendarEvent"
     WHERE unit_id = $1
       AND start_date <= $3
       AND COALESCE(end_date, start_date) >= $2
     ORDER BY start_date ASC, "createdAt" ASC`,
    unitId,
    from,
    to
  );
}

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — 본인 소속(unit) 일정만 */
export async function GET(req: Request) {
  let auth;
  try {
    auth = await authorizeScheduleCalendar();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const from = normalizeYmd(searchParams.get('from'), getKSTDateString() || '');
    const to = normalizeYmd(searchParams.get('to'), from);
    if (!from || !to) {
      return NextResponse.json({ error: '조회 기간(from/to)이 필요합니다.' }, { status: 400 });
    }

    const events = await listEvents(unitId, from, to);
    return NextResponse.json({
      unitId,
      unitName,
      events,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/dept-calendar GET]', msg);
    return NextResponse.json({ error: '일정 조회 실패', details: msg }, { status: 500 });
  }
}

/** POST — 본인 소속 일정 등록 (소속 전원 공유) */
export async function POST(req: Request) {
  let auth;
  try {
    auth = await authorizeScheduleCalendar();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    await ensureDetailColumns();
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const title = String(body.title || '').trim();
    if (!title) {
      return NextResponse.json({ error: '내용을 입력해 주세요.' }, { status: 400 });
    }
    const startDate = normalizeYmd(body.start_date || body.startDate);
    if (!startDate) {
      return NextResponse.json({ error: '시작일을 확인해 주세요.' }, { status: 400 });
    }
    const endDate = normalizeYmd(body.end_date || body.endDate, startDate) || startDate;
    const location = String(body.location || '').trim().slice(0, 200);
    const timeText = String(body.time_text || body.timeText || '').trim().slice(0, 80);
    const attendees = String(body.attendees || '').trim().slice(0, 300);
    const note = String(body.note || '').trim().slice(0, 500);
    const resolved = await resolveEventColor(unitId, body, { requireColor: true });
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const color = resolved.color || '#7baaf7';
    const colorPurposeId = resolved.colorPurposeId;
    const id = randomUUID().replace(/-/g, '').slice(0, 25);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "MarketingDeptCalendarEvent"
        (id, unit_id, unit_name, title, note, location, time_text, attendees,
         start_date, end_date, all_day, color, color_purpose_id,
         creator_name, creator_dept, creator_email, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13,$14,$15,NOW(),NOW())`,
      id,
      unitId,
      unitName || null,
      title.slice(0, 800),
      note,
      location,
      timeText,
      attendees,
      startDate,
      endDate,
      color,
      colorPurposeId,
      auth.user.name || null,
      unitName || null,
      auth.user.email || null
    );

    const rows = await prisma.$queryRawUnsafe<CalRow[]>(
      `SELECT ${SELECT_COLS} FROM "MarketingDeptCalendarEvent" WHERE id = $1`,
      id
    );
    return NextResponse.json(rows[0] || { id, title, start_date: startDate });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/dept-calendar POST]', msg);
    return NextResponse.json({ error: '일정 등록 실패', details: msg }, { status: 500 });
  }
}

/** PATCH — 본인 소속 일정만 수정 (소속 전원 가능) */
export async function PATCH(req: Request) {
  let auth;
  try {
    auth = await authorizeScheduleCalendar();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    await ensureDetailColumns();
    const { unitId } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ error: 'ID가 없습니다.' }, { status: 400 });

    const existing = await prisma.$queryRawUnsafe<CalRow[]>(
      `SELECT id, unit_id FROM "MarketingDeptCalendarEvent" WHERE id = $1 LIMIT 1`,
      id
    );
    if (!existing[0]) {
      return NextResponse.json({ error: '일정을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (String(existing[0].unit_id) !== unitId) {
      return NextResponse.json({ error: '다른 소속 일정은 수정할 수 없습니다.' }, { status: 403 });
    }

    const title =
      body.title !== undefined ? String(body.title || '').trim().slice(0, 800) : null;
    if (body.title !== undefined && !title) {
      return NextResponse.json({ error: '내용을 입력해 주세요.' }, { status: 400 });
    }
    const startDate =
      body.start_date !== undefined || body.startDate !== undefined
        ? normalizeYmd(body.start_date || body.startDate)
        : null;
    const endDate =
      body.end_date !== undefined || body.endDate !== undefined
        ? normalizeYmd(body.end_date || body.endDate, startDate || '')
        : null;
    const note = body.note !== undefined ? String(body.note || '').trim().slice(0, 500) : null;
    const location =
      body.location !== undefined ? String(body.location || '').trim().slice(0, 200) : null;
    const timeText =
      body.time_text !== undefined || body.timeText !== undefined
        ? String(body.time_text || body.timeText || '').trim().slice(0, 80)
        : null;
    const attendees =
      body.attendees !== undefined ? String(body.attendees || '').trim().slice(0, 300) : null;
    const colorTouched =
      body.color !== undefined ||
      body.color_purpose_id !== undefined ||
      body.colorPurposeId !== undefined;
    let color: string | null = null;
    let colorPurposeId: string | null | undefined = undefined;
    if (colorTouched) {
      const resolved = await resolveEventColor(unitId, body);
      if ('error' in resolved) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      color = resolved.color;
      colorPurposeId = resolved.colorPurposeId;
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "MarketingDeptCalendarEvent" SET
         title = COALESCE($2, title),
         note = COALESCE($3, note),
         location = COALESCE($4, location),
         time_text = COALESCE($5, time_text),
         attendees = COALESCE($6, attendees),
         start_date = COALESCE($7, start_date),
         end_date = COALESCE($8, end_date),
         color = COALESCE($9, color),
         color_purpose_id = CASE
           WHEN $11::int = 0 THEN color_purpose_id
           WHEN $10::text IS NULL THEN NULL
           ELSE $10
         END,
         "updatedAt" = NOW()
       WHERE id = $1 AND unit_id = $12`,
      id,
      title,
      note,
      location,
      timeText,
      attendees,
      startDate,
      endDate,
      color,
      colorPurposeId === undefined ? null : colorPurposeId,
      colorTouched ? 1 : 0,
      unitId
    );

    const rows = await prisma.$queryRawUnsafe<CalRow[]>(
      `SELECT ${SELECT_COLS} FROM "MarketingDeptCalendarEvent" WHERE id = $1`,
      id
    );
    return NextResponse.json(rows[0] || { id });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/dept-calendar PATCH]', msg);
    return NextResponse.json({ error: '일정 수정 실패', details: msg }, { status: 500 });
  }
}

/** DELETE ?id= — 본인 소속 일정만 삭제 */
export async function DELETE(req: Request) {
  let auth;
  try {
    auth = await authorizeScheduleCalendar();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { unitId } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.$queryRawUnsafe<CalRow[]>(
      `SELECT id, unit_id FROM "MarketingDeptCalendarEvent" WHERE id = $1 LIMIT 1`,
      id
    );
    if (!existing[0]) {
      return NextResponse.json({ error: '일정을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (String(existing[0].unit_id) !== unitId) {
      return NextResponse.json({ error: '다른 소속 일정은 삭제할 수 없습니다.' }, { status: 403 });
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM "MarketingDeptCalendarEvent" WHERE id = $1 AND unit_id = $2`,
      id,
      unitId
    );
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/dept-calendar DELETE]', msg);
    return NextResponse.json({ error: '일정 삭제 실패', details: msg }, { status: 500 });
  }
}
