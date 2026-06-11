'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
     
function MasterRequestContent() {
  const pathname = usePathname();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [processOpinion, setProcessOpinion] = useState<{ [key: string]: string }>({});

  // 🚀 공통 마스터 탭 바 명세
  const tabItems = [
    { id: 'dashboard', name: '🗂️ 소모품 마스터 대시보드', path: '/asset/supplies/master/dashboard' },
    { id: 'requests', name: '📋 사용자 신청현황 관리', path: '/asset/supplies/master/requests' },
    { id: 'purchase', name: '💰 입고/구매 내역 대장', path: '/asset/supplies/master/purchase' },
    { id: 'archive', name: '📁 폐기자산 아카이브', path: '/asset/supplies/master/archive' },
  ];
     
  useEffect(() => { fetchRequests(); fetchCurrentUser(); }, []);
     
  const fetchCurrentUser = async () => {
    try { const res = await fetch('/api/auth/me'); if (res.ok) setCurrentUser(await res.json()); } catch (e) {}
  };
     
  const fetchRequests = async () => {
    setLoading(true);
    try { const res = await fetch(`/api/asset/supplies/master/requests?t=${Date.now()}`, { cache: 'no-store' }); if (res.ok) setRequests(await res.json()); } catch(e) {}
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
      const searchMatch = !searchQuery || itemName.toLowerCase().includes(searchQuery.toLowerCase()) || r.user_name?.toLowerCase().includes(searchQuery.toLowerCase());
      return yearMatch && searchMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, selectedYear, searchQuery]);
     
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
     
  const toggleSelectAll = () => {
    const currentPageIds = paginatedRequests.map(r => r.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id)); else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
     
  let myRole = 'LV_3';
  if (currentUser) {
    let rolesArr = Array.isArray(currentUser.roles) ? currentUser.roles : [];
    myRole = String(rolesArr[0] || 'LV_3').toUpperCase();
  }
  const isLV1 = myRole === 'LV_1';

  const handleProcessRequest = async (reqId: string, status: 'COMPLETED' | 'REJECTED') => {
    const opinion = processOpinion[reqId] || '';
    if (!confirm(status === 'COMPLETED' ? '지급 완료 처리를 하시겠습니까?' : '해당 요청을 반려하시겠습니까?')) return;
    try {
      const res = await fetch('/api/asset/supplies/master/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reqId, status, admin_opinion: opinion, admin_name: currentUser?.name || '관리자', admin_dept: currentUser?.dept_name || '운영팀' })
      });
      if (res.ok) { alert(status === 'COMPLETED' ? '✅ 지급 처리가 완료되었습니다.' : '🚨 반려 처리가 완료되었습니다.'); fetchRequests(); }
    } catch (e) {}
  };
     
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading Requests...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 마스터 배너 */}
      <div className="w-full bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[120px]">
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-1">Central Supplies Control Tower</p>
          <h1 className="text-2xl font-black tracking-tight text-white">소모품 마스터 관리 통제실</h1>
          <p className="text-slate-400 text-xs font-semibold mt-2 opacity-90">전사 소모품의 실시간 재고 현황을 모니터링하고 발주 및 사용자 신청을 총괄 관리합니다.</p>
        </div>
      </div>

      {/* 🚀 공통 탭 바 */}
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

      <div className="bg-slate-900 h-20 rounded-[2rem] shadow-lg relative flex items-center px-8 mt-6">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4">
            <span className="text-2xl text-white">📩</span>
            <div className="flex flex-col justify-center">
              <h2 className="font-black tracking-tight uppercase text-white text-lg">사용자 신청현황 관리</h2>
            </div>
          </div>
          <button onClick={() => setIsTableOpen(!isTableOpen)} className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-xl text-[10px] font-black text-white transition-colors uppercase whitespace-nowrap">
            {isTableOpen ? '리스트 닫기 ▲' : '리스트 열기 ▼'}
          </button>
        </div>
      </div>
     
      {isTableOpen && (
        <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
          <div className="p-5 bg-slate-50 border-b flex justify-between items-center flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total Requests: <span className="text-indigo-600">{filteredRequests.length}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <select value={selectedYear} onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <option value="ALL">TOTAL 모두보기</option>
                {availableYears.map(year => <option key={year} value={year}>{year}년</option>)}
              </select>
              <input type="text" placeholder="물품명, 신청자 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-56 pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm" />
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] min-w-[1350px] border-collapse">
              <thead className="bg-slate-50 text-slate-400 font-black border-b border-slate-200 uppercase">
                <tr>
                  <th className="p-3 w-10 text-center"><input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="accent-indigo-600 cursor-pointer" /></th>
                  <th className="p-3 w-28 text-center">신청일시</th>
                  <th className="p-3 w-36">부서 / 신청자</th>
                  <th className="p-3 w-48 text-indigo-600">물품명</th>
                  <th className="p-3 w-24 text-center">신청수량</th>
                  <th className="p-3 min-w-[160px]">사용자 의견</th>
                  <th className="p-3 w-16 text-center">상태</th>
                  <th className="p-3 w-56 text-center">관리 액션 / 처리자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium bg-white">
                {paginatedRequests.map((req, i) => {
                  const isPending = req.status === 'PENDING' || req.status === '대기중';
                  const itemName = req.item_name || req.item?.name || '(삭제된 물품)';
                  const itemExt = req.item?.description ? JSON.parse(req.item.description) : {};
                  const sUnit = req.unit || itemExt.s_unit || 'EA';
     
                  return (
                    <tr key={req.id} className={`hover:bg-slate-50 h-14 ${selectedIds.has(req.id) ? 'bg-indigo-50/30' : ''}`}>
                      <td className="p-3 text-center"><input type="checkbox" checked={selectedIds.has(req.id)} onChange={() => { const next = new Set(selectedIds); selectedIds.has(req.id) ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="accent-indigo-600 cursor-pointer" /></td>
                      <td className="p-3 text-center font-mono text-slate-500 text-[10px]">{req.createdAt?.substring(0, 10) || '-'}</td>
                      <td className="p-3"><span className="text-[10px] text-slate-400 block mb-0.5">{req.dept_name || '-'}</span><span className="text-slate-800 font-black text-[11px]">{req.user_name || '-'}</span></td>
                      <td className="p-3 font-black text-slate-800 text-[12px] truncate">{itemName}</td>
                      <td className="p-3 text-center font-black text-indigo-600 text-[11px]">{req.qty} <span className="text-[9px] text-indigo-400 font-bold ml-0.5">{sUnit}</span></td>
                      <td className="p-3 text-slate-600 font-medium truncate max-w-[160px]">{req.note ? `"${req.note}"` : '-'}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${isPending ? 'bg-orange-50 text-orange-500 border border-orange-100' : req.status === 'REJECTED' || req.status === '반려' ? 'bg-red-50 text-red-500 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>{isPending ? '대기' : (req.status === 'REJECTED' || req.status === '반려' ? '반려' : '완료')}</span>
                      </td>
                      <td className="p-3">
                        {isPending ? (
                          <div className="flex items-center gap-1.5 justify-center">
                            <input placeholder="답변..." value={processOpinion[req.id] || ''} onChange={(e)=>setProcessOpinion({...processOpinion, [req.id]: e.target.value})} className="w-20 p-1.5 border border-slate-200 rounded-md text-[10px] font-bold outline-none focus:border-indigo-500 shadow-inner bg-slate-50" />
                            <button onClick={()=>handleProcessRequest(req.id, 'REJECTED')} className="px-2 py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md font-black text-[10px] hover:bg-red-500 hover:text-white transition-colors">반려</button>
                            <button onClick={()=>handleProcessRequest(req.id, 'COMPLETED')} className="px-2 py-1.5 bg-indigo-600 text-white rounded-md font-black text-[10px] shadow-sm hover:bg-indigo-700 transition-colors">지급</button>
                          </div>
                        ) : (
                          <div className="text-center"><span className="text-slate-700 font-bold block leading-tight">{req.admin_name || '관리자'}</span></div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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