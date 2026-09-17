export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeAdminApi,
  requireSessionUser,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

const PATCH_ALLOWED = new Set([
  'level',
  'name',
  'path',
  'description',
  'icon',
  'sort_order',
  'is_active',
  'is_visible',
  'parent_id',
  'view_scopes',
  'org_ids',
  'edit_role_ids',
  'edit_scopes',
  'task_masters',
  'view_role_ids',
  'task_accesses',
  'is_master',
  'master_editor_id',
  'entry_sidebar',
  'entry_index_view',
  'entry_l4_direct',
  'l2_entry_mode',
  'show_header',
  'page_title',
  'show_page_title',
  'page_description',
  'show_page_desc',
]);

function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

async function resolveDefaultOrgIds(parentId: string | null): Promise<string[]> {
  if (parentId) {
    const parent = await prisma.interfaceConfig.findUnique({
      where: { id: parentId },
      select: { org_ids: true },
    });
    const fromParent = Array.isArray(parent?.org_ids)
      ? (parent!.org_ids as unknown[]).map(String).filter(Boolean)
      : [];
    if (fromParent.length > 0) return fromParent;
  }

  const rootOrg = await prisma.orgUnit.findFirst({
    where: {
      is_deleted: false,
      is_active: true,
      OR: [{ unit_type: 'ORGANIZATION' }, { parent_id: null }],
    },
    orderBy: { sort_order: 'asc' },
    select: { id: true },
  });
  return rootOrg ? [rootOrg.id] : [];
}

/** 상위 메뉴를 따라 올라가며 첫 비어 있지 않은 org_ids (UI getEffectiveAllowedOrgs와 동일) */
async function getAncestorMenuOrgGuard(startParentId: string | null): Promise<string[]> {
  let parentId = startParentId;
  while (parentId) {
    const parent = await prisma.interfaceConfig.findUnique({
      where: { id: parentId },
      select: { parent_id: true, org_ids: true },
    });
    if (!parent) break;
    const ids = Array.isArray(parent.org_ids)
      ? (parent.org_ids as unknown[]).map(String).filter(Boolean)
      : [];
    if (ids.length > 0) return ids;
    parentId = parent.parent_id;
  }
  return [];
}

/** 선택 조직이 허용 집합(본인 또는 그 하위)에 속하는지 — UI isOrgAllowedByParent와 동일 */
function isOrgUnderAllowedSet(
  orgId: string,
  allowedIds: string[],
  parentById: Map<string, string | null>
): boolean {
  if (allowedIds.length === 0) return true;
  let currentId: string | null = orgId;
  const seen = new Set<string>();
  while (currentId) {
    if (allowedIds.includes(currentId)) return true;
    if (seen.has(currentId)) break;
    seen.add(currentId);
    currentId = parentById.has(currentId) ? parentById.get(currentId)! : null;
  }
  return false;
}

async function assertOrgIdsWithinParentGuard(
  menuParentId: string | null,
  orgIds: string[]
) {
  const allowed = await getAncestorMenuOrgGuard(menuParentId);
  if (allowed.length === 0) return; // 상위 Org Guard 없으면 제한 없음

  const units = await prisma.orgUnit.findMany({
    where: { is_deleted: false },
    select: { id: true, parent_id: true, unit_name: true },
  });
  const parentById = new Map(units.map((u) => [u.id, u.parent_id]));
  const nameById = new Map(units.map((u) => [u.id, u.unit_name]));

  const invalid = orgIds.filter((id) => !isOrgUnderAllowedSet(id, allowed, parentById));
  if (invalid.length > 0) {
    const labels = invalid.map((id) => nameById.get(id) || id).join(', ');
    throw Object.assign(
      new Error(`상위 메뉴 Org Guard 범위를 벗어난 조직입니다: ${labels}`),
      { code: 'ORG_GUARD_PARENT' }
    );
  }
}

// [GET] 메뉴 목록 — 로그인 필수 (서비스 전 페이지 공용, LV_1 잠금 금지)
export async function GET() {
  try {
    await requireSessionUser();
    const interfaces = await prisma.interfaceConfig.findMany({
      orderBy: { sort_order: 'asc' },
    });
    return NextResponse.json(interfaces, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    return NextResponse.json({ message: '로드 실패' }, { status: 500 });
  }
}

// [POST] 신규 메뉴 등록 — LV_1만
export async function POST(req: Request) {
  try {
    await authorizeAdminApi();
    const body = await req.json();

    if (!body.path) return badRequest('경로(path) 누락');

    const path = String(body.path).trim();
    if (!path) return badRequest('경로(path) 누락');

    const exists = await prisma.interfaceConfig.findUnique({ where: { path } });
    if (exists) return badRequest('중복된 경로가 존재합니다.');

    const parent_id = body.parent_id ? String(body.parent_id) : null;
    const org_ids =
      Array.isArray(body.org_ids) && body.org_ids.filter(Boolean).length > 0
        ? body.org_ids.filter(Boolean).map(String)
        : await resolveDefaultOrgIds(parent_id);

    await assertOrgIdsWithinParentGuard(parent_id, org_ids);

    const view_role_ids =
      Array.isArray(body.view_role_ids) && body.view_role_ids.length > 0
        ? body.view_role_ids.map(String)
        : ['LV_1', 'LV_2', 'LV_3'];

    const view_scopes =
      Array.isArray(body.view_scopes) && body.view_scopes.length > 0
        ? body.view_scopes
        : ['OWN'];

    const newMenu = await prisma.interfaceConfig.create({
      data: {
        level: Number(body.level) || 1,
        name: String(body.name || '신규 메뉴').trim() || '신규 메뉴',
        path,
        icon: body.icon != null ? String(body.icon) : '',
        sort_order: Number(body.sort_order) || 0,
        parent_id,
        org_ids,
        view_role_ids,
        view_scopes,
        entry_sidebar: body.entry_sidebar !== undefined ? Boolean(body.entry_sidebar) : true,
        is_active: true,
        is_visible: true,
      },
    });
    return NextResponse.json(newMenu);
  } catch (error: any) {
    if (error?.code === 'ORG_GUARD_PARENT' || /Org Guard/.test(String(error?.message || ''))) {
      return badRequest(error.message);
    }
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error('[메뉴 생성]', error?.message || error);
    return NextResponse.json({ message: '등록 실패', error: error?.message }, { status: 500 });
  }
}

// [PATCH] 정보 수정 — LV_1만
export async function PATCH(req: Request) {
  try {
    await authorizeAdminApi();
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return badRequest('메뉴 ID가 필요합니다.');

    const updateData: Record<string, unknown> = {};
    for (const key of PATCH_ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        updateData[key] = body[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return badRequest('수정할 항목이 없습니다.');
    }

    if ('path' in updateData) {
      const path = String(updateData.path || '').trim();
      if (!path) return badRequest('경로(path)가 비어 있습니다.');
      const clash = await prisma.interfaceConfig.findFirst({
        where: { path, id: { not: id } },
        select: { id: true, name: true },
      });
      if (clash) {
        return badRequest(`중복된 경로입니다. (${clash.name})`);
      }
      updateData.path = path;
    }

    if ('org_ids' in updateData) {
      const orgIds = Array.isArray(updateData.org_ids)
        ? (updateData.org_ids as unknown[]).filter(Boolean).map(String)
        : [];
      if (orgIds.length === 0) {
        return badRequest('Org Guard는 최소 1개 부서를 지정해야 합니다.');
      }
      updateData.org_ids = orgIds;
    }

    // Task Access / Task Editor: email만 유지 (개인 scope 폐기)
    if ('task_accesses' in updateData && Array.isArray(updateData.task_accesses)) {
      updateData.task_accesses = (updateData.task_accesses as any[])
        .map((ta) => ({ email: String(ta?.email || '').trim() }))
        .filter((ta) => ta.email);
    }
    if ('task_masters' in updateData && Array.isArray(updateData.task_masters)) {
      updateData.task_masters = (updateData.task_masters as any[])
        .map((tm) => ({ email: String(tm?.email || '').trim() }))
        .filter((tm) => tm.email);
    }

    // 상위 Org Guard 범위 검증 (UI와 동일 규칙)
    if ('org_ids' in updateData || 'parent_id' in updateData) {
      const existing = await prisma.interfaceConfig.findUnique({
        where: { id },
        select: { parent_id: true, org_ids: true },
      });
      if (!existing) {
        return NextResponse.json({ message: '메뉴를 찾을 수 없습니다.' }, { status: 404 });
      }

      const nextParentId =
        'parent_id' in updateData
          ? (updateData.parent_id as string | null)
          : existing.parent_id;

      const nextOrgIds =
        'org_ids' in updateData
          ? (updateData.org_ids as string[])
          : Array.isArray(existing.org_ids)
            ? (existing.org_ids as unknown[]).map(String).filter(Boolean)
            : [];

      if (nextOrgIds.length > 0) {
        await assertOrgIdsWithinParentGuard(nextParentId, nextOrgIds);
      }
    }

    if ('view_scopes' in updateData) {
      const raw = Array.isArray(updateData.view_scopes) ? updateData.view_scopes : [];
      const coded = raw.map(String).includes('CODED');
      const scopes = raw.filter((s: any) =>
        ['OWN', 'DEPT', 'TOTAL'].includes(String(s).toUpperCase())
      );
      if (!coded && scopes.length === 0) {
        return badRequest(
          'View Scope는 본인/부서/전사 중 최소 1개를 지정해야 합니다. (코드화 시 제외)'
        );
      }
      updateData.view_scopes = coded ? ['CODED', ...scopes] : scopes;
    }

    if ('parent_id' in updateData && updateData.parent_id === '') {
      updateData.parent_id = null;
    }
    if ('master_editor_id' in updateData && updateData.master_editor_id === '') {
      updateData.master_editor_id = null;
    }

    const updated = await prisma.interfaceConfig.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    if (error?.code === 'ORG_GUARD_PARENT' || /Org Guard/.test(String(error?.message || ''))) {
      return badRequest(error.message);
    }
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    if (error?.code === 'P2002') {
      return badRequest('중복된 경로가 존재합니다.');
    }
    console.error('[메뉴 수정]', error?.message || error);
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 메뉴 삭제 — LV_1만
export async function DELETE(req: Request) {
  try {
    await authorizeAdminApi();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return badRequest('ID가 필요합니다.');

    const childCount = await prisma.interfaceConfig.count({ where: { parent_id: id } });
    if (childCount > 0) {
      return badRequest('하위 메뉴가 존재하여 삭제할 수 없습니다.');
    }

    await prisma.interfaceConfig.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 성공' });
  } catch (error: any) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error('[메뉴 삭제]', error?.message || error);
    return NextResponse.json({ message: '서버 에러' }, { status: 500 });
  }
}
