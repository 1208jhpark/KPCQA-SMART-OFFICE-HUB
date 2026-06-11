'use client';
import SubMenuGrid from '@/components/admin/SubMenuGrid';

export default function MarketingMainPage() {
  return (
    <div className="w-full h-full animate-fade-in">
      {/* DB 설정을 읽고 L2(대시보드, 지급관리)로 알아서 튕겨주거나 카드를 보여줍니다 */}
      <SubMenuGrid path="/marketing" />
    </div>
  );
}