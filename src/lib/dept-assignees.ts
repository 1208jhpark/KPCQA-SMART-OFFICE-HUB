import prisma from '@/lib/prisma';
import { checkMenuPermission } from '@/lib/permission-utils';

function sortPersonNames(names: string[]) {
  return [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ko')
  );
}

function normalizeMenuPath(path: string) {
  return String(path || '').replace(/\/$/, '').toLowerCase();
}

/**
 * 로그인 사용자 부서 소속 Active 인원 중 해당 메뉴 Edit 가능자
 */
export async function listDeptAssignees(options: {
  menuPath: string;
  unitId: string;
  allMenus: any[];
  unitsList: any[];
}): Promise<{ editorNames: string[] }> {
  const empty = { editorNames: [] as string[] };
  const unitId = String(options.unitId || '').trim();
  const menuPath = String(options.menuPath || '').trim();
  if (!unitId || !menuPath) return empty;

  const allMenus = Array.isArray(options.allMenus) ? options.allMenus : [];
  const menu = allMenus.find((m: any) => normalizeMenuPath(m?.path) === normalizeMenuPath(menuPath));
  if (!menu) return empty;

  const users = await prisma.user.findMany({
    where: { unit_id: unitId, status: 'Active' },
    select: { id: true, email: true, name: true, roles: true, unit_id: true },
  });

  return {
    editorNames: sortPersonNames(
      users
        .filter((u) => checkMenuPermission(u, menu, allMenus, options.unitsList || []).isEditor)
        .map((u) => String(u.name || ''))
    ),
  };
}
