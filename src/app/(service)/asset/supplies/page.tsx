'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SuppliesIndexPage() {
  const router = useRouter();

  useEffect(() => {
    // 일반소모품 메뉴 클릭 시 자동으로 '재고 현황' 페이지로 즉시 이동시킵니다.
    // (뒤로가기 시 무한 루프에 빠지지 않도록 push 대신 replace 사용)
    router.replace('/asset/supplies/inventory');
  }, [router]);

  // 화면에 그릴 내용이 없으므로 null을 반환하여 React 컴포넌트 규칙을 만족시킵니다.
  return null;
}