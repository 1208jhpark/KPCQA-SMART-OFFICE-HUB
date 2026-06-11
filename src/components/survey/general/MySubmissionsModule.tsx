'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { saveAs } from 'file-saver';
  
export default function MySubmissionsModule() {
  const router = useRouter();
  
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [surveys, setSurveys] = useState<any[]>([]);
  const [myResponses, setMyResponses] = useState<Record<string, any>>({}); 
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  
  const [activeFullScreenSurvey, setActiveFullScreenSurvey] = useState<any | null>(null);
  const [viewSurveyHistory, setViewSurveyHistory] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);
  
  const [historyYear, setHistoryYear] = useState<string>('ALL');
  const [eligiblePage, setEligiblePage] = useState<number>(1);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const itemsPerPage = 5;
     
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
     
  useEffect(() => {
    // 카카오 API 인젝션
    if (typeof window !== 'undefined' && !document.getElementById('kakao-postcode-script')) {
      const script = document.createElement('script');
      script.id = 'kakao-postcode-script';
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.async = true;
      document.head.appendChild(script);
    }

    const initializeData = async () => {
      try {
        const ts = Date.now();
        const [userRes, unitsRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' })
        ]);
        
        const userData = userRes.ok ? await userRes.json() : null;
        const unitsData = unitsRes.ok ? await unitsRes.json() : [];
        setUnitsList(unitsData);
  
        if (userData) {
          const myUnit = unitsData.find((u: any) => u.id === userData.dept_id);
          userData.unit = myUnit || { unit_name: '소속없음' };
          setCurrentUser(userData);
          const storedResponses = JSON.parse(localStorage.getItem(`db_my_responses_${userData.email}`) || '{}');
          setMyResponses(storedResponses);
        }
  
        const storedSurveys = localStorage.getItem('admin_surveys_db');
        if (storedSurveys) setSurveys(JSON.parse(storedSurveys));
  
      } catch (error) {
        console.error("Unified MySubmissions Engine Error:", error);
      } finally {
        setLoading(false);
      }
    };
    initializeData();
  }, []);
     
  const handleInputChange = (qId: string, value: any) => setFormData(prev => ({ ...prev, [qId]: value }));
  const handleCheckboxChange = (qId: string, optionLabel: string, checked: boolean) => {
    const currentAns = formData[qId] || [];
    let nextAns = [...currentAns];
    if (checked) nextAns.push(optionLabel); else nextAns = nextAns.filter((val: string) => val !== optionLabel);
    setFormData(prev => ({ ...prev, [qId]: nextAns }));
  };
  const handleUserFileUpload = (qId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => setFormData(prev => ({ ...prev, [qId]: { fileName: file.name, fileData: evt.target?.result as string } }));
      reader.readAsDataURL(file);
    }
  };
  const openPostcodeEngine = (qId: string) => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          setFormData(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), zipCode: data.zonecode, roadAddress: data.roadAddress || data.address } }));
        }
      }).open();
    } else alert('주소 검색 엔진이 아직 로드 중입니다.');
  };
  
  const checkHierarchy = (targetString: string, userDeptName: string) => {
    if (!targetString || targetString === '전사') return true;
    const targetDepts = targetString.split(',').map((t: string) => t.trim());
    if (!userDeptName) return false;
    if (targetDepts.includes(userDeptName)) return true;
     
    let currentId = unitsList.find(u => u.unit_name === userDeptName)?.id;
    while (currentId) {
      const unit = unitsList.find(u => u.id === currentId);
      if (unit && unit.parent_id) {
        const parentUnit = unitsList.find(u => u.id === unit.parent_id);
        if (parentUnit && targetDepts.includes(parentUnit.unit_name)) return true; 
        currentId = unit.parent_id;
      } else break;
    }
    return false;
  };
  
  const eligibleSurveys = useMemo(() => {
    const now = new Date();
    return surveys.filter(s => {
      const isSubmitted = Boolean(myResponses[s.id]);
      if (!isSubmitted) return false;
      
      // 🚀 [버그수정]: 관리자가 "마감(완료)" 처리했거나 기한이 지나면 수정 불가 (대상 제외)
      if (s.status === '완료' || s.status === '보관됨') return false;
      if (s.endDate && now > new Date(`${s.endDate} 23:59:59`)) return false;
      
      return currentUser?.roles?.includes('LV_1') || checkHierarchy(s.target, currentUser?.unit?.unit_name);
    }).sort((a, b) => new Date(b.postDate).getTime() - new Date(a.postDate).getTime());
  }, [surveys, currentUser, myResponses, unitsList]);
  
  const historyList = useMemo(() => {
    const now = new Date();
    return surveys.filter(s => {
      const isSubmitted = Boolean(myResponses[s.id]);
      if (!isSubmitted) return false;
      
      // 🚀 [버그수정]: 완료 상태이거나 기한 초과인 경우 모두 이력 보관함에 표시
      const isExpired = s.endDate ? now > new Date(`${s.endDate} 23:59:59`) : false;
      if (s.status !== '완료' && s.status !== '보관됨' && !isExpired) return false; 
      
      return true;
    }).map(s => ({ ...s, submittedAt: myResponses[s.id].submittedAt, myAnswers: myResponses[s.id].answers })).sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt));
  }, [surveys, myResponses]);
     
  const filteredHistory = useMemo(() => historyList.filter(survey => historyYear === 'ALL' || survey.submittedAt.split('-')[0] === historyYear), [historyList, historyYear]);
  const paginatedEligible = useMemo(() => eligibleSurveys.slice((eligiblePage - 1) * itemsPerPage, eligiblePage * itemsPerPage), [eligibleSurveys, eligiblePage]);
  const paginatedHistory = useMemo(() => filteredHistory.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage), [filteredHistory, historyPage]);
     
  const totalEligiblePages = Math.ceil(eligibleSurveys.length / itemsPerPage);
  const totalHistoryPages = Math.ceil(filteredHistory.length / itemsPerPage);
  
  const handleOpenSurvey = (survey: any, isEditMode: boolean) => {
    if (isEditMode && survey.isAnonymous) return alert('🔒 본 설문조사는 익명 보안 서식입니다. 제출 완료 후 답변 수정이 불가능합니다.');
    
    if (isEditMode) setFormData(myResponses[survey.id]?.answers || {});
    else {
      const draft = localStorage.getItem(`survey_draft_${survey.id}_${currentUser?.email}`);
      setFormData(draft ? JSON.parse(draft) : {});
    }
    
    const builderData = localStorage.getItem(`survey_builder_${survey.id}`);
    const questions = builderData ? JSON.parse(builderData) : [];
    
    // 섹션 초기화 매핑
    const sectionsOrder: (string | null)[] = [];
    if (questions.length > 0 && questions[0].type !== 'SECTION') sectionsOrder.push(null);
    questions.filter((q: any) => q.type === 'SECTION').forEach((s: any) => sectionsOrder.push(s.id));
    setCurrentSectionId(sectionsOrder.length > 0 ? sectionsOrder[0] : null);

    setActiveFullScreenSurvey({ ...survey, questions, isEditMode });
  };
  
  const handleSaveDraft = () => {
    try {
      localStorage.setItem(`survey_draft_${activeFullScreenSurvey.id}_${currentUser?.email}`, JSON.stringify(formData));
      alert('💾 작성 중인 내용이 임시 저장되었습니다.');
    } catch (e) {
      alert('⚠️ 파일 용량 초과로 임시 저장이 실패했습니다.');
    }
  };
  
  const handleSubmitForm = () => {
    for (const q of activeFullScreenSurvey.questions) {
      if (q.type !== 'SECTION' && q.isRequired && !formData[q.id]) return alert(`✏️ [${q.title}] 문항은 필수 응답 항목입니다.`);
    }
    if (!confirm(activeFullScreenSurvey.isEditMode ? '답변 수정을 완료하시겠습니까?' : '설문을 최종 제출하시겠습니까?')) return;
  
    const submittedDate = `${new Date().toISOString().split('T')[0]} ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
    const nextResponses = { ...myResponses, [activeFullScreenSurvey.id]: { submittedAt: submittedDate, answers: formData } };
    
    setMyResponses(nextResponses);

    // 🚀 [수정됨] React 상태 업데이트 비동기 꼬임 방지
    setTimeout(() => {
      localStorage.setItem(`db_my_responses_${currentUser?.email}`, JSON.stringify(nextResponses));
      localStorage.removeItem(`survey_draft_${activeFullScreenSurvey.id}_${currentUser?.email}`);
      alert('✅ 설문 제출 및 수정 사항 반영이 완료되었습니다.');
      setActiveFullScreenSurvey(null);
    }, 0);
  };
     
  // 🚀 [신규 엔진 로직]: 섹션 분기 시스템
  const activeQuestions = activeFullScreenSurvey?.questions || [];
  const hasSections = activeQuestions.some((q: any) => q.type === 'SECTION');
  const sectionsOrder: (string | null)[] = [];
  if (activeQuestions.length > 0 && activeQuestions[0].type !== 'SECTION') sectionsOrder.push(null);
  activeQuestions.filter((q: any) => q.type === 'SECTION').forEach((s: any) => sectionsOrder.push(s.id));
  const currentSectionIndex = sectionsOrder.indexOf(currentSectionId);
  const isLastSection = !hasSections || currentSectionIndex === sectionsOrder.length - 1;
     
  const renderedQuestions = activeQuestions.filter((q: any, idx: number) => {
    if (!hasSections) return true;
    if (q.type === 'SECTION') return q.id === currentSectionId;
    const lastSection = activeQuestions.slice(0, idx + 1).reverse().find((item: any) => item.type === 'SECTION');
    return (lastSection ? lastSection.id : null) === currentSectionId;
  });
  
  if (loading) return <div className="p-20 text-center font-black text-blue-600 animate-pulse text-xl uppercase tracking-widest">통합 제출 제어 모듈 동기화 중...</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      {/* 상단 메인 대시 배너 */}
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[120px]">
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-1">My Eligible Surveys</p>
          <h1 className="text-2xl font-black tracking-tight">나의 제출 및 수정 가능 내역</h1>
          <p className="text-blue-100 text-xs font-semibold mt-1 opacity-90">제출한 조사내역 및 변경 가능 이력 확인</p>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div><h2 className="text-xs font-black text-slate-800 tracking-tight">내가 제출한 설문 리스트</h2><span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{eligibleSurveys.length}건</span>
          </div>
        </div>
  
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="py-4 pl-8 w-16 text-center">NO</th><th className="py-4 px-3 w-28 text-center">게시번호</th><th className="py-4 px-3 w-28 text-center">게시일</th><th className="py-4 px-4">게시명</th><th className="py-4 px-3 w-24 text-center">익명여부</th><th className="py-4 px-3 w-36 text-center">대상</th><th className="py-4 px-4 w-48 text-center">나의 제출 일시</th><th className="py-4 px-3 w-40 text-center">기간</th><th className="py-4 pr-8 w-44 text-center">상태 / 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedEligible.map((survey: any, index: number) => {
                const isAnonymousAndSubmitted = survey.isAnonymous && Boolean(myResponses[survey.id]);
                return (
                  <tr key={survey.id} className="hover:bg-slate-50/50 transition-colors h-16">
                    <td className="text-center text-slate-400 font-black pl-8">{eligibleSurveys.length - ((eligiblePage - 1) * itemsPerPage + index)}</td><td className="text-center font-mono text-slate-500">{100 + (Number(survey.id) || 0)}</td><td className="text-center font-mono text-slate-500">{survey.postDate}</td>
                    <td className="px-4"><div className="flex items-center gap-3"><span className="font-black text-slate-900">{survey.title}</span><span className="shrink-0 bg-red-50 text-red-500 text-[8px] font-black px-1.5 py-0.5 rounded border border-red-100 animate-pulse">마감임박</span></div></td>
                    <td className="text-center"><span className={`px-2 py-0.5 border rounded text-[10px] ${survey.isAnonymous ? 'bg-slate-800 text-white font-black border-slate-950' : 'text-slate-400 border-slate-200'}`}>{survey.isAnonymous ? '익명' : '기명'}</span></td>
                    <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td><td className="text-center text-slate-700 font-bold px-4 whitespace-nowrap">{myResponses[survey.id]?.submittedAt || '-'}</td>
                    <td className="text-center font-mono text-slate-500 leading-relaxed whitespace-nowrap px-3"><div>{survey.startDate} ~</div><div className="text-red-500 font-bold">{survey.endDate}</div></td>
                    <td className="text-center pr-8"><button onClick={() => handleOpenSurvey(survey, true)} disabled={isAnonymousAndSubmitted} className={`w-full py-1.5 rounded-lg font-black text-[10px] transition-all shadow-sm border ${isAnonymousAndSubmitted ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed line-through' : 'bg-white border-blue-200 text-blue-600 hover:bg-blue-50'}`}>{isAnonymousAndSubmitted ? '🔒 익명 서식 변경 불가' : '✏️ 답변 내역 수정'}</button></td>
                  </tr>
                );
              })}
              {eligibleSurveys.length === 0 && <tr><td colSpan={9} className="py-16 text-center text-slate-400 font-bold bg-slate-50/30">현재 변경 가능한 활성 제출 내역이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        {totalEligiblePages > 1 && (
          <div className="flex justify-center items-center gap-1.5 py-4 border-t border-slate-100 bg-white">
            <button disabled={eligiblePage === 1} onClick={() => setEligiblePage(p => p - 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-xl">이전</button>
            {Array.from({ length: totalEligiblePages }).map((_, i) => <button key={i} onClick={() => setEligiblePage(i + 1)} className={`w-7 h-7 rounded-xl text-xs font-black ${eligiblePage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border'}`}>{i + 1}</button>)}
            <button disabled={eligiblePage === totalEligiblePages} onClick={() => setEligiblePage(p => p + 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-xl">다음</button>
          </div>
        )}
      </div>
     
      <div onClick={() => setIsHistoryOpen(!isHistoryOpen)} className="w-full bg-gradient-to-r from-slate-700 to-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex items-center justify-between min-h-[120px] mt-12 cursor-pointer hover:brightness-95 active:scale-[0.99] transition-all select-none">
        <div className="relative z-10"><p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-1">Archive Repository (Click to Toggle)</p><h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">나의 참여 이력 보관함<span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">{isHistoryOpen ? '▲ 접기' : '▼ 펼치기'}</span></h2><p className="text-slate-400 text-xs font-semibold mt-1 opacity-90">이미 공고 기한이 최종 마감되어 보관 처리된 결과 열람 전용 내역</p></div><div className="text-4xl pr-4 font-light opacity-50 select-none hidden md:block">{isHistoryOpen ? '📂' : '📁'}</div>
      </div>
     
      {isHistoryOpen && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div><h2 className="text-xs font-black text-slate-800 tracking-tight">과거 완료 설문 명세 대장</h2><span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">총 {filteredHistory.length}건</span></div>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-600"><span className="text-slate-500">연도 필터 :</span><select value={historyYear} onChange={(e) => { setHistoryYear(e.target.value); setHistoryPage(1); }} className="bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-1.5 font-black focus:outline-none focus:border-indigo-500 text-[11px] cursor-pointer shadow-sm transition-colors"><option value="ALL">전체 내역 보기</option><option value="2026">2026년도</option><option value="2025">2025년도</option></select></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="py-4 pl-8 w-16 text-center">NO</th><th className="py-4 px-3 w-28 text-center">게시번호</th><th className="py-4 px-3 w-28 text-center">게시일</th><th className="py-4 px-4">게시명</th><th className="py-4 px-3 w-24 text-center">익명여부</th><th className="py-4 px-3 w-36 text-center">대상</th><th className="py-4 px-4 w-48 text-center">나의 제출 일시</th><th className="py-4 px-3 w-40 text-center">기간</th><th className="py-4 pr-8 w-44 text-center">결과 열람</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedHistory.map((survey: any, index: number) => {
                  const reverseNo = filteredHistory.length - ((historyPage - 1) * itemsPerPage + index);
                  return (
                    <tr key={survey.id} className="hover:bg-slate-50/50 transition-colors h-16">
                      <td className="text-center text-slate-400 font-black pl-8">{reverseNo}</td><td className="text-center font-mono text-slate-500">{100 + (Number(survey.id) || 0)}</td><td className="text-center font-mono text-slate-500">{survey.postDate}</td>
                      <td className="px-4"><div className="font-black text-slate-800 text-[12px]">{survey.title}</div><div className="text-[10px] text-slate-400 mt-0.5 font-bold">{survey.type || '일반 참여 서식'}</div></td>
                      <td className="text-center"><span className={`px-2 py-0.5 border rounded text-[10px] ${survey.isAnonymous ? 'bg-slate-800 text-white font-black border-slate-950' : 'text-slate-400 border-slate-200'}`}>{survey.isAnonymous ? '익명' : '기명'}</span></td>
                      <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td><td className="text-center text-slate-700 font-bold px-4 whitespace-nowrap">{survey.submittedAt}</td>
                      <td className="text-center font-mono text-slate-500 leading-relaxed whitespace-nowrap px-3"><div>{survey.startDate} ~</div><div className="text-slate-400 font-medium">{survey.endDate}</div></td>
                      <td className="text-center pr-8"><button onClick={() => { const builderData = JSON.parse(localStorage.getItem(`survey_builder_${survey.id}`) || '[]'); setViewSurveyHistory({ ...survey, questions: builderData }); }} className="w-full py-1.5 bg-white border border-slate-200 rounded-lg font-black text-[10px] text-slate-600 hover:bg-slate-50 shadow-sm transition-all">🔍 과거 응답 기록 보기</button></td>
                    </tr>
                  );
                })}
                {filteredHistory.length === 0 && <tr><td colSpan={9} className="py-24 text-center text-slate-400 font-bold bg-slate-50/30">조건에 맞는 과거 완료 이력이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          {totalHistoryPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 py-4 border-t border-slate-100 bg-white">
              <button disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-xl">이전</button>
              {Array.from({ length: totalHistoryPages }).map((_, i) => <button key={i} onClick={() => setHistoryPage(i + 1)} className={`w-7 h-7 rounded-xl text-xs font-black ${historyPage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border'}`}>{i + 1}</button>)}
              <button disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => p + 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-xl">다음</button>
            </div>
          )}
        </div>
      )}
     
      {/* 🚀 [신규 엔진 탑재] 설문 수정 풀스크린 에디터 (Dashboard/Public과 동일한 디자인/로직) */}
      {activeFullScreenSurvey && (
        <div className="fixed inset-0 bg-slate-50 z-[500] overflow-y-auto flex flex-col text-[11px] animate-in slide-in-from-bottom-8 duration-300">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
            <div className="flex items-center gap-4">
              <button onClick={() => { if(confirm('작성을 중단하고 나가시겠습니까?')) setActiveFullScreenSurvey(null); }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-xs text-slate-600">⬅️ 나가기</button>
              <div className="h-6 w-px bg-slate-200 mx-1"></div>
              <h1 className="text-base font-black text-slate-800">{activeFullScreenSurvey.title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleSaveDraft} className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-xs font-black shadow-sm">💾 중간 저장</button>
            </div>
          </div>
          <div className="flex-1 w-full max-w-[800px] mx-auto py-10 px-4 pb-32 space-y-6">
            {renderedQuestions.map((q: any) => {
              if (q.type === 'SECTION') return (
                <div key={q.id} className="bg-blue-900 text-white p-5 rounded-2xl shadow-sm border border-blue-950 mb-2">
                  <h3 className="text-sm font-black flex items-center gap-1.5">🔖 {q.title}</h3>
                  {q.description && <p className="text-[10px] text-blue-200 mt-2 font-medium whitespace-pre-wrap">{q.description}</p>}
                </div>
              );
              return (
                <div key={q.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <div>
                    <h4 className="font-black text-slate-800 text-xs flex items-center gap-1">{q.title} {q.isRequired && <span className="text-red-500 font-extrabold">*</span>}</h4>
                    {q.description && <p className="text-[10px] text-slate-400 mt-1 font-bold whitespace-pre-wrap">💡 {q.description}</p>}
                    {q.referenceLink && <a href={q.referenceLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block px-2.5 py-1 bg-blue-50 text-blue-600 rounded text-[9px] font-black border border-blue-100 hover:bg-blue-100">🔗 관련 참고 링크 열기</a>}
                    {q.questionImageUrl && <img src={q.questionImageUrl} alt="guide" className="mt-3 max-h-40 rounded-xl object-contain border" />}
                  </div>

                  {q.type === 'CHOICE_SINGLE' && (
                    <div className="space-y-2 pt-1">
                      {q.options?.map((opt: any, oIdx: number) => (
                        <label key={oIdx} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-blue-50/40 transition-colors">
                          <input type="radio" name={q.id} checked={formData[q.id] === opt.label} onChange={() => {
                            handleInputChange(q.id, opt.label);
                            if (opt.goToSectionId && opt.goToSectionId !== 'SUBMIT') setCurrentSectionId(opt.goToSectionId);
                          }} className="w-3.5 h-3.5 accent-blue-600" />
                          <div className="flex flex-col flex-1"><span className="font-bold text-slate-700">{opt.label}</span>{opt.referenceLink && <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5" onClick={e => e.stopPropagation()}>🔗 상세 명세 링크</a>}{opt.imageUrl && <img src={opt.imageUrl} className="mt-2 max-h-24 object-contain rounded border bg-white w-fit" />}</div>
                        </label>
                      ))}
                    </div>
                  )}

                  {q.type === 'CHOICE_MULTI' && (
                    <div className="space-y-2 pt-1">
                      {q.options?.map((opt: any, oIdx: number) => (
                        <label key={oIdx} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-blue-50/40 transition-colors">
                          <input type="checkbox" checked={(formData[q.id] || []).includes(opt.label)} onChange={(e) => handleCheckboxChange(q.id, opt.label, e.target.checked)} className="w-3.5 h-3.5 accent-blue-600 rounded" />
                          <div className="flex flex-col flex-1"><span className="font-bold text-slate-700">{opt.label}</span>{opt.referenceLink && <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5" onClick={e => e.stopPropagation()}>🔗 관련 링크</a>}{opt.imageUrl && <img src={opt.imageUrl} className="mt-2 max-h-24 object-contain rounded border bg-white w-fit" />}</div>
                        </label>
                      ))}
                    </div>
                  )}

                  {q.type === 'TEXT_SHORT' && <input type="text" value={formData[q.id] || ''} onChange={(e) => handleInputChange(q.id, e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-bold bg-slate-50 focus:bg-white text-xs" placeholder="답변 내용을 작성해 주세요." />}
                  {q.type === 'TEXT_LONG' && <textarea value={formData[q.id] || ''} onChange={(e) => handleInputChange(q.id, e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-bold bg-slate-50 focus:bg-white text-xs min-h-[100px]" placeholder="세부적인 의견을 여러 줄로 입력하실 수 있습니다." />}
                  
                  {q.type === 'SCALE' && (
                    <div className="flex items-center justify-between bg-slate-50 p-4 border border-slate-200 rounded-xl">
                      <span className="font-black text-slate-400">매우 미흡</span>
                      <div className="flex gap-2">
                        {Array.from({ length: q.scaleMax || 5 }, (_, i) => i + 1).map((n) => (
                          <button key={n} type="button" onClick={() => handleInputChange(q.id, n)} className={`w-8 h-8 rounded-full font-mono font-black border transition-all text-xs ${formData[q.id] === n ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-110' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}>{n}</button>
                        ))}
                      </div>
                      <span className="font-black text-slate-600">매우 우수</span>
                    </div>
                  )}

                  {q.type === 'SEARCH_ADDRESS' && (
                    <div className="space-y-2 bg-slate-50 p-4 rounded-xl border">
                      <button type="button" onClick={() => openPostcodeEngine(q.id)} className="px-4 py-2 bg-slate-900 text-white font-black rounded-lg hover:bg-slate-800 transition-colors">🔍 주소지 검색 찾기</button>
                      {formData[q.id]?.roadAddress && (
                        <div className="p-3 bg-white rounded border space-y-1 text-[10px] font-bold text-slate-700"><p>우편번호: <span className="text-blue-600">{formData[q.id]?.zipCode}</span></p><p>기본주소: {formData[q.id]?.roadAddress}</p></div>
                      )}
                      <input type="text" placeholder="상세 건물명 및 동/호수" value={formData[q.id]?.detailAddress || ''} onChange={(e) => setFormData(prev => ({...prev, [q.id]: { ...(prev[q.id] || {}), detailAddress: e.target.value }}))} className="w-full p-2.5 border rounded-lg bg-white outline-none focus:border-blue-500 font-bold" />
                    </div>
                  )}

                  {q.type === 'CALENDAR' && <input type="date" value={formData[q.id] || ''} onChange={(e) => handleInputChange(q.id, e.target.value)} className="p-3 border rounded-xl bg-slate-50 font-black text-slate-700 outline-none focus:border-blue-500" />}

                  {q.type === 'FILE' && (
                    <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                      {q.templateFileName && (
                        <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-blue-100 shadow-sm"><div className="flex items-center gap-2"><span className="text-base">📥</span><div><p className="font-black text-slate-700">{q.templateFileName}</p><p className="text-[9px] text-slate-400 font-bold">작성 가이드라인 양식을 다운로드 하세요.</p></div></div><button type="button" onClick={() => { if (q.templateFileData) fetch(q.templateFileData).then(r => r.blob()).then(blob => saveAs(blob, q.templateFileName!)); }} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded font-black border border-blue-100 hover:bg-blue-100">양식 받기</button></div>
                      )}
                      <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 bg-white text-center">
                        {formData[q.id]?.fileName ? (
                          <div className="flex items-center justify-between text-left font-bold text-slate-700"><span>📎 첨부됨: {formData[q.id].fileName}</span><button type="button" onClick={() => handleInputChange(q.id, null)} className="text-red-400 font-black hover:underline">취소</button></div>
                        ) : (
                          <label className="cursor-pointer text-blue-600 font-black hover:underline">➕ 기재 완료한 파일 업로드 하기<input type="file" className="hidden" onChange={(e) => handleUserFileUpload(q.id, e)} accept=".hwp,.pdf,.doc,.docx,.xls,.xlsx" /></label>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="pt-4 flex justify-between gap-4">
              {hasSections && currentSectionIndex > 0 && <button type="button" onClick={() => setCurrentSectionId(sectionsOrder[currentSectionIndex - 1])} className="px-5 py-3.5 bg-white border border-slate-300 rounded-xl font-black text-slate-600 shadow-sm hover:bg-slate-50">◀ 이전 단계</button>}
              {!isLastSection ? (
                <button type="button" onClick={() => setCurrentSectionId(sectionsOrder[currentSectionIndex + 1])} className="flex-1 py-3.5 bg-blue-600 text-white font-black text-xs rounded-xl shadow-lg hover:bg-blue-700 transition-all">다음 단계 진행하기 ▶</button>
              ) : (
                <button type="button" onClick={handleSubmitForm} className="flex-1 py-3.5 bg-slate-900 text-white font-black text-xs rounded-xl shadow-lg hover:bg-black transition-all">💾 {activeFullScreenSurvey.isEditMode ? '수정 완료' : '최종 답변서 제출하기'}</button>
              )}
            </div>
          </div>
        </div>
      )}
     
      {/* 🚀 [신규 엔진 탑재] 뷰어 모달 (주소/파일 객체가 깨지지 않고 예쁘게 나오도록 수정됨) */}
      {viewSurveyHistory && (
        <div className="fixed inset-0 bg-slate-50 z-[500] overflow-y-auto flex flex-col animate-in slide-in-from-bottom-8 duration-300">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
            <div className="flex items-center gap-4">
              <button onClick={() => setViewSurveyHistory(null)} className="px-5 py-2.5 bg-slate-800 rounded-xl font-black text-xs text-white hover:bg-black">조회 종료</button>
              <h1 className="text-base font-black text-slate-800">{viewSurveyHistory.title}</h1>
            </div>
          </div>
          <div className="flex-1 w-full max-w-[800px] mx-auto py-10 px-4 space-y-6 pb-32">
            {viewSurveyHistory.questions?.map((q: any, i: number) => {
              if (q.type === 'SECTION') return null;
              const ans = viewSurveyHistory.myAnswers?.[q.id];
              let ansStr = '내용 없음';
              // 🚀 [수정됨] 객체 파싱 안정성 (undefined, null 체크 및 Array 분리)
              if (ans !== undefined && ans !== null && ans !== '') {
                if (typeof ans === 'object' && !Array.isArray(ans)) {
                  if (ans.fileName) {
                    ansStr = `📎 [첨부파일] ${ans.fileName}`;
                  } else if (ans.roadAddress) {
                    ansStr = `📍 [${ans.zipCode || '우편번호 없음'}] ${ans.roadAddress} ${ans.detailAddress || ''}`;
                  } else {
                    ansStr = JSON.stringify(ans);
                  }
                } else if (Array.isArray(ans)) {
                  ansStr = ans.join(', ');
                } else {
                  ansStr = String(ans);
                }
              }
              return (
                <div key={q.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                  <label className="block text-sm font-black text-slate-800">{q.title}</label>
                  <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 text-sm">
                    {ansStr}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  );
}