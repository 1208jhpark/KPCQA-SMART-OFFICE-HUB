'use client';
  
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { resolveEntryHref } from '@/lib/resolve-entry-href';
  
export default function ServiceHomePage() {
  const [menus, setMenus] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const fetchData = async () => {
    try {
      const ts = Date.now();
      const [menuRes, configRes, meRes, unitsRes] = await Promise.all([
        fetch('/api/admin/interface?t=' + ts, { cache: 'no-store' }),
        fetch('/api/admin/config?t=' + ts, { cache: 'no-store' }),
        fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }).catch(() => null),
      ]);
      if (menuRes.ok) setMenus(await menuRes.json());
      if (configRes.ok) setConfig(await configRes.json());
      if (unitsRes && unitsRes.ok) setUnitsList(await unitsRes.json());
      if (meRes && meRes.ok) setUser(await meRes.json());
    } catch (error) {
      console.error("Home Data Fetch Error:", error);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => { fetchData(); }, []);
  
  const handleInactiveClick = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    alert(`🚀 [${name}] 서비스는 현재 고도화 준비 중입니다.`);
  };

  const hrefForStep1 = (menu: any) => {
    if (!menu.is_active) return '#';
    // admin/interface Step 1 Entry Mode 반영 (화면 UI는 그대로, 클릭 목적지만)
    return resolveEntryHref(menu, menus, user, unitsList);
  };
  
  if (loading || !config) return (
    <div className="w-full h-[calc(100vh-64px)] bg-white flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-0.5 bg-gray-100 overflow-hidden relative border rounded-full">
          <div className="absolute inset-0 bg-indigo-600 animate-progress origin-left" />
        </div>
      </div>
    </div>
  );
  
  const isVertical = config.layout_type === 'vertical';
  const gridCols = config.home_grid_cols || 4;
     
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
        <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-white/60 backdrop-blur-sm border border-slate-200/80 text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-5 shadow-sm ${!isVertical && 'mx-auto'}`}>
          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
          <span>Integrated Smart Governance Hub</span>
        </div>

        <h1 className={`font-black tracking-tight text-slate-900 leading-[0.95] transition-all ${isVertical ? 'text-6xl md:text-7xl' : 'text-5xl md:text-6xl'}`}>
          {config.main_headline}
        </h1>

        {config.sub_headline ? (
          <p className={`mt-5 text-sm md:text-[15px] font-semibold text-slate-900 leading-relaxed max-w-2xl ${!isVertical && 'mx-auto'}`}>
            {config.sub_headline}
          </p>
        ) : null}

        <div className={`mt-7 h-px w-10 bg-indigo-400/60 ${!isVertical && 'mx-auto'}`} />
      </header>
  
      {/* Service Grid */}
      <main className="relative z-10 flex-1 flex w-full max-w-[1600px] px-8 md:px-16 justify-center items-center py-10">
        <div className={`w-full transition-all duration-700 max-h-full px-2
          ${isVertical 
            ? `grid gap-4 ${gridCols === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}` 
            : `grid gap-5`
          }`}
          style={!isVertical ? { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` } : {}}
        >
          {Array.isArray(menus) && menus.filter(m => m.level === 1 && m.is_visible).map((menu) => (
            <Link 
              key={menu.id} 
              href={hrefForStep1(menu)}
              onClick={(e) => !menu.is_active && handleInactiveClick(e, menu.name)}
              className={`group flex flex-row items-center gap-5 bg-white/80 backdrop-blur-md rounded-[1.5rem] border border-slate-200/80 shadow-sm transition-all duration-300 relative overflow-hidden
                p-5 h-28
                ${menu.icon ? '' : 'justify-center'}
                ${!menu.is_active 
                  ? 'opacity-30 grayscale cursor-not-allowed border-dashed bg-transparent' 
                  : 'hover:bg-gradient-to-br hover:from-indigo-50 hover:via-white hover:to-sky-50/80 hover:border-indigo-300 hover:shadow-[0_15px_30px_rgba(99,102,241,0.12)] hover:-translate-y-1'
                }`}
            >
              {menu.icon ? (
                <div className="transition-all duration-500 group-hover:scale-110 shrink-0 text-4xl">
                  {menu.icon}
                </div>
              ) : null}
              
              <div className={menu.icon ? 'text-left' : 'text-center'}>
                <h3 className={`font-black text-slate-800 tracking-tight mb-1 flex items-center text-lg ${menu.icon ? '' : 'justify-center'}`}>
                  {menu.name}
                  {menu.is_active && (
                    <span className="ml-2 inline-flex items-center justify-center opacity-0 -translate-x-1.5 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 ease-out">
                      <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h12.5m0 0L13 7.5M17.5 12 13 16.5" />
                      </svg>
                    </span>
                  )}
                </h3>
                <p className="text-slate-400 font-medium leading-snug line-clamp-2 text-[12px]">
                  {menu.description}
                </p>
              </div>
  
              {menu.is_active && (
                <div className="absolute bottom-0 left-0 w-full h-[2.5px] bg-indigo-500 scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
              )}
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