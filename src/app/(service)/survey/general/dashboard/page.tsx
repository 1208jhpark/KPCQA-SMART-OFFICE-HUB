'use client';

// [수정] SubMenuGrid를 거치지 않고, 대시보드 콘텐츠를 직접 가져와서 화면에 붙입니다.
import SurveyDashboardContent from '@/components/survey/general/SurveyDashboardContent';

export default function SurveyDashboardPage() {
  return (
    <div className="w-full h-full">
      <SurveyDashboardContent />
    </div>
  );
}