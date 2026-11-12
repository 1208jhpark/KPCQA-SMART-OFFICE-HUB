'use client';

import { isSystemLv1User } from '@/lib/permission-utils';
     
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  isPendingSupplyRequest,
  isReadySupplyRequest,
  isWaitingSupplyRequest,
  isCancelledSupplyRequest,
  isRejectedSupplyRequest,
  isCompletedSupplyRequest,
  supplyRequestStatusLabelDept,
} from '@/utils/supplyRequestStatus';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth, formatKSTDateTime } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';

const MENU_PATH = '/asset/supplies/dept';

type ScopeUnitOpt = { id: string; unit_name: string };

/** 부서 재고 신호등 (방안 B) */
type StockLevel = 'OK' | 'LOW' | 'OUT';

/** 재고보드 헤더·행 동일 트랙 (auto 쓰면 열 어긋남) */
const INVENTORY_ROW_COLS =
  'grid-cols-[minmax(0,1.3fr)_8.5rem_minmax(0,1.3fr)_18rem]';

const STOCK_LEVEL_OPTIONS: {
  id: StockLevel;
  label: string;
  idle: string;
  active: string;
}[] = [
  {
    id: 'OK',
    label: '충분',
    idle: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100',
    active: 'bg-emerald-500 text-white border-emerald-500',
  },
  {
    id: 'LOW',
    label: '소량 남음',
    idle: 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100',
    active: 'bg-amber-500 text-white border-amber-500',
  },
  {
    id: 'OUT',
    label: '부족(지급요청 필요)',
    idle: 'bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100',
    active: 'bg-rose-500 text-white border-rose-500',
  },
];

function asStockLevel(raw: unknown): StockLevel | '' {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'OK' || s === 'LOW' || s === 'OUT') return s;
  return '';
}

/** 조직 표시용 — 객체({id,unit_name})가 JSX로 새지 않게 문자열만 반환 */
function asPlainLabel(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.unit_name === 'string') return o.unit_name;
    if (typeof o.name === 'string') return o.name;
  }
  return '';
}

function normalizeScopeUnit(raw: unknown): ScopeUnitOpt | null {
  if (typeof raw === 'string' && raw.trim()) {
    return { id: raw.trim(), unit_name: raw.trim() };
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? o.unit_id ?? '').trim();
  const unit_name = asPlainLabel(o.unit_name ?? o.name ?? o.unitName);
  if (!id || !unit_name) return null;
  return { id, unit_name };
}

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

function DeptContent() {
  const [requests, setRequests] = useState<any[]>([]);
  const [scopeUnits, setScopeUnits] = useState<ScopeUnitOpt[]>([]);
  /** unitId → { itemKey → 보관위치 } */
  const [itemLocationsByUnitId, setItemLocationsByUnitId] = useState<
    Record<string, Record<string, string>>
  >({});
  /** unitId → { itemKey → OK|LOW|OUT } */
  const [itemLevelsByUnitId, setItemLevelsByUnitId] = useState<
    Record<string, Record<string, StockLevel>>
  >({});
  const [locationEditingKey, setLocationEditingKey] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState('');
  const [locationSaving, setLocationSaving] = useState(false);
  const [levelSavingKey, setLevelSavingKey] = useState<string | null>(null);
  const [myDeptNameFromApi, setMyDeptNameFromApi] = useState<string>('');
  const [myUnitIdFromApi, setMyUnitIdFromApi] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchItemQuery, setSearchItemQuery] = useState('');
  const [searchUserQuery, setSearchUserQuery] = useState('');

  /** 조직 필터: 'ALL' | unit_id — 진입 시 본인 조직으로 맞춤 */
  const [selectedUnitId, setSelectedUnitId] = useState<string>('ALL');
  /** 진입 시점 KST 연·월 (하드코딩 아님) */
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState(() =>
    String(getKSTNowYearMonth().month).padStart(2, '0')
  );
  const unitDefaultAppliedRef = useRef(false);

  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'WAITING'>('ALL');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  /** 지급요청 내역 표 — 기본 접힘 (재고보드 우선) */
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => { 
    fetchData(); 
  }, []);

  const fetchData = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, reqRes, summaryRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        // 부서 범위는 서버(세션)에서만 결정 — 클라에서 재필터하지 않음
        fetch(`/api/asset/supplies/dept?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);

      if (userRes.ok) setCurrentUser(await userRes.json());

      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);

      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH)
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }

      if (reqRes.ok) {
        const data = await reqRes.json();
        if (Array.isArray(data)) {
          setRequests(data);
          setScopeUnits([]);
          setItemLocationsByUnitId({});
          setItemLevelsByUnitId({});
          setMyDeptNameFromApi('');
          setMyUnitIdFromApi('');
        } else {
          setRequests(Array.isArray(data.requests) ? data.requests : []);
          const rawUnits = Array.isArray(data.scopeUnits)
            ? data.scopeUnits
            : Array.isArray(data.scopeDepts)
              ? data.scopeDepts
              : [];
          const units = rawUnits
            .map(normalizeScopeUnit)
            .filter((u: ScopeUnitOpt | null): u is ScopeUnitOpt => !!u);
          setScopeUnits(units);
          setItemLocationsByUnitId(
            data.storageItemLocationsByUnitId &&
              typeof data.storageItemLocationsByUnitId === 'object'
              ? data.storageItemLocationsByUnitId
              : {}
          );
          const levelRaw =
            data.storageItemLevelsByUnitId &&
            typeof data.storageItemLevelsByUnitId === 'object'
              ? data.storageItemLevelsByUnitId
              : {};
          const levelNorm: Record<string, Record<string, StockLevel>> = {};
          for (const [uid, map] of Object.entries(levelRaw as Record<string, unknown>)) {
            if (!map || typeof map !== 'object') continue;
            const inner: Record<string, StockLevel> = {};
            for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
              const lv = asStockLevel(v);
              if (lv) inner[k] = lv;
            }
            levelNorm[uid] = inner;
          }
          setItemLevelsByUnitId(levelNorm);
          setMyDeptNameFromApi(asPlainLabel(data.myDeptName));
          setMyUnitIdFromApi(String(data.myUnitId || ''));
        }
      } else if (reqRes.status === 401 || reqRes.status === 403) {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '부서 소모품 내역을 볼 권한이 없습니다.');
        setRequests([]);
        setScopeUnits([]);
        setItemLocationsByUnitId({});
        setItemLevelsByUnitId({});
      } else {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '부서 소모품 내역을 불러오지 못했습니다.');
        setRequests([]);
        setScopeUnits([]);
        setItemLocationsByUnitId({});
        setItemLevelsByUnitId({});
      }
    } catch(e) { 
      console.error("Data fetch error", e);
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  // API가 viewScope 기준(본인±하위, 상위 제외)으로 반환 — 그대로 사용
  const deptRequests = requests;
  const kstNowYm = getKSTNowYearMonth();
  const kstYear = String(kstNowYm.year);
  const kstMonth = String(kstNowYm.month).padStart(2, '0');

  const myDeptName =
    asPlainLabel(myDeptNameFromApi) ||
    asPlainLabel(currentUser?.unit?.unit_name) ||
    asPlainLabel(currentUser?.dept_name) ||
    '';
  const myUnitId =
    myUnitIdFromApi || currentUser?.unit_id || currentUser?.unit?.id || '';

  const requestUnitId = (r: any) =>
    String(r.unit_id || '').trim();

  const requestDeptLabel = (r: any) =>
    asPlainLabel(r.dept_name) || '-';

  /** 서버 scopeUnits (전체 연계 조직) — 메모 대상 등 */
  const scopeDeptOptions = useMemo(() => {
    if (scopeUnits.length > 0) return scopeUnits;
    const fromData = new Map<string, string>();
    for (const r of deptRequests) {
      const id = requestUnitId(r) || asPlainLabel(r.dept_name);
      const name = requestDeptLabel(r);
      if (id && name && name !== '-') fromData.set(id, name);
    }
    return Array.from(fromData.entries())
      .map(([id, unit_name]) => ({ id, unit_name }))
      .sort((a, b) => a.unit_name.localeCompare(b.unit_name, 'ko'));
  }, [scopeUnits, deptRequests]);

  // 연계필터: 연도 → 월 → 조직 (대장 데이터 기준)
  const availableYears = useMemo(() => {
    const years = deptRequests
      .map((r) => getKSTYearMonthParts(r.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years));
    if (!unique.includes(kstYear)) unique.push(kstYear);
    return unique.sort((a, b) => b.localeCompare(a));
  }, [deptRequests, kstYear]);

  const afterYearList = useMemo(() => {
    if (selectedYear === 'ALL') return deptRequests;
    return deptRequests.filter((r) => getKSTYearMonthParts(r.createdAt)?.year === selectedYear);
  }, [deptRequests, selectedYear]);

  const availableMonths = useMemo(() => {
    const months = afterYearList
      .map((r) => getKSTYearMonthParts(r.createdAt)?.month)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(months));
    // 당해(또는 연도 전체)에는 접속 기준 당월을 옵션에 유지 — 0건이어도 기본 선택 가능
    if (
      (selectedYear === 'ALL' || selectedYear === kstYear) &&
      !unique.includes(kstMonth)
    ) {
      unique.push(kstMonth);
    }
    return unique.sort((a, b) => a.localeCompare(b));
  }, [afterYearList, selectedYear, kstYear, kstMonth]);

  const afterPeriodList = useMemo(() => {
    if (selectedMonth === 'ALL') return afterYearList;
    return afterYearList.filter((r) => getKSTYearMonthParts(r.createdAt)?.month === selectedMonth);
  }, [afterYearList, selectedMonth]);

  /** 기간 내 대장 조직 + 본인 조직(신청 0건이어도 기본 선택 가능) */
  const deptOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of afterPeriodList) {
      const uid = requestUnitId(r);
      const name = requestDeptLabel(r);
      if (uid) {
        const scoped = scopeDeptOptions.find((d) => d.id === uid);
        byId.set(uid, scoped?.unit_name || name);
      } else if (name && name !== '-') {
        const scoped = scopeDeptOptions.find((d) => d.unit_name === name);
        if (scoped) byId.set(scoped.id, scoped.unit_name);
        else byId.set(name, name);
      }
    }
    if (myUnitId) {
      const scoped = scopeDeptOptions.find((d) => d.id === myUnitId);
      byId.set(myUnitId, scoped?.unit_name || myDeptName || '내 조직');
    }
    return Array.from(byId.entries())
      .map(([id, unit_name]) => ({ id, unit_name }))
      .sort((a, b) => a.unit_name.localeCompare(b.unit_name, 'ko'));
  }, [afterPeriodList, scopeDeptOptions, myUnitId, myDeptName]);

  const deptOptionLabels = useMemo(
    () => deptOptions.map((d) => ({ id: String(d.id), label: String(d.unit_name) })),
    [deptOptions]
  );

  /** 진입 시: 연도=현재연도(이미 init), 월=전체, 조직=본인 */
  useEffect(() => {
    if (unitDefaultAppliedRef.current) return;
    if (!myUnitId) return;
    setSelectedUnitId(String(myUnitId));
    unitDefaultAppliedRef.current = true;
  }, [myUnitId]);

  useEffect(() => {
    if (
      selectedYear !== 'ALL' &&
      availableYears.length > 0 &&
      !availableYears.includes(selectedYear)
    ) {
      setSelectedYear(kstYear);
    }
  }, [availableYears, selectedYear, kstYear]);

  useEffect(() => {
    if (selectedMonth === 'ALL') return;
    if (availableMonths.includes(selectedMonth)) return;
    // 당월은 데이터 없어도 유지 (빈 집계가 맞음)
    const keepCurrentMonth =
      (selectedYear === 'ALL' || selectedYear === kstYear) &&
      selectedMonth === kstMonth;
    if (!keepCurrentMonth) setSelectedMonth('ALL');
  }, [availableMonths, selectedMonth, selectedYear, kstYear, kstMonth]);

  useEffect(() => {
    if (
      selectedUnitId !== 'ALL' &&
      !deptOptions.some((d) => d.id === selectedUnitId)
    ) {
      setSelectedUnitId(myUnitId || 'ALL');
    }
  }, [deptOptions, selectedUnitId, myUnitId]);

  const filteredRequests = useMemo(() => {
    return afterPeriodList.filter(r => {
      const deptMatch =
        selectedUnitId === 'ALL' ||
        requestUnitId(r) === selectedUnitId ||
        (!requestUnitId(r) &&
          deptOptions.find((d) => d.id === selectedUnitId)?.unit_name === r.dept_name);
      
      const itemName = r.item_name || r.item?.name || '';
      const itemMatch = !searchItemQuery || itemName.toLowerCase().includes(searchItemQuery.toLowerCase());
      const userMatch = !searchUserQuery || (r.user_name || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      
      if (isCancelledSupplyRequest(r.status)) return false;

      const statusMatch =
        selectedStatus === 'ALL' ||
        (selectedStatus === 'WAITING' && isWaitingSupplyRequest(r.status));
      
      return deptMatch && itemMatch && userMatch && statusMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [afterPeriodList, selectedUnitId, searchItemQuery, searchUserQuery, selectedStatus, deptOptions]);

  const matchesUnitFilter = (r: any) =>
    selectedUnitId === 'ALL' ||
    requestUnitId(r) === selectedUnitId ||
    (!requestUnitId(r) &&
      deptOptions.find((d) => d.id === selectedUnitId)?.unit_name === r.dept_name);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedUnitId, selectedYear, selectedMonth, searchItemQuery, searchUserQuery, selectedStatus]);

  const toggleSelectAll = () => {
    const currentPageIds = paginatedRequests.map(r => r.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };

  const handleCancelRequest = async (req: any) => {
    if (!req?.id) return;
    if (!isPendingSupplyRequest(req.status)) {
      alert('대기 중인 신청만 취소할 수 있습니다.');
      return;
    }
    const ownerEmail = String(req.user_email || '').trim().toLowerCase();
    const sessionEmail = String(currentUser?.email || '').trim().toLowerCase();
    if (!ownerEmail || !sessionEmail || ownerEmail !== sessionEmail) {
      alert('본인이 신청한 건만 취소할 수 있습니다.');
      return;
    }
    const itemName = req.item_name || req.item?.name || '해당 물품';
    if (!confirm(`[신청 취소]\n\n「${itemName}」 ${req.qty}건 신청을 취소하시겠습니까?\n(취소 시 선차감 재고가 복구됩니다.)`)) {
      return;
    }

    setCancellingId(req.id);
    try {
      const res = await fetch('/api/asset/supplies/dept', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', id: req.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || '신청 취소에 실패했습니다.');
        return;
      }
      await fetchData({ silent: true });
    } catch {
      alert('신청 취소 중 오류가 발생했습니다.');
    } finally {
      setCancellingId(null);
    }
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    const formatted = formatKSTDateTime(dateStr);
    return formatted === '-' ? '' : formatted;
  };

  const handleExportExcel = () => {
    const target = selectedIds.size > 0 ? filteredRequests.filter(r => selectedIds.has(r.id)) : filteredRequests;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = target.map((r, idx) => {
      let sUnit = '';
      try {
        const itemExt = r.item?.description ? JSON.parse(r.item.description) : {};
        sUnit = asPlainLabel(itemExt.r_unit || itemExt.s_unit) || '';
      } catch (e) {}

      const itemName = r.item_name || r.item?.name || '';
      return {
        'NO': target.length - idx,
        '신청일시': formatDateTime(r.createdAt),
        '소속조직': requestDeptLabel(r),
        '신청자': r.user_name || '',
        '물품명': itemName,
        '신청수량': sUnit ? `${r.qty} ${sUnit}` : r.qty,
        '사용자 의견': r.note || '',
        '취소사유': r.admin_opinion || '',
        '처리자': r.admin_name || '',
        '처리일시': r.processedAt ? formatDateTime(r.processedAt) : '',
        '상태': supplyRequestStatusLabelDept(r.status),
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서소모품신청내역");
    
    const monthStr = selectedMonth !== 'ALL' ? `_${selectedMonth}월` : '';
    const selectedUnitName =
      selectedUnitId !== 'ALL'
        ? deptOptions.find((d) => d.id === selectedUnitId)?.unit_name || selectedUnitId
        : '';
    const deptStr = selectedUnitName ? `_${selectedUnitName}` : '';
    const statusStr = selectedStatus !== 'ALL' ? `_${selectedStatus}` : '';
    XLSX.writeFile(wb, `부서_소모품신청현황_${selectedYear === 'ALL' ? '전체' : selectedYear}년${monthStr}${deptStr}${statusStr}.xlsx`);
  };

  const resolveReqUnit = (r: any) => {
    try {
      const itemExt = r.item?.description ? JSON.parse(r.item.description) : {};
      return asPlainLabel(itemExt.r_unit || itemExt.s_unit) || '';
    } catch {
      return '';
    }
  };

  /**
   * 좌측: 기간·조직 필터 = 하단 지급요청 내역과 동일 (상태 필터 제외).
   * 물품별 신청 수량 합산 — 재고가 아님.
   */
  const applicationAggItems = useMemo(() => {
    type ItemAgg = { qty: number; unit: string; itemKey: string };
    const itemMap: Record<string, ItemAgg> = {};
    for (const cur of afterPeriodList) {
      if (isCancelledSupplyRequest(cur.status)) continue;
      if (!matchesUnitFilter(cur)) continue;
      const name = String(cur.item_name || cur.item?.name || '').trim();
      if (!name) continue;
      const itemKey = String(cur.item_id || cur.item?.id || name).trim() || name;
      if (!itemMap[name]) {
        itemMap[name] = { qty: 0, unit: resolveReqUnit(cur), itemKey };
      }
      itemMap[name].qty += Number(cur.qty) || 0;
      if (!itemMap[name].unit) itemMap[name].unit = resolveReqUnit(cur);
      if (!itemMap[name].itemKey) itemMap[name].itemKey = itemKey;
    }
    return (Object.entries(itemMap) as [string, ItemAgg][])
      .map(([name, agg]) => ({ name, ...agg }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ko'));
  }, [afterPeriodList, selectedUnitId, deptOptions]);

  /** 우측 재고보드용 — 전체 기간 신청 물품 · 최근 보충일(지급완료 처리일) */
  const inventoryItems = useMemo(() => {
    type ItemAgg = { unit: string; itemKey: string; lastReplenishedAt: number | null };
    const itemMap: Record<string, ItemAgg> = {};
    for (const cur of deptRequests) {
      if (isCancelledSupplyRequest(cur.status)) continue;
      const name = String(cur.item_name || cur.item?.name || '').trim();
      if (!name) continue;
      const itemKey = String(cur.item_id || cur.item?.id || name).trim() || name;
      if (!itemMap[name]) {
        itemMap[name] = { unit: resolveReqUnit(cur), itemKey, lastReplenishedAt: null };
      }
      if (!itemMap[name].unit) itemMap[name].unit = resolveReqUnit(cur);
      if (isCompletedSupplyRequest(cur.status)) {
        const t = new Date(cur.processedAt || cur.createdAt || 0).getTime();
        if (Number.isFinite(t) && t > 0) {
          const prev = itemMap[name].lastReplenishedAt;
          if (prev == null || t > prev) itemMap[name].lastReplenishedAt = t;
        }
      }
    }
    return (Object.entries(itemMap) as [string, ItemAgg][])
      .map(([name, agg]) => ({ name, ...agg }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [deptRequests]);

  /** 하단 표와 동일 기간·조직 기준 지급대기(PENDING·레거시 READY) 건수 */
  const waitingCount = useMemo(() => {
    return afterPeriodList.filter(
      (r) => !isCancelledSupplyRequest(r.status) && matchesUnitFilter(r) && isWaitingSupplyRequest(r.status)
    ).length;
  }, [afterPeriodList, selectedUnitId, deptOptions]);

  /** 재고·보관위치 대상 조직: 필터 ALL이면 내 소속, 아니면 선택한 조직 */
  const stockUnitId =
    selectedUnitId === 'ALL'
      ? myUnitId
      : selectedUnitId;
  const stockDeptName = asPlainLabel(
    deptOptions.find((d) => d.id === stockUnitId)?.unit_name ||
      scopeDeptOptions.find((d) => d.id === stockUnitId)?.unit_name ||
      (selectedUnitId === 'ALL' ? myDeptName : '') ||
      myDeptName
  );

  const canEditStock =
    !!stockUnitId &&
    (scopeDeptOptions.some((d) => d.id === String(stockUnitId)) ||
      String(stockUnitId) === String(myUnitId));

  useEffect(() => {
    setLocationEditingKey(null);
    setLocationDraft('');
  }, [stockUnitId]);

  const itemLocationsForStockUnit =
    (stockUnitId && itemLocationsByUnitId[stockUnitId]) || {};
  const itemLevelsForStockUnit =
    (stockUnitId && itemLevelsByUnitId[stockUnitId]) || {};

  const saveItemStockLevel = async (itemKey: string, nextLevel: StockLevel | '') => {
    if (!canEditStock) {
      return alert('선택한 조직의 재고 상태를 수정할 수 없습니다.');
    }
    if (!stockUnitId && !stockDeptName) return alert('대상 조직을 확인할 수 없습니다.');
    const prevLevel = itemLevelsForStockUnit[itemKey] || '';
    // 같은 뱃지 재클릭 → 해제
    const levelToSave: StockLevel | '' = prevLevel === nextLevel ? '' : nextLevel;
    setLevelSavingKey(itemKey);
    // 낙관적 업데이트
    setItemLevelsByUnitId((prev) => {
      const unitMap = { ...(prev[stockUnitId] || {}) };
      if (levelToSave) unitMap[itemKey] = levelToSave;
      else delete unitMap[itemKey];
      return { ...prev, [stockUnitId]: unitMap };
    });
    try {
      const res = await fetch('/api/asset/supplies/dept', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: stockUnitId || undefined,
          dept_name: stockDeptName || undefined,
          item_key: itemKey,
          item_stock_level: levelToSave,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 롤백
        setItemLevelsByUnitId((prev) => {
          const unitMap = { ...(prev[stockUnitId] || {}) };
          if (prevLevel) unitMap[itemKey] = prevLevel as StockLevel;
          else delete unitMap[itemKey];
          return { ...prev, [stockUnitId]: unitMap };
        });
        alert(data.error || '재고 상태 저장에 실패했습니다.');
        return;
      }
      const savedId = String(data.unit_id || stockUnitId);
      const savedLevel = asStockLevel(data.item_stock_level);
      setItemLevelsByUnitId((prev) => {
        const unitMap = { ...(prev[savedId] || {}) };
        if (savedLevel) unitMap[itemKey] = savedLevel;
        else delete unitMap[itemKey];
        return { ...prev, [savedId]: unitMap };
      });
    } catch {
      setItemLevelsByUnitId((prev) => {
        const unitMap = { ...(prev[stockUnitId] || {}) };
        if (prevLevel) unitMap[itemKey] = prevLevel as StockLevel;
        else delete unitMap[itemKey];
        return { ...prev, [stockUnitId]: unitMap };
      });
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLevelSavingKey(null);
    }
  };

  const startLocationEdit = (itemKey: string, current: string) => {
    if (!canEditStock) {
      return alert('선택한 조직의 품목 보관 위치를 수정할 수 없습니다.');
    }
    setLocationEditingKey(itemKey);
    setLocationDraft(current || '');
  };

  const cancelLocationEdit = () => {
    setLocationEditingKey(null);
    setLocationDraft('');
  };

  const saveItemLocation = async (itemKey: string) => {
    if (!canEditStock) return alert('선택한 조직의 품목 보관 위치를 수정할 수 없습니다.');
    if (!stockUnitId && !stockDeptName) return alert('대상 조직을 확인할 수 없습니다.');
    const nextLoc = locationDraft.trim();
    setLocationSaving(true);
    try {
      const res = await fetch('/api/asset/supplies/dept', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: stockUnitId || undefined,
          dept_name: stockDeptName || undefined,
          item_key: itemKey,
          item_location: nextLoc,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || '보관 위치 저장에 실패했습니다.');
        return;
      }
      const savedId = String(data.unit_id || stockUnitId);
      setItemLocationsByUnitId((prev) => {
        const unitMap = { ...(prev[savedId] || {}) };
        if (nextLoc) unitMap[itemKey] = nextLoc;
        else delete unitMap[itemKey];
        return { ...prev, [savedId]: unitMap };
      });
      setLocationEditingKey(null);
      setLocationDraft('');
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLocationSaving(false);
    }
  };

  if (loading) return <LoadingState />;

  const periodCriteriaLabel = `${selectedYear === 'ALL' ? '전체 연도' : `${selectedYear}년`} · ${
    selectedMonth === 'ALL' ? '전체 월' : `${Number(selectedMonth)}월`
  }`;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 마케팅 distribution/dept 배너 규격: gradient · orbs · label 10px / title 2xl / desc xs */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-indigo-400 mb-2.5">
            SUPPLIES MANAGEMENT SYSTEM
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-indigo-400 font-normal">{String(myDeptName || '소속 부서')}</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-medium">소모품 보유 현황</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            우리 센터(본부의 경우 하위 센터까지)의 소모품 보유 현황 및 신청 내역을 조회합니다.
          </p>
          {permissionSummary && isSystemLv1User(currentUser) && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-white/10 border-white/25 text-slate-50 shadow-sm">
                <span>👑 Master 책임자:</span>
                <span>{permissionSummary.masterName}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
                <span>👁️ Access:</span>
                <span>{permissionSummary.accessDesignate}</span>
                <span className="opacity-50">|</span>
                <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.accessLevel}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
                <span>✍️ Edit:</span>
                <span>{permissionSummary.editDesignate}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.editLevel}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      
      {/* 좌: 기간별 신청 집계(좁게) · 우: 재고 관리(넓게) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-6 md:items-stretch">

        <div className="md:col-span-4 bg-white rounded-none border border-slate-200 shadow-sm p-5 flex flex-col min-h-[280px] h-full">
          <div className="flex justify-between items-end mb-3 shrink-0 gap-2">
            <h3 className="text-sm font-medium text-slate-800 tracking-tight">
              📦 품목별 신청 집계
            </h3>
            <span className="text-[11px] font-medium text-slate-600 whitespace-nowrap">
              조회 기준 <span className="text-indigo-700">{periodCriteriaLabel}</span>
            </span>
          </div>

          {applicationAggItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[11px] font-bold text-slate-300 italic">
              신청 내역 없음
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto border border-slate-100 rounded-xl">
              {/* 타이포: 하단 지급요청 내역 표와 동일 (11px / th 600 / td 400 / #333) */}
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 bg-slate-50 border-b border-slate-100">
                <span className="text-[11px] font-semibold text-[#333333] text-left">품목</span>
                <span className="text-[11px] font-semibold text-[#333333] text-right whitespace-nowrap">신청수량</span>
              </div>
              <div className="divide-y divide-slate-100">
                {applicationAggItems.map((item) => (
                  <div
                    key={item.name}
                    className="w-full grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center px-3 py-2 bg-white text-[#333333] hover:bg-slate-50/80"
                  >
                    <span className="min-w-0 text-[11px] font-normal truncate" title={item.name}>
                      {item.name}
                    </span>
                    <span className="shrink-0 text-[11px] font-normal tabular-nums text-[#333333] text-right whitespace-nowrap">
                      {item.qty.toLocaleString()}
                      {item.unit ? (
                        <span className="text-[10px] font-normal text-slate-500 ml-1">{item.unit}</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="md:col-span-8 bg-white rounded-none border border-slate-200 shadow-sm p-5 flex flex-col min-h-[280px] h-full">
          <div className="flex justify-between items-end mb-3 shrink-0 gap-2">
            <h3 className="text-sm font-medium text-slate-800 tracking-tight flex items-center gap-2 flex-wrap">
              <span>📦 품목별 재고 관리</span>
              <span className="normal-case tracking-normal text-[10px] font-bold text-slate-400">
                최근 보충일 · 보관위치 · 상태 체크
                {stockDeptName ? ` · ${stockDeptName}` : ''}
              </span>
            </h3>
          </div>

          {inventoryItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[11px] font-bold text-slate-300 italic">
              재고 관리할 물품이 없습니다
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto border border-slate-100 rounded-xl">
              {/* 타이포: 하단 지급요청 내역 표와 동일 */}
              <div
                className={`sticky top-0 z-10 grid ${INVENTORY_ROW_COLS} gap-x-3 px-3 py-2 bg-slate-50 border-b border-slate-100 items-center`}
              >
                <span className="min-w-0 text-[11px] font-semibold text-[#333333] text-left">
                  품목
                </span>
                <span className="text-[11px] font-semibold text-[#333333] text-center whitespace-nowrap">
                  최근 보충일
                </span>
                <span className="min-w-0 text-[11px] font-semibold text-[#333333] text-left">
                  보관위치
                </span>
                <span className="flex flex-col items-end gap-0.5 text-right leading-tight tracking-normal">
                  <span className="text-[11px] font-medium text-blue-600">
                    [우리부서 재고 현황]
                  </span>
                  <span className="text-[11px] font-semibold text-[#333333]">
                    최근 이용자는 상태를 체크해주세요!
                  </span>
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {inventoryItems.map((item) => {
                  const itemKey = item.itemKey || item.name;
                  const locationText =
                    itemLocationsForStockUnit[itemKey] ||
                    itemLocationsForStockUnit[item.name] ||
                    '';
                  const currentLevel =
                    itemLevelsForStockUnit[itemKey] ||
                    itemLevelsForStockUnit[item.name] ||
                    '';
                  const isLocEditing = locationEditingKey === itemKey;
                  const levelBusy = levelSavingKey === itemKey;
                  const lastDate =
                    item.lastReplenishedAt != null
                      ? getKSTDateString(new Date(item.lastReplenishedAt))
                      : '';
                  return (
                    <div
                      key={item.name}
                      className={`w-full grid ${INVENTORY_ROW_COLS} gap-x-3 items-center px-3 py-2 bg-white text-[#333333] hover:bg-slate-50/80`}
                    >
                      <span className="min-w-0 text-[11px] font-normal truncate text-left" title={item.name}>
                        {item.name}
                      </span>
                      <span
                        className={`w-full text-[11px] font-normal text-center tabular-nums whitespace-nowrap ${
                          lastDate ? 'text-[#333333]' : 'text-slate-300'
                        }`}
                        title={lastDate ? '지급완료 처리일 기준' : '지급완료 이력 없음'}
                      >
                        {lastDate || '-'}
                      </span>
                      <div className="min-w-0 w-full text-left">
                        {isLocEditing ? (
                          <div className="flex items-center gap-1 w-full">
                            <input
                              type="text"
                              value={locationDraft}
                              maxLength={200}
                              autoFocus
                              disabled={locationSaving}
                              onChange={(e) => setLocationDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void saveItemLocation(itemKey);
                                }
                                if (e.key === 'Escape') cancelLocationEdit();
                              }}
                              placeholder="예: 선반 A-3"
                              className="w-full min-w-0 px-1.5 py-0.5 rounded border border-slate-200 text-[11px] font-normal text-[#333333] outline-none focus:border-indigo-400"
                            />
                            <button
                              type="button"
                              disabled={locationSaving}
                              onClick={() => void saveItemLocation(itemKey)}
                              className="shrink-0 text-[10px] font-medium text-indigo-600 hover:underline disabled:opacity-40"
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              disabled={locationSaving}
                              onClick={cancelLocationEdit}
                              className="shrink-0 text-[10px] font-normal text-slate-400 hover:underline"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            title={
                              canEditStock
                                ? '클릭하여 보관위치 편집'
                                : locationText || '보관위치 없음'
                            }
                            onClick={() => startLocationEdit(itemKey, locationText)}
                            className={`block w-full text-left text-[11px] font-normal truncate tracking-normal ${
                              locationText
                                ? 'text-[#333333] hover:text-indigo-600 hover:underline'
                                : 'text-slate-300 hover:text-indigo-500 hover:underline'
                            }`}
                          >
                            {locationText || (canEditStock ? '위치 입력' : '-')}
                          </button>
                        )}
                      </div>
                      <div
                        className="flex flex-nowrap items-center justify-end gap-1.5"
                        role="radiogroup"
                        aria-label={`${item.name} 재고 상태`}
                      >
                        {STOCK_LEVEL_OPTIONS.map((opt) => {
                          const selected = currentLevel === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              disabled={!canEditStock || levelBusy}
                              title={
                                canEditStock
                                  ? selected
                                    ? '다시 누르면 해제'
                                    : opt.label
                                  : opt.label
                              }
                              onClick={() => void saveItemStockLevel(itemKey, opt.id)}
                              className={`inline-flex items-center h-7 px-2 rounded-md border text-[10px] font-medium tracking-normal whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                selected ? opt.active : opt.idle
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
     
      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
          
          <div
            className={`p-4 px-6 bg-slate-200/70 flex flex-wrap items-center justify-between gap-4 ${
              ledgerOpen ? 'border-b border-slate-300' : ''
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <button
                type="button"
                onClick={() => setLedgerOpen((v) => !v)}
                className="inline-flex items-center gap-2 min-w-0 rounded-lg hover:bg-white/50 px-1.5 py-1 -ml-1.5 transition-colors"
                aria-expanded={ledgerOpen}
                title={ledgerOpen ? '내역 접기' : '내역 펼치기'}
              >
                <span
                  className={`text-slate-500 text-[10px] font-black transition-transform ${
                    ledgerOpen ? 'rotate-90' : ''
                  }`}
                  aria-hidden
                >
                  ▶
                </span>
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                <h2 className="text-sm font-black text-slate-800 tracking-tight">
                  (경영) 소모품 지급요청 내역
                </h2>
              </button>
              <span className="inline-flex items-center h-6 text-[11px] font-medium px-2.5 rounded-md bg-slate-300/80 text-slate-700 border border-transparent leading-none">
                {filteredRequests.length}건
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedStatus((prev) => (prev === 'WAITING' ? 'ALL' : 'WAITING'));
                  setLedgerOpen(true);
                }}
                className={`inline-flex items-center h-6 text-[11px] font-medium px-2.5 rounded-md border leading-none transition-colors ${
                  selectedStatus === 'WAITING'
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                }`}
                title="클릭하면 지급대기만 필터 · 내역 펼침"
              >
                지급대기 {waitingCount}건
              </button>
              {!ledgerOpen && (
                <button
                  type="button"
                  onClick={() => setLedgerOpen(true)}
                  className="text-[11px] font-medium text-indigo-600 hover:underline"
                >
                  펼치기
                </button>
              )}
            </div>
            
            <div className="soh-filter-bar flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[11px] font-medium text-slate-400 uppercase">연도</span>
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(e.target.value);
                    setSelectedMonth('ALL');
                    setSelectedUnitId(myUnitId || 'ALL');
                  }}
                  className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {availableYears.map((year) => (
                    <option key={year} value={year}>{year}년</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[11px] font-medium text-slate-400 uppercase">월별</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    setSelectedUnitId(myUnitId || 'ALL');
                  }}
                  className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>{month}월</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[11px] font-medium text-slate-400 uppercase">조직</span>
                <select
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                  className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent max-w-[160px]"
                >
                  <option value="ALL">전체 (연계 조직)</option>
                  {deptOptionLabels.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.label}
                    </option>
                  ))}
                </select>
              </div>

              {ledgerOpen && (
              <>
              <div className="flex items-center gap-2">
                <div className="relative w-40">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">📦</span>
                  <input type="text" placeholder="물품명 검색..." value={searchItemQuery} onChange={e => setSearchItemQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:border-indigo-500 shadow-sm transition-colors placeholder:font-medium" />
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">👤</span>
                  <input type="text" placeholder="신청자 검색..." value={searchUserQuery} onChange={e => setSearchUserQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:border-indigo-500 shadow-sm transition-colors placeholder:font-medium" />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-medium shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
              >
                {selectedIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
              </>
              )}
            </div>
          </div>
     
          {ledgerOpen && (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed min-w-[1080px]">
              <colgroup>
                <col className="w-[40px]" />
                <col className="w-[48px]" />
                <col className="w-[90px]" />
                <col className="w-[120px]" />
                <col className="w-[150px]" />
                <col className="w-[88px]" />
                <col className="w-[280px]" />
                <col className="w-[110px]" />
                <col className="w-[88px]" />
                <col className="w-[130px]" />
              </colgroup>
              <thead className="bg-slate-100 text-[11px] font-semibold text-[#333333] border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 text-center">
                    <input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                  </th>
                  <th className="h-12 px-2 text-center">NO</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
                  <th className="h-12 px-2 text-left">부서 / 신청자</th>
                  <th className="h-12 px-2 text-left">물품명</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청수량</th>
                  <th className="h-12 px-2 text-left">신청자 특이요청 사항</th>
                  <th className="h-12 px-2 text-left whitespace-nowrap border-l border-slate-200">부서 / 처리자</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">지급일</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap border-l border-slate-200">상태</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-normal text-[#333333]">
                {paginatedRequests.length === 0 ? (
                  <tr><td colSpan={10} className="p-16 text-center text-slate-400 text-[11px]">조건에 맞는 신청 내역이 없습니다.</td></tr>
                ) : (
                  paginatedRequests.map((req, i) => {
                    const isPending = isPendingSupplyRequest(req.status);
                    const isReady = isReadySupplyRequest(req.status);
                    const isRejected = isRejectedSupplyRequest(req.status);
                    const isCancelled = isCancelledSupplyRequest(req.status);
                    const isMine = Boolean(
                      currentUser?.email &&
                        String(req.user_email || '').trim().toLowerCase() ===
                          String(currentUser.email || '').trim().toLowerCase()
                    );
                    let sUnit = '';
                    try {
                      const itemExt = req.item?.description ? JSON.parse(req.item.description) : {};
                      sUnit = asPlainLabel(itemExt.r_unit || itemExt.s_unit) || '';
                    } catch (e) {}

                    const itemName = req.item_name || req.item?.name || '';
                    const rowNo = filteredRequests.length - ((currentPage - 1) * itemsPerPage + i);
                    const createdDate = getKSTDateString(req.createdAt) || '-';
                    const processDate = getKSTDateString(req.processedAt) || '-';
                    const isSelected = selectedIds.has(req.id);
     
                    return (
                      <tr
                        key={req.id}
                        className={`h-12 transition-colors ${
                          isRejected
                            ? isSelected
                              ? 'bg-slate-200/80 text-red-500 [&_td]:text-red-500 [&_td]:line-through'
                              : 'bg-slate-100/80 text-red-500 hover:bg-slate-100 [&_td]:text-red-500 [&_td]:line-through'
                            : isSelected
                              ? 'bg-indigo-50/50 hover:bg-slate-50/50'
                              : 'hover:bg-slate-50/50'
                        }`}
                      >
                        <td className="pl-4 text-center !no-underline" style={isRejected ? { textDecoration: 'none' } : undefined} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); isSelected ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                        </td>
                        <td className="px-2 text-center tabular-nums !text-slate-500 !no-underline" style={isRejected ? { textDecoration: 'none' } : undefined}>{rowNo}</td>
                        <td className={`px-2 text-center whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-[#333333]'}`}>{createdDate}</td>
                        <td className="px-2 text-left min-w-0">
                          <span className={`text-[11px] font-normal block truncate ${isRejected ? '' : 'text-slate-500'}`}>{String(requestDeptLabel(req))}</span>
                          <span className={`font-normal block truncate ${isRejected ? '' : 'text-[#333333]'}`}>{req.user_name || '-'}</span>
                        </td>
                        <td className={`px-2 text-left font-medium truncate min-w-0 ${isRejected ? '' : 'text-[#333333]'}`} title={itemName}>{itemName}</td>
                        <td className={`px-2 text-center whitespace-nowrap tabular-nums font-medium ${isRejected ? '' : 'text-[#333333]'}`}>
                          {req.qty}
                          {sUnit && <span className={`text-[11px] font-medium ml-0.5 ${isRejected ? '' : 'text-slate-500'}`}>{sUnit}</span>}
                        </td>
                        <td className={`px-2 text-left font-normal truncate ${isRejected ? '' : 'text-[#333333]'}`} title={req.note || ''}>
                          {req.note ? `"${req.note}"` : '-'}
                        </td>
                        <td className="px-2 text-left min-w-0 border-l border-slate-200">
                          {!isPending ? (
                            <div className="min-w-0">
                              <span className={`text-[11px] font-normal block truncate ${isRejected ? '' : 'text-slate-500'}`}>{req.admin_dept || '-'}</span>
                              <span className={`font-normal block truncate ${isRejected ? '' : 'text-[#333333]'}`}>{req.admin_name || '관리자'}</span>
                            </div>
                          ) : (
                            <span className="text-slate-300 !no-underline" style={{ textDecoration: 'none' }}>-</span>
                          )}
                        </td>
                        <td className={`px-2 text-center whitespace-nowrap tabular-nums font-normal ${isRejected ? '' : 'text-[#333333]'}`}>
                          {!isPending ? processDate : <span className="text-slate-300 !no-underline" style={{ textDecoration: 'none' }}>-</span>}
                        </td>
                        <td className="px-2 text-center border-l border-slate-200 !no-underline" style={isRejected ? { textDecoration: 'none' } : undefined}>
                          {isPending && isMine ? (
                            <button
                              type="button"
                              disabled={cancellingId === req.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelRequest(req);
                              }}
                              className="inline-block border px-2 py-0.5 rounded text-[11px] font-medium tracking-normal whitespace-nowrap bg-red-50 text-red-600 border-red-200 hover:bg-red-100 transition-colors disabled:opacity-40"
                            >
                              {cancellingId === req.id ? '처리중…' : '신청취소'}
                            </button>
                          ) : isPending || isReady ? (
                            <span className="inline-block font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[11px]">
                              지급대기
                            </span>
                          ) : isRejected ? (
                            <span
                              className="inline-flex flex-col items-center leading-tight"
                              title={req.admin_opinion || ''}
                            >
                              <span className="text-[11px] font-medium tracking-normal whitespace-nowrap text-red-600">
                                취소
                              </span>
                              {req.admin_opinion ? (
                                <span className="text-[11px] font-medium text-red-400 truncate max-w-[88px] mt-0.5">
                                  {req.admin_opinion}
                                </span>
                              ) : null}
                            </span>
                          ) : isCancelled ? (
                            <span className="inline-block border px-2 py-0.5 rounded text-[11px] font-medium tracking-normal whitespace-nowrap bg-slate-100 text-slate-500 border-slate-200">
                              신청취소
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium tracking-normal whitespace-nowrap text-[#333333]">
                              지급완료
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
     
          {filteredRequests.length > 0 && (
            <WindowedPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
          </>
          )}
        </div>
    </div>
  );
}

export default function DeptModule() {
  return <DeptContent />;
}