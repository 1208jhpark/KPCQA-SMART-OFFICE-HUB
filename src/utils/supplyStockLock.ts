/** 소모품 현재고 직접수정 잠금 — 최초 게시 이후(또는 입고·신청 이력 시작 후) */

export function parseSupplyItemExt(description: unknown): Record<string, any> {
  if (!description) return {};
  if (typeof description === 'object' && !Array.isArray(description)) {
    return description as Record<string, any>;
  }
  try {
    const parsed = JSON.parse(String(description));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * true면 수정 모달에서 현재고 직접 입력 불가 (LV_1 강제보정 제외).
 * - stock_locked: 한 번이라도 게시 올리면 영구
 * - 현재 게시 중: 레거시(플래그 없는 기존 게시 품목)
 * - 입고·신청 이력이 있으면 재고 흐름이 시작된 것으로 보고 잠금
 */
export function isSupplyDirectStockLocked(item: {
  is_published?: boolean | null;
  description?: unknown;
  _count?: { purchases?: number; requests?: number } | null;
}): boolean {
  const ext = parseSupplyItemExt(item.description);
  if (ext.stock_locked === true) return true;
  if (item.is_published === true) return true;
  const purchases = Number(item._count?.purchases || 0);
  const requests = Number(item._count?.requests || 0);
  if (purchases > 0 || requests > 0) return true;
  return false;
}

/** 게시 올릴 때 description에 stock_locked 반영 */
export function withSupplyStockLocked(description: unknown): string {
  const ext = parseSupplyItemExt(description);
  return JSON.stringify({ ...ext, stock_locked: true });
}
