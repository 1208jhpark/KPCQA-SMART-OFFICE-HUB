'use client';

import React, { useState, useEffect, useMemo } from 'react';

export default function ClientSearchModule() {
  const [clients, setClients] = useState<any[]>([]);
  const [masterCategories, setMasterCategories] = useState<string[]>([]);
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 숨겨진 부서를 목록에 표시할지 여부
  const [showHiddenDepts, setShowHiddenDepts] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // 상세 이력 모달 상태
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; clientName: string; deptName: string; list: any[] }>({
    isOpen: false, clientName: '', deptName: '', list: []
  });

  // 고객사 마스터 등록/수정 모달 상태
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', location: '', category: '' });

  // 부서 추가/수정 모달 상태
  const [deptModal, setDeptModal] = useState<{ isOpen: boolean; client: any; deptIndex: number | null; name: string }>({
    isOpen: false, client: null, deptIndex: null, name: ''
  });

  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  useEffect(() => { fetchClients(); }, []);

  // 🚀 데이터 통합 로드 (고객사 + 어드민 마스터 데이터 + 시스템 설정)
  const fetchClients = async () => {
    try {
      const [cRes, mRes, sysRes] = await Promise.all([
        fetch('/api/marketing/clients'),
        fetch('/api/admin/master-data'),
        fetch('/api/admin/config')
      ]);

      if (cRes.ok) setClients(await cRes.json());
      
      let configData = null;
      if (sysRes.ok) {
        configData = await sysRes.json();
        setSystemConfig(configData);
      }

      if (mRes.ok && configData?.client_category_group) {
        const masterData = await mRes.json();
        // Settings에서 지정한 그룹 ID로 업무범주 목록 필터링
        const categoryGroup = masterData.find((g: any) => g.id === configData.client_category_group);
        
        if (categoryGroup && categoryGroup.codes) {
          const activeCodes = categoryGroup.codes
            .filter((c: any) => c.is_active && !c.is_archived)
            .sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((c: any) => c.label);
          setMasterCategories(activeCodes);
        }
      }
    } catch(e) { 
      console.error("Data Fetch Error:", e); 
    }
    setLoading(false);
  };

  // 부서 정렬: "전사" 무조건 최상단
  const getNormalizedSortedDepts = (departments: any) => {
    if (!Array.isArray(departments)) return [];
    const depts = departments.map(d => typeof d === 'string' ? { name: d, is_hidden: false } : d);
    
    return depts.sort((a, b) => {
      if (a.name === "전사") return -1;
      if (b.name === "전사") return 1;
      return a.name.localeCompare(b.name, 'ko');
    });
  };

  // 상단 필터용 유니크 업무범주 (DB에 이미 등록된 데이터 기준)
  const uniqueCategories = useMemo(() => {
    const categories = clients.map(c => c.category).filter(Boolean);
    return Array.from(new Set(categories)).sort();
  }, [clients]);

  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const matchCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
      const matchSearch = !searchQuery || 
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (c.location && c.location.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.category && c.category.toLowerCase().includes(searchQuery.toLowerCase()));
        
      return matchCategory && matchSearch;
    });
  }, [clients, searchQuery, selectedCategory]);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / itemsPerPage));
  const paginatedClients = filteredClients.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedClients);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedClients(next);
  };

  // 🚀 상세 이력 조회 (물품 신청일 createdAt 기준)
  const openHistory = (clientName: string, deptName: string, distributions: any[]) => {
    const filtered = distributions
      .filter(d => d.client_dept === deptName && new Date(d.createdAt).getFullYear() === currentYear)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); 
    
    setHistoryModal({ isOpen: true, clientName, deptName, list: filtered });
  };

  const handleSaveDept = async () => {
    if (!deptModal.name.trim()) return alert("부서명을 입력하세요.");
    const { client, deptIndex, name } = deptModal;
    let depts = getNormalizedSortedDepts(client.departments);
    let oldName = '';
    if (deptIndex !== null) {
      oldName = depts[deptIndex].name;
      depts[deptIndex].name = name;
    } else {
      if (depts.some(d => d.name === name)) return alert("이미 존재하는 부서명입니다.");
      depts.push({ name, is_hidden: false });
    }
    const res = await fetch('/api/marketing/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: client.id, departments: depts, oldDeptName: oldName || undefined, newDeptName: oldName ? name : undefined })
    });
    if (res.ok) { setDeptModal({ ...deptModal, isOpen: false }); fetchClients(); }
  };

  const handleDeleteDept = async (client: any, deptName: string) => {
    if (deptName === "전사") return alert("기본 부서 '전사'는 삭제할 수 없습니다.");
    if (!confirm(`'${deptName}' 부서를 완전히 삭제하시겠습니까?\n(지급 이력이 있는 경우 삭제가 거부됩니다.)`)) return;
    const res = await fetch('/api/marketing/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: client.id, action: 'delete_dept', targetDeptName: deptName })
    });
    if (res.ok) { alert('부서가 삭제되었습니다.'); fetchClients(); }
    else { const err = await res.json(); alert(err.error || '삭제 실패'); }
  };

  const handleToggleDeptHide = async (client: any, index: number) => {
    const depts = getNormalizedSortedDepts(client.departments);
    depts[index].is_hidden = !depts[index].is_hidden;
    const res = await fetch('/api/marketing/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: client.id, departments: depts })
    });
    if (res.ok) fetchClients();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return alert("고객사명은 필수입니다.");
    if (masterCategories.length > 0 && !formData.category) return alert("업무 범주를 선택해주세요.");

    const url = '/api/marketing/clients';
    const method = editClient ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editClient ? { id: editClient.id, ...formData } : formData)
    });
    if (res.ok) {
      alert(editClient ? '수정되었습니다.' : '등록되었습니다.');
      setShowModal(false);
      setEditClient(null);
      setFormData({ name: '', location: '', category: '' });
      fetchClients();
    }
  };

  const handleArchiveClient = async (id: string) => {
    if (!confirm('이 고객사를 목록에서 숨김(보관) 처리하시겠습니까?')) return;
    const res = await fetch(`/api/marketing/clients?id=${id}`, { method: 'DELETE' });
    if (res.ok) { alert('숨김 처리되었습니다.'); fetchClients(); }
  };

  const renderAggregatedItems = (distributions: any[]) => {
    const map: Record<string, number> = {};
    distributions.forEach(d => {
      const itemName = d.item?.name || '기타';
      map[itemName] = (map[itemName] || 0) + d.qty;
    });
    const entries = Object.entries(map);
    if (entries.length === 0) return <span className="text-slate-300">-</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {entries.map(([name, qty]) => (
          <span key={name} className="bg-slate-50 border border-slate-200 text-slate-500 text-[9px] px-1.5 py-0.5 rounded-md font-bold">
            {name} <strong className="text-indigo-600">{qty}</strong>
          </span>
        ))}
      </div>
    );
  };

  if (loading) return <div className="p-10 text-center font-black animate-pulse tracking-widest text-indigo-400 mt-20">Syncing Clients Data...</div>;

  return (
    <div className="p-8 space-y-6 max-w-[1600px] mx-auto font-sans text-slate-900 pb-20 animate-fade-in">
      
      {/* 상단 컨트롤 패널 */}
      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm p-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🏢</span>
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">고객사별 수령 현황</h2>
            <div className="flex items-center gap-4 mt-1">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Total {clients.length} Clients</p>
                <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={showHiddenDepts} onChange={(e) => setShowHiddenDepts(e.target.checked)} className="sr-only peer" />
                    <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:bg-indigo-500 relative transition-colors shadow-inner">
                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${showHiddenDepts ? 'translate-x-4' : ''} shadow-sm`}></div>
                    </div>
                    <span className="text-[10px] font-black text-slate-400 group-hover:text-indigo-600 transition-colors">숨김 부서 포함하기</span>
                </label>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          {/* 업무범주 필터 드롭다운 */}
          <select 
            value={selectedCategory} 
            onChange={(e) => setSelectedCategory(e.target.value)} 
            className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 shadow-sm cursor-pointer text-slate-700"
          >
            <option value="ALL">모든 업무범주</option>
            {uniqueCategories.map(cat => (
              <option key={cat as string} value={cat as string}>{cat as string}</option>
            ))}
          </select>

          <div className="relative w-full md:w-64">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
            <input type="text" placeholder="회사명, 소재지 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-inner" />
          </div>
          <button onClick={() => { setEditClient(null); setFormData({name:'', location:'', category:''}); setShowModal(true); }} className="shrink-0 px-6 py-3 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-md hover:bg-indigo-600 transition-all active:scale-95 whitespace-nowrap">
            + 신규 고객사 등록
          </button>
        </div>
      </div>

      {/* 데이터 테이블 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1300px] table-fixed">
            <thead className="bg-slate-900 text-[10px] text-slate-300 font-black uppercase tracking-widest border-b border-slate-800">
              <tr>
                <th className="py-4 text-center w-[60px]">NO</th>
                <th className="py-4 pl-2 w-[220px]">회사명 (부서관리)</th>
                <th className="py-4 text-center w-[70px]">하위</th>
                <th className="py-4 px-3 text-center w-[120px] text-indigo-400">업무범주</th>
                <th className="py-4 px-3 w-[200px] text-center">소재지 (주소)</th>
                <th className="py-4 px-4 w-[250px] border-l border-slate-800">이번 달 합계</th>
                <th className="py-4 px-4 w-[250px] border-l border-slate-800">올해 누적 합계</th>
                <th className="py-4 pr-6 text-center w-[140px] border-l border-slate-800">마스터 관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedClients.length === 0 ? (
                <tr><td colSpan={8} className="p-16 text-center text-slate-400 text-sm">조건에 맞는 고객사가 없습니다.</td></tr>
              ) : paginatedClients.map((client, idx) => {
                const isExpanded = expandedClients.has(client.id);
                const allDepts = getNormalizedSortedDepts(client.departments);
                const visibleDepts = allDepts.filter(d => showHiddenDepts || !d.is_hidden);
                
                const thisYearDists = client.distributions.filter((d:any) => new Date(d.createdAt).getFullYear() === currentYear);
                const thisMonthDists = thisYearDists.filter((d:any) => new Date(d.createdAt).getMonth() === currentMonth);

                return (
                  <React.Fragment key={client.id}>
                    <tr onClick={() => toggleExpand(client.id)} className={`hover:bg-slate-50 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/30' : ''}`}>
                      <td className="py-3 text-center text-slate-400 font-bold">{filteredClients.length - ((currentPage - 1) * itemsPerPage + idx)}</td>
                      <td className="py-3 pl-2 truncate pr-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                          <span className="font-black text-slate-900 text-[13px] truncate" title={client.name}>{client.name}</span>
                        </div>
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-black border border-slate-200">
                            {allDepts.filter(d => !d.is_hidden).length}
                          </span>
                          <button onClick={(e) => { e.stopPropagation(); setDeptModal({ isOpen: true, client, deptIndex: null, name: '' }); }} className="w-5 h-5 flex items-center justify-center bg-indigo-600 text-white rounded-md text-xs hover:bg-slate-800 shadow-sm">＋</button>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center text-indigo-600 font-black text-[12px] truncate" title={client.category}>{client.category || '-'}</td>
                      <td className="py-3 px-3 text-center text-slate-500 truncate" title={client.location}>{client.location || '-'}</td>
                      <td className="py-3 px-4 border-l border-slate-100 bg-white">{renderAggregatedItems(thisMonthDists)}</td>
                      <td className="py-3 px-4 border-l border-slate-100 bg-white">{renderAggregatedItems(thisYearDists)}</td>
                      <td className="py-3 pr-6 border-l border-slate-100 bg-white text-center">
                        <div className="flex justify-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setEditClient(client); setFormData({name:client.name, location:client.location||'', category:client.category||''}); setShowModal(true); }} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded text-[9px] font-black hover:bg-slate-900 hover:text-white transition-colors shadow-sm">수정</button>
                          <button onClick={(e) => { e.stopPropagation(); handleArchiveClient(client.id); }} className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-400 rounded text-[9px] font-black hover:bg-slate-500 hover:text-white transition-colors shadow-sm">숨김</button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && visibleDepts.map((dept: any) => {
                      const originalIndex = allDepts.findIndex(ad => ad.name === dept.name);
                      const deptMonthDists = thisMonthDists.filter((d:any)=>d.client_dept === dept.name);
                      const deptYearDists = thisYearDists.filter((d:any)=>d.client_dept === dept.name);
                      return (
                        <tr key={`${client.id}-${dept.name}`} className={`bg-slate-50/50 border-t border-dashed border-slate-200 h-10 ${dept.is_hidden ? 'opacity-50 grayscale' : ''}`}>
                          <td className="py-2 text-center border-r border-slate-100"></td>
                          <td colSpan={2} className="py-2 pl-8 text-slate-600 text-[11px] font-bold border-r border-slate-100">
                            <div className="flex items-center gap-2 group cursor-pointer" onClick={() => openHistory(client.name, dept.name, client.distributions)}>
                                <span className="text-slate-300">└</span> 
                                <span className={`${dept.is_hidden ? 'line-through text-slate-400' : 'group-hover:text-indigo-600'} truncate max-w-[200px] flex items-center`}>
                                  {dept.name} 
                                  {/* 🚀 제공이력 상세보기 (빨간색) */}
                                  <span className="text-[9px] font-black text-red-500 ml-2 group-hover:underline bg-red-50 px-1.5 py-0.5 rounded transition-all">
                                    제공이력 상세보기
                                  </span>
                                </span>
                            </div>
                          </td>
                          <td colSpan={2} className="py-2 px-3 text-center border-r border-slate-100">
                            <div className="flex justify-center gap-1">
                                <button onClick={() => setDeptModal({ isOpen: true, client, deptIndex: originalIndex, name: dept.name })} className="px-2 py-1 bg-white border border-slate-200 rounded text-[8px] font-black text-slate-500 hover:bg-indigo-600 hover:text-white shadow-sm transition-colors">EDIT</button>
                                <button onClick={() => handleToggleDeptHide(client, originalIndex)} className={`px-2 py-1 border rounded text-[8px] font-black shadow-sm transition-colors ${dept.is_hidden ? 'bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-600 hover:text-white' : 'bg-white border-slate-200 text-slate-400 hover:bg-red-500 hover:text-white'}`}>{dept.is_hidden ? 'SHOW' : 'HIDE'}</button>
                                {dept.name !== "전사" && (
                                  <button onClick={() => handleDeleteDept(client, dept.name)} className="px-2 py-1 bg-red-50 border border-red-100 text-red-400 rounded text-[8px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm">DEL</button>
                                )}
                            </div>
                          </td>
                          <td className="py-2 px-4 border-r border-slate-100 bg-slate-50/50">{renderAggregatedItems(deptMonthDists)}</td>
                          <td className="py-2 px-4 border-r border-slate-100 bg-slate-50/50">{renderAggregatedItems(deptYearDists)}</td>
                          <td className="py-2 pr-6 bg-slate-50/50"></td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center gap-1.5 p-4 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-7 h-7 rounded-lg text-[11px] font-black transition-all border ${currentPage === i + 1 ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>

      {/* 상세 이력 조회 모달 (신청일 createdAt 기준) */}
      {historyModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-6" onClick={() => setHistoryModal({...historyModal, isOpen: false})}>
          <div className="bg-white w-full max-w-4xl p-8 rounded-[2.5rem] shadow-2xl flex flex-col max-h-[80vh]" onClick={e=>e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-slate-100 pb-5 mb-6">
              <div>
                <h3 className="text-xl font-black text-slate-900">{historyModal.clientName} - <span className="text-indigo-600">{historyModal.deptName}</span></h3>
                <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">{currentYear} YEAR CUMULATIVE HISTORY (신청일 최신순)</p>
              </div>
              <button onClick={() => setHistoryModal({...historyModal, isOpen: false})} className="w-10 h-10 flex items-center justify-center bg-slate-100 text-slate-400 rounded-full hover:bg-slate-900 hover:text-white transition-all text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              {historyModal.list.length === 0 ? (
                <div className="py-20 text-center text-slate-300 font-bold">올해 지급된 이력이 없습니다.</div>
              ) : (
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[10px] text-slate-400 font-black uppercase sticky top-0">
                    <tr>
                      <th className="p-3 pl-5">물품 신청일</th>
                      <th className="p-3 text-indigo-600">물품명</th>
                      <th className="p-3 text-center">수량</th>
                      <th className="p-3">지급 목적</th>
                      <th className="p-3 text-center">신청자</th>
                      <th className="p-3 text-center">지원부서</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                    {historyModal.list.map((d, idx) => (
                      <tr key={idx} className="hover:bg-indigo-50/30 transition-colors h-12">
                        <td className="p-3 pl-5 font-mono text-slate-400">{new Date(d.createdAt).toISOString().split('T')[0]}</td>
                        <td className="p-3 text-indigo-700">{d.item?.name || '(삭제됨)'}</td>
                        <td className="p-3 text-center bg-slate-50/50">{d.qty} EA</td>
                        <td className="p-3 text-slate-500 truncate max-w-[200px]" title={d.purpose}>{d.purpose}</td>
                        <td className="p-3 text-center">{d.sender_name}</td>
                        <td className="p-3 text-center text-[10px] text-slate-400">{d.sender_dept}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 부서 추가/수정 모달 */}
      {deptModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4" onClick={() => setDeptModal({...deptModal, isOpen: false})}>
          <div className="bg-white w-[380px] p-7 rounded-[2rem] shadow-2xl flex flex-col border" onClick={e=>e.stopPropagation()}>
            <h3 className="font-black text-sm text-slate-800 mb-5 border-b border-slate-100 pb-3 flex items-center gap-2">
              <span className="text-lg">🏢</span> {deptModal.client.name} <span className="text-indigo-600">{deptModal.deptIndex !== null ? '부서명 수정' : '신규 부서 추가'}</span>
            </h3>
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-slate-500 uppercase tracking-tight ml-1">부서 명칭</label>
                <input type="text" value={deptModal.name} onChange={e=>setDeptModal({...deptModal, name: e.target.value})} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-inner" placeholder="예: 인사팀, 기획팀..." />
                {deptModal.deptIndex !== null && <p className="text-[9px] text-indigo-500 mt-1 font-bold">※ 수정 시 과거 지급 내역의 부서명도 일괄 업데이트됩니다.</p>}
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setDeptModal({...deptModal, isOpen: false})} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-black text-[11px] hover:bg-slate-200 transition-colors">취소</button>
                <button onClick={handleSaveDept} className="flex-[2] py-3.5 bg-indigo-600 text-white rounded-xl font-black text-[11px] shadow-lg hover:bg-indigo-700 transition-colors">저장하기</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 고객사 마스터 등록/수정 모달 (업무범주 마스터 연동) */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white w-[420px] p-8 rounded-[2rem] shadow-2xl flex flex-col border" onClick={e=>e.stopPropagation()}>
            <h3 className="font-black text-lg text-slate-900 border-b border-slate-100 pb-4 mb-6 flex items-center gap-2">
              <span>{editClient ? '✏️' : '✨'}</span>
              고객사 마스터 {editClient ? '정보 수정' : '신규 등록'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[12px] font-black text-slate-600 tracking-tight">고객사 공식 회사명 *</label>
                <input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm placeholder:text-slate-400" placeholder="회사명 풀명칭 입력" />
                {editClient && (
                  <p className="text-[9px] text-indigo-500 mt-1 font-bold">※ 수정 시 과거 지급 내역의 회사명도 일괄 업데이트됩니다.</p>
                )}
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[12px] font-black text-slate-600 tracking-tight">업무 범주 (CATEGORY) *</label>
                {/* 🚀 마스터 데이터 드롭다운 적용 */}
                {masterCategories.length > 0 ? (
                  <select 
                    required 
                    value={formData.category} 
                    onChange={e=>setFormData({...formData, category: e.target.value})} 
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm cursor-pointer text-slate-700"
                  >
                    <option value="">범주 선택</option>
                    {masterCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                ) : (
                  <div className="relative">
                    <input 
                      required type="text" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} 
                      className="w-full p-3.5 bg-red-50 border border-red-200 rounded-xl text-[13px] font-bold outline-none focus:border-red-500 transition-all shadow-sm text-red-700 placeholder:text-red-300" 
                      placeholder="어드민 설정에서 마스터 그룹을 매핑해주세요!" 
                    />
                    <p className="text-[9px] text-red-500 font-bold mt-1 ml-1">※ 현재 매핑된 마스터 그룹이 없어 직접 입력 모드입니다.</p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[12px] font-black text-slate-600 tracking-tight">소재지 주소</label>
                <input type="text" value={formData.location} onChange={e=>setFormData({...formData, location: e.target.value})} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm placeholder:text-slate-400" placeholder="풀주소 입력" />
              </div>

              {!editClient && (
                <div className="bg-indigo-50/50 p-4 rounded-2xl border border-dashed border-indigo-200">
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">💡 <strong>기본 부서(전사)</strong>가 자동으로 생성됩니다.</p>
                </div>
              )}
              
              <div className="flex gap-2.5 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-xl font-black text-[12px] hover:bg-slate-200 transition-colors">취소</button>
                <button type="submit" className="flex-[2] py-4 bg-indigo-600 text-white rounded-xl font-black text-[12px] shadow-lg hover:bg-indigo-700 transition-colors">{editClient ? '수정 완료' : '등록 완료'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}