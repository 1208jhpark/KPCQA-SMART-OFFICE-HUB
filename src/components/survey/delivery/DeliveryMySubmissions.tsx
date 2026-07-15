'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { saveAs } from 'file-saver';
import { getKSTDateString } from '@/utils/dateUtils';
     
// 🚀 [UI 표준] 전사 공통 헤더 컴포넌트
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-teal-600"></div>
      <h2 className="text-xs font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);
  
export default function DeliveryMySubmissions() {
  const router = useRouter();
  
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageConfig, setPageConfig] = useState<any>(null);
  
  const [surveys, setSurveys] = useState<any[]>([]);
  const [myResponses, setMyResponses] = useState<Record<string, any>>({}); 
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  
  const [activeFullScreenSurvey, setActiveFullScreenSurvey] = useState<any | null>(null);
  const [viewSurveyHistory, setViewSurveyHistory] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  const [historyYear, setHistoryYear] = useState<string>('ALL');
  const [eligiblePage, setEligiblePage] = useState<number>(1);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const itemsPerPage = 5;
     
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  
  // 🚀 [신규 엔진] 이미지 확대(Zoom) 라이트박스 상태
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
     
  // 🚀 [재고 연동 코어] 옵션별 전사 실시간 소진 누적 개수 해시맵 컨텍스트 선언
  const [stockUsage, setStockUsage] = useState<Record<string, Record<string, number>>>({});
     // 🚀 [추가] 캘린더 날짜 표시를 위한 헬퍼 함수
  const formatDeliveryDate = (dateStr: string) => {
    if (!dateStr) return '날짜를 지정해 주세요.';
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return dateStr;
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const dayOfWeek = dayNames[dateObj.getDay()];
    return `${yyyy}년 ${mm}월 ${dd}일 (${dayOfWeek})`;
  };
  // 🚀 카카오(Daum) 주소 검색 엔진 호출 함수
  const openPostcodeEngine = (qId: string) => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          setFormData((prev: any) => ({
            ...prev,
            [`${qId}_zip`]: data.zonecode,
            [`${qId}_road`]: data.roadAddress || data.address
          }));
        }
      }).open();
    } else {
      alert('주소 검색 엔진이 로드되지 않았습니다. 페이지를 새로고침 후 다시 시도해 주세요.');
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const scriptId = 'kakao-postcode-script-sub';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
        script.async = true;
        document.head.appendChild(script);
      }
    }
     
    const initializeUnifiedContext = async () => {
      try {
        const ts = Date.now();
        const [userRes, unitsRes, configRes, surveyRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/interface?t=' + ts).catch(() => null),
          fetch(`/api/survey/delivery?t=${ts}`, { cache: 'no-store' }) // 🚀 캐시 원천 차단
        ]);
        
        const userData = userRes.ok ? await userRes.json() : null;
        const unitsData = unitsRes.ok ? await unitsRes.json() : [];
        setUnitsList(unitsData);
     
        if (configRes && configRes.ok) {
          const interfaces = await configRes.json();
          const config = interfaces.find((m: any) => m.path === '/survey/delivery/my-submissions');
          if (config) setPageConfig(config);
        }
     
        if (surveyRes.ok) {
          setSurveys(await surveyRes.json());
        } else {
          setSurveys([]);
        }
  
      
        if (userData) {
          userData.unit = unitsData.find((u: any) => u.id === userData.dept_id) || { unit_name: '소속없음' };
          setCurrentUser(userData);
          
          // 🚀 1. 내 제출 내역 전용 격리 조회
          const myRespRes = await fetch('/api/survey/delivery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'GET_RESPONSES' }),
            cache: 'no-store'
          }).catch(() => null);
          
          // 🚀 2. 전사 재고 정보 호출 (보안이 마스킹된 안전 통계 API)
          const statsRes = await fetch('/api/survey/delivery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'GET_STATS' }),
            cache: 'no-store'
          }).catch(() => null);

          if (myRespRes && myRespRes.ok) {
            const myDbResponses = await myRespRes.json();
            const nextMyRes: Record<string, any> = {};
            
            myDbResponses.forEach((r: any) => {
              if (r.userEmail === userData.email) {
                nextMyRes[r.surveyId] = {
                  submittedAt: r.submittedAt ? r.submittedAt.split('T')[0] + ' ' + new Date(r.submittedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-',
                  answers: r.answers,
                  isApproved: r.isApproved,
                  isRevoked: r.isRevoked,
                  feedbackMsg: r.feedbackMsg,
                  revisionCount: r.revisionCount
                };
              }
            });
            setMyResponses(nextMyRes);
          } else {
            alert('⚠️ 나의 이전 제출 정보를 가져오지 못했습니다.');
          }

          if (statsRes && statsRes.ok) {
            const statsData = await statsRes.json();
            setStockUsage(statsData.stockUsage || {}); // 실시간 전사 품절 현황 정확하게 연동
          } else {
            alert('⚠️ 전사 실시간 상품 재고 현황을 동기화하지 못했습니다.');
          }
        }

      } catch (error) {
        console.error("Delivery MySubmissions Sync Error:", error);
      } finally {
        setLoading(false);
      }
    };
    initializeUnifiedContext();
  }, []);
  
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
      // 💡 [수정] 관리자가 '완료'나 '보관됨' 처리한 것만 제외함 (시간 만료는 여기서 체크 안 함!)
      if (s.status === '완료' || s.status === '보관됨') return false;
      
      return currentUser?.roles?.includes('LV_1') || checkHierarchy(s.target, currentUser?.unit?.unit_name);
    }).sort((a, b) => new Date(b.postDate).getTime() - new Date(a.postDate).getTime());
  }, [surveys, currentUser, unitsList, myResponses]);
  
  const historyList = useMemo(() => {
    return surveys.filter(s => {
      const myRes = myResponses[s.id];
      if (!myRes) return false;
      if (myRes.isApproved) return true; // 승인된 건은 무조건 보관함
      if (s.status === '진행중' || s.status === '게시중단') return false;
     
      // 💡 [수정] 오직 관리자가 마감(완료) 처리한 것만 보관함으로 이동!
      const isGloballyClosed = s.status === '완료' || s.status === '보관됨';
      return isGloballyClosed;
    }).map(s => ({
      ...s,
      submittedAt: myResponses[s.id].submittedAt,
      myAnswers: myResponses[s.id].answers,
      isApproved: myResponses[s.id].isApproved
    })).sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt));
  }, [surveys, myResponses]);
     
  const filteredHistory = useMemo(() => historyList.filter(s => historyYear === 'ALL' || s.submittedAt.split('-')[0] === historyYear), [historyList, historyYear]);
  const paginatedEligible = useMemo(() => eligibleSurveys.slice((eligiblePage - 1) * itemsPerPage, eligiblePage * itemsPerPage), [eligibleSurveys, eligiblePage]);
  const paginatedHistory = useMemo(() => filteredHistory.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage), [filteredHistory, historyPage]);
     
  const totalEligiblePages = Math.ceil(eligibleSurveys.length / itemsPerPage);
  const totalHistoryPages = Math.ceil(filteredHistory.length / itemsPerPage);
  
  const handleOpenUserPostcode = (qId: string) => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          setFormData(prev => ({
            ...prev,
            [`${qId}_zip`]: data.zonecode,
            [`${qId}_road`]: data.roadAddress || data.address
          }));
        }
      }).open();
    } else {
      alert('주소 검색 엔진을 로드 중입니다. 잠시 후 다시 클릭해 주세요.');
    }
  };
     
  const handleOpenSurvey = (survey: any, isEditMode: boolean) => {
    if (isEditMode) {
      setFormData(myResponses[survey.id]?.answers || {});
    } else {
      const safeEmail = currentUser?.email || 'unknown_user';
      const draftKey = `delivery_draft_${survey.id}_${safeEmail}`;
      const draftRaw = localStorage.getItem(draftKey);
      
      if (draftRaw) {
        try {
          const parsed = JSON.parse(draftRaw);
          // 🚀 대시보드와 나의 제출함 양쪽의 임시저장 포맷(direct formData vs object) 유연한 호환성 확보
          const answers = (parsed && typeof parsed === 'object' && 'answers' in parsed) ? parsed.answers : parsed;
          
          if (confirm('💾 이전에 작성 중이던 임시 저장 내역이 있습니다.\n이어서 작성하시겠습니까?')) {
            setFormData(answers || {});
          } else {
            localStorage.removeItem(draftKey);
            setFormData({});
          }
        } catch (e) {
          console.error("로컬 스토리지 데이터 오염 감지, 초기화 진행", e);
          setFormData({});
          localStorage.removeItem(draftKey);
        }
      } else {
        setFormData({});
      }
    }
    
    let questions = [];
    try {
      questions = typeof survey.questions === 'string' 
        ? JSON.parse(survey.questions) 
        : (survey.questions || []);
    } catch (e) {
      console.error("문항 파싱 오류:", e);
    }
    
    setActiveFullScreenSurvey({ ...survey, questions, isEditMode });
  };

  const handleSaveDraft = () => {
    if (!activeFullScreenSurvey) return;
    const safeEmail = currentUser?.email || 'unknown_user';
    // 대시보드 구조와 동일하게 폼 데이터 직접 직렬화
    localStorage.setItem(`delivery_draft_${activeFullScreenSurvey.id}_${safeEmail}`, JSON.stringify(formData));
    alert('💾 작성 중인 배송지 내용이 안전하게 임시 저장되었습니다.');
  };
  
  const handleSubmitForm = async () => {
    // 🚀 1. 제출 순간 시간 만료 및 상태 마감 클라이언트 사이드 철저 가드
    const now = new Date();
    const hasValidDate = typeof activeFullScreenSurvey.endDate === 'string' && activeFullScreenSurvey.endDate.includes('-');
    const rawTime = (activeFullScreenSurvey.endTime || '').trim();
    const timeStr = rawTime === '' ? '23:59' : rawTime;
    const deadline = hasValidDate ? new Date(`${activeFullScreenSurvey.endDate.trim()}T${timeStr}:00`) : null;
    
    if (deadline && now > deadline) {
      alert('❌ 기한이 만료되어 배송 정보를 접수하거나 수정할 수 없습니다.');
      setActiveFullScreenSurvey(null);
      return;
    }

      // 🚀 [새로운 코드 시작]
      const visibleQuestions: any[] = [];
      const questions = activeFullScreenSurvey.questions || [];
      let currentIndex = 0;
      
      while (currentIndex < questions.length) {
        const q = questions[currentIndex];
        visibleQuestions.push(q);
        const userAns = formData[q.id];
        
        let nextSectionId: string | undefined = undefined;
        if (q.type === 'CHOICE_SINGLE' && userAns) {
          const selectedOpt = q.options?.find((o: any) => o.label === userAns);
          if (selectedOpt?.goToSectionId) nextSectionId = selectedOpt.goToSectionId;
        }
        
        if (!nextSectionId && q.goToSectionId && userAns !== undefined && userAns !== null && userAns !== '') {
          nextSectionId = q.goToSectionId;
        }
        
        if (nextSectionId) {
          if (nextSectionId === 'SUBMIT') break;
          const targetIdx = questions.findIndex((item: any) => item.id === nextSectionId);
          if (targetIdx !== -1 && targetIdx > currentIndex) {
            currentIndex = targetIdx;
            continue;
          }
        }
        currentIndex++;
      }
  
      for (const q of visibleQuestions) {
        if (q.type === 'SECTION') continue;
        if (q.isRequired) {
          if (q.type === 'SEARCH_ADDRESS') {
            if (!formData[`${q.id}_zip`] || !formData[`${q.id}_road`] || !formData[`${q.id}_detail`]) {
              alert(`📍 [${q.title}]의 우편번호 검색 및 상세주소를 완벽히 기입해 주세요.`);
              return;
            }
          } else if (!formData[q.id] || formData[q.id].length === 0) {
            alert(`✏️ [${q.title}] 문항은 필수 기입 항목입니다.`);
            return;
          }
        }
      }
      // 🚀 [새로운 코드 끝]
  
    if (!confirm(activeFullScreenSurvey.isEditMode ? '배송지 수정을 완료하시겠습니까?' : '배송지를 최종 제출하시겠습니까?')) return;
  
    try {
      const res = await fetch('/api/survey/delivery', {
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
        const serverRes = await res.json();
        const submittedDate = `${getKSTDateString()} ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
        
        // 🚀 2. [SPA 최적화] 무거운 window.location.reload()를 완전히 제거하고
        // 서버 DB의 실제 반환값(revisionCount 및 결재 플래그)을 다이렉트로 매핑
        const nextResponses = {
          ...myResponses,
          [activeFullScreenSurvey.id]: { 
            ...myResponses[activeFullScreenSurvey.id],
            submittedAt: submittedDate, 
            answers: formData,
            revisionCount: serverRes.revisionCount || 1,
            isApproved: serverRes.isApproved,
            isRevoked: serverRes.isRevoked,
            feedbackMsg: serverRes.feedbackMsg
          }
        };
        
        setMyResponses(nextResponses);

        // 로컬 임시 저장소 확실히 제거
        const safeEmail = currentUser?.email || 'unknown_user';
        localStorage.removeItem(`delivery_draft_${activeFullScreenSurvey.id}_${safeEmail}`);
        
        alert('✅ 배송지 제출 및 수정 사항 반영이 완료되었습니다.');
        setActiveFullScreenSurvey(null);

        // 🚀 3. 백그라운드로 전사 실시간 재고 갱신 호출 (동작 방해 없는 고성능 패치)
        fetch('/api/survey/delivery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_STATS' }),
          cache: 'no-store'
        })
        .then(r => r.ok ? r.json() : null)
        .then(statsData => {
          if (statsData && statsData.stockUsage) {
            setStockUsage(statsData.stockUsage); // 즉시 폼 내의 품절 여부 재가공 반영
          }
        })
        .catch(e => console.error("통계 동기화 실패", e));

      } else {
        alert('❌ 제출 처리에 실패했습니다.');
      }
    } catch (error) {
      console.error(error);
      alert('❌ 네트워크 오류가 발생했습니다.');
    }
  }
  
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
     
  if (loading) return <div className="p-20 text-center font-black text-teal-600 animate-pulse text-xl uppercase tracking-widest">배송 제출 제어 모듈 동기화 중...</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
{/* 🌑 [배송조사 전용 테마] 미드나잇 슬레이트에서 라이트 그레이로 번지는 입체형 그라데이션 */}
<div className="w-full bg-gradient-to-r from-slate-800 to-slate-600 p-6 rounded-[2.5rem] min-h-[140px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden group">
  
  {/* ✨ 우측 라이트 그레이 톤과 자연스럽게 녹아들도록 투명도를 최적화한 은은한 빛 번짐 효과 */}
  <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-white/15 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>

  <div className="relative z-10 flex justify-between items-end w-full">
    <div>
      {/* 1. 상단 라벨 (미드나잇 슬레이트 테마 전용 text-slate-400 처리 및 mb-3 간격 표준화) */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3"> 
        MY PENDING DELIVERY
      </h3>
      
      {/* 2. 메인 타이틀 (명함/일반설문 코너와 1:1 싱크로: 부서 박스 + 이름 님 텍스트) */}
      <h1 className="text-2xl font-black tracking-tight text-white leading-none flex items-center flex-wrap gap-2">
        {/* 🏢 소속 부서 뱃지 (미드나잇 테마에 최적화된 프리미엄 반투명 뱃지 박스) */}
        <span className="bg-white/10 border border-white/20 text-slate-200 px-4 py-2 rounded-2xl text-lg font-black tracking-tight shrink-0 shadow-sm">
          {currentUser?.unit?.unit_name || '조직'}
        </span>
        
        {/* 👤 사용자 이름 (배경색에 맞춰 자연스럽게 매칭되는 서체 톤) */}
        <span className="text-slate-200 shrink-0">{currentUser?.name || '임직원'} 님</span>{' '}
        
        {/* 🎯 메인 타이틀 텍스트 */}
        <span className="text-white">나의 배송 신청 내역</span>
      </h1>
      
      {/* 3. 하단 설명 (공통 신청 명세 문법 완벽 이식 및 mt-4 간격 고정) */}
      <p className="text-slate-400 text-xs font-semibold mt-4 opacity-95 flex items-center gap-1">
        <span>현재 상태:</span>
        <span className="font-black text-white">
          ✨ 접수한 배송내역 확인 및 관리자 출고 승인 대기 목록 조회 중
        </span>
      </p>
    </div>
  </div>
</div>

  
      {/* 🚀 대장 1: 기간 내 참여 및 정보 수정 가능 대장 */}
      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <HeaderLight title="출고 대기 중인 신청 리스트" count={eligibleSurveys.length} />
  
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
          <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-8 w-16 text-center">NO</th>
                <th className="h-12 px-3 w-28 text-center">게시번호</th>
                <th className="h-12 px-3 w-28 text-center">게시일</th>
                <th className="h-12 px-4">게시명</th>
                <th className="h-12 px-3 w-24 text-center">신청분류</th>
                <th className="h-12 px-3 w-36 text-center">대상</th>
                <th className="h-12 px-4 w-48 text-center">나의 접수 일시</th>
                <th className="h-12 px-3 w-40 text-center">기간</th>
                <th className="h-12 pr-8 w-44 text-center">상태 / 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedEligible.map((survey: any, index: number) => {
                const submissionTimeStr = myResponses[survey.id]?.submittedAt || '-';
                const reverseNo = eligibleSurveys.length - ((eligiblePage - 1) * itemsPerPage + index);
                
                // 💡 [시간 및 날짜 정밀 계산] - 시간이 비어있어도 에러 안 나게 안전 처리!
                const hasValidDate = typeof survey.endDate === 'string' && survey.endDate.includes('-');
                const rawTime = (survey.endTime || '').trim();
                const timeStr = rawTime === '' ? '23:59' : rawTime;
                
                const deadline = hasValidDate ? new Date(`${survey.endDate.trim()}T${timeStr}:00`) : null;
                const now = new Date();
                const isTimeOver = deadline ? now > deadline : false;
                
                let dDayText = null;
                
                // 🚨 [원인 해결!] '상시' 분류여도 마감일이 정해져 있으면 무조건 D-Day를 띄우도록 제한 해제!
                if (deadline && !isTimeOver) {
                  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const endDateDate = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
                  
                  const pureDaysDiff = Math.round((endDateDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
                  
                  if (pureDaysDiff === 0) dDayText = "D-Day";
                  else if (pureDaysDiff > 0 && pureDaysDiff <= 3) dDayText = `D-${pureDaysDiff}`;
                }
  
                return (
                  <tr key={survey.id} className={`transition-colors h-16 ${isTimeOver ? 'bg-slate-50/70 opacity-60 grayscale' : 'hover:bg-slate-50/50'}`}>
                    <td className="text-center text-slate-400 font-black pl-8">{reverseNo}</td>
                    <td className="text-center font-mono text-slate-500">{survey.postNumber}</td>
                    <td className="text-center font-mono text-slate-500">{survey.postDate}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-3 h-16">
                        <span className={`font-black truncate ${isTimeOver ? 'text-slate-500' : 'text-slate-900'}`}>{survey.title}</span>
                        
                        {/* 💡 동적 D-Day 표시: D-Day는 빨강, D-1~D-3은 노랑으로 시각적 분리 */}
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
                    <td className="text-center">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black ${survey.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700 border border-pink-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                        {survey.deliveryType === 'ALWAYS' ? '상시' : '기간'}
                      </span>
                    </td>
                    <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td>
                    <td className="text-center text-teal-700 font-bold px-4 whitespace-nowrap">{submissionTimeStr}</td>
                    
                    {/* 💡 뱃지에 맞춰 날짜 폰트 색상도 동일하게 세분화 (빨강 / 노랑 / 먹색) */}
                    <td className="text-center font-mono text-slate-500 text-[10px] px-3 py-4">
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
                      <div className="flex flex-col gap-1.5 w-full justify-center h-16">
                        {myResponses[survey.id]?.isRevoked ? (
                          <button onClick={() => alert(`💡 관리자 승인 취소 사유:\n\n${myResponses[survey.id].feedbackMsg}`)} className="w-full py-1 bg-red-50 text-red-600 border border-red-300 rounded text-[9px] font-black hover:bg-red-100 animate-pulse">⚠️ 취소/보완필요</button>
                        ) : myResponses[survey.id]?.feedbackMsg ? (
                          <button onClick={() => alert(`💡 관리자 보완 요청 의견:\n\n${myResponses[survey.id].feedbackMsg}`)} className="w-full py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded text-[9px] font-black hover:bg-amber-100 animate-pulse">⚠️ 보완 필요</button>
                        ) : (
                          <span className="w-full py-1 bg-slate-50 text-slate-500 border border-slate-200 rounded font-black text-[9px]">승인 대기 중</span>
                        )}
                        
                        {isTimeOver ? (
                          <button disabled className="w-full py-1 rounded-lg font-black text-[10px] shadow-sm border bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed">기간 종료 (수정 불가)</button>
                        ) : (
                          <button onClick={() => handleOpenSurvey(survey, true)} className="w-full py-1 rounded-lg font-black text-[10px] transition-all shadow-sm border bg-white border-teal-200 text-teal-600 hover:bg-teal-50">✏️ 답변 수정</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {eligibleSurveys.length === 0 && (
                <tr><td colSpan={9} className="py-16 text-center text-slate-400 font-bold bg-slate-50/30">현재 출고 대기 중이거나 수정 가능한 내역이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalEligiblePages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
            <button disabled={eligiblePage === 1} onClick={() => setEligiblePage(p => Math.max(p - 1, 1))} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
            {Array.from({ length: totalEligiblePages }).map((_, i) => (
              <button key={i} onClick={() => setEligiblePage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${eligiblePage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={eligiblePage === totalEligiblePages} onClick={() => setEligiblePage(p => Math.min(p + 1, totalEligiblePages))} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
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
     
      {/* 대장 2: 과거 완료 및 승인 이력 대장 */}
      {isHistoryOpen && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <HeaderLight title="완료 및 승인 배송 대장" count={filteredHistory.length}>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <span className="text-slate-500">연도 필터 :</span>
              <select 
                value={historyYear} 
                onChange={(e) => { setHistoryYear(e.target.value); setHistoryPage(1); }} 
                className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
              >
                <option value="ALL">전체 내역 보기</option>
                <option value="2026">2026년도</option>
                <option value="2025">2025년도</option>
              </select>
            </div>
          </HeaderLight>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-8 w-16 text-center">NO</th>
                  <th className="h-12 px-3 w-28 text-center">게시번호</th>
                  <th className="h-12 px-3 w-28 text-center">게시일</th>
                  <th className="h-12 px-4">게시명</th>
                  <th className="h-12 px-3 w-24 text-center">신청분류</th>
                  <th className="h-12 px-3 w-36 text-center">대상</th>
                  <th className="h-12 px-4 w-48 text-center">접수 일시</th>
                  <th className="h-12 px-3 w-40 text-center">상태/기간</th>
                  <th className="h-12 pr-8 w-44 text-center">명세서 확인</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedHistory.map((survey: any, index: number) => {
                  const reverseNo = filteredHistory.length - ((historyPage - 1) * itemsPerPage + index);
                  return (
                    <tr key={survey.id} className="hover:bg-slate-50/50 transition-colors h-16">
                      <td className="text-center text-slate-400 font-black pl-8">{reverseNo}</td>
                      <td className="text-center font-mono text-slate-500 px-3">{survey.postNumber}</td>
                      <td className="text-center font-mono text-slate-500 px-3">{survey.postDate}</td>
                      <td className="px-4">
                        <div className="font-black text-slate-800 text-[12px] whitespace-pre-wrap">{survey.title}</div>
                      </td>
                      
                      {/* 💡 상시/기간 뱃지로 통일 */}
                      <td className="text-center">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black ${survey.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700 border border-pink-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                          {survey.deliveryType === 'ALWAYS' ? '상시' : '기간'}
                        </span>
                      </td>
                      
                      <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td>
                      <td className="text-center text-slate-700 font-bold px-4 whitespace-nowrap">{survey.submittedAt}</td>
                      
                      <td className="text-center px-3 py-2">
                        <div className="mb-1">
                          {survey.isApproved ? (
                            <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[10px] font-black inline-block border border-emerald-200">출고 승인완료</span>
                          ) : (
                            <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-black inline-block border border-slate-200">공고 마감됨</span>
                          )}
                        </div>
                        {/* 💡 가이드 반영: General과 서체(font-mono)를 통일하되 보관함은 예외 없이 먹색(slate-500)으로 단정하게 고정 */}
                        <div className="font-mono text-slate-500 leading-relaxed whitespace-nowrap mt-1">
                          <div>{survey.startDate} ~</div>
                          <div className="text-slate-500 font-medium">
                            {survey.endDate} <span className="text-[8px]">({survey.endTime || '23:59'})</span>
                          </div>
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
                  <tr><td colSpan={9} className="py-24 text-center text-slate-400 font-bold bg-slate-50/30">보관 처리된 내역이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalHistoryPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
              <button disabled={historyPage === 1} onClick={() => setHistoryPage(p => Math.max(p - 1, 1))} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
              {Array.from({ length: totalHistoryPages }).map((_, i) => (
                <button key={i} onClick={() => setHistoryPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${historyPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => Math.min(p + 1, totalHistoryPages))} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
            </div>
          )}
        </div>
      )}
     
      {/* 🌟 수정 폼 풀스크린 모달 */}
      {activeFullScreenSurvey && (
        <div className="fixed inset-0 bg-slate-50 z-[500] overflow-y-auto flex flex-col animate-in slide-in-from-bottom-8 duration-300">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
            <div className="flex items-center gap-4">
              <button onClick={() => { if(confirm('작성을 중단하고 나가시겠습니까?\n저장하지 않은 내용은 사라집니다.')) setActiveFullScreenSurvey(null); }} className="px-4 py-2 bg-slate-100 rounded-xl font-black text-xs text-slate-600 hover:bg-slate-200">목록으로</button>
              <h1 className="text-base font-black text-slate-800">{activeFullScreenSurvey.title}</h1>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveDraft} className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-xs font-black shadow-sm hover:bg-black">임시 저장</button>
              <button onClick={handleSubmitForm} className="px-6 py-2.5 bg-teal-600 text-white rounded-xl text-xs font-black shadow-md hover:bg-teal-700">{activeFullScreenSurvey.isEditMode ? '수정 완료' : '제출 완료'}</button>
            </div>
          </div>
          <div className="flex-1 w-full max-w-[800px] mx-auto py-10 px-4 space-y-6 pb-32">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm mb-6 relative">
              {zoomedImage && (
                <div className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm p-4 cursor-zoom-out animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
                  <div className="relative max-w-5xl max-h-[90vh] flex items-center justify-center">
                    <img src={zoomedImage} alt="Zoomed Area" className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl cursor-default" onClick={(e) => e.stopPropagation()} />
                    <button className="absolute -top-12 right-0 text-white font-black text-lg bg-black/40 hover:bg-black/80 w-9 h-9 rounded-full flex items-center justify-center transition-colors" onClick={() => setZoomedImage(null)}>✕</button>
                  </div>
                </div>
              )}
              
              <h2 className="text-2xl font-black text-slate-900 mb-2 whitespace-pre-wrap text-left">{activeFullScreenSurvey.title}</h2>
              {activeFullScreenSurvey.description && <p className="text-sm font-bold text-slate-500 leading-relaxed whitespace-pre-wrap text-left">{activeFullScreenSurvey.description}</p>}
            </div>
     
            {(() => {
              const visibleQuestions: any[] = [];
              const questions = activeFullScreenSurvey.questions || [];
              let currentIndex = 0;
              
              while (currentIndex < questions.length) {
                const q = questions[currentIndex];
                visibleQuestions.push(q);
                const userAns = formData[q.id];
                
                let nextSectionId: string | undefined = undefined;
                if (q.type === 'CHOICE_SINGLE' && userAns) {
                  const selectedOpt = q.options?.find((o: any) => o.label === userAns);
                  if (selectedOpt?.goToSectionId) nextSectionId = selectedOpt.goToSectionId;
                }
                if (!nextSectionId && q.goToSectionId && userAns !== undefined && userAns !== null && userAns !== '') {
                  nextSectionId = q.goToSectionId;
                }
                if (nextSectionId) {
                  if (nextSectionId === 'SUBMIT') break;
                  const targetIdx = questions.findIndex((item: any) => item.id === nextSectionId);
                  if (targetIdx !== -1 && targetIdx > currentIndex) {
                    currentIndex = targetIdx;
                    continue;
                  }
                }
                currentIndex++;
              }

              return visibleQuestions.map((q, i) => (
                <div key={q.id} className={`bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4 ${q.type === 'SECTION' ? 'border-l-8 border-l-teal-600 bg-teal-50/10' : ''}`}>
                  <label className="block text-base font-black text-slate-800">
                    <span className="text-teal-500 mr-2">{i + 1}.</span> {q.title} {q.isRequired && <span className="text-red-500 ml-1">*</span>}
                  </label>

                  {q.questionImageUrl && (
                    <div className="my-3">
                      <img src={q.questionImageUrl} alt="문항 안내 이미지" className="max-h-64 rounded-2xl border border-slate-200 object-contain shadow-sm cursor-zoom-in" onClick={() => setZoomedImage(q.questionImageUrl)} />
                    </div>
                  )}

                  {(q.description || q.referenceLink) && (
                    <div className="bg-teal-50 p-4 rounded-xl border border-teal-100 mb-4">
                      {q.description && <p className="text-sm font-bold text-teal-800 whitespace-pre-wrap leading-relaxed">{q.description}</p>}
                      {q.referenceLink && (
                        <a href={q.referenceLink} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 px-3 py-1.5 bg-white text-teal-600 font-black text-xs rounded shadow-sm border border-teal-200 hover:bg-teal-600 hover:text-white transition-colors">
                          🔗 참조 링크 열기
                        </a>
                      )}
                    </div>
                  )}

                  {q.type.includes('CHOICE') ? (
                    <div className="space-y-2 mt-4">
                      {q.options?.map((opt: any, oIdx: number) => {
                        const isChecked = q.type === 'CHOICE_SINGLE' ? formData[q.id] === opt.label : (formData[q.id] || []).includes(opt.label);
                        const usageKey = `${q.id}_${opt.label}`;
                        let currentUsage = stockUsage[activeFullScreenSurvey.id]?.[usageKey] || 0;
                        
                        const myPreviousAnswers = myResponses[activeFullScreenSurvey.id]?.answers || {};
                        let wasCheckedByMe = false;
                        if (q.type === 'CHOICE_SINGLE') {
                          wasCheckedByMe = myPreviousAnswers[q.id] === opt.label;
                        } else if (Array.isArray(myPreviousAnswers[q.id])) {
                          wasCheckedByMe = myPreviousAnswers[q.id].includes(opt.label);
                        }
                        if (wasCheckedByMe && currentUsage > 0) currentUsage -= 1;
                        
                        const isOutOfStock = opt.stockLimit !== null && opt.stockLimit !== undefined && currentUsage >= opt.stockLimit;

                        return (
                          <label key={oIdx} className={`flex items-center p-3 rounded-xl border-2 cursor-pointer transition-all ${isOutOfStock ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed' : isChecked ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-teal-300'}`}>
                            <div className="flex items-center gap-3 w-full">
                              <input type={q.type === 'CHOICE_SINGLE' ? 'radio' : 'checkbox'} name={`q_${q.id}`} value={opt.label} checked={isChecked} disabled={isOutOfStock}
                                onChange={(e) => {
                                  if (q.type === 'CHOICE_SINGLE') {
                                    setFormData({ ...formData, [q.id]: e.target.value });
                                  } else {
                                    const prev = formData[q.id] || [];
                                    if (e.target.checked) setFormData({ ...formData, [q.id]: [...prev, e.target.value] });
                                    else setFormData({ ...formData, [q.id]: prev.filter((v: string) => v !== e.target.value) });
                                  }
                                }}
                                className={`w-5 h-5 cursor-pointer accent-teal-600 ${isOutOfStock ? 'grayscale opacity-50' : ''}`}
                              />
                              {opt.imageUrl && <img src={opt.imageUrl} alt={opt.label} className="w-12 h-12 rounded-lg object-cover border border-slate-200" />}
                              <div className="flex-1 flex items-center justify-between">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`font-bold text-sm whitespace-pre-wrap text-left ${isOutOfStock ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{opt.label}</span>
                                  {opt.referenceLink && (
                                    <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 hover:underline bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded font-black shrink-0">🔗 상세정보</a>
                                  )}
                                  {isOutOfStock ? (
                                    <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-black rounded border border-red-200 ml-2">SOLD OUT</span>
                                  ) : (opt.stockLimit !== null && opt.stockLimit !== undefined) ? (
                                    <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-[10px] font-black rounded border border-teal-200 ml-2">잔여: {opt.stockLimit - currentUsage}개</span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : q.type === 'SEARCH_ADDRESS' ? (
                    <div className="space-y-3 bg-slate-50 p-5 border border-slate-200 rounded-2xl">
                      <div className="flex items-center gap-2">
                        <input type="text" value={formData[`${q.id}_zip`] || ''} placeholder="우편번호" readOnly className="w-24 p-3 border border-slate-300 rounded-xl text-center text-sm font-black outline-none bg-white shadow-sm text-teal-700" />
                        <button type="button" onClick={() => handleOpenUserPostcode(q.id)} className="px-4 py-3 bg-slate-800 text-white rounded-xl text-xs font-black shadow-md hover:bg-black transition-all">🔍 주소 검색</button>
                      </div>
                      <input type="text" value={formData[`${q.id}_road`] || ''} placeholder="기본 주소가 이곳에 자동 입력됩니다." readOnly className="w-full p-3 border border-slate-300 rounded-xl text-sm font-bold outline-none bg-white shadow-sm text-slate-600" />
                      <input type="text" value={formData[`${q.id}_detail`] || ''} onChange={(e) => setFormData({ ...formData, [`${q.id}_detail`]: e.target.value })} placeholder="동, 호수 등 상세 주소를 정확히 기재해주세요." className="w-full p-3 border border-teal-400 rounded-xl text-sm font-bold outline-none bg-white shadow-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all text-slate-800" />
                    </div>
                  ) : q.type === 'CALENDAR' ? (
                    <div className="space-y-3 bg-slate-50 p-4 border border-slate-200 rounded-xl relative z-0">
                      <input type="date" value={formData[q.id] || ''} onChange={(e) => setFormData({ ...formData, [q.id]: e.target.value })} className="p-3 border border-slate-300 rounded-xl text-sm font-black outline-none focus:border-teal-500 text-slate-700 bg-white shadow-sm" />
                      {formData[q.id] && (
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-2">
                          <span className="text-blue-500 text-base">📅</span>
                          <span className="text-sm font-black text-slate-800">요청일 변환: <span className="text-blue-600 underline font-extrabold">{formatDeliveryDate(formData[q.id])}</span></span>
                        </div>
                      )}
                    </div>
                  ) : q.type === 'TEXT_LONG' ? (
                    <textarea value={formData[q.id] || ''} onChange={e => setFormData({...formData, [q.id]: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-teal-500 focus:bg-white transition-colors min-h-[120px] text-sm whitespace-pre-wrap text-left" placeholder="상세한 내역을 자유롭게 기재해 주세요." />
                  ) : q.type === 'SCALE' ? (
                    <div className="flex flex-wrap gap-2 py-2">
                      {Array.from({ length: q.scaleMax || 5 }).map((_, sIdx) => {
                        const score = sIdx + 1;
                        return (
                          <button key={score} type="button" onClick={() => setFormData({...formData, [q.id]: score})} className={`w-12 h-12 rounded-xl font-black text-sm transition-all ${formData[q.id] === score ? 'bg-teal-600 text-white shadow-md scale-110' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                            {score}
                          </button>
                        );
                      })}
                    </div>
                  ) : q.type === 'FILE' ? (
                    <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 relative z-0">
                      {q.templateFileName && (
                        <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-200 shadow-sm relative z-0">
                          <span className="text-xs font-bold text-slate-600">📋 첨부된 안내 서식: <span className="font-black text-slate-800 text-left">{q.templateFileName}</span></span>
                          <button type="button" onClick={() => fetch(q.templateFileData).then(r=>r.blob()).then(b=>saveAs(b, q.templateFileName))} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-black transition-colors shrink-0">다운로드</button>
                        </div>
                      )}
                      <label className="block w-full cursor-pointer bg-white border-2 border-dashed border-teal-200 p-6 rounded-xl text-center hover:bg-teal-50 transition-colors relative z-0">
                        <span className="text-2xl mb-2 block">📤</span>
                        <span className="text-xs font-black text-teal-600">제출할 파일을 선택하여 업로드하세요.</span>
                        {formData[q.id]?.fileName && <div className="mt-3 text-[11px] font-bold text-slate-500 bg-slate-100 py-1.5 px-3 rounded-full inline-block text-left">{formData[q.id].fileName}</div>}
                        <input type="file" onChange={(e) => { const file = e.target.files?.[0]; if (file) setFormData({...formData, [q.id]: { fileName: file.name } }); }} className="hidden" />
                      </label>
                    </div>
                  ) : q.type === 'SECTION' ? (
                    <div className="hidden" />
                  ) : (
                    <input type="text" value={formData[q.id] || ''} onChange={e => setFormData({...formData, [q.id]: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-teal-500 focus:bg-white text-sm" placeholder="정보를 입력하세요." />
                  )}
                </div>
              ));
            })()}
          </div>
        </div>
      )}
     
      {/* 🌟 이력 열람 뷰어 모달 */}
      {viewSurveyHistory && (
        <div className="fixed inset-0 bg-slate-50 z-[500] overflow-y-auto flex flex-col animate-in slide-in-from-bottom-8 duration-300">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
            <div className="flex items-center gap-4">
              <button onClick={() => setViewSurveyHistory(null)} className="px-5 py-2.5 bg-slate-800 rounded-xl font-black text-xs text-white hover:bg-black">조회 종료</button>
              <h1 className="text-base font-black text-slate-800 whitespace-pre-wrap">{viewSurveyHistory.title}</h1>
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
     
     {viewSurveyHistory.questions?.map((q: any, i: number) => (
              <div key={q.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <label className="block text-base font-black text-slate-800">{i + 1}. {q.title}</label>
                
                {/* 🚀 [연동 갭 해결]: 기록 열람 시에도 빌더 이미지를 동일하게 매핑 */}
                {q.questionImageUrl && (
                  <div className="my-3">
                    <img 
                      src={q.questionImageUrl} 
                      alt="문항 안내 이미지" 
                      className="max-h-64 rounded-2xl border border-slate-200 object-contain shadow-sm cursor-zoom-in"
                      onClick={() => setZoomedImage(q.questionImageUrl)}
                    />
                  </div>
                )}

                <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 text-sm whitespace-pre-wrap text-left">
                  {formatAnswerForView(q, viewSurveyHistory.myAnswers)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}