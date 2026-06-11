'use client';

import SubMenuGrid from '@/components/admin/SubMenuGrid';

export default function SurveyDeliveryAdminPage() {
  // admin 하위에 등록된 Step 4 패널들(campaign, ongoing, survey-builder, history)을 
  // 시스템 관리자 규격 그리드로 자동 매핑하여 렌더링합니다.
  return <SubMenuGrid path="/survey/delivery/admin" />;
}