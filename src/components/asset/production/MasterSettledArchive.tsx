'use client';

import DeptArchivePanel from '@/components/asset/production/DeptArchivePanel';
import ProductionMasterShell from '@/components/asset/production/ProductionMasterShell';

/**
 * 제작물 마스터 대조완료 보관함 — dashboard와 동일 배너·탭·표.
 * 거래명세표 등록·선택 명세서 검수 버튼은 제외.
 */
export default function MasterSettledArchive() {
  return (
    <ProductionMasterShell>
      <DeptArchivePanel variant="master-archive" />
    </ProductionMasterShell>
  );
}
