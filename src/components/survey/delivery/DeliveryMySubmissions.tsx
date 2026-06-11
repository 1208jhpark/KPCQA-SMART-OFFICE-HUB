'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
  
export default function DeliveryMySubmissions() {
  const router = useRouter();
  
  // 1. 공통 통합 상태 인프라 (권한 차단 상태 제거, 순수 데이터 상태만 유지)
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageConfig, setPageConfig] = useState<any>(null);
  
  // 공용 데이터 매트릭스 버퍼
  const [surveys, setSurveys] = useState<any[]>([]);
  const [myResponses, setMyResponses] = useState<Record<string, any>>({}); 
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  
  // 모달 팝업 상태 제어 링커
  const [activeFullScreenSurvey, setActiveFullScreenSurvey] = useState<any | null>(null);
  const [viewSurveyHistory, setViewSurveyHistory] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  // 연도 필터 및 개별 페이징 표준
  const [historyYear, setHistoryYear] = useState<string>('ALL');
  const [eligiblePage, setEligiblePage] = useState<number>(1);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const itemsPerPage = 5;
     
  // 과거 완료 참여 이력 보관함 접기/펼치기 제어 상태
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
     
  useEffect(() => {
    // 🔥 카카오 주소 API 동적 인젝션 (수정 시 주소 검색용)
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
        // 🚀 L4PanelRenderer가 이미 권한을 검증했으므로, 여기서는 순수하게 내 데이터만 가져옵니다.
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
          
          // 🌟 [핵심] 저장된 이메일 키를 사용하여 명확하게 배송 데이터 로드
          const dbKey = `db_my_delivery_responses_${userData.email}`;
          const storedResponses = localStorage.getItem(dbKey);
          
          if (storedResponses) {
              try {
                  const parsed = JSON.parse(storedResponses);
                  setMyResponses(parsed);
              } catch (e) {
                  console.error("데이터 파싱 에러:", e);
                  setMyResponses({});
              }
          } else {
              setMyResponses({});
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
  
  const eligibleSurveys = useMemo(() => {
    const now = new Date();
    return surveys.filter(s => {
      const isSubmitted = Boolean(myResponses[s.id]);
      if (!isSubmitted) return false;
     
      if (s.endDate) {
        const endTarget = new Date(`${s.endDate} 23:59:59`);
        if (now > endTarget) return false;
      }
     
      return currentUser?.roles?.includes('LV_1') || checkHierarchy(s.target, currentUser?.unit?.unit_name);
    }).sort((a, b) => new Date(b.postDate).getTime() - new Date(a.postDate).getTime());
  }, [surveys, currentUser, myResponses, unitsList]);
  
  const historyList = useMemo(() => {
    const now = new Date();
    return surveys.filter(s => {
      const isSubmitted = Boolean(myResponses[s.id]);
      if (!isSubmitted) return false;
      
      if (s.endDate) {
        const endTarget = new Date(`${s.endDate} 23:59:59`);
        if (now <= endTarget) return false; 
      }
      return true;
    }).map(s => ({
      ...s,
      submittedAt: myResponses[s.id].submittedAt,
      myAnswers: myResponses[s.id].answers
    })).sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt));
  }, [surveys, myResponses]);
     
  const filteredHistory = useMemo(() => {
    return historyList.filter(survey => {
      if (historyYear === 'ALL') return true;
      return survey.submittedAt.split('-')[0] === historyYear;
    });
  }, [historyList, historyYear]);
     
  const paginatedEligible = useMemo(() => {
    const start = (eligiblePage - 1) * itemsPerPage;
    return eligibleSurveys.slice(start, start + itemsPerPage);
  }, [eligibleSurveys, eligiblePage]);
     
  const paginatedHistory = useMemo(() => {
    const start = (historyPage - 1) * itemsPerPage;
    return filteredHistory.slice(start, start + itemsPerPage);
  }, [filteredHistory, historyPage]);
     
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

    // 🚀 현재 차수를 확인하고, 수정 모드일 경우에만 차수를 1 올립니다.
    const currentCount = myResponses[activeFullScreenSurvey.id]?.revisionCount || 0;
    const newCount = activeFullScreenSurvey.isEditMode ? currentCount + 1 : currentCount;
    
    const nextResponses = {
      ...myResponses,
      [activeFullScreenSurvey.id]: { 
        submittedAt: submittedDate, 
        answers: formData,
        revisionCount: newCount // 차수 데이터 추가
      }
    };
    
    setMyResponses(nextResponses);
    localStorage.setItem(`db_my_delivery_responses_${currentUser?.email}`, JSON.stringify(nextResponses));
    localStorage.removeItem(`delivery_draft_${activeFullScreenSurvey.id}_${currentUser?.email}`);
    alert('✅ 배송지 제출 및 수정 사항 반영이 완료되었습니다.');
    setActiveFullScreenSurvey(null);
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
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 상단 메인 대시 배너 */}
      <div className="w-full bg-gradient-to-r from-teal-700 to-emerald-800 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[120px]">
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-200 mb-1">My Eligible Delivery</p>
          <h1 className="text-2xl font-black tracking-tight">{pageConfig?.page_title || '나의 배송 신청 내역'}</h1>
          <p className="text-teal-100 text-xs font-semibold mt-1 opacity-90">
            {pageConfig?.page_description || '접수한 배송내역 확인 및 출고 전 정보 수정'}
          </p>
        </div>
      </div>
  
      {/* 🚀 대장 1: 기간 내 참여 및 정보 수정 가능 대장 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-teal-600"></div>
            <h2 className="text-xs font-black text-slate-800 tracking-tight">출고 대기 중인 신청 리스트</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{eligibleSurveys.length}건</span>
          </div>
        </div>
  
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="py-4 pl-8 w-16 text-center">NO</th>
                <th className="py-4 px-3 w-28 text-center">게시번호</th>
                <th className="py-4 px-3 w-28 text-center">게시일</th>
                <th className="py-4 px-4">게시명</th>
                <th className="py-4 px-3 w-24 text-center">분류</th>
                <th className="py-4 px-3 w-36 text-center">대상</th>
                <th className="py-4 px-4 w-48 text-center">나의 접수 일시</th>
                <th className="py-4 px-3 w-40 text-center">기간</th>
                <th className="py-4 pr-8 w-44 text-center">상태 / 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedEligible.map((survey: any, index: number) => {
                const submissionTimeStr = myResponses[survey.id]?.submittedAt || '-';
                const reverseNo = eligibleSurveys.length - ((eligiblePage - 1) * itemsPerPage + index);
  
                return (
                  <tr key={survey.id} className="hover:bg-slate-50/50 transition-colors h-16">
                    <td className="text-center text-slate-400 font-black pl-8">{reverseNo}</td>
                    <td className="text-center font-mono text-slate-500">{100 + (Number(survey.id) || 0)}</td>
                    <td className="text-center font-mono text-slate-500">{survey.postDate}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-3">
                        <span className="font-black text-slate-900">{survey.title}</span>
                      </div>
                    </td>
                    <td className="text-center py-4 px-3">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black ${survey.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700' : 'bg-amber-100 text-amber-700'}`}>
                        {survey.deliveryType === 'ALWAYS' ? '상시' : '기간'}
                      </span>
                    </td>
                    <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td>
                    <td className="text-center text-teal-700 font-bold px-4 whitespace-nowrap">{submissionTimeStr}</td>
                    <td className="text-center font-mono text-slate-500 leading-relaxed whitespace-nowrap px-3">
                      <div>{survey.startDate} ~</div>
                      <div className="text-red-500 font-bold">{survey.endDate}</div>
                    </td>
                    <td className="text-center pr-8 py-2">
                      <div className="flex flex-col gap-1.5 w-full">
                        {myResponses[survey.id]?.isApproved ? (
                          <span className="w-full py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-black text-[10px]">✅ 승인완료</span>
                        ) : myResponses[survey.id]?.isRevoked ? (
                          // 🚀 새로 추가된 승인 취소 전용 빨간 뱃지
                          <button 
                            onClick={() => alert(`💡 관리자 승인 취소 사유:\n\n${myResponses[survey.id].feedbackMsg}`)}
                            className="w-full py-1.5 bg-red-50 text-red-600 border border-red-300 rounded-lg font-black text-[10px] hover:bg-red-100 animate-pulse"
                          >
                            ⚠️ 보완필요(승인취소)
                          </button>
                        ) : myResponses[survey.id]?.feedbackMsg ? (
                          // 기존 보완 요청 노란 뱃지
                          <button 
                            onClick={() => alert(`💡 관리자 보완 요청 의견:\n\n${myResponses[survey.id].feedbackMsg}`)}
                            className="w-full py-1.5 bg-amber-50 text-amber-700 border border-amber-300 rounded-lg font-black text-[10px] hover:bg-amber-100 animate-pulse"
                          >
                            ⚠️ 보완 필요(클릭)
                          </button>
                        ) : (
                          <span className="w-full py-1.5 bg-slate-50 text-slate-500 border border-slate-200 rounded-lg font-black text-[10px]">대기 중</span>
                        )}
     
                        <button 
                          onClick={() => handleOpenSurvey(survey, true)} 
                          disabled={myResponses[survey.id]?.isApproved}
                          className={`w-full py-1.5 rounded-lg font-black text-[10px] transition-all shadow-sm border ${
                            myResponses[survey.id]?.isApproved 
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' 
                              : 'bg-white border-teal-200 text-teal-600 hover:bg-teal-50'
                          }`}
                        >
                          {myResponses[survey.id]?.isApproved ? '수정불가' : '✏️ 답변 수정'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {eligibleSurveys.length === 0 && (
                <tr><td colSpan={9} className="py-16 text-center text-slate-400 font-bold bg-slate-50/30">현재 변경 가능한 활성 접수 내역이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalEligiblePages > 1 && (
          <div className="flex justify-center items-center gap-1.5 py-4 border-t border-slate-100 bg-white">
            <button disabled={eligiblePage === 1} onClick={() => setEligiblePage(p => p - 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-xl">이전</button>
            {Array.from({ length: totalEligiblePages }).map((_, i) => (
              <button key={i} onClick={() => setEligiblePage(i + 1)} className={`w-7 h-7 rounded-xl text-xs font-black ${eligiblePage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border'}`}>{i + 1}</button>
            ))}
            <button disabled={eligiblePage === totalEligiblePages} onClick={() => setEligiblePage(p => p + 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-xl">다음</button>
          </div>
        )}
      </div>
     
      {/* 아코디언 트리거 가이드 배너 */}
      <div 
        onClick={() => setIsHistoryOpen(!isHistoryOpen)}
        className="w-full bg-gradient-to-r from-slate-700 to-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex items-center justify-between min-h-[120px] mt-12 cursor-pointer hover:brightness-95 active:scale-[0.99] transition-all select-none"
      >
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-1">Archive Repository (Click to Toggle)</p>
          <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
            과거 배송 신청 명세서 보관함
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">
              {isHistoryOpen ? '▲ 접기' : '▼ 펼치기'}
            </span>
          </h2>
          <p className="text-slate-400 text-xs font-semibold mt-1 opacity-90">배송 출고가 완료되었거나 기간이 마감된 열람 전용 내역입니다.</p>
        </div>
        <div className="text-4xl pr-4 font-light opacity-50 select-none hidden md:block">
          {isHistoryOpen ? '📦' : '🗄️'}
        </div>
      </div>
     
      {/* 대장 2: 과거 완료 참여 이력 대장 */}
      {isHistoryOpen && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-600"></div>
              <h2 className="text-xs font-black text-slate-800 tracking-tight">완료 배송 대장</h2>
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">총 {filteredHistory.length}건</span>
            </div>
            
            <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <span className="text-slate-500">연도 필터 :</span>
              <select 
                value={historyYear} 
                onChange={(e) => { setHistoryYear(e.target.value); setHistoryPage(1); }} 
                className="bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-1.5 font-black focus:outline-none focus:border-slate-500 text-[11px] cursor-pointer shadow-sm transition-colors"
              >
                <option value="ALL">전체 내역 보기</option>
                <option value="2026">2026년도</option>
                <option value="2025">2025년도</option>
              </select>
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="py-4 pl-8 w-16 text-center">NO</th>
                  <th className="py-4 px-3 w-28 text-center">게시번호</th>
                  <th className="py-4 px-3 w-28 text-center">게시일</th>
                  <th className="py-4 px-4">게시명</th>
                  <th className="py-4 px-3 w-36 text-center">대상</th>
                  <th className="py-4 px-4 w-48 text-center">접수 일시</th>
                  <th className="py-4 px-3 w-40 text-center">기간</th>
                  <th className="py-4 pr-8 w-44 text-center">명세서 확인</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedHistory.map((survey: any, index: number) => {
                  const reverseNo = filteredHistory.length - ((historyPage - 1) * itemsPerPage + index);
                  return (
                    <tr key={survey.id} className="hover:bg-slate-50/50 transition-colors h-16">
                      <td className="text-center text-slate-400 font-black pl-8">{reverseNo}</td>
                      <td className="text-center font-mono text-slate-500">{100 + (Number(survey.id) || 0)}</td>
                      <td className="text-center font-mono text-slate-500">{survey.postDate}</td>
                      <td className="px-4">
                        <div className="font-black text-slate-800 text-[12px]">{survey.title}</div>
                      </td>
                      <td className="text-center text-slate-500 font-medium px-3">{survey.target}</td>
                      <td className="text-center text-slate-700 font-bold px-4 whitespace-nowrap">{survey.submittedAt}</td>
                      <td className="text-center font-mono text-slate-500 leading-relaxed whitespace-nowrap px-3">
                        <div>{survey.startDate} ~</div>
                        <div className="text-slate-400 font-medium">{survey.endDate}</div>
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
                  <tr><td colSpan={8} className="py-24 text-center text-slate-400 font-bold bg-slate-50/30">조건에 맞는 과거 완료 이력이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalHistoryPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 py-4 border-t border-slate-100 bg-white">
              <button disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-xl">이전</button>
              {Array.from({ length: totalHistoryPages }).map((_, i) => (
                <button key={i} onClick={() => setHistoryPage(i + 1)} className={`w-7 h-7 rounded-xl text-xs font-black ${historyPage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border'}`}>{i + 1}</button>
              ))}
              <button disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => p + 1)} className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-xl">다음</button>
            </div>
          )}
        </div>
      )}
     
      {/* 🌟 수정 모달 */}
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
     
      {/* 🌟 이력 뷰어 모달 */}
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