'use client';
  
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// 🚀 [핵심 정답]: L4PanelRenderer 내부의 지저분한 하드코딩을 지우고, Registry.tsx에서 모듈 명세서를 수입합니다!
import { ModuleRegistry } from './Registry';
  
// 1. 공통 로딩 컴포넌트
const ModuleLoader = () => (
  <div className="p-20 text-center font-black animate-pulse text-slate-300 tracking-widest text-xs">
    LOADING REALTIME SYSTEM MODULE...
  </div>
);
  
// 🚀 2. 렌더러 내부 전용 모듈 정밀 검증 가드 (AccessGuard)
const AccessGuard = ({ pathname, children }: { pathname: string, children: React.ReactNode }) => {
  const [status, setStatus] = useState<'loading' | 'allowed' | 'denied'>('loading');
     
  useEffect(() => {
    const verifyModuleAccess = async () => {
      try {
        const ts = Date.now();
        const [meRes, interfaceRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }),
          fetch('/api/admin/interface?t=' + ts, { cache: 'no-store' })
        ]);
     
        if (!meRes.ok) throw new Error('Not Authenticated');
        const user = await meRes.json();
        const menus = await interfaceRes.json();
     
        const userRole = user.roles?.[0] || 'LV_3';
     
        // 모듈 레벨 1차 방어: 관리자 경로 (LV_1) 강제 확인
        if (pathname.includes('/admin') && userRole !== 'LV_1') {
          setStatus('denied');
          return;
        }
     
        // 모듈 레벨 2차 방어: Admin/interface 매핑 데이터 확인
        const matchedMenu = menus
          .sort((a: any, b: any) => b.path.length - a.path.length) // 가장 상세하게 매칭되는 경로 찾기
          .find((m: any) => pathname.startsWith(m.path));
     
        if (matchedMenu) {
          if (!matchedMenu.is_active) {
            setStatus('denied');
            return;
          }
          
          // 🚀 [과거 버그 수정 완료]: 숫자가 아닌 view_role_ids 배열 구조로 권한 필터링 검증
          const allowedRoles = matchedMenu.view_role_ids || ['LV_1', 'LV_2', 'LV_3'];
          if (!allowedRoles.includes(userRole) && userRole !== 'LV_1') {
            setStatus('denied');
            return;
          }
        }
     
        setStatus('allowed');
      } catch (e) {
        setStatus('denied');
      }
    };
    verifyModuleAccess();
  }, [pathname]);
     
  if (status === 'loading') return <ModuleLoader />;
  if (status === 'denied') return (
    <div className="flex flex-col items-center justify-center p-24 h-full text-center bg-white/50 border border-red-100 rounded-[2.5rem] m-8 shadow-sm">
      <div className="text-5xl mb-4">⛔</div>
      <h2 className="text-xl font-black text-slate-800 mb-2">모듈 접근 권한이 없습니다</h2>
      <p className="text-xs text-slate-500 font-bold mb-6">
        관리자에 의해 해당 컴포넌트의 접근이 제한되었습니다.
      </p>
      <div className="px-4 py-2 bg-slate-100 text-slate-400 text-[10px] font-mono rounded-lg border border-slate-200">
        Blocked Path: {pathname}
      </div>
    </div>
  );
     
  return <>{children}</>;
};
  
// 3. 메인 렌더러 컴포넌트
export default function L4PanelRenderer() {
  const pathname = usePathname();
  let lowerPath = pathname?.toLowerCase() || '';
  
  // 🚀 [경로 자동 보정 엔진 (Fallback Parser)]
  if (lowerPath === '/asset/supplies/master' || lowerPath === '/asset/supplies/master/') {
    lowerPath = '/asset/supplies/master/dashboard';
  }
  if (lowerPath === '/asset/it/master' || lowerPath === '/asset/it/master/') {
    lowerPath = '/asset/it/master/dashboard';
  }
  if (lowerPath === '/asset/outsourcing/master' || lowerPath === '/asset/outsourcing/master/') {
    lowerPath = '/asset/outsourcing/master/dashboard';
  }
  
  // Registry.tsx에서 임포트한 ModuleRegistry 객체 서칭 계산
  const targetKey = Object.keys(ModuleRegistry).find(
    key => key.toLowerCase() === lowerPath
  );
  
  const TargetModule = targetKey ? ModuleRegistry[targetKey] : null;
  
  if (!TargetModule) {
    return (
      <div className="p-16 text-center border border-dashed border-slate-200 rounded-[2.5rem] bg-white/40 m-8">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
          [MCD 인터페이스 결함] 하위 레지스트리에 맵핑되지 않은 라우트 주소입니다.
        </p>
        <p className="text-[10px] text-slate-300 mt-1 font-mono">요청 경로: {pathname}</p>
        <p className="text-[10px] text-indigo-500 mt-2 font-bold">
          💡 Registry.tsx 파일의 ModuleRegistry 객체에 해당 주소가 정확히 매핑되었는지 확인해주세요.
        </p>
      </div>
    );
  }
  
  return (
    <div className="w-full h-full animate-fade-in">
      {/* 🚀 AccessGuard로 모듈을 한 번 더 감싸서, 렌더링 전 최종 권한 검사를 수행합니다 */}
      <AccessGuard pathname={pathname}>
        <TargetModule />
      </AccessGuard>
    </div>
  );
}