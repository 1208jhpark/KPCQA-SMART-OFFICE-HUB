'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
     
function MasterPurchaseContent() {
  const pathname = usePathname();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [sumMode, setSumMode] = useState<'YEAR' | 'CHECKBOX'>('YEAR');

  // 🚀 공통 마스터 탭 바 명세
  const tabItems = [
    { id: 'dashboard', name: '🗂️ 소모품 마스터 대시보드', path: '/asset/supplies/master/dashboard' },
    { id: 'requests', name: '📋 사용자 신청현황 관리', path: '/asset/supplies/master/requests' },
    { id: 'purchase', name: '💰 입고/구매 내역 대장', path: '/asset/supplies/master/purchase' },
    { id: 'archive', name: '📁 폐기자산 아카이브', path: '/asset/supplies/master/archive' },
  ];
     
  useEffect(() => { fetchPurchases(); fetchCurrentUser(); }, []);
     
  const fetchCurrentUser = async () => {
    try { const res = await fetch('/api/auth/me'); if (res.ok) setCurrentUser(await res.json()); } catch (e) {}
  };
     
  const fetchPurchases = async () => {
    setLoading(true);
    try { const res = await fetch(`/api/asset/supplies/master/purchase?t=${Date.now()}`, { cache: 'no-store' }); if (res.ok) setPurchases(await res.json()); } catch(e) {}
    setLoading(false);
  };
     
  const availableYears = useMemo(() => {
    const years = purchases.map(p => new Date(p.purchase_date).getFullYear().toString());
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = new Date().getFullYear().toString();
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [purchases]);
     
  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      const yearMatch = selectedYear === 'ALL' || new Date(p.purchase_date).getFullYear().toString() === selectedYear;
      const searchMatch = !searchQuery || p.item?.name?.toLowerCase().includes(searchQuery.toLowerCase()) || p.vendor?.toLowerCase().includes(searchQuery.toLowerCase());
      return yearMatch && searchMatch;
    }).sort((a, b) => new Date(b.createdAt || b.purchase_date).getTime() - new Date(a.createdAt || a.purchase_date).getTime());
  }, [purchases, selectedYear, searchQuery]);
     
  const totalAmount = useMemo(() => {
    if (sumMode === 'CHECKBOX' && selectedIds.size > 0) return filteredPurchases.filter(p => selectedIds.has(p.id)).reduce((acc, cur) => acc + (cur.total_price || 0), 0);
    return filteredPurchases.reduce((acc, cur) => acc + (cur.total_price || 0), 0);
  }, [filteredPurchases, sumMode, selectedIds]);
     
  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / itemsPerPage));
  const paginatedPurchases = filteredPurchases.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
     
  const toggleSelectAll = () => {
    const currentPageIds = paginatedPurchases.map(p => p.id);
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
     
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading Inbound Logs...</div>;
     
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
            <span className="text-2xl text-white">📥</span>
            <div className="flex flex-col justify-center">
              <h2 className="font-black tracking-tight uppercase text-white text-lg">소모품 입고 내역 대장</h2>
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
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total Logs: <span className="text-indigo-600">{filteredPurchases.length}</span></span>
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">💰 합계 금액</span>
                <span className="text-sm font-black text-slate-800 font-mono">{totalAmount.toLocaleString()} 원</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <select value={selectedYear} onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); setSumMode('YEAR'); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <option value="ALL">TOTAL 모두보기</option>
                {availableYears.map(year => <option key={year} value={year}>{year}년</option>)}
              </select>
              <input type="text" placeholder="물품명, 구매처 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-56 pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm" />
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] min-w-[1250px] border-collapse">
              <thead className="bg-slate-50 text-slate-400 font-black border-b border-slate-200 uppercase">
                <tr>
                  <th className="p-3 w-10 text-center"><input type="checkbox" checked={paginatedPurchases.length > 0 && paginatedPurchases.every(p => selectedIds.has(p.id))} onChange={toggleSelectAll} className="accent-indigo-600 w-3 h-3 cursor-pointer" /></th>
                  <th className="p-3 w-24 text-center">입고일자</th>
                  <th className="p-3 w-48 text-indigo-600">물품명</th>
                  <th className="p-3 w-28 text-center">입고수량</th>
                  <th className="p-3 w-28 text-right text-indigo-600">총 구매금액(원)</th>
                  <th className="p-3 min-w-[200px]">메모 (비고)</th>
                  <th className="p-3 w-28 text-center">등록자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium bg-white">
                {paginatedPurchases.map((p, i) => (
                  <tr key={p.id} className={`hover:bg-slate-50 h-12 ${selectedIds.has(p.id) ? 'bg-indigo-50/20' : ''}`}>
                    <td className="p-3 text-center"><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => { const next = new Set(selectedIds); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSelectedIds(next); }} className="accent-indigo-600 w-3 h-3 cursor-pointer" /></td>
                    <td className="p-3 text-center font-mono text-slate-600 text-[10px]">{new Date(p.purchase_date).toISOString().split('T')[0]}</td>
                    <td className="p-3 font-black text-slate-800 text-[12px] truncate">{p.item?.name || '(삭제된 물품)'}</td>
                    <td className="p-3 text-center font-mono font-bold text-slate-700">{p.qty} <span className="text-[9px] text-slate-400">박스/묶음</span></td>
                    <td className="p-3 text-right font-mono font-black text-indigo-600 text-[12px]">{p.total_price?.toLocaleString()}</td>
                    <td className="p-3 text-slate-500 font-medium truncate">{p.note || '-'}</td>
                    <td className="p-3 text-center"><span className="text-slate-800 font-bold block leading-tight">{p.purchaser_name}</span></td>
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
     
export default function MasterPurchaseModule() {
  return (
    <Suspense fallback={<div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading Inbound Logs...</div>}>
      <MasterPurchaseContent />
    </Suspense>
  );
}