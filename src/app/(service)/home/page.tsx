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

  useEffect(() => {
    fetchData();
  }, []);

  const handleInactiveClick = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    alert(`🚀 [${name}] 서비스는 현재 고도화 준비 중입니다.\n잠시만 기다려 주세요!`);
  };

  if (loading || !config) return (
    <div className="h-screen bg-white flex items-center justify-center font-black text-slate-300 italic tracking-widest animate-pulse">
      INITIALIZING SMART OFFICE HUB...
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50/30 flex flex-col items-center justify-center p-10 animate-in fade-in duration-700">
      
      {/* 🚀 히어로 섹션 (중앙 집중형) */}
      <div className="text-center mb-16 space-y-4">
        <h2 className="text-5xl font-black text-slate-900 tracking-tight">
          {config.main_headline}
        </h2>
        <p className="text-slate-400 text-base font-medium italic">
          {config.sub_headline}
        </p>
        <div className="h-1.5 w-12 bg-blue-600 mx-auto rounded-full mt-6" />
      </div>
      
      {/* 🚀 서비스 카드 그리드 */}
      <div 
        className="grid gap-8 w-full max-w-7xl" 
        style={{ gridTemplateColumns: `repeat(${config.home_grid_cols || 4}, minmax(0, 1fr))` }}
      >
        {menus.filter(m => m.level === 1 && m.is_visible).map((menu) => (
          <Link 
            key={menu.id} 
            href={menu.is_active ? menu.path : '#'}
            onClick={(e) => !menu.is_active && handleInactiveClick(e, menu.name)}
            className={`group bg-white rounded-[2.5rem] p-10 shadow-sm border border-slate-100 flex flex-col items-center text-center transition-all relative overflow-hidden ${
              !menu.is_active 
                ? 'opacity-40 grayscale cursor-not-allowed' 
                : 'hover:shadow-[0_20px_50px_rgba(0,0,0,0.05)] hover:-translate-y-2 hover:border-blue-200'
            }`}
          >
            {/* 호버 시 은은한 배경 효과 */}
            <div className="absolute inset-0 bg-gradient-to-b from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

            <div className="text-6xl mb-6 group-hover:scale-110 transition-transform relative z-10">
              {menu.icon || '📦'}
            </div>
            
            <h3 className="text-xl font-black text-slate-800 leading-tight tracking-tight relative z-10">
              {menu.name}
            </h3>
            
            <div className="h-0.5 w-6 bg-slate-100 my-4 group-hover:w-12 transition-all group-hover:bg-blue-400 relative z-10" />
            
            <p className="text-xs text-slate-400 leading-relaxed font-medium break-keep relative z-10">
              {menu.description}
            </p>

            {!menu.is_active && (
              <div className="absolute top-6 right-6 bg-amber-100 text-amber-600 text-[10px] font-black px-2.5 py-1 rounded-full">
                COMING SOON
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* 하단 푸터 (선택 사항) */}
      <footer className="mt-20 text-slate-300 text-[10px] font-bold tracking-widest uppercase">
        © 2026 KPCQA SMART OFFICE HUB. All Rights Reserved.
      </footer>
    </div>
  );
}