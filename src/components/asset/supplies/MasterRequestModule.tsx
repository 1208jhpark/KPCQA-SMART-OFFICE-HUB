'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import {
  isCompletedSupplyRequest,
  isPendingSupplyRequest,
  isRejectedSupplyRequest,
  normalizeSupplyRequestStatus,
  supplyRequestStatusLabel,
} from '@/utils/supplyRequestStatus';
import LoadingState from '@/components/common/LoadingState';
import * as XLSX from 'xlsx';

const MENU_PATH = '/asset/supplies/master/requests';

/** KST 기준 연·월 문자열 (year: '2026', month: '07') — 파싱 실패 시 null */
function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return {
    year: String(ym.year),
    month: String(ym.month).padStart(2, '0'),
  };
}
     
function MasterRequestContent({ currentUser: propUser }: { currentUser?: any }) {
  const pathname = usePathname();
  
  // 데이터 상태 관리
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(propUser || null);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  
  // 하단 장부 상태 관리
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchItemQuery, setSearchItemQuery] = useState('');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL'); 
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [processOpinion, setProcessOpinion] = useState<{ [key: string]: string }>({});
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 🚀 상단 통계 전용 필터 상태
  const [statYear, setStatYear] = useState('ALL');
  const [statMonth, setStatMonth] = useState('ALL');
  const [statDept, setStatDept] = useState('ALL');
     
  const tabItems = [
    { id: 'dashboard', name: '🗂️ 소모품 마스터 대시보드', path: '/asset/supplies/master/dashboard' },
    { id: 'requests', name: '📋 사용자 신청현황 관리', path: '/asset/supplies/master/requests' },
    { id: 'purchase', name: '💰 입고/구매 내역 대장', path: '/asset/supplies/master/purchase' },
    { id: 'archive', name: '📁 폐기자산 아카이브', path: '/asset/supplies/master/archive' },
  ];
     
  useEffect(() => { 
    fetchRequestsData(); 
  }, []);
     
  const fetchRequestsData = async () => {
    setLoading(true);
    try { 
      const ts = Date.now();
      const [reqRes, userRes, summaryRes] = await Promise.all([
        fetch(`/api/asset/supplies/master/requests?t=${ts}`, { cache: 'no-store' }),
        !propUser ? fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }) : Promise.resolve(null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
      ]);
      
      if (reqRes.ok) {
        setRequests(await reqRes.json());
      } else if (reqRes.status === 401 || reqRes.status === 403) {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '신청현황 관리 권한이 없습니다.');
      }
      if (!propUser && userRes?.ok) setCurrentUser(await userRes.json());
      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);
    } catch(e) {
      console.error("Requests Sync Error", e);
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };
     
  const isLV1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : [currentUser.role];
    return roles?.includes('LV_1');
  }, [currentUser]);
     
  // 장부 필터용 옵션 (Asia/Seoul)
  const availableYears = useMemo(() => {
    const years = requests
      .map((r) => getKSTYearMonthParts(r.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [requests]);
  const availableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const availableDepts = useMemo(() => {
    const depts = requests.map(r => r.dept_name).filter(Boolean);
    return Array.from(new Set(depts)).sort();
  }, [requests]);

  // 부서별 소모품 지급 통계 — 지급완료 신청 내역의 물품명 기준 (dashboard items 비의존)
  const processedStatsTable = useMemo(() => {
    const baseApprovedRequests = requests.filter(r => {
      if (!isCompletedSupplyRequest(r.status)) return false;
      const ym = getKSTYearMonthParts(r.createdAt);
      if (!ym) return false;
      if (statYear !== 'ALL' && ym.year !== statYear) return false;
      if (statMonth !== 'ALL' && ym.month !== statMonth) return false;
      return true;
    });

    const byItem = new Map<string, {
      id: string;
      name: string;
      rUnit: string;
      totalAccumQty: number;
      deptQty: number;
    }>();

    baseApprovedRequests.forEach((r) => {
      const name = r.item_name || r.item?.name || '(삭제된 물품)';
      const key = r.item_id || `name:${name}`;
      let ext: any = {};
      try {
        ext = r.item?.description ? JSON.parse(r.item.description) : {};
      } catch {
        ext = {};
      }
      const rUnit = r.unit || ext.s_unit || ext.r_unit || 'EA';
      const qty = Number(r.qty) || 0;
      const deptMatch = statDept === 'ALL' || r.dept_name === statDept;

      const row = byItem.get(key) || {
        id: key,
        name,
        rUnit,
        totalAccumQty: 0,
        deptQty: 0,
      };
      row.totalAccumQty += qty;
      if (deptMatch) row.deptQty += qty;
      byItem.set(key, row);
    });

    return Array.from(byItem.values())
      .filter((row) => row.totalAccumQty > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((row) => ({
        ...row,
        ratio: row.totalAccumQty > 0
          ? ((row.deptQty / row.totalAccumQty) * 100).toFixed(1)
          : '0.0',
      }));
  }, [requests, statYear, statMonth, statDept]);
     
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      const ym = getKSTYearMonthParts(r.createdAt);
      const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      const deptMatch = selectedDept === 'ALL' || r.dept_name === selectedDept;
      
      const isPending = isPendingSupplyRequest(r.status);
      const isCompleted = isCompletedSupplyRequest(r.status);
      const isRejected = isRejectedSupplyRequest(r.status);
      
      const statusMatch = selectedStatus === 'ALL' || 
                         (selectedStatus === 'PENDING' && isPending) ||
                         (selectedStatus === 'COMPLETED' && isCompleted) ||
                         (selectedStatus === 'REJECTED' && isRejected);
     
      const itemName = r.item_name || r.item?.name || '';
      const itemMatch = !searchItemQuery ||
        itemName.toLowerCase().includes(searchItemQuery.toLowerCase());
      const userMatch = !searchUserQuery ||
        (r.user_name || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      
      return yearMatch && monthMatch && deptMatch && statusMatch && itemMatch && userMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, selectedYear, selectedMonth, selectedDept, selectedStatus, searchItemQuery, searchUserQuery]);
     
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  useEffect(() => { setCurrentPage(1); }, [selectedYear, selectedMonth, selectedDept, selectedStatus, searchItemQuery, searchUserQuery]);
     
  const toggleSelectAll = () => {
    const currentPageIds = paginatedRequests.map(r => r.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id)); else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  };

  const handleExportExcel = () => {
    const target = selectedIds.size > 0
      ? filteredRequests.filter((r) => selectedIds.has(r.id))
      : filteredRequests;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const exportData = target.map((r, idx) => {
      let sUnit = '';
      try {
        const itemExt = r.item?.description ? JSON.parse(r.item.description) : {};
        sUnit = r.unit || itemExt.s_unit || itemExt.r_unit || '';
      } catch (e) {}

      const itemName = r.item_name || r.item?.name || '';
      return {
        NO: target.length - idx,
        신청일시: formatDateTime(r.createdAt),
        소속조직: r.dept_name || '',
        신청자: r.user_name || '',
        물품명: itemName,
        신청수량: sUnit ? `${r.qty} ${sUnit}` : r.qty,
        '사용자 의견': r.note || '',
        '관리자 답변': r.admin_opinion || '',
        처리자: r.admin_name || '',
        처리일시: r.processedAt ? formatDateTime(r.processedAt) : '',
        상태: supplyRequestStatusLabel(r.status),
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '사용자신청내역');

    const monthStr = selectedMonth !== 'ALL' ? `_${selectedMonth}월` : '';
    const deptStr = selectedDept !== 'ALL' ? `_${selectedDept}` : '';
    const statusStr = selectedStatus !== 'ALL' ? `_${selectedStatus}` : '';
    XLSX.writeFile(
      wb,
      `소모품_사용자신청현황_${selectedYear === 'ALL' ? '전체' : selectedYear}년${monthStr}${deptStr}${statusStr}.xlsx`
    );
  };
     
  // 상태 변경 — 재고 복구/재차감은 서버가 이전 status 기준으로 처리
  const handleProcessRequest = async (req: any, status: 'COMPLETED' | 'REJECTED') => {
    const reqId = req.id;
    if (processingId) return;
    const opinion = processOpinion[reqId] || '';
    if (!confirm(status === 'COMPLETED' ? '지급 처리하시겠습니까?' : '요청을 반려하시겠습니까?\n(선차감된 재고가 다시 창고로 복구됩니다.)')) return;
    
    setProcessingId(reqId);
    try {
      const res = await fetch('/api/asset/supplies/master/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reqId, status, admin_opinion: opinion })
      });
     
      if (res.ok) { 
        alert(status === 'COMPLETED' ? '✅ 지급 확정 완료' : '🚨 반려 및 재고 복구 완료'); 
        fetchRequestsData(); 
        setProcessOpinion({...processOpinion, [reqId]: ''}); 
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 처리 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) { alert("처리 중 오류가 발생했습니다."); }
    finally { setProcessingId(null); }
  };
     
  const handleCancelDispense = async (req: any) => {
    if (processingId) return;
    if (!confirm(`[경고] 지급철회 하시겠습니까?\n상태가 다시 '대기'로 변경됩니다.\n(선차감 재고는 대기 중에도 유지됩니다.)`)) return;
    
    setProcessingId(req.id);
    try {
      const res = await fetch('/api/asset/supplies/master/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: req.id, status: 'PENDING', admin_opinion: '지급철회(대기 상태로 원복)'
        })
      });
     
      if (res.ok) { 
        alert('✅ 지급철회가 완료되었습니다. (대기 상태로 원복)'); 
        fetchRequestsData(); 
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 지급철회 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) { alert("처리 중 오류가 발생했습니다."); }
    finally { setProcessingId(null); }
  };
     
  const handleDeleteRequest = async (req: any) => {
    if (processingId) return;

    const status = normalizeSupplyRequestStatus(req.status);
    const isCompleted = status === 'COMPLETED';

    if (isCompleted && !isLV1) {
      return alert('지급완료 건 삭제는 LV_1만 가능합니다.');
    }

    const confirmMsg = isCompleted
      ? '경고: 지급완료 건을 영구 삭제하시겠습니까? (LV_1)\n삭제 시 선차감 재고가 창고로 복구됩니다.'
      : '경고: 해당 신청 내역을 영구 삭제하시겠습니까?\n대기 건은 선차감 재고가 창고로 복구됩니다.';
    if (!confirm(confirmMsg)) return;
    
    setProcessingId(req.id);
    try {
      const res = await fetch(`/api/asset/supplies/master/requests?id=${req.id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('🗑️ 삭제되었습니다.');
        fetchRequestsData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 삭제 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) { alert("서버 통신 오류가 발생했습니다."); }
    finally { setProcessingId(null); }
  };
     
  if (loading) return <LoadingState />;

  // 장부 칩 집계: 조직·연도·월 필터 반영 (상태 칩/검색은 제외)
  const scopedForStatusChips = requests.filter((r) => {
    const ym = getKSTYearMonthParts(r.createdAt);
    const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
    const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
    const deptMatch = selectedDept === 'ALL' || r.dept_name === selectedDept;
    return yearMatch && monthMatch && deptMatch;
  });
  const countAll = scopedForStatusChips.length;
  const countPending = scopedForStatusChips.filter((r) => isPendingSupplyRequest(r.status)).length;
  const countCompleted = scopedForStatusChips.filter((r) => isCompletedSupplyRequest(r.status)).length;
  const countRejected = scopedForStatusChips.filter((r) => isRejectedSupplyRequest(r.status)).length;
  // 탭 배지: 전사 대기건 (필터 무관)
  const tabPendingCount = requests.filter((r) => isPendingSupplyRequest(r.status)).length;
  
  const formatNum = (num: any) => Number(num || 0).toLocaleString();
     
  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* client-search 배너 규격: emerald→teal · orbs · label 10px / title 2xl / desc xs */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
  <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
  <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
  <div className="relative z-10">
    <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
      CENTRAL SUPPLIES CONTROL TOWER
    </h3>
    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
      소모품 마스터 관리 통제실
    </h1>
    <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
      임직원의 소모품 신청내역을 검토하고 승인/반려 등 관리합니다.
    </p>
    {permissionSummary && (
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
          <span>👑 Master 책임자:</span>
          <span>{permissionSummary.masterName}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
          <span>👁️ Access:</span>
          <span>{permissionSummary.accessDesignate}</span>
          <span className="opacity-50">|</span>
          <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
          <span className="opacity-50">|</span>
          <span>Level: {permissionSummary.accessLevel}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
          <span>✍️ Edit:</span>
          <span>{permissionSummary.editDesignate}</span>
          <span className="opacity-50">|</span>
          <span>Level: {permissionSummary.editLevel}</span>
        </div>
      </div>
    )}
  </div>
</div>

      {/* 탭 네비게이션 — client-search / distribution 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabItems.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            const activeColor =
              tab.id === 'purchase' ? 'text-emerald-600' :
              tab.id === 'archive' ? 'text-slate-800' :
              'text-indigo-600';
            const showPendingBadge = tab.id === 'requests' && tabPendingCount > 0;
            return (
              <Link
                key={tab.id}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                  isActive
                    ? `bg-white ${activeColor} shadow-sm border border-slate-200/80`
                    : 'text-slate-500 hover:text-slate-800'
                } ${showPendingBadge && !isActive ? 'ring-1 ring-red-300/80' : ''}`}
              >
                <span>{tab.name}</span>
                {showPendingBadge && (
                  <span className="inline-flex items-center justify-center min-w-[1.35rem] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-black font-mono shadow-sm animate-pulse">
                    {tabPendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden lg:block">
          ※ 탭을 클릭하여 대시보드·신청·입고·아카이브를 전환합니다.
        </p>
      </div>
     
      {/* 🚀 [신규 기능 탑재] 부서별 소모품 지급 통계 보드 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <div className="p-5 bg-slate-100/80 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
            <h2 className="text-[13px] font-black text-slate-800 tracking-tight">📊 부서별 소모품 지급 통계 <span className="text-xs font-normal text-slate-500 ml-1">(지급완료 신청 내역 기준 · 수량/점유율)</span></h2>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <select value={statYear} onChange={(e) => setStatYear(e.target.value)} className="p-2 bg-white border border-slate-300 rounded-xl text-[11px] font-black text-slate-700 outline-none">
              <option value="ALL">전체 연도</option>
              {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={statMonth} onChange={(e) => setStatMonth(e.target.value)} className="p-2 bg-white border border-slate-300 rounded-xl text-[11px] font-black text-slate-700 outline-none">
              <option value="ALL">전체 월</option>
              {availableMonths.map(m => <option key={m} value={m}>{m}월</option>)}
            </select>
            <select value={statDept} onChange={(e) => setStatDept(e.target.value)} className="p-2 bg-white border border-slate-300 rounded-xl text-[11px] font-black text-indigo-700 font-bold outline-none ring-2 ring-indigo-100">
              <option value="ALL">🏢 전체 부서 요약</option>
              {/* 🚀 물품 단위(deptOptions) 대신, 실제 부서 데이터(availableDepts)로 교체 */}
              {availableDepts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr className="text-center">
                <th className="h-12 px-2 w-16">NO</th>
                <th className="h-12 px-2 text-left w-[350px] text-indigo-600">품목명</th>
                <th className="h-12 px-2 w-24">신청단위</th>
                <th className="h-12 px-2 w-36 bg-slate-100">총 누적 지급량(전사)</th>
                <th className="h-12 px-2 bg-indigo-50 text-indigo-800 border-l border-indigo-100">
                  {statDept === 'ALL' ? '전체부서' : `[${statDept}]`} 통계 수량
                </th>
                <th className="h-12 px-2 bg-indigo-900 text-white border-l border-indigo-800">
                  {statDept === 'ALL' ? '전사 통합' : `[${statDept}]`} 점유율 (%)
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {processedStatsTable.length === 0 ? (
                <tr><td colSpan={6} className="p-16 text-center text-slate-400 text-xs">데이터가 존재하지 않습니다.</td></tr>
              ) : (
                processedStatsTable.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50/50 transition-colors text-center h-12">
                    <td className="px-2 font-mono text-slate-500 tabular-nums">{idx + 1}</td>
                    <td className="px-2 text-left text-indigo-700 truncate" title={row.name}>{row.name}</td>
                    <td className="px-2 text-slate-500">{row.rUnit}</td>
                    <td className="px-2 bg-slate-50 font-mono tabular-nums text-slate-800">{formatNum(row.totalAccumQty)}</td>
                    <td className="px-2 bg-indigo-50/30 text-indigo-600 font-mono tabular-nums border-l border-indigo-100">{formatNum(row.deptQty)}</td>
                    <td className="px-2 bg-slate-900/5 font-mono tabular-nums border-l border-indigo-100">
                      <span className={Number(row.ratio) > 50 ? 'text-red-500' : 'text-slate-700'}>
                        {row.ratio}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
     
      <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4 mt-6">
          
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">
                {selectedStatus === 'ALL' ? '사용자 신청 내역 장부' :
                 selectedStatus === 'PENDING' ? '신규 신청 대기건' :
                 selectedStatus === 'COMPLETED' ? '지급 완료건' : '반려 처리건'}
              </h2>
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredRequests.length}건</span>
              <div className="flex items-center gap-1 ml-1">
                <button
                  type="button"
                  onClick={() => setSelectedStatus('ALL')}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                    selectedStatus === 'ALL'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  전체 {countAll}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus((prev) => (prev === 'PENDING' ? 'ALL' : 'PENDING'))}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                    selectedStatus === 'PENDING'
                      ? 'bg-orange-500 text-white'
                      : 'bg-orange-50 text-orange-600 border border-orange-100 hover:bg-orange-100'
                  }`}
                >
                  신규 대기 {countPending}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus((prev) => (prev === 'COMPLETED' ? 'ALL' : 'COMPLETED'))}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                    selectedStatus === 'COMPLETED'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100'
                  }`}
                >
                  지급완료 {countCompleted}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus((prev) => (prev === 'REJECTED' ? 'ALL' : 'REJECTED'))}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                    selectedStatus === 'REJECTED'
                      ? 'bg-red-500 text-white'
                      : 'bg-red-50 text-red-600 border border-red-100 hover:bg-red-100'
                  }`}
                >
                  반려 {countRejected}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">조직</span>
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[160px]"
                >
                  <option value="ALL">전체 부서</option>
                  {availableDepts.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {availableYears.map((year) => (
                    <option key={year} value={year}>{year}년</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">전체</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>{month}월</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative w-40">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">📦</span>
                  <input
                    type="text"
                    placeholder="물품명 검색..."
                    value={searchItemQuery}
                    onChange={(e) => setSearchItemQuery(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                  />
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">👤</span>
                  <input
                    type="text"
                    placeholder="신청자 검색..."
                    value={searchUserQuery}
                    onChange={(e) => setSearchUserQuery(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
              >
                {selectedIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed min-w-[1300px]">
            <colgroup>
              <col className="w-[40px]" />
              <col className="w-[48px]" />
              <col className="w-[90px]" />
              <col className="w-[120px]" />
              <col className="w-[180px]" />
              <col className="w-[100px]" />
              <col className="w-[180px]" />
              <col className="w-[64px]" />
              <col className="w-[180px]" />
              <col className="w-[110px]" />
              <col className="w-[90px]" />
              <col className="w-[128px]" />
            </colgroup>
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 text-center"><input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></th>
                  <th className="h-12 px-2 text-center">NO</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap border-l-4 border-white">신청일시</th>
                  <th className="h-12 px-2">부서 / 신청자</th>
                  <th className="h-12 px-2 text-indigo-600">물품명</th>
                  <th className="h-12 px-2 text-center text-indigo-600 whitespace-nowrap">신청수량</th>
                  <th className="h-12 px-2 border-l-4 border-white">사용자 의견</th>
                  <th className="h-12 px-2 text-center border-l border-slate-300">상태</th>
                  <th className="h-12 px-2 border-l-4 border-white">관리자 답변</th>
                  <th className="h-12 px-2 text-center border-l-4 border-white whitespace-nowrap">부서 / 처리자</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">처리날짜</th>
                  <th className="h-12 px-2 text-center border-l-4 border-white whitespace-nowrap">관리 액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr><td colSpan={12} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 내역이 없습니다.</td></tr>
                ) : paginatedRequests.map((req, i) => {
                  const isPending = isPendingSupplyRequest(req.status);
                  const isRejected = isRejectedSupplyRequest(req.status);
                  const isCompleted = isCompletedSupplyRequest(req.status);
                  const statusLabel = supplyRequestStatusLabel(req.status);
                  const itemName = req.item_name || req.item?.name || '(삭제된 물품)';
                  const itemExt = req.item?.description ? JSON.parse(req.item.description) : {};
                  const sUnit = req.unit || itemExt.r_unit || itemExt.s_unit || 'EA';
                  const processDate = getKSTDateString(req.processedAt) || '-';
                  const createdDate = getKSTDateString(req.createdAt) || '-';
                  const rowNo = filteredRequests.length - ((currentPage - 1) * itemsPerPage + i);
     
                  return (
                    <tr key={req.id} className={`hover:bg-slate-50/50 h-12 transition-colors ${selectedIds.has(req.id) ? 'bg-indigo-50/50' : ''}`}>
                      <td className="pl-4 text-center"><input type="checkbox" checked={selectedIds.has(req.id)} onChange={() => { const next = new Set(selectedIds); selectedIds.has(req.id) ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></td>
                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800 border-l-4 border-white">{createdDate}</td>
                      <td className="px-2 truncate">
                        <span className="text-[10px] text-slate-500 block truncate">{req.dept_name || '-'}</span>
                        <span className="text-slate-800 truncate">{req.user_name || '-'}</span>
                      </td>
                      <td className="px-2 text-indigo-700 truncate" title={itemName}>{itemName}</td>
                      <td className="px-2 text-center font-mono whitespace-nowrap tabular-nums text-indigo-600">
                        {req.qty}
                        <span className="text-[10px] font-sans ml-0.5 text-slate-500">{sUnit}</span>
                      </td>
                      <td className="px-2 text-slate-700 truncate border-l-4 border-white" title={req.note}>{req.note ? `"${req.note}"` : '-'}</td>
                      <td className="px-2 text-center border-l border-slate-300">
                        <span className={`inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                          isPending ? 'bg-orange-50 text-orange-600 border-orange-200' :
                          isRejected ? 'bg-red-50 text-red-600 border-red-200' :
                          'bg-emerald-50 text-emerald-600 border-emerald-200'
                        }`}>
                          {statusLabel === '대기중' ? '대기' : statusLabel}
                        </span>
                      </td>
                      
                      <td className="px-2 border-l-4 border-white">
                        {isPending ? (
                          <input 
                            placeholder="답변..." 
                            value={processOpinion[req.id] || ''} 
                            onChange={(e)=>setProcessOpinion({...processOpinion, [req.id]: e.target.value})} 
                            className="w-full min-w-0 p-1.5 border border-slate-300 rounded-md text-[10px] font-bold text-slate-700 outline-none focus:border-indigo-500 shadow-inner bg-white" 
                          />
                        ) : (
                          <span className="text-slate-700 truncate block w-full" title={req.admin_opinion}>
                            {req.admin_opinion ? `" ${req.admin_opinion} "` : '-'}
                          </span>
                        )}
                      </td>
     
                      <td className="px-2 text-center border-l-4 border-white">
                        {!isPending ? (
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 block truncate">{req.admin_dept || '-'}</span>
                            <span className="text-slate-800 truncate">{req.admin_name || '관리자'}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                        {!isPending ? processDate : <span className="text-slate-300">-</span>}
                      </td>
     
                      <td className="px-2 text-center border-l-4 border-white">
                        {isPending ? (
                          <div className="flex items-center justify-center gap-0.5 w-full flex-wrap">
                            <button onClick={()=>handleProcessRequest(req, 'REJECTED')} className="px-1.5 py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap">반려</button>
                            <button onClick={()=>handleProcessRequest(req, 'COMPLETED')} className="px-1.5 py-1.5 bg-indigo-600 text-white border border-indigo-700 rounded-md text-[10px] font-black shadow-sm hover:bg-indigo-700 whitespace-nowrap">지급</button>
                            <button onClick={()=>handleDeleteRequest(req)} title="대기 건 영구 삭제 (재고 복구)" className="px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap">삭제</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-0.5 w-full flex-wrap">
                            {isCompleted && (
                              <button onClick={()=>handleCancelDispense(req)} title="지급철회(대기 상태로 원복 · 선차감 재고 유지)" className="px-1.5 py-1.5 bg-orange-50 text-orange-600 border border-orange-200 rounded-md text-[10px] font-black hover:bg-orange-100 shadow-sm whitespace-nowrap">철회</button>
                            )}
                            {isCompleted ? (
                              isLV1 ? (
                                <button onClick={()=>handleDeleteRequest(req)} title="지급완료 건 영구 삭제 — LV_1 전용" className="px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap">삭제</button>
                              ) : null
                            ) : (
                              <button onClick={()=>handleDeleteRequest(req)} title="반려 건 영구 삭제" className="px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap">삭제</button>
                            )}
                          </div>
                        )}
                      </td>
     
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
  
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">이전</button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">다음</button>
            </div>
          )}
        </section>
    </div>
  );
}
     
export default function MasterRequestModule() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MasterRequestContent />
    </Suspense>
  );
}