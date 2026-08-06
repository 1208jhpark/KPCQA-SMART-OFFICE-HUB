'use client';
     
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useRouter } from 'next/navigation'; // 🚀 Next.js App Router 필수 임포트
import { getKSTDateString } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
     
export default function AuditModule() {
  const router = useRouter(); // 🚀 이 선언문이 있어야 router.push를 사용할 수 있습니다!
  const [audits, setAudits] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  const [editModal, setEditModal] = useState<any | null>(null);
  const [nudgeModal, setNudgeModal] = useState<any | null>(null);
  
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const itemsPerPage = 10;
  
  const fetchAuditData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [auditRes, uRes, unitRes, meRes] = await Promise.all([
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }), 
        fetch(`/api/admin/users?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
        fetch('/api/auth/me')
      ]);
  
      if (meRes.ok) setCurrentUser(await meRes.json());
  
      if (auditRes.ok) {
        const loadedAudits = await auditRes.json();
        setAudits(loadedAudits);
      }
  
      if (uRes.ok && unitRes.ok) {
        const uData = await uRes.json();
        const unitData = await unitRes.json();
        setUnits(unitData);
  
        const mappedUsers = (uData.users || []).map((u: any) => ({
          ...u,
          dept: unitData.find((un: any) => un.id === u.unit_id)?.unit_name || '소속없음'
        }));
        setUsers(mappedUsers);
      }
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => { fetchAuditData(); }, []);
  
  const isLV1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : JSON.parse(currentUser.roles || '[]');
    return roles.includes('LV_1');
  }, [currentUser]);
  
  const todayStr = getKSTDateString();
  const activeAudits = useMemo(() => audits.filter(a => a.status !== '보관됨').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [audits]);
  const historyAuditsRaw = useMemo(() => audits.filter(a => a.status === '보관됨').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [audits]);
  
  const availableYears = useMemo(() => {
    const years = historyAuditsRaw.map(h => (h.archivedAt || '').substring(0, 4)).filter(Boolean);
    const unique = Array.from(new Set(years));
    if (!unique.includes(todayStr.substring(0, 4))) unique.push(todayStr.substring(0, 4));
    return unique.sort((a, b) => b.localeCompare(a));
  }, [historyAuditsRaw, todayStr]);
  
  const filteredHistory = useMemo(() => {
    return historyAuditsRaw.filter(h => selectedYear === 'ALL' || (h.archivedAt || '').startsWith(selectedYear));
  }, [historyAuditsRaw, selectedYear]);
  
  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const paginatedHistory = filteredHistory.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage);
  
  const isOrgAllowed = (targetDepts: string[], userDeptName: string) => {
    if (targetDepts.includes('전사')) return true;
    if (targetDepts.includes(userDeptName)) return true;
    let currentUnit = units.find(u => u.unit_name === userDeptName);
    while (currentUnit && currentUnit.parent_id) {
      const parentUnit = units.find(u => u.id === currentUnit.parent_id);
      if (parentUnit && targetDepts.includes(parentUnit.unit_name)) return true;
      currentUnit = parentUnit;
    }
    return false;
  };
  
  const saveAuditPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { id, createdAt, updatedAt, responses, ...submitData } = editModal;
      if (id.startsWith('NEW_')) {
        await fetch('/api/asset/it/audit', { method: 'POST', body: JSON.stringify(submitData) });
      } else {
        await fetch('/api/asset/it/audit', { method: 'PATCH', body: JSON.stringify({ id, ...submitData }) });
      }
      setEditModal(null);
      fetchAuditData();
      alert('✅ 실사 계획이 저장되었습니다.');
    } catch (error) { alert('❌ 저장 중 오류가 발생했습니다.'); }
  };
  
  const handleStatusChange = async (id: string, action: 'PUBLISH' | 'STOP' | 'CLOSE' | 'ARCHIVE' | 'RESTORE' | 'DELETE') => {
    if (action === 'DELETE') {
      if (!isLV1) return alert('데이터 영구 삭제는 최고 관리자(LV_1) 권한이 필요합니다.');
      if (!confirm('🚨 경고: 이 실사 이력을 영구적으로 삭제하시겠습니까? 데이터 복구가 불가능합니다.')) return;
      await fetch(`/api/asset/it/audit?id=${id}`, { method: 'DELETE' });
      fetchAuditData();
      return;
    }
  
    let patchData: any = { id };
    if (action === 'PUBLISH') patchData = { id, status: '진행중', postDate: todayStr };
    if (action === 'STOP') patchData = { id, status: '게시중단' };
    if (action === 'CLOSE') {
      if (!confirm("실사 운영을 강제로 마감하시겠습니까?")) return;
      patchData = { id, status: '마감' };
    }
    if (action === 'ARCHIVE') patchData = { id, status: '보관됨', archivedAt: todayStr };
    if (action === 'RESTORE') {
      if (!confirm("선택한 이력을 현황판(운영 리스트)으로 복구하시겠습니까?")) return;
      patchData = { id, status: '마감' }; 
    }
  
    try {
      await fetch('/api/asset/it/audit', { method: 'PATCH', body: JSON.stringify(patchData) });
      fetchAuditData();
    } catch(err) { alert('상태 변경 실패'); }
  };
  
  const handleCopyUnsubmittedEmails = (audit: any, unsubmittedUsers: any[]) => {
    if (unsubmittedUsers.length === 0) return alert('현재 미참여자가 없습니다.');
    const emails = unsubmittedUsers.map(u => u.email).join(', ');
    navigator.clipboard.writeText(emails);
    alert(`미참여자 ${unsubmittedUsers.length}명의 이메일이 클립보드에 복사되었습니다.\n(메일 클라이언트의 '받는 사람' 란에 바로 붙여넣기 하세요.)`);
  };
  
// 🚀 src/components/asset/it/AuditModule.tsx 내부의 executeNudgeAndSync 함수 전체 교체
const executeNudgeAndSync = async () => {
  if (!nudgeModal) return;
  const { targetUsers } = nudgeModal; 
  
  // 백엔드 정합성을 위해 이메일과 이름을 동시에 추출
  const unsubmittedEmails = targetUsers.map((u: any) => u.email);
  const unsubmittedNames = targetUsers.map((u: any) => u.name);
  
  try {
    const res = await fetch('/api/asset/it/requests', { 
      method: 'PATCH', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id: 'NUDGE_ACTION', 
        action: 'NUDGE', 
        emails: unsubmittedEmails, 
        names: unsubmittedNames, 
        date: todayStr 
      }) 
    });

    if (res.ok) {
      alert(`✅ ${targetUsers.length}명의 미참여자에게 독촉 알람이 발송되었으며,\n마스터 대시보드의 상태가 '실사독촉전달'로 즉시 변경되었습니다.`);
      fetchAuditData();
    } else {
      alert("⚠️ 서버 기록 중 오류가 발생했습니다.");
    }
  } catch(e) {
    console.error("Nudge API Error:", e);
    alert("❌ 네트워크 통신 오류가 발생했습니다.");
  }
  setNudgeModal(null);
};
  
  const handleDownloadExcel = () => {
    const target = selectedHistoryIds.size > 0 ? filteredHistory.filter(h => selectedHistoryIds.has(h.id)) : filteredHistory;
    if (target.length === 0) return alert("추출할 데이터가 없습니다.");
    
    const ws = XLSX.utils.json_to_sheet(target.map((h, i) => ({
      'NO': i + 1, '종료일': h.archivedAt, '실사명': h.title, '대상': h.target, '기간': `${h.startDate} ~ ${h.endDate}`, '상태': h.status
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "실사이력");
    XLSX.writeFile(wb, `IT자산_실사이력_${selectedYear}.xlsx`);
  };
  
  const handleDownloadZip = async () => {
    const target = selectedHistoryIds.size > 0 ? filteredHistory.filter(h => selectedHistoryIds.has(h.id)) : filteredHistory;
    if (target.length === 0) return alert("추출할 데이터가 없습니다.");
    
    const zip = new JSZip();
    target.forEach(h => {
      const content = `■ 실사명: ${h.title}\n■ 대상: ${h.target}\n■ 기간: ${h.startDate} ~ ${h.endDate}\n■ 종료일: ${h.archivedAt}\n\n[실사 내용 요약]\n${h.description}`;
      zip.file(`실사요약_${h.title.replace(/[/\\?%*:|"<>]/g, '-')}.txt`, "\ufeff" + content);
    });
  
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `실사이력_데이터모음_${todayStr}.zip`);
  };
  
  if (loading) return <LoadingState />;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* 🚀 딥 에메랄드 테마 기반 IT 마스터 실사 관제 배너 */}
<div className="w-full bg-teal-950 border border-teal-850 p-6 rounded-[2.5rem] text-white shadow-lg relative overflow-hidden flex flex-col justify-center min-h-[140px] mb-6">
  <div className="flex items-center justify-between relative z-10 w-full">
    <div>
      {/* 1. 상단 라벨 (마스터 컬러 매칭 text-teal-400) */}
      <p className="text-[10px] font-black uppercase tracking-widest text-teal-400 mb-2">
        IT Asset Audit Control Hub
      </p>
      
      {/* 2. 메인 타이틀 */}
      <h2 className="text-2xl font-black tracking-tight text-white leading-none">
        IT 자산 정기 실사 관제 센터
      </h2>
      
      {/* 3. 하단 설명 (간격 mt-4 표준화 및 선명도 조절) */}
      <p className="text-teal-200/80 text-xs font-semibold mt-4 opacity-95">
        신규 실사 계획 수립 및 실시간 참여 현황을 통합 관리합니다.
      </p>
    </div>
    
    {/* 🚀 우측 액션 버튼 (기존 기능 백프로 유지 및 활성 스케일 보정) */}
    <div className="flex items-center gap-2 shrink-0">
      <button 
        type="button"
        onClick={() => setEditModal({ id: `NEW_${Date.now()}`, title: '', description: '', target: '전사', startDate: todayStr, endDate: todayStr, status: '작성중' })} 
        className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-black text-xs shadow-md transition-all active:scale-95 whitespace-nowrap"
      >
        + 신규 실사 계획 수립
      </button>
    </div>
  </div>
</div>

{/* 🚀 URL 기반 4버튼 동적 탭 네비게이션 (IT 마스터 컴패니언 킷 표준 장착) */}
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
  
      {/* 진행 중 현황판 */}
      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center gap-2">
           <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
           <h2 className="text-sm font-black text-slate-800 tracking-tight">운영 중인 실사 현황 (Active)</h2>
           <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{activeAudits.length}건</span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[1550px]">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-6 w-[50px] text-center">NO</th>
                <th className="h-12 px-2 w-[90px] text-center whitespace-nowrap">게시일</th>
                <th className="h-12 px-4 min-w-[250px] max-w-[300px]">실사명 / 내용 요약</th>
                <th className="h-12 px-2 w-[80px] text-center whitespace-nowrap">대상범위</th>
                <th className="h-12 px-2 w-[140px] text-center whitespace-nowrap">실사 운영 기간</th>
                <th className="h-12 px-2 w-[70px] text-center border-l border-slate-200 whitespace-nowrap">참여율</th>
                <th className="h-12 px-2 w-[80px] text-center text-indigo-600 bg-indigo-50/50 whitespace-nowrap">접수완료</th>
                <th className="h-12 px-2 w-[180px] text-center text-red-600 bg-red-50/50 whitespace-nowrap">미접수 관리 (독촉)</th>
                <th className="h-12 px-2 w-[80px] text-center border-r border-slate-200 whitespace-nowrap">상태</th>
                <th className="h-12 px-2 w-[160px] text-center whitespace-nowrap">배포 링크 (QR)</th>
                <th className="h-12 pr-6 w-[180px] text-center whitespace-nowrap">관리 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {activeAudits.length === 0 ? <tr><td colSpan={11} className="py-12 text-center text-slate-400">운영 중인 실사가 없습니다.</td></tr> : activeAudits.map((a, idx) => {
                const targetDepts = a.target.split(',').map((t: string) => t.trim());
                const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
                
                const auditResponses = a.responses || [];
                const done = targetUsers.filter(u => auditResponses.some((r: any) => r.userEmail === u.email && r.isDone)).length;
                const total = targetUsers.length;
                const notDone = total - done;
                const rate = total > 0 ? Math.round((done / total) * 100) : 0;
                
                const unsubmittedUsers = targetUsers.filter(u => !auditResponses.some((r: any) => r.userEmail === u.email && r.isDone));
                const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
                const publicLink = `${BASE_URL}/audit/public/${a.id}`;
  
                return (
                  <tr key={a.id} className="h-16 hover:bg-slate-50/50 transition-colors">
                    <td className="pl-6 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-2 text-center font-mono text-slate-500 whitespace-nowrap">{a.postDate || '-'}</td>
                    <td className="px-4 max-w-[250px]">
                      <div className="font-black text-slate-900 truncate" title={a.title}>{a.title}</div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5" title={a.description}>{a.description}</div>
                    </td>
                    <td className="px-2 text-center text-slate-600 whitespace-nowrap">{a.target === '전사' ? '전사' : `${a.target.split(',').length}개 부서`}</td>
                    <td className="px-2 text-center text-slate-500 font-mono tracking-tighter text-[10px] whitespace-nowrap"><div>{a.startDate} ~</div><div>{a.endDate}</div></td>
                    <td className="px-2 text-center font-black text-slate-800 border-l border-slate-100 whitespace-nowrap">{rate}%</td>
                    <td className="px-2 text-center font-black text-indigo-600 bg-indigo-50/20 whitespace-nowrap">{done}명</td>
                    <td className="px-2 text-center bg-red-50/20">
                      <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                        <span className="font-black text-red-500 w-8 text-right shrink-0">{notDone}명</span>
                        {a.status === '진행중' && notDone > 0 && (
                          <div className="flex gap-1">
                            <button onClick={() => setNudgeModal({ id: a.id, count: notDone, title: a.title, targetUsers: unsubmittedUsers })} className="px-2 py-1 bg-white border border-red-200 text-red-600 rounded-lg text-[10px] font-black hover:bg-red-50 transition-colors whitespace-nowrap">🔔 독촉</button>
                            <button onClick={() => handleCopyUnsubmittedEmails(a, unsubmittedUsers)} className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-colors whitespace-nowrap">📧 메일추출</button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-2 text-center border-r border-slate-100 whitespace-nowrap"><span className={`px-2 py-1 rounded-md text-[10px] ${a.status === '진행중' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>{a.status}</span></td>
                    <td className="px-2">
                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1.5">
                        <input type="text" readOnly value={publicLink} className="w-full text-[9px] font-mono text-slate-500 outline-none bg-transparent" />
                        <button onClick={() => { navigator.clipboard.writeText(publicLink); alert('배포 링크가 복사되었습니다.'); }} className="px-2 py-1 bg-white border border-slate-200 text-slate-700 rounded text-[9px] font-black shrink-0 hover:bg-slate-100 whitespace-nowrap">복사</button>
                      </div>
                    </td>
                    <td className="pr-6 text-center">
                      <div className="flex justify-center gap-1.5 whitespace-nowrap">
                        {a.status === '작성중' || a.status === '게시중단' ? (
                          <>
                            <button onClick={() => handleStatusChange(a.id, 'PUBLISH')} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] hover:bg-indigo-700">배포</button>
                            <button onClick={() => setEditModal(a)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] hover:bg-slate-50">수정</button>
                          </>
                        ) : a.status === '진행중' ? (
                          <>
                            <button onClick={() => setEditModal(a)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] hover:bg-slate-50">수정</button>
                            <button onClick={() => handleStatusChange(a.id, 'STOP')} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] hover:bg-slate-50">중단</button>
                            <button onClick={() => handleStatusChange(a.id, 'CLOSE')} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] hover:bg-emerald-700">마감</button>
                          </>
                        ) : (
                          <button onClick={() => handleStatusChange(a.id, 'ARCHIVE')} className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-[10px] w-full hover:bg-slate-700">보관함 이동</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
  
      {/* 이력 보관함 */}
      <div className="mt-6 bg-slate-800 text-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden transition-all duration-300">
        <div className="p-4 px-6 bg-slate-900/50 border-b border-slate-700 flex items-center justify-between cursor-pointer" onClick={() => setIsHistoryOpen(!isHistoryOpen)}>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-400"></div>
            <h2 className="text-sm font-black text-white tracking-tight">실사 종료 이력 (Archive)</h2>
            <span className="text-[11px] font-bold bg-slate-700 text-slate-300 px-2 py-0.5 rounded-md">{filteredHistory.length}건</span>
            <span className="text-xs ml-2 text-slate-400 font-bold bg-slate-700/50 px-2 py-0.5 rounded-lg hover:bg-slate-700 hover:text-white">{isHistoryOpen ? '▲ 접기' : '▼ 펼치기'}</span>
          </div>
  
          <div onClick={e => e.stopPropagation()} className="flex items-center gap-2">
            <select value={selectedYear} onChange={(e) => { setSelectedYear(e.target.value); setHistoryPage(1); }} className="text-[11px] font-bold bg-slate-700 text-white border border-slate-600 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-slate-500">
              <option value="ALL">전체 내역 보기</option>
              {availableYears.map(y => <option key={y} value={y} className="bg-slate-800">{y}년도</option>)}
            </select>
            <button onClick={handleDownloadZip} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-500 shadow-sm transition-colors flex items-center gap-1"><span>📥</span> 선택 ZIP 다운로드</button>
            <button onClick={handleDownloadExcel} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-bold hover:bg-emerald-500 shadow-sm transition-colors flex items-center gap-1"><span>📈</span> 선택 엑셀 다운로드</button>
          </div>
        </div>
  
        {isHistoryOpen && (
          <div className="overflow-x-auto bg-white text-slate-700 animate-in slide-in-from-top-2 duration-200">
            <table className="w-full text-left border-collapse min-w-[1400px]">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-6 w-[60px] text-center">
                    <input type="checkbox" checked={selectedHistoryIds.size === paginatedHistory.length && paginatedHistory.length > 0} onChange={(e) => { if (e.target.checked) setSelectedHistoryIds(new Set(paginatedHistory.map(h => h.id))); else setSelectedHistoryIds(new Set()); }} className="accent-indigo-600 w-3.5 h-3.5 cursor-pointer rounded" />
                  </th>
                  <th className="h-12 px-2 w-[100px] text-center">게시일</th>
                  <th className="h-12 px-4 min-w-[300px]">실사명 / 내용 요약</th>
                  <th className="h-12 px-2 w-[90px] text-center">대상범위</th>
                  <th className="h-12 px-2 w-[150px] text-center">실사 운영 기간</th>
                  <th className="h-12 px-2 w-[80px] text-center border-l border-slate-200">참여율</th>
                  <th className="h-12 px-2 w-[90px] text-center text-indigo-600 bg-indigo-50/50">접수완료</th>
                  <th className="h-12 px-2 w-[100px] text-center text-red-600 bg-red-50/50">미접수</th>
                  <th className="h-12 px-2 w-[80px] text-center border-r border-slate-200">상태</th>
                  <th className="h-12 pr-6 w-[160px] text-center">관리 액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedHistory.length === 0 ? <tr><td colSpan={10} className="py-12 text-center text-slate-400">데이터가 없습니다.</td></tr> : paginatedHistory.map((h) => {
                  const targetDepts = h.target.split(',').map((t: string) => t.trim());
                  const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
                  const auditResponses = h.responses || [];
                  const done = targetUsers.filter(u => auditResponses.some((r: any) => r.userEmail === u.email && r.isDone)).length;
                  const total = targetUsers.length;
                  const notDone = total - done;
                  const rate = total > 0 ? Math.round((done / total) * 100) : 0;
  
                  return (
                    <tr key={h.id} className="h-16 hover:bg-slate-50/50 transition-colors">
                      <td className="pl-6 text-center"><input type="checkbox" checked={selectedHistoryIds.has(h.id)} onChange={(e) => { const next = new Set(selectedHistoryIds); e.target.checked ? next.add(h.id) : next.delete(h.id); setSelectedHistoryIds(next); }} className="accent-indigo-600 w-3.5 h-3.5 cursor-pointer rounded" /></td>
                      <td className="px-2 text-center font-mono text-slate-500">{h.postDate || '-'}</td>
                      <td className="px-4">
                        <div className="font-black text-slate-900 truncate">{h.title}</div>
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">{h.description}</div>
                      </td>
                      <td className="px-2 text-center text-slate-600">{h.target === '전사' ? '전사' : `${h.target.split(',').length}개 부서`}</td>
                      <td className="px-2 text-center text-slate-500 font-mono tracking-tighter text-[10px]"><div>{h.startDate} ~</div><div>{h.endDate}</div></td>
                      <td className="px-2 text-center font-black text-slate-800 border-l border-slate-100">{rate}%</td>
                      <td className="px-2 text-center font-black text-indigo-600 bg-indigo-50/20">{done}명</td>
                      <td className="px-2 text-center font-black text-red-500 bg-red-50/20">{notDone}명</td>
                      <td className="px-2 text-center border-r border-slate-100"><span className="px-2 py-1 rounded-md text-[10px] bg-slate-200 text-slate-600">{h.status}</span></td>
                      <td className="pr-6 text-center">
                        <div className="flex justify-center gap-1.5">
                          <button onClick={() => handleStatusChange(h.id, 'RESTORE')} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-[10px] hover:bg-slate-800 hover:text-white transition-colors">🔄 복구</button>
                          {isLV1 && (
                            <button onClick={() => handleStatusChange(h.id, 'DELETE')} className="px-3 py-1.5 bg-white border border-red-200 text-red-500 rounded-lg text-[10px] hover:bg-red-50 transition-colors">🗑️ 삭제</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            {totalHistoryPages > 1 && (
              <div className="flex justify-center items-center gap-1.5 pt-4 pb-4 border-t border-slate-100 bg-white">
                <button disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
                {Array.from({ length: totalHistoryPages }).map((_, i) => (
                  <button key={i} onClick={() => setHistoryPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${historyPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
                ))}
                <button disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
              </div>
            )}
          </div>
        )}
      </div>
  
      {/* 모달 영역 */}
      {editModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] rounded-[2.5rem] overflow-hidden shadow-2xl">
            <div className="p-6 bg-slate-900 text-white flex justify-between items-center"><h3 className="font-black text-sm">실사 계획 수립</h3><button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-white">✕</button></div>
            <form onSubmit={saveAuditPlan} className="p-8 space-y-5 bg-slate-50">
              <div><label className="text-[11px] font-black text-slate-500 uppercase">실사 제목</label><input required type="text" value={editModal.title} onChange={e => setEditModal({...editModal, title: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-black outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
              <div><label className="text-[11px] font-black text-slate-500 uppercase">상세 설명</label><textarea required value={editModal.description} onChange={e => setEditModal({...editModal, description: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 mt-1 min-h-[80px] shadow-sm" /></div>
              <div><label className="text-[11px] font-black text-slate-500 uppercase block mb-1">대상 부서</label><select value={editModal.target} onChange={e => setEditModal({...editModal, target: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 shadow-sm"><option value="전사">전사 (전체 부서)</option>{units.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[11px] font-black text-slate-500 uppercase">시작일</label><input required type="date" value={editModal.startDate} onChange={e => setEditModal({...editModal, startDate: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
                <div><label className="text-[11px] font-black text-slate-500 uppercase">종료일</label><input required type="date" value={editModal.endDate} onChange={e => setEditModal({...editModal, endDate: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
              </div>
              <div className="pt-4 flex gap-2 border-t border-slate-200 mt-4">
                <button type="button" onClick={() => setEditModal(null)} className="flex-1 py-3.5 bg-white border border-slate-200 rounded-xl font-black text-slate-600 text-xs hover:bg-slate-50">취소</button>
                <button type="submit" className="flex-[2] py-3.5 bg-indigo-600 text-white rounded-xl font-black text-xs shadow-md hover:bg-indigo-700">저장하기</button>
              </div>
            </form>
          </div>
        </div>
      )}
  
      {nudgeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-[400px] rounded-[2.5rem] overflow-hidden shadow-2xl p-8 text-center">
            <div className="text-5xl mb-4">🔔</div>
            <h3 className="font-black text-lg text-slate-800 mb-2">미참여 인원 독촉 및 동기화</h3>
            <p className="text-xs text-slate-500 font-bold mb-8 leading-relaxed">
              [{nudgeModal.title}] 실사에 참여하지 않은 <br/><span className="text-red-500 text-sm">{nudgeModal.count}명</span>에게 알림을 발송하고 <br/>
              <span className="text-indigo-600 bg-indigo-50 px-1 rounded">마스터 대시보드</span>에 독촉 일자를 자동 기록합니다.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setNudgeModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-xs hover:bg-slate-200">취소</button>
              <button onClick={executeNudgeAndSync} className="flex-[2] py-3 bg-red-500 text-white rounded-xl font-black text-xs shadow-md hover:bg-red-600">발송 및 기록</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}