'use client';
     
import React, { useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import * as XLSX from 'xlsx';
     
function DeptContent() {
  const [requests, setRequests] = useState<any[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]); // 🚀 [추가] 조직도 상태 추가
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchItemQuery, setSearchItemQuery] = useState('');
  const [searchUserQuery, setSearchUserQuery] = useState('');

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));

  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'COMPLETED' | 'PENDING' | 'REJECTED'>('ALL');
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => { 
    fetchData(); 
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, reqRes, unitRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        // 💡 하위 데이터를 모두 보려면 백엔드 API가 넓은 범위의 데이터를 주어야 합니다. 
        // 안 나온다면 주소를 '/api/asset/supplies/requests' 등으로 변경해 보세요.
        fetch(`/api/asset/supplies/dept?t=${ts}`, { cache: 'no-store' }),
        fetch('/api/admin/units?active=true').catch(() => null) // 🚀 [추가] 조직도 로드
      ]);

      if (userRes.ok) setCurrentUser(await userRes.json());
      if (reqRes.ok) setRequests(await reqRes.json());
      if (unitRes?.ok) setUnitsList(await unitRes.json());

    } catch(e) { 
      console.error("Data fetch error", e); 
    } finally {
      setLoading(false);
    }
  };

  // 🚀 [신규 로직] 1. 본부 하위의 조직(센터/파트)을 모두 찾아내는 재귀 함수
  const getDescendantDepts = useCallback((targetDeptName: string) => {
    if (!unitsList.length) return [targetDeptName];
    const targetUnit = unitsList.find(u => u.unit_name === targetDeptName);
    if (!targetUnit) return [targetDeptName];

    const results = new Set<string>();
    results.add(targetUnit.unit_name); // 본부 추가

    const findChildren = (parentId: string) => {
      unitsList.filter(u => u.parent_id === parentId).forEach(child => {
        results.add(child.unit_name);
        findChildren(child.id);
      });
    };

    findChildren(targetUnit.id);
    return Array.from(results);
  }, [unitsList]);

  // 🚀 [신규 로직] 2. 로그인 사용자의 본부 + 하위 센터 목록 도출
  const allowedDepts = useMemo(() => {
    const myDept = currentUser?.unit?.unit_name || currentUser?.dept_name;
    if (!myDept || !unitsList.length) return [myDept || ''];
    return getDescendantDepts(myDept);
  }, [currentUser, unitsList, getDescendantDepts]);

  // 🚀 [신규 로직] 3. 전체 데이터에서 본부 및 하위 센터 데이터만 걸러낸 최종 타겟 리스트
  const deptRequests = useMemo(() => {
    if (!allowedDepts.length) return requests;
    return requests.filter(r => {
      const rDept = r.dept || r.user_dept || r.unit_name; // API 응답 필드명에 맞춰 확인
      if (!rDept) return true; 
      return allowedDepts.includes(rDept);
    });
  }, [requests, allowedDepts]);

  // 🚀 [수정] 아래부터는 기존 requests 대신 deptRequests를 사용합니다.
  const availableYears = useMemo(() => {
    const years = deptRequests.map(r => (r.createdAt || '').substring(0, 4)).filter(Boolean);
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = new Date().getFullYear().toString();
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [deptRequests]);

  const availableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];

  const filteredRequests = useMemo(() => {
    return deptRequests.filter(r => {
      let reqYear = '';
      let reqMonth = '';
      if (r.createdAt) {
        const d = new Date(r.createdAt);
        if (!isNaN(d.getTime())) {
          reqYear = d.getFullYear().toString();
          reqMonth = String(d.getMonth() + 1).padStart(2, '0');
        }
      }
      
      const yearMatch = selectedYear === 'ALL' || reqYear === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || reqMonth === selectedMonth;
      
      const itemName = r.item_name || r.item?.name || '';
      const itemMatch = !searchItemQuery || itemName.toLowerCase().includes(searchItemQuery.toLowerCase());
      const userMatch = !searchUserQuery || (r.user_name || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      
      const statusMatch = selectedStatus === 'ALL' ||
        (selectedStatus === 'COMPLETED' && (r.status === 'COMPLETED' || r.status === '지급완료')) ||
        (selectedStatus === 'PENDING' && (r.status === 'PENDING' || r.status === '대기중')) ||
        (selectedStatus === 'REJECTED' && (r.status === 'REJECTED' || r.status === '반려'));
      
      const itemFilterMatch = !selectedItemFilter || itemName === selectedItemFilter;
      
      return yearMatch && monthMatch && itemMatch && userMatch && statusMatch && itemFilterMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [deptRequests, selectedYear, selectedMonth, searchItemQuery, searchUserQuery, selectedStatus, selectedItemFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedYear, selectedMonth, searchItemQuery, searchUserQuery, selectedStatus, selectedItemFilter]);

  const toggleSelectAll = () => {
    const currentPageIds = paginatedRequests.map(r => r.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { 
      year: '2-digit', month: '2-digit', day: '2-digit', 
      hour: '2-digit', minute: '2-digit', hour12: false 
    });
  };

  const handleExportExcel = () => {
    const target = selectedIds.size > 0 ? filteredRequests.filter(r => selectedIds.has(r.id)) : filteredRequests;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = target.map((r, idx) => {
      let sUnit = '';
      try {
        const itemExt = r.item?.description ? JSON.parse(r.item.description) : {};
        sUnit = r.unit || itemExt.s_unit || itemExt.r_unit || '';
      } catch (e) {}
      
      const itemName = r.item_name || r.item?.name || '';
      return {
        'NO': target.length - idx, 
        '신청일시': formatDateTime(r.createdAt),
        '신청자': r.user_name || '', 
        '물품명': itemName,
        '신청수량': sUnit ? `${r.qty} ${sUnit}` : r.qty, 
        '사용자 의견': r.note || '', 
        '관리자 답변': r.admin_opinion || '',
        '처리자': r.admin_name || '', 
        '처리일시': r.completedAt ? formatDateTime(r.completedAt) : '',
        '상태': r.status === 'COMPLETED' ? '지급완료' : r.status === 'REJECTED' ? '반려' : '대기중'
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서소모품신청내역");
    
    const monthStr = selectedMonth !== 'ALL' ? `_${selectedMonth}월` : '';
    const statusStr = selectedStatus !== 'ALL' ? `_${selectedStatus}` : '';
    const itemStr = selectedItemFilter ? `_${selectedItemFilter}` : '';
    XLSX.writeFile(wb, `부서_소모품신청현황_${selectedYear === 'ALL' ? '전체' : selectedYear}년${monthStr}${statusStr}${itemStr}.xlsx`);
  };

  const statsData = useMemo(() => {
    // 🚀 [수정] requests 대신 deptRequests 사용
    const periodReqs = deptRequests.filter(r => {
      let reqYear = '';
      let reqMonth = '';
      if (r.createdAt) {
        const d = new Date(r.createdAt);
        if (!isNaN(d.getTime())) {
          reqYear = d.getFullYear().toString();
          reqMonth = String(d.getMonth() + 1).padStart(2, '0');
        }
      }
      const yearMatch = selectedYear === 'ALL' || reqYear === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || reqMonth === selectedMonth;
      return yearMatch && monthMatch;
    });
      
    const totalQty = periodReqs.reduce((sum, cur) => sum + (Number(cur.qty) || 0), 0);
   
    const itemMap = periodReqs.reduce((acc: Record<string, number>, cur) => {
      const name = cur.item_name || cur.item?.name;
      if (name) acc[name] = (acc[name] || 0) + (Number(cur.qty) || 0);
      return acc;
    }, {});
   
    const allItems = (Object.entries(itemMap) as [string, number][])
      .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
      .map(([name, qty]) => ({ name, qty }));

    const totalReqCount = periodReqs.length;
    const statusMap = { COMPLETED: 0, PENDING: 0, REJECTED: 0 };
   
    periodReqs.forEach(r => {
      if (r.status === 'COMPLETED' || r.status === '지급완료') statusMap.COMPLETED++;
      else if (r.status === 'REJECTED' || r.status === '반려') statusMap.REJECTED++;
      else statusMap.PENDING++;
    });

    const statusStats = [
      { id: 'COMPLETED', label: '✅ 지급 완료', count: statusMap.COMPLETED, color: 'emerald' },
      { id: 'PENDING', label: '⏳ 승인 대기중', count: statusMap.PENDING, color: 'orange' },
      { id: 'REJECTED', label: '❌ 반려 / 취소', count: statusMap.REJECTED, color: 'red' }
    ].map(s => ({
      ...s,
      percent: totalReqCount > 0 ? ((s.count / totalReqCount) * 100).toFixed(1) : '0.0'
    }));

    return { totalQty, totalReqCount, allItems, statusStats };
  }, [deptRequests, selectedYear, selectedMonth]);
     
  const myDeptName = currentUser?.unit?.unit_name || currentUser?.dept_name;
     
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading Dept Data...</div>;
  
  const statsTitle = `${selectedYear === 'ALL' ? '전체 기간' : `${selectedYear}년`} ${selectedMonth === 'ALL' ? '' : `${selectedMonth}월`}`;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
   {/* 🚀 부서 지급 대장 (Slate) - 최상위 140px 표준 규격 통일 */}
<div className="w-full bg-slate-800 p-6 rounded-[2.5rem] text-white shadow-lg relative overflow-hidden flex flex-col justify-center min-h-[140px]">
  
  <div className="relative z-10 flex justify-between items-end">
    
    {/* 좌측 텍스트 영역 */}
    <div>
      {/* 1. 상단 라벨 (파란색 배너와 동일하게 mb-3 여백 적용) */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
        SUPPLIES MANAGEMENT SYSTEM
      </h3>
      
   {/* 2. 메인 타이틀 (대괄호 제거 및 통일된 박스 뱃지 스타일 적용) */}
<h1 className="text-2xl font-black tracking-tight text-white leading-none flex items-center flex-wrap gap-2.5">
  {/* 🏢 부서명 독립형 박스 뱃지 (대괄호 문자 완전 제거) */}
  <span className="bg-slate-700/60 border border-slate-600 text-indigo-300 px-4 py-2 rounded-2xl text-lg font-black tracking-tight shrink-0 shadow-inner">
  {myDeptName || '조직'}
</span>
  
  {/* 🎯 메인 타이틀 텍스트 */}
  <span className="text-white">부서 소모품 지급 대장</span>
</h1>
      
      {/* 3. 하단 설명 (파란색 배너와 동일하게 mt-4 여백 적용) */}
      <p className="text-slate-300 text-xs font-semibold mt-4 opacity-90">
        우리 부서 구성원들의 소모품 신청 내역 및 처리 현황을 조회합니다.
      </p>
    </div>

    {/* 우측 액션 버튼 */}
    <button 
      onClick={() => setIsTableOpen(!isTableOpen)} 
      className="bg-white/10 hover:bg-white/20 px-5 py-2 rounded-xl text-[11px] font-black text-white transition-colors uppercase whitespace-nowrap shadow-sm border border-white/10"
    >
      {isTableOpen ? '목록 닫기 ▲' : '목록 열기 ▼'}
    </button>
  </div>

  <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
    🏢
  </div>
</div>

      
      {/* 🚀 통계 카드 영역 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        
        {/* 🚀 [좌측 카드 완전 변경]: 2열 격자 그리드 구조 표기 및 무제한 가나다 정렬 수량 표출 */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 flex flex-col min-h-[300px]">
          <div className="flex justify-between items-end mb-4">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">📦 {statsTitle} 품목별 실시간 신청 집계</h3>
            <div className="flex gap-2 items-center">
              {selectedItemFilter && (
                <button onClick={() => setSelectedItemFilter(null)} className="text-[10px] text-indigo-500 hover:underline font-bold">전체보기 ✕</button>
              )}
              <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md">총 {statsData.totalQty}개 수량</span>
            </div>
          </div>
          
          {statsData.allItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[11px] font-bold text-slate-300 italic">신청 내역 없음</div>
          ) : (
            // 🚀 grid-cols-2 구조로 설정하여 좌측 5개, 우측 5개 형태로 유연하게 정렬 배치
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 flex-1 overflow-y-auto max-h-[220px] pr-1 scrollbar-thin">
              {statsData.allItems.map((item) => {
                const isSelected = selectedItemFilter === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() => setSelectedItemFilter(isSelected ? null : item.name)}
                    className={`w-full flex justify-between items-center px-4 py-2.5 rounded-xl border transition-all text-left group ${
                      isSelected 
                        ? 'bg-indigo-600 border-indigo-700 text-white shadow-sm font-black' 
                        : 'bg-slate-50 border-slate-100 text-slate-700 hover:bg-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <span className={`text-[11px] truncate max-w-[150px] ${isSelected ? 'text-white' : 'text-slate-800 font-bold group-hover:text-indigo-600'}`}>
                      {item.name}
                    </span>
                    <span className={`text-[11px] font-mono font-black shrink-0 ${isSelected ? 'text-white' : 'text-indigo-600 bg-white border px-1.5 py-0.5 rounded-md shadow-sm'}`}>
                      {item.qty.toLocaleString()}개
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
     
        {/* 오른쪽: 상태별 버튼 필터 영역 */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 flex flex-col min-h-[300px]">
          <div className="flex justify-between items-end mb-4">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">📋 {statsTitle} 결재/지급 처리 현황 (클릭 시 정렬)</h3>
            <div className="flex gap-2 items-center">
              {selectedStatus !== 'ALL' && (
                <button onClick={() => setSelectedStatus('ALL')} className="text-[10px] text-indigo-500 hover:underline font-bold">필터 해제 ✕</button>
              )}
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">총 {statsData.totalReqCount}건 신청</span>
            </div>
          </div>
          
          {statsData.totalReqCount === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[11px] font-bold text-slate-300 italic">신청 내역 없음</div>
          ) : (
            <div className="space-y-2.5 flex-1 flex flex-col justify-center">
              {statsData.statusStats.map((status) => {
                const isSelected = selectedStatus === status.id;
                const bgClass = status.color === 'emerald' ? 'bg-emerald-50' : status.color === 'orange' ? 'bg-orange-50' : 'bg-red-50';
                const borderClass = status.color === 'emerald' ? 'border-emerald-200' : status.color === 'orange' ? 'border-orange-200' : 'border-red-200';
                const textClass = status.color === 'emerald' ? 'text-emerald-700' : status.color === 'orange' ? 'text-orange-600' : 'text-red-600';
                const fillClass = status.color === 'emerald' ? 'bg-emerald-500' : status.color === 'orange' ? 'bg-orange-400' : 'bg-red-500';

                return (
                  <button
                    key={status.id}
                    onClick={() => setSelectedStatus(isSelected ? 'ALL' : status.id as any)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-md ${isSelected ? `${bgClass} ${borderClass} ring-2 ring-indigo-200` : 'bg-white border-slate-200 hover:border-slate-300'}`}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <span className={`w-24 text-left text-[11px] font-black ${textClass}`}>{status.label}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden mr-4">
                        <div className={`h-full ${fillClass} rounded-full transition-all duration-500`} style={{ width: `${status.percent}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[12px] font-black ${textClass}`}>{status.count}건</span>
                      <span className="text-[10px] font-bold text-slate-400 w-10 text-right">({status.percent}%)</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
     
      {isTableOpen && (
        <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
          
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">부서 소모품 신청 내역</h2>
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredRequests.length}건</span>
              
              {/* 활성화된 교차 필터 상태 태그 표출 */}
              {selectedItemFilter && (
                <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md ml-2 animate-pulse">
                  📦 {selectedItemFilter}만 보기 중
                </span>
              )}
              {selectedStatus !== 'ALL' && (
                <span className="text-[10px] font-black text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md ml-1">
                  🎯 {selectedStatus === 'COMPLETED' ? '지급완료' : selectedStatus === 'PENDING' ? '대기중' : '반려'} 상태
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                  <option value="ALL">전체</option>
                  {availableYears.map(year => <option key={year} value={year}>{year}년</option>)}
                </select>
                
                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>
                
                <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                  <option value="ALL">전체</option>
                  {availableMonths.map(month => <option key={month} value={month}>{month}월</option>)}
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <div className="relative w-40">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">📦</span>
                  <input type="text" placeholder="물품명 검색..." value={searchItemQuery} onChange={e => setSearchItemQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors" />
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">👤</span>
                  <input type="text" placeholder="신청자 검색..." value={searchUserQuery} onChange={e => setSearchUserQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors" />
                </div>
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
                  <th className="h-12 px-3 w-32 text-center">소속 조직</th>
                  <th className="h-12 px-3 w-28 text-center text-indigo-600">신청자</th>
                  <th className="h-12 px-4 w-48 text-indigo-600">물품명</th>
                  <th className="h-12 px-3 w-24 text-center text-indigo-600">신청수량</th>
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
                    let sUnit = '';
                    try {
                      const itemExt = req.item?.description ? JSON.parse(req.item.description) : {};
                      sUnit = req.unit || itemExt.s_unit || itemExt.r_unit || '';
                    } catch (e) {}
                    
                    const itemName = req.item_name || req.item?.name || '';
     
                    return (
                      <tr key={req.id} className="h-16 hover:bg-slate-50/50 transition-colors">
                        <td className="pl-4 text-center"><input type="checkbox" checked={selectedIds.has(req.id)} onChange={() => { const next = new Set(selectedIds); selectedIds.has(req.id) ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="accent-indigo-600 cursor-pointer w-3.5 h-3.5" /></td>
                        <td className="px-3 text-center text-slate-400 font-mono text-[10px]">{filteredRequests.length - ((currentPage - 1) * itemsPerPage + i)}</td>
                        <td className="px-3 text-center font-mono text-slate-500 text-[10px]">{formatDateTime(req.createdAt)}</td>
                        <td className="px-3 text-center text-[11px] font-bold text-slate-600">{req.dept_name || '-'}</td>
                        <td className="px-3 text-center text-slate-800 text-[11px]">{req.user_name}</td>
                        <td className="px-4 font-black text-slate-900 text-[12px] truncate max-w-[200px]" title={itemName}>{itemName}</td>
                        <td className="px-3 text-center font-black text-indigo-600 text-[11px]">
                          {req.qty} {sUnit && <span className="text-[9px] text-indigo-400 font-bold ml-0.5">{sUnit}</span>}
                        </td>
                        <td className="px-4 text-slate-600 font-medium truncate max-w-[180px]" title={req.note}>{req.note}</td>
                        <td className="px-4 text-slate-800 font-medium truncate max-w-[180px]" title={req.admin_opinion}>{req.admin_opinion}</td>
                        <td className="px-3 text-center">
                          {!isPending && (
                            <div className="flex flex-col items-center justify-center">
                              <span className="text-slate-700 font-bold leading-tight">{req.admin_name}</span>
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
     
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
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