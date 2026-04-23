'use client';

import { useState, useMemo, useEffect } from 'react';

export default function ITAssetPersonalPage() {
  const [currentUser, setCurrentUser] = useState<{name: string, dept: string} | null>(null);
  const [authError, setAuthError] = useState(false);

  const [assets, setAssets] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [colFilters, setColFilters] = useState({ category: '범주', it_type: '자산 분류', is_rental: '렌탈/구매' });

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestContent, setRequestContent] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => { setCurrentPage(1); }, [searchQuery, colFilters, showReplaceableOnly]);

  useEffect(() => {
    const init = async () => {
      try {
        let fetchedUser = null;

        // 1. LocalStorage 우선 탐색
        const keysToCheck = ['user', 'user-storage', 'session', 'currentUser', 'auth', 'user_info'];
        for (const key of keysToCheck) {
          const localData = localStorage.getItem(key);
          if (localData) {
            try {
              const parsed = JSON.parse(localData);
              const name = parsed.name || parsed.user?.name || parsed.username || parsed.state?.user?.name;
              const dept = parsed.dept || parsed.unit_name || parsed.user?.dept || parsed.state?.user?.dept || '소속 미정';
              
              if (name) {
                fetchedUser = { name, dept };
                break;
              }
            } catch(e) {}
          }
        }

        // 🚀 2. API 탐색 (사용자 프로젝트의 실제 라우트인 /api/auth/me 적용)
        if (!fetchedUser) {
          try {
            const userRes = await fetch('/api/auth/me'); 
            if (userRes.ok) {
              const userData = await userRes.json();
              // API 응답 구조에 대비한 안전한 할당
              const targetName = userData.user?.name || userData.name;
              const targetDept = userData.user?.unit_name || userData.user?.dept || userData.unit_name || userData.dept || '소속 미정';
              
              if (targetName) {
                fetchedUser = { name: targetName, dept: targetDept };
              }
            }
          } catch(e) {
            console.error("Auth API Error:", e);
          }
        }

        if (fetchedUser) {
          setCurrentUser(fetchedUser);
        } else {
          setAuthError(true);
        }

        // 3. 자산 데이터 로드
        const savedAssets = localStorage.getItem('it_work_assets_db') || localStorage.getItem('it_assets_db');
        if (savedAssets && savedAssets !== '[]') {
          setAssets(JSON.parse(savedAssets));
        }

        const savedRequests = localStorage.getItem('it_requests_db');
        if (savedRequests) setRequests(JSON.parse(savedRequests));

      } catch (e) { 
        console.error("Data Sync Failed", e); 
      } finally { 
        setLoading(false); 
      }
    };
    init();
  }, []);

  const getAssetLogic = (a: any) => {
    let repDate = '-';
    let dday = null;
    let isTargetCount = false;

    const baseDateString = (a.is_rental === '렌탈' && a.start_date) ? a.start_date : (a.in_date || new Date().toISOString().split('T')[0]);
    if (baseDateString) {
      const d = new Date(baseDateString);
      d.setMonth(d.getMonth() + (parseInt(a.cycle) || 0));
      repDate = d.toISOString().split('T')[0];
      dday = Math.ceil((new Date(repDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      isTargetCount = dday <= 90;
    }
    return { repDate, dday, isTargetCount };
  };

  const myAssets = useMemo(() => {
    if (!currentUser) return [];
    return assets.filter(a => a.user === currentUser.name);
  }, [assets, currentUser]);

  const filteredAssets = useMemo(() => {
    return myAssets.filter(a => {
      const s = searchQuery.toLowerCase().trim();
      const logic = getAssetLogic(a);
      const matchSearch = !s || [a.code, a.model, a.sn, a.spec].some(v => String(v).toLowerCase().includes(s));
      
      const matchCategory = colFilters.category === '범주' || a.category === colFilters.category;
      const matchType = colFilters.it_type === '자산 분류' || a.it_type === colFilters.it_type;
      const matchRental = colFilters.is_rental === '렌탈/구매' || a.is_rental === colFilters.is_rental;
      const matchReplace = !showReplaceableOnly || logic.isTargetCount;

      return matchSearch && matchCategory && matchType && matchRental && matchReplace;
    });
  }, [myAssets, searchQuery, colFilters, showReplaceableOnly]);

  const paginatedRequests = useMemo(() => {
    if (!currentUser) return [];
    const myReqs = requests.filter(r => r.requester === currentUser.name);
    return myReqs.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage);
  }, [requests, historyPage, currentUser]);
  
  const requestTotalPages = Math.max(1, Math.ceil((requests.filter(r => r.requester === currentUser?.name).length) / itemsPerPage));

  const stats = useMemo(() => {
    const counts: any = {};
    let hwCount = 0, swCount = 0, furnitureCount = 0;
    myAssets.forEach(a => {
      counts[a.it_type] = (counts[a.it_type] || 0) + 1;
      if (a.category === 'HW') hwCount++; 
      else if (a.category === 'SW') swCount++;
      else if (a.category === '비품') furnitureCount++;
    });
    const replaceableCount = myAssets.filter(a => getAssetLogic(a).isTargetCount).length;
    return { counts, replaceableCount, hwCount, swCount, furnitureCount, total: myAssets.length };
  }, [myAssets]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleSelectAll = () => {
    const currentPageIds = paginatedAssets.map(a => a.id);
    const allSelected = currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };

  const handleSendRequest = () => {
    if (!requestContent.trim()) return alert("요구사항을 입력해주세요.");
    if (!currentUser) return alert("사용자 정보가 없습니다. 다시 로그인해주세요.");
    
    const targetAssets = filteredAssets.filter(a => selectedIds.has(a.id));
    const newRequest = {
      id: `REQ-${Date.now()}`,
      requestDate: new Date().toISOString().split('T')[0],
      assetInfo: targetAssets.map(a => `${a.it_type} (${a.model})`).join(', '),
      content: requestContent,
      status: '대기중',
      requester: currentUser.name, 
      dept: currentUser.dept
    };

    const updatedRequests = [newRequest, ...requests];
    setRequests(updatedRequests);
    localStorage.setItem('it_requests_db', JSON.stringify(updatedRequests));

    alert("✅ 관리자에게 요구사항이 성공적으로 전송되었습니다.");
    setShowRequestModal(false);
    setRequestContent('');
    setSelectedIds(new Set());
    setIsHistoryOpen(true);
  };

  // 🚀 이제 무한 로딩이 돌지 않고 정확하게 분기처리 됩니다.
  if (loading) return <div className="p-10 font-bold text-slate-400 animate-pulse text-center">데이터를 불러오는 중입니다...</div>;

  if (authError || !currentUser) {
    return (
      <div className="p-10 flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-lg font-bold text-slate-800">사용자 권한을 확인할 수 없습니다.</h2>
        <p className="text-sm text-slate-500 font-medium">로그인이 풀렸거나 세션 정보를 가져오는데 실패했습니다.<br/>다시 로그인해주세요.</p>
        <button onClick={() => window.location.href = '/login'} className="px-6 py-2 bg-slate-900 text-white font-bold rounded-lg mt-4">로그인 페이지로 이동</button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 bg-[#F8FAFC] min-h-screen font-sans text-slate-900 text-[11px] relative">
      
      <div className="flex justify-end items-center mb-2 gap-2 text-slate-500 font-bold text-xs">
        <span className="bg-indigo-100 text-indigo-600 px-2 py-1 rounded shadow-sm">👤 {currentUser.dept}</span>
        <span className="text-slate-700">{currentUser.name} 님, 환영합니다.</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 p-5 shadow-sm rounded-xl flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-[-10px] right-[-10px] w-20 h-20 bg-blue-50 rounded-full opacity-50"></div>
          <div className="relative z-10">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">나의 IT·업무자산</p>
            <p className="text-3xl font-bold text-slate-900 leading-none">{stats.total} <span className="text-xs text-slate-400 font-medium ml-1">Items</span></p>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-50 relative z-10">
            <div className="text-center border-r border-slate-100">
              <p className="text-[9px] text-slate-400 font-bold mb-1">H/W</p>
              <p className="text-sm font-bold text-blue-600">{stats.hwCount}</p>
            </div>
            <div className="text-center border-r border-slate-100">
              <p className="text-[9px] text-slate-400 font-bold mb-1">S/W</p>
              <p className="text-sm font-bold text-indigo-600">{stats.swCount}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-slate-400 font-bold mb-1">비품</p>
              <p className="text-sm font-bold text-amber-600">{stats.furnitureCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-slate-900 p-5 shadow-md rounded-xl flex flex-col justify-between col-span-2">
          <div className="flex justify-between items-start">
             <div>
               <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">My Asset Status</p>
               <h2 className="text-white text-xl font-bold tracking-tight">나의 IT·업무자산 운영 현황</h2>
             </div>
             <div className="flex gap-2">
               <button onClick={() => setShowReplaceableOnly(!showReplaceableOnly)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${showReplaceableOnly ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                 교체대상 장비 {stats.replaceableCount}건
               </button>
             </div>
          </div>
          <div className="flex gap-3 overflow-x-auto mt-4 pb-1 scrollbar-hide">
             {Object.entries(stats.counts).map(([type, count]: any) => (
               <div key={type} className="bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 shrink-0">
                 <span className="text-[10px] text-slate-500 font-bold mr-2 uppercase">{type}</span>
                 <span className="text-white font-bold">{count}</span>
               </div>
             ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 p-3 shadow-sm rounded-xl flex gap-3 items-center">
        <input type="text" placeholder="내 자산 검색 (자산번호, 모델명, S/N 등)" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-bold outline-none focus:border-blue-500" />
        <button 
          onClick={() => {
            if (selectedIds.size === 0) return alert('요청을 보낼 자산을 하단 리스트에서 체크박스로 선택해주세요.');
            setShowRequestModal(true);
          }} 
          className={`px-6 py-2 font-bold rounded-lg transition-all shadow-sm flex items-center gap-2 ${selectedIds.size > 0 ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'}`}
        >
          <span>✈️ 선택 자산 관리자 요구사항 전송</span>
          {selectedIds.size > 0 && <span className="bg-indigo-800 px-2 py-0.5 rounded text-xs">{selectedIds.size}</span>}
        </button>
      </div>

      <div className="bg-white border border-slate-200 shadow-md rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 uppercase tracking-tighter ml-2">나의 IT·업무자산 리스트</h3>
          <div className="flex gap-2">
            <select className="p-1.5 border border-slate-200 font-bold text-[11px] rounded" value={colFilters.category} onChange={e => setColFilters({ ...colFilters, category: e.target.value })}><option>범주</option><option>HW</option><option>SW</option><option>비품</option></select>
            <select className="p-1.5 border border-slate-200 font-bold text-[11px] rounded" value={colFilters.it_type} onChange={e => setColFilters({ ...colFilters, it_type: e.target.value })}><option>자산 분류</option><option>노트북</option><option>데스크</option><option>모니터</option></select>
            <select className="p-1.5 border border-slate-200 font-bold text-[11px] rounded" value={colFilters.is_rental} onChange={e => setColFilters({ ...colFilters, is_rental: e.target.value })}><option>렌탈/구매</option><option>구매</option><option>렌탈</option></select>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[2000px] table-fixed">
            <thead>
              <tr className="bg-slate-900 text-slate-400 uppercase font-bold border-b border-slate-800">
                <th className="p-3 w-[40px] text-center sticky left-0 bg-slate-900 z-30"><input type="checkbox" checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedIds.has(a.id))} onChange={toggleSelectAll} /></th>
                <th className="p-3 w-[50px] text-center sticky left-[40px] bg-slate-900 z-30">NO</th>
                <th className="p-3 w-[60px] text-center sticky left-[90px] bg-slate-900 z-30">범주</th>
                <th className="p-3 w-[100px] text-center sticky left-[150px] bg-slate-900 z-30 text-blue-400">자산 분류</th>
                <th className="p-3 w-[140px] sticky left-[250px] bg-slate-900 z-30">조직</th>
                <th className="p-3 w-[90px] sticky left-[390px] bg-slate-900 z-30 border-r-2 border-slate-500 text-blue-400">사용자</th>
                
                <th className="p-3 w-[220px]">자산번호</th>
                <th className="p-3 w-[250px]">모델명</th>
                <th className="p-3 w-[150px]">S/N</th>
                <th className="p-3 w-[140px]">제조사</th>
                <th className="p-3 w-[300px]">기본 사양</th>
                <th className="p-3 w-[90px] text-center">구분</th>
                <th className="p-3 w-[120px] text-center text-blue-300">렌탈기간(개월)</th>
                <th className="p-3 w-[120px] text-center">입고일</th>
                <th className="p-3 w-[120px] text-center text-blue-300">계약시작일</th>
                <th className="p-3 w-[120px] text-center text-blue-300">계약종료일</th>
                <th className="p-3 w-[120px] text-center">교체주기(개월)</th>
                <th className="p-3 w-[180px] bg-slate-800 text-white text-center shadow-inner">교체가능일 (자동)</th>
                <th className="p-3 w-[250px]">기타(메모)</th>
                <th className="p-3 w-[120px] text-center">등록일자</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedAssets.length === 0 ? (
                <tr><td colSpan={24} className="p-10 text-center text-slate-400 font-bold">현재 본인 계정({currentUser.name})으로 할당된 IT·업무자산이 없습니다.</td></tr>
              ) : paginatedAssets.map((a, idx) => {
                const { repDate, dday } = getAssetLogic(a);
                const serialNo = (currentPage - 1) * itemsPerPage + idx + 1;
                const isP = a.is_rental === '구매';
                const isSelected = selectedIds.has(a.id);
                
                const stickyBg = isSelected ? 'bg-indigo-50/95' : 'bg-white';

                return (
                  <tr key={a.id} className={`hover:bg-slate-50/50 h-10 transition-all font-bold ${isSelected ? 'bg-indigo-50/30' : ''}`}>
                    <td className={`p-2 text-center sticky left-0 z-20 ${stickyBg}`}><input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} /></td>
                    <td className={`p-2 text-center text-slate-400 sticky left-[40px] z-20 ${stickyBg}`}>{serialNo}</td>
                    <td className={`p-2 text-center text-slate-500 sticky left-[90px] z-20 ${stickyBg}`}>{a.category}</td>
                    <td className={`p-2 text-center text-blue-600 sticky left-[150px] z-20 ${stickyBg}`}>{a.it_type}</td>
                    <td className={`p-2 truncate sticky left-[250px] z-20 ${stickyBg}`}>{a.dept}</td>
                    <td className={`p-2 text-blue-600 truncate sticky left-[390px] z-20 border-r-2 border-slate-300 ${stickyBg}`}>{a.user}</td>
                    
                    <td className="p-2 text-slate-800">{a.code}</td>
                    <td className="p-2 text-slate-800 truncate" title={a.model}>{a.model}</td>
                    <td className="p-2 text-slate-500 truncate">{a.sn}</td>
                    <td className="p-2 text-slate-600">{a.brand}</td>
                    <td className="p-2 text-slate-500 truncate" title={a.spec}>{a.spec}</td>
                    
                    <td className="p-2 text-center"><span className={`px-2 py-0.5 font-bold ${isP ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-600'}`}>{a.is_rental}</span></td>
                    
                    <td className="p-2 text-center text-slate-600">{isP ? '-' : `${a.rental_months}`}</td>
                    <td className="p-2 text-center text-slate-600">{a.in_date}</td>
                    <td className="p-2 text-center text-slate-600">{isP ? '-' : a.start_date}</td>
                    <td className="p-2 text-center text-slate-600">{isP ? '-' : a.end_date}</td>
                    
                    <td className="p-2 text-center text-slate-600">{a.cycle}</td>
                    <td className="p-2 bg-slate-50/50">
                      <div className="flex items-center justify-center gap-3">
                        <span className="text-slate-900">{repDate}</span>
                        {dday !== null && dday <= 90 && <span className={`px-1.5 py-0.5 font-bold text-[10px] rounded ${dday <= 0 ? 'bg-red-500 text-white animate-pulse shadow-sm' : 'bg-blue-600 text-white shadow-sm'}`}>{dday <= 0 ? `D+${Math.abs(dday)}` : `D-${dday}`}</span>}
                      </div>
                    </td>
                    <td className="p-2 text-slate-400 truncate" title={a.memo}>{a.memo}</td>
                    <td className="p-2 text-center text-slate-400">{a.reg_date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-3 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`px-3 py-1 border rounded font-bold text-[10px] shadow-sm transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">
        <div onClick={() => setIsHistoryOpen(!isHistoryOpen)} className="p-4 flex justify-between items-center cursor-pointer bg-slate-800 text-white transition-colors hover:bg-slate-700">
          <h3 className="text-xs font-bold uppercase tracking-tighter flex items-center gap-2">
            <span>📤 나의 요구사항 전송 이력</span>
            <span className="bg-blue-500 text-white px-2 py-0.5 rounded text-[10px]">{paginatedRequests.length}건</span>
          </h3>
          <span className="text-[11px] font-bold">{isHistoryOpen ? '접기 ▲' : '열기 ▼'}</span>
        </div>
        {isHistoryOpen && (
          <div className="p-0">
            <table className="w-full text-left text-[11px] border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                  <th className="p-3 w-[60px] text-center">NO</th>
                  <th className="p-3 w-[120px] text-center">전송일자</th>
                  <th className="p-3 w-[250px]">대상 자산정보</th>
                  <th className="p-3 w-auto">요구사항 (사유)</th>
                  <th className="p-3 w-[100px] text-center">진행상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRequests.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-400 font-bold">요구사항 전송 이력이 없습니다.</td></tr>
                ) : paginatedRequests.map((req: any, i: number) => (
                  <tr key={req.id} className="text-slate-600 font-bold hover:bg-slate-50 transition-colors">
                    <td className="p-3 text-center text-slate-400">{(historyPage - 1) * itemsPerPage + i + 1}</td>
                    <td className="p-3 text-center">{req.requestDate}</td>
                    <td className="p-3 truncate text-blue-600" title={req.assetInfo}>{req.assetInfo}</td>
                    <td className="p-3 text-slate-800 truncate" title={req.content}>{req.content}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-1 uppercase text-[10px] rounded shadow-sm ${req.status === '대기중' ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                        {req.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {requestTotalPages > 1 && (
              <div className="flex justify-center gap-2 p-3 border-t border-slate-100 bg-slate-50">
                {Array.from({ length: requestTotalPages }).map((_, i) => (
                  <button key={i} onClick={() => setHistoryPage(i + 1)} className={`px-3 py-1 border rounded font-bold text-[10px] shadow-sm transition-all ${historyPage === i + 1 ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>{i + 1}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showRequestModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] border border-slate-300 shadow-2xl p-8 rounded-xl">
            <h4 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-4 border-b-2 border-slate-900 pb-2 flex items-center gap-2">
              ✈️ 자산 요구사항 전송
            </h4>
            
            <div className="mb-4">
              <p className="text-[10px] font-bold text-slate-500 mb-2">선택된 대상 자산 ({selectedIds.size}건)</p>
              <div className="max-h-24 overflow-y-auto bg-slate-50 border border-slate-200 rounded p-2 text-[10px] space-y-1">
                {filteredAssets.filter(a => selectedIds.has(a.id)).map(a => (
                  <div key={a.id} className="font-bold text-slate-700 flex justify-between border-b border-slate-100 pb-1 last:border-0">
                    <span>{a.it_type} | {a.model}</span>
                    <span className="text-blue-600">[{a.code}]</span>
                  </div>
                ))}
              </div>
            </div>

            <textarea 
              value={requestContent} 
              onChange={e => setRequestContent(e.target.value)} 
              placeholder="요청하실 내용을 자유롭게 상세히 기재해주세요. (예: 데스크탑 문제발생으로 수리 요청 등)" 
              className="w-full h-32 bg-white border border-slate-300 p-4 text-[11px] font-bold outline-none rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all resize-none shadow-inner" 
            />
            
            <div className="flex gap-2 mt-6">
              <button onClick={() => { setShowRequestModal(false); setRequestContent(''); }} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded font-bold text-[11px] uppercase hover:bg-slate-200 transition-all border border-slate-200">취소 (Cancel)</button>
              <button onClick={handleSendRequest} className="flex-1 py-3 bg-indigo-600 text-white rounded font-bold text-[11px] uppercase shadow-md hover:bg-indigo-700 transition-all">담당 관리자에게 전송</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}