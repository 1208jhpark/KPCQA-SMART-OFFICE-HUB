'use client';
  
import dynamic from 'next/dynamic';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LoadingState from '@/components/common/LoadingState';
import { checkMenuPermission } from '@/lib/permission-utils';
  
const ModuleLoader = () => <LoadingState />;
  
// --- [IT 업무자산] ---
const ITDeptModule = dynamic(() => import('../equipment/it/DeptModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITPersonalModule = dynamic(() => import('../equipment/it/PersonalModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterDashboardModule = dynamic(() => import('../equipment/it/MasterDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterArchiveModule = dynamic(() => import('../equipment/it/MasterArchiveModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ITMasterRequestModule = dynamic(() => import('../equipment/it/MasterRequestModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
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

// --- [법인카드] ---
const CorpCardDeptBoardModule = dynamic(() => import('../asset/corp-card/DeptBoardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const CorpCardMasterMonitoringModule = dynamic(() => import('../asset/corp-card/MasterMonitoringModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const CorpCardMasterHistoryModule = dynamic(() => import('../asset/corp-card/MasterHistoryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const CorpCardMasterRegistryModule = dynamic(() => import('../asset/corp-card/MasterRegistryModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });

// --- [부서 맞춤 제작물] ---
const ProductionApplyForm = dynamic(() => import('../production/ProductionApplyForm').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ProductionApplyHistory = dynamic(() => import('../production/ProductionApplyHistory').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptOrderPanel = dynamic(() => import('../production/DeptOrderPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptHistoryPanel = dynamic(() => import('../production/DeptHistoryPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptInspectionPanel = dynamic(() => import('../production/DeptInspectionPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptSettlementPanel = dynamic(() => import('../production/DeptSettlementPanel').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const DeptSettledArchive = dynamic(() => import('../production/DeptSettledArchive').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MasterOrderDashboard = dynamic(() => import('../production/MasterOrderDashboard').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MasterSettledArchive = dynamic(() => import('../production/MasterSettledArchive').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ProductionClientAddressModule = dynamic(() => import('../production/ProductionClientAddressModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });

// --- [마케팅] ---
const MarketingDashboard = dynamic(() => import('../../components/marketing/DashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ScheduleDashboard = dynamic(() => import('../schedule/ScheduleDashboardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const ScheduleWorkBoard = dynamic(() => import('../schedule/WorkBoardModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
const MarketingCatalog = dynamic(() => import('../marketing/CatalogModule').then(m => m.default || m), { loading: ModuleLoader, ssr: false });
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

  // [법인카드]
  '/asset/corp-card/dept/board': CorpCardDeptBoardModule,
  '/asset/corp-card/master/monitoring': CorpCardMasterMonitoringModule,
  '/asset/corp-card/master/history': CorpCardMasterHistoryModule,
  '/asset/corp-card/master/registry': CorpCardMasterRegistryModule,
     
// [부서 맞춤 제작물]
'/production/custom/my-orders/request': ProductionApplyForm,
'/production/custom/my-orders/history': ProductionApplyHistory,
'/production/custom/dept-master/order': DeptOrderPanel,
'/production/custom/dept-master/history': DeptHistoryPanel,
'/production/custom/dept-master/inspection': DeptInspectionPanel,
'/production/custom/dept-master/settlement': DeptSettlementPanel,
'/production/custom/dept-master/archive': DeptSettledArchive,
'/production/custom/admin/dashboard': MasterOrderDashboard,
'/production/custom/admin/archive': MasterSettledArchive,
'/production/custom/clients': ProductionClientAddressModule,

  // [일정]
  '/schedule/dashboard': ScheduleDashboard,
  '/schedule/work-board': ScheduleWorkBoard,

  // [마케팅]
  '/marketing/dashboard': MarketingDashboard,
  '/marketing/distribution/catalog': MarketingCatalog,
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
     
/** registry 구 경로 → interface 검사에 쓸 path */
const ACCESS_PATH_ALIAS: Record<string, string> = {
  '/asset/supplies/master/purchase': '/asset/supplies/master/restock',
};

export default function L4PanelRenderer() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [denyReason, setDenyReason] = useState<string | null>(null);

  let lowerPath = pathname?.toLowerCase() || '';
  if (lowerPath.endsWith('/')) {
    lowerPath = lowerPath.slice(0, -1);
  }

  const targetKey = useMemo(
    () => Object.keys(ModuleRegistry).find((key) => key.toLowerCase() === lowerPath) || null,
    [lowerPath]
  );
  const TargetModule = targetKey ? ModuleRegistry[targetKey] : null;
  const accessPath = targetKey
    ? ACCESS_PATH_ALIAS[targetKey] || targetKey
    : lowerPath;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setAllowed(false);
    setDenyReason(null);

    if (!targetKey) {
      setReady(true);
      setAllowed(false);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const ts = Date.now();
        const [meRes, menuRes, unitsRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
        ]);

        if (cancelled) return;

        if (!meRes || !meRes.ok) {
          setDenyReason('로그인이 필요하거나 세션이 만료되었습니다.');
          setAllowed(false);
          setReady(true);
          return;
        }

        const user = await meRes.json();
        const menusRaw = menuRes && menuRes.ok ? await menuRes.json() : [];
        const menus = Array.isArray(menusRaw) ? menusRaw : menusRaw?.data || [];
        const unitsRaw = unitsRes && unitsRes.ok ? await unitsRes.json() : [];
        const units = Array.isArray(unitsRaw) ? unitsRaw : unitsRaw?.data || [];

        const cleanAccess = accessPath.replace(/\/$/, '').toLowerCase();
        // 1) 해당 L4 exact path 우선
        let menu =
          menus.find(
            (m: any) => String(m.path || '').replace(/\/$/, '').toLowerCase() === cleanAccess
          ) || null;

        // 2) 없으면 상위 path 중 가장 긴 메뉴 (탭이 부모 Access만 있는 경우)
        if (!menu) {
          menu = [...menus]
            .sort((a: any, b: any) => (b.path?.length || 0) - (a.path?.length || 0))
            .find(
              (m: any) =>
                cleanAccess.startsWith(String(m.path || '').replace(/\/$/, '').toLowerCase()) &&
                m.path !== '/home'
            );
        }

        if (!menu) {
          setDenyReason('이 경로에 대한 메뉴가 설정되어 있지 않습니다.');
          setAllowed(false);
          setReady(true);
          return;
        }

        if (!menu.is_active) {
          setDenyReason('현재 점검 중이거나 비활성화된 서비스입니다.');
          setAllowed(false);
          setReady(true);
          return;
        }

        const permission = checkMenuPermission(user, menu, menus, units);
        if (!permission.hasAccess) {
          setDenyReason('귀하의 소속 부서 또는 권한으로는 접근할 수 없는 메뉴입니다.');
          setAllowed(false);
          setReady(true);
          return;
        }

        setAllowed(true);
        setReady(true);
      } catch {
        if (cancelled) return;
        setDenyReason('권한 확인 중 오류가 발생했습니다.');
        setAllowed(false);
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [targetKey, accessPath]);

  // 매핑 실패 — 인덱스/미등록 주소는 조용히 비움
  if (!TargetModule) return null;

  if (!ready) {
    return <LoadingState />;
  }

  if (!allowed) {
    return (
      <div className="w-full min-h-[50vh] flex items-center justify-center p-8 animate-fade-in">
        <div className="bg-white border-2 border-dashed border-red-200 rounded-[2rem] p-12 max-w-lg w-full text-center shadow-xl">
          <span className="text-6xl mb-4 block">⛔</span>
          <h2 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter">
            Access Denied
          </h2>
          <p className="text-red-500 font-bold text-sm mb-8">
            {denyReason || '접근 권한이 없습니다.'}
          </p>
          <Link
            href="/home"
            className="inline-block px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-colors shadow-md"
          >
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full animate-fade-in">
      <TargetModule />
    </div>
  );
}