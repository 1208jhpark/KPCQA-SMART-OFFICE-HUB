'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonthParts } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
import ProductionRequestDetailModal from '@/components/production/ProductionRequestDetailModal';
import DeptAssigneeLine, { useDeptAssignees } from '@/components/common/DeptAssigneeLine';
import {
  getProductionCategoryTextClass,
  getProductionCategoryFolderTabClasses,
} from '@/lib/production-category-theme';
import {
  PRODUCTION_STATUS,
  productionActionHint,
  productionStatusLabel,
  productionStatusTextClass,
} from '@/lib/production-status';
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

/** 분류 라벨용 (사무문구 포함) */
const DEPT_HISTORY_CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

/** 묶음발주대기 서류철 — 분류별 후보 보드 */
const BATCH_FOLDER_CATEGORIES = DEPT_HISTORY_CATEGORIES;

const BATCH_CATEGORY_IDS = BATCH_FOLDER_CATEGORIES.map((c) => c.id);
const INSPECTION_PATH = '/production/custom/dept-master/inspection';

function inspectionPathForCategory(category: string) {
  const cat = String(category || '').trim().toUpperCase();
  if (BATCH_CATEGORY_IDS.includes(cat)) {
    return `${INSPECTION_PATH}?category=${encodeURIComponent(cat)}`;
  }
  return INSPECTION_PATH;
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
  const [actionMenu, setActionMenu] = useState<{ id: string; top: number; left: number } | null>(
    null
  );
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [batchShippingOpen, setBatchShippingOpen] = useState(false);
  const [pendingOrderIds, setPendingOrderIds] = useState<string[]>([]);
  /** 개별발주→배송지 모달만: 닫으면 ACCEPTED를 신청검수(PENDING)로 되돌림 */
  const [shippingCancelRevertIds, setShippingCancelRevertIds] = useState<string[]>([]);

  /** 부서 발주 관리액션: 메뉴 Access면 처리 가능 (Edit 미사용) */
  const canAct = true;
  const { editorNames } = useDeptAssignees(MENU_PATH);

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

  /** 묶음발주대기 대상 */
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
    setActionMenu(null);
  }, [activeCategory, selectedYear, selectedMonth, selectedUnitId, searchUserQuery, searchTitleQuery]);

  useEffect(() => {
    if (!actionMenu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (actionMenuRef.current?.contains(t)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-action-kebab]')) return;
      setActionMenu(null);
    };
    const onWin = () => setActionMenu(null);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onWin, true);
    window.addEventListener('resize', onWin);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onWin, true);
      window.removeEventListener('resize', onWin);
    };
  }, [actionMenu]);

  useEffect(() => {
    setActionMenu(null);
  }, [currentPage]);

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

  /** 접수대기 → 묶음발주대기(ACCEPTED) */
  const handleApprove = async (row: ProductionRequestRow) => {
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
  /** 최근 배송지 저장 분류 — 현판/제본/기타/사무문구 분리 */
  const batchShippingCategoryScope = useMemo(() => {
    const cats = pendingOrderRequests.map((r) => String(r.category || '').trim()).filter(Boolean);
    if (cats.length === 0) {
      return activeCategory !== 'ALL' ? activeCategory : 'OTHER';
    }
    const unique = Array.from(new Set(cats));
    if (unique.length === 1) return unique[0];
    if (unique.includes(activeCategory)) return activeCategory;
    return unique[0];
  }, [pendingOrderRequests, activeCategory]);

  /** 개별발주 중 취소·실패 시 묶음발주대기(ACCEPTED) → 신청검수(PENDING) */
  const revertAcceptedToPending = async (ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return;
    const okIds: string[] = [];
    for (const id of unique) {
      try {
        const res = await fetch('/api/production/custom/dept-master/order', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'revert' }),
        });
        if (res.ok) okIds.push(id);
      } catch {
        /* 개별 실패는 아래에서 남은 건만 반영 */
      }
    }
    if (okIds.length === 0) return;
    setRequests((prev) =>
      prev.map((r) =>
        okIds.includes(r.id) ? { ...r, status: PRODUCTION_STATUS.PENDING } : r
      )
    );
    setSelectedIds((prev) => {
      const next = new Set(prev);
      okIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const closeBatchShippingModal = async () => {
    if (ordering) return;
    const revertIds = shippingCancelRevertIds;
    setBatchShippingOpen(false);
    setPendingOrderIds([]);
    setShippingCancelRevertIds([]);
    if (revertIds.length > 0) {
      await revertAcceptedToPending(revertIds);
    }
  };

  const executeBatchOrder = async (
    orderIds: string[],
    batchShipping?: BatchShippingInput,
    batchShippingScope?: BatchShippingApplyScope
  ): Promise<boolean> => {
    const ids = orderIds.filter(Boolean);
    if (ids.length === 0) {
      alert('발주할 항목을 선택해주세요.');
      return false;
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
        return false;
      }
      alert(data.message || '묶음 발주가 완료되었습니다.');
      setSelectedIds(new Set());
      setPendingOrderIds([]);
      setShippingCancelRevertIds([]);
      setBatchShippingOpen(false);
      const orderedCats = Array.from(
        new Set(
          ids
            .map((id) => requests.find((r) => r.id === id)?.category)
            .map((c) => String(c || '').trim().toUpperCase())
            .filter((c) => BATCH_CATEGORY_IDS.includes(c))
        )
      );
      const category =
        orderedCats.length === 1
          ? orderedCats[0]
          : activeCategory !== 'ALL' && orderedCats.includes(activeCategory)
            ? activeCategory
            : orderedCats[0] || (activeCategory !== 'ALL' ? activeCategory : '');
      router.push(inspectionPathForCategory(category));
      return true;
    } catch {
      alert('서버와 통신할 수 없습니다.');
      return false;
    } finally {
      setOrdering(false);
    }
  };

  const handleBatchOrder = async () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const row = requests.find((r) => r.id === id);
      return Boolean(row);
    });
    if (ids.length === 0) return alert('발주대기(접수완료) 건을 선택해 주세요.');

    if (
      !confirm(
        [
          `선택한 ${ids.length}건을 묶음 발주 처리할까요?`,
          '배송주소 설정 후 다음 탭으로 이동합니다.',
        ].join('\n')
      )
    ) {
      return;
    }

    const selectedRequests = requests.filter((r) => ids.includes(r.id));
    const needsBatchShipping = selectedRequests.some((r) => itemNeedsBatchShipping(r));
    if (needsBatchShipping) {
      setShippingCancelRevertIds([]);
      setPendingOrderIds(ids);
      setBatchShippingOpen(true);
      return;
    }
    setPendingOrderIds(ids);
    await executeBatchOrder(ids);
  };

  /** 접수대기 → 접수(ACCEPTED) 후 바로 개별발주(검수 탭) */
  const handleDirectSingleOrder = async (row: ProductionRequestRow) => {
    if (row.status !== PRODUCTION_STATUS.PENDING) return;
    if (
      !confirm(
        [
          `[${row.postNumber}] 개별발주 처리할까요?`,
          '배송주소 설정 후 다음 탭으로 이동합니다.',
        ].join('\n')
      )
    ) {
      return;
    }
    setActionBusyId(row.id);
    let approved = false;
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
      approved = true;
      setRequests((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: PRODUCTION_STATUS.ACCEPTED } : r))
      );

      if (itemNeedsBatchShipping(row)) {
        setShippingCancelRevertIds([row.id]);
        setPendingOrderIds([row.id]);
        setBatchShippingOpen(true);
        return;
      }
      const ordered = await executeBatchOrder([row.id]);
      if (!ordered) {
        await revertAcceptedToPending([row.id]);
      }
    } catch {
      alert('서버와 통신할 수 없습니다.');
      if (approved) await revertAcceptedToPending([row.id]);
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRevertAccept = async (item: ProductionRequestRow) => {
    if (item.status !== PRODUCTION_STATUS.ACCEPTED) return;
    if (
      !confirm(
        `[${item.postNumber}] 묶음발주 대기열에서 제외하고 신청검토로 되돌릴까요?`
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
        alert(data.message || '신청검토 복귀에 실패했습니다.');
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

  const openActionMenu = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    if (!canAct) return;
    const width = 220;
    const r = e.currentTarget.getBoundingClientRect();
    setActionMenu((prev) =>
      prev?.id === id
        ? null
        : {
            id,
            top: r.bottom + 4,
            left: Math.min(Math.max(12, r.right - width), window.innerWidth - width - 12),
          }
    );
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
    const revertIds = shippingCancelRevertIds;
    const ordered = await executeBatchOrder(ids, shipping, scope);
    if (!ordered && revertIds.length > 0) {
      await revertAcceptedToPending(revertIds);
      setShippingCancelRevertIds([]);
    }
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
    ? '신청검토/개별발주 목록'
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
          💡프로세스
          <span className="font-medium text-slate-900">[발주전 검수]</span>
          {' : '}
          원문검토{' '}
          <b className="font-medium text-amber-600">→</b>{' '}
          <span className="font-medium">[개별발주]</span> 진행 또는{' '}
          <span className="font-medium">[묶음취합]</span> 이동
        </div>

        {/* 서류철 탭이 아래 표에 붙음 · 신청검수 | 묶음발주대기(분류) */}
        <div>
          <div
            className="flex flex-wrap items-end gap-1 border-b border-slate-300"
            role="tablist"
            aria-label="신청검토/개별발주 · 묶음발주대기"
          >
            <button
              type="button"
              role="tab"
              aria-selected={isReviewStage}
              onClick={() => setActiveCategory('ALL')}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses('ALL', isReviewStage)}`}
            >
              <span className="text-sm leading-none">⏳</span>
              <span className="flex items-center gap-1">
                <span>신청검토/개별발주</span>
                {pendingTabCounts.ALL > 0 ? (
                  <span
                    className={`tabular-nums ${isReviewStage ? 'opacity-95' : 'text-indigo-600'}`}
                  >
                    ({pendingTabCounts.ALL})
                  </span>
                ) : null}
              </span>
            </button>

            <div className="w-px h-8 bg-slate-300 mx-1.5 mb-0 shrink-0" aria-hidden />
            <button
              type="button"
              className="shrink-0 mb-2 px-1 text-[10px] font-medium text-slate-400 whitespace-nowrap hover:text-slate-600"
              title={
                acceptedBatchTotal > 0
                  ? `묶음 취합 대기 총 ${acceptedBatchTotal}건 — 분류 탭을 선택하세요`
                  : '묶음 취합 대기 분류 탭을 선택하세요'
              }
              onClick={openBatchStage}
            >
              묶음 취합 대기
              {acceptedBatchTotal > 0 ? (
                <span className="ml-0.5 tabular-nums text-indigo-600">({acceptedBatchTotal})</span>
              ) : null}
            </button>
            {BATCH_FOLDER_CATEGORIES.map((cat) => {
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
                  className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
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

        <div className="bg-white border border-t-0 border-slate-200 rounded-b-sm rounded-tr-sm shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            <h2 className="text-sm font-medium text-slate-800 tracking-tight">{tableTitle}</h2>
            <span className="text-[11px] font-medium bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
              {filteredRequests.length}건
            </span>
            <DeptAssigneeLine editorNames={editorNames} />
            {selectedIds.size > 0 && (
              <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                {selectedIds.size}개 선택
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="제목 검색"
              value={searchTitleQuery}
              onChange={(e) => setSearchTitleQuery(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:ring-2 focus:ring-indigo-300 w-36"
            />
            <input
              type="text"
              placeholder="신청자 검색"
              value={searchUserQuery}
              onChange={(e) => setSearchUserQuery(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:ring-2 focus:ring-indigo-300 w-32"
            />
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium text-slate-800 outline-none"
            >
              <option value="ALL">전체 조직</option>
              {deptOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unit_name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-8">
              <span className="text-[10px] font-medium text-slate-400 uppercase">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth('ALL');
                }}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300" />
              <span className="text-[10px] font-medium text-slate-400 uppercase">월</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
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
                onClick={handleBatchOrder}
                disabled={!canAct || ordering || selectedIds.size === 0}
                title={undefined}
                className={`inline-flex items-center gap-2 text-[10px] font-medium rounded-lg px-4 py-1.5 transition-colors shadow-sm whitespace-nowrap ${
                  canAct
                    ? 'bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-700 disabled:opacity-50'
                    : DISABLED_ACTION_BTN
                }`}
              >
                <span>
                  {ordering
                    ? '발주 처리 중…'
                    : `선택된 ${selectedIds.size}건 묶음발주(취합) 이동`}
                </span>
                {!ordering && (
                  <span
                    className="flex w-10 shrink-0 items-center"
                    title="묶음발주(취합) 이동"
                    aria-hidden
                  >
                    <span className="h-2 flex-1 rounded-l-full bg-amber-300" />
                    <span className="h-0 w-0 shrink-0 border-y-[7px] border-y-transparent border-l-[11px] border-l-amber-300" />
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <LoadingState />
          ) : (
            <table className="w-full table-fixed text-left border-collapse">
              <colgroup>
                <col style={{ width: '2.5rem' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '8.5%' }} />
                <col style={{ width: '7%' }} />
                <col />
                <col style={{ width: '5.5rem' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '5.5rem' }} />
                <col style={{ width: '9.75rem' }} />
                {isReviewStage ? (
                  <>
                    <col style={{ width: '5.75rem' }} />
                    <col style={{ width: '8.75rem' }} />
                    <col style={{ width: '2.5rem' }} />
                  </>
                ) : (
                  <col style={{ width: '6.5rem' }} />
                )}
              </colgroup>
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-medium border-b border-slate-200">
                <tr>
                  <th className="h-12 px-2 text-center">No</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">관리번호</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
                  <th className="h-12 px-2 text-left whitespace-nowrap">부서 / 신청자</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">분류</th>
                  <th className="h-12 px-2 text-left">관리용 제목</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">
                    {activeCategory === 'OFFICE_SUPPLIES' ? '건' : '수량'}
                  </th>
                  <th className="h-12 px-2 text-left whitespace-nowrap">외주업체</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap border-l border-r border-slate-300 bg-amber-50 text-amber-800">
                    <div className="flex flex-col items-center gap-1 px-1">
                      <span>신청내역</span>
                      <div
                        className="flex w-full max-w-[4.5rem] items-center"
                        title="신청내역 확인"
                        aria-hidden
                      >
                        <div className="h-2.5 flex-1 rounded-l-full bg-amber-500/80" />
                        <div className="h-0 w-0 shrink-0 border-y-[10px] border-y-transparent border-l-[16px] border-l-amber-500/80" />
                      </div>
                    </div>
                  </th>
                  <th
                    colSpan={isReviewStage ? 3 : 1}
                    className="h-12 px-2 text-center whitespace-nowrap bg-indigo-50 text-indigo-700"
                  >
                    {isReviewStage ? (
                      <div className="flex flex-col items-center gap-1 px-1">
                        <span>관리액션</span>
                        <div
                          className="flex w-full max-w-full items-center"
                          title="관리 액션 진행"
                          aria-hidden
                        >
                          <div className="h-2.5 flex-1 rounded-l-full bg-indigo-500/80" />
                          <div className="h-0 w-0 shrink-0 border-y-[10px] border-y-transparent border-l-[16px] border-l-indigo-500/80" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-0.5 px-1">
                        <div
                          className="flex flex-col items-center"
                          title="위쪽 묶음발주(취합) 버튼으로 이동"
                          aria-hidden
                        >
                          <div className="h-0 w-0 border-x-[7px] border-x-transparent border-b-[10px] border-b-indigo-500/80" />
                          <div className="h-2.5 w-2 rounded-b-full bg-indigo-500/80" />
                        </div>
                        <span>관리액션</span>
                        <input
                          type="checkbox"
                          className="w-3 h-3 accent-indigo-600 rounded cursor-pointer"
                          checked={allAcceptedSelected && acceptedSelectableOnPage.length > 0}
                          onChange={toggleSelectAll}
                          title="묶음발주(취합)할 건 선택"
                        />
                      </div>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-medium text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={isReviewStage ? 13 : 11} className="p-16 text-center text-slate-400 text-xs">
                      {isReviewStage
                        ? '신청검토 중인 신규 신청이 없습니다.'
                        : '묶음발주대기 건이 없습니다. 신청검토에서 이동한 뒤 이 분류를 확인해 주세요.'}
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
                        <td className="px-2 text-center text-slate-500">
                          {rowNo}
                        </td>
                        <td className="px-2 text-center text-slate-900 truncate max-w-0">
                          {item.postNumber}
                        </td>
                        <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                          {getKSTDateString(item.createdAt)}
                        </td>
                        <td
                          className="px-2 text-left min-w-0 max-w-0"
                          title={[item.deptName, item.userName].filter(Boolean).join(' / ')}
                        >
                          <span className="text-[10px] font-normal text-slate-500 block truncate">
                            {item.deptName || '-'}
                          </span>
                          <span className="font-normal text-slate-800 block truncate">
                            {item.userName || '-'}
                          </span>
                        </td>
                        <td className="px-2 text-center max-w-0">
                          <span
                            className={`inline-block max-w-full truncate text-[11px] font-medium tracking-tight ${getProductionCategoryTextClass(item.category)}`}
                            title={getCategoryLabel(item.category)}
                          >
                            {getCategoryLabel(item.category)}
                          </span>
                        </td>
                        <td className="px-2 text-left text-slate-800 truncate max-w-0" title={item.title || ''}>
                          {item.title || '-'}
                        </td>
                        <td className="px-2 text-center text-slate-900 whitespace-nowrap">
                          <span>{item.quantity}</span>
                          <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                            {formatQuantityUnit(item)}
                          </span>
                        </td>
                        <td className="px-2 text-left text-slate-800 truncate max-w-0" title={(item.options as any)?.vendor || ''}>
                          {(item.options as any)?.vendor || '-'}
                        </td>
                        <td className="px-2 text-center">
                          <span
                            className={`font-medium whitespace-nowrap ${
                              item.status === PRODUCTION_STATUS.ACCEPTED
                                ? 'text-orange-600'
                                : productionStatusTextClass(
                                    item.status,
                                    item.options as Record<string, unknown> | null,
                                    item.category
                                  )
                            }`}
                          >
                            {productionStatusLabel(
                              item.status,
                              item.options as Record<string, unknown> | null,
                              'deptQueue',
                              item.category
                            )}
                          </span>
                        </td>
                        <td className="px-2 text-center border-l border-r border-slate-300">
                          {isPending || item.status === PRODUCTION_STATUS.ACCEPTED ? (
                            <button
                              type="button"
                              onClick={() => setDetailItem(item)}
                              className="px-2.5 py-1 text-[10px] font-medium rounded-lg shadow-sm transition-colors bg-rose-600 text-white hover:bg-rose-700 whitespace-nowrap"
                            >
                              원문검토 · 수정가능
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDetailItem(item)}
                              className="px-2.5 py-1 text-[10px] font-medium rounded-lg transition-colors bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
                            >
                              원문확인
                            </button>
                          )}
                        </td>
                        {isPending ? (
                          <>
                            <td className="px-1 text-center align-middle">
                              <button
                                type="button"
                                disabled={!canAct || ordering || actionBusyId === item.id}
                                title={'접수 후 바로 개별발주(검수 탭)'}
                                onClick={() => handleDirectSingleOrder(item)}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                                  canAct
                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                <span>→</span>
                                <span>
                                  {ordering || actionBusyId === item.id ? '처리중' : '개별발주'}
                                </span>
                              </button>
                            </td>
                            <td className="px-1 text-center align-middle">
                              <button
                                type="button"
                                disabled={!canAct || ordering || actionBusyId === item.id}
                                title={'묶음 취합으로 이동'}
                                onClick={() => handleApprove(item)}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                                  canAct
                                    ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                <span>→</span>
                                <span>
                                  {actionBusyId === item.id ? '처리중' : '묶음 취합'}
                                </span>
                              </button>
                            </td>
                            <td className="px-0.5 text-center align-middle">
                              <button
                                type="button"
                                data-action-kebab
                                disabled={!canAct || ordering || actionBusyId === item.id}
                                title={!canAct ? '처리 권한 필요' : '더보기'}
                                onClick={(e) => openActionMenu(e, item.id)}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
                                  canAct
                                    ? actionMenu?.id === item.id
                                      ? 'bg-slate-200 text-slate-800'
                                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                    : 'text-slate-300 cursor-not-allowed'
                                }`}
                              >
                                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor" aria-hidden>
                                  <circle cx="10" cy="4.5" r="1.6" />
                                  <circle cx="10" cy="10" r="1.6" />
                                  <circle cx="10" cy="15.5" r="1.6" />
                                </svg>
                              </button>
                            </td>
                          </>
                        ) : item.status === PRODUCTION_STATUS.ACCEPTED &&
                          activeCategory !== 'ALL' ? (
                          <td className="px-1 text-center align-middle">
                            <div className="inline-flex items-center justify-center gap-1">
                              <input
                                type="checkbox"
                                className="w-3 h-3 accent-indigo-600 rounded cursor-pointer"
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleSelectOne(item.id, item.status)}
                                title="묶음발주(취합) 대상"
                              />
                              <button
                                type="button"
                                data-action-kebab
                                disabled={!canAct || ordering || actionBusyId === item.id}
                                title={!canAct ? '처리 권한 필요' : '더보기'}
                                onClick={(e) => openActionMenu(e, item.id)}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
                                  canAct
                                    ? actionMenu?.id === item.id
                                      ? 'bg-slate-200 text-slate-800'
                                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                    : 'text-slate-300 cursor-not-allowed'
                                }`}
                              >
                                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor" aria-hidden>
                                  <circle cx="10" cy="4.5" r="1.6" />
                                  <circle cx="10" cy="10" r="1.6" />
                                  <circle cx="10" cy="15.5" r="1.6" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        ) : (
                          <td
                            colSpan={isReviewStage ? 3 : 1}
                            className="px-2 text-center align-middle"
                          >
                            <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap">
                              {productionActionHint(item.status, item.options as Record<string, unknown> | null)}
                            </span>
                          </td>
                        )}
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

      {actionMenu &&
        createPortal(
          <div
            ref={actionMenuRef}
            style={{ top: actionMenu.top, left: actionMenu.left }}
            className="fixed z-[500] w-[220px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-left"
          >
            {requests.find((r) => r.id === actionMenu.id)?.status ===
            PRODUCTION_STATUS.ACCEPTED ? (
              <button
                type="button"
                disabled={!canAct || ordering || actionBusyId === actionMenu.id}
                className="w-full px-3 py-2 text-left text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 whitespace-nowrap"
                onClick={() => {
                  const row = requests.find((r) => r.id === actionMenu.id);
                  setActionMenu(null);
                  if (!row) return;
                  void handleRevertAccept(row);
                }}
              >
                ↺ 신청검토 복구 · 묶음발주 취소
              </button>
            ) : (
              <button
                type="button"
                disabled={!canAct || ordering || actionBusyId === actionMenu.id}
                className="w-full px-3 py-2 text-left text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                onClick={() => {
                  const row = requests.find((r) => r.id === actionMenu.id);
                  setActionMenu(null);
                  if (!row) return;
                  setRejectTarget(row);
                  setRejectReason('');
                }}
              >
                신청반려
              </button>
            )}
          </div>,
          document.body
        )}

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
                disabled={!canAct || savingReject}
                onClick={handleRejectSubmit}
                className={`flex-1 py-2.5 text-xs font-black rounded-lg ${
                  canAct
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
          categoryScope={batchShippingCategoryScope}
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
            void closeBatchShippingModal();
          }}
          onSubmit={handleBatchShippingBeforeOrder}
        />
      )}

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          allowEdit={canAct}
          editableStatuses={['PENDING', 'ACCEPTED']}
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
