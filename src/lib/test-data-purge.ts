/**
 * LV_1 테스트 거래 데이터 정리 — 신청·응답·이력 등 "표에 쌓이는 행"만.
 * 마스터/시드/메뉴·권한·설문 정의·품목 카탈로그는 포함하지 않음.
 *
 * 정렬 = 홈 Interface 메뉴 순서 (Step1 → Step2)
 *   Step1: asset → marketing → equipment → survey
 *   Asset Step2: supplies → it → businesscard → production
 */

export type TestDataPurgeDomainId =
  | 'supplies_requests'
  | 'supplies_purchases'
  | 'it_requests'
  | 'it_audits'
  | 'it_asset_archive'
  | 'business_card'
  | 'production_requests'
  | 'marketing_distributions'
  | 'marketing_purchases'
  | 'equipment_histories'
  | 'general_responses'
  | 'delivery_responses';

export type TestDataPurgeDomainDef = {
  id: TestDataPurgeDomainId;
  /** 홈 L1 — 예: 1. 경영자산관리 */
  step1: string;
  /** 서비스 L2 — 예: 1. 일반소모품 */
  step2: string;
  label: string;
  paths: string[];
  description: string;
  tables: string[];
};

/**
 * .env ALLOW_TEST_DELETE=true 일 때만 일괄삭제 UI/API 활성.
 * 미설정·그 외 값 → 비활성(안전 기본값). 서버 재시작 후 반영.
 */
export function isTestDataPurgeAllowed(): boolean {
  return String(process.env.ALLOW_TEST_DELETE || '')
    .trim()
    .toLowerCase() === 'true';
}

/** 일회용 확인 키 — 코드에 고정 문자열이 없어 실수·재전송 오작동을 줄임 */
type PurgeChallenge = {
  code: string;
  userId: string;
  expiresAt: number;
};

const PURGE_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const purgeChallenges = new Map<string, PurgeChallenge>();

function prunePurgeChallenges(now = Date.now()) {
  for (const [id, row] of purgeChallenges) {
    if (row.expiresAt <= now) purgeChallenges.delete(id);
  }
}

/** 6자리 숫자 키 발급 (화면 표시용). challengeId는 서버 검증용 */
export function issuePurgeChallenge(userId: string): {
  challengeId: string;
  challengeCode: string;
  expiresInSec: number;
} {
  prunePurgeChallenges();
  const challengeId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const challengeCode = String(Math.floor(100000 + Math.random() * 900000));
  const uid = String(userId || '').trim();
  purgeChallenges.set(challengeId, {
    code: challengeCode,
    userId: uid,
    expiresAt: Date.now() + PURGE_CHALLENGE_TTL_MS,
  });
  return {
    challengeId,
    challengeCode,
    expiresInSec: Math.floor(PURGE_CHALLENGE_TTL_MS / 1000),
  };
}

/** 확인 키 검증 후 일회용 소비. 성공 시 true */
export function consumePurgeChallenge(
  challengeId: string,
  typedCode: string,
  userId: string
): { ok: true } | { ok: false; message: string } {
  prunePurgeChallenges();
  const id = String(challengeId || '').trim();
  const code = String(typedCode || '').trim();
  const uid = String(userId || '').trim();
  if (!id || !code) {
    return { ok: false, message: '확인 키를 입력해 주세요.' };
  }
  const row = purgeChallenges.get(id);
  if (!row) {
    return {
      ok: false,
      message: '확인 키가 만료되었거나 이미 사용되었습니다. 건수 새로고침 후 다시 입력해 주세요.',
    };
  }
  if (row.userId && uid && row.userId !== uid) {
    return { ok: false, message: '확인 키 발급 사용자와 일치하지 않습니다.' };
  }
  if (row.expiresAt <= Date.now()) {
    purgeChallenges.delete(id);
    return {
      ok: false,
      message: '확인 키가 만료되었습니다. 건수 새로고침 후 다시 입력해 주세요.',
    };
  }
  if (row.code !== code) {
    return { ok: false, message: '확인 키가 일치하지 않습니다.' };
  }
  purgeChallenges.delete(id);
  return { ok: true };
}

export const TEST_DATA_PURGE_DOMAINS: TestDataPurgeDomainDef[] = [
  // ── Step1 /asset · Step2 supplies (1) ──
  {
    id: 'supplies_requests',
    step1: '1. 경영자산관리',
    step2: '1. 일반소모품',
    label: '소모품 사용자 신청',
    paths: [
      '/asset/supplies/inventory',
      '/asset/supplies/dept',
      '/asset/supplies/master/requests',
    ],
    description: 'SupplyRequest — 신청·지급·반려 장부 (품목 마스터 SupplyItem 제외)',
    tables: ['SupplyRequest'],
  },
  {
    id: 'supplies_purchases',
    step1: '1. 경영자산관리',
    step2: '1. 일반소모품',
    label: '소모품 입고(구매) 장부',
    paths: ['/asset/supplies/master/restock'],
    description: 'SupplyPurchase — 입고 행 (삭제 시 해당 품목 재고에서 입고 수량만큼 차감, 0 미만 방지)',
    tables: ['SupplyPurchase'],
  },
  // ── Step1 /asset · Step2 it (2) ──
  {
    id: 'it_requests',
    step1: '1. 경영자산관리',
    step2: '2. IT·업무자산',
    label: 'IT 요구사항·의견',
    paths: [
      '/asset/it/personal',
      '/asset/it/dept',
      '/asset/it/master/requests',
    ],
    description: 'ITRequest — 신청/의견 행 (ITAsset 보유 대장 제외)',
    tables: ['ITRequest'],
  },
  {
    id: 'it_audits',
    step1: '1. 경영자산관리',
    step2: '2. IT·업무자산',
    label: 'IT 자산 실사',
    paths: ['/asset/it/master/audit'],
    description: 'ITAudit + ITAuditResponse — 실사 건·응답 (자산 대장 제외)',
    tables: ['ITAuditResponse', 'ITAudit'],
  },
  {
    id: 'it_asset_archive',
    step1: '1. 경영자산관리',
    step2: '2. IT·업무자산',
    label: 'IT 종료자산 아카이브',
    paths: ['/asset/it/master/archive'],
    description: 'ITAssetArchive — 종료·폐기 아카이브 행 (활성 ITAsset 제외)',
    tables: ['ITAssetArchive'],
  },
  // ── Step1 /asset · Step2 businesscard (3) ──
  {
    id: 'business_card',
    step1: '1. 경영자산관리',
    step2: '3. 명함신청',
    label: '명함 신청·발주',
    paths: [
      '/asset/businesscard/my-page',
      '/asset/businesscard/master/requests',
      '/asset/businesscard/master/order',
      '/asset/businesscard/master/archive',
    ],
    description: 'BusinessCardRequest + OrderBatch (주소/자격 마스터 제외)',
    tables: ['BusinessCardRequest', 'BusinessCardOrderBatch'],
  },
  // ── Step1 /asset · Step2 production (4) ──
  {
    id: 'production_requests',
    step1: '1. 경영자산관리',
    step2: '4. 부서 맞춤 제작품',
    label: '제작물 신청',
    paths: [
      '/asset/production/apply/request',
      '/asset/production/apply/history',
      '/asset/production/dept-master',
      '/asset/production/master',
    ],
    description: 'ProductionRequest — 신청·발주·반려·아카이브 행 전부 (마스터 품목/외주/인증 제외)',
    tables: ['ProductionRequest'],
  },
  // ── Step1 /marketing (2) ──
  {
    id: 'marketing_distributions',
    step1: '2. 마케팅자산관리',
    step2: '2. 지급 및 물품 관리',
    label: '마케팅 물품 지급·배포',
    paths: [
      '/marketing/distribution/catalog',
      '/marketing/distribution/register',
      '/marketing/distribution/dept',
      '/marketing/distribution/client-search',
    ],
    description: 'MarketingDistribution — 지급/승인/반려 행 (품목·고객사 마스터 제외)',
    tables: ['MarketingDistribution'],
  },
  {
    id: 'marketing_purchases',
    step1: '2. 마케팅자산관리',
    step2: '2. 지급 및 물품 관리',
    label: '마케팅 물품 입고',
    paths: [
      '/marketing/distribution/catalog',
      '/marketing/distribution/dept',
    ],
    description: 'MarketingPurchase — 입고 행 (삭제 시 해당 품목 재고에서 입고 수량만큼 차감, 0 미만 방지)',
    tables: ['MarketingPurchase'],
  },
  // ── Step1 /equipment (3) ──
  {
    id: 'equipment_histories',
    step1: '3. 현장 직무·안전 장비관리',
    step2: '1. 장비 종합 대시보드',
    label: '장비 교정·유지보수 이력',
    paths: ['/equipment/main'],
    description: 'CalibrationHistory + MaintenanceHistory (장비 Equipment 본체 제외)',
    tables: ['CalibrationHistory', 'MaintenanceHistory'],
  },
  // ── Step1 /survey (4) — L2: general(1) → delivery(2) ──
  {
    id: 'general_responses',
    step1: '4. 설문 및 배송조사',
    step2: '1. 일반조사/익명조사',
    label: '일반 설문 응답',
    paths: [
      '/survey/general/dashboard',
      '/survey/general/my-submissions',
      '/survey/general/admin',
    ],
    description: 'GeneralResponse — 응답 행 (설문 정의 GeneralSurvey 제외)',
    tables: ['GeneralResponse'],
  },
  {
    id: 'delivery_responses',
    step1: '4. 설문 및 배송조사',
    step2: '2. 배송조사(의견회신형)',
    label: '배달복지 설문 응답',
    paths: [
      '/survey/delivery/dashboard',
      '/survey/delivery/my-submissions',
      '/survey/delivery/admin',
    ],
    description: 'DeliveryResponse + Event — 응답·타임라인 (설문 정의 DeliverySurvey 제외)',
    tables: ['DeliveryResponseEvent', 'DeliveryResponse'],
  },
];

export function resolvePurgeDomains(ids: unknown): TestDataPurgeDomainDef[] {
  const set = new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  return TEST_DATA_PURGE_DOMAINS.filter((d) => set.has(d.id));
}
