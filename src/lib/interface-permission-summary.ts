import prisma from '@/lib/prisma';
import { getEffectiveAllowedOrgs } from '@/lib/permission-utils';

function asJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeMenuPath(path: string) {
  return String(path || '').replace(/\/$/, '').toLowerCase();
}

function designateCountLabel(count: number) {
  return count > 0 ? `지정 ${count}명` : '미지정';
}

/**
 * 사용자 화면 배너용 Access/Edit 요약.
 * 지정 인원 명수만 노출. Scope는 admin/interface에서만 확인.
 */
export async function buildInterfacePermissionSummary(menuPath?: string | null) {
  const path = normalizeMenuPath(menuPath || '');
  if (!path) return null;

  const [menu, allMenus] = await Promise.all([
    prisma.interfaceConfig.findFirst({
      where: { path: { equals: path, mode: 'insensitive' } },
    }),
    prisma.interfaceConfig.findMany(),
  ]);
  if (!menu) return null;

  const taskAccesses = asJsonArray(menu.task_accesses);
  const taskMasters = asJsonArray(menu.task_masters);

  const [orgUnits, masterUser] = await Promise.all([
    prisma.orgUnit.findMany({
      where: { is_deleted: false },
      select: { id: true, unit_name: true },
    }),
    menu.master_editor_id
      ? prisma.user.findUnique({
          where: { id: menu.master_editor_id },
          select: { name: true },
        })
      : Promise.resolve(null),
  ]);

  const ownOrgIds = asJsonArray(menu.org_ids).map(String).filter(Boolean);
  const effectiveOrgIds = (
    ownOrgIds.length > 0 ? ownOrgIds : getEffectiveAllowedOrgs(menu, allMenus).map(String)
  );
  const orgNames = effectiveOrgIds
    .map((id) => orgUnits.find((o) => o.id === id)?.unit_name)
    .filter(Boolean) as string[];
  const accessOrg =
    orgNames.length > 0
      ? ownOrgIds.length === 0
        ? `${orgNames.join(', ')} (상위상속·미지정)`
        : orgNames.join(', ')
      : '미지정(필수)';
  const viewRoles = asJsonArray(menu.view_role_ids).map(String);
  const editRoles = asJsonArray(menu.edit_role_ids).map(String);

  return {
    masterName: masterUser?.name || '미지정',
    accessDesignate: designateCountLabel(taskAccesses.length),
    accessOrg,
    accessLevel: viewRoles.length > 0 ? viewRoles.join(', ') : '제한',
    editDesignate: designateCountLabel(taskMasters.length),
    editLevel: editRoles.length > 0 ? editRoles.join(', ') : '제한',
  };
}
