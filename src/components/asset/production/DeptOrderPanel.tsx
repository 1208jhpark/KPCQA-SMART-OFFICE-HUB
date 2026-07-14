'use client';

import React from 'react';

export default function PlaceholderComponent() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-20 bg-slate-50 min-h-[400px] rounded-2xl border border-dashed border-slate-300">
      <span className="text-4xl mb-4">🚧</span>
      <h2 className="text-xl font-black text-slate-700 tracking-tight mb-2">
        화면 컴포넌트 준비 중
      </h2>
      <p className="text-sm font-medium text-slate-500">
        해당 경로의 모듈이 로딩되었습니다. UI 개발이 진행될 영역입니다.
      </p>
    </div>
  );
}