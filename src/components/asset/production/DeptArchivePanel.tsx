'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  productionStatusLabel,
  productionStatusTextClass,
} from '@/lib/production-status';
import { isCustomerDirectShip, isVendorDispatched } from '@/lib/production-shipping';
import {
  buildJebonOrderExcelRows,
  buildOfficeSuppliesOrderExcelRows,
  buildPrintOrderExcelRows,
  buildSignOrderExcelRows,
} from '@/lib/production-sign-excel';

const DEPT_MENU_PATH = '/asset/production/dept-master/archive';
const MASTER_MENU_PATH = '/asset/production/master/dashboard';
const DEPT_API_PATH = '/api/asset/production/dept-master/archive';
const MASTER_API_PATH = '/api/asset/production/master/dashboard';
const BATCH_PAGE_SIZE = 10;
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none';

const HISTORY_CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

const CATEGORY_LABEL: Record<string, string> = {
  SIGN: '현판/명판/상패',
  JEBON: '제본',
  PRINT: '기타 제작물',
  OFFICE_SUPPLIES: '사무문구류',
};

type BatchItem = {
  id: string;
  postNumber: string;
  category: string;
  title: string;
  quantity: number;
  status: string;
  userName: string;
  deptName: string;
  deptHead?: string;
  createdAt: string;
  finalPrice?: number | null;
  options?: Record<string, unknown>;
};

type ArchiveBatch = {
  id: string;
  status: string;
  totalCount: number;
  totalQuantity: number;
  vendors: string[];
  depts?: string[];
  deptHeads?: string[];
  orderedAt: string | null;
  dispatchedAt?: string | null;
  archivedAt: string | null;
  items: BatchItem[];
};

type DeptArchivePanelProps = {
  /** dept: 부서 보관함 / master: 전사 마스터 대시보드 */
  variant?: 'dept' | 'master';
};

function formatQuantityUnit(item: BatchItem) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'OFFICE_SUPPLIES') return '건';
  if (item.category === 'PRINT') {
    const label = (item.options as any)?.printItemMasterInfo?.unitLabel;
    if (label) return String(label);
  }
  return 'EA';
}

function formatBatchNo(id: string) {
  return String(id || '').replace(/^BATCH-/, '');
}

function getBatchLabelKind(
  batch: ArchiveBatch,
  activeCategory: string
): 'sign' | 'jebon' | 'print' | 'office' | 'other' {
  if (activeCategory === 'SIGN') return 'sign';
  if (activeCategory === 'JEBON') return 'jebon';
  if (activeCategory === 'PRINT') return 'print';
  if (activeCategory === 'OFFICE_SUPPLIES') return 'office';
  const items = batch.items || [];
  if (items.length > 0 && items.every((i) => i.category === 'SIGN')) return 'sign';
  if (items.length > 0 && items.every((i) => i.category === 'JEBON')) return 'jebon';
  if (items.length > 0 && items.every((i) => i.category === 'PRINT')) return 'print';
  if (items.length > 0 && items.every((i) => i.category === 'OFFICE_SUPPLIES')) return 'office';
  return 'other';
}

function formatBatchDisplayName(batchId: string, kind: ReturnType<typeof getBatchLabelKind>) {
  const no = formatBatchNo(batchId);
  if (kind === 'sign') return `현판_${no}`;
  if (kind === 'jebon') return `제본_${no}`;
  if (kind === 'print') return `제작물_${no}`;
  if (kind === 'office') return `사무문구류_${no}`;
  return no;
}

function formatBatchExcelBaseName(
  batchId: string,
  opts?: { sign?: boolean; jebon?: boolean; print?: boolean; office?: boolean }
) {
  const no = formatBatchNo(batchId);
  if (opts?.sign) return `현판_발주서_${no}`;
  if (opts?.jebon) return `제본_발주서_${no}`;
  if (opts?.print) return `제작물_${no}`;
  if (opts?.office) return `사무문구류_${no}`;
  return `제작물_${no}`;
}

function batchLabelOpts(kind: 'sign' | 'jebon' | 'print' | 'office' | 'other') {
  if (kind === 'sign') return { sign: true as const };
  if (kind === 'jebon') return { jebon: true as const };
  if (kind === 'print') return { print: true as const };
  if (kind === 'office') return { office: true as const };
  return {};
}

function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput == null) return null;
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return {
    year: String(ym.year),
    month: String(ym.month).padStart(2, '0'),
  };
}

function getBatchReceiveSummary(batch: ArchiveBatch) {
  const items = batch.items || [];
  const direct = items.filter((i) => isCustomerDirectShip(i)).length;
  const received = items.filter((i) => i.status === PRODUCTION_STATUS.VERIFIED).length;
  return { direct, received, total: items.length };
}

function getStatementMatchState(batch: ArchiveBatch) {
  const items = batch.items || [];
  if (items.length === 0) return { allMatched: false };
  const matched = items.filter(
    (i) => i.finalPrice != null && Number.isFinite(Number(i.finalPrice))
  ).length;
  return { allMatched: matched === items.length };
}

export default function DeptArchivePanel({ variant = 'dept' }: DeptArchivePanelProps) {
  const isMaster = variant === 'master';
  const menuPath = isMaster ? MASTER_MENU_PATH : DEPT_MENU_PATH;
  const apiPath = isMaster ? MASTER_API_PATH : DEPT_API_PATH;

  const [batches, setBatches] = useState<ArchiveBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [activeCategory, setActiveCategory] = useState('SIGN');
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [searchTitleQuery, setSearchTitleQuery] = useState('');
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [detailItem, setDetailItem] = useState<BatchItem | null>(null);
  const [statementBatch, setStatementBatch] = useState<ArchiveBatch | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingStatement, setSavingStatement] = useState(false);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [archiveRes, meRes, ifaceRes] = await Promise.all([
        fetch(`${apiPath}?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);
      const data = await archiveRes.json().catch(() => ({}));
      if (!archiveRes.ok) {
        alert(data.error || data.message || '보관함 내역을 불러오지 못했습니다.');
        setBatches([]);
      } else {
        setBatches(Array.isArray(data.batches) ? data.batches : []);
      }
      if (meRes?.ok) setCurrentUser(await meRes.json());
      if (ifaceRes?.ok) {
        const menus = await ifaceRes.json();
        const row = Array.isArray(menus)
          ? menus.find((m: any) => m.path === menuPath)
          : null;
        setInterfaceConfig(row || null);
      }
    } catch {
      alert('서버와 통신할 수 없습니다.');
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, [apiPath, menuPath]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedBatchIds(new Set());
  }, [activeCategory, selectedYear, selectedMonth, selectedDept, searchUserQuery, searchTitleQuery]);

  const availableYears = useMemo(() => {
    const years = batches
      .map((b) => getKSTYearMonthParts(b.dispatchedAt || b.archivedAt || b.orderedAt)?.year)
      .filter((y): y is string => Boolean(y));
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const kstYear = String(getKSTNowYearMonth().year);
    if (!unique.includes(kstYear)) unique.unshift(kstYear);
    return unique;
  }, [batches]);

  const availableMonths = useMemo(() => {
    if (selectedYear === 'ALL') return [];
    const months = batches
      .filter(
        (b) =>
          getKSTYearMonthParts(b.dispatchedAt || b.archivedAt || b.orderedAt)?.year ===
          selectedYear
      )
      .map((b) => getKSTYearMonthParts(b.dispatchedAt || b.archivedAt || b.orderedAt)?.month)
      .filter((m): m is string => Boolean(m));
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [batches, selectedYear]);

  const availableDepts = useMemo(() => {
    const names = new Set<string>();
    for (const b of batches) {
      (b.depts || []).forEach((d) => names.add(d));
      (b.items || []).forEach((i) => {
        if (i.deptName) names.add(i.deptName);
      });
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [batches]);

  const filteredBatches = useMemo(() => {
    const qUser = searchUserQuery.trim().toLowerCase();
    const qTitle = searchTitleQuery.trim().toLowerCase();
    return batches.filter((batch) => {
      const items = batch.items || [];
      if (activeCategory !== 'ALL' && !items.some((i) => i.category === activeCategory)) {
        return false;
      }
      if (selectedDept !== 'ALL') {
        const deptHit =
          (batch.depts || []).includes(selectedDept) ||
          items.some((i) => i.deptName === selectedDept);
        if (!deptHit) return false;
      }
      const ym = getKSTYearMonthParts(batch.dispatchedAt || batch.archivedAt || batch.orderedAt);
      if (selectedYear !== 'ALL' && ym?.year !== selectedYear) return false;
      if (selectedMonth !== 'ALL' && ym?.month !== selectedMonth) return false;
      const matchUser =
        !qUser || items.some((i) => String(i.userName || '').toLowerCase().includes(qUser));
      const matchTitle =
        !qTitle || items.some((i) => String(i.title || '').toLowerCase().includes(qTitle));
      return matchUser && matchTitle;
    });
  }, [
    batches,
    activeCategory,
    selectedYear,
    selectedMonth,
    selectedDept,
    searchUserQuery,
    searchTitleQuery,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / BATCH_PAGE_SIZE));
  const pageBatches = useMemo(() => {
    const start = (currentPage - 1) * BATCH_PAGE_SIZE;
    return filteredBatches.slice(start, start + BATCH_PAGE_SIZE);
  }, [filteredBatches, currentPage]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  /** 대상자·제목 검색 시 매칭 묶음 하위 상세(아코디언) 자동 펼침 */
  useEffect(() => {
    const qUser = searchUserQuery.trim();
    const qTitle = searchTitleQuery.trim();
    if (!qUser && !qTitle) {
      setExpandedBatchIds(new Set());
      return;
    }
    const start = (currentPage - 1) * BATCH_PAGE_SIZE;
    const pageIds = filteredBatches
      .slice(start, start + BATCH_PAGE_SIZE)
      .map((b) => b.id);
    setExpandedBatchIds(new Set(pageIds));
  }, [searchUserQuery, searchTitleQuery, currentPage, filteredBatches]);

  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };
  const allPageBatchesSelected =
    pageBatches.length > 0 && pageBatches.every((b) => selectedBatchIds.has(b.id));

  const handleSelectAllBatches = () => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (allPageBatchesSelected) {
        pageBatches.forEach((b) => next.delete(b.id));
      } else {
        pageBatches.forEach((b) => next.add(b.id));
      }
      return next;
    });
  };

  const handleSelectBatchRow = (batchId: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const handleBatchExcel = (batch: ArchiveBatch) => {
    if (!canEdit) return alert('엑셀 저장 권한(Edit)이 없습니다.');

    const exportItems =
      activeCategory === 'ALL'
        ? batch.items
        : batch.items.filter((i) => i.category === activeCategory);

    if (exportItems.length === 0) {
      return alert('다운로드할 데이터가 없습니다.');
    }

    const allSign = exportItems.every((i) => i.category === 'SIGN');
    const allJebon = exportItems.every((i) => i.category === 'JEBON');
    const labelKind = getBatchLabelKind(batch, activeCategory);
    if (allSign || activeCategory === 'SIGN') {
      const signRows = buildSignOrderExcelRows(
        exportItems.map((r) => ({
          ...r,
          batchId: batch.id,
        }))
      );
      if (signRows.length === 0) {
        return alert('다운로드할 현판(SIGN) 데이터가 없습니다.');
      }
      const ws = XLSX.utils.json_to_sheet(signRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '현판상세');
      XLSX.writeFile(wb, `${formatBatchExcelBaseName(batch.id, { sign: true })}.xlsx`);
      return;
    }

    if (allJebon || activeCategory === 'JEBON') {
      const jebonRows = buildJebonOrderExcelRows(
        exportItems.map((r) => ({ ...r, batchId: batch.id }))
      );
      if (jebonRows.length === 0) {
        return alert('다운로드할 제본(JEBON) 데이터가 없습니다.');
      }
      const ws = XLSX.utils.json_to_sheet(jebonRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '제본발주');
      XLSX.writeFile(wb, `${formatBatchExcelBaseName(batch.id, { jebon: true })}.xlsx`);
      return;
    }

    const allPrint = exportItems.every((i) => i.category === 'PRINT');
    if (allPrint || activeCategory === 'PRINT') {
      const printRows = buildPrintOrderExcelRows(
        exportItems.map((r) => ({ ...r, batchId: batch.id }))
      );
      if (printRows.length === 0) {
        return alert('다운로드할 기타 제작물(PRINT) 데이터가 없습니다.');
      }
      const ws = XLSX.utils.json_to_sheet(printRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '기타제작발주');
      XLSX.writeFile(wb, `${formatBatchExcelBaseName(batch.id, { print: true })}.xlsx`);
      return;
    }

    const allOffice = exportItems.every((i) => i.category === 'OFFICE_SUPPLIES');
    if (allOffice || activeCategory === 'OFFICE_SUPPLIES') {
      const officeRows = buildOfficeSuppliesOrderExcelRows(
        exportItems.map((r) => ({ ...r, batchId: batch.id }))
      );
      if (officeRows.length === 0) {
        return alert('다운로드할 사무문구류 데이터가 없습니다.');
      }
      const ws = XLSX.utils.json_to_sheet(officeRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '사무문구발주');
      XLSX.writeFile(wb, `${formatBatchExcelBaseName(batch.id, { office: true })}.xlsx`);
      return;
    }

    const rows = exportItems.map((r, rowIdx) => ({
      NO: rowIdx + 1,
      관리번호: r.postNumber,
      신청일: getKSTDateString(r.createdAt),
      본부: r.deptHead || '',
      소속부서: r.deptName,
      신청자: r.userName,
      분류: CATEGORY_LABEL[r.category] || r.category,
      관리용제목: r.title,
      수량: `${r.quantity}${formatQuantityUnit(r)}`,
      외주업체: (r.options as any)?.vendor || '',
      상태: productionStatusLabel(r.status),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '제작발주');
    XLSX.writeFile(
      wb,
      `${formatBatchExcelBaseName(batch.id, batchLabelOpts(labelKind))}.xlsx`
    );
  };

  const openStatementModal = (batch: ArchiveBatch) => {
    const drafts: Record<string, string> = {};
    (batch.items || []).forEach((item) => {
      drafts[item.id] =
        item.finalPrice != null && Number.isFinite(Number(item.finalPrice))
          ? String(item.finalPrice)
          : '';
    });
    setPriceDrafts(drafts);
    setStatementBatch(batch);
  };

  const handleSaveStatementMatch = async () => {
    if (!statementBatch || !canEdit) return;
    const prices = (statementBatch.items || [])
      .map((item) => ({
        requestId: item.id,
        finalPrice: Number(String(priceDrafts[item.id] || '').replace(/,/g, '')),
      }))
      .filter((p) => Number.isFinite(p.finalPrice) && p.finalPrice >= 0);

    if (prices.length === 0) {
      return alert('저장할 단가를 입력해 주세요.');
    }

    setSavingStatement(true);
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'statement-match',
          batchId: statementBatch.id,
          prices,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '명세표 대조 저장에 실패했습니다.');
        return;
      }
      alert(data.message || '저장되었습니다.');
      setStatementBatch(null);
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setSavingStatement(false);
    }
  };

  return (
    <ArchivePanelShell isMaster={isMaster}>
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
            <div className="flex items-start gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-700 mt-1.5 shrink-0" />
              <div>
                <h2 className="text-sm font-black text-slate-800 tracking-tight">
                  {isMaster ? '전사 검수 완료 보관함' : '검수 완료 보관함'}
                </h2>
                <p className="text-[11px] text-slate-500 font-bold mt-1">
                  {isMaster
                    ? '각 부서에서 수령 완료 후 이관된 묶음 · 부서별 조회 · 정산 상태'
                    : '수령완료 묶음 보관 · 정산 상태 확인'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap ml-auto">
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
                {filteredBatches.length}묶음
              </span>
              <div className="relative flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border">
                <span className="text-[10px] font-black text-slate-400 uppercase leading-none">
                  연도
                </span>
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(e.target.value);
                    setSelectedMonth('ALL');
                  }}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
                >
                  <option value="ALL">전체</option>
                  {availableYears.map((year) => (
                    <option key={year} value={year}>
                      {year}년
                    </option>
                  ))}
                </select>
                <div className="w-px h-3 bg-slate-300 shrink-0" />
                <span className="text-[10px] font-black text-slate-400 uppercase leading-none">
                  월별
                </span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
                >
                  <option value="ALL">전체</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>
                      {parseInt(month, 10)}월
                    </option>
                  ))}
                </select>
              </div>
              {isMaster && (
                <div className="relative flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border">
                  <span className="text-[10px] font-black text-slate-400 uppercase leading-none">
                    부서
                  </span>
                  <select
                    value={selectedDept}
                    onChange={(e) => setSelectedDept(e.target.value)}
                    className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0 max-w-[140px]"
                  >
                    <option value="ALL">전체</option>
                    {availableDepts.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="relative w-32 h-7">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] leading-none pointer-events-none">
                  👤
                </span>
                <input
                  type="text"
                  placeholder="대상자 검색..."
                  value={searchUserQuery}
                  onChange={(e) => setSearchUserQuery(e.target.value)}
                  className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-indigo-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
              <div className="relative w-36 h-7">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] leading-none pointer-events-none">
                  📝
                </span>
                <input
                  type="text"
                  placeholder="제목 검색..."
                  value={searchTitleQuery}
                  onChange={(e) => setSearchTitleQuery(e.target.value)}
                  className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-indigo-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto min-h-[360px]">
            {loading ? (
              <LoadingState />
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-indigo-100 text-indigo-900 text-[10px] font-black uppercase tracking-widest border-b border-indigo-200">
                  <tr>
                    <th className="h-12 px-4 w-[50px]">
                      <input
                        type="checkbox"
                        onChange={handleSelectAllBatches}
                        checked={allPageBatchesSelected}
                        className="w-3 h-3 accent-indigo-600 cursor-pointer"
                      />
                    </th>
                    <th className="h-12 px-2 w-[48px] text-center">NO</th>
                    <th className="h-12 px-2 min-w-[280px] whitespace-nowrap">묶음 번호</th>
                    <th className="h-12 px-4 w-[120px] text-center">발주 생성일</th>
                    <th className="h-12 px-4 min-w-[140px]">외주업체</th>
                    <th className="h-12 px-4 text-center w-[80px]">총 수량</th>
                    <th className="h-12 px-4 min-w-[120px]">신청 상세</th>
                    <th className="h-12 px-2 text-center w-[120px]">발주서(엑셀)</th>
                    <th className="h-12 px-2 text-center min-w-[128px]">수령 검수</th>
                    <th className="h-12 px-2 text-center w-[140px]">정산 상태</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                  {filteredBatches.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-16 text-center text-slate-400 text-[11px] font-bold">
                        보관된 묶음이 없습니다. 검수 탭에서 수령완료 후 보관함 이동해 주세요.
                      </td>
                    </tr>
                  ) : (
                    pageBatches.map((batch, idx) => {
                      const kind = getBatchLabelKind(batch, activeCategory);
                      const expanded = expandedBatchIds.has(batch.id);
                      const receive = getBatchReceiveSummary(batch);
                      const match = getStatementMatchState(batch);
                      const rowNo =
                        filteredBatches.length -
                        ((currentPage - 1) * BATCH_PAGE_SIZE + idx);
                      return (
                        <React.Fragment key={batch.id}>
                          <tr
                            className={`h-16 transition-colors ${
                              selectedBatchIds.has(batch.id)
                                ? 'bg-indigo-50/50'
                                : 'hover:bg-indigo-50/40'
                            }`}
                          >
                            <td className="px-4 text-center">
                              <input
                                type="checkbox"
                                checked={selectedBatchIds.has(batch.id)}
                                onChange={() => handleSelectBatchRow(batch.id)}
                                className="w-3 h-3 accent-indigo-600 cursor-pointer"
                              />
                            </td>
                            <td className="px-2 text-center font-mono text-slate-500 tabular-nums">
                              {rowNo}
                            </td>
                            <td
                              className="px-2 font-mono text-indigo-600 cursor-pointer whitespace-nowrap tabular-nums"
                              onClick={() => toggleBatchExpand(batch.id)}
                            >
                              {formatBatchDisplayName(batch.id, kind)}
                            </td>
                            <td className="px-4 text-center font-mono text-slate-800 tabular-nums whitespace-nowrap">
                              {batch.orderedAt
                                ? getKSTDateString(batch.orderedAt)
                                : batch.dispatchedAt
                                  ? getKSTDateString(batch.dispatchedAt)
                                  : '-'}
                            </td>
                            <td
                              className="px-4 text-slate-700 truncate max-w-[160px]"
                              title={(batch.vendors || []).join(', ') || ''}
                            >
                              {(batch.vendors || []).join(', ') || '-'}
                            </td>
                            <td className="px-4 text-center text-indigo-700 tabular-nums">
                              {batch.items?.length || 0} 건
                            </td>
                            <td
                              className="px-4 cursor-pointer"
                              onClick={() => toggleBatchExpand(batch.id)}
                            >
                              <span className="text-indigo-600 underline underline-offset-2">
                                상세보기
                              </span>
                            </td>
                            <td className="px-2 text-center">
                              <button
                                type="button"
                                disabled={!canEdit}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={() => handleBatchExcel(batch)}
                                className={`p-1.5 px-3 font-bold text-[10px] rounded-lg w-full ${
                                  canEdit
                                    ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                📊엑셀 저장
                              </button>
                            </td>
                            <td className="px-2 text-center">
                              {receive.direct === receive.total && receive.total > 0 ? (
                                <span className="text-[10px] font-bold text-indigo-600 whitespace-nowrap">
                                  고객사 직발송
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-600 whitespace-nowrap">
                                  수령 완료 {receive.received}/{receive.total}
                                </span>
                              )}
                            </td>
                            <td className="px-2 text-center">
                              <button
                                type="button"
                                disabled={!canEdit}
                                title={
                                  canEdit
                                    ? match.allMatched
                                      ? '정산 내역 확인·수정'
                                      : '정산 단가 입력'
                                    : '편집 권한 필요'
                                }
                                onClick={() => openStatementModal(batch)}
                                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold border whitespace-nowrap ${
                                  match.allMatched
                                    ? canEdit
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 cursor-not-allowed opacity-70'
                                    : canEdit
                                      ? 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                                      : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
                                }`}
                              >
                                {match.allMatched ? '정산 완료' : '정산 대기'}
                              </button>
                            </td>
                          </tr>

                          {expanded && (
                            <tr>
                              <td className="w-[50px] bg-indigo-50/60 border-b border-indigo-100" />
                              <td className="w-[48px] bg-indigo-50/60 border-b border-indigo-100" />
                              <td
                                colSpan={8}
                                className="bg-indigo-50/60 py-3 pr-4 pl-0 border-b border-indigo-100 border-l-4 border-l-indigo-400"
                              >
                                <div className="bg-white border border-indigo-100 rounded-2xl overflow-hidden shadow-sm">
                                  <table className="w-full text-left border-collapse">
                                    <thead className="bg-slate-50 text-slate-600 text-[10px] font-black tracking-widest border-b border-slate-200">
                                      <tr>
                                        <th className="h-10 px-2 w-[48px] text-center">NO</th>
                                        <th className="h-10 px-2 w-[110px] text-center whitespace-nowrap">
                                          관리번호
                                        </th>
                                        <th className="h-10 px-2 w-[96px] text-center whitespace-nowrap">
                                          신청일
                                        </th>
                                        <th className="h-10 px-2">본부 (상위 조직)</th>
                                        <th className="h-10 px-2">센터 (하위 조직)</th>
                                        <th className="h-10 px-2">대상자</th>
                                        <th className="h-10 px-2 text-center whitespace-nowrap">
                                          분류
                                        </th>
                                        <th className="h-10 px-2">관리용 제목</th>
                                        <th className="h-10 px-2 text-center w-[72px] whitespace-nowrap">
                                          수량
                                        </th>
                                        <th className="h-10 px-2 text-center w-[120px] whitespace-nowrap">
                                          원문 확인
                                        </th>
                                        <th className="h-10 px-2 text-center w-[120px] whitespace-nowrap">
                                          수령 검수
                                        </th>
                                        <th className="h-10 px-2 text-center w-[96px] whitespace-nowrap">
                                          상태
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                                      {(batch.items || []).map((item, idx) => (
                                        <tr
                                          key={item.id}
                                          className="h-12 hover:bg-slate-50/50 transition-colors"
                                        >
                                          <td className="px-2 text-center font-mono text-slate-500 tabular-nums">
                                            {idx + 1}
                                          </td>
                                          <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate">
                                            {item.postNumber}
                                          </td>
                                          <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                                            {getKSTDateString(item.createdAt)}
                                          </td>
                                          <td
                                            className="px-2 truncate"
                                            title={item.deptHead || ''}
                                          >
                                            {item.deptHead || '-'}
                                          </td>
                                          <td
                                            className="px-2 truncate"
                                            title={item.deptName || ''}
                                          >
                                            {item.deptName || (
                                              <span className="text-slate-300">-</span>
                                            )}
                                          </td>
                                          <td className="px-2 text-slate-800 truncate">
                                            {item.userName || '-'}
                                          </td>
                                          <td className="px-2 text-center">
                                            <span
                                              className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-tight border ${getProductionCategoryBadgeClass(item.category)}`}
                                            >
                                              {CATEGORY_LABEL[item.category] || item.category}
                                            </span>
                                          </td>
                                          <td
                                            className="px-2 text-slate-800 truncate"
                                            title={item.title || ''}
                                          >
                                            {item.title || '-'}
                                          </td>
                                          <td className="px-2 text-center">
                                            <span className="font-mono tabular-nums">
                                              {item.quantity}
                                            </span>
                                            <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                                              {formatQuantityUnit(item)}
                                            </span>
                                          </td>
                                          <td className="px-2 text-center">
                                            <button
                                              type="button"
                                              onClick={() => setDetailItem(item)}
                                              className="px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
                                            >
                                              원문 확인
                                            </button>
                                          </td>
                                          <td className="px-2 text-center">
                                            {(() => {
                                              const direct = isCustomerDirectShip(item);
                                              const dispatched = isVendorDispatched(
                                                item.options || {}
                                              );
                                              if (direct) {
                                                return (
                                                  <span className="text-[10px] font-bold text-indigo-600 whitespace-nowrap">
                                                    고객사 직발송
                                                  </span>
                                                );
                                              }
                                              if (item.status === PRODUCTION_STATUS.VERIFIED) {
                                                return (
                                                  <span className="text-[10px] font-bold text-emerald-600 whitespace-nowrap">
                                                    수령 완료
                                                  </span>
                                                );
                                              }
                                              if (!dispatched) {
                                                return (
                                                  <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
                                                    발주 완료 대기
                                                  </span>
                                                );
                                              }
                                              return (
                                                <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
                                                  수령 대기
                                                </span>
                                              );
                                            })()}
                                          </td>
                                          <td className="px-2 text-center">
                                            <span
                                              className={`text-[10px] font-bold whitespace-nowrap ${productionStatusTextClass(item.status)}`}
                                            >
                                              {productionStatusLabel(item.status)}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {!loading && filteredBatches.length > 0 && (
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

      {statementBatch && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">명세표 대조</h3>
              <p className="text-xs text-slate-500 mt-1.5 font-semibold">
                {formatBatchDisplayName(
                  statementBatch.id,
                  getBatchLabelKind(statementBatch, activeCategory)
                )}{' '}
                · 외주 명세 단가를 건별로 입력합니다.
              </p>
            </div>
            <div className="p-6 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-black border-b border-slate-200 text-[10px]">
                  <tr>
                    <th className="h-10 px-2">관리번호</th>
                    <th className="h-10 px-2">대상자</th>
                    <th className="h-10 px-2">제목</th>
                    <th className="h-10 px-2 text-center">수량</th>
                    <th className="h-10 px-2 text-right w-[140px]">정산단가(원)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                  {(statementBatch.items || []).map((item) => (
                    <tr key={item.id} className="h-12">
                      <td className="px-2 font-mono text-[11px]">{item.postNumber}</td>
                      <td className="px-2 text-[11px]">{item.userName}</td>
                      <td className="px-2 text-[11px] truncate max-w-[200px]" title={item.title}>
                        {item.title || '-'}
                      </td>
                      <td className="px-2 text-center text-[11px]">
                        {item.quantity}
                        {formatQuantityUnit(item)}
                      </td>
                      <td className="px-2 text-right">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={priceDrafts[item.id] || ''}
                          onChange={(e) =>
                            setPriceDrafts((prev) => ({
                              ...prev,
                              [item.id]: e.target.value.replace(/[^\d]/g, ''),
                            }))
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-right text-[11px] font-mono outline-none focus:border-indigo-400"
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                disabled={savingStatement}
                onClick={() => setStatementBatch(null)}
                className="px-4 py-2.5 rounded-xl text-[11px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200"
              >
                취소
              </button>
              <button
                type="button"
                disabled={savingStatement || !canEdit}
                onClick={handleSaveStatementMatch}
                className="px-4 py-2.5 rounded-xl text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
              >
                {savingStatement ? '저장 중…' : '대조 저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem as any}
          onClose={() => setDetailItem(null)}
        />
      )}
    </ArchivePanelShell>
  );
}

function ArchivePanelShell({
  isMaster,
  children,
}: {
  isMaster: boolean;
  children: React.ReactNode;
}) {
  if (isMaster) {
    return <>{children}</>;
  }

  return (
    <ProductionDeptShell pageHint="검수(수령) 완료 후 보관함으로 이관된 묶음을 조회하고 정산 상태를 확인합니다.">
      {children}
    </ProductionDeptShell>
  );
}
