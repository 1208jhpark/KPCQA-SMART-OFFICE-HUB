'use client';
  
import { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx'; 
  
export default function DeptModule() {
  const [currentUser, setCurrentUser] = useState<{name: string, dept: string} | null>(null);
  const [authError, setAuthError] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [allGlobalAssets, setAllGlobalAssets] = useState<any[]>([]); 
  const [requests, setRequests] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [auditBaseline, setAuditBaseline] = useState(''); 
  const [typeLabel, setTypeLabel] = useState('자산 분류'); 
  const [adminGroupOptions, setAdminGroupOptions] = useState<string[]>([]);
  const [colFilters, setColFilters] = useState({ category: '', it_type: '', is_rental: '', user: '' });
  
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestContent, setRequestContent] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(true); 
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const itemsPerPage = 10;
  
  // 🚀 [해결] 기본값을 ALL로 설정하여 처음에 전체보기(TOTAL)가 나오도록 수정
  const [selectedYear, setSelectedYear] = useState('ALL');
  
  useEffect(() => { setCurrentPage(1); }, [searchQuery, colFilters, showReplaceableOnly, showUnverifiedOnly]);
  useEffect(() => { setHistoryPage(1); }, [selectedYear]);
  
  useEffect(() => {
    const init = async () => {
      try {
        let fetchedUser: {name: string, dept: string} | null = null;
        
        try {
          const configRes = await fetch('/api/admin/config');
          if (configRes.ok) {
            const configData = await configRes.json();
            if (configData?.admin04_label) setTypeLabel(configData.admin04_label);
            if (configData?.audit_baseline) setAuditBaseline(configData.audit_baseline);
          }
        } catch (e) {}
  
        try {
          const userRes = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: 'no-store' }); 
          if (userRes.ok) {
            const userData = await userRes.json();
            fetchedUser = { 
              name: userData.name || '알수없음', 
              dept: userData.unit?.unit_name || '소속 미정' 
            };
          }
        } catch(e) {
          console.error("User fetch error", e);
        }
  
        let loadedAssets: any[] = [];
        const savedAssets = localStorage.getItem('it_assets_db') || localStorage.getItem('it_work_assets_db');
        if (savedAssets && savedAssets !== '[]') {
          loadedAssets = JSON.parse(savedAssets);
        }
  
        if (fetchedUser && fetchedUser.dept === '소속 미정') {
          const myFirstAsset = loadedAssets.find(a => a.user === fetchedUser?.name && a.dept);
          if (myFirstAsset) fetchedUser.dept = myFirstAsset.dept;
        }

        let loadedReqs: any[] = [];
        const savedRequests = localStorage.getItem('it_requests_db');
        if (savedRequests) {
          loadedReqs = JSON.parse(savedRequests);
        }

        // 🚀 인사변동 자동 동기화: 자산과 요구사항 모두 최신 부서로 연동
        if (fetchedUser && fetchedUser.name !== '알수없음') {
          let needsUpdate = false;
          loadedAssets = loadedAssets.map(a => {
            if (a.user === fetchedUser!.name && a.dept !== fetchedUser!.dept) {
              needsUpdate = true;
              return { ...a, dept: fetchedUser!.dept }; 
            }
            return a;
          });

          if (needsUpdate) {
            localStorage.setItem('it_assets_db', JSON.stringify(loadedAssets));
            window.dispatchEvent(new Event('storage'));
          }
          
          // 🚀 [해결] 나의 과거 요구사항 데이터의 소속 부서도 현재 최신 부서로 강제 업데이트!
          let reqsNeedUpdate = false;
          loadedReqs = loadedReqs.map(r => {
            if (r.requester === fetchedUser!.name && r.dept !== fetchedUser!.dept) {
              reqsNeedUpdate = true;
              return { ...r, dept: fetchedUser!.dept };
            }
            return r;
          });

          if (reqsNeedUpdate) {
            localStorage.setItem('it_requests_db', JSON.stringify(loadedReqs));
            window.dispatchEvent(new Event('storage'));
          }
        }

        setAllGlobalAssets(loadedAssets);
        setAssets(loadedAssets);
        setRequests(loadedReqs);
  
        if (fetchedUser) setCurrentUser(fetchedUser);
        else setAuthError(true);
  
      } catch (e) { 
        console.error("Data Sync Failed", e); 
      } finally { 
        setLoading(false); 
      }
    };
    init();
  
    const handleStorageChange = () => {
      const savedAssets = localStorage.getItem('it_assets_db');
      if (savedAssets && savedAssets !== '[]') {
        const parsed = JSON.parse(savedAssets);
        setAllGlobalAssets(parsed);
        setAssets(parsed);
      }
      const savedRequests = localStorage.getItem('it_requests_db');
      if (savedRequests) setRequests(JSON.parse(savedRequests));
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  
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
    const lastAudit = a.last_audit_date || '';
    const isVerified = lastAudit && lastAudit >= auditBaseline;
    return { repDate, dday, isTargetCount, isVerified, lastAudit };
  };
  
  const toggleAudit = (id: string) => {
    const today = new Date().toISOString().split('T')[0];
    const updatedGlobal = allGlobalAssets.map(a => {
      if (a.id === id) {
        const nextDate = a.last_audit_date ? '' : today;
        return { ...a, last_audit_date: nextDate, audit_request_date: nextDate ? '' : a.audit_request_date };
      }
      return a;
    });
    setAllGlobalAssets(updatedGlobal);
    setAssets(updatedGlobal);
    localStorage.setItem('it_assets_db', JSON.stringify(updatedGlobal));
    window.dispatchEvent(new Event('storage')); 
  };
  
  const cancelRequest = (id: string) => {
    if (!confirm("해당 요구사항 전송을 취소하시겠습니까?")) return;
    const updated = requests.filter(r => r.id !== id);
    setRequests(updated);
    localStorage.setItem('it_requests_db', JSON.stringify(updated));
    window.dispatchEvent(new Event('storage')); 
    alert("✅ 요청이 성공적으로 취소되었습니다.");
  };
  
  const deptAssets = useMemo(() => {
    if (!currentUser) return [];
    return assets.filter(a => a.dept === currentUser.dept);
  }, [assets, currentUser]);
  
  const stats = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    let verified = 0;
    deptAssets.forEach(a => {
      typeCounts[a.it_type] = (typeCounts[a.it_type] || 0) + 1;
      if (getAssetLogic(a).isVerified) verified++;
    });
    return { verified, typeCounts, total: deptAssets.length, replaceable: deptAssets.filter(a => getAssetLogic(a).isTargetCount).length };
  }, [deptAssets, auditBaseline]);
  
  const uniqueCategories = useMemo(() => Array.from(new Set(allGlobalAssets.map(a => a.category).filter(Boolean))), [allGlobalAssets]);
  const uniqueTypes = useMemo(() => Array.from(new Set(allGlobalAssets.map(a => a.it_type).filter(Boolean))), [allGlobalAssets]);
  
  const uniqueUsers = useMemo(() => {
    const users = deptAssets.map(a => a.user).filter(Boolean);
    return Array.from(new Set(users)).sort();
  }, [deptAssets]);
  
  const filteredAssets = useMemo(() => {
    return deptAssets.filter(a => {
      const s = searchQuery.toLowerCase().trim();
      const logic = getAssetLogic(a);
      const matchSearch = !s || [a.code, a.model, a.sn, a.spec, a.user].some(v => String(v).toLowerCase().includes(s));
      const matchCategory = !colFilters.category || a.category === colFilters.category;
      const matchType = !colFilters.it_type || a.it_type === colFilters.it_type;
      const matchUser = !colFilters.user || a.user === colFilters.user; 
      
      const matchReplace = !showReplaceableOnly || logic.isTargetCount;
      const matchUnverified = !showUnverifiedOnly || !logic.isVerified; 
  
      return matchSearch && matchCategory && matchType && matchUser && matchReplace && matchUnverified;
    });
  }, [deptAssets, searchQuery, colFilters, showReplaceableOnly, showUnverifiedOnly, auditBaseline]);
  
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  
  const availableYears = useMemo(() => {
    const years = requests.filter(r => r.dept === currentUser?.dept).map(r => r.requestDate.substring(0, 4));
    const uniqueYears = Array.from(new Set(years));
    const currentYear = new Date().getFullYear().toString();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
    return uniqueYears.sort((a, b) => b.localeCompare(a)); 
  }, [requests, currentUser]);
  
  const deptReqs = useMemo(() => {
    return requests
      // 🚀 [해결] selectedYear가 'ALL'일 경우 조건없이 전부 반환하도록 로직 수정
      .filter(r => r.dept === currentUser?.dept && (selectedYear === 'ALL' || r.requestDate.startsWith(selectedYear)))
      .sort((a, b) => b.id.localeCompare(a.id));
  }, [requests, currentUser, selectedYear]);
  
  const paginatedRequests = deptReqs.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage);
  const requestTotalPages = Math.max(1, Math.ceil(deptReqs.length / itemsPerPage));
  
  const handleExcelDownload = () => {
    const targetAssets = selectedIds.size > 0 
      ? filteredAssets.filter(a => selectedIds.has(a.id)) 
      : filteredAssets;
  
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
  
    const excelData = targetAssets.map((a, index) => {
      const logic = getAssetLogic(a);
      return {
        'NO': index + 1,
        '조직': a.dept || '-',
        '사용자': a.user || '-',
        '범주': a.category,
        '자산 분류': a.it_type,
        '자산번호': a.code,
        '모델명': a.model,
        'S/N': a.sn,
        '기본 사양': a.spec,
        '교체주기(M)': a.cycle,
        '교체예정일(자동)': logic.repDate,
        '최근실사일': a.last_audit_date || '-',
        '확인요청일': a.audit_request_date || '-',
        '기타(메모)': a.memo
      };
    });
  
    const ws = XLSX.utils.json_to_sheet(excelData); 
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dept_Assets"); 
    XLSX.writeFile(wb, `부서자산현황_${currentUser?.dept}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // 🚀 [신규 추가] 요구사항 전송 이력용 엑셀 다운로드 함수
  const handleRequestExportExcel = () => {
    if (deptReqs.length === 0) return alert('다운로드할 요구사항 이력 데이터가 없습니다.');
    
    const exportData = deptReqs.map((req, idx) => ({
      'NO': deptReqs.length - idx,
      '전송일자': req.requestDate,
      '요청자': req.requester,
      '대상 자산정보': req.assetInfo,
      '요구사항 내용': req.content,
      '관리자 검토의견': req.adminOpinion || '-',
      '처리완료일': req.completedAt || '-',
      '상태': req.status
    }));
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서요구사항이력");
    XLSX.writeFile(wb, `부서요구사항_${currentUser?.dept}_${selectedYear === 'ALL' ? '전체' : selectedYear}년.xlsx`);
  };
  
  if (loading) return <div className="p-10 font-bold text-slate-400 animate-pulse text-center">데이터 동기화 중...</div>;
  
  return (
    <div className="p-4 space-y-4 bg-[#F8FAFC] min-h-screen font-sans text-slate-900 text-[11px] relative">
      
      <div className="flex justify-end items-center mb-2 gap-2 text-slate-500 font-bold text-[10px]">
        <span className="bg-indigo-100 text-indigo-600 px-2 py-1 rounded shadow-sm">🏢 {currentUser?.dept}</span>
        <span className="text-slate-700">{currentUser?.name} 님</span>
      </div>
  
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 p-5 shadow-sm rounded-xl flex flex-col justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">부서 실사 인증 현황</p>
            <div className="flex justify-between items-end">
              <p className="text-3xl font-black text-slate-900 leading-none">{stats.verified} <span className="text-xs text-slate-400 font-medium ml-1">/ {stats.total} 완료</span></p>
              
              <button 
                onClick={() => setShowUnverifiedOnly(!showUnverifiedOnly)} 
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${showUnverifiedOnly ? 'bg-amber-500 border-amber-500 text-white shadow-md' : 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100'}`}
              >
                미인증 {stats.total - stats.verified}건
              </button>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-50 text-[9px] text-slate-400 font-bold">인증 완료 시 마스터 DB에 실시간 연동됩니다.</div>
        </div>
        
        <div className="bg-slate-900 p-5 shadow-md rounded-xl flex flex-col justify-between col-span-2 relative overflow-hidden">
          <div className="flex justify-between items-start z-10">
             <div>
               <h2 className="text-white text-xl font-black tracking-tight mb-1">우리 부서 IT·업무자산 운영 현황</h2>
               <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">기준 실사일: {auditBaseline || '미연동'}</p>
             </div>
             <button onClick={() => setShowReplaceableOnly(!showReplaceableOnly)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${showReplaceableOnly ? 'bg-red-600 border-red-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
               교체대상 {stats.replaceable}건
             </button>
          </div>
          
          <div className="mt-4 z-10">
            <p className="text-[9px] text-slate-500 font-bold uppercase mb-2">자산분류별 수량</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {Object.entries(stats.typeCounts).map(([type, count]) => (
                <div key={type} className="bg-slate-800 px-3 py-2 rounded-lg border border-slate-700 flex flex-col items-center min-w-[70px] shadow-lg">
                  <span className="text-[8px] text-slate-500 font-bold uppercase mb-1">{type}</span>
                  <span className="text-white font-black text-sm leading-none">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 px-5 h-14 shadow-sm rounded-xl flex gap-3 items-center">
        <input 
          type="text" 
          placeholder="[통합검색] 사용자명, 자산번호, 모델명, S/N" 
          value={searchQuery} 
          onChange={e => setSearchQuery(e.target.value)} 
          className="flex-1 bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-bold outline-none focus:border-blue-500" 
        />
        <div className="flex gap-2 items-center">
          <select 
            className="p-2 border border-slate-200 font-black text-[10px] rounded-lg outline-none bg-white shadow-sm"
            value={colFilters.user}
            onChange={(e) => setColFilters({ ...colFilters, user: e.target.value })}
          >
            <option value="">사용자 (전체)</option>
            {uniqueUsers.map(u => <option key={u as string}>{u as string}</option>)}
          </select>
          <select 
            className="p-2 border border-slate-200 font-black text-[10px] rounded-lg outline-none bg-white shadow-sm"
            value={colFilters.category}
            onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}
          >
            <option value="">범주 (전체)</option>
            {uniqueCategories.map(cat => <option key={cat}>{cat}</option>)}
          </select>
          <select 
            className="p-2 border border-slate-200 font-black text-[10px] rounded-lg outline-none bg-white text-blue-600 shadow-sm"
            value={colFilters.it_type}
            onChange={(e) => setColFilters({ ...colFilters, it_type: e.target.value })}
          >
            <option value="">자산분류 (전체)</option>
            {uniqueTypes.map(type => <option key={type}>{type}</option>)}
          </select>
          
          <div className="w-px h-6 bg-slate-200 mx-1"></div>
  
          <button 
            onClick={handleExcelDownload} 
            className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 font-black rounded-lg hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center gap-1"
          >
            ⬇️ 다운로드
          </button>
          
          <button 
            onClick={() => selectedIds.size > 0 && setShowRequestModal(true)} 
            className={`px-6 py-2 font-black rounded-lg transition-all shadow-sm ${selectedIds.size > 0 ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-400 border border-slate-200'}`}
          >
            요구사항 전송 ({selectedIds.size})
          </button>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 shadow-md rounded-xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse min-w-[2300px] table-fixed">
            <thead>
              <tr className="h-14 bg-slate-900 text-slate-400 uppercase font-bold border-b border-slate-800">
                <th className="p-3 w-[40px] text-center sticky left-0 bg-slate-900 z-30"><input type="checkbox" checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedIds.has(a.id))} onChange={() => {
                  const currentPageIds = paginatedAssets.map(a => a.id);
                  const allSelected = currentPageIds.every(id => selectedIds.has(id));
                  const next = new Set(selectedIds);
                  if (allSelected) currentPageIds.forEach(id => next.delete(id));
                  else currentPageIds.forEach(id => next.add(id));
                  setSelectedIds(next);
                }} /></th>
                <th className="p-3 w-[50px] text-center sticky left-[40px] bg-slate-900 z-30">NO</th>
                <th className="p-3 w-[120px] text-center sticky left-[90px] bg-slate-900 z-30 text-emerald-400">실사 확인</th>
                <th className="p-3 w-[90px] text-center sticky left-[210px] bg-slate-900 z-30 text-amber-500">확인요청</th>
                <th className="p-3 w-[100px] text-center sticky left-[300px] bg-slate-900 z-30 text-indigo-300">조직</th>
                <th className="p-3 w-[100px] text-center sticky left-[400px] bg-slate-900 z-30 text-indigo-300">사용자</th>
                <th className="p-3 w-[80px] text-center sticky left-[500px] bg-slate-900 z-30">범주</th>
                <th className="p-3 w-[120px] text-center sticky left-[580px] bg-slate-900 z-30 text-blue-400 border-r-2 border-slate-700">{typeLabel}</th>
                <th className="p-3 w-[120px] font-black">자산번호</th>
                <th className="p-3 w-[250px]">모델명</th>
                <th className="p-3 w-[150px]">S/N</th>
                <th className="p-3 w-[400px]">기본 사양</th>
                <th className="p-3 w-[100px] text-center text-blue-600">교체주기(M)</th>
                <th className="p-3 w-[150px] bg-slate-800 text-white text-center shadow-inner">교체예정일</th>
                <th className="p-3 w-[300px]">기타(메모)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedAssets.map((a, idx) => {
                const logic = getAssetLogic(a);
                const isSelected = selectedIds.has(a.id);
                const stickyBg = isSelected ? 'bg-indigo-50/95' : 'bg-white';
                return (
                  <tr key={a.id} className={`hover:bg-slate-50 h-12 transition-all font-bold ${isSelected ? 'bg-indigo-50/30' : ''}`}>
                    <td className={`p-2 text-center sticky left-0 z-20 ${stickyBg}`}><input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} /></td>
                    <td className={`p-2 text-center text-slate-400 sticky left-[40px] z-20 ${stickyBg}`}>{(currentPage-1)*itemsPerPage + idx + 1}</td>
                    
                    <td className={`p-2 text-center sticky left-[90px] z-20 ${stickyBg}`}>
                      <button 
                        onClick={() => toggleAudit(a.id)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${logic.isVerified ? 'bg-emerald-600 text-white shadow-md' : 'bg-slate-100 text-slate-400 border hover:bg-emerald-50 hover:text-emerald-600'}`}
                      >
                        {logic.isVerified ? `✅ ${a.last_audit_date}` : '실사 확인'}
                      </button>
                    </td>
                    
                    <td className={`p-2 text-center sticky left-[210px] z-20 ${stickyBg}`}>
                      {a.audit_request_date ? (
                        <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-[10px] font-black border border-amber-200 animate-pulse">
                          🔔 요청됨
                        </span>
                      ) : '-'}
                    </td>
  
                    <td className={`p-2 text-center truncate text-slate-500 sticky left-[300px] z-20 ${stickyBg}`}>{a.dept || '-'}</td>
                    <td className={`p-2 text-center truncate text-slate-900 font-black sticky left-[400px] z-20 ${stickyBg}`}>{a.user || '-'}</td>
                    <td className={`p-2 text-center text-slate-500 sticky left-[500px] z-20 ${stickyBg}`}>{a.category}</td>
                    <td className={`p-2 text-center text-blue-600 sticky left-[580px] z-20 font-black border-r-2 border-slate-200 ${stickyBg}`}>{a.it_type}</td>
                    <td className="p-2 font-black text-slate-900">{a.code}</td>
                    <td className="p-2 truncate">{a.model}</td>
                    <td className="p-2 text-slate-500">{a.sn}</td>
                    <td className="p-2 text-slate-400 truncate text-[10px]">{a.spec}</td>
                    <td className="p-2 text-center">{a.cycle}</td>
                    <td className="p-2 bg-slate-50/50 text-center font-black">
                      {logic.repDate}
                      {logic.dday !== null && logic.dday <= 90 && <span className={`ml-1 px-1 rounded text-[9px] ${logic.dday <= 0 ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'}`}>D-{logic.dday}</span>}
                    </td>
                    <td className="p-2 text-slate-400 truncate text-[10px]">{a.memo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-3 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`px-3 py-1 border rounded font-black text-[10px] shadow-sm transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>
  
      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">
        <div onClick={() => setIsHistoryOpen(!isHistoryOpen)} className="px-5 h-14 flex justify-between items-center cursor-pointer bg-slate-800 text-white hover:bg-slate-700 transition-all">
          <h3 className="text-xs font-black uppercase tracking-tighter flex items-center gap-2">📤 부서 요구사항 전송 이력 ({deptReqs.length}건)</h3>
          <span className="text-[11px] font-bold">{isHistoryOpen ? '접기 ▲' : '열기 ▼'}</span>
        </div>
        
        {isHistoryOpen && (
          <div>
            <div className="flex items-center gap-2 p-3 bg-slate-50 border-b border-slate-200">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">🗓️ 조회 연도</span>
              
              {/* 🚀 [추가] TOTAL 모두보기 추가 및 엑셀 다운로드 버튼 삽입 */}
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="p-1.5 px-3 border border-slate-200 font-black text-[11px] rounded-lg outline-none bg-white text-indigo-600 shadow-sm cursor-pointer hover:border-indigo-300 transition-colors"
              >
                <option value="ALL">TOTAL 모두보기</option>
                {availableYears.map(year => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>

              <button 
                onClick={handleRequestExportExcel} 
                className="px-4 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-black rounded-lg hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center gap-1 ml-2"
              >
                ⬇️ 엑셀 다운로드
              </button>
            </div>
  
            <div className="p-0 overflow-x-auto scrollbar-hide">
              <table className="w-full text-left text-[11px] border-collapse min-w-[1200px] table-fixed">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                    <th className="p-3 w-[60px] text-center">NO</th>
                    <th className="p-3 w-[100px] text-center">전송일자</th>
                    <th className="p-3 w-[80px] text-center">요청자</th>
                    <th className="p-3 w-[200px]">대상 자산정보</th>
                    <th className="p-3 w-[300px]">요구사항 내용</th>
                    <th className="p-3 w-[250px] text-indigo-600 font-black">관리자 검토의견</th>
                    <th className="p-3 w-[100px] text-center">처리완료일</th>
                    <th className="p-3 w-[100px] text-center text-slate-900">상태 / 액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400 font-bold">해당 연도의 요구사항 이력이 없습니다.</td>
                    </tr>
                  ) : (
                    paginatedRequests.map((req: any, i: number) => (
                      <tr key={req.id} className="text-slate-600 font-bold hover:bg-slate-50 transition-colors">
                        <td className="p-3 text-center text-slate-400">{(historyPage-1)*itemsPerPage + i + 1}</td>
                        <td className="p-3 text-center">{req.requestDate}</td>
                        <td className="p-3 text-center text-slate-700">{req.requester}</td>
                        <td className="p-3 font-black text-blue-600 truncate">{req.assetInfo}</td>
                        <td className="p-3 break-keep">{req.content}</td>
                        <td className="p-3 text-indigo-600 font-bold italic bg-indigo-50/20">{req.adminOpinion || '-'}</td>
                        <td className="p-3 text-center text-slate-500 font-black">{req.status !== '대기중' ? (req.completedAt || '-') : '-'}</td>
                        <td className="p-3 text-center">
                          {req.status === '대기중' ? (
                            <button 
                              onClick={() => cancelRequest(req.id)} 
                              className="px-2.5 py-1 bg-red-50 text-red-600 border border-red-200 rounded text-[10px] font-black hover:bg-red-500 hover:text-white transition-all shadow-sm"
                            >
                              요청 취소
                            </button>
                          ) : (
                            <span className={`px-2 py-1 rounded text-[10px] font-black ${req.status === '완료' ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'bg-red-100 text-red-700'}`}>
                              {req.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            {requestTotalPages > 1 && (
              <div className="flex justify-center gap-2 p-3 bg-slate-50 border-t">
                {Array.from({ length: requestTotalPages }).map((_, i) => (
                  <button key={i} onClick={() => setHistoryPage(i + 1)} className={`px-3 py-1 border rounded font-black text-[10px] ${historyPage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>{i + 1}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
  
      {showRequestModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] border border-slate-300 shadow-2xl p-8 rounded-[2.5rem]">
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-4 border-b-2 border-slate-900 pb-3 italic">✈️ Asset Request</h4>
            <div className="mb-4">
              <p className="text-[10px] font-bold text-slate-500 mb-2 underline">선택 자산 정보</p>
              <div className="max-h-24 overflow-y-auto bg-slate-50 border rounded-xl p-2 text-[10px] space-y-1 shadow-inner">
                {deptAssets.filter(a => selectedIds.has(a.id)).map(a => (
                  <div key={a.id} className="font-bold text-slate-700 flex justify-between border-b border-slate-100 pb-1 last:border-0 p-1">
                    <span>{a.user ? `[${a.user}] ` : ''}{a.it_type} | {a.model}</span>
                    <span className="text-blue-600">[{a.code}]</span>
                  </div>
                ))}
              </div>
            </div>
            <textarea value={requestContent} onChange={e => setRequestContent(e.target.value)} placeholder="상세 요청 내용을 입력하세요." className="w-full h-32 bg-white border border-slate-200 p-4 text-[11px] font-bold rounded-xl outline-none focus:border-indigo-500 transition-all resize-none shadow-inner" />
            <div className="flex gap-2 mt-6">
              <button onClick={() => { setShowRequestModal(false); setRequestContent(''); }} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold uppercase">Cancel</button>
              <button onClick={() => {
                if (!requestContent.trim()) return alert("내용을 입력하세요.");
                const targetAssets = deptAssets.filter(a => selectedIds.has(a.id));
                const newRequests = targetAssets.map((a, idx) => ({
                  id: `REQ-${Date.now()}-${idx}`,
                  requestDate: new Date().toISOString().split('T')[0],
                  requester: currentUser?.name, 
                  dept: currentUser?.dept,
                  assetInfo: `${a.code} / ${a.model} / ${a.sn || 'S/N 없음'}`,
                  content: requestContent,
                  status: '대기중',
                  assetCode: a.code,
                  model: a.model,
                  sn: a.sn || '-',
                  assetType: a.it_type,
                  adminOpinion: '',
                  completedAt: ''
                }));
                
                const updated = [...newRequests, ...requests];
                setRequests(updated);
                localStorage.setItem('it_requests_db', JSON.stringify(updated));
                alert("✅ 관리자에게 성공적으로 전송되었습니다.");
                setShowRequestModal(false); setRequestContent(''); setSelectedIds(new Set());
                
                setSelectedYear('ALL'); // 🚀 등록 후 연도를 전체로 초기화해서 내역이 바로 보이도록 함
                
                window.dispatchEvent(new Event('storage'));
              }} className="flex-[2] py-3.5 bg-indigo-600 text-white rounded-xl font-black shadow-md hover:bg-indigo-700 active:scale-95 transition-all uppercase">Send Request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}