'use client';

import React, { useEffect, useState } from 'react';
import { generateQrDataUrl } from '@/utils/equipmentQr';

type Props = {
  /** QR에 담을 원문 (URL 등) */
  payload: string;
  size?: number;
  className?: string;
  alt?: string;
};

/** 클라이언트에서만 QR 생성 — 외부 qrserver 미사용 */
export default function LocalQrImage({
  payload,
  size = 250,
  className = '',
  alt = 'QR',
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(false);
    if (!payload) {
      setError(true);
      return;
    }
    generateQrDataUrl(payload, size)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [payload, size]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-50 text-[10px] font-bold text-red-500 ${className}`}
        style={{ width: size, height: size, maxWidth: '100%' }}
      >
        QR 생성 실패
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-50 text-[10px] font-bold text-slate-400 animate-pulse ${className}`}
        style={{ width: size, height: size, maxWidth: '100%' }}
      >
        생성 중…
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} width={size} height={size} />;
}
