'use client';
  
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { isPendingSupplyRequest } from '@/utils/supplyRequestStatus';
  
// 로딩 스켈레톤 (와이드 레이아웃 맞춤형 디자인)
const LoadingSkeleton = () => (
  <div className="w-full max-w-6xl mx-auto py-16 px-6 space-y-6 animate-pulse">
    <div className="w-64 h-10 bg-slate-200 rounded-lg mb-12"></div>
    <div className="grid grid-cols-1 gap-6">
      <div className="w-full h-48 bg-slate-200 rounded-[2rem]"></div>
      <div className="w-full h-48 bg-slate-200 rounded-[2rem]"></div>
      <div className="w-full h-48 bg-slate-200 rounded-[2rem]"></div>
    </div>
  </div>
);
  
export default function AssetIntegratedDashboard() {
  const [stats, setStats] = useState({
    supplies: { myPending: 0, totalPending: 0 },
    bizcard: { myPending: 0, totalPending: 0 }
  });
  const [itActiveSurvey, setItActiveSurvey] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [originUrl, setOriginUrl] = useState('');
  
  // 🚀 [권한 통제 벨트]: 직급(LV)에 상관없이 이 유저가 관리자 업무 대상자인지 판별하는 마스터 상태
  const [isManager, setIsManager] = useState(false);
  
  useEffect(() => {
    setOriginUrl(window.location.origin);
    
    const getSafeArray = async (res: Response | null) => {
      if (!res || !res.ok) return [];
      try {
        const data = await res.json();
        return Array.isArray(data) ? data : (data.data || []);
      } catch {
        return [];
      }
    };

    const syncDashboardMetrics = async () => {
      try {
        const ts = Date.now();
        const [uRes, unitsRes, supReqRes, itSurvRes, bizReqRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/asset/supplies/master/requests?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/asset/businesscard/master/requests?t=${ts}`, { cache: 'no-store' }).catch(() => null)
        ]);
        
        const currentUser = uRes && uRes.ok ? await uRes.json() : null;
  
        if (currentUser) {
          const userEmail = currentUser.email;
          const userName = currentUser.name;
          
          // 관리자 권한 플래그 세팅
          const hasManagerPermission = currentUser.roles?.includes('LV_1') || currentUser.roles?.includes('LV_2') || currentUser.isAssetAdmin === true;
          setIsManager(hasManagerPermission);
     
          // -------------------------------------------------------------
          // [1] 일반소모품 (Supplies) 메트릭 계산 (나의 대기 vs 전사 대기)
          // -------------------------------------------------------------
          const supRequests = await getSafeArray(supReqRes);
          
          const mySupPending = supRequests.filter((r: any) => 
            (r.userEmail === userEmail || r.email === userEmail || r.user_email === userEmail) && 
            isPendingSupplyRequest(r.status)
          ).length;

          const totalSupPending = supRequests.filter((r: any) => 
            isPendingSupplyRequest(r.status)
          ).length;
     
          // -------------------------------------------------------------
          // [2] IT업무자산 (IT Assets) 실사 현황
          // -------------------------------------------------------------
          const itSurveys = await getSafeArray(itSurvRes);
          const activeSurvey = itSurveys.find((s: any) => s.status === '진행중');
          setItActiveSurvey(activeSurvey || null);
     
          // -------------------------------------------------------------
          // [3] 명함 신청 (Business Card) 메트릭 계산 (나의 대기 vs 전사 대기)
          // -------------------------------------------------------------
          const bizRequests = await getSafeArray(bizReqRes);
          
          const myBizPending = bizRequests.filter((r: any) => 
            (r.userEmail === userEmail || r.email === userEmail || r.userName === userName) && 
            r.adminStatus === '대기중'
          ).length;

          const totalBizPending = bizRequests.filter((r: any) => 
            r.adminStatus === '대기중'
          ).length;
     
          setStats({
            supplies: { myPending: mySupPending, totalPending: totalSupPending },
            bizcard: { myPending: myBizPending, totalPending: totalBizPending }
          });
        }
      } catch (err) {
        console.error("Asset Dashboard Sync Error:", err);
      } finally {
        setLoading(false);
      }
    };
    syncDashboardMetrics();
  }, []);
  
  if (loading) return <LoadingSkeleton />;
  
  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      <div className="bg-slate-900 pt-16 pb-32 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-indigo-400 font-black tracking-widest text-[11px] uppercase mb-4">Resource Command Center</p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            경영기획센터 관리자산 대시보드
          </h1>
          <p className="text-slate-400 mt-4 font-medium max-w-2xl leading-relaxed">
            KPCQA 전사가 신청가능한 비품 현황, 
            <br /> 
            IT 업무용 자산 대장 등 경영기획센터 제공 서비스를 통합 관제합니다.
            <br />
            하단 도메인 패널에서 목적에 맞는 버튼을 선택하여 진입하세요.
          </p>
        </div>
      </div>
  
      <div className="max-w-6xl mx-auto px-6 -mt-16 space-y-6 relative z-10">
        
        {/* 🚀 [1] 일반소모품 대시보드 */}
        <WideHubPanel 
          title="일반소모품"
          titleEn="General Office Supplies"
          desc="사내 공통 소모품과 일반 비품의 실시간 재고를 파악하고, 부서별 비품 청구 내역을 통제합니다."
          icon="📦"
          theme="amber"
          myPendingCount={stats.supplies.myPending}
          totalPendingCount={stats.supplies.totalPending}
          userLink="/asset/supplies/dept" 
          adminLink="/asset/supplies/master/requests" 
          isManager={isManager}
        />
  
        {/* 🚀 [2] IT업무자산 대시보드 */}
        <WideHubPanel 
          title="IT·업무자산"
          titleEn="IT Infrastructure Assets"
          desc="임직원용 노트북, 모니터 등 전사 정보화 자산 대장을 추적하고 실사 조사를 관제합니다."
          icon="🖥️"
          theme="indigo"
          userLink="/asset/it/personal" 
          adminLink="/asset/it/master/dashboard" 
          isManager={isManager}
          customContent={
            <div className="flex flex-col justify-center w-full">
              <p className="text-[11px] font-black text-indigo-400 uppercase tracking-widest mb-1">실사진행현황</p>
              {itActiveSurvey ? (
                <div className="text-xs font-bold text-slate-700 leading-relaxed bg-indigo-50/40 p-3 rounded-xl border border-indigo-100 w-[240px]">
                  <span className="text-indigo-600 font-black text-sm block mb-1">실사 진행중 🚨</span>
                  <span className="text-slate-500 text-[10px]">({itActiveSurvey.startDate} ~ {itActiveSurvey.endDate})</span>
                  <div className="mt-2 text-[9px] bg-white p-1.5 rounded-lg border border-slate-200 truncate font-mono shadow-sm">
                    <span className="text-slate-400 font-bold block mb-0.5">URL 경로:</span>
                    <a href={`${originUrl}/audit/public/${itActiveSurvey.id}`} className="text-indigo-500 hover:underline">
                      {`${originUrl}/audit/public/${itActiveSurvey.id.substring(0,8)}...`}
                    </a>
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-sm mr-1 opacity-70">⏸️</span>
                  <span className="text-2xl font-black text-slate-400 tracking-tighter">실사 대기중</span>
                </div>
              )}
            </div>
          }
        />
  
        {/* 🚀 [3] 명함 신청 대시보드 */}
        <WideHubPanel 
          title="명함 신청"
          titleEn="Business Card Request"
          desc="신규 입사자 및 승진, 정보 변경에 따른 임직원 명함 제작 신청 및 발주를 관리합니다."
          icon="📇"
          theme="teal"
          myPendingCount={stats.bizcard.myPending}
          totalPendingCount={stats.bizcard.totalPending}
          userLink="/asset/businesscard/my-page" 
          adminLink="/asset/businesscard/master/requests" 
          isManager={isManager}
        />
  
      </div>
    </div>
  );
}
     // -------------------------------------------------------------
// 🚀 전사 공통 인터페이스: 좌(나의 수치) / 우(전사 수치) 완벽 대칭 패널
// -------------------------------------------------------------
const WideHubPanel = ({ title, titleEn, desc, icon, theme, myPendingCount, totalPendingCount, userLink, adminLink, isManager, customContent }: any) => {
  const colors: Record<string, any> = {
    amber: {
      iconBg: 'bg-amber-50 text-amber-600',
      btnPrimary: 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20 text-white',
      badge: 'bg-amber-100 text-amber-700',
      warnColor: 'text-amber-600'
    },
    indigo: {
      iconBg: 'bg-indigo-50 text-indigo-600',
      btnPrimary: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20 text-white',
      badge: 'bg-indigo-100 text-indigo-700',
      warnColor: 'text-indigo-600'
    },
    teal: {
      iconBg: 'bg-teal-50 text-teal-600',
      btnPrimary: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/20 text-white',
      badge: 'bg-teal-100 text-teal-700',
      warnColor: 'text-teal-600'
    }
  };
  const c = colors[theme];
  
  return (
    <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-200/80 transition-all duration-300 hover:shadow-[0_20px_40px_rgb(0,0,0,0.07)] flex flex-col lg:flex-row items-center gap-10">
      
      {/* 1. 왼쪽 코어 설명 블록 */}
      <div className="flex-1 flex gap-6 w-full lg:w-auto">
        <div className={`w-20 h-20 shrink-0 rounded-[1.5rem] flex items-center justify-center text-4xl shadow-sm ${c.iconBg}`}>
          {icon}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{title}</h2>
            <span className={`px-2.5 py-0.5 rounded text-[10px] font-black tracking-widest uppercase leading-none ${c.badge}`}>
              {titleEn}
            </span>
          </div>
          <p className="text-sm text-slate-500 font-medium leading-relaxed pt-1">
            {desc}
          </p>
        </div>
      </div>
  
      {/* 2. 중앙 리얼타임 데이터 현황 (너비 280px 확장 및 줄바꿈 방지) */}
      <div className="flex gap-6 w-full lg:w-[280px] shrink-0 border-y lg:border-y-0 lg:border-l border-slate-100 py-6 lg:py-0 lg:pl-8">
        {customContent ? (
          customContent
        ) : (
          <>
            {/* 좌측: 나의 신청대기 */}
            <div className="flex flex-col justify-center min-w-[90px]">
              <p className={`text-[11px] font-black uppercase tracking-widest mb-1 whitespace-nowrap ${c.warnColor}`}>나의 신청대기</p>
              <div className="flex items-baseline gap-1">
                <span className={`text-4xl font-black tracking-tighter ${c.warnColor}`}>{myPendingCount || 0}</span>
                <span className={`text-xs font-bold ${c.warnColor} opacity-70`}>건</span>
              </div>
            </div>
            
            {/* 우측: 전사 신청대기 (불꽃 삭제) */}
            <div className="flex flex-col justify-center pl-6 border-l border-slate-200 min-w-[90px]">
              <p className="text-[11px] font-black uppercase tracking-widest mb-1 whitespace-nowrap text-slate-600">전사 신청대기</p>
              <div className="flex items-baseline gap-1">
                {/* 🔥 불꽃 아이콘 삭제됨 */}
                <span className="text-4xl font-black tracking-tighter text-slate-800">{totalPendingCount || 0}</span>
                <span className="text-xs font-bold text-slate-500">건</span>
              </div>
            </div>
          </>
        )}
      </div>
  
      {/* 3. 우측 듀얼 진입 라우터 링크 버튼 벨트 */}
      <div className="flex flex-col justify-center gap-2 w-full lg:w-52 shrink-0">
        <Link 
          href={userLink} 
          className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-xs shadow-sm uppercase tracking-wider transition-all active:scale-95 ${c.btnPrimary}`}
        >
          👤 나의 신청 / 현황 <span className="text-sm leading-none">→</span>
        </Link>
        
        <Link 
          href={adminLink} 
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-xs text-slate-200 bg-slate-800 hover:bg-slate-900 border border-slate-700/60 shadow-sm uppercase tracking-wider transition-all active:scale-95"
        >
          ⚙️ 관리자 패널 제어 <span className="text-sm leading-none">→</span>
        </Link>
      </div>
  
    </div>
  );
};