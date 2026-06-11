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
  
  const fetchInitialData = async () => {
    try {
      const ts = Date.now();
      const [menuRes, userRes, unitsRes] = await Promise.all([
        fetch('/api/admin/interface', { cache: 'no-store' }),
        fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }),
        fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }).catch(() => null)
      ]);
  
      const menuData = await menuRes.json();
      setMenus(menuData);
  
      if (userRes.ok) {
        const userData = await userRes.json();
        const unitsData = unitsRes && unitsRes.ok ? await unitsRes.json() : [];
        
        const myUnit = unitsData.find((u: any) => u.id === userData.dept_id);
        userData.unit = myUnit || { unit_name: '소속없음' };
        
        setUser(userData);
      } else {
        router.push('/login');
      }
    } catch (e) {
      console.error("데이터 로드 실패:", e);
    } finally {
      setLoading(false);
    }
  };
  
// 🚀 [보안 강화 1단계]: URL 변경 시 실시간 권한 필터링 검증
useEffect(() => {
  fetchInitialData().then(() => {
    if (user && menus.length > 0) {
      const userRole = user.roles?.[0] || 'LV_3';

      // 1. 🎯 [정밀 교정]: URL 중간에 admin이 포함된 경우가 아니라, 오직 '/admin' 제어 타워로 시작하는 경로만 LV_1로 강제 차단
      if (pathname.startsWith('/admin') && userRole !== 'LV_1') {
        alert('접근 거부: 해당 경로는 최고 관리자(LV_1) 전용입니다.');
        router.push('/home');
        return;
      }

      // 2. Admin/interface에서 설정한 메뉴 권한 정보 대조
      const currentMenu = menus.find(m => pathname.startsWith(m.path) && m.path !== '/home');
      if (currentMenu) {
        // 2-1. 활성화 여부 체크
        if (!currentMenu.is_active) {
          alert('현재 점검 중이거나 비활성화된 서비스입니다.');
          router.push('/home');
          return;
        }

        // 2-2. DB의 view_role_ids 배열을 직접 순회하여 권한 검증
        const allowedRoles = currentMenu.view_role_ids || ['LV_1', 'LV_2', 'LV_3'];
        
        // 내 권한(userRole)이 허용 배열(allowedRoles)에 존재하지 않으며, 최고관리자(LV_1)도 아니라면 차단
        if (!allowedRoles.includes(userRole) && userRole !== 'LV_1') {
          router.push('/403'); // 팝업 없이 깔끔하게 403 권한 없음 페이지로 이동
        }
      }
    }
  });
}, [pathname, user?.email]);
  
  const handleLogout = async () => {
    if (!confirm('로그아웃 하시겠습니까?')) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };
  
  const handleInactiveClick = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    alert(`🚀 [${name}] 서비스는 현재 점검 중이거나 비활성화되었습니다.`);
  };
  
  const l1Menus = menus.filter(m => m.level === 1 && m.is_visible);
  const currentL1 = l1Menus.find(m => pathname.startsWith(m.path));
  const l2Menus = menus.filter(m => m.level === 2 && m.parent_id === currentL1?.id && m.is_visible).sort((a, b) => a.sort_order - b.sort_order);
  const currentL2 = l2Menus.find(m => pathname.startsWith(m.path));
  const l3Menus = menus.filter(m => m.level === 3 && m.parent_id === currentL2?.id && m.is_visible).sort((a, b) => a.sort_order - b.sort_order);
  
  const isHomePage = pathname === '/home';
     
  if (loading) return (
    <div className="h-screen w-full flex items-center justify-center bg-white">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-black italic tracking-tighter text-blue-600 animate-pulse uppercase">Smart Office Hub Syncing...</h1>
        <div className="h-1.5 w-48 bg-slate-100 rounded-full mx-auto overflow-hidden">
          <div className="h-full bg-blue-600 w-1/3 animate-shimmer" />
        </div>
      </div>
    </div>
  );
  
  return (
    <div className="flex flex-col h-screen bg-slate-50/50 font-sans text-slate-900 overflow-hidden">
      {/* 글로벌 헤더 */}
      <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-8 shrink-0 z-50 shadow-lg">
        <div className="flex items-center gap-12">
          <Link href="/home" className="font-black text-[14px] uppercase tracking-widest text-indigo-400 not-italic hover:opacity-80 transition-opacity">
            SMART OFFICE HUB
          </Link>
          
          <nav className="flex gap-10">
            {l2Menus.map(l2 => {
              const isActive = pathname.startsWith(l2.path);
              return (
                <Link 
                  key={l2.id} 
                  href={l2.is_active ? l2.path : '#'} 
                  onClick={(e) => !l2.is_active && handleInactiveClick(e, l2.name)}
                  className={`text-[11px] font-black tracking-tighter transition-all relative py-5 uppercase flex items-center gap-1 ${
                    !l2.is_active ? 'opacity-20 cursor-not-allowed text-slate-400' :
                    isActive ? 'text-indigo-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {l2.name} {!l2.is_active && <span className="px-1.5 py-0.5 bg-red-900/40 text-red-400 rounded Royal text-[8px] font-black leading-none">OFF</span>}
                </Link>
              );
            })}
          </nav>
        </div>
  
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 text-slate-400 font-black text-[11px] tracking-tighter border-r pr-6 border-slate-800 h-8 font-sans">
            <span className="text-slate-200 font-black">{user?.name ? `${user.name} 님` : '정보 없음'}</span> 
            <span className="text-slate-700">|</span>
            <span className="text-indigo-300 font-black bg-indigo-950/40 px-2 py-0.5 border border-indigo-900/50 rounded">{user?.unit?.unit_name || '소속없음'}</span>
            <span className="text-slate-700">|</span>
            <span className="font-bold opacity-60 lowercase text-slate-400">{user?.email || '---'}</span>
            <span className="text-slate-700">|</span>
            <span className="text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-500/20 text-[9px] uppercase tracking-wider font-bold">
              {user?.roles?.[0] || 'LV_1'}
            </span>
          </div>
          
          <div className="flex items-center gap-5 font-sans">
            <Link href="/admin" className="text-indigo-400 font-bold hover:text-indigo-300 transition-colors text-[11px] tracking-wide uppercase active:scale-95">
              Admin
            </Link>
            <button onClick={handleLogout} className="text-rose-400 font-bold hover:text-rose-300 transition-colors text-[11px] tracking-wide uppercase active:scale-95">
              Logout
            </button>
          </div>
        </div>
      </header>
  
      <div className="flex flex-1 overflow-hidden">
        {!isHomePage && l3Menus.length > 0 && (
          <aside className="w-64 bg-white border-r border-slate-100 flex flex-col p-6 shrink-0 shadow-sm animate-in slide-in-from-left duration-300">
            <p className="text-[10px] font-black text-slate-300 uppercase px-3 mb-6 tracking-[0.2em]">Section Menu</p>
            <nav className="space-y-1.5">
              {l3Menus.map(l3 => {
                const isActive = pathname === l3.path;
                return (
                  <Link 
                    key={l3.id} 
                    href={l3.is_active ? l3.path : '#'} 
                    onClick={(e) => !l3.is_active && handleInactiveClick(e, l3.name)}
                    className={`flex items-center justify-between p-4 rounded-2xl transition-all ${
                      !l3.is_active ? 'opacity-40 grayscale cursor-not-allowed' :
                      isActive ? 'bg-slate-900 text-white shadow-xl translate-x-1' : 'text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className={`text-lg ${isActive ? 'opacity-100' : 'opacity-40'}`}>{l3.icon}</span>
                      <span className="text-[11px] font-black tracking-tighter uppercase">{l3.name}</span>
                    </div>
                    {!l3.is_active && <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[8px] font-black">OFF</span>}
                  </Link>
                );
              })}
            </nav>
          </aside>
        )}
        <main className="flex-1 overflow-y-auto bg-slate-50/20">
          {children}
        </main>
      </div>
    </div>
  );
}