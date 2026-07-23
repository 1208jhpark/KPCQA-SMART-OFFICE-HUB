'use client';
     
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import {
  isCompletedSupplyRequest,
  isPendingSupplyRequest,
  isRejectedSupplyRequest,
  normalizeSupplyRequestStatus,
  supplyRequestStatusLabel,
} from '@/utils/supplyRequestStatus';
import { getKSTDateString } from '@/utils/dateUtils';

function DeptContent() {
  const [requests, setRequests] = useState<any[]>([]);
  const [scopeDepts, setScopeDepts] = useState<string[]>([]);
  const [storageNotes, setStorageNotes] = useState<Record<string, string>>({});
  const [myDeptNameFromApi, setMyDeptNameFromApi] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchItemQuery, setSearchItemQuery] = useState('');
  const [searchUserQuery, setSearchUserQuery] = useState('');

  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));

  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'COMPLETED' | 'PENDING' | 'REJECTED'>('ALL');
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);

  const [memoEditing, setMemoEditing] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');
  const [memoSaving, setMemoSaving] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => { 
    fetchData(); 
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, reqRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        // 부서 범위는 서버(세션)에서만 결정 — 클라에서 재필터하지 않음
        fetch(`/api/asset/supplies/dept?t=${ts}`, { cache: 'no-store' }),
      ]);

      if (userRes.ok) setCurrentUser(await userRes.json());

      if (reqRes.ok) {
        const data = await reqRes.json();
        // 신형: { requests, scopeDepts, storageNotes } / 구형 배열 호환
        if (Array.isArray(data)) {
          setRequests(data);
          setScopeDepts([]);
          setStorageNotes({});
          setMyDeptNameFromApi('');
        } else {
          setRequests(Array.isArray(data.requests) ? data.requests : []);
          setScopeDepts(Array.isArray(data.scopeDepts) ? data.scopeDepts : []);
          setStorageNotes(
            data.storageNotes && typeof data.storageNotes === 'object' ? data.storageNotes : {}
          );
          setMyDeptNameFromApi(String(data.myDeptName || ''));
        }
        setMemoEditing(false);
      } else if (reqRes.status === 401 || reqRes.status === 403) {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '부서 소모품 내역을 볼 권한이 없습니다.');
        setRequests([]);
        setScopeDepts([]);
        setStorageNotes({});
      } else {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '부서 소모품 내역을 불러오지 못했습니다.');
        setRequests([]);
        setScopeDepts([]);
        setStorageNotes({});
      }
    } catch(e) { 
      console.error("Data fetch error", e);
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  // API가 이미 스코프(본인+하위+직속상위)만 반환 — 그대로 사용
  const deptRequests = requests;

  /** 드롭다운 옵션: 서버 scopeDepts 우선, 없으면 데이터에 나온 dept_name */
  const deptOptions = useMemo(() => {
    if (scopeDepts.length > 0) return scopeDepts;
    const fromData = Array.from(
      new Set(deptRequests.map((r) => r.dept_name).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b), 'ko'));
    return fromData as string[];
  }, [scopeDepts, deptRequests]);

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
      
      const deptMatch = selectedDept === 'ALL' || r.dept_name === selectedDept;
      const yearMatch = selectedYear === 'ALL' || reqYear === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || reqMonth === selectedMonth;
      
      const itemName = r.item_name || r.item?.name || '';
      const itemMatch = !searchItemQuery || itemName.toLowerCase().includes(searchItemQuery.toLowerCase());
      const userMatch = !searchUserQuery || (r.user_name || '').toLowerCase().includes(searchUserQuery.toLowerCase());
      
      const statusMatch = selectedStatus === 'ALL' ||
        (selectedStatus === 'COMPLETED' && isCompletedSupplyRequest(r.status)) ||
        (selectedStatus === 'PENDING' && isPendingSupplyRequest(r.status)) ||
        (selectedStatus === 'REJECTED' && isRejectedSupplyRequest(r.status));
      
      const itemFilterMatch = !selectedItemFilter || itemName === selectedItemFilter;
      
      return deptMatch && yearMatch && monthMatch && itemMatch && userMatch && statusMatch && itemFilterMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [deptRequests, selectedDept, selectedYear, selectedMonth, searchItemQuery, searchUserQuery, selectedStatus, selectedItemFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedDept, selectedYear, selectedMonth, searchItemQuery, searchUserQuery, selectedStatus, selectedItemFilter]);

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
        '처리일시': r.processedAt ? formatDateTime(r.processedAt) : '',
        '상태': supplyRequestStatusLabel(r.status)
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서소모품신청내역");
    
    const monthStr = selectedMonth !== 'ALL' ? `_${selectedMonth}월` : '';
    const deptStr = selectedDept !== 'ALL' ? `_${selectedDept}` : '';
    const statusStr = selectedStatus !== 'ALL' ? `_${selectedStatus}` : '';
    const itemStr = selectedItemFilter ? `_${selectedItemFilter}` : '';
    XLSX.writeFile(wb, `부서_소모품신청현황_${selectedYear === 'ALL' ? '전체' : selectedYear}년${monthStr}${deptStr}${statusStr}${itemStr}.xlsx`);
  };

  const statsData = useMemo(() => {
    const periodReqs = deptRequests.filter(r => {
      if (selectedDept !== 'ALL' && r.dept_name !== selectedDept) return false;
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

    type ItemAgg = { qty: number; lastAt: string };
    const itemMap = periodReqs.reduce((acc: Record<string, ItemAgg>, cur) => {
      const name = cur.item_name || cur.item?.name;
      if (!name) return acc;
      if (!acc[name]) acc[name] = { qty: 0, lastAt: '' };
      acc[name].qty += Number(cur.qty) || 0;
      const created = String(cur.createdAt || '');
      if (created && (!acc[name].lastAt || new Date(created).getTime() > new Date(acc[name].lastAt).getTime())) {
        acc[name].lastAt = created;
      }
      return acc;
    }, {});

    const allItems = (Object.entries(itemMap) as [string, ItemAgg][])
      .map(([name, agg]) => ({ name, ...agg }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ko'));

    const totalReqCount = periodReqs.length;
    const statusMap = { COMPLETED: 0, PENDING: 0, REJECTED: 0 };
   
    periodReqs.forEach(r => {
      const s = normalizeSupplyRequestStatus(r.status);
      if (s === 'COMPLETED') statusMap.COMPLETED++;
      else if (s === 'REJECTED') statusMap.REJECTED++;
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
  }, [deptRequests, selectedDept, selectedYear, selectedMonth]);
     
  const myDeptName =
    myDeptNameFromApi || currentUser?.unit?.unit_name || currentUser?.dept_name || '';

  /** 보관 메모 대상 조직: 필터 ALL이면 내 소속, 아니면 선택한 조직 */
  const memoDeptName = selectedDept === 'ALL' ? myDeptName : selectedDept;
  const currentMemo = (memoDeptName && storageNotes[memoDeptName]) || '';

  useEffect(() => {
    setMemoEditing(false);
    setMemoDraft(currentMemo);
  }, [memoDeptName, currentMemo]);

  const startMemoEdit = () => {
    setMemoDraft(currentMemo);
    setMemoEditing(true);
  };

  const cancelMemoEdit = () => {
    setMemoDraft(currentMemo);
    setMemoEditing(false);
  };

  const saveMemo = async () => {
    if (!memoDeptName) return alert('대상 조직을 확인할 수 없습니다.');
    setMemoSaving(true);
    try {
      const res = await fetch('/api/asset/supplies/dept', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dept_name: memoDeptName, note: memoDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || '보관 안내 저장에 실패했습니다.');
        return;
      }
      setStorageNotes((prev) => ({
        ...prev,
        [memoDeptName]: String(data.note ?? memoDraft),
      }));
      setMemoEditing(false);
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setMemoSaving(false);
    }
  };

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
  </div>

  <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
    🏢
  </div>
</div>

      
      {/* 🚀 통계 카드 영역 — 좌/우 동일 높이 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 md:items-stretch">
        
{/* 좌측: 품목별 집계 — 물품명 | 비중막대 | 최근신청일 | 수량 */}
<div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-6 flex flex-col min-h-[280px] h-full">
          <div className="flex justify-between items-end mb-3 shrink-0">
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
            <div className="flex-1 min-h-0 overflow-y-auto border border-slate-100 rounded-xl">
              {/* 🚀 Grid 비율 조정: 비중을 1.8fr로 대폭 늘리고, 날짜 넓이를 4.5rem으로 타이트하게 잡아 우측으로 밈 */}
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.8fr)_4.5rem_3.5rem] gap-x-5 gap-y-0 px-4 py-2 bg-slate-50 border-b border-slate-100">
                <span className="text-[9px] font-black text-slate-400 tracking-widest uppercase text-left">물품명</span>
                <span className="text-[9px] font-black text-slate-400 tracking-widest text-left">비중</span>
                {/* 🚀 text-center ➔ text-right 로 변경 */}
                <span className="text-[9px] font-black text-slate-400 tracking-widest text-right">최근 신청일</span>
                <span className="text-[9px] font-black text-slate-400 tracking-widest text-right">수량</span>
              </div>
              <div className="divide-y divide-slate-100">
                {statsData.allItems.map((item) => {
                  const isSelected = selectedItemFilter === item.name;
                  const sharePct =
                    statsData.totalQty > 0
                      ? Math.min(100, Math.round((item.qty / statsData.totalQty) * 1000) / 10)
                      : 0;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      title={`${item.name} · 총수량 대비 ${sharePct}%`}
                      onClick={() => setSelectedItemFilter(isSelected ? null : item.name)}
                      className={`w-full grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.8fr)_4.5rem_3.5rem] gap-x-5 gap-y-0 items-center px-4 py-2 text-left transition-colors ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span className={`min-w-0 text-[11px] font-bold truncate ${isSelected ? 'text-white' : ''}`}>
                        {item.name}
                      </span>
                      <span className="min-w-0 flex items-center gap-2" aria-hidden>
                        <span
                          className={`flex-1 h-1.5 rounded-full overflow-hidden ${
                            isSelected ? 'bg-indigo-400/40' : 'bg-slate-100'
                          }`}
                        >
                          <span
                            className={`block h-full rounded-full transition-all duration-500 ${
                              isSelected
                                ? 'bg-white'
                                : 'bg-gradient-to-r from-indigo-400 to-sky-400'
                            }`}
                            style={{ width: `${sharePct}%` }}
                          />
                        </span>
                        <span
                          className={`shrink-0 text-[9px] font-black tabular-nums w-7 text-right ${
                            isSelected ? 'text-indigo-100' : 'text-slate-400'
                          }`}
                        >
                          {sharePct}%
                        </span>
                      </span>
                      {/* 🚀 text-center ➔ text-right 로 변경하여 수량 쪽으로 바짝 붙임 */}
                      <span
                        className={`text-[10px] font-mono font-bold tabular-nums text-right ${
                          isSelected ? 'text-indigo-100' : 'text-slate-500'
                        }`}
                      >
                        {item.lastAt ? getKSTDateString(item.lastAt) : '-'}
                      </span>
                      <span className={`font-mono text-[11px] font-black tabular-nums text-right ${isSelected ? 'text-indigo-100' : 'text-indigo-600'}`}>
                        {item.qty.toLocaleString()}
                        <span className={`ml-0.5 text-[9px] font-bold ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>개</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
     
{/* 오른쪽: 상태 필터(타이트) + 보관 메모 */}
<div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-6 flex flex-col gap-3 min-h-[280px] h-full">
          <div className="flex justify-between items-end shrink-0">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">📋 {statsTitle} 결재/지급 처리 현황</h3>
            <div className="flex gap-2 items-center">
              {selectedStatus !== 'ALL' && (
                <button onClick={() => setSelectedStatus('ALL')} className="text-[10px] text-indigo-500 hover:underline font-bold">필터 해제 ✕</button>
              )}
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">총 {statsData.totalReqCount}건</span>
            </div>
          </div>
          
          {statsData.totalReqCount === 0 ? (
            <div className="py-4 text-center text-[11px] font-bold text-slate-300 italic">신청 내역 없음</div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 shrink-0">
              {statsData.statusStats.map((status) => {
                const isSelected = selectedStatus === status.id;
                const tone =
                  status.color === 'emerald'
                    ? {
                        idle: 'bg-emerald-50/80 border-emerald-100 hover:bg-emerald-50',
                        selected: 'bg-emerald-100 border-emerald-300 ring-2 ring-emerald-200/80',
                        label: 'text-emerald-700',
                        count: 'text-emerald-800',
                        pct: 'text-emerald-600/70',
                      }
                    : status.color === 'orange'
                    ? {
                        idle: 'bg-amber-50/80 border-amber-100 hover:bg-amber-50',
                        selected: 'bg-amber-100 border-amber-300 ring-2 ring-amber-200/80',
                        label: 'text-amber-700',
                        count: 'text-amber-800',
                        pct: 'text-amber-600/70',
                      }
                    : {
                        idle: 'bg-rose-50/80 border-rose-100 hover:bg-rose-50',
                        selected: 'bg-rose-100 border-rose-300 ring-2 ring-rose-200/80',
                        label: 'text-rose-700',
                        count: 'text-rose-800',
                        pct: 'text-rose-600/70',
                      };
                const shortLabel =
                  status.id === 'COMPLETED' ? '지급완료' :
                  status.id === 'PENDING' ? '승인대기' : '반려/취소';

                return (
                  <button
                    key={status.id}
                    type="button"
                    onClick={() => setSelectedStatus(isSelected ? 'ALL' : status.id as any)}
                    className={`flex flex-col items-center justify-center gap-0.5 px-1.5 py-2 rounded-xl border transition-all ${
                      isSelected ? tone.selected : tone.idle
                    }`}
                  >
                    <span className={`text-[10px] font-black leading-none ${tone.label}`}>{shortLabel}</span>
                    <span className={`text-[13px] font-black leading-none tabular-nums ${tone.count}`}>
                      {status.count}<span className="text-[9px] ml-0.5 font-bold opacity-80">건</span>
                    </span>
                    <span className={`text-[9px] font-bold leading-none ${tone.pct}`}>{status.percent}%</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* 부서 전용 메모판 — 페이지 접근자면 누구나 수정 (DB: OrgUnit.supply_storage_note) */}
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 shadow-inner flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 border-b border-slate-200/70 pb-1.5 gap-2">
              <h4 className="text-[11px] font-black text-slate-700 flex items-center gap-1.5 min-w-0">
                <span>📌</span>
                <span className="truncate">부서 소모품 보관 위치 안내 메모판</span>
                {memoDeptName && (
                  <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md shrink-0">
                    {memoDeptName}
                  </span>
                )}
              </h4>
              {!memoEditing ? (
                <button
                  type="button"
                  onClick={startMemoEdit}
                  className="text-[9px] font-bold text-slate-400 hover:text-indigo-600 transition-colors shrink-0"
                >
                  수정
                </button>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={memoSaving}
                    onClick={cancelMemoEdit}
                    className="text-[9px] font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={memoSaving}
                    onClick={saveMemo}
                    className="text-[9px] font-black text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                  >
                    {memoSaving ? '저장 중…' : '저장'}
                  </button>
                </div>
              )}
            </div>

            {memoEditing ? (
              <textarea
                value={memoDraft}
                onChange={(e) => setMemoDraft(e.target.value)}
                rows={5}
                maxLength={4000}
                placeholder={'예)\n• A4 용지/토너: 복합기 옆 2단 공용 캐비닛\n• 일반 사무용품: 부서 입구 우측 수납장'}
                className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-[10px] font-bold text-slate-700 leading-relaxed outline-none focus:border-indigo-400 resize-y min-h-[88px]"
              />
            ) : (
              <div className="text-[10px] font-bold text-slate-600 leading-relaxed whitespace-pre-wrap min-h-[48px]">
                {currentMemo.trim()
                  ? currentMemo
                  : '등록된 보관 위치 안내가 없습니다. [수정]을 눌러 작성해 주세요.'}
              </div>
            )}
          </div>
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
                  🎯 {supplyRequestStatusLabel(selectedStatus)} 상태
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">조직</span>
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[160px]"
                >
                  <option value="ALL">전체 (연계 조직)</option>
                  {deptOptions.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

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
                  <th className="h-9 w-12 text-center pl-4"><input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="accent-indigo-600 cursor-pointer w-3.5 h-3.5" /></th>
                  <th className="h-9 px-3 w-16 text-center">NO</th>
                  <th className="h-9 px-3 w-36 text-center">신청일시</th>
                  <th className="h-9 px-3 w-32 text-center">소속 조직</th>
                  <th className="h-9 px-3 w-28 text-center text-indigo-600">신청자</th>
                  <th className="h-9 px-4 w-48 text-indigo-600">물품명</th>
                  <th className="h-9 px-3 w-24 text-center text-indigo-600">신청수량</th>
                  <th className="h-9 px-4 min-w-[180px]">신청자 의견</th>
                  <th className="h-9 px-4 min-w-[180px]">관리자 답변</th>
                  <th className="h-9 px-3 w-36 text-center">처리정보</th>
                  <th className="h-9 pr-6 w-24 text-center">상태</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr><td colSpan={11} className="h-24 text-center text-slate-400 italic">조건에 맞는 신청 내역이 없습니다.</td></tr>
                ) : (
                  paginatedRequests.map((req, i) => {
                    const isPending = isPendingSupplyRequest(req.status);
                    const statusLabel = supplyRequestStatusLabel(req.status);
                    let sUnit = '';
                    try {
                      const itemExt = req.item?.description ? JSON.parse(req.item.description) : {};
                      sUnit = req.unit || itemExt.s_unit || itemExt.r_unit || '';
                    } catch (e) {}
                    
                    const itemName = req.item_name || req.item?.name || '';
     
                    return (
                      <tr key={req.id} className="h-10 hover:bg-slate-50/50 transition-colors">
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
                            <div className="flex flex-col items-center justify-center leading-tight">
                              <span className="text-slate-700 font-bold text-[11px]">{req.admin_name}</span>
                              <span className="text-slate-400 font-mono text-[9px]">{req.processedAt ? formatDateTime(req.processedAt) : '-'}</span>
                            </div>
                          )}
                        </td>
                        <td className="pr-6 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${
                            isPending ? 'bg-orange-50 text-orange-500 border border-orange-100' 
                            : isRejectedSupplyRequest(req.status) ? 'bg-red-50 text-red-500 border border-red-100'
                            : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                          }`}>
                            {statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
     
          {filteredRequests.length > 0 && (
            <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
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