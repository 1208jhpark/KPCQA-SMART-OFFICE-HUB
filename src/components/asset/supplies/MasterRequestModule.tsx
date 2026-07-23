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
  
  // 하단 장부 상태 관리
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL'); 
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
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
      const [reqRes, userRes] = await Promise.all([
        fetch(`/api/asset/supplies/master/requests?t=${ts}`, { cache: 'no-store' }),
        !propUser ? fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }) : Promise.resolve(null)
      ]);
      
      if (reqRes.ok) {
        setRequests(await reqRes.json());
      } else if (reqRes.status === 401 || reqRes.status === 403) {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '신청현황 관리 권한이 없습니다.');
      }
      if (!propUser && userRes?.ok) setCurrentUser(await userRes.json());
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
      const searchMatch = !searchQuery || 
                          itemName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (r.user_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      return yearMatch && monthMatch && deptMatch && statusMatch && searchMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, selectedYear, selectedMonth, selectedDept, selectedStatus, searchQuery]);
     
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  useEffect(() => { setCurrentPage(1); }, [selectedYear, selectedMonth, selectedDept, selectedStatus, searchQuery]);
     
  const toggleSelectAll = () => {
    const currentPageIds = paginatedRequests.map(r => r.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id)); else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
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
     
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading Requests...</div>;
     
  const countPending = requests.filter(r => isPendingSupplyRequest(r.status)).length;
  const countCompleted = requests.filter(r => isCompletedSupplyRequest(r.status)).length;
  const countRejected = requests.filter(r => isRejectedSupplyRequest(r.status)).length;
  
  const formatNum = (num: any) => Number(num || 0).toLocaleString();
     
  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* 🚀 소모품 마스터 관리 통제실 (명함 배너와 100% 스타일 싱크로율 매칭) */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[140px]">
  
  <div className="relative z-10 flex justify-between items-end w-full">
    <div>
      {/* 1. 상단 라벨 (mb-3 여백 및 명함과 동일한 텍스트 톤) */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">
        CENTRAL SUPPLIES CONTROL TOWER
      </h3>
      
      {/* 2. 메인 타이틀 (leading-none으로 라인 꼬임 방지) */}
      <h1 className="text-2xl font-black tracking-tight text-white leading-none">
        소모품 마스터 관리 통제실
      </h1>
      
      {/* 3. 하단 설명 (mt-4 표준 간격 적용) */}
      <p className="text-emerald-100/90 text-xs font-semibold mt-4 opacity-90">
        임직원의 소모품 신청내역을 검토하고 승인/반려 등 관리합니다.
      </p>
    </div>
  </div>

  {/* 우측 관제실 느낌의 은은한 엠블럼 배치 (공백 완벽 메꿈) */}
  <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
    📊
  </div>
</div>

      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-4xl">
        {tabItems.map((tab) => {
          const isActive = pathname.startsWith(tab.path);
          return (
            <Link key={tab.id} href={tab.path} className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${isActive ? 'bg-white text-blue-600 shadow-sm border border-slate-300/50 scale-[1.01]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'}`}>
              {tab.name}
            </Link>
          );
        })}
      </div>
     
      <div className="grid grid-cols-4 gap-4 mt-6">
        <div onClick={() => setSelectedStatus('ALL')} className={`p-5 rounded-[2rem] border cursor-pointer transition-all flex flex-col justify-center items-center gap-1 shadow-sm hover:shadow-md ${selectedStatus === 'ALL' ? 'bg-slate-800 border-slate-900 text-white scale-105' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          <span className="text-[11px] font-black uppercase tracking-widest opacity-80">전체 신청 내역</span>
          <span className="text-2xl font-black">{requests.length}</span>
        </div>
        <div onClick={() => setSelectedStatus('PENDING')} className={`p-5 rounded-[2rem] border cursor-pointer transition-all flex flex-col justify-center items-center gap-1 shadow-sm hover:shadow-md ${selectedStatus === 'PENDING' ? 'bg-orange-500 border-orange-600 text-white scale-105' : 'bg-orange-50 border-orange-100 text-orange-600 hover:bg-orange-100'}`}>
          <span className="text-[11px] font-black uppercase tracking-widest opacity-80">신규 신청 대기건</span>
          <span className="text-2xl font-black">{countPending}</span>
        </div>
        <div onClick={() => setSelectedStatus('COMPLETED')} className={`p-5 rounded-[2rem] border cursor-pointer transition-all flex flex-col justify-center items-center gap-1 shadow-sm hover:shadow-md ${selectedStatus === 'COMPLETED' ? 'bg-emerald-600 border-emerald-700 text-white scale-105' : 'bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100'}`}>
          <span className="text-[11px] font-black uppercase tracking-widest opacity-80">지급 완료건</span>
          <span className="text-2xl font-black">{countCompleted}</span>
        </div>
        <div onClick={() => setSelectedStatus('REJECTED')} className={`p-5 rounded-[2rem] border cursor-pointer transition-all flex flex-col justify-center items-center gap-1 shadow-sm hover:shadow-md ${selectedStatus === 'REJECTED' ? 'bg-red-500 border-red-600 text-white scale-105' : 'bg-red-50 border-red-100 text-red-600 hover:bg-red-100'}`}>
          <span className="text-[11px] font-black uppercase tracking-widest opacity-80">반려 처리건</span>
          <span className="text-2xl font-black">{countRejected}</span>
        </div>
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
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-black tracking-wider text-slate-600 text-center">
                <th className="p-3.5 w-16">NO</th>
                <th className="p-3.5 text-left w-[350px]">품목명</th>
                <th className="p-3.5 w-24">신청단위</th>
                <th className="p-3.5 w-36 bg-slate-100 text-slate-800">총 누적 지급량(전사)</th>
                
                <th className="p-3.5 bg-indigo-50 text-indigo-800 font-black border-l border-indigo-100">
                  {statDept === 'ALL' ? '전체부서' : `[${statDept}]`} 통계 수량
                </th>
                <th className="p-3.5 bg-indigo-900 text-white font-black border-l border-indigo-800">
                  {statDept === 'ALL' ? '전사 통합' : `[${statDept}]`} 점유율 (%)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {processedStatsTable.length === 0 ? (
                <tr><td colSpan={6} className="h-24 text-center text-slate-400 italic bg-slate-50/50">데이터가 존재하지 않습니다.</td></tr>
              ) : (
                processedStatsTable.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors text-center h-12">
                    <td className="p-2 font-mono text-slate-400">{idx + 1}</td>
                    <td className="p-2 text-left font-black text-slate-900 text-xs">{row.name}</td>
                    <td className="p-2 text-slate-500">{row.rUnit}</td>
                    <td className="p-2 bg-slate-50 font-black text-slate-800 text-sm font-mono">{formatNum(row.totalAccumQty)}</td>
                    <td className="p-2 bg-indigo-50/30 text-indigo-700 font-black text-sm font-mono border-l border-indigo-100">{formatNum(row.deptQty)}</td>
                    <td className="p-2 bg-slate-900/5 font-black text-center font-mono text-sm">
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
     
      {isTableOpen && (
        <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4 mt-6">
          
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap gap-4 items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
              <h2 className="text-[13px] font-black text-slate-800 tracking-tight">사용자 신청 내역 장부</h2>
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredRequests.length}건 검색됨</span>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-white px-2 py-1.5 rounded-lg border border-slate-300 shadow-sm text-[11px] font-bold">
                <span className="text-slate-400">🗓️ 연도:</span>
                <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black text-slate-800">
                  <option value="ALL">전체 연도</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5 bg-white px-2 py-1.5 rounded-lg border border-slate-300 shadow-sm text-[11px] font-bold">
                <span className="text-slate-400">📅 월별:</span>
                <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black text-slate-800">
                  <option value="ALL">전체 달</option>
                  {availableMonths.map(m => <option key={m} value={m}>{m}월</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5 bg-white px-2 py-1.5 rounded-lg border border-slate-300 shadow-sm text-[11px] font-bold">
                <span className="text-slate-400">🏢 부서:</span>
                {/* value와 onChange의 변수명을 사용자님 코드에 맞춰 selectedDept 로 변경했습니다. */}
            <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black text-indigo-700 max-w-[120px] truncate">
              <option value="ALL">전체 부서</option>
              {availableDepts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
              </div>
              <div className="relative w-48">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
                <input type="text" placeholder="물품명, 신청자 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-inner" />
              </div>
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] min-w-[1300px] border-collapse table-fixed">
            <colgroup><col className="w-[40px]"/><col className="w-[48px]"/><col className="w-[90px]"/><col className="w-[120px]"/><col className="w-[180px]"/><col className="w-[100px]"/><col className="w-[240px]"/><col className="w-[100px]"/><col className="w-auto"/><col className="w-[90px]"/><col className="w-[180px]"/></colgroup>
              <thead className="bg-slate-50 text-slate-400 font-black border-b border-slate-200 uppercase tracking-widest">
                <tr>
                  <th className="h-12 pl-4 text-center"><input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="accent-indigo-600 cursor-pointer" /></th>
                  <th className="h-12 px-2 text-center">NO</th>
                  <th className="h-12 px-3 text-center border-l-4 border-white">신청일시</th>
                  <th className="h-12 px-4 bg-slate-50">부서 / 신청자</th>
                  <th className="h-12 px-4 text-indigo-600 bg-indigo-50/10">물품명</th>
                  <th className="h-12 px-3 text-center text-indigo-600 bg-indigo-50/10">신청수량</th>
                  <th className="h-12 px-4 border-l-4 border-white">사용자 의견</th>
                  <th className="h-12 px-3 text-center border-l-4 border-white">상태</th>
                  <th className="h-12 px-4 bg-slate-100 border-l-4 border-white">관리자 답변</th>
                  <th className="h-12 px-3 bg-slate-100 text-center border-l-4 border-white">처리정보</th>
                  <th className="h-12 px-3 bg-slate-100 text-center border-l-4 border-white">관리 액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium bg-white">
                {paginatedRequests.length === 0 ? (
                  <tr><td colSpan={11} className="h-32 text-center text-slate-400 italic font-bold">조건에 맞는 내역이 없습니다.</td></tr>
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
                    <tr key={req.id} className={`hover:bg-slate-50 h-14 transition-colors ${selectedIds.has(req.id) ? 'bg-indigo-50/30' : ''}`}>
                      <td className="pl-4 text-center"><input type="checkbox" checked={selectedIds.has(req.id)} onChange={() => { const next = new Set(selectedIds); selectedIds.has(req.id) ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="accent-indigo-600 cursor-pointer" /></td>
                      <td className="px-2 text-center text-slate-400 font-mono text-[10px]">{rowNo}</td>
                      <td className="px-3 text-center font-mono text-slate-500 text-[10px] border-l-4 border-white">{createdDate}</td>
                      <td className="px-4 truncate"><span className="text-[9px] text-slate-400 block mb-0.5 truncate">{req.dept_name || '-'}</span><span className="text-slate-800 font-black text-[11px] truncate">{req.user_name || '-'}</span></td>
                      <td className="px-4 font-black text-slate-800 text-[12px] bg-indigo-50/5 truncate" title={itemName}>{itemName}</td>
                      <td className="px-3 text-center font-black text-indigo-600 text-[12px] bg-indigo-50/5">{req.qty} <span className="text-[9px] text-indigo-400 font-bold ml-0.5">{sUnit}</span></td>
                      <td className="px-4 text-slate-500 font-medium truncate border-l-4 border-white" title={req.note}>{req.note ? `"${req.note}"` : '-'}</td>
                      <td className="px-3 text-center border-l-4 border-white">
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${isPending ? 'bg-orange-50 text-orange-600 border border-orange-200' : isRejected ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
                          {statusLabel === '대기중' ? '대기' : statusLabel}
                        </span>
                      </td>
                      
                      <td className="px-4 border-l-4 border-white bg-slate-50/50">
                        {isPending ? (
                          <input 
                            placeholder="답변 작성..." 
                            value={processOpinion[req.id] || ''} 
                            onChange={(e)=>setProcessOpinion({...processOpinion, [req.id]: e.target.value})} 
                            className="w-full min-w-0 p-1.5 border border-slate-300 rounded-md text-[10px] font-bold outline-none focus:border-indigo-500 shadow-inner bg-white" 
                          />
                        ) : (
                          <span className="text-slate-500 italic truncate block w-full" title={req.admin_opinion}>
                            {req.admin_opinion ? `" ${req.admin_opinion} "` : '-'}
                          </span>
                        )}
                      </td>
     
                      <td className="px-3 text-center border-l-4 border-white bg-slate-50/50">
                        {!isPending ? (
                          <div className="flex flex-col text-[10px] text-center">
                            <span className="text-slate-800 font-bold">{req.admin_name || '관리자'}</span>
                            <span className="text-slate-400 font-mono mt-0.5">{processDate}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
     
                      <td className="px-3 text-center border-l-4 border-white bg-slate-50/50">
                        {isPending ? (
                          <div className="flex items-center justify-center gap-1 w-full">
                            <button onClick={()=>handleProcessRequest(req, 'REJECTED')} className="px-2 py-1.5 bg-white text-red-500 border border-red-200 rounded-md font-black text-[10px] hover:bg-red-50 shadow-sm">반려</button>
                            <button onClick={()=>handleProcessRequest(req, 'COMPLETED')} className="px-2 py-1.5 bg-indigo-600 text-white border border-indigo-700 rounded-md font-black text-[10px] shadow-sm hover:bg-indigo-700">지급</button>
                            <button onClick={()=>handleDeleteRequest(req)} title="대기 건 영구 삭제 (재고 복구)" className="px-2 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md font-black text-[10px] hover:text-red-500 hover:bg-red-50">삭제</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1 w-full">
                            {isCompleted && (
                              <button onClick={()=>handleCancelDispense(req)} title="지급철회(대기 상태로 원복 · 선차감 재고 유지)" className="px-2 py-1.5 bg-orange-50 text-orange-600 border border-orange-200 rounded-md font-black text-[10px] hover:bg-orange-100 shadow-sm">지급철회</button>
                            )}
                            {isCompleted ? (
                              isLV1 ? (
                                <button onClick={()=>handleDeleteRequest(req)} title="지급완료 건 영구 삭제 — LV_1 전용" className="px-2 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md font-black text-[10px] hover:text-red-500 hover:bg-red-50">삭제(LV_1)</button>
                              ) : null
                            ) : (
                              <button onClick={()=>handleDeleteRequest(req)} title="반려 건 영구 삭제" className="px-2 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md font-black text-[10px] hover:text-red-500 hover:bg-red-50">삭제</button>
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
      )}
    </div>
  );
}
     
export default function MasterRequestModule() {
  return (
    <Suspense fallback={<div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading Requests...</div>}>
      <MasterRequestContent />
    </Suspense>
  );
}