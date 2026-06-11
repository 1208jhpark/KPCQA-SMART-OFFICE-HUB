'use client';
  
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ModuleRegistry } from './Registry';
  
// JSON 안전 파싱 헬퍼
const safeArray = (val: any) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch(e) {
      return val.split(',').map((s:string) => s.trim().replace(/['"\[\]]/g, '')); 
    }
  }
  return [val];
};
  
export default function SubMenuGrid({ path }: { path: string }) {
  const router = useRouter(); 
  const [subMenus, setSubMenus] = useState<any[]>([]);
  const [parentInfo, setParentInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [hasParentAccess, setHasParentAccess] = useState(false); 
    
  useEffect(() => {
    const fetchData = async () => {
      try {
        const ts = Date.now();
        const [uRes, iRes, unitsRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/units?active=true&t=${ts}`).catch(() => ({ ok: false, json: async () => [] }))
        ]);
        
        let userData: any = uRes.ok ? await uRes.json() : { roles: ['GUEST'] };
        const rolesArr = Array.isArray(userData.roles) ? userData.roles : (userData.roles ? JSON.parse(userData.roles) : []);
        const firstRole = rolesArr[0] || userData.role || userData.level || 'LV_3';
        
        const myRoleRaw = String(firstRole).toUpperCase();
        const myRole = myRoleRaw.includes('LV') 
          ? (myRoleRaw.includes('_') ? myRoleRaw : myRoleRaw.replace(/LV/g, 'LV_').replace(/\./g, ''))
          : myRoleRaw;
  
        userData.role = myRole;
        setCurrentUser(userData);
  
        const allData = await iRes.json();
        const unitsList = unitsRes.ok ? await unitsRes.json() : []; 
  
        const normalize = (p: string) => (p || "").trim().replace(/\/$/, "").toLowerCase();
        const targetPath = normalize(path);
  
        const currentParent = allData.find((item: any) => normalize(item.path) === targetPath);
        setParentInfo(currentParent);
  
        const myId = userData.id || userData.userId || userData._id;
        const myEmail = userData.email;
        const myDept = userData.dept_id;
  
        const isOrgAllowed = (allowedOrgIds: string[], userDeptId: string) => {
          if (!allowedOrgIds || allowedOrgIds.length === 0) return false;
          if (!userDeptId) return false;
          let currentId: string | null = userDeptId;
          while (currentId) {
            if (allowedOrgIds.includes(currentId)) return true;
            const parentOrg = unitsList.find((u: any) => u.id === currentId);
            currentId = parentOrg ? parentOrg.parent_id : null; 
          }
          return false;
        };
  
        const pVScopes = safeArray(currentParent?.view_scopes);
        const pOIds = safeArray(currentParent?.org_ids);
        const pTAccess = safeArray(currentParent?.task_accesses);
        const pTMasters = safeArray(currentParent?.task_masters);
        const pERoles = safeArray(currentParent?.edit_role_ids);
        const pVRoles = safeArray(currentParent?.view_role_ids);
  
        const isTopAdmin = myRole === 'LV_1'; 
  
        const isPMaster = currentParent?.master_editor_id === myId;
        const isPEditor = pERoles.includes(myRole) || pTMasters.some((tm:any) => tm.email === myEmail);
        const isPViewer = Boolean(
          (pVRoles.includes(myRole)) || (pVScopes.includes('TOTAL')) || 
          (pVScopes.includes('DEPT') && currentParent?.dept_id === myDept) || 
          (pTAccess.some((ta: any) => ta.email === myEmail)) || (isOrgAllowed(pOIds, myDept)) 
        );
  
        const canEnterParent = isTopAdmin || isPMaster || isPEditor || isPViewer || !currentParent; 
        setHasParentAccess(canEnterParent);
  
        if (canEnterParent && currentParent) {
          const rawChildren = allData.filter((menu: any) => menu.parent_id === currentParent.id);
  
          const filtered = rawChildren.filter((menu: any) => {
            if (menu.is_visible === false) return false; 
            
            if (isTopAdmin) return true; 
  
            const vScopes = safeArray(menu.view_scopes);
            const oIds = safeArray(menu.org_ids);
            const tAccess = safeArray(menu.task_accesses);
            const tMasters = safeArray(menu.task_masters);
            const eRoles = safeArray(menu.edit_role_ids);
            const vRoles = safeArray(menu.view_role_ids);
  
            const isMaster = menu.master_editor_id === myId;
            const isEditor = eRoles.includes(myRole) || tMasters.some((tm: any) => tm.email === myEmail);
            const isViewer = Boolean(
              isPMaster || isPEditor || isPViewer || 
              (vRoles.includes(myRole)) || 
              (vScopes.includes('TOTAL')) || 
              (vScopes.includes('DEPT') && menu.dept_id === myDept) || 
              (tAccess.some((ta: any) => ta.email === myEmail)) || 
              (isOrgAllowed(oIds, myDept))
            );
  
            return isMaster || isEditor || isViewer;
          }).sort((a: any, b: any) => a.sort_order - b.sort_order);
  
          setSubMenus(filtered);
        }
      } catch (error) {
        console.error("Permission Sync Error:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [path]);
  
  useEffect(() => {
    if ((parentInfo?.level === 1 || parentInfo?.level === 2) && parentInfo?.l2_entry_mode === 'L3_DEFAULT' && subMenus.length > 0) {
      router.replace(subMenus[0].path);
    }
  }, [parentInfo, subMenus, router]);
  
  const handleInactiveClick = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    alert(`🚧 [${name}] 모듈은 현재 점검 중이거나 관리자에 의해 비활성화(OFF) 되었습니다.`);
  };
  
  const renderPageHeader = (customPadding?: string) => {
    if (!parentInfo?.show_page_title && !parentInfo?.show_page_desc) return null; 
    return (
      <div className={`mb-10 pl-2 border-l-4 border-indigo-600 ${customPadding || ''}`}>
        {parentInfo?.show_page_title && (
          <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight pl-3">{parentInfo.page_title || parentInfo.name}</h1>
        )}
        {parentInfo?.show_page_desc && (
          <p className="text-slate-500 font-bold text-sm pl-3 whitespace-pre-wrap leading-relaxed">{parentInfo.page_description}</p>
        )}
      </div>
    );
  };
  
  if (loading) return <div className="p-20 text-center font-black text-teal-500 animate-pulse uppercase tracking-widest">Verifying Node Mesh...</div>;
  
  if (!hasParentAccess) {
    return (
      <div className="p-8 md:p-10 animate-fade-in w-full max-w-[1600px] mx-auto">
        {renderPageHeader()}
        <div className="p-20 text-center bg-white border border-slate-200 rounded-[3rem] shadow-sm flex flex-col items-center justify-center min-h-[400px]">
          <div className="text-6xl mb-6 opacity-30">🔒</div>
          <h3 className="text-2xl font-black text-slate-800">접근 권한이 없습니다.</h3>
          <p className="text-slate-500 text-sm mt-3 font-bold">시스템 관리자에게 접근 권한 승인을 요청하세요.</p>
        </div>
      </div>
    );
  }
  
  const renderComponent = (menuPath: string) => {
    const normalizeForRegistry = (p: string) => "/" + String(p || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
    const targetKey = normalizeForRegistry(menuPath);
    
    const RawModule = ModuleRegistry[targetKey];
    if (!RawModule) return <div className="p-20 text-center text-slate-300 font-bold border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50">연결된 레지스트리가 없는 모듈입니다. ({menuPath})</div>;
     
    const TargetModule = (RawModule as any).default || RawModule;
    return <TargetModule config={parentInfo} />;
  };
  
  // 하위 메뉴가 없을 때 (단일 모듈인 경우 Registry에서 직접 로드)
  if (subMenus.length === 0) {
    const cleanPath = String(path || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    const targetKey = "/" + cleanPath; 
    const RawModule = ModuleRegistry[targetKey];
     
    if (RawModule) {
      const TargetModule = (RawModule as any).default || RawModule;
      return (
        // 💡 [단일 모듈 보완]: w-full을 보충하여 가로 확장 안정화
        <div className="w-full max-w-[1600px] mx-auto p-8 md:p-10 animate-fade-in pb-20">
          {renderPageHeader()}
          <TargetModule config={parentInfo} />
        </div>
      );
    }
    
    return (
      <div className="w-full max-w-[1600px] mx-auto p-8 md:p-10 animate-fade-in">
        {renderPageHeader()}
        <div className="p-20 text-center bg-white border border-slate-200 rounded-[3rem] shadow-sm flex flex-col items-center justify-center min-h-[400px]">
          <div className="text-6xl mb-6 opacity-30">📁</div>
          <h3 className="text-2xl font-black text-slate-800">모듈이 연결되지 않았습니다.</h3>
          <p className="text-slate-500 text-sm mt-3 font-bold">
            어드민에서 <b>{path}</b> 경로가 정확한지 확인하시고,<br/>
            Registry.tsx에 컴포넌트가 올바르게 등록되었는지 점검해 주세요.
          </p>
        </div>
      </div>
    );
  }
  
  if ((parentInfo?.level === 1 || parentInfo?.level === 2) && parentInfo?.l2_entry_mode === 'L3_DEFAULT' && subMenus.length > 0) return null;
  
  const isSingleView = parentInfo?.entry_l4_direct === true;
  
  return (
    // 💡 [레이아웃 단일화 튜닝]: 단일화면 모드(isSingleView)일 때는 부모 패딩을 전면 제거('p-0')하여 자식 모듈들의 1600px 배너 칼각 선이 완벽하게 글로벌 탑바와 대칭을 이루도록 개선했습니다.
    <div className={`w-full max-w-[1600px] mx-auto animate-fade-in pb-20 ${isSingleView ? 'p-0' : 'p-8 md:p-10'}`}>
      {/* 단일화면 모드일 때 페이지 타이틀 영역 좌우 여백을 자식 배너와 싱크 맞춤 */}
      {renderPageHeader(isSingleView ? 'px-8 md:px-0 mt-6' : '')}
      
      {isSingleView ? (
        <div className="flex flex-col gap-10 w-full">
          {subMenus.map((menu) => (
            <div key={menu.id} className={`w-full ${!menu.is_active ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
              {!menu.is_active && (
                <div className="mx-8 md:mx-0 bg-red-50 border border-red-200 text-red-600 p-4 rounded-2xl text-center font-black text-sm mb-4">
                  🚧 이 모듈은 현재 점검 중이거나 비활성화(OFF) 되었습니다.
                </div>
              )}
              {renderComponent(menu.path)}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {subMenus.map((menu) => (
            <Link 
              key={menu.id} 
              href={menu.is_active ? menu.path : '#'}
              onClick={(e) => !menu.is_active && handleInactiveClick(e, menu.name)}
              className={`block group relative ${!menu.is_active ? 'opacity-40 grayscale cursor-not-allowed' : ''}`}
            >
              <div className={`bg-white border p-8 rounded-[2.5rem] shadow-sm transition-all duration-300 flex flex-col h-[280px] relative overflow-hidden ${menu.is_active ? 'border-slate-200 hover:shadow-xl hover:border-teal-500/50' : 'border-slate-200'}`}>
                {!menu.is_active && <div className="absolute top-6 right-6 z-20 bg-red-100 text-red-600 px-3 py-1.5 rounded-full font-black text-[10px]">OFF</div>}
                <div className="relative z-10 flex-1 flex flex-col justify-center">
                  {menu.icon && <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center group-hover:bg-teal-600 transition-all mb-5"><span className="text-2xl group-hover:invert">{menu.icon}</span></div>}
                  <div className="w-full">
                    <h3 className="text-xl font-black text-slate-800 group-hover:text-teal-600 transition-colors line-clamp-1">{menu.name}</h3>
                    <div className="h-10 mt-2">
                      {menu.description && <p className="text-[12px] font-bold text-slate-400 line-clamp-2 leading-relaxed">{menu.description}</p>}
                    </div>
                  </div>
                </div>
                <div className="mt-auto border-t border-slate-50 pt-5 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-teal-600 transition-colors">
                  <span>Enter Module</span> 
                  <span className="opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}