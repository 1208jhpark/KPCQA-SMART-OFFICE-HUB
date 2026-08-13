'use client';
     
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  isCompletedSupplyRequest,
  isPendingSupplyRequest,
  isRejectedSupplyRequest,
  normalizeSupplyRequestStatus,
  supplyRequestStatusLabel,
} from '@/utils/supplyRequestStatus';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth, formatKSTDateTime } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';

const MENU_PATH = '/asset/supplies/dept';

type ScopeUnitOpt = { id: string; unit_name: string };

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
  const [storageNotesByUnitId, setStorageNotesByUnitId] = useState<Record<string, string>>({});
  const [myDeptNameFromApi, setMyDeptNameFromApi] = useState<string>('');
  const [myUnitIdFromApi, setMyUnitIdFromApi] = useState<string>('');
  const [editableUnitIds, setEditableUnitIds] = useState<string[]>([]);
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
  /** 진입 시점 KST 연도 (하드코딩 아님) */
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const unitDefaultAppliedRef = useRef(false);

  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'COMPLETED' | 'PENDING' | 'REJECTED'>('ALL');
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);

  const [memoEditing, setMemoEditing] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');
  const [memoSaving, setMemoSaving] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => { 
    fetchData(); 
  }, []);

  const fetchData = async () => {
    setLoading(true);
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
          setStorageNotesByUnitId({});
          setMyDeptNameFromApi('');
          setMyUnitIdFromApi('');
          setEditableUnitIds([]);
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
          setStorageNotesByUnitId(
            data.storageNotesByUnitId && typeof data.storageNotesByUnitId === 'object'
              ? data.storageNotesByUnitId
              : {}
          );
          // 구형 storageNotes(name→note)만 온 경우 unit_id 맵으로 변환
          if (
            (!data.storageNotesByUnitId || Object.keys(data.storageNotesByUnitId).length === 0) &&
            data.storageNotes &&
            typeof data.storageNotes === 'object'
          ) {
            const byId: Record<string, string> = {};
            for (const u of units) {
              if (data.storageNotes[u.unit_name] != null) {
                byId[u.id] = String(data.storageNotes[u.unit_name] || '');
              }
            }
            setStorageNotesByUnitId(byId);
          }
          setMyDeptNameFromApi(asPlainLabel(data.myDeptName));
          setMyUnitIdFromApi(String(data.myUnitId || ''));
          setEditableUnitIds(
            Array.isArray(data.editableUnitIds)
              ? data.editableUnitIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
              : []
          );
        }
        setMemoEditing(false);
      } else if (reqRes.status === 401 || reqRes.status === 403) {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '부서 소모품 내역을 볼 권한이 없습니다.');
        setRequests([]);
        setScopeUnits([]);
        setStorageNotesByUnitId({});
        setEditableUnitIds([]);
      } else {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '부서 소모품 내역을 불러오지 못했습니다.');
        setRequests([]);
        setScopeUnits([]);
        setStorageNotesByUnitId({});
        setEditableUnitIds([]);
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
  const kstYear = String(getKSTNowYearMonth().year);

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
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [afterYearList]);

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
    if (selectedMonth !== 'ALL' && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth('ALL');
    }
  }, [availableMonths, selectedMonth]);

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
      
      const statusMatch = selectedStatus === 'ALL' ||
        (selectedStatus === 'COMPLETED' && isCompletedSupplyRequest(r.status)) ||
        (selectedStatus === 'PENDING' && isPendingSupplyRequest(r.status)) ||
        (selectedStatus === 'REJECTED' && isRejectedSupplyRequest(r.status));
      
      const itemFilterMatch = !selectedItemFilter || itemName === selectedItemFilter;
      
      return deptMatch && itemMatch && userMatch && statusMatch && itemFilterMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [afterPeriodList, selectedUnitId, searchItemQuery, searchUserQuery, selectedStatus, selectedItemFilter, deptOptions]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedUnitId, selectedYear, selectedMonth, searchItemQuery, searchUserQuery, selectedStatus, selectedItemFilter]);

  const toggleSelectAll = () => {
    const currentPageIds = paginatedRequests.map(r => r.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
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
        '관리자 답변': r.admin_opinion || '',
        '처리자': r.admin_name || '',
        '처리일시': r.processedAt ? formatDateTime(r.processedAt) : '',
        '상태': supplyRequestStatusLabel(r.status),
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
    const itemStr = selectedItemFilter ? `_${selectedItemFilter}` : '';
    XLSX.writeFile(wb, `부서_소모품신청현황_${selectedYear === 'ALL' ? '전체' : selectedYear}년${monthStr}${deptStr}${statusStr}${itemStr}.xlsx`);
  };

  const statsData = useMemo(() => {
    const periodReqs = deptRequests.filter(r => {
      if (
        selectedUnitId !== 'ALL' &&
        requestUnitId(r) !== selectedUnitId &&
        !(
          !requestUnitId(r) &&
          deptOptions.find((d) => d.id === selectedUnitId)?.unit_name === r.dept_name
        )
      ) {
        return false;
      }
      const ym = getKSTYearMonthParts(r.createdAt);
      const reqYear = ym?.year || '';
      const reqMonth = ym?.month || '';
      const yearMatch = selectedYear === 'ALL' || reqYear === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || reqMonth === selectedMonth;
      return yearMatch && monthMatch;
    });
      
    const totalQty = periodReqs.reduce((sum, cur) => sum + (Number(cur.qty) || 0), 0);

    const resolveReqUnit = (r: any) => {
      try {
        const itemExt = r.item?.description ? JSON.parse(r.item.description) : {};
        return asPlainLabel(itemExt.r_unit || itemExt.s_unit) || '';
      } catch {
        return '';
      }
    };

    type ItemAgg = { qty: number; lastAt: string; unit: string };
    const itemMap = periodReqs.reduce((acc: Record<string, ItemAgg>, cur) => {
      const name = cur.item_name || cur.item?.name;
      if (!name) return acc;
      if (!acc[name]) acc[name] = { qty: 0, lastAt: '', unit: resolveReqUnit(cur) };
      acc[name].qty += Number(cur.qty) || 0;
      if (!acc[name].unit) acc[name].unit = resolveReqUnit(cur);
      const created = String(cur.createdAt || '');
      if (created && (!acc[name].lastAt || new Date(created).getTime() > new Date(acc[name].lastAt).getTime())) {
        acc[name].lastAt = created;
      }
      return acc;
    }, {});

    const allItems = (Object.entries(itemMap) as [string, ItemAgg][])
      .map(([name, agg]) => ({ name, ...agg }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ko'));

    const totalReqCount = periodReqs.length;
    const statusMap = { COMPLETED: 0, PENDING: 0, REJECTED: 0 };
   
    periodReqs.forEach(r => {
      const s = normalizeSupplyRequestStatus(r.status);
      if (s === 'COMPLETED') statusMap.COMPLETED++;
      else if (s === 'REJECTED') statusMap.REJECTED++;
      else statusMap.PENDING++;
    });

    const statusStats = [
      { id: 'COMPLETED', label: '✅ 지급 완료', count: statusMap.COMPLETED, color: 'emerald' },
      { id: 'PENDING', label: '⏳ 승인 대기중', count: statusMap.PENDING, color: 'orange' },
      { id: 'REJECTED', label: '❌ 반려 / 취소', count: statusMap.REJECTED, color: 'red' }
    ].map(s => ({
      ...s,
      percent: totalReqCount > 0 ? ((s.count / totalReqCount) * 100).toFixed(1) : '0.0'
    }));

    return { totalQty, totalReqCount, allItems, statusStats };
  }, [deptRequests, selectedUnitId, selectedYear, selectedMonth, deptOptions]);
     
  const editState = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig),
    [currentUser, interfaceConfig]
  );

  /** 보관 메모 대상 조직: 필터 ALL이면 내 소속, 아니면 선택한 조직 */
  const memoUnitId =
    selectedUnitId === 'ALL'
      ? myUnitId
      : selectedUnitId;
  const memoDeptName = asPlainLabel(
    deptOptions.find((d) => d.id === memoUnitId)?.unit_name ||
      scopeDeptOptions.find((d) => d.id === memoUnitId)?.unit_name ||
      (selectedUnitId === 'ALL' ? myDeptName : '') ||
      myDeptName
  );
  const currentMemo = (memoUnitId && storageNotesByUnitId[memoUnitId]) || '';

  /** Access 통과자 중 Editor + editScope 안 조직만 메모 수정 */
  const canEditMemo =
    editState.isEditor &&
    !!memoUnitId &&
    editableUnitIds.includes(String(memoUnitId));

  useEffect(() => {
    setMemoEditing(false);
    setMemoDraft(currentMemo);
  }, [memoUnitId, currentMemo]);

  const startMemoEdit = () => {
    if (!editState.isEditor) {
      return alert('보관 안내 수정 권한이 없습니다.\nadmin/interface에서 해당 메뉴 Edit 권한을 확인하세요.');
    }
    if (!canEditMemo) {
      return alert('선택한 조직은 Edit Scope 밖이라 보관 안내를 수정할 수 없습니다.');
    }
    setMemoDraft(currentMemo);
    setMemoEditing(true);
  };

  const cancelMemoEdit = () => {
    setMemoDraft(currentMemo);
    setMemoEditing(false);
  };

  const saveMemo = async () => {
    if (!editState.isEditor) return alert('보관 안내 수정 권한이 없습니다. (Edit 필요)');
    if (!canEditMemo) return alert('선택한 조직은 Edit Scope 밖이라 보관 안내를 수정할 수 없습니다.');
    if (!memoUnitId && !memoDeptName) return alert('대상 조직을 확인할 수 없습니다.');
    setMemoSaving(true);
    try {
      const res = await fetch('/api/asset/supplies/dept', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: memoUnitId || undefined,
          dept_name: memoDeptName || undefined,
          note: memoDraft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || '보관 안내 저장에 실패했습니다.');
        return;
      }
      const savedId = String(data.unit_id || memoUnitId);
      setStorageNotesByUnitId((prev) => ({
        ...prev,
        [savedId]: String(data.note ?? memoDraft),
      }));
      setMemoEditing(false);
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setMemoSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  
  const statsTitle = `${selectedYear === 'ALL' ? '전체 기간' : `${selectedYear}년`} ${selectedMonth === 'ALL' ? '' : `${selectedMonth}월`}`;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 마케팅 distribution/dept 배너 규격: gradient · orbs · label 10px / title 2xl / desc xs */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2.5">
            SUPPLIES MANAGEMENT SYSTEM
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-indigo-400 font-normal">{String(myDeptName || '소속 부서')}</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-extrabold">소모품 지급 대장</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            연계 조직(본인·하위)의 소모품 신청 내역 및 처리 현황을 조회합니다.
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
            </div>
          )}
        </div>
      </div>

      
      {/* 🚀 통계 카드 영역 — 좌/우 동일 높이 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 md:items-stretch">
        
{/* 좌측: 품목별 집계 — 물품명 | 단위 | 수량막대(최대수량 대비) | 최근신청일 */}
<div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-6 flex flex-col min-h-[280px] h-full">
          <div className="flex justify-between items-end mb-3 shrink-0">
            <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 flex-wrap">
              <span>📦 {statsTitle} 품목별 실시간 신청 집계</span>
              <span className="normal-case tracking-normal text-[10px] font-bold text-slate-400">
                👆 클릭: 하단 표 필터
              </span>
            </h3>
            <div className="flex gap-2 items-center">
              {selectedItemFilter && (
                <button onClick={() => setSelectedItemFilter(null)} className="text-[10px] text-indigo-500 hover:underline font-bold">전체보기 ✕</button>
              )}
              <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md">총 {statsData.totalQty.toLocaleString()}</span>
            </div>
          </div>
          
          {statsData.allItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[11px] font-bold text-slate-300 italic">신청 내역 없음</div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto border border-slate-100 rounded-xl">
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.15fr)_5.5rem_minmax(0,1.45fr)_5.5rem] gap-x-3 gap-y-0 px-4 py-2 bg-slate-50 border-b border-slate-100">
                <span className="text-[9px] font-black text-slate-400 tracking-widest uppercase text-left">물품명</span>
                <span className="text-[9px] font-black text-slate-400 tracking-widest text-center">단위</span>
                <span className="text-[9px] font-black text-slate-400 tracking-widest text-left">수량</span>
                <span className="text-[9px] font-black text-slate-400 tracking-widest text-right">최근 신청일</span>
              </div>
              <div className="divide-y divide-slate-100">
                {(() => {
                  const maxQty = Number(statsData.allItems[0]?.qty) || 0;
                  return statsData.allItems.map((item) => {
                    const isSelected = selectedItemFilter === item.name;
                    const barPct =
                      maxQty > 0 ? Math.min(100, (Number(item.qty) / maxQty) * 100) : 0;
                    return (
                      <button
                        key={item.name}
                        type="button"
                        title={`${item.name}${item.unit ? ` (${item.unit})` : ''} · ${item.qty.toLocaleString()}`}
                        onClick={() => setSelectedItemFilter(isSelected ? null : item.name)}
                        className={`w-full grid grid-cols-[minmax(0,1.15fr)_5.5rem_minmax(0,1.45fr)_5.5rem] gap-x-3 gap-y-0 items-center px-4 py-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <span className={`min-w-0 text-[11px] font-bold truncate ${isSelected ? 'text-white' : ''}`}>
                          {item.name}
                        </span>
                        <span
                          className={`text-[10px] font-bold text-center whitespace-nowrap ${
                            isSelected ? 'text-indigo-100' : 'text-slate-500'
                          }`}
                          title={item.unit || ''}
                        >
                          {item.unit || '-'}
                        </span>
                        <span className="min-w-0 flex items-center gap-2">
                          <span
                            className={`flex-1 h-1.5 rounded-full overflow-hidden ${
                              isSelected ? 'bg-indigo-400/40' : 'bg-slate-100'
                            }`}
                          >
                            <span
                              className={`block h-full rounded-full transition-all duration-500 ${
                                isSelected ? 'bg-white' : 'bg-indigo-500'
                              }`}
                              style={{ width: `${barPct}%` }}
                            />
                          </span>
                          <span
                            className={`shrink-0 text-[11px] font-black tabular-nums text-right min-w-[2rem] ${
                              isSelected ? 'text-indigo-100' : 'text-indigo-600'
                            }`}
                          >
                            {item.qty.toLocaleString()}
                          </span>
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold tabular-nums text-right ${
                            isSelected ? 'text-indigo-100' : 'text-slate-500'
                          }`}
                        >
                          {item.lastAt ? getKSTDateString(item.lastAt) : '-'}
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>
     
{/* 오른쪽: 상태 필터(타이트) + 보관 메모 */}
<div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-6 flex flex-col gap-3 min-h-[280px] h-full">
          <div className="flex justify-between items-end shrink-0">
            <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">📋 {statsTitle} 결재/지급 처리 현황</h3>
            <div className="flex gap-2 items-center">
              {selectedStatus !== 'ALL' && (
                <button onClick={() => setSelectedStatus('ALL')} className="text-[10px] text-indigo-500 hover:underline font-bold">필터 해제 ✕</button>
              )}
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">총 {statsData.totalReqCount}건</span>
            </div>
          </div>
          
          {statsData.totalReqCount === 0 ? (
            <div className="py-4 text-center text-[11px] font-bold text-slate-300 italic">신청 내역 없음</div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 shrink-0">
              {statsData.statusStats.map((status) => {
                const isSelected = selectedStatus === status.id;
                const tone =
                  status.color === 'emerald'
                    ? {
                        idle: 'bg-emerald-50/80 border-emerald-100 hover:bg-emerald-50',
                        selected: 'bg-emerald-100 border-emerald-300 ring-2 ring-emerald-200/80',
                        label: 'text-emerald-700',
                        count: 'text-emerald-800',
                        pct: 'text-emerald-600/70',
                      }
                    : status.color === 'orange'
                    ? {
                        idle: 'bg-amber-50/80 border-amber-100 hover:bg-amber-50',
                        selected: 'bg-amber-100 border-amber-300 ring-2 ring-amber-200/80',
                        label: 'text-amber-700',
                        count: 'text-amber-800',
                        pct: 'text-amber-600/70',
                      }
                    : {
                        idle: 'bg-rose-50/80 border-rose-100 hover:bg-rose-50',
                        selected: 'bg-rose-100 border-rose-300 ring-2 ring-rose-200/80',
                        label: 'text-rose-700',
                        count: 'text-rose-800',
                        pct: 'text-rose-600/70',
                      };
                const shortLabel =
                  status.id === 'COMPLETED' ? '지급완료' :
                  status.id === 'PENDING' ? '승인대기' : '반려/취소';

                return (
                  <button
                    key={status.id}
                    type="button"
                    onClick={() => setSelectedStatus(isSelected ? 'ALL' : status.id as any)}
                    className={`flex flex-col items-center justify-center gap-0.5 px-1.5 py-2 rounded-xl border transition-all ${
                      isSelected ? tone.selected : tone.idle
                    }`}
                  >
                    <span className={`text-[10px] font-black leading-none ${tone.label}`}>{shortLabel}</span>
                    <span className={`text-[13px] font-black leading-none tabular-nums ${tone.count}`}>
                      {status.count}<span className="text-[9px] ml-0.5 font-bold opacity-80">건</span>
                    </span>
                    <span className={`text-[9px] font-bold leading-none ${tone.pct}`}>{status.percent}%</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* 부서 전용 메모판 — 열람은 Access, 수정은 Edit (DB: OrgUnit.supply_storage_note) */}
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 shadow-inner flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 border-b border-slate-200/70 pb-1.5 gap-2">
              <h4 className="text-[11px] font-black text-slate-700 flex items-center gap-1.5 min-w-0">
                <span>📌</span>
                <span className="truncate">공유 메모판</span>
                {memoDeptName ? (
                  <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md shrink-0">
                    {String(memoDeptName)}
                  </span>
                ) : null}
              </h4>
              {!memoEditing ? (
                canEditMemo ? (
                  <button
                    type="button"
                    onClick={startMemoEdit}
                    className="text-[9px] font-bold text-slate-400 hover:text-indigo-600 transition-colors shrink-0"
                  >
                    수정
                  </button>
                ) : (
                  <span className="text-[9px] font-bold text-slate-300 shrink-0" title="Edit 권한 필요">
                    조회만
                  </span>
                )
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={memoSaving}
                    onClick={cancelMemoEdit}
                    className="text-[9px] font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={memoSaving}
                    onClick={saveMemo}
                    className="text-[9px] font-black text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                  >
                    {memoSaving ? '저장 중…' : '저장'}
                  </button>
                </div>
              )}
            </div>

            {memoEditing ? (
              <textarea
                value={memoDraft}
                onChange={(e) => setMemoDraft(e.target.value)}
                rows={5}
                maxLength={4000}
                placeholder={'예)\n• A4 용지/토너: 복합기 옆 2단 공용 캐비닛\n• 일반 사무용품: 부서 입구 우측 수납장'}
                className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-[10px] font-bold text-slate-700 leading-relaxed outline-none focus:border-indigo-400 resize-y min-h-[88px]"
              />
            ) : (
              <div className="text-[10px] font-bold text-slate-600 leading-relaxed whitespace-pre-wrap min-h-[48px]">
                {currentMemo.trim()
                  ? currentMemo
                  : canEditMemo
                    ? '등록된 보관 위치 안내가 없습니다. [수정]을 눌러 작성해 주세요.'
                    : '등록된 보관 위치 안내가 없습니다.'}
              </div>
            )}
          </div>
        </div>
      </div>
     
      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
          
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">부서 소모품 신청 내역</h2>
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredRequests.length}건</span>
              
              {/* 활성화된 교차 필터 상태 태그 표출 */}
              {selectedItemFilter && (
                <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md ml-2 animate-pulse">
                  📦 {selectedItemFilter}만 보기 중
                </span>
              )}
              {selectedStatus !== 'ALL' && (
                <span className="text-[10px] font-black text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md ml-1">
                  🎯 {supplyRequestStatusLabel(selectedStatus)} 상태
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden group-hover/filter:block whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg"
                >
                  연도 → 월 → 조직 · 연계필터
                </span>

                <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(e.target.value);
                    setSelectedMonth('ALL');
                    setSelectedUnitId(myUnitId || 'ALL');
                  }}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {availableYears.map((year) => (
                    <option key={year} value={year}>{year}년</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    setSelectedUnitId(myUnitId || 'ALL');
                  }}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>{month}월</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">조직</span>
                <select
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[160px]"
                >
                  <option value="ALL">전체 (연계 조직)</option>
                  {deptOptionLabels.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <div className="relative w-40">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">📦</span>
                  <input type="text" placeholder="물품명 검색..." value={searchItemQuery} onChange={e => setSearchItemQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors" />
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">👤</span>
                  <input type="text" placeholder="신청자 검색..." value={searchUserQuery} onChange={e => setSearchUserQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors" />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
              >
                {selectedIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed min-w-[1200px]">
              <colgroup>
                <col className="w-[40px]" />
                <col className="w-[48px]" />
                <col className="w-[96px]" />
                <col className="w-[120px]" />
                <col className="w-[180px]" />
                <col className="w-[88px]" />
                <col className="w-[180px]" />
                <col className="w-[180px]" />
                <col className="w-[110px]" />
                <col className="w-[96px]" />
                <col className="w-[64px]" />
              </colgroup>
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 text-center">
                    <input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                  </th>
                  <th className="h-12 px-2 text-center">NO</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
                  <th className="h-12 px-2">부서 / 신청자</th>
                  <th className="h-12 px-2 text-indigo-600">물품명</th>
                  <th className="h-12 px-2 text-center text-indigo-600 whitespace-nowrap">신청수량</th>
                  <th className="h-12 px-2">사용자 의견</th>
                  <th className="h-12 px-2 border-l border-slate-200">관리자 답변</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">부서 / 처리자</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">처리일</th>
                  <th className="h-12 px-2 text-center">상태</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr><td colSpan={11} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 신청 내역이 없습니다.</td></tr>
                ) : (
                  paginatedRequests.map((req, i) => {
                    const isPending = isPendingSupplyRequest(req.status);
                    const isRejected = isRejectedSupplyRequest(req.status);
                    const statusLabel = supplyRequestStatusLabel(req.status);
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
                      <tr key={req.id} className={`hover:bg-slate-50/50 h-12 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                        <td className="pl-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); isSelected ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                        </td>
                        <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                        <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">{createdDate}</td>
                        <td className="px-2 truncate">
                          <span className="text-[10px] text-slate-500 block truncate">{String(requestDeptLabel(req))}</span>
                          <span className="text-slate-800 truncate">{req.user_name || '-'}</span>
                        </td>
                        <td className="px-2 text-indigo-700 truncate" title={itemName}>{itemName}</td>
                        <td className="px-2 text-center font-mono whitespace-nowrap tabular-nums text-indigo-600">
                          {req.qty}
                          {sUnit && <span className="text-[10px] font-sans ml-0.5 text-slate-500">{sUnit}</span>}
                        </td>
                        <td className="px-2 text-slate-700 truncate" title={req.note}>{req.note ? `"${req.note}"` : '-'}</td>
                        <td className="px-2 text-slate-700 truncate border-l border-slate-200" title={req.admin_opinion}>
                          {req.admin_opinion ? `" ${req.admin_opinion} "` : '-'}
                        </td>
                        <td className="px-2 text-center">
                          {!isPending ? (
                            <div className="truncate">
                              <span className="text-[10px] text-slate-500 block truncate">{req.admin_dept || '-'}</span>
                              <span className="text-slate-800 truncate">{req.admin_name || '관리자'}</span>
                            </div>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                          {!isPending ? processDate : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 text-center">
                          <span className={`inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                            isPending ? 'bg-orange-50 text-orange-600 border-orange-200' :
                            isRejected ? 'bg-red-50 text-red-600 border-red-200' :
                            'bg-emerald-50 text-emerald-600 border-emerald-200'
                          }`}>
                            {statusLabel === '대기중' ? '대기' : statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
     
          {filteredRequests.length > 0 && (
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
  );
}

export default function DeptModule() {
  return <DeptContent />;
}