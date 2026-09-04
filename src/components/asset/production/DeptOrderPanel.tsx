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
import {
  buildSignDetailExcelRows,
  buildJebonDetailExcelRows,
  buildPrintDetailExcelRows,
} from '@/lib/production-sign-excel';
import { itemDeferredBatchShipping, itemNeedsBatchShipping } from '@/lib/production-shipping';
import type { BatchShippingApplyScope, BatchShippingInput } from '@/lib/production-shipping';
import ProductionBatchShippingModal, {
  type BatchShippingSubmitPayload,
} from '@/components/asset/production/ProductionBatchShippingModal';

const MENU_PATH = '/asset/production/dept-master/order';
const ITEMS_PER_PAGE = 10;
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed';

const HISTORY_CATEGORIES = [
  { id: 'ALL', label: '접수 대기', icon: '⏳' },
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

  const pendingScopeBase = useMemo(() => {
    return afterYearList.filter((r) => {
      if (r.status !== PRODUCTION_STATUS.PENDING) return false;
      const ym = getKSTYearMonthParts(r.createdAt);
      const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      const matchUnit = selectedUnitId === 'ALL' || r.deptName === selectedUnitId;
      const matchUser =
        !searchUserQuery ||
        (r.userName || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      return matchYear && matchMonth && matchUnit && matchUser;
    });
  }, [afterYearList, selectedYear, selectedMonth, selectedUnitId, searchUserQuery]);

  const pendingTabCounts = useMemo(
    () => ({
      ALL: pendingScopeBase.length,
    }),
    [pendingScopeBase]
  );

  const acceptedScopeBase = useMemo(() => {
    return afterYearList.filter((r) => {
      if (r.status !== PRODUCTION_STATUS.ACCEPTED) return false;
      const ym = getKSTYearMonthParts(r.createdAt);
      const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      const matchUnit = selectedUnitId === 'ALL' || r.deptName === selectedUnitId;
      const matchUser =
        !searchUserQuery ||
        (r.userName || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      return matchYear && matchMonth && matchUnit && matchUser;
    });
  }, [afterYearList, selectedYear, selectedMonth, selectedUnitId, searchUserQuery]);

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
    return afterYearList
      .filter((r) => {
        if (r.status === PRODUCTION_STATUS.CANCELLED || r.status === PRODUCTION_STATUS.REJECTED) {
          return false;
        }
        const ym = getKSTYearMonthParts(r.createdAt);
        const matchCategory = activeCategory === 'ALL' || r.category === activeCategory;
        const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
        const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
        const matchUnit = selectedUnitId === 'ALL' || r.deptName === selectedUnitId;
        const matchUser =
          !searchUserQuery ||
          (r.userName || '').toLowerCase().includes(searchUserQuery.toLowerCase());

        if (activeCategory === 'ALL') {
          if (r.status !== PRODUCTION_STATUS.PENDING) return false;
        } else if (r.status !== PRODUCTION_STATUS.ACCEPTED) {
          return false;
        }

        return matchCategory && matchYear && matchMonth && matchUnit && matchUser;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [
    afterYearList,
    activeCategory,
    selectedYear,
    selectedMonth,
    selectedUnitId,
    searchUserQuery,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / ITEMS_PER_PAGE));
  const paginatedRequests = filteredRequests.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [activeCategory, selectedYear, selectedMonth, selectedUnitId, searchUserQuery]);

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
    if (
      !confirm(
        `[${row.postNumber}] 접수 완료 처리하시겠습니까?\n접수 후 ${getCategoryLabel(row.category)} 탭(발주대기)에서 확인·발주할 수 있습니다.`
      )
    ) {
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

  const batchShippingDeferredCount = useMemo(
    () => pendingOrderRequests.filter((r) => itemDeferredBatchShipping(r)).length,
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
      const res = await fetch('/api/asset/production/dept-master/order', {
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
          : '/asset/production/dept-master/inspection';
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

    const allPrint = selectedRequests.every((r) => r.category === 'PRINT');
    const hasPrint = selectedRequests.some((r) => r.category === 'PRINT');

    if (allPrint) {
      if (
        !confirm(
          `선택한 기타 제작물 ${ids.length}건을 각각 개별 발주하시겠습니까?\n발주/수령 검수 탭에는 건별로 별도 묶음이 생성됩니다.`
        )
      ) {
        return;
      }
    } else if (hasPrint) {
      if (
        !confirm(
          `선택 ${ids.length}건 중 기타 제작물은 건별 개별 발주, 나머지는 한 묶음으로 발주됩니다.\n계속하시겠습니까?`
        )
      ) {
        return;
      }
    } else if (
      !confirm(
        `선택한 ${ids.length}건을 묶음 발주 처리하시겠습니까?\n발주 후 발주/수령 검수 탭의 외주 발주 묶음 관리 대장으로 이동합니다.`
      )
    ) {
      return;
    }
    setPendingOrderIds(ids);
    await executeBatchOrder(ids);
  };

  const handleSingleOrder = async (item: ProductionRequestRow) => {
    if (!canEdit) return alert('발주 권한(Edit)이 없습니다.');
    if (item.status !== PRODUCTION_STATUS.ACCEPTED) return;

    if (itemNeedsBatchShipping(item)) {
      setPendingOrderIds([item.id]);
      setBatchShippingOpen(true);
      return;
    }

    const isPrint = item.category === 'PRINT';
    if (
      !confirm(
        isPrint
          ? `[${item.postNumber}] 기타 제작물을 개별 발주하시겠습니까?\n발주/수령 검수 탭에 단독 묶음으로 생성됩니다.`
          : `[${item.postNumber}] 발주 처리하시겠습니까?\n발주 후 발주/수령 검수 탭에서 확인합니다.`
      )
    ) {
      return;
    }

    setPendingOrderIds([item.id]);
    await executeBatchOrder([item.id]);
  };

  const handleRevertAccept = async (item: ProductionRequestRow) => {
    if (!canEdit) return alert('접수 취소 권한(Edit)이 없습니다.');
    if (item.status !== PRODUCTION_STATUS.ACCEPTED) return;
    if (
      !confirm(
        `[${item.postNumber}] 접수를 취소하고 신청(접수 대기) 탭으로 되돌릴까요?`
      )
    ) {
      return;
    }
    setActionBusyId(item.id);
    try {
      const res = await fetch('/api/asset/production/dept-master/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'revert' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '접수 취소에 실패했습니다.');
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
      scope === 'all' ? pendingOrderRequests.length : batchShippingDeferredCount;
    if (applyCount <= 0) {
      alert('선택한 적용 범위에 해당하는 건이 없습니다.');
      return;
    }
    const scopeLabel =
      scope === 'all'
        ? `배송지 적용 대상 전체 ${applyCount}건`
        : `「인증원 수령」 미입력 ${applyCount}건`;
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
    activeCategory === 'ALL'
      ? '신규 신청/접수 대기 목록'
      : `${getCategoryLabel(activeCategory)} · 발주대기`;

  const getTabBadgeCount = (catId: string) => {
    if (catId === 'ALL') return pendingTabCounts.ALL;
    return acceptedTabCounts[catId as keyof typeof acceptedTabCounts] ?? 0;
  };

  const tabCountTitle = (catId: string) => {
    const n = getTabBadgeCount(catId);
    if (n <= 0) return undefined;
    return catId === 'ALL' ? `접수 대기 ${n}건` : `발주대기 ${n}건`;
  };

  return (
    <ProductionDeptShell pageHint="⏳ 접수 대기중 탭에서 접수·반려 후, 분류 탭(현판/제본 등)에서 발주대기 건을 선택해 묶음 발주합니다. 발주 완료 건은 발주/수령 검수 탭에서 관리합니다.">
      {/* 카테고리 서류철 탭 + 테이블 */}
      <div className="w-full">
        <div
          className="flex flex-wrap items-end gap-1 border-b border-slate-200"
          role="tablist"
          aria-label="제작 분류 필터"
        >
          {HISTORY_CATEGORIES.map((cat) => {
            const active = activeCategory === cat.id;
            const badgeCount = getTabBadgeCount(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCategory(cat.id)}
                title={tabCountTitle(cat.id)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
              >
                <span className="text-sm leading-none">{cat.icon}</span>
                <span className="flex items-center gap-1">
                  <span>{cat.label}</span>
                  {badgeCount > 0 ? (
                    <span
                      className={`tabular-nums ${
                        active ? 'opacity-95' : 'text-indigo-600'
                      }`}
                    >
                      ({badgeCount})
                    </span>
                  ) : null}
                </span>
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
                  <th className="h-12 px-2 text-center whitespace-nowrap">
                    {activeCategory === 'OFFICE_SUPPLIES' ? '건' : '수량'}
                  </th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">외주업체</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-16 text-center text-slate-400 text-xs">
                      {activeCategory === 'ALL'
                        ? '접수 대기 중인 신규 신청이 없습니다.'
                        : '발주대기(접수완료) 건이 없습니다. ⏳ 접수 대기중 탭에서 접수 후 이 분류 탭을 확인해 주세요.'}
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
                              className="px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors bg-blue-600 text-white border border-blue-600 hover:bg-blue-700"
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
                          ) : item.status === PRODUCTION_STATUS.ACCEPTED && activeCategory !== 'ALL' ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                disabled={!canEdit || ordering || actionBusyId === item.id}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={() => handleSingleOrder(item)}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                  canEdit
                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                <span>→</span>
                                <span>
                                  {ordering || actionBusyId === item.id ? '처리중' : '개별 발주 이동'}
                                </span>
                              </button>
                              <button
                                type="button"
                                disabled={!canEdit || ordering || actionBusyId === item.id}
                                title={!canEdit ? '편집 권한 필요' : '신청(접수 대기)로 되돌리기'}
                                onClick={() => handleRevertAccept(item)}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                  canEdit
                                    ? 'bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 disabled:opacity-50'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                <span>←</span>
                                <span>{actionBusyId === item.id ? '처리중' : '접수 취소'}</span>
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

      {batchShippingOpen && (
        <ProductionBatchShippingModal
          open
          showApplyScope
          totalJebonCount={pendingOrderRequests.length}
          deferredCount={batchShippingDeferredCount}
          saving={ordering}
          title="묶음 배송지 입력 후 발주"
          description="인증원 수령(배송지 미입력) 건에 동일한 실배송지를 적용한 뒤 묶음 발주합니다."
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
