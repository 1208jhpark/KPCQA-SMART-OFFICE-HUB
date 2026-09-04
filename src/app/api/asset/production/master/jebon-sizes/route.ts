import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/production/apply/request',
  '/asset/production/apply/history',
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/archive',
];

/** 시드(seed-production-masters) 등록 순서 · LV_1 삭제 대상 */
const SEED_JEBON_SIZE_CODES = new Set([
  'A4',
  'B5',
  'A5',
  'B6',
  '16절',
  '비규격',
]);

const SEED_JEBON_SIZE_ORDER = [...SEED_JEBON_SIZE_CODES];

function jebonSizeSortRank(code: string) {
  const idx = (SEED_JEBON_SIZE_ORDER as readonly string[]).indexOf(code);
  return idx >= 0 ? idx : SEED_JEBON_SIZE_ORDER.length + 100;
}

function jebonSizeDbErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (code === 'P2021' || code === 'P2022') {
      return '제본 판형 테이블이 없습니다. npx prisma migrate deploy 후 npm run db:seed:production 을 실행해 주세요.';
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('ProductionJebonSizeMaster')) {
    return '제본 판형 테이블이 없습니다. npx prisma migrate deploy 후 npm run db:seed:production 을 실행해 주세요.';
  }
  return fallback;
}

export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const rows = await prisma.productionJebonSizeMaster.findMany({
      where: { isActive: true },
    });
    rows.sort((a, b) => {
      const bySeed = jebonSizeSortRank(a.code) - jebonSizeSortRank(b.code);
      if (bySeed !== 0) return bySeed;
      return a.label.localeCompare(b.label, 'ko');
    });
    return NextResponse.json(rows);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제본 판형 마스터 조회 오류:', error);
    return NextResponse.json(
      { message: jebonSizeDbErrorMessage(error, '판형 조회 실패') },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const code = String(body.code || '').trim();
    const label = String(body.label || '').trim();
    if (!code || !label) {
      return NextResponse.json({ message: '코드와 종류는 필수입니다.' }, { status: 400 });
    }

    const existing = await prisma.productionJebonSizeMaster.findUnique({ where: { code } });
    await authorizeAnyMenuPaths(READ_PATHS, { requireEditor: !!existing });

    const row = await prisma.productionJebonSizeMaster.upsert({
      where: { code },
      update: {
        label,
        size: String(body.size || '').trim(),
        description: String(body.description || '').trim(),
        isActive: true,
      },
      create: {
        code,
        label,
        size: String(body.size || '').trim(),
        description: String(body.description || '').trim(),
        isActive: true,
      },
    });
    return NextResponse.json({ message: '저장 완료', data: row });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제본 판형 마스터 저장 오류:', error);
    return NextResponse.json(
      { message: jebonSizeDbErrorMessage(error, '저장 실패') },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS);
    const { searchParams } = new URL(req.url);
    const code = String(searchParams.get('code') || '').trim();
    if (!code) return NextResponse.json({ message: '코드가 필요합니다.' }, { status: 400 });

    const row = await prisma.productionJebonSizeMaster.findUnique({ where: { code } });
    if (!row || !row.isActive) {
      return NextResponse.json(
        { message: '대상을 찾을 수 없습니다. (migrate/seed 후 다시 시도해 주세요)' },
        { status: 404 }
      );
    }

    const isSeed = SEED_JEBON_SIZE_CODES.has(code);
    if (isSeed) {
      const isLv1OrMaster =
        auth.permission.isMaster || auth.permission.myRole === 'LV_1';
      if (!isLv1OrMaster) {
        return NextResponse.json(
          { message: '시드 판형 삭제는 LV_1(마스터) 권한이 필요합니다.' },
          { status: 403 }
        );
      }
    } else if (!auth.permission.isEditor) {
      return NextResponse.json({ message: '편집 권한이 없습니다.' }, { status: 403 });
    }

    const activeCount = await prisma.productionJebonSizeMaster.count({
      where: { isActive: true },
    });
    if (activeCount <= 1) {
      return NextResponse.json(
        { message: '최소 한 개 이상의 판형이 존재해야 합니다.' },
        { status: 400 }
      );
    }

    await prisma.productionJebonSizeMaster.update({
      where: { code },
      data: { isActive: false },
    });
    return NextResponse.json({ message: '삭제(비활성화) 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제본 판형 마스터 삭제 오류:', error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}
