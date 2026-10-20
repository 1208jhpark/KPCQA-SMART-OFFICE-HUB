import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import {
  authorizeMarketingDistributionsRead,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { getKSTDateString } from '@/utils/dateUtils';

export const dynamic = 'force-dynamic';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  start_date: string;
  end_date: string | null;
  all_day: boolean;
  color: string | null;
  creator_name: string | null;
  creator_dept: string | null;
  creator_email: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function listEvents(unitId: string, from: string, to: string): Promise<CalRow[]> {
  // Prisma client 미재생성 환경 대비 — 테이블 직접 조회
  return prisma.$queryRawUnsafe<CalRow[]>(
    `SELECT id, unit_id, unit_name, title, note, start_date, end_date, all_day, color,
            creator_name, creator_dept, creator_email, "createdAt", "updatedAt"
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
    auth = await authorizeMarketingDistributionsRead();
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
    console.error('[dept-calendar GET]', msg);
    return NextResponse.json({ error: '일정 조회 실패', details: msg }, { status: 500 });
  }
}

/** POST — 본인 소속 일정 등록 (소속 전원 공유) */
export async function POST(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingDistributionsRead();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { unitId, unitName } = resolveMyUnit(auth.user);
    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const title = String(body.title || '').trim();
    if (!title) {
      return NextResponse.json({ error: '제목을 입력해 주세요.' }, { status: 400 });
    }
    const startDate = normalizeYmd(body.start_date || body.startDate);
    if (!startDate) {
      return NextResponse.json({ error: '시작일을 확인해 주세요.' }, { status: 400 });
    }
    const endDate = normalizeYmd(body.end_date || body.endDate, startDate) || startDate;
    const note = String(body.note || '').trim().slice(0, 500);
    const color = String(body.color || '#4f46e5').trim().slice(0, 32) || '#4f46e5';
    const id = randomUUID().replace(/-/g, '').slice(0, 25);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "MarketingDeptCalendarEvent"
        (id, unit_id, unit_name, title, note, start_date, end_date, all_day, color,
         creator_name, creator_dept, creator_email, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,NOW(),NOW())`,
      id,
      unitId,
      unitName || null,
      title.slice(0, 120),
      note,
      startDate,
      endDate,
      color,
      auth.user.name || null,
      unitName || null,
      auth.user.email || null
    );

    const rows = await prisma.$queryRawUnsafe<CalRow[]>(
      `SELECT id, unit_id, unit_name, title, note, start_date, end_date, all_day, color,
              creator_name, creator_dept, creator_email, "createdAt", "updatedAt"
       FROM "MarketingDeptCalendarEvent" WHERE id = $1`,
      id
    );
    return NextResponse.json(rows[0] || { id, title, start_date: startDate });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[dept-calendar POST]', msg);
    return NextResponse.json({ error: '일정 등록 실패', details: msg }, { status: 500 });
  }
}

/** PATCH — 본인 소속 일정만 수정 (소속 전원 가능) */
export async function PATCH(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingDistributionsRead();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
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
      body.title !== undefined ? String(body.title || '').trim().slice(0, 120) : null;
    if (body.title !== undefined && !title) {
      return NextResponse.json({ error: '제목을 입력해 주세요.' }, { status: 400 });
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
    const color =
      body.color !== undefined
        ? String(body.color || '#4f46e5').trim().slice(0, 32) || '#4f46e5'
        : null;

    await prisma.$executeRawUnsafe(
      `UPDATE "MarketingDeptCalendarEvent" SET
         title = COALESCE($2, title),
         note = COALESCE($3, note),
         start_date = COALESCE($4, start_date),
         end_date = COALESCE($5, end_date),
         color = COALESCE($6, color),
         "updatedAt" = NOW()
       WHERE id = $1 AND unit_id = $7`,
      id,
      title,
      note,
      startDate,
      endDate,
      color,
      unitId
    );

    const rows = await prisma.$queryRawUnsafe<CalRow[]>(
      `SELECT id, unit_id, unit_name, title, note, start_date, end_date, all_day, color,
              creator_name, creator_dept, creator_email, "createdAt", "updatedAt"
       FROM "MarketingDeptCalendarEvent" WHERE id = $1`,
      id
    );
    return NextResponse.json(rows[0] || { id });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[dept-calendar PATCH]', msg);
    return NextResponse.json({ error: '일정 수정 실패', details: msg }, { status: 500 });
  }
}

/** DELETE ?id= — 본인 소속 일정만 삭제 */
export async function DELETE(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingDistributionsRead();
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
    console.error('[dept-calendar DELETE]', msg);
    return NextResponse.json({ error: '일정 삭제 실패', details: msg }, { status: 500 });
  }
}
