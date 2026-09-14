/**
 * 제작 인증 시드 기본값 (seed-production-masters / 시드 항목 복구와 동일 기준).
 * - 복구 시: 없으면 생성, 비활성만 재활성. 기존 명칭·서식·등급·연동판형 등은 덮어쓰지 않음.
 */

const JEBON_FORM_DEFAULTS = {
  jebonDefaultSizeType: 'A4',
  jebonDefaultQuantity: 1,
  useJebonCover: true,
  useJebonCoverDate: true,
  jebonCoverColor: '컬러',
  jebonCoverPageCount: '1',
  jebonInnerColor: '흑백',
} as const;

export const SEED_SIGN_CERT_DEFAULTS = [
  {
    certId: 'GSEED',
    type: 'SIGN' as const,
    label: '녹색건축인증',
    format: '(0000. 00. 00. ~ 0000. 00. 00.)',
    jebonFormat: '',
    grades: ['최우수 (그린1등급)', '우수 (그린2등급)', '우량 (그린3등급)', '일반 (그린4등급)'],
    useCertNumber: false,
    useValidPeriod: true,
    useMultiGradeSelect: false,
  },
  {
    certId: 'BF',
    type: 'SIGN' as const,
    label: 'BF 인증',
    format: '(0000. 00. 00 ~ 0000. 00. 00)',
    jebonFormat: '',
    grades: ['최우수', '우수', '일반'],
    useCertNumber: false,
    useValidPeriod: true,
    useMultiGradeSelect: false,
  },
  {
    certId: 'EDUCATIONAL',
    type: 'SIGN' as const,
    label: '교육시설안전인증',
    format: '0000.00.00.~0000.00.00.',
    jebonFormat: '',
    grades: ['최우수', '우수'],
    useCertNumber: true,
    useValidPeriod: true,
    useMultiGradeSelect: false,
  },
  {
    certId: 'ENERGY',
    type: 'SIGN' as const,
    label: '건축물에너지효율등급인증',
    format: '0000. 00. 00 ~ 0000. 00. 00',
    jebonFormat: '',
    grades: ['1+++', '1++', '1+', '1등급', '2등급', '3등급', '4등급', '5등급', '6등급', '7등급'],
    useCertNumber: true,
    useValidPeriod: true,
    useMultiGradeSelect: false,
  },
  {
    certId: 'ZEB',
    type: 'SIGN' as const,
    label: '제로에너지건축물인증',
    format: '0000. 00. 00 ~ 0000. 00. 00',
    jebonFormat: '',
    grades: ['ZEB 5', 'ZEB 4', 'ZEB 3', 'ZEB 2', 'ZEB 1', 'ZEB +'],
    useCertNumber: true,
    useValidPeriod: true,
    useMultiGradeSelect: false,
  },
  {
    certId: 'ISO',
    type: 'SIGN' as const,
    label: 'ISO 인증',
    format: '',
    jebonFormat: '',
    grades: [
      'KS Q ISO 9001 (품질경영시스템)',
      'KS I ISO 14001 (환경경영시스템)',
      'KS Q ISO 45001 (안전보건경영시스템)',
      'IATF 16949',
      'KS Q ISO 22000 (식품안전경영시스템)',
      'TL 9000',
      'KS A ISO 50001 (에너지경영시스템)',
      'KS A ISO 22301 (비즈니스연속성경영시스템)',
      'KS A ISO 37001 (부패방지경영시스템)',
      'KS A ISO 37301 (준법경영시스템)',
      'KS X ISO/IEC 27001 (정보보안경영시스템)',
      'KS S ISO 21001 (교육기관경영시스템)',
      'KS Q ISO 10002 (고객만족경영시스템)',
      'KS X ISO/IEC 42001 (인공지능경영시스템)',
    ],
    useCertNumber: true,
    useValidPeriod: false,
    useMultiGradeSelect: true,
  },
] as const;

export const SEED_JEBON_CERT_DEFAULTS = [
  {
    certId: 'NORMAL',
    type: 'JEBON' as const,
    label: '일반제본',
    format: '',
    jebonFormat: '0000. 0. 0.',
    grades: [] as string[],
    useCertNumber: true,
    useValidPeriod: true,
    useMultiGradeSelect: false,
    ...JEBON_FORM_DEFAULTS,
  },
  {
    certId: 'GSEED_JEBON',
    type: 'JEBON' as const,
    label: '녹색건축인증 평가서',
    format: '',
    jebonFormat: '0000. 0. 0.',
    grades: ['기본 등급'],
    useCertNumber: true,
    useValidPeriod: true,
    useMultiGradeSelect: false,
    ...JEBON_FORM_DEFAULTS,
  },
  {
    certId: 'CONDENDSATION',
    type: 'JEBON' as const,
    label: '결로방지 성능평가 결과 보고서',
    format: '',
    jebonFormat: '0000. 0. 0.',
    grades: [] as string[],
    useCertNumber: true,
    useValidPeriod: true,
    useMultiGradeSelect: false,
    ...JEBON_FORM_DEFAULTS,
  },
  {
    certId: 'ENERGY_JEBON',
    type: 'JEBON' as const,
    label: '건축물에너지효율등급인증 평가서',
    format: '',
    jebonFormat: '0000. 0. 0',
    grades: ['기본 등급'],
    useCertNumber: true,
    useValidPeriod: true,
    useMultiGradeSelect: false,
    ...JEBON_FORM_DEFAULTS,
  },
  {
    certId: 'ZEB_JEBON',
    type: 'JEBON' as const,
    label: '제로에너지건축물인증 평가서',
    format: '',
    jebonFormat: '0000. 0. 0.',
    grades: ['기본 등급'],
    useCertNumber: true,
    useValidPeriod: true,
    useMultiGradeSelect: false,
    ...JEBON_FORM_DEFAULTS,
  },
] as const;

export const SEED_CERT_DEFAULTS = [
  ...SEED_SIGN_CERT_DEFAULTS,
  ...SEED_JEBON_CERT_DEFAULTS,
] as const;

export const SEED_CERT_IDS = SEED_CERT_DEFAULTS.map((c) => c.certId);

export function isSeedCertId(certId: string): boolean {
  return (SEED_CERT_IDS as readonly string[]).includes(certId);
}

export function getSeedCertDefaultsForType(type: 'SIGN' | 'JEBON') {
  return type === 'SIGN' ? SEED_SIGN_CERT_DEFAULTS : SEED_JEBON_CERT_DEFAULTS;
}
