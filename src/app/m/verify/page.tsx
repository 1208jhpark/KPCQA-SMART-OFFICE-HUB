'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function VerifyContent() {
  const searchParams = useSearchParams();
  const assetId = searchParams.get('id'); // QR코드에 담긴 ?id= 파라미터 추출

  return (
    <div className="min-h-[100dvh] bg-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-white p-8 rounded-[2rem] shadow-2xl w-full max-w-sm text-center border border-slate-200">
        <div className="text-6xl mb-4">⚠️</div>
        <h1 className="text-lg font-black text-slate-900 mb-2 tracking-tight">실사 진행 중이 아닙니다</h1>
        
        <div className="bg-slate-50 p-5 rounded-2xl mb-6 border border-slate-100 shadow-inner">
          {assetId && (
            <div className="mb-3 border-b border-slate-200 pb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">스캔된 장비</span>
              <span className="text-indigo-600 font-mono font-black text-sm">{assetId}</span>
            </div>
          )}
          <p className="text-xs text-slate-600 font-bold leading-relaxed">
            실사 진행 중 배포된 링크 안의<br/>
            <span className="text-slate-900 font-black px-1">`[📷 자산 라벨 QR 코드 촬영하기]`</span><br/>
            버튼을 눌러서 확인 바랍니다.
          </p>
        </div>

        {/* 🚀 상시 자산 확인 페이지로 연결 (추후 서버 배포 시 도메인만 변경하면 완벽 적용) */}
        <button 
          onClick={() => window.location.href = '/asset/it/personal'}
          className="w-full py-4 bg-slate-900 hover:bg-black text-white rounded-xl font-black text-xs shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          - 나의 IT 업무 자산 확인하기 -
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center font-black text-slate-400 animate-pulse text-xs">페이지 로딩 중...</div>}>
      <VerifyContent />
    </Suspense>
  );
}