// src/app/(service)/layout.tsx
'use client';
     
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
// 🚀 통합 권한 엔진 임포트 (경로를 본인 환경에 맞게 확인하세요)
import { checkMenuPermission } from '@/lib/permission-utils';
import { resolveEntryHref } from '@/lib/resolve-entry-href';

export default function ServiceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const [menus, setMenus] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null); 
  const [unitsList, setUnitsList] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  /** URL 직접 진입 시 중간 화면 깜빡임 방지 */
  const [entryJumpPending, setEntryJumpPending] = useState(false);
  
  const [showIndexGrid, setShowIndexGrid] = useState(false);
  const [indexCards, setIndexCards] = useState<any[]>([]);
  const [indexTitle, setIndexTitle] = useState('');
  const [indexDescription, setIndexDescription] = useState('');
  const [showIndexTitle, setShowIndexTitle] = useState(true);
  const [showIndexDesc, setShowIndexDesc] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const getEntryHref = useCallback(
    (menu: any) => {
      if (!menu?.is_active) return '#';
      if (!user || menus.length === 0) return menu.path;
      return resolveEntryHref(menu, menus, user, unitsList);
    },
    [menus, user, unitsList]
  );
   
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

  // 관리자 초기화 후: 비밀번호 변경 강제
  useEffect(() => {
    if (loading || !user) return;
    if (user.must_reset_password && !pathname.startsWith('/account/password')) {
      router.replace('/account/password?forced=1');
    }
  }, [loading, user?.must_reset_password, pathname, router]);

  // 경로 변경 즉시 이전 인덱스 잔상 제거 (async 메뉴 재조회 완료 전 1~2초 깜빡임 방지)
  useEffect(() => {
    setShowIndexGrid(false);
    setAccessError(null);
  }, [pathname]);

  // 캐시된 메뉴로 즉시 점프 (북마크·직접 URL 진입 시 중간 화면 억제)
  useEffect(() => {
    if (loading || !user || menus.length === 0) return;
    const cleanPathname = pathname.replace(/\/$/, '').toLowerCase();
    const currentMenu = [...menus]
      .sort((a: any, b: any) => (b.path?.length || 0) - (a.path?.length || 0))
      .find((m) => cleanPathname === (m.path || '').replace(/\/$/, '').toLowerCase() && m.path !== '/home');
    if (!currentMenu) {
      setEntryJumpPending(false);
      setShowIndexGrid(false);
      return;
    }
    const dest = resolveEntryHref(currentMenu, menus, user, unitsList);
    const self = (currentMenu.path || '').replace(/\/$/, '').toLowerCase();
    if (dest && dest.replace(/\/$/, '').toLowerCase() !== self) {
      setShowIndexGrid(false);
      setEntryJumpPending(true);
      router.replace(dest);
      return;
    }

    setEntryJumpPending(false);

    // 캐시된 메뉴로 인덱스/본문 전환을 즉시 결정 (재조회 대기 없음)
    const exactMatch = cleanPathname === self;
    const isDirectMode =
      currentMenu.entry_l4_direct === true ||
      String(currentMenu.entry_l4_direct).toLowerCase() === 'true' ||
      currentMenu.entry_l4_direct === 1;
    if (currentMenu.level === 3 && exactMatch && !isDirectMode) {
      const children = menus
        .filter((m: any) => m.parent_id === currentMenu.id && m.is_active && m.is_visible)
        .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
      const allowedChildren = children.filter(
        (c: any) => checkMenuPermission(user, c, menus, unitsList).hasAccess
      );
      setIndexTitle(
        currentMenu.show_page_title && currentMenu.page_title
          ? currentMenu.page_title
          : currentMenu.name || ''
      );
      setShowIndexTitle(true);
      if (currentMenu.show_page_desc) {
        setIndexDescription(currentMenu.page_description || '');
        setShowIndexDesc(true);
      } else {
        setIndexDescription('');
        setShowIndexDesc(false);
      }
      setIndexCards(allowedChildren);
      setShowIndexGrid(true);
    } else {
      setShowIndexGrid(false);
    }
  }, [pathname, loading, user, menus, unitsList, router]);
   
  useEffect(() => {
    const validateAccessAndRouting = async () => {
      if (loading || !user) return;
      
      try {
        const res = await fetch('/api/admin/interface?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const freshMenus = await res.json();
        
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

          // 정확한 path 일치 + 즉시실행/단일화면 → 최종 목적지 (링크 미경유·북마크 대비)
          const exactMatch =
            cleanPathname === (currentMenu.path || '').replace(/\/$/, '').toLowerCase();
          if (exactMatch) {
            const dest = resolveEntryHref(currentMenu, freshMenus, user, unitsList);
            if (dest.replace(/\/$/, '').toLowerCase() !== cleanPathname) {
              setEntryJumpPending(true);
              router.replace(dest);
              return;
            }
          }
          setEntryJumpPending(false);
        
          // Step 3 전용 인덱스 컨트롤러 (단일화면은 resolveEntryHref에서 처리)
          if (currentMenu.level === 3 && exactMatch) {
            const children = freshMenus
              .filter((m: any) => m.parent_id === currentMenu.id && m.is_active && m.is_visible)
              .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
            
            const allowedChildren = children.filter((c: any) => checkMenuPermission(user, c, freshMenus, unitsList).hasAccess);
              
            const isDirectMode = currentMenu.entry_l4_direct === true || String(currentMenu.entry_l4_direct).toLowerCase() === 'true' || currentMenu.entry_l4_direct === 1;
      
            if (!isDirectMode) {
              // 인덱스 모드 — Step3「화면 상단 헤더 설정」반영
              setIndexTitle(
                currentMenu.show_page_title && currentMenu.page_title
                  ? currentMenu.page_title
                  : (currentMenu.name || '')
              );
              setShowIndexTitle(true);
              if (currentMenu.show_page_desc) {
                setIndexDescription(currentMenu.page_description || '');
                setShowIndexDesc(true);
              } else {
                setIndexDescription('');
                setShowIndexDesc(false);
              }
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
    setUserMenuOpen(false);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  useEffect(() => {
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [userMenuOpen]);
  
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
        <h1 className="text-2xl font-black italic tracking-tighter text-blue-600 animate-pulse uppercase">
          Smart Office Hub...
        </h1>
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
              const href = getEntryHref(l2);
              return (
                <Link 
                  key={l2.id} 
                  href={href} 
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
  
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            className="flex items-center gap-2 text-[11px] font-bold text-slate-200 hover:text-white transition-colors"
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
          >
            <span className="text-slate-400 font-semibold">
              {user?.unit?.unit_name || '소속없음'}
            </span>
            <span className="text-slate-100">
              {user?.name ? `${user.name} 님` : '정보 없음'}
            </span>
            <svg
              className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {userMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-3 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-xl overflow-hidden z-[60]"
            >
              <div className="px-3.5 py-3 space-y-1.5 border-b border-slate-800">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">레벨</p>
                <p className="text-[12px] font-semibold text-slate-200">
                  {user?.roles?.[0] || 'LV_1'}
                </p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pt-1.5">이메일</p>
                <p className="text-[12px] font-medium text-slate-300 break-all lowercase">
                  {user?.email || '---'}
                </p>
              </div>
              <div className="p-1.5 flex flex-col">
                <Link
                  href="/account/password"
                  role="menuitem"
                  onClick={() => setUserMenuOpen(false)}
                  className="px-3 py-2.5 rounded-lg text-[11px] font-bold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  비밀번호 변경
                </Link>
                <Link
                  href="/admin"
                  role="menuitem"
                  onClick={() => setUserMenuOpen(false)}
                  className="px-3 py-2.5 rounded-lg text-[11px] font-bold text-indigo-300 hover:bg-slate-800 hover:text-indigo-200 transition-colors"
                >
                  Admin
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="px-3 py-2.5 rounded-lg text-left text-[11px] font-bold text-rose-400 hover:bg-slate-800 hover:text-rose-300 transition-colors"
                >
                  로그아웃
                </button>
              </div>
            </div>
          )}
        </div>
      </header>
  
      <div className="flex flex-1 overflow-hidden">
        {!isHomePage && l3Menus.length > 0 && (
          <aside className="w-64 bg-white border-r border-slate-100 flex flex-col p-6 shrink-0 shadow-sm animate-in slide-in-from-left duration-300">
            <p className="text-[10px] font-black text-slate-300 uppercase px-3 mb-6 tracking-[0.2em]">Section Menu</p>
            <nav className="space-y-1.5">
              {l3Menus.map(l3 => {
                const isActive = pathname.startsWith(l3.path);
                const href = getEntryHref(l3);
                return (
                  <Link 
                    key={l3.id} 
                    href={href} 
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
        
        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable] bg-slate-50/20 relative">
          {accessError ? (
            <div className="absolute inset-0 flex items-center justify-center p-8 bg-slate-50/50 backdrop-blur-sm z-10 animate-fade-in">
              <div className="bg-white border-2 border-dashed border-red-200 rounded-[2rem] p-12 max-w-lg w-full text-center shadow-xl">
                <span className="text-6xl mb-4 block">⛔</span>
                <h2 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter">Access Denied</h2>
                <p className="text-red-500 font-bold text-sm mb-8">{accessError}</p>
                <button onClick={() => router.push('/home')} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-colors shadow-md">홈으로 돌아가기</button>
              </div>
            </div>
          ) : entryJumpPending ? (
            <div className="w-full h-full flex items-center justify-center min-h-[240px]">
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Loading...</p>
            </div>
          ) : showIndexGrid ? (
            <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in relative z-20 bg-slate-50/20">
              <div className="pb-4 border-b border-slate-200">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Management Workspace Hub</p>
                {showIndexTitle && (
                  <h2 className="text-2xl font-black tracking-tight text-slate-900">{indexTitle}</h2>
                )}
                {showIndexDesc && indexDescription && (
                  <p className="text-slate-500 text-[11px] font-medium mt-1 whitespace-pre-wrap">{indexDescription}</p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {indexCards.map((card: any) => (
                  <div 
                    key={card.id}
                    onClick={() => router.push(card.path)}
                    className="group bg-gradient-to-r from-slate-100 via-slate-50 to-slate-50 p-5 px-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:from-indigo-50/80 hover:via-white hover:to-slate-50 hover:border-indigo-400 hover:-translate-y-0.5 transition-all duration-500 flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-6">
                      {card.icon ? (
                        <div className="w-10 h-10 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center text-lg font-bold group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                          {card.icon}
                        </div>
                      ) : null}
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
