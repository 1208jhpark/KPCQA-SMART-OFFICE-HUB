'use client';
  
import { useState, useMemo, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx'; 
  
export default function DeptModule() {
  // 🚀 클릭 상태 관리 (어떤 카드를 클릭했는지 저장)
  const [activeStatFilter, setActiveStatFilter] = useState<string | null>(null);
  // 🚀 이메일 정보 포함 (DB 기록용)
  const [currentUser, setCurrentUser] = useState<{name: string, dept: string, unit_id: string, email: string} | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [allGlobalAssets, setAllGlobalAssets] = useState<any[]>([]); 
  const [requests, setRequests] = useState<any[]>([]); 
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [auditBaseline, setAuditBaseline] = useState(''); 
  const [typeLabel, setTypeLabel] = useState('자산 분류'); 
  
  const [colFilters, setColFilters] = useState({ category: '', it_type: '', is_rental: '', dept: '', user: '' });
  
  const [audits, setAudits] = useState<any[]>([]);
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false);
  const [showAuditRequestOnly, setShowAuditRequestOnly] = useState(false);
  
  const [unifiedCommModal, setUnifiedCommModal] = useState<any | null>(null);
  const [requestContent, setRequestContent] = useState('');
  
  // 🚀 PersonalModule과 동일한 모달 팝업 상태 추가
  const [confirmAuditModal, setConfirmAuditModal] = useState<any | null>(null); 
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => { setCurrentPage(1); }, [searchQuery, colFilters, showReplaceableOnly, showUnverifiedOnly, showAuditRequestOnly]);
  
// 35번째 줄 부근 (기존 fetchAllData 시작점)부터 교체 시작 ⬇️

  // ✅ 1. 함수를 useCallback으로 감싸 리렌더링 시 고정 스냅샷 유지
  const fetchAllData = useCallback(async () => {
    setLoading(true);
    const ts = Date.now();
    let fetchedUser: {name: string, dept: string, unit_id: string, email: string} | null = null;
    
    try {
      const [configRes, userRes, unitRes] = await Promise.all([
        fetch('/api/admin/config').catch(() => null),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/units?active=true').catch(() => null)
      ]);
   
      if (configRes?.ok) {
        const configData = await configRes.json();
        if (configData?.admin04_label) setTypeLabel(configData.admin04_label);
        if (configData?.audit_baseline) setAuditBaseline(configData.audit_baseline);
      }
   
      if (unitRes?.ok) {
         const units = await unitRes.json();
         setUnitsList(units);
      }
   
      if (userRes?.ok) {
        const userData = await userRes.json();
        fetchedUser = { 
          name: userData.name || '알수없음', 
          dept: userData.unit?.unit_name || '소속 미정',
          unit_id: userData.unit?.id || '',
          email: userData.email || '' 
        };
        setCurrentUser(fetchedUser);
      }
    } catch(e) { console.error("User fetch error", e); }
   
    try {
      const [assetRes, reqRes, auditRes] = await Promise.all([
        fetch(`/api/asset/it?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/asset/it/requests?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }).catch(() => null)
      ]);
   
      if (auditRes?.ok) setAudits(await auditRes.json());
      if (reqRes?.ok) setRequests(await reqRes.json());
      
      if (assetRes?.ok) {
        const allAssets = await assetRes.json();
        setAllGlobalAssets(allAssets);
        setAssets(Array.isArray(allAssets) ? allAssets : []); // 🔴 방어 코드: 배열 보장
      }
    } catch (e) { console.error("Data Sync Failed", e); }
    finally { 
      setLoading(false); 
    }
  }, []); // 👈 의존성 배열 비워둠
   
  // ✅ 2. 마운트 시점에 안전하게 호출
  useEffect(() => { 
    fetchAllData(); 
  }, [fetchAllData]);

  // ⬆️ 여기까지 기존 코드를 지우고 덮어쓰시면 됩니다.

  const getDescendantDepts = (targetDeptName: string) => {
    const targetUnit = unitsList.find(u => u.unit_name === targetDeptName);
    if (!targetUnit) return [targetDeptName];
    
    const results = new Set<string>();
    results.add(targetUnit.unit_name);
    
    const getChildren = (parentId: string) => {
      unitsList.filter(u => u.parent_id === parentId).forEach(c => {
        results.add(c.unit_name);
        getChildren(c.id);
      });
    };
    
    getChildren(targetUnit.id);
    return Array.from(results);
  };
  
  // 🚀 직속 상위 본부 고정 추가 로직 반영 완료
  const allowedDepts = useMemo(() => {
    if (!currentUser || !unitsList.length) return [];
    
    const targetUnit = unitsList.find(u => u.unit_name === currentUser.dept);
    const depts = new Set<string>();

    if (targetUnit) {
      if (targetUnit.parent_id) {
        const parentUnit = unitsList.find(u => u.id === targetUnit.parent_id);
        if (parentUnit) depts.add(parentUnit.unit_name);
      }
      getDescendantDepts(currentUser.dept).forEach(d => depts.add(d));
    } else {
      depts.add(currentUser.dept);
    }
    
    return Array.from(depts);
  }, [currentUser, unitsList]);
  
  const deptAssets = useMemo(() => {
    return assets.filter(a => allowedDepts.includes(a.dept));
  }, [assets, allowedDepts]);
  
  const activeAudit = useMemo(() => audits.find(a => a.status === '진행중'), [audits]);
  const lastArchivedAudit = useMemo(() => audits.filter(a => a.status === '보관됨' || a.status === '마감').sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0], [audits]);
  const isAuditActive = !!activeAudit;
  
  // 🚀 PersonalModule과 동일한 UI 로직 (줄바꿈 및 색상)
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
    let auditStatusText = '';
    let auditStatusColor = '';
    let isVerified = false;
    let isNudged = !!a.audit_request_date; 
  
    if (isAuditActive) {
      if (lastAudit && lastAudit >= activeAudit.startDate) {
        auditStatusText = `인증완료\n(${lastAudit})`;
        auditStatusColor = 'bg-emerald-50 text-emerald-600 border-emerald-300 hover:bg-emerald-100 cursor-pointer';
        isVerified = true;
      } else if (isNudged) {
        auditStatusText = '🚨 관리자 확인요청'; 
        auditStatusColor = 'bg-red-600 text-white shadow-md animate-pulse border-red-700 cursor-pointer';
      } else {
        auditStatusText = '📋 실사 확인하기'; 
        auditStatusColor = 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 border-indigo-700 cursor-pointer';
      }
    } else {
       if (lastAudit) {
         auditStatusText = `최근실사\n${lastAudit}`; 
         auditStatusColor = 'bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed'; 
         isVerified = true;
       } else {
         auditStatusText = '미확인'; 
         auditStatusColor = 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed border-dashed';
       }
    }
  
    const assetRequests = requests.filter(r => r.assetCode === a.code).sort((r1, r2) => new Date(r2.createdAt).getTime() - new Date(r1.createdAt).getTime());
    const latestReq = assetRequests[0];
  
    let commStatusLabel = '의견/요청 처리';
    let commStatusColor = 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200';
  
    if (latestReq) {
      if (latestReq.status === '의견전송') {
        commStatusLabel = '의견전송완료';
        commStatusColor = 'bg-amber-100 border-amber-300 text-amber-700 hover:bg-amber-200';
      } else if (latestReq.status === '관리자 의견발송') {
        commStatusLabel = '관리자 답변/신규요청';
        commStatusColor = 'bg-pink-600 text-white hover:bg-pink-700 animate-pulse shadow-sm';
      } else if (latestReq.status === '처리완료' || latestReq.status === '관리자 확인완료') {
        commStatusLabel = '처리완료/신규요청';
        commStatusColor = 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm';
      }
    }
  
    return { repDate, dday, isTargetCount, isVerified, isNudged, auditStatusText, auditStatusColor, commStatusLabel, commStatusColor };
  };
  
  // 🚀 PersonalModule과 완벽하게 동일한 모달 API 처리 함수
  const executeAuditVerify = async () => {
    if (!confirmAuditModal || !currentUser) return;
    const assetId = confirmAuditModal.id;
    
    const isCancel = confirmAuditModal.action === 'CANCEL';
    const todayStr = new Date().toISOString().split('T')[0];
    const dateToSave = isCancel ? null : todayStr;
    const isDoneValue = !isCancel;
  
    try {
      const assetUpdate = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: assetId, 
          last_audit_date: dateToSave, 
          audit_request_date: null // 인증 완료 시 관리자 확인요청(독촉) 해제
        })
      });
  
      if (activeAudit) {
        await fetch('/api/asset/it/audit', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: activeAudit.id,
            responses: {
              upsert: {
                where: { auditId_userEmail: { auditId: activeAudit.id, userEmail: currentUser.email || currentUser.name } },
                update: { isDone: isDoneValue, date: dateToSave },
                create: { userEmail: currentUser.email || currentUser.name, isDone: isDoneValue, date: dateToSave }
              }
            }
          })
        }).catch(() => null);
      }
  
      if (assetUpdate.ok) {
        alert(isCancel ? `❌ [${confirmAuditModal.code}] 실사 인증이 취소되었습니다.` : `✅ [${confirmAuditModal.code}] 실사 내역이 기록되었습니다.`);
        setConfirmAuditModal(null);
        fetchAllData(); 
      }
    } catch (error) {
      alert("서버 통신 오류가 발생했습니다.");
    }
  };
  
  const stats = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    let verified = 0;
    let requestCount = 0;
    deptAssets.forEach(a => {
      typeCounts[a.it_type] = (typeCounts[a.it_type] || 0) + 1;
      const logic = getAssetLogic(a);
      if (logic.isVerified) verified++;
      if (logic.isNudged) requestCount++;
    });
    return { verified, requestCount, typeCounts, total: deptAssets.length, replaceable: deptAssets.filter(a => getAssetLogic(a).isTargetCount).length };
  }, [deptAssets, activeAudit, requests]);
  
  const uniqueCategories = useMemo(() => Array.from(new Set(allGlobalAssets.map(a => a.category).filter(Boolean))), [allGlobalAssets]);
  const uniqueDepts = useMemo(() => allowedDepts, [allowedDepts]);
  
  // 🚀 동적 사용자 드롭다운 ('공용' 맨 위 고정 로직 반영)
  const uniqueUsers = useMemo(() => {
    const users = new Set(deptAssets.map(a => a.user).filter(Boolean));
    users.delete('공용'); 
    return ['공용', ...Array.from(users).sort()];
  }, [deptAssets]);
  
  const filteredAssets = useMemo(() => {
    return deptAssets.filter(a => {
      const s = searchQuery.toLowerCase().trim();
      const logic = getAssetLogic(a);
      
      // 🚀 기존 조건들
      const matchSearch = !s || [a.code, a.model, a.sn, a.spec, a.user].some(v => String(v).toLowerCase().includes(s));
      const matchCategory = !colFilters.category || a.category === colFilters.category;
      const matchDept = !colFilters.dept || a.dept === colFilters.dept;
      const matchUser = !colFilters.user || a.user === colFilters.user;
      
      const matchReplace = !showReplaceableOnly || logic.isTargetCount;
      const matchUnverified = !showUnverifiedOnly || !logic.isVerified; 
      const matchAuditReq = !showAuditRequestOnly || !!a.audit_request_date;
      
      // 🚀 클릭 필터(솔트) 조건 추가
      let matchStat = true;
      if (activeStatFilter === '인증완료') matchStat = logic.isVerified;
      else if (activeStatFilter === '미인증') matchStat = !logic.isVerified;
      else if (activeStatFilter === '교체대상') matchStat = logic.isTargetCount;
      else if (activeStatFilter === '실사확인요청') matchStat = !!a.audit_request_date;
     
      return matchStat && matchSearch && matchCategory && matchDept && matchUser && matchReplace && matchUnverified && matchAuditReq;
    });
  }, [deptAssets, searchQuery, colFilters, showReplaceableOnly, showUnverifiedOnly, showAuditRequestOnly, activeStatFilter, activeAudit, requests]);
  
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  
  const handleExcelDownload = () => {
    const targetAssets = selectedIds.size > 0 ? filteredAssets.filter(a => selectedIds.has(a.id)) : filteredAssets;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const excelData = targetAssets.map((a, index) => {
      const logic = getAssetLogic(a);
      return { 'NO': index + 1, '조직': a.dept || '-', '사용자': a.user || '-', '범주': a.category, '자산 분류': a.it_type, '자산번호': a.code, '모델명': a.model, 'S/N': a.sn, '기본 사양': a.spec, '교체주기(M)': a.cycle, '교체예정일': logic.repDate, '최근실사일': a.last_audit_date || '-', '실사확인요청일': a.audit_request_date || '-', '기타(메모)': a.memo };
    });
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dept_Assets"); XLSX.writeFile(wb, `부서업무자산현황_${currentUser?.dept}.xlsx`);
  };
  
  const handleSubmitRequest = async () => {
    if (!requestContent.trim()) return alert("요청하실 내용을 입력해 주세요.");
    
    const newReq = {
      requestDate: new Date().toISOString().split('T')[0],
      requester: currentUser?.name, 
      dept: currentUser?.dept,
      assetInfo: `${unifiedCommModal.code} / ${unifiedCommModal.model}`,
      content: requestContent, 
      status: '의견전송', 
      assetCode: unifiedCommModal.code, 
      assetType: unifiedCommModal.it_type,
    };
    
    try {
      const res = await fetch('/api/asset/it/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReq)
      });

      if (res.ok) {
        alert("✅ 담당 부서(관리자)에게 성공적으로 요구사항이 전송되었습니다.");
        setUnifiedCommModal(null); 
        setRequestContent(''); 
        fetchAllData(); 
      } else {
        alert("❌ 전송 실패: 서버 오류가 발생했습니다.");
      }
    } catch (e) {
      alert("❌ 통신 오류가 발생했습니다.");
    }
  };
  
  const latestAdminOpinion = useMemo(() => {
    if (!unifiedCommModal) return '수신된 관리자 의견이 없습니다.';
    const assetReqs = requests.filter(r => r.assetCode === unifiedCommModal.code).sort((r1, r2) => new Date(r2.createdAt).getTime() - new Date(r1.createdAt).getTime());
    const latestReq = assetReqs[0];
    
    let opinionText = latestReq?.adminOpinion || '';
    if (opinionText.includes(':::')) {
      opinionText = opinionText.split(':::')[0];
    }
  
    if (latestReq && (latestReq.status === '처리완료' || latestReq.status === '관리자 확인완료') && 
        (!opinionText || opinionText.includes('의견 없이 처리'))) {
       return '관리자에 의해 처리되었습니다.';
    }
    return opinionText || '수신된 관리자 의견이 없습니다.';
  }, [unifiedCommModal, requests]);
  
  if (loading) return <div className="p-10 font-bold text-slate-400 animate-pulse text-center">Loading Workspace...</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
  
      <div className="flex flex-col lg:flex-row gap-6 items-stretch min-h-[160px]">
      <div className="flex-[3] bg-slate-900 p-8 rounded-[2rem] text-white shadow-lg flex flex-col justify-between relative overflow-hidden">
  <div className="absolute right-0 top-0 w-48 h-full bg-gradient-to-l from-slate-800/50 to-transparent pointer-events-none" />
  
  <div className="z-10 flex flex-col justify-between h-full">
    <div>

{/* 🎯 1. 최상위 표준 규격 타이틀: 대괄호 제거 및 소모품/명함 표준 뱃지 스케일 적용 (이름 없음) */}
<h1 className="text-2xl font-black tracking-tight text-white leading-none mb-8 flex items-center flex-wrap gap-2.5">
  {/* 🏢 소속 부서 뱃지 (스케일 표준화: text-lg + px-4 py-2 + rounded-2xl) */}
  <span className="bg-slate-700/60 border border-slate-600 text-indigo-300 px-4 py-2 rounded-2xl text-lg font-black tracking-tight shrink-0 shadow-inner">
    {currentUser?.dept || '조직'}
  </span>
  
  {/* 🎯 메인 타이틀 텍스트 */}
  <span className="text-white">자산 운영 현황</span>
</h1>
      
      <div className="flex items-end gap-8 mb-6">
        
        {/* 🎯 2. 관할 부서 총 자산 (메인 통계 - 5xl에서 3xl로 조정하여 밸런스 확보) */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">관할 부서 총 자산</p>
          <p className="text-3xl font-black text-white tracking-tighter leading-none">{stats.total}</p>
        </div>
        
        {/* 🎯 3. 세로 일자바 및 교체대상 버튼 (중복되는 인증/미인증 삭제) */}
        <div className="border-l border-slate-700 pl-8 pb-0.5">
          <button 
            onClick={() => setShowReplaceableOnly(!showReplaceableOnly)} 
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all shadow-sm ${showReplaceableOnly ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
          >
            교체대상 <span className={showReplaceableOnly ? 'text-white' : 'text-blue-400 font-black ml-0.5'}>{stats.replaceable}</span>
          </button>
        </div>

      </div>
    </div>
    
    {/* 4. 하단 자산 아이콘 버튼들 */}


            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
  {Object.entries(stats.typeCounts).map(([type, count]) => {
    // 🚀 클릭하면 colFilters.it_type 값을 바꿔서 필터링(솔트) 작동
    const isSelected = colFilters.it_type === type;
    return (
      <button 
        key={type} 
        onClick={() => setColFilters(prev => ({ 
          ...prev, 
          it_type: isSelected ? '' : type // 다시 누르면 필터 해제(전체보기)
        }))} 
        className={`px-4 py-2 rounded-xl border flex flex-col items-center min-w-[75px] transition-all shadow-sm ${
          isSelected 
            ? 'bg-blue-600 border-blue-500 shadow-blue-900/50 scale-105' 
            : 'bg-white/10 border-white/20 hover:bg-white/20'
        }`}
      >
        <span className={`text-[10px] font-bold uppercase mb-0.5 tracking-wider ${isSelected ? 'text-blue-100' : 'text-slate-300'}`}>
          {type}
        </span>
        <span className="font-black text-[15px] leading-none">{count}</span>
      </button>
    );
  })}
</div>
          </div>
        </div>
     
        <div className="flex-[2] bg-white border border-slate-200 rounded-[2rem] p-6 flex flex-col justify-between shadow-sm">
          <div>
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><span>🔍</span> 부서 실사 관리 (Audit Status)</span>
            <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-100 mt-3 mb-5">
              <div className="flex items-center gap-3">
                 {isAuditActive ? (
                   <span className="px-3 py-1 bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg font-black text-[11px] animate-pulse">🟢 실사 진행 중</span>
                 ) : (
                   <span className="px-3 py-1 bg-slate-200 text-slate-600 rounded-lg font-black text-[11px] border border-slate-300">⚪ 실사 대기 중</span>
                 )}
              </div>
              <div className="flex flex-col items-end">
                 <span className="text-slate-400 text-[9px] font-black">{isAuditActive ? '현재 실사 운영 기간' : '최근 실사 완료일'}</span>
                 <span className={`${isAuditActive ? 'text-indigo-600' : 'text-emerald-600'} font-black text-[13px] tracking-tight`}>
                   {isAuditActive ? `${activeAudit.startDate} ~ ${activeAudit.endDate}` : (lastArchivedAudit ? lastArchivedAudit.archivedAt : '이력 없음')}
                 </span>
              </div>
            </div>
          </div>
     
          <div className="flex gap-2 w-full">
            <button onClick={() => setShowAuditRequestOnly(!showAuditRequestOnly)} className={`flex-1 py-3 rounded-xl text-[11px] font-bold border transition-all flex flex-col items-center justify-center gap-1 ${showAuditRequestOnly ? 'bg-red-600 border-red-600 text-white shadow-lg' : 'bg-white text-red-600 border-red-200 hover:bg-red-50'}`}>
              <span>관리자 확인요청</span><span className="text-sm font-black">{stats.requestCount}</span>
            </button>
            <button onClick={() => setShowUnverifiedOnly(!showUnverifiedOnly)} className={`flex-1 py-3 rounded-xl text-[11px] font-bold border transition-all flex flex-col items-center justify-center gap-1 ${showUnverifiedOnly ? 'bg-slate-600 border-slate-600 text-white shadow-lg' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              <span>미인증 장비</span><span className="text-sm font-black">{stats.total - stats.verified}</span>
            </button>
          </div>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 p-4 shadow-sm rounded-2xl flex flex-wrap gap-4 items-center justify-between">
        <div className="flex-1 min-w-[280px]">
          <input type="text" placeholder="[통합검색] 모델명, S/N, 사양" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl text-[11px] font-bold outline-none focus:border-slate-400 transition-colors" />
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
          <select className="px-3 py-2 border border-slate-200 font-bold text-[11px] rounded-xl outline-none bg-white text-indigo-700" value={colFilters.dept} onChange={(e) => setColFilters({ ...colFilters, dept: e.target.value })}>
            <option value="">소속 부서 (전체)</option>
            {uniqueDepts.map(d => <option key={d}>{d}</option>)}
          </select>
          <select className="px-3 py-2 border border-blue-200 font-bold text-[11px] rounded-xl outline-none bg-blue-50 text-blue-700 shadow-sm" value={colFilters.user} onChange={(e) => setColFilters({ ...colFilters, user: e.target.value })}>
            <option value="">소속 인원 및 공용 (전체)</option>
            {uniqueUsers.map(u => <option key={u as string}>{u}</option>)}
          </select>
  
          <div className="w-px h-5 bg-slate-200 mx-1"></div>
  
          <select className="px-3 py-2 border border-slate-200 font-bold text-[11px] rounded-xl outline-none bg-white text-slate-700" value={colFilters.category} onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}><option value="">범주 (전체)</option>{uniqueCategories.map(cat => <option key={cat as string}>{cat as string}</option>)}</select>
          <select className="px-3 py-2 border border-slate-200 font-bold text-[11px] rounded-xl outline-none bg-white shadow-sm" value={colFilters.is_rental} onChange={(e) => setColFilters({ ...colFilters, is_rental: e.target.value })}><option value="">조달유형 (전체)</option><option value="구매">구매</option><option value="렌탈">렌탈</option><option value="구독">구독</option></select>
          <button onClick={handleExcelDownload} className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-[11px] font-black hover:bg-emerald-600 hover:text-white transition-all shadow-sm">선택 엑셀 다운로드</button>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse min-w-[2100px] table-fixed">
            <thead className="bg-slate-50 text-slate-600 text-[11px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 w-[50px] text-center sticky left-0 bg-slate-50 z-30 border-r border-slate-100">
                  <input type="checkbox" checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedIds.has(a.id))} onChange={() => {
                    const currentPageIds = paginatedAssets.map(a => a.id);
                    const allSelected = currentPageIds.every(id => selectedIds.has(id));
                    const next = new Set(selectedIds);
                    if (allSelected) currentPageIds.forEach(id => next.delete(id));
                    else currentPageIds.forEach(id => next.add(id));
                    setSelectedIds(next);
                  }} className="accent-slate-800" />
                </th>
                <th className="h-12 w-[60px] text-center sticky left-[50px] bg-slate-50 z-30 border-r border-slate-100">NO</th>
                
                {/* 🚀 PersonalModule과 동일한 단일 컬럼화 */}
                <th className="h-12 w-[160px] text-center sticky left-[110px] bg-indigo-50/50 text-indigo-700 z-30 border-r border-slate-200">정기 실사 확인 상태</th>
                <th className="h-12 w-[150px] text-center sticky left-[270px] bg-slate-50 z-30 border-r-2 border-slate-200 text-pink-600">의견/요청 처리상태</th>
                
                <th className="h-12 w-[150px] text-center border-r border-slate-100">소속 부서/센터</th>
                <th className="h-12 w-[120px] text-center border-r-2 border-slate-100 text-blue-600">장비 사용자</th>
  
                <th className="h-12 w-[100px] text-center">범주</th>
                <th className="h-12 w-[130px] text-center border-r-2 border-slate-100">{typeLabel}</th>
                <th className="h-12 w-[250px] pl-6">자산번호</th>
                <th className="h-12 w-[250px] px-4">모델명</th>
                <th className="h-12 w-[180px] px-4">S/N</th>
                <th className="h-12 w-[350px] px-4 text-slate-400">기본 사양</th>
                <th className="h-12 w-[100px] text-center text-slate-400">교체주기(M)</th>
                <th className="h-12 w-[150px] text-center font-black">교체예정일</th>
                <th className="h-12 w-[250px] px-4 text-slate-400">기타(메모)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-800">
              {paginatedAssets.length === 0 ? (
                <tr><td colSpan={15} className="h-32 text-center text-slate-400">데이터가 없습니다.</td></tr>
              ) : (
                paginatedAssets.map((a, idx) => {
                  const logic = getAssetLogic(a);
                  const isSelected = selectedIds.has(a.id);
                  const stickyBg = isSelected ? 'bg-slate-50/95' : 'bg-white';
  
                  return (
                    <tr key={a.id} className={`h-14 hover:bg-slate-50 transition-colors ${isSelected ? 'bg-slate-50' : ''}`}>
                      <td className={`text-center sticky left-0 z-20 border-r border-slate-50 ${stickyBg}`}><input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} className="accent-slate-800" /></td>
                      <td className={`text-center text-slate-400 font-mono sticky left-[50px] z-20 border-r border-slate-50 ${stickyBg}`}>{(currentPage-1)*itemsPerPage + idx + 1}</td>
                      
                      {/* 🚀 PersonalModule과 완벽하게 동일한 뱃지/버튼 UI */}
                      <td className={`text-center sticky left-[110px] z-20 border-r border-slate-100 px-2 ${stickyBg}`}>
                        {isAuditActive ? (
                          <button 
                            onClick={() => setConfirmAuditModal({ ...a, action: logic.isVerified ? 'CANCEL' : 'VERIFY' })}
                            className={`w-full py-1.5 rounded-md text-[10px] font-black whitespace-pre-line leading-tight tracking-tight transition-all shadow-sm border ${logic.auditStatusColor}`}
                          >
                            {logic.auditStatusText}
                          </button>
                        ) : (
                          <div className={`w-full py-1.5 rounded-md text-[10px] font-black whitespace-pre-line leading-tight tracking-tight border ${logic.auditStatusColor}`}>
                            {logic.auditStatusText}
                          </div>
                        )}
                      </td>
  
                      <td className={`text-center sticky left-[270px] z-20 border-r-2 border-slate-200 ${stickyBg} px-2`}>
                        <button 
                          onClick={() => setUnifiedCommModal(a)} 
                          className={`w-full py-1.5 rounded-md text-[10px] font-black border transition-all truncate px-1 shadow-sm ${logic.commStatusColor}`}
                        >
                          {logic.commStatusLabel}
                        </button>
                      </td>
  
                      <td className="text-center font-bold text-slate-500 border-r border-slate-100">{a.dept}</td>
                      <td className="text-center font-black text-slate-800 border-r-2 border-slate-100">{a.user}</td>
  
                      <td className="text-center text-slate-400">{a.category}</td>
                      <td className="text-center text-blue-600 font-black border-r-2 border-slate-100">{a.it_type}</td>
                      <td className="pl-6 font-black text-slate-900">{a.code}</td>
                      <td className="px-4 truncate max-w-[250px]">{a.model}</td>
                      <td className="px-4 font-mono text-slate-500">{a.sn}</td>
                      <td className="px-4 text-slate-500 truncate max-w-[350px]">{a.spec}</td>
                      <td className="text-center text-slate-400">{a.cycle}</td>
                      <td className="text-center font-black">
                        {logic.repDate}
                        {logic.dday !== null && logic.dday <= 90 && <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] ${logic.dday <= 0 ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'}`}>D-{logic.dday}</span>}
                      </td>
                      <td className="px-4 text-slate-400 truncate max-w-[250px]">{a.memo}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-4 pb-4 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-[11px] bg-white border border-slate-200 rounded-lg font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-lg font-black text-[11px] transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-[11px] bg-white border border-slate-200 rounded-lg font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </div>
  
      {/* 🚀 신규 추가: PersonalModule과 동일한 실사 확인/취소 모달 */}
      {confirmAuditModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-[400px] border border-slate-200 shadow-2xl p-8 rounded-3xl animate-in zoom-in-95 duration-200 flex flex-col text-center">
            {confirmAuditModal.action === 'CANCEL' ? (
              <>
                <div className="text-5xl mb-4">↩️</div>
                <h4 className="text-lg font-black text-rose-600 tracking-tight mb-2">실사 인증 내역 취소</h4>
                <p className="text-[11px] font-bold text-slate-500 mb-6 leading-relaxed bg-rose-50 p-4 rounded-xl border border-rose-100">
                  <span className="text-slate-900 font-black">[{confirmAuditModal.code}]</span> 장비에 대한<br/>
                  실사 인증 내역을 <span className="text-rose-600">미확인 상태</span>로 되돌리시겠습니까?
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmAuditModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-colors">닫기</button>
                  <button onClick={executeAuditVerify} className="flex-[2] py-3.5 bg-rose-600 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-rose-700 active:scale-95 transition-all">실사 취소하기</button>
                </div>
              </>
            ) : (
              <>
                <div className="text-5xl mb-4">📋</div>
                <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">자산 실사 내역 확인</h4>
                <p className="text-[11px] font-bold text-slate-500 mb-6 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
                  해당 부서(센터)의 <span className="text-indigo-600 font-black">[{confirmAuditModal.code}] {confirmAuditModal.model}</span> 장비에 대한 <br/>
                  파손 및 분실 등 이상 유무를 확인하셨습니까?<br/><br/>
                  이상이 없다면 아래의 <span className="text-emerald-600 font-black">'실사 확인 완료'</span> 버튼을 눌러주세요.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmAuditModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-colors">취소 (창 닫기)</button>
                  <button onClick={executeAuditVerify} className="flex-[2] py-3.5 bg-emerald-600 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-emerald-700 active:scale-95 transition-all">✅ 실사 확인 완료</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 🚀 커뮤니케이션 모달 */}
      {unifiedCommModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] border border-slate-200 shadow-2xl p-8 rounded-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">자산 관련 의견 및 요구사항 송수신</h4>
            <p className="text-[10px] font-bold text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
              대상 자산: {unifiedCommModal.it_type} | {unifiedCommModal.code} ({unifiedCommModal.user})
            </p>
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-6 scrollbar-hide">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">📥 관리자 수신 의견</p>
                <div className="bg-pink-50/50 p-4 rounded-xl border border-pink-100 text-[11px] font-bold text-slate-700 leading-relaxed whitespace-pre-wrap shadow-inner min-h-[80px]">
                  {latestAdminOpinion}
                </div>
              </div>
     
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">📤 요구사항 작성 및 전송 (답장)</p>
                <textarea 
                  value={requestContent} 
                  onChange={e => setRequestContent(e.target.value)} 
                  placeholder="해당 자산에 대한 조치, 수리, 교체 등 요구사항을 입력해 주세요." 
                  className="w-full h-32 bg-white border border-slate-300 p-4 text-[11px] font-bold rounded-xl outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400 transition-all resize-none shadow-sm" 
                />
              </div>
            </div>
            
            <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
              <button onClick={() => { setUnifiedCommModal(null); setRequestContent(''); }} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] uppercase hover:bg-slate-200 transition-colors">
                닫기
              </button>
              <button onClick={handleSubmitRequest} className="flex-[2] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[11px] shadow-md hover:bg-black active:scale-95 transition-all uppercase">
                요구사항 전송
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}