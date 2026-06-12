'use client';
  
import dynamic from 'next/dynamic';
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
  
// 1. 공통 로딩 컴포넌트
const ModuleLoader = () => (
  <div className="p-20 text-center font-black animate-pulse text-slate-300 tracking-widest text-xs">
    LOADING REALTIME SYSTEM MODULE...
  </div>
);
  
// 2. 렌더러 내부 전용 모듈 정밀 검증 가드 (AccessGuard)
const AccessGuard = ({ pathname, children }: { pathname: string, children: React.ReactNode }) => {
  const [status, setStatus] = useState<'loading' | 'allowed' | 'denied'>('loading');
     
  useEffect(() => {
    const verifyModuleAccess = async () => {
      try {
        const ts = Date.now();
        const [meRes, interfaceRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/interface?t=' + ts, { cache: 'no-store' })
        ]);
     
        if (!meRes.ok) throw new Error('Not Authenticated');
        const user = await meRes.json();
        const menus = await interfaceRes.json();
     
        const userRole = user.roles?.[0] || 'LV_3';
        const userLevel = parseInt(userRole.replace('LV_', ''), 10) || 3;
     
        if (pathname.includes('/admin') && userRole !== 'LV_1') {
          setStatus('denied');
          return;
        }
     
        const matchedMenu = menus
          .sort((a: any, b: any) => b.path.length - a.path.length) 
          .find((m: any) => pathname.startsWith(m.path));
     
        if (matchedMenu) {
          if (!matchedMenu.is_active) {
            setStatus('denied');
            return;
          }
          const requiredLevel = matchedMenu.required_level || 3;
          if (userLevel > requiredLevel) {
            setStatus('denied');
            return;
          }
        }
     
        setStatus('allowed');
      } catch (e) {
        setStatus('denied');
      }
    };
    verifyModuleAccess();
  }, [pathname]);
     
  if (status === 'loading') return <ModuleLoader />;
  if (status === 'denied') return (
    <div className="flex flex-col items-center justify-center p-24 h-full text-center bg-white/50 border border-red-100 rounded-[2.5rem] m-8 shadow-sm">
      <div className="text-5xl mb-4">⛔</div>
      <h2 className="text-xl font-black text-slate-800 mb-2">모듈 접근 권한이 없습니다</h2>
      <p className="text-xs text-slate-500 font-bold mb-6">
        관리자에 의해 해당 컴포넌트의 접근이 제한되었습니다.
      </p>
      <div className="px-4 py-2 bg-slate-100 text-slate-400 text-[10px] font-mono rounded-lg border border-slate-200">
        Blocked Path: {pathname}
      </div>
    </div>
  );
     
  return <>{children}</>;
};
     
// 3. 각 도메인 모듈 dynamic 컴포넌트 레이지 로딩 선언
const ITMainModule = dynamic(() => import('../asset/it/ITMainModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITDeptModule = dynamic(() => import('../asset/it/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITPersonalModule = dynamic(() => import('../asset/it/PersonalModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterDashboardModule = dynamic(() => import('../asset/it/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterArchiveModule = dynamic(() => import('../asset/it/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterRequestModule = dynamic(() => import('../asset/it/MasterRequestModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
const SuppliesInventoryModule = dynamic(() => import('../asset/supplies/InventoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesDeptModule = dynamic(() => import('../asset/supplies/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterDashboardModule = dynamic(() => import('../asset/supplies/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterArchiveModule = dynamic(() => import('../asset/supplies/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterPurchaseModule = dynamic(() => import('../asset/supplies/MasterPurchaseModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterRequestModule = dynamic(() => import('../asset/supplies/MasterRequestModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
const MarketingDashboard = dynamic(() => import('../marketing/DashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingCatalog = dynamic(() => import('../marketing/CatalogModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingClientSearch = dynamic(() => import('../marketing/ClientSearchModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
// 🚀 [명칭/경로 변경]: 전사 통합 모듈 레이지 로딩 타깃팅 업데이트
const MarketingOrgDistribution = dynamic(() => import('@/components/marketing/OrgDistributionModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingRegister = dynamic(() => import('../marketing/RegisterModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingDeptDistribution = dynamic(() => import('../marketing/DeptDistributionModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
const SurveyDashboard = dynamic(() => import('../survey/general/SurveyDashboardContent').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MySubmissionsModule = dynamic(() => import('../survey/general/MySubmissionsModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminActiveSurveys = dynamic(() => import('../survey/general/AdminActiveSurveysModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminSurveyBuilder = dynamic(() => import('../survey/general/AdminSurveyBuilderModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminSurveyHistory = dynamic(() => import('../survey/general/AdminSurveyHistoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
     
const AdminDeliveryActive = dynamic(() => import('../survey/delivery/AdminDeliveryActiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminDeliveryBuilder = dynamic(() => import('../survey/delivery/AdminDeliveryBuilderModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminDeliveryHistory = dynamic(() => import('../survey/delivery/AdminDeliveryHistoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeliveryDashboard = dynamic(() => import('../survey/delivery/DeliveryDashboardContent').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeliveryMySubmissions = dynamic(() => import('../survey/delivery/DeliveryMySubmissions').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
// 4. 글로벌 하드코딩 라우트 레지스트리 객체 명세
export const ModuleRegistry: Record<string, React.ComponentType<any>> = {
  // IT 자산 관리
  '/asset/it': ITMainModule,
  '/asset/it/dept': ITDeptModule,
  '/asset/it/personal': ITPersonalModule,
  '/asset/it/master/dashboard': ITMasterDashboardModule,
  '/asset/it/master/archive': ITMasterArchiveModule,
  '/asset/it/master/requests': ITMasterRequestModule,
  
  // 일반 소모품 관리
  '/asset/supplies/inventory': SuppliesInventoryModule,
  '/asset/supplies/dept': SuppliesDeptModule,
  '/asset/supplies/master/dashboard': SuppliesMasterDashboardModule,
  '/asset/supplies/master/archive': SuppliesMasterArchiveModule,
  '/asset/supplies/master/purchase': SuppliesMasterPurchaseModule,
  '/asset/supplies/master/requests': SuppliesMasterRequestModule,
  
  // 마케팅
  '/marketing/dashboard': MarketingDashboard,
  '/marketing/distribution/catalog': MarketingCatalog,
  '/marketing/distribution/client-search': MarketingClientSearch,
  // 🚀 [연동 수정]: 렌더러 측 레지스트리 밸류값도 OrgDistributionModule 컴포넌트로 조율 완료
  '/marketing/distribution/org': MarketingOrgDistribution,
  '/marketing/distribution/register': MarketingRegister,
  '/marketing/distribution/dept': MarketingDeptDistribution,
    
  // 설문조사
  '/survey/general/dashboard': SurveyDashboard,
  '/survey/general/my-submissions': MySubmissionsModule, 
  '/survey/general/admin/active-surveys': AdminActiveSurveys,
  '/survey/general/admin/survey-builder': AdminSurveyBuilder,
  '/survey/general/admin/survey-history': AdminSurveyHistory,
     
  // 배달 서비스
  '/survey/delivery/dashboard': DeliveryDashboard,
  '/survey/delivery/my-submissions': DeliveryMySubmissions,
  '/survey/delivery/admin/active-surveys': AdminDeliveryActive, 
  '/survey/delivery/admin/survey-builder': AdminDeliveryBuilder,
  '/survey/delivery/admin/history': AdminDeliveryHistory,
};
     
export default function L4PanelRenderer() {
  const pathname = usePathname();
  let lowerPath = pathname?.toLowerCase() || '';
  
  if (lowerPath === '/asset/supplies/master') {
    lowerPath = '/asset/supplies/master/dashboard';
  }
  if (lowerPath === '/asset/it/master') {
    lowerPath = '/asset/it/master/dashboard';
  }
  if (lowerPath === '/asset/outsourcing/master') {
    lowerPath = '/asset/outsourcing/master/dashboard'; 
  }
  
  const targetKey = Object.keys(ModuleRegistry).find(
    key => key.toLowerCase() === lowerPath
  );
  
  const TargetModule = targetKey ? ModuleRegistry[targetKey] : null;
  
  if (!TargetModule) {
    return (
      <div className="p-16 text-center border border-dashed border-slate-200 rounded-[2.5rem] bg-white/40 m-8">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
          [MCD 인터페이스 결함] 하위 레지스트리에 맵핑되지 않은 라우트 주소입니다.
        </p>
        <p className="text-[10px] text-slate-300 mt-1 font-mono">요청 경로: {pathname}</p>
        <p className="text-[10px] text-blue-400 mt-2 font-bold">Registry.tsx 및 L4PanelRenderer.tsx의 매핑 테이블을 확인해주세요.</p>
      </div>
    );
  }
  
  return (
    <div className="w-full h-full animate-fade-in">
      <AccessGuard pathname={pathname}>
        <TargetModule />
      </AccessGuard>
    </div>
  );
}