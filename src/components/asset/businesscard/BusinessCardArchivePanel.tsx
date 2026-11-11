'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { resolveInterfaceEditState, isSystemLv1User } from '@/lib/permission-utils';
import { getKSTNowYearMonth } from '@/utils/dateUtils';
import {
  BUSINESS_CARD_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';
import { stripBusinessCardEnPlus } from '@/lib/businesscard-phone';
import { writeBusinessCardOrderExcelBuffer } from '@/lib/businesscard-order-excel';
import { collectDescendantUnitNames, rowMatchesOrgUnit } from '@/lib/org-unit-match';
import WindowedPagination from '@/components/common/WindowedPagination';

const MENU_PATH = '/asset/businesscard/master/archive';
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none hover:bg-slate-100';

interface RequestItem {
  id: string;
  postNumber: string;
  userName: string;
  applyDate?: string;
  deptHead: string;
  deptName: string;
  unitId?: string | null;
  title: string;
  quantity: number;
  adminStatus: string;
  proofFileName?: string | null;
  proofUploadedAt?: string | null;
  proofConfirmedAt?: string | null;
  proofConfirmedBy?: string | null;
  applicantType?: string | null;
  applicantName?: string | null;
  additionalKo?: string | null;
  zipCode?: string | null;
  addressKo?: string | null;
  mobile?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  userNameEn?: string | null;
  deptHeadEn?: string | null;
  deptNameEn?: string | null;
  titleEn?: string | null;
  additionalEn?: string | null;
  addressEn?: string | null;
  mobileEn?: string | null;
  phoneEn?: string | null;
  faxEn?: string | null;
  emailEn?: string | null;
}

interface InspectSnapshot {
  itemPrice?: Record<string, number>;
  details?: Array<{ id?: string; docPrice?: number }>;
}

interface ArchivedBatch {
  id: string;
  orderDate: string;
  /** 외주 발주완료일 (YYYY-MM-DD) */
  dispatchedDate?: string | null;
  deptHeadGroup: string;
  totalCount: number;
  status: string;
  items: RequestItem[];
  displayItems?: RequestItem[];
  inspectResult?: InspectSnapshot | null;
}

/** 보관함 기간 필터·표시용 — 발주완료일 우선, 없으면 발주생성일 */
function archiveDateKey(batch: ArchivedBatch): string {
  return String(batch.dispatchedDate || batch.orderDate || '').trim();
}

function formatBatchNo(id: string) {
  return String(id || '').replace(/^BATCH-/, 'PO-BC-');
}

interface UnitItem {
  id: string;
  unit_name: string;
  unit_name_en?: string;
  unit_type?: string;
  parent_id: string | null;
  sort_order?: number;
}

function isBoldOrgType(unitType?: string | null) {
  const t = String(unitType || '').trim().toUpperCase();
  return t === 'ORGANIZATION' || t === 'HQ';
}

function flattenUnitsInSortOrder(units: UnitItem[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depthOf = (unit: UnitItem) => {
    let depth = 0;
    let current: UnitItem | undefined = unit;
    const seen = new Set<string>();
    while (current?.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parent_id);
    }
    return depth;
  };
  return [...units]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((unit) => ({ ...unit, depth: depthOf(unit) }));
}

function displayDeptName(
  item: { unitId?: string | null; deptName?: string | null },
  units: UnitItem[]
) {
  const uid = String(item.unitId || '').trim();
  if (uid && units.length) {
    const u = units.find((x) => x.id === uid);
    if (u?.unit_name) return u.unit_name;
  }
  return String(item.deptName || '').trim();
}

function itemMatchesOrg(item: RequestItem, orgId: string, units: UnitItem[]) {
  return rowMatchesOrgUnit({
    selectedOrgId: orgId,
    units,
    unitId: item.unitId,
    legacyNames: [item.deptName, item.deptHead],
  });
}

function breakdownGroupKey(item: RequestItem, selected: UnitItem | null, units: UnitItem[]) {
  if (!selected) return String(item.deptHead || item.deptName || '-').trim() || '-';
  const children = units
    .filter((u) => u.parent_id === selected.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (children.length === 0) return selected.unit_name;
  const head = String(item.deptHead || '').trim();
  const center = String(item.deptName || '').trim();
  for (const child of children) {
    const names = collectDescendantUnitNames(child.id, units);
    if (names.has(head) || names.has(center)) return child.unit_name;
  }
  return selected.unit_name;
}

/** 검수 단가 없으면 null (추정 단가 금지) */
function itemInspectPrice(batch: ArchivedBatch, item: RequestItem): number | null {
  const mapped = batch.inspectResult?.itemPrice?.[item.id];
  if (mapped != null && Number.isFinite(Number(mapped))) return Number(mapped);
  const detail = batch.inspectResult?.details?.find((d) => d.id === item.id);
  if (detail?.docPrice != null && Number.isFinite(Number(detail.docPrice))) return Number(detail.docPrice);
  return null;
}

function formatPriceWon(price: number | null) {
  if (price == null) return '-';
  return `₩${price.toLocaleString()}`;
}

/** 묶음 시안확인 상태: 시안확인대기 → 확정대기 → 확정완료 */
function getBatchProofStatus(
  batch: ArchivedBatch,
  items?: RequestItem[]
): '시안확인대기' | '확정대기' | '확정완료' {
  const list = items || batch.items || [];
  if (list.length === 0) return '시안확인대기';
  const allUploaded = list.every((it) => Boolean(it.proofFileName));
  if (!allUploaded) return '시안확인대기';
  const allConfirmed = list.every((it) => Boolean(it.proofConfirmedAt));
  if (!allConfirmed) return '확정대기';
  return '확정완료';
}

function patchBatchItemProof(
  batches: ArchivedBatch[],
  itemId: string,
  patch: Partial<RequestItem>
) {
  return batches.map((b) => ({
    ...b,
    items: (b.items || []).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
  }));
}

function sumKnownPrices(batch: ArchivedBatch, items: RequestItem[] | undefined) {
  let sum = 0;
  let known = 0;
  for (const item of items || []) {
    const p = itemInspectPrice(batch, item);
    if (p == null) continue;
    sum += p;
    known += 1;
  }
  return { sum, known };
}

export default function BusinessCardArchivePanel() {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(BUSINESS_CARD_MASTER_TABS, '/asset/businesscard/master');
  const [archivedBatches, setArchivedBatches] = useState<ArchivedBatch[]>([]);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
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

  const [yearFilter, setYearFilter] = useState(() => String(getKSTNowYearMonth().year));
  const [monthFilter, setMonthFilter] = useState('ALL');
  const [orgFilter, setOrgFilter] = useState('ALL');
  const [nameSearch, setNameSearch] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  const isLV1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : [currentUser.role];
    return roles?.some((r: any) => String(r).includes('LV_1')) || currentUser.permissionLevel === 'LV_1';
  }, [currentUser]);
  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
  const [deletingBulk, setDeletingBulk] = useState(false);
  const proofFileInputRef = useRef<HTMLInputElement>(null);
  const [proofUploadTargetId, setProofUploadTargetId] = useState<string | null>(null);
  const [proofUploadingId, setProofUploadingId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<RequestItem | null>(null);

  const openProofUpload = (itemId: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    setProofUploadTargetId(itemId);
    window.setTimeout(() => proofFileInputRef.current?.click(), 0);
  };

  const handleProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const requestId = proofUploadTargetId;
    setProofUploadTargetId(null);
    if (!file || !requestId) return;
    if (!canEditMaster) return alertNoEditPermission();

    setProofUploadingId(requestId);
    try {
      const fd = new FormData();
      fd.append('requestId', requestId);
      fd.append('file', file);
      const res = await fetch('/api/asset/businesscard/proof', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '시안 업로드에 실패했습니다.');
        return;
      }
      setArchivedBatches((prev) =>
        patchBatchItemProof(prev, requestId, {
          proofFileName: data.proofFileName || file.name,
          proofUploadedAt: data.proofUploadedAt || new Date().toISOString(),
          proofConfirmedAt: null,
          proofConfirmedBy: null,
        })
      );
      alert(data.message || '시안이 업로드되었습니다.');
    } catch {
      alert('시안 업로드 중 오류가 발생했습니다.');
    } finally {
      setProofUploadingId(null);
    }
  };

  const handleProofDownloadAdmin = (itemId: string, fileName?: string | null) => {
    const a = document.createElement('a');
    a.href = `/api/asset/businesscard/proof?id=${encodeURIComponent(itemId)}&download=1`;
    a.download = fileName || '시안';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleAdminProofConfirm = async (item: RequestItem) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!item.proofFileName) {
      return alert('업로드된 시안이 없습니다. 먼저 시안을 업로드해 주세요.');
    }
    if (item.proofConfirmedAt) {
      return alert('이미 시안이 확정되었습니다.');
    }
    if (
      !confirm(
        `[${item.postNumber}] ${item.userName || ''} 님 시안을 관리자 권한으로 확정할까요?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/asset/businesscard/proof', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '시안 확정에 실패했습니다.');
        return;
      }
      setArchivedBatches((prev) =>
        patchBatchItemProof(prev, item.id, {
          proofConfirmedAt: data.proofConfirmedAt || new Date().toISOString(),
          proofConfirmedBy: data.proofConfirmedBy || null,
        })
      );
      alert(data.message || '시안이 확정되었습니다.');
    } catch {
      alert('시안 확정 중 오류가 발생했습니다.');
    }
  };

  useEffect(() => {
    const fetchArchivedData = async () => {
      try {
        const ts = Date.now();
        const [res, meRes, ifRes, summaryRes, unitRes] = await Promise.all([
          fetch(`/api/asset/businesscard/master/order?isArchived=true&t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
            cache: 'no-store',
          }).catch(() => null),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (res.ok) {
          const data = await res.json();
          setArchivedBatches(data);
        }
        if (unitRes && unitRes.ok) {
          const raw = await unitRes.json();
          setUnits(Array.isArray(raw) ? raw : []);
        } else setUnits([]);
        if (meRes && meRes.ok) setCurrentUser(await meRes.json());
        if (ifRes && ifRes.ok) {
          const interfaces = await ifRes.json();
          const menu = Array.isArray(interfaces)
            ? interfaces.find(
                (m: any) =>
                  m.path === MENU_PATH || m.path?.includes('/businesscard/master/archive')
              )
            : null;
          setInterfaceConfig(menu || null);
        } else {
          setInterfaceConfig(null);
        }
        if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
        else setPermissionSummary(null);
      } catch (error) {
        console.error('보관함 데이터 로딩 실패:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchArchivedData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedBatchIds(new Set());
  }, [yearFilter, monthFilter, orgFilter, nameSearch]);

  useEffect(() => {
    if (!orgMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setOrgMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOrgMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [orgMenuOpen]);

  const availableYears = useMemo(() => {
    const years = archivedBatches
      .map((b) => archiveDateKey(b).substring(0, 4))
      .filter((y) => y.length === 4);
    const current = String(getKSTNowYearMonth().year);
    return Array.from(new Set([current, ...years])).sort((a, b) => b.localeCompare(a));
  }, [archivedBatches]);

  const afterYearList = useMemo(() => {
    if (yearFilter === 'ALL') return archivedBatches;
    return archivedBatches.filter((b) => archiveDateKey(b).startsWith(yearFilter));
  }, [archivedBatches, yearFilter]);

  const availableMonths = useMemo(() => {
    const months = afterYearList
      .map((b) => archiveDateKey(b).substring(5, 7))
      .filter(Boolean);
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [afterYearList]);

  const afterPeriodList = useMemo(() => {
    if (monthFilter === 'ALL') return afterYearList;
    return afterYearList.filter((b) => archiveDateKey(b).substring(5, 7) === monthFilter);
  }, [afterYearList, monthFilter]);

  const orgOptions = useMemo(() => flattenUnitsInSortOrder(units), [units]);
  const organizationUnit = useMemo(
    () => orgOptions.find((u) => String(u.unit_type || '').trim().toUpperCase() === 'ORGANIZATION') || null,
    [orgOptions]
  );
  const selectedOrg = orgOptions.find((u) => u.id === orgFilter) || (orgFilter === 'ALL' ? organizationUnit : null) || null;

  useEffect(() => {
    if (orgFilter !== 'ALL' || !organizationUnit) return;
    setOrgFilter(organizationUnit.id);
  }, [orgFilter, organizationUnit]);

  const processedBatches = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    return afterPeriodList
      .map((b) => ({
        ...b,
        displayItems: (b.items || []).filter((item) => {
          if (!itemMatchesOrg(item, orgFilter, units)) return false;
          if (q && !String(item.userName || '').toLowerCase().includes(q)) return false;
          return true;
        }),
      }))
      .filter((b) => (b.displayItems || []).length > 0);
  }, [afterPeriodList, orgFilter, nameSearch, units]);

  const totalPages = Math.ceil(processedBatches.length / itemsPerPage) || 1;
  const paginatedBatches = processedBatches.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  let totalQty = 0;
  let totalCalculatedPrice = 0;
  let totalPriceKnown = 0;
  const deptStatsMap: Record<string, { qty: number; price: number; priceKnown: number }> = {};

  processedBatches.forEach((batch) => {
    batch.displayItems?.forEach((item) => {
      const q = item.quantity || 1;
      const price = itemInspectPrice(batch, item);
      totalQty += q;
      const dept = breakdownGroupKey(item, selectedOrg, units);
      if (!deptStatsMap[dept]) deptStatsMap[dept] = { qty: 0, price: 0, priceKnown: 0 };
      deptStatsMap[dept].qty += q;
      if (price != null) {
        totalCalculatedPrice += price;
        totalPriceKnown += 1;
        deptStatsMap[dept].price += price;
        deptStatsMap[dept].priceKnown += 1;
      }
    });
  });

  const handleListExcelDownload = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    const targets =
      selectedBatchIds.size > 0
        ? processedBatches.filter((b) => selectedBatchIds.has(b.id))
        : processedBatches;
    const items = targets.flatMap((batch) => batch.displayItems || batch.items || []);
    if (items.length === 0) return alert('내려받을 내역이 없습니다.');
    try {
      const buffer = await writeBusinessCardOrderExcelBuffer(items, {
        sheetName: '명함발주서',
      });
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        targets.length === 1
          ? `명함발주서_${formatBatchNo(targets[0].id)}.xlsx`
          : '명함발주서_보관함.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('명함 발주서 다운로드에 실패했습니다.');
    }
  };

  const pageBatchIds = paginatedBatches.map((b) => b.id);
  const allPageBatchesSelected =
    pageBatchIds.length > 0 && pageBatchIds.every((id) => selectedBatchIds.has(id));

  const handleSelectAllBatches = () => {
    // 테이블 헤더: 현재 페이지분만 토글
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (allPageBatchesSelected) pageBatchIds.forEach((id) => next.delete(id));
      else pageBatchIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleSelectBatchRow = (id: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDeleteLv1 = async () => {
    if (!isLV1) return alert('삭제는 LV_1만 가능합니다.');
    if (deletingBulk) return;
    const ids = Array.from(selectedBatchIds);
    if (ids.length === 0) return alert('삭제할 묶음을 체크박스로 선택해 주세요.');
    if (
      !confirm(
        `경고: 선택한 ${ids.length}건의 보관 묶음을 영구 삭제하시겠습니까?\n(묶음에 포함된 명함 신청 건도 함께 삭제됩니다.)`
      )
    ) {
      return;
    }

    setDeletingBulk(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const id of ids) {
        const res = await fetch(
          `/api/asset/businesscard/master/order?batchId=${encodeURIComponent(id)}&purge=1`,
          { method: 'DELETE' }
        );
        if (res.ok) ok += 1;
        else fail += 1;
      }
      alert(
        fail > 0
          ? `삭제 완료 ${ok}건 / 실패 ${fail}건`
          : `🗑️ ${ok}건 삭제되었습니다.`
      );
      setSelectedBatchIds(new Set());
      setExpandedBatchIds(new Set());
      const refresh = await fetch(
        `/api/asset/businesscard/master/order?isArchived=true&t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (refresh.ok) setArchivedBatches(await refresh.json());
    } catch {
      alert('일괄 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingBulk(false);
    }
  };

  /** 대상자 검색 시 매칭 묶음 하위 상세(아코디언) 자동 펼침 */
  useEffect(() => {
    const qUser = nameSearch.trim();
    if (!qUser) {
      setExpandedBatchIds(new Set());
      return;
    }
    const start = (currentPage - 1) * itemsPerPage;
    const pageIds = processedBatches
      .slice(start, start + itemsPerPage)
      .map((b) => b.id);
    setExpandedBatchIds(new Set(pageIds));
  }, [nameSearch, currentPage, processedBatches, itemsPerPage]);

  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      <input
        ref={proofFileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.ai,.zip"
        onChange={handleProofFileChange}
      />
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-emerald-400 mb-2.5">
            BUSINESS CARD TOTAL GOVERNANCE
          </h3>
          <h1 className="text-2xl font-medium tracking-tight text-white leading-none">
            전사 임직원 명함 통합 관리 대장
          </h1>
          <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
            물품 지급 검수 및 거래명세표 대조가 완료된 명함 발주 건을 보관하고, 기간·조직별 누적 수량과 외주 정산 통계를 통합 조회하는 아카이브입니다.
          </p>
          {permissionSummary && isSystemLv1User(currentUser) && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
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

      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            return (
              <Link
                key={tab.id}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${
                  isActive
                    ? `bg-white ${tab.activeColor || 'text-indigo-600'} shadow-sm border border-slate-200/80`
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-medium px-3 hidden sm:block">
          ※ 탭을 클릭하여 신청현황·외주발주·보관함을 전환합니다.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-3 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-slate-100 pb-2">
          <h2 className="text-base font-medium text-slate-800 whitespace-nowrap">🗄️ 과거 발주 및 지급 완료 묶음 결산 이력</h2>
          <p className="text-xs text-slate-500">
            아래 표의 연도·월·조직·대상자 검색에 맞춰 수량과 금액이 바로 집계됩니다.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(200px,15.5rem)_minmax(0,1fr)] gap-3 items-stretch">
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col justify-center min-h-[64px]">
            <h3 className="text-slate-400 text-[9px] font-medium tracking-widest mb-1.5">TOTAL SUMMARY</h3>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-medium text-slate-500 whitespace-nowrap">총 발주 수량</span>
                <span className="text-lg font-medium text-slate-800 font-mono tabular-nums">
                  {totalQty}
                  <span className="text-xs font-medium text-slate-500 ml-0.5">통</span>
                </span>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-medium text-slate-500 whitespace-nowrap">외주 정산 총액</span>
                <span className="text-lg font-medium text-indigo-600 font-mono tabular-nums tracking-tight">
                  {totalPriceKnown > 0 ? `₩${totalCalculatedPrice.toLocaleString()}` : '-'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 flex flex-col shadow-sm min-h-[64px] min-w-0">
            <div className="bg-slate-50/90 px-3 py-1 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="text-slate-500 text-[10px] font-medium tracking-widest">조직별 조회</h3>
              <span className="text-[10px] font-medium text-slate-400 bg-slate-200/50 px-1.5 py-0.5 rounded">
                {Object.keys(deptStatsMap).length}개 조직
              </span>
            </div>
            <div className="px-2 py-1.5">
              {Object.keys(deptStatsMap).length === 0 ? (
                <p className="text-slate-400 text-xs text-center py-1 font-medium">조건에 맞는 데이터가 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(deptStatsMap)
                    .sort((a, b) => {
                      const orderOf = (name: string) => {
                        const unit = units.find((u) => u.unit_name === name);
                        return unit?.sort_order ?? Number.MAX_SAFE_INTEGER;
                      };
                      const byOrder = orderOf(a[0]) - orderOf(b[0]);
                      if (byOrder !== 0) return byOrder;
                      return b[1].qty - a[1].qty;
                    })
                    .map(([dept, data]) => (
                      <div
                        key={dept}
                        title={dept}
                        className="inline-flex items-center gap-1.5 border border-slate-200 bg-white rounded-md px-2.5 py-1 text-xs"
                      >
                        <span className="font-medium text-slate-700 truncate max-w-[140px]">{dept}</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-500 tabular-nums whitespace-nowrap">{data.qty}통</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-medium text-indigo-600 font-mono tabular-nums whitespace-nowrap">
                          {data.priceKnown > 0 ? `₩${data.price.toLocaleString()}` : '-'}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={`bg-white border border-indigo-200 rounded-lg shadow-sm ${orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
        <div className={`p-4 px-6 bg-indigo-50 border-b border-indigo-200 flex flex-wrap items-center justify-between gap-4 relative ${orgMenuOpen ? 'z-[80] overflow-visible' : ''}`}>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0" />
            <h2 className="text-sm font-medium text-slate-800 tracking-tight">명세대조 완료 보관함 대장</h2>
            <span className="text-[11px] font-medium bg-indigo-200/80 text-indigo-800 px-2 py-0.5 rounded-md">{processedBatches.length}건</span>
          </div>
          <div className={`flex items-center gap-2 flex-wrap ml-auto ${orgMenuOpen ? 'relative z-[90] overflow-visible' : ''}`}>
            {isLV1 && (
              <button
                type="button"
                disabled={selectedBatchIds.size === 0 || deletingBulk}
                onClick={handleBulkDeleteLv1}
                title="체크한 보관 묶음을 영구 삭제 (LV_1 전용)"
                className="h-7 px-2.5 rounded-lg text-[10px] font-medium border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {deletingBulk
                  ? '삭제중…'
                  : selectedBatchIds.size > 0
                    ? `삭제(LV_1) ${selectedBatchIds.size}`
                    : '삭제(LV_1)'}
              </button>
            )}
            <div className={`relative group/filter flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-indigo-200 shadow-sm h-7 box-border ${orgMenuOpen ? 'relative z-[90]' : ''}`}>
              <span
                role="tooltip"
                className={`pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-medium text-white shadow-lg ${orgMenuOpen ? '' : 'group-hover/filter:block'}`}
              >
                연도 → 월 · 연계필터 / 조직은 마스터 정렬
              </span>
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">연도</span>
              <select
                value={yearFilter}
                onChange={(e) => {
                  setYearFilter(e.target.value);
                  setMonthFilter('ALL');
                }}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">월별</span>
              <select
                value={monthFilter}
                onChange={(e) => {
                  setMonthFilter(e.target.value);
                }}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{parseInt(month, 10)}월</option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">조직</span>
              <div className="relative inline-flex items-center" ref={orgMenuRef}>
                <button
                  type="button"
                  onClick={() => setOrgMenuOpen((open) => !open)}
                  className="max-w-[220px] truncate text-left text-[11px] font-medium text-slate-800 leading-none py-0 px-0 m-0 h-4 inline-flex items-center border-0 appearance-none outline-none cursor-pointer bg-transparent"
                >
                  {selectedOrg ? selectedOrg.unit_name : organizationUnit?.unit_name || '조직 선택'}
                </button>
                {orgMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 z-[100] min-w-[240px] max-h-72 overflow-y-auto bg-white border border-indigo-200 rounded-lg shadow-xl py-1">
                    {orgOptions.map((dept) => {
                      const bold = isBoldOrgType(dept.unit_type);
                      return (
                        <button
                          key={dept.id}
                          type="button"
                          onClick={() => {
                            setOrgFilter(dept.id);
                            setOrgMenuOpen(false);
                          }}
                          className={`w-full text-left pr-3 py-1.5 text-[11px] ${
                            bold ? 'font-medium text-slate-900' : 'font-medium text-slate-600'
                          } ${orgFilter === dept.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                          style={{ paddingLeft: `${12 + dept.depth * 12}px` }}
                        >
                          {dept.unit_name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="relative w-32 h-7">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] leading-none pointer-events-none">👤</span>
              <input
                type="text"
                placeholder="대상자 검색..."
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-indigo-200 rounded-lg text-[11px] font-medium outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
            <button
              type="button"
              disabled={!canEditMaster}
              title={!canEditMaster ? '편집 권한 필요' : undefined}
              onClick={handleListExcelDownload}
              className={`h-7 px-3 rounded-lg text-[10px] font-medium shadow-sm transition-all whitespace-nowrap leading-none ${
                canEditMaster
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : DISABLED_ACTION_BTN
              }`}
            >
              {selectedBatchIds.size > 0
                ? `선택 발주서 다운로드(${selectedBatchIds.size})`
                : '발주서 엑셀 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left border-collapse">
            <colgroup>
              <col style={{ width: '40px' }} />
              <col style={{ width: '40px' }} />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead className="bg-indigo-100 text-indigo-900 text-[10px] font-medium uppercase tracking-widest border-b border-indigo-200">
              <tr>
                <th className="h-12 px-2 text-center">
                  <input
                    type="checkbox"
                    title="현재 페이지(최대 10건)만 선택"
                    onChange={handleSelectAllBatches}
                    checked={allPageBatchesSelected}
                    className="w-3 h-3 accent-indigo-600 cursor-pointer"
                  />
                </th>
                <th className="h-12 px-1 text-center">NO</th>
                <th className="h-12 px-2 text-center">묶음 번호</th>
                <th className="h-12 px-2 text-center">발주완료일</th>
                <th className="h-12 px-2 text-center">신청 상세</th>
                <th className="h-12 px-2 text-center">
                  <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                    <span className="whitespace-nowrap">원문</span>
                    <span className="text-[10px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                      (Edit)
                    </span>
                  </div>
                </th>
                <th className="h-12 px-2 text-center">
                  <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                    <span className="whitespace-nowrap">시안확인</span>
                    <span className="text-[10px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                      (Edit)
                    </span>
                  </div>
                </th>
                <th className="h-12 px-2 text-center">정산 금액</th>
                <th className="h-12 px-2 text-center">상태</th>
              </tr>
            </thead>
            <tbody className="bg-white text-xs font-medium text-slate-900 divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={9} className="p-16 text-center text-slate-400 text-xs">데이터를 불러오는 중입니다...</td></tr>
              ) : paginatedBatches.length === 0 ? (
                <tr><td colSpan={9} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 보관 내역이 없습니다.</td></tr>
              ) : (
                paginatedBatches.map((batch, index) => {
                  const rowNo = processedBatches.length - ((currentPage - 1) * itemsPerPage + index);
                  const displayItems = batch.displayItems || [];
                  const batchCount = displayItems.length;
                  const batchQty = displayItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
                  const { sum: batchPriceSum, known: batchPriceKnown } = sumKnownPrices(batch, batch.displayItems);
                  return (
                    <React.Fragment key={batch.id}>
                      <tr
                        className={`h-16 hover:bg-indigo-50/40 transition-colors ${selectedBatchIds.has(batch.id) ? 'bg-indigo-50/50' : ''}`}
                      >
                        <td className="px-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.has(batch.id)}
                            onChange={(e) => handleSelectBatchRow(batch.id, e)}
                            className="w-3 h-3 accent-indigo-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-1 text-center font-mono text-slate-900 tabular-nums">{rowNo}</td>
                        <td
                          className="px-2 text-center font-mono text-slate-900 cursor-pointer whitespace-nowrap tabular-nums truncate overflow-hidden"
                          title={formatBatchNo(batch.id)}
                          onClick={() => toggleBatchExpand(batch.id)}
                        >
                          {formatBatchNo(batch.id)}
                        </td>
                        <td className="px-2 text-center text-slate-900 font-mono tabular-nums">
                          {batch.dispatchedDate || '-'}
                        </td>
                        <td
                          className="px-2 text-center cursor-pointer"
                          onClick={() => toggleBatchExpand(batch.id)}
                        >
                          <span className="text-slate-700 underline underline-offset-2 whitespace-nowrap">
                            상세보기({batchCount}건/{batchQty}통)
                          </span>
                          {(() => {
                            const names = Array.from(new Set(batch.displayItems?.map((i) => i.userName).filter(Boolean)));
                            if (names.length === 0) return null;
                            const label = names.join(', ');
                            return (
                              <p className="text-[10px] text-slate-400 mt-0.5 truncate text-center" title={label}>
                                {label}
                              </p>
                            );
                          })()}
                        </td>
                        <td className="px-2 text-center text-slate-300">—</td>
                        <td
                          className="px-2 text-center cursor-pointer"
                          onClick={() => toggleBatchExpand(batch.id)}
                          title="클릭하면 상세에서 시안 확인"
                        >
                          {(() => {
                            const proofStatus = getBatchProofStatus(batch, displayItems);
                            const cls =
                              proofStatus === '확정완료'
                                ? 'text-slate-700'
                                : proofStatus === '확정대기'
                                  ? 'text-amber-600'
                                  : 'text-slate-500';
                            return (
                              <span className={`font-medium whitespace-nowrap ${cls}`}>
                                {proofStatus}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-2 text-center font-mono tabular-nums text-slate-900">
                          {batchPriceKnown > 0 ? `₩${batchPriceSum.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-2 text-center">
                          <span className="font-medium whitespace-nowrap text-slate-900">명세대조완료</span>
                        </td>
                      </tr>
                      {expandedBatchIds.has(batch.id) && (
                        <tr className="bg-slate-200/90 text-slate-700 text-[10px] font-medium tracking-wide border-y border-slate-300">
                          <td className="h-9 px-2 text-center border-l-4 border-l-blue-500 bg-slate-200/90">NO</td>
                          <td className="h-9 px-1 text-center text-slate-400">—</td>
                          <td className="h-9 px-2 text-center whitespace-nowrap">관리번호</td>
                          <td className="h-9 px-2 text-center whitespace-nowrap">신청일</td>
                          <td className="h-9 px-2 text-center whitespace-nowrap">신청주체 / 부서·이름</td>
                          <td className="h-9 px-2 text-center whitespace-nowrap">원문확인</td>
                          <td className="h-9 px-2 text-center whitespace-nowrap">시안확인</td>
                          <td className="h-9 px-2 text-center whitespace-nowrap">정산액</td>
                          <td className="h-9 px-2 text-center text-slate-400">—</td>
                        </tr>
                      )}
                      {expandedBatchIds.has(batch.id) &&
                        displayItems.map((item, idx) => {
                          const deptLabel =
                            displayDeptName(item, units) ||
                            String(item.deptHead || '').trim() ||
                            '-';
                          return (
                            <tr
                              key={item.id}
                              className="h-12 bg-slate-50/80 hover:bg-slate-100/80 text-[11px] font-medium text-slate-700 border-y border-slate-200"
                            >
                              <td className="px-2 text-center border-l-4 border-l-blue-500 bg-slate-100/70">
                                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                                  {idx + 1}
                                </span>
                              </td>
                              <td className="px-1 text-center text-slate-300 bg-slate-50/80">—</td>
                              <td
                                className="px-2 text-center font-mono text-slate-900 tabular-nums truncate bg-slate-50/80"
                                title={item.postNumber}
                              >
                                {item.postNumber}
                              </td>
                              <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800 bg-slate-50/80">
                                {item.applyDate || '-'}
                              </td>
                              <td
                                className="px-2 text-center min-w-0 bg-slate-50/80"
                                title={[item.deptHead, displayDeptName(item, units), item.title]
                                  .filter(Boolean)
                                  .join(' · ')}
                              >
                                <span className="text-[10px] font-medium whitespace-nowrap block">
                                  {item.applicantType === '관리자대행' ? (
                                    <span className="text-indigo-700">관리자대행</span>
                                  ) : (
                                    <span className="text-slate-500">본인</span>
                                  )}
                                  <span className="text-slate-300 mx-1">·</span>
                                  <span className="text-slate-500">{deptLabel}</span>
                                </span>
                                <span className="text-slate-800 block truncate">
                                  {item.userName || '-'}
                                  <span className="text-[9px] font-medium text-slate-400 ml-1 tabular-nums">
                                    {item.quantity || 1}통
                                  </span>
                                </span>
                              </td>
                              <td className="px-2 text-center bg-slate-50/80">
                                <button
                                  type="button"
                                  disabled={!canEditMaster}
                                  title={!canEditMaster ? '편집 권한 필요' : '신청 원문 확인'}
                                  onClick={() => {
                                    if (!canEditMaster) return alertNoEditPermission();
                                    setDetailTarget(item);
                                  }}
                                  className={`px-2 py-1 text-[10px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                                    canEditMaster
                                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                                      : DISABLED_ACTION_BTN
                                  }`}
                                >
                                  원문보기
                                </button>
                              </td>
                              <td className="px-2 text-center bg-slate-50/80">
                                <div className="inline-flex flex-col items-center gap-1">
                                  {!item.proofFileName ? (
                                    <button
                                      type="button"
                                      disabled={!canEditMaster || proofUploadingId === item.id}
                                      title={!canEditMaster ? '편집 권한 필요' : '시안 파일 업로드'}
                                      onClick={() => {
                                        if (!canEditMaster) return alertNoEditPermission();
                                        openProofUpload(item.id);
                                      }}
                                      className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                        canEditMaster
                                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                                          : DISABLED_ACTION_BTN
                                      }`}
                                    >
                                      {proofUploadingId === item.id ? '업로드중…' : '시안업로드'}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={!canEditMaster}
                                      title={
                                        !canEditMaster
                                          ? '편집 권한 필요'
                                          : item.proofFileName || '시안 다운로드'
                                      }
                                      onClick={() => {
                                        if (!canEditMaster) return alertNoEditPermission();
                                        handleProofDownloadAdmin(item.id, item.proofFileName);
                                      }}
                                      className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                        canEditMaster
                                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                                          : DISABLED_ACTION_BTN
                                      }`}
                                    >
                                      다운로드
                                    </button>
                                  )}
                                  {item.proofConfirmedAt ? (
                                    <span
                                      className="text-[9px] font-medium text-slate-700 whitespace-nowrap"
                                      title={item.proofConfirmedBy || undefined}
                                    >
                                      확정
                                      <span className="text-slate-400 mx-0.5">·</span>
                                      {String(item.proofConfirmedBy || '').startsWith('관리자')
                                        ? '관리자'
                                        : '신청자'}
                                    </span>
                                  ) : item.proofFileName ? (
                                    <button
                                      type="button"
                                      disabled={!canEditMaster}
                                      title={
                                        !canEditMaster
                                          ? '편집 권한 필요'
                                          : '관리자가 시안을 직접 확정'
                                      }
                                      onClick={() => {
                                        if (!canEditMaster) return alertNoEditPermission();
                                        void handleAdminProofConfirm(item);
                                      }}
                                      className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                        canEditMaster
                                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                          : DISABLED_ACTION_BTN
                                      }`}
                                    >
                                      확정
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-2 text-center font-mono tabular-nums text-slate-800 bg-slate-50/80">
                                {formatPriceWon(itemInspectPrice(batch, item))}
                              </td>
                              <td className="px-2 text-center text-slate-300 bg-slate-50/80">—</td>
                            </tr>
                          );
                        })}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {processedBatches.length > 0 && (
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      {detailTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-medium text-blue-600 font-mono tracking-widest">
                  🔎 원문 확인
                </span>
                <h2 className="text-base font-medium text-slate-900 mt-1">
                  명함 신청 원문 확인 ({detailTarget.userName || '-'} 님)
                </h2>
                <p className="text-[10px] font-medium text-slate-400 mt-0.5 font-mono">
                  {detailTarget.postNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-medium text-sm transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <div className="space-y-2 border-r border-slate-200 pr-5 flex flex-col">
                <h3 className="text-xs font-medium text-slate-800 border-b pb-1.5">1. 국문 조판 데이터</h3>
                <div className="space-y-1.5 text-xs font-medium text-slate-600 flex-1">
                  <label className="block text-[10px] text-slate-400 mt-1">성명</label>
                  <p className="text-slate-900 font-medium">{detailTarget.userName || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">본부 (상위 조직)</label>
                  <p className="text-slate-900 font-medium">{detailTarget.deptHead || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">센터 (하위 조직)</label>
                  <p className="text-slate-900 font-medium">
                    {displayDeptName(detailTarget, units) || detailTarget.deptName || '-'}
                  </p>
                  <label className="block text-[10px] text-slate-400 mt-1">직책/직급</label>
                  <p className="text-slate-900 font-medium">{detailTarget.title || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">자격사항</label>
                  <p className="text-slate-900 font-medium">{detailTarget.additionalKo || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">휴대전화</label>
                  <p className="text-slate-900 font-mono font-medium">{detailTarget.mobile || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">내선전화</label>
                  <p className="text-slate-900 font-mono">{detailTarget.phone || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">이메일</label>
                  <p className="text-slate-900 font-mono">{detailTarget.email || '-'}</p>
                </div>
                <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                  <p className="text-[11px] font-medium text-slate-600 mb-1">
                    팩스: <span className="font-mono text-slate-900">{detailTarget.fax || '-'}</span>
                  </p>
                  <p className="text-[11px] font-medium text-slate-600 leading-relaxed">
                    주소:{' '}
                    <span className="text-slate-900">
                      [{detailTarget.zipCode || '-'}] {detailTarget.addressKo || '-'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="space-y-2 pl-1 flex flex-col">
                <h3 className="text-xs font-medium text-indigo-800 border-b border-indigo-100 pb-1.5">
                  2. 영문 조판 데이터
                </h3>
                <div className="space-y-1.5 text-xs font-medium text-slate-600 flex-1">
                  <label className="block text-[10px] text-slate-400 mt-1">영문 성명</label>
                  <p className="text-indigo-900 font-medium">{detailTarget.userNameEn || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">영문 본부</label>
                  <p className="text-indigo-900 font-medium">{detailTarget.deptHeadEn || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">영문 센터</label>
                  <p className="text-indigo-900 font-medium">{detailTarget.deptNameEn || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">영문 직책/직급</label>
                  <p className="text-indigo-900 font-medium">{detailTarget.titleEn || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">영문 자격사항</label>
                  <p className="text-indigo-900 font-medium">{detailTarget.additionalEn || '-'}</p>
                  <label className="block text-[10px] text-slate-400 mt-1">영문 휴대전화</label>
                  <p className="text-indigo-900 font-mono font-medium">
                    {stripBusinessCardEnPlus(detailTarget.mobileEn) || '-'}
                  </p>
                  <label className="block text-[10px] text-slate-400 mt-1">영문 내선전화</label>
                  <p className="text-indigo-900 font-mono">
                    {stripBusinessCardEnPlus(detailTarget.phoneEn) || '-'}
                  </p>
                  <label className="block text-[10px] text-slate-400 mt-1">영문 이메일</label>
                  <p className="text-indigo-900 font-mono">{detailTarget.emailEn || '-'}</p>
                </div>
                <div className="mt-4 p-3 bg-white rounded-xl border border-indigo-100">
                  <p className="text-[11px] font-medium text-slate-600 mb-1">
                    영문 팩스:{' '}
                    <span className="font-mono text-indigo-900">
                      {stripBusinessCardEnPlus(detailTarget.faxEn) || '-'}
                    </span>
                  </p>
                  <p className="text-[11px] font-medium text-slate-600 leading-relaxed">
                    영문 주소: <span className="text-indigo-900">{detailTarget.addressEn || '-'}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                className="px-5 py-2 text-xs font-medium rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
