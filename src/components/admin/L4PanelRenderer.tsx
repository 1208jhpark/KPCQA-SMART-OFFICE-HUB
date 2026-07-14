'use client';
  
import dynamic from 'next/dynamic';
import React from 'react';
import { usePathname } from 'next/navigation';
  
const ModuleLoader = () => (
  <div className="p-20 text-center font-black animate-pulse text-slate-300 tracking-widest text-xs font-sans">
    LOADING REALTIME SYSTEM MODULE...
  </div>
);
  
// --- [IT 업무자산] ---
const ITDeptModule = dynamic(() => import('../asset/it/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITPersonalModule = dynamic(() => import('../asset/it/PersonalModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterDashboardModule = dynamic(() => import('../asset/it/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterArchiveModule = dynamic(() => import('../asset/it/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterRequestModule = dynamic(() => import('../asset/it/MasterRequestModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITAuditModule = dynamic(() => import('../asset/it/AuditModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
     
// --- [일반 소모품] ---
const SuppliesInventoryModule = dynamic(() => import('../asset/supplies/InventoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesDeptModule = dynamic(() => import('../asset/supplies/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterDashboardModule = dynamic(() => import('../asset/supplies/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterArchiveModule = dynamic(() => import('../asset/supplies/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterPurchaseModule = dynamic(() => import('../asset/supplies/MasterPurchaseModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterRequestModule = dynamic(() => import('../asset/supplies/MasterRequestModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
// --- [명함 관리] ---
const BusinessCardMyPage = dynamic(() => import('../asset/businesscard/BusinessCardMyPage').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const BusinessCardRequestPanel = dynamic(() => import('../asset/businesscard/BusinessCardRequestPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const BusinessCardOrderPanel = dynamic(() => import('../asset/businesscard/BusinessCardOrderPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const BusinessCardArchivePanel = dynamic(() => import('../asset/businesscard/BusinessCardArchivePanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });


// --- [부서 맞춤 제작물] ---
const ProductionApplyForm = dynamic(() => import('../asset/production/ProductionApplyForm').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ProductionApplyHistory = dynamic(() => import('../asset/production/ProductionApplyHistory').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptOrderPanel = dynamic(() => import('../asset/production/DeptOrderPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptInvoiceVerifyPanel = dynamic(() => import('../asset/production/DeptInvoiceVerifyPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptArchivePanel = dynamic(() => import('../asset/production/DeptArchivePanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });

// --- [마케팅] ---
const MarketingDashboard = dynamic(() => import('../../components/marketing/DashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingCatalog = dynamic(() => import('../marketing/CatalogModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingClientSearch = dynamic(() => import('../marketing/ClientSearchModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingOrgDistribution = dynamic(() => import('@/components/marketing/OrgDistributionModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingRegister = dynamic(() => import('../marketing/RegisterModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingDeptDistribution = dynamic(() => import('../marketing/DeptDistributionModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
// --- [일반 설문] ---
const SurveyDashboard = dynamic(() => import('../survey/SurveyDashboard').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SurveyDashboardContent = dynamic(() => import('../survey/general/SurveyDashboardContent').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MySubmissionsModule = dynamic(() => import('../survey/general/MySubmissionsModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminActiveSurveys = dynamic(() => import('../survey/general/AdminActiveSurveysModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminSurveyBuilder = dynamic(() => import('../survey/general/AdminSurveyBuilderModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminSurveyHistory = dynamic(() => import('../survey/general/AdminSurveyHistoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
     
// --- [배달 서비스 설문] ---
const AdminDeliveryActive = dynamic(() => import('../survey/delivery/AdminDeliveryActiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminDeliveryBuilder = dynamic(() => import('../survey/delivery/AdminDeliveryBuilderModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const AdminDeliveryHistory = dynamic(() => import('../survey/delivery/AdminDeliveryHistoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeliveryDashboardContent = dynamic(() => import('../survey/delivery/DeliveryDashboardContent').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeliveryMySubmissions = dynamic(() => import('../survey/delivery/DeliveryMySubmissions').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
export const ModuleRegistry: Record<string, React.ComponentType<any>> = {
  // [IT 자산 관리]
  '/asset/it/dept': ITDeptModule,
  '/asset/it/personal': ITPersonalModule,
  '/asset/it/master/audit': ITAuditModule, 
  '/asset/it/master/dashboard': ITMasterDashboardModule,
  '/asset/it/master/archive': ITMasterArchiveModule,
  '/asset/it/master/requests': ITMasterRequestModule,
     
  // [일반 소모품 관리]
  '/asset/supplies/inventory': SuppliesInventoryModule,
  '/asset/supplies/dept': SuppliesDeptModule,
  '/asset/supplies/master/dashboard': SuppliesMasterDashboardModule,
  '/asset/supplies/master/archive': SuppliesMasterArchiveModule,
  '/asset/supplies/master/purchase': SuppliesMasterPurchaseModule,
  '/asset/supplies/master/requests': SuppliesMasterRequestModule,

  // [명함 관리 모듈]
  '/asset/businesscard/my-page': BusinessCardMyPage,
  '/asset/businesscard/master/requests': BusinessCardRequestPanel,
  '/asset/businesscard/master/order': BusinessCardOrderPanel,
  '/asset/businesscard/master/archive': BusinessCardArchivePanel,
     
// [부서 맞춤 제작물]
'/asset/production/apply/request': ProductionApplyForm,
'/asset/production/apply/history': ProductionApplyHistory,
'/asset/production/dept-master/order': DeptOrderPanel,
'/asset/production/dept-master/verify': DeptInvoiceVerifyPanel,
'/asset/production/dept-master/archive': DeptArchivePanel,

  // [마케팅]
  '/marketing/dashboard': MarketingDashboard,
  '/marketing/distribution/catalog': MarketingCatalog,
  '/marketing/distribution/client-search': MarketingClientSearch,
  '/marketing/distribution/org': MarketingOrgDistribution,
  '/marketing/distribution/register': MarketingRegister,
  '/marketing/distribution/dept': MarketingDeptDistribution,
     
  // [일반 설문조사]
  '/survey': SurveyDashboard,
  '/survey/general/dashboard': SurveyDashboardContent,
  '/survey/general/my-submissions': MySubmissionsModule, 
  '/survey/general/admin/active-surveys': AdminActiveSurveys,
  '/survey/general/admin/survey-builder': AdminSurveyBuilder,
  '/survey/general/admin/survey-history': AdminSurveyHistory,
     
  // [배달 서비스]
  '/survey/delivery/dashboard': DeliveryDashboardContent,
  '/survey/delivery/my-submissions': DeliveryMySubmissions,
  '/survey/delivery/admin/active-surveys': AdminDeliveryActive, 
  '/survey/delivery/admin/survey-builder': AdminDeliveryBuilder,
  '/survey/delivery/admin/history': AdminDeliveryHistory,
};
     
export default function L4PanelRenderer() {
  const pathname = usePathname();
  
  let lowerPath = pathname?.toLowerCase() || '';
  if (lowerPath.endsWith('/')) {
    lowerPath = lowerPath.slice(0, -1);
  }

  const targetKey = Object.keys(ModuleRegistry).find(key => key.toLowerCase() === lowerPath);
  const TargetModule = targetKey ? ModuleRegistry[targetKey] : null;
  
  // 🚀 [원복 완료] 매핑 실패 혹은 인덱스 주소 진입 시, 경고창 없이 깨끗하게 null을 반환합니다.
  if (!TargetModule) return null; 
  
  return (
    <div className="w-full h-full animate-fade-in">
      <TargetModule />
    </div>
  );
}