'use client';
import SubMenuGrid from '@/components/admin/SubMenuGrid';

export default function EquipmentMainPage() {
  return (
    <div className="w-full h-full animate-fade-in">
      {/* 어드민 인터페이스 설정에 따라 하위 장비 카드(a, b, c...)들을 자동으로 뿌려줍니다. */}
      <SubMenuGrid path="/equipment" />
    </div>
  );
}