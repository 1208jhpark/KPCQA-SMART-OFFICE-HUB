'use client';
     
import React, { useState, useEffect, useMemo, Suspense, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

function SuppliesMasterDashboardContent() {
  const pathname = usePathname();
  const router = useRouter();
  
  const [items, setItems] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  
  // 🚀 글로벌 설정 및 마스터 데이터 로드용 상태
  const [config, setConfig] = useState<any>(null);
  const [masterData, setMasterData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [editModal, setEditModal] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tabItems = [
    { id: 'dashboard', name: '🗂️ 소모품 마스터 대시보드', path: '/asset/supplies/master/dashboard' },
    { id: 'requests', name: '📋 사용자 신청현황 관리', path: '/asset/supplies/master/requests' },
    { id: 'purchase', name: '💰 입고/구매 내역 대장', path: '/asset/supplies/master/purchase' },
    { id: 'archive', name: '📁 폐기자산 아카이브', path: '/asset/supplies/master/archive' },
  ];

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // 병렬 데이터 로칭: 인벤토리, 신청내역, 설정, 마스터데이터
      const ts = Date.now();
      const [invRes, reqRes, confRes, mastRes] = await Promise.all([
        fetch('/api/asset/supplies/inventory', { cache: 'no-store' }).catch(() => null),
        fetch(`/api/asset/supplies/dept?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/config?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' }).catch(() => null)
      ]);

      if (invRes?.ok) setItems((await invRes.json()).items || []);
      if (reqRes?.ok) setRequests(await reqRes.json());
      if (confRes?.ok) setConfig(await confRes.json());
      if (mastRes?.ok) setMasterData(await mastRes.json());
    } catch (e) {
      console.error("Master Dashboard Sync Error", e);
    } finally {
      setLoading(false);
    }
  };

  // 📊 대시보드 통계 연산
  const stats = useMemo(() => {
    const activeItems = items.filter(i => i.is_active !== false); 
    const totalItems = activeItems.length;
    const outOfStockCount = activeItems.filter(item => item.current_stock <= (item.alert_qty || 5)).length;
    
    const now = new Date();
    const thisMonthReqs = requests.filter(r => {
      if (!r.createdAt) return false;
      const d = new Date(r.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    
    const pendingReqs = requests.filter(r => r.status === 'PENDING' || r.status === '대기중').length;
    return { totalItems, outOfStockCount, thisMonthReqs: thisMonthReqs.length, pendingReqs };
  }, [items, requests]);

  const sortedItems = useMemo(() => {
    return [...items]
      .filter(i => i.is_active !== false)
      .sort((a, b) => a.current_stock - b.current_stock);
  }, [items]);

// 🚀 마스터 데이터 드롭다운 옵션 필터링 (undefined 안전 방어선 구축)
const supplyOptions = useMemo(() => {
  if (!config?.supply_category_group || !masterData.length) return [];
  const group = masterData.find(g => g.id === config.supply_category_group);
  // codes 뒤에 ?. 을 붙이고 없으면 빈 배열 [] 을 바라보도록 보정
  return group?.codes?.filter((c: any) => c.is_active && !c.is_archived) || [];
}, [config, masterData]);

const unitOptions = useMemo(() => {
  if (!config?.unit_category_group || !masterData.length) return [];
  const group = masterData.find(g => g.id === config.unit_category_group);
  // codes 뒤에 ?. 을 붙이고 없으면 빈 배열 [] 을 바라보도록 보정
  return group?.codes?.filter((c: any) => c.is_active && !c.is_archived) || [];
}, [config, masterData]);

  // -----------------------------------------------------------------
  // 🛠️ 데이터 조작 및 액션 컨트롤러 함수들
  // -----------------------------------------------------------------
  
  const handleAddNewClick = () => {
    setEditModal({
      isNew: true,
      name: supplyOptions[0]?.label || '',
      current_stock: 0,
      alert_qty: 5,
      s_unit: unitOptions[0]?.label || 'EA',
      note: '',
      image_url: '' // 사진 초기화
    });
  };

  const handleEditClick = (item: any) => {
    const ext = item.description ? JSON.parse(item.description) : {};
    setEditModal({
      isNew: false,
      id: item.id,
      name: item.name,
      current_stock: item.current_stock,
      alert_qty: item.alert_qty || 5,
      s_unit: ext.s_unit || 'EA',
      note: ext.note || '',
      image_url: item.image_url || '' // 등록된 사진 바인딩
    });
  };

  // 📸 이미지 파일 업로드 핸들러 (Base64 변환)
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) return alert("이미지 용량은 2MB를 초과할 수 없습니다.");
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditModal((prev: any) => ({ ...prev, image_url: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal.name.trim()) return alert('품목명을 선택/입력해주세요.');

    const descriptionJson = JSON.stringify({ s_unit: editModal.s_unit, note: editModal.note });
    const payload = {
      id: editModal.id, 
      name: editModal.name,
      current_stock: Number(editModal.current_stock),
      alert_qty: Number(editModal.alert_qty),
      category: '소모품',
      description: descriptionJson,
      is_active: true,
      image_url: editModal.image_url // 사진 DB 전송
    };

    try {
      const method = editModal.isNew ? 'POST' : 'PATCH';
      const res = await fetch('/api/asset/supplies/inventory', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert(editModal.isNew ? '✅ 신규 품목이 등록되었습니다.' : '✅ 정보가 수정되었습니다.');
        setEditModal(null);
        fetchDashboardData(); 
      } else {
        alert('저장 중 오류가 발생했습니다.');
      }
    } catch (err) {
      alert('서버 통신 오류가 발생했습니다.');
    }
  };

  const handleTogglePublish = async (id: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    if (!confirm(nextStatus ? '해당 품목을 사용자 화면에 게시하시겠습니까?' : '사용자 화면에서 숨김 처리하시겠습니까?')) return;
    
    setItems(prev => prev.map(item => item.id === id ? { ...item, is_published: nextStatus } : item));
    try {
      await fetch('/api/asset/supplies/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_published: nextStatus })
      });
    } catch (e) { fetchDashboardData(); }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('해당 품목을 대시보드에서 내리고 [아카이브(보관함)]로 이동하시겠습니까?')) return;
    setItems(prev => prev.map(item => item.id === id ? { ...item, is_active: false } : item));
    try {
      await fetch('/api/asset/supplies/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id, is_active: false, 
          disposal_date: new Date().toISOString().split('T')[0],
          disposal_reason: '마스터 대시보드에서 보관 처리' 
        })
      });
      alert('보관함으로 이동되었습니다.');
    } catch (e) { fetchDashboardData(); }
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest text-xl">Loading Master Workspace...</div>;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 마스터 타이틀 배너 */}
      <div className="w-full bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[120px]">
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-1">Central Supplies Control Tower</p>
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white">소모품 마스터 관리 통제실</h1>
              <p className="text-slate-400 text-xs font-semibold mt-2 opacity-90">전사 소모품의 실시간 재고 현황을 모니터링하고 관리합니다.</p>
            </div>
          </div>
        </div>
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none">🗄️</div>
      </div>

      {/* 공통 탭 바 */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-4xl">
        {tabItems.map((tab) => {
          const isActive = pathname.startsWith(tab.path);
          return (
            <Link key={tab.id} href={tab.path} className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${isActive ? 'bg-white text-blue-600 shadow-sm border border-slate-300/50 scale-[1.01]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'}`}>
              {tab.name}
            </Link>
          );
        })}
      </div>

      {/* 대시보드 통계 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-4">
        <div className="bg-white border border-slate-200 p-6 shadow-sm rounded-[2rem] flex flex-col justify-center">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">총 운용 품목</p>
          <p className="text-3xl font-black text-slate-900 tracking-tighter">{stats.totalItems} <span className="text-sm font-bold text-slate-400 ml-1">EA</span></p>
        </div>
        <div className="bg-white border border-slate-200 p-6 shadow-sm rounded-[2rem] flex flex-col justify-center">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">금월 누적 신청</p>
          <p className="text-3xl font-black text-blue-600 tracking-tighter">{stats.thisMonthReqs} <span className="text-sm font-bold text-blue-300 ml-1">건</span></p>
        </div>
        <div className="bg-white border border-slate-200 p-6 shadow-sm rounded-[2rem] flex flex-col justify-center relative overflow-hidden">
          <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">처리 대기중인 신청</p>
          <p className="text-3xl font-black text-amber-600 tracking-tighter">{stats.pendingReqs} <span className="text-sm font-bold text-amber-300 ml-1">건</span></p>
          {stats.pendingReqs > 0 && <span className="absolute top-4 right-4 text-xs animate-ping">🔔</span>}
        </div>
        <div className="bg-rose-50 border border-rose-100 p-6 shadow-sm rounded-[2rem] flex flex-col justify-center relative">
          <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">재고 경고 (발주요망)</p>
          <p className="text-3xl font-black text-rose-600 tracking-tighter">{stats.outOfStockCount} <span className="text-sm font-bold text-rose-300 ml-1">품목</span></p>
        </div>
      </div>

      {/* 데이터시트 보드 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">실시간 창고 재고 현황 보드</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{sortedItems.length}개 품목</span>
          </div>
          <div className="flex items-center gap-2">
            {/* 🚀 신규 추가 버튼 */}
            <button onClick={handleAddNewClick} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-700 transition-all shadow-sm flex items-center gap-1.5">
              + 신규 물품 추가
            </button>
            <Link href="/asset/supplies/master/purchase" className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-[10px] font-black hover:bg-slate-900 transition-all shadow-sm flex items-center gap-1.5">
              발주 대장 ➡️
            </Link>
          </div>
        </div>
     
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1300px]">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 px-6 w-16 text-center">NO</th>
                <th className="h-12 px-4 w-28 text-center text-slate-400">품목코드</th>
                <th className="h-12 px-4 w-[250px] text-indigo-600">품목명</th>
                <th className="h-12 px-4 w-32 text-center">현재 재고</th>
                <th className="h-12 px-4 w-28 text-center text-slate-400">경고 재고치</th>
                <th className="h-12 px-4 w-32 text-center">재고 상태</th>
                <th className="h-12 px-4 min-w-[150px]">관리 비고</th>
                <th className="h-12 px-4 w-64 text-center border-l border-slate-200">마스터 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {sortedItems.length === 0 ? (
                <tr><td colSpan={8} className="h-32 text-center text-slate-400 italic">등록된 소모품 마스터 데이터가 없습니다.</td></tr>
              ) : (
                sortedItems.map((item, idx) => {
                  const ext = item.description ? JSON.parse(item.description) : {};
                  const sUnit = ext.s_unit || 'EA';
                  const safeStock = item.alert_qty || 5; 
                  const isDanger = item.current_stock <= safeStock;
                  const isOut = item.current_stock === 0;
                  const isPublished = item.is_published !== false; 

                  return (
                    <tr key={item.id} className={`h-16 transition-colors ${isDanger ? 'bg-rose-50/30 hover:bg-rose-50' : 'hover:bg-slate-50'}`}>
                      <td className="px-6 text-center text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                      <td className="px-4 text-center font-mono text-slate-400 text-[10px]">SUP-{String(item.id).padStart(4, '0')}</td>
                      <td className="px-4 flex items-center gap-3 h-16">
                        {/* 이미지 미니 썸네일 */}
                        <div className="w-8 h-8 rounded border border-slate-200 overflow-hidden flex-shrink-0 bg-slate-100 flex justify-center items-center">
                          {item.image_url ? <img src={item.image_url} alt="img" className="w-full h-full object-cover" /> : <span className="text-[10px] opacity-40">📦</span>}
                        </div>
                        <div>
                          <div className="font-black text-slate-900 text-[12px] truncate max-w-[200px]">{item.name}</div>
                          {!isPublished && <span className="text-[8px] font-black text-red-500 bg-red-50 px-1.5 py-0.5 rounded uppercase mt-0.5 inline-block">비공개(숨김)</span>}
                        </div>
                      </td>
                      <td className={`px-4 text-center font-black text-[14px] ${isOut ? 'text-red-500' : isDanger ? 'text-orange-500' : 'text-indigo-600'}`}>
                        {item.current_stock} <span className="text-[9px] font-bold ml-0.5">{sUnit}</span>
                      </td>
                      <td className="px-4 text-center font-bold text-slate-400 text-[11px]">{safeStock} {sUnit}</td>
                      <td className="px-4 text-center">
                        <span className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest ${isOut ? 'bg-red-100 text-red-600 border border-red-200' : isDanger ? 'bg-orange-100 text-orange-600 border border-orange-200 animate-pulse' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                          {isOut ? '품절' : isDanger ? '재고부족' : '정상운용'}
                        </span>
                      </td>
                      <td className="px-4 text-slate-500 font-medium text-[10px] truncate max-w-[150px]">{ext.note || '-'}</td>
                      
                      {/* 🚀 관리자 액션 버튼 영역 */}
                      <td className="px-4 border-l border-slate-100">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => handleTogglePublish(item.id, isPublished)} className={`px-2.5 py-1.5 rounded text-[9px] font-black shadow-sm border transition-colors ${isPublished ? 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100' : 'bg-slate-800 border-slate-800 text-white hover:bg-slate-900'}`}>
                            {isPublished ? '게시내림' : '게시올림'}
                          </button>
                          <button onClick={() => handleEditClick(item)} className="px-2.5 py-1.5 rounded text-[9px] font-black bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-600 hover:text-white shadow-sm transition-colors">
                            정보수정
                          </button>
                          <button onClick={() => handleArchive(item.id)} className="px-2.5 py-1.5 rounded text-[9px] font-black bg-white text-rose-500 border border-rose-200 hover:bg-rose-50 shadow-sm transition-colors">
                            보관함
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🚀 5. 사진 업로드 + 마스터 데이터 연동 모달 팝업 */}
      {editModal && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8">
            <div className="bg-slate-900 p-6 flex justify-between items-center text-white">
              <div>
                <h3 className="font-black text-sm uppercase tracking-widest text-white">
                  {editModal.isNew ? '✨ 신규 소모품 마스터 등록' : '✏️ 소모품 정보 수정'}
                </h3>
              </div>
              <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-white transition-colors text-xl">✕</button>
            </div>

            <form onSubmit={handleSaveSubmit} className="p-8 bg-slate-50 flex gap-8">
              
              {/* 좌측 사진 영역 */}
              <div className="w-1/3 flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">상품 이미지</label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-square border-2 border-dashed border-slate-300 rounded-2xl bg-white hover:bg-slate-50 transition-colors flex items-center justify-center cursor-pointer overflow-hidden relative group"
                >
                  {editModal.image_url ? (
                    <>
                      <img src={editModal.image_url} alt="preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center text-white text-[10px] font-black">사진 변경</div>
                    </>
                  ) : (
                    <div className="text-center text-slate-400">
                      <div className="text-3xl mb-1">📸</div>
                      <span className="text-[10px] font-bold">클릭하여 등록</span>
                    </div>
                  )}
                </div>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageChange} className="hidden" />
              </div>

              {/* 우측 폼 입력 영역 */}
              <div className="w-2/3 space-y-5">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5 flex items-center gap-2">
                    품목명 (Master Link)
                    {!supplyOptions.length && <span className="text-[9px] text-red-500 font-bold bg-red-50 px-1.5 py-0.5 rounded">※ 설정 화면에서 매핑 필요</span>}
                  </label>
                  {supplyOptions.length > 0 ? (
                    <select 
                      required value={editModal.name} onChange={(e) => setEditModal({...editModal, name: e.target.value})}
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-indigo-700 outline-none focus:border-indigo-500 shadow-sm"
                    >
                      <option value="">품목을 선택하세요</option>
                      {supplyOptions.map((opt:any) => <option key={opt.id} value={opt.label}>{opt.label}</option>)}
                    </select>
                  ) : (
                    <input 
                      type="text" required value={editModal.name} onChange={(e) => setEditModal({...editModal, name: e.target.value})}
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-900 outline-none shadow-sm"
                      placeholder="매핑 데이터가 없습니다. 직접 입력하세요."
                    />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">단위 (Master Link)</label>
                    {unitOptions.length > 0 ? (
                      <select 
                        required value={editModal.s_unit} onChange={(e) => setEditModal({...editModal, s_unit: e.target.value})}
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:border-indigo-500 shadow-sm"
                      >
                        {unitOptions.map((opt:any) => <option key={opt.id} value={opt.label}>{opt.label}</option>)}
                      </select>
                    ) : (
                      <input 
                        type="text" required value={editModal.s_unit} onChange={(e) => setEditModal({...editModal, s_unit: e.target.value})}
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-900 outline-none shadow-sm"
                        placeholder="예: EA"
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">현재고 (수동조정)</label>
                    <input 
                      type="number" min="0" required value={editModal.current_stock} onChange={(e) => setEditModal({...editModal, current_stock: e.target.value})}
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-indigo-600 outline-none focus:border-indigo-500 shadow-sm text-right"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-orange-500 uppercase tracking-widest block mb-1.5">안전 재고 (경고 알림 수량)</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" min="0" required value={editModal.alert_qty} onChange={(e) => setEditModal({...editModal, alert_qty: e.target.value})}
                      className="w-24 p-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-orange-600 outline-none focus:border-orange-400 shadow-sm text-right"
                    />
                    <span className="text-[10px] text-slate-400 font-bold">개 이하로 떨어지면 대시보드에 위험(재고부족) 경고 발생</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">관리 비고 (Note)</label>
                  <input 
                    type="text" value={editModal.note} onChange={(e) => setEditModal({...editModal, note: e.target.value})}
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 shadow-sm"
                    placeholder="특이사항 메모 (선택)"
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-200">
                  <button type="button" onClick={() => setEditModal(null)} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl text-[11px] font-black text-slate-500 hover:bg-slate-100 transition-colors shadow-sm">
                    취소
                  </button>
                  <button type="submit" className="flex-[2] py-3 bg-slate-900 text-white rounded-xl text-[11px] font-black hover:bg-indigo-600 transition-colors shadow-md">
                    {editModal.isNew ? '신규 등록 완료' : '변경사항 최종 저장'}
                  </button>
                </div>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
     
export default function MasterDashboardModule() {
  return (
    <Suspense fallback={<div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">LOADING MASTER WORKSPACE...</div>}>
      <SuppliesMasterDashboardContent />
    </Suspense>
  );
}