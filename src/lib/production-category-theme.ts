/** 제작물 분류 — 토글·테이블 배지·서류철 탭 공통 색상 (apply/history · dept · form 동기화) */
export const PRODUCTION_CATEGORY_THEME = {
  ALL: {
    badge: 'bg-slate-700 text-white border-slate-600',
    toggleActive:
      'bg-slate-900 text-white shadow-lg shadow-slate-900/20 scale-[1.02] border-transparent',
    toggleIdle: 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200',
    folderActive: 'bg-slate-900 text-white border-slate-900 border-b-white z-10 -mb-px',
    folderIdle:
      'bg-slate-100 text-slate-600 border-slate-300 border-b-transparent hover:bg-slate-200/80 hover:text-slate-800',
  },
  SIGN: {
    badge: 'bg-rose-600 text-white border-rose-500',
    toggleActive:
      'bg-rose-600 text-white shadow-lg shadow-rose-600/25 scale-[1.02] border-transparent',
    toggleIdle: 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-200',
    folderActive: 'bg-rose-600 text-white border-rose-500 border-b-white z-10 -mb-px',
    folderIdle:
      'bg-rose-50 text-rose-700 border-rose-200 border-b-transparent hover:bg-rose-100',
  },
  JEBON: {
    badge: 'bg-blue-600 text-white border-blue-500',
    toggleActive:
      'bg-blue-600 text-white shadow-lg shadow-blue-600/25 scale-[1.02] border-transparent',
    toggleIdle: 'bg-white text-blue-700 hover:bg-blue-50 border border-blue-200',
    folderActive: 'bg-blue-600 text-white border-blue-500 border-b-white z-10 -mb-px',
    folderIdle:
      'bg-blue-50 text-blue-700 border-blue-200 border-b-transparent hover:bg-blue-100',
  },
  PRINT: {
    badge: 'bg-amber-500 text-white border-amber-400',
    toggleActive:
      'bg-amber-500 text-white shadow-lg shadow-amber-500/25 scale-[1.02] border-transparent',
    toggleIdle: 'bg-white text-amber-800 hover:bg-amber-50 border border-amber-200',
    folderActive: 'bg-amber-500 text-white border-amber-400 border-b-white z-10 -mb-px',
    folderIdle:
      'bg-amber-50 text-amber-800 border-amber-200 border-b-transparent hover:bg-amber-100',
  },
  OFFICE_SUPPLIES: {
    badge: 'bg-emerald-600 text-white border-emerald-500',
    toggleActive:
      'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 scale-[1.02] border-transparent',
    toggleIdle: 'bg-white text-emerald-800 hover:bg-emerald-50 border border-emerald-200',
    folderActive: 'bg-emerald-600 text-white border-emerald-500 border-b-white z-10 -mb-px',
    folderIdle:
      'bg-emerald-50 text-emerald-800 border-emerald-200 border-b-transparent hover:bg-emerald-100',
  },
} as const;

export type ProductionCategoryThemeKey = keyof typeof PRODUCTION_CATEGORY_THEME;

export function getProductionCategoryBadgeClass(categoryId: string): string {
  const key = categoryId as ProductionCategoryThemeKey;
  return (
    PRODUCTION_CATEGORY_THEME[key]?.badge ??
    'bg-slate-700 text-white border-slate-600'
  );
}

export function getProductionCategoryToggleClasses(
  categoryId: string,
  isActive: boolean
): string {
  const key = categoryId as ProductionCategoryThemeKey;
  const theme = PRODUCTION_CATEGORY_THEME[key] ?? PRODUCTION_CATEGORY_THEME.ALL;
  return isActive ? theme.toggleActive : theme.toggleIdle;
}

/** 서류철(엑셀 시트) 탭 — 분류 배지·토글과 동일 색상 */
export function getProductionCategoryFolderTabClasses(
  categoryId: string,
  isActive: boolean
): string {
  const key = categoryId as ProductionCategoryThemeKey;
  const theme = PRODUCTION_CATEGORY_THEME[key] ?? PRODUCTION_CATEGORY_THEME.ALL;
  return isActive ? theme.folderActive : theme.folderIdle;
}
