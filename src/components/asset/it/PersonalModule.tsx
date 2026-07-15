'use client';
     
import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx'; 
import { getKSTDateString } from '@/utils/dateUtils';
     
export default function PersonalModule() {
  const [currentUser, setCurrentUser] = useState<{name: string, dept: string, email: string} | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [allGlobalAssets, setAllGlobalAssets] = useState<any[]>([]); 
  const [requests, setRequests] = useState<any[]>([]); 
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [typeLabel, setTypeLabel] = useState('자산 분류'); 
  // ✨ 자산 분류(it_type) 필터 추가 완료
  const [colFilters, setColFilters] = useState({ category: '', it_type: '', is_rental: '' });
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false);
  const [showAuditRequestOnly, setShowAuditRequestOnly] = useState(false);
  const [showFeedbackOnly, setShowFeedbackOnly] = useState(false);
  
  const [unifiedCommModal, setUnifiedCommModal] = useState<any | null>(null);
  const [requestContent, setRequestContent] = useState('');
  const [confirmAuditModal, setConfirmAuditModal] = useState<any | null>(null); 
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const [historyTypeFilter, setHistoryTypeFilter] = useState('ALL');
  const [historyDateFilter, setHistoryDateFilter] = useState('ALL');
  const [expandedHistoryAssets, setExpandedHistoryAssets] = useState<Set<string>>(new Set());
  
  const todayStr = getKSTDateString();

  useEffect(() => { setCurrentPage(1); }, [searchQuery, colFilters, showReplaceableOnly, showUnverifiedOnly, showAuditRequestOnly, showFeedbackOnly]);
  
  const fetchAllData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [configRes, meRes, assetRes, reqRes, auditRes] = await Promise.all([
        fetch('/api/admin/config').catch(()=>null),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/asset/it?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/asset/it/requests?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }).catch(()=>null)
      ]);

      if (configRes && configRes.ok) {
        const configData = await configRes.json();
        if (configData?.it_master_label) setTypeLabel(configData.it_master_label);
      }

      let user: any = null;
      if (meRes && meRes.ok) {
        const userData = await meRes.json();
        user = { name: userData.name || '알수없음', dept: userData.unit?.unit_name || '소속 미정', email: userData.email };
        setCurrentUser(user);
      }

      if (auditRes && auditRes.ok) setAudits(await auditRes.json());
      if (reqRes && reqRes.ok) setRequests(await reqRes.json());

      if (assetRes && assetRes.ok) {
        const allAssets = await assetRes.json();
        setAllGlobalAssets(allAssets);
        if (user) setAssets(allAssets.filter((a: any) => a.user === user.name));
      }
    } catch (e) { console.error("Data Sync Failed", e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAllData(); }, []);
  
  const activeAudit = useMemo(() => audits.find(a => a.status === '진행중'), [audits]);
  const lastArchivedAudit = useMemo(() => audits.filter(a => a.status === '보관됨' || a.status === '마감').sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0], [audits]);
  const isAuditActive = !!activeAudit;
  
  const getAssetLogic = (a: any) => {
    let repDate = '-';
    let dday = null;
    let isTargetCount = false;
    const baseDateString = (a.is_rental === '렌탈' && a.start_date) ? a.start_date : (a.in_date || todayStr);
    if (baseDateString) {
      const d = new Date(baseDateString);
      d.setMonth(d.getMonth() + (parseInt(a.cycle) || 0));
      repDate = getKSTDateString(d);
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
        auditStatusText = `인증완료 (${lastAudit})`;
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
         auditStatusText = `최근실사 ${lastAudit}`; 
         auditStatusColor = 'bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed'; 
         isVerified = true;
       } else {
         auditStatusText = '미확인'; 
         auditStatusColor = 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed border-dashed';
       }
    }
     
    const assetRequests = requests.filter(r => r.assetCode === a.code).sort((r1, r2) => new Date(r2.createdAt).getTime() - new Date(r1.createdAt).getTime());
    const latestReq = assetRequests[0];
     
    let commStatusLabel = '의견/요청 작성';
    let commStatusColor = 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50';
    let hasUnreadFeedback = false;
     
    if (latestReq) {
      if (latestReq.status === '의견전송' || latestReq.status === '답변 대기중') {
        commStatusLabel = '요청 전송완료 (대기중)';
        commStatusColor = 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100';
      } else if (latestReq.status === '관리자 의견발송') {
        commStatusLabel = '💌 관리자 답변 도착';
        commStatusColor = 'bg-pink-600 text-white border-pink-700 hover:bg-pink-700 animate-pulse shadow-sm';
        hasUnreadFeedback = true;
      } else if (latestReq.status === '처리완료' || latestReq.status === '관리자 확인완료') {
        commStatusLabel = '✅ 조치 완료';
        commStatusColor = 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100';
      }
    }
  
    return { repDate, dday, isTargetCount, isVerified, isNudged, auditStatusText, auditStatusColor, commStatusLabel, commStatusColor, hasUnreadFeedback };
  };
  
  // ✨ 실사 확인 및 취소(서버 API 연동)
  const executeAuditVerify = async () => {
    if (!confirmAuditModal || !currentUser) return;
    const assetId = confirmAuditModal.id;
    
    // VERIFY(인증)인지 CANCEL(취소)인지 판단
    const isCancel = confirmAuditModal.action === 'CANCEL';
    const dateToSave = isCancel ? null : todayStr;
    const isDoneValue = !isCancel;

    try {
      const assetUpdate = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: assetId, last_audit_date: dateToSave, audit_request_date: '' })
      });

      if (activeAudit) {
        await fetch('/api/asset/it/audit', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: activeAudit.id,
            responses: {
              upsert: {
                where: { auditId_userEmail: { auditId: activeAudit.id, userEmail: currentUser.email } },
                update: { isDone: isDoneValue, date: dateToSave },
                create: { userEmail: currentUser.email, isDone: isDoneValue, date: dateToSave }
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
    let verified = 0, requestCount = 0, feedbackCount = 0;
    assets.forEach(a => {
      typeCounts[a.it_type] = (typeCounts[a.it_type] || 0) + 1;
      const logic = getAssetLogic(a);
      if (logic.isVerified) verified++;
      if (logic.isNudged) requestCount++;
      if (logic.hasUnreadFeedback) feedbackCount++; 
    });
    return { verified, requestCount, feedbackCount, typeCounts, total: assets.length, replaceable: assets.filter(a => getAssetLogic(a).isTargetCount).length };
  }, [assets, activeAudit, requests]);
  
  const uniqueCategories = useMemo(() => Array.from(new Set(allGlobalAssets.map(a => a.category).filter(Boolean))), [allGlobalAssets]);
  const uniqueItTypes = useMemo(() => Array.from(new Set(allGlobalAssets.map(a => a.it_type).filter(Boolean))), [allGlobalAssets]);
  
  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      const s = searchQuery.toLowerCase().trim();
      const logic = getAssetLogic(a);
      const matchSearch = !s || [a.code, a.model, a.sn, a.spec].some(v => String(v).toLowerCase().includes(s));
      const matchCategory = !colFilters.category || a.category === colFilters.category;
      const matchItType = !colFilters.it_type || a.it_type === colFilters.it_type; // ✨ 필터 연동
      const matchRental = !colFilters.is_rental || a.is_rental === colFilters.is_rental;
      
      const matchReplace = !showReplaceableOnly || logic.isTargetCount;
      const matchUnverified = !showUnverifiedOnly || !logic.isVerified; 
      const matchAuditReq = !showAuditRequestOnly || logic.isNudged;
      const matchFeedback = !showFeedbackOnly || logic.hasUnreadFeedback; 
     
      return matchSearch && matchCategory && matchItType && matchRental && matchReplace && matchUnverified && matchAuditReq && matchFeedback;
    });
  }, [assets, searchQuery, colFilters, showReplaceableOnly, showUnverifiedOnly, showAuditRequestOnly, showFeedbackOnly, activeAudit, requests]);
  
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  
  const myHistoryReqs = useMemo(() => {
    if (!currentUser) return [];
    let list = requests.filter(r => r.requester === currentUser.name);
    if (historyTypeFilter !== 'ALL') list = list.filter(r => r.assetType === historyTypeFilter);
    if (historyDateFilter !== 'ALL') list = list.filter(r => (r.requestDate || '').startsWith(historyDateFilter));
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, currentUser, historyTypeFilter, historyDateFilter]);

  const historyUniqueTypes = useMemo(() => Array.from(new Set(requests.filter(r => r.requester === currentUser?.name).map(r => r.assetType).filter(Boolean))), [requests, currentUser]);
  const historyUniqueDates = useMemo(() => {
    const dates = requests.filter(r => r.requester === currentUser?.name).map(r => (r.requestDate || '').substring(0, 7)); 
    return Array.from(new Set(dates)).filter(Boolean).sort((a, b) => b.localeCompare(a));
  }, [requests, currentUser]);
  
  const handleExcelDownload = () => {
    const targetAssets = selectedIds.size > 0 ? filteredAssets.filter(a => selectedIds.has(a.id)) : filteredAssets;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const excelData = targetAssets.map((a, index) => {
      const logic = getAssetLogic(a);
      return { 'NO': index + 1, '조직': a.dept || '-', '사용자': a.user || '-', '범주': a.category, '자산 분류': a.it_type, '자산번호': a.code, '모델명': a.model, 'S/N': a.sn, '기본 사양': a.spec, '교체주기(M)': a.cycle, '교체예정일': logic.repDate, '최근실사일': a.last_audit_date || '-', '실사확인요청일': a.audit_request_date || '-', '기타(메모)': a.memo };
    });
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "My_Assets"); XLSX.writeFile(wb, `나의업무자산현황_${currentUser?.name}.xlsx`);
  };
  
// ✨ 에러 추적 기능이 강화된 전송 함수
const handleSubmitRequest = async () => {
  if (!requestContent.trim()) return alert("요청하실 내용을 입력해 주세요.");
  
  const newReq = {
    requestDate: todayStr,
    requester: currentUser?.name, 
    dept: currentUser?.dept,
    assetInfo: `${unifiedCommModal.code} / ${unifiedCommModal.model}`,
    content: requestContent, 
    status: '의견전송', // 🚀 관리자 대시보드 '사용자 의견수신'과 매칭되는 핵심 키워드
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
      fetchAllData(); // 🚀 전송 후 즉시 서버 최신화 동기화
    } else {
      const errData = await res.json().catch(() => ({}));
      // 백엔드 DB 저장 실패 시 원인을 팝업으로 표출
      alert(`❌ 서버 저장 실패: ${errData.error || 'Prisma 스키마 필드 매칭 오류 가능성'}`);
    }
  } catch(e: any) { 
    console.error("의견 전송 통신 오류:", e);
    alert(`❌ 서버 통신 실패: ${e.message}`); 
  }
};
 
// 🚀 전송한 의견 취소 로직 (fetchAllData로 오류 해결된 최종본)
const handleCancelRequest = async (id: string) => {
  if (!confirm("전송한 의견을 취소하시겠습니까? (취소 후 복구할 수 없습니다)")) return;

  try {
    const res = await fetch(`/api/asset/it/requests?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert("✅ 의견 전송이 취소되었습니다.");
      // 💡 컴포넌트 내부 이름인 fetchAllData로 정확하게 연동했습니다.
      fetchAllData(); 
    } else {
      alert("❌ 취소에 실패했습니다.");
    }
  } catch (e) {
    console.error(e);
    alert("❌ 통신 오류가 발생했습니다.");
  }
};

  const toggleHistoryAsset = (assetCode: string) => {
    setExpandedHistoryAssets(prev => {
      const next = new Set(prev);
      next.has(assetCode) ? next.delete(assetCode) : next.add(assetCode);
      return next;
    });
  };
  
  const latestAdminOpinion = useMemo(() => {
    if (!unifiedCommModal) return '수신된 관리자 의견이 없습니다.';
    const assetReqs = requests.filter(r => r.assetCode === unifiedCommModal.code).sort((r1, r2) => new Date(r2.createdAt).getTime() - new Date(r1.createdAt).getTime());
    const latestReq = assetReqs[0];
    const opinion = latestReq?.adminOpinion;
     
    if (latestReq && (latestReq.status === '처리완료' || latestReq.status === '관리자 확인완료') && (!opinion || opinion.includes('의견 없이 처리'))) {
       return '관리자에 의해 정상적으로 처리되었습니다.';
    }
    return opinion || '아직 수신된 관리자 의견/답변이 없습니다.';
  }, [unifiedCommModal, requests]);
     
  if (loading) return <div className="p-10 font-bold text-slate-400 animate-pulse text-center">Loading Workspace...</div>;
  if (!currentUser) return <div className="p-20 text-center font-black text-red-500">인증 정보가 없습니다. 다시 로그인해주세요.</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
  
      <div className="flex flex-col lg:flex-row gap-6 items-stretch min-h-[160px]">
      <div className="flex-[3] bg-slate-900 p-8 rounded-[2rem] text-white shadow-lg flex flex-col justify-between relative overflow-hidden">
  <div className="absolute right-0 top-0 w-48 h-full bg-gradient-to-l from-slate-800/50 to-transparent pointer-events-none" />
  
  <div className="z-10 flex flex-col justify-between h-full">
    <div>

{/* 🎯 1. 최상위 표준 규격 타이틀 (명함 코너 표준 규칙: 부서만 박스, 이름은 박스 없이 텍스트로) */}
<h1 className="text-2xl font-black tracking-tight text-white leading-none mb-8 flex items-center flex-wrap gap-2.5">
  {/* 🏢 소속 부서 뱃지 (스케일 표준화: text-lg + px-4 py-2) */}
  <span className="bg-slate-700/60 border border-slate-600 text-indigo-300 px-4 py-2 rounded-2xl text-lg font-black tracking-tight shrink-0 shadow-inner">
    {currentUser?.dept || '조직'}
  </span>
  
  {/* 👤 사용자 이름 (박스를 빼고 명함 코너와 1:1 매칭!) */}
  <span className="text-slate-200 font-black shrink-0">
    {currentUser?.name || '사용자'} 님
  </span>
  
  {/* 🎯 메인 타이틀 텍스트 */}
  <span className="text-white">IT·업무자산 운영 현황</span>
</h1>
      
    
        {/* 🎯 3. 세로 일자바 및 교체대상 클릭 필터 */}
        <div className="flex items-end gap-8 mb-6">
        
        {/* 🎯 나의 보유 자산 (메인 통계) */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">나의 보유 자산</p>
          <p className="text-3xl font-black text-white tracking-tighter leading-none">{stats.total}</p>
        </div>
        
        {/* 🎯 세로 일자바 및 교체대상 (원래의 버튼형으로 복구) */}
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
    
    {/* 4. 하단 자산 아이콘 버튼들 (유지) */}
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {Object.entries(stats.typeCounts).map(([type, count]) => {
        const isSelected = colFilters.it_type === type;
        return (
          <button key={type} onClick={() => setColFilters({ ...colFilters, it_type: isSelected ? '' : type })} className={`px-4 py-2 rounded-xl border flex flex-col items-center min-w-[75px] transition-all shadow-sm ${isSelected ? 'bg-blue-600 border-blue-500 shadow-blue-900/50 scale-105' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}>
            <span className={`text-[10px] font-bold uppercase mb-0.5 tracking-wider ${isSelected ? 'text-blue-100' : 'text-slate-300'}`}>{type}</span>
            <span className="font-black text-[15px] leading-none">{count}</span>
          </button>
        );
      })}
    </div>
  </div>
</div>
     
        <div className="flex-[2] bg-white border border-slate-200 rounded-[2rem] p-6 flex flex-col justify-between shadow-sm">
          <div>
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><span>🔍</span> 실사 운영 관리 (Audit Status)</span>
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
            <button onClick={() => setShowFeedbackOnly(!showFeedbackOnly)} className={`flex-1 py-3 rounded-xl text-[11px] font-bold border transition-all flex flex-col items-center justify-center gap-1 ${showFeedbackOnly ? 'bg-pink-600 border-pink-600 text-white shadow-lg' : 'bg-white text-pink-600 border-pink-200 hover:bg-pink-50'}`}>
              <span>새로운 답변/의견</span><span className="text-sm font-black">{stats.feedbackCount}</span>
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
          {/* ✨ 3개의 필터 나란히 배치 */}
          <select className="px-3 py-2 border border-slate-200 font-bold text-[11px] rounded-xl outline-none bg-white text-slate-700" value={colFilters.category} onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}><option value="">범주 (전체)</option>{uniqueCategories.map(cat => <option key={cat}>{cat}</option>)}</select>
          <select className="px-3 py-2 border border-blue-200 font-bold text-[11px] rounded-xl outline-none bg-blue-50 text-blue-700 shadow-sm" value={colFilters.it_type} onChange={(e) => setColFilters({ ...colFilters, it_type: e.target.value })}><option value="">{typeLabel} (전체)</option>{uniqueItTypes.map(t => <option key={t}>{t}</option>)}</select>
          <select className="px-3 py-2 border border-slate-200 font-bold text-[11px] rounded-xl outline-none bg-white shadow-sm text-indigo-700" value={colFilters.is_rental} onChange={(e) => setColFilters({ ...colFilters, is_rental: e.target.value })}><option value="">조달유형 (전체)</option><option value="구매">구매</option><option value="렌탈">렌탈</option><option value="구독">구독</option></select>
          
          <div className="w-px h-5 bg-slate-200 mx-1"></div>
          <button onClick={handleExcelDownload} className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-[11px] font-black hover:bg-emerald-600 hover:text-white transition-all shadow-sm">선택 엑셀 다운로드</button>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse min-w-[1900px] table-fixed">
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
                
                <th className="h-12 w-[160px] text-center sticky left-[110px] bg-indigo-50/50 text-indigo-700 z-30 border-r border-slate-200">정기 실사 확인 상태</th>
                <th className="h-12 w-[150px] text-center sticky left-[270px] bg-slate-50 z-30 border-r-2 border-slate-200 text-pink-600">의견 및 요구사항 처리</th>
                
                <th className="h-12 w-[100px] text-center">범주</th>
                <th className="h-12 w-[130px] text-center border-r-2 border-slate-100">{typeLabel}</th>
                <th className="h-12 w-[250px] pl-6">자산번호</th>
                <th className="h-12 w-[250px] px-4">모델명</th>
                <th className="h-12 w-[180px] px-4">S/N</th>
                <th className="h-12 w-[350px] px-4 text-slate-400">기본 사양</th>
                <th className="h-12 w-[100px] text-center text-slate-400">교체주기(M)</th>
                <th className="h-12 w-[150px] text-center font-black">교체예정일</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-800">
              {paginatedAssets.length === 0 ? (
                <tr><td colSpan={12} className="h-32 text-center text-slate-400">조회된 자산이 없습니다.</td></tr>
              ) : (
                paginatedAssets.map((a, idx) => {
                  const logic = getAssetLogic(a);
                  const isSelected = selectedIds.has(a.id);
                  const stickyBg = isSelected ? 'bg-slate-50/95' : 'bg-white';
  
                  return (
                    <tr key={a.id} className={`h-14 hover:bg-slate-50 transition-colors ${isSelected ? 'bg-slate-50' : ''}`}>
                      <td className={`text-center sticky left-0 z-20 border-r border-slate-50 ${stickyBg}`}><input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} className="accent-slate-800" /></td>
                      <td className={`text-center text-slate-400 font-mono sticky left-[50px] z-20 border-r border-slate-50 ${stickyBg}`}>{(currentPage-1)*itemsPerPage + idx + 1}</td>
                      
                      {/* ✨ 동적으로 변하는 실사 확인 뱃지/버튼 (기간에 따라 잠김/활성/취소 분기 처리) */}
                      <td className={`text-center sticky left-[110px] z-20 border-r border-slate-100 px-2 ${stickyBg}`}>
                        {isAuditActive ? (
                          <button 
                            onClick={() => setConfirmAuditModal({ ...a, action: logic.isVerified ? 'CANCEL' : 'VERIFY' })}
                            className={`w-full py-1.5 rounded-md font-black tracking-tight transition-all shadow-sm border ${logic.auditStatusColor}`}
                          >
                            {logic.auditStatusText}
                          </button>
                        ) : (
                          <div className={`w-full py-1.5 rounded-md font-black tracking-tight border ${logic.auditStatusColor}`}>
                            {logic.auditStatusText}
                          </div>
                        )}
                      </td>
                      
                      {/* ✨ 먹통 버그 해결: 독립적으로 잘 열림 */}
                      <td className={`text-center sticky left-[270px] z-20 border-r-2 border-slate-200 ${stickyBg} px-2`}>
                        <button onClick={() => setUnifiedCommModal(a)} className={`w-full py-1.5 rounded-md text-[10px] font-black border transition-all truncate px-1 shadow-sm cursor-pointer ${logic.commStatusColor}`}>
                          {logic.commStatusLabel}
                        </button>
                      </td>
  
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
  
      <div className="mt-12 bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden pb-8">
        <div className="bg-slate-800 text-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-black tracking-widest uppercase flex items-center gap-2"><span>💬</span> 나의 의견 및 요구사항 송수신 대장</h2>
            <p className="text-[10px] text-slate-400 font-bold mt-1">관리자에게 보낸 자산 관련 조치 요청과 답변 내역을 한눈에 확인합니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={historyTypeFilter} onChange={(e) => setHistoryTypeFilter(e.target.value)} className="text-[11px] font-bold bg-slate-700 border border-slate-600 text-white rounded-xl px-4 py-2 outline-none cursor-pointer focus:ring-1 focus:ring-slate-400">
              <option value="ALL">자산 분류 전체보기</option>
              {historyUniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={historyDateFilter} onChange={(e) => setHistoryDateFilter(e.target.value)} className="text-[11px] font-bold bg-slate-700 border border-slate-600 text-white rounded-xl px-4 py-2 outline-none cursor-pointer focus:ring-1 focus:ring-slate-400">
              <option value="ALL">모든 기간 (전체 조회)</option>
              {historyUniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
          
        <div className="overflow-x-auto w-full">
        <table className="w-full text-left border-collapse min-w-[1050px]">
            <thead className="bg-white border-b border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest">
              <tr>
                <th className="p-4 text-center w-[100px]">요청 일자</th>
                <th className="p-4 text-center w-[140px]">대상 자산 정보</th>
                <th className="p-4 w-[260px]">나의 전송 내역 (요청사항)</th>
                <th className="p-4 w-[240px]">관리자 답변 사항</th>
                {/* 🚀 답변자, 취소 컬럼 신규 추가 */}
                <th className="p-4 text-center w-[90px]">답변자</th>
                <th className="p-4 text-center w-[100px]">처리 일자</th>
                <th className="p-4 text-center w-[110px]">응답 상태</th>
                <th className="p-4 text-center w-[90px] text-rose-500">취소</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {requests.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-400 text-xs font-bold">송수신 내역이 없습니다.</td></tr>
              ) : (
                requests.map((req, idx) => {
                  const isPending = req.status === '의견전송' || req.status === '답변 대기중';
                  
                  // 🚀 DB에 저장된 "내용:::관리자이름" 분리 로직
                  let opinionText = req.adminOpinion || '';
                  let responder = '';
                  if (opinionText.includes(':::')) {
                    [opinionText, responder] = opinionText.split(':::');
                  }

                  return (
                    <tr key={req.id || idx} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 text-center font-mono text-slate-500 text-[11px]">
                        {req.requestDate || req.createdAt?.split('T')[0] || '-'}
                      </td>
                      
                      {/* 🚀 1. 대상 자산 정보 (뱃지 + 코드 UI) */}
                      <td className="p-4 text-center">
                        <div className="flex flex-col gap-0.5 items-center justify-center">
                          <span className="text-[9px] font-black uppercase tracking-wider text-indigo-500 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
                            {req.assetType || '일반'}
                          </span>
                          <span className="text-slate-800 font-black text-[11px] mt-1 whitespace-nowrap">
                            {req.assetCode}
                          </span>
                        </div>
                      </td>
                      
                      <td className="p-4 text-slate-700 text-[11px] font-bold">
                        {req.content}
                      </td>
                      
                      {/* 🚀 2. 관리자 답변 사항 (:::이후 이름 제거됨) */}
                      <td className="p-4 text-slate-600 text-[11px]">
                        {isPending ? (
                          <span className="text-slate-400 italic">아직 답변이 등록되지 않았습니다.</span>
                        ) : (
                          opinionText
                        )}
                      </td>

                      {/* 🚀 3. 답변자 전용 컬럼 */}
                      <td className="p-4 text-center">
                        {!isPending && responder ? (
                          <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 border border-indigo-200 rounded shadow-sm whitespace-nowrap">
                            {responder}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      
                      <td className="p-4 text-center font-mono text-slate-500 text-[11px]">
                        {!isPending ? (req.completedAt || '-') : '-'}
                      </td>
                      
                      {/* 🚀 4. 응답 상태 (whitespace-nowrap 적용으로 줄바꿈 방지) */}
                      <td className="p-4 text-center">
                        <span className={`px-2.5 py-1.5 rounded-md text-[10px] font-black whitespace-nowrap shadow-sm inline-block ${
                          isPending ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        }`}>
                          {req.status}
                        </span>
                      </td>

                      {/* 🚀 5. 전송 취소 액션 버튼 (대기 중일 때만 표시) */}
                      <td className="p-4 text-center">
                        {isPending ? (
                          <button 
                            onClick={() => handleCancelRequest(req.id)}
                            className="px-2.5 py-1.5 bg-white border border-rose-200 text-rose-500 rounded text-[10px] font-black hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-colors shadow-sm whitespace-nowrap"
                          >
                            전송 취소
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[10px] font-bold">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table> 
        </div>
      </div>
  
      {/* ✨ 신규: 실사 확인 모달 (인증 및 취소 통합 처리) */}
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
                  현재 보유 중이신 <span className="text-indigo-600 font-black">[{confirmAuditModal.code}] {confirmAuditModal.model}</span> 장비의 <br/>
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

      {/* 의견/요청 전송 모달 */}
      {unifiedCommModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] border border-slate-200 shadow-2xl p-8 rounded-3xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">자산 조치 관련 관리자 커뮤니케이션</h4>
            <p className="text-[10px] font-bold text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
              대상 자산: {unifiedCommModal.it_type} | {unifiedCommModal.code}
            </p>
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-6 scrollbar-hide">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">📤 관리자에게 전송할 내용 작성</p>
                <textarea 
                  value={requestContent} 
                  onChange={e => setRequestContent(e.target.value)} 
                  placeholder="장비 불량, 교체 희망, 소프트웨어 설치 지원 등 관리자에게 전달할 내용을 작성하세요." 
                  className="w-full h-32 bg-slate-50 border border-slate-200 p-4 text-[11px] font-bold rounded-xl outline-none focus:border-slate-500 focus:bg-white focus:ring-1 focus:ring-slate-400 transition-all resize-none shadow-inner" 
                />
              </div>
            </div>
            
            {/* ✨ 모달 하단 버튼부: type="button" 강제 및 클릭 섀도우 안정화 */}
            <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
              <button 
                type="button"
                onClick={() => { setUnifiedCommModal(null); setRequestContent(''); }} 
                className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] uppercase hover:bg-slate-200 transition-colors"
              >
                취소 (닫기)
              </button>
              <button 
                type="button"
                onClick={handleSubmitRequest} 
                className="flex-[2] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
              >
                🚀 요구사항 전송
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}