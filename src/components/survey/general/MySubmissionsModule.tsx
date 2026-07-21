'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { saveAs } from 'file-saver';
import { getKSTDateString, getKSTTimeString, formatKSTDateTime, isPastKSTDeadline, getKSTDaysUntil } from '@/utils/dateUtils';
import {
  resolveBranchTarget,
  getVisibleQuestionsByBranch,
  buildSectionHistoryFromAnswers,
  getParentSectionId as getParentSectionIdShared,
} from '@/utils/surveyBranching';
     
// 🚀 [UI 표준 지침] 전사 공통 Header 컴포넌트 분리 선언
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-xs font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);
  
export default function MySubmissionsModule() {  
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageConfig, setPageConfig] = useState<any>(null);
  
  const [surveys, setSurveys] = useState<any[]>([]);
  const [myResponses, setMyResponses] = useState<Record<string, any>>({}); 
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  
  const [activeFullScreenSurvey, setActiveFullScreenSurvey] = useState<any | null>(null);
  const [viewSurveyHistory, setViewSurveyHistory] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  // 🚀 [추가] 사용자가 거쳐온 섹션 히스토리 추적 스택 (이전 단계 복구용 및 분기 검증용)
  const [sectionHistory, setSectionHistory] = useState<(string | null)[]>([]);

  const getParentSectionId = (q: any, questions: any[]) => getParentSectionIdShared(q, questions);
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);
  
  const [historyYear, setHistoryYear] = useState<string>('ALL');
  const [eligiblePage, setEligiblePage] = useState<number>(1);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const itemsPerPage = 5;
     
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
     
  const [stockUsage, setStockUsage] = useState<Record<string, Record<string, number>>>({});


     
  useEffect(() => {
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
        const [userRes, unitsRes, configRes, surveyRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/interface?t=${ts}`).catch(() => null),
          fetch(`/api/survey/general?t=${ts}`, { cache: 'no-store' })
        ]);
        
        const userData = userRes.ok ? await userRes.json() : null;
        const unitsData = unitsRes.ok ? await unitsRes.json() : [];
        setUnitsList(unitsData);
     
        if (configRes && configRes.ok) {
          const interfaces = await configRes.json();
          const config = interfaces.find((m: any) => m.path === '/survey/general/my-submissions');
          if (config) setPageConfig(config);
        }
  
        if (userData) {
          const myUnit = unitsData.find((u: any) => u.id === userData.dept_id);
          userData.unit = myUnit || { unit_name: '소속없음' };
          setCurrentUser(userData);
          
          // 🚀 1. 내 제출 내역 조회
          const respRes = await fetch('/api/survey/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'GET_RESPONSES' }),
            cache: 'no-store'
          }).catch(() => null);

          // 🚀 2. 전사 실제 안전 소진율 통계 조회 (GET_STATS 연동 완료)
          const statsRes = await fetch('/api/survey/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'GET_STATS' }),
            cache: 'no-store'
          }).catch(() => null);
          
          if (respRes && respRes.ok) {
            const dbResponses = await respRes.json();
            const nextMyRes: Record<string, any> = {};
            
            dbResponses.forEach((r: any) => {
              if (r.userEmail === userData.email) {
                nextMyRes[r.surveyId] = {
                  submittedAt: r.submittedAt ? formatKSTDateTime(r.submittedAt) : '-',
                  answers: r.answers || {},
                  isApproved: r.isApproved || false
                };
              }
            });
            setMyResponses(nextMyRes);
          } else {
            alert('⚠️ 나의 이전 제출 정보를 가져오지 못했습니다.');
          }

          if (statsRes && statsRes.ok) {
            const statsData = await statsRes.json();
            setStockUsage(statsData.stockUsage || {}); // 실시간 전사 품절 현황의 안전한 동기화 완료
          } else {
            alert('⚠️ 실시간 상품 재고 통계 현황을 동기화하지 못했습니다.');
          }
        }
  
        if (surveyRes.ok) {
          setSurveys(await surveyRes.json());
        } else {
          setSurveys([]);
        }
  
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
    return surveys.filter(s => {
      const myRes = myResponses[s.id];
      if (!myRes) return false;
      if (myRes.isApproved) return false; 
      
      // 💡 [수정] 오직 관리자가 '완료'나 '보관됨' 처리한 것만 제외 (시간 만료는 리스트에 남김)
      if (s.status === '완료' || s.status === '보관됨') return false;
      
      return currentUser?.roles?.includes('LV_1') || checkHierarchy(s.target, currentUser?.unit?.unit_name);
    }).sort((a, b) => new Date(b.postDate).getTime() - new Date(a.postDate).getTime());
  }, [surveys, currentUser, unitsList, myResponses]);
     
  const historyList = useMemo(() => {
    return surveys.filter(s => {
      const myRes = myResponses[s.id];
      if (!myRes) return false;
      if (myRes.isApproved) return true;
      if (s.status === '진행중' || s.status === '게시중단') return false;
      
      // 💡 [수정] 관리자가 명시적으로 마감(완료/보관됨) 처리한 것만 보관함으로 이동
      return s.status === '완료' || s.status === '보관됨';
    }).map(s => ({
      ...s,
      submittedAt: myResponses[s.id].submittedAt,
      myAnswers: myResponses[s.id].answers,
      isApproved: myResponses[s.id].isApproved
    })).sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt));
  }, [surveys, myResponses]);
     
  const availableYears = useMemo(() => {
    const years = historyList.map(s => s.submittedAt?.split('-')[0]).filter(Boolean);
    return Array.from(new Set(years)).sort((a, b) => Number(b) - Number(a));
  }, [historyList]);

  const filteredHistory = useMemo(() => historyList.filter(survey => historyYear === 'ALL' || survey.submittedAt.split('-')[0] === historyYear), [historyList, historyYear]);
  const paginatedEligible = useMemo(() => eligibleSurveys.slice((eligiblePage - 1) * itemsPerPage, eligiblePage * itemsPerPage), [eligibleSurveys, eligiblePage]);
  const paginatedHistory = useMemo(() => filteredHistory.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage), [filteredHistory, historyPage]);
     
  const totalEligiblePages = Math.ceil(eligibleSurveys.length / itemsPerPage);
  const totalHistoryPages = Math.ceil(filteredHistory.length / itemsPerPage);
  
  const handleOpenSurvey = (survey: any, isEditMode: boolean) => {
    if (isEditMode && survey.isAnonymous) return alert('🔒 본 설문조사는 익명 보안 서식입니다. 제출 완료 후 답변 수정이 불가능합니다.');
    
    let initialAnswers: Record<string, any> = {};

    if (isEditMode) {
      initialAnswers = myResponses[survey.id]?.answers || {};
    } else {
      const safeEmail = currentUser?.email || 'unknown_user';
      const draftKey = `survey_draft_${survey.id}_${safeEmail}`;
      const draftRaw = localStorage.getItem(draftKey);
      
      if (draftRaw) {
        try {
          const parsed = JSON.parse(draftRaw);
          const answers = (parsed && typeof parsed === 'object' && 'answers' in parsed) ? parsed.answers : parsed;
          
          if (confirm('💾 이전에 작성 중이던 임시 저장 내역이 있습니다.\n이어서 작성하시겠습니까?')) {
            initialAnswers = answers || {};
          } else {
            localStorage.removeItem(draftKey);
            initialAnswers = {};
          }
        } catch (e) {
          console.error("로컬 스토리지 데이터 오염 감지, 초기화 진행", e);
          initialAnswers = {};
          localStorage.removeItem(draftKey);
        }
      }
    }

    setFormData(initialAnswers);
    
   let questions = [];
   try {
     questions = typeof survey.questions === 'string' 
       ? JSON.parse(survey.questions) 
       : (survey.questions || []);
   } catch (e) {
     console.error("문항 파싱 오류:", e);
   }
    
   const sectionsOrder: (string | null)[] = [];
   if (questions.length > 0 && questions[0].type !== 'SECTION') sectionsOrder.push(null);
   questions.filter((q: any) => q.type === 'SECTION').forEach((s: any) => sectionsOrder.push(s.id));
   
   // 🚀 수정/임시저장: 답변으로 분기 경로(sectionHistory) 복원 · 신규: 첫 섹션만
   const hasLoadedAnswers = Object.keys(initialAnswers).length > 0;
   if (hasLoadedAnswers) {
     const restored = buildSectionHistoryFromAnswers(questions, initialAnswers, 'general');
     const history = restored.length > 0
       ? restored
       : (sectionsOrder.length > 0 ? [sectionsOrder[0]] : []);
     setSectionHistory(history);
     setCurrentSectionId(history[history.length - 1] ?? null);
   } else {
     const initialSection = sectionsOrder.length > 0 ? sectionsOrder[0] : null;
     setCurrentSectionId(initialSection);
     setSectionHistory(sectionsOrder.length > 0 ? [sectionsOrder[0]] : []);
   }
      
    setActiveFullScreenSurvey({ ...survey, questions, isEditMode });
  };
  
  const handleSaveDraft = () => {
    if (!activeFullScreenSurvey) return; // 🚀 가드 추가
    try {
      const payload = {
        updatedAt: activeFullScreenSurvey.updatedAt,
        answers: formData
      };
      const safeEmail = currentUser?.email || 'unknown_user';
      localStorage.setItem(`survey_draft_${activeFullScreenSurvey.id}_${safeEmail}`, JSON.stringify(payload));
      alert('💾 작성 중인 내용이 안전하게 임시 저장되었습니다.');
    } catch (e) {
      alert('⚠️ 파일 첨부 용량 초과로 임시 저장이 실패했습니다. (파일을 제외한 기입 내용만 임시 저장됩니다)');
    }
  };
  
// 🚀 [추가]: 다단계 분기 가드를 반영한 고도화 네비게이션 컨트롤러
const handleNextSection = () => {
  const activeQuestions = activeFullScreenSurvey?.questions || [];
  
  // 1. 현재 소속된 섹션 문항들에 대한 즉석 필수 검증 (중도 방지)
  const currentSectionQuestions = activeQuestions.filter((q: any) => {
    if (q.type === 'SECTION') return false;
    return getParentSectionId(q, activeQuestions) === currentSectionId;
  });

  for (const q of currentSectionQuestions) {
    if (q.isRequired) {
      if (q.type === 'SEARCH_ADDRESS') {
        if (!formData[q.id]?.zipCode || !formData[q.id]?.roadAddress || !formData[q.id]?.detailAddress) {
          return alert(`📍 [${q.title}]의 우편번호 및 상세주소를 입력해 주세요.`);
        }
      } else if (q.type === 'FILE') {
        if (!formData[q.id]?.fileName) {
          return alert(`📎 [${q.title}]에 필수 서식을 첨부해 주세요.`);
        }
      } else if (!formData[q.id] || formData[q.id].length === 0) {
        return alert(`✏️ [${q.title}] 문항은 필수 응답 항목입니다.`);
      }
    }
  }

  // 2. 분기(Jump): 단일/다중선택 옵션 + 주소·문항 레벨 goToSectionId
  let nextSecId: string | null = null;
  for (const q of currentSectionQuestions) {
    const target = resolveBranchTarget(q, formData, 'general');
    if (target) {
      nextSecId = target;
      break;
    }
  }

  // 분기가 없으면 순차 목록 이동
  if (!nextSecId) {
    const nextIdx = sectionsOrder.indexOf(currentSectionId) + 1;
    nextSecId = nextIdx < sectionsOrder.length ? sectionsOrder[nextIdx] : 'SUBMIT';
  }

  if (nextSecId === 'SUBMIT') {
    if (confirm('🏁 분기 조건에 따라 더 이상 진행할 단계가 없습니다. 이대로 최종 답변서를 제출하시겠습니까?')) {
      handleSubmitForm();
    }
    return;
  }

  if (nextSecId) {
    setCurrentSectionId(nextSecId);
    setSectionHistory(prev => [...prev, nextSecId]);
  }
};

const handlePrevSection = () => {
  if (sectionHistory.length <= 1) return;
  const updatedHistory = [...sectionHistory];
  updatedHistory.pop(); // 현재 내역 탈출
  const prevSecId = updatedHistory[updatedHistory.length - 1];
  setCurrentSectionId(prevSecId);
  setSectionHistory(updatedHistory); // 이전 흔적으로 안전 워프
};

  const handleSubmitForm = async () => {
    // 🚀 답변 기준 분기 경로로 검증 (수정 모드 sectionHistory 미복원 오차단/검증 누락 방지)
    const visibleQuestions = getVisibleQuestionsByBranch(
      activeFullScreenSurvey.questions || [],
      formData,
      'general'
    ).filter((q: any) => q.type !== 'SECTION');

    for (const q of visibleQuestions) {
      if (q.isRequired) {
        if (q.type === 'SEARCH_ADDRESS') {
          if (!formData[q.id]?.zipCode || !formData[q.id]?.roadAddress || !formData[q.id]?.detailAddress) {
            return alert(`📍 [${q.title}]의 우편번호 및 상세주소를 완벽히 기입해 주세요.`);
          }
        } else if (q.type === 'FILE') {
          if (!formData[q.id]?.fileName) {
            return alert(`📎 [${q.title}]에 필수 파일을 첨부해 주세요.`);
          }
        } else if (!formData[q.id] || formData[q.id].length === 0) {
          return alert(`✏️ [${q.title}] 문항은 필수 응답 항목입니다.`);
        }
      }
    }

    if (!confirm(activeFullScreenSurvey.isEditMode ? '답변 수정을 완료하시겠습니까?' : '설문을 최종 제출하시겠습니까?')) return;
  
    try {
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_RESPONSE',
          surveyId: activeFullScreenSurvey.id,
          userEmail: currentUser?.email,
          answers: formData
        })
      });
     
      if (res.ok) {
        const submittedDate = `${getKSTDateString()} ${getKSTTimeString()}`;
        const nextResponses = { 
          ...myResponses, 
          [activeFullScreenSurvey.id]: { submittedAt: submittedDate, answers: formData } 
        };
        
        setMyResponses(nextResponses);
        const safeEmail = currentUser?.email || 'unknown_user';
        localStorage.removeItem(`survey_draft_${activeFullScreenSurvey.id}_${safeEmail}`);
        
        alert('✅ 설문 응답 및 수정 사항이 시스템에 성공적으로 제출되었습니다.');
        setActiveFullScreenSurvey(null);
        
        // 🚀 [수정 완료]: 제출 후 내 응답(GET_RESPONSES)이 아닌 전사 재고 통계(GET_STATS)를 직접 호출하여 완벽 동기화
        fetch('/api/survey/general', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_STATS' }),
          cache: 'no-store'
        }).then(r => r.ok ? r.json() : null).then(statsData => {
          if (statsData && statsData.stockUsage) {
            setStockUsage(statsData.stockUsage);
          }
        }).catch(e => console.error("재고 동기화 실패", e));

      } else {
        alert('❌ 서버 제출 처리에 실패했습니다.');
      }
    } catch (error) {
      console.error(error);
      alert('❌ 네트워크 통신 오류가 발생했습니다.');
    }
  };
  
  const formatAnswerForView = (q: any, answers: any) => {
    if (!answers) return '응답 없음';
    if (q.type === 'SEARCH_ADDRESS') {
      const zip = answers[`${q.id}_zip`] || '';
      const road = answers[`${q.id}_road`] || '';
      const detail = answers[`${q.id}_detail`] || '';
      return zip ? `[${zip}] ${road} ${detail}` : '입력된 주소가 없습니다.';
    }
    if (q.type === 'CALENDAR') return answers[q.id] || '미지정';
    if (Array.isArray(answers[q.id])) return answers[q.id].join(', ');
    if (q.type === 'FILE') return answers[q.id]?.fileName || '첨부파일 없음';
    return answers[q.id] || '응답 없음';
  };
  
  // 🚀 [복구]: 누락되었던 섹션/페이지 렌더링용 핵심 변수 복구
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
      
{/* 🔵 [디자인 1원칙: 공통신청 = 파란색 테마 배너] 명함 신청 배너 구조 & 스타일 완벽 이식 */}
<div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[140px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden">
  <div className="relative z-10 flex justify-between items-end w-full">
    <div>
      {/* 1. 상단 라벨 (명함 배너와 매칭되는 텍스트 간격 mb-3) */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-3"> 
        MY ELIGIBLE SURVEYS & HISTORY
      </h3>
      
      {/* 2. 메인 타이틀 (명함 코너의 '부서 박스 + 이름 님 텍스트' 스타일 100% 싱크로) */}
      <h1 className="text-2xl font-black tracking-tight text-white leading-none flex items-center flex-wrap gap-2">
        {/* 🏢 소속 부서 뱃지 (명함 배너의 블루 박스 볼륨을 파란색 그라데이션용으로 투명도 커스텀) */}
        <span className="bg-white/10 border border-white/20 text-blue-100 px-4 py-2 rounded-2xl text-lg font-black tracking-tight shrink-0 shadow-sm">
          {currentUser?.unit?.unit_name || '조직'}
        </span>
        
        {/* 👤 사용자 이름 (명함의 text-slate-700 대비, 파란 배경에 맞춘 text-blue-100 톤 유지) */}
        <span className="text-blue-100 shrink-0">{currentUser?.name || '임직원'} 님</span>{' '}
        
        {/* 🎯 메인 타이틀 텍스트 */}
        <span className="text-white">나의 설문/조사 제출 내역</span>
      </h1>
      
      {/* 3. 하단 설명 (명함의 하단 현재 모드 문법 스타일 가독성 주입 - mt-4) */}
      <p className="text-blue-200 text-xs font-semibold mt-4 opacity-95 flex items-center gap-1">
        <span>현재 상태:</span>
        <span className="font-black text-white">
          ✨ 제출내역 조회 및 공고 마감 전 변경 가능 이력 확인 중
        </span>
      </p>
    </div>
  </div>
</div>
  
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <HeaderLight title="내가 제출한 설문 리스트" count={eligibleSurveys.length} />
  
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
                
                // 💡 1. KST 마감·D-day
                const rawTime = (survey.endTime || '').trim();
                const timeStr = rawTime === '' ? '23:59' : rawTime;
                const isTimeOver = typeof survey.endDate === 'string' && survey.endDate.includes('-')
                  ? isPastKSTDeadline(survey.endDate, timeStr)
                  : false;
                
                let dDayText = null;
                if (!isTimeOver && typeof survey.endDate === 'string') {
                  const pureDaysDiff = getKSTDaysUntil(survey.endDate);
                  if (pureDaysDiff === 0) dDayText = "D-Day";
                  else if (pureDaysDiff > 0 && pureDaysDiff <= 3) dDayText = `D-${pureDaysDiff}`;
                }
     
                return (
                  <tr key={survey.id} className={`transition-colors h-16 ${isTimeOver ? 'bg-slate-50/70 opacity-60 grayscale' : 'hover:bg-slate-50/50'}`}>
                    <td className="text-center text-slate-400 font-black pl-8">{eligibleSurveys.length - ((eligiblePage - 1) * itemsPerPage + index)}</td>
                    <td className="text-center font-mono text-slate-500">{survey.postNumber || '-'}</td>
                    <td className="text-center font-mono text-slate-500">{survey.postDate}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-3 h-16">
                        <span className={`font-black truncate ${isTimeOver ? 'text-slate-500' : 'text-slate-900'}`}>{survey.title}</span>
                        
                        {/* 💡 [표출방식 일치] D-Day는 빨강, D-1~D-3은 노랑으로 세분화 및 통일 */}
                        {dDayText && (
                          <span className={`shrink-0 text-[8px] px-1.5 py-0.5 rounded font-black animate-pulse ${
                            dDayText === 'D-Day' 
                              ? 'bg-red-600 text-white' 
                              : 'bg-amber-400 text-amber-950'
                          }`}>
                            {dDayText}
                          </span>
                        )}
                        {isTimeOver && <span className="shrink-0 bg-slate-500 text-white text-[8px] px-1.5 py-0.5 rounded font-black">종료됨</span>}
                      </div>
                    </td>
                    <td className="text-center"><span className={`px-2 py-0.5 border rounded text-[10px] ${survey.isAnonymous ? 'bg-slate-800 text-white font-black border-slate-950' : 'text-slate-400 border-slate-200'}`}>{survey.isAnonymous ? '익명' : '기명'}</span></td>
                    <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td>
                    <td className="text-center text-slate-700 font-bold px-4 whitespace-nowrap">{myResponses[survey.id]?.submittedAt || '-'}</td>
                    
                    {/* 💡 [기간 컬러 표기 일치] 마감 임박 상태에 맞춰 날짜 텍스트 컬러 완벽 매칭 */}
                    <td className="text-center font-mono text-slate-500 leading-relaxed whitespace-nowrap px-3">
                      <div>{survey.startDate} ~</div>
                      <div className={
                        isTimeOver ? 'text-slate-400 font-bold' 
                        : dDayText === 'D-Day' ? 'text-red-500 font-black' 
                        : dDayText ? 'text-amber-500 font-black' 
                        : 'text-slate-600'
                      }>
                        {survey.endDate} <span className="text-[8px]">({timeStr})</span>
                      </div>
                    </td>
                    
                    <td className="text-center pr-8">
                      {isTimeOver ? (
                        <button disabled className="w-full py-1.5 rounded-lg font-black text-[10px] shadow-sm border bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed">
                          ⏰ 기간종료 (수정불가)
                        </button>
                      ) : (
                        <button onClick={() => handleOpenSurvey(survey, true)} disabled={isAnonymousAndSubmitted} className={`w-full py-1.5 rounded-lg font-black text-[10px] transition-all shadow-sm border ${isAnonymousAndSubmitted ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed line-through' : 'bg-white border-blue-200 text-blue-600 hover:bg-blue-50'}`}>
                          {isAnonymousAndSubmitted ? '🔒 익명 서식 변경 불가' : '✏️ 답변 내역 수정'}
                        </button>
                      )}
                    </td>
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
     
{/* 📁 슬림 규격으로 압축한 참여 이력 보관함 토글 바 (다크 그레이 시인성 확보 버전) */}
<div 
  onClick={() => setIsHistoryOpen(!isHistoryOpen)} 
  className="w-full bg-slate-200 border border-slate-400 p-4 px-7 rounded-2xl shadow-sm mt-8 cursor-pointer hover:bg-slate-200/70 active:scale-[0.995] transition-all select-none flex items-center justify-between gap-6"
>
  <div className="flex items-center gap-4 flex-1 min-w-0">
    {/* 🎯 타이틀 & 펼치기 상태 뱃지 (기본 다크 그레이 text-slate-800 적용) */}
    <h2 className="text-base font-black tracking-tight text-slate-800 flex items-center gap-2.5 shrink-0">
      📁 나의 참여 이력 보관함
      <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md font-bold border border-slate-300">
        {isHistoryOpen ? '▲ 접기' : '▼ 펼치기'}
      </span>
    </h2>
    
    {/* 💡 구역 구분용 얇은 버티컬 라인 */}
    <div className="w-px h-3.5 bg-slate-300 shrink-0 hidden md:block" />
    
    {/* 📝 서브 설명 (기본 slate-500으로 처음부터 또렷하게 노출) */}
    <p className="text-slate-500 text-xs font-semibold opacity-90 truncate hidden md:block">
      공고 기한이 최종 마감되어 보관 처리된 설문/조사 결과 열람 전용 내역
    </p>
  </div>

  {/* 🚀 우측 영역 영문 라벨 */}
  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0 hidden sm:block">
    Archive Repository
  </p>
</div>
     
      {isHistoryOpen && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <HeaderLight title="과거 완료 설문 명세 대장" count={filteredHistory.length}>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <span className="text-slate-500">연도 필터 :</span>
              <select value={historyYear} onChange={(e) => { setHistoryYear(e.target.value); setHistoryPage(1); }} className="bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-1.5 font-black focus:outline-none focus:border-indigo-500 text-[11px] cursor-pointer shadow-sm transition-colors">
                <option value="ALL">전체 내역 보기</option>
                {/* 💡 하드코딩 제거: 데이터 기반 동적 연도 렌더링 */}
                {availableYears.map(year => (
                  <option key={year} value={year}>{year}년도</option>
                ))}
              </select>
            </div>
          </HeaderLight>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="py-4 pl-8 w-16 text-center">NO</th><th className="py-4 px-3 w-28 text-center">게시번호</th><th className="py-4 px-3 w-28 text-center">게시일</th><th className="py-4 px-4">게시명</th><th className="py-4 px-3 w-24 text-center">익명여부</th><th className="py-4 px-3 w-36 text-center">대상</th><th className="py-4 px-4 w-48 text-center">나의 제출 일시</th><th className="py-4 px-3 w-40 text-center">기간</th><th className="py-4 pr-8 w-44 text-center">결과 열람</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedHistory.map((survey: any, index: number) => {
                  return (
                    <tr key={survey.id} className="hover:bg-slate-50/50 transition-colors h-16">
                      <td className="text-center text-slate-400 font-black pl-8">
                        {filteredHistory.length - ((historyPage - 1) * itemsPerPage + index)}
                      </td>
                      <td className="text-center font-mono text-slate-500">{survey.postNumber || '-'}</td>
                      <td className="text-center font-mono text-slate-500">{survey.postDate}</td>
                      <td className="px-4">
                        <div className="font-black text-slate-800 text-[12px] whitespace-pre-wrap line-clamp-1">
                          {survey.title}
                        </div>
                      </td>
                      <td className="text-center">
                        <span className={`px-2 py-0.5 border rounded text-[10px] ${survey.isAnonymous ? 'bg-slate-700 text-white font-black border-slate-900' : 'text-slate-400 border-slate-200'}`}>
                          {survey.isAnonymous ? '익명' : '기명'}
                        </span>
                      </td>
                      <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td>
                      <td className="text-center text-slate-700 font-bold px-4 whitespace-nowrap">
                        {survey.submittedAt}
                      </td>
                      
                      {/* 💡 [복구 및 가이드 반영]: 보관함 특성에 맞춰 임박 색상(노랑/빨강) 없이 차분한 slate-500 먹색 서체로 고정 */}
                      <td className="text-center font-mono text-slate-500 leading-relaxed whitespace-nowrap px-3">
                        <div>{survey.startDate} ~</div>
                        <div className="text-slate-500 font-medium">
                          {survey.endDate} <span className="text-[8px]">({survey.endTime || '23:59'})</span>
                        </div>
                      </td>
                      
                      <td className="text-center pr-8">
                        <button 
                          onClick={() => {
                            let builderQuestions = [];
                            try {
                              builderQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []);
                            } catch (e) { console.error("문항 파싱 오류:", e); }
                            setViewSurveyHistory({ ...survey, questions: builderQuestions });
                          }} 
                          className="w-full py-1.5 bg-white border border-slate-200 rounded-lg font-black text-[10px] text-slate-600 hover:bg-slate-50 shadow-sm transition-all"
                        >
                          🔍 명세 기록 열람
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-400 font-bold bg-slate-50/30">
                      보관 처리된 완료 내역이 없습니다.
                    </td>
                  </tr>
                )}
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
     
      {/* 설문 수정 풀스크린 에디터 */}
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
                    {q.questionImageUrl && <img src={q.questionImageUrl} alt="guide" onClick={() => setZoomedImage(q.questionImageUrl)} className="mt-3 max-h-40 rounded-xl object-contain border cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all hover:scale-[1.01]" />}
                  </div>
     
                  {q.type === 'CHOICE_SINGLE' && (
                    <div className="space-y-2 pt-1">
                      {q.options?.map((opt: any, oIdx: number) => {
                        const limit = opt.stockLimit;
                        let usedCount = stockUsage[activeFullScreenSurvey.id]?.[`${q.id}_${opt.label}`] || 0;
                        
                        const myPastAnswers = myResponses[activeFullScreenSurvey.id]?.answers || {};
                        const wasCheckedByMe = myPastAnswers[q.id] === opt.label;
                          
                        if (wasCheckedByMe && usedCount > 0) {
                          usedCount = usedCount - 1; 
                        }
       
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
                              handleInputChange(q.id, opt.label); // 다음 단계 클릭 시 분기 연산 처리하도록 이관
                            }} className="w-3.5 h-3.5 accent-blue-600" />
                            <div className="flex flex-col flex-1">
                              <span className={`font-bold ${isOutOfStock ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{opt.label}</span>
                              {isOutOfStock ? (
                                <span className="text-[10px] w-fit mt-1 font-black bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded shadow-sm animate-pulse">SOLD OUT</span>
                              ) : isStockLimited ? (
                                <span className="text-[10px] w-fit mt-1 font-black text-pink-600 bg-pink-50 border border-pink-100 px-1.5 py-0.5 rounded shadow-sm">잔여: {remaining}개 {wasCheckedByMe && <span className="text-[9px] text-teal-600">(기존 내 선택)</span>}</span>
                              ) : null}
                              {opt.referenceLink && <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5 w-fit" onClick={e => e.stopPropagation()}>🔗 상세 명세 링크</a>}
                              {opt.imageUrl && <img src={opt.imageUrl} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setZoomedImage(opt.imageUrl); }} className="mt-2 max-h-24 object-contain rounded border bg-white w-fit cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all hover:scale-[1.02]" />}
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
                        let usedCount = stockUsage[activeFullScreenSurvey.id]?.[`${q.id}_${opt.label}`] || 0;
                        
                        const myPastAnswers = myResponses[activeFullScreenSurvey.id]?.answers || {};
                        const wasCheckedByMe = (myPastAnswers[q.id] || []).includes(opt.label);
                          
                        if (wasCheckedByMe && usedCount > 0) {
                          usedCount = usedCount - 1; 
                        }
       
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
                                <span className="text-[10px] w-fit mt-1 font-black text-pink-600 bg-pink-50 border border-pink-100 px-1.5 py-0.5 rounded shadow-sm">잔여: {remaining}개 {wasCheckedByMe && <span className="text-[9px] text-teal-600">(기존 내 선택)</span>}</span>
                              ) : null}
                              {opt.referenceLink && <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5 w-fit" onClick={e => e.stopPropagation()}>🔗 관련 링크</a>}
                              {opt.imageUrl && <img src={opt.imageUrl} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setZoomedImage(opt.imageUrl); }} className="mt-2 max-h-24 object-contain rounded border bg-white w-fit cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all hover:scale-[1.02]" />}
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
              {hasSections && sectionHistory.length > 1 && (
                <button type="button" onClick={handlePrevSection} className="px-5 py-3.5 bg-white border border-slate-300 rounded-xl font-black text-slate-600 shadow-sm hover:bg-slate-50">◀ 이전 단계</button>
              )}
              {!isLastSection ? (
                <button type="button" onClick={handleNextSection} className="flex-1 py-3.5 bg-blue-600 text-white font-black text-xs rounded-xl shadow-lg hover:bg-blue-700 transition-all">다음 단계 진행하기 ▶</button>
              ) : (
                <button type="button" onClick={handleSubmitForm} className="flex-1 py-3.5 bg-slate-900 text-white font-black text-xs rounded-xl shadow-lg hover:bg-black transition-all">💾 {activeFullScreenSurvey.isEditMode ? '수정 완료' : '최종 답변서 제출하기'}</button>
              )}
            </div>
          </div>
        </div>
      )}
     
      {/* 뷰어 모달 */}
      {viewSurveyHistory && (
        <div className="fixed inset-0 bg-slate-50 z-[500] overflow-y-auto flex flex-col animate-in slide-in-from-bottom-8 duration-300">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
            <div className="flex items-center gap-4">
              <button onClick={() => setViewSurveyHistory(null)} className="px-5 py-2.5 bg-slate-800 rounded-xl font-black text-xs text-white hover:bg-black">조회 종료</button>
              <h1 className="text-base font-black text-slate-800">{viewSurveyHistory.title}</h1>
            </div>
          </div>
          <div className="flex-1 w-full max-w-[800px] mx-auto py-10 px-4 space-y-6 pb-32 relative">
            {zoomedImage && (
              <div className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm p-4 cursor-zoom-out animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
                <div className="relative max-w-5xl max-h-[90vh] flex items-center justify-center">
                  <img src={zoomedImage} alt="Zoomed Area" className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl cursor-default" onClick={(e) => e.stopPropagation()} />
                  <button className="absolute -top-12 right-0 text-white font-black text-lg bg-black/40 hover:bg-black/80 w-9 h-9 rounded-full flex items-center justify-center transition-colors" onClick={() => setZoomedImage(null)}>✕</button>
                </div>
              </div>
            )}
            
            {viewSurveyHistory.questions?.map((q: any, i: number) => {
              if (q.type === 'SECTION') return null;
              const ans = viewSurveyHistory.myAnswers?.[q.id];
              let ansStr = '내용 없음';
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
                  <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 text-sm whitespace-pre-wrap text-left">
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