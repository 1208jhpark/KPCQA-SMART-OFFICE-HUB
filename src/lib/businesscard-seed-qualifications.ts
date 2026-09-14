/**
 * 명함 자격사항 시드 기본값 (seed-businesscard-masters / 시드 항목 복구).
 * 키: nameKo — 없으면 생성, 미사용(isActive=false)만 재활성. 기존 영문명은 덮어쓰지 않음.
 */
export const SEED_BUSINESS_CARD_QUALIFICATIONS = [
  { nameKo: '공학박사', nameEn: 'Ph.D.' },
  { nameKo: '건축사', nameEn: 'Architect' },
  { nameKo: '건축물에너지평가사', nameEn: 'Building Energy Assessor' },
  {
    nameKo: '건축물에너지효율등급 심사위원',
    nameEn: 'Building Energy Efficiency Rating Auditor',
  },
  { nameKo: '건축기계설비기술사', nameEn: 'Professional Engineer' },
  { nameKo: '에너지진단사', nameEn: 'Energy Management Engineer' },
  { nameKo: '건축시공기술사', nameEn: 'P.E.' },
  { nameKo: '벤처공학박사', nameEn: 'Doctor of Venture Engineering' },
  { nameKo: '재난관리지도사', nameEn: 'Business Continuity Master' },
  { nameKo: '인증심사원', nameEn: 'Auditor' },
  { nameKo: '품질경영기술사', nameEn: 'Quality Management System P.E.' },
  { nameKo: '기술지도사', nameEn: 'Technology Expert Advisor' },
  { nameKo: '환경관리기술사', nameEn: 'Environment Engineer' },
  { nameKo: '이학박사', nameEn: 'Ph.D.' },
  {
    nameKo: '국제통용발자국검증심사원',
    nameEn: 'Cerified Carbon Footprints of Product Verification Professional',
  },
  {
    nameKo: '공조냉동기계기술사',
    nameEn: 'Professional Engineer Air-conditioning Refrigerating Machinery',
  },
  { nameKo: 'AA1000 ACSAP 검증심사원', nameEn: 'AA1000 ACSAP Auditor' },
] as const;

export function isSeedBusinessCardQualificationNameKo(nameKo: string): boolean {
  return SEED_BUSINESS_CARD_QUALIFICATIONS.some((q) => q.nameKo === nameKo);
}
