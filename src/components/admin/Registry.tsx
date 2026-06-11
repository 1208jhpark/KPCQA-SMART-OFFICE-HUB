'use client';
  
import dynamic from 'next/dynamic';
import React from 'react';
  
// 1. 공통 로딩 컴포넌트
const ModuleLoader = () => (
  <div className="p-20 text-center font-black animate-pulse text-slate-300 tracking-widest text-xs">
    LOADING CENTRAL SYSTEM MODULE...
  </div>
);
  
// 2. 각 도메인 모듈 dynamic 컴포넌트 레이지 로딩 선언
// --- [IT 업무자산] ---
const ITMainModule = dynamic(() => import('../asset/it/ITMainModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITDeptModule = dynamic(() => import('../asset/it/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITPersonalModule = dynamic(() => import('../asset/it/PersonalModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterDashboardModule = dynamic(() => import('../asset/it/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterArchiveModule = dynamic(() => import('../asset/it/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
// 주의: 파일 트리에 MaterRequestModule.tsx 로 되어 있으나, 오타로 추정되어 아래와 같이 매핑합니다. 실제 파일명과 맞춰주세요.
const ITMasterRequestModule = dynamic(() => import('../asset/it/MasterRequestModule').then(m => m.default || m).catch(() => import('../asset/it/MasterRequestModule').then(m => m.default || m)), { loading: ModuleLoader, ssr: false });
const ITNoticeModule = dynamic(() => import('../asset/it/NoticeModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });

// --- [일반 소모품] ---
const SuppliesInventoryModule = dynamic(() => import('../asset/supplies/InventoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesDeptModule = dynamic(() => import('../asset/supplies/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterDashboardModule = dynamic(() => import('../asset/supplies/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterArchiveModule = dynamic(() => import('../asset/supplies/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterPurchaseModule = dynamic(() => import('../asset/supplies/MasterPurchaseModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterRequestModule = dynamic(() => import('../asset/supplies/MasterRequestModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
// --- [마케팅] ---
const MarketingDashboard = dynamic(() => import('../marketing/DashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingCatalog = dynamic(() => import('../marketing/CatalogModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingClientSearch = dynamic(() => import('../marketing/ClientSearchModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingPurchase = dynamic(() => import('../marketing/PurchaseModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingRegister = dynamic(() => import('../marketing/RegisterModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingDeptDistribution = dynamic(() => import('../marketing/DeptDistributionModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
  
// --- [일반 설문] ---
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
  
// 3. 레지스트리 객체 명세 (절대 경로 1:1 매핑)
export const ModuleRegistry: Record<string, React.ComponentType<any>> = {
  // 🚀 [IT 자산 관리]
  '/asset/it': ITMainModule,
  '/asset/it/dept': ITDeptModule,
  '/asset/it/personal': ITPersonalModule,
  '/asset/it/notice': ITNoticeModule,
  
  // 마스터 전용 중간 경로 및 세부 라우트
  '/asset/it/master': ITMasterDashboardModule, 
  '/asset/it/master/dashboard': ITMasterDashboardModule,
  '/asset/it/master/archive': ITMasterArchiveModule,
  '/asset/it/master/requests': ITMasterRequestModule,
  
  // 🚀 [일반 소모품 관리]
  '/asset/supplies/inventory': SuppliesInventoryModule,
  '/asset/supplies/dept': SuppliesDeptModule,
  
  // 마스터 전용 중간 경로 및 세부 라우트
  '/asset/supplies/master': SuppliesMasterDashboardModule,
  '/asset/supplies/master/dashboard': SuppliesMasterDashboardModule,
  '/asset/supplies/master/archive': SuppliesMasterArchiveModule,
  '/asset/supplies/master/purchase': SuppliesMasterPurchaseModule,
  '/asset/supplies/master/requests': SuppliesMasterRequestModule,
  
  // 🚀 [마케팅]
  '/marketing/dashboard': MarketingDashboard,
  '/marketing/distribution/catalog': MarketingCatalog,
  '/marketing/distribution/client-search': MarketingClientSearch,
  '/marketing/distribution/purchase': MarketingPurchase,
  '/marketing/distribution/register': MarketingRegister,
  '/marketing/distribution/dept': MarketingDeptDistribution,
    
  // 🚀 [일반 설문조사]
  '/survey/general/dashboard': SurveyDashboardContent,
  '/survey/general/my-submissions': MySubmissionsModule, 
  '/survey/general/admin/active-surveys': AdminActiveSurveys,
  '/survey/general/admin/survey-builder': AdminSurveyBuilder,
  '/survey/general/admin/survey-history': AdminSurveyHistory,
     
  // 🚀 [배달 서비스]
  '/survey/delivery/dashboard': DeliveryDashboardContent,
  '/survey/delivery/my-submissions': DeliveryMySubmissions,
  '/survey/delivery/admin/active-surveys': AdminDeliveryActive, 
  '/survey/delivery/admin/survey-builder': AdminDeliveryBuilder,
  '/survey/delivery/admin/history': AdminDeliveryHistory,
};