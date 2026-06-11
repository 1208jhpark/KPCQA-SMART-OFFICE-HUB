'use client';

import SubMenuGrid from '@/components/admin/SubMenuGrid';

export default function DeliveryRootPage() {
  // 하위 메뉴들(dashboard, my-submissions, admin 등)을 그리드 형태로 렌더링
  return <SubMenuGrid path="/survey/delivery" />;
}