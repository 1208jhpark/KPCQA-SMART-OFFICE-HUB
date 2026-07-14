'use client';
  
import { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useRouter } from 'next/navigation'; // 🚀 Next.js App Router 필수 임포트
  
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);
  
function ITMasterRequestContent() {
  const router = useRouter(); // 🚀 이 선언문이 있어야 router.push를 사용할 수 있습니다!
  const [currentUser, setCurrentUser] = useState<{name: string, dept: string, level: string} | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // 🚀 조치 팝업 상태 관리
  const [editingReq, setEditingReq] = useState<any>(null);
  const [editOpinion, setEditOpinion] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | '답변 대기중' | '관리자 확인완료'>('ALL');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10; 
  const [selectedYear, setSelectedYear] = useState('ALL');
  
  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterDept, filterType, filterStatus, selectedYear]);
  
  useEffect(() => { 
    fetchData(); 
  }, []);
  
  const fetchData = async () => {
    setLoading(true);
    
    try {
      const userRes = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: 'no-store' }); 
      if (userRes.ok) {
        const userData = await userRes.json();
        setCurrentUser({ 
          name: userData.name || '시스템 관리자', 
          dept: userData.unit?.unit_name || '소속 미정',
          level: userData.level || 'LV-1' 
        });
      }
    } catch(e) { console.error("User fetch error", e); }
  
    try {
      const reqRes = await fetch(`/api/asset/it/requests?t=${Date.now()}`, { cache: 'no-store' });
      if (reqRes.ok) {
        let allReqs = await reqRes.json();
        
        allReqs = allReqs.map((r: any) => {
          let unifiedStatus = r.status;
          if (unifiedStatus === '의견전송' || unifiedStatus === '대기중') unifiedStatus = '답변 대기중';
          if (unifiedStatus === '완료') unifiedStatus = '관리자 확인완료';

          let opinionText = r.adminOpinion || '';
          let responder = '';
          if (opinionText.includes(':::')) {
            [opinionText, responder] = opinionText.split(':::');
          }

          return { 
            ...r, 
            status: unifiedStatus,
            adminOpinionText: opinionText,
            responderName: responder 
          };
        });
  
        allReqs.sort((a: any, b: any) => {
          const dateA = a.requestDate || a.createdAt || '';
          const dateB = b.requestDate || b.createdAt || '';
          return dateB.localeCompare(dateA);
        });
        setRequests(allReqs);
      }
    } catch(e) { console.error("Data fetch error", e); }
    
    setLoading(false);
  };
  
  // 🚀 DB 팝업 데이터 조치 및 업데이트
  const handleUpdateStatus = async () => {
    if (!editingReq) return;
    
    const responder = currentUser?.name || '시스템 관리자'; // API에서 긁어온 실제 세션 이름

    try {
      const res = await fetch('/api/asset/it/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingReq.id,
          adminOpinion: editOpinion,
          responderName: responder,
          status: '관리자 확인완료'
        })
      });

      if (res.ok) {
        alert("✅ 조치가 성공적으로 완료되었습니다.");
        setEditingReq(null);
        fetchData();
      } else {
        alert("❌ 서버 오류로 조치에 실패했습니다.");
      }
    } catch (e) {
      console.error(e);
      alert("❌ 통신 오류가 발생했습니다.");
    }
  };

  // 🚀 [신규 기능] 답변 회수 로직 (상태 및 답변 내용 초기화)
  const handleRevokeReply = async (id: string) => {
    if (!confirm("답변을 회수하고 다시 '답변 대기중' 상태로 되돌리시겠습니까?")) return;
  
    try {
      const res = await fetch('/api/asset/it/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id,
          adminOpinion: '',    // 내용 초기화
          responderName: '',   // 답변자 초기화
          status: '의견전송'     // DB 초기 상태로 롤백
        })
      });

      if (res.ok) {
        alert("✅ 답변이 회수되었습니다.");
        fetchData();
      } else {
        alert("❌ 서버 오류로 회수에 실패했습니다.");
      }
    } catch (e) { console.error(e); }
  };

  // 🚀 단일 내역 삭제 로직
  const handleDeleteRequest = async (id: string) => {
    if (currentUser?.level !== 'LV-1') {
      return alert("❌ 삭제 권한이 거부되었습니다. (LV-1 전사 관리자 전용 기능)");
    }
    if (!confirm("해당 송수신 이력 내역을 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.")) return;
  
    try {
      const res = await fetch(`/api/asset/it/requests?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert("✅ 해당 이력이 정상적으로 삭제되었습니다.");
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetchData();
      }
    } catch (e) { console.error(e); }
  };
  
  const availableYears = useMemo(() => {
    const years = requests.map(r => (r.requestDate || r.createdAt || '').substring(0, 4)).filter(Boolean);
    const uniqueYears = Array.from(new Set(years));
    const currentYear = new Date().getFullYear().toString();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
    return uniqueYears.sort((a, b) => b.localeCompare(a)); 
  }, [requests]);
  
  const uniqueDepts = useMemo(() => Array.from(new Set(requests.map(r => r.dept || r.department || '소속 미정'))).filter(Boolean).sort(), [requests]);
  const uniqueTypes = useMemo(() => Array.from(new Set(requests.map(r => r.assetType || r.category || '일반'))).filter(Boolean).sort(), [requests]);
  
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      const matchYear = selectedYear === 'ALL' || (r.requestDate || r.createdAt || '').startsWith(selectedYear);
      const matchStatus = filterStatus === 'ALL' || r.status === filterStatus;
      const rDept = r.dept || r.department || '소속 미정';
      const matchDept = !filterDept || rDept === filterDept;
      const rType = r.assetType || r.category || '일반';
      const matchType = !filterType || rType === filterType;
      const s = searchQuery.toLowerCase().trim();
      const matchSearch = !s || [r.requester, r.name, rDept, r.assetCode, r.code, r.modelName, r.model, r.content].some(v => 
        String(v).toLowerCase().includes(s)
      );
      return matchYear && matchStatus && matchDept && matchType && matchSearch;
    });
  }, [requests, selectedYear, filterStatus, filterDept, filterType, searchQuery]);
  
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const currentData = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  const toggleSelectAll = () => {
    const currentIds = currentData.map(r => r.id);
    const allSelected = currentIds.length > 0 && currentIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentIds.forEach(id => next.delete(id));
    else currentIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
  
  const handleExportExcel = () => {
    const targets = selectedIds.size > 0 ? filteredRequests.filter(r => selectedIds.has(r.id)) : filteredRequests;
    if (targets.length === 0) return alert("다운로드할 데이터가 없습니다.");
    
    const exportData = targets.map((req, idx) => ({
      'NO': targets.length - idx,
      '신청일자': req.requestDate || req.createdAt || '-',
      '신청자': req.requester || req.name || '알수없음',
      '소속': req.dept || req.department || '소속 미정',
      '자산분류': req.assetType || req.category || '일반',
      '자산번호': req.assetCode || req.code || '-',
      '사용자 요구사항': req.content,
      '관리자 검토의견': req.adminOpinionText || '-',
      '답변 관리자': req.responderName || '-',
      '처리상태': req.status,
      '처리완료일': req.completedAt || '-'
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Requests_Log");
    XLSX.writeFile(wb, `IT_요구사항_이력대장_${selectedYear === 'ALL' ? '전체' : selectedYear}.xlsx`);
  };
  
  const handleExportZip = async () => {
    const targets = selectedIds.size > 0 ? filteredRequests.filter(r => selectedIds.has(r.id)) : filteredRequests;
    if (targets.length === 0) return alert("추출할 데이터가 없습니다.");
    
    const zip = new JSZip();
    targets.forEach((req, idx) => {
      const content = `■ 발생일자: ${req.requestDate || req.createdAt || '-'}\n■ 요청자: ${req.requester} (${req.dept})\n■ 대상자산: ${req.assetType} | ${req.assetCode}\n\n[사용자 요구사항]\n${req.content}\n\n=================================\n\n■ 처리상태: ${req.status}\n■ 완료일자: ${req.completedAt || '-'}\n■ 답변자: ${req.responderName || '시스템'}\n\n[관리자 검토/조치결과]\n${req.adminOpinionText || '내역 없음'}`;
      zip.file(`${idx + 1}_${req.requester}_${req.assetCode}.txt`, "\ufeff" + content);
    });
  
    const contentBlob = await zip.generateAsync({ type: "blob" });
    saveAs(contentBlob, `IT_요구사항_증빙자료_${new Date().toISOString().split('T')[0]}.zip`);
  };
  
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading IT Requests Archive...</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* 🚀 딥 에메랄드 테마 기반 IT 마스터 서브 배너 */}
<div className="w-full bg-teal-950 border border-teal-850 p-6 rounded-[2.5rem] text-white shadow-lg relative overflow-hidden flex flex-col justify-center min-h-[140px] mb-6">
  <div className="flex items-center justify-between relative z-10 w-full">
    <div>
      {/* 1. 상단 라벨 (마스터 컬러 매칭 text-teal-400) */}
      <p className="text-[10px] font-black uppercase tracking-widest text-teal-400 mb-2">
        IT Asset Service Requests & History Log
      </p>
      
      {/* 2. 메인 타이틀 */}
      <h2 className="text-2xl font-black tracking-tight text-white leading-none">
        전사 IT 요구사항 및 실사 이력 아카이브
      </h2>
      
      {/* 3. 하단 설명 (간격 mt-4 표준화 및 선명도 조절) */}
      <p className="text-teal-200/80 text-xs font-semibold mt-4 opacity-95">
        사용자와 주고받은 모든 자산 관련 조치 로그가 영구 보존됩니다. (답변 대기중 항목 클릭 시 조치 팝업)
      </p>
    </div>
    
  </div>
</div>

{/* 🚀 URL 기반 4버튼 동적 탭 네비게이션 (소모품/명함 마스터 표준 규격 이식) */}
<div className="bg-slate-100 p-2 rounded-3xl flex flex-wrap gap-2 max-w-max border border-slate-200/50 shadow-inner mb-6">
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/dashboard')}
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname === '/asset/it/master/dashboard'
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📊 IT 마스터 대시보드
  </button>
  
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/audit')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/audit')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    🔍 정기 자산 실사 관리
  </button>
  
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/requests')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/requests')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📋 서비스 요청/조치 대장
  </button>

  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/archive')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/archive')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📁 불용자산 아카이브
  </button>
</div>
  
      <div className="bg-white border border-slate-200 px-5 py-4 shadow-sm rounded-[2rem] flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          <button onClick={() => setFilterStatus('ALL')} className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all ${filterStatus === 'ALL' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>전체 내역 보기</button>
          <button onClick={() => setFilterStatus('답변 대기중')} className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all ${filterStatus === '답변 대기중' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>답변 대기중</button>
          <button onClick={() => setFilterStatus('관리자 확인완료')} className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all ${filterStatus === '관리자 확인완료' ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>관리자 확인완료</button>
        </div>
  
        <div className="flex-1 min-w-[300px]">
          <input 
            type="text" 
            placeholder="[통합검색] 이름, 부서, 자산번호, 요구사항 내용 검색..." 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)} 
            className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-[11px] font-bold outline-none focus:border-indigo-500 transition-colors" 
          />
        </div>
  
        <div className="flex flex-wrap gap-2 items-center">
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="p-2.5 border border-slate-200 font-black text-[11px] rounded-xl outline-none bg-white text-slate-700">
            <option value="">부서 (전체)</option>
            {uniqueDepts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="p-2.5 border border-slate-200 font-black text-[11px] rounded-xl outline-none bg-white text-indigo-700">
            <option value="">자산 분류 (전체)</option>
            {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        
        <HeaderLight title="전사 요구사항 로그 대장" count={filteredRequests.length}>
          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
            >
              <option value="ALL">전체 연도 조회</option>
              {availableYears.map(year => <option key={year} value={year}>{year}년도</option>)}
            </select>
            <button onClick={handleExportZip} className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-[10px] font-black hover:bg-black transition-all shadow-sm">
              선택 ZIP 다운로드
            </button>
            <button onClick={handleExportExcel} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-700 transition-all shadow-sm">
              선택 엑셀 다운로드
            </button>
          </div>
        </HeaderLight>
  
        <div className="overflow-x-auto">
          {/* 테이블 최소 너비를 조금 더 넓혀서 버튼 2개와 새 컬럼이 넉넉히 들어가게 조정 */}
          <table className="w-full text-left border-collapse min-w-[1400px] table-fixed">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 w-[50px] text-center border-r border-slate-200">
                  <input type="checkbox" checked={currentData.length > 0 && currentData.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="accent-slate-800" />
                </th>
                <th className="h-12 w-[60px] text-center border-r border-slate-200">NO</th>
                <th className="h-12 w-[100px] text-center border-r border-slate-200">신청일자</th>
                <th className="h-12 w-[150px] pl-6 border-r border-slate-200">신청자 (소속)</th>
                <th className="h-12 w-[200px] pl-6 border-r border-slate-200">대상 자산 정보</th>
                <th className="h-12 w-[240px] px-6">사용자 요구사항</th>
                
                {/* 🚀 컬럼 분리: 검토의견 / 답변자 */}
                <th className="h-12 w-[220px] px-6 border-l border-slate-200 bg-slate-50">관리자 검토의견</th>
                <th className="h-12 w-[90px] text-center border-l border-slate-200 bg-slate-50">답변자</th>
                
                <th className="h-12 w-[90px] text-center border-l border-slate-200">처리상태</th>
                <th className="h-12 w-[100px] text-center border-l border-slate-200">처리완료일</th>
                
                {/* 🚀 액션 버튼 공간 확장 (회수, 삭제 2개) */}
                <th className="h-12 w-[110px] text-center border-l border-slate-200 text-rose-600">액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {currentData.length === 0 ? (
                <tr><td colSpan={11} className="h-32 text-center text-slate-400 italic">조회된 이력 데이터가 없습니다.</td></tr>
              ) : (
                currentData.map((req, i) => {
                  const isPending = req.status === '답변 대기중';
                  
                  return (
                    <tr key={req.id} className={`h-16 hover:bg-slate-50 transition-colors ${selectedIds.has(req.id) ? 'bg-slate-50' : ''}`}>
                      <td className="text-center border-r border-slate-50">
                        <input type="checkbox" checked={selectedIds.has(req.id)} onChange={() => {
                          const next = new Set(selectedIds);
                          next.has(req.id) ? next.delete(req.id) : next.add(req.id);
                          setSelectedIds(next);
                        }} className="accent-slate-800" />
                      </td>
                      <td className="text-center text-slate-400 font-mono border-r border-slate-50">
                        {filteredRequests.length - ((currentPage - 1) * itemsPerPage + i)}
                      </td>
                      <td className="text-center font-mono text-slate-500 border-r border-slate-50">
                        {req.requestDate || req.createdAt?.split('T')[0] || '-'}
                      </td>
                      <td className="pl-6 border-r border-slate-50">
                        <span className="text-slate-900 font-black">{req.requester || '알수없음'}</span>
                        <span className="text-slate-400 block text-[10px]">({req.dept || '미정'})</span>
                      </td>
                      <td className="pl-6 border-r border-slate-50">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-slate-400 font-black uppercase tracking-wider">{req.assetType || '일반'}</span>
                          <span className="text-indigo-700 font-black truncate">{req.assetCode || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 text-slate-600 truncate" title={req.content}>
                        {req.content}
                      </td>
                      
                      {/* 🚀 분리된 관리자 검토의견 컬럼 */}
                      <td className="px-6 border-l border-slate-50 bg-slate-50/30">
                        <span className="text-slate-800 truncate block" title={req.adminOpinionText}>
                          {isPending ? <span className="text-slate-300 italic">검토 대기 중</span> : (req.adminOpinionText || '완료 확인')}
                        </span>
                      </td>

                      {/* 🚀 분리된 답변자 (API 연동된 이름) 컬럼 */}
                      <td className="text-center border-l border-slate-50 bg-slate-50/30">
                        {!isPending && req.responderName ? (
                          <span className="text-[10px] font-black text-indigo-700 whitespace-nowrap">
                            {req.responderName}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* 🚀 상태 클릭 시 팝업 오픈 (기존 기능 유지) */}
                      <td 
                        className="text-center border-l border-slate-50 cursor-pointer group"
                        onClick={() => {
                          setEditingReq(req);
                          setEditOpinion(req.adminOpinionText || '');
                        }}
                      >
                        <span className={`px-2 py-1 rounded-md text-[9px] font-black tracking-tight whitespace-nowrap group-hover:scale-105 transition-transform inline-block ${
                          isPending ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        }`}>
                          {req.status} {isPending && '✎'}
                        </span>
                      </td>
                      <td className="text-center text-slate-400 font-mono border-l border-slate-50">
                        {!isPending ? (req.completedAt || '-') : '-'}
                      </td>
                      
                      {/* 🚀 액션 버튼 (회수 + 삭제) */}
                      <td className="border-l border-slate-50 px-2">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* 완료된 항목에만 '회수' 버튼 렌더링 */}
                          {!isPending && (
                            <button 
                              onClick={() => handleRevokeReply(req.id)}
                              className="px-2 py-1.5 bg-slate-100 border border-slate-200 text-slate-600 rounded text-[9px] font-black hover:bg-slate-700 hover:text-white hover:border-slate-700 transition-colors"
                              title="답변을 지우고 대기 상태로 되돌립니다."
                            >
                              회수
                            </button>
                          )}
                          <button 
                            onClick={() => handleDeleteRequest(req.id)}
                            className="px-2 py-1.5 bg-rose-50 border border-rose-200 text-rose-600 rounded text-[9px] font-black hover:bg-rose-600 hover:text-white transition-colors"
                            title="내역 영구 삭제"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
  
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-[11px] transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50">다음</button>
          </div>
        )}
      </div>

      {/* 🚀 관리자 답변 조치 팝업 */}
      {editingReq && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden">
            <div className="bg-slate-800 p-5 flex items-center justify-between">
              <h3 className="font-black text-white text-lg">사용자 요구사항 조치 및 답변</h3>
              <button onClick={() => setEditingReq(null)} className="text-slate-400 hover:text-white font-black">✕</button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-600 font-bold space-y-1.5">
                <p><span className="text-slate-400">요청자:</span> {editingReq.requester} ({editingReq.dept})</p>
                <p><span className="text-slate-400">대상 자산:</span> {editingReq.assetCode}</p>
                <p><span className="text-slate-400">요청 내용:</span> <span className="text-indigo-600">{editingReq.content}</span></p>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-2">관리자 검토 의견 (선택)</label>
                <textarea 
                  value={editOpinion} 
                  onChange={(e) => setEditOpinion(e.target.value)}
                  className="w-full h-32 p-4 bg-white rounded-xl border border-slate-300 text-sm font-bold text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none transition-all"
                  placeholder="답변을 작성하지 않고 '완료 처리'만 누르셔도 무방합니다."
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditingReq(null)} className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black text-xs transition-colors">
                  닫기
                </button>
                <button onClick={handleUpdateStatus} className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-xs shadow-md transition-colors">
                  답변 저장 및 완료 처리하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
  
    </div>
  );
}
  
export default function MasterRequestModule() {
  return (
    <Suspense fallback={<div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading IT Requests Archive...</div>}>
      <ITMasterRequestContent />
    </Suspense>
  );
}