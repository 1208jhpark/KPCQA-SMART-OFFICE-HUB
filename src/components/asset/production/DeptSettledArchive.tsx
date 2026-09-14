'use client';

import DeptArchivePanel from '@/components/asset/production/DeptArchivePanel';

/** 부서 정산완료 보관함 — 마스터에서 정산완료 이관된 묶음 (조회 전용) */
export default function DeptSettledArchive() {
  return <DeptArchivePanel variant="dept-archive" />;
}
