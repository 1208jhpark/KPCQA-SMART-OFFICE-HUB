import type { PrismaClient } from '@prisma/client';
import { parseKSTDateOnly } from '@/utils/dateUtils';

/**
 * 장비 시드 (범주별)
 * - performance: 기계설비성능점검 (EQ-MEC-*)
 * - safety: 안전 장비 (EQ-SAF-*)
 * - airtightness: 창호·기밀성능측정 (EQ-ENV-*)
 * 키: asset_no — fill 시 없으면 생성, sync 시 시드값으로 upsert
 *
 * 날짜 규칙(엑셀 수집값):
 * - 연도만(2014) → YYYY-01-01
 * - 연·월(2019.1 / 2024.01 / 2016.10) → YYYY-MM-01
 * - 연·월·일(2026.09.04) → YYYY-MM-DD
 */
export type SeedEquipmentRow = {
  asset_no: string;
  name: string;
  category: string;
  department: string;
  brand: string | null;
  model_name: string;
  qty: number;
  spec_summary: string | null;
  /** YYYY-MM-DD */
  purchase_date?: string | null;
  /** YYYY-MM-DD — 최근 소모품교체/수리일 */
  last_replace_date?: string | null;
  replace_cycle_mo?: number | null;
  replace_applicable?: boolean;
  calib_cycle_mo?: number | null;
  calib_applicable?: boolean;
  /** YYYY-MM-DD */
  calib_request_date?: string | null;
  /** YYYY-MM-DD */
  calib_date?: string | null;
  etc_memo?: string | null;
};

/** 시드용 느슨한 날짜 파서 → YYYY-MM-DD | null */
export function parseEquipmentSeedDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // 순수 연도
    if (Number.isInteger(raw) && raw >= 1900 && raw <= 2100) {
      return `${raw}-01-01`;
    }
    // 2019.1 / 2024.01 형태 (엑셀 숫자)
    const s = String(raw);
    const m = s.match(/^(\d{4})\.(\d{1,2})$/);
    if (m) {
      const mm = Math.min(12, Math.max(1, Number(m[2])));
      return `${m[1]}-${String(mm).padStart(2, '0')}-01`;
    }
    return null;
  }
  const s = String(raw).trim().replace(/\.+$/, '').replace(/\s+/g, '');
  if (!s) return null;
  let m = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if (m) {
    const mm = Math.min(12, Math.max(1, Number(m[2])));
    const dd = Math.min(31, Math.max(1, Number(m[3])));
    return `${m[1]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})[.\-\/](\d{1,2})$/);
  if (m) {
    const mm = Math.min(12, Math.max(1, Number(m[2])));
    return `${m[1]}-${String(mm).padStart(2, '0')}-01`;
  }
  m = s.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01-01`;
  return null;
}

function seedDateToPrisma(ymd: string | null | undefined): Date | null {
  if (!ymd) return null;
  const d = parseKSTDateOnly(ymd);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 시드 부서명 → OrgUnit.unit_code (조직명 변경에도 unit_id 유지) */
const SEED_DEPT_UNIT_CODE: Record<string, string> = {
  AX혁신센터: 'AXIC',
  제로에너지인증센터: 'ZEC',
  경영기획센터: 'PMC',
};

/** Section Menu / API 복구 대상 범주 코드 */
export const SEEDABLE_EQUIPMENT_CATEGORIES = [
  'safety',
  'performance',
  'airtightness',
] as const;

export type SeedableEquipmentCategory =
  (typeof SEEDABLE_EQUIPMENT_CATEGORIES)[number];

export const SEED_EQUIPMENT_BY_CATEGORY: Record<
  SeedableEquipmentCategory,
  readonly SeedEquipmentRow[]
> = {
  performance: [
  {
    asset_no: "EQ-MEC-0001",
    name: "적외선 열화상 카메라",
    category: "performance",
    department: "AX혁신센터",
    brand: "FLIR",
    model_name: "FLIR-E5 / FLIR-E6390",
    qty: 1,
    spec_summary: "80 x 64 픽셀\n5 mm 렌즈로 44° (H) x 36°(V)\n9 mm 렌즈로 25° (H) x 20°(V)\n이미지 주파수 : 60 Hz // 디텍터 피치 : 50 µm\n대상 온도 범위 : -25°C ~ +135°C (-13 ~ 275°F) /\n–40°C ~ +550°C (-40 ~ 1022°F)"
  },
  {
    asset_no: "EQ-MEC-0002",
    name: "초음파 유량계",
    category: "performance",
    department: "AX혁신센터",
    brand: "Online-Instruments",
    model_name: "Ulsoflow 309S (중형-휴대용)",
    qty: 1,
    spec_summary: "측정범위 : 0 ∼ ±15 m/sec\n정밀도 : ±1% of Reading at Rate>0.2 mps, 현장교정시 ±0.5% of Reading\n재현성 : ±0.2%\n유량검출 : 주기 : 1 sec\n저장간격 : 2 sec ~ 1 hr, 저장시간 : 1 min ~ 168 hr\n시간 40 pico-second"
  },
  {
    asset_no: "EQ-MEC-0003",
    name: "디지털 압력계",
    category: "performance",
    department: "AX혁신센터",
    brand: "LUTRON",
    model_name: "PS-9302",
    qty: 1,
    spec_summary: "* Meter connects with 2, 5, 10, 20, 50, 100, 400 bar sensor, \nno calibration procedures are necessary when change a new sensor.\n* Bar, PSI, Kg/cm2, inch/Hg, mm/Hg, inch/H20, meter/H2O, Atmosphere.\n* Data hold, Memory (Max., Min.), RS232.\n* Size : 180 x 72 x 32 mm"
  },
  {
    asset_no: "EQ-MEC-0004",
    name: "데이터 기록계",
    category: "performance",
    department: "AX혁신센터",
    brand: "LUTRON",
    model_name: "4208SD",
    qty: 1,
    spec_summary: "채널수 :  12채널 온도 측정\n센서 타입 : J/K/T/E/R/S 타입 열전대\n자동 또는 수종 데이터 로거\n데이터 로거 샘플링 타임 범위 : 1 ~ 3600초\nK 타입 온도계 : -100 ~ 1300℃\n동일한 LCD 화면에 CH1 ~ CH8 또는 CH9 ~ CH12를 표시\n표시기 분해능 : 1℃/0.1℃\n시간 정보 : 년, 월, 일, 시간, 분 및 초"
  },
  {
    asset_no: "EQ-MEC-0005",
    name: "표준 온도계",
    category: "performance",
    department: "AX혁신센터",
    brand: null,
    model_name: "DK-2000",
    qty: 1,
    spec_summary: "온도 범위 : - 50 ~ 360℃ (8개)\n제품 크기 : 길이 420mm x 굵기 6.5Ø"
  },
  {
    asset_no: "EQ-MEC-0006",
    name: "디지털 풍속계",
    category: "performance",
    department: "AX혁신센터",
    brand: "TES",
    model_name: "AVM-03",
    qty: 1,
    spec_summary: "표시 : 3 1/2 Digit LCD Display\n사용 온도/압력 : 10℃ ~ 50℃/500mB ~ 2 Bar\n보관 온도 : -40℃ ~ 60℃ (-40°F ~ 140°F)\n전원 : 알카라인 9V x 1 EA\n크기 : 본체 168 mm x 90 mm x 31.3 mm\n무게 : 500g"
  },
  {
    asset_no: "EQ-MEC-0007",
    name: "디지털 풍압계",
    category: "performance",
    department: "AX혁신센터",
    brand: "AZ",
    model_name: "AZ8252",
    qty: 1,
    spec_summary: "측정범위 : 1410mm H2O\n정밀도 : ±0.3% (최대값 25℃)\n반복성 : ±0.2% (Max ±0.5)%\n측정유체 : Air\n응답시간 : 0.5 sec\n선택단위 : Bar, mbar, psi, kPa, inHg, mmHg, ozin2, inH2O, ftH2O, cmH2O, kg/cm2\n사용온습도 : 0 ~ 50℃ Humidity<80%>\n보관온습도 : -20 ~ 50℃ Humidity<90%>\n콘넥터 : Ø4mm\n크기/무게 : 182 x 72 x 30mm /150g"
  },
  {
    asset_no: "EQ-MEC-0008",
    name: "교류전력측정계",
    category: "performance",
    department: "AX혁신센터",
    brand: "LUTRON",
    model_name: "PC_6011SD",
    qty: 1,
    spec_summary: "Voltage Ranges : 10 ACV to 600 ACV (Auto Range)\nCurrent Ranges : 5 ACA to 2000 ACA (Auto Range)\n표준 안전규격 : IEC1010 CAT IV 600V\nACV input impedance : 10 M ohms\nClamp frequency response : 40 Hz to 1 KHz\nTested Clamp : 45 to 65 Hz\nOver-load protection : ACV : 720 ACV RMS\n                                                  ACA : 2100 ACA with clamp probe\nSampling Time : Approx. 1 Second\n사용 온도 : 0 to 50℃ (32 to 122°F)\n사용 습도 : 80% Relative Humidity max."
  },
  {
    asset_no: "EQ-MEC-0009",
    name: "조도계",
    category: "performance",
    department: "AX혁신센터",
    brand: "TES",
    model_name: "TES-1330A",
    qty: 1,
    spec_summary: "폭넓은 Range 구성 : 0.01 ~ 200,000 lux\n높은 정도 및 순간 응답\nData Hold 기능\ncosine angular corrected\n본체와 분리된 센서로 측정 편리\n 크기 : 135 x 72 x 33mm\n배터리 수명 : 200 시간"
  },
  {
    asset_no: "EQ-MEC-0010",
    name: "회전계",
    category: "performance",
    department: "AX혁신센터",
    brand: "CEM",
    model_name: "AT-8",
    qty: 1,
    spec_summary: "RPM 범위 : 2 to 99,999 RPM\n정확도 : ± 0.05% ±1d\n최대 분해능 : 0.1 RPM\n크기 : 160 x 60 x 42 (mm)\n중량 : 151g"
  },
  {
    asset_no: "EQ-MEC-0011",
    name: "초음파 두께 측정기",
    category: "performance",
    department: "AX혁신센터",
    brand: "뉴텍",
    model_name: "SC-20",
    qty: 1,
    spec_summary: "측정 범위 : 강재 기준 1.1mm~600mm    (기본센서:TDP0510)\n표준 Probe : 5 MHz\n분해능 : 0.01mm\n음속등록 : 음속 10 개 (자주사용하는 음속등록)\n 저    장 : 측정 값 500 개 저장 \n센    서 : Piezo 형 접촉식\n전    원 : AA 급 배터리 2 개  (일회용 혹은 충전식)\n크    기 : 72x118x33 mm\n응답속도 : 1 Sec."
  },
  {
    asset_no: "EQ-MEC-0012",
    name: "버어니어 캘리퍼스",
    category: "performance",
    department: "AX혁신센터",
    brand: "SINCON",
    model_name: "SD500-300PRO",
    qty: 1,
    spec_summary: "측정 범위 : 0.01mm ~ 300.00mm (0.01mm 단위로 측정 가능)\n오차(정밀도) : 0.04mm\n외경/내경/높이까지 정확한 측정\nmm, inch 단위 변경 가능\nZERO 세팅 및 자동 ON/OFF 기능\n미세 조정 썸룰러 & 강화 스테인레스 스틸"
  },
  {
    asset_no: "EQ-MEC-0013",
    name: "CO 측정기",
    category: "performance",
    department: "AX혁신센터",
    brand: "AZ",
    model_name: "AZ7701",
    qty: 1,
    spec_summary: "측정범위 : 0 ~ 999 ppm\n분해능 : 1ppm\n정밀도 : ±20% at 0~100ppm ; ±15% at 100~500ppm\n응답시간 : 약 60초 이내\nDisplay size : 11 x 26mm\n작동환경 : 0~50℃/5~95%\n보관환경 : -20~50℃ / 0~95%\n전      원 : AAA battery x 3ea\n크      기 : 175 x 47 x 28mm\n무      게 : 120 g"
  },
  {
    asset_no: "EQ-MEC-0014",
    name: "누수 탐지기",
    category: "performance",
    department: "AX혁신센터",
    brand: "NUSUCOP",
    model_name: "NC-1000",
    qty: 1,
    spec_summary: "사용 범위 : 옥내용 (깊이 1.5M 이내)\n사용 시간 : 연속 사용 30시간\n사용 전원 : DC9V (1EA)\n주파수 특성 : 1Hz-6,000Hz"
  },
  {
    asset_no: "EQ-MEC-0015",
    name: "배관 내시경 카메라",
    category: "performance",
    department: "AX혁신센터",
    brand: "JACO",
    model_name: "JA-6100",
    qty: 1,
    spec_summary: "이미지센서 : CMOS Image Sensor\n해상도 : 320 (H) * 240 (V) / 640 (H) * 480 (V)\n외부지름 / 길이 : 5.5mm / 1M, 2M, 3M, 5M, 10M, 20M, 30M\n촬영속도 : ~30fps\n잡음률 : 42dB\n노출 : Automatic\nWhite valance : Fix\nField of view (FOV) 67°\nDepth of field (DOF) : 1.5cm ~ 10cm\nLight source : 4 white LED"
  },
  {
    asset_no: "EQ-MEC-0016",
    name: "수질 분석기",
    category: "performance",
    department: "AX혁신센터",
    brand: "HM디지털",
    model_name: "HM501",
    qty: 1,
    spec_summary: "측정범위\npH : 0.00 ~ 14.00pH\nTemp : 0.0 ~ 80.0℃ / 32.0 ~ 176.0°F\nEC : 0 ~ 9990㎲ / 0 ~ 20.00 mS\nTDS : 0 ~9990 ppm / 0 ~ 10.00 ppt\n정밀도\npH : ± 0.02pH / Temp : ±1℃, °F\nEC/TDS : 측정수치 point 2%\n온도 보상 범위 : 0 ~ 60℃\nData 저장 : 20개\n절정기능 : 5분 후 자동 꺼짐"
  },
  ],
  safety: [
  {
    asset_no: "EQ-SAF-0001",
    name: "전체식 안전벨트",
    category: "safety",
    department: "AX혁신센터",
    brand: "나비엠알오",
    model_name: "K49460677",
    qty: 6,
    spec_summary: "대구경 / 전체식 / 웨빙\n벨트류 : 1530kgf 이상\n죔줄 : 2245kgf 이상\n훅 : 1530kgf 이상\nD링 : 1530kgf 이상\n버클 : 800kgf 이상\n동하중성능 : 612kgf 이하"
  },
  {
    asset_no: "EQ-SAF-0002",
    name: "안전화",
    category: "safety",
    department: "AX혁신센터",
    brand: "K2",
    model_name: "K2-14",
    qty: 6,
    spec_summary: "높이 : 6인치\n사이즈 : 235mm(2ea) / 250mm(1ea) / 255mm(2ea) / 285mm(1ea)"
  },
  {
    asset_no: "EQ-SAF-0003",
    name: "안전모",
    category: "safety",
    department: "AX혁신센터",
    brand: "나비엠알오",
    model_name: "고글 투구형(K4286346)",
    qty: 2,
    spec_summary: "색상 : 백색\n타입 : 투구형"
  },
  ],
  /** 창호·기밀 — @@씨드만들기_ 창호기밀성능측정장비.xlsx */
  airtightness: [
  {
    asset_no: "EQ-ENV-0001",
    name: "침기량 테스트기-1",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "DG-700",
    qty: 1,
    spec_summary: null,
    purchase_date: "2014-01-01",
    last_replace_date: "2019-10-01",
    replace_applicable: false,
    calib_cycle_mo: 12,
    calib_applicable: true,
    calib_request_date: "2026-09-04",
    calib_date: "2026-09-09"
  },
  {
    asset_no: "EQ-ENV-0002",
    name: "침기량 테스트기-2",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "DG-700",
    qty: 1,
    spec_summary: null,
    purchase_date: "2014-01-01",
    last_replace_date: "2019-10-01",
    replace_applicable: false,
    calib_cycle_mo: 12,
    calib_applicable: true,
    calib_request_date: "2026-09-04",
    calib_date: "2026-09-09"
  },
  {
    asset_no: "EQ-ENV-0003",
    name: "침기량 테스트기-3",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "DG-1000",
    qty: 1,
    spec_summary: null,
    purchase_date: "2024-01-01",
    replace_applicable: false,
    calib_cycle_mo: 12,
    calib_applicable: true,
    calib_request_date: "2026-09-04",
    calib_date: "2026-09-09"
  },
  {
    asset_no: "EQ-ENV-0004",
    name: "소형팬",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "Series B MINI BD",
    qty: 1,
    spec_summary: null,
    purchase_date: "2024-02-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true
  },
  {
    asset_no: "EQ-ENV-0005",
    name: "BD 프레임",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "BD AL Frame",
    qty: 1,
    spec_summary: null,
    purchase_date: "2024-02-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true
  },
  {
    asset_no: "EQ-ENV-0006",
    name: "BD 패널",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "Nylon MINI Panel",
    qty: 1,
    spec_summary: null,
    purchase_date: "2024-02-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true
  },
  {
    asset_no: "EQ-ENV-0007",
    name: "대형팬",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "Model 3 Minneapolis / Blower DoorTM Fans",
    qty: 1,
    spec_summary: null,
    purchase_date: "2014-01-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true
  },
  {
    asset_no: "EQ-ENV-0008",
    name: "풍속/온도계",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "TESTO 410-1",
    qty: 1,
    spec_summary: null,
    purchase_date: "2023-09-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true
  },
  {
    asset_no: "EQ-ENV-0009",
    name: "기밀진단용 열선기류 측정기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "testo 425",
    qty: 1,
    spec_summary: null,
    purchase_date: "2018-09-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true,
    calib_request_date: "2024-10-01"
  },
  {
    asset_no: "EQ-ENV-0010",
    name: "기밀진단용 온습도 측정기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: "Testo",
    model_name: "testo 625",
    qty: 1,
    spec_summary: "*습도 - 용량\n습도 측정범위: 0 ~ 100 %RH   \n정전용량형 습도센서 정확도: ±2.5 %RH (5 ~ 95 %RH)   \n습도 분해능: 0.1 %RH   \n*NTC   \nNTC 센서 측정 범위: -10 ~ +60 °C   \nNTC 센서 정확도: ±0.5 °C   \nNTC 센서 분해능: 0.1 °C   \n*열전대 K타입(NiCr-Ni)   \n열전대 K 타입 측정 범위: -200 ~ +1370 °C   \n열전대 K 타입 정확도: See probe data   \n열전대 K 타입 분해능: 0.1 °C",
    purchase_date: "2018-09-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true,
    calib_request_date: "2024-09-27"
  },
  {
    asset_no: "EQ-ENV-0011",
    name: "무선 거리 측정기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "eBOSCH-GLM500",
    qty: 1,
    spec_summary: null,
    purchase_date: "2019-07-09",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true
  },
  {
    asset_no: "EQ-ENV-0012",
    name: "무선 거리 측정기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "eBOSCH-GLM80",
    qty: 1,
    spec_summary: null,
    purchase_date: "2020-06-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true
  },
  {
    asset_no: "EQ-ENV-0013",
    name: "글라스 체크기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "GLASS-CHEK ELITE / (GC3200)",
    qty: 1,
    spec_summary: null,
    purchase_date: "2016-10-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true
  },
  {
    asset_no: "EQ-ENV-0014",
    name: "글라스 체크기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "GLASS-CHEK PRO",
    qty: 1,
    spec_summary: null,
    purchase_date: "2016-01-01",
    replace_applicable: false,
    calib_cycle_mo: 24,
    calib_applicable: true,
    calib_request_date: "2024-10-11"
  },
  {
    asset_no: "EQ-ENV-0015",
    name: "적외선 및 접촉식 온도계",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: "FLUKE",
    model_name: "FLUKE-561",
    qty: 1,
    spec_summary: "[Fluke 561 HVACPro 접촉식 및 비접촉식 온도미터]\n-온도범위: -40~550℃\n-디스플레이 분해능: 0.1℃의 판독값\n-D:S(거리 대 면적) 12:1\n-편리한 방사율 선택 기능: 세가지 설정: 낮음(0.3) 보통(0.7) 높음 (0.95)\n-정확도(23~25도의 주변 온도로 가정 했을 때) 판독값의 ±1.0% 또는 ±1℃ 중 큰 값 / 0℃ 미만에서는 ±1℃ */1*\n-응답시간: 500 mSec (판독값의 95%)\n-반복성: 판독값의 ±0.5% 또는 ±1℃ \n-스팩트럼 응답: 8㎛~14㎛",
    purchase_date: "2015-02-01",
    replace_applicable: false,
    calib_applicable: false,
    calib_request_date: "2022-01-01",
    etc_memo: "2015.02.(제조)"
  },
  {
    asset_no: "EQ-ENV-0016",
    name: "열화상 카메라",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "testo 872",
    qty: 1,
    spec_summary: null,
    purchase_date: "2020-06-29",
    replace_applicable: false,
    calib_applicable: false
  },
  {
    asset_no: "EQ-ENV-0017",
    name: "연소가스분석기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: "TESTO",
    model_name: "testo 300",
    qty: 1,
    spec_summary: "O2, CO(H2 보상), NO 센서 장착 (최대 8,000ppmCO 측정 가능)\n미세 압력 측정 센서 내장\n스마트-터치 기술과 튼튼한 설계, 이메일 보고서 등의 기능으로 효율적인 측정 업무가 가능한 스마트 연소가스 분석기 testo 300 (O2, CO, NO 센서 장착 / 최대 8,000 ppm CO 측정 가능)",
    purchase_date: "2019-07-02",
    replace_applicable: false,
    calib_applicable: false,
    calib_request_date: "2022-01-01"
  },
  {
    asset_no: "EQ-ENV-0018",
    name: "노트북",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "15ZB95N",
    qty: 1,
    spec_summary: null,
    purchase_date: "2022-01-01",
    replace_applicable: false,
    calib_applicable: false
  },
  {
    asset_no: "EQ-ENV-0019",
    name: "빔 프로젝터",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "PH550",
    qty: 1,
    spec_summary: null,
    purchase_date: "2017-03-01",
    replace_applicable: false,
    calib_applicable: false,
    etc_memo: "2022년 (임대)교체"
  },
  {
    asset_no: "EQ-ENV-0020",
    name: "열관류율 측정기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "TESTO 635",
    qty: 1,
    spec_summary: null,
    purchase_date: "2025-11-01",
    replace_applicable: false,
    calib_applicable: false,
    etc_memo: "2025.11.(신사업 인수)"
  },
  {
    asset_no: "EQ-ENV-0021",
    name: "SHGC 측정기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: null,
    model_name: "WP4500",
    qty: 1,
    spec_summary: null,
    purchase_date: "2025-11-01",
    replace_applicable: false,
    calib_applicable: false,
    etc_memo: "2025.11.(신사업 인수)"
  },
  {
    asset_no: "EQ-ENV-0022",
    name: "CO2 측정기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: "AZ",
    model_name: "AZ77532",
    qty: 1,
    spec_summary: "측정범위\n CO2 : 0 ~ 3000 ppm 3001~9999ppm (out of scale range)\n온 도 : -10 ~ 60℃\n분해능 : CO2 : 2ppm , 온도: 0.1℃\n정밀도 : CO2 :±5% 온 도 : ±0,6℃\n센서방식 : CO2 : NDIR 방식\nWarm-up : 약 30 초\nResponse time : About 30 초\n알람 dB : 80 dB\n사용온습도 : -5 ~ 60℃ / 0 ~ 95%\n보관온습도 : -20 ~ 60℃ /0 ~ 95%\n전 원 : AA Battery 4ea 연속사용시간 10시간",
    purchase_date: "2025-11-01",
    replace_applicable: false,
    calib_applicable: false,
    etc_memo: "2025.11.(신사업 인수)"
  },
  {
    asset_no: "EQ-ENV-0023",
    name: "미세먼지측정기",
    category: "airtightness",
    department: "제로에너지인증센터",
    brand: "TES",
    model_name: "TES-5321A",
    qty: 1,
    spec_summary: "측정범위\nPM2.5 : 0 -500㎍/㎥\nHumidity : 1% - 99%R.H.\nTemperature : -20℃ ~ +60℃ ( -4°F ~ + 140°F)\n분해능 : 1㎍/㎥, 1ppm, 0.1% RH, 0.1℃, 0.1°F\n정밀도\nPM2.5 : ≤50㎍ : ±5㎍\n>50㎍ : ±10% of reading\nTemperature : ±0.8℃, ±0.1°F\nHumidity : ±3%RH (at 25℃, 30-80%RH)\n±5%RH (at 25℃, 0.20%RH and 80-100%RH)\n응답시간\nPM2.5 : ≤1min\nHumidity : 45+%RH-95%RH ≤1min\n95%RH-45%RH ≤3min\nTemperature : 10℃/ 2 sec",
    purchase_date: "2025-11-01",
    replace_applicable: false,
    calib_applicable: false,
    etc_memo: "2025.11.(신사업 인수)"
  },
  ],
};

/** @deprecated 전체 플랫 목록 (CLI 전체 sync용) */
export const SEED_EQUIPMENT_PERFORMANCE: SeedEquipmentRow[] = [
  ...SEED_EQUIPMENT_BY_CATEGORY.performance,
  ...SEED_EQUIPMENT_BY_CATEGORY.safety,
  ...SEED_EQUIPMENT_BY_CATEGORY.airtightness,
];

export function isSeedableEquipmentCategory(
  code: string
): code is SeedableEquipmentCategory {
  return (SEEDABLE_EQUIPMENT_CATEGORIES as readonly string[]).includes(code);
}

export function equipmentCategoryCodeFromPath(path: string): string | null {
  const m = String(path || '').match(/^\/equipment\/main\/([^/]+)/);
  return m?.[1] || null;
}

export function isSeedEquipmentAssetNo(assetNo: string): boolean {
  return SEED_EQUIPMENT_PERFORMANCE.some((e) => e.asset_no === assetNo);
}

export type SeedEquipmentResult = {
  category: string;
  created: number;
  updated: number;
  skipped: number;
  renamed: number;
  missingDepts: string[];
  seedCount: number;
};

/**
 * - mode 'fill'  : asset_no 없으면 생성
 * - mode 'sync'  : 시드 기준값으로 upsert
 * - categoryCode : 지정 시 해당 범주만 (미지정 시 seedable 전체)
 */
export async function runSeedEquipmentPerformance(
  prisma: PrismaClient,
  mode: 'fill' | 'sync' = 'fill',
  categoryCode?: string | null
): Promise<SeedEquipmentResult> {
  const code = String(categoryCode || '').trim();
  const targets: SeedableEquipmentCategory[] = code
    ? isSeedableEquipmentCategory(code)
      ? [code]
      : []
    : [...SEEDABLE_EQUIPMENT_CATEGORIES];

  if (code && targets.length === 0) {
    return {
      category: code,
      created: 0,
      updated: 0,
      skipped: 0,
      renamed: 0,
      missingDepts: [],
      seedCount: 0,
    };
  }

  const rows = targets.flatMap((c) =>
    SEED_EQUIPMENT_BY_CATEGORY[c].map((r) => ({ ...r, category: c }))
  );

  const units = await prisma.orgUnit.findMany({
    select: { id: true, unit_name: true, unit_code: true },
  });
  const unitByCode = new Map(
    units
      .map((u) => [String(u.unit_code || '').trim().toUpperCase(), u] as const)
      .filter(([code]) => !!code)
  );
  const unitByName = new Map(
    units.map((u) => [String(u.unit_name || '').trim(), u])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let renamed = 0;
  const missingDepts = new Set<string>();

  for (const row of rows) {
    const departmentName = String(row.department || '').trim();
    const preferredCode = String(
      SEED_DEPT_UNIT_CODE[departmentName] || ''
    )
      .trim()
      .toUpperCase();
    const unit =
      (preferredCode ? unitByCode.get(preferredCode) : undefined) ||
      (departmentName ? unitByName.get(departmentName) : undefined) ||
      null;
    const unit_id = unit?.id || null;
    const department = unit
      ? String(unit.unit_name || '').trim() || departmentName || null
      : departmentName || null;
    if (departmentName && !unit_id) missingDepts.add(departmentName);

    const purchase_date = seedDateToPrisma(row.purchase_date);
    const last_replace_date = seedDateToPrisma(row.last_replace_date);
    const replace_applicable = row.replace_applicable !== false;
    const calib_applicable = row.calib_applicable !== false;
    const calib_cycle_mo =
      row.calib_cycle_mo != null && Number(row.calib_cycle_mo) > 0
        ? Number(row.calib_cycle_mo)
        : calib_applicable
          ? 12
          : 12;
    const replace_cycle_mo =
      row.replace_cycle_mo != null && Number(row.replace_cycle_mo) > 0
        ? Number(row.replace_cycle_mo)
        : null;

    const data = {
      name: row.name,
      category: row.category,
      department,
      unit_id,
      brand: row.brand,
      model_name: row.model_name,
      qty: row.qty,
      qty_unit: 'VAL_1',
      spec_summary: row.spec_summary,
      purchase_date,
      last_replace_date,
      replace_cycle_mo,
      replace_applicable,
      calib_cycle_mo,
      calib_applicable,
      etc_memo: row.etc_memo || null,
      status: '정상',
    };

    const calibRequestYmd = row.calib_request_date || null;
    const calibDoneYmd = row.calib_date || null;

    const ensureCalibHistory = async (equipmentId: string) => {
      if (!calibRequestYmd && !calibDoneYmd) return;
      const existingHist = await prisma.calibrationHistory.count({
        where: { equipment_id: equipmentId },
      });
      if (existingHist > 0) return;
      const calibDate =
        seedDateToPrisma(calibDoneYmd) || seedDateToPrisma(calibRequestYmd);
      if (!calibDate) return;
      await prisma.calibrationHistory.create({
        data: {
          equipment_id: equipmentId,
          calib_request_date: calibRequestYmd,
          calib_date: calibDate,
          agency: '시드(자료)',
          content: null,
          result: calibDoneYmd ? '적합' : '진행중',
          cost: 0,
          creator_name: 'SEED',
          creator_dept: 'SYSTEM',
        },
      });
    };

    let exist = await prisma.equipment.findUnique({
      where: { asset_no: row.asset_no },
    });

    if (!exist) {
      // 구 시드 번호 이전: kpcqa-eq-* / KPCQA-EQ-* → EQ-*
      const legacyCandidates = [
        row.asset_no.toLowerCase(),
        ...(row.asset_no.startsWith('EQ-')
          ? [`KPCQA-${row.asset_no}`, `kpcqa-${row.asset_no.toLowerCase()}`]
          : []),
      ].filter((n, i, arr) => n && n !== row.asset_no && arr.indexOf(n) === i);

      for (const legacyNo of legacyCandidates) {
        const legacy = await prisma.equipment.findUnique({
          where: { asset_no: legacyNo },
        });
        if (!legacy) continue;
        await prisma.equipment.update({
          where: { asset_no: legacyNo },
          data: { asset_no: row.asset_no },
        });
        renamed += 1;
        exist = await prisma.equipment.findUnique({
          where: { asset_no: row.asset_no },
        });
        break;
      }
    }

    if (!exist) {
      const createdEq = await prisma.equipment.create({
        data: {
          asset_no: row.asset_no,
          ...data,
          creator_name: 'SEED',
          creator_dept: 'SYSTEM',
        },
      });
      await ensureCalibHistory(createdEq.id);
      created += 1;
      continue;
    }

    // 폐기/반납·부분폐기(_ARC_)·archived_at 잔존 건은 시드로 되살리지 않음
    const isArchivedRow =
      exist.status !== '정상' ||
      !!exist.archived_at ||
      String(exist.asset_no || '').includes('_ARC_');
    if (isArchivedRow) {
      skipped += 1;
      continue;
    }

    if (mode === 'sync') {
      const { status: _status, ...syncData } = data;
      await prisma.equipment.update({
        where: { asset_no: row.asset_no },
        data: syncData,
      });
      await ensureCalibHistory(exist.id);
      updated += 1;
    } else if (exist.category !== row.category) {
      // fill이어도 범주 오배치(시드 안전→performance)는 교정
      await prisma.equipment.update({
        where: { asset_no: row.asset_no },
        data: { category: row.category },
      });
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    category: code || 'all',
    created,
    updated,
    skipped,
    renamed,
    missingDepts: [...missingDepts],
    seedCount: rows.length,
  };
}
