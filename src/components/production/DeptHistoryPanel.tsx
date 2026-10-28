'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
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
import {
  buildSignDetailExcelRows,
  buildJebonDetailExcelRows,
  buildPrintDetailExcelRows,
  buildOfficeSuppliesDetailExcelRows,
} from '@/lib/production-sign-excel';
const HISTORY_API = '/api/production/custom/dept-master/history';
const ITEMS_PER_PAGE = 10;

const DEPT_HISTORY_CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

/** apply/history 공정상태와 동일 표기 */
function getApplyHistoryStatusDisplay(item: {
  status?: string;
  category?: string;
  options?: Record<string, unknown> | null;
}) {
  const opts = (item.options || {}) as Record<string, unknown>;
  return {
    label: productionStatusLabel(String(item.status || ''), opts, 'applicant', item.category),
    className: `${productionStatusTextClass(String(item.status || ''), opts, item.category)} font-medium`,
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

export default function DeptHistoryPanel() {
  const [requests, setRequests] = useState<ProductionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [histCategory, setHistCategory] = useState('SIGN');
  const [histYear, setHistYear] = useState(() => String(getKSTNowYearMonth().year));
  const [histMonth, setHistMonth] = useState('ALL');
  const [histPage, setHistPage] = useState(1);
  const [histTitleQuery, setHistTitleQuery] = useState('');
  const [histUserQuery, setHistUserQuery] = useState('');
  const [detailItem, setDetailItem] = useState<ProductionRequestRow | null>(null);

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

  const handleHistExcelDownload = () => {
    const target = histFiltered;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const yearLabel = histYear === 'ALL' ? '전체' : `${histYear}년`;
    const catLabel = getCategoryLabel(histCategory).replace(/\//g, '_');

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

  return (
    <>
      <div className="w-full space-y-3">
        <div className="w-full bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
            📂 부서 전체 이력
          </h3>
          <p className="text-[10px] text-slate-500 font-medium mt-0.5">
            연계 조직 신청을 분류철별로 모아 봅니다. 공정상태는 나의 신청 이력과 동일하게 표기됩니다.
          </p>
        </div>

        <div className="w-full">
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
          </div>

          <div className="bg-white border border-t-0 border-slate-200 rounded-b-[2.5rem] rounded-tr-2xl shadow-sm overflow-hidden">
            <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                <h2 className="text-sm font-black text-slate-800 tracking-tight">
                  {getCategoryLabel(histCategory)} 이력
                </h2>
                <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
                  {histFiltered.length}수량
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="제목 검색"
                  value={histTitleQuery}
                  onChange={(e) => setHistTitleQuery(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:ring-2 focus:ring-indigo-300 w-36"
                />
                <input
                  type="text"
                  placeholder="신청자 검색"
                  value={histUserQuery}
                  onChange={(e) => setHistUserQuery(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:ring-2 focus:ring-indigo-300 w-32"
                />
                <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-medium text-slate-400 uppercase">연도</span>
                  <select
                    value={histYear}
                    onChange={(e) => {
                      setHistYear(e.target.value);
                      setHistMonth('ALL');
                    }}
                    className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
                  >
                    <option value="ALL">전체</option>
                    {histAvailableYears.map((year) => (
                      <option key={year} value={year}>
                        {year}년
                      </option>
                    ))}
                  </select>
                  <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
                  <span className="text-[10px] font-medium text-slate-400 uppercase">월별</span>
                  <select
                    value={histMonth}
                    onChange={(e) => setHistMonth(e.target.value)}
                    className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
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
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-medium shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap disabled:opacity-50"
                >
                  화면 목록 EXCEL 다운로드
                </button>
              </div>
            </div>

            <div className="overflow-x-auto min-h-[280px]">
              {loading ? (
                <LoadingState />
              ) : (
                <table className="w-full text-left border-collapse table-fixed">
                  <colgroup>
                    <col className="w-[4%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[12%]" />
                    <col className="w-[9%]" />
                    <col className="w-[14%]" />
                    <col style={{ width: '9.75rem' }} />
                    <col className="w-[6%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                    <tr>
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
                        <td colSpan={11} className="p-16 text-center text-slate-400 text-xs">
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
                              className="px-2 text-left text-slate-800 truncate"
                              title={item.title || ''}
                            >
                              {item.title || '-'}
                            </td>
                            <td className="px-2 text-center">
                              <button
                                type="button"
                                onClick={() => setDetailItem(item)}
                                className={`px-2.5 py-1 text-[10px] font-medium rounded-lg shadow-sm transition-colors whitespace-nowrap ${
                                  isPending
                                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300'
                                }`}
                              >
                                {isPending ? '원문검토 · 수정가능' : '원문확인'}
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
                                      <span className="text-[10px] font-medium whitespace-nowrap">
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
                                  className={`text-[10px] font-medium whitespace-nowrap ${statusDisp.className}`}
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
