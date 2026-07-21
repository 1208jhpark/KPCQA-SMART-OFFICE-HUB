'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { saveAs } from 'file-saver';
import { getKSTDateString, getKSTTimeString, isPastKSTDeadline, getKSTDaysUntil, formatKSTCalendarLabel } from '@/utils/dateUtils';
import { getVisibleQuestionsByBranch } from '@/utils/surveyBranching';

export default function DeliveryDashboardContent() {
  const [surveys, setSurveys] = useState<any[]>([]);
  const [myResponses, setMyResponses] = useState<Record<string, any>>({}); 
  const [allResponses, setAllResponses] = useState<Record<string, any>>({});
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
     
  // 🌟 필터 제어 상태 (일반 대기건 vs 독촉건)
  const [filterPending, setFilterPending] = useState<boolean>(false);
  const [filterNudged, setFilterNudged] = useState<boolean>(false);
  const [filterClosingToday, setFilterClosingToday] = useState<boolean>(false); // 💡 요 부분 한 줄 추가!
  
  // 🚀 [DB 연동 완료]: 관리자가 독촉한 배달 조사 ID 배열 (서버에서 가져옴)
  const [nudgedSurveys, setNudgedSurveys] = useState<string[]>([]);
     
  const [introModalSurvey, setIntroModalSurvey] = useState<any | null>(null);
  const [activeFullScreenSurvey, setActiveFullScreenSurvey] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
     
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 10;
     
  const [stockUsage, setStockUsage] = useState<Record<string, Record<string, number>>>({});
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const scriptId = 'kakao-postcode-script-user';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
        script.async = true;
        document.head.appendChild(script);
      }
    }
     
    // 🚀 [DB 연동 핵심]: 모든 데이터를 캐시 없이 서버(PostgreSQL)에서 직접 가져옴
    const fetchData = async () => {
      setLoading(true);
      try {
        const ts = new Date().getTime();
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
        }
     
        if (usersRes && usersRes.ok) {
          const usersData = await usersRes.json();
          const mappedUsers = (usersData.users || []).map((u:any) => ({
            ...u,
            dept: unitsData.find((un:any) => un.id === u.unit_id)?.unit_name || '소속없음'
          }));
          setAllUsers(mappedUsers);
        }
     
        // 🚀 1. 내 제출 내역 전용 호출
        const myRespRes = await fetch('/api/survey/delivery?t=' + ts, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_RESPONSES' }),
          cache: 'no-store'
        }).catch(() => null);
        
        // 🚀 2. 전사 재고 및 참여 통계 호출
        const statsRes = await fetch('/api/survey/delivery?t=' + ts, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_STATS' }),
          cache: 'no-store'
        }).catch(() => null);

        if (myRespRes && myRespRes.ok) {
          const myDbResponses = await myRespRes.json();
          const nextMyRes: Record<string, any> = {};
          myDbResponses.forEach((r: any) => {
            if (userData && r.userEmail === userData.email) {
              nextMyRes[r.surveyId] = { submittedAt: r.submittedAt, answers: r.answers };
            }
          });
          setMyResponses(nextMyRes);
        }

        if (statsRes && statsRes.ok) {
          const statsData = await statsRes.json();
          setStockUsage(statsData.stockUsage || {}); 
          setAllResponses(statsData.participation || {}); // { [surveyId]: number (제출 건수) }
        } else {
          alert('⚠️ 전사 참여율 및 재고 정보를 동기화하지 못했습니다.');
        }
     
        const surveyRes = await fetch('/api/survey/delivery?t=' + ts, { cache: 'no-store' });
        if (surveyRes.ok) {
          const loadedSurveys = await surveyRes.json();
          setSurveys(loadedSurveys);
          
          // 🚀 [로컬스토리지 파기]: 서버에서 받아온 공고 데이터 중 'isNudged' 같은 
          // 서버 측 플래그나 상태를 검사하여 nudgedSurveys 배열을 채웁니다.
          // (백엔드 설계에 따라 s.nudgedUsers.includes(userData.email) 등의 방식을 사용해야 합니다.
          // 현재는 임시로 서버 데이터 기반의 안전한 빈 배열 또는 서버 필드를 참조하도록 연결)
          const serverNudged = loadedSurveys
            .filter((s: any) => s.nudgedUsers && s.nudgedUsers.includes(userData?.email))
            .map((s: any) => s.id);
            
          setNudgedSurveys(serverNudged); 
        } else {
          setSurveys([]);
        }
  
      } catch (error) {
        console.error("Delivery Dashboard Sync Error:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);
     
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
     
 // 💡 [수정] 전역 공통 KST 함수 적용 (오전 9시 이전 오차 완벽 방지)
 const todayStr = getKSTDateString();
     
 // 🚀 수정된 visibleSurveys (관리자가 마감시킨 '완료' 건은 제외)
  const visibleSurveys = useMemo(() => {
    return surveys.filter(s => {
      if (s.status !== '진행중') return false; 
      if (currentUser?.roles?.includes('LV_1')) return true; 
      return checkHierarchyTarget(s.target, currentUser?.unit?.unit_name);
    });
  }, [surveys, currentUser, unitsList]);
     
  const filteredSurveys = useMemo(() => {
    // 💡 [핵심] 오늘 마감 배너 클릭 시 필터링 연산 추가!
    if (filterClosingToday) {
      return visibleSurveys.filter(s => s.status === '진행중' && s.endDate === todayStr);
    }
    if (filterNudged) {
      return visibleSurveys.filter(s => s.status === '진행중' && !myResponses[s.id] && nudgedSurveys.includes(s.id));
    }
    if (filterPending) {
      return visibleSurveys.filter(s => s.status === '진행중' && !myResponses[s.id]);
    }
    return visibleSurveys;
  }, [visibleSurveys, filterPending, filterNudged, filterClosingToday, myResponses, nudgedSurveys, todayStr]);
     
  const paginatedSurveys = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSurveys.slice(start, start + itemsPerPage);
  }, [filteredSurveys, currentPage]);
  const totalPages = Math.ceil(filteredSurveys.length / itemsPerPage);
     
  // 💡 필터 클릭 시 1페이지로 돌아가기
  useEffect(() => { setCurrentPage(1); }, [filterPending, filterNudged, filterClosingToday]);
     
  const stats = useMemo(() => {
    if (!currentUser) return { ongoingCount: 0, closingTodayCount: 0, myPendingCount: 0, nudgeCount: 0 };
    const allOngoing = surveys.filter(s => s.status === '진행중');
    const pendingSurveys = allOngoing.filter(s => {
      const isTargeted = checkHierarchyTarget(s.target, currentUser?.unit?.unit_name);
      return isTargeted && !myResponses[s.id];
    });
    
    const nudgedCount = pendingSurveys.filter(s => nudgedSurveys.includes(s.id)).length;
     
    return {
      ongoingCount: visibleSurveys.filter(s => s.status === '진행중').length,
      closingTodayCount: visibleSurveys.filter(s => s.endDate === todayStr).length,
      myPendingCount: pendingSurveys.length,
      nudgeCount: nudgedCount
    };
  }, [surveys, visibleSurveys, myResponses, todayStr, currentUser, unitsList, nudgedSurveys]);
     
  const formatDeliveryDate = (dateStr: string) => formatKSTCalendarLabel(dateStr, '');
     
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
     
  const handleOpenIntro = (survey: any) => {
    if (survey.status === '완료' || isPastKSTDeadline(survey.endDate, survey.endTime)) {
      alert('🔒 본 배송 신청의 기한이 만료되어 마감되었습니다.');
      return;
    }
    setIntroModalSurvey(survey);
  };
     
  const handleStartSurvey = () => {
    const surveyId = introModalSurvey.id;
    // 🚀 이메일 로딩 지연에 따른 undefined 키 생성 방어
    const safeEmail = currentUserEmail || 'unknown_user';
    const draftKey = `delivery_draft_${surveyId}_${safeEmail}`;
    
    const draftData = localStorage.getItem(draftKey);
    
    if (draftData) {
      if (confirm('💾 이전에 작성 중이던 주소지 임시 저장 내역이 있습니다.\n이어서 작성하시겠습니까?')) {
        try {
          // 🛡️ 파싱 에러 방어막: 데이터가 오염되었을 경우 화면 다운 방지
          setFormData(JSON.parse(draftData));
        } catch (e) {
          console.error("로컬 스토리지 데이터 오염 감지, 초기화 진행", e);
          localStorage.removeItem(draftKey);
          setFormData({});
        }
      } else {
        // 🧹 클린업: 사용자가 이어서 안 한다고 하면 찌꺼기 즉시 영구 삭제!
        localStorage.removeItem(draftKey);
        setFormData({});
      }
    } else {
      setFormData({});
    }
     
    // 🚀 질문(Questions) 스키마는 절대 로컬 데이터를 쓰지 않고, 오직 무조건 서버 최신 데이터를 파싱
    let questions = [];
    try {
      questions = typeof introModalSurvey.questions === 'string' 
        ? JSON.parse(introModalSurvey.questions) 
        : (introModalSurvey.questions || []);
    } catch (e) {
      console.error("문항 파싱 에러:", e);
      questions = [
        { id: 'q_name', type: 'TEXT_SHORT', title: '수령인 성명', isRequired: true },
        { id: 'q_addr', type: 'SEARCH_ADDRESS', title: '상세 배송지 (우편번호 포함)', isRequired: true },
        { id: 'q_date', type: 'CALENDAR', title: '배송 요청일', isRequired: true }
      ];
    }
    
    setActiveFullScreenSurvey({ ...introModalSurvey, questions });
    setIntroModalSurvey(null);
  };
     
// --- 중간 저장 함수 ---
const handleSaveDraft = () => {
  if (!activeFullScreenSurvey) return;
  const safeEmail = currentUserEmail || 'unknown_user';
  localStorage.setItem(`delivery_draft_${activeFullScreenSurvey.id}_${safeEmail}`, JSON.stringify(formData));
  alert('💾 현재까지 작성한 배송지 내역이 임시 저장되었습니다.');
};
  
  
  const handleSubmitForm = async () => {
    // 💡 [추가] 제출 버튼을 누른 시점에 한 번 더 시간 체크
    if (isPastKSTDeadline(activeFullScreenSurvey.endDate, activeFullScreenSurvey.endTime)) {
      alert('❌ 기한이 만료되어 제출할 수 없습니다.');
      setActiveFullScreenSurvey(null);
      return;
    }
    
   // 🚀 분기 경로 문항만 검증 (단일/다중선택·주소 goToSectionId 포함)
   const visibleQuestions = getVisibleQuestionsByBranch(
     activeFullScreenSurvey.questions || [],
     formData,
     'delivery'
   );

   // 🚀 눈에 보이는 필수 문항만 검사 (SECTION은 무조건 패스)
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
     
    if (!confirm('배송지 명세를 최종 접수하시겠습니까?\n제출 후에는 게시 마감전까지 나의 참여 이력에서 수정할 수 있습니다.')) return;
     
    try {
      // 🚀 DB 연동 제출: 서버 DB로 직접 전송
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_RESPONSE',
          surveyId: activeFullScreenSurvey.id,
          userEmail: currentUserEmail,
          answers: formData,
          isAnonymous: activeFullScreenSurvey.isAnonymous === true || activeFullScreenSurvey.isAnonymous === 'true'
        })
      });
      
      // 🚀 [여기서부터 붙여넣기] ---------------------------------------------
      if (res.ok) {
        const submittedDate = `${todayStr} ${getKSTTimeString()}`;
        const isAlreadySubmitted = Boolean(myResponses[activeFullScreenSurvey.id]);
        
        const nextResponses = {
          ...myResponses,
          [activeFullScreenSurvey.id]: { submittedAt: submittedDate, answers: formData }
        };
        setMyResponses(nextResponses);
        
        // 🚀 1. 낙관적 업데이트: 화면에서 즉시 참여자 수 +1 (중복 방지)
        setAllResponses(prev => ({
          ...prev,
          [activeFullScreenSurvey.id]: (prev[activeFullScreenSurvey.id] || 0) + (isAlreadySubmitted ? 0 : 1)
        }));
        
        // DB 제출 성공 시 로컬 임시 저장소 비우기
        const safeEmail = currentUserEmail || 'unknown_user';
        localStorage.removeItem(`delivery_draft_${activeFullScreenSurvey.id}_${safeEmail}`);
        
        alert(`🚚 정상적으로 접수되었습니다.\n운영 부서에서 확인 후 순차 배송을 시작합니다.`);
        setActiveFullScreenSurvey(null);
        
        // 🚀 2. 서버 원장 통계 백그라운드 갱신 (재고 및 참여율 실시간 동기화)
        fetch('/api/survey/delivery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_STATS' }),
          cache: 'no-store'
        })
        .then(r => r.ok ? r.json() : null)
        .then(statsData => {
          if (statsData) {
            if (statsData.stockUsage) setStockUsage(statsData.stockUsage);
            if (statsData.participation) setAllResponses(statsData.participation);
          }
        })
        .catch(e => console.error("통계 동기화 실패", e));
        
      } else {
        alert('❌ 제출에 실패했습니다. 서버 상태를 확인하세요.');
      }
      // 🚀 [여기까지 붙여넣기] -----------------------------------------------
    } catch (e) {
      console.error(e);
      alert('❌ 네트워크 오류가 발생했습니다.');
    }
  }; // 👈 썰려 나갔던 꼬리표 복구 완료!
  
  if (loading) return <div className="p-20 text-center font-black text-blue-600 animate-pulse text-xl uppercase tracking-widest">Delivery Dashboard Syncing...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in relative">
      
      {/* 🌟 상단 대시보드 배너 레이아웃 재구성 */}
      <div className="flex flex-col xl:flex-row gap-4 w-full">
        
{/* 배경 줄 */}
<div className="xl:w-2/5 bg-gradient-to-r from-slate-700 to-slate-900 p-6 rounded-[2.5rem] min-h-[120px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden group">
  
{/* 빛 번짐 줄 (은은한 화이트) */}
  <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
  
  <div>
    {/* 1. 상단 라벨 (바이올렛 테마에 맞춘 text-violet-200) */}
    <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-1 text-violet-200">
      My Delivery Mission
    </p>
    <div className="flex items-end gap-2 mt-1">
      <h3 className="text-4xl font-black">{stats.myPendingCount}</h3>
      <p className="text-xs font-bold mb-1 opacity-90">건의 참여할 배송 조사가 있습니다.</p>
    </div>
  </div>
  
  <div className="absolute right-6 top-1/2 -translate-y-1/2">
    {/* 🚀 우측 액션 버튼 (활성화 시 텍스트를 text-violet-800으로 매칭) */}
    <button 
      onClick={() => {
        if (stats.myPendingCount === 0) return alert('현재 신청 대기 중인 배송 공고가 없습니다.');
        setFilterPending(!filterPending);
        setFilterNudged(false); 
      }} 
      className={`shrink-0 text-[10px] font-black px-4 py-2 rounded-xl transition-all border shadow-sm ${
        filterPending 
          ? 'bg-white text-violet-800 border-white' 
          : 'bg-white/20 hover:bg-white/30 text-white border-white/20'
      }`}
    >
      {filterPending ? '전체 목록 ↺' : '대상만 보기 →'}
    </button>
  </div>
</div>
  
        <div className="xl:w-3/5 flex flex-col md:flex-row gap-4">
          <div className="flex-1 bg-white border border-slate-200 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px]">
            <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">진행 중 조사</p><h3 className="text-3xl font-black text-slate-800 mt-1">{stats.ongoingCount} <span className="text-sm font-bold text-slate-400">건</span></h3></div>
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">🚚</div>
          </div>
    
          {/* 💡 [수정] 오늘 마감 배너를 클릭 가능하도록 이벤트 연결! */}
          <div 
            onClick={() => {
              if (stats.closingTodayCount === 0) return alert('오늘 마감이 임박한 배송 공고가 없습니다.');
              setFilterClosingToday(!filterClosingToday);
              setFilterPending(false);
              setFilterNudged(false);
            }}
            className={`flex-1 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px] cursor-pointer transition-all border-2 ${
              filterClosingToday ? 'bg-red-50 border-red-400 scale-[1.02] shadow-lg' : 'bg-white border-slate-200 hover:border-red-200 hover:bg-red-50/30'
            }`}
          >
            <div><p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">오늘 마감</p><h3 className="text-3xl font-black text-red-600 mt-1">{stats.closingTodayCount} <span className="text-sm font-bold text-red-300">건</span></h3></div>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all ${filterClosingToday ? 'bg-red-500 text-white animate-pulse' : 'bg-red-50'}`}>⏰</div>
          </div>
     
          <div 
            onClick={() => {
              if (stats.nudgeCount === 0) return alert('현재 접수된 독촉(참여 요청) 배송 건이 없습니다.');
              setFilterNudged(!filterNudged);
              setFilterPending(false); 
            }}
            className={`flex-1 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px] cursor-pointer transition-all border-2 ${
              filterNudged 
                ? 'bg-red-500 border-red-600 scale-[1.02] shadow-lg' 
                : 'bg-white border-red-100 hover:border-red-300 hover:bg-red-50/30'
            }`}
          >
            <div>
              <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${filterNudged ? 'text-red-100' : 'text-red-400'}`}>참여 요청</p>
              <h3 className={`text-3xl font-black mt-1 ${filterNudged ? 'text-white' : 'text-red-600'}`}>{stats.nudgeCount} <span className={`text-sm font-bold ${filterNudged ? 'text-red-200' : 'text-red-300'}`}>건</span></h3>
            </div>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all ${
              filterNudged 
                ? 'bg-red-600 text-white' 
                : stats.nudgeCount > 0 
                  ? 'bg-red-50 animate-bounce shadow-md' 
                  : 'bg-slate-50 text-slate-300 grayscale opacity-50'
            }`}>
              🚨
            </div>
          </div>
        </div>
      </div>
  
      {/* 🚀 데이터시트 대장 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <div className="p-4 px-6 bg-slate-200/80 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-xs font-black text-slate-800 tracking-tight">
              {filterNudged ? '🚨 긴급 참여 요청 내역' : '진행 중인 배달/조사 리스트'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {filterPending && <span className="text-[10px] font-black bg-indigo-500 text-white px-2 py-0.5 rounded-full border border-indigo-600 animate-pulse">대상 내역 표시 중</span>}
            {filterNudged && <span className="text-[10px] font-black bg-red-500 text-white px-2 py-0.5 rounded-full border border-red-600 animate-pulse">독촉 건만 표시 중</span>}
            {/* 💡 요기 뱃지 추가! */}
            {filterClosingToday && <span className="text-[10px] font-black bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-200 animate-pulse">오늘 마감 건 표시 중</span>}
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">조회 {filteredSurveys.length}건</span>
          </div>
        </div>
     
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="py-4 pl-8 w-16 text-center">NO</th>
                <th className="py-4 px-2 w-20 text-center whitespace-nowrap">게시번호</th>
                <th className="py-4 px-3 w-32 text-center whitespace-nowrap">게시일</th>
                <th className="py-4 px-4">게시명</th>
                <th className="py-4 px-3 w-24 text-center">신청분류</th>
                <th className="py-4 px-3 w-44 text-center">대상</th>
                <th className="py-4 px-3 w-36 text-center">기간</th>
                <th className="py-4 px-2 w-16 text-center">참여율</th>
                <th className="py-4 px-2 w-16 text-center">참여</th>
                <th className="py-4 px-2 w-16 text-center">미참여</th>
                <th className="py-4 pr-8 w-32 text-center">상태 / 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedSurveys.length === 0 ? (
                <tr><td colSpan={11} className="py-24 text-center text-slate-400 font-bold bg-slate-50/30">조건에 맞는 배달/조사 내역이 없습니다.</td></tr>
              ) : paginatedSurveys.map((s, idx) => {
                // 🚀 프론트 대상자 + 서버 제출자 결합
                let total = 0;
                if (allUsers.length > 0) {
                  const targetUsers = allUsers.filter(u => checkHierarchyTarget(s.target, u.dept));
                  total = targetUsers.length;
                }
                const done = allResponses[s.id] || 0;
                const rate = total > 0 ? Math.round((done / total) * 100) : 0;
     
                const isSubmitted = Boolean(myResponses[s.id]);
                // 🚀 관리자(LV_1)는 묻지도 따지지도 않고 접근 가능하게 우회
                const isTargeted = currentUser?.roles?.includes('LV_1') || checkHierarchyTarget(s.target, currentUser?.unit?.unit_name);                
                const isNudged = isTargeted && !isSubmitted && nudgedSurveys.includes(s.id);
                
                // 💡 [KST 마감·D-day 계산]
                const rawTime = (s.endTime || '').trim();
                const timeStr = rawTime === '' ? '23:59' : rawTime;
                const isTimeOver = typeof s.endDate === 'string' && s.endDate.includes('-')
                  ? (s.status === '진행중' && isPastKSTDeadline(s.endDate, timeStr))
                  : false;
                
                let dDayText = null;
                if (!isTimeOver && typeof s.endDate === 'string') {
                  const pureDaysDiff = getKSTDaysUntil(s.endDate);
                  if (pureDaysDiff === 0) dDayText = "D-Day";
                  else if (pureDaysDiff > 0 && pureDaysDiff <= 3) dDayText = `D-${pureDaysDiff}`;
                }
     
                return (
                  <tr 
                    key={s.id} 
                    className={`transition-all ${
                      !isTargeted 
                        ? 'bg-slate-50 opacity-40 cursor-not-allowed grayscale' 
                        : isTimeOver 
                          ? 'bg-slate-100/70 opacity-50 grayscale text-slate-400' 
                          : isNudged 
                            ? 'bg-red-50/40 hover:bg-red-50' 
                            : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <td className="text-center text-slate-400 font-black pl-8 py-4">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                    <td className="text-center font-black text-slate-600 px-2 py-4">{s.postNumber}</td>
                    <td className="text-center font-mono text-slate-500 px-3 py-4 whitespace-nowrap">{s.postDate || '-'}</td>
                    
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1 items-start">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => isTargeted && !isSubmitted && !isTimeOver && handleOpenIntro(s)} 
                            className={`font-black text-[12px] text-left line-clamp-1 ${!isTargeted || isTimeOver || isSubmitted ? 'text-slate-400 cursor-not-allowed' : 'text-slate-800 hover:text-blue-600 hover:underline'}`}
                            disabled={!isTargeted || isSubmitted || isTimeOver}
                          >
                            {s.title}
                          </button>
                          
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
                        {isNudged && !isTimeOver && (
                          <span className="inline-block bg-red-100 text-red-600 border border-red-200 text-[8px] px-2 py-0.5 rounded shadow-sm font-black animate-pulse">
                            🚨 관리자 참여 요청
                          </span>
                        )}
                      </div>
                    </td>
                    
                    <td className="text-center py-4 px-3">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black ${s.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700 border border-pink-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                        {s.deliveryType === 'ALWAYS' ? '상시' : '기간'}
                      </span>
                    </td>
  
                    <td className="px-3 py-4 text-center text-slate-600 font-medium whitespace-normal break-keep leading-relaxed">{s.target}</td>
                    
                    {/* 💡 뱃지에 맞춰 날짜 폰트 색상도 동일하게 세분화 (빨강 / 노랑 / 먹색) */}
                    <td className="text-center font-mono text-slate-500 text-[10px] px-3 py-4">
                      <div>{s.startDate} ~</div>
                      <div className={
                        isTimeOver ? 'text-slate-400 font-bold' 
                        : dDayText === 'D-Day' ? 'text-red-500 font-black' 
                        : dDayText ? 'text-amber-500 font-black' 
                        : 'text-slate-600'
                      }>
                        {s.endDate} <span className="text-[8px]">({timeStr})</span>
                      </div>
                    </td>
                    
                    <td className="text-center font-black text-slate-700 px-2 py-4">{rate}%</td>
                    <td className="text-center font-black text-blue-600 px-2 py-4">{done}명</td>
                    <td className="text-center font-black text-red-500 px-2 py-4">{total - done}명</td>
     
                    <td className="text-center pr-8 py-4">
                    {!isTargeted ? (
                       <button disabled className="px-4 py-1.5 rounded-lg font-black text-[10px] bg-slate-200 text-slate-500 cursor-not-allowed">🚫 대상아님</button>
                      ) : isSubmitted ? (
                        <button 
                          onClick={() => {
                            const resp = myResponses[s.id];
                            alert(`📋 [내 배송지 접수 명세서]\n접수일시: ${resp.submittedAt}`);
                          }} 
                          className="px-3 py-1.5 rounded-lg font-black text-[10px] transition-all whitespace-nowrap shadow-sm bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                        >
                        📬 제출완료
                      </button>
                    ) : isTimeOver ? (
                      <button disabled className="px-4 py-1.5 rounded-lg font-black text-[10px] bg-red-50 text-red-500 border border-red-200 cursor-not-allowed">
                        ⏰ 기간종료
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleOpenIntro(s)} 
                        className={`px-4 py-1.5 rounded-lg font-black text-[10px] transition-all whitespace-nowrap shadow-sm ${
                          isNudged ? 'bg-red-600 text-white hover:bg-red-700 animate-bounce' : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {isNudged ? '🔥 참여 요청' : '📥 미접수'}
                      </button>
                    )}
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
     
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i + 1)}
                className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                {i + 1}
              </button>
            ))}
            <button 
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>
     
      {introModalSurvey && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col p-8 items-center text-center animate-in zoom-in duration-300">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-3xl mb-6">📦</div>
            <h3 className="text-xl font-black text-slate-800 mb-4 whitespace-pre-wrap text-left w-full">{introModalSurvey.title}</h3>
            {introModalSurvey.description ? (
              <p className="text-sm font-bold text-slate-500 bg-slate-50 p-4 rounded-xl w-full leading-relaxed mb-8 border border-slate-100 whitespace-pre-wrap text-left">
                {introModalSurvey.description}
              </p>
            ) : (
              <p className="text-sm font-bold text-slate-400 mb-8 whitespace-pre-wrap text-left w-full">수령하실 정확한 배송지 정보를 입력해 주세요.</p>
            )}
            
            <div className="flex gap-3 w-full">
              <button onClick={() => setIntroModalSurvey(null)} className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black transition-colors">닫기</button>
              <button onClick={handleStartSurvey} className="flex-[2] py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black shadow-lg transition-colors text-[13px]">
                🚀 신청서 기재 시작하기
              </button>
            </div>
          </div>
        </div>
      )}
     
      {activeFullScreenSurvey && (
        <div className="fixed inset-0 bg-slate-50 z-[500] overflow-y-auto flex flex-col animate-in slide-in-from-bottom-8 duration-300">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
            <div className="flex items-center gap-4">
              <button onClick={() => {
                if(confirm('작성을 중단하고 나가시겠습니까?\n저장하지 않은 내용은 사라집니다.')) setActiveFullScreenSurvey(null);
              }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-[12px] text-slate-600 transition-colors">
                ⬅️ 나가기
              </button>
              <div className="h-6 w-px bg-slate-200 mx-1"></div>
              <div>
                <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">진행 중인 배송 신청</span>
                <h1 className="text-base font-black text-slate-800 mt-1 whitespace-pre-wrap text-left">{activeFullScreenSurvey.title}</h1>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button onClick={handleSaveDraft} className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-xs font-black hover:bg-black transition-colors shadow-sm">
                💾 중간 저장
              </button>
              <button onClick={handleSubmitForm} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black shadow-md hover:bg-blue-700 transition-colors">
                🚀 최종 제출하기
              </button>
            </div>
          </div>
     
          <div className="flex-1 w-full max-w-[800px] mx-auto py-10 px-4 pb-32 space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm mb-6 relative">
              <h2 className="text-2xl font-black text-slate-900 mb-2 whitespace-pre-wrap text-left">{activeFullScreenSurvey.title}</h2>
              {activeFullScreenSurvey.description && <p className="text-sm font-bold text-slate-500 leading-relaxed whitespace-pre-wrap text-left">{activeFullScreenSurvey.description}</p>}
            </div>
     
            {(() => {
              const visibleQuestions = getVisibleQuestionsByBranch(
                activeFullScreenSurvey.questions || [],
                formData,
                'delivery'
              );

              return visibleQuestions.map((q, qIdx) => (
                <div key={q.id} className={`bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4 relative ${q.type === 'SECTION' ? 'border-l-8 border-l-teal-600 bg-teal-50/10' : ''}`}>
                  <label className="block text-base font-black text-slate-800">
                    <span className="text-blue-500 mr-2">{qIdx + 1}.</span> {q.title} {q.isRequired && <span className="text-red-500 ml-1">*</span>}
                  </label>

                {/* 🚀 [연동 갭 해결 1]: 빌더에서 등록한 문항별 안내 이미지 표출 */}
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
                
                {(q.description || q.referenceLink) && (
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2 mb-4">
                    {q.description && <p className="text-xs font-bold text-slate-600 leading-relaxed whitespace-pre-wrap text-left">{q.description}</p>}
                    {q.referenceLink && (
                      <a href={q.referenceLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-[10px] font-black hover:bg-blue-100 transition-colors w-fit">
                        🔗 첨부된 참조 링크 열기
                      </a>
                    )}
                  </div>
                )}
     
                {q.type.includes('CHOICE') ? (
                  <div className="grid grid-cols-1 gap-2 mt-4">
                    {q.options?.map((opt: any, oIdx: number) => {
                      const limit = opt.stockLimit;
                      const usedCount = stockUsage[activeFullScreenSurvey.id]?.[`${q.id}_${opt.label}`] || 0;
                      const isStockLimited = limit !== undefined && limit !== null && limit !== '';
                      const remaining = isStockLimited ? Number(limit) - usedCount : null;
                      const isOutOfStock = isStockLimited && remaining! <= 0;
     
                      const isChecked = q.type === 'CHOICE_SINGLE' 
                        ? formData[q.id] === opt.label 
                        : (formData[q.id] || []).includes(opt.label);
                        
                      return (
                        <label key={oIdx} className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
                          isOutOfStock 
                            ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed grayscale' 
                            : isChecked ? 'border-blue-500 bg-blue-50/30 cursor-pointer' : 'border-slate-200 hover:bg-slate-50 cursor-pointer'
                        }`}>
                          <input 
                            type={q.type === 'CHOICE_SINGLE' ? 'radio' : 'checkbox'} 
                            name={q.id} 
                            value={opt.label} 
                            checked={isChecked} 
                            disabled={isOutOfStock}
                            onChange={(e) => {
                              if(q.type === 'CHOICE_SINGLE') setFormData({...formData, [q.id]: e.target.value});
                              else {
                                const curr = formData[q.id] || [];
                                const next = e.target.checked ? [...curr, opt.label] : curr.filter((l:string)=>l!==opt.label);
                                setFormData({...formData, [q.id]: next});
                              }
                            }} 
                            className="accent-blue-600 w-4 h-4 disabled:opacity-50" 
                          />
                          <div className="flex flex-col gap-1.5 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-bold text-sm whitespace-pre-wrap text-left ${isOutOfStock ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{opt.label}</span>
                              
                              {/* 🚀 [연동 갭 해결 2]: 사은품/물품 옵션별 개별 외부 참조 링크 표출 */}
                              {opt.referenceLink && (
                                <a 
                                  href={opt.referenceLink} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  onClick={(e) => e.stopPropagation()} // 라벨 클릭으로 인한 체크방지
                                  className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 hover:underline bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded font-black shrink-0"
                                >
                                  🔗 상세정보
                                </a>
                              )}

                              {isOutOfStock ? (
                                <span className="text-[10px] font-black bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded shadow-sm animate-pulse">
                                  SOLD OUT (재고없음)
                                </span>
                              ) : isStockLimited ? (
                                <span className="text-[10px] font-bold text-pink-500 bg-pink-50 border border-pink-100 px-1.5 py-0.5 rounded">
                                  잔여: {remaining}개
                                </span>
                              ) : null}
                            </div>
                            {opt.imageUrl && (
                              <img 
                                src={opt.imageUrl} 
                                alt={opt.label}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); if(!isOutOfStock) setZoomedImage(opt.imageUrl); }}
                                className={`w-48 h-32 object-cover rounded-lg border border-slate-200 mt-2 shadow-sm transition-all ${isOutOfStock ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:ring-2 hover:ring-blue-500 hover:scale-[1.02]'}`} 
                                title="클릭하면 크게 보실 수 있습니다."
                              />
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : q.type === 'TEXT_LONG' ? (
                  <textarea value={formData[q.id] || ''} onChange={e => setFormData({...formData, [q.id]: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-blue-500 focus:bg-white transition-colors min-h-[120px] text-sm whitespace-pre-wrap text-left" placeholder="상세한 내역을 자유롭게 기재해 주세요." />
                ) : q.type === 'TEXT_SHORT' ? (
                  <input type="text" value={formData[q.id] || ''} onChange={e => setFormData({...formData, [q.id]: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-blue-500 focus:bg-white transition-colors text-sm" placeholder="정보를 입력하세요." />
                ) : q.type === 'SEARCH_ADDRESS' ? (
                  <div className="space-y-2 bg-slate-50 p-4 border border-slate-200 rounded-xl relative z-0">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 border bg-white px-3 py-2 rounded-xl shadow-sm">
                        <span className="font-black text-slate-400 text-[10px] uppercase">우편번호</span>
                        <input type="text" value={formData[`${q.id}_zip`] || ''} className="w-20 font-mono text-center font-black text-blue-600 bg-transparent outline-none" readOnly placeholder="자동검색" />
                      </div>
                      <button type="button" onClick={() => handleOpenUserPostcode(q.id)} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-slate-800 transition-transform active:scale-95 shadow-sm">
                        🔍 우편번호 검색
                      </button>
                    </div>
                    <input type="text" value={formData[`${q.id}_road`] || ''} placeholder="기본 도로명 주소" className="w-full p-3 border border-slate-200 rounded-xl bg-white text-slate-700 font-bold outline-none shadow-sm whitespace-pre-wrap text-left" readOnly />
                    <div className="flex items-center border border-blue-300 rounded-xl px-3 bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-200">
                      <span className="font-black text-blue-600 whitespace-nowrap text-xs pr-2">상세주소 :</span>
                      <input type="text" value={formData[`${q.id}_detail`] || ''} onChange={(e) => setFormData({ ...formData, [`${q.id}_detail`]: e.target.value })} placeholder="동, 호수 및 건물 상세 주소 기입" className="w-full p-3 text-sm font-bold text-slate-800 outline-none bg-transparent whitespace-pre-wrap text-left" />
                    </div>
                  </div>
                ) : q.type === 'CALENDAR' ? (
                  <div className="space-y-3 bg-slate-50 p-4 border border-slate-200 rounded-xl relative z-0">
                    <input type="date" value={formData[q.id] || ''} onChange={(e) => setFormData({ ...formData, [q.id]: e.target.value })} className="p-3 border border-slate-300 rounded-xl text-sm font-black outline-none focus:border-blue-500 text-slate-700 bg-white shadow-sm" />
                    {formData[q.id] && (
                      <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-2">
                        <span className="text-blue-500 text-base">📅</span>
                        <span className="text-sm font-black text-slate-800">요청일 변환: <span className="text-blue-600 underline font-extrabold">{formatDeliveryDate(formData[q.id])}</span></span>
                      </div>
                    )}
                  </div>
                ) : q.type === 'SCALE' ? (
                  <div className="flex flex-wrap gap-2 py-2">
                    {Array.from({ length: q.scaleMax || 5 }).map((_, sIdx) => {
                      const score = sIdx + 1;
                      return (
                        <button key={score} type="button" onClick={() => setFormData({...formData, [q.id]: score})} className={`w-12 h-12 rounded-xl font-black text-sm transition-all ${formData[q.id] === score ? 'bg-blue-600 text-white shadow-md scale-110' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                          {score}
                        </button>
                      );
                    })}
                  </div>
                ) : q.type === 'FILE' && (
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 relative z-0">
                    {q.templateFileName && (
                      <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-200 shadow-sm relative z-0">
                        <span className="text-xs font-bold text-slate-600">📋 첨부된 안내 서식: <span className="font-black text-slate-800 whitespace-pre-wrap text-left">{q.templateFileName}</span></span>
                        <button type="button" onClick={() => fetch(q.templateFileData).then(r=>r.blob()).then(b=>saveAs(b, q.templateFileName))} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-black transition-colors shrink-0">다운로드</button>
                      </div>
                    )}
                    <label className="block w-full cursor-pointer bg-white border-2 border-dashed border-blue-200 p-6 rounded-xl text-center hover:bg-blue-50 transition-colors relative z-0">
                      <span className="text-2xl mb-2 block">📤</span>
                      <span className="text-xs font-black text-blue-600">제출할 파일을 선택하여 업로드하세요.</span>
                      {formData[q.id]?.fileName && <div className="mt-3 text-[11px] font-bold text-slate-500 bg-slate-100 py-1.5 px-3 rounded-full inline-block whitespace-pre-wrap text-left">{formData[q.id].fileName}</div>}
                      <input type="file" onChange={(e) => { const file = e.target.files?.[0]; if (file) setFormData({...formData, [q.id]: { fileName: file.name } }); }} className="hidden" />
                    </label>
                  </div>
                )}
              </div>
              ));
            })()}
     
            <div className="flex justify-center pt-8">
              <button onClick={handleSubmitForm} className="px-10 py-4 bg-blue-600 text-white rounded-full text-sm font-black shadow-xl hover:bg-blue-700 hover:scale-105 transition-all">
                🚀 배송지 명세 최종 접수
              </button>
            </div>
          </div>
        </div>
      )}
     
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm p-4 cursor-zoom-out animate-in fade-in duration-200" 
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex items-center justify-center relative">
            <img 
              src={zoomedImage} 
              alt="Zoomed Area" 
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl cursor-default" 
              onClick={(e) => e.stopPropagation()} 
            />
            <button 
              className="absolute -top-12 right-0 text-white font-black text-lg bg-black/40 hover:bg-black/80 w-9 h-9 rounded-full flex items-center justify-center transition-colors z-[610]"
              onClick={() => setZoomedImage(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}