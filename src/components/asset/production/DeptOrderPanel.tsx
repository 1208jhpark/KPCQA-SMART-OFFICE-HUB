'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import ProductionDeptShell from '@/components/asset/production/ProductionDeptShell';
import ProductionRequestDetailModal from '@/components/asset/production/ProductionRequestDetailModal';
import {
  getProductionCategoryBadgeClass,
  getProductionCategoryFolderTabClasses,
} from '@/lib/production-category-theme';
import {
  PRODUCTION_STATUS,
  productionActionHint,
  productionStatusLabel,
  productionStatusTextClass,
} from '@/lib/production-status';
import { buildSignDetailExcelRows } from '@/lib/production-sign-excel';

const MENU_PATH = '/asset/production/dept-master/order';
const ITEMS_PER_PAGE = 10;
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed';

const HISTORY_CATEGORIES = [
  { id: 'ALL', label: '전체 내역', icon: '📋' },
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

type ProductionRequestRow = {
  id: string;
  postNumber: string;
  category: string;
  title: string;
  quantity: number;
  status: string;
  userName: string;
  userEmail: string;
  deptName: string;
  deptHead: string;
  batchId?: string | null;
  createdAt: string;
  estimatedPrice?: number;
  options?: Record<string, unknown>;
};

type ViewMode = 'ALL' | 'PENDING' | 'ACCEPTED' | 'ORDERED';

function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput == null) return null;
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return { year: String(ym.year), month: String(ym.month).padStart(2, '0') };
}

function getCategoryLabel(catId: string) {
  return HISTORY_CATEGORIES.find((c) => c.id === catId)?.label || catId;
}

function formatQuantityUnit(item: {
  category?: string;
  options?: { printItemMasterInfo?: { unitLabel?: string } };
}) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'PRINT') {
    const label = item.options?.printItemMasterInfo?.unitLabel;
    if (label) return String(label);
  }
  return 'EA';
}

export default function DeptOrderPanel() {
  const router = useRouter();
  const [requests, setRequests] = useState<ProductionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [scopeUnits, setScopeUnits] = useState<{ id: string; unit_name: string }[]>([]);

  const [viewMode, setViewMode] = useState<ViewMode>('ALL');
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState('ALL');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [detailItem, setDetailItem] = useState<ProductionRequestRow | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ProductionRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [savingReject, setSavingReject] = useState(false);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, reqRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/production/dept-master/order?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);

      if (userRes.ok) setCurrentUser(await userRes.json());

      if (ifRes?.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH)
          : null;
        setInterfaceConfig(menu || null);
      }

      if (reqRes.ok) {
        const data = await reqRes.json();
        setRequests(Array.isArray(data.requests) ? data.requests : []);
        setScopeUnits(Array.isArray(data.scopeUnits) ? data.scopeUnits : []);
      } else {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || err.message || '부서 신청 내역을 불러오지 못했습니다.');
        setRequests([]);
      }
    } catch {
      alert('서버와 통신할 수 없습니다.');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const kstYear = String(getKSTNowYearMonth().year);

  const availableYears = useMemo(() => {
    const years = requests
      .map((r) => getKSTYearMonthParts(r.createdAt)?.year)
      .filter((y): y is string => Boolean(y));
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    if (!unique.includes(kstYear)) unique.unshift(kstYear);
    return unique;
  }, [requests, kstYear]);

  const afterYearList = useMemo(() => {
    if (selectedYear === 'ALL') return requests;
    return requests.filter((r) => getKSTYearMonthParts(r.createdAt)?.year === selectedYear);
  }, [requests, selectedYear]);

  const availableMonths = useMemo(() => {
    const months = afterYearList
      .map((r) => getKSTYearMonthParts(r.createdAt)?.month)
      .filter((m): m is string => Boolean(m));
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [afterYearList]);

  const deptOptions = useMemo(() => {
    const names = new Set<string>();
    for (const u of scopeUnits) names.add(u.unit_name);
    for (const r of afterYearList) {
      if (r.deptName) names.add(r.deptName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [scopeUnits, afterYearList]);

  const counts = useMemo(() => {
    const base = afterYearList.filter((r) => {
      if (r.status === PRODUCTION_STATUS.CANCELLED || r.status === PRODUCTION_STATUS.REJECTED) {
        return false;
      }
      const matchUnit = selectedUnitId === 'ALL' || r.deptName === selectedUnitId;
      const matchUser =
        !searchUserQuery ||
        (r.userName || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      const matchCategory = activeCategory === 'ALL' || r.category === activeCategory;
      return matchUnit && matchUser && matchCategory;
    });
    return {
      all: base.length,
      pending: base.filter((r) => r.status === PRODUCTION_STATUS.PENDING).length,
      accepted: base.filter((r) => r.status === PRODUCTION_STATUS.ACCEPTED).length,
      ordered: base.filter((r) => r.status === PRODUCTION_STATUS.ORDERED).length,
    };
  }, [afterYearList, selectedUnitId, searchUserQuery, activeCategory]);

  const filteredRequests = useMemo(() => {
    return afterYearList
      .filter((r) => {
        if (r.status === PRODUCTION_STATUS.CANCELLED) return false;
        if (r.status === PRODUCTION_STATUS.REJECTED && viewMode !== 'ALL') return false;
        const ym = getKSTYearMonthParts(r.createdAt);
        const matchCategory = activeCategory === 'ALL' || r.category === activeCategory;
        const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
        const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
        const matchUnit = selectedUnitId === 'ALL' || r.deptName === selectedUnitId;
        const matchUser =
          !searchUserQuery ||
          (r.userName || '').toLowerCase().includes(searchUserQuery.toLowerCase());
        const matchStatus =
          viewMode === 'ALL' ||
          (viewMode === 'PENDING' && r.status === PRODUCTION_STATUS.PENDING) ||
          (viewMode === 'ACCEPTED' && r.status === PRODUCTION_STATUS.ACCEPTED) ||
          (viewMode === 'ORDERED' && r.status === PRODUCTION_STATUS.ORDERED);
        return matchCategory && matchYear && matchMonth && matchUnit && matchUser && matchStatus;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [
    afterYearList,
    activeCategory,
    selectedYear,
    selectedMonth,
    selectedUnitId,
    searchUserQuery,
    viewMode,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / ITEMS_PER_PAGE));
  const paginatedRequests = filteredRequests.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [viewMode, activeCategory, selectedYear, selectedMonth, selectedUnitId, searchUserQuery]);

  const toggleSelectAll = () => {
    const pageIds = paginatedRequests
      .filter((r) => r.status === PRODUCTION_STATUS.ACCEPTED)
      .map((r) => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setSelectedIds(next);
  };

  const toggleSelectOne = (id: string, status: string) => {
    if (status !== PRODUCTION_STATUS.ACCEPTED) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleApprove = async (row: ProductionRequestRow) => {
    if (!canEdit) return alert('접수 권한(Edit)이 없습니다.');
    if (!confirm(`[${row.postNumber}] 접수 완료 처리하시겠습니까?\n접수 후 이 화면의 발주대기열에 남습니다.`)) {
      return;
    }
    setActionBusyId(row.id);
    try {
      const res = await fetch('/api/asset/production/dept-master/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, action: 'approve' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '접수 처리에 실패했습니다.');
        return;
      }
      setRequests((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: PRODUCTION_STATUS.ACCEPTED } : r))
      );
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectTarget) return;
    if (!canEdit) return alert('반려 권한(Edit)이 없습니다.');
    const reason = rejectReason.trim();
    if (!reason) return alert('반려 사유를 입력해 주세요.');
    setSavingReject(true);
    try {
      const res = await fetch('/api/asset/production/dept-master/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rejectTarget.id,
          action: 'reject',
          rejectReason: reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '반려 처리에 실패했습니다.');
        return;
      }
      alert(`[${rejectTarget.postNumber}] 반려 처리했습니다.`);
      setRequests((prev) =>
        prev.map((r) =>
          r.id === rejectTarget.id
            ? {
                ...r,
                status: PRODUCTION_STATUS.REJECTED,
                options: {
                  ...(r.options || {}),
                  rejectReason: reason,
                },
              }
            : r
        )
      );
      setRejectTarget(null);
      setRejectReason('');
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setSavingReject(false);
    }
  };

  const handleBatchOrder = async () => {
    if (!canEdit) return alert('묶음 발주 권한(Edit)이 없습니다.');
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return alert('발주대기(접수완료) 건을 선택해 주세요.');
    if (
      !confirm(
        `선택한 ${ids.length}건을 묶음 발주 처리하시겠습니까?\n발주 후 명세서 검수 탭의 외주 발주 묶음 관리 대장으로 이동합니다.`
      )
    ) {
      return;
    }
    setOrdering(true);
    try {
      const res = await fetch('/api/asset/production/dept-master/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '발주 처리에 실패했습니다.');
        return;
      }
      alert(data.message || '묶음 발주가 완료되었습니다.');
      setSelectedIds(new Set());
      const redirectTo =
        typeof data.redirectTo === 'string'
          ? data.redirectTo
          : '/asset/production/dept-master/inspection';
      router.push(redirectTo);
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setOrdering(false);
    }
  };

  const handleExcelDownload = () => {
    const target =
      selectedIds.size > 0
        ? filteredRequests.filter((r) => selectedIds.has(r.id))
        : filteredRequests;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const yearLabel = selectedYear === 'ALL' ? '전체' : `${selectedYear}년`;

    if (activeCategory === 'SIGN') {
      const rows = buildSignDetailExcelRows(target);
      if (rows.length === 0) return alert('다운로드할 현판(SIGN) 데이터가 없습니다.');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '현판상세');
      XLSX.writeFile(wb, `현판_신청상세_${yearLabel}.xlsx`);
      return;
    }

    const rows = target.map((r, idx) => ({
      NO: target.length - idx,
      관리번호: r.postNumber,
      신청일: getKSTDateString(r.createdAt),
      소속부서: r.deptName,
      신청자: r.userName,
      분류: getCategoryLabel(r.category),
      관리용제목: r.title,
      수량: `${r.quantity}${formatQuantityUnit(r)}`,
      외주업체: (r.options as any)?.vendor || '',
      현재상태: productionStatusLabel(r.status),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '부서제작신청');
    XLSX.writeFile(wb, `부서_제작신청현황_${yearLabel}.xlsx`);
  };

  const acceptedSelectableOnPage = paginatedRequests.filter(
    (r) => r.status === PRODUCTION_STATUS.ACCEPTED
  );
  const allAcceptedSelected =
    acceptedSelectableOnPage.length > 0 &&
    acceptedSelectableOnPage.every((r) => selectedIds.has(r.id));

  const tableTitle =
    viewMode === 'PENDING'
      ? '신규 신청 · 접수 대기 대장'
      : viewMode === 'ACCEPTED'
        ? '접수완료 · 발주대기 대장'
        : viewMode === 'ORDERED'
          ? '묶음 발주 완료 목록 (검수는 명세서 검수 탭)'
          : '부서 제작 신청 전체 대장';

  return (
    <ProductionDeptShell pageHint="신청 건을 접수·반려한 뒤, 발주대기열에서 선택해 외주 묶음 발주합니다. 발주 완료 건은 명세서 검수 탭에서 관리합니다.">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(
          [
            { id: 'ALL' as const, label: '전체건', count: counts.all, bg: '#0f172a' },
            { id: 'PENDING' as const, label: '대기중', count: counts.pending, bg: '#f59e0b' },
            { id: 'ACCEPTED' as const, label: '발주대기', count: counts.accepted, bg: '#4f46e5' },
            { id: 'ORDERED' as const, label: '발주완료', count: counts.ordered, bg: '#2563eb' },
          ] as const
        ).map((card) => {
          const active = viewMode === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setViewMode(card.id)}
              className={`p-5 rounded-[2rem] text-left transition-all border border-slate-200 flex flex-col justify-center ${
                active ? 'text-white shadow-md scale-[1.02]' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
              style={active ? { backgroundColor: card.bg, color: '#fff' } : undefined}
            >
              <span className="text-[9px] font-black tracking-widest uppercase opacity-60">
                {card.id}
              </span>
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-xl font-black">{card.count}</span>
                <span className="text-[11px] font-bold">{card.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 카테고리 서류철 탭 + 테이블 — 간격 없이 물리적으로 부착 */}
      <div className="w-full">
        <div
          className="flex flex-wrap items-end gap-1 border-b border-slate-200"
          role="tablist"
          aria-label="제작 분류 필터"
        >
          {HISTORY_CATEGORIES.map((cat) => {
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCategory(cat.id)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
              >
                <span className="text-sm leading-none">{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        <div className="bg-white border border-t-0 border-slate-200 rounded-b-[2.5rem] rounded-tr-2xl shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">{tableTitle}</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
              {filteredRequests.length}건
            </span>
            {selectedIds.size > 0 && (
              <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                {selectedIds.size}개 선택
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleBatchOrder}
              disabled={!canEdit || ordering || selectedIds.size === 0}
              title={!canEdit ? '편집 권한 필요' : undefined}
              className={`inline-flex items-center gap-1 text-[10px] font-black rounded-lg px-4 py-1.5 transition-colors shadow-sm ${
                canEdit
                  ? 'bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-700 disabled:opacity-50'
                  : DISABLED_ACTION_BTN
              }`}
            >
              <span>→</span>
              <span>
                {ordering
                  ? '발주 처리 중…'
                  : `선택된 ${selectedIds.size}건 묶음 발주 생성 🚀`}
              </span>
            </button>
            <input
              type="text"
              placeholder="신청자 검색"
              value={searchUserQuery}
              onChange={(e) => setSearchUserQuery(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-300 w-32"
            />
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-black text-slate-800 outline-none"
            >
              <option value="ALL">전체 조직</option>
              {deptOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-8">
              <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth('ALL');
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300" />
              <span className="text-[10px] font-black text-slate-400 uppercase">월</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {month}월
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleExcelDownload}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700"
            >
              EXCEL
            </button>
          </div>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <LoadingState />
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 text-center">
                    <input
                      type="checkbox"
                      className="w-3 h-3 accent-indigo-600 rounded cursor-pointer"
                      checked={allAcceptedSelected && acceptedSelectableOnPage.length > 0}
                      onChange={toggleSelectAll}
                      title="발주대기(접수완료) 건만 선택"
                    />
                  </th>
                  <th className="h-12 px-2 text-center">No</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">관리번호</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
                  <th className="h-12 px-2">소속 부서</th>
                  <th className="h-12 px-2">신청자</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">분류</th>
                  <th className="h-12 px-2">관리용 제목</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청내역</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">수량</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">외주업체</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-16 text-center text-slate-400 text-xs">
                      조회 범위 내 신청 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  paginatedRequests.map((item, idx) => {
                    const isPending = item.status === PRODUCTION_STATUS.PENDING;
                    const rowNo =
                      filteredRequests.length - ((currentPage - 1) * ITEMS_PER_PAGE + idx);
                    return (
                      <tr
                        key={item.id}
                        className={`h-12 transition-colors ${
                          selectedIds.has(item.id) ? 'bg-indigo-50/30' : 'hover:bg-slate-50/50'
                        }`}
                      >
                        <td className="pl-4 text-center">
                          <input
                            type="checkbox"
                            className="w-3 h-3 accent-indigo-600 rounded cursor-pointer disabled:opacity-30"
                            checked={selectedIds.has(item.id)}
                            disabled={item.status !== PRODUCTION_STATUS.ACCEPTED}
                            onChange={() => toggleSelectOne(item.id, item.status)}
                          />
                        </td>
                        <td className="px-2 text-center font-mono text-slate-500 tabular-nums">
                          {rowNo}
                        </td>
                        <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate">
                          {item.postNumber}
                        </td>
                        <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                          {getKSTDateString(item.createdAt)}
                        </td>
                        <td className="px-2 truncate" title={item.deptName || ''}>
                          {item.deptName || <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 text-slate-800 truncate">{item.userName || '-'}</td>
                        <td className="px-2 text-center">
                          <span
                            className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-tight border ${getProductionCategoryBadgeClass(item.category)}`}
                          >
                            {getCategoryLabel(item.category)}
                          </span>
                        </td>
                        <td className="px-2 text-slate-800 truncate" title={item.title || ''}>
                          {item.title || '-'}
                        </td>
                        <td className="px-2 text-center">
                          {isPending || item.status === PRODUCTION_STATUS.ACCEPTED ? (
                            <button
                              type="button"
                              onClick={() => setDetailItem(item)}
                              className="px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200"
                            >
                              원문 검수
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDetailItem(item)}
                              className="px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
                            >
                              원문 확인
                            </button>
                          )}
                        </td>
                        <td className="px-2 text-center tabular-nums text-slate-900">
                          <span className="font-mono">{item.quantity}</span>
                          <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                            {formatQuantityUnit(item)}
                          </span>
                        </td>
                        <td className="px-2 text-center text-slate-800 truncate">
                          {(item.options as any)?.vendor || '-'}
                        </td>
                        <td className="px-2 text-center">
                          <span
                            className={`text-[10px] font-bold whitespace-nowrap ${productionStatusTextClass(item.status)}`}
                          >
                            {productionStatusLabel(item.status)}
                          </span>
                        </td>
                        <td className="px-2 text-center">
                          {isPending ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                disabled={!canEdit || actionBusyId === item.id}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={() => handleApprove(item)}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                  canEdit
                                    ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                <span>→</span>
                                <span>{actionBusyId === item.id ? '처리중' : '접수'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={!canEdit || actionBusyId === item.id}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={() => {
                                  if (!canEdit) return alert('반려 권한(Edit)이 없습니다.');
                                  setRejectTarget(item);
                                  setRejectReason('');
                                }}
                                className={`px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                  canEdit
                                    ? 'bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                반려
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-500 font-bold whitespace-nowrap">
                              {productionActionHint(item.status)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {!loading && filteredRequests.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentPage(i + 1)}
                className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
                  currentPage === i + 1
                    ? 'bg-slate-800 text-white shadow-sm scale-105'
                    : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-rose-50">
              <h3 className="text-sm font-black text-rose-800 tracking-tight">반려 사유 입력</h3>
              <button
                type="button"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                className="text-slate-400 hover:text-slate-600 font-black text-sm"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[11px] font-bold text-slate-500">
                [{rejectTarget.postNumber}] {rejectTarget.userName} 님 신청을 반려합니다. 사유는 신청
                이력에 표시됩니다.
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                placeholder="예: 원문 오기재, 수량·업체 재확인 필요 등"
                className="w-full p-3 text-xs font-bold text-slate-800 border border-rose-200 rounded-xl outline-none focus:border-rose-400 bg-white resize-none"
              />
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                className="flex-1 py-2.5 bg-slate-200 text-slate-700 text-xs font-black rounded-lg hover:bg-slate-300"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!canEdit || savingReject}
                onClick={handleRejectSubmit}
                className={`flex-1 py-2.5 text-xs font-black rounded-lg ${
                  canEdit
                    ? 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50'
                    : DISABLED_ACTION_BTN
                }`}
              >
                {savingReject ? '전송중' : '반려 전송'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          allowEdit={canEdit}
          editableStatuses={['PENDING', 'ACCEPTED']}
          editApiPath="/api/asset/production/dept-master/order"
          onSaved={(updated) => {
            setRequests((prev) =>
              prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
            );
            setDetailItem((prev) =>
              prev && prev.id === updated.id ? { ...prev, ...updated } : prev
            );
          }}
        />
      )}
    </ProductionDeptShell>
  );
}
