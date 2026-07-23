'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString } from '@/utils/dateUtils';
     
function MasterArchiveContent() {
  const pathname = usePathname();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  
  const tabItems = [
    { id: 'dashboard', name: '🗂️ 소모품 마스터 대시보드', path: '/asset/supplies/master/dashboard' },
    { id: 'requests', name: '📋 사용자 신청현황 관리', path: '/asset/supplies/master/requests' },
    { id: 'purchase', name: '💰 입고/구매 내역 대장', path: '/asset/supplies/master/purchase' },
    { id: 'archive', name: '📁 폐기자산 아카이브', path: '/asset/supplies/master/archive' },
  ];
     
  useEffect(() => { 
    fetchData(); 
  }, []);
  
  const fetchData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, archiveRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/supplies/master/archive?t=${ts}`, { cache: 'no-store' })
      ]);
      
      if (userRes.ok) setCurrentUser(await userRes.json());
      if (archiveRes.ok) {
        setItems(await archiveRes.json() || []);
      } else if (archiveRes.status === 401 || archiveRes.status === 403) {
        const err = await archiveRes.json().catch(() => ({}));
        alert(err.error || '아카이브 권한이 없습니다.');
      } else {
        const err = await archiveRes.json().catch(() => ({}));
        alert(err.error || '아카이브 데이터를 불러오지 못했습니다.');
      }
    } catch (e) {
      console.error("Archive Sync Error", e);
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };
  
  // 🚀 권한 체크 (LV_1)
  const isLV1 = currentUser?.roles?.includes('LV_1') || currentUser?.role === 'LV_1';
     
  // 🚀 아이템 리스트에 파싱된 데이터를 미리 매핑해두기 (필터링 및 엑셀 다운로드를 위해)
  const parsedItems = useMemo(() => {
    return items.map(item => {
      let ext = {};
      try { ext = item.description ? JSON.parse(item.description) : {}; } catch(e) {}
      return { ...item, ext };
    });
  }, [items]);
     
  const availableYears = useMemo(() => {
    const years = parsedItems.map(i => {
      const raw = i.ext.disposal_date || i.updatedAt || i.createdAt;
      if (!raw) return '';
      const d = new Date(raw);
      return isNaN(d.getTime()) ? '' : d.getFullYear().toString();
    }).filter(Boolean);
    return Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
  }, [parsedItems]);
     
  const availableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];
     
  const filteredItems = useMemo(() => {
    return parsedItems.filter(i => {
      const raw = i.ext.disposal_date || i.updatedAt || i.createdAt;
      let itemYear = '';
      let itemMonth = '';
      
      if (raw) {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          itemYear = d.getFullYear().toString();
          itemMonth = String(d.getMonth() + 1).padStart(2, '0');
        }
      }
      
      const yearMatch = selectedYear === 'ALL' || itemYear === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || itemMonth === selectedMonth;
      
      const searchMatch = !searchQuery || 
        i.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        i.ext.disposal_reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.ext.disposer_name?.toLowerCase().includes(searchQuery.toLowerCase());
        
      return yearMatch && monthMatch && searchMatch;
    }).sort((a, b) => {
      const dateA = new Date(a.ext.disposal_date || a.updatedAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.ext.disposal_date || b.updatedAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });
  }, [parsedItems, selectedYear, selectedMonth, searchQuery]);
     
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
     
  // 🚀 복구 로직
  const handleRestore = async (id: string) => {
    if (!confirm('해당 품목을 대시보드 운영 리스트로 복구하시겠습니까?')) return;
    try {
      const res = await fetch('/api/asset/supplies/master/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: true })
      });
      if (res.ok) { alert('✅ 대시보드로 복구되었습니다.'); fetchData(); } 
      else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 복구 실패: ${err.error || '권한을 확인하세요.'}`);
      }
    } catch (e) { alert("서버 통신 오류"); }
  };
     
  // 🚀 LV_1 영구 삭제 로직
  const handleDeleteArchived = async (ids: string[]) => {
    if (!isLV1) return alert("영구 삭제 권한이 없습니다. (LV_1 전용)");
    if (!confirm(`선택한 ${ids.length}개의 아카이브 내역을 영구 삭제하시겠습니까?\n이 작업은 데이터베이스에서 완전히 파기되며 되돌릴 수 없습니다.`)) return;
    
    try {
      const deletePromises = ids.map(id => fetch(`/api/asset/supplies/master/archive?id=${id}`, { method: 'DELETE' }));
      const results = await Promise.all(deletePromises);
      const failed = results.filter(res => !res.ok);
     
      if (failed.length === 0) alert('✅ 영구 삭제되었습니다.');
      else {
        const err = await failed[0].json().catch(() => ({}));
        alert(`⚠️ 일부 항목 삭제 실패: ${err.error || '권한을 확인하세요.'}`);
      }
      
      setSelectedIds(new Set()); 
      fetchData();
    } catch (e) { alert("삭제 중 통신 오류 발생"); }
  };

  // 🚀 엑셀 다운로드 추가
  const handleDownloadExcel = () => {
    const targetList = selectedIds.size > 0 ? filteredItems.filter(i => selectedIds.has(i.id)) : filteredItems;
    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");
    
    const exportData = targetList.map((item, idx) => {
      return {
        'NO': targetList.length - idx,
        '폐기 처리일': item.ext.disposal_date ? item.ext.disposal_date.substring(0, 10) : '-',
        '물품명': item.name || '-',
        '최종 재고': item.current_stock || 0,
        '폐기 사유 (비고)': item.ext.disposal_reason || '-',
        '처리자 이름': item.ext.disposer_name || '관리자',
        '처리자 부서': item.ext.disposer_dept || '-'
      };
    });
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "폐기자산_목록");
    XLSX.writeFile(wb, `소모품_폐기자산_아카이브_${getKSTDateString()}.xlsx`);
  };
     
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-slate-400 uppercase tracking-widest">Loading Archive...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
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
        더이상 지급하지 않는 소모품의 폐기 이력을 관리합니다.
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
     
      {isTableOpen && (
        <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4 mt-6">
          <div className="p-5 bg-slate-50 border-b flex justify-between items-center flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total Archived: <span className="text-indigo-600">{filteredItems.length}</span></span>
              {/* 🚀 LV_1 전용 선택 삭제 버튼 */}
              <button 
                onClick={() => handleDeleteArchived(Array.from(selectedIds))} 
                disabled={!isLV1 || selectedIds.size === 0} 
                className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${isLV1 && selectedIds.size > 0 ? 'bg-red-50 text-red-600 border border-red-200 shadow-sm hover:bg-red-600 hover:text-white' : 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed'}`}
                title={!isLV1 ? "LV_1 등급 관리자만 영구 삭제가 가능합니다." : ""}
              >
                🗑️ 선택 영구삭제 ({selectedIds.size})
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <select value={selectedYear} onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <option value="ALL">전체 연도</option>
                {availableYears.map(year => <option key={year} value={year}>{year}년</option>)}
              </select>
              
              <select value={selectedMonth} onChange={(e) => { setSelectedMonth(e.target.value); setCurrentPage(1); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <option value="ALL">전체 월</option>
                {availableMonths.map(month => <option key={month} value={month}>{month}월</option>)}
              </select>
              
              {/* 🚀 엑셀 다운로드 버튼 */}
              <button onClick={handleDownloadExcel} className="text-[10px] font-black bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-1.5 hover:bg-emerald-100 transition-colors shadow-sm">
                {selectedIds.size > 0 ? `선택 항목 엑셀 다운로드 (${selectedIds.size})` : '화면 목록 엑셀 다운로드 ⬇️'}
              </button>

              <input type="text" placeholder="물품, 사유, 처리자 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-48 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm" />
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
                  <th className="p-3 w-40 text-center">액션 제어</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium bg-white">
                {paginatedItems.length === 0 ? (
                  <tr><td colSpan={7} className="h-32 text-center text-slate-400 italic font-bold">조건에 맞는 아카이브 내역이 없습니다.</td></tr>
                ) : paginatedItems.map((item) => {
                  
                  let displayDate = '-';
                  if (item.ext.disposal_date) {
                    displayDate = item.ext.disposal_date.substring(0, 10);
                  }
     
                  let sUnit = item.ext.r_unit || item.ext.s_unit || '';
     
                  return (
                    <tr key={item.id} className={`hover:bg-slate-50 h-12 ${selectedIds.has(item.id) ? 'bg-indigo-50/20' : ''}`}>
                      <td className="p-3 text-center">
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => { const next = new Set(selectedIds); selectedIds.has(item.id) ? next.delete(item.id) : next.add(item.id); setSelectedIds(next); }} className="accent-indigo-600 cursor-pointer" />
                      </td>
                      <td className="p-3 text-center font-mono text-slate-600 text-[10px]">{displayDate}</td>
                      <td className="p-3 font-black text-slate-800 text-[12px] truncate">{item.name}</td>
                      <td className="p-3 text-center font-mono font-bold text-red-500">
                        {item.current_stock?.toLocaleString()} {sUnit}
                      </td>
                      
                      {/* 🚀 파싱된 사유와 처리자 정보 바인딩 */}
                      <td className="p-3 text-slate-500 font-medium italic truncate max-w-[400px]">
                        {item.ext.disposal_reason || '-'}
                      </td>
                      <td className="p-3 text-center flex flex-col justify-center items-center">
                        <span className="text-slate-800 font-bold leading-tight">{item.ext.disposer_name || '관리자'}</span>
                        <span className="text-[9px] text-slate-400">{item.ext.disposer_dept || '-'}</span>
                      </td>
                      
                      <td className="p-3 border-l border-slate-100 bg-slate-50/30">
                        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                          <button onClick={() => handleRestore(item.id)} className="px-3 py-1.5 border border-indigo-200 bg-indigo-50 rounded-md text-[10px] font-black text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all shadow-sm">
                            대시보드 복구
                          </button>
                          {/* 🚀 개별 영구 삭제 버튼 (LV1 전용) */}
                          <button 
                            onClick={() => handleDeleteArchived([item.id])} 
                            disabled={!isLV1}
                            title={!isLV1 ? "LV_1 관리자만 영구삭제가 가능합니다." : "데이터베이스에서 완전히 파기합니다."}
                            className={`px-3 py-1.5 border rounded-md text-[10px] font-black transition-all shadow-sm ${isLV1 ? 'border-red-200 bg-white text-red-500 hover:bg-red-50' : 'border-slate-200 bg-slate-100 text-slate-300 cursor-not-allowed'}`}
                          >
                            영구삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-4 pb-4 border-t border-slate-100 bg-white">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-lg font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-7 h-7 rounded-lg font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-indigo-600 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-lg font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
            </div>
          )}
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