'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { saveAs } from 'file-saver';
     
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
          
          // 🚀 [DB 연동 1] 로컬스토리지 파기 & 중앙 DB에서 내 응답 가져오기 및 실시간 전사 재고 집계 연산
          const respRes = await fetch('/api/survey/delivery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'GET_RESPONSES' }),
            cache: 'no-store'
          });
          
          if (respRes.ok) {
            const dbResponses = await respRes.json();
            const nextMyRes: Record<string, any> = {};
            const usageMap: Record<string, Record<string, number>> = {};
            
            dbResponses.forEach((r: any) => {
              // 전사 실시간 재고 맵 집계 연산 (상시/기간 복지 물품 카운팅)
              if (r.answers) {
                if (!usageMap[r.surveyId]) usageMap[r.surveyId] = {};
                Object.entries(r.answers).forEach(([qId, val]) => {
                  if (typeof val === 'string') {
                    const key = `${qId}_${val}`;
                    usageMap[r.surveyId][key] = (usageMap[r.surveyId][key] || 0) + 1;
                  } else if (Array.isArray(val)) {
                    val.forEach((item: string) => {
                      const key = `${qId}_${item}`;
                      usageMap[r.surveyId][key] = (usageMap[r.surveyId][key] || 0) + 1;
                    });
                  }
                });
              }
     
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
            setStockUsage(usageMap);
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
      // 🚀 [핵심 안정화]: 버전 대조형 안전 임시 저장 로드 엔진
      const draftRaw = localStorage.getItem(`delivery_draft_${survey.id}_${currentUser?.email}`);
      if (draftRaw) {
        try {
          const draft = JSON.parse(draftRaw);
          // 서버 공고의 최종 수정일(updatedAt)과 임시저장 시점의 수정일 비교
          if (draft.updatedAt === survey.updatedAt) {
            setFormData(draft.answers || {});
          } else {
            console.warn("공고 내용이 변경되어 기존 임시 저장 데이터를 초기화합니다.");
            setFormData({});
            localStorage.removeItem(`delivery_draft_${survey.id}_${currentUser?.email}`);
          }
        } catch (e) {
          setFormData({});
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
    // 🚀 [핵심 안정화]: 임시 저장 시 현재 공고의 버전을 함께 패키징
    const payload = {
      updatedAt: activeFullScreenSurvey.updatedAt,
      answers: formData
    };
    localStorage.setItem(`delivery_draft_${activeFullScreenSurvey.id}_${currentUser?.email}`, JSON.stringify(payload));
    alert('💾 작성 중인 배송지 내용이 안전하게 임시 저장되었습니다.');
  };
  
  const handleSubmitForm = async () => {
    for (const q of activeFullScreenSurvey.questions) {
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
    if (!confirm(activeFullScreenSurvey.isEditMode ? '배송지 수정을 완료하시겠습니까?' : '배송지를 최종 제출하시겠습니까?')) return;
  
    try {
      // 🚀 DB 제출: 프론트엔드의 간섭 없이 순수하게 서버 데이터 전송
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
        const submittedDate = `${new Date().toISOString().split('T')[0]} ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
        const currentCount = myResponses[activeFullScreenSurvey.id]?.revisionCount || 0;
        const newCount = activeFullScreenSurvey.isEditMode ? currentCount + 1 : currentCount;
        
        const nextResponses = {
          ...myResponses,
          [activeFullScreenSurvey.id]: { 
            ...myResponses[activeFullScreenSurvey.id],
            submittedAt: submittedDate, 
            answers: formData,
            revisionCount: newCount 
          }
        };
        
        setMyResponses(nextResponses);
        localStorage.removeItem(`delivery_draft_${activeFullScreenSurvey.id}_${currentUser?.email}`);
        
        alert('✅ 배송지 제출 및 수정 사항 반영이 완료되었습니다.');
        setActiveFullScreenSurvey(null);
        window.location.reload(); // 재고 큐 리컴파일링 리로드
      } else {
        alert('❌ 제출 처리에 실패했습니다.');
      }
    } catch (error) {
      console.error(error);
      alert('❌ 네트워크 오류가 발생했습니다.');
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
     
            {activeFullScreenSurvey.questions.map((q: any, i: number) => (
              <div key={q.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <label className="block text-base font-black text-slate-800"><span className="text-teal-500 mr-2">{i + 1}.</span> {q.title} {q.isRequired && <span className="text-red-500 ml-1">*</span>}</label>
                
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
     
                {/* 🚀 [재고 계산 수정 가드 장착]: 수정 화면 라디오/체크박스 기선점 차감 연동 */}
                {q.type.includes('CHOICE') ? (
                  <div className="grid grid-cols-1 gap-2 mt-4">
                    {q.options?.map((opt: any, oIdx: number) => {
                      // 전체 전사 소진 개수 수거
                      const limit = opt.stockLimit;
                      let usedCount = stockUsage[activeFullScreenSurvey.id]?.[`${q.id}_${opt.label}`] || 0;
                      
                      // 🎯 [핵심 자가 선점 예외 엔진]: 내가 과거 신청대장에 이 항목을 마킹했다면 수량 1개를 반환(차감)해준다.
                      const myPastAnswers = myResponses[activeFullScreenSurvey.id]?.answers || {};
                      const wasCheckedByMe = q.type === 'CHOICE_SINGLE'
                        ? myPastAnswers[q.id] === opt.label
                        : (myPastAnswers[q.id] || []).includes(opt.label);
                        
                      if (wasCheckedByMe && usedCount > 0) {
                        usedCount = usedCount - 1; // 내 지분 확보 복구 연산
                      }
     
                      const isStockLimited = limit !== undefined && limit !== null && limit !== '';
                      const remaining = isStockLimited ? Number(limit) - usedCount : null;
                      const isOutOfStock = isStockLimited && remaining! <= 0;
     
                      const isChecked = q.type === 'CHOICE_SINGLE' 
                        ? formData[q.id] === opt.label 
                        : (formData[q.id] || []).includes(opt.label);
                        
                      return (
                        <label key={oIdx} className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
                          isOutOfStock 
                            ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed grayscale select-none' 
                            : isChecked ? 'border-teal-500 bg-teal-50/30 cursor-pointer' : 'border-slate-200 hover:bg-slate-50 cursor-pointer'
                        }`}>
                          <input 
                            type={q.type === 'CHOICE_SINGLE' ? 'radio' : 'checkbox'} 
                            checked={isChecked} 
                            disabled={isOutOfStock}
                            onChange={(e) => {
                              if(q.type === 'CHOICE_SINGLE') setFormData({...formData, [q.id]: opt.label});
                              else {
                                const curr = formData[q.id] || [];
                                const next = e.target.checked ? [...curr, opt.label] : curr.filter((l:string)=>l!==opt.label);
                                setFormData({...formData, [q.id]: next});
                              }
                            }} 
                            className="accent-teal-600 w-4 h-4 disabled:opacity-40" 
                          />
                          <div className="flex flex-col gap-1.5 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`font-bold text-sm ${isOutOfStock ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{opt.label}</span>
                              {isOutOfStock ? (
                                <span className="text-[10px] font-black bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded shadow-sm animate-pulse">
                                  SOLD OUT (재고없음)
                                </span>
                              ) : isStockLimited ? (
                                <span className="text-[10px] font-black text-pink-600 bg-pink-50 border border-pink-100 px-1.5 py-0.5 rounded shadow-sm">
                                  잔여 재고: {remaining}개 {wasCheckedByMe && <span className="text-[9px] text-teal-600 font-black">(기존 내 선택 품목)</span>}
                                </span>
                              ) : null}
                            </div>
                            {opt.imageUrl && (
                              <img 
                                src={opt.imageUrl} 
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); if(!isOutOfStock) setZoomedImage(opt.imageUrl); }}
                                className={`w-48 h-32 object-cover rounded-lg border border-slate-200 mt-2 shadow-sm transition-all ${isOutOfStock ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:ring-2 hover:ring-teal-500 hover:scale-[1.02]'}`} 
                                title="클릭하면 크게 보실 수 있습니다."
                              />
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : q.type === 'SEARCH_ADDRESS' ? (
                  <div className="space-y-2 bg-slate-50 p-4 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 border bg-white px-3 py-2 rounded-xl shadow-sm">
                        <span className="font-black text-slate-400 text-[10px] uppercase">우편번호</span>
                        <input type="text" value={formData[`${q.id}_zip`] || ''} className="w-20 font-mono text-center font-black text-teal-600 bg-transparent outline-none" readOnly />
                      </div>
                      <button type="button" onClick={() => handleOpenUserPostcode(q.id)} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-slate-800 transition-transform active:scale-95 shadow-sm">🔍 우편번호 검색</button>
                    </div>
                    <input type="text" value={formData[`${q.id}_road`] || ''} placeholder="기본 도로명 주소" className="w-full p-3 border border-slate-200 rounded-xl bg-white text-slate-700 font-bold outline-none shadow-sm" readOnly />
                    <div className="flex items-center border border-teal-300 rounded-xl px-3 bg-white shadow-sm focus-within:ring-2 focus-within:ring-teal-200">
                      <span className="font-black text-teal-600 whitespace-nowrap text-xs pr-2">상세주소 :</span>
                      <input type="text" value={formData[`${q.id}_detail`] || ''} onChange={(e) => setFormData({ ...formData, [`${q.id}_detail`]: e.target.value })} placeholder="동, 호수 및 건물 상세 주소 기입" className="w-full p-3 text-sm font-bold text-slate-800 outline-none bg-transparent" />
                    </div>
                  </div>
                ) : q.type === 'CALENDAR' ? (
                  <input type="date" value={formData[q.id] || ''} onChange={(e) => setFormData({ ...formData, [q.id]: e.target.value })} className="p-3 border border-slate-300 rounded-xl text-sm font-black outline-none focus:border-teal-500 text-slate-700 bg-white shadow-sm" />
                ) : (
                  <input type="text" value={formData[q.id] || ''} onChange={e => setFormData({...formData, [q.id]: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-blue-500 focus:bg-white text-sm" />
                )}
              </div>
            ))}
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