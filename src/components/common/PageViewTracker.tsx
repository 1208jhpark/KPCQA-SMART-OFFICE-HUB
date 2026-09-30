'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { normalizePagePath, shouldSkipPageViewPath } from '@/lib/page-view-stats';

const DEBOUNCE_MS = 20_000;

/**
 * 경로 변경 시 접속 1회 전송 (동일 경로 20초 내 중복 억제).
 * service / admin 레이아웃에 한 번만 마운트.
 */
export default function PageViewTracker() {
  const pathname = usePathname();
  const lastSent = useRef<{ path: string; at: number }>({ path: '', at: 0 });

  useEffect(() => {
    const path = normalizePagePath(pathname || '');
    if (!path || shouldSkipPageViewPath(path)) return;

    const now = Date.now();
    if (lastSent.current.path === path && now - lastSent.current.at < DEBOUNCE_MS) {
      return;
    }

    try {
      const sk = `pv:${path}`;
      const prev = Number(sessionStorage.getItem(sk) || 0);
      if (prev && now - prev < DEBOUNCE_MS) return;
      sessionStorage.setItem(sk, String(now));
    } catch {
      /* private mode 등 */
    }

    lastSent.current = { path, at: now };

    const payload = JSON.stringify({ path });
    const blob = new Blob([payload], { type: 'application/json' });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon('/api/analytics/page-view', blob);
      if (ok) return;
    }
    fetch('/api/analytics/page-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  }, [pathname]);

  return null;
}
