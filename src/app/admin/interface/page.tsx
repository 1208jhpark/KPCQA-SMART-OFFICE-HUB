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
  const [tmSearch, setTmSearch] = useState('');
  const [masterSearch, setMasterSearch] = useState('');
  
  const [collapsedParents, setCollapsedParents] = useState<Record<string, boolean>>({});

  const fetchData = async () => {
    try {
      const [mRes, cRes, oRes] = await Promise.all([
        fetch('/api/admin/interface', { cache: 'no-store' }),
        fetch('/api/admin/config', { cache: 'no-store' }),
        fetch('/api/admin/units?active=true', { cache: 'no-store' })
      ]);
      setMenus(await mRes.json()); 
      setConfig(await cRes.json()); 
      setOrgs(await oRes.json());
      
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

  const handleUpdate = async (id: string, payload: any) => {
    try {
      const res = await fetch('/api/admin/interface', { method: 'PATCH', body: JSON.stringify({ id, ...payload }) });
      if (!res.ok) throw new Error('서버 업데이트 실패');
      fetchData();
    } catch (error) {
      console.error("Update Error:", error);
      alert("데이터 저장 중 오류가 발생했습니다.");
    }
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

  const handleUpdateMode = (id: string, mode: 'SIDEBAR' | 'INDEX' | 'DIRECT') => {
    const payload = { entry_sidebar: mode === 'SIDEBAR', entry_index_view: mode === 'INDEX', entry_l4_direct: mode === 'DIRECT' };
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
    await fetch('/api/admin/interface', { 
      method: 'POST', 
      body: JSON.stringify({ level: 1, name: '신규 서비스', path: path, sort_order: nextSort }) 
    });
    fetchData();
  };

  const handleAddSub = async (parentId: string, parentPath: string, level: number) => {
    const newPath = `${parentPath.replace(/\/$/, '')}/sub-${Date.now().toString(36)}`;
    const nextSort = menus.filter(m => m.parent_id === parentId).length + 1;
    try {
      const res = await fetch('/api/admin/interface', { 
        method: 'POST', 
        body: JSON.stringify({ level, name: `신규 L${level} 하위 메뉴`, parent_id: parentId, path: newPath, sort_order: nextSort, entry_sidebar: true }) 
      });
      if (!res.ok) throw new Error('생성 실패');
      setCollapsedParents(prev => ({ ...prev, [parentId]: false }));
      fetchData();
    } catch (error) { alert('생성 오류'); }
  };

  const toggleCollapse = (parentId: string | null) => {
    const key = parentId || 'root';
    setCollapsedParents(prev => ({ ...prev, [key]: !prev[key] }));
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

  const parentsList = activeTab === 1 
    ? [{ id: null, name: 'Root' }] 
    : menus.filter(m => m.level === activeTab - 1).sort((a, b) => {
        const linA = getSortLineage(a.id); const linB = getSortLineage(b.id);
        for (let i = 0; i < Math.max(linA.length, linB.length); i++) {
          const valA = linA[i] || 0; const valB = linB[i] || 0;
          if (valA !== valB) return valA - valB;
        }
        return 0;
      });

  if (loading) return <div className="p-10 text-center font-black text-slate-300">Syncing...</div>;

  return (
    <div className="p-5 space-y-6 bg-gray-50 min-h-screen font-sans text-slate-800 relative">
      
      {/* 🚀 상단 글로벌 설정 배너 */}
      <div className="bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Main Headline</label>
            <input defaultValue={config?.main_headline} onBlur={(e) => fetch('/api/admin/config', {method:'PATCH', body:JSON.stringify({main_headline:e.target.value})})} className="w-full bg-slate-800 rounded-lg p-3 text-sm font-black outline-none border border-slate-700 focus:ring-2 ring-blue-500" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Sub Headline</label>
            <input defaultValue={config?.sub_headline} onBlur={(e) => fetch('/api/admin/config', {method:'PATCH', body:JSON.stringify({sub_headline:e.target.value})})} className="w-full bg-slate-800 rounded-lg p-3 text-xs font-bold text-slate-400 outline-none border border-slate-700 focus:ring-2 ring-blue-500" />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-slate-800 pt-4">
          <div className="flex gap-4 items-center">
            <div className="flex gap-1 bg-slate-800 p-1 rounded-lg">
              {['horizontal', 'vertical'].map(t => (
                <button key={t} onClick={() => fetch('/api/admin/config', {method:'PATCH', body:JSON.stringify({layout_type:t})}).then(fetchData)} className={`px-4 py-1.5 rounded-md text-[10px] font-black ${config?.layout_type === t ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-white'}`}>
                  {t === 'horizontal' ? '가로 그리드' : '세로 리스트'}
                </button>
              ))}
            </div>
          </div>
          {activeTab === 1 && <button onClick={handleAddL1} className="px-5 py-2 bg-blue-600 rounded-xl font-black text-xs hover:bg-blue-500 shadow-lg">+ L1 신규 카드 추가</button>}
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-2 border-b">
        {[1, 2, 3, 4].map(lv => (
          <button key={lv} onClick={() => setActiveTab(lv)} className={`px-8 py-3 text-[11px] font-black border-b-4 transition-all ${activeTab === lv ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>LEVEL {lv}</button>
        ))}
      </div>

      <div className="space-y-6 pb-20">
        {parentsList.map(parent => {
          const children = menus.filter(m => m.level === activeTab && m.parent_id === parent.id).sort((a, b) => a.sort_order - b.sort_order);
          const parentKey = parent.id || 'root';
          const isCollapsed = collapsedParents[parentKey];
          
          return (
            <div key={parentKey} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all hover:shadow-md">
              <div className="bg-slate-50 px-5 py-4 border-b flex justify-between items-center cursor-pointer hover:bg-slate-100" onClick={() => toggleCollapse(parent.id)}>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-black text-blue-500 uppercase tracking-widest shrink-0">PARENT NODE:</span>
                  <span className="text-sm font-black text-slate-800 truncate max-w-2xl">{getBreadcrumbPath(parent.id)}</span>
                  <span className="text-[10px] font-bold text-blue-500 bg-white px-2 py-0.5 rounded-md border shadow-sm ml-2">{children.length} CARDS</span>
                </div>
                <div className="flex items-center gap-2">
                  {parent.id && children.length > 0 && <button onClick={(e) => { e.stopPropagation(); handleSyncChildPaths(parent); }} className="px-3 py-1.5 bg-amber-500 text-white rounded text-[10px] font-black shadow-sm">🔗 하위 경로 동기화</button>}
                  {children.length > 0 && <button onClick={(e) => { e.stopPropagation(); handleResetOrder(children); }} className="px-3 py-1.5 bg-slate-800 rounded text-[10px] font-black text-white shadow-sm">🔄 번호 리셋</button>}
                  {activeTab <= 4 && parent.id && <button onClick={(e) => { e.stopPropagation(); handleAddSub(parent.id, parent.path, activeTab); }} className="px-3 py-1.5 bg-white border border-blue-200 rounded text-[10px] font-black text-blue-600 shadow-sm">+ 하위 생성</button>}
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
                      
                      // 🚀 Global 담당자 실명 표출 로직
                      const globalMasters = m.task_masters?.filter((t: any) => t.scope === 'GLOBAL') || [];
                      const globalDisplay = globalMasters.length > 0 
                        ? (globalMasters.length > 2 
                            ? `${users.find(u => u.email === globalMasters[0].email)?.name || '담당자'} 외 ${globalMasters.length - 1}명`
                            : globalMasters.map((t: any) => users.find(u => u.email === t.email)?.name || t.email).join(', '))
                        : '-';

                      const deptCount = m.task_masters?.filter((t:any)=>t.scope==='DEPT').length || 0;
                      
                      // 🚀 Org 부서 실명 나열 로직
                      const selectedOrgNames = m.org_ids?.map((id: any) => orgs.find((o: any) => o.id === id)?.unit_name).filter(Boolean);
                      const orgDisplay = selectedOrgNames?.length > 0 ? selectedOrgNames.join(', ') : '전체 허용';

                      return (
                        <tr key={m.id} className="hover:bg-blue-50/20 group transition-colors">
                          <td className="p-4 w-20 text-center align-middle border-r border-gray-50 bg-gray-50/30">
                            <input type="number" defaultValue={m.sort_order} onBlur={(e) => handleUpdate(m.id, { sort_order: Number(e.target.value) })} className="w-10 p-1 font-black text-blue-600 bg-white border rounded text-center outline-none focus:ring-2 ring-blue-500" />
                          </td>
                          <td className="p-4 align-top pt-5">
                            <input type="text" defaultValue={m.name} onBlur={(e) => handleUpdate(m.id, { name: e.target.value })} className="font-black text-slate-800 bg-transparent block w-full outline-none focus:text-blue-600 text-sm" />
                            <div className="flex gap-2 text-[10px] text-slate-400 mt-1 font-mono">
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-blue-500 font-bold shrink-0">{m.path}</span>
                              <span className="italic truncate max-w-[300px]">{m.description || '...'}</span>
                            </div>
                            
                            {m.level >= 2 && (
                              <div className="flex items-center gap-1 mt-4 bg-slate-50 p-1 rounded-lg inline-flex border border-slate-100 shadow-inner">
                                <span className="text-[9px] font-black text-slate-500 px-2 uppercase">Action:</span>
                                {[ { id: 'SIDEBAR', label: '하위 사이드바' }, { id: 'INDEX', label: '하위 인덱스뷰' }, { id: 'DIRECT', label: '단일화면 진입' } ].map(mode => {
                                  const isDefault = !m.entry_sidebar && !m.entry_index_view && !m.entry_l4_direct;
                                  const isActive = (mode.id === 'SIDEBAR' && (m.entry_sidebar || isDefault)) || (mode.id === 'INDEX' && m.entry_index_view) || (mode.id === 'DIRECT' && m.entry_l4_direct);
                                  return (
                                    <button key={mode.id} onClick={() => handleUpdateMode(m.id, mode.id as 'SIDEBAR' | 'INDEX' | 'DIRECT')} className={`px-3 py-1 rounded text-[10px] font-black transition-all ${isActive ? 'bg-white text-blue-600 shadow-sm border' : 'text-slate-400'}`}>
                                      {mode.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* 🚀 [최종 정제 요약 줄] */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-bold text-slate-400 mt-4 pt-3 border-t border-slate-50 uppercase tracking-tighter">
                              <span className={`${m.is_master ? 'text-blue-600' : 'text-slate-300'}`}>Master: {m.is_master ? masterName : '-'}</span>
                              <span className="text-slate-200">|</span>
                              <span>Edit: <span className="text-slate-600">{editRoles}</span></span>
                              <span className="text-slate-200">|</span>
                              <span className={globalMasters.length > 0 ? 'text-blue-500' : ''}>Global: {globalDisplay}</span>
                              <span className="text-slate-200">|</span>
                              <span>Dept: <span className="text-slate-600">{deptCount}명</span></span>
                              <span className="text-slate-200">|</span>
                              <span>Access: <span className="text-blue-500">{m.view_scopes?.length ? m.view_scopes.join('/') : '-'}</span></span>
                              <span className="text-slate-200">|</span>
                              <span className="flex items-center gap-1">
                                <span className="text-slate-300">Org:</span>
                                <span className="text-slate-600 truncate max-w-[200px]" title={orgDisplay}>{orgDisplay}</span>
                              </span>
                            </div>
                          </td>
                          <td className="p-4 w-32 text-center align-middle space-x-1">
                            <button onClick={() => handleUpdate(m.id, { is_active: !m.is_active })} className={`px-2.5 py-1 rounded text-[9px] font-black ${m.is_active ? 'bg-green-100 text-green-600' : 'bg-red-50 text-red-400'}`}>{m.is_active ? 'ON' : 'OFF'}</button>
                            <button onClick={() => handleUpdate(m.id, { is_visible: !m.is_visible })} className={`px-2.5 py-1 rounded text-[9px] font-black ${m.is_visible ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>{m.is_visible ? 'SHOW' : 'HIDE'}</button>
                          </td>
                          <td className="p-4 w-36 text-center align-middle space-x-3">
                            <button onClick={() => { setSelectedMenu(m); setTmSearch(''); setMasterSearch(''); }} className="text-[10px] font-black text-slate-400 hover:text-blue-600 underline">상세설정</button>
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

      {/* 🚀 상세설정 드로어 */}
      <div className={`fixed inset-y-0 right-0 w-[450px] bg-white shadow-[-20px_0_60px_rgba(0,0,0,0.1)] z-[100] transform transition-transform duration-300 ${selectedMenu ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}>
        {selectedMenu && (
          <>
            <div className="p-6 bg-slate-900 text-white flex justify-between items-start shrink-0">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-black tracking-widest">{selectedMenu.icon} {selectedMenu.name}</h3>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[9px] text-slate-500 font-black shrink-0">PATH:</span>
                  <input type="text" defaultValue={selectedMenu.path} onBlur={(e) => handleUpdate(selectedMenu.id, { path: e.target.value })} className="bg-slate-800 text-blue-400 text-[10px] font-mono px-2 py-1 rounded w-full outline-none" />
                </div>
              </div>
              <button onClick={() => setSelectedMenu(null)} className="text-2xl font-light hover:rotate-90 transition-all text-slate-500">✕</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex gap-4 border-b border-gray-100 pb-6">
                <div className="space-y-1 w-20 shrink-0">
                  <label className="text-[9px] font-black text-slate-400 uppercase">Icon</label>
                  <input type="text" defaultValue={selectedMenu.icon} onBlur={(e) => handleUpdate(selectedMenu.id, { icon: e.target.value })} className="w-full p-2 bg-gray-50 rounded-xl text-2xl text-center border outline-none" />
                </div>
                <div className="space-y-1 flex-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase">Description</label>
                  <textarea defaultValue={selectedMenu.description} onBlur={(e) => handleUpdate(selectedMenu.id, { description: e.target.value })} className="w-full p-3 bg-gray-50 rounded-xl text-[11px] min-h-[60px] border outline-none whitespace-pre-wrap font-medium" />
                </div>
              </div>

              {/* Master 섹션 */}
              <div className="bg-blue-50/50 p-6 rounded-[2rem] border border-blue-100">
                <h4 className="text-blue-600 font-black text-[11px] mb-4 uppercase tracking-tighter">Master Property 자산 컨트롤러</h4>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input type="checkbox" checked={selectedMenu.is_master} onChange={(e) => handleMasterToggle(selectedMenu, e.target.checked)} className="w-5 h-5 accent-blue-600 rounded-lg" />
                    <span className="text-sm font-black text-slate-700">이 카드를 Master로 지정</span>
                  </label>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Master Editor (데이터 마스터 지정)</label>
                    <div className="relative">
                      <input type="text" value={masterSearch} onChange={(e) => setMasterSearch(e.target.value)} placeholder="마스터 이름 검색..." className="w-full p-3 bg-white border border-blue-100 rounded-xl text-sm font-bold focus:ring-2 ring-blue-500 outline-none transition-all" />
                      {masterSearch && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-blue-200 rounded-xl shadow-2xl max-h-40 overflow-y-auto z-[120]">
                          {users.filter(u => u.name?.includes(masterSearch)).map(u => (
                            <div key={u.id} onClick={() => { handleUpdate(selectedMenu.id, { master_editor_id: u.id }); setSelectedMenu({...selectedMenu, master_editor_id: u.id}); setMasterSearch(''); }} className="p-3 text-xs font-bold hover:bg-blue-50 cursor-pointer border-b last:border-b-0 flex justify-between">
                              <span>{u.name}</span> <span className="text-slate-300 font-medium">{u.email}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedMenu.master_editor_id && (
                      <div className="flex items-center justify-between bg-blue-600 text-white p-3 rounded-xl mt-2 shadow-md">
                        <span className="text-xs font-black">{users.find(u => u.id === selectedMenu.master_editor_id)?.name} (지정됨)</span>
                        <button onClick={() => { handleUpdate(selectedMenu.id, { master_editor_id: null }); setSelectedMenu({...selectedMenu, master_editor_id: null}); }} className="text-xs">✕</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 편집 거버넌스 */}
              <div className="space-y-5">
                <h4 className="text-[11px] font-black text-blue-600 uppercase">EDIT GOVERNANCE 쓰기 권한</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[{id:'LV_2', label:'LV.2 센터장'}, {id:'LV_3', label:'LV.3 일반사원'}].map(role => (
                    <label key={role.id} className={`flex items-center justify-center p-3 rounded-xl border text-[10px] font-bold cursor-pointer transition-all ${selectedMenu.edit_role_ids?.includes(role.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-100 text-slate-500 hover:bg-gray-50'}`}>
                      {role.label}
                      <input type="checkbox" checked={selectedMenu.edit_role_ids?.includes(role.id)} onChange={(e) => {
                        const cur = selectedMenu.edit_role_ids || [];
                        const next = e.target.checked ? [...cur, role.id] : cur.filter((k:any) => k !== role.id);
                        handleUpdate(selectedMenu.id, { edit_role_ids: next }); setSelectedMenu({...selectedMenu, edit_role_ids: next});
                      }} className="hidden" />
                    </label>
                  ))}
                </div>
                <div className="space-y-3">
                  <label className="text-[9px] font-black text-slate-400 uppercase">Task Master (담당자 지정)</label>
                  <div className="relative">
                    <input type="text" value={tmSearch} onChange={(e) => setTmSearch(e.target.value)} className="w-full p-3 bg-blue-50/20 border border-blue-100 rounded-xl text-[11px] font-bold outline-none" placeholder="담당자 검색..." />
                    {tmSearch && (
                      <div className="absolute top-full left-0 right-0 bg-white border rounded-xl shadow-2xl max-h-40 overflow-y-auto z-[110]">
                        {users.filter(u => u.name?.includes(tmSearch)).map(u => (
                          <div key={u.id} onClick={() => {
                            const cur = selectedMenu.task_masters || [];
                            if(!cur.find((item:any) => item.email === u.email)) {
                              const next = [...cur, { email: u.email, scope: 'DEPT' }];
                              handleUpdate(selectedMenu.id, { task_masters: next }); setSelectedMenu({...selectedMenu, task_masters: next});
                            }
                            setTmSearch('');
                          }} className="p-3 text-[11px] font-bold hover:bg-blue-50 cursor-pointer border-b">{u.name} ({u.email})</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 mt-2">
                    {selectedMenu.task_masters?.map((tm: any) => (
                      <div key={tm.email} className="bg-white border border-gray-100 p-3 rounded-xl flex items-center justify-between shadow-sm">
                        <span className="text-[10px] font-black text-slate-800">{users.find(u => u.email === tm.email)?.name || tm.email}</span>
                        <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
                          {['DEPT', 'GLOBAL'].map(sc => (
                            <button key={sc} onClick={() => {
                              const next = selectedMenu.task_masters.map((item:any) => item.email === tm.email ? { ...item, scope: sc } : item);
                              handleUpdate(selectedMenu.id, { task_masters: next }); setSelectedMenu({...selectedMenu, task_masters: next});
                            }} className={`px-2 py-1 rounded text-[9px] font-black transition-all ${tm.scope === sc ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>{sc === 'DEPT' ? '부서' : '전사'}</button>
                          ))}
                          <button onClick={() => {
                            const next = selectedMenu.task_masters.filter((item:any) => item.email !== tm.email);
                            handleUpdate(selectedMenu.id, { task_masters: next }); setSelectedMenu({...selectedMenu, task_masters: next});
                          }} className="px-2 text-red-400">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ACCESS CONTROL */}
              <div className="space-y-5 pt-6 border-t border-gray-100 pb-10">
                <h4 className="text-[11px] font-black text-blue-600 uppercase">ACCESS CONTROL 조회/부서 제한</h4>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">View Scope (조회 범위)</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['OWN', 'DEPT', 'TOTAL'].map(s => (
                        <label key={s} className={`flex items-center justify-center p-3 rounded-xl border text-[10px] font-bold cursor-pointer transition-all ${selectedMenu.view_scopes?.includes(s) ? 'bg-slate-900 border-slate-900 text-white shadow-md' : 'border-gray-100 text-slate-500 hover:bg-gray-50'}`}>
                          {s === 'OWN' ? '본인' : s === 'DEPT' ? '부서' : '전체'}
                          <input type="checkbox" checked={selectedMenu.view_scopes?.includes(s)} onChange={(e) => {
                            const cur = selectedMenu.view_scopes || [];
                            const next = e.target.checked ? [...cur, s] : cur.filter((k:any) => k !== s);
                            handleUpdate(selectedMenu.id, { view_scopes: next }); setSelectedMenu({...selectedMenu, view_scopes: next});
                          }} className="hidden" />
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Org Guard (부서 접근제한)</label>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {orgs.map(org => (
                        <label key={org.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${selectedMenu.org_ids?.includes(org.id) ? 'bg-indigo-50 border-indigo-200 text-indigo-900' : 'bg-white border-gray-100 text-slate-500 hover:bg-gray-50'}`}>
                          <span className="text-[10px] font-bold">{org.unit_name}</span>
                          <input type="checkbox" checked={selectedMenu.org_ids?.includes(org.id)} onChange={(e) => {
                            const next = e.target.checked ? [...(selectedMenu.org_ids || []), org.id] : selectedMenu.org_ids.filter((id:any) => id !== org.id);
                            handleUpdate(selectedMenu.id, { org_ids: next }); setSelectedMenu({...selectedMenu, org_ids: next});
                          }} className="w-4 h-4 accent-indigo-600 rounded" />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-6 bg-gray-50 border-t mt-auto shrink-0">
              <button onClick={() => setSelectedMenu(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs shadow-xl active:scale-[0.98] transition-all tracking-[0.2em]">SAVE & CLOSE</button>
            </div>
          </>
        )}
      </div>
      {selectedMenu && <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-[2px] z-[90]" onClick={() => setSelectedMenu(null)} />}
    </div>
  );
}