'use client';
  
import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTYearMonth, getKSTNowYearMonth } from '@/utils/dateUtils';
import { resolveTopOrgName, getChildUnitNames, isGlobalMgmtOrgMember, canEditTopOrgMarketingAsset } from '@/utils/orgUnits';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import LoadingState from '@/components/common/LoadingState';

// [UI 표준] 공통 HeaderLight 컴포넌트
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);

function getDistBusinessDate(d: { dist_date?: string | Date | null; createdAt?: string | Date | null }) {
  return d.dist_date || d.createdAt || null;
}

/** 승인 완료 후 3일(KST) 이내 — 최근 승인 하이라이트 */
function isRecentlyApproved(d: { status?: string | null; approved_at?: string | Date | null }, withinDays = 3) {
  if (d.status === 'PENDING' || d.status === 'REJECTED' || !d.approved_at) return false;
  const approvedYmd = getKSTDateString(d.approved_at);
  const todayYmd = getKSTDateString();
  if (!approvedYmd || !todayYmd) return false;
  const a = new Date(`${approvedYmd}T12:00:00+09:00`).getTime();
  const t = new Date(`${todayYmd}T12:00:00+09:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(t)) return false;
  const diffDays = Math.floor((t - a) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays < withinDays;
}

async function readApiError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

/** 역할 문자열 정규화 (LV_1 / "1" / ["LV_1"] 등) */
function normalizeRoles(roles: unknown): string[] {
  if (!roles) return [];
  const arr = Array.isArray(roles) ? roles : [roles];
  return arr.map((r) => {
    const s = String(r).trim();
    const m = s.match(/(\d+)/);
    return m ? `LV_${m[1]}` : s;
  });
}

function emailsEqual(a?: string | null, b?: string | null) {
  return !!(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** 본인 지급 — 이메일 우선, 레거시(이메일 없음)는 이름+부서 */
function isOwnDistribution(
  d: { sender_email?: string | null; sender_name?: string | null; sender_dept?: string | null },
  user: { email?: string | null; name?: string | null; unit?: { unit_name?: string | null } | null } | null
) {
  if (!user) return false;
  if (d.sender_email) return emailsEqual(d.sender_email, user.email);
  const myDept = user.unit?.unit_name || '';
  return !!d.sender_name && d.sender_name === user.name && !!d.sender_dept && d.sender_dept === myDept;
}

/** 종료 탭: 종료처리자(archived_by) 우선 — 마감 버튼을 누른 사람. 레거시만 creator fallback */
function resolveItemRegistrant(item: {
  creator_name?: string | null;
  creator_dept?: string | null;
  creator_email?: string | null;
  archived_by_name?: string | null;
  archived_by_dept?: string | null;
  archived_by_email?: string | null;
}) {
  const useArchiver = !!(item.archived_by_name || item.archived_by_email || item.archived_by_dept);
  if (useArchiver) {
    return {
      name: item.archived_by_name || '관리자',
      dept: item.archived_by_dept || '-',
      email: item.archived_by_email || '',
    };
  }
  return {
    name: item.creator_name || '관리자',
    dept: item.creator_dept || '-',
    email: item.creator_email || '',
  };
}

/** 본부면 본인+하위 센터 부서명 목록 */
function getScopedDeptNames(
  myDeptName: string | undefined,
  myUnitId: string | undefined,
  units: any[]
): string[] {
  if (!myDeptName) return [];
  const names = new Set<string>([myDeptName]);
  units.forEach((u) => {
    if (u?.unit_name && (u.parent?.unit_name === myDeptName || (myUnitId && u.parent_id === myUnitId))) {
      names.add(u.unit_name);
    }
  });
  return Array.from(names);
}

/** 물품소속 기준 조회 범위: 나+하위센터 (+ GLOBAL_MGMT면 최상위 Organization) */
function getOwnerScopedDeptNames(opts: {
  myDeptName?: string;
  myUnitId?: string;
  units: any[];
  topOrgName?: string | null;
  globalMgmtDept?: string | null;
  isLv1?: boolean;
}): string[] {
  const me = String(opts.myDeptName || '').trim();
  if (!me && !opts.isLv1) return [];

  const names = new Set<string>();
  if (me) {
    names.add(me);
    getChildUnitNames(me, opts.myUnitId, opts.units).forEach((c) => names.add(c));
  }

  if (
    opts.isLv1 ||
    isGlobalMgmtOrgMember({
      myUnitName: me,
      myUnitId: opts.myUnitId,
      globalMgmtDept: opts.globalMgmtDept,
      units: opts.units,
    })
  ) {
    const top = String(opts.topOrgName || '').trim();
    if (top) names.add(top);
  }

  return Array.from(names);
}
  
function DeptDistributionContent() {
  const searchParams = useSearchParams();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]); 
  const [items, setItems] = useState<any[]>([]); 
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;

    editDesignate: string;
    editLevel: string;

  } | null>(null);
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const MENU_PATH = '/marketing/distribution/dept';

  const { year: kstYear } = getKSTNowYearMonth();
  
  // 🚀 활성 탭 상태 관리 (?tab=DIST|PURCHASE|ARCHIVED)
  const [activeTab, setActiveTab] = useState<'DIST' | 'PURCHASE' | 'ARCHIVED'>('DIST');
  /** 지급 이력: 기본 = 관리소속(물품 owner) 기준 (장부·승인 후 추적에 유리) */
  const [distViewMode, setDistViewMode] = useState<'SENDER' | 'OWNER'>('OWNER');

  // [탭 1] 지급 이력 상태
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchItemQuery, setSearchItemQuery] = useState('');
  const [searchClientQuery, setSearchClientQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(kstYear.toString());
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [distOwnerFilter, setDistOwnerFilter] = useState<string>('ALL');
  const [distSenderFilter, setDistSenderFilter] = useState<string>('ALL');
  const [selectedClientFilter, setSelectedClientFilter] = useState<string | null>(null);
  /** GLOBAL_MGMT: Organization 풀 승인대기 */
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const tab = (searchParams.get('tab') || '').toUpperCase();
    if (tab === 'PURCHASE' || tab === 'ARCHIVED' || tab === 'DIST') {
      setActiveTab(tab);
      if (tab !== 'DIST') setApprovalModalOpen(false);
    }
  }, [searchParams]);

  // [탭 2] 입고 내역 상태
  const [purchaseItemQuery, setPurchaseItemQuery] = useState('');
  const [purchaseVendorQuery, setPurchaseVendorQuery] = useState('');
  const [purchaseYear, setPurchaseYear] = useState(kstYear.toString());
  const [purchaseMonth, setPurchaseMonth] = useState('ALL');
  const [purchaseOwnerFilter, setPurchaseOwnerFilter] = useState<string>('ALL');
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<Set<string>>(new Set());
  const [currentPurchasePage, setCurrentPurchasePage] = useState(1);
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);

  // [탭 3] 종료 물품 상태
  const [endedItemQuery, setEndedItemQuery] = useState('');
  const [endedRegistrantQuery, setEndedRegistrantQuery] = useState('');
  const [endedYearFilter, setEndedYearFilter] = useState<string>('ALL');
  const [endedMonthFilter, setEndedMonthFilter] = useState<string>('ALL');
  const [endedOwnerFilter, setEndedOwnerFilter] = useState<string>('ALL');
  const [endedPage, setEndedPage] = useState<number>(1);
  const [selectedEndedIds, setSelectedEndedIds] = useState<Set<string>>(new Set());

  const itemsPerPage = 10;
  /** 신청자/물품소속 전환 시 늦게 도착한 응답 무시 */
  const distLoadSeqRef = useRef(0);
  
  useEffect(() => {
    fetchData();
  }, []);

  const buildDistQuery = (
    user: any,
    loadedUnits: any[],
    sysCfg: any,
    mode: 'SENDER' | 'OWNER'
  ) => {
    const myDept = user?.unit?.unit_name;
    if (!myDept) return null;
    const myUnitId = user?.unit_id || user?.unit?.id;
    const roles = normalizeRoles(user?.roles);
    const isLv1 = roles.includes('LV_1');

    if (mode === 'OWNER') {
      const owners = getOwnerScopedDeptNames({
        myDeptName: myDept,
        myUnitId,
        units: loadedUnits,
        topOrgName: resolveTopOrgName(loadedUnits),
        globalMgmtDept: sysCfg?.global_mgmt_dept,
        isLv1,
      });
      if (owners.length === 0) return null;
      return owners.length > 1
        ? `ownerDepts=${encodeURIComponent(owners.join(','))}`
        : `ownerDept=${encodeURIComponent(owners[0])}`;
    }

    const scoped = getScopedDeptNames(myDept, myUnitId, loadedUnits);
    return scoped.length > 1
      ? `depts=${encodeURIComponent(scoped.join(','))}`
      : `dept=${encodeURIComponent(myDept)}`;
  };

  const loadDistributions = async (
    user: any,
    loadedUnits: any[],
    sysCfg: any,
    mode: 'SENDER' | 'OWNER'
  ): Promise<'ok' | 'error' | 'stale'> => {
    const seq = ++distLoadSeqRef.current;
    const q = buildDistQuery(user, loadedUnits, sysCfg, mode);
    if (!q) {
      if (seq !== distLoadSeqRef.current) return 'stale';
      setDistributions([]);
      return 'ok';
    }
    const dRes = await fetch(`/api/marketing/distributions?${q}&t=${Date.now()}`);
    if (seq !== distLoadSeqRef.current) return 'stale';
    if (dRes.ok) {
      const data = await dRes.json();
      if (seq !== distLoadSeqRef.current) return 'stale';
      setDistributions(data);
      return 'ok';
    }
    setDistributions([]);
    return 'error';
  };

  const loadPendingApprovals = async (user: any, loadedUnits: any[], sysCfg: any) => {
    const top = resolveTopOrgName(loadedUnits);
    const mgmt = sysCfg?.global_mgmt_dept;
    const roles = normalizeRoles(user?.roles);
    const isLv1User = roles.includes('LV_1');
    const inMgmtTree = isGlobalMgmtOrgMember({
      myUnitName: user?.unit?.unit_name,
      myUnitId: user?.unit_id || user?.unit?.id,
      globalMgmtDept: mgmt,
      units: loadedUnits,
    });
    // LV_1 또는 GLOBAL_MGMT 트리만 Organization 풀 승인대기 조회
    if (!top || (!isLv1User && !inMgmtTree)) {
      setPendingApprovals([]);
      return;
    }
    const qs = new URLSearchParams({
      ownerDept: top,
      status: 'PENDING',
      t: String(Date.now()),
    });
    const res = await fetch(`/api/marketing/distributions?${qs}`);
    if (res.ok) {
      const list = await res.json();
      setPendingApprovals(Array.isArray(list) ? list : []);
    } else {
      setPendingApprovals([]);
    }
  };

  const fetchData = async () => {
    setLoadError(null);
    try {
      const ts = Date.now();
      const [uRes, iRes, purRes, itemRes, sysRes, unitsRes, summaryRes] = await Promise.all([
        fetch('/api/auth/me?t=' + ts),
        fetch('/api/admin/interface?t=' + ts),
        fetch('/api/marketing/purchases?t=' + ts), 
        fetch('/api/marketing/items?raw=1&t=' + ts),
        fetch('/api/admin/config?t=' + ts),
        fetch('/api/admin/units?active=true&t=' + ts),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`),
      ]);

      const failed: string[] = [];
      if (!uRes.ok) failed.push('사용자');
      if (!purRes.ok) failed.push('입고');
      if (!itemRes.ok) failed.push('물품');

      if (purRes.ok) setPurchases(await purRes.json());
      else setPurchases([]);
      if (itemRes.ok) setItems(await itemRes.json());
      else setItems([]);

      let sysCfg: any = null;
      if (sysRes.ok) {
        sysCfg = await sysRes.json();
        setSystemConfig(sysCfg);
      }

      let loadedUnits: any[] = [];
      if (unitsRes.ok) {
        loadedUnits = await unitsRes.json();
        setUnits(loadedUnits);
      }

      let user: any = null;
      if (uRes.ok) {
        user = await uRes.json();
        setCurrentUser(user);

        if (user?.unit?.unit_name) {
          const distResult = await loadDistributions(user, loadedUnits, sysCfg, distViewMode);
          if (distResult === 'error') failed.push('지급이력');
          await loadPendingApprovals(user, loadedUnits, sysCfg);
        }
      }

      if (iRes.ok) {
        const interfaces = await iRes.json();
        const config = interfaces.find((m: any) => m.path === MENU_PATH);
        setInterfaceConfig(config);
      }

      if (summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);

      if (failed.length > 0) {
        const status = [uRes, purRes, itemRes].find((r) => !r.ok)?.status;
        setLoadError(
          status === 401
            ? '로그인 세션이 만료되었거나 권한이 없습니다.'
            : status === 403
              ? '이 메뉴에 대한 접근 권한이 없습니다.'
              : `일부 데이터 로드 실패: ${failed.join(', ')}`
        );
      }
    } catch(e) {
      console.error("데이터 통합 로드 실패:", e);
      setLoadError('데이터 로드 중 오류가 발생했습니다.');
    }
    setLoading(false);
  };

  const handleDistViewMode = async (mode: 'SENDER' | 'OWNER') => {
    if (mode === distViewMode) return;
    setDistViewMode(mode);
    setCurrentPage(1);
    setSelectedIds(new Set());
    setDistOwnerFilter('ALL');
    setDistSenderFilter('ALL');
    if (!currentUser) return;
    setLoading(true);
    const result = await loadDistributions(currentUser, units, systemConfig, mode);
    // 더 최신 전환 요청이 있으면 로딩 해제하지 않음 (늦은 응답 레이스 방지)
    if (result !== 'stale') setLoading(false);
  };
  
  const safeArray = (val: any) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { 
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch(e) { 
        return val.split(',').map(s => s.trim()); 
      }
    }
    return [];
  };

  const myRoles = useMemo(() => normalizeRoles(currentUser?.roles), [currentUser]);
  const isLv1 = myRoles.includes('LV_1');
  
  const editState = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig),
    [currentUser, interfaceConfig]
  );
  const canEdit = editState.isEditor;

  /** assertCanEditOwnerDept / Catalog checkEditPermission 과 동일 — 행별 입고취소·복원 */
  const checkEditPermission = (itemOwnerDept?: string | null) => {
    if (!currentUser || !itemOwnerDept) return false;
    if (isLv1) return true;
    if (!systemConfig || !editState.isEditor) return false;

    const myCenter = currentUser.unit?.unit_name;
    const myHq = currentUser.unit?.parent?.unit_name;
    const globalMgmtDept = systemConfig.global_mgmt_dept;
    const top = resolveTopOrgName(units);

    if (top && itemOwnerDept === top) {
      return canEditTopOrgMarketingAsset({
        ownerDept: itemOwnerDept,
        topOrgName: top,
        myUnitName: myCenter,
        myHqName: myHq,
        globalMgmtDept,
        units,
      });
    }

    const scope = editState.editScope;
    if (scope === 'TOTAL') return true;
    if ((scope === 'DEPT' || scope === 'OWN') && itemOwnerDept === myCenter) return true;
    return false;
  };

  /** 타인 건 철회: LV_1·메뉴 마스터만. 그 외는 본인 건만 */
  const isMenuMaster =
    isLv1 || (!!currentUser?.id && interfaceConfig?.master_editor_id === currentUser.id);
  const canCancelDist = (d: any) =>
    d?.status !== 'REJECTED' && (isOwnDistribution(d, currentUser) || isMenuMaster);

  const handleDelete = async (id: string) => {
    const dist = distributions.find((d) => d.id === id);
    if (!dist || !canCancelDist(dist)) {
      return alert('❌ 본인 신청만 철회할 수 있습니다. (타인 건은 LV_1·마스터만 가능)');
    }
    if (!confirm('정말 지급 신청을 철회하시겠습니까?\n(철회 시 카탈로그 재고가 자동으로 복구됩니다.)')) return;
    const res = await fetch(`/api/marketing/distributions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setDistributions(prev => prev.filter(d => d.id !== id));
      alert('지급 신청이 정상적으로 철회되었습니다.');
      fetchData();
    } else {
      alert(await readApiError(res, '철회에 실패했습니다.'));
    }
  };

  const handleCancelPurchase = async (id: string, ownerDept?: string | null) => {
    if (!checkEditPermission(ownerDept)) return alert('❌ 해당 물품 소속에 대한 입고 취소 권한이 없습니다.');
    if (!confirm('이 입고 내역을 취소하시겠습니까?\n(취소 시 카탈로그의 부서 재고도 함께 차감됩니다.)')) return;
    const res = await fetch(`/api/marketing/purchases?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert('입고가 성공적으로 취소되었습니다.');
      fetchData();
    } else {
      alert(await readApiError(res, '취소 실패. 이미 소진된 재고이거나 권한 에러입니다.'));
    }
  };

  const handleRestoreItem = async (id: string, ownerDept?: string | null) => {
    if (!checkEditPermission(ownerDept)) return alert('❌ 해당 물품 소속에 대한 복원 권한이 없습니다.');
    if (!confirm('종료된 상품을 다시 활성 물품 리스트로 복구하시겠습니까?')) return;
    const res = await fetch('/api/marketing/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_archived: false })
    });
    if (res.ok) { alert('활성 리스트로 복원되었습니다.'); fetchData(); }
    else alert(await readApiError(res, '복원에 실패했습니다.'));
  };

  const handlePermanentDeleteItem = async (id: string) => {
    if (!isLv1) return alert('❌ 영구 삭제는 최고 관리자(LV_1)만 가능합니다.');
    if (!confirm('종료(아카이브) 물품을 영구 삭제합니다.\n지급·입고 이력도 함께 삭제되며 되돌릴 수 없습니다.\n계속할까요?')) return;
    const res = await fetch(`/api/marketing/items?id=${id}&force=1`, { method: 'DELETE' });
    if (res.ok) { alert('완전히 삭제되었습니다.'); fetchData(); }
    else alert(await readApiError(res, '영구 삭제에 실패했습니다.'));
  };

  const handleApprovePending = async (id: string) => {
    if (!confirm('이 승인 요청을 승인하시겠습니까?\n지급일자가 오늘로 확정됩니다.')) return;
    setApprovalBusyId(id);
    try {
      const res = await fetch('/api/marketing/distributions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          action: 'approve',
          dist_date: getKSTDateString(),
        }),
      });
      if (!res.ok) {
        alert(await readApiError(res, '승인 실패'));
        return;
      }
      setPendingApprovals((prev) => {
        const next = prev.filter((d) => d.id !== id);
        if (next.length === 0) setApprovalModalOpen(false);
        return next;
      });
      await loadDistributions(currentUser, units, systemConfig, distViewMode);
    } finally {
      setApprovalBusyId(null);
    }
  };

  const handleRejectPending = async () => {
    if (!rejectTarget?.id) return;
    const reason = rejectReason.trim();
    if (!reason) {
      alert('반려 사유를 입력해 주세요.');
      return;
    }
    const id = rejectTarget.id as string;
    setApprovalBusyId(id);
    try {
      const res = await fetch('/api/marketing/distributions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'reject', reject_reason: reason }),
      });
      if (!res.ok) {
        alert(await readApiError(res, '반려 실패'));
        return;
      }
      setPendingApprovals((prev) => {
        const next = prev.filter((d) => d.id !== id);
        if (next.length === 0) setApprovalModalOpen(false);
        return next;
      });
      setRejectTarget(null);
      setRejectReason('');
      await loadDistributions(currentUser, units, systemConfig, distViewMode);
      const iRes = await fetch('/api/marketing/items?raw=1&t=' + Date.now());
      if (iRes.ok) setItems(await iRes.json());
    } finally {
      setApprovalBusyId(null);
    }
  };

// 🚀 동적 권한 및 부서(본부/센터) 체계 확인 변수
const mgmtDept = systemConfig?.global_mgmt_dept;
const topOrgName = resolveTopOrgName(units);

const myDeptName = currentUser?.unit?.unit_name;

const isMgmtTree = isGlobalMgmtOrgMember({
  myUnitName: myDeptName,
  myUnitId: currentUser?.unit_id || currentUser?.unit?.id,
  globalMgmtDept: mgmtDept,
  units,
});
/** 승인대기함 열람: LV_1 또는 GLOBAL_MGMT 트리 */
const canSeeApprovalInbox = isLv1 || isMgmtTree;
/** 승인/반려 처리: LV_1 또는 (mgmt 트리 + 메뉴 편집권) — 열람만이면 버튼 숨김 */
const canProcessApprovals = isLv1 || (isMgmtTree && canEdit);
  
  // ==========================================
  // [탭 1] 지급 이력 연산 로직 (부서/하위센터 + 이메일 식별)
  // ==========================================
  const availableYears = useMemo(() => {
    const years = distributions
      .map((d) => getKSTYearMonth(getDistBusinessDate(d) as string)?.year?.toString())
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a,b) => b.localeCompare(a));
    const currentYear = kstYear.toString();
    if (!unique.includes(currentYear)) unique.push(currentYear);
    return unique;
  }, [distributions, kstYear]);

  // 🚀 필터 드롭다운을 위한 지급 이력 내 물품 소속 / 신청자 소속 추출
  const availableDistOwners = useMemo(() => {
    return Array.from(new Set(distributions.map(d => d.item?.owner_dept || '미지정'))).sort();
  }, [distributions]);

  const availableDistSenders = useMemo(() => {
    return Array.from(new Set(distributions.map((d) => d.sender_dept || '미지정'))).sort((a, b) =>
      a.localeCompare(b, 'ko')
    );
  }, [distributions]);
  
  const baseFilteredList = useMemo(() => {
    const itemQ = searchItemQuery.trim().toLowerCase();
    const clientQ = searchClientQuery.trim().toLowerCase();
    return distributions.filter(d => {
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      const yearMatch = selectedYear === 'ALL' || ym?.year?.toString() === selectedYear;
      
      // 🚀 [추가] 월(달) 매칭 로직
      const dMonth = ym ? String(ym.month).padStart(2, '0') : '';
      const monthMatch = selectedMonth === 'ALL' || dMonth === selectedMonth;

      const ownerMatch = distOwnerFilter === 'ALL' || (d.item?.owner_dept || '미지정') === distOwnerFilter;
      const senderMatch =
        distSenderFilter === 'ALL' || (d.sender_dept || '미지정') === distSenderFilter;
      const itemMatch = !itemQ || (d.item?.name || '').toLowerCase().includes(itemQ);
      const clientMatch = !clientQ || (d.client_name || '').toLowerCase().includes(clientQ);
        
      return yearMatch && monthMatch && ownerMatch && senderMatch && itemMatch && clientMatch;
    })
    // 재고신청(createdAt) 시각 최신순 — 같은 지급일자여도 신청 쌓인 순서. 순번(reverseNo)도 이 기준
    .sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }, [distributions, selectedYear, selectedMonth, distOwnerFilter, distSenderFilter, searchItemQuery, searchClientQuery]);
  
  const totalAmountForYear = useMemo(() => {
    return baseFilteredList.reduce((acc, cur) => {
      if (cur.status === 'REJECTED' || cur.status === 'PENDING') return acc;
      return acc + (cur.item?.unit_price || 0) * cur.qty;
    }, 0);
  }, [baseFilteredList]);

  const totalCountForYear = useMemo(
    () =>
      baseFilteredList.filter((d) => d.status !== 'REJECTED' && d.status !== 'PENDING').length,
    [baseFilteredList]
  );

  const clientStats = useMemo(() => {
    const statsMap: Record<string, { price: number; count: number }> = {};
    baseFilteredList.forEach((d) => {
      if (d.status === 'REJECTED' || d.status === 'PENDING') return;
      const amount = (d.item?.unit_price || 0) * d.qty;
      if (!statsMap[d.client_name]) statsMap[d.client_name] = { price: 0, count: 0 };
      statsMap[d.client_name].price += amount;
      statsMap[d.client_name].count += 1;
    });
    return Object.entries(statsMap)
      .map(([name, { price, count }]) => ({
        name,
        price,
        count,
        percent: totalAmountForYear > 0 ? ((price / totalAmountForYear) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.price - a.price);
  }, [baseFilteredList, totalAmountForYear]);

  const finalFilteredList = useMemo(() => {
    // 칩 미선택: 전체 이력(대기·반려 포함). 칩 선택: 칩 집계와 동일하게 확정만
    if (!selectedClientFilter) return baseFilteredList;
    return baseFilteredList.filter(
      (d) =>
        d.client_name === selectedClientFilter &&
        d.status !== 'REJECTED' &&
        d.status !== 'PENDING'
    );
  }, [baseFilteredList, selectedClientFilter]);
  
  const totalPages = Math.max(1, Math.ceil(finalFilteredList.length / itemsPerPage));
  const paginatedList = finalFilteredList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  // 🚀 selectedMonth 변경 시에도 페이지 초기화되도록 추가
  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()); }, [selectedYear, selectedMonth, searchItemQuery, searchClientQuery, selectedClientFilter, distOwnerFilter, distSenderFilter]);

  const toggleAll = () => {
    const currentPageIds = paginatedList.map(d => d.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
  
// ==========================================
  // 🚀 [탭 2] 입고 내역 — 지급「관리소속」·카탈로그 편집 가능 스코프와 동일
  // 나+하위센터 (+ GLOBAL_MGMT 트리면 Organization 풀) / LV_1: 전체
  // ==========================================
  const ownerScopedDeptNames = useMemo(
    () =>
      new Set(
        getOwnerScopedDeptNames({
          myDeptName,
          myUnitId: currentUser?.unit_id || currentUser?.unit?.id,
          units,
          topOrgName,
          globalMgmtDept: mgmtDept,
          isLv1,
        })
      ),
    [myDeptName, currentUser, units, topOrgName, mgmtDept, isLv1]
  );

  const myDeptPurchases = useMemo(() => {
    if (ownerScopedDeptNames.size === 0 && !isLv1) return [];
    return purchases.filter((p) => {
      const owner = p.item?.owner_dept;
      if (!owner) return false;
      if (isLv1) return true;
      return ownerScopedDeptNames.has(owner);
    });
  }, [purchases, ownerScopedDeptNames, isLv1]);

  const purchaseYears = useMemo(() => {
    const years = myDeptPurchases
      .map((p) => getKSTYearMonth(p.purchase_date)?.year?.toString())
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curYear = kstYear.toString();
    if (!unique.includes(curYear)) unique.push(curYear);
    return unique;
  }, [myDeptPurchases, kstYear]);

  // 🚀 필터 드롭다운을 위한 소속 종류 추출
  const availablePurchaseOwners = useMemo(() => {
    return Array.from(new Set(myDeptPurchases.map(p => p.item?.owner_dept || '미지정'))).sort();
  }, [myDeptPurchases]);

  const baseFilteredPurchases = useMemo(() => {
    const itemQ = purchaseItemQuery.trim().toLowerCase();
    const vendorQ = purchaseVendorQuery.trim().toLowerCase();
    return myDeptPurchases.filter(p => {
      const ym = getKSTYearMonth(p.purchase_date);
      const yearMatch = purchaseYear === 'ALL' || ym?.year?.toString() === purchaseYear;
      const dMonth = ym ? String(ym.month).padStart(2, '0') : '';
      const monthMatch = purchaseMonth === 'ALL' || dMonth === purchaseMonth;
      const ownerMatch = purchaseOwnerFilter === 'ALL' || p.item?.owner_dept === purchaseOwnerFilter;
      const vendorName = (p.old_vendor || (typeof p.vendor === 'string' ? p.vendor : '') || '').toLowerCase();
      const itemMatch = !itemQ || (p.item?.name || '').toLowerCase().includes(itemQ);
      const vendorMatch = !vendorQ || vendorName.includes(vendorQ);
      return yearMatch && monthMatch && ownerMatch && itemMatch && vendorMatch;
    }).sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime());
  }, [myDeptPurchases, purchaseYear, purchaseMonth, purchaseItemQuery, purchaseVendorQuery, purchaseOwnerFilter]);

  const totalPurchaseAmount = useMemo(() => {
    return baseFilteredPurchases.reduce((acc, cur) => acc + (cur.total_price || 0), 0);
  }, [baseFilteredPurchases]);

  const totalPurchaseCount = baseFilteredPurchases.length;

  const purchaseItemStats = useMemo(() => {
    const statsMap: Record<string, { price: number; count: number }> = {};
    baseFilteredPurchases.forEach((p) => {
      const itemName = p.item?.name || '(삭제된 물품)';
      if (!statsMap[itemName]) statsMap[itemName] = { price: 0, count: 0 };
      statsMap[itemName].price += p.total_price || 0;
      statsMap[itemName].count += 1;
    });
    return Object.entries(statsMap)
      .map(([name, { price, count }]) => ({
        name,
        price,
        count,
        percent: totalPurchaseAmount > 0 ? ((price / totalPurchaseAmount) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.price - a.price);
  }, [baseFilteredPurchases, totalPurchaseAmount]);

  const finalFilteredPurchases = useMemo(() => {
    if (!selectedItemFilter) return baseFilteredPurchases;
    return baseFilteredPurchases.filter(p => (p.item?.name || '(삭제된 물품)') === selectedItemFilter);
  }, [baseFilteredPurchases, selectedItemFilter]);

  const totalPurchasePages = Math.max(1, Math.ceil(finalFilteredPurchases.length / itemsPerPage));
  const paginatedPurchases = finalFilteredPurchases.slice((currentPurchasePage - 1) * itemsPerPage, currentPurchasePage * itemsPerPage);

  useEffect(() => {
    setCurrentPurchasePage(1);
    setSelectedPurchaseIds(new Set());
  }, [purchaseYear, purchaseMonth, purchaseItemQuery, purchaseVendorQuery, selectedItemFilter, purchaseOwnerFilter]);

  const toggleAllPurchases = () => {
    const currentIds = paginatedPurchases.map(p => p.id);
    const allSelected = currentIds.length > 0 && currentIds.every(id => selectedPurchaseIds.has(id));
    const next = new Set(selectedPurchaseIds);
    if (allSelected) currentIds.forEach(id => next.delete(id));
    else currentIds.forEach(id => next.add(id));
    setSelectedPurchaseIds(next);
  };

// ==========================================
  // 🚀 [탭 3] 종료 물품 — 입고·관리소속과 동일 스코프
  // ==========================================
  const myDeptEndedItems = useMemo(() => {
    if (ownerScopedDeptNames.size === 0 && !isLv1) return [];
    return items.filter((item) => {
      if (!item.is_archived) return false;
      const owner = item.owner_dept;
      if (!owner) return false;
      if (isLv1) return true;
      return ownerScopedDeptNames.has(owner);
    });
  }, [items, ownerScopedDeptNames, isLv1]);

  const endedYears = useMemo(() => {
    const years = myDeptEndedItems
      .map((i) => getKSTYearMonth(i.updatedAt || i.createdAt)?.year?.toString())
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curYear = kstYear.toString();
    if (!unique.includes(curYear)) unique.push(curYear);
    return unique;
  }, [myDeptEndedItems, kstYear]);

  // 🚀 필터 드롭다운을 위한 소속 종류 추출
  const availableEndedOwners = useMemo(() => {
    return Array.from(new Set(myDeptEndedItems.map(i => i.owner_dept || '미지정'))).sort();
  }, [myDeptEndedItems]);

  const filteredEndedItems = useMemo(() => {
    const itemQ = endedItemQuery.trim().toLowerCase();
    const regQ = endedRegistrantQuery.trim().toLowerCase();
    return myDeptEndedItems.filter(item => {
      const ym = getKSTYearMonth(item.updatedAt || item.createdAt);
      const yearMatch = endedYearFilter === 'ALL' || ym?.year?.toString() === endedYearFilter;
      const dMonth = ym ? String(ym.month).padStart(2, '0') : '';
      const monthMatch = endedMonthFilter === 'ALL' || dMonth === endedMonthFilter;
      const ownerMatch = endedOwnerFilter === 'ALL' || item.owner_dept === endedOwnerFilter;
      const reg = resolveItemRegistrant(item);
      const itemMatch = !itemQ || (item.name || '').toLowerCase().includes(itemQ);
      const registrantMatch =
        !regQ ||
        (reg.name || '').toLowerCase().includes(regQ) ||
        (reg.dept || '').toLowerCase().includes(regQ) ||
        (reg.email || '').toLowerCase().includes(regQ);
      return yearMatch && monthMatch && ownerMatch && itemMatch && registrantMatch;
    }).sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }, [myDeptEndedItems, endedYearFilter, endedMonthFilter, endedOwnerFilter, endedItemQuery, endedRegistrantQuery]);

  const paginatedEndedItems = useMemo(() => {
    const start = (endedPage - 1) * itemsPerPage;
    return filteredEndedItems.slice(start, start + itemsPerPage);
  }, [filteredEndedItems, endedPage]);

  const totalEndedPages = Math.max(1, Math.ceil(filteredEndedItems.length / itemsPerPage));

  useEffect(() => {
    setEndedPage(1);
    setSelectedEndedIds(new Set());
  }, [endedYearFilter, endedMonthFilter, endedOwnerFilter, endedItemQuery, endedRegistrantQuery]);

  const toggleAllEnded = () => {
    const currentIds = paginatedEndedItems.map(i => i.id);
    const allSelected = currentIds.length > 0 && currentIds.every(id => selectedEndedIds.has(id));
    const next = new Set(selectedEndedIds);
    if (allSelected) currentIds.forEach(id => next.delete(id));
    else currentIds.forEach(id => next.add(id));
    setSelectedEndedIds(next);
  };

  // ==========================================
  // 엑셀 다운로드 로직 모음
  // ==========================================
  const handleDownloadExcel = () => {
    // 선택 시에도 화면 연·월·검색 필터(finalFilteredList)와 교집합 — 범위 밖 ID 혼입 방지
    const targetList =
      selectedIds.size > 0
        ? finalFilteredList.filter((d) => selectedIds.has(d.id))
        : finalFilteredList;
    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");
    const exportData = targetList.map((d) => ({
      '재고신청일': getKSTDateString(d.createdAt),
      '지급일자':
        d.status === 'PENDING'
          ? '지급대기'
          : d.status === 'REJECTED'
            ? '반려'
            : getKSTDateString(d.dist_date || d.createdAt),
      '상태': d.status === 'REJECTED' ? '반려' : d.status === 'PENDING' ? '지급대기' : '확정',
      '반려사유': d.reject_reason || '',
      '고객사(회사명)': d.client_name,
      '고객사 부서': d.client_dept,
      '물품소속': d.item?.owner_dept || '-',
      '물품명': d.item?.name || '(삭제됨)',
      '단가(원)': d.item?.unit_price,
      '개수': d.status === 'REJECTED' ? '' : d.qty,
      '단위': d.item?.unit || 'EA',
      '총금액(원)': d.status === 'REJECTED' ? '' : (d.item?.unit_price || 0) * d.qty,
      '지급목적': d.purpose,
      '신청자': d.sender_name,
      '신청자소속': d.sender_dept,
      '신청자이메일': d.sender_email || '-',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서지급현황");
    XLSX.writeFile(wb, `${myDeptName || '부서'}_지급현황대장_${selectedYear}년.xlsx`);
  };

  const handleDownloadPurchaseExcel = () => {
    const targetList =
      selectedPurchaseIds.size > 0
        ? finalFilteredPurchases.filter((p) => selectedPurchaseIds.has(p.id))
        : finalFilteredPurchases;
    if (targetList.length === 0) return alert("다운로드할 입고 데이터가 없습니다.");
    const exportData = targetList.map((p) => {
      let extraCost = Number(p.extra_cost) || 0;
      if (!p.extra_cost && typeof p.note === 'string' && p.note.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(p.note);
          extraCost = Number(parsed?.extra_cost) || 0;
        } catch { /* keep */ }
      }
      return {
        '입고일자': getKSTDateString(p.purchase_date),
        '물품소속': p.item?.owner_dept || '-',
        '물품명': p.item?.name || '(삭제됨)',
        '단가(원)': p.unit_price,
        '수량': p.qty,
        '부대비용(원)': extraCost,
        '총 금액(원)': p.total_price,
        '구매/공급처': p.old_vendor || (typeof p.vendor === 'string' ? p.vendor : '') || '-',
        '등록자': p.purchaser_name,
        '등록자소속': p.purchaser_dept,
        '등록자이메일': p.purchaser_email || '-',
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서입고현황");
    XLSX.writeFile(wb, `${myDeptName || '부서'}_물품입고대장_${purchaseYear}년.xlsx`);
  };

  const handleDownloadEndedExcel = () => {
    const targetList =
      selectedEndedIds.size > 0
        ? filteredEndedItems.filter((i) => selectedEndedIds.has(i.id))
        : filteredEndedItems;
    if (targetList.length === 0) return alert("다운로드할 종료 물품 데이터가 없습니다.");
    const exportData = targetList.map((item) => {
      const reg = resolveItemRegistrant(item);
      return {
        '종료일자': getKSTDateString(item.updatedAt || item.createdAt),
        '물품소속': item.owner_dept,
        '물품명': item.name,
        '단가(원)': item.unit_price,
        '재고수량': item.current_stock,
        '단위': item.unit || 'EA',
        '종료처리자': reg.name,
        '종료처리자소속': reg.dept,
        '종료처리자이메일': reg.email || '-',
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "종료물품장부");
    XLSX.writeFile(wb, `${myDeptName || '부서'}_종료물품장부_${endedYearFilter}년.xlsx`);
  };
  
  if (loading) return <LoadingState />;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      {loadError && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button type="button" onClick={() => { setLoading(true); fetchData(); }} className="shrink-0 rounded-lg bg-amber-100 px-3 py-1 text-xs hover:bg-amber-200">
            다시 시도
          </button>
        </div>
      )}
      
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2.5">
            DEPARTMENT DISTRIBUTION STATUS
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-indigo-400 font-normal">{myDeptName || '소속 부서'}</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-extrabold">지급 현황 마스터 대장</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            부서원 지급·입고·종료 이력을 모니터링합니다.
          </p>
          {permissionSummary && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-slate-50 shadow-sm">
                <span>👑 Master 책임자:</span>
                <span>{permissionSummary.masterName}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
                <span>👁️ Access:</span>
                <span>{permissionSummary.accessDesignate}</span>
                <span className="opacity-50">|</span>
                <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.accessLevel}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
                <span>✍️ Edit:</span>
                <span>{permissionSummary.editDesignate}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.editLevel}</span>
              </div>
              {!canEdit && (
                <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
                  편집 권한 없음 — 조회만 가능
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 탭 네비게이션 — equipment inventory / survey admin 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('DIST')}
            className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
              activeTab === 'DIST'
                ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>🎁 부서 지급 이력</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('PURCHASE');
              setApprovalModalOpen(false);
            }}
            className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
              activeTab === 'PURCHASE'
                ? 'bg-white text-emerald-600 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📦 입고 / 매입 장부</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('ARCHIVED');
              setApprovalModalOpen(false);
            }}
            className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
              activeTab === 'ARCHIVED'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>🛑 종료된 과거 물품</span>
          </button>
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
          ※ 탭을 클릭하여 지급·입고·종료 내역을 전환합니다.
        </p>
      </div>

      {/* GLOBAL_MGMT / LV_1: Organization 풀 승인대기 — 부서 지급 이력 탭에서만 */}
      {activeTab === 'DIST' && canSeeApprovalInbox && pendingApprovals.length > 0 && (
        <button
          type="button"
          onClick={() => setApprovalModalOpen(true)}
          className="w-full text-left bg-amber-50 border border-amber-200 hover:bg-amber-100/80 hover:border-amber-300 rounded-[1.5rem] px-5 py-4 shadow-sm transition-colors group"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center text-lg shrink-0 shadow-sm">
                ⏳
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black text-amber-900">
                  승인 대기 {pendingApprovals.length.toLocaleString()}건
                </p>
                <p className="text-[11px] font-bold text-amber-700/80 mt-0.5 truncate">
                  {canProcessApprovals
                    ? '전사(Organization) 풀 지급 승인 요청 · 클릭하여 확인'
                    : '전사(Organization) 풀 지급 승인 요청 · 열람만 가능 (편집 권한 없음)'}
                </p>
              </div>
            </div>
            <span className="text-amber-600 group-hover:translate-x-0.5 transition-transform font-black text-sm shrink-0">
              확인하기 →
            </span>
          </div>
        </button>
      )}

{/* ========================================================================= */}
      {/* [탭 1] 부서 지급 이력 화면 (NO 칼럼 포함) */}
      {/* ========================================================================= */}
      {activeTab === 'DIST' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">

          {/* 2차 세그먼트 — 상위 탭과 동일 톤, 지급 대장 렌즈만 전환 */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-1.5 p-1 bg-slate-200/50 rounded-[1rem] w-fit shadow-inner">
                <button
                  type="button"
                  onClick={() => handleDistViewMode('OWNER')}
                  className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all duration-300 ${
                    distViewMode === 'OWNER'
                      ? 'bg-white text-indigo-600 shadow-md'
                      : 'text-slate-500 hover:bg-slate-300/50 hover:text-slate-700'
                  }`}
                >
                  관리 물품 기준
                </button>
                <button
                  type="button"
                  onClick={() => handleDistViewMode('SENDER')}
                  className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all duration-300 ${
                    distViewMode === 'SENDER'
                      ? 'bg-white text-indigo-600 shadow-md'
                      : 'text-slate-500 hover:bg-slate-300/50 hover:text-slate-700'
                  }`}
                >
                  부서원 신청 기준
                </button>
              </div>
              <p className="text-[10px] font-bold text-slate-400 leading-snug max-w-xl">
                {distViewMode === 'OWNER'
                  ? isMgmtTree || isLv1
                    ? '내 조직·하위센터 재고 + 전사(Organization) 풀 소모 내역'
                    : '내 조직·하위센터 재고가 나간 내역 (예산/재고 관점)'
                  : '우리·하위 조직원이 신청한 내역'}
              </p>
            </div>
          </div>
      
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
            <HeaderLight
              title={distViewMode === 'SENDER' ? '부서 지급 이력 대장 (부서원 기준)' : '부서 지급 이력 대장 (관리소속 기준)'}
              count={finalFilteredList.length}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-black text-slate-400 uppercase">물품소속</span>
                  <select
                    value={distOwnerFilter}
                    onChange={(e) => setDistOwnerFilter(e.target.value)}
                    className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
                  >
                    <option value="ALL">전체</option>
                    {availableDistOwners.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>

                  <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                  <span className="text-[10px] font-black text-slate-400 uppercase">신청자소속</span>
                  <select
                    value={distSenderFilter}
                    onChange={(e) => setDistSenderFilter(e.target.value)}
                    className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
                  >
                    <option value="ALL">전체</option>
                    {availableDistSenders.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>

                  <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                  <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                  >
                    <option value="ALL">전체</option>
                    {availableYears.map((y) => (
                      <option key={y} value={y}>{y}년</option>
                    ))}
                  </select>

                  <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                  <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                  >
                    <option value="ALL">전체</option>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                      <option key={m} value={m}>{m}월</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative w-40">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">📦</span>
                    <input
                      type="text"
                      placeholder="물품명 검색..."
                      value={searchItemQuery}
                      onChange={(e) => setSearchItemQuery(e.target.value)}
                      className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                    />
                  </div>
                  <div className="relative w-36">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🏢</span>
                    <input
                      type="text"
                      placeholder="고객사 검색..."
                      value={searchClientQuery}
                      onChange={(e) => setSearchClientQuery(e.target.value)}
                      className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadExcel}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
                >
                  {selectedIds.size > 0
                    ? `선택 EXCEL 다운로드(${selectedIds.size})`
                    : '화면 목록 EXCEL 다운로드'}
                </button>
              </div>
            </HeaderLight>

            <div className="p-6 bg-slate-50/70 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm min-h-[110px] flex flex-col justify-center">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                  부서 총 지급액/지급건 ({selectedYear === 'ALL' ? '전체' : `${selectedYear}년`})
                </span>
                <div className="text-xl font-mono font-black text-indigo-600 mt-1">
                  {totalAmountForYear.toLocaleString()}
                  <span className="text-xs text-slate-500 font-sans font-bold">원</span>
                  <span className="text-slate-300 font-sans mx-1">/</span>
                  <span className="text-slate-800">{totalCountForYear.toLocaleString()}</span>
                  <span className="text-xs text-slate-500 font-sans font-bold">건</span>
                </div>
              </div>
              
              <div className="lg:col-span-9 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-2 block">
                고객사별 지급액 비중 요약 (클릭하여 해당 내역만 필터링)
                </span>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide max-h-[64px]">
                  {clientStats.length === 0 ? (
                    <span className="text-xs text-slate-400 font-bold py-2">지급 통계 데이터가 존재하지 않습니다.</span>
                  ) : clientStats.map(stat => {
                    const isSelected = selectedClientFilter === stat.name;
                    return (
                      <div 
                        key={stat.name} 
                        onClick={() => setSelectedClientFilter(prev => prev === stat.name ? null : stat.name)}
                        className={`shrink-0 border rounded-xl px-3 py-1.5 flex flex-col justify-center text-right min-w-[120px] max-w-[180px] cursor-pointer transition-colors ${
                          isSelected ? 'bg-indigo-100 border-indigo-300 shadow-sm' : 'bg-slate-50 border-slate-200 hover:bg-white hover:border-slate-300 hover:shadow-sm'
                        }`}
                      >
                        <span className={`text-[10px] font-black truncate text-left ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>{stat.name}</span>
                        <span className="text-[11px] font-mono font-black text-indigo-600 mt-0.5">
                          {stat.price.toLocaleString()}원
                          <span className="text-slate-400 font-sans font-bold">/{stat.count}건</span>
                          <strong className={`text-[10px] ml-1 ${isSelected ? 'text-indigo-600' : 'text-emerald-500'}`}>({stat.percent}%)</strong>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
      
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1320px] xl:min-w-full">
                <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                  <tr>
                    <th className="h-12 pl-4 w-10 text-center">
                      <input type="checkbox" checked={paginatedList.length > 0 && paginatedList.every(d => selectedIds.has(d.id))} onChange={toggleAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                    </th>
                    <th className="h-12 px-2 w-10 text-center">NO</th>
                    <th className="h-12 px-2 w-[88px] text-center whitespace-nowrap">재고신청일</th>
                    <th className="h-12 px-2 w-[88px] text-center whitespace-nowrap">지급일자</th>
                    <th className="h-12 px-2 w-28">고객사</th>
                    <th className="h-12 px-2 w-24">고객사부서</th>
                    <th className="h-12 px-2 w-24 text-center whitespace-nowrap">물품소속</th>
                    <th className="h-12 px-2 w-36 text-indigo-600">물품명</th>
                    <th className="h-12 px-2 w-[72px] text-center whitespace-nowrap">단가(원)</th>
                    <th className="h-12 px-2 w-14 text-center whitespace-nowrap">수량</th>
                    <th className="h-12 px-2 w-[88px] text-center text-indigo-600 whitespace-nowrap">총금액(원)</th>
                    <th className="h-12 px-2 w-28 text-left">지급목적</th>
                    <th className="h-12 px-2 w-32 text-center whitespace-nowrap">신청자(소속)</th>
                    <th className="h-12 px-2 w-28 text-center whitespace-nowrap">이메일</th>
                    <th className="h-12 pr-4 text-center w-24 whitespace-nowrap">관리기능</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                  {paginatedList.length === 0 ? (
                    <tr><td colSpan={15} className="p-16 text-center text-slate-400 text-xs">부서 지급 내역 장부가 비어있습니다.</td></tr>
                  ) : paginatedList.map((d, idx) => {
                    const isSelected = selectedIds.has(d.id);
                    const isPending = d.status === 'PENDING';
                    const isRejected = d.status === 'REJECTED';
                    const isRecentApproved = isRecentlyApproved(d);
                    const reqDate = getKSTDateString(d.createdAt);
                    const distDate = getKSTDateString(d.dist_date || d.createdAt);
                    const reverseNo = finalFilteredList.length - ((currentPage - 1) * itemsPerPage + idx);
                    const canCancel = canCancelDist(d);
                    
                    return (
                      <tr
                        key={d.id}
                        className={`transition-colors h-12 ${
                          isRejected
                            ? isSelected
                              ? 'bg-slate-200/80 text-red-500 [&_td]:text-red-500 [&_td]:line-through'
                              : 'bg-slate-100/80 text-red-500 hover:bg-slate-100 [&_td]:text-red-500 [&_td]:line-through'
                            : isPending
                              ? isSelected
                                ? 'bg-amber-100/90'
                                : 'bg-amber-50 hover:bg-amber-100/80'
                              : isRecentApproved
                                ? isSelected
                                  ? 'bg-emerald-100/90'
                                  : 'bg-emerald-50 hover:bg-emerald-100/80'
                                : isSelected
                                  ? 'bg-indigo-50/50'
                                  : 'hover:bg-slate-50/50'
                        }`}
                      >
                        <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(d.id) ? next.delete(d.id) : next.add(d.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                        </td>
                        <td className="px-2 text-center font-mono text-slate-500 tabular-nums !text-slate-500 !no-underline" style={isRejected ? { textDecoration: 'none' } : undefined}>{reverseNo}</td>
                        <td className={`px-2 text-center whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-800'}`}>{reqDate}</td>
                        <td className="px-2 text-center whitespace-nowrap">
                          {isRejected ? (
                            <span className="inline-flex flex-col items-center leading-tight" title={d.reject_reason || ''}>
                              <span className="inline-block font-black text-red-600 px-0.5 text-[10px]">
                                반려
                              </span>
                              {d.reject_reason ? (
                                <span className="text-[9px] font-bold text-red-400 truncate max-w-[88px] mt-0.5">
                                  {d.reject_reason}
                                </span>
                              ) : null}
                            </span>
                          ) : isPending ? (
                            <span className="inline-block font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[10px]">
                              지급대기
                            </span>
                          ) : isRecentApproved ? (
                            <span className="inline-flex flex-col items-center leading-tight">
                              <span className="text-slate-800 tabular-nums">{distDate}</span>
                              <span className="text-[9px] font-black text-emerald-600">승인완료</span>
                            </span>
                          ) : (
                            <span className="text-slate-800 tabular-nums">{distDate}</span>
                          )}
                        </td>
                        <td className={`px-2 truncate max-w-[112px] ${isRejected ? '' : 'text-slate-800'}`} title={d.client_name}>{d.client_name}</td>
                        <td className={`px-2 truncate max-w-[96px] ${isRejected ? '' : 'text-slate-700'}`} title={d.client_dept || ''}>{d.client_dept || '-'}</td>
                        <td className="px-2 text-center">
                          <span className={`inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${isRejected ? 'bg-transparent border-red-200 text-red-500' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{d.item?.owner_dept || '-'}</span>
                        </td>
                        <td className={`px-2 truncate max-w-[144px] ${isRejected ? '' : 'text-indigo-700'}`} title={d.item?.name || ''}>{d.item?.name || '(삭제됨)'}</td>
                        <td className={`px-2 text-center font-mono whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-700'}`}>{d.item?.unit_price?.toLocaleString()}</td>
                        <td className={`px-2 text-center font-mono whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-700'}`}>
                          {d.qty}
                          <span className={`text-[10px] font-sans ml-0.5 ${isRejected ? '' : 'text-slate-500'}`}>{d.item?.unit || 'EA'}</span>
                        </td>
                        <td className={`px-2 text-center font-mono whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-indigo-600'}`}>
                          {isRejected ? '-' : ((d.item?.unit_price || 0) * d.qty).toLocaleString()}
                        </td>
                        <td className={`px-2 truncate max-w-[112px] ${isRejected ? '' : 'text-slate-700'}`} title={isRejected && d.reject_reason ? `${d.purpose || ''} / 반려: ${d.reject_reason}` : d.purpose}>
                          {d.purpose}
                        </td>
                        <td className={`px-2 text-center ${isRejected ? '' : 'text-slate-700'}`}>
                          <div className="flex flex-col items-center justify-center leading-tight min-w-[7rem]">
                            <span className="truncate max-w-[120px]" title={d.sender_name || ''}>
                              {d.sender_name || '-'}
                            </span>
                            <span className={`text-[10px] truncate max-w-[120px] ${isRejected ? '' : 'text-slate-500'}`} title={d.sender_dept || ''}>
                              ({d.sender_dept || '-'})
                            </span>
                          </div>
                        </td>
                        <td className={`px-2 text-center truncate max-w-[120px] ${isRejected ? '' : 'text-slate-700'}`} title={d.sender_email || ''}>{d.sender_email || '-'}</td>
                        <td className="pr-4 text-center no-underline" style={isRejected ? { textDecoration: 'none' } : undefined} onClick={(e)=>e.stopPropagation()}>
                          {canCancel ? (
                            <button onClick={() => handleDelete(d.id)} className="w-full py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                              신청철회
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-300 font-bold no-underline" style={{ textDecoration: 'none' }}>-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {finalFilteredList.length > 0 && (
              <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
                ))}
                <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 🚀 [탭 2] 부서 입고(구매) 장부 화면 (물품소속 칼럼 & 필터 적용) */}
      {/* ========================================================================= */}
      {activeTab === 'PURCHASE' && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
          <HeaderLight title="부서 입고 내역 장부" count={finalFilteredPurchases.length}>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">물품소속</span>
                <select
                  value={purchaseOwnerFilter}
                  onChange={(e) => setPurchaseOwnerFilter(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
                >
                  <option value="ALL">전체</option>
                  {availablePurchaseOwners.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                <select
                  value={purchaseYear}
                  onChange={(e) => setPurchaseYear(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {purchaseYears.map((y) => (
                    <option key={y} value={y}>{y}년</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                <select
                  value={purchaseMonth}
                  onChange={(e) => setPurchaseMonth(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative w-40">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">📦</span>
                  <input
                    type="text"
                    placeholder="물품명 검색..."
                    value={purchaseItemQuery}
                    onChange={(e) => setPurchaseItemQuery(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                  />
                </div>
                <div className="relative w-36">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🏪</span>
                  <input
                    type="text"
                    placeholder="공급처 검색..."
                    value={purchaseVendorQuery}
                    onChange={(e) => setPurchaseVendorQuery(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownloadPurchaseExcel}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
              >
                {selectedPurchaseIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedPurchaseIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
            </div>
          </HeaderLight>

          <div className="p-6 bg-slate-50/70 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm min-h-[110px] flex flex-col justify-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                총 입고(구매)액/건
              </span>
              <div className="text-xl font-mono font-black text-emerald-600 mt-1">
                {totalPurchaseAmount.toLocaleString()}
                <span className="text-xs text-slate-500 font-sans font-bold">원</span>
                <span className="text-slate-300 font-sans mx-1">/</span>
                <span className="text-slate-800">{totalPurchaseCount.toLocaleString()}</span>
                <span className="text-xs text-slate-500 font-sans font-bold">건</span>
              </div>
            </div>
            
            <div className="lg:col-span-9 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-2 block">
                입고 금액 기준 물품 순위 (클릭 시 해당 품목만 필터링)
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide max-h-[64px]">
                {purchaseItemStats.length === 0 ? (
                  <span className="text-xs text-slate-400 font-bold py-2">입고 매입 통계가 존재하지 않습니다.</span>
                ) : purchaseItemStats.map(stat => {
                  const isSelected = selectedItemFilter === stat.name;
                  return (
                    <div 
                      key={stat.name} 
                      onClick={() => setSelectedItemFilter(prev => prev === stat.name ? null : stat.name)}
                      className={`shrink-0 border rounded-xl px-3 py-1.5 flex flex-col justify-center text-right min-w-[120px] max-w-[180px] cursor-pointer transition-colors ${
                        isSelected ? 'bg-emerald-100 border-emerald-300' : 'bg-slate-50 border-slate-200 hover:bg-white hover:border-slate-300'
                      }`}
                    >
                      <span className="text-[10px] font-black text-slate-700 truncate text-left">{stat.name}</span>
                      <span className="text-[11px] font-mono font-black text-emerald-600 mt-0.5">
                        {stat.price.toLocaleString()}원
                        <span className="text-slate-400 font-sans font-bold">/{stat.count}건</span>
                        <strong className="text-indigo-500 text-[10px] ml-0.5">({stat.percent}%)</strong>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px] xl:min-w-full">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 w-10 text-center">
                    <input type="checkbox" checked={paginatedPurchases.length > 0 && paginatedPurchases.every(p => selectedPurchaseIds.has(p.id))} onChange={toggleAllPurchases} className="w-3 h-3 accent-emerald-600 cursor-pointer" />
                  </th>
                  <th className="h-12 px-2 w-10 text-center">NO</th>
                  <th className="h-12 px-2 w-[88px] text-center whitespace-nowrap">입고일자</th>
                  <th className="h-12 px-2 w-24 text-center whitespace-nowrap">물품소속</th>
                  <th className="h-12 px-2 w-40 text-emerald-600">물품명</th>
                  <th className="h-12 px-2 w-[72px] text-center whitespace-nowrap">단가(원)</th>
                  <th className="h-12 px-2 w-14 text-center whitespace-nowrap">수량</th>
                  <th className="h-12 px-2 w-[88px] text-center whitespace-nowrap">부대비용(원)</th>
                  <th className="h-12 px-2 w-[88px] text-center text-emerald-600 whitespace-nowrap">총금액(원)</th>
                  <th className="h-12 px-2 w-32">구매/공급처</th>
                  <th className="h-12 px-2 w-32 text-center whitespace-nowrap">등록자(소속)</th>
                  <th className="h-12 px-2 w-28 text-center whitespace-nowrap">이메일</th>
                  <th className="h-12 pr-4 text-center w-24 whitespace-nowrap">관리기능</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedPurchases.length === 0 ? (
                  <tr><td colSpan={13} className="p-16 text-center text-slate-400 text-xs">배정된 매입 데이터가 없습니다.</td></tr>
                ) : paginatedPurchases.map((p, idx) => {
                  const isSelected = selectedPurchaseIds.has(p.id);
                  const pDate = getKSTDateString(p.purchase_date);
                  const reverseNo = finalFilteredPurchases.length - ((currentPurchasePage - 1) * itemsPerPage + idx);
                  const vendorLabel = p.old_vendor || (typeof p.vendor === 'string' ? p.vendor : '') || '-';
                  let extraCost = Number(p.extra_cost) || 0;
                  if (!p.extra_cost && typeof p.note === 'string' && p.note.trim().startsWith('{')) {
                    try {
                      const parsed = JSON.parse(p.note);
                      extraCost = Number(parsed?.extra_cost) || 0;
                    } catch { /* keep plain note */ }
                  }

                  return (
                    <tr key={p.id} className={`transition-colors h-12 ${isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50/50'}`}>
                      <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedPurchaseIds); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSelectedPurchaseIds(next); }} className="w-3 h-3 accent-emerald-600 cursor-pointer" />
                      </td>
                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{reverseNo}</td>
                      <td className="px-2 text-center text-slate-800 whitespace-nowrap tabular-nums">{pDate}</td>
                      <td className="px-2 text-center">
                        <span className="inline-block bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap">{p.item?.owner_dept || '-'}</span>
                      </td>
                      <td className="px-2 text-emerald-700 truncate max-w-[160px]" title={p.item?.name || ''}>{p.item?.name || '(삭제됨)'}</td>
                      <td className="px-2 text-center font-mono text-slate-700 whitespace-nowrap tabular-nums">{p.unit_price?.toLocaleString()}</td>
                      <td className="px-2 text-center font-mono text-slate-700 whitespace-nowrap tabular-nums">
                        {p.qty}
                        <span className="text-[10px] text-slate-500 font-sans ml-0.5">{p.item?.unit || 'EA'}</span>
                      </td>
                      <td className="px-2 text-center font-mono text-slate-700 whitespace-nowrap tabular-nums">{extraCost.toLocaleString()}</td>
                      <td className="px-2 text-center font-mono text-emerald-600 whitespace-nowrap tabular-nums">{(p.total_price || 0).toLocaleString()}</td>
                      <td className="px-2 text-slate-800 truncate max-w-[130px]" title={vendorLabel}>{vendorLabel}</td>
                      <td className="px-2 text-center text-slate-700">
                        <div className="flex flex-col items-center justify-center leading-tight min-w-[7rem]">
                          <span className="truncate max-w-[120px]" title={p.purchaser_name || ''}>
                            {p.purchaser_name || '-'}
                          </span>
                          <span className="text-[10px] text-slate-500 truncate max-w-[120px]" title={p.purchaser_dept || ''}>
                            ({p.purchaser_dept || '-'})
                          </span>
                        </div>
                      </td>
                      <td className="px-2 text-center text-slate-700 truncate max-w-[120px]" title={p.purchaser_email || ''}>{p.purchaser_email || '-'}</td>
                      <td className="pr-4 text-center" onClick={(e)=>e.stopPropagation()}>
                        {checkEditPermission(p.item?.owner_dept) ? (
                          <button onClick={() => handleCancelPurchase(p.id, p.item?.owner_dept)} className="w-full py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                            입고 취소
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-300 font-bold">열람만</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {finalFilteredPurchases.length > 0 && (
            <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
              <button disabled={currentPurchasePage === 1} onClick={() => setCurrentPurchasePage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
              {Array.from({ length: totalPurchasePages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPurchasePage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPurchasePage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPurchasePage === totalPurchasePages} onClick={() => setCurrentPurchasePage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 🚀 [탭 3] 종료된 물품 화면 (물품소속 위치 이동 및 필터 적용) */}
      {/* ========================================================================= */}
      {activeTab === 'ARCHIVED' && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
          <HeaderLight title="종료 물품 리스트" count={filteredEndedItems.length}>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">물품소속</span>
                <select
                  value={endedOwnerFilter}
                  onChange={(e) => setEndedOwnerFilter(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
                >
                  <option value="ALL">전체</option>
                  {availableEndedOwners.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                <select
                  value={endedYearFilter}
                  onChange={(e) => setEndedYearFilter(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {endedYears.map((year) => (
                    <option key={year} value={year}>{year}년</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                <select
                  value={endedMonthFilter}
                  onChange={(e) => setEndedMonthFilter(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative w-40">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">📦</span>
                  <input
                    type="text"
                    placeholder="물품명 검색..."
                    value={endedItemQuery}
                    onChange={(e) => setEndedItemQuery(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                  />
                </div>
                <div className="relative w-36">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">👤</span>
                  <input
                    type="text"
                    placeholder="종료처리자 검색..."
                    value={endedRegistrantQuery}
                    onChange={(e) => setEndedRegistrantQuery(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownloadEndedExcel}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
              >
                {selectedEndedIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedEndedIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
            </div>
          </HeaderLight>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 w-10 text-center">
                    <input type="checkbox" checked={paginatedEndedItems.length > 0 && paginatedEndedItems.every(i => selectedEndedIds.has(i.id))} onChange={toggleAllEnded} className="w-3 h-3 accent-slate-800 cursor-pointer" />
                  </th>
                  <th className="h-12 px-2 w-10 text-center">NO</th>
                  <th className="h-12 px-2 w-[88px] text-center whitespace-nowrap">종료일자</th>
                  <th className="h-12 px-2 w-24 text-center whitespace-nowrap">물품소속</th>
                  <th className="h-12 px-2 w-48">물품명</th>
                  <th className="h-12 px-2 w-[72px] text-center whitespace-nowrap">단가(원)</th>
                  <th className="h-12 px-2 w-14 text-center whitespace-nowrap">재고수량</th>
                  <th className="h-12 px-2 w-32 text-center whitespace-nowrap">종료처리자(소속)</th>
                  <th className="h-12 px-2 w-28 text-center whitespace-nowrap">이메일</th>
                  <th className="h-12 pr-4 text-center w-36 whitespace-nowrap">관리액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedEndedItems.length === 0 ? (
                  <tr><td colSpan={10} className="p-16 text-center text-slate-400 text-xs">선택한 조건의 종료된 물품 내역이 없습니다.</td></tr>
                ) : paginatedEndedItems.map((item, index) => {
                     const reverseNo = filteredEndedItems.length - ((endedPage - 1) * itemsPerPage + index);
                     const endDate = getKSTDateString(item.updatedAt || item.createdAt);
                     const isSelected = selectedEndedIds.has(item.id);
                     const { name: regName, dept: regDept, email: regEmail } = resolveItemRegistrant(item);

                     return (
                      <tr key={item.id} className={`transition-colors h-12 ${isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                        <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedEndedIds); next.has(item.id) ? next.delete(item.id) : next.add(item.id); setSelectedEndedIds(next); }} className="w-3 h-3 accent-slate-800 cursor-pointer" />
                        </td>
                        <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{reverseNo}</td>
                        <td className="px-2 text-center text-slate-800 whitespace-nowrap tabular-nums">{endDate}</td>
                        <td className="px-2 text-center">
                          <span className="inline-block bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap">{item.owner_dept || '-'}</span>
                        </td>
                        <td className="px-2 text-slate-800 truncate max-w-[200px]" title={item.name}>{item.name}</td>
                        <td className="px-2 text-center font-mono text-slate-700 whitespace-nowrap tabular-nums">{item.unit_price?.toLocaleString()}</td>
                        <td className="px-2 text-center font-mono text-slate-700 whitespace-nowrap tabular-nums">
                          {item.current_stock}
                          <span className="text-[10px] text-slate-500 font-sans ml-0.5">{item.unit || 'EA'}</span>
                        </td>
                        <td className="px-2 text-center text-slate-700">
                          <div className="flex flex-col items-center justify-center leading-tight min-w-[7rem]">
                            <span className="truncate max-w-[120px]" title={regName}>{regName}</span>
                            <span className="text-[10px] text-slate-500 truncate max-w-[120px]" title={regDept}>({regDept})</span>
                          </div>
                        </td>
                        <td className="px-2 text-center text-slate-700 truncate max-w-[120px]" title={regEmail}>
                          {regEmail || '-'}
                        </td>
                        <td className="pr-4 text-center">
                           <div className="flex flex-row gap-1.5 justify-center">
                              {checkEditPermission(item.owner_dept) ? (
                                <button onClick={() => handleRestoreItem(item.id, item.owner_dept)} className="flex-1 py-1.5 bg-white border border-slate-300 text-slate-600 rounded-md text-[10px] font-black hover:bg-slate-800 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                                  ↺ 복구
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-300 font-bold">열람만</span>
                              )}
                              {isLv1 && (
                                <button onClick={() => handlePermanentDeleteItem(item.id)} className="flex-1 py-1.5 bg-red-50 text-red-500 border border-red-200 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors whitespace-nowrap">
                                  🗑️ 영구삭제(LV_1)
                                </button>
                              )}
                           </div>
                        </td>
                      </tr>
                   )
                  })}
              </tbody>
            </table>
          </div>

          {filteredEndedItems.length > 0 && (
            <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
              <button disabled={endedPage === 1} onClick={() => setEndedPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
              {Array.from({ length: totalEndedPages }).map((_, i) => (
                <button key={i} onClick={() => setEndedPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${endedPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={endedPage === totalEndedPages} onClick={() => setEndedPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
            </div>
          )}
        </div>
      )}

      {approvalModalOpen && activeTab === 'DIST' && canSeeApprovalInbox && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-[2rem] shadow-2xl flex flex-col border border-amber-100 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-amber-100 bg-amber-50 shrink-0">
              <div>
                <h3 className="text-lg font-black text-amber-900 flex items-center gap-2">
                  <span>⏳</span> 승인 대기 요청
                </h3>
                <p className="text-[11px] font-bold text-amber-700/80 mt-0.5">
                  전사(Organization) 풀 · {pendingApprovals.length.toLocaleString()}건
                  {!canProcessApprovals ? ' · 열람 전용' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApprovalModalOpen(false)}
                className="w-10 h-10 rounded-full bg-white border border-amber-200 text-amber-700 font-black hover:bg-amber-100"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {pendingApprovals.length === 0 ? (
                <p className="py-16 text-center text-sm font-bold text-slate-400">대기 중인 요청이 없습니다.</p>
              ) : (
                <table className="w-full text-left border-collapse min-w-[720px]">
                  <thead className="bg-amber-50/80 text-[10px] font-black text-amber-800/70 uppercase sticky top-0">
                    <tr>
                      <th className="py-2.5 px-2">신청일</th>
                      <th className="py-2.5 px-2">신청자</th>
                      <th className="py-2.5 px-2">고객사</th>
                      <th className="py-2.5 px-2">물품</th>
                      <th className="py-2.5 px-2 text-center">수량</th>
                      <th className="py-2.5 px-2">목적</th>
                      <th className="py-2.5 px-2 text-center w-40">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 text-[11px] font-bold text-slate-700">
                    {pendingApprovals.map((d) => (
                      <tr key={d.id} className="bg-amber-50/40 hover:bg-amber-50">
                        <td className="py-3 px-2 font-mono text-slate-500 whitespace-nowrap">
                          {getKSTDateString(d.createdAt)}
                        </td>
                        <td className="py-3 px-2">
                          <div className="leading-tight">
                            <p className="truncate max-w-[100px]" title={d.sender_name}>
                              {d.sender_name}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate max-w-[100px]">
                              {d.sender_dept || '-'}
                            </p>
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <div className="leading-tight">
                            <p className="truncate max-w-[120px]" title={d.client_name}>
                              {d.client_name}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate max-w-[120px]">
                              {d.client_dept || '-'}
                            </p>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-indigo-700 truncate max-w-[140px]" title={d.item?.name}>
                          {d.item?.name || '(삭제됨)'}
                        </td>
                        <td className="py-3 px-2 text-center font-mono">{d.qty}</td>
                        <td className="py-3 px-2 text-slate-500 truncate max-w-[140px]" title={d.purpose}>
                          {d.purpose || '-'}
                        </td>
                        <td className="py-3 px-2">
                          {canProcessApprovals ? (
                            <div className="flex gap-1.5 justify-center">
                              <button
                                type="button"
                                disabled={approvalBusyId === d.id}
                                onClick={() => handleApprovePending(d.id)}
                                className="px-2.5 py-1.5 rounded-lg text-[10px] font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                              >
                                승인
                              </button>
                              <button
                                type="button"
                                disabled={approvalBusyId === d.id}
                                onClick={() => {
                                  setRejectReason('');
                                  setRejectTarget(d);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-[10px] font-black bg-white border border-red-200 text-red-500 hover:bg-red-500 hover:text-white disabled:opacity-40"
                              >
                                반려
                              </button>
                            </div>
                          ) : (
                            <p className="text-center text-[10px] font-bold text-slate-400">열람만</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {rejectTarget && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-red-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-red-100 bg-red-50/70">
              <h3 className="text-sm font-black text-red-800">반려 사유 입력</h3>
              <p className="text-[11px] font-bold text-red-600/80 mt-0.5">
                재고는 복구되고, 이력대장에는 반려로 남습니다. (수량 집계 제외)
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] font-bold text-slate-600">
                <p className="truncate">{rejectTarget.item?.name || '(삭제됨)'} · {rejectTarget.qty}ea</p>
                <p className="truncate text-slate-400 mt-0.5">
                  {rejectTarget.client_name}
                  {rejectTarget.client_dept ? ` / ${rejectTarget.client_dept}` : ''}
                </p>
              </div>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                placeholder="반려 사유를 입력해 주세요."
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 resize-none"
              />
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  disabled={approvalBusyId === rejectTarget.id}
                  onClick={() => {
                    setRejectTarget(null);
                    setRejectReason('');
                  }}
                  className="px-3.5 py-2 rounded-xl text-[11px] font-black bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={approvalBusyId === rejectTarget.id || !rejectReason.trim()}
                  onClick={() => handleRejectPending()}
                  className="px-3.5 py-2 rounded-xl text-[11px] font-black bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                >
                  반려 확정
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
  
    </div>
  );
}
  
export default function DeptDistributionModule() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DeptDistributionContent />
    </Suspense>
  );
}