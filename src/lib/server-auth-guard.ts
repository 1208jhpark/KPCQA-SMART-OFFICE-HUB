import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import prisma from '@/lib/prisma';
import { checkMenuPermission } from './permission-utils';
import { resolveTopOrgName, canEditTopOrgMarketingAsset } from '@/utils/orgUnits';

const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

/** 마케팅 코너 interface 경로 (하위 카드 중 하나라도 통과하면 API 허용) */
export const MARKETING_MENU_PATHS = [
  '/marketing',
  '/marketing/dashboard',
  '/marketing/distribution',
  '/marketing/distribution/catalog',
  '/marketing/distribution/register',
  '/marketing/distribution/dept',
  '/marketing/distribution/client-search',
];

const safeArray = (val: any) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return val.split(',').map((s: string) => s.trim().replace(/['"\[\]]/g, ''));
    }
  }
  return [val];
};

function normalizePath(menuPath: string) {
  return menuPath.replace(/\/$/, '').toLowerCase();
}

function scopeRank(scope: string) {
  const s = String(scope || 'NONE').toUpperCase();
  if (s === 'TOTAL') return 3;
  if (s === 'DEPT') return 2;
  if (s === 'OWN') return 1;
  return 0;
}

export async function authorizeApi(menuPath: string) {
  const cleanPath = normalizePath(menuPath);

  const isSurveyOpenLink =
    cleanPath.includes('/survey/') && !cleanPath.includes('/admin') && !cleanPath.includes('/my-submissions');
  const isItAuditQrLink =
    cleanPath.includes('/asset/it/master/audit') || cleanPath.includes('/asset/it/audit');

  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  if (!token) {
    if (isSurveyOpenLink || isItAuditQrLink) {
      return {
        user: {
          id: 'OPEN_LINK_USER',
          name: '링크 참여자',
          email: 'guest@kpcqa.jp',
          roles: ['GUEST'],
          unit_id: null,
          unit: null,
        },
        permission: {
          hasAccess: true,
          isMaster: false,
          isEditor: true,
          isViewer: true,
          viewScope: 'OWN',
          editScope: 'OWN',
          myRole: 'GUEST',
        },
        unitsList: [] as any[],
        systemConfig: null as any,
        allMenus: [] as any[],
      };
    }
    throw new Error('UNAUTHORIZED');
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    if (isSurveyOpenLink || isItAuditQrLink) {
      return {
        user: {
          id: 'OPEN_LINK_USER',
          name: '링크 참여자',
          email: 'guest@kpcqa.jp',
          roles: ['GUEST'],
          unit_id: null,
          unit: null,
        },
        permission: {
          hasAccess: true,
          isMaster: false,
          isEditor: true,
          isViewer: true,
          viewScope: 'OWN',
          editScope: 'OWN',
          myRole: 'GUEST',
        },
        unitsList: [] as any[],
        systemConfig: null as any,
        allMenus: [] as any[],
      };
    }
    throw new Error('UNAUTHORIZED_EXPIRED');
  }

  const user = await prisma.user.findUnique({
    where: { email: decoded.email },
    include: { unit: { include: { parent: true } } },
  });
  if (!user) throw new Error('USER_NOT_FOUND');

  const [allMenus, unitsList, systemConfig] = await Promise.all([
    prisma.interfaceConfig.findMany(),
    prisma.orgUnit.findMany({ where: { is_deleted: false, is_active: true } }),
    prisma.systemConfig.findUnique({ where: { id: 'global' } }),
  ]);

  const menu = allMenus.find((m) => m.path?.toLowerCase() === cleanPath);

  if (!menu) {
    if (isSurveyOpenLink || isItAuditQrLink) {
      return {
        user,
        permission: {
          hasAccess: true,
          isMaster: false,
          isEditor: true,
          isViewer: true,
          viewScope: 'OWN',
          editScope: 'OWN',
          myRole: 'LV_3',
        },
        unitsList,
        systemConfig,
        allMenus,
      };
    }
    throw new Error('MENU_NOT_CONFIGURED');
  }

  const permission = checkMenuPermission(
    { id: user.id, email: user.email, roles: user.roles, dept_id: user.unit_id, unit: user.unit },
    menu,
    allMenus,
    unitsList
  );

  return { user, permission, unitsList, systemConfig, allMenus };
}

/**
 * 여러 interface 경로 중 하나라도 접근/편집 가능하면 통과.
 * (공유 API: items/distributions 등이 여러 L4에서 호출되는 경우)
 */
export async function authorizeAnyMenuPaths(
  menuPaths: string[],
  options?: { requireEditor?: boolean }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) throw new Error('UNAUTHORIZED');

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    throw new Error('UNAUTHORIZED_EXPIRED');
  }

  const user = await prisma.user.findUnique({
    where: { email: decoded.email },
    include: { unit: { include: { parent: true } } },
  });
  if (!user) throw new Error('USER_NOT_FOUND');

  const [allMenus, unitsList, systemConfig] = await Promise.all([
    prisma.interfaceConfig.findMany(),
    prisma.orgUnit.findMany({ where: { is_deleted: false, is_active: true } }),
    prisma.systemConfig.findUnique({ where: { id: 'global' } }),
  ]);

  const userForPerm = {
    id: user.id,
    email: user.email,
    roles: user.roles,
    dept_id: user.unit_id,
    unit: user.unit,
  };

  let matchedConfigured = 0;
  const merged = {
    hasAccess: false,
    isMaster: false,
    isEditor: false,
    isViewer: false,
    viewScope: 'NONE',
    editScope: 'NONE',
    myRole: 'LV_3',
  };

  for (const path of menuPaths) {
    const clean = normalizePath(path);
    const menu = allMenus.find((m) => m.path?.toLowerCase() === clean);
    if (!menu) continue;
    matchedConfigured += 1;

    const p = checkMenuPermission(userForPerm, menu, allMenus, unitsList);
    if (p.myRole) merged.myRole = p.myRole;

    if (p.isMaster || p.myRole === 'LV_1') {
      return {
        user,
        permission: {
          hasAccess: true,
          isMaster: true,
          isEditor: true,
          isViewer: true,
          viewScope: 'TOTAL',
          editScope: 'TOTAL',
          myRole: p.myRole,
        },
        unitsList,
        systemConfig,
        allMenus,
      };
    }

    if (p.hasAccess) {
      merged.hasAccess = true;
      merged.isViewer = true;
      if (scopeRank(p.viewScope) > scopeRank(merged.viewScope)) {
        merged.viewScope = p.viewScope;
      }
    }

    if (p.isEditor) {
      merged.isEditor = true;
      // FE Catalog: edit_scopes 비어 있으면 편집자 = 전체(TOTAL)로 취급
      const rawEditScopes = safeArray(menu.edit_scopes);
      const effectiveEdit =
        rawEditScopes.length === 0 ? 'TOTAL' : String(p.editScope || 'OWN').toUpperCase();
      if (scopeRank(effectiveEdit) > scopeRank(merged.editScope)) {
        merged.editScope = effectiveEdit;
      }
    }
  }

  if (matchedConfigured === 0) {
    // 메뉴가 DB에 하나도 없으면 LV_1만 통과 (오설정으로 전면 개방 방지)
    const rolesArr = safeArray(user.roles);
    const levelMatch = String(rolesArr[0] || '').match(/\d+/);
    const myRole = levelMatch ? `LV_${levelMatch[0]}` : 'LV_3';
    if (myRole === 'LV_1') {
      return {
        user,
        permission: {
          hasAccess: true,
          isMaster: true,
          isEditor: true,
          isViewer: true,
          viewScope: 'TOTAL',
          editScope: 'TOTAL',
          myRole,
        },
        unitsList,
        systemConfig,
        allMenus,
      };
    }
    throw new Error('MENU_NOT_CONFIGURED');
  }

  if (!merged.hasAccess) throw new Error('FORBIDDEN');
  if (options?.requireEditor && !merged.isEditor) throw new Error('FORBIDDEN_EDIT');

  return { user, permission: merged, unitsList, systemConfig, allMenus };
}

export async function authorizeMarketingApi(options?: { requireEditor?: boolean }) {
  return authorizeAnyMenuPaths(MARKETING_MENU_PATHS, options);
}

/**
 * 물품 owner_dept 기준 편집 스코프 (Catalog FE와 동일)
 * - Organization(최상위) 자산: LV_1 제외 global_mgmt_dept만 (TOTAL이어도 동일)
 * - 그 외: TOTAL → 전체 / DEPT → 내 센터·본부
 * - HQ가 하위 센터 자산을 편집하진 않음 (지급 신청만)
 */
export function assertCanEditOwnerDept(
  auth: Awaited<ReturnType<typeof authorizeMarketingApi>>,
  ownerDept: string | null | undefined
) {
  const { user, permission, unitsList, systemConfig } = auth;
  if (permission.isMaster || permission.myRole === 'LV_1') return;
  if (!permission.isEditor) throw new Error('FORBIDDEN_EDIT');

  const myCenter = user.unit?.unit_name;
  const myHq = (user.unit as any)?.parent?.unit_name as string | undefined;
  const topOrg = resolveTopOrgName(unitsList);
  const mgmtDept = systemConfig?.global_mgmt_dept;

  // Organization 자산 CRUD → settings GLOBAL_MGMT만
  if (topOrg && ownerDept && ownerDept === topOrg) {
    if (
      canEditTopOrgMarketingAsset({
        ownerDept,
        topOrgName: topOrg,
        myUnitName: myCenter,
        myHqName: myHq,
        globalMgmtDept: mgmtDept,
      })
    ) {
      return;
    }
    throw new Error('FORBIDDEN_EDIT');
  }

  const scope = String(permission.editScope || 'NONE').toUpperCase();
  if (scope === 'TOTAL') return;

  // 본인 소속 조직만 CRUD (센터→HQ, HQ→하위센터 편집 불가 — 지급 신청만)
  if (ownerDept && ownerDept === myCenter) return;

  throw new Error('FORBIDDEN_EDIT');
}

export function authErrorToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  switch (msg) {
    case 'UNAUTHORIZED':
    case 'UNAUTHORIZED_EXPIRED':
    case 'USER_NOT_FOUND':
      return NextResponse.json({ error: '로그인 후 이용할 수 있습니다.' }, { status: 401 });
    case 'FORBIDDEN':
      return NextResponse.json(
        { error: '해당 메뉴에 대한 접근 권한이 없습니다.' },
        { status: 403 }
      );
    case 'FORBIDDEN_EDIT':
      return NextResponse.json(
        { error: '편집/등록 권한이 없거나, 해당 부서 자산에 대한 권한이 없습니다.' },
        { status: 403 }
      );
    case 'FORBIDDEN_ADMIN':
      return NextResponse.json(
        { error: '조직 관리 권한이 없습니다. (LV_1 필요)' },
        { status: 403 }
      );
    case 'MENU_NOT_CONFIGURED':
      return NextResponse.json(
        { error: '메뉴 권한이 설정되지 않았습니다. 관리자에게 문의하세요.' },
        { status: 403 }
      );
    default:
      console.error('[authErrorToResponse]', msg);
      return NextResponse.json({ error: '권한 확인 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/**
 * 로그인 세션만 검증 (메뉴 권한 불문). units 등 공통 조회용.
 * 토큰 없으면 null (throw 안 함).
 */
export async function tryGetSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: decoded.email },
    include: { unit: { include: { parent: true } } },
  });
  return user;
}

/** 로그인 필수 */
export async function requireSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) throw new Error('UNAUTHORIZED');

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    throw new Error('UNAUTHORIZED_EXPIRED');
  }

  const user = await prisma.user.findUnique({
    where: { email: decoded.email },
    include: { unit: { include: { parent: true } } },
  });
  if (!user) throw new Error('USER_NOT_FOUND');
  return user;
}

function roleLevel(roles: unknown): string {
  const arr = safeArray(roles);
  for (const r of arr) {
    const m = String(r).match(/(\d+)/);
    if (m) return `LV_${m[1]}`;
  }
  return 'LV_3';
}

/** 조직 CRUD 등 — LV_1만 */
export async function requireLv1SessionUser() {
  const user = await requireSessionUser();
  if (roleLevel(user.roles) !== 'LV_1') throw new Error('FORBIDDEN_ADMIN');
  return user;
}
