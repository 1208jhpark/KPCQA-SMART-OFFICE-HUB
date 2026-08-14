'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type PublicAsset = {
  id: string;
  code: string;
  it_type?: string | null;
  category?: string | null;
  model?: string | null;
  sn?: string | null;
  brand?: string | null;
  spec?: string | null;
  dept?: string | null;
  user?: string | null;
};

function VerifyContent() {
  const searchParams = useSearchParams();
  const assetCode = String(searchParams.get('id') || searchParams.get('code') || '').trim();
  const [loading, setLoading] = useState(true);
  const [asset, setAsset] = useState<PublicAsset | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!assetCode) {
      setLoading(false);
      setError('스캔된 자산번호가 없습니다.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/asset/it?code=${encodeURIComponent(assetCode)}&t=${Date.now()}`,
          { cache: 'no-store' }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || '자산을 찾을 수 없습니다.');
        }
        const data = await res.json();
        if (!cancelled) setAsset(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '자산 조회에 실패했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetCode]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-slate-100 flex items-center justify-center p-4 font-sans">
        <p className="text-xs font-black text-slate-400 animate-pulse">자산 정보 불러오는 중...</p>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="min-h-[100dvh] bg-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 rounded-[2rem] shadow-2xl w-full max-w-sm text-center border border-slate-200">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-lg font-black text-slate-900 mb-2 tracking-tight">자산 조회 실패</h1>
          {assetCode && (
            <p className="text-[11px] font-mono font-black text-indigo-600 mb-3">{assetCode}</p>
          )}
          <p className="text-xs text-slate-500 font-bold">
            {error || '등록된 자산을 찾을 수 없습니다.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-white p-6 rounded-[2rem] shadow-2xl w-full max-w-sm border border-slate-200 space-y-4">
        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">IT·업무자산 QR 조회</p>
          <p className="text-[10px] font-bold text-amber-700 mt-2 leading-relaxed">
            ⚠ 사내 LAN / Wi-Fi에서만 조회됩니다
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 text-white px-4 py-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">담당자</p>
          <p className="mt-1 text-[15px] font-black tracking-tight">
            {String(asset.dept || '').trim() || '-'}
          </p>
          <p className="mt-0.5 text-[13px] font-bold text-indigo-200">
            {String(asset.user || '').trim() || '-'}
          </p>
        </div>

        <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">자산 분류</p>
          <p className="mt-1 text-[15px] font-black text-indigo-700 tracking-tight">
            {asset.it_type || '-'}
          </p>
          <p className="mt-1.5 text-[11px] font-bold text-slate-500 font-mono">
            자산번호 {asset.code || '-'}
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2.5">
          {(
            [
              ['model', '모델명'],
              ['sn', 'S/N'],
              ['brand', '제조사'],
              ['spec', '기본 사양'],
            ] as const
          ).map(([key, label]) => (
            <div
              key={key}
              className="flex justify-between gap-3 text-[11px] font-bold border-t border-slate-100/80 pt-2 first:border-0 first:pt-0"
            >
              <span className="text-slate-400 shrink-0">{label}</span>
              <span className="text-slate-800 text-right break-all min-w-0 flex-1">
                {String(asset[key] ?? '').trim() || '-'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 flex items-center justify-center font-black text-slate-400 animate-pulse text-xs">
          페이지 로딩 중...
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
