// src/app/(service)/layout.tsx
'use client';
     
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
// 🚀 통합 권한 엔진 임포트 (경로를 본인 환경에 맞게 확인하세요)
import { checkMenuPermission } from '@/lib/permission-utils';
     
export default function ServiceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const [menus, setMenus] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null); 
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  
  const [showIndexGrid, setShowIndexGrid] = useState(false);
  const [indexCards, setIndexCards] = useState<any[]>([]);
  const [indexTitle, setIndexTitle] = useState('');
   
  const fetchInitialData = async () => {
    try {
      const ts = Date.now();
      const [menuRes, userRes, unitsRes] = await Promise.all([
        fetch('/api/admin/interface?t=' + ts, { cache: 'no-store' }),
        fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }),
        fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }).catch(() => null)
      ]);
     
      const menuData = await menuRes.json();
      setMenus(menuData);
     
      const fetchedUnits = unitsRes && unitsRes.ok ? await unitsRes.json() : [];
      setUnitsList(fetchedUnits);
     
      if (userRes.ok) {
        const userData = await userRes.json();
        const myUnit = fetchedUnits.find((u: any) => u.id === userData.dept_id);
        userData.unit = myUnit || { unit_name: '소속없음' };
        setUser(userData);
      } else {
        router.push('/login');
      }
    } catch (e) {
      console.error("Central Data load failed", e);
    } finally {
      setLoading(false);
    }
  };
   
  useEffect(() => {
    fetchInitialData();
  }, []);
   
  useEffect(() => {
    const validateAccessAndRouting = async () => {
      if (loading || !user) return;
      
      try {
        const res = await fetch('/api/admin/interface?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const freshMenus = await res.json();
        
        // 🚀 [보안 가드] URL 직접 진입 원천 차단
        // master 하위 경로로 진입하려 할 때, 최고 관리자거나 경영기획 부서가 아니면 즉시 차단
        if (pathname.includes('/master')) {
          const deptName = user.unit?.unit_name || user.dept_name || '';
          const isLV1 = user.roles?.includes('LV_1') || user.role === 'LV_1';
          
          if (!isLV1 && !deptName.includes('경영기획')) {
            setAccessError('⛔ 접근이 거부되었습니다: 해당 마스터 페이지는 경영기획본부 전용입니다.');
            return; // 에러 셋팅 후 아래 라우팅 로직 수행 안함 (강제 렌더링 중단)
          }
        }

        setMenus(freshMenus);
        setAccessError(null);
        setShowIndexGrid(false); 
        
        if (pathname.startsWith('/admin') && user.roles?.[0] !== 'LV_1') {
          setAccessError('해당 경로는 최고 관리자(LV_1) 전용입니다.');
          return;
        }
        
        const cleanPathname = pathname.replace(/\/$/, '').toLowerCase();
        const currentMenu = [...freshMenus]
          .sort((a: any, b: any) => (b.path?.length || 0) - (a.path?.length || 0))
          .find(m => cleanPathname.startsWith(m.path?.toLowerCase()) && m.path !== '/home');
        
        if (currentMenu) {
          if (!currentMenu.is_active) {
            setAccessError('현재 점검 중이거나 비활성화된 서비스입니다.');
            return;
          }
        
          const permission = checkMenuPermission(user, currentMenu, freshMenus, unitsList);
        
          if (!permission.hasAccess) {
            setAccessError('귀하의 소속 부서 또는 권한(레벨)으로는 접근할 수 없는 메뉴입니다.');
            return; 
          }
        
          // Step 1 & Step 2 모드 (하위로 자동 점프)
          if (currentMenu.level <= 2 && currentMenu.l2_entry_mode === 'L3_DEFAULT' && cleanPathname === currentMenu.path?.toLowerCase()) {
            const children = freshMenus
              .filter((m: any) => m.parent_id === currentMenu.id && m.is_active)
              .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
              
            if (children.length > 0) {
              const allowedChild = children.find((c: any) => checkMenuPermission(user, c, freshMenus, unitsList).hasAccess);
              if (allowedChild) {
                router.replace(allowedChild.path); 
                return;
              } else {
                setAccessError('하위 메뉴에 접근할 권한이 없습니다.');
                return;
              }
            }
          }
        
          // Step 3 전용 인덱스/단일화면 컨트롤러
          if (currentMenu.level === 3 && cleanPathname === currentMenu.path?.toLowerCase()) {
            const children = freshMenus
              .filter((m: any) => m.parent_id === currentMenu.id && m.is_active && m.is_visible)
              .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
            
            const allowedChildren = children.filter((c: any) => checkMenuPermission(user, c, freshMenus, unitsList).hasAccess);
              
            const isDirectMode = currentMenu.entry_l4_direct === true || String(currentMenu.entry_l4_direct).toLowerCase() === 'true' || currentMenu.entry_l4_direct === 1;
      
            if (isDirectMode) {
              // 단일화면 모드 (하위 1번으로 자동 점프)
              if (allowedChildren.length > 0) {
                router.replace(allowedChildren[0].path);
                return;
              }
            } else {
              // 인덱스 모드 (화면에 카드를 그림)
              setIndexTitle(currentMenu.name);
              setIndexCards(allowedChildren);
              setShowIndexGrid(true);
            }
          }
        }
      } catch (e) {
        console.error('라우팅 설정 동기화 실패:', e);
      }
    };
   
    validateAccessAndRouting();
  }, [pathname, loading, user, router]); 
  
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
  
  const l2Menus = menus
    .filter(m => m.level === 2 && m.parent_id === currentL1?.id && m.is_visible)
    .filter(m => checkMenuPermission(user, m, menus, unitsList).hasAccess)
    .sort((a, b) => a.sort_order - b.sort_order);
    
  const currentL2 = l2Menus.find(m => pathname.startsWith(m.path));
  
  const l3Menus = menus
    .filter(m => m.level === 3 && m.parent_id === currentL2?.id && m.is_visible)
    .filter(m => checkMenuPermission(user, m, menus, unitsList).hasAccess)
    .sort((a, b) => a.sort_order - b.sort_order);
  
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
                  {l2.name} {!l2.is_active && <span className="px-1.5 py-0.5 bg-red-900/40 text-red-400 rounded text-[8px] font-black leading-none">OFF</span>}
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
                const isActive = pathname.startsWith(l3.path);
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
        
        <main className="flex-1 overflow-y-auto bg-slate-50/20 relative">
          {accessError ? (
            <div className="absolute inset-0 flex items-center justify-center p-8 bg-slate-50/50 backdrop-blur-sm z-10 animate-fade-in">
              <div className="bg-white border-2 border-dashed border-red-200 rounded-[2rem] p-12 max-w-lg w-full text-center shadow-xl">
                <span className="text-6xl mb-4 block">⛔</span>
                <h2 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter">Access Denied</h2>
                <p className="text-red-500 font-bold text-sm mb-8">{accessError}</p>
                <button onClick={() => router.push('/home')} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-colors shadow-md">홈으로 돌아가기</button>
              </div>
            </div>
          ) : showIndexGrid ? (
            <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in relative z-20 bg-slate-50/20">
              <div className="pb-4 border-b border-slate-200">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Management Workspace Hub</p>
                <h2 className="text-2xl font-black tracking-tight text-slate-900">{indexTitle}</h2>
                <p className="text-slate-500 text-[11px] font-medium mt-1">원하시는 세부 관리 대장 업무를 선택하여 실행하십시오.</p>
              </div>
              <div className="flex flex-col gap-3">
                {indexCards.map((card: any) => (
                  <div 
                    key={card.id}
                    onClick={() => router.push(card.path)}
                    className="group bg-gradient-to-r from-slate-100 via-slate-50 to-slate-50 p-5 px-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:from-indigo-50/80 hover:via-white hover:to-slate-50 hover:border-indigo-400 hover:-translate-y-0.5 transition-all duration-500 flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-6">
                      <div className="w-10 h-10 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center text-lg font-bold group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                        {card.icon || '⚙️'}
                      </div>
                      <div className="space-y-0.5">
                        <h3 className="text-[13px] font-black text-slate-800 tracking-tight group-hover:text-blue-600 transition-colors">
                          {card.name}
                        </h3>
                        <p className="text-[11px] text-slate-400 font-bold leading-none">
                          {card.description || '상세 시스템 제어 모듈 관리 화면으로 이동합니다.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                       <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 group-hover:text-blue-500 font-mono transition-colors opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all">Enter Module</span>
                       <span className="text-slate-300 group-hover:text-blue-600 transition-colors">
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                       </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}