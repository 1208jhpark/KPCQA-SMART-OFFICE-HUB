'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonthParts } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
import ProductionRequestDetailModal from '@/components/production/ProductionRequestDetailModal';
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
  writeDeptHistoryListExcelBuffer,
  writeJebonOrderExcelBuffer,
  writePrintOrderExcelBuffer,
  writeSignOrderExcelBuffer,
} from '@/lib/production-sign-excel';
import { downloadOfficeOrderFileBundle } from '@/lib/production-office-order-bundle';
const HISTORY_API = '/api/production/custom/dept-master/history';
const ITEMS_PER_PAGE = 10;

type HistStatusFilter = 'ALL' | 'APPLY' | 'WAIT_ORDER' | 'DISPATCH' | 'DONE';

const HIST_STATUS_CHIPS: {
  id: HistStatusFilter;
  label: string;
  hint: string;
  idle: string;
  active: string;
}[] = [
  {
    id: 'ALL',
    label: '전체보기',
    hint: '반려를 제외한 전체 공정',
    idle: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
    active: 'bg-slate-800 text-white border-slate-800',
  },
  {
    id: 'APPLY',
    label: '신청',
    hint: '신청대기, 묶음신청대기',
    idle: 'bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100',
    active: 'bg-orange-500 text-white border-orange-500',
  },
  {
    id: 'WAIT_ORDER',
    label: '발주대기',
    hint: '발주대기',
    idle: 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100',
    active: 'bg-blue-600 text-white border-blue-600',
  },
  {
    id: 'DISPATCH',
    label: '발주진행',
    hint: '발주전송',
    idle: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100',
    active: 'bg-emerald-700 text-white border-emerald-700',
  },
  {
    id: 'DONE',
    label: '완료',
    hint: '발주전송(고객사직발송), 물품수령완료',
    idle: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
    active: 'bg-slate-600 text-white border-slate-600',
  },
];

function isListedHistoryRow(r: { status?: string }) {
  return (
    r.status !== PRODUCTION_STATUS.CANCELLED && r.status !== PRODUCTION_STATUS.REJECTED
  );
}

function matchHistStatusFilter(
  item: {
    status?: string;
    options?: Record<string, unknown> | null;
  },
  filter: HistStatusFilter
): boolean {
  if (filter === 'ALL') return true;
  const status = String(item.status || '');
  const opts = (item.options || {}) as Record<string, unknown>;
  if (filter === 'APPLY') {
    return status === PRODUCTION_STATUS.PENDING || status === PRODUCTION_STATUS.ACCEPTED;
  }
  if (filter === 'WAIT_ORDER') {
    return status === PRODUCTION_STATUS.ORDERED && !isVendorDispatched(opts);
  }
  if (filter === 'DISPATCH') {
    return status === PRODUCTION_STATUS.ORDERED && isVendorDispatched(opts);
  }
  if (filter === 'DONE') {
    return status === PRODUCTION_STATUS.VERIFIED;
  }
  return true;
}

const DEPT_HISTORY_CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

const DEPT_HISTORY_ALL_TAB = { id: 'ALL', label: '전체 조회', icon: '📋' };

/** apply/history 공정상태와 동일 표기 */
function getApplyHistoryStatusDisplay(item: {
  status?: string;
  category?: string;
  options?: Record<string, unknown> | null;
}) {
  const opts = (item.options || {}) as Record<string, unknown>;
  const status = String(item.status || '');
  const isDirectShipDone =
    status === PRODUCTION_STATUS.VERIFIED &&
    isCustomerDirectShip({ category: item.category, options: opts });
  return {
    label: productionStatusLabel(status, opts, 'applicant', item.category),
    className: productionStatusTextClass(status, opts, item.category),
    isDirectShipDone,
  };
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
  if (catId === DEPT_HISTORY_ALL_TAB.id) return DEPT_HISTORY_ALL_TAB.label;
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

function isApplyWaitStage(status: string) {
  return status === PRODUCTION_STATUS.PENDING || status === PRODUCTION_STATUS.ACCEPTED;
}

function isInspectionOrLater(status: string) {
  return status === PRODUCTION_STATUS.ORDERED || status === PRODUCTION_STATUS.VERIFIED;
}

function formatHistoryBatchExcelBaseName(batchId: string, category: string) {
  const no = String(batchId || '').replace(/^BATCH-/, '') || '발주';
  if (category === 'SIGN') return `현판_발주서_${no}`;
  if (category === 'JEBON') return `제본_발주서_${no}`;
  if (category === 'PRINT') return `기타제작_발주서_${no}`;
  if (category === 'OFFICE_SUPPLIES') return `사무문구류_${no}`;
  return `제작물_${no}`;
}

const ORDER_EXCEL_CATEGORIES = ['SIGN', 'JEBON', 'PRINT'] as const;

function selectedOrderExcelFileName(category: string, count: number) {
  if (category === 'SIGN') return `선택목록_현판_발주서_${count}건.xlsx`;
  if (category === 'JEBON') return `선택목록_제본_발주서_${count}건.xlsx`;
  if (category === 'PRINT') return `선택목록_기타제작_발주서_${count}건.xlsx`;
  return `선택목록_발주서_${count}건.xlsx`;
}

async function downloadExcelJsFile(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DeptHistoryPanel() {
  const [requests, setRequests] = useState<ProductionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [histCategory, setHistCategory] = useState('ALL');
  const [histYear, setHistYear] = useState(() => String(getKSTNowYearMonth().year));
  const [histMonth, setHistMonth] = useState('ALL');
  const [histPage, setHistPage] = useState(1);
  const [histTitleQuery, setHistTitleQuery] = useState('');
  const [histUserQuery, setHistUserQuery] = useState('');
  const [histStatusFilter, setHistStatusFilter] = useState<HistStatusFilter>('ALL');
  const [detailItem, setDetailItem] = useState<ProductionRequestRow | null>(null);
  const [orderFileBusyId, setOrderFileBusyId] = useState<string | null>(null);
  const [selectedOrderBusy, setSelectedOrderBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const reqRes = await fetch(`${HISTORY_API}?t=${ts}`, { cache: 'no-store' });

      if (reqRes.ok) {
        const data = await reqRes.json();
        setRequests(Array.isArray(data.requests) ? data.requests : []);
      } else {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || err.message || '부서 신청 이력을 불러오지 못했습니다.');
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

  const listedRequests = useMemo(
    () => requests.filter(isListedHistoryRow),
    [requests]
  );

  const histAvailableYears = useMemo(() => {
    const years = listedRequests
      .map((r) => getKSTYearMonthParts(r.createdAt)?.year)
      .filter((y): y is string => Boolean(y));
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    if (!unique.includes(kstYear)) unique.unshift(kstYear);
    return unique;
  }, [listedRequests, kstYear]);

  const histAfterYear = useMemo(() => {
    if (histYear === 'ALL') return listedRequests;
    return listedRequests.filter((r) => getKSTYearMonthParts(r.createdAt)?.year === histYear);
  }, [listedRequests, histYear]);

  const histAvailableMonths = useMemo(() => {
    const months = histAfterYear
      .map((r) => getKSTYearMonthParts(r.createdAt)?.month)
      .filter((m): m is string => Boolean(m));
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [histAfterYear]);

  const histSearchScoped = useMemo(() => {
    const titleQ = histTitleQuery.trim().toLowerCase();
    const userQ = histUserQuery.trim().toLowerCase();
    return listedRequests.filter((r) => {
      const ym = getKSTYearMonthParts(r.createdAt);
      const matchYear = histYear === 'ALL' || ym?.year === histYear;
      const matchMonth = histMonth === 'ALL' || ym?.month === histMonth;
      const matchTitle = !titleQ || (r.title || '').toLowerCase().includes(titleQ);
      const matchUser = !userQ || (r.userName || '').toLowerCase().includes(userQ);
      return matchYear && matchMonth && matchTitle && matchUser;
    });
  }, [listedRequests, histYear, histMonth, histTitleQuery, histUserQuery]);

  const histStatusCounts = useMemo(() => {
    const counts: Record<HistStatusFilter, number> = {
      ALL: histSearchScoped.length,
      APPLY: 0,
      WAIT_ORDER: 0,
      DISPATCH: 0,
      DONE: 0,
    };
    for (const r of histSearchScoped) {
      if (matchHistStatusFilter(r, 'APPLY')) counts.APPLY += 1;
      else if (matchHistStatusFilter(r, 'WAIT_ORDER')) counts.WAIT_ORDER += 1;
      else if (matchHistStatusFilter(r, 'DISPATCH')) counts.DISPATCH += 1;
      else if (matchHistStatusFilter(r, 'DONE')) counts.DONE += 1;
    }
    return counts;
  }, [histSearchScoped]);

  const histFiltered = useMemo(() => {
    return histSearchScoped
      .filter((r) => {
        if (histCategory !== 'ALL' && r.category !== histCategory) return false;
        return matchHistStatusFilter(r, histStatusFilter);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [histSearchScoped, histCategory, histStatusFilter]);

  const histTotalPages = Math.max(1, Math.ceil(histFiltered.length / ITEMS_PER_PAGE));
  const histPaginated = histFiltered.slice(
    (histPage - 1) * ITEMS_PER_PAGE,
    histPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setHistPage(1);
    setSelectedIds(new Set());
  }, [histCategory, histYear, histMonth, histTitleQuery, histUserQuery, histStatusFilter]);

  useEffect(() => {
    if (histPage > histTotalPages) setHistPage(histTotalPages);
  }, [histPage, histTotalPages]);

  const pageIds = histPaginated.map((r) => r.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const toggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleHistExcelDownload = async () => {
    const numbered = histFiltered.map((item, idx) => ({
      item,
      no: histFiltered.length - idx,
    }));
    const selected =
      selectedIds.size > 0
        ? numbered.filter(({ item }) => selectedIds.has(item.id))
        : numbered;
    if (selected.length === 0) {
      return alert('다운로드할 목록이 없습니다.');
    }

    const rows = selected.map(({ item, no }) => {
      const statusDisp = getApplyHistoryStatusDisplay(item);
      const statusLabel = statusDisp.isDirectShipDone
        ? '발주전송 (고객사직발송)'
        : statusDisp.label;
      const actionLabel = isApplyWaitStage(item.status)
        ? '원문검토'
        : isInspectionOrLater(item.status)
          ? item.category === 'OFFICE_SUPPLIES'
            ? '견적서 다운'
            : '발주서 다운'
          : '원문확인';
      const processed = item.statusChangedAt
        ? getKSTDateString(item.statusChangedAt)
        : '-';
      return {
        NO: no,
        관리번호: item.postNumber || '-',
        신청일: getKSTDateString(item.createdAt),
        부서: item.deptName || '-',
        신청자: item.userName || '-',
        분류: getCategoryLabel(item.category),
        '관리용 제목': item.title || '-',
        신청내역: actionLabel,
        수량: `${item.quantity}${formatQuantityUnit(item)}`,
        외주업체: (item.options as { vendor?: string } | undefined)?.vendor || '-',
        처리날짜: processed,
        공정상태: statusLabel,
      };
    });

    try {
      const buffer = await writeDeptHistoryListExcelBuffer(rows);
      await downloadExcelJsFile(buffer, `부서이력_목록.xlsx`);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };

  const selectedOrderItems = useMemo(
    () =>
      histFiltered.filter(
        (r) =>
          selectedIds.has(r.id) &&
          (ORDER_EXCEL_CATEGORIES as readonly string[]).includes(r.category)
      ),
    [histFiltered, selectedIds]
  );

  const handleSelectedOrderDownload = async () => {
    if (selectedOrderItems.length === 0) {
      return alert('현판·제본·기타제작물 건을 체크해 주세요.');
    }
    setSelectedOrderBusy(true);
    try {
      const groups: Array<{ category: string; items: ProductionRequestRow[] }> = [
        { category: 'SIGN', items: selectedOrderItems.filter((r) => r.category === 'SIGN') },
        { category: 'JEBON', items: selectedOrderItems.filter((r) => r.category === 'JEBON') },
        { category: 'PRINT', items: selectedOrderItems.filter((r) => r.category === 'PRINT') },
      ];
      let started = false;
      for (const group of groups) {
        if (group.items.length === 0) continue;
        if (started) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        started = true;
        const exportItems = group.items.map((r) => ({ ...r, batchId: r.batchId || null }));
        const fileName = selectedOrderExcelFileName(group.category, exportItems.length);
        if (group.category === 'SIGN') {
          await downloadExcelJsFile(await writeSignOrderExcelBuffer(exportItems), fileName);
        } else if (group.category === 'JEBON') {
          await downloadExcelJsFile(await writeJebonOrderExcelBuffer(exportItems), fileName);
        } else {
          await downloadExcelJsFile(await writePrintOrderExcelBuffer(exportItems), fileName);
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(err?.message || '선택 건 발주서 다운로드에 실패했습니다.');
    } finally {
      setSelectedOrderBusy(false);
    }
  };

  const handleRowOrderDownload = async (item: ProductionRequestRow) => {
    const exportItems = [{ ...item, batchId: item.batchId || null }];
    const fileBase = formatHistoryBatchExcelBaseName(
      String(item.postNumber || item.id),
      item.category
    );
    setOrderFileBusyId(item.id);
    try {
      if (item.category === 'OFFICE_SUPPLIES') {
        await downloadOfficeOrderFileBundle(exportItems, `${fileBase}_견적서`);
        return;
      }
      if (item.category === 'SIGN') {
        await downloadExcelJsFile(await writeSignOrderExcelBuffer(exportItems), `${fileBase}.xlsx`);
        return;
      }
      if (item.category === 'JEBON') {
        await downloadExcelJsFile(await writeJebonOrderExcelBuffer(exportItems), `${fileBase}.xlsx`);
        return;
      }
      if (item.category === 'PRINT') {
        await downloadExcelJsFile(await writePrintOrderExcelBuffer(exportItems), `${fileBase}.xlsx`);
        return;
      }
      alert('이 분류는 발주서 다운로드를 지원하지 않습니다.');
    } catch (err: any) {
      console.error(err);
      alert(err?.message || '다운로드에 실패했습니다.');
    } finally {
      setOrderFileBusyId(null);
    }
  };

  return (
    <>
      <div className="w-full space-y-3">
        <div className="w-full bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-[13rem] shrink-0 pt-0.5">
              <h3 className="text-base font-medium text-slate-800 flex items-center gap-2">
                📂 부서 진행 대시보드
              </h3>
              <p className="text-[11px] text-slate-500 font-medium mt-1 leading-relaxed max-w-xs">
                4개 분류철을 통합 검색하고, 공정상태별로 조회합니다.
              </p>
            </div>

            <div className="flex flex-col items-end gap-3 min-w-0 flex-1">
              <div
                className="flex flex-wrap justify-end gap-2"
                role="tablist"
                aria-label="공정상태 조회"
              >
                {HIST_STATUS_CHIPS.map((chip) => {
                  const active = histStatusFilter === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={chip.hint}
                      onClick={() => setHistStatusFilter(chip.id)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors min-h-10 ${
                        active ? chip.active : chip.idle
                      }`}
                    >
                      {chip.label}
                      <span className="ml-1.5 tabular-nums">{histStatusCounts[chip.id]}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="제목 검색"
                  value={histTitleQuery}
                  onChange={(e) => setHistTitleQuery(e.target.value)}
                  className="h-10 px-3.5 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-300 w-52"
                />
                <input
                  type="text"
                  placeholder="신청자 검색"
                  value={histUserQuery}
                  onChange={(e) => setHistUserQuery(e.target.value)}
                  className="h-10 px-3.5 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-300 w-44"
                />
                <div className="flex items-center gap-2.5 h-10 bg-white px-3.5 rounded-lg border border-slate-200 shadow-sm">
                  <span className="text-xs font-medium text-slate-400 whitespace-nowrap">연도</span>
                  <select
                    value={histYear}
                    onChange={(e) => {
                      setHistYear(e.target.value);
                      setHistMonth('ALL');
                    }}
                    className="text-sm font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-full"
                  >
                    <option value="ALL">전체</option>
                    {histAvailableYears.map((year) => (
                      <option key={year} value={year}>
                        {year}년
                      </option>
                    ))}
                  </select>
                  <div className="w-px h-5 bg-slate-300" />
                  <span className="text-xs font-medium text-slate-400 whitespace-nowrap">월별</span>
                  <select
                    value={histMonth}
                    onChange={(e) => setHistMonth(e.target.value)}
                    className="text-sm font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-full"
                  >
                    <option value="ALL">전체</option>
                    {histAvailableMonths.map((month) => (
                      <option key={month} value={month}>
                        {month}월
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="w-full">
          <div
            className="flex flex-wrap items-end gap-1 border-b border-slate-200"
            role="tablist"
            aria-label="부서 이력 분류 필터"
          >
            {DEPT_HISTORY_CATEGORIES.map((cat) => {
              const active = histCategory === cat.id;
              const count = histSearchScoped.filter(
                (r) =>
                  r.category === cat.id && matchHistStatusFilter(r, histStatusFilter)
              ).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setHistCategory(cat.id)}
                  className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
                >
                  <span className="text-sm leading-none">{cat.icon}</span>
                  <span>{cat.label}</span>
                  {count > 0 && (
                    <span className="ml-0.5 min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-slate-800/10 text-slate-700">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            {(() => {
              const active = histCategory === 'ALL';
              const count = histSearchScoped.filter((r) =>
                matchHistStatusFilter(r, histStatusFilter)
              ).length;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title="위 검색·공정상태 조건을 4개 분류철에서 모아 봅니다"
                  onClick={() => setHistCategory('ALL')}
                  className={`ml-auto relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses('ALL', active)}`}
                >
                  <span className="text-sm leading-none">{DEPT_HISTORY_ALL_TAB.icon}</span>
                  <span>{DEPT_HISTORY_ALL_TAB.label}</span>
                  {count > 0 && (
                    <span
                      className={`ml-0.5 min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[9px] font-medium tabular-nums ${
                        active ? 'bg-white/20 text-white' : 'bg-slate-800/10 text-slate-700'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })()}
          </div>

          <div
            className={`bg-white border border-t-0 border-slate-200 rounded-b-sm shadow-sm overflow-hidden ${
              histCategory === 'ALL' ? 'rounded-tl-sm' : 'rounded-tr-sm'
            }`}
          >
            <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                <h2 className="text-sm font-medium text-slate-800 tracking-tight">
                  {histCategory === 'ALL'
                    ? DEPT_HISTORY_ALL_TAB.label
                    : `${getCategoryLabel(histCategory)} 이력`}
                </h2>
                <span className="text-[11px] font-medium bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
                  {histFiltered.length}건
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {(histCategory === 'SIGN' ||
                  histCategory === 'JEBON' ||
                  histCategory === 'PRINT') && (
                  <button
                    type="button"
                    onClick={() => void handleSelectedOrderDownload()}
                    disabled={selectedOrderBusy || selectedOrderItems.length === 0}
                    title="체크한 현판·제본·기타제작물 건의 발주서를 받습니다"
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-medium shadow-sm hover:bg-indigo-700 transition-all whitespace-nowrap disabled:opacity-50"
                  >
                    {selectedOrderBusy
                      ? '발주서 준비 중…'
                      : `선택 건 발주서 다운로드${
                          selectedOrderItems.length > 0
                            ? `(${selectedOrderItems.length})`
                            : ''
                        }`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleHistExcelDownload()}
                  disabled={histFiltered.length === 0}
                  title={
                    selectedIds.size > 0
                      ? `선택한 ${selectedIds.size}건 다운로드`
                      : '체크가 없으면 현재 필터의 전체 페이지를 받습니다'
                  }
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-medium shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap disabled:opacity-50"
                >
                  목록 EXCEL 다운로드
                  {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto min-h-[280px]">
              {loading ? (
                <LoadingState />
              ) : (
                <table className="w-full text-left border-collapse table-fixed">
                  <colgroup>
                    <col className="w-[3%]" />
                    <col className="w-[4%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[8%]" />
                    <col className="w-[7%]" />
                    <col />
                    <col style={{ width: '9.75rem' }} />
                    <col className="w-[6%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                    <tr>
                      <th className="h-12 px-1 text-center">
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer"
                          checked={allPageSelected}
                          onChange={toggleSelectAllPage}
                          title="현재 페이지 전체 선택"
                        />
                      </th>
                      <th className="h-12 px-2 text-center">No</th>
                      <th className="h-12 px-2 text-center whitespace-nowrap">관리번호</th>
                      <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
                      <th className="h-12 px-2 text-left whitespace-nowrap">부서 / 신청자</th>
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
                  <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-medium text-slate-700">
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
                        const processedLabel = item.statusChangedAt
                          ? getKSTDateString(item.statusChangedAt)
                          : '';
                        return (
                          <tr
                            key={item.id}
                            className={`h-12 transition-colors ${
                              selectedIds.has(item.id)
                                ? 'bg-indigo-50/40'
                                : 'hover:bg-slate-50/50'
                            }`}
                          >
                            <td className="px-1 text-center">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer"
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleSelectRow(item.id)}
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
                            <td
                              className="px-2 text-left min-w-0"
                              title={[item.deptName, item.userName].filter(Boolean).join(' / ')}
                            >
                              <span className="text-[10px] font-normal text-slate-500 block truncate">
                                {item.deptName || '-'}
                              </span>
                              <span className="font-normal text-slate-800 block truncate">
                                {item.userName || '-'}
                              </span>
                            </td>
                            <td className="px-2 text-center">
                              <span
                                className={`px-2.5 py-1 rounded text-[10px] font-medium tracking-tight border ${getProductionCategoryBadgeClass(item.category)}`}
                              >
                                {getCategoryLabel(item.category)}
                              </span>
                            </td>
                            <td
                              className="px-2 text-left text-slate-800 truncate min-w-0"
                              title={item.title || ''}
                            >
                              {item.title || '-'}
                            </td>
                            <td className="px-2 text-center">
                              {isApplyWaitStage(item.status) ? (
                                <button
                                  type="button"
                                  onClick={() => setDetailItem(item)}
                                  title="원문 검토 (이력에서는 수정 불가)"
                                  className="px-2.5 py-1 text-[10px] font-medium rounded-lg shadow-sm transition-colors bg-rose-600 text-white hover:bg-rose-700 whitespace-nowrap"
                                >
                                  원문검토
                                </button>
                              ) : isInspectionOrLater(item.status) ? (
                                <button
                                  type="button"
                                  disabled={orderFileBusyId === item.id}
                                  onClick={() => void handleRowOrderDownload(item)}
                                  title={
                                    item.category === 'OFFICE_SUPPLIES'
                                      ? '견적서 다운로드'
                                      : '발주서 다운로드'
                                  }
                                  className="h-7 box-border inline-flex items-center justify-center px-2.5 text-[11px] font-medium rounded-lg whitespace-nowrap transition-colors bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 disabled:opacity-60"
                                >
                                  {orderFileBusyId === item.id
                                    ? '준비 중…'
                                    : item.category === 'OFFICE_SUPPLIES'
                                      ? '📥 견적서 다운'
                                      : '📥 발주서 다운'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setDetailItem(item)}
                                  className="px-2.5 py-1 text-[10px] font-medium rounded-lg shadow-sm transition-colors whitespace-nowrap bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
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
                              {(item.options as { vendor?: string } | undefined)?.vendor || '-'}
                            </td>
                            <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                              {processedLabel || <span className="text-slate-300">-</span>}
                            </td>
                            <td className="px-2 text-center">
                              {statusDisp.isDirectShipDone ? (
                                <span
                                  className={`inline-flex flex-col items-center leading-tight font-medium whitespace-nowrap ${statusDisp.className}`}
                                >
                                  <span className="whitespace-nowrap">발주전송</span>
                                  <span className="text-[10px] font-medium whitespace-nowrap normal-case tracking-normal">
                                    (고객사직발송)
                                  </span>
                                </span>
                              ) : (
                                <span
                                  className={`font-medium whitespace-nowrap ${statusDisp.className}`}
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
      </div>

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          allowEdit={false}
        />
      )}
    </>
  );
}
