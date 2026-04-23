'use client';

import { useEffect, useState } from 'react';

// 🚨 상태 관리에 sort_order 추가 (DB 스키마와 일치)
interface CodeItem {
  id: string;
  sort_order: number;
  label: string;
  orgs: string[];
  min_qty: number | string | null;
  unit: string;
  price: number | string | null;
  vendor: string;
  is_active: boolean;
  is_visible: boolean;
  is_archived: boolean;
  in_use: boolean;
}

interface GroupItem {
  id: string;
  name: string;
  description: string;
  sort_order: number; // 🚨 그룹 정렬을 위해 추가
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

  // 🚀 데이터 초기 로드 및 조직 정보 호출
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [uRes, mRes] = await Promise.all([
          fetch('/api/admin/units?active=true'),
          fetch('/api/admin/master-data') // 실제 DB 데이터 호출
        ]);
        
        if (uRes.ok) setOrgs(await uRes.json());
        if (mRes.ok) {
          const data = await mRes.json();
          if (data && data.length > 0) {
            setGroups(data);
          } else {
            setGroups([
              { id: 'GRP_1_SUPPLY', name: '소모품(경영)', description: '경영지원본부 소모품 마스터', sort_order: 1, is_active: true, codes: [] },
              { id: 'GRP_2_MKT', name: '마케팅물품', description: '홍보 및 이벤트용 물품', sort_order: 2, is_active: true, codes: [] }
            ]);
          }
        }
      } catch (error) {
        console.error("Data Fetch Error");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleGlobalSave = async () => {
    try {
      const res = await fetch('/api/admin/master-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groups),
      });
      if (res.ok) alert("✅ 모든 마스터 데이터가 DB에 성공적으로 저장되었습니다.");
      else alert("❌ 저장 실패: 서버 오류가 발생했습니다.");
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
    const currentCodes = newGroups[activeGroupIndex].codes;
    const nextSort = currentCodes.length > 0 ? Math.max(...currentCodes.map(c => c.sort_order)) + 1 : 1;
    currentCodes.push({ id: `NEW_${Date.now()}`, sort_order: nextSort, label: '', orgs: ['전체'], min_qty: '', unit: '', price: '', vendor: '', is_active: true, is_visible: true, is_archived: false, in_use: false });
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
    if(!confirm("이 항목을 미사용 보관함으로 이동하시겠습니까?")) return;
    handleUpdateCode(groupIndex, codeIndex, 'is_archived', true);
  };

  const handleRestore = (groupIndex: number, codeIndex: number) => {
    handleUpdateCode(groupIndex, codeIndex, 'is_archived', false);
  };

  const handleDelete = (groupIndex: number, codeIndex: number) => {
    if(!confirm("영구 삭제하시겠습니까?")) return;
    const newGroups = [...groups];
    newGroups[groupIndex].codes.splice(codeIndex, 1);
    setGroups(newGroups);
  };

  const formatNumber = (val: any) => {
    if (!val && val !== 0) return '';
    return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  const sortedGroups = [...groups].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const allFilteredCodes = activeGroup?.codes.filter(c => c.label.includes(searchQuery) || (c.vendor && c.vendor.includes(searchQuery))).sort((a, b) => a.sort_order - b.sort_order) || [];
  const activeCodes = allFilteredCodes.filter(c => !c.is_archived);
  const archivedCodes = allFilteredCodes.filter(c => c.is_archived);

  if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Syncing Master Hub...</div>;

  return (
    <div className="p-5 min-h-screen bg-gray-50 font-sans text-slate-800 flex flex-col h-screen overflow-hidden" onClick={() => setOpenOrgDropdownId(null)}>
      
      {/* 헤더 배너 */}
      <div className="bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl mb-6 shrink-0 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-black tracking-tight flex items-center gap-2"><span className="text-blue-400">04.</span> Master Data Engine</h1>
          <p className="text-[11px] text-slate-400 mt-1">시스템 전반의 드롭다운 리스트 및 기초 자산 메타 정보를 관리합니다.</p>
        </div>
        <button onClick={handleGlobalSave} className="px-5 py-2 bg-blue-600 text-white rounded-xl text-xs font-black shadow-lg hover:bg-blue-500 transition-all">
          💾 전체 데이터 저장
        </button>
      </div>

      <div className="flex gap-6 flex-1 overflow-hidden pb-5">
        
        {/* 🚀 좌측 패널 (높이 50% 축소 및 단일 행 가독성 강화) */}
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

        {/* 🚀 우측 패널 (기존 모든 기능 및 디자인 100% 유지) */}
        <div className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-sm flex flex-col overflow-hidden relative">
          {activeGroup ? (
            <>
              <div className="p-5 border-b border-gray-100 bg-slate-50 shrink-0 flex gap-4 items-center">
                <div className="flex-1 space-y-1">
                  <input type="text" value={activeGroup.name} onChange={(e) => handleUpdateGroup('name', e.target.value)} className="text-lg font-black text-slate-800 bg-transparent outline-none w-full border-b border-dashed border-transparent hover:border-gray-300 focus:border-blue-500 px-1 py-0.5 transition-all" />
                  <input type="text" value={activeGroup.description} onChange={(e) => handleUpdateGroup('description', e.target.value)} className="text-[10px] font-mono text-slate-400 bg-transparent outline-none w-full border-b border-dashed border-transparent hover:border-gray-300 focus:border-blue-500 px-1 py-0.5 transition-all" />
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleToggleGroup(activeGroupIndex)}
                    className={`px-3 py-2.5 rounded-xl text-[11px] font-black shadow-sm transition-all ${activeGroup.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
                  >
                    그룹 {activeGroup.is_active ? '활성 (ON)' : '비활성 (OFF)'}
                  </button>
                  <input type="text" placeholder="검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-40 bg-white border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold outline-none focus:ring-2 ring-blue-500 shadow-inner" />
                  <button onClick={handleAddCode} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-lg hover:bg-slate-800 active:scale-95 transition-all">+ 항목 추가</button>
                </div>
              </div>

              <div className="flex-1 overflow-auto bg-white scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-gray-50 pb-10">
                <table className="w-full text-left text-[11px] min-w-[1200px]">
                  <thead className="bg-slate-50 text-slate-400 font-black tracking-widest text-[9px] sticky top-0 z-10 shadow-sm border-b border-gray-200">
                    <tr>
                      <th className="p-3 text-center w-12">순서</th>
                      <th className="p-3 w-56 border-l border-gray-100">드롭다운 옵션</th>
                      <th className="p-3 w-40 border-l border-gray-100 text-center">노출조직</th>
                      <th className="p-3 w-20 border-l border-gray-100 text-right">최저재고</th>
                      <th className="p-3 w-24 border-l border-gray-100 text-center">단위(Unit)</th>
                      <th className="p-3 w-28 border-l border-gray-100 text-right">기준단가(원)</th>
                      <th className="p-3 w-28 border-l border-gray-100 text-center">공급처</th>
                      <th className="p-3 w-48 border-l border-gray-100 text-center sticky right-0 bg-slate-50">제어 및 상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeCodes.map((code) => {
                      const originalIndex = activeGroup.codes.findIndex(c => c.id === code.id);
                      return (
                        <tr key={code.id} className="hover:bg-blue-50/20 transition-all">
                          <td className="p-2 text-center">
                            <input type="number" value={code.sort_order} onChange={(e) => handleUpdateCode(activeGroupIndex, originalIndex, 'sort_order', Number(e.target.value))} className="w-10 p-1.5 font-black text-blue-600 bg-gray-50 border border-gray-200 rounded text-center outline-none focus:bg-white" />
                          </td>
                          <td className="p-2 border-l border-gray-50">
                            <input type="text" value={code.label} onChange={(e) => handleUpdateCode(activeGroupIndex, originalIndex, 'label', e.target.value)} className="font-black text-sm text-slate-800 bg-transparent w-full outline-none focus:bg-white focus:ring-1 ring-blue-300 rounded p-1.5" />
                          </td>
                          <td className="p-2 border-l border-gray-50 text-center relative">
                            <button onClick={(e) => { e.stopPropagation(); setOpenOrgDropdownId(openOrgDropdownId === code.id ? null : code.id); }} className="w-full px-2 py-1.5 text-[10px] font-bold rounded truncate flex items-center justify-between border bg-slate-50 border-gray-200 text-slate-600 hover:bg-slate-100">
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
                          <td className="p-2 border-l border-gray-50 text-right">
                            <input type="text" value={code.min_qty === null ? '' : code.min_qty} onChange={(e) => handleUpdateCode(activeGroupIndex, originalIndex, 'min_qty', e.target.value)} className="font-mono font-bold text-slate-600 bg-transparent w-full text-right outline-none" />
                          </td>
                          <td className="p-2 border-l border-gray-50 text-center">
                            <input type="text" value={code.unit} onChange={(e) => handleUpdateCode(activeGroupIndex, originalIndex, 'unit', e.target.value)} className="font-bold text-indigo-600 bg-transparent w-full text-center outline-none" />
                          </td>
                          <td className="p-2 border-l border-gray-50 text-right">
                            <div className="flex items-center bg-emerald-50/50 rounded px-1.5 focus-within:bg-white focus-within:ring-1 ring-emerald-300">
                              <input type="text" value={code.price === null ? '' : formatNumber(code.price)} onChange={(e) => { const raw = e.target.value.replace(/,/g, ""); if (!isNaN(Number(raw)) || raw === "") handleUpdateCode(activeGroupIndex, originalIndex, 'price', raw === "" ? null : Number(raw)); }} className="font-mono font-black text-emerald-600 bg-transparent w-full text-right outline-none p-1.5" />
                              <span className="text-[10px] font-bold text-emerald-400 ml-1">원</span>
                            </div>
                          </td>
                          <td className="p-2 border-l border-gray-50 text-center">
                            <input type="text" value={code.vendor} onChange={(e) => handleUpdateCode(activeGroupIndex, originalIndex, 'vendor', e.target.value)} className="font-bold text-slate-600 bg-transparent w-full text-center outline-none" />
                          </td>
                          <td className="p-2 border-l border-gray-50 text-center sticky right-0 bg-white shadow-[-5px_0_10px_rgba(0,0,0,0.02)]">
                            <div className="flex justify-center gap-1">
                              <button onClick={() => handleUpdateCode(activeGroupIndex, originalIndex, 'is_active', !code.is_active)} className={`px-2 py-1.5 rounded w-11 text-[9px] font-black transition-all ${code.is_active ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>{code.is_active ? '활성' : '비활성'}</button>
                              <button onClick={() => handleUpdateCode(activeGroupIndex, originalIndex, 'is_visible', !code.is_visible)} className={`px-2 py-1.5 rounded w-11 text-[9px] font-black transition-all ${code.is_visible ? 'bg-indigo-100 text-indigo-600' : 'bg-red-50 text-red-400'}`}>{code.is_visible ? '보이기' : '숨기기'}</button>
                              <div className="w-[1px] h-6 bg-gray-200 mx-1"></div>
                              {code.in_use ? (
                                <button onClick={() => handleArchive(activeGroupIndex, originalIndex)} className="px-2 py-1.5 rounded w-11 text-[9px] font-black bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200">보관</button>
                              ) : (
                                <button onClick={() => handleDelete(activeGroupIndex, originalIndex)} className="px-2 py-1.5 rounded w-11 text-[9px] font-black bg-red-50 text-red-500 hover:bg-red-500 hover:text-white border border-red-200 transition-colors">삭제</button>
                              )}
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
                                  <div>
                                    <p className="text-xs font-black text-slate-700 line-through decoration-slate-300">{code.label}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5 font-mono">단위: {code.unit || '-'} | 단가: {code.price ? formatNumber(code.price) : '-'}원 | 공급처: {code.vendor || '-'}</p>
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
          ) : null}
        </div>
      </div>
    </div>
  );
}