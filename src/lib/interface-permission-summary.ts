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

function collectEmails(rows: any[]): string[] {
  return [
    ...new Set(
      rows
        .map((r) => String(r?.email || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/** Task Access / Task Editor 명단 → 이름 나열 (없으면 email, 없으면 미지정) */
function designateNamesLabel(
  rows: any[],
  emailToName: Map<string, string>
): string {
  if (rows.length === 0) return '미지정';
  const names = rows.map((r) => {
    const email = String(r?.email || '').trim();
    const key = email.toLowerCase();
    return emailToName.get(key) || email || '?';
  });
  return names.join(', ');
}

/**
 * 사용자 화면 배너용 Access/Edit 요약 (LV_1 전용 표시).
 * Master·Task Access·Task Editor는 지정자 이름을 노출. Scope는 admin/interface에서만 확인.
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
  const designateEmails = [
    ...collectEmails(taskAccesses),
    ...collectEmails(taskMasters),
  ];

  const [orgUnits, masterUser, designateUsers] = await Promise.all([
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
    designateEmails.length > 0
      ? prisma.user.findMany({
          where: {
            OR: designateEmails.map((email) => ({
              email: { equals: email, mode: 'insensitive' as const },
            })),
          },
          select: { email: true, name: true },
        })
      : Promise.resolve([] as { email: string; name: string }[]),
  ]);

  const emailToName = new Map(
    designateUsers.map((u) => [String(u.email || '').trim().toLowerCase(), u.name || u.email])
  );

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
    accessDesignate: designateNamesLabel(taskAccesses, emailToName),
    accessOrg,
    accessLevel: viewRoles.length > 0 ? viewRoles.join(', ') : '제한',
    editDesignate: designateNamesLabel(taskMasters, emailToName),
    editLevel: editRoles.length > 0 ? editRoles.join(', ') : '제한',
  };
}
