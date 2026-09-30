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

function prismaCode(e: unknown): string {
  return String((e as { code?: string })?.code || '');
}

/** 테이블 미생성·클라이언트 미갱신 — 배포 PC에서 migrate/generate 전 */
function isMissingSchemaError(e: unknown): boolean {
  const code = prismaCode(e);
  if (code === 'P2021' || code === 'P2022') return true;
  const msg = e instanceof Error ? e.message : String(e || '');
  return (
    /pageviewdaily|pageviewvisitordaily/i.test(msg) &&
    /(does not exist|unknown arg|findunique|upsert)/i.test(msg)
  );
}

/** 로그인 사용자 페이지 접속 1회 기록 (일별 upsert) */
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const userId = sessionUserIdFromCookie(cookieStore.get('token')?.value);
    if (!userId) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    if (!prisma.pageViewDaily || !prisma.pageViewVisitorDaily) {
      console.warn(
        '[page-view] Prisma 클라이언트에 PageView 모델 없음 → 서버 중지 후 npx prisma generate'
      );
      return NextResponse.json({ ok: false, skipped: true, reason: 'client' });
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

    try {
      await prisma.pageViewDaily.upsert({
        where: {
          path_year_month_day: { path, year, month, day },
        },
        create: { path, year, month, day, hits: 1 },
        update: { hits: { increment: 1 } },
      });
    } catch (e) {
      if (isMissingSchemaError(e)) {
        console.warn(
          '[page-view] PageViewDaily 테이블 없음 → 배포 PC에서 npm run db:migrate 실행 필요',
          prismaCode(e) || e
        );
        return NextResponse.json({ ok: false, skipped: true, reason: 'migrate' });
      }
      // 동시 upsert 유니크 충돌 → 한 번 더 increment 시도
      if (prismaCode(e) === 'P2002') {
        await prisma.pageViewDaily.update({
          where: { path_year_month_day: { path, year, month, day } },
          data: { hits: { increment: 1 } },
        });
      } else {
        throw e;
      }
    }

    try {
      await prisma.pageViewVisitorDaily.upsert({
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
      });
    } catch (e) {
      if (isMissingSchemaError(e)) {
        console.warn(
          '[page-view] PageViewVisitorDaily 테이블 없음 → npm run db:migrate 필요',
          prismaCode(e) || e
        );
        return NextResponse.json({ ok: false, skipped: true, reason: 'migrate' });
      }
      // 이미 오늘 방문 기록됨 — 무시
      if (prismaCode(e) === 'P2002') {
        return NextResponse.json({ ok: true });
      }
      throw e;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = prismaCode(e);
    console.error('[page-view] track error', code || '', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
