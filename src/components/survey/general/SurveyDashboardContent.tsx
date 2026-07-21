'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { saveAs } from 'file-saver';
import { getKSTDateString, getKSTTimeString, formatKSTDateTime, isPastKSTDeadline, getKSTDaysUntil } from '@/utils/dateUtils';
import { getVisibleQuestionsByBranch } from '@/utils/surveyBranching';

export default function SurveyDashboardContent() {
  const [stockUsage, setStockUsage] = useState<Record<string, Record<string, number>>>({}); // 🚀 재고 상태
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
  const [filterClosingToday, setFilterClosingToday] = useState<boolean>(false);
  const [nudgedSurveys, setNudgedSurveys] = useState<string[]>([]);
     
  const [introModalSurvey, setIntroModalSurvey] = useState<any | null>(null); 
  const [activeFullScreenSurvey, setActiveFullScreenSurvey] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  
  useEffect(() => {
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
        const [uRes, unitsRes, usersRes, surveyRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/users?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
          fetch(`/api/survey/general?t=${ts}`, { cache: 'no-store' })
        ]);
        
        const userData = uRes.ok ? await uRes.json() : null;
        const unitsData = unitsRes.ok ? await unitsRes.json() : [];
        setUnitsList(unitsData);
     
        if (userData) {
          const myUnit = unitsData.find((u: any) => u.id === userData.dept_id);
          userData.unit = myUnit || { unit_name: '소속없음' };
          setCurrentUser(userData);
          setCurrentUserEmail(userData.email || 'user@kpcqa.or.kr');
        }
     
        if (usersRes && usersRes.ok) {
          const usersData = await usersRes.json();
          const mappedUsers = (usersData.users || []).map((u:any) => ({
            ...u,
            dept: unitsData.find((un:any) => un.id === u.unit_id)?.unit_name || '소속없음'
          }));
          setAllUsers(mappedUsers);
        }
     
       // 🚀 1. 내 제출 내역 전용 호출 (보안 격리됨)
       const myRespRes = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'GET_RESPONSES' }),
        cache: 'no-store'
      }).catch(() => null);
      
      // 🚀 2. 전사 재고 및 참여 통계 전용 호출 (새로 뚫어둔 API)
      const statsRes = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'GET_STATS' }),
        cache: 'no-store'
      }).catch(() => null);

      // 내 데이터 처리
      if (myRespRes && myRespRes.ok) {
        const myDbResponses = await myRespRes.json();
        const nextMyRes: Record<string, any> = {};
        
        myDbResponses.forEach((r: any) => {
          if (userData && r.userEmail === userData.email) {
            const formattedDate = r.submittedAt 
              ? formatKSTDateTime(r.submittedAt) 
              : '-';
            nextMyRes[r.surveyId] = {
              submittedAt: formattedDate,
              answers: r.answers || {},
              isApproved: r.isApproved || false
            };
          }
        });
        if (userData) setMyResponses(nextMyRes);
      }

      // 전사 통계 데이터 처리 (서버에서 마스킹/집계된 통계 객체 직접 매핑)
      if (statsRes && statsRes.ok) {
        const statsData = await statsRes.json();
        setStockUsage(statsData.stockUsage || {}); 
        setAllResponses(statsData.participation || {}); // { [surveyId]: number (제출자 수) }
      } else {
        alert('⚠️ 전사 참여율 및 재고 정보를 동기화하지 못했습니다.');
      }
  
        if (surveyRes.ok) {
          const loadedSurveys = await surveyRes.json();
          setSurveys(loadedSurveys);
          
          const serverNudged = loadedSurveys
            .filter((s: any) => s.nudgedUsers && s.nudgedUsers.includes(userData?.email))
            .map((s: any) => s.id);
          setNudgedSurveys(serverNudged);
        } else {
          setSurveys([]);
        }
     
      } catch (error) {
        console.error("Dashboard Sync Error:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
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
     
  // 💡 [원인 해결] 전역 공통 KST 함수 적용
  const todayStr = getKSTDateString();
    
  const visibleSurveys = useMemo(() => surveys.filter(s => s.status === '진행중' || s.status === '완료'), [surveys]);
   
  const filteredSurveys = useMemo(() => {
    if (filterClosingToday) {
      return visibleSurveys.filter(s => s.status === '진행중' && s.endDate === todayStr);
    }
    if (filterNudged) {
      return visibleSurveys.filter(s => { 
        const isTargeted = currentUser?.roles?.includes('LV_1') || checkHierarchyTarget(s.target, currentUser?.unit?.unit_name); 
        return s.status === '진행중' && isTargeted && !myResponses[s.id] && nudgedSurveys.includes(s.id); 
      });
    }
    if (filterPending) {
      return visibleSurveys.filter(s => { 
        const isTargeted = currentUser?.roles?.includes('LV_1') || checkHierarchyTarget(s.target, currentUser?.unit?.unit_name); 
        return s.status === '진행중' && isTargeted && !myResponses[s.id]; 
      });
    }
    return visibleSurveys;
  }, [visibleSurveys, filterPending, filterNudged, filterClosingToday, myResponses, currentUser, unitsList, nudgedSurveys, todayStr]);
     
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
    const survey = introModalSurvey;
    
    // 🚀 [핵심 안정화]: 안전한 키 생성 및 찌꺼기 삭제
    const safeEmail = currentUserEmail || 'unknown_user';
    const draftKey = `survey_draft_${survey.id}_${safeEmail}`;
    const draftRaw = localStorage.getItem(draftKey);
    
    if (draftRaw) {
      try {
        const draft = JSON.parse(draftRaw);
        if (draft.updatedAt === survey.updatedAt) {
          if (confirm('💾 이전에 작성 중이던 임시 저장 내역이 있습니다.\n이어서 작성하시겠습니까?')) {
            setFormData(draft.answers || {});
          } else {
            localStorage.removeItem(draftKey); // 🧹 찌꺼기 삭제
            setFormData({});
          }
        } else {
          console.warn("설문 내용이 변경되어 기존 임시 저장 데이터를 초기화합니다.");
          setFormData({});
          localStorage.removeItem(draftKey);
        }
      } catch (e) {
        setFormData({});
        localStorage.removeItem(draftKey); // 🛡️ 파싱 에러 방어
      }
    } else {
      setFormData({});
    }
     
    let questions = [];
    try {
      questions = typeof survey.questions === 'string' 
        ? JSON.parse(survey.questions) 
        : (survey.questions || []);
    } catch (e) {
      console.error("문항 파싱 오류:", e);
    }
    
    if (questions.length > 0 && questions[0].type !== 'SECTION') setCurrentSectionId(null);
    else {
      const firstSection = questions.find((q: any) => q.type === 'SECTION');
      if (firstSection) setCurrentSectionId(firstSection.id);
    }
     
    setActiveFullScreenSurvey({ ...survey, questions });
    setIntroModalSurvey(null);
  };
     
  const handleSaveDraft = () => {
    if (!activeFullScreenSurvey) return;
    const safeEmail = currentUserEmail || 'unknown_user';
    try {
      const payload = {
        updatedAt: activeFullScreenSurvey.updatedAt,
        answers: formData
      };
      localStorage.setItem(`survey_draft_${activeFullScreenSurvey.id}_${safeEmail}`, JSON.stringify(payload));
      alert('💾 현재까지 작성한 설문 내용이 안전하게 임시 저장되었습니다.');
    } catch (e) {
      alert('⚠️ 첨부된 파일의 용량이 초과되어 임시 저장이 제한됩니다.');
    }
  };
     
  const handleSubmitForm = async () => {
    // 🚀 [보안] 제출 시점 재검증
    if (activeFullScreenSurvey.status === '완료' || isPastKSTDeadline(activeFullScreenSurvey.endDate, activeFullScreenSurvey.endTime)) {
      alert('❌ 기한이 만료되었거나 관리자에 의해 마감 처리되어 제출할 수 없습니다.');
      setActiveFullScreenSurvey(null);
      return;
    }

    // 🚀 분기 경로 문항만 검증 (단일/다중선택·주소 goToSectionId 포함)
    const visibleQuestions = getVisibleQuestionsByBranch(
      activeFullScreenSurvey.questions || [],
      formData,
      'general'
    );

    for (const q of visibleQuestions) {
      if (q.type === 'SECTION' || !q.isRequired) continue;

      if (q.type === 'SEARCH_ADDRESS') {
        if (!formData[q.id]?.zipCode || !formData[q.id]?.roadAddress || !formData[q.id]?.detailAddress) {
          return alert(`📍 [${q.title}]의 우편번호 및 상세주소를 완벽히 기입해 주세요.`);
        }
      } else if (q.type === 'FILE') {
        if (!formData[q.id]?.fileName) {
          return alert(`📎 [${q.title}]에 필수 파일을 첨부해 주세요.`);
        }
      } else if (!formData[q.id] || formData[q.id].length === 0) {
        return alert(`✏️ [${q.title}] 문항은 필수 응답 사항입니다. 답변을 채워주세요.`);
      }
    }
    if (!confirm('설문 응답을 최종 제출하시겠습니까?\n제출 후에는 게시 마감전까지 나의 참여 이력에서 수정할 수 있습니다.')) return;
     
    try {
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_RESPONSE',
          surveyId: activeFullScreenSurvey.id,
          userEmail: currentUserEmail,
          answers: formData
        })
      });
     
      if (res.ok) {
        const submittedDate = `${todayStr} ${getKSTTimeString()}`;
        
        // 이 설문에 이미 제출했었는지 여부 확인 (수정 제출 시 중복 카운팅 방지)
        const isAlreadySubmitted = Boolean(myResponses[activeFullScreenSurvey.id]);
        
        // 1. 내 응답 상태 갱신
        const nextResponses = { ...myResponses, [activeFullScreenSurvey.id]: { submittedAt: submittedDate, answers: formData } };
        setMyResponses(nextResponses);
        
        // 2. 낙관적 업데이트 (참여 인원 카운트 즉시 1 증가, 수정 제출인 경우 유지)
        setAllResponses(prev => ({
          ...prev,
          [activeFullScreenSurvey.id]: (prev[activeFullScreenSurvey.id] || 0) + (isAlreadySubmitted ? 0 : 1)
        }));
        
        const safeEmail = currentUserEmail || 'unknown_user';
        localStorage.removeItem(`survey_draft_${activeFullScreenSurvey.id}_${safeEmail}`); 
        alert(`✅ 정상적으로 제출되었습니다.\n설문 참여에 감사드립니다.`);
        setActiveFullScreenSurvey(null); 
        
        // 3. 🚀 백그라운드 연동 (재고 최신화 + 참여율 원장 실시간 수신 및 동기화)
        fetch('/api/survey/general', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_STATS' }),
          cache: 'no-store'
        })
        .then(r => r.ok ? r.json() : null)
        .then(statsData => {
          if (statsData) {
            if (statsData.stockUsage) setStockUsage(statsData.stockUsage);
            if (statsData.participation) setAllResponses(statsData.participation); // participation(건수)도 함께 갱신!
          }
        })
        .catch(e => console.error("통계 동기화 실패", e));

      } else {
        alert('❌ 서버 데이터 제출 처리에 실패했습니다.');
      }
    } catch (error) {
      console.error(error);
      alert('❌ 네트워크 통신 오류가 발생했습니다.');
    }
  };
     
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
            <button onClick={() => { if (stats.myPendingCount === 0) return alert('미참여 대기 설문이 없습니다.'); setFilterPending(!filterPending); setFilterNudged(false); setFilterClosingToday(false); }} className={`shrink-0 text-[10px] font-black px-4 py-2 rounded-xl transition-all border shadow-sm ${filterPending ? 'bg-white text-indigo-700 border-white' : 'bg-white/20 hover:bg-white/30 text-white border-white/20'}`}>{filterPending ? '전체 목록 ↺' : '대상만 보기 →'}</button>
          </div>
        </div>
        <div className="xl:w-3/5 flex flex-col md:flex-row gap-4">
          <div className="flex-1 bg-white border border-slate-200 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px]">
            <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">진행 중 조사</p><h3 className="text-3xl font-black text-slate-800 mt-1">{stats.ongoingCount} <span className="text-sm font-bold text-slate-400">건</span></h3></div><div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">📝</div>
          </div>
          
          <div onClick={() => { if (stats.closingTodayCount === 0) return alert('오늘 마감이 임박한 조사가 없습니다.'); setFilterClosingToday(!filterClosingToday); setFilterPending(false); setFilterNudged(false); }} className={`flex-1 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px] cursor-pointer transition-all border-2 ${filterClosingToday ? 'bg-red-50 border-red-400 scale-[1.02] shadow-lg' : 'bg-white border-slate-200 hover:border-red-200 hover:bg-red-50/30'}`}>
            <div><p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">오늘 마감</p><h3 className="text-3xl font-black text-red-600 mt-1">{stats.closingTodayCount} <span className="text-sm font-bold text-red-300">건</span></h3></div><div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all ${filterClosingToday ? 'bg-red-500 text-white animate-pulse' : 'bg-red-50'}`}>⏰</div>
          </div>
          
          <div onClick={() => { if (stats.nudgeCount === 0) return alert('접수된 참여 요청 건이 없습니다.'); setFilterNudged(!filterNudged); setFilterPending(false); setFilterClosingToday(false); }} className={`flex-1 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px] cursor-pointer transition-all border-2 ${filterNudged ? 'bg-red-500 border-red-600 scale-[1.02] shadow-lg' : 'bg-white border-red-100 hover:border-red-300 hover:bg-red-50/30'}`}>
            <div><p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${filterNudged ? 'text-red-100' : 'text-red-400'}`}>참여 요청</p><h3 className={`text-3xl font-black mt-1 ${filterNudged ? 'text-white' : 'text-red-600'}`}>{stats.nudgeCount} <span className={`text-sm font-bold ${filterNudged ? 'text-red-200' : 'text-red-300'}`}>건</span></h3></div>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all ${filterNudged ? 'bg-red-600 text-white' : stats.nudgeCount > 0 ? 'bg-red-50 animate-bounce shadow-md' : 'bg-slate-50 text-slate-300 grayscale opacity-50'}`}>🚨</div>
          </div>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
      <div className="p-6 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-sm font-black text-white flex items-center gap-2"><span className="text-blue-500">●</span> {filterNudged ? '🚨 참여 요청 내역' : filterClosingToday ? '⏰ 오늘 마감 설문' : '진행 중인 전사 설문 리스트'}</h3>
          <div className="flex items-center gap-2">
            {filterPending && <span className="text-[10px] font-black bg-indigo-500 text-white px-2 py-0.5 rounded-full border border-indigo-600 animate-pulse">대상 내역 표시 중</span>}
            {filterNudged && <span className="text-[10px] font-black bg-red-500 text-white px-2 py-0.5 rounded-full border border-red-600 animate-pulse">독촉 건만 표시 중</span>}
            {filterClosingToday && <span className="text-[10px] font-black bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-200 animate-pulse">오늘 마감 건 표시 중</span>}
            
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
                
               // 🚀 [여기로 교체] 프론트엔드의 대상자 계산(total) + 서버의 안전한 참여자 수(done) 결합
               let total = 0;
               if (allUsers.length > 0) {
                 const targetUsers = allUsers.filter(u => checkHierarchyTarget(s.target, u.dept));
                 total = targetUsers.length;
               }
               const done = allResponses[s.id] || 0; // 서버에서 안전하게 받아온 숫자
               const rate = total > 0 ? Math.round((done / total) * 100) : 0;

                const isSubmitted = Boolean(myResponses[s.id]);
                const isTargeted = currentUser?.roles?.includes('LV_1') || checkHierarchyTarget(s.target, currentUser?.unit?.unit_name);
                const nudgedSurveysList = nudgedSurveys || [];
                const isNudged = isTargeted && !isSubmitted && nudgedSurveysList.includes(s.id);
  
                // 💡 [KST 마감·D-day 계산]
                const isTimeOver = isPastKSTDeadline(s.endDate, s.endTime);
                const isClosed = s.status === '완료' || isTimeOver;
                const pureDaysDiff = getKSTDaysUntil(s.endDate);
                
                let dDayText = null;
                if (!isClosed) {
                  if (pureDaysDiff === 0) dDayText = "D-Day";
                  else if (pureDaysDiff > 0 && pureDaysDiff <= 3) dDayText = `D-${pureDaysDiff}`;
                }
                const isUrgent = dDayText !== null;
     
                return (
                  <tr 
                    key={s.id} 
                    className={`transition-all ${
                      !isTargeted 
                        ? 'bg-slate-50 opacity-40 cursor-not-allowed grayscale' 
                        : isClosed 
                          ? 'bg-slate-100/70 opacity-50 grayscale text-slate-400' 
                          : isNudged 
                            ? 'bg-red-50/40 hover:bg-red-50' 
                            : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <td className="text-center text-slate-400 font-black pl-8 py-4">{idx + 1}</td>
                    <td className="text-center font-black text-slate-600 px-2 py-4">{s.postNumber}</td>
                    <td className="text-center font-mono text-slate-500 px-3 py-4 whitespace-nowrap">{s.postDate || '-'}</td>
                    
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1 items-start">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => isTargeted && !isSubmitted && !isClosed && handleOpenIntro(s)} 
                            className={`font-black text-[12px] text-left line-clamp-1 ${!isTargeted || isClosed || isSubmitted ? 'text-slate-400 cursor-not-allowed' : 'text-slate-800 hover:text-blue-600 hover:underline'}`}
                            disabled={!isTargeted || isSubmitted || isClosed}
                          >
                            {s.title}
                          </button>
                          
                          {dDayText && (
                            <span className="shrink-0 bg-red-600 text-white text-[8px] px-1.5 py-0.5 rounded font-black animate-pulse">
                              {dDayText}
                            </span>
                          )}
                          
                          {isClosed && <span className="shrink-0 bg-slate-500 text-white text-[8px] px-1.5 py-0.5 rounded font-black">종료됨</span>}
                        </div>
                        {isNudged && !isClosed && (
                          <span className="inline-block bg-red-100 text-red-600 border border-red-200 text-[8px] px-2 py-0.5 rounded shadow-sm font-black animate-pulse">🚨 관리자 참여 요청</span>
                        )}
                      </div>
                    </td>
                    
                    <td className="text-center py-4 px-3">
                      <span className={`px-2 py-0.5 border text-[10px] rounded ${s.isAnonymous ? 'bg-slate-700 text-white font-black border-slate-900' : 'text-slate-400 border-slate-200'}`}>{s.isAnonymous ? '익명' : '기명'}</span>
                    </td>
                    
                    <td className="px-3 py-4 text-center text-slate-600 font-medium whitespace-normal break-keep leading-relaxed">{s.target}</td>
                    
                    <td className="text-center text-slate-500 text-[10px] px-3 py-4">
                      <div>{s.startDate} ~</div>
                      <div className={isClosed ? 'text-red-400 font-bold' : isUrgent ? 'text-red-500 font-black' : ''}>
                        {s.endDate} <span className="text-[8px]">({s.endTime || '23:59'})</span>
                      </div>
                    </td>
                    
                    <td className="text-center font-black text-slate-700 px-2 py-4">{rate}%</td>
                    <td className="text-center font-black text-blue-600 px-2 py-4">{done}명</td>
                    <td className="text-center font-black text-red-500 px-2 py-4">{total - done}명</td>
                    
                    <td className="text-center pr-8 py-4">
                      {!isTargeted ? (
                        <button disabled className="px-4 py-1.5 rounded-lg font-black text-[10px] bg-slate-200 text-slate-500 cursor-not-allowed">🚫 대상아님</button>
                      ) : isSubmitted ? (
                        <button onClick={() => alert(`✅ 제출 내역 정보: ${myResponses[s.id].submittedAt}`)} className="px-3 py-1.5 rounded-lg font-black text-[10px] bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100/50">📬 제출완료</button>
                      ) : isClosed ? (
                        <button disabled className="px-4 py-1.5 rounded-lg font-black text-[10px] bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed">
                          {s.status === '완료' ? '🔒 마감됨' : '⏰ 기간종료'}
                        </button>
                      ) : (
                        <button 
                          onClick={() => handleOpenIntro(s)} 
                          className={`px-4 py-1.5 rounded-lg font-black text-[10px] shadow-sm transition-all ${isNudged ? 'bg-red-600 text-white hover:bg-red-700 animate-bounce' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                        >
                          {isNudged ? '🔥참여요청' : '📥 미참여'}
                        </button>
                      )}
                    </td>
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
            <p className="text-sm font-bold text-slate-500 bg-slate-50 p-4 rounded-xl w-full leading-relaxed mb-8 border border-slate-100 whitespace-pre-wrap text-left">
              {introModalSurvey.description || '본 설문조사에 참여하여 의견을 남겨주세요.'}
            </p>
            <div className="flex gap-3 w-full">
              <button onClick={() => setIntroModalSurvey(null)} className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black transition-colors">닫기</button>
              <button onClick={handleStartSurvey} className="flex-[2] py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black shadow-lg transition-colors text-[13px]">🚀 설문 응답 제출하기</button>
            </div>
          </div>
        </div>
      )}
     
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
     
          <div className="flex-1 w-full max-w-[800px] mx-auto py-10 px-4 pb-32 space-y-6 relative">
            {zoomedImage && (
              <div className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm p-4 cursor-zoom-out animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
                <div className="relative max-w-5xl max-h-[90vh] flex items-center justify-center">
                  <img src={zoomedImage} alt="Zoomed Area" className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl cursor-default" onClick={(e) => e.stopPropagation()} />
                  <button className="absolute -top-12 right-0 text-white font-black text-lg bg-black/40 hover:bg-black/80 w-9 h-9 rounded-full flex items-center justify-center transition-colors" onClick={() => setZoomedImage(null)}>✕</button>
                </div>
              </div>
            )}
            
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
                    {q.questionImageUrl && (
                      <img 
                        src={q.questionImageUrl} 
                        alt="guide" 
                        onClick={() => setZoomedImage(q.questionImageUrl)} 
                        className="mt-3 max-h-40 rounded-xl object-contain border cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all hover:scale-[1.01]" 
                        title="클릭하면 크게 보실 수 있습니다."
                      />
                    )}
                  </div>
     
                  {q.type === 'CHOICE_SINGLE' && (
                    <div className="space-y-2 pt-1">
                      {q.options?.map((opt: any, oIdx: number) => {
                        const limit = opt.stockLimit;
                        const usedCount = stockUsage[activeFullScreenSurvey.id]?.[`${q.id}_${opt.label}`] || 0;
                        const isStockLimited = limit !== undefined && limit !== null && limit !== '';
                        const remaining = isStockLimited ? Number(limit) - usedCount : null;
                        const isOutOfStock = isStockLimited && remaining! <= 0;
                        const isChecked = formData[q.id] === opt.label;
                        
                        return (
                          <label key={oIdx} className={`flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl transition-colors ${
                            isOutOfStock 
                            ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed grayscale select-none' 
                            : isChecked ? 'border-blue-500 bg-blue-50/30 cursor-pointer' : 'border-slate-200 hover:bg-blue-50/40 cursor-pointer'
                          }`}>
                            <input type="radio" name={q.id} disabled={isOutOfStock} checked={isChecked} onChange={() => {
                              handleInputChange(q.id, opt.label);
                              if (opt.goToSectionId) {
                                if (opt.goToSectionId === 'SUBMIT') {
                                  // 🚀 즉시 제출 분기 (마지막 섹션인 것처럼 트릭 부여 후 제출 함수 호출 유도)
                                  setTimeout(() => handleSubmitForm(), 100); 
                                } else {
                                  setCurrentSectionId(opt.goToSectionId);
                                }
                              }
                            }} className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" />
                            <div className="flex flex-col flex-1">
                              <span className={`font-bold ${isOutOfStock ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{opt.label}</span>
                              {isOutOfStock ? (
                                <span className="text-[10px] w-fit mt-1 font-black bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded shadow-sm animate-pulse">SOLD OUT</span>
                              ) : isStockLimited ? (
                                <span className="text-[10px] w-fit mt-1 font-black text-pink-600 bg-pink-50 border border-pink-100 px-1.5 py-0.5 rounded shadow-sm">잔여: {remaining}개</span>
                              ) : null}
                              {opt.referenceLink && <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5 w-fit" onClick={e => e.stopPropagation()}>🔗 상세 명세 링크</a>}
                              {opt.imageUrl && (
                                <img 
                                  src={opt.imageUrl} 
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setZoomedImage(opt.imageUrl); }} 
                                  className="mt-2 max-h-24 object-contain rounded border bg-white w-fit cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all hover:scale-[1.02]" 
                                  title="클릭하면 크게 보실 수 있습니다."
                                />
                              )}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
     
                  {q.type === 'CHOICE_MULTI' && (
                    <div className="space-y-2 pt-1">
                      {q.options?.map((opt: any, oIdx: number) => {
                        const limit = opt.stockLimit;
                        const usedCount = stockUsage[activeFullScreenSurvey.id]?.[`${q.id}_${opt.label}`] || 0;
                        const isStockLimited = limit !== undefined && limit !== null && limit !== '';
                        const remaining = isStockLimited ? Number(limit) - usedCount : null;
                        const isOutOfStock = isStockLimited && remaining! <= 0;
                        const isChecked = (formData[q.id] || []).includes(opt.label);
                        
                        return (
                          <label key={oIdx} className={`flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl transition-colors ${
                            isOutOfStock 
                            ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed grayscale select-none' 
                            : isChecked ? 'border-blue-500 bg-blue-50/30 cursor-pointer' : 'border-slate-200 hover:bg-blue-50/40 cursor-pointer'
                          }`}>
                            <input type="checkbox" disabled={isOutOfStock} checked={isChecked} onChange={(e) => handleCheckboxChange(q.id, opt.label, e.target.checked)} className="w-3.5 h-3.5 accent-blue-600 rounded" />
                            <div className="flex flex-col flex-1">
                              <span className={`font-bold ${isOutOfStock ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{opt.label}</span>
                              {isOutOfStock ? (
                                <span className="text-[10px] w-fit mt-1 font-black bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded shadow-sm animate-pulse">SOLD OUT</span>
                              ) : isStockLimited ? (
                                <span className="text-[10px] w-fit mt-1 font-black text-pink-600 bg-pink-50 border border-pink-100 px-1.5 py-0.5 rounded shadow-sm">잔여: {remaining}개</span>
                              ) : null}
                              {opt.referenceLink && <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5 w-fit" onClick={e => e.stopPropagation()}>🔗 관련 링크</a>}
                              {opt.imageUrl && (
                                <img 
                                  src={opt.imageUrl} 
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setZoomedImage(opt.imageUrl); }} 
                                  className="mt-2 max-h-24 object-contain rounded border bg-white w-fit cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all hover:scale-[1.02]" 
                                  title="클릭하면 크게 보실 수 있습니다."
                                />
                              )}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
     
                  {q.type === 'TEXT_SHORT' && <input type="text" value={formData[q.id] || ''} onChange={(e) => handleInputChange(q.id, e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-bold bg-slate-50 focus:bg-white text-xs" placeholder="답변 내용을 작성해 주세요." />}
                  {q.type === 'TEXT_LONG' && <textarea value={formData[q.id] || ''} onChange={(e) => handleInputChange(q.id, e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-bold bg-slate-50 focus:bg-white text-xs min-h-[100px] whitespace-pre-wrap" placeholder="세부적인 의견을 여러 줄로 입력하실 수 있습니다." />}
                  
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
                <button type="button" onClick={handleSubmitForm} className="flex-1 py-3.5 bg-slate-900 text-white font-black text-xs rounded-xl shadow-lg hover:bg-black transition-all">💾 최종 답변서 제출하기</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}