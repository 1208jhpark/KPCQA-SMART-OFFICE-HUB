'use client';
     
import { useEffect, useState } from 'react';
     
interface CodeItem {
  id: string;
  sort_order: number;
  label: string;
  orgs: string[];
  is_active: boolean;
  is_visible: boolean;
  is_archived: boolean;
  in_use: boolean;
  updatedAt?: string; // 🚀 날짜 표시를 위한 필드 추가 (DB에 있을 경우)
}
     
interface GroupItem {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  codes: CodeItem[];
}
     
export default function MasterDataPage() {
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [openOrgDropdownId, setOpenOrgDropdownId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [orgs, setOrgs] = useState<any[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  
  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [uRes, mRes] = await Promise.all([
        fetch('/api/admin/units?active=true'),
        fetch('/api/admin/master-data') 
      ]);
      
      if (uRes.ok) setOrgs(await uRes.json());
      if (mRes.ok) {
        const data = await mRes.json();
        if (data && data.length > 0) {
          setGroups(data);
        } else {
          setGroups([]);
        }
      }
    } catch (error) {
      console.error("Data Fetch Error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);
  
  const handleGlobalSave = async () => {
    try {
      const res = await fetch('/api/admin/master-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groups),
      });
      if (res.ok) {
        alert("✅ 모든 드롭다운 마스터 데이터가 성공적으로 저장되었습니다.");
        await fetchAllData(); 
      } else {
        alert("❌ 저장 실패: 서버 오류가 발생했습니다.");
      }
    } catch (e) {
      alert("❌ 저장 실패: 네트워크 연결을 확인하세요.");
    }
  };
  
  const activeGroup = groups[activeGroupIndex];
  
  const handleAddGroup = () => {
    const nextId = `GRP_NEW_${Date.now()}`;
    const nextSort = groups.length > 0 ? Math.max(...groups.map(g => g.sort_order || 0)) + 1 : 1;
    setGroups([...groups, { id: nextId, name: '신규 마스터 그룹', description: '설명을 입력하세요', sort_order: nextSort, is_active: true, codes: [] }]);
    setActiveGroupIndex(groups.length);
  };

  const handleDeleteGroup = async (groupId: string, index: number) => {
    if (!confirm("⚠️ 정말 이 그룹을 삭제하시겠습니까?\n(설정 메뉴에 연동되어 있다면 삭제가 거부됩니다.)")) return;
    
    if (groupId.startsWith('GRP_NEW_')) {
      const newGroups = groups.filter((_, i) => i !== index);
      setGroups(newGroups);
      setActiveGroupIndex(Math.max(0, index - 1));
      return;
    }

    try {
      const res = await fetch(`/api/admin/master-data?groupId=${groupId}`, { method: 'DELETE' });
      if (res.ok) {
        const newGroups = groups.filter((_, i) => i !== index);
        setGroups(newGroups);
        setActiveGroupIndex(Math.max(0, index - 1));
        alert("🗑️ 그룹이 삭제되었습니다.");
      } else {
        // 🚀 서버에서 넘겨준 거부 메시지 표출
        const err = await res.json();
        alert(`🚫 삭제 불가: ${err.error}`);
      }
    } catch(e) {
      alert("오류가 발생했습니다.");
    }
  };
  
  const handleUpdateGroup = (field: keyof GroupItem, value: any) => {
    const newGroups = [...groups];
    (newGroups[activeGroupIndex] as any)[field] = value;
    setGroups(newGroups);
  };
  
  const handleToggleGroup = (index: number) => {
    const newGroups = [...groups];
    newGroups[index].is_active = !newGroups[index].is_active;
    setGroups(newGroups);
  };
  
  const handleUpdateCode = (groupIndex: number, codeIndex: number, field: keyof CodeItem, value: any) => {
    const newGroups = [...groups];
    (newGroups[groupIndex].codes[codeIndex] as any)[field] = value;
    setGroups(newGroups);
  };
  
  const handleAddCode = () => {
    const newGroups = [...groups];
    const currentCodes = newGroups[activeGroupIndex].codes || [];
    const nextSort = currentCodes.length > 0 ? Math.max(...currentCodes.map(c => c.sort_order)) + 1 : 1;
    
    newGroups[activeGroupIndex].codes = [
      ...currentCodes,
      { id: `NEW_${Date.now()}`, sort_order: nextSort, label: '', orgs: ['전체'], is_active: true, is_visible: true, is_archived: false, in_use: false }
    ];
    setGroups(newGroups);
  };
  
  const handleToggleOrg = (groupIndex: number, codeIndex: number, orgName: string) => {
    const newGroups = [...groups];
    const code = newGroups[groupIndex].codes[codeIndex];
    if (orgName === '전체') { 
      code.orgs = ['전체']; 
    } else {
      let currentOrgs = code.orgs.filter(o => o !== '전체'); 
      if (currentOrgs.includes(orgName)) { 
        currentOrgs = currentOrgs.filter(o => o !== orgName); 
      } else { 
        currentOrgs.push(orgName); 
      }
      code.orgs = currentOrgs.length === 0 ? ['전체'] : currentOrgs;
    }
    setGroups(newGroups);
  };
  
  const handleArchive = (groupIndex: number, codeIndex: number) => {
    if(!confirm("이 항목을 미사용 보관함으로 이동하시겠습니까? (기존 신청 이력은 유지됩니다)")) return;
    
    const newGroups = [...groups];
    const code = newGroups[groupIndex].codes[codeIndex];
    
    code.is_archived = true;
    code.updatedAt = new Date().toISOString(); // 🚀 보관 버튼을 누른 '현재 시간'을 주입!
    
    setGroups(newGroups);
  };
  
  const handleRestore = (groupIndex: number, codeIndex: number) => {
    const newGroups = [...groups];
    const code = newGroups[groupIndex].codes[codeIndex];
    
    code.is_archived = false;
    code.updatedAt = new Date().toISOString(); // 🚀 복원할 때도 시간을 업데이트해 줍니다.
    
    setGroups(newGroups);
  };
  
  const handleDelete = (groupIndex: number, codeIndex: number) => {
    if(!confirm("⚠️ 영구 삭제하시겠습니까? (사용 이력이 없는 경우에만 권장합니다)")) return;
    const newGroups = [...groups];
    newGroups[groupIndex].codes.splice(codeIndex, 1);
    setGroups(newGroups);
  };
  
  const sortedGroups = [...groups].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  
  const rawCodes = activeGroup?.codes || [];
  const allFilteredCodes = [...rawCodes]
    .filter(c => c.label.includes(searchQuery))
    .sort((a, b) => a.sort_order - b.sort_order);
    
  const activeCodes = allFilteredCodes.filter(c => !c.is_archived);
  const archivedCodes = allFilteredCodes.filter(c => c.is_archived);
  
  if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Syncing Master Hub...</div>;
  
  return (
    <div className="p-5 min-h-screen bg-gray-50 font-sans text-slate-800 flex flex-col h-screen overflow-hidden" onClick={() => setOpenOrgDropdownId(null)}>
      
      {/* 헤더 배너 */}
      <div className="bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl mb-6 shrink-0 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-black tracking-tight flex items-center gap-2"><span className="text-blue-400">04.</span> Master Data Engine</h1>
          <p className="text-[11px] text-slate-400 mt-1">시스템 전반의 드롭다운 리스트를 중앙 제어합니다. 
            <br /> 변경 후 <span className="text-blue-400 font-black"> "전체 데이터 저장" </span>을 눌러 변경사항을 저장하세요. 
            <br /> <span className="text-amber-500 font-black"> 항목 문구를 변경하면 과거 기록 데이터도 함께 변경되니 주의하세요. </span>
            <br /> 더이상 사용하지 않는 항목은 미사용 보관함 (Archive)으로 이동하세요. (복원 버튼을 눌러 원래 위치로 복원할 수 있습니다.)
          </p>
        </div>
        <button onClick={handleGlobalSave} className="px-5 py-2 bg-blue-600 text-white rounded-xl text-xs font-black shadow-lg hover:bg-blue-500 transition-all">
          💾 전체 데이터 저장
        </button>
      </div>
  
      <div className="flex gap-6 flex-1 overflow-hidden pb-5">
        
        {/* 좌측 패널 */}
        <div className="w-[240px] shrink-0 bg-white rounded-3xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-slate-50 shrink-0">
            <h2 className="text-[9px] font-black text-slate-400 tracking-widest uppercase">Select Group</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {sortedGroups.map((grp) => {
              const originalIndex = groups.findIndex(g => g.id === grp.id);
              const isActive = activeGroupIndex === originalIndex;
              return (
                <div 
                  key={grp.id} 
                  onClick={() => setActiveGroupIndex(originalIndex)} 
                  className={`flex items-center gap-2 p-1.5 px-2.5 rounded-lg cursor-pointer transition-all border ${isActive ? 'bg-slate-800 border-slate-800 text-white shadow-md' : 'bg-white border-transparent hover:bg-slate-50'}`}
                >
                  <input 
                    type="number" 
                    value={grp.sort_order || 0} 
                    onChange={(e) => {
                      const next = [...groups];
                      next[originalIndex].sort_order = Number(e.target.value);
                      setGroups(next);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`w-7 bg-transparent text-[10px] font-black border-b border-transparent focus:border-blue-500 outline-none ${isActive ? 'text-blue-400' : 'text-slate-400'}`} 
                  />
                  <h3 className={`text-[11px] font-black truncate flex-1 ${isActive ? 'text-white' : 'text-slate-700'}`} title={grp.name}>
                    {grp.name}
                  </h3>
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${grp.is_active ? 'bg-green-400' : 'bg-slate-200'}`}></div>
                </div>
              );
            })}
          </div>
          <div className="p-2 bg-slate-50 border-t">
            <button onClick={handleAddGroup} className="w-full py-2 bg-white border border-dashed border-gray-200 rounded-xl text-[10px] font-black text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-all">+ 그룹 추가</button>
          </div>
        </div>
  
        {/* 우측 패널 */}
        <div className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-sm flex flex-col overflow-hidden relative">
          {activeGroup ? (
            <>
              <div className="p-5 border-b border-gray-100 bg-slate-50 shrink-0 flex gap-4 items-center">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-3">
                    <input type="text" value={activeGroup.name || ''} onChange={(e) => handleUpdateGroup('name', e.target.value)} className="text-lg font-black text-slate-800 bg-transparent outline-none border-b border-dashed border-transparent hover:border-gray-300 focus:border-blue-500 px-1 py-0.5 transition-all" />
                  </div>
                  <input 
                    type="text" 
                    value={activeGroup.description || ''} 
                    onChange={(e) => handleUpdateGroup('description', e.target.value)} 
                    placeholder="그룹 설명을 입력하세요"
                    className="text-[10px] font-mono text-slate-400 bg-transparent outline-none w-full border-b border-dashed border-transparent hover:border-gray-300 focus:border-blue-500 px-1 py-0.5 transition-all" 
                  />
                </div>
                <div className="flex items-center gap-2">
                  {/* 🚀 삭제 버튼을 그룹 활성 버튼 좌측으로 이동 */}
                  <button onClick={() => handleDeleteGroup(activeGroup.id, activeGroupIndex)} className="px-3 py-2.5 rounded-xl text-[11px] font-black shadow-sm transition-all bg-red-50 text-red-500 border border-red-100 hover:bg-red-100">
                    🗑️ 그룹 삭제
                  </button>
                  <button 
                    onClick={() => handleToggleGroup(activeGroupIndex)}
                    className={`px-3 py-2.5 rounded-xl text-[11px] font-black shadow-sm transition-all ${activeGroup.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
                  >
                    그룹 {activeGroup.is_active ? '활성 (ON)' : '비활성 (OFF)'}
                  </button>
                  <input type="text" placeholder="옵션 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-40 bg-white border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold outline-none focus:ring-2 ring-blue-500 shadow-inner" />
                  <button onClick={handleAddCode} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-lg hover:bg-slate-800 active:scale-95 transition-all">+ 항목 추가</button>
                </div>
              </div>
  
              <div className="flex-1 overflow-auto bg-white scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-gray-50 pb-10">
                <table className="w-full text-left text-[11px] min-w-[800px]">
                  <thead className="bg-slate-50 text-slate-400 font-black tracking-widest text-[9px] sticky top-0 z-10 shadow-sm border-b border-gray-200">
                    <tr>
                      <th className="p-3 text-center w-16">순서</th>
                      <th className="p-3 border-l border-gray-100">드롭다운 옵션명 (Label)</th>
                      <th className="p-3 w-48 border-l border-gray-100 text-center">노출 조직 권한</th>
                      <th className="p-3 w-64 border-l border-gray-100 text-center sticky right-0 bg-slate-50">제어 및 상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeCodes.map((code) => {
                      const originalIndex = activeGroup.codes.findIndex(c => c.id === code.id);
                      return (
                        <tr key={code.id} className="hover:bg-blue-50/20 transition-all h-12">
                          <td className="p-2 text-center">
                            <input type="number" value={code.sort_order} onChange={(e) => handleUpdateCode(activeGroupIndex, originalIndex, 'sort_order', Number(e.target.value))} className="w-12 p-1.5 font-black text-blue-600 bg-gray-50 border border-gray-200 rounded text-center outline-none focus:bg-white" />
                          </td>
                          <td className="p-2 border-l border-gray-50">
                            <input type="text" placeholder="예: A4 용지, 모니터..." value={code.label || ''} onChange={(e) => handleUpdateCode(activeGroupIndex, originalIndex, 'label', e.target.value)} className="font-black text-sm text-slate-800 bg-transparent w-full outline-none focus:bg-white focus:ring-1 ring-blue-300 rounded p-1.5" />
                          </td>
                          <td className="p-2 border-l border-gray-50 text-center relative">
                            <button onClick={(e) => { e.stopPropagation(); setOpenOrgDropdownId(openOrgDropdownId === code.id ? null : code.id); }} className="w-full px-3 py-2 text-[11px] font-bold rounded truncate flex items-center justify-between border bg-white border-gray-200 text-slate-600 hover:bg-slate-50">
                              <span className="truncate">{code.orgs.join(', ')}</span><span className="text-[8px] opacity-50 ml-1">▼</span>
                            </button>
                            {openOrgDropdownId === code.id && (
                              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-48 bg-white border border-gray-200 shadow-xl rounded-xl p-2 z-[99]" onClick={(e) => e.stopPropagation()}>
                                <label className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer border-b mb-1">
                                  <input type="checkbox" checked={code.orgs.includes('전체')} onChange={() => handleToggleOrg(activeGroupIndex, originalIndex, '전체')} className="accent-blue-600 w-3 h-3" />
                                  <span className="text-[11px] font-black">전체</span>
                                </label>
                                {orgs.map(org => (
                                  <label key={org.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                                    <input type="checkbox" checked={code.orgs.includes(org.unit_name)} onChange={() => handleToggleOrg(activeGroupIndex, originalIndex, org.unit_name)} className="accent-blue-600 w-3 h-3" />
                                    <span className="text-[10px] font-bold text-slate-600">{org.unit_name}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="p-2 border-l border-gray-50 text-center sticky right-0 bg-white shadow-[-5px_0_10px_rgba(0,0,0,0.02)]">
                            {/* 🚀 제어 버튼 공간 넉넉하게 재배치 및 상시 노출 */}
                            <div className="flex justify-center items-center gap-1.5">
                              <button onClick={() => handleUpdateCode(activeGroupIndex, originalIndex, 'is_active', !code.is_active)} className={`w-[48px] py-1.5 rounded-md text-[10px] font-black transition-all ${code.is_active ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>{code.is_active ? '활성' : '비활성'}</button>
                              <button onClick={() => handleUpdateCode(activeGroupIndex, originalIndex, 'is_visible', !code.is_visible)} className={`w-[48px] py-1.5 rounded-md text-[10px] font-black transition-all ${code.is_visible ? 'bg-indigo-100 text-indigo-600' : 'bg-red-50 text-red-400'}`}>{code.is_visible ? '보이기' : '숨기기'}</button>
                              <div className="w-[1px] h-4 bg-gray-200 mx-1"></div>
                              <button onClick={() => handleArchive(activeGroupIndex, originalIndex)} className="w-[48px] py-1.5 rounded-md text-[10px] font-black bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 transition-colors">보관</button>
                              <button onClick={() => handleDelete(activeGroupIndex, originalIndex)} className="w-[48px] py-1.5 rounded-md text-[10px] font-black bg-red-50 text-red-500 hover:bg-red-500 hover:text-white border border-red-200 transition-colors">삭제</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
  
                <div className="mt-8 mx-5 border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div onClick={() => setIsArchiveOpen(!isArchiveOpen)} className="bg-slate-100 p-4 flex justify-between items-center cursor-pointer hover:bg-slate-200 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{isArchiveOpen ? '📂' : '📁'}</span>
                      <h3 className="text-sm font-black text-slate-600">미사용 보관함 (Archive)</h3>
                      <span className="bg-slate-300 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full">{archivedCodes.length}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-400">{isArchiveOpen ? '접기 ▲' : '펼치기 ▼'}</span>
                  </div>
                  {isArchiveOpen && (
                    <div className="bg-slate-50 border-t border-slate-200 p-5">
                      {archivedCodes.length === 0 ? (
                        <p className="text-center text-slate-400 text-xs font-bold p-5">보관된 항목이 없습니다.</p>
                      ) : (
                        <div className="space-y-2">
                          {archivedCodes.map(code => {
                             const originalIndex = activeGroup.codes.findIndex(c => c.id === code.id);
                             return (
                              <div key={code.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 opacity-70 hover:opacity-100 transition-opacity">
                                <div className="flex items-center gap-4">
                                  <span className="bg-slate-200 text-slate-500 text-[9px] font-black px-2 py-1 rounded">보관됨</span>
                                  <div className="flex flex-col">
                                    <p className="text-sm font-black text-slate-700 line-through decoration-slate-300">{code.label}</p>
                                    {/* 🚀 보관 처리된 일시 표시 (DB의 updatedAt 활용) */}
                                    <p className="text-[9px] text-slate-400 mt-0.5 font-mono">
  최종 상태 변경일: {code.updatedAt ? new Date(code.updatedAt).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }) : '날짜 정보 없음'}
</p>
                                  </div>
                                </div>
                                <button onClick={() => handleRestore(activeGroupIndex, originalIndex)} className="px-4 py-2 bg-white border-2 border-blue-500 text-blue-600 rounded-lg text-[10px] font-black shadow-sm hover:bg-blue-50 transition-all">↺ 메인으로 복원</button>
                              </div>
                             )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
             <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-4">
                <div className="text-4xl">📁</div>
                <p className="text-sm font-bold">좌측에서 그룹을 선택하거나 새 그룹을 추가해주세요.</p>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}