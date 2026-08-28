import prisma from '@/lib/prisma';
import { getKSTDateString } from '@/utils/dateUtils';
import { normalizeOrgUnitCode } from '@/lib/org-unit-code';

/** DB category → 관리번호 중간 세그먼트 (대문자·짧은 영문) */
export const PRODUCTION_POST_CATEGORY_CODES: Record<string, string> = {
  SIGN: 'SIGN', // 현판/명판/상패
  JEBON: 'BIND', // 제본 (Binding)
  PRINT: 'PRT', // 기타 제작물 (Print / custom production)
  OFFICE_SUPPLIES: 'SUP', // 사무문구류 (Supplies)
};

export function resolveProductionPostCategoryCode(category: string): string {
  const key = String(category || '').trim().toUpperCase();
  return PRODUCTION_POST_CATEGORY_CODES[key] || 'MISC';
}

/** KST 오늘 기준 YYMMDD (앞 20년도 축약) */
export function productionPostDateSegment(dateInput?: Date | string): string {
  const ymd = (dateInput ? getKSTDateString(dateInput) : getKSTDateString()).replace(/-/g, '');
  return ymd.length === 8 ? ymd.slice(2) : ymd;
}

export function resolveProductionDeptCode(unitCode: string | null | undefined): string {
  const normalized = normalizeOrgUnitCode(unitCode);
  return normalized || 'ORG';
}

/**
 * 예: P-SUP-PMD-260825-001
 * P=제작물 · 품목 · 조직코드(unit_code) · YYMMDD · 일련
 * - 카테고리·부서·일자별 독립 일련번호
 */
export async function nextProductionPostNumber(
  category: string,
  unitCode: string | null | undefined
): Promise<string> {
  const catCode = resolveProductionPostCategoryCode(category);
  const deptCode = resolveProductionDeptCode(unitCode);
  const dateSeg = productionPostDateSegment();
  const prefix = `P-${catCode}-${deptCode}-${dateSeg}-`;

  const rows = await prisma.productionRequest.findMany({
    where: { postNumber: { startsWith: prefix } },
    select: { postNumber: true },
  });

  let maxSeq = 0;
  for (const row of rows) {
    const tail = String(row.postNumber || '').slice(prefix.length);
    const n = parseInt(tail, 10);
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }

  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}
