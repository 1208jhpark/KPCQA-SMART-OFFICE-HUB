'use client';

import React from 'react';
import L4PanelRenderer from '@/components/admin/L4PanelRenderer';

export default function GeneralMySubmissionsPage() {
  /* 💡 [아키텍처 정합성 싱크 완료]:
    이제 하위 L4 창구를 개별 폴더로 쪼개지 않고, 레지스트리에 바인딩된 
    MySubmissionsModule(통합 대시보드 패널)로 일체화하여 즉시 다이렉트 매핑합니다.
    인증 권한 계층 및 admin/interface 규칙 검증은 L4PanelRenderer가 수행합니다.
  */
  return <L4PanelRenderer />;
}