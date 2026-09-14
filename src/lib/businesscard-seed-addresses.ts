/**
 * 명함 전사 공통 주소/팩스 시드 기본값 (seed-businesscard-masters / 시드 항목 복구).
 * 키: label — 없으면 생성, 미사용(isActive=false)만 재활성. 기존 주소·팩스는 덮어쓰지 않음.
 */
export const SEED_COMPANY_ADDRESSES = [
  {
    label: '12F(경영)',
    zipCode: '04513',
    addressKo: '서울특별시 중구 세종대로 39 대한상공회의소빌딩 12층',
    addressEn: '12F, KCCI Buiding, Sejong-daero 39, Seoul, 04513 Korea',
    fax: '02-6973-9099',
    faxEn: '+82-2-6973-9099',
  },
  {
    label: '11F',
    zipCode: '04513',
    addressKo: '서울특별시 중구 세종대로 39 대한상공회의소빌딩 11층',
    addressEn: '11F, KCCI Buiding, Sejong-daero 39, Seoul, 04513 Korea',
    fax: '02-6973-9098',
    faxEn: '+82-2-6973-9098',
  },
  {
    label: '12F',
    zipCode: '04513',
    addressKo: '서울특별시 중구 세종대로 39 대한상공회의소빌딩 12층',
    addressEn: '12F, KCCI Buiding, Sejong-daero 39, Seoul, 04513 Korea',
    fax: '02-6973-9097',
    faxEn: '+82-2-6973-9097',
  },
] as const;

export function isSeedCompanyAddressLabel(label: string): boolean {
  return SEED_COMPANY_ADDRESSES.some((a) => a.label === label);
}
