'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function asNameList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => String(n || '').trim()).filter(Boolean);
}

/** 메뉴 path 기준 부서 편집 담당자. unitId 있으면 해당 소속, 없으면 로그인 사용자 소속 */
export function useDeptAssignees(menuPath: string, unitId?: string | null) {
  const [editorNames, setEditorNames] = useState<string[]>([]);

  useEffect(() => {
    const path = String(menuPath || '').trim();
    const uid = String(unitId || '').trim();
    if (!path) {
      setEditorNames([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ path, t: String(Date.now()) });
        if (uid) qs.set('unitId', uid);
        const res = await fetch(`/api/admin/interface/dept-assignees?${qs.toString()}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setEditorNames([]);
          return;
        }
        setEditorNames(asNameList(data.editorNames));
      } catch {
        if (!cancelled) setEditorNames([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [menuPath, unitId]);

  return { editorNames };
}

type Props = {
  editorNames: string[];
  className?: string;
  /** 색 배경 헤더 위 — 흰 글씨 */
  onColor?: boolean;
  /** 헤더 버튼 문구. 기본: 부서 담당자 */
  label?: string;
  /** 팝업 파란 라벨. 기본: 부서 편집 담당자 */
  popupLabel?: string;
  /** 사람 SVG 아이콘. 이모지 라벨일 때 false */
  showIcon?: boolean;
};

function joinNames(names: string[]) {
  const list = names.map((n) => String(n || '').trim()).filter(Boolean);
  return list.length > 0 ? list.join(', ') : '없음';
}

const POPUP_MIN_WIDTH = 520;

/** 회색 서브텍스트 옆 — 클릭 시 넓은 메모형 팝업 */
export default function DeptAssigneeLine({
  editorNames,
  className = '',
  onColor = false,
  label = '부서 담당자',
  popupLabel = '부서 편집 담당자',
  showIcon = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxLeft = Math.max(12, window.innerWidth - POPUP_MIN_WIDTH - 12);
    setPos({
      top: r.bottom + 6,
      left: Math.min(Math.max(12, r.left), maxLeft),
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onWin = () => updatePos();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onWin, true);
    window.addEventListener('resize', onWin);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('scroll', onWin, true);
      window.removeEventListener('resize', onWin);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  return (
    <div className={`inline-flex items-center ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 text-[10px] font-medium ${
          onColor
            ? 'text-white/90 hover:text-white'
            : 'text-blue-600 hover:text-blue-800'
        }`}
        aria-expanded={open}
      >
        {showIcon ? (
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-3.5 h-3.5 shrink-0"
            aria-hidden
          >
            <path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            <path d="M3.5 16.2c.7-2.4 3.2-4 6.5-4s5.8 1.6 6.5 4a.75.75 0 0 1-.73.95H4.23a.75.75 0 0 1-.73-.95Z" />
          </svg>
        ) : null}
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{ top: pos.top, left: pos.left, minWidth: POPUP_MIN_WIDTH }}
            className="fixed z-[500] max-w-[40rem] rounded-xl border border-slate-200 bg-white shadow-lg p-3 text-left"
          >
            <p className="text-[11px] font-medium text-slate-700 leading-relaxed">
              <span className="text-blue-600">{popupLabel}</span>
              : {joinNames(editorNames)}
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}
