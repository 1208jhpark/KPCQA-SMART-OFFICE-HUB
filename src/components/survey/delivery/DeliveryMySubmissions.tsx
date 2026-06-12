'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

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
        const [userRes, unitsRes, configRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/interface?t=' + ts)
        ]);
        
        const userData = userRes.ok ? await userRes.json() : null;
        const unitsData = unitsRes.ok ? await unitsRes.json() : [];
        setUnitsList(unitsData);

        if (configRes.ok) {
          const interfaces = await configRes.json();
          const config = interfaces.find((m: any) => m.path === '/survey/delivery/my-submissions');
          if (config) setPageConfig(config);
        }
  
        if (userData) {
          userData.unit = unitsData.find((u: any) => u.id === userData.dept_id) || { unit_name: '소속없음' };
          setCurrentUser(userData);
          
          const dbKey = `db_my_delivery_responses_${userData.email}`;
          const storedResponses = localStorage.getItem(dbKey);
          if (storedResponses) {
              try { setMyResponses(JSON.parse(storedResponses)); } 
              catch (e) { setMyResponses({}); }
          }
        }
  
        const storedSurveys = localStorage.getItem('admin_delivery_surveys');
        if (storedSurveys) setSurveys(JSON.parse(storedSurveys));
  
      } catch (error) {
        console.error("Unified Delivery MySubmissions Engine Error:", error);
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
  
  // 🚀 [다이내믹 큐 라우팅 1] 대기 리스트: 승인완료(isApproved) 항목은 제외
  const eligibleSurveys = useMemo(() => {
    const now = new Date();
    return surveys.filter(s => {
      const myRes = myResponses[s.id];
      if (!myRes) return false; 
      
      // 💡 핵심 1: 내 신청 건이 이미 "승인 완료" 되었다면 대기 리스트에서 즉시 방출
      if (myRes.isApproved) return false;
     
      if (s.status === '완료' || s.status === '보관됨') return false;
      if (s.endDate && now > new Date(`${s.endDate}T23:59:59`)) return false;
     
      return currentUser?.roles?.includes('LV_1') || checkHierarchy(s.target, currentUser?.unit?.unit_name);
    }).sort((a, b) => new Date(b.postDate).getTime() - new Date(a.postDate).getTime());
  }, [surveys, currentUser, unitsList, myResponses]);
  
  // 🚀 [다이내믹 큐 라우팅 2] 보관함 리스트: 마감되었거나 승인완료(isApproved) 항목을 수집
  const historyList = useMemo(() => {
    const now = new Date();
    return surveys.filter(s => {
      const myRes = myResponses[s.id];
      if (!myRes) return false;
     
      const isExpired = s.endDate ? now > new Date(`${s.endDate}T23:59:59`) : false;
      const isGloballyClosed = s.status === '완료' || s.status === '보관됨' || isExpired;
     
      // 💡 핵심 2: 공고가 끝났거나 OR 내 신청이 "승인 완료" 되었다면 보관함으로 편입
      if (!isGloballyClosed && !myRes.isApproved) return false; 
      
      return true;
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
      const draft = localStorage.getItem(`delivery_draft_${survey.id}_${currentUser?.email}`);
      setFormData(draft ? JSON.parse(draft) : {});
    }
    const builderData = localStorage.getItem(`delivery_builder_${survey.id}`);
    setActiveFullScreenSurvey({ ...survey, questions: builderData ? JSON.parse(builderData) : [], isEditMode });
  };
  
  const handleSaveDraft = () => {
    localStorage.setItem(`delivery_draft_${activeFullScreenSurvey.id}_${currentUser?.email}`, JSON.stringify(formData));
    alert('💾 작성 중인 배송지 내용이 임시 저장되었습니다.');
  };
  
  const handleSubmitForm = () => {
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
    
    setTimeout(() => {
      localStorage.setItem(`db_my_delivery_responses_${currentUser?.email}`, JSON.stringify(nextResponses));
      localStorage.removeItem(`delivery_draft_${activeFullScreenSurvey.id}_${currentUser?.email}`);
      alert('✅ 배송지 제출 및 수정 사항 반영이 완료되었습니다.');
      setActiveFullScreenSurvey(null);
    }, 0);
  };
  
  const formatAnswerForView = (q: any, answers: any) => {
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
      
      {/* 상단 메인 대시 배너 */}
      <div className="w-full bg-gradient-to-r from-teal-700 to-emerald-800 p-6 rounded-[2.5rem] min-h-[120px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-200 mb-1">My Pending Delivery</p>
          <h1 className="text-2xl font-black tracking-tight">{pageConfig?.page_title || '나의 배송 신청 내역'}</h1>
          <p className="text-teal-100 text-xs font-semibold mt-2 opacity-90">
            {pageConfig?.page_description || '접수한 배송내역 확인 및 출고 승인 대기 목록'}
          </p>
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
                <th className="h-12 px-3 w-24 text-center">분류</th>
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
                
                // 마감임박 다이내믹 계산 처리
                const endDateObj = survey.endDate ? new Date(`${survey.endDate}T23:59:59`) : null;
                const timeDiff = endDateObj ? endDateObj.getTime() - new Date().getTime() : 0;
                const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
                const isUrgent = daysDiff > 0 && daysDiff <= 3 && survey.deliveryType !== 'ALWAYS';
  
                return (
                  <tr key={survey.id} className="hover:bg-slate-50/50 transition-colors h-16">
                    <td className="text-center text-slate-400 font-black pl-8">{reverseNo}</td>
                    <td className="text-center font-mono text-slate-500">{100 + (Number(survey.id) || 0)}</td>
                    <td className="text-center font-mono text-slate-500">{survey.postDate}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-3 h-16">
                        <span className="font-black text-slate-900 truncate">{survey.title}</span>
                        {isUrgent && <span className="shrink-0 bg-red-50 text-red-500 text-[8px] font-black px-1.5 py-0.5 rounded border border-red-100 animate-pulse">마감임박</span>}
                      </div>
                    </td>
                    <td className="text-center">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black ${survey.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700 border border-pink-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                        {survey.deliveryType === 'ALWAYS' ? '상시신청' : '기간한정'}
                      </span>
                    </td>
                    <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td>
                    <td className="text-center text-teal-700 font-bold px-4 whitespace-nowrap">{submissionTimeStr}</td>
                    <td className="text-center font-mono text-slate-500 leading-relaxed whitespace-nowrap px-3">
                      {survey.deliveryType === 'ALWAYS' ? (
                        <div className="text-teal-600 font-black text-[10px] bg-teal-50 px-2 py-1 rounded">연중 상시</div>
                      ) : (
                        <>
                          <div>{survey.startDate} ~</div>
                          <div className={isUrgent ? "text-red-500 font-bold" : "text-slate-600"}>{survey.endDate}</div>
                        </>
                      )}
                    </td>
                    <td className="text-center pr-8">
                      <div className="flex flex-col gap-1.5 w-full justify-center h-16">
                        {myResponses[survey.id]?.isRevoked ? (
                          <button onClick={() => alert(`💡 관리자 승인 취소 사유:\n\n${myResponses[survey.id].feedbackMsg}`)} className="w-full py-1.5 bg-red-50 text-red-600 border border-red-300 rounded-lg font-black text-[10px] hover:bg-red-100 animate-pulse">⚠️ 취소/보완필요</button>
                        ) : myResponses[survey.id]?.feedbackMsg ? (
                          <button onClick={() => alert(`💡 관리자 보완 요청 의견:\n\n${myResponses[survey.id].feedbackMsg}`)} className="w-full py-1.5 bg-amber-50 text-amber-700 border border-amber-300 rounded-lg font-black text-[10px] hover:bg-amber-100 animate-pulse">⚠️ 보완 필요</button>
                        ) : (
                          <span className="w-full py-1.5 bg-slate-50 text-slate-500 border border-slate-200 rounded-lg font-black text-[10px]">대기 중</span>
                        )}
                        <button onClick={() => handleOpenSurvey(survey, true)} className="w-full py-1.5 rounded-lg font-black text-[10px] transition-all shadow-sm border bg-white border-teal-200 text-teal-600 hover:bg-teal-50">✏️ 답변 수정</button>
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
            <button disabled={eligiblePage === 1} onClick={() => setEligiblePage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
            {Array.from({ length: totalEligiblePages }).map((_, i) => (
              <button key={i} onClick={() => setEligiblePage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${eligiblePage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={eligiblePage === totalEligiblePages} onClick={() => setEligiblePage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
          </div>
        )}
      </div>
     
      {/* 아코디언 트리거 가이드 배너 */}
      <div 
        onClick={() => setIsHistoryOpen(!isHistoryOpen)}
        className="w-full bg-slate-800 p-6 rounded-[2.5rem] text-white shadow-lg relative overflow-hidden flex flex-col justify-center min-h-[120px] mt-12 cursor-pointer hover:brightness-95 active:scale-[0.99] transition-all select-none"
      >
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Archive Repository (Click to Toggle)</p>
          <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
            과거/승인 완료 명세서 보관함
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">
              {isHistoryOpen ? '▲ 접기' : '▼ 펼치기'}
            </span>
          </h2>
          <p className="text-slate-300 text-xs font-semibold mt-2 opacity-90">배송 출고(승인)가 완료되었거나, 공고가 완전히 마감된 내역입니다.</p>
        </div>
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
                      <td className="text-center font-mono text-slate-500 px-3">{100 + (Number(survey.id) || 0)}</td>
                      <td className="text-center font-mono text-slate-500 px-3">{survey.postDate}</td>
                      <td className="px-4">
                        <div className="font-black text-slate-800 text-[12px]">{survey.title}</div>
                      </td>
                      <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td>
                      <td className="text-center text-slate-700 font-bold px-4 whitespace-nowrap">{survey.submittedAt}</td>
                      <td className="text-center font-mono px-3">
                        {/* 🚀 승인 여부에 따라 보관함 내 표시 문구 변경 */}
                        {survey.isApproved ? (
                          <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[10px] font-black block w-fit mx-auto">출고 승인완료</span>
                        ) : (
                          <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-black block w-fit mx-auto">공고 마감됨</span>
                        )}
                      </td>
                      <td className="text-center pr-8">
                        <button 
                          onClick={() => {
                            const builderData = JSON.parse(localStorage.getItem(`delivery_builder_${survey.id}`) || '[]');
                            setViewSurveyHistory({ ...survey, questions: builderData });
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
                  <tr><td colSpan={8} className="py-24 text-center text-slate-400 font-bold bg-slate-50/30">보관 처리된 내역이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalHistoryPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
              <button disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
              {Array.from({ length: totalHistoryPages }).map((_, i) => (
                <button key={i} onClick={() => setHistoryPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${historyPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
            </div>
          )}
        </div>
      )}
     
      {/* 🌟 수정 폼 풀스크린 모달 */}
      {activeFullScreenSurvey && (
        <div className="fixed inset-0 bg-slate-50 z-[500] overflow-y-auto flex flex-col animate-in slide-in-from-bottom-8 duration-300">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
            <div className="flex items-center gap-4">
              <button onClick={() => setActiveFullScreenSurvey(null)} className="px-4 py-2 bg-slate-100 rounded-xl font-black text-xs text-slate-600 hover:bg-slate-200">목록으로</button>
              <h1 className="text-base font-black text-slate-800">{activeFullScreenSurvey.title}</h1>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveDraft} className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-xs font-black shadow-sm">임시 저장</button>
              <button onClick={handleSubmitForm} className="px-6 py-2.5 bg-teal-600 text-white rounded-xl text-xs font-black shadow-md">{activeFullScreenSurvey.isEditMode ? '수정 완료' : '제출 완료'}</button>
            </div>
          </div>
          <div className="flex-1 w-full max-w-[800px] mx-auto py-10 px-4 space-y-6 pb-32">
            {activeFullScreenSurvey.questions.map((q: any, i: number) => (
              <div key={q.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <label className="block text-base font-black text-slate-800"><span className="text-teal-500 mr-2">{i + 1}.</span> {q.title} {q.isRequired && <span className="text-red-500 ml-1">*</span>}</label>
                
                {q.type.includes('CHOICE') ? (
                  <div className="grid grid-cols-1 gap-2 mt-4">
                    {q.options?.map((opt: any, oIdx: number) => {
                      const isChecked = q.type === 'CHOICE_SINGLE' ? formData[q.id] === opt.label : (formData[q.id] || []).includes(opt.label);
                      return (
                        <label key={oIdx} className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer ${isChecked ? 'border-teal-500 bg-teal-50/30' : 'border-slate-200'}`}>
                          <input type={q.type === 'CHOICE_SINGLE' ? 'radio' : 'checkbox'} checked={isChecked} onChange={(e) => {
                            if(q.type === 'CHOICE_SINGLE') setFormData({...formData, [q.id]: opt.label});
                            else {
                              const curr = formData[q.id] || [];
                              const next = e.target.checked ? [...curr, opt.label] : curr.filter((l:string)=>l!==opt.label);
                              setFormData({...formData, [q.id]: next});
                            }
                          }} className="accent-teal-600 w-4 h-4" />
                          <span className="font-bold text-sm text-slate-700">{opt.label}</span>
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
                  <input type="text" value={formData[q.id] || ''} onChange={e => setFormData({...formData, [q.id]: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-teal-500 focus:bg-white text-sm" />
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
              <h1 className="text-base font-black text-slate-800">{viewSurveyHistory.title}</h1>
            </div>
          </div>
          <div className="flex-1 w-full max-w-[800px] mx-auto py-10 px-4 space-y-6 pb-32">
            {viewSurveyHistory.questions?.map((q: any, i: number) => (
              <div key={q.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <label className="block text-base font-black text-slate-800">{i + 1}. {q.title}</label>
                <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 text-sm">
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