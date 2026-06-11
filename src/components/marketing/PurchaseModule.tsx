'use client';

import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';

export default function PurchaseModule() {
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    fetchPurchases();
  }, []);

  const fetchPurchases = async () => {
    try {
      const res = await fetch('/api/marketing/purchases');
      if (res.ok) setPurchases(await res.json());
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const availableYears = useMemo(() => {
    const years = purchases.map(p => new Date(p.purchase_date).getFullYear().toString());
    const uniqueYears = Array.from(new Set(years));
    const currentYear = new Date().getFullYear().toString();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
    return uniqueYears.sort((a, b) => b.localeCompare(a));
  }, [purchases]);

  const availableDepts = useMemo(() => {
    const depts = purchases.map(p => p.purchaser_dept).filter(Boolean);
    return Array.from(new Set(depts)).sort();
  }, [purchases]);

  const filteredPurchases = useMemo(() => {
    return purchases
      .filter(p => {
        const yearMatch = selectedYear === 'ALL' || new Date(p.purchase_date).getFullYear().toString() === selectedYear;
        const deptMatch = selectedDept === 'ALL' || p.purchaser_dept === selectedDept;
        const searchMatch = !searchQuery || 
          p.item?.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
          p.vendor?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.purchaser_name?.toLowerCase().includes(searchQuery.toLowerCase());
        return yearMatch && deptMatch && searchMatch;
      })
      .sort((a, b) => {
        const dateA = new Date(a.purchase_date).getTime();
        const dateB = new Date(b.purchase_date).getTime();
        if (dateA !== dateB) return dateB - dateA;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [purchases, selectedYear, selectedDept, searchQuery]);

  // 🚀 [신규 추가] 필터링된 입고 리스트의 총 구매금액 합계 계산
  const totalAmount = useMemo(() => {
    return filteredPurchases.reduce((acc, cur) => acc + (cur.total_price || 0), 0);
  }, [filteredPurchases]);

  useEffect(() => { 
    setCurrentPage(1); 
    setSelectedIds(new Set()); 
  }, [selectedYear, selectedDept, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / itemsPerPage));
  const paginatedPurchases = filteredPurchases.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleSelectAll = () => {
    const currentPageIds = paginatedPurchases.map(p => p.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 입고 내역을 취소하시겠습니까?\n(취소 시 카탈로그의 현재 재고도 함께 차감됩니다.)')) return;
    try {
      const res = await fetch(`/api/marketing/purchases?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('입고가 성공적으로 취소되었습니다.');
        fetchPurchases();
      } else { alert('취소 실패'); }
    } catch (e) { alert('오류 발생'); }
  };

  const handleExportExcel = () => {
    const targetPurchases = selectedIds.size > 0 
      ? filteredPurchases.filter(p => selectedIds.has(p.id)) 
      : filteredPurchases;

    if (targetPurchases.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const exportData = targetPurchases.map((p, idx) => ({
      'NO': targetPurchases.length - idx,
      '입고일자': new Date(p.purchase_date).toISOString().split('T')[0],
      '물품명': p.item?.name || '(삭제된 물품)',
      '입고수량': p.qty,
      '입고단가(원)': p.unit_price,
      '총 구매금액(원)': p.total_price,
      '공급처': p.vendor || '-',
      '등록자': p.purchaser_name,
      '소속부서': p.purchaser_dept,
      '비고': p.note || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "입고내역");
    XLSX.writeFile(wb, `기념품_입고내역대장_${selectedYear}년_${selectedDept === 'ALL' ? '전체' : selectedDept}.xlsx`);
  };

  if (loading) return <div className="p-10 font-black text-center text-slate-400 animate-pulse mt-20 tracking-widest">장부 동기화 중...</div>;

  return (
    <div className="p-8 space-y-6 font-sans max-w-[1600px] mx-auto pb-20 animate-fade-in relative z-10">
      
      {/* 상단 헤더 */}
      <div className="bg-slate-900 p-8 rounded-[2rem] shadow-xl flex justify-between items-center text-white relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-emerald-500 rounded-full blur-3xl opacity-20"></div>
        <div className="relative z-10">
          <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-2">Purchase & Inbound History</p>
          <h2 className="text-3xl font-black tracking-tight flex items-center gap-3">
            {/* 🚀 명칭 변경 */}
            <span>📥</span> 기념품 입고 내역 대장
          </h2>
        </div>
        <div className="relative z-10 flex items-center gap-3">
          <button onClick={handleExportExcel} className={`px-5 py-2.5 rounded-xl text-[11px] font-black shadow-lg transition-all flex items-center gap-2 ${selectedIds.size > 0 ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-700 text-slate-400 border border-slate-600'}`}>
            <span>📊</span> {selectedIds.size > 0 ? `선택 항목 EXCEL 다운로드 (${selectedIds.size})` : '전체 EXCEL 다운로드'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-50 border-b flex flex-wrap justify-between items-center gap-4">
          <h3 className="text-[13px] font-black text-slate-800 flex items-center gap-2 min-w-max">
            <span>📋</span> 입고 이력 리스트
          </h3>
          
          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            {/* 🚀 [신규 추가] 총 금액 합계 표시 (에메랄드 톤 유지) */}
            <div className="flex items-center gap-2 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-200 shadow-inner">
              <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">💰 합계 금액</span>
              <span className="text-sm font-black text-emerald-700 font-mono">{totalAmount.toLocaleString()} 원</span>
            </div>

            {/* 🚀 [이동됨] 연도 필터 (밝은 테마로 변경) */}
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">🗓️ 연도</span>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent text-[11px] font-black text-slate-700 outline-none cursor-pointer">
                <option value="ALL">TOTAL 모두보기</option>
                {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
            </div>

            {/* 🚀 부서 필터 */}
            <select value={selectedDept} onChange={e => setSelectedDept(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-emerald-500 shadow-sm cursor-pointer text-slate-700">
              <option value="ALL">전체 부서</option>
              {availableDepts.map(dept => <option key={dept} value={dept}>{dept}</option>)}
            </select>
            
            {/* 🚀 검색창 */}
            <div className="relative w-full md:w-64">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input type="text" placeholder="물품명, 구매처, 등록자 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-emerald-500 shadow-inner" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1300px]">
            <thead className="bg-white text-[10px] text-slate-400 font-black tracking-tight uppercase border-b border-slate-200">
              <tr>
                <th className="py-4 pl-4 w-10 text-center">
                  <input type="checkbox" checked={paginatedPurchases.length > 0 && paginatedPurchases.every(p => selectedIds.has(p.id))} onChange={toggleSelectAll} className="accent-emerald-600 w-3 h-3 cursor-pointer" />
                </th>
                <th className="py-4 px-2 w-12 text-center">NO</th>
                <th className="py-4 px-3 w-28 text-center">입고일자</th>
                <th className="py-4 px-3 w-56 text-emerald-600">입고 물품명</th>
                <th className="py-4 px-3 w-24 text-center">수량</th>
                <th className="py-4 px-3 w-32 text-right">단가(원)</th>
                <th className="py-4 px-3 w-32 text-right text-emerald-600">총 구매금액(원)</th>
                <th className="py-4 px-3 w-36 text-center">구매/공급처</th>
                <th className="py-4 px-3 w-24 text-center">등록자</th>
                <th className="py-4 px-3 w-32 text-center">소속부서</th>
                <th className="py-4 px-3 w-40">비고</th>
                <th className="py-4 pr-6 w-24 text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedPurchases.length === 0 ? (
                <tr><td colSpan={12} className="p-16 text-center text-slate-400">해당 조건의 입고 내역이 없습니다.</td></tr>
              ) : paginatedPurchases.map((p, idx) => {
                const visualNo = filteredPurchases.length - ((currentPage - 1) * itemsPerPage + idx);
                
                return (
                  <tr key={p.id} className={`transition-colors h-12 ${selectedIds.has(p.id) ? 'bg-emerald-50/50' : 'hover:bg-emerald-50/20'}`}>
                    <td className="pl-4 text-center">
                      <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => {
                        const next = new Set(selectedIds);
                        next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                        setSelectedIds(next);
                      }} className="accent-emerald-600 w-3 h-3 cursor-pointer" />
                    </td>
                    <td className="px-2 text-center text-slate-400 font-mono">{visualNo}</td>
                    <td className="px-3 text-center font-mono text-slate-500">{new Date(p.purchase_date).toISOString().split('T')[0]}</td>
                    <td className="px-3 text-emerald-700 text-[12px]">{p.item?.name || '(삭제된 물품)'}</td>
                    <td className="px-3 text-center bg-slate-50/50 font-mono">{p.qty} EA</td>
                    <td className="px-3 text-right font-mono text-slate-600">{p.unit_price.toLocaleString()}</td>
                    <td className="px-3 text-right font-mono font-black text-emerald-600 bg-emerald-50/30">{p.total_price.toLocaleString()}</td>
                    <td className="px-3 text-center">{p.vendor || '-'}</td>
                    <td className="px-3 text-center text-slate-800">{p.purchaser_name}</td>
                    <td className="px-3 text-center text-[10px] text-slate-400 whitespace-nowrap">{p.purchaser_dept}</td>
                    <td className="px-3 text-slate-500 truncate max-w-[150px]">{p.note || '-'}</td>
                    <td className="pr-6 text-center">
                      <button onClick={() => handleDelete(p.id)} className="px-3 py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-lg text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                        입고 취소
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center gap-1.5 p-4 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-7 h-7 rounded-lg text-[11px] font-black transition-all border ${currentPage === i + 1 ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}