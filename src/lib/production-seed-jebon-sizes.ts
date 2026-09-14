/**
 * 제본 판형 시드 기본값 (seed-production-masters / 시드 항목 복구와 동일 기준).
 * - 복구 시: 없으면 생성, 비활성만 재활성. 기존 종류·규격·설명은 덮어쓰지 않음.
 */
export const SEED_JEBON_SIZE_DEFAULTS = [
  { code: 'A4', label: 'A4', size: '210 × 297mm', description: '표준 기본' },
  { code: 'B5', label: 'B5', size: '182 × 257mm', description: '' },
  { code: 'A5', label: 'A5', size: '148 × 210mm', description: '' },
  { code: 'B6', label: 'B6', size: '128 × 182mm', description: '' },
  { code: '16절', label: '16절', size: '197 × 272mm', description: '' },
  { code: '비규격', label: '비규격', size: '', description: '직접 입력' },
] as const;

export const SEED_JEBON_SIZE_CODES = SEED_JEBON_SIZE_DEFAULTS.map((r) => r.code);

export function isSeedJebonSizeCode(code: string): boolean {
  return (SEED_JEBON_SIZE_CODES as readonly string[]).includes(code);
}
