'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';

const MENU_PATH = '/asset/supplies/master/archive';

/** KST 기준 연·월 문자열 (year: '2026', month: '07') */
function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const raw = String(dateInput).trim();
  // 폐기일 등 YYYY-MM-DD 스냅샷은 파싱 없이 그대로 사용
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return { year: ymd[1], month: ymd[2] };
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return {
    year: String(ym.year),
    month: String(ym.month).padStart(2, '0'),
  };
}
     
function MasterArchiveContent() {
  const pathname = usePathname();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [pendingReqCount, setPendingReqCount] = useState(0);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [searchQuery, setSearchQuery] = useState('');
  /** 진입 시점 KST 연도 (하드코딩 아님) */
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
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
      const [userRes, archiveRes, summaryRes, pendingRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/supplies/master/archive?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
        fetch(`/api/asset/supplies/master/pending-count?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
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
      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/supplies/master/archive'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
      if (pendingRes && pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingReqCount(Number(data.pendingCount) || 0);
      } else {
        setPendingReqCount(0);
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

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
  const disabledActionBtn =
    'px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70';
     
  // 🚀 아이템 리스트에 파싱된 데이터를 미리 매핑해두기 (필터링 및 엑셀 다운로드를 위해)
  const parsedItems = useMemo(() => {
    return items.map(item => {
      let ext = {};
      try { ext = item.description ? JSON.parse(item.description) : {}; } catch(e) {}
      return { ...item, ext };
    });
  }, [items]);
     
  const availableYears = useMemo(() => {
    const years = parsedItems
      .map((i) => getKSTYearMonthParts(i.ext.disposal_date || i.updatedAt || i.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique.sort((a, b) => b.localeCompare(a));
  }, [parsedItems]);
     
  const availableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];
     
  const filteredItems = useMemo(() => {
    return parsedItems.filter(i => {
      const ym = getKSTYearMonthParts(i.ext.disposal_date || i.updatedAt || i.createdAt);
      const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      
      const searchMatch = !searchQuery || 
        i.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        i.ext.disposal_reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.ext.disposer_name?.toLowerCase().includes(searchQuery.toLowerCase());
        
      return yearMatch && monthMatch && searchMatch;
    }).sort((a, b) => {
      const aKey = String(a.ext.disposal_date || getKSTDateString(a.updatedAt || a.createdAt) || '');
      const bKey = String(b.ext.disposal_date || getKSTDateString(b.updatedAt || b.createdAt) || '');
      return bKey.localeCompare(aKey);
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
    if (!canEdit) return alertNoEditPermission();
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
     
  // LV_1 영구 삭제
  const handleDeleteArchived = async (ids: string[]) => {
    if (!canEdit) return alertNoEditPermission();
    if (!isLV1) return alert("영구 삭제 권한이 없습니다. (LV_1 전용)");
    if (!confirm(`선택한 ${ids.length}개의 아카이브 내역을 영구 삭제하시겠습니까? (LV_1)\n이 작업은 데이터베이스에서 완전히 파기되며 되돌릴 수 없습니다.`)) return;
    
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
        '처리자 부서': item.ext.disposer_dept || '-',

      };
    });
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "폐기자산_목록");
    XLSX.writeFile(wb, `소모품_폐기자산_아카이브_${getKSTDateString()}.xlsx`);
  };
     
  if (loading) return <LoadingState />;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
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
      더이상 지급하지 않는 소모품의 폐기 이력을 관리합니다.
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
        {!canEdit && (
          <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
            편집 권한 없음 — 조회만 가능
          </span>
        )}
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
            const showPendingBadge = tab.id === 'requests' && pendingReqCount > 0;
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
                    {pendingReqCount}
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
     
      {isTableOpen && (
        <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4 mt-6">
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-600 shrink-0"></div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">폐기자산 아카이브 장부</h2>
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredItems.length}건</span>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                <select value={selectedYear} onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                  <option value="ALL">전체</option>
                  {availableYears.map(year => <option key={year} value={year}>{year}년</option>)}
                </select>
                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>
                <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                <select value={selectedMonth} onChange={(e) => { setSelectedMonth(e.target.value); setCurrentPage(1); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                  <option value="ALL">전체</option>
                  {availableMonths.map(month => <option key={month} value={month}>{month}월</option>)}
                </select>
              </div>
              <div className="relative w-48">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
                <input type="text" placeholder="물품, 사유, 처리자 검색..." value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors" />
              </div>
              <button onClick={handleDownloadExcel} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap">
                {selectedIds.size > 0 ? `선택 EXCEL 다운로드(${selectedIds.size})` : '화면 목록 EXCEL 다운로드'}
              </button>
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
              <colgroup>
                <col className="w-[40px]" />
                <col className="w-[48px]" />
                <col className="w-[100px]" />
                <col className="w-[200px]" />
                <col className="w-[100px]" />
                <col />
                <col className="w-[120px]" />
                <col className="w-[160px]" />
              </colgroup>
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 text-center">
                    <input type="checkbox" checked={paginatedItems.length > 0 && paginatedItems.every(p => selectedIds.has(p.id))} onChange={toggleSelectAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                  </th>
                  <th className="h-12 px-2 text-center">NO</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">폐기 처리일</th>
                  <th className="h-12 px-2 text-indigo-600">물품명</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">최종 재고</th>
                  <th className="h-12 px-2">폐기 사유 (비고)</th>
                  <th className="h-12 px-2 text-center border-l border-slate-200 whitespace-nowrap">부서 / 처리자</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap border-l border-slate-200">관리 액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedItems.length === 0 ? (
                  <tr><td colSpan={8} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 아카이브 내역이 없습니다.</td></tr>
                ) : paginatedItems.map((item, i) => {
                  let displayDate = '-';
                  if (item.ext.disposal_date) {
                    displayDate = String(item.ext.disposal_date).substring(0, 10);
                  }
                  const sUnit = item.ext.s_unit || item.ext.r_unit || '';
                  const rowNo = filteredItems.length - ((currentPage - 1) * itemsPerPage) - i;
                  const isSelected = selectedIds.has(item.id);
     
                  return (
                    <tr key={item.id} className={`hover:bg-slate-50/50 h-12 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                      <td className="pl-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); isSelected ? next.delete(item.id) : next.add(item.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                      </td>
                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">{displayDate}</td>
                      <td className="px-2 text-indigo-700 truncate" title={item.name}>{item.name}</td>
                      <td className="px-2 text-center font-mono whitespace-nowrap tabular-nums text-red-500">
                        {Number(item.current_stock || 0).toLocaleString()}
                        {sUnit && <span className="text-[9px] text-slate-400 font-bold ml-0.5">{sUnit}</span>}
                      </td>
                      <td className="px-2 text-slate-600 truncate" title={item.ext.disposal_reason || ''}>
                        {item.ext.disposal_reason || '-'}
                      </td>
                      <td className="px-2 text-center border-l border-slate-200">
                        <div className="truncate">
                          <span className="text-[10px] text-slate-500 block truncate">{item.ext.disposer_dept || '-'}</span>
                          <span className="text-slate-800 truncate">{item.ext.disposer_name || '관리자'}</span>
                        </div>
                      </td>
                      <td className="px-2 text-center border-l border-slate-200">
                        <div className="flex items-center justify-center gap-0.5 w-full flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleRestore(item.id)}
                            title={canEdit ? '대시보드 복구' : '편집 권한 필요'}
                            className={
                              canEdit
                                ? 'px-1.5 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-md text-[10px] font-black hover:bg-indigo-100 shadow-sm whitespace-nowrap'
                                : disabledActionBtn
                            }
                          >
                            대시보드 복구
                          </button>
                          {canEdit ? (
                            isLV1 ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteArchived([item.id])}
                                title="아카이브 영구 삭제 — LV_1 전용"
                                className="px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap"
                              >
                                삭제(LV_1)
                              </button>
                            ) : null
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDeleteArchived([item.id])}
                              title="편집 권한 필요"
                              className={disabledActionBtn}
                            >
                              삭제(LV_1)
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {filteredItems.length > 0 && (
            <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
     
export default function MasterArchiveModule() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MasterArchiveContent />
    </Suspense>
  );
}