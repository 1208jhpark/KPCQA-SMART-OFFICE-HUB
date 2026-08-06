import { checkMenuPermission } from '@/lib/permission-utils';

/**
 * Step1·2 즉시실행 / Step3 단일화면:
 * admin 토글만으로 하위 1번 path를 찾아 바로 이동 (경로 하드코딩 불필요)
 */
export function resolveEntryHref(
  menu: any,
  allMenus: any[],
  user: any,
  unitsList: any[],
  depth = 0
): string {
  if (!menu?.path) return '#';
  if (depth > 5) return menu.path;

  const kids = allMenus
    .filter((m: any) => m.parent_id === menu.id && m.is_active && m.is_visible !== false)
    .filter((m: any) => checkMenuPermission(user, m, allMenus, unitsList).hasAccess)
    .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

  const first = kids[0];
  if (!first) return menu.path;

  if ((menu.level === 1 || menu.level === 2) && menu.l2_entry_mode === 'L3_DEFAULT') {
    return resolveEntryHref(first, allMenus, user, unitsList, depth + 1);
  }

  const isDirect =
    menu.level === 3 &&
    (menu.entry_l4_direct === true ||
      String(menu.entry_l4_direct).toLowerCase() === 'true' ||
      menu.entry_l4_direct === 1);
  if (isDirect) {
    return resolveEntryHref(first, allMenus, user, unitsList, depth + 1);
  }

  return menu.path;
}
