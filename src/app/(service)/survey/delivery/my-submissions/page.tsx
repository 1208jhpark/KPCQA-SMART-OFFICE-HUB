'use client';

import React from 'react';
import L4PanelRenderer from '@/components/admin/L4PanelRenderer';

export default function DeliveryMySubmissionsPage() {
  /* 💡 [배달 서비스 도메인 정합성 동기화 완료]:
    하위 L4 창구를 개별 폴더로 쪼개지 않고, 레지스트리에 바인딩된 
    DeliveryMySubmissions(배달 서비스용 통합 제출/이력 패널)로 일체화하여 즉시 다이렉트 매핑합니다.
    인증 권한 계층 및 admin/interface 규칙 검증은 L4PanelRenderer가 투명하게 수행합니다.
  */
  return <L4PanelRenderer />;
}