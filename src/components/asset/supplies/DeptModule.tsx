'use client';
     
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
     
function DeptContent() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
     
  useEffect(() => { 
    fetchData(); 
  }, []);
     
  const fetchData = async () => {
    setLoading(true);
    try {
      const userRes = await fetch('/api/auth/me');
      if (userRes.ok) {
        setCurrentUser(await userRes.json());
      }
     
      const reqRes = await fetch(`/api/asset/supplies/dept?t=${Date.now()}`, { cache: 'no-store' });
      if (reqRes.ok) {
        const myDeptReqs = await reqRes.json();
        setRequests(myDeptReqs);
      }
    } catch(e) { console.error("Data fetch error", e); }
    setLoading(false);
  };
     
  const availableYears = useMemo(() => {
    const years = requests.map(r => (r.createdAt || '').substring(0, 4)).filter(Boolean);
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = new Date().getFullYear().toString();
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [requests]);
     
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      const yearMatch = selectedYear === 'ALL' || (r.createdAt || '').startsWith(selectedYear);
      const itemName = r.item_name || r.item?.name || '';
      const searchMatch = !searchQuery || 
        itemName.toLowerCase().includes(searchQuery.toLowerCase()) || 
        r.user_name?.toLowerCase().includes(searchQuery.toLowerCase());
      return yearMatch && searchMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, selectedYear, searchQuery]);
     
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
     
  const toggleSelectAll = () => {
    const currentPageIds = paginatedRequests.map(r => r.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
     
  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('ko-KR', { 
      year: '2-digit', month: '2-digit', day: '2-digit', 
      hour: '2-digit', minute: '2-digit', hour12: false 
    });
  };
     
  const handleExportExcel = () => {
    const target = selectedIds.size > 0 ? filteredRequests.filter(r => selectedIds.has(r.id)) : filteredRequests;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = target.map((r, idx) => {
      const itemExt = r.item?.description ? JSON.parse(r.item.description) : {};
      const sUnit = itemExt.s_unit || 'EA';
      const itemName = r.item_name || r.item?.name || '-';
      return {
        'NO': target.length - idx, '신청일시': formatDateTime(r.createdAt),
        '신청자': r.user_name || '-', '물품명': itemName,
        '신청수량': `${r.qty} ${sUnit}`, '사용자 의견': r.note || '-', '관리자 답변': r.admin_opinion || '-',
        '처리자': r.admin_name || '-', '처리일시': r.completedAt ? formatDateTime(r.completedAt) : '-',
        '상태': r.status === 'COMPLETED' ? '지급완료' : r.status === 'REJECTED' ? '반려' : '대기중'
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서소모품신청내역");
    XLSX.writeFile(wb, `부서_소모품신청현황_${selectedYear === 'ALL' ? '전체' : selectedYear}년.xlsx`);
  };
     
  const statsData = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
     
    const thisMonthReqs = requests.filter(r => {
      const d = new Date(r.createdAt);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
     
    const monthStats = thisMonthReqs.reduce((acc, cur) => {
      const name = cur.item_name || cur.item?.name || '기타';
      acc[name] = (acc[name] || 0) + cur.qty;
      return acc;
    }, {} as Record<string, number>);
     
    const monthEntries = Object.entries(monthStats) as [string, number][];
    const topMonthItems = monthEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
      
    const maxMonthQty = topMonthItems.length > 0 ? Math.max(...topMonthItems.map(i => i[1])) : 1;
     
    const itemDates = requests.reduce((acc, cur) => {
      const name = cur.item_name || cur.item?.name || '기타';
      if (!acc[name]) acc[name] = [];
      acc[name].push(new Date(cur.createdAt).getTime());
      return acc;
    }, {} as Record<string, number[]>);
     
    const cycleStats: { name: string, cycle: number }[] = [];
    
    const dateEntries = Object.entries(itemDates) as [string, number[]][];
    dateEntries.forEach(([name, dates]) => {
      if (dates.length > 1) {
        const sorted = dates.sort((a, b) => a - b);
        const diffTotal = sorted[sorted.length - 1] - sorted[0];
        const avgDays = diffTotal / (sorted.length - 1) / (1000 * 60 * 60 * 24);
        cycleStats.push({ name, cycle: Math.round(avgDays) });
      }
    });
     
    const topCycleItems = cycleStats.sort((a, b) => a.cycle - b.cycle).slice(0, 5);
    return { topMonthItems, maxMonthQty, topCycleItems };
  }, [requests]);
     
  const myDeptName = currentUser?.dept_name || currentUser?.unit?.unit_name || '우리 부서';
     
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading Dept Data...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 🚀 서브 페이지/이력 제목 배너 (Title Banner 표준) */}
      <div className="w-full bg-slate-800 p-6 rounded-[2.5rem] text-white shadow-lg relative overflow-hidden flex flex-col justify-center min-h-[120px]">
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
            Department History
          </p>
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white">
                [{myDeptName}] 신청 현황
              </h1>
              <p className="text-slate-300 text-xs font-semibold mt-2 opacity-90">
                우리 부서 구성원들의 소모품 신청 내역 및 처리 현황을 조회합니다.
              </p>
            </div>
            <button 
              onClick={() => setIsTableOpen(!isTableOpen)} 
              className="bg-white/10 hover:bg-white/20 px-5 py-2 rounded-xl text-[11px] font-black text-white transition-colors uppercase whitespace-nowrap shadow-sm border border-white/10"
            >
              {isTableOpen ? '목록 닫기 ▲' : '목록 열기 ▼'}
            </button>
          </div>
        </div>
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none">
          🏢
        </div>
      </div>
     
      {/* 📊 상단 통계 그래프 섹션 (라운드 규격 2.5rem 매핑) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8">
          <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-6">📊 이번 달 신청 목록 (물품/수량)</h3>
          {statsData.topMonthItems.length === 0 ? (
            <div className="h-28 flex items-center justify-center text-[11px] font-bold text-slate-300 italic">내역 없음</div>
          ) : (
            <div className="space-y-4">
              {statsData.topMonthItems.map(([name, qty]) => (
                <div key={name} className="flex items-center gap-4">
                  <span className="w-32 truncate text-[12px] font-black text-slate-700">{name}</span>
                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${(qty / statsData.maxMonthQty) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right text-[12px] font-black text-indigo-600">{qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>
     
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8">
          <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-6">⏱️ 평균 물품 신청 주기</h3>
          {statsData.topCycleItems.length === 0 ? (
            <div className="h-28 flex items-center justify-center text-[11px] font-bold text-slate-300 italic">데이터 부족</div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {statsData.topCycleItems.map((item) => (
                <div key={item.name} className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex justify-between items-center transition-colors hover:bg-white hover:border-slate-200 hover:shadow-sm">
                  <span className="truncate flex-1 text-[11px] font-black text-slate-700 pr-2">{item.name}</span>
                  <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm shrink-0">
                    <span className="text-[14px] font-black text-emerald-600 font-mono">{item.cycle}</span>
                    <span className="text-[10px] text-slate-400 font-bold ml-1">Day</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
     
      {/* 🚀 데이터시트 표준 테이블 (HeaderLight 및 Pagination 적용) */}
      {isTableOpen && (
        <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
          
          {/* HeaderLight 컴포넌트 표준 */}
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">부서 소모품 신청 내역</h2>
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredRequests.length}건</span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">조회연도</span>
                <select value={selectedYear} onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                  <option value="ALL">전체 내역 보기</option>
                  {availableYears.map(year => <option key={year} value={year}>{year}년도</option>)}
                </select>
              </div>
              <div className="relative w-56">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
                <input type="text" placeholder="물품명, 신청자 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors" />
              </div>
              <button onClick={handleExportExcel} className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-[10px] font-black hover:bg-slate-900 transition-all shadow-sm flex items-center gap-1.5">
                <span>📊</span> EXCEL 다운로드
              </button>
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1400px]">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 w-12 text-center pl-4"><input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="accent-indigo-600 cursor-pointer w-3.5 h-3.5" /></th>
                  <th className="h-12 px-3 w-16 text-center">NO</th>
                  <th className="h-12 px-3 w-36 text-center">신청일시</th>
                  <th className="h-12 px-3 w-28 text-center">신청자</th>
                  <th className="h-12 px-4 w-48 text-indigo-600">물품명</th>
                  <th className="h-12 px-3 w-24 text-center">신청수량</th>
                  <th className="h-12 px-4 min-w-[180px]">신청자 의견</th>
                  <th className="h-12 px-4 min-w-[180px]">관리자 답변</th>
                  <th className="h-12 px-3 w-36 text-center">처리정보</th>
                  <th className="h-12 pr-6 w-24 text-center">상태</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr><td colSpan={10} className="h-32 text-center text-slate-400 italic">조건에 맞는 신청 내역이 없습니다.</td></tr>
                ) : (
                  paginatedRequests.map((req, i) => {
                    const isPending = req.status === 'PENDING' || req.status === '대기중';
                    const itemExt = req.item?.description ? JSON.parse(req.item.description) : {};
                    const sUnit = itemExt.s_unit || 'EA';
                    const itemName = req.item_name || req.item?.name || '(삭제된 물품)';
     
                    return (
                      <tr key={req.id} className="h-16 hover:bg-slate-50/50 transition-colors">
                        <td className="pl-4 text-center"><input type="checkbox" checked={selectedIds.has(req.id)} onChange={() => { const next = new Set(selectedIds); selectedIds.has(req.id) ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="accent-indigo-600 cursor-pointer w-3.5 h-3.5" /></td>
                        <td className="px-3 text-center text-slate-400 font-mono text-[10px]">{filteredRequests.length - ((currentPage - 1) * itemsPerPage + i)}</td>
                        <td className="px-3 text-center font-mono text-slate-500 text-[10px]">{formatDateTime(req.createdAt)}</td>
                        <td className="px-3 text-center text-slate-800 text-[11px]">{req.user_name || '-'}</td>
                        <td className="px-4 font-black text-slate-900 text-[12px] truncate max-w-[200px]" title={itemName}>{itemName}</td>
                        <td className="px-3 text-center font-black text-indigo-600 text-[11px]">
                          {req.qty} <span className="text-[9px] text-indigo-400 font-bold ml-0.5">{sUnit}</span>
                        </td>
                        <td className="px-4 text-slate-600 font-medium truncate max-w-[180px]" title={req.note}>{req.note || '-'}</td>
                        <td className="px-4 text-slate-800 font-medium truncate max-w-[180px]" title={req.admin_opinion}>{req.admin_opinion || '-'}</td>
                        <td className="px-3 text-center">
                          {isPending ? (
                            <span className="text-slate-300 italic text-[10px]">-</span>
                          ) : (
                            <div className="flex flex-col items-center justify-center">
                              <span className="text-slate-700 font-bold leading-tight">{req.admin_name || '관리자'}</span>
                              <span className="text-slate-400 font-mono text-[9px] mt-0.5">{req.completedAt ? formatDateTime(req.completedAt) : formatDateTime(req.updatedAt)}</span>
                            </div>
                          )}
                        </td>
                        <td className="pr-6 text-center">
                          <span className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest ${
                            isPending ? 'bg-orange-50 text-orange-500 border border-orange-100' 
                            : req.status === 'REJECTED' || req.status === '반려' ? 'bg-red-50 text-red-500 border border-red-100'
                            : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                          }`}>
                            {isPending ? '대기중' : (req.status === 'REJECTED' || req.status === '반려' ? '반려' : '지급완료')}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
     
          {/* 🚀 표준 페이지네이션 컨트롤러 */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
              <button 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(p => p - 1)}
                className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                이전
              </button>
              
              {Array.from({ length: totalPages }).map((_, i) => (
                <button 
                  key={i} 
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
                disabled={currentPage === totalPages} 
                onClick={() => setCurrentPage(p => p + 1)}
                className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                다음
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
     
export default function DeptModule() {
  return (
    <Suspense fallback={<div className="p-20 font-black animate-pulse text-indigo-400 text-center uppercase tracking-widest text-xl">Loading Dept Data...</div>}>
      <DeptContent />
    </Suspense>
  );
}