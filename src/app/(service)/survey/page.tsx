'use client';

import SurveyDashboard from "@/components/survey/SurveyDashboard";

export default function SurveyMainDashboard() {
  return (
    <main className="min-h-screen bg-slate-50/50">
      {/* 기존의 하드코딩된 대시보드 박스들을 제거하고, 
        재사용 가능한 SurveyDashboard 컴포넌트를 호출하여
        전체 서비스의 레이아웃 일관성을 유지합니다.
      */}
      <div className="pt-8 animate-in fade-in duration-500">
        <SurveyDashboard />
      </div>
    </main>
  );
}