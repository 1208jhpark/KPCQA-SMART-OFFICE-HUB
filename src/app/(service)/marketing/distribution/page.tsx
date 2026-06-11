'use client';
import SubMenuGrid from '@/components/admin/SubMenuGrid';

export default function MarketingDistributionPage() {
  return (
    <div className="w-full h-full animate-fade-in">
      {/* DB 설정을 읽고 L3(카탈로그 등) 카드를 보여주는 역할 */}
      <SubMenuGrid path="/marketing/distribution" />
    </div>
  );
}