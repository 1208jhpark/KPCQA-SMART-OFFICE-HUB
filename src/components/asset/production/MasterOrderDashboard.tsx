'use client';

import DeptArchivePanel from '@/components/asset/production/DeptArchivePanel';
import ProductionMasterShell from '@/components/asset/production/ProductionMasterShell';

/**
 * 제작물 마스터 대시보드 — 부서 archive(검수 완료 보관함)와 동일 목록을 전사 스코프로 표시.
 * 배너·탭 네비는 명함 master 규격(ProductionMasterShell).
 */
export default function MasterOrderDashboard() {
  return (
    <ProductionMasterShell>
      <DeptArchivePanel variant="master" />
    </ProductionMasterShell>
  );
}
