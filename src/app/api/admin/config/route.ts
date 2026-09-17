import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAdminApi, authErrorToResponse, requireSessionUser } from '@/lib/server-auth-guard';

const DEFAULT_TAGLINE = 'Workplace Innovative System for Efficiency';

async function readTagline(): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<Array<{ tagline: string | null }>>`
      SELECT "tagline" FROM "SystemConfig" WHERE id = 'global'
    `;
    const v = String(rows[0]?.tagline ?? '').trim();
    return v || DEFAULT_TAGLINE;
  } catch {
    return DEFAULT_TAGLINE;
  }
}

async function writeTagline(value: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "SystemConfig" SET "tagline" = $1, "updatedAt" = NOW() WHERE id = 'global'`,
    value
  );
}

/**
 * [GET] 시스템 글로벌 설정 불러오기
 * - 홈·서비스 화면에서도 사용 → 로그인만 필수 (LV_1 잠금 금지)
 * - 비로그인 공개 차단
 */
export async function GET() {
  try {
    await requireSessionUser();

    let config = await prisma.systemConfig.findUnique({
      where: { id: 'global' },
    });

    // 만약 최초 실행이라 설정 데이터가 없다면 기본 레코드를 생성합니다.
    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          id: 'global',
          main_headline: 'KPCQA WISE',
          sub_headline: 'KPCQA 통합업무지원시스템',
          home_grid_cols: 4,
          layout_type: 'horizontal',
          audit_baseline: '',
        },
      });
      await writeTagline(DEFAULT_TAGLINE);
    }

    const tagline =
      typeof (config as any).tagline === 'string' && String((config as any).tagline).trim()
        ? String((config as any).tagline).trim()
        : await readTagline();

    return NextResponse.json(
      { ...config, tagline },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Config GET Error:', error);
    return NextResponse.json({ message: '설정 로드 실패' }, { status: 500 });
  }
}

/**
 * [PATCH] 시스템 글로벌 설정 수정하기 — LV_1만
 */
export async function PATCH(req: Request) {
  try {
    await authorizeAdminApi();
    const body = await req.json();

    const allowedFields = [
      'main_headline',
      'sub_headline',
      'tagline',
      'home_grid_cols',
      'layout_type',
      'audit_baseline',
      'client_category_group',
      'supply_category_group',
      'unit_category_group',
      'it_category_group',
      'it_rental_group',
      'it_master_group',
      'global_mgmt_dept',
      'linked_sites',
      // 레거시(미사용): 직책/직급은 /admin/users SystemConfig 옵션으로 이전
      'job_duty_group',
      'job_grade_group',
      'bc_sheets_per_pack',
      'outsourcing_vendor_group',
      'outsourcing_item_group',
      'outsourcing_detail1_group',
      'outsourcing_detail2_group',
    ];

    const updateData: any = {};
    allowedFields.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        if (key === 'linked_sites' && typeof body[key] === 'string') {
          try {
            updateData[key] = JSON.parse(body[key]);
          } catch {
            updateData[key] = body[key];
          }
        } else {
          updateData[key] = body[key];
        }
      }
    });

    // tagline: Prisma client 미재생성 환경 대비 raw 저장
    const nextTagline =
      updateData.tagline !== undefined ? String(updateData.tagline ?? '') : null;
    delete updateData.tagline;

    if (Object.keys(updateData).length > 0) {
      await prisma.systemConfig.update({
        where: { id: 'global' },
        data: updateData,
      });
    }
    if (nextTagline !== null) {
      await writeTagline(nextTagline);
    }

    const updated = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    const tagline = nextTagline !== null ? nextTagline : await readTagline();

    return NextResponse.json({ ...updated, tagline });
  } catch (error: any) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error('🔥 [시스템 설정 PATCH DB 에러 상세]:', error.message || error);
    return NextResponse.json({ message: '저장 실패', error: error.message }, { status: 500 });
  }
}
