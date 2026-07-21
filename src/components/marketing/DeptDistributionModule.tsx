'use client';
  
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTYearMonth, getKSTNowYearMonth } from '@/utils/dateUtils';
import { resolveTopOrgName } from '@/utils/orgUnits';

// [UI 표준] 공통 HeaderLight 컴포넌트
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
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
  
function DeptDistributionContent() {
  const searchParams = useSearchParams();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]); 
  const [items, setItems] = useState<any[]>([]); 
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { year: kstYear, month: kstMonth } = getKSTNowYearMonth();
  
  // 🚀 활성 탭 상태 관리 (?tab=DIST|PURCHASE|ARCHIVED)
  const [activeTab, setActiveTab] = useState<'DIST' | 'PURCHASE' | 'ARCHIVED'>('DIST');

  useEffect(() => {
    const tab = (searchParams.get('tab') || '').toUpperCase();
    if (tab === 'PURCHASE' || tab === 'ARCHIVED' || tab === 'DIST') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // [탭 1] 지급 이력 상태
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(kstYear.toString());
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [distOwnerFilter, setDistOwnerFilter] = useState<string>('ALL');
  const [selectedClientFilter, setSelectedClientFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  // 미니 통계 (KST 기준 월)
  const currentMonthStr = String(kstMonth).padStart(2, '0');
  const [statsYear, setStatsYear] = useState(kstYear.toString());
  const [statsMonth, setStatsMonth] = useState(currentMonthStr);

const topDistributedItems = useMemo(() => {
  const filtered = distributions.filter(d => {
    const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
    if (!ym) return false;
    const matchYear = statsYear === 'ALL' || ym.year?.toString() === statsYear;
    const dMonth = String(ym.month).padStart(2, '0');
    const matchMonth = statsMonth === 'ALL' || dMonth === statsMonth;
    return matchYear && matchMonth;
  });

  const map: Record<string, number> = {};
  filtered.forEach(d => {
    const name = d.item?.name || '(삭제된 물품)';
    map[name] = (map[name] || 0) + (d.qty || 0); // 수량 기준 합산
  });

  return Object.entries(map)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty) // 내림차순 정렬
    .slice(0, 5); // TOP 5만 추출
}, [distributions, statsYear, statsMonth]);

  // [탭 2] 입고 내역 상태
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchaseYear, setPurchaseYear] = useState(kstYear.toString());
  const [purchaseMonth, setPurchaseMonth] = useState('ALL');
  const [purchaseOwnerFilter, setPurchaseOwnerFilter] = useState<string>('ALL');
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<Set<string>>(new Set());
  const [currentPurchasePage, setCurrentPurchasePage] = useState(1);
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);

  // [탭 3] 종료 물품 상태
  const [endedYearFilter, setEndedYearFilter] = useState<string>('ALL');
  const [endedMonthFilter, setEndedMonthFilter] = useState<string>('ALL');
  const [endedOwnerFilter, setEndedOwnerFilter] = useState<string>('ALL');
  const [endedPage, setEndedPage] = useState<number>(1);
  const [selectedEndedIds, setSelectedEndedIds] = useState<Set<string>>(new Set());

  const itemsPerPage = 10; 
  
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoadError(null);
    try {
      const ts = Date.now();
      const [uRes, iRes, purRes, itemRes, sysRes, unitsRes] = await Promise.all([
        fetch('/api/auth/me?t=' + ts),
        fetch('/api/admin/interface?t=' + ts),
        fetch('/api/marketing/purchases?t=' + ts), 
        fetch('/api/marketing/items?t=' + ts),
        fetch('/api/admin/config?t=' + ts),
        fetch('/api/admin/units?active=true&t=' + ts)
      ]);

      const failed: string[] = [];
      if (!uRes.ok) failed.push('사용자');
      if (!purRes.ok) failed.push('입고');
      if (!itemRes.ok) failed.push('물품');

      if (purRes.ok) setPurchases(await purRes.json());
      else setPurchases([]);
      if (itemRes.ok) setItems(await itemRes.json());
      else setItems([]);
      if (sysRes.ok) setSystemConfig(await sysRes.json());

      let loadedUnits: any[] = [];
      if (unitsRes.ok) {
        loadedUnits = await unitsRes.json();
        setUnits(loadedUnits);
      }

      let user: any = null;
      if (uRes.ok) {
        user = await uRes.json();
        setCurrentUser(user);

        const myDept = user?.unit?.unit_name;
        if (myDept) {
          const scoped = getScopedDeptNames(myDept, user?.unit_id || user?.unit?.id, loadedUnits);
          const q = scoped.length > 1
            ? `depts=${encodeURIComponent(scoped.join(','))}`
            : `dept=${encodeURIComponent(myDept)}`;
          const dRes = await fetch(`/api/marketing/distributions?${q}&t=${ts}`);
          if (dRes.ok) setDistributions(await dRes.json());
          else {
            setDistributions([]);
            failed.push('지급이력');
          }
        }
      }

      if (iRes.ok) {
        const interfaces = await iRes.json();
        const config = interfaces.find((m: any) => m.path === '/marketing/distribution/dept');
        setInterfaceConfig(config);
      }

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
  
  const canEdit = useMemo(() => {
    if (!currentUser) return false;
    if (isLv1) return true; 
    if (!interfaceConfig) return false;

    const myEmail = (currentUser.email || '').trim().toLowerCase();
    const myId = currentUser.id;
  
    const eRoles = safeArray(interfaceConfig.edit_role_ids).map((r: string) => {
      const m = String(r).match(/(\d+)/);
      return m ? `LV_${m[1]}` : String(r);
    });
    const tMasters = safeArray(interfaceConfig.task_masters);
    
    if (interfaceConfig.master_editor_id === myId) return true;
    if (myRoles.some((r: string) => eRoles.includes(r))) return true; 
    if (tMasters.some((tm: any) => emailsEqual(tm.email, myEmail))) return true;
  
    return false;
  }, [currentUser, interfaceConfig, isLv1, myRoles]);

  /** 타인 건 철회: LV_1·메뉴 마스터만. 그 외는 본인 건만 */
  const isMenuMaster =
    isLv1 || (!!currentUser?.id && interfaceConfig?.master_editor_id === currentUser.id);
  const canCancelDist = (d: any) =>
    isOwnDistribution(d, currentUser) || isMenuMaster;

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

  const handleCancelPurchase = async (id: string) => {
    if (!canEdit) return alert('❌ 입고 취소 권한이 없습니다.');
    if (!confirm('이 입고 내역을 취소하시겠습니까?\n(취소 시 카탈로그의 부서 재고도 함께 차감됩니다.)')) return;
    const res = await fetch(`/api/marketing/purchases?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert('입고가 성공적으로 취소되었습니다.');
      fetchData();
    } else {
      alert(await readApiError(res, '취소 실패. 이미 소진된 재고이거나 권한 에러입니다.'));
    }
  };

  const handleRestoreItem = async (id: string) => {
    if (!canEdit) return alert('❌ 권한이 없습니다.');
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

// 🚀 동적 권한 및 부서(본부/센터) 체계 확인 변수
const mgmtDept = systemConfig?.global_mgmt_dept;
const topOrgName = resolveTopOrgName(units);

const myDeptName = currentUser?.unit?.unit_name;

const isGlobalAdmin = Boolean(mgmtDept && myDeptName === mgmtDept);
  
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

  // 🚀 필터 드롭다운을 위한 지급 이력 내 물품 소속 추출
  const availableDistOwners = useMemo(() => {
    return Array.from(new Set(distributions.map(d => d.item?.owner_dept || '미지정'))).sort();
  }, [distributions]);
  
  const baseFilteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return distributions.filter(d => {
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      const yearMatch = selectedYear === 'ALL' || ym?.year?.toString() === selectedYear;
      
      // 🚀 [추가] 월(달) 매칭 로직
      const dMonth = ym ? String(ym.month).padStart(2, '0') : '';
      const monthMatch = selectedMonth === 'ALL' || dMonth === selectedMonth;

      const ownerMatch = distOwnerFilter === 'ALL' || (d.item?.owner_dept || '미지정') === distOwnerFilter;
      const searchMatch = !q || 
        d.client_name?.toLowerCase().includes(q) || 
        d.item?.name?.toLowerCase().includes(q) ||
        d.sender_name?.toLowerCase().includes(q) ||
        d.sender_email?.toLowerCase().includes(q) ||
        d.sender_dept?.toLowerCase().includes(q);
        
      return yearMatch && monthMatch && ownerMatch && searchMatch; // 🚀 monthMatch 추가
    })
    // 재고신청(createdAt) 시각 최신순 — 같은 지급일자여도 신청 쌓인 순서. 순번(reverseNo)도 이 기준
    .sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }, [distributions, selectedYear, selectedMonth, distOwnerFilter, searchQuery]); // 🚀 selectedMonth 의존성 추가
  
  const totalAmountForYear = useMemo(() => {
    return baseFilteredList.reduce((acc, cur) => acc + (cur.item?.unit_price || 0) * cur.qty, 0);
  }, [baseFilteredList]);

  const totalCountForYear = baseFilteredList.length;

  const clientStats = useMemo(() => {
    const statsMap: Record<string, { price: number; count: number }> = {};
    baseFilteredList.forEach((d) => {
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
    if (!selectedClientFilter) return baseFilteredList;
    return baseFilteredList.filter(d => d.client_name === selectedClientFilter);
  }, [baseFilteredList, selectedClientFilter]);
  
  const totalPages = Math.max(1, Math.ceil(finalFilteredList.length / itemsPerPage));
  const paginatedList = finalFilteredList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  // 🚀 selectedMonth 변경 시에도 페이지 초기화되도록 추가
  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()); }, [selectedYear, selectedMonth, searchQuery, selectedClientFilter, distOwnerFilter]);

  const toggleAll = () => {
    const currentPageIds = paginatedList.map(d => d.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
  
// ==========================================
  // 🚀 [탭 2] 입고 내역 — Catalog 입고/수정 가능 스코프와 동일
  // Center: 본인 센터만 / HQ: 본인 본부만 / Organization: global_mgmt_dept만 / LV_1: 전체
  // ==========================================
  const myDeptPurchases = useMemo(() => {
    if (!myDeptName && !isLv1) return [];
    return purchases.filter((p) => {
      const owner = p.item?.owner_dept;
      if (!owner) return false;
      if (isLv1) return true;
      if (owner === myDeptName) return true;
      if (isGlobalAdmin && topOrgName && owner === topOrgName) return true;
      return false;
    });
  }, [purchases, myDeptName, isGlobalAdmin, topOrgName, isLv1]);

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
    const q = purchaseSearch.trim().toLowerCase();
    return myDeptPurchases.filter(p => {
      const ym = getKSTYearMonth(p.purchase_date);
      const yearMatch = purchaseYear === 'ALL' || ym?.year?.toString() === purchaseYear;
      const dMonth = ym ? String(ym.month).padStart(2, '0') : '';
      const monthMatch = purchaseMonth === 'ALL' || dMonth === purchaseMonth;
      const ownerMatch = purchaseOwnerFilter === 'ALL' || p.item?.owner_dept === purchaseOwnerFilter;
      const searchMatch = !q ||
        p.item?.name?.toLowerCase().includes(q) ||
        (p.old_vendor || (typeof p.vendor === 'string' ? p.vendor : ''))?.toLowerCase().includes(q) ||
        p.purchaser_name?.toLowerCase().includes(q) ||
        p.purchaser_email?.toLowerCase().includes(q) ||
        p.purchaser_dept?.toLowerCase().includes(q);
      return yearMatch && monthMatch && ownerMatch && searchMatch;
    }).sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime());
  }, [myDeptPurchases, purchaseYear, purchaseMonth, purchaseSearch, purchaseOwnerFilter]);

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
  }, [purchaseYear, purchaseMonth, purchaseSearch, selectedItemFilter, purchaseOwnerFilter]);

  const toggleAllPurchases = () => {
    const currentIds = paginatedPurchases.map(p => p.id);
    const allSelected = currentIds.length > 0 && currentIds.every(id => selectedPurchaseIds.has(id));
    const next = new Set(selectedPurchaseIds);
    if (allSelected) currentIds.forEach(id => next.delete(id));
    else currentIds.forEach(id => next.add(id));
    setSelectedPurchaseIds(next);
  };

// ==========================================
  // 🚀 [탭 3] 종료 물품 — 입고와 동일 스코프
  // Center: 본인 센터만 / HQ: 본인 본부만 / Organization: global_mgmt_dept만 / LV_1: 전체
  // ==========================================
  const myDeptEndedItems = useMemo(() => {
    if (!myDeptName && !isLv1) return [];
    return items.filter((item) => {
      if (!item.is_archived) return false;
      const owner = item.owner_dept;
      if (!owner) return false;
      if (isLv1) return true;
      if (owner === myDeptName) return true;
      if (isGlobalAdmin && topOrgName && owner === topOrgName) return true;
      return false;
    });
  }, [items, myDeptName, isGlobalAdmin, topOrgName, isLv1]);

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
    return myDeptEndedItems.filter(item => {
      const ym = getKSTYearMonth(item.updatedAt || item.createdAt);
      const yearMatch = endedYearFilter === 'ALL' || ym?.year?.toString() === endedYearFilter;
      const dMonth = ym ? String(ym.month).padStart(2, '0') : '';
      const monthMatch = endedMonthFilter === 'ALL' || dMonth === endedMonthFilter;
      const ownerMatch = endedOwnerFilter === 'ALL' || item.owner_dept === endedOwnerFilter;
      return yearMatch && monthMatch && ownerMatch;
    }).sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }, [myDeptEndedItems, endedYearFilter, endedMonthFilter, endedOwnerFilter]);

  const paginatedEndedItems = useMemo(() => {
    const start = (endedPage - 1) * itemsPerPage;
    return filteredEndedItems.slice(start, start + itemsPerPage);
  }, [filteredEndedItems, endedPage]);

  const totalEndedPages = Math.max(1, Math.ceil(filteredEndedItems.length / itemsPerPage));

  useEffect(() => {
    setEndedPage(1);
    setSelectedEndedIds(new Set());
  }, [endedYearFilter, endedMonthFilter, endedOwnerFilter]);

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
    const targetList = selectedIds.size > 0 ? distributions.filter(d => selectedIds.has(d.id)) : finalFilteredList;
    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");
    const exportData = targetList.map((d) => ({
      '재고신청일': getKSTDateString(d.createdAt),
      '지급일자': getKSTDateString(d.dist_date || d.createdAt),
      '고객사(회사명)': d.client_name,
      '고객사 부서': d.client_dept,
      '물품소속': d.item?.owner_dept || '-',
      '물품명': d.item?.name || '(삭제됨)',
      '단가(원)': d.item?.unit_price,
      '개수': d.qty,
      '단위': d.item?.unit || 'EA',
      '총금액(원)': (d.item?.unit_price || 0) * d.qty,
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
    const targetList = selectedPurchaseIds.size > 0 ? purchases.filter(p => selectedPurchaseIds.has(p.id)) : finalFilteredPurchases;
    if (targetList.length === 0) return alert("다운로드할 입고 데이터가 없습니다.");
    const exportData = targetList.map((p) => ({
      '입고일자': getKSTDateString(p.purchase_date),
      '물품소속': p.item?.owner_dept || '-',
      '물품명': p.item?.name || '(삭제됨)',
      '단가(원)': p.unit_price,
      '수량': p.qty,
      '총 금액(원)': p.total_price,
      '구매/공급처': p.old_vendor || (typeof p.vendor === 'string' ? p.vendor : '') || '-',
      '비고(메모)': p.note || '-',
      '등록자': p.purchaser_name,
      '등록자소속': p.purchaser_dept,
      '등록자이메일': p.purchaser_email || '-',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서입고현황");
    XLSX.writeFile(wb, `${myDeptName || '부서'}_물품입고대장_${purchaseYear}년.xlsx`);
  };

  const handleDownloadEndedExcel = () => {
    const targetList = selectedEndedIds.size > 0 ? myDeptEndedItems.filter(i => selectedEndedIds.has(i.id)) : filteredEndedItems;
    if (targetList.length === 0) return alert("다운로드할 종료 물품 데이터가 없습니다.");
    const exportData = targetList.map((item) => {
      const reg = resolveItemRegistrant(item);
      return {
        '종료일자': getKSTDateString(item.updatedAt || item.createdAt),
        '물품소속': item.owner_dept,
        '물품명': item.name,
        '단가(원)': item.unit_price,
        '재고개수': item.current_stock,
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
  
  if (loading) return <div className="p-10 font-black text-center text-indigo-400 animate-pulse mt-20 tracking-widest">Syncing Master Ledger...</div>;
  
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
      
      {/* 🌑 최상단 먹색 메인 배너 */}
      <div className="w-full bg-slate-900 p-6 rounded-[2.5rem] min-h-[140px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden group">
        <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-indigo-500/20 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-3">
              DEPARTMENT DISTRIBUTION STATUS
            </h3>
            <h1 className="text-2xl font-black tracking-tight text-white leading-none flex items-center flex-wrap gap-3">
              <span className="bg-white/10 border border-white/20 text-white px-4 py-2 rounded-xl text-lg font-black tracking-tight shrink-0 shadow-inner backdrop-blur-sm">
                {myDeptName || '소속 부서'}
              </span>
              <span>지급 현황 마스터 대장</span>
            </h1>
            <p className="text-slate-400 text-xs font-semibold mt-4">
              우리 부서원들의 기념품 지급내역, 재고 보충(입고)내역, 종료된 물품 이력을 실시간 모니터링합니다.
            </p>
          </div>
        </div>
      </div>

      {/* 🚀 탭 네비게이션 */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-slate-200/50 rounded-[1.25rem] w-fit shadow-inner">
        <button 
          onClick={() => setActiveTab('DIST')} 
          className={`px-6 py-3 rounded-xl text-xs font-black transition-all duration-300 ${activeTab === 'DIST' ? 'bg-white text-indigo-600 shadow-md scale-100' : 'text-slate-500 hover:bg-slate-300/50 hover:text-slate-700 scale-95'}`}
        >
          🎁 부서 지급 이력
        </button>
        <button 
          onClick={() => setActiveTab('PURCHASE')} 
          className={`px-6 py-3 rounded-xl text-xs font-black transition-all duration-300 ${activeTab === 'PURCHASE' ? 'bg-white text-emerald-600 shadow-md scale-100' : 'text-slate-500 hover:bg-slate-300/50 hover:text-slate-700 scale-95'}`}
        >
          📦 입고 / 매입 장부
        </button>
        <button 
          onClick={() => setActiveTab('ARCHIVED')} 
          className={`px-6 py-3 rounded-xl text-xs font-black transition-all duration-300 ${activeTab === 'ARCHIVED' ? 'bg-white text-slate-800 shadow-md scale-100' : 'text-slate-500 hover:bg-slate-300/50 hover:text-slate-700 scale-95'}`}
        >
          🛑 종료된 과거 물품
        </button>
      </div>

{/* ========================================================================= */}
      {/* [탭 1] 부서 지급 이력 화면 (NO 칼럼 포함) */}
      {/* ========================================================================= */}
      {activeTab === 'DIST' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
          
          {/* 🚀 [교체됨] 월별 부서 인기 지급 물품 통계 (TOP 5) */}
          <div className="bg-white border border-slate-500 rounded-[2.5rem] shadow-sm p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🏆</span>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">부서 인기 지급 물품 랭킹</h3>
              </div>
              <div className="flex items-center gap-2">
                <select value={statsYear} onChange={e => setStatsYear(e.target.value)} className="bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold rounded-lg px-2 py-1.5 outline-none cursor-pointer">
                  <option value="ALL">전체 연도</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
                </select>
                <select value={statsMonth} onChange={e => setStatsMonth(e.target.value)} className="bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold rounded-lg px-2 py-1.5 outline-none cursor-pointer">
                  <option value="ALL">전체 월</option>
                  {Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>
            </div>

            {topDistributedItems.length === 0 ? (
              <div className="text-center py-5 text-slate-400 text-[11px] font-bold">
                선택하신 기간({statsYear !== 'ALL' ? statsYear+'년' : ''} {statsMonth !== 'ALL' ? statsMonth+'월' : ''})에 지급된 내역이 없습니다.
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {topDistributedItems.map((item, idx) => {
                  // 메달 컬러링 지정 (1등 금, 2등 은, 3등 동, 4~5등 일반)
                  const medalColors = [
                    'bg-amber-100 text-amber-600 border-amber-200', 
                    'bg-slate-200 text-slate-600 border-slate-300', 
                    'bg-orange-100 text-orange-700 border-orange-200',
                    'bg-indigo-50 text-indigo-400 border-indigo-100',
                    'bg-indigo-50 text-indigo-400 border-indigo-100'
                  ];

                  return (
                    <div key={item.name} className="flex-1 min-w-[180px] bg-slate-50 p-3 rounded-2xl border border-slate-200 shadow-inner flex items-center gap-3 transition-transform hover:scale-[1.02]">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm border shadow-sm ${medalColors[idx]}`}>
                        {idx + 1}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-black text-slate-800 truncate" title={item.name}>{item.name}</span>
                        <span className="text-[10px] font-bold text-indigo-600 mt-0.5"><span className="text-xl font-black tracking-tighter mr-0.5">{item.qty.toLocaleString()}</span>개 지급</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
            <HeaderLight title="부서 지급 이력 대장" count={finalFilteredList.length}>
              <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                  <span>🗓️ 연도:</span>
                  <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                    <option value="ALL">전체 연도</option>
                    {availableYears.map(y => <option key={y} value={y}>{y}년도</option>)}
                  </select>
                </div>

                {/* 🚀 [추가] 월(달) 필터 UI */}
                <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                  <span>📅 월:</span>
                  <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                    <option value="ALL">전체 월</option>
                    {Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                      <option key={m} value={m}>{m}월</option>
                    ))}
                  </select>
                </div>

                {/* 🚀 물품 소속 필터 추가 */}
                <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                  <span>🏢 물품소속:</span>
                  <select value={distOwnerFilter} onChange={e => setDistOwnerFilter(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                    <option value="ALL">전체 보기</option>
                    {availableDistOwners.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                <button onClick={handleDownloadExcel} className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1 outline-none hover:bg-slate-50 transition-colors shadow-sm text-slate-700">
                  {selectedIds.size > 0 ? `선택 엑셀 다운로드 (${selectedIds.size})` : '화면 목록 엑셀 다운로드'}
                </button>
                <div className="relative w-40">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px]">🔍</span>
                  <input type="text" placeholder="물품·고객사·이름·이메일..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-6 pr-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-indigo-500 transition-all shadow-inner" />
                </div>
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
                  고객사별 지급 비율 요약 (클릭하여 해당 내역만 필터링)
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
                <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                  {paginatedList.length === 0 ? (
                    <tr><td colSpan={15} className="p-16 text-center text-slate-400">부서 지급 내역 장부가 비어있습니다.</td></tr>
                  ) : paginatedList.map((d, idx) => {
                    const isSelected = selectedIds.has(d.id);
                    const reqDate = getKSTDateString(d.createdAt);
                    const distDate = getKSTDateString(d.dist_date || d.createdAt);
                    const reverseNo = finalFilteredList.length - ((currentPage - 1) * itemsPerPage + idx);
                    const canCancel = canCancelDist(d);
                    
                    return (
                      <tr key={d.id} className={`transition-colors h-14 ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50/50'}`}>
                        <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(d.id) ? next.delete(d.id) : next.add(d.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                        </td>
                        <td className="px-2 text-center text-slate-800 font-black">{reverseNo}</td>
                        <td className="px-2 text-center font-mono text-slate-800 text-[11px] whitespace-nowrap">{reqDate}</td>
                        <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">{distDate}</td>
                        <td className="px-2 font-black text-slate-800 text-[12px] truncate max-w-[112px]">{d.client_name}</td>
                        <td className="px-2 text-slate-800 truncate max-w-[96px]">{d.client_dept || '-'}</td>
                        <td className="px-2 text-center">
                          <span className="bg-slate-100 text-slate-800 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-black whitespace-nowrap">{d.item?.owner_dept || '-'}</span>
                        </td>
                        <td className="px-2 text-indigo-700 text-[12px] font-black truncate max-w-[144px]">{d.item?.name || '(삭제됨)'}</td>
                        <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">{d.item?.unit_price?.toLocaleString()}</td>
                        <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">
                          {d.qty}
                          <span className="text-[9px] text-slate-800 font-sans ml-0.5">{d.item?.unit || 'EA'}</span>
                        </td>
                        <td className="px-2 text-center font-mono font-black text-indigo-600 whitespace-nowrap">
                          {((d.item?.unit_price || 0) * d.qty).toLocaleString()}
                        </td>
                        <td className="px-2 text-slate-800 truncate max-w-[112px]" title={d.purpose}>{d.purpose}</td>
                        <td className="px-2 text-center text-slate-800">
                          <div className="flex flex-col items-center justify-center leading-tight min-w-[7rem]">
                            <span className="text-[11px] font-bold truncate max-w-[120px]" title={d.sender_name || ''}>
                              {d.sender_name || '-'}
                            </span>
                            <span className="text-[9px] text-slate-800 truncate max-w-[120px]" title={d.sender_dept || ''}>
                              ({d.sender_dept || '-'})
                            </span>
                          </div>
                        </td>
                        <td className="px-2 text-center text-[10px] text-slate-800 truncate max-w-[120px]" title={d.sender_email || ''}>{d.sender_email || '-'}</td>
                        <td className="pr-4 text-center" onClick={(e)=>e.stopPropagation()}>
                          {canCancel ? (
                            <button onClick={() => handleDelete(d.id)} className="w-full py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                              신청철회
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-300 font-bold">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">이전</button>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
                ))}
                <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">다음</button>
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
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                <span>🗓️ 연도:</span>
                <select value={purchaseYear} onChange={e => setPurchaseYear(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                  <option value="ALL">전체 내역 보기</option>
                  {purchaseYears.map(y => <option key={y} value={y}>{y}년도</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                <span>📅 월:</span>
                <select value={purchaseMonth} onChange={e => setPurchaseMonth(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                  <option value="ALL">전체 월</option>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>
              {/* 🚀 물품소속 필터 추가 */}
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                <span>🏢 물품소속:</span>
                <select value={purchaseOwnerFilter} onChange={e => setPurchaseOwnerFilter(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                  <option value="ALL">전체 보기</option>
                  {availablePurchaseOwners.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              
              <button 
                onClick={handleDownloadPurchaseExcel}
                className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1 outline-none hover:bg-slate-50 transition-colors shadow-sm text-slate-700"
              >
                {selectedPurchaseIds.size > 0 ? `선택 입고 엑셀 다운 (${selectedPurchaseIds.size})` : '입고 장부 엑셀 다운'}
              </button>

              <div className="relative w-40">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px]">🔍</span>
                <input type="text" placeholder="물품·공급처·이름·이메일..." value={purchaseSearch} onChange={e => setPurchaseSearch(e.target.value)} className="w-full pl-6 pr-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-indigo-500 transition-all shadow-inner" />
              </div>
            </div>
          </HeaderLight>

          <div className="p-6 bg-slate-50/70 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm min-h-[110px] flex flex-col justify-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                표시된 총 입고(구매)액/건
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
                입고 물품 순위 나열 (클릭 시 해당 품목만 필터링)
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
                  <th className="h-12 px-2 w-[88px] text-center text-emerald-600 whitespace-nowrap">총금액(원)</th>
                  <th className="h-12 px-2 w-32">구매/공급처</th>
                  <th className="h-12 px-2 w-36 text-left">비고 (메모)</th>
                  <th className="h-12 px-2 w-32 text-center whitespace-nowrap">등록자(소속)</th>
                  <th className="h-12 px-2 w-28 text-center whitespace-nowrap">이메일</th>
                  <th className="h-12 pr-4 text-center w-24 whitespace-nowrap">관리기능</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedPurchases.length === 0 ? (
                  <tr><td colSpan={13} className="p-16 text-center text-slate-400">배정된 매입 데이터가 없습니다.</td></tr>
                ) : paginatedPurchases.map((p, idx) => {
                  const isSelected = selectedPurchaseIds.has(p.id);
                  const pDate = getKSTDateString(p.purchase_date);
                  const reverseNo = finalFilteredPurchases.length - ((currentPurchasePage - 1) * itemsPerPage + idx);
                  const vendorLabel = p.old_vendor || (typeof p.vendor === 'string' ? p.vendor : '') || '-';

                  return (
                    <tr key={p.id} className={`transition-colors h-14 ${isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50/50'}`}>
                      <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedPurchaseIds); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSelectedPurchaseIds(next); }} className="w-3 h-3 accent-emerald-600 cursor-pointer" />
                      </td>
                      <td className="px-2 text-center text-slate-800 font-black">{reverseNo}</td>
                      <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">{pDate}</td>
                      <td className="px-2 text-center">
                        <span className="bg-slate-100 text-slate-800 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-black whitespace-nowrap">{p.item?.owner_dept || '-'}</span>
                      </td>
                      <td className="px-2 text-emerald-700 text-[12px] font-black truncate max-w-[160px]">{p.item?.name || '(삭제됨)'}</td>
                      <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">{p.unit_price?.toLocaleString()}</td>
                      <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">
                        {p.qty}
                        <span className="text-[9px] text-slate-800 font-sans ml-0.5">{p.item?.unit || 'EA'}</span>
                      </td>
                      <td className="px-2 text-center font-mono font-black text-emerald-600 whitespace-nowrap">{(p.total_price || 0).toLocaleString()}</td>
                      <td className="px-2 font-black text-slate-800 truncate max-w-[130px]">{vendorLabel}</td>
                      <td className="px-2 text-slate-800 truncate max-w-[150px]" title={p.note}>{p.note || '-'}</td>
                      <td className="px-2 text-center text-slate-800">
                        <div className="flex flex-col items-center justify-center leading-tight min-w-[7rem]">
                          <span className="text-[11px] font-bold truncate max-w-[120px]" title={p.purchaser_name || ''}>
                            {p.purchaser_name || '-'}
                          </span>
                          <span className="text-[9px] text-slate-800 truncate max-w-[120px]" title={p.purchaser_dept || ''}>
                            ({p.purchaser_dept || '-'})
                          </span>
                        </div>
                      </td>
                      <td className="px-2 text-center text-[10px] text-slate-800 truncate max-w-[120px]" title={p.purchaser_email || ''}>{p.purchaser_email || '-'}</td>
                      <td className="pr-4 text-center" onClick={(e)=>e.stopPropagation()}>
                        {canEdit ? (
                          <button onClick={() => handleCancelPurchase(p.id)} className="w-full py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                            입고 취소
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-300 font-bold">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPurchasePages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
              <button disabled={currentPurchasePage === 1} onClick={() => setCurrentPurchasePage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">이전</button>
              {Array.from({ length: totalPurchasePages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPurchasePage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPurchasePage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPurchasePage === totalPurchasePages} onClick={() => setCurrentPurchasePage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">다음</button>
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
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                <span>🗓️ 연도:</span>
                <select 
                  value={endedYearFilter} 
                  onChange={(e) => setEndedYearFilter(e.target.value)} 
                  className="outline-none bg-transparent cursor-pointer font-black"
                >
                  <option value="ALL">전체 내역 보기</option>
                  {endedYears.map(year => (
                    <option key={year} value={year}>{year}년</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                <span>📅 월:</span>
                <select
                  value={endedMonthFilter}
                  onChange={(e) => setEndedMonthFilter(e.target.value)}
                  className="outline-none bg-transparent cursor-pointer font-black"
                >
                  <option value="ALL">전체 월</option>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                <span>🏢 물품소속:</span>
                <select value={endedOwnerFilter} onChange={e => setEndedOwnerFilter(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                  <option value="ALL">전체 보기</option>
                  {availableEndedOwners.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              
              <button 
                onClick={handleDownloadEndedExcel}
                className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1 outline-none hover:bg-slate-50 transition-colors shadow-sm text-slate-700"
              >
                {selectedEndedIds.size > 0 ? `선택 엑셀 다운로드 (${selectedEndedIds.size})` : '종료 장부 엑셀 다운'}
              </button>
            </div>
          </HeaderLight>

          <div className="overflow-x-auto">
            {filteredEndedItems.length === 0 ? (
              <div className="py-20 text-center font-black text-slate-400 bg-slate-50 m-6 rounded-2xl border border-dashed border-slate-200">
                선택한 연도의 종료된 물품 내역이 없습니다.
              </div>
            ) : (
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
                    <th className="h-12 px-2 w-14 text-center whitespace-nowrap">재고개수</th>
                    <th className="h-12 px-2 w-32 text-center whitespace-nowrap">종료처리자(소속)</th>
                    <th className="h-12 px-2 w-28 text-center whitespace-nowrap">이메일</th>
                    <th className="h-12 pr-4 text-center w-36 whitespace-nowrap">관리액션</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-800">
                  {paginatedEndedItems.map((item, index) => {
                     const reverseNo = filteredEndedItems.length - ((endedPage - 1) * itemsPerPage + index);
                     const endDate = getKSTDateString(item.updatedAt || item.createdAt);
                     const isSelected = selectedEndedIds.has(item.id);
                     const { name: regName, dept: regDept, email: regEmail } = resolveItemRegistrant(item);

                     return (
                      <tr key={item.id} className={`transition-colors h-14 ${isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                        <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedEndedIds); next.has(item.id) ? next.delete(item.id) : next.add(item.id); setSelectedEndedIds(next); }} className="w-3 h-3 accent-slate-800 cursor-pointer" />
                        </td>
                        <td className="px-2 text-center text-slate-800 font-black">{reverseNo}</td>
                        <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">{endDate}</td>
                        <td className="px-2 text-center">
                          <span className="bg-slate-100 text-slate-800 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-black whitespace-nowrap">{item.owner_dept || '-'}</span>
                        </td>
                        <td className="px-2 text-slate-800 font-black truncate max-w-[200px]">{item.name}</td>
                        <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">{item.unit_price?.toLocaleString()}</td>
                        <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">
                          {item.current_stock}
                          <span className="text-[9px] text-slate-800 font-sans ml-0.5">{item.unit || 'EA'}</span>
                        </td>
                        <td className="px-2 text-center text-slate-800">
                          <div className="flex flex-col items-center justify-center leading-tight min-w-[7rem]">
                            <span className="text-[11px] font-bold truncate max-w-[120px]" title={regName}>{regName}</span>
                            <span className="text-[9px] text-slate-800 truncate max-w-[120px]" title={regDept}>({regDept})</span>
                          </div>
                        </td>
                        <td className="px-2 text-center text-[10px] text-slate-800 truncate max-w-[120px]" title={regEmail}>
                          {regEmail || '-'}
                        </td>
                        <td className="pr-4 text-center">
                           <div className="flex flex-row gap-1.5 justify-center">
                              {canEdit ? (
                                <button onClick={() => handleRestoreItem(item.id)} className="flex-1 py-1.5 bg-white border border-slate-300 text-slate-600 rounded-md text-[9px] font-black hover:bg-slate-800 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                                  ↺ 복구
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-300 font-bold">-</span>
                              )}
                              {isLv1 && (
                                <button onClick={() => handlePermanentDeleteItem(item.id)} className="flex-1 py-1.5 bg-red-50 text-red-500 border border-red-200 rounded-md text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors whitespace-nowrap">
                                  🗑️ 영구삭제
                                </button>
                              )}
                           </div>
                        </td>
                      </tr>
                   )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {totalEndedPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 py-6 border-t border-slate-100 bg-white">
              <button disabled={endedPage === 1} onClick={() => setEndedPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
              {Array.from({ length: totalEndedPages }).map((_, i) => (
                <button key={i} onClick={() => setEndedPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${endedPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={endedPage === totalEndedPages} onClick={() => setEndedPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
            </div>
          )}
        </div>
      )}
  
    </div>
  );
}
  
export default function DeptDistributionModule() {
  return (
    <Suspense fallback={<div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">Loading Department Combined Environment...</div>}>
      <DeptDistributionContent />
    </Suspense>
  );
}