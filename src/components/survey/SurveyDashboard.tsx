'use client';
  
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
  
// 로딩 스켈레톤 (와이드 형태)
const LoadingSkeleton = () => (
  <div className="w-full max-w-6xl mx-auto py-16 px-6 space-y-6 animate-pulse">
    <div className="w-64 h-10 bg-slate-200 rounded-lg mb-12"></div>
    <div className="w-full h-48 bg-slate-200 rounded-3xl"></div>
    <div className="w-full h-48 bg-slate-200 rounded-3xl"></div>
  </div>
);
  
export default function SurveyDashboard() {
  const [stats, setStats] = useState({
    general: { pending: 0, nudge: 0, total: 0 },
    delivery: { pending: 0, nudge: 0, total: 0 }
  });
  const [loading, setLoading] = useState(true);
     
  useEffect(() => {
    const syncData = async () => {
      try {
        const ts = Date.now();
        // 🚀 [DB 정합성 코어 1]: 마스터 데이터 파이프라인 병렬 실시간 수신 (캐시 원천 차단)
        const [uRes, unitsRes, generalSurveyRes, deliverySurveyRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }).catch(() => null),
          fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }).catch(() => null),
          fetch('/api/survey/general?t=' + ts, { cache: 'no-store' }).catch(() => null),
          fetch('/api/survey/delivery?t=' + ts, { cache: 'no-store' }).catch(() => null)
        ]);
        
        const currentUser = uRes && uRes.ok ? await uRes.json() : null;
        const unitsList = unitsRes && unitsRes.ok ? await unitsRes.json() : [];
        const generalSurveys = generalSurveyRes && generalSurveyRes.ok ? await generalSurveyRes.json() : [];
        const deliverySurveys = deliverySurveyRes && deliverySurveyRes.ok ? await deliverySurveyRes.json() : [];
     
        if (currentUser) {
          const myUnit = unitsList.find((u: any) => u.id === currentUser.dept_id);
          currentUser.unit = myUnit || { unit_name: '소속없음' };
          const userEmail = currentUser.email || 'user@kpcqa.or.kr';
     
          // 조직도 타겟팅 확인 함수 (상세 페이지 로직 완벽 복제)
          const checkTarget = (targetString: string, userDeptName: string) => {
            if (!targetString || targetString === '전사') return true;
            const targetDepts = targetString.split(',').map(t => t.trim());
            if (!userDeptName) return false;
            if (targetDepts.includes(userDeptName)) return true;
             
            let currentId = unitsList.find((u: any) => u.unit_name === userDeptName)?.id;
            while (currentId) {
              const unit = unitsList.find((u: any) => u.id === currentId);
              if (unit && unit.parent_id) {
                const parentUnit = unitsList.find((u: any) => u.id === unit.parent_id);
                if (parentUnit && targetDepts.includes(parentUnit.unit_name)) return true; 
                currentId = unit.parent_id;
              } else break;
            }
            return false;
          };
          
          // 🚀 [DB 정합성 코어 2]: 제출 여부를 완벽 대조하기 위해 각 도메인별 응답 대장 서버 실시간 호출
          const [generalRespRes, deliveryRespRes] = await Promise.all([
            fetch('/api/survey/general', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'GET_RESPONSES' }),
              cache: 'no-store'
            }).catch(() => null),
            fetch('/api/survey/delivery', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'GET_RESPONSES' }),
              cache: 'no-store'
            }).catch(() => null)
          ]);

          const dbGeneralResponses = generalRespRes && generalRespRes.ok ? await generalRespRes.json() : [];
          const dbDeliveryResponses = deliveryRespRes && deliveryRespRes.ok ? await deliveryRespRes.json() : [];

          // 내 참여 여부 판단용 해시맵 빌드
          const generalResponsesMap: Record<string, boolean> = {};
          dbGeneralResponses.forEach((r: any) => {
            if (r.userEmail === userEmail) generalResponsesMap[r.surveyId] = true;
          });

          const deliveryResponsesMap: Record<string, boolean> = {};
          dbDeliveryResponses.forEach((r: any) => {
            if (r.userEmail === userEmail) deliveryResponsesMap[r.surveyId] = true;
          });
     
          // -------------------------------------------------------------
          // [1] 일반 설문 (General) 데이터 실시간 DB 계산 (로컬스토리지 완전 대체)
          // -------------------------------------------------------------
          let gPending = 0, gNudge = 0, gTotal = 0;
          generalSurveys.forEach((s: any) => {
            if (s.status === '진행중') {
              gTotal++;
              const isTargeted = currentUser.roles?.includes('LV_1') || checkTarget(s.target, currentUser.unit.unit_name);
              if (isTargeted && !generalResponsesMap[s.id]) {
                gPending++;
                // 서버 원장에 명시된 독촉 대상 배열 검사
                if (s.nudgedUsers && s.nudgedUsers.includes(userEmail)) gNudge++;
              }
            }
          });
     
          // -------------------------------------------------------------
          // [2] 배달/신청 (Delivery) 데이터 실시간 DB 계산 (로컬스토리지 완전 대체)
          // -------------------------------------------------------------
          let dPending = 0, dNudge = 0, dTotal = 0;
          deliverySurveys.forEach((s: any) => {
            if (s.status === '진행중') {
              dTotal++;
              const isTargeted = currentUser.roles?.includes('LV_1') || checkTarget(s.target, currentUser.unit.unit_name);
              if (isTargeted && !deliveryResponsesMap[s.id]) {
                dPending++;
                // 서버 원장에 명시된 독촉 대상 배열 검사
                if (s.nudgedUsers && s.nudgedUsers.includes(userEmail)) dNudge++;
              }
            }
          });
     
          // 최종 상태 업데이트
          setStats({
            general: { pending: gPending, nudge: gNudge, total: gTotal },
            delivery: { pending: dPending, nudge: dNudge, total: dTotal }
          });
        }
      } catch (err) {
        console.error("Dashboard Sync Error:", err);
      } finally {
        setLoading(false);
      }
    };
    syncData();
  }, []);
     
  if (loading) return <LoadingSkeleton />;
     
  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      {/* 프리미엄 헤더 영역 (Dark) */}
      <div className="bg-slate-900 pt-16 pb-32 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-blue-400 font-black tracking-widest text-[11px] uppercase mb-4">Command Center</p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            통합 업무 대시보드
          </h1>
          <p className="text-slate-400 mt-4 font-medium max-w-xl">
            전사 설문조사 및 임직원 복지 물품 배송 현황을 실시간으로 관리합니다.<br/>
            하단 패널에서 처리해야 할 업무를 확인하고 즉시 이동하세요.
          </p>
        </div>
      </div>
     
      {/* 메인 허브 패널 영역 */}
      <div className="max-w-6xl mx-auto px-6 -mt-16 space-y-6 relative z-10">
        
        {/* 일반 설문 와이드 패널 */}
        <WideHubPanel 
          title="일반조사/익명조사 설문"
          titleEn="General Survey"
          desc="사내 의견 수렴, 수요 조사 및 전사 설문을 관리하고 실시간 응답 현황을 추적합니다."
          icon="📊"
          theme="indigo"
          stats={stats.general}
          link="/survey/general/dashboard"
        />
     
        {/* 배달/신청 와이드 패널 */}
        <WideHubPanel 
          title="배송/꽃배달 신청 조사"
          titleEn="Delivery & Logistics"
          desc="임직원 복지 물품 배송지 접수 및 물류 출고 프로세스를 효율적으로 관리합니다."
          icon="📦"
          theme="teal"
          stats={stats.delivery}
          link="/survey/delivery/dashboard"
        />
     
      </div>
    </div>
  );
}
     
// 와이드 형태의 프리미엄 패널 컴포넌트
const WideHubPanel = ({ title, titleEn, desc, icon, theme, stats, link }: any) => {
  const colors: Record<string, any> = {
    indigo: {
      iconBg: 'bg-indigo-50 text-indigo-600',
      btnPrimary: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30',
      badge: 'bg-indigo-100 text-indigo-700',
      nudgeIcon: 'text-indigo-500'
    },
    teal: {
      iconBg: 'bg-teal-50 text-teal-600',
      btnPrimary: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/30',
      badge: 'bg-teal-100 text-teal-700',
      nudgeIcon: 'text-teal-500'
    }
  };
  const c = colors[theme];
     
  return (
    <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 transition-all duration-300 hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] flex flex-col lg:flex-row items-center gap-10">
      
      <div className="flex-1 flex gap-6 w-full lg:w-auto">
        <div className={`w-20 h-20 shrink-0 rounded-[1.5rem] flex items-center justify-center text-4xl ${c.iconBg}`}>
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-black text-slate-900">{title}</h2>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-widest uppercase ${c.badge}`}>
              {titleEn}
            </span>
          </div>
          <p className="text-sm text-slate-500 font-medium leading-relaxed">
            {desc}
          </p>
        </div>
      </div>
     
      <div className="flex gap-6 w-full lg:w-auto shrink-0 border-y lg:border-y-0 lg:border-l border-slate-100 py-6 lg:py-0 lg:pl-10">
        <div className="flex flex-col justify-center">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">참여 대기</p>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-black text-slate-800">{stats.pending}</span>
            <span className="text-sm font-bold text-slate-400">/{stats.total}건</span>
          </div>
        </div>
        
        <div className="flex flex-col justify-center pl-6 border-l border-slate-100">
          <p className={`text-[11px] font-black uppercase tracking-widest mb-1 ${stats.nudge > 0 ? 'text-red-500' : 'text-slate-400'}`}>
            긴급 요청(독촉)
          </p>
          <div className="flex items-baseline gap-1">
            {stats.nudge > 0 && <span className="text-xl animate-pulse mr-1">🚨</span>}
            <span className={`text-4xl font-black ${stats.nudge > 0 ? 'text-red-600' : 'text-slate-800'}`}>
              {stats.nudge}
            </span>
            <span className="text-sm font-bold text-slate-400">건</span>
          </div>
        </div>
      </div>
     
      <div className="flex flex-col justify-center gap-3 w-full lg:w-48 shrink-0">
        <Link 
          href={link} 
          className={`w-full flex items-center justify-center gap-2 py-5 rounded-xl font-black text-sm text-white shadow-lg transition-all active:scale-95 ${c.btnPrimary}`}
        >
          현황판 진입 <span className="text-lg leading-none">→</span>
        </Link>
      </div>
     
    </div>
  );
};