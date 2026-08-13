import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
  tryGetSessionUser,
} from '@/lib/server-auth-guard';
import { checkMenuPermission } from '@/lib/permission-utils';
import { getChildUnitNames, resolveTopOrgName } from '@/utils/orgUnits';
import {
  assetMatchesIdentity,
  normalizeEmail,
  prismaAssetOwnerWhere,
  toItIdentity,
} from '@/utils/itUserIdentity';
import { withItAssetScheduleFields } from '@/utils/itAssetSchedule';

export const dynamic = 'force-dynamic';

/** IT 자산 조회 가능 메뉴 */
const IT_READ_PATHS = [
  '/asset/it/personal',
  '/asset/it/dept',
  '/asset/it/master/dashboard',
  '/asset/it/master/archive',
  '/asset/it/master/audit',
  '/asset/it/master/requests',
] as const;

/** 마스터 전역 목록(전사) 조회 메뉴 */
const IT_MASTER_READ_PATHS = [
  '/asset/it/master/dashboard',
  '/asset/it/master/archive',
  '/asset/it/master/audit',
  '/asset/it/master/requests',
] as const;

/** 마스터 등록·삭제·전역 수정 */
const IT_MASTER_WRITE_PATHS = [
  '/asset/it/master/dashboard',
  '/asset/it/master/archive',
] as const;

/** 개인 실사·정보수정(본인 자산) */
const IT_PERSONAL_PATH = '/asset/it/personal';

function isLv1(user: any) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.some((r: any) => String(r).includes('LV_1')) || user?.permissionLevel === 'LV_1';
}

function hasMenuAccess(auth: any, path: string) {
  const clean = String(path || '').toLowerCase();
  const menu = (auth.allMenus || []).find(
    (m: any) => String(m.path || '').toLowerCase() === clean
  );
  if (!menu) return false;
  const userForPerm = {
    id: auth.user.id,
    email: auth.user.email,
    roles: auth.user.roles,
    dept_id: auth.user.unit_id,
    unit: auth.user.unit,
  };
  return checkMenuPermission(userForPerm, menu, auth.allMenus || [], auth.unitsList || []).hasAccess;
}

function sanitizeAndParsePayload(rawData: any) {
  const sanitized: any = {};

  const stringFields = [
    'category',
    'it_type',
    'dept',
    'user',
    'user_email',
    'user_id',
    'code',
    'model',
    'sn',
    'brand',
    'spec',
    'is_rental',
    'in_date',
    'start_date',
    'end_date',
    'first_bill',
    'memo',
    'reg_date',
    'entry_source',
    'last_audit_date',
    'last_audit_by',
    'audit_request_date',
  ];
  stringFields.forEach((field) => {
    if (rawData[field] !== undefined) {
      sanitized[field] = rawData[field] === null ? null : String(rawData[field]).trim();
    }
  });
  if (sanitized.user_email) {
    sanitized.user_email = normalizeEmail(sanitized.user_email);
  }

  const intFields = ['rental_months', 'cycle'];
  intFields.forEach((field) => {
    if (rawData[field] !== undefined) {
      const parsed = parseInt(rawData[field], 10);
      sanitized[field] = isNaN(parsed) ? 0 : parsed;
    }
  });

  const floatFields = ['purchase_price', 'monthly_fee'];
  floatFields.forEach((field) => {
    if (rawData[field] !== undefined) {
      const parsed = parseFloat(rawData[field]);
      sanitized[field] = isNaN(parsed) ? 0 : parsed;
    }
  });

  if (rawData.is_active !== undefined) {
    sanitized.is_active = Boolean(rawData.is_active);
  }

  if (rawData.info_correction_pending !== undefined) {
    sanitized.info_correction_pending =
      rawData.info_correction_pending === null
        ? Prisma.DbNull
        : rawData.info_correction_pending;
  }

  return sanitized;
}

/** user / user_email / user_id 중 하나로 User 테이블에서 신원 보강 */
async function enrichOwnerIdentity(cleanData: any) {
  const email = normalizeEmail(cleanData.user_email);
  const id = String(cleanData.user_id || '').trim();
  const name = String(cleanData.user || '').trim();
  if (!email && !id && (!name || name === '-' || name === '공용')) return cleanData;

  let found: any = null;
  if (id) {
    found = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
  }
  if (!found && email) {
    found =
      (await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true },
      })) ||
      (await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, name: true, email: true },
      }));
  }
  if (!found && name && name !== '-' && name !== '공용') {
    found = await prisma.user.findFirst({
      where: { name },
      select: { id: true, name: true, email: true },
    });
  }
  if (found) {
    cleanData.user = found.name || cleanData.user;
    cleanData.user_email = normalizeEmail(found.email);
    cleanData.user_id = found.id;
  } else if (email) {
    cleanData.user_email = email;
  }
  return cleanData;
}

/** 개인 실사/정보수정에 허용되는 필드만 */
function sanitizePersonalSelfPatch(rawData: any) {
  const allowed: any = {};
  for (const key of [
    'last_audit_date',
    'last_audit_by',
    'audit_request_date',
    'info_correction_pending',
  ]) {
    if (rawData[key] !== undefined) allowed[key] = rawData[key];
  }
  return sanitizeAndParsePayload(allowed);
}

function resolveDeptScopeNames(auth: any, globalMgmtDept?: string): string[] | null {
  const myUnit = auth.user?.unit;
  if (!myUnit?.unit_name) return [];
  const editScope = String(auth.permission?.editScope || auth.permission?.viewScope || 'OWN').toUpperCase();
  const units = auth.unitsList || [];
  if (editScope === 'TOTAL' || auth.permission?.isMaster || isLv1(auth.user)) {
    return null; // null = no dept filter (all)
  }

  const names = new Set<string>([myUnit.unit_name]);
  if (editScope === 'DEPT') {
    const children = getChildUnitNames(myUnit.unit_name, myUnit.id, units) || [];
    children.forEach((n: string) => names.add(n));
  }

  // FE DeptModule.buildDeptViewScope 와 동일: 총괄 부서(및 하위)면 최상위 Organization 자산 포함
  const mgmt = String(globalMgmtDept || '').trim();
  const topOrg = resolveTopOrgName(units);
  const own = String(myUnit.unit_name || '').trim();
  if (mgmt && topOrg && own) {
    const covers = (ancestorName: string, descendantName: string) => {
      if (ancestorName === descendantName) return true;
      let current = units.find((u: any) => u.unit_name === descendantName);
      while (current?.parent_id) {
        const parent = units.find((u: any) => u.id === current!.parent_id);
        if (!parent) break;
        if (parent.unit_name === ancestorName) return true;
        current = parent;
      }
      return false;
    };
    if (own === mgmt || covers(mgmt, own)) names.add(topOrg);
  }

  return Array.from(names);
}

async function assetsForEmail(email: string) {
  const raw = String(email || '').trim();
  const normalized = normalizeEmail(raw);
  const resolved =
    (await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, name: true, email: true },
    })) ||
    (await prisma.user.findFirst({
      where: { email: { equals: raw, mode: 'insensitive' } },
      select: { id: true, name: true, email: true },
    }));
  if (!resolved) return { user: null, assets: [] as any[] };
  const identity = toItIdentity(resolved);
  if (!identity) return { user: null, assets: [] as any[] };
  const assets = await prisma.iTAsset.findMany({
    where: { is_active: true, ...prismaAssetOwnerWhere(identity) },
    orderBy: { createdAt: 'desc' },
  });
  return { user: resolved, assets: assets.map(withItAssetScheduleFields) };
}

// 🚀 1. IT 자산 목록 조회 (GET)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const publicEmail = String(searchParams.get('email') || '').trim();

    // 공개 QR 실사: 이메일로 본인 자산만
    const session = await tryGetSessionUser();
    if (!session && publicEmail) {
      const { user, assets } = await assetsForEmail(publicEmail);
      if (!user) {
        return NextResponse.json({ message: '가입된 정보가 없습니다.' }, { status: 403 });
      }
      return NextResponse.json(assets);
    }

    const auth = await authorizeAnyMenuPaths([...IT_READ_PATHS]);
    const masterVisible = IT_MASTER_READ_PATHS.some((p) => hasMenuAccess(auth, p)) || isLv1(auth.user);

    let where: Prisma.ITAssetWhereInput = { is_active: true };

    if (masterVisible) {
      // 전사
    } else if (hasMenuAccess(auth, '/asset/it/dept')) {
      const config = await prisma.systemConfig.findUnique({
        where: { id: 'global' },
        select: { global_mgmt_dept: true },
      });
      const depts = resolveDeptScopeNames(auth, config?.global_mgmt_dept || '');
      if (depts === null) {
        // TOTAL
      } else if (depts.length === 0) {
        return NextResponse.json([]);
      } else {
        where = { ...where, dept: { in: depts } };
      }
    } else {
      // personal — email/userId 우선, 레거시 이름 폴백
      const identity = toItIdentity(auth.user);
      if (!identity) return NextResponse.json([]);
      where = { ...where, ...prismaAssetOwnerWhere(identity) };
    }

    const assets = await prisma.iTAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(assets.map(withItAssetScheduleFields));
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('IT Asset GET Error:', error);
    return NextResponse.json({ message: '데이터 로드 실패' }, { status: 500 });
  }
}

// 🚀 2. IT 자산 신규 등록 (POST) — 마스터 대시보드/아카이브 Edit
export async function POST(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths([...IT_MASTER_WRITE_PATHS], { requireEditor: true });
    void auth;

    const body = await req.json();
    const cleanData = await enrichOwnerIdentity(sanitizeAndParsePayload(body));

    const asset = await prisma.iTAsset.create({
      data: {
        ...cleanData,
        is_active: true,
      },
    });
    return NextResponse.json(withItAssetScheduleFields(asset));
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('IT Asset POST Error:', error);
    return NextResponse.json({ message: '자산 등록 실패' }, { status: 500 });
  }
}

// 🚀 3. IT 자산 수정 (PATCH)
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ message: 'ID 누락' }, { status: 400 });

    const publicEmail = String(body.publicAuditEmail || body.email || '').trim();
    const session = await tryGetSessionUser();

    // 공개 QR 실사: 본인 자산 + 실사 필드만
    if (!session && publicEmail) {
      const { user, assets } = await assetsForEmail(publicEmail);
      if (!user) return NextResponse.json({ message: '가입된 정보가 없습니다.' }, { status: 403 });
      const target = assets.find((a) => String(a.id) === String(id));
      if (!target) {
        return NextResponse.json({ message: '본인 자산만 실사할 수 있습니다.' }, { status: 403 });
      }
      const cleanData = sanitizePersonalSelfPatch(body);
      const updated = await prisma.iTAsset.update({ where: { id }, data: cleanData });
      return NextResponse.json(withItAssetScheduleFields(updated));
    }

    // 마스터 Edit → 전 필드
    try {
      await authorizeAnyMenuPaths([...IT_MASTER_WRITE_PATHS], { requireEditor: true });
      let cleanData = sanitizeAndParsePayload(body);
      if (
        cleanData.user !== undefined ||
        cleanData.user_email !== undefined ||
        cleanData.user_id !== undefined
      ) {
        cleanData = await enrichOwnerIdentity(cleanData);
      }
      const updated = await prisma.iTAsset.update({ where: { id }, data: cleanData });
      return NextResponse.json(withItAssetScheduleFields(updated));
    } catch (masterErr) {
      const msg = masterErr instanceof Error ? masterErr.message : '';
      if (!['FORBIDDEN', 'FORBIDDEN_EDIT', 'MENU_NOT_CONFIGURED'].includes(msg)) {
        throw masterErr;
      }
    }

    // 개인 Access → 본인 자산 + 실사/정보수정 필드만
    const personalAuth = await authorizeAnyMenuPaths([IT_PERSONAL_PATH]);
    const identity = toItIdentity(personalAuth.user);
    const existing = await prisma.iTAsset.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ message: '자산 없음' }, { status: 404 });
    if (!assetMatchesIdentity(existing, identity)) {
      return NextResponse.json({ message: '본인 자산만 수정할 수 있습니다.' }, { status: 403 });
    }
    const cleanData = sanitizePersonalSelfPatch(body);
    const updated = await prisma.iTAsset.update({ where: { id }, data: cleanData });
    return NextResponse.json(withItAssetScheduleFields(updated));
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('IT Asset PATCH Error:', error);
    return NextResponse.json({ message: '자산 수정 실패' }, { status: 500 });
  }
}

// 🚀 4. IT 자산 완전 삭제 (DELETE) — 마스터 Edit (허수·오등록 정리)
// 종료 이관은 /archive POST (트랜잭션). 아카이브 영구삭제는 archive DELETE + LV_1
export async function DELETE(req: Request) {
  try {
    await authorizeAnyMenuPaths([...IT_MASTER_WRITE_PATHS], { requireEditor: true });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ message: 'ID 누락' }, { status: 400 });

    await prisma.iTAsset.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('IT Asset DELETE Error:', error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}
