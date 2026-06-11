'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

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
    supplies: { pending: 0, critical: 0, total: 0 },
    it: { pending: 0, critical: 0, total: 0 },
    outsourcing: { pending: 0, completed: 0, total: 0 }
  });
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const syncDashboardMetrics = async () => {
      try {
        const ts = Date.now();
        // 🚀 유저 및 부서 조직 마스터 데이터 동기화
        const [uRes, unitsRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }).catch(() => null),
          fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }).catch(() => null)
        ]);
        
        const currentUser = uRes && uRes.ok ? await uRes.json() : null;
        const unitsList = unitsRes && unitsRes.ok ? await unitsRes.json() : [];
  
        if (currentUser) {
          const myUnit = unitsList.find((u: any) => u.id === currentUser.dept_id);
          currentUser.unit = myUnit || { unit_name: '소속없음' };
          const userDept = currentUser.unit.unit_name;

          // -------------------------------------------------------------
          // [1] 일반소모품 (Supplies) 실시간 메트릭 연산
          // -------------------------------------------------------------
          const storedSupplies = localStorage.getItem('db_assets_supplies_matrix');
          const suppliesList = storedSupplies ? JSON.parse(storedSupplies) : [];
          
          // 내 부서 자산으로 필터링 (최고관리자 LV_1은 전사 수량 관제)
          const targetedSupplies = currentUser.roles?.includes('LV_1') 
            ? suppliesList 
            : suppliesList.filter((a: any) => a.dept === userDept);

          const sTotal = targetedSupplies.length;
          const sCritical = targetedSupplies.filter((a: any) => a.isCritical).length;
          const sPending = targetedSupplies.filter((a: any) => a.status === 'In-Review').length;

          // -------------------------------------------------------------
          // [2] IT업무자산 (IT Assets) 실시간 메트릭 연산
          // -------------------------------------------------------------
          const storedIT = localStorage.getItem('db_assets_it_matrix');
          const itList = storedIT ? JSON.parse(storedIT) : [];
          
          const targetedIT = currentUser.roles?.includes('LV_1') 
            ? itList 
            : itList.filter((a: any) => a.dept === userDept);

          const itTotal = targetedIT.length;
          const itCritical = targetedIT.filter((a: any) => a.isCritical).length;
          const itPending = targetedIT.filter((a: any) => a.status === 'In-Review').length;

          // -------------------------------------------------------------
          // [3] 외주업무서비스 (Outsourcing) 실시간 메트릭 연산 (단일 테이블 가동)
          // -------------------------------------------------------------
          const storedOutsourcing = localStorage.getItem('db_outsourcing_matrix');
          const outsourcingList = storedOutsourcing ? JSON.parse(storedOutsourcing) : [];
          
          const targetedOutsourcing = currentUser.roles?.includes('LV_1') 
            ? outsourcingList 
            : outsourcingList.filter((o: any) => o.dept_name === userDept);

          const oTotal = targetedOutsourcing.length;
          const oPending = targetedOutsourcing.filter((o: any) => o.status === 'PENDING' || o.status === 'APPROVED').length;
          const oCompleted = targetedOutsourcing.filter((o: any) => o.status === 'COMPLETED').length;

          // 메트릭스 전역 바인딩 타격
          setStats({
            supplies: { pending: sPending, critical: sCritical, total: sTotal },
            it: { pending: itPending, critical: itCritical, total: itTotal },
            outsourcing: { pending: oPending, completed: oCompleted, total: oTotal }
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
      {/* 프리미엄 헤더 영역 (Dark 컨트롤 타워 백본) */}
      <div className="bg-slate-900 pt-16 pb-32 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-indigo-400 font-black tracking-widest text-[11px] uppercase mb-4">Resource Command Center</p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            자산 및 외주업무 대시보드
          </h1>
          <p className="text-slate-400 mt-4 font-medium max-w-2xl leading-relaxed">
            KPCQA 전사 일반 비품 소모품 현황, IT 업무용 자산 대장 및 외주 연동 서비스를 통합 관제합니다.<br/>
            하단 도메인 패널에서 실시간 물류 변동성 및 업무 처리 현황을 확인한 후 진입하세요.
          </p>
        </div>
      </div>
  
      {/* 메인 허브 패널 영역 (마이너스 임베디드 마진 배열 적용) */}
      <div className="max-w-6xl mx-auto px-6 -mt-16 space-y-6 relative z-10">
        
        {/* [1] 일반소모품 대시보드 유닛 */}
        <WideHubPanel 
          title="일반소모품 관리"
          titleEn="General Office Supplies"
          desc="사내 공통 소모품과 일반 비품의 실시간 재고를 파악하고, 부서별 비품 청구 및 출고 내역을 통제합니다."
          icon="📦"
          theme="amber"
          stats={stats.supplies}
          statLabel1="청구 승인대기"
          statLabel2="재고 위험/경고"
          link="/asset/supplies/inventory"
        />
  
        {/* [2] IT업무자산 대시보드 유닛 */}
        <WideHubPanel 
          title="IT 업무 자산 관리"
          titleEn="IT Infrastructure Assets"
          desc="임직원용 노트북, 모니터 등 전사 정보화 자산 대장을 추적하고 4년 만료 대상 장비의 교체 주기를 관제합니다."
          icon="💻"
          theme="indigo"
          stats={stats.it}
          statLabel1="교체 신청대기"
          statLabel2="내구 만료장비"
          link="/asset/it"
        />
  
        {/* [3] 외주업무서비스 대시보드 유닛 (통합 5대 서비스 관문) */}
        <WideHubPanel 
          title="외주 업무 서비스"
          titleEn="Outsourcing Operations"
          desc="제본, 현판 제작, 문구 일괄구매, 기업 택배, 퀵 서비스 등 전사 5대 아웃소싱 비즈니스를 원스톱으로 관리합니다."
          icon="🏍️"
          theme="teal"
          stats={{ pending: stats.outsourcing.pending, critical: stats.outsourcing.completed, total: stats.outsourcing.total }}
          statLabel1="발주 진행중"
          statLabel2="최종 정산완료"
          link="/asset/outsourcing" // 🚀 새롭게 도달할 외주업무 통합 관문 허브 경로
        />
  
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 전사 공통 인터페이스: 와이드 형태의 프리미엄 관문 패널 컴포넌트
// -------------------------------------------------------------
const WideHubPanel = ({ title, titleEn, desc, icon, theme, stats, statLabel1, statLabel2, link }: any) => {
  const colors: Record<string, any> = {
    amber: {
      iconBg: 'bg-amber-50 text-amber-600',
      btnPrimary: 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/30',
      badge: 'bg-amber-100 text-amber-700',
      warnColor: 'text-amber-600'
    },
    indigo: {
      iconBg: 'bg-indigo-50 text-indigo-600',
      btnPrimary: 'bg-slate-900 hover:bg-slate-800 shadow-slate-900/30',
      badge: 'bg-indigo-100 text-indigo-700',
      warnColor: 'text-indigo-600'
    },
    teal: {
      iconBg: 'bg-teal-50 text-teal-600',
      btnPrimary: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/30',
      badge: 'bg-teal-100 text-teal-700',
      warnColor: 'text-emerald-600'
    }
  };
  const c = colors[theme];
  
  return (
    <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-200/80 transition-all duration-300 hover:shadow-[0_20px_40px_rgb(0,0,0,0.07)] flex flex-col lg:flex-row items-center gap-10">
      
      {/* 왼쪽 코어 설명 블록 */}
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
  
      {/* 중앙 리얼타임 데이터 현황 매트릭스 */}
      <div className="flex gap-10 w-full lg:w-auto shrink-0 border-y lg:border-y-0 lg:border-l border-slate-100 py-6 lg:py-0 lg:pl-10">
        <div className="flex flex-col justify-center min-w-[80px]">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">{statLabel1}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-black text-slate-800 tracking-tighter">{stats.pending}</span>
            <span className="text-xs font-bold text-slate-400">/{stats.total}건</span>
          </div>
        </div>
        
        <div className="flex flex-col justify-center pl-10 border-l border-slate-100 min-w-[100px]">
          <p className={`text-[11px] font-black uppercase tracking-widest mb-1 ${stats.critical > 0 && theme !== 'teal' ? 'text-rose-500 animate-pulse' : 'text-slate-400'}`}>
            {statLabel2}
          </p>
          <div className="flex items-baseline gap-1">
            {stats.critical > 0 && theme !== 'teal' && <span className="text-lg leading-none mr-1">⚠️</span>}
            <span className={`text-4xl font-black tracking-tighter ${stats.critical > 0 && theme !== 'teal' ? 'text-rose-600' : c.warnColor}`}>
              {stats.critical}
            </span>
            <span className="text-xs font-bold text-slate-400">건</span>
          </div>
        </div>
      </div>
  
      {/* 우측 단일 라우터 링크 진입 버튼 */}
      <div className="flex flex-col justify-center gap-3 w-full lg:w-48 shrink-0">
        <Link 
          href={link} 
          className={`w-full flex items-center justify-center gap-2 py-5 rounded-2xl font-black text-xs text-white shadow-md uppercase tracking-wider transition-all active:scale-95 ${c.btnPrimary}`}
        >
          현황판 진입 <span className="text-base leading-none">→</span>
        </Link>
      </div>
  
    </div>
  );
};