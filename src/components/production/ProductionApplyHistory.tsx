'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonthParts } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
import ProductionRequestDetailModal from '@/components/production/ProductionRequestDetailModal';
import {
  getProductionCategoryTextClass,
  getProductionCategoryFolderTabClasses,
} from '@/lib/production-category-theme';
import {
  PRODUCTION_STATUS,
  canEditProductionApplicantSource,
  productionStatusLabel,
  productionStatusTextClass,
} from '@/lib/production-status';
import { isCustomerDirectShip } from '@/lib/production-shipping';
import {
  PRODUCTION_MY_ORDERS_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';

// 서류철: 진행 중(반려 포함) / 분류별은 수령완료만
const HISTORY_CATEGORIES = [
  { id: 'ALL', label: '진행 중 내역', icon: '📋' },
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

const ITEMS_PER_PAGE = 10;

/** 신청 수량 단위: 제본=부, 기타제작=마스터 단위, 사무문구=건, 그 외=EA */
function formatQuantityUnit(item: {
  category?: string;
  options?: { printItemMasterInfo?: { unitLabel?: string; unitValue?: string } };
}) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'OFFICE_SUPPLIES') return '건';
  if (item.category === 'PRINT') {
    const label = item.options?.printItemMasterInfo?.unitLabel;
    if (label) return String(label);
  }
  return 'EA';
}

export default function ProductionApplyHistory() {
  const stepTabs = useInterfaceStepTabs(
    PRODUCTION_MY_ORDERS_TABS,
    '/production/custom/my-orders'
  );
  const [histories, setHistories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [activeCategory, setActiveCategory] = useState('ALL');
  /** 진행 중 내역 탭 전용 — 분류 솔트 (서류철 분류 탭과 별개) */
  const [progressCategoryFilter, setProgressCategoryFilter] = useState('ALL');
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailItem, setDetailItem] = useState<any>(null);

  const openDetail = (item: any) => {
    setDetailItem(item);
  };

  const loadHistories = () => {
    setLoading(true);
    fetch('/api/production/custom/my-orders/history?scope=OWN', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setHistories([]);
          alert(data.message || data.error || '신청 이력을 불러올 권한이 없거나 실패했습니다.');
          return;
        }
        if (Array.isArray(data)) {
          setHistories(data);
        } else {
          setHistories([]);
        }
      })
      .catch((err) => {
        console.error('히스토리 로드 실패:', err);
        setHistories([]);
        alert('신청 이력을 불러오는 중 오류가 발생했습니다.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => setCurrentUser(user))
      .catch(() => setCurrentUser(null));
  }, []);

  // 🎯 본인(scope=OWN) 자료만 가져오도록 명확하게 필터 벨트 바인딩
  useEffect(() => {
    loadHistories();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
  }, [activeCategory, progressCategoryFilter, selectedYear, selectedMonth]);

  useEffect(() => {
    if (activeCategory !== 'ALL') setProgressCategoryFilter('ALL');
  }, [activeCategory]);

  // 🚀 코드가 아닌 한글 매핑 명칭을 안전하게 추출하는 공통 헬퍼
  const getCategoryLabel = (catId: string) => {
    const found = HISTORY_CATEGORIES.find((c) => c.id === catId);
    return found ? found.label : catId;
  };

  const kstYear = String(getKSTNowYearMonth().year);

  const availableYears = useMemo(() => {
    const years = histories
      .map((item) => getKSTYearMonthParts(item.createdAt)?.year)
      .filter((y): y is string => Boolean(y));
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    if (!unique.includes(kstYear)) unique.unshift(kstYear);
    return unique;
  }, [histories, kstYear]);

  const afterYearList = useMemo(() => {
    if (selectedYear === 'ALL') return histories;
    return histories.filter(
      (item) => getKSTYearMonthParts(item.createdAt)?.year === selectedYear
    );
  }, [histories, selectedYear]);

  const availableMonths = useMemo(() => {
    const months = afterYearList
      .map((item) => getKSTYearMonthParts(item.createdAt)?.month)
      .filter((m): m is string => Boolean(m));
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [afterYearList]);

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

  const filteredHistories = useMemo(() => {
    return histories.filter((item) => {
      // 예전 soft-cancel(CANCELLED) 잔여분 숨김 — 발주대기 취소는 이제 DB 삭제
      if (item.status === 'CANCELLED') return false;
      const ym = getKSTYearMonthParts(item.createdAt);
      const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      if (!matchYear || !matchMonth) return false;

      // 진행 중: 수령완료만 제외(반려는 진행 중에 유지) / 분류 서류철: 수령완료만
      if (activeCategory === 'ALL') {
        if (item.status === 'VERIFIED') return false;
        return progressCategoryFilter === 'ALL' || item.category === progressCategoryFilter;
      }
      return item.status === 'VERIFIED' && item.category === activeCategory;
    });
  }, [histories, activeCategory, progressCategoryFilter, selectedYear, selectedMonth]);

  const totalPages = Math.max(1, Math.ceil(filteredHistories.length / ITEMS_PER_PAGE));
  const paginatedHistories = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredHistories.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredHistories, currentPage]);
  /** 완료 이력 4탭은 재신청·취소 불가 — 관리액션 칼럼 숨김 */
  const isProgressBoard = activeCategory === 'ALL';
  const showManageAction = isProgressBoard;
  const tableColSpan = showManageAction ? 13 : 12;

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedIds(paginatedHistories.map((item) => item.id));
    else setSelectedIds([]);
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleCancel = async (item: any) => {
    if (item.status !== 'PENDING' && item.status !== 'REJECTED') return;
    const isRejected = item.status === 'REJECTED';
    if (
      !confirm(
        isRejected
          ? `[${item.postNumber}] 반려된 신청을 취소하고 목록에서 삭제할까요?\n복구할 수 없습니다.`
          : `[${item.postNumber}] 신청을 취소하시겠습니까?\n접수대기(미접수) 건은 목록에서 삭제되며, 복구할 수 없습니다.`
      )
    ) {
      return;
    }
    setActionBusyId(item.id);
    try {
      const res = await fetch('/api/production/custom/my-orders/history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'cancel' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '취소에 실패했습니다.');
        return;
      }
      setHistories((prev) => prev.filter((h) => h.id !== item.id));
      setSelectedIds((prev) => prev.filter((id) => id !== item.id));
      if (detailItem?.id === item.id) {
        setDetailItem(null);
      }
      alert('신청이 취소되어 목록에서 삭제되었습니다.');
    } catch {
      alert('취소 처리 중 오류가 발생했습니다.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleReapply = async (item: any) => {
    if (item.status !== 'REJECTED') return;
    if (
      !confirm(
        `[${item.postNumber}] 반려된 신청을 다시 접수대기로 올릴까요?\n원문을 수정한 뒤 부서 검수로 다시 들어갑니다.`
      )
    ) {
      return;
    }
    setActionBusyId(item.id);
    try {
      const res = await fetch('/api/production/custom/my-orders/history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'reapply' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '재신청에 실패했습니다.');
        return;
      }
      setHistories((prev) =>
        prev.map((h) =>
          h.id === item.id ? { ...h, ...(data.data || {}), status: 'PENDING' } : h
        )
      );
      alert('재신청되어 접수대기로 올렸습니다.');
    } catch {
      alert('재신청 처리 중 오류가 발생했습니다.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRevertAccept = async (item: any) => {
    if (item.status !== 'ACCEPTED') return;
    if (
      !confirm(
        `[${item.postNumber}] 접수를 취소하고 접수대기 상태로 되돌리시겠습니까?`
      )
    ) {
      return;
    }
    setActionBusyId(item.id);
    try {
      const res = await fetch('/api/production/custom/my-orders/history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'revert-accept' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '접수 취소에 실패했습니다.');
        return;
      }
      setHistories((prev) =>
        prev.map((h) => (h.id === item.id ? { ...h, status: 'PENDING' } : h))
      );
      alert('접수가 취소되어 접수대기 상태로 변경되었습니다.');
    } catch {
      alert('접수 취소 처리 중 오류가 발생했습니다.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleExcelDownload = async () => {
    const targetData =
      selectedIds.length > 0
        ? filteredHistories.filter((item) => selectedIds.includes(item.id))
        : filteredHistories;

    if (targetData.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const qtyHeader = activeCategory === 'OFFICE_SUPPLIES' ? '건' : '수량';
    const sheetTitle = isProgressBoard ? '진행중내역' : '완료이력';
    const headers = [
      'No',
      '관리번호',
      '신청일',
      '부서',
      '신청자',
      '분류',
      '관리용 제목',
      qtyHeader,
      '외주업체',
      '처리날짜',
      '공정상태',
    ];

    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(sheetTitle);
      sheet.addRow(headers);

      targetData.forEach((item: any) => {
        const idx = filteredHistories.findIndex((h) => h.id === item.id);
        const rowNo = idx >= 0 ? filteredHistories.length - idx : '';
        const opts = (item.options || {}) as Record<string, unknown>;
        sheet.addRow([
          rowNo,
          item.postNumber || '',
          getKSTDateString(item.createdAt),
          item.deptName || '-',
          item.userName || '-',
          getCategoryLabel(item.category),
          item.title || '-',
          `${item.quantity}${formatQuantityUnit(item)}`,
          String(opts.vendor || '').trim() || '-',
          item.statusChangedAt ? getKSTDateString(item.statusChangedAt) : '-',
          productionStatusLabel(item.status, opts, 'applicant', item.category),
        ]);
      });

      const thin = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
      const border = { top: thin, left: thin, bottom: thin, right: thin };
      const headerRow = sheet.getRow(1);
      headerRow.height = 22;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: '맑은 고딕' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF334155' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = border;
      });

      const centerCols = new Set([1, 2, 3, 6, 8, 10, 11]);
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.height = 18;
        row.eachCell((cell, colNumber) => {
          cell.font = { size: 10, name: '맑은 고딕' };
          cell.alignment = {
            vertical: 'middle',
            horizontal: centerCols.has(colNumber) ? 'center' : 'left',
          };
          cell.border = border;
          if (rowNumber % 2 === 0) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF8FAFC' },
            };
          }
        });
      });

      const displayWidth = (v: unknown) => {
        const s = v == null ? '' : String(v);
        let w = 0;
        for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
        return w;
      };
      sheet.columns.forEach((col) => {
        let max = 8;
        col.eachCell?.({ includeEmpty: true }, (cell) => {
          const w = displayWidth(cell.value);
          if (w > max) max = w;
        });
        col.width = Math.min(46, Math.max(12, max + 4));
      });

      const yearLabel = selectedYear === 'ALL' ? '전체' : `${selectedYear}년`;
      const catLabel = (
        isProgressBoard
          ? progressCategoryFilter === 'ALL'
            ? '진행중내역'
            : `진행중내역_${getCategoryLabel(progressCategoryFilter)}`
          : `${getCategoryLabel(activeCategory)}_완료이력`
      ).replace(/\//g, '_');
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${catLabel}_${yearLabel}${
        selectedIds.length > 0 ? '_선택분' : ''
      }.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs — survey/general/my-submissions와 동일 */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-indigo-400 mb-2.5">
            MY PRODUCTION REQUESTS & HISTORY
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-indigo-400 font-normal">{currentUser?.name || '임직원'} 님</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-medium">나의 신청 이력</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            본인 계정으로 신청한 맞춤 제작물 이력을 조회합니다.
          </p>
        </div>
      </div>

      {/* 탭 네비게이션 — admin/interface 명칭 반영 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap min-h-[40px]">
          {stepTabs.length === 0 ? (
            <div className="h-8 w-72 rounded-md bg-slate-200/80 animate-pulse" aria-hidden />
          ) : (
            stepTabs.map((tab) => {
              const isActive = pathname === tab.path;
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
            })
          )}
        </div>
        <p className="text-[10px] text-slate-400 font-medium px-3 hidden sm:block">
          ※ apply=개인 신청 · dept=부서 묶음 발주 · master=중앙 대조
        </p>
      </div>

      {/* 서류철 탭이 아래 표 상단선에 붙음 · 진행 중 | 완료 이력(분류) */}
      <div className="w-full pt-2">
        <div
          className="flex flex-wrap items-end gap-1 border-b border-slate-200"
          role="tablist"
          aria-label="진행 중 · 완료 이력"
        >
          {HISTORY_CATEGORIES.filter((c) => c.id === 'ALL').map((cat) => {
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCategory(cat.id)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
              >
                <span className="text-sm leading-none">{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}

          <div
            className="w-px h-8 bg-slate-300 mx-1.5 mb-0 shrink-0"
            aria-hidden
          />
          <span className="shrink-0 mb-2 px-1 text-[10px] font-medium text-slate-400 whitespace-nowrap select-none">
            완료 이력
          </span>
          {HISTORY_CATEGORIES.filter((c) => c.id !== 'ALL').map((cat) => {
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={`${cat.label} 수령완료 이력`}
                onClick={() => setActiveCategory(cat.id)}
                className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
              >
                <span className="text-sm leading-none">{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        <div className="bg-white border border-t-0 border-slate-200 rounded-b-sm rounded-tr-sm shadow-sm overflow-hidden">
        <div
          className={`p-4 px-6 border-b flex items-center justify-between flex-wrap gap-4 ${
            isProgressBoard
              ? 'bg-amber-500 border-amber-400'
              : 'bg-slate-200/70 border-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isProgressBoard ? 'bg-white' : 'bg-blue-600'
              }`}
            />
            <h2
              className={`text-sm font-medium tracking-tight ${
                isProgressBoard ? 'text-white' : 'text-slate-800'
              }`}
            >
              {isProgressBoard
                ? '실시간 신청·진행 현황'
                : `${getCategoryLabel(activeCategory)} 제작·수령 완료 이력`}
            </h2>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                isProgressBoard
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-300/80 text-slate-700'
              }`}
            >
              {filteredHistories.length}건
            </span>
            {selectedIds.length > 0 && (
              <span
                className={`text-[10px] font-medium ml-2 px-2 py-0.5 rounded-md border ${
                  isProgressBoard
                    ? 'text-white bg-white/20 border-white/40'
                    : 'text-blue-600 bg-blue-50 border-blue-200'
                }`}
              >
                {selectedIds.length}개 선택됨
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden group-hover/filter:block whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-medium text-white shadow-lg"
              >
                {activeCategory === 'ALL'
                  ? '분류 → 연도 → 월 · 연계필터'
                  : '연도 → 월 · 연계필터'}
              </span>

              {activeCategory === 'ALL' && (
                <>
                  <span className="text-[10px] font-medium text-slate-400 uppercase">분류</span>
                  <select
                    value={progressCategoryFilter}
                    onChange={(e) => setProgressCategoryFilter(e.target.value)}
                    className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent max-w-[9.5rem]"
                    aria-label="진행 중 내역 분류 솔트"
                  >
                    <option value="ALL">전체</option>
                    {HISTORY_CATEGORIES.filter((c) => c.id !== 'ALL').map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                  <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
                </>
              )}

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

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-medium text-slate-400 uppercase">월별</span>
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

            <button
              type="button"
              onClick={handleExcelDownload}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-medium shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
            >
              {selectedIds.length > 0
                ? `선택 EXCEL 다운로드(${selectedIds.length})`
                : '화면 목록 EXCEL 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <LoadingState />
          ) : (
            <table className="w-full text-left border-collapse table-fixed">
              <colgroup>
                <col style={{ width: '2.5rem' }} />
                <col style={{ width: '2.5rem' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '7%' }} />
                <col />
                <col style={{ width: '9.75rem' }} />
                <col style={{ width: '5.5rem' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '5.5rem' }} />
                {showManageAction ? <col style={{ width: '6rem' }} /> : null}
              </colgroup>
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-medium uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 text-center">
                    <input
                      type="checkbox"
                      className="w-3 h-3 accent-blue-600 rounded cursor-pointer"
                      checked={
                        paginatedHistories.length > 0 &&
                        selectedIds.length === paginatedHistories.length
                      }
                      onChange={handleSelectAll}
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
                    {activeCategory === 'OFFICE_SUPPLIES' ? '건' : '수량'}
                  </th>
                  <th className="h-12 px-2 text-left whitespace-nowrap">외주업체</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">처리날짜</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
                  {showManageAction ? (
                    <th className="h-12 px-2 text-center whitespace-nowrap">관리액션</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-medium text-slate-700">
                {paginatedHistories.length === 0 ? (
                  <tr>
                    <td colSpan={tableColSpan} className="p-16 text-center text-slate-400 text-xs">
                      신청 가드 범위 내에 해당하는 내역이 존재하지 않습니다.
                    </td>
                  </tr>
                ) : (
                  paginatedHistories.map((item: any, idx: number) => {
                    const rowNo =
                      filteredHistories.length - ((currentPage - 1) * ITEMS_PER_PAGE + idx);
                    const isPending = item.status === 'PENDING';
                    const isAccepted = item.status === 'ACCEPTED';
                    const isOrdered = item.status === 'ORDERED';
                    const isVerified = item.status === 'VERIFIED';
                    const isRejected = item.status === 'REJECTED';
                    const isCancelled = item.status === 'CANCELLED';

                    const opts = (item.options || {}) as Record<string, unknown>;
                    const canReviewEdit = canEditProductionApplicantSource(item.status, opts);
                    const statusLabel = productionStatusLabel(
                      item.status,
                      opts,
                      'applicant',
                      item.category
                    );
                    const isDirectShipDone =
                      item.status === PRODUCTION_STATUS.VERIFIED &&
                      isCustomerDirectShip({
                        category: item.category,
                        options: opts,
                      });
                    const isHqReceivedDone =
                      item.status === PRODUCTION_STATUS.VERIFIED && !isDirectShipDone;
                    const statusClass = `${
                      item.status === PRODUCTION_STATUS.ACCEPTED
                        ? 'text-orange-600'
                        : isDirectShipDone || isHqReceivedDone
                          ? 'text-slate-800'
                          : productionStatusTextClass(item.status, opts, item.category)
                    } font-medium`;
                    return (
                    <tr
                      key={item.id}
                      className={`h-12 transition-colors group ${
                        selectedIds.includes(item.id) ? 'bg-blue-50/30' : 'hover:bg-slate-50/50'
                      }`}
                    >
                      <td className="pl-4 text-center">
                        <input
                          type="checkbox"
                          className="w-3 h-3 accent-blue-600 rounded cursor-pointer"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => handleSelectOne(item.id)}
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
                          className={`text-[11px] font-medium tracking-tight ${getProductionCategoryTextClass(item.category)}`}
                        >
                          {getCategoryLabel(item.category)}
                        </span>
                      </td>
                      <td className="px-2 text-left text-slate-800 truncate" title={item.title || ''}>
                        {item.title || '-'}
                      </td>
                      <td className="px-2 text-center">
                        {canReviewEdit ? (
                          <button
                            type="button"
                            onClick={() => openDetail(item)}
                            className="px-2.5 py-1 text-[10px] font-medium rounded-lg shadow-sm transition-colors bg-rose-600 text-white hover:bg-rose-700 whitespace-nowrap"
                          >
                            원문검토 · 수정가능
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openDetail(item)}
                            className="px-2.5 py-1 text-[10px] font-medium rounded-lg transition-colors bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
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
                        {item.options?.vendor || '-'}
                      </td>
                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                        {item.statusChangedAt ? (
                          getKSTDateString(item.statusChangedAt)
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-2 text-center">
                        {isRejected ? (
                          (() => {
                            const rejectReason = String(opts.rejectReason || '').trim();
                            const rejectedAt = String(opts.rejectedAt || '').trim();
                            const tip = rejectReason
                              ? `반려 사유: ${rejectReason}${rejectedAt ? `\n처리일: ${rejectedAt}` : ''}`
                              : '등록된 반려 사유가 없습니다.';
                            return (
                              <button
                                type="button"
                                title={tip}
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
                                className={`inline-flex flex-col items-center leading-tight ${statusClass} underline decoration-dotted underline-offset-2 cursor-pointer hover:opacity-80`}
                              >
                                <span className="text-[10px] font-medium whitespace-nowrap">반려</span>
                                <span className="text-[9px] font-medium text-rose-500/90 whitespace-nowrap normal-case tracking-normal">
                                  {rejectReason ? '사유 보기' : '사유 없음'}
                                </span>
                              </button>
                            );
                          })()
                        ) : isDirectShipDone ? (
                          <span
                            className={`inline-flex flex-col items-center leading-tight ${statusClass}`}
                          >
                            <span className="text-[10px] font-medium whitespace-nowrap">
                              발주전송
                            </span>
                            <span className="text-[9px] font-medium whitespace-nowrap normal-case tracking-normal">
                              (고객사직발송)
                            </span>
                          </span>
                        ) : (
                          <span className={`text-[10px] font-medium whitespace-nowrap ${statusClass}`}>
                            {statusLabel}
                          </span>
                        )}
                      </td>
                      {showManageAction ? (
                      <td className="px-2 text-center">
                        {isRejected ? (
                          <div className="inline-flex items-center justify-center gap-1">
                            <button
                              type="button"
                              disabled={actionBusyId === item.id}
                              onClick={() => handleReapply(item)}
                              className="px-2 py-1 text-[10px] font-medium rounded-lg transition-colors bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                            >
                              {actionBusyId === item.id ? '처리중…' : '재신청'}
                            </button>
                            <button
                              type="button"
                              disabled={actionBusyId === item.id}
                              onClick={() => handleCancel(item)}
                              className="px-2 py-1 text-[10px] font-medium rounded-lg transition-colors bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600 disabled:opacity-50 whitespace-nowrap"
                            >
                              {actionBusyId === item.id ? '처리중…' : '신청취소'}
                            </button>
                          </div>
                        ) : isPending ? (
                          <button
                            type="button"
                            disabled={actionBusyId === item.id}
                            onClick={() => handleCancel(item)}
                            className="px-2 py-1 text-[10px] font-medium rounded-lg transition-colors bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600 disabled:opacity-50 whitespace-nowrap"
                          >
                            {actionBusyId === item.id ? '처리중…' : '신청취소'}
                          </button>
                        ) : isAccepted ? (
                          <button
                            type="button"
                            disabled={actionBusyId === item.id}
                            onClick={() => handleRevertAccept(item)}
                            className="px-2 py-1 text-[10px] font-medium rounded-lg transition-colors bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600 disabled:opacity-50 whitespace-nowrap"
                          >
                            {actionBusyId === item.id ? '처리중…' : '접수취소'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                            -
                          </span>
                        )}
                      </td>
                      ) : null}
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {!loading && filteredHistories.length > 0 && (
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
      </div>

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          allowEdit
          editableStatuses={['PENDING', 'ACCEPTED', 'REJECTED', 'ORDERED']}
          onSaved={(updated) => {
            setHistories((prev) =>
              prev.map((h) => (h.id === updated.id ? { ...h, ...updated } : h))
            );
            setDetailItem((prev: any) =>
              prev && prev.id === updated.id ? { ...prev, ...updated } : prev
            );
          }}
        />
      )}
    </div>
  );
}
