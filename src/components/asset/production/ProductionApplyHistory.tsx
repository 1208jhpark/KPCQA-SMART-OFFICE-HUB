'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import ProductionRequestDetailModal from '@/components/asset/production/ProductionRequestDetailModal';
import {
  getProductionCategoryBadgeClass,
  getProductionCategoryFolderTabClasses,
} from '@/lib/production-category-theme';

// 🚀 [신청 페이지 CATEGORIES와 1:1 싱크 통일 + 전체내역 탭 추가]
const HISTORY_CATEGORIES = [
  { id: 'ALL', label: '전체 내역', icon: '📋' },
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

const ITEMS_PER_PAGE = 10;

/** 신청 수량 단위: 제본=부, 기타제작=마스터 단위, 그 외=EA */
function formatQuantityUnit(item: {
  category?: string;
  options?: { printItemMasterInfo?: { unitLabel?: string; unitValue?: string } };
}) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'PRINT') {
    const label = item.options?.printItemMasterInfo?.unitLabel;
    if (label) return String(label);
  }
  return 'EA';
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

export default function ProductionApplyHistory() {
  const [histories, setHistories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [activeCategory, setActiveCategory] = useState('ALL');
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
    fetch('/api/asset/production/apply/history?scope=OWN', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setHistories(data);
        } else {
          setHistories([]);
        }
      })
      .catch((err) => console.error('히스토리 로드 실패:', err))
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
  }, [activeCategory, selectedYear, selectedMonth]);

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
      const matchCategory = activeCategory === 'ALL' || item.category === activeCategory;
      const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      return matchCategory && matchYear && matchMonth;
    });
  }, [histories, activeCategory, selectedYear, selectedMonth]);

  const totalPages = Math.max(1, Math.ceil(filteredHistories.length / ITEMS_PER_PAGE));
  const paginatedHistories = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredHistories.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredHistories, currentPage]);

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
    if (item.status !== 'PENDING') return;
    if (
      !confirm(
        `[${item.postNumber}] 신청을 취소하시겠습니까?\n대기중(미접수) 건은 목록에서 삭제되며, 복구할 수 없습니다.`
      )
    ) {
      return;
    }
    setCancellingId(item.id);
    try {
      const res = await fetch('/api/asset/production/apply/history', {
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
      setCancellingId(null);
    }
  };

  // 🚀 [지침 완벽 반영]: 시스템 내부 보조 서식을 철저히 배제하고 순서대로 엑셀(CSV) 추출
  const handleExcelDownload = () => {
    const targetData =
      selectedIds.length > 0
        ? filteredHistories.filter((item) => selectedIds.includes(item.id))
        : filteredHistories;

    if (targetData.length === 0) return alert('다운로드할 데이터가 없습니다.');

    // 외주 제작사 전달용 최적화 헤더 스펙 (보조 서식 차단 완료)
    const headers = [
      '관리번호',
      '분류명',
      '배정업체',
      '신청일자',
      '소속부서',
      '담당자',
      '신청수량',
      '예상단가 합계',
      '주요 제작물 명세 및 옵션',
      '배송지 수령인',
      '수령인 연락처',
      '최종 배송지 주소',
    ];

    const rows = targetData.map((item) => {
      const opt = item.options || {};
      
      // 카테고리별 옵션 명세 문자열 가공
      let detailSpec = '';
      if (item.category === 'SIGN') {
        detailSpec = (() => {
          const digits = String(opt.formattedValidPeriod || '').replace(/\D/g, '');
          const period =
            !digits || /^0+$/.test(digits) ? '해당없음' : opt.formattedValidPeriod;
          return `사양: ${opt.plateMasterInfo?.label || ''}(${opt.plateMasterInfo?.size || ''}) / 인증: ${opt.certType || ''} / 등급: ${opt.certLevel || ''} / 유효기간: ${period}`;
        })();
      } else if (item.category === 'JEBON') {
        detailSpec = `판형: ${opt.jebonSize || 'A4'} / 표지: ${opt.coverColor || ''}(${opt.coverPageCount || 0}p) / 본문: ${opt.innerColor || ''}(${opt.innerPageCount || 0}p) / 단계: ${opt.certPhase || ''} / 지정일: ${opt.formattedCompDate || '해당없음'}`;
      } else if (item.category === 'PRINT') {
        detailSpec = `품목: ${opt.printCustomName || opt.printItemType || ''} / 인쇄문구1: ${opt.printItemDetails || ''} / 인쇄문구2: ${opt.printDeliveryDetails || ''}`;
      } else if (item.category === 'OFFICE_SUPPLIES') {
        detailSpec = `견적 텍스트 내역 존재`;
      }

      return [
        item.postNumber,
        getCategoryLabel(item.category),
        `"${(opt.vendor || '-').replace(/"/g, '""')}"`,
        getKSTDateString(item.createdAt),
        `"${(item.deptName || '').replace(/"/g, '""')}"`,
        `"${(item.userName || '').replace(/"/g, '""')}"`,
        item.quantity,
        item.estimatedPrice,
        `"${detailSpec.replace(/"/g, '""')}"`,
        `"${(opt.receiverName || '-').replace(/"/g, '""')}"`,
        `"${(opt.receiverPhone || '-').replace(/"/g, '""')}"`,
        `"${(opt.shippingAddress || '-').replace(/"/g, '""')}"`,
      ].join(',');
    });

    const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `나의_제작신청_이력대장_${selectedIds.length > 0 ? '선택분' : '전체분'}.csv`;
    link.click();
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs — survey/general/my-submissions와 동일 */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2.5">
            MY PRODUCTION REQUESTS & HISTORY
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-indigo-400 font-normal">{currentUser?.name || '임직원'} 님</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-extrabold">나의 신청 이력</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            본인 계정으로 신청한 맞춤 제작물 이력을 조회합니다.
          </p>
        </div>
      </div>

      {/* 탭 네비게이션 구조화 */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-2xl mt-4">
        {[
          { name: '✍️ 신규 제작물 신청', path: '/asset/production/apply/request' },
          { name: '📂 나의 신청 이력 관리', path: '/asset/production/apply/history' },
        ].map((tab) => {
          const isActive = pathname === tab.path;
          return (
            <Link
              key={tab.path}
              href={tab.path}
              className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${
                isActive
                  ? 'bg-white text-blue-600 shadow-sm border border-blue-200/50 scale-[1.01]'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>

      {/* 카테고리 서류철 탭 + 테이블 — dept-master/order와 동일 */}
      <div className="w-full pt-2">
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
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">개인 신청 내역 관리 대장</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
              {filteredHistories.length}건
            </span>
            {selectedIds.length > 0 && (
              <span className="text-[10px] font-black text-blue-600 ml-2 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                {selectedIds.length}개 선택됨
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden group-hover/filter:block whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg"
              >
                연도 → 월 · 연계필터
              </span>

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

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
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
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
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
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
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
                {paginatedHistories.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-16 text-center text-slate-400 text-xs">
                      신청 가드 범위 내에 해당하는 내역이 존재하지 않습니다.
                    </td>
                  </tr>
                ) : (
                  paginatedHistories.map((item: any, idx: number) => {
                    const rowNo =
                      filteredHistories.length - ((currentPage - 1) * ITEMS_PER_PAGE + idx);
                    const isPending = item.status === 'PENDING';
                    const statusLabel =
                      item.status === 'PENDING'
                        ? '대기중'
                        : item.status === 'ACCEPTED'
                          ? '발주대기'
                          : item.status === 'ORDERED'
                            ? '발주완료'
                            : item.status === 'VERIFIED'
                              ? '정산승인'
                              : item.status === 'REJECTED'
                                ? '반려'
                                : item.status === 'CANCELLED'
                                  ? '취소됨'
                                  : item.status;
                    // businesscard/master/requests 공정상태 색상 톤과 통일
                    const statusClass =
                      item.status === 'PENDING'
                        ? 'text-orange-600'
                        : item.status === 'ACCEPTED'
                          ? 'text-blue-600'
                          : item.status === 'ORDERED'
                            ? 'text-emerald-600'
                            : item.status === 'VERIFIED'
                              ? 'text-purple-700'
                              : item.status === 'REJECTED'
                                ? 'text-red-600'
                                : item.status === 'CANCELLED'
                                  ? 'text-slate-400'
                                  : 'text-slate-500';
                    const actionHint =
                      item.status === 'ACCEPTED'
                        ? '발주 대기'
                        : item.status === 'ORDERED'
                          ? '명세 검수 대기'
                          : item.status === 'VERIFIED'
                            ? '완료'
                            : item.status === 'REJECTED'
                              ? '반려됨'
                              : item.status === 'CANCELLED'
                                ? '취소됨'
                                : '-';
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
                        {isPending ? (
                          <button
                            type="button"
                            onClick={() => openDetail(item)}
                            className="px-2.5 py-1 text-[10px] font-bold rounded-lg shadow-sm transition-colors bg-rose-600 text-white hover:bg-rose-700"
                          >
                            원문 검수
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openDetail(item)}
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
                        {item.options?.vendor || '-'}
                      </td>
                      <td className="px-2 text-center">
                        <span className={`text-[10px] font-bold whitespace-nowrap ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-2 text-center">
                        {isPending ? (
                          <button
                            type="button"
                            disabled={cancellingId === item.id}
                            onClick={() => handleCancel(item)}
                            className="px-2 py-1 text-[10px] font-black rounded-lg transition-colors bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600 disabled:opacity-50"
                          >
                            {cancellingId === item.id ? '처리중…' : '신청취소'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-bold whitespace-nowrap">
                            {actionHint}
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

        {/* 페이징 패널 — 일반소모품 부서 페이지와 동일 스타일 */}
        {!loading && filteredHistories.length > 0 && (
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

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          allowEdit
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
