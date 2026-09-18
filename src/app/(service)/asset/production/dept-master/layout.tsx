'use client';

import ProductionDeptShell from '@/components/asset/production/ProductionDeptShell';

/** 탭(order/inspection/…) 이동 시 배너·유저 state 유지 — 패널마다 셸 재마운트 방지 */
export default function ProductionDeptMasterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProductionDeptShell>{children}</ProductionDeptShell>;
}
