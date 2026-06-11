'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
     
function MasterArchiveContent() {
  const pathname = usePathname();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // 🚀 공통 마스터 탭 바 명세
  const tabItems = [
    { id: 'dashboard', name: '🗂️ 소모품 마스터 대시보드', path: '/asset/supplies/master/dashboard' },
    { id: 'requests', name: '📋 사용자 신청현황 관리', path: '/asset/supplies/master/requests' },
    { id: 'purchase', name: '💰 입고/구매 내역 대장', path: '/asset/supplies/master/purchase' },
    { id: 'archive', name: '📁 폐기자산 아카이브', path: '/asset/supplies/master/archive' },
  ];
     
  useEffect(() => { 
    fetchArchivedItems(); 
    fetchCurrentUser();
  }, []);
     
  const fetchCurrentUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) setCurrentUser(await res.json());
    } catch (e) {}
  };
     
  const fetchArchivedItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asset/supplies/master/archive?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) setItems(await res.json() || []);
    } catch(e) {}
    setLoading(false);
  };
     
  const availableYears = useMemo(() => {
    const years = items.map(i => (i.disposal_date || '').substring(0, 4)).filter(Boolean);
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = new Date().getFullYear().toString();
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [items]);
     
  const filteredItems = useMemo(() => {
    return items.filter(i => {
      const yearMatch = selectedYear === 'ALL' || (i.disposal_date || '').startsWith(selectedYear);
      const searchMatch = !searchQuery || 
        i.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        i.disposal_reason?.toLowerCase().includes(searchQuery.toLowerCase());
      return yearMatch && searchMatch;
    }).sort((a, b) => new Date(b.disposal_date || 0).getTime() - new Date(a.disposal_date || 0).getTime());
  }, [items, selectedYear, searchQuery]);
     
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));
  const paginatedItems = filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
     
  const toggleSelectAll = () => {
    const currentPageIds = paginatedItems.map(p => p.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
     
  let myRole = 'LV_3';
  if (currentUser) {
    let rolesArr = Array.isArray(currentUser.roles) ? currentUser.roles : [];
    myRole = String(rolesArr[0] || 'LV_3').toUpperCase();
  }
  const isLV1 = myRole === 'LV_1';
     
  const handleRestore = async (id: string) => {
    if (!confirm('해당 품목을 다시 대시보드 운영 리스트로 복구하시겠습니까?')) return;
    try {
      const res = await fetch('/api/asset/supplies/master/dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: true })
      });
      if (res.ok) { alert('✅ 복구되었습니다.'); fetchArchivedItems(); }
    } catch (e) {}
  };
     
  const handleDeleteArchived = async (ids: string[]) => {
    if (!isLV1) return alert("삭제 권한이 없습니다.");
    if (!confirm(`선택한 ${ids.length}개의 아카이브 내역을 영구 삭제하시겠습니까?`)) return;
    try {
      await Promise.all(ids.map(id => fetch(`/api/asset/supplies/master/archive?id=${id}`, { method: 'DELETE' })));
      alert('✅ 영구 삭제되었습니다.'); setSelectedIds(new Set()); fetchArchivedItems();
    } catch (e) {}
  };
     
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-slate-400 uppercase tracking-widest">Loading Archive...</div>;
     
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
            <span className="text-2xl text-white">📦</span>
            <div className="flex flex-col justify-center">
              <h2 className="font-black tracking-tight uppercase text-white text-lg">종료 자산 아카이브</h2>
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
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total Archived: <span className="text-indigo-600">{filteredItems.length}</span></span>
              <button onClick={() => handleDeleteArchived(Array.from(selectedIds))} disabled={!isLV1 || selectedIds.size === 0} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${isLV1 && selectedIds.size > 0 ? 'bg-red-50 text-red-600 border border-red-200 shadow-sm hover:bg-red-600 hover:text-white' : 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed'}`}>
                🗑️ 선택 삭제 ({selectedIds.size})
              </button>
            </div>
            <div className="flex items-center gap-2">
              <select value={selectedYear} onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <option value="ALL">TOTAL 모두보기</option>
                {availableYears.map(year => <option key={year} value={year}>{year}년</option>)}
              </select>
              <input type="text" placeholder="물품명 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-56 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm" />
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] min-w-[1200px] border-collapse">
              <thead className="bg-slate-50 text-slate-400 font-black border-b border-slate-200 uppercase">
                <tr>
                  <th className="p-3 w-10 text-center"><input type="checkbox" checked={paginatedItems.length > 0 && paginatedItems.every(p => selectedIds.has(p.id))} onChange={toggleSelectAll} className="accent-indigo-600 cursor-pointer" /></th>
                  <th className="p-3 w-28 text-center">폐기 처리일</th>
                  <th className="p-3 w-56 text-indigo-600">물품명</th>
                  <th className="p-3 w-28 text-center">최종 재고</th>
                  <th className="p-3 min-w-[300px]">폐기 사유 (비고)</th>
                  <th className="p-3 w-40 text-center">처리자 정보</th>
                  <th className="p-3 w-32 text-center">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium bg-white">
                {paginatedItems.map((item, i) => (
                  <tr key={item.id} className={`hover:bg-slate-50 h-12 ${selectedIds.has(item.id) ? 'bg-indigo-50/20' : ''}`}>
                    <td className="p-3 text-center"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => { const next = new Set(selectedIds); selectedIds.has(item.id) ? next.delete(item.id) : next.add(item.id); setSelectedIds(next); }} className="accent-indigo-600 cursor-pointer" /></td>
                    <td className="p-3 text-center font-mono text-slate-600 text-[10px]">{item.disposal_date || '-'}</td>
                    <td className="p-3 font-black text-slate-800 text-[12px] truncate">{item.name}</td>
                    <td className="p-3 text-center font-mono font-bold text-red-500">{item.current_stock?.toLocaleString()} EA</td>
                    <td className="p-3 text-slate-500 font-medium italic truncate max-w-[400px]">"{item.disposal_reason || '사유 미기재'}"</td>
                    <td className="p-3 text-center"><span className="text-slate-800 font-bold block leading-tight">{item.disposer_name || '-'}</span></td>
                    <td className="p-3 text-center">
                      <button onClick={() => handleRestore(item.id)} className="px-3 py-1.5 border border-slate-200 rounded-md text-[9px] font-black text-slate-400 hover:bg-slate-800 hover:text-white transition-all shadow-sm">복구</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
     
export default function MasterArchiveModule() {
  return (
    <Suspense fallback={<div className="p-10 font-black animate-pulse text-indigo-400 text-center uppercase tracking-widest">Loading Archive...</div>}>
      <MasterArchiveContent />
    </Suspense>
  );
}