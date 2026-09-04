import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/apply/request';
const READ_PATHS = [
  '/asset/production/apply/request',
  '/asset/production/apply/history',
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/archive',
];

/** 시드(seed-production-masters) 등록 순서 — 목록/연동 UI 기본 정렬 */
const SEED_PLATE_ORDER = [
  'CAST_IRON_300',
  'TUNGSTEN_300',
  'BRASS_300',
  'STAINLESS_300',
  'STAINLESS_90',
  'STAINLESS_450_A',
  'STAINLESS_450_IMS',
  'STAINLESS_450_B',
  'WOOD_240',
  'SILVER_220',
  'SILVER_260',
] as const;

function plateSortRank(code: string) {
  const idx = (SEED_PLATE_ORDER as readonly string[]).indexOf(code);
  return idx >= 0 ? idx : SEED_PLATE_ORDER.length + 100;
}

export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const plates = await prisma.productionPlateMaster.findMany({
      where: { isActive: true },
    });
    // 시드 등록 순서 우선, 그 외(수동 추가)는 라벨·규격순
    plates.sort((a, b) => {
      const bySeed = plateSortRank(a.code) - plateSortRank(b.code);
      if (bySeed !== 0) return bySeed;
      const byLabel = a.label.localeCompare(b.label, 'ko');
      if (byLabel !== 0) return byLabel;
      return String(a.size || '').localeCompare(String(b.size || ''), 'ko');
    });
    return NextResponse.json(plates);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 명판 마스터 조회 오류:', error);
    return NextResponse.json({ message: '단가 조회 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const code = String(body.code || '').trim();
    const label = String(body.label || '').trim();
    if (!code || !label) {
      return NextResponse.json({ message: '코드와 품목명은 필수입니다.' }, { status: 400 });
    }

    // 신규 등록은 메뉴 접근만, 기존 품목 수정은 Edit 권한 필요
    const existing = await prisma.productionPlateMaster.findUnique({ where: { code } });
    await authorizeApi(MENU_PATH, { requireEditor: !!existing });

    const plate = await prisma.productionPlateMaster.upsert({
      where: { code },
      update: {
        label,
        price: Number(body.price) || 0,
        size: String(body.size || '자율 규격').trim() || '자율 규격',
        isActive: true,
      },
      create: {
        code,
        label,
        price: Number(body.price) || 0,
        size: String(body.size || '자율 규격').trim() || '자율 규격',
        isActive: true,
      },
    });
    return NextResponse.json({ message: '저장 완료', data: plate });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 명판 마스터 저장 오류:', error);
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    if (!code) return NextResponse.json({ message: '코드가 필요합니다.' }, { status: 400 });

    const activeCount = await prisma.productionPlateMaster.count({ where: { isActive: true } });
    if (activeCount <= 1) {
      return NextResponse.json({ message: '최소 한 개 이상의 판 종류가 존재해야 합니다.' }, { status: 400 });
    }

    await prisma.productionPlateMaster.update({
      where: { code },
      data: { isActive: false },
    });
    return NextResponse.json({ message: '삭제(비활성화) 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 명판 마스터 삭제 오류:', error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}
