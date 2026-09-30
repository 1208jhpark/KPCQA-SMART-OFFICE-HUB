/** 페이지 접속 집계 — 경로 정규화·메뉴 Step 매핑·서울 시각 */

export type InterfaceMenuRow = {
  id: string;
  path: string;
  name: string;
  level: number;
  parent_id: string | null;
  sort_order: number;
  icon?: string | null;
};

export type PageViewStepRow = {
  path: string;
  step1: string;
  step2: string;
  step3: string;
  step4: string;
  level: number;
  sortKey: string;
  hits: number;
  users: number;
  inMenu: boolean;
};

/** 앱에 존재하는 주요 화면 경로 (Interface 없어도 목록에 항상 표시) */
export const KNOWN_APP_PATHS: { path: string; step1: string; step2: string; step3: string; step4: string }[] = [
  // 홈·계정
  { path: '/home', step1: '홈', step2: '—', step3: '—', step4: '홈' },
  { path: '/account/password', step1: '계정', step2: '—', step3: '—', step4: '비밀번호 변경' },

  // 경영자산 /asset
  { path: '/asset', step1: '경영·업무자산', step2: '허브', step3: '—', step4: '대시보드' },
  { path: '/asset/supplies/inventory', step1: '경영·업무자산', step2: '일반소모품', step3: '사용자', step4: '소모품 조회·신청' },
  { path: '/asset/supplies/dept', step1: '경영·업무자산', step2: '일반소모품', step3: '부서', step4: '부서 소모품 현황' },
  { path: '/asset/supplies/master/dashboard', step1: '경영·업무자산', step2: '일반소모품', step3: '마스터', step4: '대시보드' },
  { path: '/asset/supplies/master/requests', step1: '경영·업무자산', step2: '일반소모품', step3: '마스터', step4: '신청현황' },
  { path: '/asset/supplies/master/restock', step1: '경영·업무자산', step2: '일반소모품', step3: '마스터', step4: '입고 관리' },
  { path: '/asset/supplies/master/archive', step1: '경영·업무자산', step2: '일반소모품', step3: '마스터', step4: '폐기 아카이브' },
  { path: '/asset/it/personal', step1: '경영·업무자산', step2: 'IT·업무자산', step3: '사용자', step4: '개인 자산' },
  { path: '/asset/it/dept', step1: '경영·업무자산', step2: 'IT·업무자산', step3: '부서', step4: '부서 자산' },
  { path: '/asset/it/master/dashboard', step1: '경영·업무자산', step2: 'IT·업무자산', step3: '마스터', step4: '대시보드' },
  { path: '/asset/it/master/audit', step1: '경영·업무자산', step2: 'IT·업무자산', step3: '마스터', step4: '정기 실사' },
  { path: '/asset/it/master/requests', step1: '경영·업무자산', step2: 'IT·업무자산', step3: '마스터', step4: '의견/요청' },
  { path: '/asset/it/master/archive', step1: '경영·업무자산', step2: 'IT·업무자산', step3: '마스터', step4: '종료 아카이브' },
  { path: '/asset/businesscard/my-page', step1: '경영·업무자산', step2: '명함', step3: '사용자', step4: '명함 신청' },
  { path: '/asset/businesscard/master/requests', step1: '경영·업무자산', step2: '명함', step3: '마스터', step4: '신청현황' },
  { path: '/asset/businesscard/master/order', step1: '경영·업무자산', step2: '명함', step3: '마스터', step4: '발주·검수' },
  { path: '/asset/businesscard/master/archive', step1: '경영·업무자산', step2: '명함', step3: '마스터', step4: '검수완료 보관함' },
  { path: '/asset/production/apply/request', step1: '경영·업무자산', step2: '맞춤 제작품', step3: '신청', step4: '신규 신청' },
  { path: '/asset/production/apply/history', step1: '경영·업무자산', step2: '맞춤 제작품', step3: '신청', step4: '나의 이력' },
  { path: '/asset/production/dept-master/order', step1: '경영·업무자산', step2: '맞춤 제작품', step3: '부서', step4: '발주 대장' },
  { path: '/asset/production/dept-master/inspection', step1: '경영·업무자산', step2: '맞춤 제작품', step3: '부서', step4: '수령검수' },
  { path: '/asset/production/dept-master/settlement', step1: '경영·업무자산', step2: '맞춤 제작품', step3: '부서', step4: '명세서 정산' },
  { path: '/asset/production/dept-master/archive', step1: '경영·업무자산', step2: '맞춤 제작품', step3: '부서', step4: '정산완료 보관함' },
  { path: '/asset/production/master/dashboard', step1: '경영·업무자산', step2: '맞춤 제작품', step3: '전사 마스터', step4: '검수 완료' },
  { path: '/asset/production/master/archive', step1: '경영·업무자산', step2: '맞춤 제작품', step3: '전사 마스터', step4: '대조완료 보관함' },

  // 장비
  { path: '/equipment/main', step1: '장비', step2: '대장', step3: '—', step4: '장비 메인' },
  { path: '/equipment/dashboard', step1: '장비', step2: '대시보드', step3: '—', step4: '장비 대시보드' },

  // 설문
  { path: '/survey/general', step1: '설문', step2: '제너럴', step3: '—', step4: '허브' },
  { path: '/survey/general/my-submissions', step1: '설문', step2: '제너럴', step3: '사용자', step4: '나의 제출' },
  { path: '/survey/general/admin/active-surveys', step1: '설문', step2: '제너럴', step3: '관리', step4: '진행중 조사' },
  { path: '/survey/general/admin/survey-history', step1: '설문', step2: '제너럴', step3: '관리', step4: '조사 이력' },
  { path: '/survey/delivery', step1: '설문', step2: '딜리버리', step3: '—', step4: '허브' },
  { path: '/survey/delivery/my-submissions', step1: '설문', step2: '딜리버리', step3: '사용자', step4: '나의 제출' },
  { path: '/survey/delivery/admin/active-surveys', step1: '설문', step2: '딜리버리', step3: '관리', step4: '신청 현황' },
  { path: '/survey/delivery/admin/history', step1: '설문', step2: '딜리버리', step3: '관리', step4: '결과 이력' },

  // 마케팅·외주 등 자주 쓰는 서비스
  { path: '/marketing', step1: '마케팅', step2: '—', step3: '—', step4: '마케팅' },
  { path: '/outsourcing', step1: '외주', step2: '—', step3: '—', step4: '외주' },

  // 관리자
  { path: '/admin/users', step1: '관리자', step2: '설정', step3: '—', step4: '사용자·권한' },
  { path: '/admin/units', step1: '관리자', step2: '설정', step3: '—', step4: '조직 관리' },
  { path: '/admin/interface', step1: '관리자', step2: '설정', step3: '—', step4: '인터페이스' },
  { path: '/admin/master-data', step1: '관리자', step2: '설정', step3: '—', step4: '마스터 데이터' },
  { path: '/admin/settings', step1: '관리자', step2: '설정', step3: '—', step4: '시스템 환경' },
];

export function normalizePagePath(raw: string): string {
  let p = String(raw || '').trim();
  if (!p) return '';
  try {
    if (/^https?:\/\//i.test(p)) {
      p = new URL(p).pathname;
    }
  } catch {
    /* keep as-is */
  }
  p = p.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/$/, '');
  return p;
}

/** 추적 제외 (노이즈·정적·공개 검증 등) */
export function shouldSkipPageViewPath(path: string): boolean {
  const p = normalizePagePath(path);
  if (!p) return true;
  if (p === '/login' || p === '/signup') return true;
  if (p.startsWith('/api')) return true;
  if (p.startsWith('/_next')) return true;
  if (p.includes('.')) return true;
  return false;
}

/** Asia/Seoul 기준 연·월·일 */
export function seoulYmd(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((x) => x.type === 'year')?.value || 0);
  const month = Number(parts.find((x) => x.type === 'month')?.value || 0);
  const day = Number(parts.find((x) => x.type === 'day')?.value || 0);
  return { year, month, day };
}

function walkAncestors(
  menu: InterfaceMenuRow,
  byId: Map<string, InterfaceMenuRow>
): InterfaceMenuRow[] {
  const chain: InterfaceMenuRow[] = [];
  let cur: InterfaceMenuRow | undefined = menu;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain;
}

function stepsFromChain(chain: InterfaceMenuRow[]): {
  step1: string;
  step2: string;
  step3: string;
  step4: string;
} {
  const byLevel = (lv: number) => chain.find((m) => m.level === lv)?.name || '';
  return {
    step1: byLevel(1) || chain[0]?.name || '—',
    step2: byLevel(2) || '—',
    step3: byLevel(3) || '—',
    step4: byLevel(4) || (chain[chain.length - 1]?.level === 4 ? chain[chain.length - 1].name : '—'),
  };
}

/** 경로에 가장 긴 InterfaceConfig path 매칭 */
export function matchMenuForPath(
  path: string,
  menus: InterfaceMenuRow[]
): InterfaceMenuRow | null {
  const p = normalizePagePath(path).toLowerCase();
  if (!p) return null;
  const sorted = [...menus]
    .filter((m) => m.path)
    .sort((a, b) => (b.path?.length || 0) - (a.path?.length || 0));
  for (const m of sorted) {
    const mp = normalizePagePath(m.path).toLowerCase();
    if (!mp) continue;
    if (p === mp || p.startsWith(`${mp}/`)) return m;
  }
  return null;
}

function knownMeta(path: string) {
  return KNOWN_APP_PATHS.find((k) => normalizePagePath(k.path) === path) || null;
}

/**
 * 표시 목록 =
 *  1) 코드에 정의된 전체 주요 경로
 *  2) InterfaceConfig에 있는 모든 경로
 *  3) 실제 접속이 쌓인 경로
 * → 조회수 0이어도 경로 자체는 항상 나열
 */
export function buildPageViewReportRows(opts: {
  menus: InterfaceMenuRow[];
  hitMap: Map<string, number>;
  userMap: Map<string, number>;
}): PageViewStepRow[] {
  const { menus, hitMap, userMap } = opts;
  const byId = new Map(menus.map((m) => [m.id, m]));
  const rowMap = new Map<string, PageViewStepRow>();

  const upsert = (row: PageViewStepRow) => {
    const prev = rowMap.get(row.path);
    if (!prev) {
      rowMap.set(row.path, row);
      return;
    }
    // Interface/메뉴 정보가 있으면 라벨 우선, 수치는 동일 hitMap 기준
    if (row.inMenu && !prev.inMenu) {
      rowMap.set(row.path, { ...row, hits: prev.hits, users: prev.users });
    }
  };

  // 1) 고정 경로 카탈로그
  for (const k of KNOWN_APP_PATHS) {
    const path = normalizePagePath(k.path);
    if (!path) continue;
    upsert({
      path,
      step1: k.step1,
      step2: k.step2,
      step3: k.step3,
      step4: k.step4,
      level: 4,
      sortKey: `${k.step1}/${k.step2}/${k.step3}/${k.step4}/${path}`,
      hits: hitMap.get(path) || 0,
      users: userMap.get(path) || 0,
      inMenu: false,
    });
  }

  // 2) Interface 전 경로 (있으면 Step 라벨 덮어씀)
  for (const m of menus) {
    const path = normalizePagePath(m.path);
    if (!path || shouldSkipPageViewPath(path)) continue;
    const chain = walkAncestors(m, byId);
    const steps = stepsFromChain(chain);
    if (m.level === 3 && (!steps.step3 || steps.step3 === '—')) steps.step3 = m.name;
    if (m.level === 4 && (!steps.step4 || steps.step4 === '—')) steps.step4 = m.name;
    if (m.level <= 2 && steps.step4 === '—') steps.step4 = m.name;
    upsert({
      path,
      ...steps,
      level: m.level,
      sortKey: `${String(chain[0]?.sort_order ?? 999).padStart(4, '0')}/${steps.step1}/${String(chain[1]?.sort_order ?? 999).padStart(4, '0')}/${steps.step2}/${String(m.sort_order).padStart(4, '0')}/${path}`,
      hits: hitMap.get(path) || 0,
      users: userMap.get(path) || 0,
      inMenu: true,
    });
  }

  // 3) 실제 접속만 있는 경로
  for (const path of hitMap.keys()) {
    if (rowMap.has(path)) {
      const cur = rowMap.get(path)!;
      cur.hits = hitMap.get(path) || 0;
      cur.users = userMap.get(path) || 0;
      continue;
    }
    const matched = matchMenuForPath(path, menus);
    if (matched) {
      const chain = walkAncestors(matched, byId);
      const steps = stepsFromChain(chain);
      upsert({
        path,
        ...steps,
        level: matched.level,
        sortKey: `z/${steps.step1}/${steps.step2}/${path}`,
        hits: hitMap.get(path) || 0,
        users: userMap.get(path) || 0,
        inMenu: false,
      });
      continue;
    }
    const known = knownMeta(path);
    if (known) {
      upsert({
        path,
        step1: known.step1,
        step2: known.step2,
        step3: known.step3,
        step4: known.step4,
        level: 4,
        sortKey: `${known.step1}/${known.step2}/${path}`,
        hits: hitMap.get(path) || 0,
        users: userMap.get(path) || 0,
        inMenu: false,
      });
      continue;
    }
    upsert({
      path,
      step1: '기타',
      step2: '추가 접속 경로',
      step3: '—',
      step4: path,
      level: 0,
      sortKey: `zzz/${path}`,
      hits: hitMap.get(path) || 0,
      users: userMap.get(path) || 0,
      inMenu: false,
    });
  }

  // hitMap에 있는 모든 경로 수치 재동기화
  for (const [path, row] of rowMap) {
    row.hits = hitMap.get(path) || 0;
    row.users = userMap.get(path) || 0;
  }

  return Array.from(rowMap.values()).sort((a, b) =>
    a.sortKey.localeCompare(b.sortKey, 'ko')
  );
}
