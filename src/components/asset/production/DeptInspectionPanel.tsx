'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import ProductionDeptShell from '@/components/asset/production/ProductionDeptShell';
import ProductionRequestDetailModal from '@/components/asset/production/ProductionRequestDetailModal';
import { getProductionCategoryBadgeClass, getProductionCategoryFolderTabClasses } from '@/lib/production-category-theme';
import { PRODUCTION_STATUS, productionStatusLabel } from '@/lib/production-status';

const MENU_PATH = '/asset/production/dept-master/inspection';
const BATCH_PAGE_SIZE = 10;
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none';

const HISTORY_CATEGORIES = [
  { id: 'ALL', label: '전체 내역', icon: '📋' },
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
  finalPrice?: number;
  options?: Record<string, unknown>;
};

type OrderBatch = {
  id: string;
  status: string;
  totalCount: number;
  totalQuantity: number;
  vendors: string[];
  orderedAt: string | null;
  items: BatchItem[];
};

function formatQuantityUnit(item: BatchItem) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'PRINT') {
    const label = (item.options as any)?.printItemMasterInfo?.unitLabel;
    if (label) return String(label);
  }
  return 'EA';
}

function formatBatchNo(id: string) {
  return id.replace(/^BATCH-/, '');
}

function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput == null) return null;
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return { year: String(ym.year), month: String(ym.month).padStart(2, '0') };
}

export default function DeptInspectionPanel() {
  const [batches, setBatches] = useState<OrderBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [batchPage, setBatchPage] = useState(1);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<BatchItem | null>(null);
  const [emailBatch, setEmailBatch] = useState<OrderBatch | null>(null);

  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, batchRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/production/dept-master/inspection?t=${ts}`, { cache: 'no-store' }),
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

      if (batchRes.ok) {
        const data = await batchRes.json();
        setBatches(Array.isArray(data.batches) ? data.batches : []);
      } else {
        const err = await batchRes.json().catch(() => ({}));
        alert(err.error || err.message || '발주 묶음을 불러오지 못했습니다.');
        setBatches([]);
      }
    } catch {
      alert('서버와 통신할 수 없습니다.');
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const availableYears = useMemo(() => {
    const years = batches
      .map((b) => getKSTYearMonthParts(b.orderedAt)?.year)
      .filter((y): y is string => Boolean(y));
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const kstYear = String(getKSTNowYearMonth().year);
    if (!unique.includes(kstYear)) unique.unshift(kstYear);
    return unique;
  }, [batches]);

  const availableMonths = useMemo(() => {
    const base =
      selectedYear === 'ALL'
        ? batches
        : batches.filter((b) => getKSTYearMonthParts(b.orderedAt)?.year === selectedYear);
    const months = base
      .map((b) => getKSTYearMonthParts(b.orderedAt)?.month)
      .filter((m): m is string => Boolean(m));
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [batches, selectedYear]);

  const filteredBatches = useMemo(() => {
    const q = searchUserQuery.trim().toLowerCase();
    return batches
      .map((b) => {
        const items =
          activeCategory === 'ALL'
            ? b.items || []
            : (b.items || []).filter((i) => i.category === activeCategory);
        return { ...b, items, totalCount: items.length };
      })
      .filter((b) => {
        if (b.items.length === 0) return false;
        const ym = getKSTYearMonthParts(b.orderedAt);
        const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
        const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
        const matchUser =
          !q || (b.items || []).some((i) => (i.userName || '').toLowerCase().includes(q));
        return matchYear && matchMonth && matchUser;
      });
  }, [batches, selectedYear, selectedMonth, searchUserQuery, activeCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / BATCH_PAGE_SIZE));
  const paginatedBatches = filteredBatches.slice(
    (batchPage - 1) * BATCH_PAGE_SIZE,
    batchPage * BATCH_PAGE_SIZE
  );

  useEffect(() => {
    setBatchPage(1);
    setSelectedBatchIds(new Set());
  }, [selectedYear, selectedMonth, searchUserQuery, activeCategory]);

  const allPageBatchesSelected =
    paginatedBatches.length > 0 &&
    paginatedBatches.every((b) => selectedBatchIds.has(b.id));

  const handleSelectAllBatches = () => {
    const next = new Set(selectedBatchIds);
    if (allPageBatchesSelected) {
      paginatedBatches.forEach((b) => next.delete(b.id));
    } else {
      paginatedBatches.forEach((b) => next.add(b.id));
    }
    setSelectedBatchIds(next);
  };

  const handleSelectBatchRow = (id: string) => {
    const next = new Set(selectedBatchIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBatchIds(next);
  };

  const handleBatchExcel = (batch: OrderBatch) => {
    if (!canEdit) return alert('엑셀 저장 권한(Edit)이 없습니다.');
    const rows = batch.items.map((r, idx) => ({
      NO: idx + 1,
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
    XLSX.writeFile(wb, `제작발주서_${formatBatchNo(batch.id)}.xlsx`);
  };

  const handleCancelBatch = async (batch: OrderBatch) => {
    if (!canEdit) return alert('발주 취소 권한(Edit)이 없습니다.');
    if (batch.status !== PRODUCTION_STATUS.ORDERED) {
      return alert('정산승인된 묶음은 발주 취소할 수 없습니다.');
    }
    if (
      !confirm(
        `[${formatBatchNo(batch.id)}] 발주를 취소하고 소속 건을 발주대기열로 되돌릴까요?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/asset/production/dept-master/inspection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel-batch', batchId: batch.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '발주 취소에 실패했습니다.');
        return;
      }
      alert(data.message || '발주를 취소했습니다.');
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  const handleArchiveBatch = async (batch: OrderBatch) => {
    if (!canEdit) return alert('보관함 이동 권한(Edit)이 없습니다.');
    if (batch.status !== PRODUCTION_STATUS.VERIFIED) {
      return alert('정산승인 완료 묶음만 보관함으로 이동할 수 있습니다.');
    }
    if (!confirm(`[${formatBatchNo(batch.id)}] 검수 완료 보관함으로 이동할까요?`)) return;
    try {
      const res = await fetch('/api/asset/production/dept-master/inspection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive-batch', batchId: batch.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '보관함 이동에 실패했습니다.');
        return;
      }
      alert(data.message || '보관함으로 이동했습니다.');
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  const emailSubject = emailBatch
    ? `[제작물발주] 한국생산성본부인증원 제작 요청 (${formatBatchNo(emailBatch.id)})`
    : '';
  const emailBody = emailBatch
    ? `안녕하세요.\n한국생산성본부인증원 제작물 담당자입니다.\n\n금일 발주 확정된 제작 리스트 총 ${emailBatch.totalCount}건 송부해 드립니다.\n첨부된 엑셀 데이터로 제작 부탁드립니다.\n\n- 발주 번호: ${formatBatchNo(emailBatch.id)}\n- 총 건수: ${emailBatch.totalCount}건\n- 외주업체: ${emailBatch.vendors.join(', ') || '-'}\n\n감사합니다.`
    : '';

  const copyEmailPreview = async () => {
    if (!emailBatch) return;
    try {
      await navigator.clipboard.writeText(
        [`제목: ${emailSubject}`, '', emailBody].join('\n')
      );
      alert('제목·본문이 복사되었습니다. 그룹웨어 메일에 붙여넣기 해 주세요.');
    } catch {
      alert('복사에 실패했습니다. 내용을 직접 드래그해서 복사해 주세요.');
    }
  };

  return (
    <ProductionDeptShell pageHint="부서 묶음 발주 건을 외주 발주 묶음 대장으로 관리합니다. 엑셀 저장·메일 복사 → 명세 대조 → 보관함 이동.">
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

      <div className="bg-white border border-t-0 border-indigo-200 rounded-b-[2.5rem] rounded-tr-2xl shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-indigo-50 border-b border-indigo-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 mt-1.5 shrink-0" />
            <div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">
                외주 발주 묶음 관리 대장
              </h2>
              <p className="text-[11px] text-indigo-700/70 font-bold mt-1">
                엑셀 저장·메일 복사(그룹웨어 첨부) → 납품·명세 대조 → 정산승인 → 보관함 이동
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative group/filter flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-indigo-200 shadow-sm h-7 box-border">
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
                  <th className="h-12 px-2 w-[160px]">묶음 번호</th>
                  <th className="h-12 px-4 w-[120px]">발주 일자</th>
                  <th className="h-12 px-4 min-w-[160px]">신청 상세</th>
                  <th className="h-12 px-4 text-center w-[80px]">총 수량</th>
                  <th className="h-12 px-2 text-center w-[120px]">엑셀 다운로드</th>
                  <th className="h-12 px-2 text-center w-[120px]">업체 메일 발송</th>
                  <th className="h-12 px-2 text-center w-[110px]">납품처리</th>
                  <th className="h-12 px-2 text-center min-w-[128px]">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <span>명세서 검수</span>
                      <button
                        type="button"
                        onClick={() =>
                          alert(
                            '거래명세표 일괄 대조는 추후 연동됩니다. 선택 묶음 기준으로 준비 중입니다.'
                          )
                        }
                        disabled={selectedBatchIds.size === 0}
                        className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white font-black text-[10px] rounded-lg shadow-sm disabled:opacity-40 whitespace-nowrap normal-case tracking-normal"
                      >
                        선택 명세서 검수({selectedBatchIds.size}건)
                      </button>
                    </div>
                  </th>
                  <th className="h-12 px-2 text-center w-[150px]">
                    <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                      <span>보관함 이동</span>
                      <span className="text-[9px] font-bold text-indigo-700/80 normal-case tracking-normal">
                        (정산승인 후)
                      </span>
                    </div>
                  </th>
                  <th className="h-12 px-2 text-center w-[90px]">발주 취소</th>
                </tr>
              </thead>
              <tbody className="bg-white text-xs font-bold text-slate-700 divide-y divide-slate-100">
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-16 text-center text-slate-400 text-xs">
                      발주 묶음이 없습니다. 발주 관리 탭에서 접수 후 묶음 발주해 주세요.
                    </td>
                  </tr>
                ) : (
                  paginatedBatches.map((batch) => (
                    <React.Fragment key={batch.id}>
                      <tr
                        className={`h-16 hover:bg-indigo-50/40 transition-colors ${
                          selectedBatchIds.has(batch.id) ? 'bg-indigo-50/50' : ''
                        }`}
                      >
                        <td className="px-4">
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.has(batch.id)}
                            onChange={() => handleSelectBatchRow(batch.id)}
                            className="w-3 h-3 accent-indigo-600 cursor-pointer"
                          />
                        </td>
                        <td
                          className="px-2 font-mono text-indigo-600 cursor-pointer"
                          onClick={() =>
                            setExpandedBatchId(
                              expandedBatchId === batch.id ? null : batch.id
                            )
                          }
                        >
                          {expandedBatchId === batch.id ? '👇' : '👉'}{' '}
                          {formatBatchNo(batch.id)}
                        </td>
                        <td className="px-4 text-slate-600 font-mono">
                          {batch.orderedAt ? getKSTDateString(batch.orderedAt) : '-'}
                        </td>
                        <td
                          className="px-4 cursor-pointer"
                          onClick={() =>
                            setExpandedBatchId(
                              expandedBatchId === batch.id ? null : batch.id
                            )
                          }
                        >
                          <span className="text-indigo-600 underline underline-offset-2 font-black">
                            상세 보기
                          </span>
                          {(() => {
                            const names = Array.from(
                              new Set(
                                (batch.items || []).map((i) => i.userName).filter(Boolean)
                              )
                            );
                            if (names.length === 0) return null;
                            const label = names.join(', ');
                            return (
                              <p
                                className="text-[10px] text-slate-400 mt-0.5 truncate"
                                title={label}
                              >
                                {label}
                              </p>
                            );
                          })()}
                        </td>
                        <td className="px-4 text-center text-indigo-700 font-black">
                          {batch.items?.length || 0} 건
                        </td>
                        <td className="px-2 text-center">
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={() => handleBatchExcel(batch)}
                            className={`p-1.5 px-3 font-black text-[10px] rounded-lg w-full ${
                              canEdit
                                ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            📊 엑셀 저장
                          </button>
                        </td>
                        <td className="px-2 text-center">
                          <button
                            type="button"
                            onClick={() => setEmailBatch(batch)}
                            className="p-1.5 px-3 font-black text-[10px] rounded-lg w-full transition-colors bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200"
                          >
                            📋 미리보기
                          </button>
                        </td>
                        <td className="px-2 text-center">
                          {batch.status === PRODUCTION_STATUS.ORDERED ? (
                            <span className="text-[10px] font-bold whitespace-nowrap text-blue-700">
                              발주완료
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold whitespace-nowrap text-violet-700">
                              정산승인
                            </span>
                          )}
                        </td>
                        <td className="px-2 text-center">
                          {batch.status === PRODUCTION_STATUS.VERIFIED ? (
                            <span className="text-[10px] font-black text-emerald-600">일치</span>
                          ) : (
                            <span className="text-[10px] font-black text-slate-400">미검수</span>
                          )}
                        </td>
                        <td className="px-2 text-center">
                          {batch.status === PRODUCTION_STATUS.VERIFIED ? (
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={!canEdit ? '편집 권한 필요' : undefined}
                              onClick={() => handleArchiveBatch(batch)}
                              className={`p-1.5 px-2 font-black text-[10px] rounded-lg shadow-sm w-full whitespace-nowrap ${
                                canEdit
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              → 검수 완료 보관함 이동
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 text-center">
                          {batch.status === PRODUCTION_STATUS.ORDERED ? (
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={!canEdit ? '편집 권한 필요' : undefined}
                              onClick={() => handleCancelBatch(batch)}
                              className={`p-1.5 px-2 font-black text-[10px] rounded-lg w-full ${
                                canEdit
                                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              발주 취소
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                      </tr>

                      {expandedBatchId === batch.id && (
                        <tr>
                          <td
                            colSpan={11}
                            className="bg-indigo-50/60 p-6 border-l-4 border-indigo-400"
                          >
                            <div className="bg-white border border-indigo-100 rounded-2xl overflow-hidden shadow-sm">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 text-slate-600 font-black tracking-widest border-b border-slate-200 text-[10px]">
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
                                    <th className="h-10 px-2 text-center w-[80px] whitespace-nowrap">
                                      명세서 대조
                                    </th>
                                    <th className="h-10 px-2 text-center w-[96px] whitespace-nowrap">
                                      금액결과
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                                  {batch.items?.map((item, idx) => (
                                    <tr
                                      key={item.id}
                                      className="h-12 hover:bg-slate-50/50 text-[11px] font-bold text-slate-700"
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
                                          className={`px-2 py-0.5 rounded text-[10px] border ${getProductionCategoryBadgeClass(item.category)}`}
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
                                      <td className="px-2 text-center font-mono tabular-nums text-slate-900">
                                        {item.quantity}
                                        <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                                          {formatQuantityUnit(item)}
                                        </span>
                                      </td>
                                      <td className="px-4 text-center">
                                        <button
                                          type="button"
                                          onClick={() => setDetailItem(item)}
                                          className="px-3 py-1.5 text-[11px] font-black rounded-lg transition-colors bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200"
                                        >
                                          원문 확인
                                        </button>
                                      </td>
                                      <td className="px-4 text-center text-base font-black">
                                        {item.status === PRODUCTION_STATUS.VERIFIED ? (
                                          <span className="text-emerald-500">O</span>
                                        ) : (
                                          <span className="text-slate-300">-</span>
                                        )}
                                      </td>
                                      <td className="px-2 text-center font-mono tabular-nums text-[11px]">
                                        {item.finalPrice
                                          ? Number(item.finalPrice).toLocaleString()
                                          : '-'}
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
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {!loading && filteredBatches.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button
              type="button"
              disabled={batchPage === 1}
              onClick={() => setBatchPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setBatchPage(i + 1)}
                className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
                  batchPage === i + 1
                    ? 'bg-slate-800 text-white shadow-sm scale-105'
                    : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              disabled={batchPage === totalPages}
              onClick={() => setBatchPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>
      </div>

      {emailBatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b border-indigo-100 flex justify-between items-center bg-indigo-50">
              <h3 className="text-sm font-black text-indigo-900 tracking-tight">
                업체 메일 미리보기
              </h3>
              <button
                type="button"
                onClick={() => setEmailBatch(null)}
                className="text-slate-400 hover:text-slate-600 font-black text-sm"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs font-bold text-slate-700">
              <p className="text-[11px] text-slate-500">
                외주업체: {emailBatch.vendors.join(', ') || '-'}
              </p>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">제목</label>
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  {emailSubject}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">본문</label>
                <pre className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg whitespace-pre-wrap font-sans text-[11px] leading-relaxed">
                  {emailBody}
                </pre>
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => setEmailBatch(null)}
                className="flex-1 py-2.5 bg-slate-200 text-slate-700 text-xs font-black rounded-lg hover:bg-slate-300"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={copyEmailPreview}
                className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black rounded-lg hover:bg-indigo-700"
              >
                제목·본문 복사
              </button>
            </div>
          </div>
        </div>
      )}

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem as any}
          onClose={() => setDetailItem(null)}
          allowEdit={false}
        />
      )}
    </ProductionDeptShell>
  );
}
