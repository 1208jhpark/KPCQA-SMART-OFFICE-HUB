'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function ServiceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menus, setMenus] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null); 
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [menuRes, userRes] = await Promise.all([
          fetch('/api/admin/interface', { cache: 'no-store' }),
          fetch('/api/auth/me', { cache: 'no-store' })
        ]);

        if (menuRes.ok) setMenus(await menuRes.json());
        if (userRes.ok) setUser(await userRes.json());
        else router.push('/login'); // 인증 실패 시 로그인으로
      } catch (e) {
        console.error("Sync Error");
      } finally {
        setLoading(false);
      }
    };
    fetchInitialData();
  }, [router]);

  const handleLogout = async () => {
    if (!confirm('로그아웃 하시겠습니까?')) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const l1Menus = menus.filter(m => m.level === 1);
  const currentL1 = l1Menus.find(m => pathname.startsWith(m.path));
  const l2Menus = menus.filter(m => m.level === 2 && m.parent_id === currentL1?.id).sort((a,b) => a.sort_order - b.sort_order);
  const currentL2 = l2Menus.find(m => pathname.startsWith(m.path));
  const l3Menus = menus.filter(m => m.level === 3 && m.parent_id === currentL2?.id).sort((a,b) => a.sort_order - b.sort_order);

  if (loading) return <div className="h-screen flex items-center justify-center font-black text-blue-600 animate-pulse uppercase italic">Syncing Smart Office Hub...</div>;

  return (
    <div className="flex flex-col h-screen bg-slate-50/50 font-sans text-slate-900">
      <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0 z-50 shadow-sm">
        <div className="flex items-center gap-12">
          <Link href="/home" className="text-blue-600 font-black italic tracking-tighter text-xl uppercase">
            SMART OFFICE <span className="text-slate-900 not-italic ml-1">HUB</span>
          </Link>
          <nav className="flex gap-10">
            {l2Menus.map(l2 => (
              <Link key={l2.id} href={l2.path} className={`text-[11px] font-black tracking-tighter transition-all relative py-5 uppercase ${pathname.startsWith(l2.path) ? 'text-blue-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                {l2.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 text-slate-500 font-black text-[11px] tracking-tighter border-r pr-6 border-slate-100 h-8 font-sans">
            <span className="text-slate-900">{user?.name ? `${user.name} 님` : '데이터 로드 중...'}</span> 
            <span className="text-slate-300">|</span>
            <span className="font-bold opacity-60 lowercase">{user?.email || '---'}</span>
            <span className="text-slate-300">|</span>
            <span className="text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100 text-[9px] uppercase">
              {user?.roles?.[0] || 'LV_?'}
            </span>
          </div>
          <div className="flex gap-2">
            <Link href="/admin" className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black hover:bg-blue-600 transition-all uppercase shadow-lg shadow-slate-200">Admin</Link>
            <button onClick={handleLogout} className="px-4 py-2 border border-red-100 text-red-500 rounded-xl text-[10px] font-black hover:bg-red-500 hover:text-white transition-all uppercase">Logout</button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {l3Menus.length > 0 && (
          <aside className="w-64 bg-white border-r border-slate-100 flex flex-col p-6 shrink-0 shadow-sm animate-in slide-in-from-left duration-300">
            <nav className="space-y-1.5">
              {l3Menus.map(l3 => (
                <Link key={l3.id} href={l3.path} className={`flex items-center justify-between p-4 rounded-2xl transition-all ${pathname === l3.path ? 'bg-slate-900 text-white shadow-xl translate-x-1' : 'text-slate-400 hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-4">
                    <span className={`text-lg ${pathname === l3.path ? 'opacity-100' : 'opacity-40'}`}>{l3.icon}</span>
                    <span className="text-[11px] font-black tracking-tighter uppercase">{l3.name}</span>
                  </div>
                </Link>
              ))}
            </nav>
          </aside>
        )}
        <main className="flex-1 overflow-y-auto bg-slate-50/20">{children}</main>
      </div>
    </div>
  );
}