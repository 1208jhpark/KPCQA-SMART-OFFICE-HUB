'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import {
  SUPPLIES_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';

const MENU_PATH = '/asset/supplies/master/restock';

/** KST 기준 연·월 문자열 (year: '2026', month: '07') */
function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return {
    year: String(ym.year),
    month: String(ym.month).padStart(2, '0'),
  };
}

/** KST YYYY-MM-DD 두 날짜의 일수 차 (b - a) */
function kstDayDiff(fromYmd: string, toYmd: string) {
  if (!fromYmd || !toYmd) return null;
  const a = new Date(`${fromYmd}T12:00:00+09:00`);
  const b = new Date(`${toYmd}T12:00:00+09:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** 안전재고 대비 현재고 비율 (바·표기 모두 100% 캡) */
function getStockLevelVisual(current: number, safety: number) {
  if (safety <= 0) {
    return current > 0
      ? { fillPct: 100, label: '100%', healthy: true }
      : { fillPct: 0, label: '0%', healthy: false };
  }
  const rawPct = (current / safety) * 100;
  const healthy = current > safety;
  const capped = Math.min(100, Math.round(rawPct));
  return {
    fillPct: capped,
    label: `${capped}%`,
    healthy,
  };
}
     
function MasterRestockContent() {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(SUPPLIES_MASTER_TABS, '/asset/supplies/master');
  const [purchases, setPurchases] = useState<any[]>([]);
  /** 대시보드와 동일: 활성 등록 물품 */
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [pendingReqCount, setPendingReqCount] = useState(0);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedYear, setSelectedYear] = useState(String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);
  /** 입고 주기 보드: 현재고 ≤ 안전재고만 보기 */
  const [stockWarnOnly, setStockWarnOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
     
  useEffect(() => { 
    fetchData(); 
  }, []);
     
  const fetchData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, purchaseRes, dashRes, summaryRes, pendingRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/supplies/master/restock?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/supplies/master/dashboard?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
        fetch(`/api/asset/supplies/master/pending-count?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);
      
      if (userRes.ok) setCurrentUser(await userRes.json());
      if (purchaseRes.ok) {
        setPurchases(await purchaseRes.json());
      } else if (purchaseRes.status === 401 || purchaseRes.status === 403) {
        const err = await purchaseRes.json().catch(() => ({}));
        alert(err.error || '입고 대장 권한이 없습니다.');
      } else {
        const err = await purchaseRes.json().catch(() => ({}));
        alert(err.error || '입고 내역을 불러오지 못했습니다.');
      }
      if (dashRes && dashRes.ok) {
        const dash = await dashRes.json();
        setCatalogItems(Array.isArray(dash.items) ? dash.items : []);
      } else {
        setCatalogItems([]);
      }
      let summaryOk = summaryRes && summaryRes.ok;
      if (summaryOk) {
        setPermissionSummary(await summaryRes!.json());
      } else {
        // 구 메뉴 path 잔존 시 summary 폴백
        const legacySummary = await fetch(
          `/api/admin/interface/summary?path=${encodeURIComponent('/asset/supplies/master/purchase')}&t=${ts}`,
          { cache: 'no-store' }
        ).catch(() => null);
        if (legacySummary && legacySummary.ok) {
          setPermissionSummary(await legacySummary.json());
          summaryOk = true;
        } else {
          setPermissionSummary(null);
        }
      }
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find(
              (m: any) =>
                m.path === MENU_PATH ||
                m.path?.includes('/supplies/master/restock') ||
                m.path?.includes('/supplies/master/purchase')
            )
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
      if (pendingRes && pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingReqCount(Number(data.pendingCount) || 0);
      } else {
        setPendingReqCount(0);
      }
    } catch (e) {
      console.error("Restock Sync Error", e);
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };
     
  const availableYears = useMemo(() => {
    const years = purchases
      .map((p) => getKSTYearMonthParts(p.purchase_date || p.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [purchases]);
  
  const availableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];
     
  const baseFilteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      const ym = getKSTYearMonthParts(p.purchase_date || p.createdAt);
      const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      
      const itemName = p.item?.name || '알 수 없는 품목';
      const searchMatch = !searchQuery || 
        itemName.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (p.purchaser_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      return yearMatch && monthMatch && searchMatch;
    }).sort((a, b) => new Date(b.purchase_date || b.createdAt).getTime() - new Date(a.purchase_date || a.createdAt).getTime());
  }, [purchases, selectedYear, selectedMonth, searchQuery]);
     
  /** 등록 물품 기준 입고 주기 (평균·경과일=전체 이력 / 입고횟수=연·월 필터) */
  const itemCycleStats = useMemo(() => {
    const today = getKSTDateString();
    const byItemId = new Map<string, any[]>();
    purchases.forEach((p) => {
      const id = p.item_id || p.item?.id;
      if (!id) return;
      if (!byItemId.has(id)) byItemId.set(id, []);
      byItemId.get(id)!.push(p);
    });

    const rows = catalogItems.map((item) => {
      const logs = (byItemId.get(item.id) || [])
        .map((p) => ({
          ...p,
          ymd: getKSTDateString(p.purchase_date || p.createdAt),
        }))
        .filter((p) => p.ymd)
        .sort((a, b) => a.ymd.localeCompare(b.ymd));

      const lastYmd = logs.length ? logs[logs.length - 1].ymd : '';
      const daysSince = lastYmd ? kstDayDiff(lastYmd, today) : null;

      let avgGapDays: number | null = null;
      if (logs.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < logs.length; i++) {
          const d = kstDayDiff(logs[i - 1].ymd, logs[i].ymd);
          if (d !== null && d >= 0) gaps.push(d);
        }
        if (gaps.length) {
          avgGapDays = Math.round(gaps.reduce((s, n) => s + n, 0) / gaps.length);
        }
      }

      const periodCount = logs.filter((p) => {
        const ym = getKSTYearMonthParts(p.ymd);
        const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
        const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
        return yearMatch && monthMatch;
      }).length;

      const currentStock = Number(item.current_stock) || 0;
      const safetyStock = Number(item.alert_qty) || 0;
      const isStockWarn = currentStock <= safetyStock;

      return {
        id: item.id,
        name: item.name || '(이름 없음)',
        currentStock,
        safetyStock,
        lastYmd,
        daysSince,
        avgGapDays,
        periodCount,
        totalCount: logs.length,
        isStockWarn,
      };
    });

    return rows.sort((a, b) => {
      if (a.isStockWarn !== b.isStockWarn) return a.isStockWarn ? -1 : 1;
      if (a.currentStock !== b.currentStock) return a.currentStock - b.currentStock;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [catalogItems, purchases, selectedYear, selectedMonth]);

  const stockWarnCount = useMemo(
    () => itemCycleStats.filter((r) => r.isStockWarn).length,
    [itemCycleStats]
  );

  const visibleCycleStats = useMemo(
    () => (stockWarnOnly ? itemCycleStats.filter((r) => r.isStockWarn) : itemCycleStats),
    [itemCycleStats, stockWarnOnly]
  );
     
  const finalFilteredPurchases = useMemo(() => {
    if (!selectedItemFilter) return baseFilteredPurchases;
    return baseFilteredPurchases.filter(p => (p.item?.name || '(삭제된 품목)') === selectedItemFilter);
  }, [baseFilteredPurchases, selectedItemFilter]);
     
  const totalPages = Math.max(1, Math.ceil(finalFilteredPurchases.length / itemsPerPage));
  const paginatedPurchases = finalFilteredPurchases.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
     
  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()); }, [selectedYear, selectedMonth, searchQuery, selectedItemFilter, stockWarnOnly]);
     
  const handleCancelPurchase = async (purchaseData: any) => {
    if (!canEdit) return alertNoEditPermission();
    const itemName = purchaseData.item?.name || '알 수 없는 품목';
    if (
      !confirm(
        `[경고] 정말 [${itemName}] 입고 내역을 철회하시겠습니까?\n철회 시 해당 물품의 재고가 자동으로 차감됩니다.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/asset/supplies/master/restock?id=${purchaseData.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: purchaseData.id }),
      });

      if (res.ok) {
        alert('✅ 정상적으로 입고가 철회되었습니다.');
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 철회 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  /** LV_1 전용 — 잘못된 백데이터 정리용 영구 삭제 (입고철회와 동일 API) */
  const handleDeletePurchaseLv1 = async (purchaseData: any) => {
    if (!canEdit) return alertNoEditPermission();
    if (!isLv1) {
      return alert('잘못된 데이터 삭제는 LV_1만 가능합니다.');
    }
    const itemName = purchaseData.item?.name || '알 수 없는 품목';
    if (
      !confirm(
        `경고: [${itemName}] 입고 내역을 영구 삭제하시겠습니까? (LV_1 · 백데이터 정리)\n삭제 시 해당 수량만큼 현재고가 차감됩니다.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/asset/supplies/master/restock?id=${purchaseData.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: purchaseData.id }),
      });

      if (res.ok) {
        alert('🗑️ 입고 내역이 삭제되었습니다.');
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 삭제 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('서버와 통신할 수 없습니다.');
    }
  };
     
  const handleDownloadExcel = () => {
    const targetList = selectedIds.size > 0 ? purchases.filter(p => selectedIds.has(p.id)) : finalFilteredPurchases;
    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");
    
    // 엑셀 다운로드 — 입고 팝업/장부 라벨과 동일
    const exportData = targetList.map((p, idx) => {
      let pQty = Number(p.qty) || 0;
      let pUnit = '';
      let linkQty = 1;
      let sUnit = '';
      let stockQty = Number(p.qty) || 0;
      
      try {
        if (p.item?.description) {
          const itemExt = JSON.parse(p.item.description);
          sUnit = itemExt.s_unit || itemExt.r_unit || '';
          pUnit = itemExt.p_unit || '';
        }
      } catch(e) {}
      
      try {
        if (p.note) {
          const parsed = JSON.parse(p.note);
          if (Number(parsed.p_qty) > 0) pQty = Number(parsed.p_qty);
          if (parsed.p_unit) pUnit = parsed.p_unit;
          if (Number(parsed.link_qty) > 0) linkQty = Number(parsed.link_qty);
          if (parsed.s_unit) sUnit = parsed.s_unit;
          if (Number(parsed.stock_qty) > 0) stockQty = Number(parsed.stock_qty);
        }
      } catch(e) {}
     
      return {
        'NO': targetList.length - idx,
        '창고 입고일': p.purchase_date ? getKSTDateString(p.purchase_date) : '-',
        '물품명': p.item?.name || '(삭제된 품목)',
        '입고수량': pQty,
        '입고단위': pUnit || '-',
        '환산수량 (지급/입고)': linkQty,
        '환산 입고수량': stockQty,
        '지급단위': sUnit || '-',
        '등록자': p.purchaser_name || '관리자',
        '소속부서': p.purchaser_dept || '-',
      };
    });
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "입고대장");
    XLSX.writeFile(wb, `소모품_입고대장_${selectedYear}년${selectedMonth !== 'ALL' ? `_${selectedMonth}월` : ''}.xlsx`);
  };
     
  const isLv1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : [currentUser.role];
    return (roles || []).some((r: any) => {
      const m = String(r || '').match(/\d+/);
      return m ? `LV_${m[0]}` === 'LV_1' : String(r) === 'LV_1';
    });
  }, [currentUser]);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
  const disabledActionBtn =
    'px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70';

  if (loading) return <LoadingState />;
     
  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* client-search 배너 규격: emerald→teal · orbs · label 10px / title 2xl / desc xs */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
  <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
  <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
  <div className="relative z-10">
    <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
      CENTRAL SUPPLIES CONTROL TOWER
    </h3>
    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
      소모품 마스터 관리 통제실
    </h1>
    <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
      신규 소모품 내역의 입고 내역을 관리합니다.
    </p>
    {permissionSummary && (
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
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
     
      {/* 탭 네비게이션 — client-search / distribution 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            const showPendingBadge = tab.id === 'requests' && pendingReqCount > 0;
            return (
              <Link
                key={tab.id}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                  isActive
                    ? `bg-white ${tab.activeColor || 'text-indigo-600'} shadow-sm border border-slate-200/80`
                    : 'text-slate-500 hover:text-slate-800'
                } ${showPendingBadge && !isActive ? 'ring-1 ring-red-300/80' : ''}`}
              >
                <span>{tab.label}</span>
                {showPendingBadge && (
                  <span className="inline-flex items-center justify-center min-w-[1.35rem] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-black font-mono shadow-sm animate-pulse">
                    {pendingReqCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden lg:block">
          ※ 탭을 클릭하여 대시보드·신청·입고·아카이브를 전환합니다.
        </p>
      </div>
  
      {/* 입고 주기 보드 — 장부 카드 밖 */}
      <section className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h2 className="text-sm font-black text-slate-800 tracking-tight">입고 주기 보드</h2>
            <span className="text-[11px] font-bold text-slate-500">
              등록 물품 <strong className="text-slate-800 tabular-nums">{itemCycleStats.length}</strong>
            </span>
            <button
              type="button"
              onClick={() => setStockWarnOnly((prev) => !prev)}
              title="현재고 ≤ 안전재고 품목만 보기"
              className={`text-[11px] font-black px-2.5 py-1 rounded-md border transition-colors tabular-nums ${
                stockWarnOnly
                  ? 'bg-amber-500 text-white border-amber-500'
                  : stockWarnCount > 0
                    ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
              }`}
            >
              재고 주의 {stockWarnCount}
            </button>
            <span className="text-[10px] font-bold text-slate-400 hidden sm:inline">
              · 행 클릭 시 아래 장부 필터
            </span>
          </div>
          {(selectedItemFilter || stockWarnOnly) && (
            <button
              type="button"
              onClick={() => {
                setSelectedItemFilter(null);
                setStockWarnOnly(false);
              }}
              className="text-[11px] font-black text-indigo-600 hover:underline"
            >
              필터 초기화 ✕
            </button>
          )}
        </div>

        {itemCycleStats.length === 0 ? (
          <p className="px-5 py-8 text-xs text-slate-400 font-bold text-center">
            등록된 활성 물품이 없습니다. 대시보드에서 물품을 등록하세요.
          </p>
        ) : visibleCycleStats.length === 0 ? (
          <p className="px-5 py-8 text-xs text-slate-400 font-bold text-center">
            재고 주의 품목이 없습니다.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_11rem_64px_64px_108px_68px_92px_76px] gap-3 px-5 py-1.5 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
              <span>물품명</span>
              <span className="text-center inline-flex items-center justify-center gap-0.5">
                재고 수준
                <span
                  className="normal-case tracking-normal font-bold text-slate-400 cursor-help"
                  title="안전재고 대비 현재고 보유 비율 (현재고 / 안전재고)"
                  aria-label="안전재고 대비 현재고 보유 비율 (현재고 / 안전재고)"
                >
                  ⓘ
                </span>
              </span>
              <span className="text-right">현재고</span>
              <span className="text-right">안전재고</span>
              <span className="text-center">최근 입고</span>
              <span className="text-right">경과일</span>
              <span className="text-right inline-flex items-center justify-end gap-0.5">
                평균간격
                <span
                  className="normal-case tracking-normal font-bold text-slate-400 cursor-help"
                  title="2회 이상 입고 시 자동 계산"
                  aria-label="2회 이상 입고 시 자동 계산"
                >
                  ⓘ
                </span>
              </span>
              <span className="text-right">입고 횟수</span>
            </div>
            {visibleCycleStats.map((stat) => {
              const isSelected = selectedItemFilter === stat.name;
              const level = getStockLevelVisual(stat.currentStock, stat.safetyStock);
              return (
                <button
                  type="button"
                  key={stat.id}
                  onClick={() => setSelectedItemFilter((prev) => (prev === stat.name ? null : stat.name))}
                  className={`w-full text-left px-5 py-1.5 transition-colors sm:grid sm:grid-cols-[minmax(0,1.4fr)_11rem_64px_64px_108px_68px_92px_76px] sm:gap-3 sm:items-center ${
                    isSelected
                      ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200'
                      : stat.isStockWarn
                        ? 'bg-amber-50/50 hover:bg-amber-50'
                        : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    {stat.isStockWarn && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" title="재고 주의 (현재고 ≤ 안전재고)" />
                    )}
                    <span
                      className={`text-[12px] font-black truncate ${isSelected ? 'text-indigo-800' : 'text-slate-800'}`}
                      title={stat.name}
                    >
                      {stat.name}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-2 w-full"
                    title={`현재고 ${stat.currentStock.toLocaleString()} / 안전재고 ${stat.safetyStock.toLocaleString()}`}
                  >
                    <div className="w-36 shrink-0 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          level.healthy ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${level.fillPct}%` }}
                      />
                    </div>
                    <span
                      className={`shrink-0 text-[10px] font-black tabular-nums w-9 text-right ${
                        level.healthy ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      {level.label}
                    </span>
                  </div>
                  <div className="mt-1 sm:mt-0 flex flex-wrap sm:contents gap-x-4 gap-y-0.5 text-[11px] font-bold tabular-nums">
                    <span className={`sm:text-right ${stat.isStockWarn ? 'text-amber-700' : 'text-slate-600'}`}>
                      <span className="sm:hidden text-slate-400 mr-1">현재고</span>
                      {stat.currentStock.toLocaleString()}
                    </span>
                    <span className="text-slate-500 sm:text-right">
                      <span className="sm:hidden text-slate-400 mr-1">안전재고</span>
                      {stat.safetyStock.toLocaleString()}
                    </span>
                    <span className="text-slate-700 sm:text-center">
                      <span className="sm:hidden text-slate-400 mr-1">최근</span>
                      {stat.lastYmd || '—'}
                    </span>
                    <span className="text-slate-500 sm:text-right">
                      <span className="sm:hidden text-slate-400 mr-1">경과</span>
                      {stat.daysSince === null ? '이력없음' : `${stat.daysSince}일`}
                    </span>
                    <span
                      className="text-emerald-700 sm:text-right"
                      title="2회 이상 입고 시 자동 계산"
                    >
                      <span className="sm:hidden text-slate-400 mr-1">평균</span>
                      {stat.avgGapDays !== null ? `${stat.avgGapDays}일` : '—'}
                    </span>
                    <span className="text-slate-600 sm:text-right">
                      <span className="sm:hidden text-slate-400 mr-1">입고 횟수</span>
                      {stat.periodCount}회
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mt-6">
        
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">입고 내역 장부</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{finalFilteredPurchases.length}건</span>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                <option value="ALL">전체</option>
                {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>
              <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                <option value="ALL">전체</option>
                {availableMonths.map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
            </div>
            <div className="relative w-48">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input type="text" placeholder="물품, 등록자 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors" />
            </div>
            <button onClick={handleDownloadExcel} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap">
              {selectedIds.size > 0 ? `선택 EXCEL 다운로드(${selectedIds.size})` : '화면 목록 EXCEL 다운로드'}
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1240px]">
            <colgroup>
              <col className="w-[40px]" />
              <col className="w-[48px]" />
              <col className="w-[100px]" />
              <col className="w-[150px]" />
              <col className="w-[72px]" />
              <col className="w-[88px]" />
              <col className="w-[150px]" />
              <col className="w-[80px]" />
              <col className="w-[88px]" />
              <col className="w-[120px]" />
              <col className="w-[168px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-4 text-center">
                  <input type="checkbox" checked={paginatedPurchases.length > 0 && paginatedPurchases.every(p => selectedIds.has(p.id))} onChange={() => {
                    const currentIds = paginatedPurchases.map(p => p.id);
                    const allSelected = currentIds.every(id => selectedIds.has(id));
                    const next = new Set(selectedIds);
                    if (allSelected) currentIds.forEach(id => next.delete(id)); else currentIds.forEach(id => next.add(id));
                    setSelectedIds(next);
                  }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                </th>
                <th className="h-12 px-2 text-center">NO</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">창고 입고 일자</th>
                <th className="h-12 px-2 text-indigo-600">물품명</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">입고수량</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">입고단위</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">환산수량 (지급/입고)</th>
                <th className="h-12 px-2 text-center text-indigo-600 whitespace-nowrap">환산 입고수량</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">지급단위</th>
                <th className="h-12 px-2 text-center border-l border-slate-200 whitespace-nowrap">부서 / 등록자</th>
                <th className="h-12 px-2 text-center whitespace-nowrap border-l border-slate-200">관리액션(Edit)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedPurchases.length === 0 ? (
                <tr><td colSpan={11} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 입고 내역이 없습니다.</td></tr>
              ) : paginatedPurchases.map((p, i) => {
                const isSelected = selectedIds.has(p.id);
                const itemName = p.item?.name || '(삭제된 품목)';
                
                let pQty = Number(p.qty) || 0;
                let pUnit = '-';
                let linkQty = 1;
                let sUnit = '';
                let stockQty = Number(p.qty) || 0;

                try {
                  if (p.item?.description) {
                    const itemExt = JSON.parse(p.item.description);
                    sUnit = itemExt.s_unit || itemExt.r_unit || '';
                    if (itemExt.p_unit) pUnit = itemExt.p_unit;
                  }
                } catch(e) {}
                
                try {
                  if (p.note) {
                    const parsedNote = JSON.parse(p.note);
                    if (Number(parsedNote.p_qty) > 0) pQty = Number(parsedNote.p_qty);
                    if (parsedNote.p_unit) pUnit = parsedNote.p_unit;
                    if (Number(parsedNote.link_qty) > 0) linkQty = Number(parsedNote.link_qty);
                    if (parsedNote.s_unit) sUnit = parsedNote.s_unit;
                    if (Number(parsedNote.stock_qty) > 0) stockQty = Number(parsedNote.stock_qty);
                  }
                } catch(e) {}

                const rowNo = finalFilteredPurchases.length - ((currentPage - 1) * itemsPerPage) - i;
     
                return (
                  <tr key={p.id} className={`hover:bg-slate-50/50 h-12 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                    <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                    </td>
                    <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                    <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                      {p.purchase_date ? getKSTDateString(p.purchase_date) : '-'}
                    </td>
                    <td className="px-2 text-indigo-700 truncate" title={itemName}>{itemName}</td>
                    <td className="px-2 text-center font-mono whitespace-nowrap tabular-nums text-slate-900">{pQty}</td>
                    <td className="px-2 text-center text-slate-900">{pUnit}</td>
                    <td className="px-2 text-center font-mono tabular-nums text-slate-600">{linkQty}</td>
                    <td className="px-2 text-center font-mono whitespace-nowrap tabular-nums text-indigo-600">
                      {stockQty}
                    </td>
                    <td className="px-2 text-center text-slate-900 whitespace-nowrap">{sUnit || '-'}</td>
                    <td className="px-2 text-center border-l border-slate-200">
                      <div className="truncate">
                        <span className="text-[10px] text-slate-500 block truncate">{p.purchaser_dept || '-'}</span>
                        <span className="text-slate-800 truncate">{p.purchaser_name || '관리자'}</span>
                      </div>
                    </td>
                    <td className="px-1.5 text-center border-l border-slate-200">
                      <div className="inline-flex items-center justify-center gap-1 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => handleCancelPurchase(p)}
                          title={canEdit ? '입고 철회 (재고 차감)' : '편집 권한 필요'}
                          className={
                            canEdit
                              ? 'px-1.5 py-1.5 bg-orange-50 text-orange-600 border border-orange-200 rounded-md text-[10px] font-black hover:bg-orange-100 shadow-sm whitespace-nowrap'
                              : disabledActionBtn
                          }
                        >
                          입고철회
                        </button>
                        {canEdit ? (
                          isLv1 ? (
                            <button
                              type="button"
                              onClick={() => handleDeletePurchaseLv1(p)}
                              title="잘못된 백데이터 영구 삭제 — LV_1 전용"
                              className="px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap"
                            >
                              삭제(LV_1)
                            </button>
                          ) : null
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDeletePurchaseLv1(p)}
                            title="편집 권한 필요"
                            className={disabledActionBtn}
                          >
                            삭제(LV_1)
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
     
        {finalFilteredPurchases.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </section>
    </div>
  );
}
     
export default function MasterRestockModule() {
  return <Suspense fallback={<LoadingState />}><MasterRestockContent /></Suspense>;
}
