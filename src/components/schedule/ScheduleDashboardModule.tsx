'use client';

import React from 'react';
import DeptSharedCalendar from '@/components/schedule/DeptSharedCalendar';
import ScheduleBoardMembers from '@/components/schedule/ScheduleBoardMembers';

/**
 * `/schedule/dashboard` — Shared Team Calendar + Detail
 * (마케팅 대시보드 하단 일정 영역 복사)
 */
export default function ScheduleDashboardModule() {
  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-slate-50 font-sans flex flex-col overflow-hidden">
      <div className="w-full max-w-[1760px] mx-auto flex-1 min-h-0 flex flex-col px-4 md:px-6 pt-5 pb-5 gap-4">
        <ScheduleBoardMembers />
        <div className="flex-1 min-h-0">
          <DeptSharedCalendar />
        </div>
      </div>
    </div>
  );
}
