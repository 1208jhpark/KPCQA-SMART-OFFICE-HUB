'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { saveAs } from 'file-saver';
  
export default function SurveyDashboardContent() {
  const [surveys, setSurveys] = useState<any[]>([]);
  const [myResponses, setMyResponses] = useState<Record<string, any>>({}); 
  const [allResponses, setAllResponses] = useState<Record<string, any>>({});
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
     
  const [filterPending, setFilterPending] = useState<boolean>(false);
  const [filterNudged, setFilterNudged] = useState<boolean>(false);
  const [nudgedSurveys, setNudgedSurveys] = useState<string[]>([]);
     
  const [introModalSurvey, setIntroModalSurvey] = useState<any | null>(null); 
  const [activeFullScreenSurvey, setActiveFullScreenSurvey] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  // 🚀 [신규] 섹션 제어용 상태
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);
  
  useEffect(() => {
    // 카카오 주소 API 동적 인젝션
    if (typeof window !== 'undefined') {
      const scriptId = 'kakao-postcode-script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
        script.async = true;
        document.head.appendChild(script);
      }
    }

    const fetchData = async () => {
      try {
        const ts = Date.now();
        const [uRes, unitsRes, usersRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/users?t=' + ts, { cache: 'no-store' }).catch(()=>null)
        ]);
        
        const userData = uRes.ok ? await uRes.json() : null;
        const unitsData = unitsRes.ok ? await unitsRes.json() : [];
        setUnitsList(unitsData);
     
        if (userData) {
          const myUnit = unitsData.find((u: any) => u.id === userData.dept_id);
          userData.unit = myUnit || { unit_name: '소속없음' };
          setCurrentUser(userData);
          setCurrentUserEmail(userData.email || 'user@kpcqa.or.kr');
  
          const storedResponses = JSON.parse(localStorage.getItem(`db_my_responses_${userData.email}`) || '{}');
          setMyResponses(storedResponses);
        }
     
        if (usersRes && usersRes.ok) {
          const usersData = await usersRes.json();
          const mappedUsers = (usersData.users || []).map((u:any) => ({
            ...u,
            dept: unitsData.find((un:any) => un.id === u.unit_id)?.unit_name || '소속없음'
          }));
          setAllUsers(mappedUsers);
     
          const realRes: Record<string, any> = {};
          mappedUsers.forEach((u:any) => {
            if (!u.email) return;
            const stored = localStorage.getItem(`db_my_responses_${u.email}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              Object.keys(parsed).forEach(surveyId => {
                realRes[`${surveyId}_${u.email}`] = true;
              });
            }
          });
          setAllResponses(realRes);
        }
  
        const storedSurveys = localStorage.getItem('admin_surveys_db');
        if (storedSurveys) setSurveys(JSON.parse(storedSurveys));
     
        const storedNudges = JSON.parse(localStorage.getItem('nudged_surveys') || '[]');
        setNudgedSurveys(storedNudges);
      } catch (error) {
        console.error("Dashboard Sync Error:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // 🚀 [신규] 입력 제어 헬퍼 함수들
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
     
  const checkHierarchyTarget = (targetString: string, userDeptName: string) => {
    if (!targetString || targetString === '전사') return true;
    const targetDepts = targetString.split(',').map(t => t.trim());
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
     
  const todayStr = new Date().toISOString().split('T')[0];
  const visibleSurveys = useMemo(() => surveys.filter(s => s.status === '진행중' || s.status === '완료'), [surveys]);
     
  const filteredSurveys = useMemo(() => {
    if (filterNudged) return visibleSurveys.filter(s => { const isTargeted = currentUser?.roles?.includes('LV_1') || checkHierarchyTarget(s.target, currentUser?.unit?.unit_name); return s.status === '진행중' && isTargeted && !myResponses[s.id] && nudgedSurveys.includes(s.id); });
    if (filterPending) return visibleSurveys.filter(s => { const isTargeted = currentUser?.roles?.includes('LV_1') || checkHierarchyTarget(s.target, currentUser?.unit?.unit_name); return s.status === '진행중' && isTargeted && !myResponses[s.id]; });
    return visibleSurveys;
  }, [visibleSurveys, filterPending, filterNudged, myResponses, currentUser, unitsList, nudgedSurveys]);
     
  const stats = useMemo(() => {
    if (!currentUser) return { ongoingCount: 0, closingTodayCount: 0, myPendingCount: 0, nudgeCount: 0 };
    const allOngoing = surveys.filter(s => s.status === '진행중');
    const pendingSurveys = allOngoing.filter(s => { const isTargeted = currentUser?.roles?.includes('LV_1') || checkHierarchyTarget(s.target, currentUser?.unit?.unit_name); return isTargeted && !myResponses[s.id]; });
    return { ongoingCount: allOngoing.length, closingTodayCount: allOngoing.filter(s => s.endDate === todayStr).length, myPendingCount: pendingSurveys.length, nudgeCount: pendingSurveys.filter(s => nudgedSurveys.includes(s.id)).length };
  }, [surveys, myResponses, todayStr, currentUser, unitsList, nudgedSurveys]);
     
  const handleOpenIntro = (survey: any) => {
    if (survey.status === '완료') return alert('🔒 본 설문조사 창구는 기한이 만료되어 닫혔습니다.');
    setIntroModalSurvey(survey);
  };
     
  const handleStartSurvey = () => {
    const surveyId = introModalSurvey.id;
    const draftData = localStorage.getItem(`survey_draft_${surveyId}_${currentUserEmail}`);
    if (draftData) {
      if (confirm('💾 이전에 작성 중이던 임시 저장 내역이 있습니다.\n이어서 작성하시겠습니까?')) setFormData(JSON.parse(draftData)); else setFormData({});
    } else setFormData({});
     
    const builderData = localStorage.getItem(`survey_builder_${surveyId}`);
    const questions = builderData ? JSON.parse(builderData) : [];
    
    // 🚀 [신규] 섹션 초기화 로직
    if (questions.length > 0 && questions[0].type !== 'SECTION') setCurrentSectionId(null);
    else {
      const firstSection = questions.find((q: any) => q.type === 'SECTION');
      if (firstSection) setCurrentSectionId(firstSection.id);
    }

    setActiveFullScreenSurvey({ ...introModalSurvey, questions });
    setIntroModalSurvey(null);
  };
     
  const handleSaveDraft = () => {
    if (!activeFullScreenSurvey) return;
    localStorage.setItem(`survey_draft_${activeFullScreenSurvey.id}_${currentUserEmail}`, JSON.stringify(formData));
    alert('💾 현재까지 작성한 설문 내용이 임시 저장되었습니다.');
  };
     
  const handleSubmitForm = () => {
    for (const q of activeFullScreenSurvey.questions) {
      if (q.type !== 'SECTION' && q.isRequired && !formData[q.id]) return alert(`✏️ [${q.title}] 문항은 필수 응답 사항입니다. 답변을 채워주세요.`);
    }
    if (!confirm('설문 응답을 최종 제출하시겠습니까?\n제출 후에는 수정할 수 없습니다.')) return;
     
    const submittedDate = `${todayStr} ${new Date().toLocaleTimeString('ko-KR', {hour12: false})}`;
    const nextResponses = { ...myResponses, [activeFullScreenSurvey.id]: { submittedAt: submittedDate, answers: formData } };
    
    setMyResponses(nextResponses);
    localStorage.setItem(`db_my_responses_${currentUserEmail}`, JSON.stringify(nextResponses));
    localStorage.removeItem(`survey_draft_${activeFullScreenSurvey.id}_${currentUserEmail}`); 
    alert(`✅ ${submittedDate}에 정상적으로 제출되었습니다.\n설문 참여에 감사드립니다.`);
    setActiveFullScreenSurvey(null); 
  };

  // 🚀 [신규] 섹션 분기 필터링 시스템
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
     
  if (loading) return <div className="p-20 text-center font-black text-blue-600 animate-pulse text-xl uppercase tracking-widest">Survey Dashboard Syncing...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      <div className="flex flex-col xl:flex-row gap-4 w-full">
        <div className="xl:w-2/5 bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[120px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden group">
          <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-1">My Survey Mission</p>
            <div className="flex items-end gap-2 mt-1"><h3 className="text-4xl font-black">{stats.myPendingCount}</h3><p className="text-xs font-bold mb-1 opacity-90">건의 참여할 설문이 있습니다.</p></div>
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2">
            <button onClick={() => { if (stats.myPendingCount === 0) return alert('미참여 대기 설문이 없습니다.'); setFilterPending(!filterPending); setFilterNudged(false); }} className={`shrink-0 text-[10px] font-black px-4 py-2 rounded-xl transition-all border shadow-sm ${filterPending ? 'bg-white text-indigo-700 border-white' : 'bg-white/20 hover:bg-white/30 text-white border-white/20'}`}>{filterPending ? '전체 목록 ↺' : '대상만 보기 →'}</button>
          </div>
        </div>
        <div className="xl:w-3/5 flex flex-col md:flex-row gap-4">
          <div className="flex-1 bg-white border border-slate-200 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px]">
            <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">진행 중 조사</p><h3 className="text-3xl font-black text-slate-800 mt-1">{stats.ongoingCount} <span className="text-sm font-bold text-slate-400">건</span></h3></div><div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">📝</div>
          </div>
          <div className="flex-1 bg-white border border-slate-200 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px]">
            <div><p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">오늘 마감</p><h3 className="text-3xl font-black text-red-600 mt-1">{stats.closingTodayCount} <span className="text-sm font-bold text-red-300">건</span></h3></div><div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-2xl">⏰</div>
          </div>
          <div onClick={() => { if (stats.nudgeCount === 0) return alert('접수된 참여 요청 건이 없습니다.'); setFilterNudged(!filterNudged); setFilterPending(false); }} className={`flex-1 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px] cursor-pointer transition-all border-2 ${filterNudged ? 'bg-red-500 border-red-600 scale-[1.02] shadow-lg' : 'bg-white border-red-100 hover:border-red-300 hover:bg-red-50/30'}`}>
            <div><p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${filterNudged ? 'text-red-100' : 'text-red-400'}`}>참여 요청</p><h3 className={`text-3xl font-black mt-1 ${filterNudged ? 'text-white' : 'text-red-600'}`}>{stats.nudgeCount} <span className={`text-sm font-bold ${filterNudged ? 'text-red-200' : 'text-red-300'}`}>건</span></h3></div>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all ${filterNudged ? 'bg-red-600 text-white' : stats.nudgeCount > 0 ? 'bg-red-50 animate-bounce shadow-md' : 'bg-slate-50 text-slate-300 grayscale opacity-50'}`}>🚨</div>
          </div>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <div className="p-6 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-sm font-black text-white flex items-center gap-2"><span className="text-blue-500">●</span> {filterNudged ? '🚨 참여 요청 내역' : '진행 중인 전사 설문 리스트'}</h3>
          <div className="flex items-center gap-2">
            {filterPending && <span className="text-[10px] font-black bg-indigo-500 text-white px-2 py-0.5 rounded-full border border-indigo-600 animate-pulse">대상 내역 표시 중</span>}
            {filterNudged && <span className="text-[10px] font-black bg-red-500 text-white px-2 py-0.5 rounded-full border border-red-600 animate-pulse">독촉 건만 표시 중</span>}
            <span className="text-xs font-black bg-slate-700 text-indigo-300 px-2.5 py-0.5 rounded-full border border-slate-600">조회 {filteredSurveys.length}건</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="py-4 pl-8 w-16 text-center">NO</th><th className="py-4 px-2 w-20 text-center whitespace-nowrap">게시번호</th><th className="py-4 px-3 w-32 text-center whitespace-nowrap">게시일</th><th className="py-4 px-4">게시명</th><th className="py-4 px-3 w-24 text-center">익명여부</th><th className="py-4 px-3 w-44 text-center">대상</th><th className="py-4 px-3 w-36 text-center">기간</th><th className="py-4 px-2 w-16 text-center">참여율</th><th className="py-4 px-2 w-16 text-center">참여</th><th className="py-4 px-2 w-16 text-center">미참여</th><th className="py-4 pr-8 w-32 text-center">상태 / 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {filteredSurveys.length === 0 ? (
                <tr><td colSpan={11} className="py-24 text-center text-slate-400 font-bold bg-slate-50/30">조건에 맞는 설문이 없습니다.</td></tr>
              ) : filteredSurveys.map((s, idx) => {
                let done = 0, total = 0;
                if (allUsers.length > 0) {
                  const targetUsers = allUsers.filter(u => checkHierarchyTarget(s.target, u.dept));
                  total = targetUsers.length;
                  done = targetUsers.filter(u => allResponses[`${s.id}_${u.email}`]).length;
                }
                const rate = total > 0 ? Math.round((done/total)*100) : 0;
                const isClosingToday = s.endDate === todayStr;
                const isSubmitted = Boolean(myResponses[s.id]);
                const isTargeted = currentUser?.roles?.includes('LV_1') || checkHierarchyTarget(s.target, currentUser?.unit?.unit_name);
                const isNudged = isTargeted && !isSubmitted && nudgedSurveys.includes(s.id);
  
                return (
                  <tr key={s.id} className={`transition-all ${isTargeted ? (isNudged ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50/50') : 'bg-slate-50 opacity-40 cursor-not-allowed grayscale'}`}>
                    <td className="text-center text-slate-400 font-black pl-8 py-4">{idx + 1}</td><td className="text-center font-black text-slate-600 px-2 py-4">{s.postNumber}</td><td className="text-center font-mono text-slate-500 px-3 py-4 whitespace-nowrap">{s.postDate || '-'}</td>
                    <td className="px-4 py-4"><div className="flex flex-col gap-1 items-start"><div className="flex items-center gap-2"><button onClick={() => isTargeted && !isSubmitted && handleOpenIntro(s)} className={`font-black text-[12px] text-left line-clamp-1 ${!isTargeted ? 'text-slate-500 cursor-not-allowed' : isSubmitted ? 'text-slate-400 cursor-not-allowed' : 'text-slate-800 hover:text-blue-600 hover:underline'}`}>{s.title}</button>{isClosingToday && <span className="shrink-0 bg-red-600 text-white text-[8px] px-1.5 py-0.5 rounded font-black animate-pulse">마감임박</span>}</div>{isNudged && (<span className="inline-block bg-red-100 text-red-600 border border-red-200 text-[8px] px-2 py-0.5 rounded shadow-sm font-black animate-pulse">🚨 관리자 참여 요청</span>)}</div></td>
                    <td className="text-center py-4 px-3"><span className={`px-2 py-0.5 border text-[10px] rounded ${s.isAnonymous ? 'bg-slate-700 text-white font-black border-slate-900' : 'text-slate-400 border-slate-200'}`}>{s.isAnonymous ? '익명' : '기명'}</span></td>
                    <td className="px-3 py-4 text-center text-slate-600 font-medium whitespace-normal break-keep leading-relaxed">{s.target}</td>
                    <td className="text-center text-slate-500 text-[10px] px-3 py-4"><div>{s.startDate} ~</div><div className={isClosingToday ? 'text-red-500 font-black' : ''}>{s.endDate}</div></td>
                    <td className="text-center font-black text-slate-700 px-2 py-4">{rate}%</td><td className="text-center font-black text-blue-600 px-2 py-4">{done}명</td><td className="text-center font-black text-red-500 px-2 py-4">{total - done}명</td>
                    <td className="text-center pr-8 py-4">{!isTargeted ? (<button disabled className="px-4 py-1.5 rounded-lg font-black text-[10px] bg-slate-200 text-slate-500 cursor-not-allowed">🚫 대상아님</button>) : isSubmitted ? (<button onClick={() => alert(`✅ 제출 내역 정보: ${myResponses[s.id].submittedAt}`)} className="px-3 py-1.5 rounded-lg font-black text-[10px] bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100/50">📬 제출완료</button>) : (<button onClick={() => handleOpenIntro(s)} className={`px-4 py-1.5 rounded-lg font-black text-[10px] shadow-sm transition-all ${isNudged ? 'bg-red-600 text-white hover:bg-red-700 animate-bounce' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>{isNudged ? '🔥참여요청' : '📥 미참여'}</button>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
     
      {introModalSurvey && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col p-8 items-center text-center animate-in zoom-in duration-300">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-3xl mb-6">📋</div>
            <h3 className="text-xl font-black text-slate-800 mb-4">{introModalSurvey.title}</h3>
            <p className="text-sm font-bold text-slate-500 bg-slate-50 p-4 rounded-xl w-full leading-relaxed mb-8 border border-slate-100">
              {introModalSurvey.description || '본 설문조사에 참여하여 의견을 남겨주세요.'}
            </p>
            <div className="flex gap-3 w-full">
              <button onClick={() => setIntroModalSurvey(null)} className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black transition-colors">닫기</button>
              <button onClick={handleStartSurvey} className="flex-[2] py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black shadow-lg transition-colors text-[13px]">🚀 설문 응답 제출하기</button>
            </div>
          </div>
        </div>
      )}
     
      {/* 🚀 [신규 엔진 탑재] 설문 작성 풀스크린 에디터 */}
      {activeFullScreenSurvey && (
        <div className="fixed inset-0 bg-slate-50 z-[500] overflow-y-auto flex flex-col text-[11px]">
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
                <div key={q.id} className="bg-indigo-900 text-white p-5 rounded-2xl shadow-sm border border-indigo-950 mb-2">
                  <h3 className="text-sm font-black flex items-center gap-1.5">🔖 {q.title}</h3>
                  {q.description && <p className="text-[10px] text-indigo-200 mt-2 font-medium whitespace-pre-wrap">{q.description}</p>}
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
                        <div className="p-3 bg-white rounded border space-y-1 text-[10px] font-bold text-slate-700">
                          <p>우편번호: <span className="text-blue-600">{formData[q.id]?.zipCode}</span></p>
                          <p>기본주소: {formData[q.id]?.roadAddress}</p>
                        </div>
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
                <button type="button" onClick={handleSubmitForm} className="flex-1 py-3.5 bg-slate-900 text-white font-black text-xs rounded-xl shadow-lg hover:bg-black transition-all">💾 최종 답변서 제출하기</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}