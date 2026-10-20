'use client';

import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTYearMonth, getKSTNowYearMonth } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';

const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      {/* 굵기·색: globals.css (HeaderLight / table.w-full 공통) */}
      <h2 className="text-sm tracking-tight">{title}</h2>
      <span className="text-[11px] font-medium bg-slate-300/80 text-[#333333] px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);

function getDistBusinessDate(d: { dist_date?: string | Date | null; createdAt?: string | Date | null }) {
  return d.dist_date || d.createdAt || null;
}

/** 승인 완료 후 3일(KST) 이내 — 최근 승인 하이라이트 */
function isRecentlyApproved(d: { status?: string | null; approved_at?: string | Date | null }, withinDays = 3) {
  if (d.status === 'PENDING' || d.status === 'REJECTED' || !d.approved_at) return false;
  const approvedYmd = getKSTDateString(d.approved_at);
  const todayYmd = getKSTDateString();
  if (!approvedYmd || !todayYmd) return false;
  const a = new Date(`${approvedYmd}T12:00:00+09:00`).getTime();
  const t = new Date(`${todayYmd}T12:00:00+09:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(t)) return false;
  const diffDays = Math.floor((t - a) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays < withinDays;
}

async function readApiError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}


const DEFAULT_GROUPWARE_SHORTCUT_URL =
  'https://ep.kpcqa.or.kr/ea/edoc/eapproval/docCommonDrafWrite.do?template_key=8';
const GROUPWARE_SHORTCUT_STORAGE_KEY_PREFIX = 'mkt_groupware_shortcut_url:';

function groupwareStorageKey(userKey: string) {
  return `${GROUPWARE_SHORTCUT_STORAGE_KEY_PREFIX}${String(userKey || 'anon').trim().toLowerCase()}`;
}

function RegisterContent() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { year: kstYear } = getKSTNowYearMonth();

  const [searchItemQuery, setSearchItemQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(kstYear.toString());
  // 🚀 [1] 월(달) 조회 필터 상태 추가
  const [selectedMonth, setSelectedMonth] = useState('ALL'); 
  const [itemOwnerFilter, setItemOwnerFilter] = useState('ALL');
  const [groupwareShortcutUrl, setGroupwareShortcutUrl] = useState(DEFAULT_GROUPWARE_SHORTCUT_URL);
  const [groupwareShortcutEditor, setGroupwareShortcutEditor] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  /** 비고(사용 목적/배포처 등) 인라인 편집 초안 */
  const [purposeDrafts, setPurposeDrafts] = useState<Record<string, string>>({});
  const [purposeSavingId, setPurposeSavingId] = useState<string | null>(null);

  const fetchMyDistributions = async () => {
    const dRes = await fetch(`/api/marketing/distributions?mine=1&t=${Date.now()}`);
    if (dRes.ok) setDistributions(await dRes.json());
    else {
      setDistributions([]);
      throw new Error(await readApiError(dRes, '지급 이력 로드 실패'));
    }
  };

  useEffect(() => {
    const initData = async () => {
      setLoadError(null);
      try {
        const ts = Date.now();
        const uRes = await fetch('/api/auth/me?t=' + ts);

        const failed: string[] = [];
        if (!uRes.ok) failed.push('사용자');

        let user: any = null;
        if (uRes.ok) {
          user = await uRes.json();
          setCurrentUser(user);
        }

        if (user?.email) {
          try {
            await fetchMyDistributions();
          } catch {
            failed.push('지급이력');
          }
        }

        if (failed.length > 0) {
          setLoadError(
            uRes.status === 401
              ? '로그인 세션이 만료되었거나 권한이 없습니다.'
              : uRes.status === 403
                ? '마케팅 메뉴 접근 권한이 없습니다.'
                : `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')})`
          );
        }
      } catch (e) {
        console.error('초기 데이터 로드 실패:', e);
        setLoadError('네트워크 오류로 데이터를 불러오지 못했습니다.');
      }
      setLoading(false);
    };
    initData();
  }, []);

  useEffect(() => {
    const userKey = String(currentUser?.email || '').trim().toLowerCase();
    if (!userKey) return;

    try {
      const stored = localStorage.getItem(groupwareStorageKey(userKey));
      if (stored) setGroupwareShortcutUrl(stored);
    } catch {}

    fetch(`/api/marketing/settings?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const url = String(data?.groupwareShortcutUrl || '').trim();
        if (!url) return;
        setGroupwareShortcutUrl(url);
        try {
          localStorage.setItem(groupwareStorageKey(userKey), url);
        } catch {}
      })
      .catch(() => {});
  }, [currentUser?.email]);

  const handleSaveGroupwareShortcut = async () => {
    if (groupwareShortcutEditor == null) return;
    const next = groupwareShortcutEditor.trim() || DEFAULT_GROUPWARE_SHORTCUT_URL;
    const userKey = String(currentUser?.email || '').trim().toLowerCase();
    setGroupwareShortcutUrl(next);
    if (userKey) {
      try {
        localStorage.setItem(groupwareStorageKey(userKey), next);
      } catch {}
    }
    try {
      const res = await fetch('/api/marketing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupwareShortcutUrl: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || '서버 저장 실패');
      }
    } catch (error: any) {
      alert(`이 PC에는 저장했습니다. 서버 반영은 실패했습니다.\n${error.message || ''}`);
    }
    setGroupwareShortcutEditor(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('예약을 취소하시겠습니까?\n(취소 시 카탈로그 재고가 복구됩니다.)')) return;
    const res = await fetch(`/api/marketing/distributions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert('재고 예약이 정상적으로 취소되었습니다.');
      setDistributions((prev) => prev.filter((d) => d.id !== id));
    } else {
      alert(await readApiError(res, '예약 취소 실패'));
    }
  };

  const purposeValue = (d: { id: string; purpose?: string | null }) =>
    purposeDrafts[d.id] !== undefined ? purposeDrafts[d.id] : String(d.purpose || '');

  const savePurpose = async (d: { id: string; purpose?: string | null }) => {
    const next = purposeValue(d).trim();
    const prev = String(d.purpose || '').trim();
    if (next === prev) {
      setPurposeDrafts((s) => {
        const { [d.id]: _, ...rest } = s;
        return rest;
      });
      return;
    }
    setPurposeSavingId(d.id);
    try {
      const res = await fetch('/api/marketing/distributions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: d.id, purpose: next }),
      });
      if (res.ok) {
        setDistributions((list) =>
          list.map((row) => (row.id === d.id ? { ...row, purpose: next } : row))
        );
        setPurposeDrafts((s) => {
          const { [d.id]: _, ...rest } = s;
          return rest;
        });
      } else {
        alert(await readApiError(res, '비고 저장 실패'));
      }
    } catch {
      alert('통신 오류가 발생했습니다.');
    } finally {
      setPurposeSavingId(null);
    }
  };

  const availableYears = useMemo(() => {
    const years = distributions
      .map((d) => getKSTYearMonth(getDistBusinessDate(d) as string)?.year?.toString())
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const cur = getKSTNowYearMonth().year.toString();
    if (!unique.includes(cur)) unique.push(cur);
    return unique;
  }, [distributions]);

  const availableItemOwners = useMemo(() => {
    return Array.from(new Set(distributions.map((d) => d.item?.owner_dept || '미지정'))).sort((a, b) =>
      a.localeCompare(b, 'ko')
    );
  }, [distributions]);

  const baseFilteredList = useMemo(() => {
    return distributions
      .filter((d) => {
        const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
        const yearMatch = selectedYear === 'ALL' || (ym && ym.year.toString() === selectedYear);

        const dMonth = ym ? String(ym.month).padStart(2, '0') : '';
        const monthMatch = selectedMonth === 'ALL' || dMonth === selectedMonth;

        const ownerMatch =
          itemOwnerFilter === 'ALL' || (d.item?.owner_dept || '미지정') === itemOwnerFilter;

        const q = searchItemQuery.trim().toLowerCase();
        const textMatch =
          !q ||
          (d.item?.name || '').toLowerCase().includes(q) ||
          (d.purpose || '').toLowerCase().includes(q);

        return yearMatch && monthMatch && ownerMatch && textMatch;
      })
      // 신청 쌓인 순(최신 createdAt 위) — 순번은 이 순서 기준 reverseNo
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [distributions, selectedYear, selectedMonth, itemOwnerFilter, searchItemQuery]);

  const finalFilteredList = baseFilteredList;

  const totalPages = Math.max(1, Math.ceil(finalFilteredList.length / itemsPerPage));
  const paginatedList = finalFilteredList.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedYear, selectedMonth, itemOwnerFilter, searchItemQuery]);

  const toggleAll = () => {
    const currentPageIds = paginatedList.map((d) => d.id);
    const allSelected =
      currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach((id) => next.delete(id));
    else currentPageIds.forEach((id) => next.add(id));
    setSelectedIds(next);
  };

  const handleDownloadExcel = () => {
    // 선택 시에도 화면 연·월·검색 필터(finalFilteredList)와 교집합 — 범위 밖 ID 혼입 방지
    const targetList =
      selectedIds.size > 0
        ? finalFilteredList.filter((d) => selectedIds.has(d.id))
        : finalFilteredList;

    if (targetList.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const exportData = targetList.map((d) => ({
      '재고신청일': getKSTDateString(d.createdAt),
      '물품소속': d.item?.owner_dept || '-',
      '물품명': d.item?.name || '(삭제됨)',
      '개수': d.status === 'REJECTED' ? '' : d.qty,
      '신청자': d.sender_name,
      '소속부서': d.sender_dept,
      '비고 (사용 목적 / 배포처 등)': d.purpose || '',
      '상태':
        d.status === 'REJECTED'
          ? '취소'
          : d.status === 'PENDING'
            ? '예약대기'
            : d.approved_at
              ? '예약확정'
              : '예약확정',
      '취소사유': d.reject_reason || '',
      '신청자이메일': d.sender_email || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '지급이력대장');
    XLSX.writeFile(
      wb,
      `지급이력대장_${selectedYear}년_${currentUser?.name || '관리자'}.xlsx`
    );
  };

  if (loading) return <LoadingState />;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[10px] font-medium uppercase tracking-widest text-indigo-400 mb-2.5">
              GIFT DISTRIBUTION MANAGEMENT
            </h3>
            <h1 className="text-2xl tracking-tight leading-none">
              <span className="text-indigo-400 font-normal">{currentUser?.name || '임직원'} 님</span>
              <span className="text-white/30 font-normal mx-2.5">|</span>
              <span className="text-white font-extrabold">기념품 재고 예약 내역</span>
            </h1>
            <p className="text-slate-400 text-xs mt-3 leading-relaxed">
              카탈로그에서 예약한 기념품의 개인별 지급·예약 이력을 관리합니다.
            </p>
          </div>
          <div className="shrink-0 self-start md:self-end flex items-stretch gap-1.5">
            <a
              href={groupwareShortcutUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="그룹웨어 기념품 지급 신청서 바로가기"
              className="group inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl font-medium text-[12px] bg-amber-200 text-indigo-950 shadow-lg shadow-black/30 ring-1 ring-amber-100/80 hover:bg-amber-300 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
            >
              그룹웨어 기념품 지급 신청서
              <span className="text-amber-700 group-hover:text-indigo-900 transition-colors">↗</span>
            </a>
            <div className="relative group/gwsettings">
              <button
                type="button"
                onClick={() => setGroupwareShortcutEditor(groupwareShortcutUrl)}
                aria-label="그룹웨어 바로가기 경로 설정"
                className="h-full min-h-[42px] px-3 rounded-xl bg-white/10 border border-white/20 text-white text-[13px] font-medium hover:bg-white/20 transition-colors"
              >
                ⚙
              </button>
              <span
                role="tooltip"
                className="pointer-events-none absolute right-0 bottom-full mb-2 z-[60] hidden group-hover/gwsettings:block w-[260px] rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-[10px] font-normal text-slate-900 shadow-xl leading-relaxed"
              >
                <span className="block text-slate-900">개인별로 그룹웨어 경로를 설정하세요.</span>
                <span className="block mt-1 text-slate-600 font-medium">
                  그룹웨어 전자결재 &gt; 공통 &gt; 기념품 지급 신청서
                </span>
                <span className="absolute right-3 top-full border-[6px] border-transparent border-t-slate-100" />
              </span>
            </div>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-normal flex justify-between items-center gap-4 shadow-sm">
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-medium hover:bg-amber-700"
          >
            새로고침
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <HeaderLight title="나의 지급 이력 대장" count={finalFilteredList.length}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 h-8 bg-white px-3 rounded-lg border border-slate-200 shadow-sm box-border">
              <span className="text-[10px] font-medium text-slate-400 uppercase">물품소속</span>
              <select
                value={itemOwnerFilter}
                onChange={(e) => setItemOwnerFilter(e.target.value)}
                className="h-full text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
              >
                <option value="ALL">전체</option>
                {availableItemOwners.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

              <span className="text-[10px] font-medium text-slate-400 uppercase">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="h-full text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

              <span className="text-[10px] font-medium text-slate-400 uppercase">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-full text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-40">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none">📦</span>
                <input
                  type="text"
                  placeholder="물품명·비고 검색..."
                  value={searchItemQuery}
                  onChange={(e) => setSearchItemQuery(e.target.value)}
                  className="w-full h-8 box-border pl-7 pr-3 bg-white border border-slate-200 rounded-lg text-[11px] font-normal outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadExcel}
                className="h-8 box-border px-3 inline-flex items-center bg-emerald-600 text-white rounded-lg text-[11px] font-medium shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap leading-none"
              >
                {selectedIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
            </div>
          </div>
        </HeaderLight>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1280px] xl:min-w-full">
            {/* 머리글/본문 굵기·색: globals.css table.w-full 공통 */}
            <thead className="bg-slate-100 text-[11px] border-b border-slate-200">
              <tr>
                <th className="h-12 pl-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      paginatedList.length > 0 &&
                      paginatedList.every((d) => selectedIds.has(d.id))
                    }
                    onChange={toggleAll}
                    className="w-3 h-3 accent-indigo-600 cursor-pointer"
                  />
                </th>
                <th className="h-12 px-2 w-10 text-center">NO</th>
                <th className="h-12 px-2 w-[88px] text-center whitespace-nowrap">재고신청일</th>
                <th className="h-12 px-2 w-24 text-left whitespace-nowrap">물품소속</th>
                <th className="h-12 px-2 w-36 text-left text-indigo-700">물품명</th>
                <th className="h-12 px-2 w-14 text-center whitespace-nowrap">수량</th>
                <th className="h-12 px-2 w-32 text-left whitespace-nowrap">신청자</th>
                <th className="h-12 px-2 w-52 text-left whitespace-nowrap" title="비고 (사용 목적 / 배포처 등)">
                  비고 (사용 목적 / 배포처 등)
                </th>
                <th className="h-12 px-2 w-20 text-center whitespace-nowrap">상태</th>
                <th className="h-12 pr-4 text-center w-36 whitespace-nowrap">관리기능</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px]">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-16 text-center text-slate-400 text-xs">
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                paginatedList.map((d, idx) => {
                  const isSelected = selectedIds.has(d.id);
                  const reqDate = getKSTDateString(d.createdAt);
                  const isPending = d.status === 'PENDING';
                  const isRejected = d.status === 'REJECTED';
                  const isRecentApproved = isRecentlyApproved(d);

                  const reverseNo = finalFilteredList.length - ((currentPage - 1) * itemsPerPage + idx);
                  // 예약대기 · 승인 없이 즉시 확정(자기부서)만 신청자 취소 · 승인 후 확정은 부서 관리자 취소
                  const canCancel =
                    isPending || (d.status === 'CONFIRMED' && !d.approved_at);

                  return (
                    <tr
                      key={d.id}
                      className={`transition-colors h-12 ${
                        isRejected
                          ? isSelected
                            ? 'bg-slate-200/80 text-red-500 [&_td]:text-red-500 [&_td]:line-through'
                            : 'bg-slate-100/80 text-red-500 hover:bg-slate-100 [&_td]:text-red-500 [&_td]:line-through'
                          : isPending
                            ? isSelected
                              ? 'bg-amber-100/90'
                              : 'bg-amber-50 hover:bg-amber-100/80'
                            : isRecentApproved
                              ? isSelected
                                ? 'bg-emerald-100/90'
                                : 'bg-emerald-50 hover:bg-emerald-100/80'
                              : isSelected
                                ? 'bg-indigo-50/50'
                                : 'hover:bg-slate-50/50'
                      }`}
                    >
                      <td className="pl-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const next = new Set(selectedIds);
                            next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                            setSelectedIds(next);
                          }}
                          className="w-3 h-3 accent-indigo-600 cursor-pointer"
                        />
                      </td>
                      <td
                        className="px-2 text-center font-mono text-slate-500 tabular-nums !text-slate-500 !no-underline"
                        style={isRejected ? { textDecoration: 'none' } : undefined}
                      >
                        {reverseNo}
                      </td>
                      <td className={`px-2 text-center whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-[#333333]'}`}>{reqDate}</td>
                      <td className="px-2 text-left">
                        <span className={`inline-block border px-1.5 py-0.5 rounded text-[10px] font-normal whitespace-nowrap ${isRejected ? 'bg-transparent border-red-200 text-red-500' : 'bg-slate-100 text-[#333333] border-slate-200'}`}>
                          {d.item?.owner_dept || '-'}
                        </span>
                      </td>
                      <td className={`px-2 text-left truncate max-w-[144px] soh-emph ${isRejected ? '' : 'text-indigo-700'}`} title={d.item?.name || ''}>
                        {d.item?.name || '(삭제됨)'}
                      </td>
                      <td className={`px-2 text-center font-mono whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-[#333333]'}`}>
                        {d.qty}
                        <span className={`text-[10px] font-sans ml-0.5 ${isRejected ? '' : 'text-slate-600'}`}>{d.item?.unit || 'EA'}</span>
                      </td>
                      <td className="px-2 text-left truncate">
                        <span
                          className={`text-[10px] block truncate ${isRejected ? '' : 'text-slate-600'}`}
                          title={d.sender_dept || ''}
                        >
                          {d.sender_dept || '-'}
                        </span>
                        <span
                          className={`truncate block ${isRejected ? '' : 'text-[#333333]'}`}
                          title={d.sender_name || ''}
                        >
                          {d.sender_name || '-'}
                        </span>
                      </td>
                      <td
                        className="px-2 text-left !no-underline"
                        style={isRejected ? { textDecoration: 'none' } : undefined}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isRejected ? (
                          <span className="text-slate-500 truncate block font-medium" title={d.purpose || ''}>
                            {d.purpose || '-'}
                          </span>
                        ) : (
                          <input
                            type="text"
                            value={purposeValue(d)}
                            disabled={purposeSavingId === d.id}
                            maxLength={200}
                            placeholder="비고 (사용 목적 / 배포처 등)"
                            onChange={(e) =>
                              setPurposeDrafts((s) => ({ ...s, [d.id]: e.target.value }))
                            }
                            onBlur={() => void savePurpose(d)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                            className="w-full min-w-[9rem] max-w-[12rem] h-8 px-2 bg-white border border-slate-200 rounded-lg text-[11px] outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 disabled:opacity-60"
                          />
                        )}
                      </td>
                      <td className="px-2 text-center whitespace-nowrap !no-underline" style={isRejected ? { textDecoration: 'none' } : undefined}>
                        {isRejected ? (
                          <span className="inline-flex flex-col items-center leading-tight" title={d.reject_reason || ''}>
                            <span className="inline-block font-medium text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded text-[10px]">
                              취소
                            </span>
                            {d.reject_reason ? (
                              <span className="text-[9px] font-normal text-red-400 truncate max-w-[88px] mt-0.5">
                                {d.reject_reason}
                              </span>
                            ) : null}
                          </span>
                        ) : isPending ? (
                          <span className="inline-block font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[10px]">
                            예약대기
                          </span>
                        ) : d.approved_at ? (
                          <span className="inline-block font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded text-[10px]">
                            예약확정
                          </span>
                        ) : (
                          <span className="text-[11px] font-normal text-slate-400" title="공유 승인 없이 즉시 예약된 건">
                            예약확정
                          </span>
                        )}
                      </td>

                      {/* 결재용 복사 & 예약 취소 */}
                      <td
                        className="pr-4 text-center !text-slate-700 !no-underline"
                        style={isRejected ? { textDecoration: 'none', color: 'inherit' } : undefined}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isRejected ? (
                          <span className="text-[10px] text-slate-300 font-normal">-</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const giftName = d.item?.name || '기념품명';
                                const date =
                                  d.status === 'PENDING'
                                    ? '지급대기'
                                    : getKSTDateString(getDistBusinessDate(d) as string);
                                const qty = d.qty || 1;
                                const purpose = purposeValue(d).trim() || '(비고)';
                                const textToCopy = `[선물명] ${giftName}\n[재고신청일] ${reqDate || date}\n[비고] ${purpose}\n[업체명] (회사명 / 성함 직급)\n[신청개수] ${qty}개`;
                                navigator.clipboard.writeText(textToCopy).then(() => {
                                  alert(
                                    '✅ 결재용 텍스트가 복사되었습니다!\n\n업체명 부분을 실제 고객사·담당자 정보로 수정 후 결재를 올리세요.'
                                  );
                                }).catch(() => {
                                  alert('복사에 실패했습니다.');
                                });
                              }}
                              className="flex-1 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-md text-[10px] font-medium hover:bg-indigo-600 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                            >
                              결재용 복사
                            </button>
                            {canCancel ? (
                              <button
                                type="button"
                                onClick={() => handleDelete(d.id)}
                                className="flex-1 py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[10px] font-medium hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                              >
                                예약 취소
                              </button>
                            ) : (
                              <span className="flex-1 text-[10px] text-slate-300 font-normal">-</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {finalFilteredList.length > 0 && (
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

    {groupwareShortcutEditor != null && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <h3 className="text-base font-medium text-slate-900">그룹웨어 바로가기 경로 설정</h3>
          <p className="mt-2 text-[11px] font-normal leading-relaxed text-slate-500">
            개인별로 그룹웨어 경로를 설정하세요. 본인 계정에만 저장됩니다.
            <br />
            <span className="text-indigo-600">
              그룹웨어 전자결재 &gt; 공통 &gt; 기념품 지급 신청서
            </span>
          </p>
          <input
            type="text"
            value={groupwareShortcutEditor}
            onChange={(e) => setGroupwareShortcutEditor(e.target.value)}
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-indigo-400"
            placeholder={DEFAULT_GROUPWARE_SHORTCUT_URL}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setGroupwareShortcutEditor(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600">취소</button>
            <button type="button" onClick={handleSaveGroupwareShortcut} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white">저장</button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

export default function RegisterModule() {
  return <RegisterContent />;
}