'use client';
  
import { useEffect, useState } from 'react';
  
export default function AdminInterfacePage() {
  const [activeTab, setActiveTab] = useState(1);
  const [menus, setMenus] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [selectedMenu, setSelectedMenu] = useState<any>(null);
  
  const [masterSearch, setMasterSearch] = useState('');
  const [tmSearch, setTmSearch] = useState(''); 
  const [taSearch, setTaSearch] = useState(''); 
  
  const [isSiteModalOpen, setIsSiteModalOpen] = useState(false);
  const [localSites, setLocalSites] = useState<any[]>([]);
  const [collapsedParents, setCollapsedParents] = useState<Record<string, boolean>>({});
  
  const parseLinkedSites = (rawSites: any): any[] => {
    if (!rawSites) return [];
    if (Array.isArray(rawSites)) return rawSites;
    if (typeof rawSites === 'string') {
      try {
        const parsed = JSON.parse(rawSites);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.error("linked_sites 파싱 실패:", e);
      }
    }
    return [];
  };

  const fetchData = async () => {
    try {
      const [mRes, cRes, oRes] = await Promise.all([
        fetch('/api/admin/interface', { cache: 'no-store' }),
        fetch('/api/admin/config', { cache: 'no-store' }),
        fetch('/api/admin/units?active=true', { cache: 'no-store' })
      ]);
      const mData = await mRes.json();
      const cData = await cRes.json();
      
      setMenus(mData); 
      setConfig(cData); 
      setOrgs(await oRes.json());
      
      setLocalSites(parseLinkedSites(cData?.linked_sites)); 
      
      try {
        const uRes = await fetch('/api/admin/users', { cache: 'no-store' });
        if (uRes.ok) {
          const uData = await uRes.json();
          setUsers(uData.users ? uData.users : []); 
        }
      } catch (e) { setUsers([]); }
      
      setLoading(false);
    } catch (error) { setLoading(false); }
  };
  
  useEffect(() => { fetchData(); }, []);
  
  const handleConfigUpdate = async (payload: any) => {
    try {
      setConfig((prev: any) => ({ ...prev, ...payload }));
      const res = await fetch('/api/admin/config', { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });
      if (!res.ok) alert('설정 저장 중 오류가 발생했습니다.');
    } catch (error) { console.error("Config Save Error"); }
  };
  
  const handleUpdate = async (id: string, payload: any) => {
    setMenus(prev => prev.map(m => m.id === id ? { ...m, ...payload } : m));
    try {
      const res = await fetch('/api/admin/interface', { method: 'PATCH', body: JSON.stringify({ id, ...payload }) });
      if (!res.ok) throw new Error('서버 업데이트 실패');
      fetchData(); 
    } catch (error) { alert("데이터 저장 중 오류 발생"); }
  };
  
  const handleMasterToggle = async (menu: any, isMaster: boolean) => {
    if (isMaster) {
      const siblings = menus.filter(m => m.parent_id === menu.parent_id && m.id !== menu.id && m.is_master);
      await Promise.all(siblings.map(s => fetch('/api/admin/interface', { method: 'PATCH', body: JSON.stringify({ id: s.id, is_master: false }) })));
    }
    handleUpdate(menu.id, { is_master: isMaster });
    if (selectedMenu?.id === menu.id) setSelectedMenu({ ...selectedMenu, is_master: isMaster });
  };
  
  const handleSyncChildPaths = async (parentMenu: any) => {
    const children = menus.filter(m => m.parent_id === parentMenu.id);
    if (children.length === 0) return alert("동기화할 하위 메뉴가 없습니다.");
    if (!confirm(`부모 경로 [${parentMenu.path}]를 기준으로 경로를 업데이트하시겠습니까?`)) return;
    try {
      await Promise.all(children.map(child => {
        const segments = child.path.split('/');
        const leaf = segments[segments.length - 1];
        const newPath = `${parentMenu.path}/${leaf}`.replace(/\/+/g, '/');
        return fetch('/api/admin/interface', { method: 'PATCH', body: JSON.stringify({ id: child.id, path: newPath }) });
      }));
      fetchData();
    } catch (e) { alert("동기화 실패"); }
  };
  
  const handleUpdateMode = (id: string, mode: 'INDEX' | 'DIRECT') => {
    const payload = { entry_sidebar: true, entry_index_view: mode === 'INDEX', entry_l4_direct: mode === 'DIRECT' };
    handleUpdate(id, payload);
    if (selectedMenu?.id === id) setSelectedMenu({ ...selectedMenu, ...payload });
  };
  
  const handleResetOrder = async (children: any[]) => {
    if (!confirm('1번부터 재정렬하시겠습니까?')) return;
    try {
      await Promise.all(children.map((c, index) => fetch('/api/admin/interface', { method: 'PATCH', body: JSON.stringify({ id: c.id, sort_order: index + 1 }) })));
      fetchData();
    } catch(e) { alert("정렬 실패"); }
  };
  
  const handleDeleteSafe = async (menu: any) => {
    const hasChildren = menus.some(c => c.parent_id === menu.id);
    if (hasChildren) return alert(`🚨 하위 데이터를 먼저 제거해 주세요.`);
    if (!confirm(`[${menu.name}] 카드를 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/admin/interface?id=${menu.id}`, { method: 'DELETE' });
      if (res.ok) { if (selectedMenu?.id === menu.id) setSelectedMenu(null); fetchData(); }
    } catch (error) { alert('삭제 실패'); }
  };
  
  const generateAlphabetPath = (index: number) => {
    let charCode = 97 + (index % 26);
    let prefix = index >= 26 ? Math.floor(index / 26) : '';
    return `/service/${String.fromCharCode(charCode)}${prefix}`;
  };
  
  const handleAddL1 = async () => {
    const l1Menus = menus.filter(m => m.level === 1);
    const nextSort = l1Menus.length > 0 ? Math.max(...l1Menus.map(m => m.sort_order)) + 1 : 1;
    const path = generateAlphabetPath(l1Menus.length);
    await fetch('/api/admin/interface', { method: 'POST', body: JSON.stringify({ level: 1, name: '신규 서비스', path: path, sort_order: nextSort }) });
    fetchData();
  };
  
  const handleAddSub = async (parentId: string, parentPath: string, level: number) => {
    const newPath = `${parentPath.replace(/\/$/, '')}/sub-${Date.now().toString(36)}`;
    const nextSort = menus.filter(m => m.parent_id === parentId).length + 1;
    try {
      const res = await fetch('/api/admin/interface', { method: 'POST', body: JSON.stringify({ level, name: `신규 L${level} 하위 메뉴`, parent_id: parentId, path: newPath, sort_order: nextSort, entry_sidebar: true }) });
      if (!res.ok) throw new Error('생성 실패');
      setCollapsedParents(prev => ({ ...prev, [parentId]: false }));
      fetchData();
    } catch (error) { alert('생성 오류'); }
  };
  
  const toggleCollapse = (parentId: string | null) => {
    const key = parentId || 'root';
    setCollapsedParents(prev => ({ ...prev, [key]: prev[key] === false ? true : false }));
  };
  
  const getBreadcrumbPath = (menuId: string | null) => {
    if (!menuId) return 'Root (최상위 서비스)';
    const pathNames = [];
    let currentId: string | null = menuId;
    while (currentId) {
      const node = menus.find(m => m.id === currentId);
      if (node) { pathNames.unshift(node.name); currentId = node.parent_id; }
      else break;
    }
    return pathNames.join(' > ');
  };
  
  const getSortLineage = (menuId: string | null): number[] => {
    if (!menuId) return [];
    const lineage: number[] = [];
    let currentId: string | null = menuId;
    while (currentId) {
      const node = menus.find(m => m.id === currentId);
      if (node) { lineage.unshift(node.sort_order || 0); currentId = node.parent_id; }
      else break;
    }
    return lineage;
  };
  
  const getEffectiveAllowedOrgs = (menu: any) => {
    let curr = menu;
    while (curr && curr.parent_id) {
      const parent = menus.find((m: any) => m.id === curr.parent_id);
      if (parent && parent.org_ids && parent.org_ids.length > 0) {
        return parent.org_ids;
      }
      curr = parent;
    }
    return [];
  };
  
  const isOrgAllowedByParent = (orgId: string, effectiveOrgIds: string[]) => {
    if (!effectiveOrgIds || effectiveOrgIds.length === 0) return true;
    let currentId: string | null = orgId;
    while (currentId) {
      if (effectiveOrgIds.includes(currentId)) return true;
      const parentOrg = orgs.find((u: any) => u.id === currentId);
      currentId = parentOrg ? parentOrg.parent_id : null;
    }
    return false;
  };
  
  const parentsList = activeTab === 1 
    ? [{ id: null, name: 'Root' }] 
    : menus.filter(m => m.level === activeTab - 1).sort((a, b) => {
        const linA = getSortLineage(a.id); const linB = getSortLineage(b.id);
        for (let i = 0; i < Math.max(linA.length, linB.length); i++) {
          const valA = linA[i] || 0; const valB = linB[i] || 0;
          if (valA !== valB) return valA - valB;
        }
        return (a.name || '').localeCompare(b.name || '');
      });
  
  if (loading) return <div className="p-10 text-center font-black text-slate-300 uppercase tracking-widest animate-pulse">Syncing...</div>;
  
  const tabsInfo = [
    { lv: 1, title: 'Sept1 Home View', desc: '전체 서비스 진입로 (기존 대분류)' },
    { lv: 2, title: 'Sept2 Tab View', desc: '상단 대메뉴 (탭) 고정 상단바' },
    { lv: 3, title: 'Sept3 Side View', desc: '좌측 서브메뉴 트리 (단일 vs 인덱스)' },
    { lv: 4, title: 'Sept4 Panel View', desc: '콘텐츠 작업 영역' }
  ];
  
  return (
    <div className="p-5 space-y-6 bg-gray-50 min-h-screen font-sans text-slate-800 relative">
      
      {/* 헤더 영역 */}
      <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl border-b-8 border-blue-600">
        <div className="flex flex-col lg:flex-row gap-8 items-start mb-8">
          <div className="flex-1 grid grid-cols-2 gap-4 w-full">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Main Headline</label>
              <input defaultValue={config?.main_headline} onBlur={(e) => handleConfigUpdate({main_headline: e.target.value})} className="w-full bg-slate-800 rounded-xl p-3 text-sm font-black outline-none border border-slate-700 focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Sub Headline</label>
              <input defaultValue={config?.sub_headline} onBlur={(e) => handleConfigUpdate({sub_headline: e.target.value})} className="w-full bg-slate-800 rounded-xl p-3 text-xs font-bold text-slate-400 outline-none border border-slate-700 focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 flex items-center justify-between min-w-[320px]">
             <div>
                <h4 className="text-sm font-black text-white">홈 화면 연동 사이트 관리</h4>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Linked Sites Manager</p>
             </div>
             <button onClick={() => { setLocalSites(parseLinkedSites(config?.linked_sites)); setIsSiteModalOpen(true); }} className="px-5 py-3 bg-blue-600 rounded-2xl font-black text-[11px] hover:bg-blue-500 transition-all shadow-lg">사이트 편집</button>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-slate-800 pt-6">
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Home Card Layout Strategy:</span>
            <div className="flex gap-2 bg-slate-800 p-1.5 rounded-2xl border border-slate-700">
              {[ { label: '가로 4열 그리드', type: 'horizontal', cols: 4 }, { label: '가로 5열 그리드', type: 'horizontal', cols: 5 }, { label: '세로 1열 (Split/L)', type: 'vertical', cols: 1 }, { label: '세로 2열 (Split/2)', type: 'vertical', cols: 2 } ].map((opt, i) => {
                const isActive = config?.layout_type === opt.type && config?.home_grid_cols === opt.cols;
                return ( <button key={i} onClick={() => handleConfigUpdate({ layout_type: opt.type, home_grid_cols: opt.cols })} className={`px-4 py-2 rounded-xl text-[11px] font-black transition-all ${isActive ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>{opt.label}</button> );
              })}
            </div>
          </div>
          {activeTab === 1 && <button onClick={handleAddL1} className="px-8 py-3 bg-white text-slate-900 rounded-2xl font-black text-xs hover:bg-blue-50 shadow-xl transition-all">+ L1 신규 서비스 추가</button>}
        </div>
      </div>
  
      <div className="flex flex-wrap gap-2 border-b">
        {tabsInfo.map(tab => (
          <button key={tab.lv} onClick={() => setActiveTab(tab.lv)} className={`px-6 py-3 text-left border-b-4 transition-all ${activeTab === tab.lv ? 'border-blue-600 bg-white' : 'border-transparent hover:bg-slate-50'}`}>
            <div className={`font-black text-[12px] ${activeTab === tab.lv ? 'text-blue-600' : 'text-slate-600'}`}>{tab.title}</div>
            <div className={`text-[9px] mt-0.5 font-bold ${activeTab === tab.lv ? 'text-blue-400' : 'text-slate-400'}`}>{tab.desc}</div>
          </button>
        ))}
      </div>
  
      {/* 리스트 영역 */}
      <div className="space-y-6 pb-20">
        {parentsList.map(parent => {
          const children = menus.filter(m => m.level === activeTab && m.parent_id === parent.id).sort((a, b) => {
            if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
            return (a.name || '').localeCompare(b.name || '');
          });
          const parentKey = parent.id || 'root';
          const isCollapsed = collapsedParents[parentKey] !== false; 
          
          return (
            <div key={parentKey} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all hover:shadow-md">
              <div className="bg-slate-50 px-5 py-4 border-b flex justify-between items-center cursor-pointer hover:bg-slate-100" onClick={() => toggleCollapse(parent.id)}>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-black text-blue-500 uppercase tracking-widest shrink-0">PARENT NODE:</span>
                  <span className="text-sm font-black text-slate-800 truncate max-w-2xl">{getBreadcrumbPath(parent.id)}</span>
                  <span className="text-[10px] font-bold text-blue-500 bg-white px-2 py-0.5 rounded-md border shadow-sm ml-2">{children.length} CARDS</span>
                </div>
                <div className="flex items-center gap-2">
                  {parent.id && children.length > 0 && <button onClick={(e) => { e.stopPropagation(); handleSyncChildPaths(parent); }} className="px-3 py-1.5 bg-amber-500 text-white rounded text-[10px] font-black shadow-sm hover:bg-amber-600 transition-colors">🔗 하위 경로 동기화</button>}
                  {children.length > 0 && <button onClick={(e) => { e.stopPropagation(); handleResetOrder(children); }} className="px-3 py-1.5 bg-slate-800 rounded text-[10px] font-black text-white shadow-sm hover:bg-slate-700 transition-colors">🔄 번호 리셋</button>}
                  {activeTab <= 4 && parent.id && <button onClick={(e) => { e.stopPropagation(); handleAddSub(parent.id, parent.path, activeTab); }} className="px-3 py-1.5 bg-white border border-blue-200 rounded text-[10px] font-black text-blue-600 shadow-sm hover:bg-blue-50 transition-colors">+ 하위 생성</button>}
                  <div className="text-slate-400 text-[10px] w-6 text-center ml-2">{isCollapsed ? '▼' : '▲'}</div>
                </div>
              </div>
              {!isCollapsed && (
                <table className="w-full text-left text-[11px]">
                  <tbody className="divide-y divide-gray-50">
                    {children.length === 0 ? (
                      <tr><td className="p-8 text-center text-slate-400">등록된 하위 카드가 없습니다.</td></tr>
                    ) : children.map((m) => {
                      
                      const masterName = users.find(u => u.id === m.master_editor_id)?.name || '-';
                      const editRoles = m.edit_role_ids?.length ? m.edit_role_ids.join(', ') : 'MASTER ONLY';
                      const globalCount = m.task_masters?.filter((t: any) => t.scope === 'GLOBAL').length || 0;
                      const deptCount = m.task_masters?.filter((t:any)=>t.scope==='DEPT').length || 0;
                      
                      const safeVScopes = Array.isArray(m.view_scopes) ? m.view_scopes : [];
                      const validScopes = safeVScopes.filter((s:string) => ['OWN', 'DEPT', 'TOTAL'].includes(s));
                      const viewScopesStr = validScopes.length > 0 ? validScopes.map((s:string) => s==='OWN'?'본인':s==='DEPT'?'부서':'전체').join(', ') : '제한';
                      const taCount = m.task_accesses?.length || 0;
                      const selectedOrgNames = m.org_ids?.map((id: any) => orgs.find((o: any) => o.id === id)?.unit_name).filter(Boolean);
                      const orgDisplay = selectedOrgNames?.length > 0 ? selectedOrgNames.join(', ') : '-';
                      const editScopeStr = m.edit_scopes?.includes('DEPT') ? '소속(부서/본부)' : '전체(Total)';
  
                      return (
                        <tr key={m.id} className="hover:bg-blue-50/10 group transition-colors">
                          <td className="p-4 w-20 text-center align-middle border-r border-gray-50 bg-gray-50/30">
                            <input type="number" defaultValue={m.sort_order} onBlur={(e) => handleUpdate(m.id, { sort_order: Number(e.target.value) })} className="w-10 p-1 font-black text-blue-600 bg-white border rounded text-center outline-none focus:ring-2 focus:ring-blue-500" />
                          </td>
                          <td className="p-4 align-top pt-5 pb-5">
                            <input type="text" defaultValue={m.name} onBlur={(e) => handleUpdate(m.id, { name: e.target.value })} className="font-black text-slate-800 bg-transparent block w-full outline-none focus:text-blue-600 text-[15px]" />
                            <div className="flex gap-2 text-[10px] text-slate-400 mt-1 font-mono">
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-blue-500 font-bold shrink-0">{m.path}</span>
                              <span className="italic truncate max-w-[300px]">{m.description || '...'}</span>
                            </div>
                            
                            {m.level === 3 && (
                              <div className="flex items-center gap-1 mt-3 bg-slate-50 p-1.5 rounded-lg inline-flex border border-slate-100 shadow-inner">
                                <span className="text-[9px] font-black text-slate-400 px-2 uppercase">Sept4 View Mode:</span>
                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleUpdateMode(m.id, 'INDEX'); }} className={`px-2 py-1 rounded text-[9px] font-black transition-all ${m.entry_index_view ? 'bg-white text-blue-600 shadow-sm border border-blue-200' : 'text-slate-400 hover:bg-slate-200'}`}>🗂️ 인덱스</button>
                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleUpdateMode(m.id, 'DIRECT'); }} className={`px-2 py-1 rounded text-[9px] font-black transition-all ${m.entry_l4_direct ? 'bg-white text-blue-600 shadow-sm border border-blue-200' : 'text-slate-400 hover:bg-slate-200'}`}>📄 단일화면</button>
                              </div>
                            )}
                            
                            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
                              {m.is_master && (
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-black border tracking-tight bg-slate-800 border-slate-700 text-white shadow-sm">
                                  <span>📌 마스터 원본 카드</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-black border tracking-tight bg-blue-50 border-blue-200 text-blue-700 shadow-sm">
                                <span>👑 Master 책임자:</span><span>{masterName !== '-' ? masterName : '미지정'}</span>
                              </div>
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-black bg-emerald-50 border border-emerald-200 text-emerald-700 tracking-tight shadow-sm">
                                <span>✍️ Edit:</span><span>{editRoles}</span><span className="text-emerald-300 opacity-60">|</span><span>범위: {editScopeStr}</span><span className="text-emerald-300 opacity-60">|</span><span>지정: {globalCount + deptCount}명</span>
                              </div>
                              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-black border tracking-tight max-w-[350px] shadow-sm ${validScopes.length > 0 || taCount > 0 || selectedOrgNames?.length > 0 ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                                <span>👁️ Access:</span>
                                <span className={validScopes.length === 0 ? 'text-red-500' : ''}>{viewScopesStr}</span>
                                <span className="opacity-60">|</span><span>지정: {taCount}명</span><span className="opacity-60">|</span><span className="truncate">Org: {orgDisplay}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 w-32 text-center align-middle space-x-1">
                            <button onClick={() => handleUpdate(m.id, { is_active: !m.is_active })} className={`px-2.5 py-1 rounded text-[9px] font-black ${m.is_active ? 'bg-green-100 text-green-600' : 'bg-red-50 text-red-400'}`}>{m.is_active ? 'ON' : 'OFF'}</button>
                            <button onClick={() => handleUpdate(m.id, { is_visible: !m.is_visible })} className={`px-2.5 py-1 rounded text-[9px] font-black ${m.is_visible ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>{m.is_visible ? 'SHOW' : 'HIDE'}</button>
                          </td>
                          <td className="p-4 w-36 text-center align-middle space-x-3">
                            <button onClick={() => { setSelectedMenu(m); setTmSearch(''); setTaSearch(''); setMasterSearch(''); }} className="text-[10px] font-black text-slate-400 hover:text-blue-600 underline">상세설정</button>
                            <button onClick={() => handleDeleteSafe(m)} className="text-[10px] font-black text-red-300 hover:text-red-500">DEL</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
  
      {/* 상세설정 패널 (우측 슬라이드) */}
      {selectedMenu && (
        <div className={`fixed inset-y-0 right-0 w-[420px] bg-white shadow-[-20px_0_60px_rgba(0,0,0,0.1)] z-[100] transform transition-transform duration-300 translate-x-0 flex flex-col`}>
          <div className="p-5 bg-slate-900 text-white flex justify-between items-start shrink-0">
            <div className="flex-1 mr-4">
              <h3 className="text-[12px] font-black tracking-widest uppercase">{selectedMenu.icon} {selectedMenu.name}</h3>
              <input type="text" defaultValue={selectedMenu.path} onBlur={(e) => handleUpdate(selectedMenu.id, { path: e.target.value })} className="mt-1 bg-slate-800 text-blue-400 text-[10px] font-mono px-2 py-1 rounded w-full outline-none border border-slate-700" />
            </div>
            <button onClick={() => setSelectedMenu(null)} className="text-xl font-light hover:rotate-90 transition-all text-slate-500">✕</button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-white scrollbar-thin pb-24">
            
            <div className="flex gap-3 pb-2 border-b border-slate-100">
              <div className="space-y-1 w-16 shrink-0">
                <label className="text-[9px] font-black text-slate-400 uppercase">Icon</label>
                <input type="text" defaultValue={selectedMenu.icon} onBlur={(e) => handleUpdate(selectedMenu.id, { icon: e.target.value })} className="w-full p-2 bg-gray-50 rounded-lg text-lg text-center border focus:border-indigo-500 outline-none" />
              </div>
              <div className="space-y-1 flex-1">
                <label className="text-[9px] font-black text-slate-400 uppercase">Card Description</label>
                <textarea defaultValue={selectedMenu.description} onBlur={(e) => handleUpdate(selectedMenu.id, { description: e.target.value })} className="w-full p-2 bg-gray-50 rounded-lg text-[10px] min-h-[44px] border outline-none font-medium focus:border-indigo-500" placeholder="메뉴 카드에 들어갈 짧은 설명..." />
              </div>
            </div>
  
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div>
                  <h4 className="text-[11px] font-black text-slate-800 flex items-center gap-1">📄 화면 상단 헤더 설정</h4>
                  <p className="text-[9px] text-slate-500 mt-0.5">실제 진입한 화면 상단에 노출될 제목과 설명을 개별 관리합니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase">Page Title (페이지 제목)</label>
                  <input type="text" defaultValue={selectedMenu.page_title || selectedMenu.name} onBlur={(e) => { if(e.target.value) handleUpdate(selectedMenu.id, { page_title: e.target.value }); }} className="w-full p-2 bg-white rounded-lg text-[11px] border focus:border-blue-500 outline-none font-black text-slate-800 shadow-sm" placeholder="화면 상단에 보일 전용 제목..." />
                </div>
                <div className="pt-5 shrink-0 flex flex-col items-center gap-1">
                   <span className="text-[8px] font-black text-slate-400 uppercase">노출</span>
                   <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={selectedMenu.show_page_title || false} onChange={(e) => { handleUpdate(selectedMenu.id, { show_page_title: e.target.checked }); setSelectedMenu({...selectedMenu, show_page_title: e.target.checked}); }} className="sr-only peer" />
                      <div className="w-8 h-4 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all shadow-inner"></div>
                    </label>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase">Page Description (페이지 설명)</label>
                  <textarea defaultValue={selectedMenu.page_description || ''} onBlur={(e) => handleUpdate(selectedMenu.id, { page_description: e.target.value })} className="w-full p-2 bg-white rounded-lg text-[10px] min-h-[60px] border outline-none font-medium focus:border-blue-500 text-slate-600 shadow-sm leading-relaxed" placeholder="화면 상단에 보일 전용 설명을 입력하세요..." />
                </div>
                <div className="pt-5 shrink-0 flex flex-col items-center gap-1">
                   <span className="text-[8px] font-black text-slate-400 uppercase">노출</span>
                   <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={selectedMenu.show_page_desc || false} onChange={(e) => { handleUpdate(selectedMenu.id, { show_page_desc: e.target.checked }); setSelectedMenu({...selectedMenu, show_page_desc: e.target.checked}); }} className="sr-only peer" />
                      <div className="w-8 h-4 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all shadow-inner"></div>
                    </label>
                </div>
              </div>
            </div>           
            
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
              <div>
                <h4 className="text-[11px] font-black text-slate-800 flex items-center gap-1">📌 마스터 원본 카드로 지정</h4>
                <p className="text-[9px] text-slate-500 mt-0.5">이 카드가 다른 카드들에 데이터를 뿌려주는 기준이 됩니다.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={selectedMenu.is_master || false} onChange={(e) => handleMasterToggle(selectedMenu, e.target.checked)} className="sr-only peer" />
                <div className="w-9 h-5 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-slate-800 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all shadow-inner"></div>
              </label>
            </div>
  
            {(selectedMenu.level === 1 || selectedMenu.level === 2) && (
              <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 shadow-sm space-y-3 mt-4">
                <div>
                  <h4 className="text-[11px] font-black text-blue-700 flex items-center gap-1">🚀 L{selectedMenu.level} 진입 동작 설정</h4>
                  <p className="text-[9px] text-slate-500 mt-0.5">메뉴 클릭 시 어떤 화면을 먼저 보여줄지 결정합니다.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => handleUpdate(selectedMenu.id, { l2_entry_mode: 'CUSTOM_UI' })} className={`py-2 rounded-lg text-[10px] font-black border transition-all ${selectedMenu.l2_entry_mode === 'CUSTOM_UI' || !selectedMenu.l2_entry_mode ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}>기획화면</button>
                  <button onClick={() => handleUpdate(selectedMenu.id, { l2_entry_mode: 'L3_DEFAULT' })} className={`py-2 rounded-lg text-[10px] font-black border transition-all ${selectedMenu.l2_entry_mode === 'L3_DEFAULT' ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}>L{selectedMenu.level + 1}의 1번카드 즉시실행</button>
                </div>
              </div>
            )}
  
            <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 shadow-sm">
              <h4 className="text-indigo-600 font-black text-[10px] mb-1 uppercase flex items-center gap-1">👑 편집/접근권한 MASTER 지정</h4>
              <p className="text-[9px] text-slate-400 mb-3 font-bold">이 카드의 생성, 수정, 삭제(CRUD) 및 접근 권한을 모두 갖는 총괄 책임자</p>
              <div className="space-y-2">
                <div className="relative">
                  <input type="text" value={masterSearch} onChange={(e) => setMasterSearch(e.target.value)} placeholder="이름으로 마스터 검색..." className="w-full p-2 bg-white border border-gray-200 rounded-lg text-[10px] font-bold focus:border-indigo-500 outline-none" />
                  {masterSearch && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-xl max-h-32 overflow-y-auto z-[120]">
                      {users.filter(u => u.name?.includes(masterSearch)).map(u => (
                        <div key={u.id} onClick={() => { handleUpdate(selectedMenu.id, { master_editor_id: u.id }); setSelectedMenu({...selectedMenu, master_editor_id: u.id}); setMasterSearch(''); }} className="p-2 text-[10px] font-bold hover:bg-indigo-50 cursor-pointer border-b flex justify-between"><span>{u.name}</span><span className="text-slate-300">{u.email}</span></div>
                      ))}
                    </div>
                  )}
                </div>
                {selectedMenu.master_editor_id && (
                  <div className="flex items-center justify-between bg-indigo-600 text-white p-2 rounded-lg shadow-md">
                    <span className="text-[10px] font-black">{users.find(u => u.id === selectedMenu.master_editor_id)?.name} (책임자 지정됨)</span>
                    <button onClick={() => { handleUpdate(selectedMenu.id, { master_editor_id: null }); setSelectedMenu({...selectedMenu, master_editor_id: null}); }} className="text-[10px] px-1 hover:text-indigo-200 font-black">✕</button>
                  </div>
                )}
              </div>
            </div>
  
            <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm mt-4">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-emerald-600 font-black text-[10px] uppercase flex items-center gap-1"><span>✍️</span> 편집 권한자 (Editor)</h4>
                <label className="flex items-center gap-1 cursor-pointer bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded text-[9px] font-black transition-colors">
                  <input type="checkbox" checked={['LV_1', 'LV_2', 'LV_3'].every(lv => selectedMenu.edit_role_ids?.includes(lv))} onChange={(e) => {
                    const next = e.target.checked ? ['LV_1', 'LV_2', 'LV_3'] : [];
                    handleUpdate(selectedMenu.id, { edit_role_ids: next }); setSelectedMenu({...selectedMenu, edit_role_ids: next});
                  }} className="w-3 h-3 accent-emerald-600 rounded" />
                  <span className="text-slate-600">전체 허용</span>
                </label>
              </div>
  
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-slate-400 w-16">Editor 레벨</span>
                  <div className="flex flex-1 gap-1">
                    {[{id:'LV_1', label:'LV.1'}, {id:'LV_2', label:'LV.2'}, {id:'LV_3', label:'LV.3'}].map(role => (
                      <label key={role.id} className={`flex-1 flex items-center justify-center py-1.5 rounded-lg border text-[9px] font-black cursor-pointer transition-all ${selectedMenu.edit_role_ids?.includes(role.id) ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'border-gray-200 text-slate-400 hover:bg-gray-50'}`}>
                        {role.label}
                        <input type="checkbox" checked={selectedMenu.edit_role_ids?.includes(role.id) || false} onChange={(e) => {
                          const cur = selectedMenu.edit_role_ids || [];
                          const next = e.target.checked ? [...cur, role.id] : cur.filter((k:any) => k !== role.id);
                          handleUpdate(selectedMenu.id, { edit_role_ids: next }); setSelectedMenu({...selectedMenu, edit_role_ids: next});
                        }} className="hidden" />
                      </label>
                    ))}
                  </div>
                </div>
  
                <div>
                  <label className="text-[9px] font-bold text-slate-400 mb-1 block">Task Editor (다수 지정)</label>
                  <div className="relative">
                    <input type="text" value={tmSearch} onChange={(e) => setTmSearch(e.target.value)} className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-[10px] outline-none focus:border-emerald-500" placeholder="Editor 검색..." />
                    {tmSearch && (
                      <div className="absolute top-full left-0 right-0 bg-white border rounded-lg shadow-xl max-h-32 overflow-y-auto z-[110]">
                        {users.filter(u => u.name?.includes(tmSearch)).map(u => (
                          <div key={u.id} onClick={() => {
                            const cur = selectedMenu.task_masters || [];
                            if(!cur.find((item:any) => item.email === u.email)) {
                              const next = [...cur, { email: u.email, scope: 'DEPT' }];
                              handleUpdate(selectedMenu.id, { task_masters: next }); setSelectedMenu({...selectedMenu, task_masters: next});
                            }
                            setTmSearch('');
                          }} className="p-2 text-[10px] font-bold hover:bg-emerald-50 cursor-pointer border-b flex justify-between"><span>{u.name}</span><span className="text-slate-300">{u.email}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 mt-2">
                    {selectedMenu.task_masters?.map((tm: any) => (
                      <div key={tm.email} className="bg-gray-50 border border-gray-100 p-1.5 rounded-lg flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-700 ml-1">{users.find(u => u.email === tm.email)?.name || tm.email}</span>
                        <div className="flex gap-1">
                          {['DEPT', 'GLOBAL'].map(sc => (
                            <button key={sc} onClick={() => {
                              const next = selectedMenu.task_masters.map((item:any) => item.email === tm.email ? { ...item, scope: sc } : item);
                              handleUpdate(selectedMenu.id, { task_masters: next }); setSelectedMenu({...selectedMenu, task_masters: next});
                            }} className={`px-1.5 py-0.5 rounded text-[8px] font-black transition-all ${tm.scope === sc ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-slate-400'}`}>{sc === 'DEPT' ? '부서' : '전사'}</button>
                          ))}
                          <button onClick={() => {
                            const next = selectedMenu.task_masters.filter((item:any) => item.email !== tm.email);
                            handleUpdate(selectedMenu.id, { task_masters: next }); setSelectedMenu({...selectedMenu, task_masters: next});
                          }} className="px-1.5 text-[10px] text-red-400 hover:text-red-600">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
  
                <div className="space-y-2 mt-4 pt-4 border-t border-dashed border-emerald-200">
                  <span className="text-[10px] font-black text-slate-800 tracking-tighter">🔘 편집 가능 범위 (Edit Scope) 설정</span>
                  <div className="flex gap-2">
                    {[
                      { id: 'TOTAL', label: '전체 자료 편집 허용 (최고 관리자용)' },
                      { id: 'DEPT', label: '본인 부서 및 상위 본부 자료만 허용 (실무자용)' }
                    ].map(scope => {
                      const isChecked = selectedMenu.edit_scopes?.includes(scope.id) || (!selectedMenu.edit_scopes?.length && scope.id === 'TOTAL');
                      return (
                        <label key={scope.id} className={`flex-1 flex items-center justify-center py-2 rounded-lg border text-[10px] font-black cursor-pointer transition-all ${isChecked ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'border-gray-200 text-slate-400 hover:bg-gray-50'}`}>
                          {scope.label}
                          <input type="radio" name={`edit_scope_${selectedMenu.id}`} checked={isChecked || false} onChange={() => { handleUpdate(selectedMenu.id, { edit_scopes: [scope.id] }); setSelectedMenu({...selectedMenu, edit_scopes: [scope.id]}); }} className="hidden" />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
  
            {/* 🚀 [MDC 원칙 수정된 UI 적용 영역] */}
            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm mt-4 space-y-5">
              <h4 className="text-purple-600 font-black text-[10px] uppercase flex items-center gap-1 border-b border-purple-50 pb-2">
                <span>👁️</span> 접근 권한 및 화면 설정
              </h4>
              
              <div className="bg-purple-50 p-3 rounded-lg text-[9px] font-bold text-purple-700 leading-relaxed shadow-inner">
                💡 <b>[예외]</b> 특정 지정인(Task Access)은 무조건 통과합니다.<br/>
                📌 <b>[규칙]</b> 그 외에는 부서(AND) + 레벨(AND) 조건을 모두 충족해야 통과합니다.<br/>
                🎯 <b>[결과]</b> 통과된 자에게만 데이터 범위(Data Scope) 권한이 부여됩니다.
              </div>
  
              {/* 1️⃣ [예외] Task Access */}
              <div className="space-y-2">
                <span className="text-[10px] font-black text-slate-800 tracking-tighter">1️⃣ [예외] Task Access (특정 권한자 다수 지정)</span>
                <div className="relative">
                  <input type="text" value={taSearch} onChange={(e) => setTaSearch(e.target.value)} className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-[10px] font-bold focus:border-purple-500 outline-none" placeholder="이름으로 조회 권한자 추가..." />
                  {taSearch && (
                    <div className="absolute top-full left-0 right-0 bg-white border rounded-lg shadow-xl max-h-32 overflow-y-auto z-[110]">
                      {users.filter(u => u.name?.includes(taSearch)).map(u => (
                        <div key={u.id} onClick={() => {
                          const cur = Array.isArray(selectedMenu.task_accesses) ? selectedMenu.task_accesses : [];
                          if(!cur.find((item:any) => item.email === u.email)) {
                            const next = [...cur, { email: u.email }];
                            handleUpdate(selectedMenu.id, { task_accesses: next }); setSelectedMenu({...selectedMenu, task_accesses: next});
                          }
                          setTaSearch('');
                        }} className="p-2 text-[10px] font-bold hover:bg-purple-50 cursor-pointer border-b flex justify-between"><span>{u.name}</span><span className="text-slate-300">{u.email}</span></div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedMenu.task_accesses?.map((ta: any) => (
                    <div key={ta.email} className="bg-purple-50 border border-purple-100 px-2 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                      <span className="text-[9px] font-bold text-purple-800">{users.find(u => u.email === ta.email)?.name || ta.email}</span>
                      <button onClick={() => {
                        const next = selectedMenu.task_accesses.filter((item:any) => item.email !== ta.email);
                        handleUpdate(selectedMenu.id, { task_accesses: next }); setSelectedMenu({...selectedMenu, task_accesses: next});
                      }} className="text-[10px] text-purple-400 hover:text-red-500 font-black ml-1">✕</button>
                    </div>
                  ))}
                </div>
              </div>
  
              {/* 2️⃣ [규칙 1] Org Guard */}
              <div className="space-y-2 pt-2 border-t border-dashed border-slate-200">
                <span className="text-[10px] font-black text-slate-800 tracking-tighter">2️⃣ [규칙 1] Org Guard (지정 부서만 접근허용)</span>
                
                {(() => {
                  const effectiveParentOrgs = getEffectiveAllowedOrgs(selectedMenu);
                  const isRestrictedByParent = effectiveParentOrgs.length > 0;
     
                  return (
                    <div className="relative">
                      <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto border border-gray-100 rounded-lg p-2 bg-gray-50 scrollbar-thin shadow-inner">
                        {orgs.map(org => {
                          const isAllowedByParent = isOrgAllowedByParent(org.id, effectiveParentOrgs);
                          const isChecked = selectedMenu.org_ids?.includes(org.id) || false;
                          
                          return (
                            <label 
                              key={org.id} 
                              className={`flex items-center gap-2 p-1.5 rounded-md transition-all 
                                ${!isAllowedByParent ? 'opacity-40 grayscale cursor-not-allowed bg-slate-100' : 'cursor-pointer hover:bg-white'} 
                                ${isChecked && isAllowedByParent ? 'bg-white text-purple-800 shadow-sm border border-purple-100' : 'text-slate-500'}
                              `}
                            >
                              <input 
                                type="checkbox" 
                                disabled={!isAllowedByParent}
                                checked={isChecked && isAllowedByParent} 
                                onChange={(e) => {
                                  const cur = Array.isArray(selectedMenu.org_ids) ? selectedMenu.org_ids : [];
                                  const next = e.target.checked ? [...cur, org.id] : cur.filter((id:any) => id !== org.id);
                                  handleUpdate(selectedMenu.id, { org_ids: next }); setSelectedMenu({...selectedMenu, org_ids: next});
                                }} 
                                className="w-3 h-3 accent-purple-600 rounded disabled:opacity-50" 
                              />
                              <span className={`text-[9px] font-bold ${!isAllowedByParent ? 'line-through' : ''}`}>{org.unit_name}</span>
                            </label>
                          );
                        })}
                      </div>
                      {isRestrictedByParent && (
                        <div className="text-[9px] font-bold text-red-500 mt-1">
                          ※ 상위 모듈에서 접근을 제한한 부서는 비활성화됩니다.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
  
              {/* 3️⃣ [규칙 2] Access Level */}
              <div className="space-y-2 pt-2 border-t border-dashed border-slate-200">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-black text-slate-800 tracking-tighter">3️⃣ [규칙 2] 접근 권한 레벨 (Access Level)</span>
                  <label className="flex items-center gap-1 cursor-pointer bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded text-[8px] font-black">
                    <input type="checkbox" checked={['LV_1', 'LV_2', 'LV_3'].every(lv => selectedMenu.view_role_ids?.includes(lv))} onChange={(e) => {
                      const next = e.target.checked ? ['LV_1', 'LV_2', 'LV_3'] : [];
                      handleUpdate(selectedMenu.id, { view_role_ids: next }); setSelectedMenu({...selectedMenu, view_role_ids: next});
                    }} className="w-2.5 h-2.5 accent-purple-600 rounded" />
                    <span className="text-slate-600">전체 허용</span>
                  </label>
                </div>
                <div className="flex gap-1">
                  {[{id:'LV_1', label:'LV.1'}, {id:'LV_2', label:'LV.2'}, {id:'LV_3', label:'LV.3'}].map(role => (
                    <label key={role.id} className={`flex-1 flex items-center justify-center py-1.5 rounded-lg border text-[9px] font-black cursor-pointer transition-all ${selectedMenu.view_role_ids?.includes(role.id) ? 'bg-purple-600 border-purple-600 text-white shadow-sm' : 'border-gray-200 text-slate-400 hover:bg-gray-50'}`}>
                      {role.label}
                      <input type="checkbox" checked={selectedMenu.view_role_ids?.includes(role.id) || false} onChange={(e) => {
                        const cur = selectedMenu.view_role_ids || [];
                        const next = e.target.checked ? [...cur, role.id] : cur.filter((k:any) => k !== role.id);
                        handleUpdate(selectedMenu.id, { view_role_ids: next }); setSelectedMenu({...selectedMenu, view_role_ids: next});
                      }} className="hidden" />
                    </label>
                  ))}
                </div>
              </div>
  
              {/* 4️⃣ [결과] Data Scope */}
              <div className="space-y-2 pt-2 border-t border-dashed border-slate-200">
                <span className="text-[10px] font-black text-slate-800 tracking-tighter">4️⃣ [결과] 보이는 화면 (Data Scope)</span>
                <div className="flex gap-1">
                  {['OWN', 'DEPT', 'TOTAL'].map(s => {
                    const isChecked = selectedMenu.view_scopes?.includes(s);
                    return (
                      <label key={s} className={`flex-1 flex items-center justify-center py-2 rounded-lg border text-[10px] font-black cursor-pointer transition-all ${isChecked ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'border-gray-200 text-slate-400 hover:bg-gray-50'}`}>
                        {s === 'OWN' ? '본인 자료' : s === 'DEPT' ? '부서 자료' : '전사 자료'}
                        <input type="checkbox" checked={isChecked || false} onChange={(e) => {
                          const cur = Array.isArray(selectedMenu.view_scopes) ? selectedMenu.view_scopes : [];
                          const next = e.target.checked ? [...cur, s] : cur.filter((k:any) => k !== s);
                          handleUpdate(selectedMenu.id, { view_scopes: next }); setSelectedMenu({...selectedMenu, view_scopes: next});
                        }} className="hidden" />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
  
          </div>
          
          <div className="p-4 bg-gray-50 border-t mt-auto shrink-0 z-10 relative">
            <button onClick={() => setSelectedMenu(null)} className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] shadow-lg active:scale-[0.98] transition-all tracking-widest">SAVE & CLOSE</button>
          </div>
        </div>
      )}
      {selectedMenu && <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-[2px] z-[90]" onClick={() => setSelectedMenu(null)} />}

      {/* 🚀 사이트 편집 모달 (Linked Sites Manager - 타이포그래피 전용 개편) */}
      {isSiteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-6 bg-slate-900 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-blue-400">Linked Sites Manager</h3>
                <p className="text-[10px] text-slate-400 mt-1">홈 화면 하단에 표시될 외부 연동 사이트의 텍스트와 링크를 관리합니다.</p>
              </div>
              <button onClick={() => setIsSiteModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            {/* 💡 [UI 정리 완료] 복잡했던 아이콘/배너 입력 필드를 완전히 제거하고 글자 입력만 남김 */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-slate-50">
              {localSites.map((site: any, index: number) => (
                <div key={index} className="flex gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative group items-end">
                  
                  <div className="w-52 space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Site Name (사이트명)</label>
                    <input type="text" value={site.name || ''} onChange={(e) => {
                      const newSites = [...localSites];
                      newSites[index].name = e.target.value;
                      setLocalSites(newSites);
                    }} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[11px] font-black outline-none focus:border-blue-500 text-slate-800 focus:bg-white transition-all" placeholder="ex) NAVER" />
                  </div>

                  <div className="flex-1 space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">URL (연결 주소)</label>
                    <input type="text" value={site.url || ''} onChange={(e) => {
                      const newSites = [...localSites];
                      newSites[index].url = e.target.value;
                      setLocalSites(newSites);
                    }} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[11px] font-medium outline-none focus:border-blue-500 text-slate-600 focus:bg-white transition-all" placeholder="https://..." />
                  </div>

                  <button onClick={() => {
                    const newSites = localSites.filter((_, i) => i !== index);
                    setLocalSites(newSites);
                  }} className="absolute -top-2 -right-2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-500 hover:text-white font-bold text-xs">
                    ✕
                  </button>
                </div>
              ))}
              
              <button onClick={() => setLocalSites([...localSites, { name: '', url: '', icon: '' }])} className="w-full py-4 border-2 border-dashed border-slate-300 rounded-2xl text-slate-500 font-black text-[11px] hover:border-blue-500 hover:text-blue-500 transition-colors bg-white tracking-widest">
                + 신규 연동 사이트 추가
              </button>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-100 flex justify-end gap-3 shrink-0">
              <button onClick={() => setIsSiteModalOpen(false)} className="px-6 py-2.5 rounded-xl text-[11px] font-black text-slate-500 hover:bg-slate-100 transition-colors">취소</button>
              <button onClick={() => {
                handleConfigUpdate({ linked_sites: localSites });
                setIsSiteModalOpen(false);
              }} className="px-6 py-2.5 rounded-xl text-[11px] font-black bg-blue-600 text-white hover:bg-blue-500 shadow-lg transition-colors">변경사항 저장</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}