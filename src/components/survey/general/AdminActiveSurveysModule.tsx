'use client';
     
import React, { useState, useMemo, useEffect, Fragment } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx'; 
     
const MOCK_SURVEYS = [
  { 
    id: 'S001', 
    code: 'SRV-001', 
    postNumber: 101, 
    title: '2026년 상반기 조직문화 진단', 
    type: '선택형+자유응답', 
    isAnonymous: true,
    target: '전사', 
    postDate: '2026-04-20', 
    startDate: '2026-04-20', 
    endDate: '2026-04-28', 
    status: '진행중', 
    description: '2026년 상반기 전사 조직문화 진단을 위한 설문입니다.',
    hasBeenPublished: true
  }
];
     
export default function ActiveSurveysAdminPage() {
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [deptList, setDeptList] = useState<string[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  
  const [surveyListFilter, setSurveyListFilter] = useState<'ALL' | 'ONGOING' | 'CLOSING_TODAY'>('ALL');
  const [matrixUserFilter, setMatrixUserFilter] = useState<{surveyId: string, type: 'DONE' | 'NOT_DONE' | 'ALL'}>({surveyId: '', type: 'ALL'});
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [selectedSurveyIds, setSelectedSurveyIds] = useState<Set<string>>(new Set());
  
  const [editModal, setEditModal] = useState<any | null>(null);
  const [previewModal, setPreviewModal] = useState<any | null>(null);
  const [nudgeModal, setNudgeModal] = useState<{surveyId: string, title: string, count: number} | null>(null);
     
  useEffect(() => {
    // 🚀 L4PanelRenderer가 이미 권한 검증을 마쳤으므로, 순수하게 관리자 관제에 필요한 데이터만 동기화합니다.
    const fetchOrgData = async () => {
      try {
        const storedSurveys = localStorage.getItem('admin_surveys_db');
        if (storedSurveys) setSurveys(JSON.parse(storedSurveys));
        else {
          setSurveys(MOCK_SURVEYS);
          localStorage.setItem('admin_surveys_db', JSON.stringify(MOCK_SURVEYS));
        }
     
        const ts = Date.now();
        const [uRes, unitRes] = await Promise.all([ 
            fetch(`/api/admin/users?t=${ts}`, { cache: 'no-store' }), 
            fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }) 
        ]);
        
        if (uRes.ok && unitRes.ok) {
          const uData = await uRes.json();
          const unitData = await unitRes.json();
          setUnitsList(unitData);
          
          const activeDepts = unitData.map((u:any) => u.unit_name);
          setDeptList(activeDepts);
     
          const mappedUsers = (uData.users || []).map((u:any) => ({ 
            ...u, 
            dept: unitData.find((un:any) => un.id === u.unit_id)?.unit_name || '소속없음' 
          }));
          setUsers(mappedUsers);
     
          const realRes: Record<string, any> = {};
          mappedUsers.forEach((u:any) => {
            if (!u.email) return;
            const stored = localStorage.getItem(`db_my_responses_${u.email}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              Object.keys(parsed).forEach(surveyId => {
                realRes[`${surveyId}_${u.email}`] = {
                  isDone: true,
                  date: parsed[surveyId].submittedAt.split(' ')[0],
                  result: '제출완료',
                  answers: parsed[surveyId].answers
                };
              });
            }
          });
          setResponses(realRes);
        }
      } catch (error) { 
        console.error("Admin Survey 관제 데이터 로드 실패:", error); 
      } finally { 
        setLoading(false); 
      }
    };
    fetchOrgData();
  }, []);
     
  useEffect(() => {
    if (surveys.length > 0) localStorage.setItem('admin_surveys_db', JSON.stringify(surveys));
  }, [surveys]);
     
  const todayStr = new Date().toISOString().split('T')[0];
  const stats = useMemo(() => ({
    activeCount: surveys.filter(s => s.status === '진행중').length,
    closingTodayCount: surveys.filter(s => s.status === '진행중' && s.endDate === todayStr).length,
  }), [surveys, todayStr]);
     
  const sortedSurveys = useMemo(() => [...surveys].sort((a, b) => a.postNumber - b.postNumber), [surveys]);
  
  const filteredSurveys = useMemo(() => {
    let list = sortedSurveys;
    if (surveyListFilter === 'ONGOING') list = list.filter(s => s.status === '진행중');
    else if (surveyListFilter === 'CLOSING_TODAY') list = list.filter(s => s.status === '진행중' && s.endDate === todayStr);
    else list = list.filter(s => s.status !== '보관됨');
    return list;
  }, [sortedSurveys, surveyListFilter, todayStr]);
     
  const groupedUsers = useMemo(() => {
    const groups: Record<string, any[]> = {};
    users.forEach(u => {
      if (!groups[u.dept]) groups[u.dept] = [];
      groups[u.dept].push(u);
    });
    return groups;
  }, [users]);
     
  const toggleDept = (dept: string) => {
    const next = new Set(collapsedDepts);
    next.has(dept) ? next.delete(dept) : next.add(dept);
    setCollapsedDepts(next);
  };
  
  const collapseAll = () => setCollapsedDepts(new Set(Object.keys(groupedUsers)));
  const expandAll = () => {
    setCollapsedDepts(new Set());
    setMatrixUserFilter({ surveyId: '', type: 'ALL' }); 
  };
     
  const isOrgAllowed = (targetDepts: string[], userDeptName: string) => {
    if (targetDepts.includes('전사')) return true;
    if (targetDepts.includes(userDeptName)) return true;
    
    let currentUnit = unitsList.find(u => u.unit_name === userDeptName);
    while (currentUnit && currentUnit.parent_id) {
      const parentUnit = unitsList.find(u => u.id === currentUnit.parent_id);
      if (parentUnit && targetDepts.includes(parentUnit.unit_name)) return true;
      currentUnit = parentUnit;
    }
    return false;
  };
     
  const toggleTarget = (dept: string) => {
    const currentTargets = editModal.target.split(',').map((s:string) => s.trim()).filter(Boolean);
    let nextTargets = new Set(currentTargets);
    if (dept === '전사') nextTargets = new Set(['전사']);
    else {
      nextTargets.delete('전사');
      nextTargets.has(dept) ? nextTargets.delete(dept) : nextTargets.add(dept);
      if (nextTargets.size === 0) nextTargets.add('전사'); 
    }
    setEditModal({...editModal, target: Array.from(nextTargets).join(', ')});
  };
     
  const handleAddSurvey = () => {
    const nextPostNumber = surveys.length > 0 ? Math.max(...surveys.map(s => s.postNumber)) + 1 : 101;
    setEditModal({ 
      id: `S_${Date.now()}`, 
      code: `SRV-NEW-${Date.now().toString().slice(-4)}`, 
      postNumber: nextPostNumber, 
      title: '새로운 설문', 
      description: '', 
      type: '선택형', 
      isAnonymous: false,
      target: '전사', 
      postDate: todayStr, 
      startDate: todayStr, 
      endDate: todayStr, 
      status: '게시전',
      hasBeenPublished: false
    });
  };
     
  const handleDeleteSurvey = (id: string) => {
    if (!confirm('이 설문을 삭제하시겠습니까?')) return;
    setSurveys(prev => prev.filter(s => s.id !== id));
  };
     
  const handleStatusChange = (id: string, action: 'UP' | 'DOWN' | 'ARCHIVE' | 'FORCE_COMPLETE') => {
    setSurveys(prev => prev.map(s => {
      if (s.id !== id) return s;
      if (action === 'UP') return { ...s, status: '진행중', postDate: todayStr, hasBeenPublished: true };
      if (action === 'DOWN') return { ...s, status: '게시중단' };
      if (action === 'FORCE_COMPLETE') {
        if(!confirm("이 설문을 즉시 강제 종료(완료) 처리하시겠습니까?")) return s;
        return { ...s, status: '완료' };
      }
      if (action === 'ARCHIVE') { alert('보관함으로 이동되었습니다.'); return { ...s, status: '보관됨' }; }
      return s;
    }));
  };
     
  const handleNudge = (surveyId: string) => {
    const survey = surveys.find(s => s.id === surveyId);
    const targetDepts = survey.target.split(',').map((t:string) => t.trim());
    const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
    const notDoneUsers = targetUsers.filter(u => !responses[`${surveyId}_${u.email}`]?.isDone);
    if (notDoneUsers.length === 0) return alert('모든 인원이 참여를 완료했습니다!');
    setNudgeModal({ surveyId, title: survey.title, count: notDoneUsers.length });
  };
     
  const handleSavePreview = () => {
    setSurveys(prev => prev.map(s => s.id === previewModal.id ? previewModal : s));
    alert('✅ 기본 정보가 수정되었습니다.');
    setPreviewModal(null);
  };
     
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetNames = editModal.target.split(',').map((s:string) => s.trim()).filter(Boolean);
    let expandedDepts = ['전사'];
    
    if (!targetNames.includes('전사')) {
      const result = new Set<string>();
      const addSubDepts = (parentId: string) => {
        unitsList.filter(u => u.parent_id === parentId).forEach(u => {
          result.add(u.unit_name);
          addSubDepts(u.id);
        });
      };
      unitsList.forEach(u => {
        if (targetNames.includes(u.unit_name)) {
          result.add(u.unit_name);
          addSubDepts(u.id);
        }
      });
      expandedDepts = Array.from(result);
    }
    
    const finalEditData = { ...editModal, allowedDepts: expandedDepts };
    if (surveys.find(s => s.id === finalEditData.id)) {
      setSurveys(prev => prev.map(s => s.id === finalEditData.id ? finalEditData : s));
      alert('✅ 게시 정보가 수정되었습니다.');
    } else {
      setSurveys(prev => [...prev, finalEditData]); 
      alert('✅ 새로운 설문이 추가되었습니다.');
    }
    setEditModal(null);
  };
     
  const handleMatrixFilter = (surveyId: string, type: 'DONE' | 'NOT_DONE') => {
    setMatrixUserFilter({ surveyId, type });
    setCollapsedDepts(new Set()); 
  };
     
// AdminActiveSurveysModule.tsx 내부의 handleExportAnalysisAll 함수 교체
const handleExportAnalysisAll = () => {
  if (selectedSurveyIds.size === 0) return alert('분석할 설문을 하나 이상 선택해주세요.');
  const selectedSurveys = surveys.filter(s => selectedSurveyIds.has(s.id));
  const wb = XLSX.utils.book_new();
  let hasData = false;
    
  selectedSurveys.forEach(survey => {
    // 🚀 빌더의 고도화된 객체 정보(설명, 외부링크, 파일양식) 온전하게 로드
    const storedQuestions = JSON.parse(localStorage.getItem(`survey_builder_${survey.id}`) || '[]');
    const questions = storedQuestions.length > 0 ? storedQuestions : [{ id: 'q1', title: '1. 의견 및 건의사항' }];
    
    const targetDepts = survey.target.split(',').map((t:string) => t.trim());
    const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
    const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
    
    if (submittedUsers.length > 0) {
      hasData = true;
      
      const deptRow = ['제출조직(부서)', ...submittedUsers.map((u, i) => survey.isAnonymous ? '익명조직' : u.dept)];
      const nameRow = ['제출자이름', ...submittedUsers.map((u, i) => survey.isAnonymous ? `익명응답자 ${i + 1}` : u.name)];
      const dateRow = ['제출일자', ...submittedUsers.map(u => responses[`${survey.id}_${u.email}`]?.date || '-')];
      
      // 🚀 객체 파싱 버그 수정 존: 데이터가 단순 문자열이든 객체이든 안전하게 파싱하도록 인터셉터 장착
      const contentRows = questions.map((q: any) => {
        // 섹션 타입은 엑셀 셀 행에서 가독성을 위해 명시 처리
        if (q.type === 'SECTION') return [`[🔖 섹션 단락]: ${q.title}`];

        const rowData = [q.title];
        submittedUsers.forEach(u => {
          const ans = responses[`${survey.id}_${u.email}`]?.answers;
          if (!ans || !ans[q.id]) rowData.push('(미응답)');
          else {
            const a = ans[q.id];
            // 파일형 패키지 오브젝트인지, 단순 선택지 텍스트 어레이인지 정밀 분류
            if (a && typeof a === 'object' && a.fileName) {
              rowData.push(`[첨부파일] ${a.fileName}`);
            } else {
              rowData.push(Array.isArray(a) ? a.join(', ') : String(a));
            }
          }
        });
        return rowData;
      });
    
      const ws = XLSX.utils.aoa_to_sheet([deptRow, nameRow, dateRow, ...contentRows]);
      const safeTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
      XLSX.utils.book_append_sheet(wb, ws, safeTitle);
    }
  });
    
  if (!hasData) return alert('선택한 설문에 제출된 응답이 없습니다.');
  XLSX.writeFile(wb, `[조직별_상세분석엑셀]_${new Date().toISOString().split('T')[0]}.xlsx`);
};
     
  const handleDownloadZipAll = async () => {
    if (selectedSurveyIds.size === 0) return alert('다운로드할 설문을 하나 이상 선택해주세요.');
    const zip = new JSZip();
    const selectedSurveys = surveys.filter(s => selectedSurveyIds.has(s.id));
    let hasData = false;
      
    selectedSurveys.forEach(survey => {
      const safeFolderTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-');
      const folder = zip.folder(safeFolderTitle); 
      
      const storedQuestions = JSON.parse(localStorage.getItem(`survey_builder_${survey.id}`) || '[]');
      const targetDepts = survey.target.split(',').map((t:string) => t.trim());
      const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
      
      targetUsers.forEach((user, idx) => {
        const resp = responses[`${survey.id}_${user.email}`];
        if (resp?.isDone) {
          hasData = true;
          const identifier = survey.isAnonymous ? `익명응답자_${idx + 1}` : `${user.dept}_${user.name}`;
          const fileNameBase = `${identifier}_${safeFolderTitle}`; 
      
          let content = `■ 설문명: ${survey.title}\n■ 제출자: ${survey.isAnonymous ? '익명' : user.dept + ' ' + user.name}\n■ 제출일: ${resp.date}\n------------------------------------------\n\n`;
          
          storedQuestions.forEach((q: any, i: number) => {
             content += `Q${i+1}. ${q.title}\n`;
             const ans = resp.answers ? resp.answers[q.id] : null;
             if (ans && ans.fileName) {
                 content += `A. [첨부파일] ${ans.fileName}\n\n`;
                 if (ans.fileData) {
                     const base64Data = ans.fileData.split(',')[1];
                     folder?.file(`${identifier}_${ans.fileName}`, base64Data, {base64: true});
                 }
             } else {
                 content += `A. ${Array.isArray(ans) ? ans.join(', ') : (ans || '미답변')}\n\n`;
             }
          });
          folder?.file(`${fileNameBase}_응답요약.txt`, "\ufeff" + content); 
        }
      });
    });
      
    if (!hasData) return alert('선택한 설문에 제출된 응답이 없습니다.');
    alert('데이터를 추출하고 압축 중입니다. 잠시만 기다려주세요...');
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `[통합응답결과]_${new Date().toISOString().split('T')[0]}.zip`);
  };
     
  const getStatusBadge = (status: string) => {
    switch (status) {
      case '게시전': return 'bg-slate-100 text-slate-500 border border-slate-200';
      case '게시중단': return 'bg-amber-100 text-amber-700';
      case '진행중': return 'bg-blue-100 text-blue-700';
      case '완료': return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-slate-100 text-slate-500';
    }
  };
     
  if (loading) return <div className="p-20 text-center font-black text-blue-600 animate-pulse text-xl uppercase tracking-widest">설문 관제 모듈 동기화 중...</div>;

  return (
    <div className="space-y-6 font-sans text-slate-900 text-[11px] animate-fade-in pb-20 pt-8 px-2">
      
      {/* 요약 대시 배너 */}
      <div className="flex gap-6 w-full">
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'ONGOING' ? 'ALL' : 'ONGOING')} className={`flex-1 p-5 rounded-3xl border transition-all flex items-center justify-between ${surveyListFilter === 'ONGOING' ? 'border-blue-400 bg-blue-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-blue-300'}`}>
          <div className="flex items-center gap-5">
            <span className="text-3xl opacity-80 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">📝</span>
            <div className="text-left">
              <p className="text-[11px] font-black text-blue-600 uppercase mb-1">진행 중인 조사</p>
              <p className="text-2xl font-black text-slate-800">{stats.activeCount} <span className="text-sm font-bold text-slate-500">건</span></p>
            </div>
          </div>
        </button>
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'CLOSING_TODAY' ? 'ALL' : 'CLOSING_TODAY')} className={`flex-1 p-5 rounded-3xl border transition-all flex items-center justify-between ${surveyListFilter === 'CLOSING_TODAY' ? 'border-red-400 bg-red-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-red-300'}`}>
          <div className="flex items-center gap-5">
            <span className="text-3xl opacity-80 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">⏰</span>
            <div className="text-left">
              <p className="text-[11px] font-black text-red-600 uppercase mb-1">오늘 마감 조사</p>
              <p className="text-2xl font-black text-slate-800">{stats.closingTodayCount} <span className="text-sm font-bold text-slate-500">건</span></p>
            </div>
          </div>
        </button>
      </div>
      
      {/* 설문 관리 데이터 테이블 대장 */}
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden mt-8">
        <div className="p-4 px-6 bg-slate-900 flex justify-between items-center text-white">
          <h3 className="text-[12px] font-black flex items-center gap-2"><span>📢</span> 설문 배포 및 관리 리스트</h3>
          <button onClick={handleAddSurvey} className="px-4 py-2 bg-blue-500 text-white rounded-xl font-black text-[10px] shadow-sm hover:bg-blue-400 transition-all">+ 새로운 설문 작성</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-medium min-w-[1400px]">
            <thead className="bg-slate-50 text-[10px] text-slate-500 font-black border-b border-slate-200 tracking-tight uppercase">
              <tr>
                <th className="py-3 pl-4 w-10 text-center">NO</th>
                <th className="py-3 px-2 w-20">식별코드</th>
                <th className="py-3 px-2 w-16 text-center text-indigo-500">게시번호</th>
                <th className="py-3 px-2 w-20 text-center">게시일</th>
                <th className="py-3 px-2 w-[220px]">게시명 / 유형</th>
                <th className="py-3 px-2 w-14 text-center text-indigo-500">익명여부</th>
                <th className="py-3 px-2 w-24 text-center">대상</th>
                <th className="py-3 px-2 w-24 text-center">기간</th>
                <th className="py-3 px-2 w-12 text-center border-l bg-slate-100/50">참여율</th>
                <th className="py-3 px-2 w-12 text-center bg-blue-50/50 text-blue-600">참여</th>
                <th className="py-3 px-2 w-[110px] text-center bg-red-50/50 text-red-600 border-r">미참여인원</th>
                <th className="py-3 px-2 w-16 text-center">상태</th>
                <th className="py-3 px-2 w-[140px] text-center border-l border-slate-200 bg-slate-100/30 text-indigo-600">게시 제어</th>
                <th className="py-3 pr-4 w-[140px] text-center bg-slate-100/30 text-slate-600">명세 관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredSurveys.map((s, idx) => {
                const targetDepts = s.target.split(',').map((t:string) => t.trim());
                const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
                const done = targetUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                const total = targetUsers.length;
                const notDone = total - done;
                const rate = total > 0 ? Math.round((done/total)*100) : 0;
      
                return (
                  <tr key={s.id} className="hover:bg-blue-50/20 transition-all h-14">
                    <td className="py-2 pl-4 text-center text-slate-400 font-bold align-middle">{idx + 1}</td>
                    <td className="py-2 px-2 font-mono font-black text-slate-600 tracking-tighter align-middle">{s.code}</td>
                    <td className="py-2 px-2 font-black text-center text-indigo-600 text-[12px] align-middle">{s.postNumber}</td>
                    <td className="py-2 px-2 font-mono text-center text-slate-500 whitespace-nowrap align-middle">{s.postDate === '-' ? '' : s.postDate}</td>
                    <td className="py-2 px-2 align-middle">
                      <button onClick={() => setPreviewModal(s)} className="font-black text-slate-800 text-[11px] hover:text-blue-600 hover:underline text-left line-clamp-1">{s.title}</button>
                      <div className="text-[9px] text-slate-400 font-bold mt-0.5">{s.type}</div>
                    </td>
                    <td className="py-2 px-2 text-center align-middle">
                      {s.isAnonymous ? (
                        <span className="px-1.5 py-0.5 bg-slate-700 text-white text-[9px] font-black rounded">익명</span>
                      ) : (
                        <span className="px-1.5 py-0.5 border border-slate-300 text-slate-500 text-[9px] font-bold rounded">기명</span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-bold text-slate-600 text-center align-middle">
                      <div className="text-[10px] leading-tight cursor-help truncate w-20 mx-auto" title={s.target}>
                        {s.target === '전사' ? '전사' : <span className="underline decoration-dashed decoration-slate-300">{s.target.split(',').length}개 부서 지정</span>}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-slate-500 tracking-tighter text-center text-[9px] whitespace-nowrap align-middle">
                      <div>{s.startDate} ~</div>
                      <div>{s.endDate}</div>
                    </td>
                    <td className="py-2 px-2 text-center font-black text-slate-700 border-l bg-slate-50/30 align-middle">{rate}%</td>
                    <td className="py-2 px-2 text-center bg-blue-50/30 align-middle">
                      <button onClick={() => handleMatrixFilter(s.id, 'DONE')} className="text-blue-600 font-black hover:underline relative z-10">{done}명</button>
                    </td>
                    
                    <td className="py-2 px-2 text-center bg-red-50/30 border-r align-middle">
                      <div className="flex items-center justify-center gap-2 w-full">
                        <button onClick={() => handleMatrixFilter(s.id, 'NOT_DONE')} className="text-red-500 font-black hover:underline">{notDone}명</button>
                        {s.status === '진행중' && notDone > 0 && (
                          <button onClick={() => handleNudge(s.id)} className="px-1.5 py-0.5 bg-white border border-red-200 text-red-600 rounded text-[9px] font-black hover:bg-red-50 transition-colors shadow-sm whitespace-nowrap">🔔독촉</button>
                        )}
                      </div>
                    </td>
     
                    <td className="py-2 px-2 text-center align-middle">
                      <span className={`px-2 py-1 rounded font-black text-[9px] whitespace-nowrap ${getStatusBadge(s.status)}`}>{s.status}</span>
                    </td>
                    
                    <td className="py-2 px-2 align-middle border-l border-slate-200 bg-slate-50/50">
                      <div className="flex items-center justify-center gap-1 w-full">
                        <button 
                          onClick={() => handleStatusChange(s.id, 'UP')} 
                          disabled={s.status === '진행중' || s.status === '완료'}
                          className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${
                            s.status === '게시전' || s.status === '게시중단' 
                              ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' 
                              : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                          }`}
                        >
                          게시
                        </button>
                        <button 
                          onClick={() => handleStatusChange(s.id, 'DOWN')} 
                          disabled={s.status !== '진행중'}
                          className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${
                            s.status === '진행중' 
                              ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100' 
                              : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                          }`}
                        >
                          중단
                        </button>
                        <button 
                          onClick={() => handleStatusChange(s.id, 'FORCE_COMPLETE')} 
                          disabled={s.status !== '진행중'}
                          className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${
                            s.status === '진행중' 
                              ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' 
                              : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                          }`}
                        >
                          마감
                        </button>
                      </div>
                    </td>
     
                    <td className="py-2 pr-4 align-middle bg-slate-50/50">
                      <div className="flex items-center justify-center gap-1 w-full">
                        <button 
                          onClick={() => setEditModal(s)} 
                          disabled={s.status === '진행중' || s.status === '완료'} 
                          className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all ${s.status === '게시전' || s.status === '게시중단' ? 'bg-white border border-slate-300 text-slate-700 shadow-sm hover:bg-slate-100' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-transparent'}`}
                        >
                          수정
                        </button>
                        <button 
                          onClick={() => handleDeleteSurvey(s.id)} 
                          disabled={s.hasBeenPublished} 
                          className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all ${!s.hasBeenPublished ? 'bg-white border border-red-200 text-red-500 shadow-sm hover:bg-red-50' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-transparent'}`}
                        >
                          삭제
                        </button>
                        <button 
                          onClick={() => handleStatusChange(s.id, 'ARCHIVE')} 
                          disabled={s.status !== '완료'}
                          className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all ${s.status === '완료' ? 'bg-slate-800 text-white shadow-sm hover:bg-slate-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-transparent'}`}
                        >
                          보관함이동
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* 사용자별 응답 데이터 매트릭스 */}
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden mt-6">
        <div className="p-4 px-6 bg-slate-900 flex justify-between items-center text-white">
          <h3 className="text-[12px] font-black flex items-center gap-2"><span>🗂️</span> 부서 및 직원별 설문 제출 결과 현황 보드</h3>
          <div className="flex gap-2">
            <button onClick={handleDownloadZipAll} className="px-4 py-2 bg-indigo-600 rounded-lg text-[10px] font-black shadow-sm hover:bg-indigo-500 transition-all flex items-center gap-1.5">
              <span>📥</span> 선택 ZIP 다운로드
            </button>
            <button onClick={handleExportAnalysisAll} className="px-4 py-2 bg-emerald-600 rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-500 transition-all flex items-center gap-1.5">
              <span>📈</span> 선택 엑셀 다운로드
            </button>
          </div>
        </div>
      
        <div className="overflow-x-auto max-h-[500px] scrollbar-thin">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead className="sticky top-0 z-20 bg-white shadow-sm">
              <tr className="border-b-2 border-slate-300">
                <th className="py-2 pl-6 w-48 bg-slate-50 font-black text-slate-500 tracking-widest text-[9px] align-bottom">
                  <div className="uppercase mb-1">소속 부서 / 이름</div>
                  <div className="flex gap-2 text-[8px] text-blue-500 font-bold">
                    <button onClick={collapseAll} className="hover:underline">전체 접기</button> <span className="text-slate-300">|</span> <button onClick={expandAll} className="hover:underline">전체 펼치기</button>
                  </div>
                </th>
                {sortedSurveys.filter(s => s.status !== '보관됨').map(s => (
                  <th key={s.id} className="p-2 border-l border-slate-100 text-center min-w-[180px] bg-white align-bottom">
                    <div className="flex flex-col items-center gap-1.5">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input type="checkbox" checked={selectedSurveyIds.has(s.id)} onChange={(e) => {
                          const next = new Set(selectedSurveyIds); e.target.checked ? next.add(s.id) : next.delete(s.id); setSelectedSurveyIds(next);
                        }} className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer" />
                        <div className="text-left">
                          <span className="font-black text-slate-800 text-[10px] leading-tight group-hover:text-indigo-600 transition-colors">[{s.code}] {s.isAnonymous && <span className="text-red-500 ml-1">🔒</span>}</span>
                          <br/>
                          <span className="line-clamp-1 text-slate-500 text-[9px] group-hover:text-indigo-500 transition-colors">{s.title}</span>
                        </div>
                      </label>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(groupedUsers).map(([dept, deptUsers]) => (
                <Fragment key={dept}>
                  <tr className="bg-slate-50/80 cursor-pointer hover:bg-slate-100 border-b border-white" onClick={() => toggleDept(dept)}>
                    <td className="py-2 pl-6 font-black text-indigo-700 flex items-center gap-2 text-[11px]"><span className="text-[8px] opacity-60">{collapsedDepts.has(dept) ? '▶' : '▼'}</span>{dept} <span className="text-[9px] text-slate-400 ml-1">{deptUsers.length}명</span></td>
                    {sortedSurveys.filter(s => s.status !== '보관됨').map(s => {
                       const targetDepts = s.target.split(',').map((t:string) => t.trim());
                       if (!isOrgAllowed(targetDepts, dept)) return <td key={`ds-${s.id}`} className="py-2 border-l border-slate-200 text-center bg-slate-100/30 text-[10px] font-black text-slate-300">-</td>;
                       if (s.isAnonymous) return <td key={`ds-${s.id}`} className="py-2 border-l border-slate-200 text-center bg-slate-100/30"><span className="text-[9px] font-black text-slate-400">🔒 블랭크</span></td>;
                       
                       const dDone = deptUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                       const dTotal = deptUsers.length;
                       return <td key={`ds-${s.id}`} className="py-2 border-l border-slate-200 text-center bg-slate-100/30"><div className="text-[9px] font-bold text-slate-600"><span className="text-indigo-600 font-black">{dDone}명</span> / {dTotal}명 <span className="ml-1 text-[8px] text-slate-400">({dTotal > 0 ? Math.round((dDone/dTotal)*100) : 0}%)</span></div></td>
                    })}
                  </tr>
                  {!collapsedDepts.has(dept) && deptUsers.map(user => {
                    if (matrixUserFilter.type === 'DONE' && matrixUserFilter.surveyId && !responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
                    if (matrixUserFilter.type === 'NOT_DONE' && matrixUserFilter.surveyId && responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
      
                    return (
                      <tr key={user.id} className="hover:bg-indigo-50/30 h-8">
                        <td className="py-1.5 pl-12 font-bold text-slate-700 flex items-center gap-2 border-r border-slate-50 text-[10px]"><div className="w-1 h-1 rounded-full bg-slate-300"></div>{user.name} <span className="text-[8px] text-slate-400 font-mono">{user.email.split('@')[0]}</span></td>
                        {sortedSurveys.filter(s => s.status !== '보관됨').map(s => {
                          const targetDepts = s.target.split(',').map((t:string) => t.trim());
                          if (!isOrgAllowed(targetDepts, user.dept)) return <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center text-[10px] font-black text-slate-300">-</td>;
                          if (s.isAnonymous) return <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center bg-slate-50/50"><span className="text-[8px] font-black text-slate-300">🔒 블랭크</span></td>;
                          
                          const resp = responses[`${s.id}_${user.email}`];
                          const hasFile = resp?.answers && Object.values(resp.answers).some((a: any) => a && a.fileName);
                          
                          return (
                            <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center">
                              {resp?.isDone ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">제출 <span className="opacity-60 font-mono">{resp.date}</span></span>
                                  {hasFile && (
                                    <button onClick={() => {
                                      const fileAns = Object.values(resp.answers || {}).find((a: any) => a && a.fileName);
                                      if (fileAns && (fileAns as any).fileData) {
                                        fetch((fileAns as any).fileData).then(r => r.blob()).then(blob => saveAs(blob, (fileAns as any).fileName));
                                      }
                                    }} className="text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700">📂 파일</button>
                                  )}
                                </div>
                              ) : <span className="text-[8px] font-black text-slate-300">미진행</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
{/* 모달창 영역 */}
{previewModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setPreviewModal(null)}>
          <div className="bg-white w-[600px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="p-5 bg-slate-800 text-white flex justify-between"><h3 className="font-black text-sm">설문 상세 편집 및 배포</h3><button onClick={() => setPreviewModal(null)} className="text-xl">✕</button></div>
            <div className="p-6 space-y-5 bg-slate-50 flex-1">
              <div><label className="text-[10px] font-black text-slate-500">설문 제목</label><input type="text" value={previewModal.title} onChange={e => setPreviewModal({...previewModal, title: e.target.value})} className="w-full p-2 border rounded text-xs font-black outline-none focus:border-indigo-500" /></div>
              <div><label className="text-[10px] font-black text-slate-500">인사말 및 설명</label><textarea value={previewModal.description} onChange={e => setPreviewModal({...previewModal, description: e.target.value})} className="w-full p-2 border rounded text-xs outline-none focus:border-indigo-500 min-h-[80px]" /></div>
              
              <div className="text-center p-5 border-2 border-dashed border-indigo-200 bg-indigo-50 rounded-xl">
                <Link href={`/survey/general/admin/survey-builder?id=${previewModal.id}`} className="px-5 py-3 bg-indigo-600 text-white rounded-xl text-[11px] font-black shadow-md hover:bg-indigo-700 block w-fit mx-auto">🛠️ 설문지 생성기(Builder) 열기</Link>
                <p className="text-[10px] text-indigo-500 font-bold mt-3">Builder에서 구체적인 질문 문항을 구성할 수 있습니다.</p>
              </div>

              {/* 🚀 배포 링크 복사 섹션 추가 */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <label className="text-[10px] font-black text-slate-500 block mb-2">🔗 모바일/웹 외부 응답 배포 링크</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="text" 
                    readOnly 
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/survey/public/${previewModal.id}`} 
                    className="flex-1 p-2 bg-slate-100 rounded border border-slate-200 text-xs font-mono text-slate-500 outline-none"
                  />
                  <button 
                    onClick={() => {
                      const link = `${window.location.origin}/survey/public/${previewModal.id}`;
                      navigator.clipboard.writeText(link);
                      alert('배포 링크가 클립보드에 복사되었습니다!\n게시판이나 메신저에 붙여넣기 하세요.');
                    }}
                    className="px-4 py-2 bg-slate-800 text-white rounded text-[11px] font-black hover:bg-black transition-colors shrink-0"
                  >
                    링크 복사
                  </button>
                </div>
              </div>

            </div>
            <div className="p-4 bg-white flex gap-2"><button onClick={() => setPreviewModal(null)} className="flex-1 py-2.5 border rounded-xl text-xs font-black text-slate-500">취소</button><button onClick={handleSavePreview} className="flex-[2] py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black shadow-md hover:bg-black">저장</button></div>
          </div>
        </div>
      )}
      
      {editModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] rounded-[2rem] overflow-hidden shadow-2xl">
            <div className="p-5 bg-slate-900 text-white flex justify-between items-center"><h3 className="font-black text-sm">설문 기본 정보 {editModal.id.startsWith('S_') ? '추가' : '수정'}</h3><button onClick={() => setEditModal(null)} className="text-lg">✕</button></div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 bg-slate-50">
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[9px] font-black text-slate-500">식별코드</label><input type="text" value={editModal.code} onChange={e => setEditModal({...editModal, code: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500" /></div>
                <div><label className="text-[9px] font-black text-indigo-500">게시번호 (순서)</label><input type="number" value={editModal.postNumber} onChange={e => setEditModal({...editModal, postNumber: Number(e.target.value)})} className="w-full p-2 rounded-lg border text-[11px] font-black outline-none focus:border-indigo-500" /></div>
                <div><label className="text-[9px] font-black text-slate-500">게시일</label><input type="date" value={editModal.postDate === '-' ? todayStr : editModal.postDate} onChange={e => setEditModal({...editModal, postDate: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500" /></div>
              </div>
              
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[9px] font-black text-slate-500">게시명 (설문 제목)</label>
                  <input type="text" value={editModal.title} onChange={e => setEditModal({...editModal, title: e.target.value})} className="w-full p-2.5 rounded-lg border text-[12px] font-black outline-none focus:border-indigo-500" />
                </div>
                <div className="w-24">
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">익명 여부</label>
                  <label className="flex items-center gap-2 bg-white p-2 border rounded-lg cursor-pointer hover:bg-slate-100">
                    <input type="checkbox" checked={editModal.isAnonymous || false} onChange={e => setEditModal({...editModal, isAnonymous: e.target.checked})} className="accent-indigo-600" />
                    <span className="text-[11px] font-black text-slate-700">익명</span>
                  </label>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">대상 부서</label>
                  <select value={editModal.target === '전사' ? '전사' : '특정'} onChange={(e) => { if(e.target.value === '전사') setEditModal({...editModal, target: '전사'}); else setEditModal({...editModal, target: deptList[0] || ''}); }} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500 mb-2">
                    <option value="전사">전사</option>
                    <option value="특정">특정 부서 지정</option>
                  </select>
                  {editModal.target !== '전사' && (
                    <div className="border bg-white rounded-lg p-2 max-h-24 overflow-y-auto">
                      {deptList.map(d => (
                        <label key={d} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-50">
                          <input type="checkbox" checked={editModal.target.includes(d)} onChange={() => toggleTarget(d)} className="accent-indigo-600"/>
                          <span className="text-[10px] font-bold">{d}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">설문 유형</label>
                  <select value={editModal.type} onChange={e => setEditModal({...editModal, type: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500">
                    <option>선택형</option>
                    <option>자유응답형</option>
                    <option>선택형+자유응답</option>
                    <option>파일형(HWP)</option>
                    <option>파일형(PDF)</option>
                  </select>
                </div>
              </div>
      
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[9px] font-black text-slate-500">시작일</label><input type="date" value={editModal.startDate} onChange={e => setEditModal({...editModal, startDate: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500" /></div>
                <div><label className="text-[9px] font-black text-slate-500">종료일</label><input type="date" value={editModal.endDate} onChange={e => setEditModal({...editModal, endDate: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500" /></div>
              </div>
              <div className="pt-4 flex gap-2 mt-2 border-t border-slate-200"><button type="button" onClick={() => setEditModal(null)} className="flex-1 py-2.5 bg-white border rounded-xl font-black text-slate-600">취소</button><button type="submit" className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-black shadow-md hover:bg-indigo-700">저장하기</button></div>
            </form>
          </div>
        </div>
      )}
      
      {nudgeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-[400px] rounded-[2rem] overflow-hidden shadow-2xl p-8 border text-center">
            <div className="flex justify-center items-center mb-4 text-4xl">🔔</div>
            <h3 className="font-black text-lg text-slate-800 mb-2">미참여 인원 독촉 알림</h3>
            <p className="text-xs text-slate-500 font-bold mb-6 leading-relaxed">
              <span className="text-indigo-600 font-black">[{nudgeModal.title}]</span> 설문에<br/>
              참여하지 않은 <span className="text-red-500 font-black">{nudgeModal.count}명</span>의 사용자에게<br/>
              나의 제출(My Dashboard) 알람 팝업을 띄우시겠습니까?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setNudgeModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-xs hover:bg-slate-200 transition-colors">취소</button>
              <button onClick={() => {
                  const nudged = JSON.parse(localStorage.getItem('nudged_surveys') || '[]');
                  if (!nudged.includes(nudgeModal.surveyId)) {
                    localStorage.setItem('nudged_surveys', JSON.stringify([...nudged, nudgeModal.surveyId]));
                  }
                  alert(`✅ ${nudgeModal.count}명의 미참여자 화면에 독촉 알람이 성공적으로 발송되었습니다.`);
                  setNudgeModal(null);
              }} className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-black text-xs shadow-md hover:bg-indigo-700 transition-colors">🚀 독촉 팝업 발송하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}