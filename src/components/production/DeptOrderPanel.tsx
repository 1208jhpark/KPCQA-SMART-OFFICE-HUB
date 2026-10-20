'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonthParts } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import ProductionRequestDetailModal from '@/components/production/ProductionRequestDetailModal';
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
import {
  buildSignDetailExcelRows,
  buildJebonDetailExcelRows,
  buildPrintDetailExcelRows,
  buildOfficeSuppliesDetailExcelRows,
} from '@/lib/production-sign-excel';
import {
  isItemShippingEntered,
  isItemShippingUnentered,
  isVendorDispatched,
  itemDeferredBatchShipping,
  itemNeedsBatchShipping,
} from '@/lib/production-shipping';
import type { BatchShippingApplyScope, BatchShippingInput } from '@/lib/production-shipping';
import ProductionBatchShippingModal, {
  type BatchShippingSubmitPayload,
} from '@/components/production/ProductionBatchShippingModal';

const MENU_PATH = '/production/custom/dept-master/order';
const ITEMS_PER_PAGE = 10;
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed';

/** 묶음발주대기 분류칩 · 하단 부서 이력 서류철 */
const DEPT_HISTORY_CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

const BATCH_CATEGORY_IDS = DEPT_HISTORY_CATEGORIES.map((c) => c.id);

/** apply/history 공정상태와 동일 표기 */
function getApplyHistoryStatusDisplay(item: {
  status?: string;
  options?: Record<string, unknown> | null;
}) {
  const status = String(item.status || '');
  const opts = (item.options || {}) as Record<string, unknown>;
  const isDispatched = isVendorDispatched(opts) || opts.vendorDispatched === true;

  if (status === PRODUCTION_STATUS.PENDING) {
    return { label: '접수대기', className: 'text-orange-600 font-bold' };
  }
  if (
    status === PRODUCTION_STATUS.ACCEPTED ||
    (status === PRODUCTION_STATUS.ORDERED && !isDispatched)
  ) {
    return { label: '발주대기', className: 'text-blue-600 font-bold' };
  }
  if (status === PRODUCTION_STATUS.ORDERED && isDispatched) {
    return { label: '발주완료', className: 'text-emerald-700 font-bold' };
  }
  if (status === PRODUCTION_STATUS.VERIFIED) {
    return { label: '수령완료', className: 'text-slate-900 font-bold' };
  }
  if (status === PRODUCTION_STATUS.REJECTED) {
    return { label: '반려', className: 'text-red-600 font-bold' };
  }
  if (status === PRODUCTION_STATUS.CANCELLED) {
    return { label: '취소됨', className: 'text-slate-400 font-bold' };
  }
  return { label: status || '-', className: 'text-slate-500' };
}

type ProductionRequestRow = {
  id: string;
  postNumber: string;
  category: string;
  title: string;
  quantity: number;
  status: string;
  statusChangedAt?: string | Date | null;
  userName: string;
  userEmail: string;
  unitId?: string | null;
  deptName: string;
  deptHead: string;
  batchId?: string | null;
  createdAt: string;
  estimatedPrice?: number;
  options?: Record<string, unknown>;
};

function getCategoryLabel(catId: string) {
  return DEPT_HISTORY_CATEGORIES.find((c) => c.id === catId)?.label || catId;
}

function formatQuantityUnit(item: {
  category?: string;
  options?: { printItemMasterInfo?: { unitLabel?: string } };
}) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'OFFICE_SUPPLIES') return '건';
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

  const [activeCategory, setActiveCategory] = useState('ALL');
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [searchTitleQuery, setSearchTitleQuery] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState('ALL');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [detailItem, setDetailItem] = useState<ProductionRequestRow | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ProductionRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [savingReject, setSavingReject] = useState(false);
  const [batchShippingOpen, setBatchShippingOpen] = useState(false);
  const [pendingOrderIds, setPendingOrderIds] = useState<string[]>([]);

  /** 하단 부서 전체 이력표 — 기본 접힘 */
  const [histOpen, setHistOpen] = useState(false);
  const [histCategory, setHistCategory] = useState('SIGN');
  const [histYear, setHistYear] = useState(() => String(getKSTNowYearMonth().year));
  const [histMonth, setHistMonth] = useState('ALL');
  const [histPage, setHistPage] = useState(1);
  const [histTitleQuery, setHistTitleQuery] = useState('');
  const [histUserQuery, setHistUserQuery] = useState('');

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
        fetch(`/api/production/custom/dept-master/order?t=${ts}`, { cache: 'no-store' }),
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
    return [...scopeUnits].sort((a, b) => a.unit_name.localeCompare(b.unit_name, 'ko'));
  }, [scopeUnits]);

  const matchSelectedUnit = useCallback(
    (r: ProductionRequestRow) => {
      if (selectedUnitId === 'ALL') return true;
      const uid = String(r.unitId || '').trim();
      if (uid) return uid === selectedUnitId;
      const selected = scopeUnits.find((u) => u.id === selectedUnitId);
      return Boolean(selected?.unit_name && r.deptName === selected.unit_name);
    },
    [selectedUnitId, scopeUnits]
  );

  const pendingScopeBase = useMemo(() => {
    const titleQ = searchTitleQuery.trim().toLowerCase();
    return afterYearList.filter((r) => {
      if (r.status !== PRODUCTION_STATUS.PENDING) return false;
      const ym = getKSTYearMonthParts(r.createdAt);
      const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      const matchUnit = matchSelectedUnit(r);
      const matchUser =
        !searchUserQuery ||
        (r.userName || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      const matchTitle = !titleQ || (r.title || '').toLowerCase().includes(titleQ);
      return matchYear && matchMonth && matchUnit && matchUser && matchTitle;
    });
  }, [afterYearList, selectedYear, selectedMonth, matchSelectedUnit, searchUserQuery, searchTitleQuery]);

  const pendingTabCounts = useMemo(
    () => ({
      ALL: pendingScopeBase.length,
    }),
    [pendingScopeBase]
  );

  const acceptedScopeBase = useMemo(() => {
    const titleQ = searchTitleQuery.trim().toLowerCase();
    return afterYearList.filter((r) => {
      if (r.status !== PRODUCTION_STATUS.ACCEPTED) return false;
      const ym = getKSTYearMonthParts(r.createdAt);
      const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      const matchUnit = matchSelectedUnit(r);
      const matchUser =
        !searchUserQuery ||
        (r.userName || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      const matchTitle = !titleQ || (r.title || '').toLowerCase().includes(titleQ);
      return matchYear && matchMonth && matchUnit && matchUser && matchTitle;
    });
  }, [afterYearList, selectedYear, selectedMonth, matchSelectedUnit, searchUserQuery, searchTitleQuery]);

  const acceptedTabCounts = useMemo(
    () => ({
      SIGN: acceptedScopeBase.filter((r) => r.category === 'SIGN').length,
      JEBON: acceptedScopeBase.filter((r) => r.category === 'JEBON').length,
      PRINT: acceptedScopeBase.filter((r) => r.category === 'PRINT').length,
      OFFICE_SUPPLIES: acceptedScopeBase.filter((r) => r.category === 'OFFICE_SUPPLIES').length,
    }),
    [acceptedScopeBase]
  );

  const filteredRequests = useMemo(() => {
    const titleQ = searchTitleQuery.trim().toLowerCase();
    return afterYearList
      .filter((r) => {
        if (r.status === PRODUCTION_STATUS.CANCELLED || r.status === PRODUCTION_STATUS.REJECTED) {
          return false;
        }
        const ym = getKSTYearMonthParts(r.createdAt);
        const matchCategory = activeCategory === 'ALL' || r.category === activeCategory;
        const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
        const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
        const matchUnit = matchSelectedUnit(r);
        const matchUser =
          !searchUserQuery ||
          (r.userName || '').toLowerCase().includes(searchUserQuery.toLowerCase());
        const matchTitle = !titleQ || (r.title || '').toLowerCase().includes(titleQ);

        if (activeCategory === 'ALL') {
          if (r.status !== PRODUCTION_STATUS.PENDING) return false;
        } else if (r.status !== PRODUCTION_STATUS.ACCEPTED) {
          return false;
        }

        return matchCategory && matchYear && matchMonth && matchUnit && matchUser && matchTitle;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [
    afterYearList,
    activeCategory,
    selectedYear,
    selectedMonth,
    matchSelectedUnit,
    searchUserQuery,
    searchTitleQuery,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / ITEMS_PER_PAGE));
  const paginatedRequests = filteredRequests.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [activeCategory, selectedYear, selectedMonth, selectedUnitId, searchUserQuery, searchTitleQuery]);

  const histAvailableYears = useMemo(() => {
    const years = requests
      .map((r) => getKSTYearMonthParts(r.createdAt)?.year)
      .filter((y): y is string => Boolean(y));
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    if (!unique.includes(kstYear)) unique.unshift(kstYear);
    return unique;
  }, [requests, kstYear]);

  const histAfterYear = useMemo(() => {
    if (histYear === 'ALL') return requests;
    return requests.filter((r) => getKSTYearMonthParts(r.createdAt)?.year === histYear);
  }, [requests, histYear]);

  const histAvailableMonths = useMemo(() => {
    const months = histAfterYear
      .map((r) => getKSTYearMonthParts(r.createdAt)?.month)
      .filter((m): m is string => Boolean(m));
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [histAfterYear]);

  const histFiltered = useMemo(() => {
    const titleQ = histTitleQuery.trim().toLowerCase();
    const userQ = histUserQuery.trim().toLowerCase();
    return requests
      .filter((r) => {
        if (r.status === PRODUCTION_STATUS.CANCELLED) return false;
        if (r.category !== histCategory) return false;
        const ym = getKSTYearMonthParts(r.createdAt);
        const matchYear = histYear === 'ALL' || ym?.year === histYear;
        const matchMonth = histMonth === 'ALL' || ym?.month === histMonth;
        const matchTitle = !titleQ || (r.title || '').toLowerCase().includes(titleQ);
        const matchUser = !userQ || (r.userName || '').toLowerCase().includes(userQ);
        return matchYear && matchMonth && matchTitle && matchUser;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, histYear, histMonth, histCategory, histTitleQuery, histUserQuery]);

  const histTotalPages = Math.max(1, Math.ceil(histFiltered.length / ITEMS_PER_PAGE));
  const histPaginated = histFiltered.slice(
    (histPage - 1) * ITEMS_PER_PAGE,
    histPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setHistPage(1);
  }, [histCategory, histYear, histMonth, histTitleQuery, histUserQuery]);

  useEffect(() => {
    if (histPage > histTotalPages) setHistPage(histTotalPages);
  }, [histPage, histTotalPages]);

  const getHistCategoryLabel = (catId: string) => getCategoryLabel(catId);

  const handleHistExcelDownload = () => {
    const target = histFiltered;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const yearLabel = histYear === 'ALL' ? '전체' : `${histYear}년`;
    const catLabel = getHistCategoryLabel(histCategory).replace(/\//g, '_');

    if (histCategory === 'SIGN') {
      const rows = buildSignDetailExcelRows(target);
      if (rows.length === 0) return alert('다운로드할 현판 데이터가 없습니다.');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '현판상세');
      XLSX.writeFile(wb, `부서이력_현판_${yearLabel}.xlsx`);
      return;
    }
    if (histCategory === 'JEBON') {
      const rows = buildJebonDetailExcelRows(target);
      if (rows.length === 0) return alert('다운로드할 제본 데이터가 없습니다.');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '제본상세');
      XLSX.writeFile(wb, `부서이력_제본_${yearLabel}.xlsx`);
      return;
    }
    if (histCategory === 'PRINT') {
      const rows = buildPrintDetailExcelRows(target);
      if (rows.length === 0) return alert('다운로드할 기타 제작물 데이터가 없습니다.');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '기타제작상세');
      XLSX.writeFile(wb, `부서이력_기타제작_${yearLabel}.xlsx`);
      return;
    }
    if (histCategory === 'OFFICE_SUPPLIES') {
      const rows = buildOfficeSuppliesDetailExcelRows(target);
      if (rows.length === 0) return alert('다운로드할 사무문구류 데이터가 없습니다.');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '사무문구상세');
      XLSX.writeFile(wb, `부서이력_사무문구_${yearLabel}.xlsx`);
      return;
    }

    const rows = target.map((r, idx) => ({
      NO: target.length - idx,
      관리번호: r.postNumber,
      신청일: getKSTDateString(r.createdAt),
      소속부서: r.deptName,
      신청자: r.userName,
      분류: catLabel,
      관리용제목: r.title,
      수량: `${r.quantity}${formatQuantityUnit(r)}`,
      외주업체: (r.options as { vendor?: string } | undefined)?.vendor || '',
      공정상태: getApplyHistoryStatusDisplay(r).label,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '부서이력');
    XLSX.writeFile(wb, `부서이력_${catLabel}_${yearLabel}.xlsx`);
  };

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

  /** 접수대기 → 묶음발주대기(ACCEPTED)만 */
  const handleApprove = async (row: ProductionRequestRow) => {
    if (!canEdit) return alert('접수 권한(Edit)이 없습니다.');
    if (
      !confirm(
        `[${row.postNumber}] 묶음발주대기로 보낼까요?\n${getCategoryLabel(row.category)} 분류에서 선택 후 묶음 발주할 수 있습니다.`
      )
    ) {
      return;
    }
    setActionBusyId(row.id);
    try {
      const res = await fetch('/api/production/custom/dept-master/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, action: 'approve' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '묶음발주대기 이동에 실패했습니다.');
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
      const res = await fetch('/api/production/custom/dept-master/order', {
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
        alert(data.message || '신청반려 처리에 실패했습니다.');
        return;
      }
      alert(`[${rejectTarget.postNumber}] 신청반려 처리했습니다.`);
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

  const selectedRequests = useMemo(
    () => requests.filter((r) => selectedIds.has(r.id)),
    [requests, selectedIds]
  );

  /** 묶음/개별 발주 직전 배송지 모달 — pendingOrderIds 우선 (개별 발주는 체크 없이 열림) */
  const pendingOrderRequests = useMemo(() => {
    const ids = pendingOrderIds.length > 0 ? pendingOrderIds : Array.from(selectedIds);
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    return requests.filter((r) => idSet.has(r.id));
  }, [requests, pendingOrderIds, selectedIds]);

  const batchShippingUnenteredCount = useMemo(
    () => pendingOrderRequests.filter((r) => isItemShippingUnentered(r)).length,
    [pendingOrderRequests]
  );
  const batchShippingEnteredCount = useMemo(
    () => pendingOrderRequests.filter((r) => isItemShippingEntered(r)).length,
    [pendingOrderRequests]
  );

  const executeBatchOrder = async (
    orderIds: string[],
    batchShipping?: BatchShippingInput,
    batchShippingScope?: BatchShippingApplyScope
  ) => {
    const ids = orderIds.filter(Boolean);
    if (ids.length === 0) {
      alert('발주할 항목을 선택해주세요.');
      return;
    }
    setOrdering(true);
    try {
      const res = await fetch('/api/production/custom/dept-master/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestIds: ids,
          ...(batchShipping
            ? { batchShipping, batchShippingScope: batchShippingScope || 'deferred' }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '발주 처리에 실패했습니다.');
        return;
      }
      alert(data.message || '묶음 발주가 완료되었습니다.');
      setSelectedIds(new Set());
      setPendingOrderIds([]);
      setBatchShippingOpen(false);
      const redirectTo =
        typeof data.redirectTo === 'string'
          ? data.redirectTo
          : '/production/custom/dept-master/inspection';
      router.push(redirectTo);
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setOrdering(false);
    }
  };

  const handleBatchOrder = async () => {
    if (!canEdit) return alert('묶음 발주 권한(Edit)이 없습니다.');
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return alert('발주대기(접수완료) 건을 선택해 주세요.');

    const needsBatchShipping = selectedRequests.some((r) => itemNeedsBatchShipping(r));
    if (needsBatchShipping) {
      setPendingOrderIds(ids);
      setBatchShippingOpen(true);
      return;
    }

    if (
      !confirm(
        `선택한 ${ids.length}건을 묶음 발주 처리하시겠습니까?\n발주 후 발주/수령검수 탭의 외주 발주 묶음 관리 대장으로 이동합니다.`
      )
    ) {
      return;
    }
    setPendingOrderIds(ids);
    await executeBatchOrder(ids);
  };

  /** 접수대기 → 접수(ACCEPTED) 후 바로 개별발주(검수 탭) */
  const handleDirectSingleOrder = async (row: ProductionRequestRow) => {
    if (!canEdit) return alert('발주 권한(Edit)이 없습니다.');
    if (row.status !== PRODUCTION_STATUS.PENDING) return;
    if (
      !confirm(
        `[${row.postNumber}] 개별발주 처리할까요?\n접수 후 바로 발주되며, 발주/수령검수 탭에서 확인합니다.`
      )
    ) {
      return;
    }
    setActionBusyId(row.id);
    try {
      const approveRes = await fetch('/api/production/custom/dept-master/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, action: 'approve' }),
      });
      const approveData = await approveRes.json().catch(() => ({}));
      if (!approveRes.ok) {
        alert(approveData.message || '접수 처리에 실패했습니다.');
        return;
      }
      setRequests((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: PRODUCTION_STATUS.ACCEPTED } : r))
      );

      if (itemNeedsBatchShipping(row)) {
        setPendingOrderIds([row.id]);
        setBatchShippingOpen(true);
        return;
      }
      await executeBatchOrder([row.id]);
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRevertAccept = async (item: ProductionRequestRow) => {
    if (!canEdit) return alert('대기열 제외 권한(Edit)이 없습니다.');
    if (item.status !== PRODUCTION_STATUS.ACCEPTED) return;
    if (
      !confirm(
        `[${item.postNumber}] 묶음발주 대기열에서 제외하고 신청검수로 이동할까요?`
      )
    ) {
      return;
    }
    setActionBusyId(item.id);
    try {
      const res = await fetch('/api/production/custom/dept-master/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'revert' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '대기열 제외에 실패했습니다.');
        return;
      }
      setRequests((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, status: PRODUCTION_STATUS.PENDING } : r))
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleBatchShippingBeforeOrder = async ({ shipping, scope }: BatchShippingSubmitPayload) => {
    const ids = pendingOrderRequests.map((r) => r.id);
    if (ids.length === 0) {
      alert('발주 대상 건을 확인할 수 없습니다. 다시 선택해 주세요.');
      return;
    }
    const applyCount =
      scope === 'all' ? pendingOrderRequests.length : batchShippingUnenteredCount;
    if (applyCount <= 0) {
      alert('선택한 적용 범위에 해당하는 건이 없습니다.');
      return;
    }
    const scopeLabel =
      scope === 'all'
        ? `전체 ${applyCount}건 (기존 입력건 포함)`
        : `실배송지 미입력 ${applyCount}건`;
    if (
      !confirm(
        `선택한 ${ids.length}건을 묶음 발주합니다.\n${scopeLabel}에 입력한 배송지를 일괄 적용합니다.`
      )
    ) {
      return;
    }
    await executeBatchOrder(ids, shipping, scope);
  };

  const handleExcelDownload = () => {
    const target = filteredRequests;
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

    if (activeCategory === 'JEBON') {
      const rows = buildJebonDetailExcelRows(target);
      if (rows.length === 0) return alert('다운로드할 제본(JEBON) 데이터가 없습니다.');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '제본상세');
      XLSX.writeFile(wb, `제본_신청상세_${yearLabel}.xlsx`);
      return;
    }

    if (activeCategory === 'PRINT') {
      const rows = buildPrintDetailExcelRows(target);
      if (rows.length === 0) return alert('다운로드할 기타 제작물(PRINT) 데이터가 없습니다.');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '기타제작상세');
      XLSX.writeFile(wb, `기타제작_신청상세_${yearLabel}.xlsx`);
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
      현재상태: productionStatusLabel(r.status, r.options as Record<string, unknown> | null),
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

  const isReviewStage = activeCategory === 'ALL';
  const acceptedBatchTotal = acceptedScopeBase.length;
  const tableTitle = isReviewStage
    ? '신청검수 목록'
    : `${getCategoryLabel(activeCategory)} · 묶음발주대기`;

  const openBatchStage = () => {
    const preferred =
      BATCH_CATEGORY_IDS.find(
        (id) => (acceptedTabCounts[id as keyof typeof acceptedTabCounts] ?? 0) > 0
      ) || 'SIGN';
    setActiveCategory(preferred);
  };

  return (
    <>
      {/* 단계 전환 + 분류 서류철 — 배너는 dept-master/layout ProductionDeptShell */}
      <div className="w-full space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-[10px] text-amber-800 font-medium leading-relaxed">
          💡{' '}
          <span className="font-black text-slate-900">발주 전</span>
          {' : '}
          <span className="font-black">[신청검수]</span> 원문검수 후 개별발주 또는 묶음발주대기로 분기{' '}
          <b className="font-black text-amber-600">→</b>{' '}
          <span className="font-black">[묶음발주대기]</span> 분류별 후보 선택·발주 이동
        </div>

        <div
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1"
          role="tablist"
          aria-label="발주 전 단계"
        >
          <button
            type="button"
            role="tab"
            aria-selected={isReviewStage}
            onClick={() => setActiveCategory('ALL')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black tracking-tight transition-colors ${
              isReviewStage
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-500 hover:bg-white hover:text-slate-800'
            }`}
          >
            <span>⏳</span>
            <span>신청검수</span>
            {pendingTabCounts.ALL > 0 ? (
              <span className={`tabular-nums ${isReviewStage ? 'opacity-95' : 'text-indigo-600'}`}>
                ({pendingTabCounts.ALL})
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isReviewStage}
            onClick={openBatchStage}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black tracking-tight transition-colors ${
              !isReviewStage
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-500 hover:bg-white hover:text-slate-800'
            }`}
          >
            <span>📦</span>
            <span>묶음발주대기</span>
            {acceptedBatchTotal > 0 ? (
              <span className={`tabular-nums ${!isReviewStage ? 'opacity-95' : 'text-indigo-600'}`}>
                ({acceptedBatchTotal})
              </span>
            ) : null}
          </button>
        </div>

        <div>
          {!isReviewStage ? (
            <div
              className="flex flex-wrap items-end gap-1 border-b border-slate-200"
              role="tablist"
              aria-label="묶음발주대기 분류"
            >
              {DEPT_HISTORY_CATEGORIES.map((cat) => {
                const active = activeCategory === cat.id;
                const badgeCount = acceptedTabCounts[cat.id as keyof typeof acceptedTabCounts] ?? 0;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveCategory(cat.id)}
                    title={badgeCount > 0 ? `묶음발주대기 ${badgeCount}건` : undefined}
                    className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
                  >
                    <span className="text-sm leading-none">{cat.icon}</span>
                    <span className="flex items-center gap-1">
                      <span>{cat.label}</span>
                      {badgeCount > 0 ? (
                        <span
                          className={`tabular-nums ${active ? 'opacity-95' : 'text-indigo-600'}`}
                        >
                          ({badgeCount})
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

        <div
          className={`bg-white border border-slate-200 shadow-sm overflow-hidden ${
            isReviewStage
              ? 'rounded-[2.5rem] rounded-tl-2xl'
              : 'border-t-0 rounded-b-[2.5rem] rounded-tr-2xl'
          }`}
        >
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
            {activeCategory !== 'ALL' && (
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
                    : `선택된 ${selectedIds.size}건 묶음발주 이동 🚀`}
                </span>
              </button>
            )}
            <input
              type="text"
              placeholder="제목 검색"
              value={searchTitleQuery}
              onChange={(e) => setSearchTitleQuery(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-300 w-36"
            />
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
              {deptOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unit_name}
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
            {activeCategory !== 'ALL' && (
              <button
                type="button"
                onClick={handleExcelDownload}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
              >
                화면 목록 EXCEL 다운로드
              </button>
            )}
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
                      title="묶음발주대기 건만 선택"
                    />
                  </th>
                  <th className="h-12 px-2 text-center">No</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">관리번호</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
                  <th className="h-12 px-2 text-left">소속 부서</th>
                  <th className="h-12 px-2 text-left">신청자</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">분류</th>
                  <th className="h-12 px-2 text-left">관리용 제목</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청내역</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">
                    {activeCategory === 'OFFICE_SUPPLIES' ? '건' : '수량'}
                  </th>
                  <th className="h-12 px-2 text-left whitespace-nowrap">외주업체</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">관리액션(Edit)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-16 text-center text-slate-400 text-xs">
                      {isReviewStage
                        ? '신청검수 중인 신규 신청이 없습니다.'
                        : '묶음발주대기 건이 없습니다. 신청검수에서 이동한 뒤 이 분류를 확인해 주세요.'}
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
                        <td className="px-2 text-left truncate" title={item.deptName || ''}>
                          {item.deptName || <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 text-left text-slate-800 truncate">{item.userName || '-'}</td>
                        <td className="px-2 text-center">
                          <span
                            className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-tight border ${getProductionCategoryBadgeClass(item.category)}`}
                          >
                            {getCategoryLabel(item.category)}
                          </span>
                        </td>
                        <td className="px-2 text-left text-slate-800 truncate" title={item.title || ''}>
                          {item.title || '-'}
                        </td>
                        <td className="px-2 text-center">
                          {isPending ? (
                            <button
                              type="button"
                              onClick={() => setDetailItem(item)}
                              className="px-2.5 py-1 text-[10px] font-bold rounded-lg shadow-sm transition-colors bg-rose-600 text-white hover:bg-rose-700"
                            >
                              원문검수
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDetailItem(item)}
                              className="px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
                            >
                              원문확인
                            </button>
                          )}
                        </td>
                        <td className="px-2 text-center tabular-nums text-slate-900">
                          <span className="font-mono">{item.quantity}</span>
                          <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                            {formatQuantityUnit(item)}
                          </span>
                        </td>
                        <td className="px-2 text-left text-slate-800 truncate">
                          {(item.options as any)?.vendor || '-'}
                        </td>
                        <td className="px-2 text-center">
                          <span
                            className={`text-[10px] font-bold whitespace-nowrap ${productionStatusTextClass(item.status, item.options as Record<string, unknown> | null)}`}
                          >
                            {productionStatusLabel(item.status, item.options as Record<string, unknown> | null)}
                          </span>
                        </td>
                        <td className="px-2 text-center">
                          {isPending ? (
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              <button
                                type="button"
                                disabled={!canEdit || ordering || actionBusyId === item.id}
                                title={!canEdit ? '편집 권한 필요' : '접수 후 바로 개별발주(검수 탭)'}
                                onClick={() => handleDirectSingleOrder(item)}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black rounded-lg transition-colors whitespace-nowrap ${
                                  canEdit
                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                <span>→</span>
                                <span>
                                  {ordering || actionBusyId === item.id ? '처리중' : '개별발주'}
                                </span>
                              </button>
                              <button
                                type="button"
                                disabled={!canEdit || ordering || actionBusyId === item.id}
                                title={!canEdit ? '편집 권한 필요' : '묶음발주대기로 이동'}
                                onClick={() => handleApprove(item)}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black rounded-lg transition-colors whitespace-nowrap ${
                                  canEdit
                                    ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                <span>→</span>
                                <span>{actionBusyId === item.id ? '처리중' : '묶음발주대기'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={!canEdit || ordering || actionBusyId === item.id}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={() => {
                                  if (!canEdit) return alert('신청반려 권한(Edit)이 없습니다.');
                                  setRejectTarget(item);
                                  setRejectReason('');
                                }}
                                className={`px-2 py-1 text-[10px] font-black rounded-lg transition-colors whitespace-nowrap ${
                                  canEdit
                                    ? 'bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                신청반려
                              </button>
                            </div>
                          ) : item.status === PRODUCTION_STATUS.ACCEPTED && activeCategory !== 'ALL' ? (
                            <button
                              type="button"
                              disabled={!canEdit || ordering || actionBusyId === item.id}
                              title={!canEdit ? '편집 권한 필요' : '묶음발주 대기열에서 제외하고 신청검수로 이동'}
                              onClick={() => handleRevertAccept(item)}
                              className={`px-2 py-1 text-[10px] font-black rounded-lg transition-colors whitespace-nowrap ${
                                canEdit
                                  ? 'bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600 disabled:opacity-50'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              {actionBusyId === item.id ? '처리중' : '대기열 제외'}
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500 font-bold whitespace-nowrap">
                              {productionActionHint(item.status, item.options as Record<string, unknown> | null)}
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
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
        </div>
        </div>
      </div>

      {/* 부서 전체 이력 — 기본 접힘 · apply/history 리스트·공정상태 */}
      <div className="w-full mt-8 space-y-3">
        <button
          type="button"
          onClick={() => setHistOpen((v) => !v)}
          className={`w-full bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3 text-left transition-colors hover:bg-slate-50 ${
            histOpen ? 'rounded-b-none border-b-0' : ''
          }`}
          aria-expanded={histOpen}
        >
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              📂 부서 전체 이력
              <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                {histOpen ? '접기' : '닫힘 · 클릭하여 펼치기'}
              </span>
            </h3>
            <p className="text-[10px] text-slate-500 font-bold mt-0.5">
              연계 조직 신청을 분류철별로 모아 봅니다. 공정상태는 나의 신청 이력과 동일하게 표기됩니다.
            </p>
          </div>
          <span
            className={`text-slate-500 font-black text-lg shrink-0 transition-transform ${
              histOpen ? 'rotate-180' : ''
            }`}
            aria-hidden
          >
            ▾
          </span>
        </button>

        {histOpen && (
          <div className="w-full -mt-3">
            <div
              className="flex flex-wrap items-end gap-1 border-b border-slate-200"
              role="tablist"
              aria-label="부서 이력 분류 필터"
            >
              {DEPT_HISTORY_CATEGORIES.map((cat) => {
                const active = histCategory === cat.id;
                const count = requests.filter(
                  (r) => r.status !== PRODUCTION_STATUS.CANCELLED && r.category === cat.id
                ).length;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setHistCategory(cat.id)}
                    className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
                  >
                    <span className="text-sm leading-none">{cat.icon}</span>
                    <span>{cat.label}</span>
                    {count > 0 && (
                      <span className="ml-0.5 min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[9px] font-black bg-slate-800/10 text-slate-700">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="bg-white border border-t-0 border-slate-200 rounded-b-[2.5rem] rounded-tr-2xl shadow-sm overflow-hidden">
              <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                  <h2 className="text-sm font-black text-slate-800 tracking-tight">
                    {getHistCategoryLabel(histCategory)} 이력
                  </h2>
                  <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
                    {histFiltered.length}건
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    placeholder="제목 검색"
                    value={histTitleQuery}
                    onChange={(e) => setHistTitleQuery(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-300 w-36"
                  />
                  <input
                    type="text"
                    placeholder="신청자 검색"
                    value={histUserQuery}
                    onChange={(e) => setHistUserQuery(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-300 w-32"
                  />
                  <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                    <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                    <select
                      value={histYear}
                      onChange={(e) => {
                        setHistYear(e.target.value);
                        setHistMonth('ALL');
                      }}
                      className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                    >
                      <option value="ALL">전체</option>
                      {histAvailableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}년
                        </option>
                      ))}
                    </select>
                    <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
                    <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                    <select
                      value={histMonth}
                      onChange={(e) => setHistMonth(e.target.value)}
                      className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                    >
                      <option value="ALL">전체</option>
                      {histAvailableMonths.map((month) => (
                        <option key={month} value={month}>
                          {month}월
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleHistExcelDownload}
                    disabled={histFiltered.length === 0}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap disabled:opacity-50"
                  >
                    화면 목록 EXCEL 다운로드
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto min-h-[280px]">
                {loading ? (
                  <LoadingState />
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                      <tr>
                        <th className="h-12 px-2 text-center">No</th>
                        <th className="h-12 px-2 text-center whitespace-nowrap">관리번호</th>
                        <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
                        <th className="h-12 px-2 text-left">소속 부서</th>
                        <th className="h-12 px-2 text-left">신청자</th>
                        <th className="h-12 px-2 text-center whitespace-nowrap">분류</th>
                        <th className="h-12 px-2 text-left">관리용 제목</th>
                        <th className="h-12 px-2 text-center whitespace-nowrap">신청내역</th>
                        <th className="h-12 px-2 text-center whitespace-nowrap">
                          {histCategory === 'OFFICE_SUPPLIES' ? '건' : '수량'}
                        </th>
                        <th className="h-12 px-2 text-left whitespace-nowrap">외주업체</th>
                        <th className="h-12 px-2 text-center whitespace-nowrap">처리날짜</th>
                        <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                      {histPaginated.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="p-16 text-center text-slate-400 text-xs">
                            해당 조건의 부서 신청 이력이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        histPaginated.map((item, idx) => {
                          const rowNo =
                            histFiltered.length - ((histPage - 1) * ITEMS_PER_PAGE + idx);
                          const statusDisp = getApplyHistoryStatusDisplay(item);
                          const opts = (item.options || {}) as Record<string, unknown>;
                          const isRejected = item.status === PRODUCTION_STATUS.REJECTED;
                          const isPending = item.status === PRODUCTION_STATUS.PENDING;
                          const processedLabel = item.statusChangedAt
                            ? getKSTDateString(item.statusChangedAt)
                            : '';
                          return (
                            <tr key={item.id} className="h-12 hover:bg-slate-50/50 transition-colors">
                              <td className="px-2 text-center font-mono text-slate-500 tabular-nums">
                                {rowNo}
                              </td>
                              <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate">
                                {item.postNumber}
                              </td>
                              <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                                {getKSTDateString(item.createdAt)}
                              </td>
                              <td className="px-2 text-left truncate" title={item.deptName || ''}>
                                {item.deptName || <span className="text-slate-300">-</span>}
                              </td>
                              <td className="px-2 text-left text-slate-800 truncate">
                                {item.userName || '-'}
                              </td>
                              <td className="px-2 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-tight border ${getProductionCategoryBadgeClass(item.category)}`}
                                >
                                  {getHistCategoryLabel(item.category)}
                                </span>
                              </td>
                              <td
                                className="px-2 text-left text-slate-800 truncate"
                                title={item.title || ''}
                              >
                                {item.title || '-'}
                              </td>
                              <td className="px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => setDetailItem(item)}
                                  className={`px-2.5 py-1 text-[10px] font-bold rounded-lg shadow-sm transition-colors ${
                                    isPending
                                      ? 'bg-rose-600 text-white hover:bg-rose-700'
                                      : 'bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300'
                                  }`}
                                >
                                  {isPending ? '원문검수' : '원문확인'}
                                </button>
                              </td>
                              <td className="px-2 text-center tabular-nums text-slate-900">
                                <span className="font-mono">{item.quantity}</span>
                                <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                                  {formatQuantityUnit(item)}
                                </span>
                              </td>
                              <td className="px-2 text-left text-slate-800 truncate">
                                {(item.options as { vendor?: string } | undefined)?.vendor || '-'}
                              </td>
                              <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                                {processedLabel || <span className="text-slate-300">-</span>}
                              </td>
                              <td className="px-2 text-center">
                                {isRejected ? (
                                  (() => {
                                    const rejectReason = String(opts.rejectReason || '').trim();
                                    const rejectedAt = String(opts.rejectedAt || '').trim();
                                    return (
                                      <button
                                        type="button"
                                        title={
                                          rejectReason
                                            ? `반려 사유: ${rejectReason}${
                                                rejectedAt ? `\n처리일: ${rejectedAt}` : ''
                                              }`
                                            : '등록된 반려 사유가 없습니다.'
                                        }
                                        onClick={() => {
                                          if (rejectReason) {
                                            alert(
                                              `[${item.postNumber}] 반려 사유\n\n${rejectReason}${
                                                rejectedAt ? `\n\n처리일: ${rejectedAt}` : ''
                                              }`
                                            );
                                          } else {
                                            alert('등록된 반려 사유가 없습니다.');
                                          }
                                        }}
                                        className={`inline-flex flex-col items-center leading-tight ${statusDisp.className} underline decoration-dotted underline-offset-2 cursor-pointer hover:opacity-80`}
                                      >
                                        <span className="text-[10px] font-bold whitespace-nowrap">
                                          반려
                                        </span>
                                        <span className="text-[9px] font-medium text-rose-500/90 whitespace-nowrap normal-case tracking-normal">
                                          {rejectReason ? '사유 보기' : '사유 없음'}
                                        </span>
                                      </button>
                                    );
                                  })()
                                ) : (
                                  <span
                                    className={`text-[10px] font-bold whitespace-nowrap ${statusDisp.className}`}
                                  >
                                    {statusDisp.label}
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

              {!loading && histFiltered.length > 0 && (
                <WindowedPagination
                  currentPage={histPage}
                  totalPages={histTotalPages}
                  onPageChange={setHistPage}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-rose-50">
              <h3 className="text-sm font-black text-rose-800 tracking-tight">신청반려 사유 입력</h3>
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
                {savingReject ? '전송중' : '신청반려 전송'}
              </button>
            </div>
          </div>
        </div>
      )}

      {batchShippingOpen && (
        <ProductionBatchShippingModal
          open
          showApplyScope
          totalCount={pendingOrderRequests.length}
          unenteredCount={batchShippingUnenteredCount}
          enteredCount={batchShippingEnteredCount}
          totalJebonCount={pendingOrderRequests.length}
          deferredCount={batchShippingUnenteredCount}
          saving={ordering}
          title="묶음 배송지 입력 후 발주"
          description="묶음 발주할 건의 실배송지를 확인 및 일괄 적용합니다."
          submitLabel="배송지 적용 후 발주"
          onClose={() => {
            if (!ordering) {
              setBatchShippingOpen(false);
              setPendingOrderIds([]);
            }
          }}
          onSubmit={handleBatchShippingBeforeOrder}
        />
      )}

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          allowEdit={canEdit}
          editPermissionTag="Edit"
          editableStatuses={['PENDING']}
          editApiPath="/api/production/custom/dept-master/order"
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
    </>
  );
}
