'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { saveAs } from 'file-saver';
  
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
  
  // 🌟 관리자가 독촉한 배달 조사 ID 배열
  const [nudgedSurveys, setNudgedSurveys] = useState<string[]>([]);

  const [introModalSurvey, setIntroModalSurvey] = useState<any | null>(null);
  const [activeFullScreenSurvey, setActiveFullScreenSurvey] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
     
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    // 🔥 카카오 우편번호 스크립트 동적 주입 (배달 도메인 고유 기능 유지)
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
     
    const fetchData = async () => {
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
  
          // 💡 [배달 도메인 전용 키]
          const storedResponses = JSON.parse(localStorage.getItem(`db_my_delivery_responses_${userData.email}`) || '{}');
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
            // 💡 [배달 도메인 전용 키]
            const stored = localStorage.getItem(`db_my_delivery_responses_${u.email}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              Object.keys(parsed).forEach(surveyId => {
                realRes[`${surveyId}_${u.email}`] = true;
              });
            }
          });
          setAllResponses(realRes);
        }
  
        // 💡 [배달 도메인 전용 키]
        const storedSurveys = localStorage.getItem('admin_delivery_surveys');
        if (storedSurveys) setSurveys(JSON.parse(storedSurveys));

        // 🌟 [배달 도메인 전용 독촉 데이터 연동]
        const storedNudges = JSON.parse(localStorage.getItem('nudged_delivery_surveys') || '[]');
        setNudgedSurveys(storedNudges);
  
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
     
  const todayStr = new Date().toISOString().split('T')[0];
     
  const visibleSurveys = useMemo(() => {
    return surveys.filter(s => {
      if (s.status !== '진행중' && s.status !== '완료') return false;
      if (currentUser?.roles?.includes('LV_1')) return true; 
      return checkHierarchyTarget(s.target, currentUser?.unit?.unit_name);
    });
  }, [surveys, currentUser, unitsList]);
     
  // 🌟 [필터 솔팅 엔진]: 독촉 필터 켬 -> 독촉만 / 대기 필터 켬 -> 대기건 전체
  const filteredSurveys = useMemo(() => {
    if (filterNudged) {
      return visibleSurveys.filter(s => s.status === '진행중' && !myResponses[s.id] && nudgedSurveys.includes(s.id));
    }
    if (filterPending) {
      return visibleSurveys.filter(s => s.status === '진행중' && !myResponses[s.id]);
    }
    return visibleSurveys;
  }, [visibleSurveys, filterPending, filterNudged, myResponses, nudgedSurveys]);
     
  const paginatedSurveys = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSurveys.slice(start, start + itemsPerPage);
  }, [filteredSurveys, currentPage]);
  const totalPages = Math.ceil(filteredSurveys.length / itemsPerPage);
     
  useEffect(() => { setCurrentPage(1); }, [filterPending, filterNudged]);
     
  const stats = useMemo(() => {
    if (!currentUser) return { ongoingCount: 0, closingTodayCount: 0, myPendingCount: 0, nudgeCount: 0 };
    const allOngoing = surveys.filter(s => s.status === '진행중');
    const pendingSurveys = allOngoing.filter(s => {
      const isTargeted = checkHierarchyTarget(s.target, currentUser?.unit?.unit_name);
      return isTargeted && !myResponses[s.id];
    });
    
    // 🌟 독촉 수량 계산
    const nudgedCount = pendingSurveys.filter(s => nudgedSurveys.includes(s.id)).length;

    return {
      ongoingCount: visibleSurveys.filter(s => s.status === '진행중').length,
      closingTodayCount: visibleSurveys.filter(s => s.endDate === todayStr).length,
      myPendingCount: pendingSurveys.length,
      nudgeCount: nudgedCount
    };
  }, [surveys, visibleSurveys, myResponses, todayStr, currentUser, unitsList, nudgedSurveys]);
     
  const formatDeliveryDate = (dateStr: string) => {
    if (!dateStr) return '';
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return dateStr;
    return `${dateObj.getFullYear()}년 ${String(dateObj.getMonth() + 1).padStart(2, '0')}월 ${String(dateObj.getDate()).padStart(2, '0')}일 (${dayNames[dateObj.getDay()]})`;
  };
     
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
    if (survey.status === '완료') {
      alert('🔒 본 복지 배송 신청 조사는 마감되었습니다.');
      return;
    }
    setIntroModalSurvey(survey);
  };
     
  const handleStartSurvey = () => {
    const surveyId = introModalSurvey.id;
    const draftData = localStorage.getItem(`delivery_draft_${surveyId}_${currentUserEmail}`);
    
    if (draftData) {
      if (confirm('💾 이전에 작성 중이던 주소지 임시 저장 내역이 있습니다.\n이어서 작성하시겠습니까?')) {
        setFormData(JSON.parse(draftData));
      } else {
        setFormData({});
      }
    } else {
      setFormData({});
    }
     
    const builderData = localStorage.getItem(`delivery_builder_${surveyId}`);
    const questions = builderData ? JSON.parse(builderData) : [
      { id: 'q_name', type: 'TEXT_SHORT', title: '수령인 성명', isRequired: true },
      { id: 'q_addr', type: 'SEARCH_ADDRESS', title: '상세 배송지 (우편번호 포함)', isRequired: true },
      { id: 'q_date', type: 'CALENDAR', title: '배송 요청일', isRequired: true }
    ];
    
    setActiveFullScreenSurvey({ ...introModalSurvey, questions });
    setIntroModalSurvey(null);
  };
     
  const handleSaveDraft = () => {
    if (!activeFullScreenSurvey) return;
    localStorage.setItem(`delivery_draft_${activeFullScreenSurvey.id}_${currentUserEmail}`, JSON.stringify(formData));
    alert('💾 현재까지 작성한 배송지 내역이 임시 저장되었습니다.');
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
          alert(`✏️ [${q.title}] 항목은 필수 기입 사항입니다.`);
          return;
        }
      }
    }
     
    if (!confirm('배송지 명세를 최종 접수하시겠습니까?\n제출 후에는 수정할 수 없습니다.')) return;
     
    const submittedDate = `${todayStr} ${new Date().toLocaleTimeString()}`;
    const nextResponses = {
      ...myResponses,
      [activeFullScreenSurvey.id]: {
        submittedAt: submittedDate,
        answers: formData
      }
    };
    
    setMyResponses(nextResponses);
    localStorage.setItem(`db_my_delivery_responses_${currentUserEmail}`, JSON.stringify(nextResponses));
    localStorage.removeItem(`delivery_draft_${activeFullScreenSurvey.id}_${currentUserEmail}`); 
    
    alert(`🚚 ${submittedDate}에 정상적으로 접수되었습니다.\n운영 부서에서 확인 후 순차 배송을 시작합니다.`);
    setActiveFullScreenSurvey(null);
  };
     
  if (loading) return <div className="p-20 text-center font-black text-blue-600 animate-pulse text-xl uppercase tracking-widest">Delivery Dashboard Syncing...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 🌟 상단 대시보드 배너 레이아웃 재구성 (좌측 메인 + 우측 3개의 상태 카드) */}
      <div className="flex flex-col xl:flex-row gap-4 w-full">
        
        {/* 메인 통계 배너 */}
        <div className="xl:w-2/5 bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[120px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden group">
          <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-1">My Delivery Mission</p>
            <div className="flex items-end gap-2 mt-1">
              <h3 className="text-4xl font-black">{stats.myPendingCount}</h3>
              <p className="text-xs font-bold mb-1 opacity-90">건의 참여할 배송 조사가 있습니다.</p>
            </div>
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2">
            <button 
              onClick={() => {
                if (stats.myPendingCount === 0) return alert('현재 신청 대기 중인 배송 공고가 없습니다.');
                setFilterPending(!filterPending);
                setFilterNudged(false); // 독촉 필터 해제
              }} 
              className={`shrink-0 text-[10px] font-black px-4 py-2 rounded-xl transition-all border shadow-sm ${filterPending ? 'bg-white text-indigo-700 border-white' : 'bg-white/20 hover:bg-white/30 text-white border-white/20'}`}
            >
              {filterPending ? '전체 목록 ↺' : '대상만 보기 →'}
            </button>
          </div>
        </div>
  
        {/* 서브 상태 카드 그룹 */}
        <div className="xl:w-3/5 flex flex-col md:flex-row gap-4">
          <div className="flex-1 bg-white border border-slate-200 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px]">
            <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">진행 중 조사</p><h3 className="text-3xl font-black text-slate-800 mt-1">{stats.ongoingCount} <span className="text-sm font-bold text-slate-400">건</span></h3></div>
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">🚚</div>
          </div>
    
          <div className="flex-1 bg-white border border-slate-200 p-5 rounded-[2.5rem] shadow-sm flex items-center justify-between min-h-[120px]">
            <div><p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">오늘 마감</p><h3 className="text-3xl font-black text-red-600 mt-1">{stats.closingTodayCount} <span className="text-sm font-bold text-red-300">건</span></h3></div>
            <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-2xl">⏰</div>
          </div>

          {/* 🌟 긴급 참여 요청(독촉) 상태 필터 토글 카드 (0건일 때 애니메이션 정지 처리 반영) */}
          <div 
            onClick={() => {
              if (stats.nudgeCount === 0) return alert('현재 접수된 독촉(참여 요청) 배송 건이 없습니다.');
              setFilterNudged(!filterNudged);
              setFilterPending(false); // 일반 대기 필터 해제
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
                
                {/* 🌟 기존 배달 도메인 고유 기능(신청분류) 보존 구역 */}
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
                let done = 0, total = 0;
     
                if (allUsers.length > 0) {
                  const targetUsers = allUsers.filter(u => checkHierarchyTarget(s.target, u.dept));
                  total = targetUsers.length;
                  done = targetUsers.filter(u => allResponses[`${s.id}_${u.email}`]).length;
                }
     
                const rate = total > 0 ? Math.round((done/total)*100) : 0;
                const isClosingToday = s.endDate === todayStr;
                const isSubmitted = Boolean(myResponses[s.id]);
                const isTargeted = checkHierarchyTarget(s.target, currentUser?.unit?.unit_name);
                
                // 🌟 독촉(Nudge) 배지 판단 로직
                const isNudged = isTargeted && !isSubmitted && nudgedSurveys.includes(s.id);
  
                return (
                  <tr key={s.id} className={`transition-all ${isTargeted ? (isNudged ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50/50') : 'bg-slate-50 opacity-40 cursor-not-allowed grayscale'}`}>
                    <td className="text-center text-slate-400 font-black pl-8 py-4">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                    <td className="text-center font-black text-slate-600 px-2 py-4">{s.postNumber}</td>
                    <td className="text-center font-mono text-slate-500 px-3 py-4 whitespace-nowrap">{s.postDate || '-'}</td>
                    
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1 items-start">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => isTargeted && !isSubmitted && handleOpenIntro(s)} 
                            className={`font-black text-[12px] text-left line-clamp-1 ${!isTargeted ? 'text-slate-500 cursor-not-allowed' : isSubmitted ? 'text-slate-400 cursor-not-allowed' : 'text-slate-800 hover:text-blue-600 hover:underline'}`}
                          >
                            {s.title}
                          </button>
                          {isClosingToday && <span className="shrink-0 bg-red-600 text-white text-[8px] px-1.5 py-0.5 rounded font-black animate-pulse">마감임박</span>}
                        </div>
                        {/* 🌟 독촉 배지 출력 구역 */}
                        {isNudged && (
                          <span className="inline-block bg-red-100 text-red-600 border border-red-200 text-[8px] px-2 py-0.5 rounded shadow-sm font-black animate-pulse">
                            🚨 관리자 참여 요청
                          </span>
                        )}
                      </div>
                    </td>
                    
                    {/* 🌟 배달 도메인 고유 렌더링 (상시/기간) */}
                    <td className="text-center py-4 px-3">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black ${s.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700 border border-pink-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                        {s.deliveryType === 'ALWAYS' ? '상시' : '기간'}
                      </span>
                    </td>
  
                    <td className="px-3 py-4 text-center text-slate-600 font-medium whitespace-normal break-keep leading-relaxed">{s.target}</td>
                    <td className="text-center text-slate-500 text-[10px] px-3 py-4">
                      <div>{s.startDate} ~</div>
                      <div className={isClosingToday ? 'text-red-500 font-black' : ''}>{s.endDate}</div>
                    </td>
                    <td className="text-center font-black text-slate-700 px-2 py-4">{rate}%</td>
                    <td className="text-center font-black text-blue-600 px-2 py-4">{done}명</td>
                    <td className="text-center font-black text-red-500 px-2 py-4">{total - done}명</td>
     
                    <td className="text-center pr-8 py-4">
                      {!isTargeted ? (
                         <button disabled className="px-4 py-1.5 rounded-lg font-black text-[10px] bg-slate-200 text-slate-500 cursor-not-allowed">🚫 대상아님</button>
                      ) : isSubmitted ? (
                        <button onClick={() => alert(`✅ ${myResponses[s.id].submittedAt}에 배송지 접수가 완료되었습니다.`)} className="px-3 py-1.5 rounded-lg font-black text-[10px] transition-all whitespace-nowrap shadow-sm bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">📬 제출완료</button>
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
            <h3 className="text-xl font-black text-slate-800 mb-4">{introModalSurvey.title}</h3>
            {introModalSurvey.description ? (
              <p className="text-sm font-bold text-slate-500 bg-slate-50 p-4 rounded-xl w-full leading-relaxed mb-8 border border-slate-100">
                {introModalSurvey.description}
              </p>
            ) : (
              <p className="text-sm font-bold text-slate-400 mb-8">수령하실 정확한 배송지 정보를 입력해 주세요.</p>
            )}
            
            <div className="flex gap-3 w-full">
              <button onClick={() => setIntroModalSurvey(null)} className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black transition-colors">닫기</button>
              <button onClick={handleStartSurvey} className="flex-[2] py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black shadow-lg transition-colors text-[13px]">
                🚀 배송지 양식 작성하기
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
                <h1 className="text-base font-black text-slate-800 mt-1">{activeFullScreenSurvey.title}</h1>
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
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm mb-6">
              <h2 className="text-2xl font-black text-slate-900 mb-2">{activeFullScreenSurvey.title}</h2>
              {activeFullScreenSurvey.description && <p className="text-sm font-bold text-slate-500 leading-relaxed">{activeFullScreenSurvey.description}</p>}
            </div>
     
            {activeFullScreenSurvey.questions.map((q: any, qIdx: number) => (
              <div key={q.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <label className="block text-base font-black text-slate-800">
                  <span className="text-blue-500 mr-2">{qIdx + 1}.</span> {q.title} {q.isRequired && <span className="text-red-500 ml-1">*</span>}
                </label>
                
                {(q.description || q.referenceLink) && (
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2 mb-4">
                    {q.description && <p className="text-xs font-bold text-slate-600 leading-relaxed">{q.description}</p>}
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
                      const isChecked = q.type === 'CHOICE_SINGLE' 
                        ? formData[q.id] === opt.label 
                        : (formData[q.id] || []).includes(opt.label);
                        
                      return (
                        <label key={oIdx} className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${isChecked ? 'border-blue-500 bg-blue-50/30' : 'border-slate-200 hover:bg-slate-50'}`}>
                          <input 
                            type={q.type === 'CHOICE_SINGLE' ? 'radio' : 'checkbox'} 
                            name={q.id} 
                            value={opt.label} 
                            checked={isChecked} 
                            onChange={(e) => {
                              if(q.type === 'CHOICE_SINGLE') setFormData({...formData, [q.id]: e.target.value});
                              else {
                                const curr = formData[q.id] || [];
                                const next = e.target.checked ? [...curr, opt.label] : curr.filter((l:string)=>l!==opt.label);
                                setFormData({...formData, [q.id]: next});
                              }
                            }} 
                            className="accent-blue-600 w-4 h-4" 
                          />
                          <div className="flex flex-col gap-1.5 flex-1">
                            <span className="font-bold text-sm text-slate-700">{opt.label}</span>
                            {opt.imageUrl && <img src={opt.imageUrl} className="w-48 h-32 object-cover rounded-lg border border-slate-200 mt-2 shadow-sm" />}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : q.type === 'TEXT_LONG' ? (
                  <textarea value={formData[q.id] || ''} onChange={e => setFormData({...formData, [q.id]: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-blue-500 focus:bg-white transition-colors min-h-[120px] text-sm" placeholder="상세한 내역을 자유롭게 기재해 주세요." />
                ) : q.type === 'TEXT_SHORT' ? (
                  <input type="text" value={formData[q.id] || ''} onChange={e => setFormData({...formData, [q.id]: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-blue-500 focus:bg-white transition-colors text-sm" placeholder="정보를 입력하세요." />
                ) : q.type === 'SEARCH_ADDRESS' ? (
                  <div className="space-y-2 bg-slate-50 p-4 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 border bg-white px-3 py-2 rounded-xl shadow-sm">
                        <span className="font-black text-slate-400 text-[10px] uppercase">우편번호</span>
                        <input type="text" value={formData[`${q.id}_zip`] || ''} className="w-20 font-mono text-center font-black text-blue-600 bg-transparent outline-none" readOnly placeholder="자동검색" />
                      </div>
                      <button type="button" onClick={() => handleOpenUserPostcode(q.id)} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-slate-800 transition-transform active:scale-95 shadow-sm">
                        🔍 우편번호 검색
                      </button>
                    </div>
                    <input type="text" value={formData[`${q.id}_road`] || ''} placeholder="기본 도로명 주소" className="w-full p-3 border border-slate-200 rounded-xl bg-white text-slate-700 font-bold outline-none shadow-sm" readOnly />
                    <div className="flex items-center border border-blue-300 rounded-xl px-3 bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-200">
                      <span className="font-black text-blue-600 whitespace-nowrap text-xs pr-2">상세주소 :</span>
                      <input type="text" value={formData[`${q.id}_detail`] || ''} onChange={(e) => setFormData({ ...formData, [`${q.id}_detail`]: e.target.value })} placeholder="동, 호수 및 건물 상세 주소 기입" className="w-full p-3 text-sm font-bold text-slate-800 outline-none bg-transparent" />
                    </div>
                  </div>
                ) : q.type === 'CALENDAR' ? (
                  <div className="space-y-3 bg-slate-50 p-4 border border-slate-200 rounded-xl">
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
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    {q.templateFileName && (
                      <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                        <span className="text-xs font-bold text-slate-600">📋 첨부된 안내 서식: <span className="font-black text-slate-800">{q.templateFileName}</span></span>
                        <button type="button" onClick={() => fetch(q.templateFileData).then(r=>r.blob()).then(b=>saveAs(b, q.templateFileName))} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-black transition-colors">다운로드</button>
                      </div>
                    )}
                    <label className="block w-full cursor-pointer bg-white border-2 border-dashed border-blue-200 p-6 rounded-xl text-center hover:bg-blue-50 transition-colors">
                      <span className="text-2xl mb-2 block">📤</span>
                      <span className="text-xs font-black text-blue-600">제출할 파일을 선택하여 업로드하세요.</span>
                      {formData[q.id]?.fileName && <div className="mt-3 text-[11px] font-bold text-slate-500 bg-slate-100 py-1.5 px-3 rounded-full inline-block">{formData[q.id].fileName}</div>}
                      <input type="file" onChange={(e) => { const file = e.target.files?.[0]; if (file) setFormData({...formData, [q.id]: { fileName: file.name } }); }} className="hidden" />
                    </label>
                  </div>
                )}
              </div>
            ))}
     
            <div className="flex justify-center pt-8">
              <button onClick={handleSubmitForm} className="px-10 py-4 bg-blue-600 text-white rounded-full text-sm font-black shadow-xl hover:bg-blue-700 hover:scale-105 transition-all">
                🚀 배송지 명세 최종 접수
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}