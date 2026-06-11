'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import * as XLSX from 'xlsx'; 

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemIdFromUrl = searchParams.get('itemId');

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];

  const initialForm = { 
    item_id: '', 
    client_name: '', 
    client_dept: '', 
    qty: 1, 
    purpose: '', 
    dist_date: todayStr 
  };
  const [formData, setFormData] = useState(initialForm);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  useEffect(() => {
    const initData = async () => {
      try {
        const [uRes, iRes, cRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/marketing/items'),
          fetch('/api/marketing/clients')
        ]);
        
        let user: any = null;
        if (uRes.ok) {
          user = await uRes.json();
          setCurrentUser(user);
        }
        if (iRes.ok) setItems(await iRes.json());
        if (cRes.ok) setClients(await cRes.json());

        if (user?.name) {
          const dRes = await fetch(`/api/marketing/distributions?sender=${user.name}`);
          if (dRes.ok) setDistributions(await dRes.json());
        }
      } catch(e) {
        console.error("초기 데이터 로드 실패:", e);
      }
      setLoading(false);
    };
    initData();
  }, []);

  const checkDistributePermission = (itemOwnerDept: string) => {
    if (!currentUser || !currentUser.unit) return false;
    const myCenter = currentUser.unit.unit_name;
    const myHq = currentUser.unit.parent?.unit_name;
    const company = "KPCQA";
    return itemOwnerDept === myCenter || itemOwnerDept === myHq || itemOwnerDept === company;
  };

  const availableItems = useMemo(() => {
    return items.filter(item => checkDistributePermission(item.owner_dept));
  }, [items, currentUser]);

  useEffect(() => {
    if (itemIdFromUrl && availableItems.length > 0) {
      if (availableItems.some(i => i.id === itemIdFromUrl)) {
        setFormData(prev => ({ ...prev, item_id: itemIdFromUrl }));
      }
    }
  }, [itemIdFromUrl, availableItems]);

  const selectedItemData = useMemo(() => availableItems.find(i => i.id === formData.item_id), [availableItems, formData.item_id]);
  const totalPrice = selectedItemData ? selectedItemData.unit_price * formData.qty : 0;

  const selectedClientData = useMemo(() => clients.find(c => c.name === formData.client_name), [clients, formData.client_name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.item_id || !formData.client_name || !formData.purpose) return alert("필수 항목을 입력하세요.");
    if (!selectedItemData || formData.qty > selectedItemData.current_stock) return alert("입력 수량이 현재 재고보다 많습니다!");

    const payload = {
      ...formData,
      client_id: selectedClientData?.id || null, 
      sender_name: currentUser.name,
      sender_dept: currentUser.unit?.unit_name || '미소속'
    };

    try {
      const res = await fetch('/api/marketing/distributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert('✅ 성공적으로 등록되었으며, 재고가 차감되었습니다.');
        setFormData({ ...initialForm, dist_date: todayStr });
        const [dRes, iRes] = await Promise.all([
          fetch(`/api/marketing/distributions?sender=${currentUser.name}`),
          fetch('/api/marketing/items')
        ]);
        if (dRes.ok) setDistributions(await dRes.json());
        if (iRes.ok) setItems(await iRes.json());
      } else { alert('등록 실패'); }
    } catch (e) { alert('오류 발생'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    const res = await fetch(`/api/marketing/distributions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setDistributions(prev => prev.filter(d => d.id !== id));
      const iRes = await fetch('/api/marketing/items');
      if (iRes.ok) setItems(await iRes.json());
    }
  };

  const availableYears = useMemo(() => {
    const years = distributions.map(d => new Date(d.createdAt).getFullYear().toString());
    const unique = Array.from(new Set(years)).sort((a,b) => b.localeCompare(a));
    const currentYear = new Date().getFullYear().toString();
    if (!unique.includes(currentYear)) unique.push(currentYear);
    return unique;
  }, [distributions]);

  const filteredList = useMemo(() => {
    return distributions.filter(d => {
      const yearMatch = selectedYear === 'ALL' || new Date(d.createdAt).getFullYear().toString() === selectedYear;
      const searchMatch = !searchQuery || d.client_name.includes(searchQuery) || d.item?.name?.includes(searchQuery);
      return yearMatch && searchMatch;
    });
  }, [distributions, selectedYear, searchQuery]);

  const totalAmountForYear = useMemo(() => {
    return filteredList.reduce((acc, cur) => acc + (cur.item?.unit_price || 0) * cur.qty, 0);
  }, [filteredList]);

  const totalPages = Math.max(1, Math.ceil(filteredList.length / itemsPerPage));
  const paginatedList = filteredList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => { 
    setCurrentPage(1); 
    setSelectedIds(new Set()); 
  }, [selectedYear, searchQuery]);

  const toggleAll = () => {
    const currentPageIds = paginatedList.map(d => d.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      currentPageIds.forEach(id => next.delete(id));
    } else {
      currentPageIds.forEach(id => next.add(id));
    }
    setSelectedIds(next);
  };

  const handleDownloadExcel = () => {
    const targetList = selectedIds.size > 0 
      ? distributions.filter(d => selectedIds.has(d.id))
      : filteredList;

    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");

    const exportData = targetList.map((d, i) => ({
      'NO': targetList.length - i,
      '물품명': d.item?.name,
      '단가(원)': d.item?.unit_price,
      '개수': d.qty,
      '총 금액(원)': (d.item?.unit_price || 0) * d.qty,
      '지급목적': d.purpose,
      '고객사(회사명)': d.client_name,
      '고객사 부서': d.client_dept,
      '물품신청일': new Date(d.createdAt).toISOString().split('T')[0],
      '결재일': new Date(d.dist_date).toISOString().split('T')[0],
      '신청자': d.sender_name,
      '소속부서': d.sender_dept
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "지급이력");
    XLSX.writeFile(wb, `지급이력_${selectedYear}년_${currentUser?.name}.xlsx`);
  };

  if (loading) return <div className="p-10 font-black text-center text-slate-400 animate-pulse mt-20 tracking-widest">Syncing Database...</div>;

  return (
    <div className="p-8 space-y-6 font-sans max-w-[1600px] mx-auto pb-20 animate-fade-in relative z-10">
      
      {/* 1. 등록 폼 */}
      <div className="bg-white border-2 border-indigo-100 rounded-[2rem] shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4 px-2">
          <span className="text-2xl">🎁</span>
          <h3 className="text-lg font-black text-slate-900 tracking-tight">나의 고객사 지급 등록</h3>
        </div>
        
        <form onSubmit={handleSubmit} className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 flex flex-col gap-3">
          <div className="grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-indigo-600 uppercase ml-1">물품 선택 *</label>
              <select required value={formData.item_id} onChange={e => setFormData({...formData, item_id: e.target.value})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm cursor-pointer">
                <option value="">카탈로그에서 물품 선택</option>
                {availableItems.map(i => <option key={i.id} value={i.id} disabled={i.current_stock <= 0}>{i.name} {i.current_stock <= 0 ? '(품절)' : ''}</option>)}
              </select>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">단가 정보</label>
              <div className="w-full p-2.5 bg-slate-100/70 border border-slate-200 rounded-xl text-xs font-mono font-black text-slate-500 text-center">
                {selectedItemData ? `${selectedItemData.unit_price.toLocaleString()}` : '-'}
              </div>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">지급 개수 *</label>
              <div className="relative">
                <input type="number" min="1" max={selectedItemData?.current_stock || 1} required value={formData.qty} onChange={e => setFormData({...formData, qty: Number(e.target.value)})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm pr-12" placeholder="수량" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-indigo-400">/ {selectedItemData?.current_stock || 0}</span>
              </div>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-indigo-500 uppercase ml-1">총 금액 (단가 × 수량)</label>
              <div className="w-full p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs font-mono font-black text-indigo-600 text-right pr-4 shadow-inner">
                {totalPrice > 0 ? `${totalPrice.toLocaleString()} 원` : '-'}
              </div>
            </div>
            <div className="lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">물품 신청일 (자동)</label>
              <input type="text" readOnly value={formData.dist_date} className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-500 shadow-inner outline-none cursor-not-allowed text-center" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-3 space-y-1 relative">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">고객사(회사명) *</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  readOnly 
                  required
                  value={formData.client_name} 
                  className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold shadow-inner outline-none cursor-pointer text-slate-700" 
                  placeholder="회사 검색버튼 클릭" 
                  onClick={() => setShowClientModal(true)} 
                />
                <button type="button" onClick={() => setShowClientModal(true)} className="px-4 shrink-0 bg-indigo-100 text-indigo-700 font-black text-[10px] rounded-xl border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-colors shadow-sm">검색</button>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">고객사 부서명</label>
              <input 
                type="text" 
                list="dept-list" 
                value={formData.client_dept} 
                onChange={e => setFormData({...formData, client_dept: e.target.value})} 
                onFocus={(e) => { e.currentTarget.value = ''; setFormData(prev => ({...prev, client_dept: ''})); }}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm" 
                placeholder="부서 선택" 
              />
              <datalist id="dept-list">
                {selectedClientData?.departments?.map((d: any, idx: number) => {
                  const name = typeof d === 'string' ? d : d.name;
                  const isHidden = typeof d === 'object' ? d.is_hidden : false;
                  if (isHidden) return null;
                  return <option key={idx} value={name} />;
                })}
              </datalist>
            </div>

            <div className="lg:col-span-4 space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">지급 목적 *</label>
              <input type="text" required value={formData.purpose} onChange={e => setFormData({...formData, purpose: e.target.value})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm" placeholder="예: 세미나 참석 기념" />
            </div>

            <div className="lg:col-span-2">
              <button type="submit" className="w-full p-2.5 bg-slate-900 text-white rounded-xl font-black text-[11px] shadow-md hover:bg-indigo-600 active:scale-95 transition-all">등록 & 재고차감</button>
            </div>
          </div>
        </form>
      </div>

      {/* 2. 이력 대장 테이블 */}
      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-900 border-b flex flex-wrap justify-between items-center gap-4">
          <h3 className="text-[13px] font-black text-white flex items-center gap-2"><span>📋</span> 나의 지급 이력 대장</h3>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-indigo-900/50 px-4 py-2 rounded-xl border border-indigo-700 shadow-inner">
              <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">💰 {selectedYear}년 총 금액</span>
              <span className="text-sm font-black text-white font-mono">{totalAmountForYear.toLocaleString()} 원</span>
            </div>

            <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 shadow-inner">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">🗓️ 연도</span>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent text-[11px] font-black text-white outline-none cursor-pointer">
                <option value="ALL">TOTAL 모두보기</option>
                {availableYears.map(y => <option key={y} value={y} className="text-slate-900">{y}년</option>)}
              </select>
            </div>

            <button 
              onClick={handleDownloadExcel}
              className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all flex items-center gap-2 shadow-lg ${selectedIds.size > 0 ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-700 text-slate-400 border border-slate-600'}`}
            >
              <span>📊</span> {selectedIds.size > 0 ? `${selectedIds.size}건 엑셀 다운로드` : '전체 엑셀 다운로드'}
            </button>

            <div className="relative w-64">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input type="text" placeholder="물품명, 고객사 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-white outline-none focus:border-indigo-500 placeholder:text-slate-600" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {/* 🚀 테이블의 기본 넓이를 약간 늘려줍니다 */}
          <table className="w-full text-left min-w-[1500px]">
            <thead className="bg-slate-50 text-[10px] text-slate-400 font-black tracking-tight uppercase border-b border-slate-200">
              <tr>
                <th className="py-3 pl-6 w-12 text-center">
                  <input type="checkbox" checked={paginatedList.length > 0 && paginatedList.every(d => selectedIds.has(d.id))} onChange={toggleAll} className="w-4 h-4 accent-indigo-600 cursor-pointer" />
                </th>
                <th className="py-3 px-2 w-12 text-center">NO</th>
                <th className="py-3 px-3 w-40 text-indigo-600">물품명</th>
                <th className="py-3 px-3 w-24 text-right">단가(원)</th>
                <th className="py-3 px-3 w-20 text-center">개수</th>
                <th className="py-3 px-3 w-28 text-right text-indigo-500">총 금액(원)</th>
                <th className="py-3 px-3 w-48">지급목적</th>
                <th className="py-3 px-3 w-40 text-emerald-600">고객사 (회사명)</th>
                <th className="py-3 px-3 w-32">고객사 부서</th>
                <th className="py-3 px-3 w-24 text-center">신청일</th>
                <th className="py-3 px-3 w-24 text-center">결재일</th>
                <th className="py-3 px-3 w-20 text-center">신청자</th>
                {/* 🚀 소속부서 넓이를 w-24에서 w-36으로 확장 */}
                <th className="py-3 px-3 w-36 text-center">소속부서</th>
                <th className="py-3 pr-6 w-24 text-center">관리기능</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedList.length === 0 ? (
                <tr><td colSpan={14} className="p-16 text-center text-slate-400">데이터가 없습니다.</td></tr>
              ) : paginatedList.map((d, idx) => {
                const isSelected = selectedIds.has(d.id);
                return (
                  <tr key={d.id} className={`transition-colors h-12 ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`}>
                    <td className="pl-6 text-center">
                      <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(d.id) ? next.delete(d.id) : next.add(d.id); setSelectedIds(next); }} className="w-4 h-4 accent-indigo-600 cursor-pointer" />
                    </td>
                    <td className="px-2 text-center text-slate-400">{filteredList.length - ((currentPage - 1) * itemsPerPage + idx)}</td>
                    <td className="px-3 text-indigo-700 text-[12px]">{d.item?.name || '(삭제됨)'}</td>
                    <td className="px-3 text-right font-mono">{d.item?.unit_price?.toLocaleString()}</td>
                    <td className="px-3 text-center bg-slate-50/50 font-mono">{d.qty} EA</td>
                    <td className="px-3 text-right font-mono font-black text-indigo-600 bg-indigo-50/30">
                      {((d.item?.unit_price || 0) * d.qty).toLocaleString()} 원
                    </td>
                    <td className="px-3 text-slate-500 truncate max-w-[180px]" title={d.purpose}>{d.purpose}</td>
                    <td className="px-3 font-black text-emerald-700 text-[12px]">{d.client_name}</td>
                    <td className="px-3 text-slate-500 truncate">{d.client_dept}</td>
                    <td className="px-3 text-center text-slate-400 font-mono">{new Date(d.createdAt).toISOString().split('T')[0]}</td>
                    <td className="px-3 text-center font-black text-indigo-500 font-mono">{new Date(d.dist_date).toISOString().split('T')[0]}</td>
                    <td className="px-3 text-center">{d.sender_name}</td>
                    {/* 🚀 소속부서 td에 whitespace-nowrap 추가로 두줄 방지 */}
                    <td className="px-3 text-center text-[10px] text-slate-500 whitespace-nowrap">{d.sender_dept}</td>
                    <td className="pr-6 text-center">
                      <button onClick={() => handleDelete(d.id)} className="px-2 py-1.5 bg-red-50 text-red-500 border border-red-100 text-[9px] font-black rounded hover:bg-red-500 hover:text-white shadow-sm transition-colors">✕ 취소</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center gap-1.5 p-3 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-7 h-7 rounded-lg text-[11px] font-black transition-all ${currentPage === i + 1 ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>

      {/* 고객사 검색 모달 */}
      {showClientModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4" onClick={() => setShowClientModal(false)}>
          <div className="bg-white w-[800px] p-8 rounded-[2.5rem] shadow-2xl flex flex-col border" onClick={e=>e.stopPropagation()}>
            <div className="flex justify-between items-center border-b pb-4 mb-5">
              <h3 className="font-black text-lg text-slate-800 flex items-center gap-2"><span>🏢</span> 고객사 마스터 검색</h3>
              <button onClick={() => setShowClientModal(false)} className="text-2xl text-slate-400 hover:text-slate-700 transition-colors">✕</button>
            </div>
            <div className="relative mb-5">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">🔍</span>
              <input type="text" placeholder="회사명 검색..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white shadow-inner" />
            </div>
            <div className="flex-1 overflow-y-auto max-h-72 border border-slate-200 rounded-xl bg-white mb-6">
              <table className="w-full text-left table-fixed">
                <thead className="bg-slate-100 text-[10px] text-slate-500 font-black uppercase sticky top-0 shadow-sm">
                  <tr>
                    <th className="p-3 pl-5 w-[45%]">고객사 (회사명)</th>
                    <th className="p-3 w-[20%] text-center">업무범주</th>
                    <th className="p-3 w-[35%]">소재지 주소</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clients.filter(c => c.name.includes(clientSearch)).length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-12 text-slate-400 text-xs font-bold">검색된 고객사가 없습니다.</td></tr>
                  ) : (
                    clients.filter(c => c.name.includes(clientSearch)).map(c => (
                      <tr key={c.id} onClick={() => { setFormData(prev => ({ ...prev, client_name: c.name, client_dept: '' })); setShowClientModal(false); }} className="cursor-pointer hover:bg-indigo-50 transition-colors">
                        <td className="p-3 pl-5 font-black text-slate-800 text-[13px] truncate">{c.name}</td>
                        <td className="p-3 text-center text-indigo-600 font-bold text-[11px] truncate">{c.category || '-'}</td>
                        <td className="p-3 text-slate-500 font-medium text-[11px] truncate">{c.location || '소재지 미상'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 flex flex-col items-center">
              <p className="text-[13px] font-black text-indigo-900 mb-3">검색되지 않을 경우, 고객사 마스터를 먼저 등록해 주세요.</p>
              <button onClick={() => router.push('/marketing/distribution/client-search')} className="px-8 py-3.5 bg-indigo-600 text-white rounded-xl text-xs font-black shadow-lg hover:bg-indigo-700 flex items-center gap-2"><span>📝</span> 고객사 마스터 등록 페이지로 이동</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RegisterModule() {
    return (
      <Suspense fallback={<div className="p-10 text-center font-black animate-pulse">Loading Application...</div>}>
        <RegisterContent />
      </Suspense>
    );
  }