import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import prisma from '@/lib/prisma';
import { JWT_SECRET } from '@/lib/jwt';
import {
  normalizePagePath,
  seoulYmd,
  shouldSkipPageViewPath,
} from '@/lib/page-view-stats';

export const dynamic = 'force-dynamic';

function sessionUserIdFromCookie(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string; id?: string };
    const id = String(decoded.userId || decoded.id || '').trim();
    return id || null;
  } catch {
    return null;
  }
}

/** 로그인 사용자 페이지 접속 1회 기록 (일별 upsert) */
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const userId = sessionUserIdFromCookie(cookieStore.get('token')?.value);
    if (!userId) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const path = normalizePagePath(String(body?.path || ''));
    if (!path || shouldSkipPageViewPath(path)) {
      return NextResponse.json({ ok: false, skipped: true });
    }
    if (path.length > 240) {
      return NextResponse.json({ ok: false, error: 'path too long' }, { status: 400 });
    }

    const { year, month, day } = seoulYmd();

    await prisma.$transaction([
      prisma.pageViewDaily.upsert({
        where: {
          path_year_month_day: { path, year, month, day },
        },
        create: { path, year, month, day, hits: 1 },
        update: { hits: { increment: 1 } },
      }),
      prisma.pageViewVisitorDaily.upsert({
        where: {
          path_year_month_day_userId: {
            path,
            year,
            month,
            day,
            userId,
          },
        },
        create: { path, year, month, day, userId },
        update: {},
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[page-view] track error', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
