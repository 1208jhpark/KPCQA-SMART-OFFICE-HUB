'use client';

import DeptArchivePanel from '@/components/production/DeptArchivePanel';

/** 부서 대조완료 보관함 — admin/archive와 동일 UI, 자기 부서 스코프만 (조회 전용) */
export default function DeptSettledArchive() {
  return <DeptArchivePanel variant="dept-archive" />;
}
