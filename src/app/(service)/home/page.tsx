'use client';
  
import { useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import { resolveEntryHref } from '@/lib/resolve-entry-href';
import {
  readHomeConfigCache,
  writeHomeConfigCache,
  readServiceShellCache,
} from '@/lib/service-shell-cache';
  
export default function ServiceHomePage() {
  const [menus, setMenus] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [bootReady, setBootReady] = useState(false);
  
  const fetchData = async () => {
    try {
      const ts = Date.now();
      const [menuRes, configRes, meRes, unitsRes] = await Promise.all([
        fetch('/api/admin/interface?t=' + ts, { cache: 'no-store' }),
        fetch('/api/admin/config?t=' + ts, { cache: 'no-store' }),
        fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }).catch(() => null),
      ]);
      const nextMenus = menuRes.ok ? await menuRes.json() : [];
      const nextConfig = configRes.ok ? await configRes.json() : null;
      if (Array.isArray(nextMenus)) setMenus(nextMenus);
      if (nextConfig) {
        setConfig(nextConfig);
        writeHomeConfigCache({ config: nextConfig, menus: Array.isArray(nextMenus) ? nextMenus : [] });
      }
      if (unitsRes && unitsRes.ok) setUnitsList(await unitsRes.json());
      if (meRes && meRes.ok) setUser(await meRes.json());
    } catch (error) {
      console.error("Home Data Fetch Error:", error);
    }
  };

  useLayoutEffect(() => {
    const homeCache = readHomeConfigCache();
    const shell = readServiceShellCache();
    if (homeCache?.config) {
      setConfig(homeCache.config);
      setMenus(Array.isArray(homeCache.menus) ? homeCache.menus : []);
    }
    if (shell?.user) {
      setUser(shell.user);
      setUnitsList(Array.isArray(shell.units) ? shell.units : []);
      if (!homeCache?.menus?.length && Array.isArray(shell.menus)) setMenus(shell.menus);
    }
    setBootReady(true);
    fetchData();
  }, []);
  
  const handleInactiveClick = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    alert(`🚀 [${name}] 서비스는 현재 고도화 준비 중입니다.`);
  };

  const hrefForStep1 = (menu: any) => {
    if (!menu.is_active) return '#';
    // admin/interface Step 1 Entry Mode 반영 (화면 UI는 그대로, 클릭 목적지만)
    return resolveEntryHref(menu, menus, user, unitsList);
  };

  if (!bootReady) return null;
  if (!config) return null;
  
  const isVertical = config.layout_type === 'vertical';
  const gridCols = Number(config.home_grid_cols) || 4;
  const step1Menus = Array.isArray(menus)
    ? menus.filter((m) => m.level === 1 && m.is_visible)
    : [];
  /** 실제 카드 수와 설정 열 수 중 작은 값 — 빈 칸 없이 중앙 정렬 */
  const step1ColCount = Math.max(1, Math.min(step1Menus.length || 1, gridCols));
     
  let dynamicSites: any[] = [];
  if (config.linked_sites) {
    if (Array.isArray(config.linked_sites)) {
      dynamicSites = config.linked_sites;
    } else if (typeof config.linked_sites === 'string') {
      try {
        const parsed = JSON.parse(config.linked_sites);
        if (Array.isArray(parsed)) {
          dynamicSites = parsed;
        }
      } catch (e) {
        console.error("linked_sites 파싱 실패:", e);
      }
    }
  }
  
  return (
    // 💡 중복 차단용 fixed 가림막을 해제하고 레이아웃 내부 안착 스케일로 정돈
    <div className="w-full min-h-[calc(100vh-64px)] bg-[#f8fafc] text-slate-900 flex flex-col items-center relative overflow-x-hidden font-sans selection:bg-indigo-500 selection:text-white">
      
      {/* ❌ 껍데기 하드코딩 헤더 nav 태그 전면 제거 완료 -> 부모 layout.tsx의 헤더를 깨끗하게 투과하여 사용합니다. */}
  
      {/* 배경 글로우 효과 */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]" 
             style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="absolute top-[-10%] left-[-10%] w-[70%] h-[70%] bg-indigo-200/30 blur-[130px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] bg-blue-100/40 blur-[130px] rounded-full" />
        <div className="absolute top-[30%] left-[25%] w-[50%] h-[50%] bg-violet-100/30 blur-[130px] rounded-full" />
      </div>
  
      {/* Hero Section */}
      <header className={`relative z-10 shrink-0 w-full max-w-[1600px] px-8 md:px-16 mt-16 md:mt-20 ${isVertical ? 'text-left' : 'text-center'}`}>
        {String(config.tagline || '').trim() ? (
          <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-white/60 backdrop-blur-sm border border-slate-200/80 text-[10px] font-black text-indigo-600 tracking-wide mb-5 shadow-sm ${!isVertical && 'mx-auto'}`}>
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
            <span>{config.tagline}</span>
          </div>
        ) : null}

        <h1 className={`soh-home-title tracking-tight text-slate-900 leading-[0.95] transition-all ${isVertical ? 'text-6xl md:text-7xl' : 'text-5xl md:text-6xl'}`}>
          {config.main_headline}
        </h1>

        {config.sub_headline ? (
          <p className={`soh-home-subtitle mt-5 text-sm md:text-[15px] text-slate-900 leading-relaxed max-w-2xl ${!isVertical && 'mx-auto'}`}>
            {config.sub_headline}
          </p>
        ) : null}

        <div className={`mt-7 h-px w-10 bg-indigo-400/60 ${!isVertical && 'mx-auto'}`} />
      </header>
  
      {/* Service Grid — 카드 수와 무관하게 항상 가운데 정렬 */}
      <main className="relative z-10 flex-1 flex w-full max-w-[1600px] px-8 md:px-16 justify-center items-center py-10">
        <div
          className={`w-full transition-all duration-700 max-h-full px-2
          ${isVertical 
            ? `grid gap-6 ${gridCols === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}` 
            : `grid gap-x-8 gap-y-8 justify-center`
          }`}
          style={
            !isVertical
              ? {
                  gridTemplateColumns: `repeat(${step1ColCount}, minmax(120px, 148px))`,
                  justifyContent: 'center',
                }
              : undefined
          }
        >
          {step1Menus.map((menu) => (
            <Link 
              key={menu.id} 
              href={hrefForStep1(menu)}
              onClick={(e) => !menu.is_active && handleInactiveClick(e, menu.name)}
              className={`group flex flex-col items-center gap-3 w-full text-center transition-all duration-300
                ${!menu.is_active 
                  ? 'opacity-30 grayscale cursor-not-allowed' 
                  : 'hover:-translate-y-1'
                }`}
            >
              {/* 앱스토어형 아이콘 타일 */}
              <div
                className={`relative flex items-center justify-center w-[7.25rem] h-[7.25rem] sm:w-[7.75rem] sm:h-[7.75rem] rounded-[1.65rem] sm:rounded-[1.85rem] overflow-hidden shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition-all duration-300
                  ${!menu.is_active
                    ? 'bg-slate-200 border border-dashed border-slate-300'
                    : 'bg-gradient-to-br from-white via-slate-50 to-slate-100/90 border border-white/80 ring-1 ring-slate-200/70 group-hover:shadow-[0_14px_28px_rgba(99,102,241,0.18)] group-hover:ring-indigo-200'
                  }`}
              >
                {menu.icon ? (
                  <span className="text-[4.25rem] sm:text-[4.6rem] leading-none select-none transition-transform duration-300 group-hover:scale-[1.06] drop-shadow-sm">
                    {menu.icon}
                  </span>
                ) : (
                  <span className="text-3xl font-semibold text-slate-400 tracking-tight">
                    {(menu.name || '?').trim().slice(0, 1)}
                  </span>
                )}
              </div>

              {/* 텍스트(밖 · 아래) */}
              <div className="w-full px-0.5">
                <h3 className="soh-home-menu-title text-slate-800 tracking-tight text-[14px] sm:text-[15px] leading-snug font-semibold whitespace-pre-line">
                  {menu.name}
                </h3>
                {menu.description ? (
                  <p className="soh-home-menu-desc mt-0.5 text-slate-400 leading-snug line-clamp-2 text-[11px]">
                    {menu.description}
                  </p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </main>
  
      {/* Linked sites — 라인 아래는 상단 헤더와 동일 slate-900 */}
      <footer className="relative z-10 shrink-0 w-full mt-auto pt-16">
        <div className="w-full bg-slate-900 py-8">
          <div className="w-full max-w-[1600px] mx-auto px-8 md:px-16">
            <div className="px-2">
              {dynamicSites.length > 0 ? (
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
                  {dynamicSites.map((site: any, idx: number) => (
                    <a
                      key={idx}
                      href={site.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 text-[15px] font-semibold tracking-tight text-slate-300 rounded-lg border border-transparent bg-transparent transition-all duration-200 hover:text-white hover:bg-white/10 hover:border-white/15"
                    >
                      {site.name}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-center text-sm text-slate-500 font-medium">
                  연동 사이트를 등록해 주세요.
                </p>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}