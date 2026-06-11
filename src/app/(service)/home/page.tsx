'use client';
  
import { useEffect, useState } from 'react';
import Link from 'next/link';
  
export default function ServiceHomePage() {
  const [menus, setMenus] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const fetchData = async () => {
    try {
      const [menuRes, configRes] = await Promise.all([
        fetch('/api/admin/interface', { cache: 'no-store' }),
        fetch('/api/admin/config', { cache: 'no-store' })
      ]);
      if (menuRes.ok) setMenus(await menuRes.json());
      if (configRes.ok) setConfig(await configRes.json());
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
  
  if (loading || !config) return (
    <div className="w-full h-[calc(100vh-64px)] bg-white flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-0.5 bg-gray-100 overflow-hidden relative border rounded-full">
          <div className="absolute inset-0 bg-indigo-600 animate-progress origin-left" />
        </div>
        <span className="text-[10px] font-bold text-gray-400 tracking-[0.3em] uppercase">Booting Hub...</span>
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
    <div className="w-full min-h-[calc(100vh-64px)] bg-[#f8fafc] text-slate-900 flex flex-col items-center relative overflow-x-hidden font-sans pb-12 selection:bg-indigo-500 selection:text-white">
      
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
        
        <h1 className={`font-black tracking-tighter text-slate-900 leading-[0.95] mb-5 transition-all ${isVertical ? 'text-6xl md:text-7xl' : 'text-5xl md:text-6xl'}`}>
          {config.main_headline}
        </h1>
        
        <p className={`text-sm md:text-base text-slate-500 font-medium tracking-tight max-w-xl ${!isVertical && 'mx-auto'}`}>
          {config.sub_headline}
        </p>
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
              href={menu.is_active ? menu.path : '#'}
              onClick={(e) => !menu.is_active && handleInactiveClick(e, menu.name)}
              className={`group flex flex-row items-center gap-5 bg-white/80 backdrop-blur-md rounded-[1.5rem] border border-slate-200/80 shadow-sm transition-all duration-300 relative overflow-hidden
                p-5 h-28
                ${!menu.is_active 
                  ? 'opacity-30 grayscale cursor-not-allowed border-dashed bg-transparent' 
                  : 'hover:bg-white hover:border-indigo-400 hover:shadow-[0_15px_30px_rgba(99,102,241,0.12)] hover:-translate-y-1'
                }`}
            >
              <div className="transition-all duration-500 group-hover:scale-110 shrink-0 text-4xl">
                {menu.icon || '📦'}
              </div>
              
              <div className="text-left">
                <h3 className="font-black text-slate-800 tracking-tight mb-1 flex items-center text-lg">
                  {menu.name}
                  {menu.is_active && (
                    <svg className="w-3.5 h-3.5 ml-2 opacity-0 group-hover:opacity-100 transition-all text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
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
  
      {/* Bottom Banner */}
      <footer className="relative z-10 shrink-0 w-full max-w-[1600px] px-8 md:px-16 pb-6 pt-2">
        <div className="flex flex-col md:flex-row items-center justify-between border-t border-slate-200/60 pt-6 gap-6">
          <div className="flex items-center space-x-3">
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em] whitespace-nowrap">External Assets</span>
            <div className="h-px w-8 bg-slate-200/60 hidden md:block" />
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-2">
            {dynamicSites.map((site: any, idx: number) => (
              <a 
                key={idx} 
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] font-bold tracking-[0.15em] text-slate-500 bg-white/40 backdrop-blur-sm border border-slate-200/60 px-3.5 py-1.5 rounded-lg transition-all hover:bg-white hover:text-indigo-600 hover:border-indigo-300 hover:shadow-[0_6px_15px_rgba(99,102,241,0.05)] hover:-translate-y-0.5 shadow-sm active:scale-95 font-sans uppercase"
              >
                {site.name}
              </a>
            ))}
            {dynamicSites.length === 0 && (
              <span className="text-[11px] text-slate-400 italic py-2">연동 사이트를 등록해 주세요.</span>
            )}
          </div>
  
          <div className="flex items-center space-x-6">
            <Link href="/admin/interface" className="group flex items-center gap-2 opacity-40 hover:opacity-100 transition-opacity">
              <span className="text-[10px] font-black text-slate-500 group-hover:text-indigo-600 uppercase tracking-widest">Setup</span>
              <div className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] shadow-sm">⚙️</div>
            </Link>
          </div>
        </div>
        
        <div className="mt-6 text-center text-[9px] font-bold text-slate-300 tracking-[0.6em] uppercase">
          / KPCQA SMART OFFICE HUB /
        </div>
      </footer>
    </div>
  );
}