'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';

// 🚀 1. 알맹이 함수: 이름을 DeptDistributionContent로 변경
function DeptDistributionContent() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  
  useEffect(() => {
    const initData = async () => {
      try {
        const [uRes, iRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/admin/interface')
        ]);
  
        if (uRes.ok) {
          const user = await uRes.json();
          setCurrentUser(user);
          
          if (user?.unit?.unit_name) {
            const dRes = await fetch(`/api/marketing/distributions?dept=${encodeURIComponent(user.unit.unit_name)}`);
            if (dRes.ok) setDistributions(await dRes.json());
          }
        }
  
        if (iRes.ok) {
          const interfaces = await iRes.json();
          const config = interfaces.find((m: any) => m.path === '/marketing/distribution/dept');
          setInterfaceConfig(config);
        }
      } catch(e) {
        console.error("데이터 로드 실패:", e);
      }
      setLoading(false);
    };
    initData();
  }, []);
  
  const safeArray = (val: any) => {
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val) || []; } catch(e) { return []; }
  };
  
  const canEdit = useMemo(() => {
    if (!currentUser || !interfaceConfig) return false;
    const myRole = currentUser.roles?.[0];
    const myEmail = currentUser.email;
    const myId = currentUser.id;
  
    const eRoles = safeArray(interfaceConfig.edit_role_ids);
    const tMasters = safeArray(interfaceConfig.task_masters);
    
    if (interfaceConfig.master_editor_id === myId) return true;
    if (eRoles.includes(myRole)) return true;
    if (tMasters.some((tm: any) => tm.email === myEmail)) return true;
  
    return false;
  }, [currentUser, interfaceConfig]);
  
  const handleDelete = async (id: string) => {
    if (!confirm('정말 취소하시겠습니까? (취소 시 재고가 자동으로 복구됩니다)')) return;
    const res = await fetch(`/api/marketing/distributions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setDistributions(prev => prev.filter(d => d.id !== id));
      alert('취소(삭제)가 완료되었습니다.');
    }
  };
  
  const availableYears = useMemo(() => {
    const years = distributions.map(d => new Date(d.createdAt).getFullYear().toString());
    const unique = Array.from(new Set(years)).sort((a,b) => b.localeCompare(a));
    const currentYear = new Date().getFullYear().toString();
    if (!unique.includes(currentYear)) unique.push(currentYear);
    return unique;
  }, [distributions]);
  
  const filteredList = useMemo(() => {
    return distributions.filter(d => {
      const yearMatch = selectedYear === 'ALL' || new Date(d.createdAt).getFullYear().toString() === selectedYear;
      const searchMatch = !searchQuery || 
        d.client_name.includes(searchQuery) || 
        d.item?.name?.includes(searchQuery) ||
        d.sender_name.includes(searchQuery);
      return yearMatch && searchMatch;
    });
  }, [distributions, selectedYear, searchQuery]);
  
  const totalAmountForYear = useMemo(() => {
    return filteredList.reduce((acc, cur) => acc + (cur.item?.unit_price || 0) * cur.qty, 0);
  }, [filteredList]);
  
  const totalPages = Math.max(1, Math.ceil(filteredList.length / itemsPerPage));
  const paginatedList = filteredList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  useEffect(() => { 
    setCurrentPage(1); 
    setSelectedIds(new Set()); 
  }, [selectedYear, searchQuery]);
  
  const toggleAll = () => {
    const currentPageIds = paginatedList.map(d => d.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
  
  const handleDownloadExcel = () => {
    const targetList = selectedIds.size > 0 
      ? distributions.filter(d => selectedIds.has(d.id))
      : filteredList;
  
    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");
  
    const exportData = targetList.map((d, i) => ({
      'NO': targetList.length - i,
      '물품명': d.item?.name,
      '단가(원)': d.item?.unit_price,
      '개수': d.qty,
      '총 금액(원)': (d.item?.unit_price || 0) * d.qty,
      '지급목적': d.purpose,
      '고객사(회사명)': d.client_name,
      '고객사 부서': d.client_dept,
      '물품신청일': new Date(d.createdAt).toISOString().split('T')[0],
      '결재일': new Date(d.dist_date).toISOString().split('T')[0],
      '신청자': d.sender_name,
      '소속부서': d.sender_dept
    }));
  
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서지급현황");
    XLSX.writeFile(wb, `${currentUser?.unit?.unit_name || '부서'}_지급현황대장_${selectedYear}년.xlsx`);
  };
  
  if (loading) return <div className="p-10 font-black text-center text-slate-400 animate-pulse mt-20 tracking-widest">부서 데이터를 동기화 중입니다...</div>;
  
  return (
    <div className="p-8 space-y-6 font-sans max-w-[1600px] mx-auto pb-20 animate-fade-in relative z-10">
      <div className="bg-slate-900 p-8 rounded-[2rem] shadow-xl flex justify-between items-center text-white relative overflow-hidden border-b-4 border-blue-500">
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-blue-500 rounded-full blur-3xl opacity-20"></div>
        <div className="relative z-10">
          <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest mb-2">Department Distribution Status</p>
          <h2 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <span>🏢</span> <span className="text-blue-400">{currentUser?.unit?.unit_name || '소속 부서'}</span> 지급 현황 대장
          </h2>
        </div>
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-800 px-4 py-2.5 rounded-xl border border-slate-700 shadow-inner">
            <span className="text-[10px] font-black text-slate-400 uppercase">🗓️ 연도</span>
            <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent text-[11px] font-black text-white outline-none cursor-pointer">
              <option value="ALL">TOTAL 모두보기</option>
              {availableYears.map(y => <option key={y} value={y} className="text-slate-900">{y}년</option>)}
            </select>
          </div>
          <button onClick={handleDownloadExcel} className={`px-5 py-2.5 rounded-xl text-[11px] font-black shadow-lg transition-all flex items-center gap-2 ${selectedIds.size > 0 ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-slate-700 text-slate-400 border border-slate-600'}`}>
            <span>📊</span> {selectedIds.size > 0 ? `${selectedIds.size}건 EXCEL 다운로드` : '전체 EXCEL 다운로드'}
          </button>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <div className="p-4 px-6 bg-slate-50 border-b flex flex-wrap justify-between items-center gap-4">
          <h3 className="text-[13px] font-black text-slate-800 flex items-center gap-2"><span>👥</span> 우리 부서원 지급 이력 리스트</h3>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-xl border border-blue-200 shadow-inner">
              <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">💰 {selectedYear}년 총 금액</span>
              <span className="text-sm font-black text-blue-700 font-mono">{totalAmountForYear.toLocaleString()} 원</span>
            </div>
  
            <div className="relative w-72">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input type="text" placeholder="물품명, 고객사, 신청자 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500 shadow-sm" />
            </div>
          </div>
        </div>
  
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1500px]">
            <thead className="bg-white text-[10px] text-slate-400 font-black tracking-tight uppercase border-b border-slate-200">
              <tr>
                <th className="py-4 pl-6 w-12 text-center">
                  <input type="checkbox" checked={paginatedList.length > 0 && paginatedList.every(d => selectedIds.has(d.id))} onChange={toggleAll} className="w-4 h-4 accent-blue-600 cursor-pointer" />
                </th>
                <th className="py-4 px-2 w-12 text-center">NO</th>
                <th className="py-4 px-3 w-40 text-blue-600">물품명</th>
                <th className="py-4 px-3 w-24 text-right">단가(원)</th>
                <th className="py-4 px-3 w-20 text-center">개수</th>
                <th className="py-4 px-3 w-28 text-right text-blue-500">총 금액(원)</th>
                <th className="py-4 px-3 w-48">지급목적</th>
                <th className="py-4 px-3 w-40 text-emerald-600">고객사 (회사명)</th>
                <th className="py-4 px-3 w-32">고객사 부서</th>
                <th className="py-4 px-3 w-24 text-center">신청일</th>
                <th className="py-4 px-3 w-24 text-center">결재일</th>
                <th className="py-4 px-3 w-24 text-center text-indigo-600">신청자</th>
                <th className="py-4 px-3 w-36 text-center">소속부서</th>
                <th className="py-4 pr-6 w-24 text-center">관리기능</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedList.length === 0 ? (
                <tr><td colSpan={14} className="p-16 text-center text-slate-400">데이터가 없습니다.</td></tr>
              ) : paginatedList.map((d, idx) => {
                const isSelected = selectedIds.has(d.id);
                return (
                  <tr key={d.id} className={`transition-colors h-12 ${isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                    <td className="pl-6 text-center">
                      <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(d.id) ? next.delete(d.id) : next.add(d.id); setSelectedIds(next); }} className="w-4 h-4 accent-blue-600 cursor-pointer" />
                    </td>
                    <td className="px-2 text-center text-slate-400">{filteredList.length - ((currentPage - 1) * itemsPerPage + idx)}</td>
                    <td className="px-3 text-blue-700 text-[12px]">{d.item?.name || '(삭제됨)'}</td>
                    <td className="px-3 text-right font-mono">{d.item?.unit_price?.toLocaleString()}</td>
                    <td className="px-3 text-center bg-slate-50/50 font-mono">{d.qty} EA</td>
                    <td className="px-3 text-right font-mono font-black text-blue-600 bg-blue-50/30">
                      {((d.item?.unit_price || 0) * d.qty).toLocaleString()} 원
                    </td>
                    <td className="px-3 text-slate-500 truncate max-w-[180px]" title={d.purpose}>{d.purpose}</td>
                    <td className="px-3 font-black text-emerald-700 text-[12px]">{d.client_name}</td>
                    <td className="px-3 text-slate-500 truncate">{d.client_dept}</td>
                    <td className="px-3 text-center text-slate-400 font-mono">{new Date(d.createdAt).toISOString().split('T')[0]}</td>
                    <td className="px-3 text-center font-black text-blue-500 font-mono">{new Date(d.dist_date).toISOString().split('T')[0]}</td>
                    <td className="px-3 text-center font-black text-indigo-700">{d.sender_name}</td>
                    <td className="px-3 text-center text-[10px] text-slate-500 whitespace-nowrap">{d.sender_dept}</td>
                    <td className="pr-6 text-center">
                      {canEdit ? (
                        <button onClick={() => handleDelete(d.id)} className="px-2 py-1.5 bg-red-50 text-red-500 border border-red-100 text-[9px] font-black rounded hover:bg-red-500 hover:text-white shadow-sm transition-colors">
                          ✕ 취소
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-300 font-bold">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center gap-1.5 p-3 bg-white border-t border-slate-100">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-7 h-7 rounded-lg text-[11px] font-black transition-all ${currentPage === i + 1 ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 🚀 2. 껍데기 모듈 
export default function DeptDistributionModule() {
  return (
    <Suspense fallback={<div className="p-10 text-center font-black animate-pulse">Loading Application...</div>}>
      <DeptDistributionContent />
    </Suspense>
  );
}