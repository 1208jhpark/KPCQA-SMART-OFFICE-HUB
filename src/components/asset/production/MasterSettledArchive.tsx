'use client';

import DeptArchivePanel from '@/components/asset/production/DeptArchivePanel';
import ProductionMasterShell from '@/components/asset/production/ProductionMasterShell';

/**
 * 제작물 마스터 대조완료 보관함 — dashboard와 동일 배너·탭·표.
 * 거래명세표 등록·선택 명세서 검수 버튼은 제외.
 */
export default function MasterSettledArchive() {
  return (
    <ProductionMasterShell pageHint="거래명세표 대조가 완료된 부서별 외주 제작 건을 보관하며, 제작 분류 및 부서별 정산 집계와 결산 내역을 통합 조회하는 아카이브입니다.">
      <DeptArchivePanel variant="master-archive" />
    </ProductionMasterShell>
  );
}
