'use client';
  
import dynamic from 'next/dynamic';
import React from 'react';
import LoadingState from '@/components/common/LoadingState';
  
// 1. 공통 로딩 컴포넌트
const ModuleLoader = () => <LoadingState />;
  
// 2. 각 도메인 모듈 dynamic 컴포넌트 레이지 로딩 선언
// --- [IT 업무자산] ---
const ITDeptModule = dynamic(() => import('../equipment/it/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITPersonalModule = dynamic(() => import('../equipment/it/PersonalModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterDashboardModule = dynamic(() => import('../equipment/it/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterArchiveModule = dynamic(() => import('../equipment/it/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterRequestModule = dynamic(() => import('../equipment/it/MasterRequestModule').then(m => m.default || m).catch(() => import('../equipment/it/MasterRequestModule').then(m => m.default || m)), { loading: ModuleLoader, ssr: false });
const ITAuditModule = dynamic(() => import('../equipment/it/AuditModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
     
// --- [일반 소모품] ---
const SuppliesInventoryModule = dynamic(() => import('../asset/supplies/InventoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesDeptModule = dynamic(() => import('../asset/supplies/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterDashboardModule = dynamic(() => import('../asset/supplies/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterArchiveModule = dynamic(() => import('../asset/supplies/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterRestockModule = dynamic(() => import('../asset/supplies/MasterRestockModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const SuppliesMasterRequestModule = dynamic(() => import('../asset/supplies/MasterRequestModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
 
// --- [명함 관리] ---
const BusinessCardMyPage = dynamic(() => import('../asset/businesscard/BusinessCardMyPage').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const BusinessCardRequestPanel = dynamic(() => import('../asset/businesscard/BusinessCardRequestPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const BusinessCardOrderPanel = dynamic(() => import('../asset/businesscard/BusinessCardOrderPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const BusinessCardArchivePanel = dynamic(() => import('../asset/businesscard/BusinessCardArchivePanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });


// --- [부서 맞춤 제작물] ---
const ProductionApplyForm = dynamic(() => import('../production/ProductionApplyForm').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ProductionApplyHistory = dynamic(() => import('../production/ProductionApplyHistory').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptOrderPanel = dynamic(() => import('../production/DeptOrderPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptInspectionPanel = dynamic(() => import('../production/DeptInspectionPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptSettlementPanel = dynamic(() => import('../production/DeptSettlementPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptSettledArchive = dynamic(() => import('../production/DeptSettledArchive').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MasterOrderDashboard = dynamic(() => import('../production/MasterOrderDashboard').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MasterSettledArchive = dynamic(() => import('../production/MasterSettledArchive').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ProductionClientAddressModule = dynamic(() => import('../production/ProductionClientAddressModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });


// --- [마케팅] ---
const MarketingDashboard = dynamic(() => import('../../components/marketing/DashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false }); // 👈 절대경로(@/)나 상위 상대경로(../../)로 명확히 지정해 줍니다.
const ScheduleDashboard = dynamic(() => import('../schedule/ScheduleDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingCatalog = dynamic(() => import('../marketing/CatalogModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingClientSearch = dynamic(() => import('../marketing/ClientSearchModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
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

// --- [장비 관리] ---
const EquipmentDashboardModule = dynamic(() => import('../equipment/EquipmentDashboardClient').then(m => m.default || m), { loading: ModuleLoader, ssr: false });

// 3. 레지스트리 객체 명세 (🚀 스탭3 상위 경로와 하위 스탭4 컴포넌트 간의 고정 결합 원천 제거)
export const ModuleRegistry: Record<string, React.ComponentType<any>> = {
  // [IT 자산 관리]
  '/equipment/it/dept': ITDeptModule,
  '/equipment/it/personal': ITPersonalModule,
  '/equipment/it/master/audit': ITAuditModule,
  '/equipment/it/master/dashboard': ITMasterDashboardModule,
  '/equipment/it/master/archive': ITMasterArchiveModule,
  '/equipment/it/master/requests': ITMasterRequestModule,
  
  // [일반 소모품 관리]
  '/asset/supplies/inventory': SuppliesInventoryModule,
  '/asset/supplies/dept': SuppliesDeptModule,
  '/asset/supplies/master/dashboard': SuppliesMasterDashboardModule,
  '/asset/supplies/master/archive': SuppliesMasterArchiveModule,
  '/asset/supplies/master/restock': SuppliesMasterRestockModule,
  '/asset/supplies/master/purchase': SuppliesMasterRestockModule, // 구 경로 호환
  '/asset/supplies/master/requests': SuppliesMasterRequestModule,
  
  // [명함 관리 모듈]
  '/asset/businesscard/my-page': BusinessCardMyPage,
  '/asset/businesscard/master/requests': BusinessCardRequestPanel,
  '/asset/businesscard/master/order': BusinessCardOrderPanel,
  '/asset/businesscard/master/archive': BusinessCardArchivePanel,

  // [부서 맞춤 제작물]
  '/production/custom/my-orders/request': ProductionApplyForm,
  '/production/custom/my-orders/history': ProductionApplyHistory,
  '/production/custom/dept-master/order': DeptOrderPanel,
  '/production/custom/dept-master/inspection': DeptInspectionPanel,
  '/production/custom/dept-master/settlement': DeptSettlementPanel,
  '/production/custom/dept-master/archive': DeptSettledArchive,
  '/production/custom/admin/dashboard': MasterOrderDashboard,
  '/production/custom/admin/archive': MasterSettledArchive,
  '/production/custom/clients': ProductionClientAddressModule,
  
  // [일정]
  '/schedule/dashboard': ScheduleDashboard,

  // [마케팅]
  '/marketing/dashboard': MarketingDashboard,
  '/marketing/distribution/catalog': MarketingCatalog,
  '/marketing/distribution/client-search': MarketingClientSearch,
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

// [장비 관리]
'/equipment/main': EquipmentDashboardModule,
};