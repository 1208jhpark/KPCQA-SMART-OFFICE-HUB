/**
 * Signage 시드 판형 기본값 (seed-production-masters / 시드 항목 복구와 동일 기준).
 * - 복구 시: 없으면 생성, 비활성만 재활성. 기존 단가·명칭·규격은 덮어쓰지 않음.
 */
export const SEED_PLATE_DEFAULTS = [
  { code: 'TUNGSTEN_300', label: '텅스텐현판', price: 135000, size: '300*400' },
  { code: 'CAST_IRON_300', label: '주물현판', price: 230000, size: '300*400' },
  { code: 'STAINLESS_300', label: '스텐현판', price: 120000, size: '300*400' },
  { code: 'STAINLESS_90', label: '스텐현판', price: 120000, size: '90*55' },
  { code: 'BRASS_300', label: '신주현판', price: 160000, size: '300*400' },
  {
    code: 'STAINLESS_450_A',
    label: 'ISO 실외 스텐현판_기업명표기',
    price: 120000,
    size: '450*300',
  },
  {
    code: 'STAINLESS_450_IMS',
    label: 'ISO 실외 스텐현판_통합경영',
    price: 120000,
    size: '450*300',
  },
  {
    code: 'STAINLESS_450_B',
    label: 'ISO 실외 스텐현판_기업명 미표기',
    price: 120000,
    size: '450*300',
  },
  { code: 'WOOD_240', label: 'ISO 실내 메탈목재상패', price: 160000, size: '240*300' },
  { code: 'SILVER_220', label: 'ISO 실내 원형 은쟁반패', price: 160000, size: '220*220' },
  { code: 'SILVER_260', label: 'ISO 실내 팔각형 은쟁반패', price: 160000, size: '260*260' },
] as const;

export const SEED_PLATE_CODES = SEED_PLATE_DEFAULTS.map((p) => p.code);

export function isSeedPlateCode(code: string): boolean {
  return (SEED_PLATE_CODES as readonly string[]).includes(code);
}
