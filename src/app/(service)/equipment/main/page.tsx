// src/app/(service)/equipment/main/page.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    <div className="flex items-center gap-2">
      {children}
    </div>
  </div>
);

const displayAssetNo = (no: string) => no?.split('_ARC_')[0] || '-';
const parseFileData = (str: string | null) => { try { return str ? JSON.parse(str) : null; } catch { return null; } };

const getLatestCalibDate = (histories: any[]) => {
  if (!histories || histories.length === 0) return null;
  return [...histories].sort((a, b) => new Date(b.calib_date).getTime() - new Date(a.calib_date).getTime())[0].calib_date?.split('T')[0] || null;
};

const addMonthsToDateStr = (dateStr: string | null | undefined, months: number | null | undefined) => {
  if (!dateStr || !months) return null;
  const d = new Date(dateStr); d.setMonth(d.getMonth() + Number(months));
  return d.toISOString().split('T')[0];
};

const renderDDay = (targetDate: string | null) => {
  if (!targetDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate); target.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return <span className="text-red-500 font-black px-1.5 py-0.5 rounded bg-red-50 ml-1.5 text-[9px]">D-Day</span>;
  if (diffDays > 0) return <span className="text-blue-600 font-black px-1.5 py-0.5 rounded bg-blue-50 ml-1.5 text-[9px]">D-{diffDays}</span>;
  return <span className="text-red-600 font-black px-1.5 py-0.5 rounded bg-red-50 ml-1.5 text-[9px]">D+{Math.abs(diffDays)}</span>;
};

export default function EquipmentMainDashboard() {
  const router = useRouter();
  
  const [equipments, setEquipments] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [showQrModal, setShowQrModal] = useState<any>(null); 
   
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
   
  useEffect(() => {
    const initializePage = async () => {
      try {
        const menuRes = await fetch('/api/admin/interface');
        const menus = await menuRes.json();
        const currentMenu = menus.find((m: any) => m.path === '/equipment/main');
        
        if (currentMenu && currentMenu.l2_entry_mode === 'L3_DEFAULT') {
          const children = menus
            .filter((m: any) => m.parent_id === currentMenu.id && m.is_active)
            .sort((a: any, b: any) => a.sort_order - b.sort_order);
          if (children.length > 0) {
            router.replace(children[0].path); return; 
          }
        }
   
        const [eqRes, unitRes] = await Promise.all([
          fetch('/api/equipment'),
          fetch('/api/admin/units?active=true').catch(() => null)
        ]);
  
        const eqData = await eqRes.json();
        const unitData = unitRes && unitRes.ok ? await unitRes.json() : [];
        
        const activeEquipments = eqData.filter((e: any) => e.status === '정상');
        setEquipments(activeEquipments);
        setUnits(unitData);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    };
    initializePage();
  }, [router]);
  
  const processedEquipments = useMemo(() => {
    return equipments.map(eq => {
      const lCalib = getLatestCalibDate(eq.histories);
      const nCalib = addMonthsToDateStr(lCalib, eq.calib_cycle_mo) || eq.next_calib_date?.split('T')[0];
      
      let isUrgent = false;
      if (nCalib) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const target = new Date(nCalib); target.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 30) isUrgent = true;
      }
      return { ...eq, nCalib, isUrgent };
    });
  }, [equipments]);
   
  const deptStats = useMemo(() => {
    const stats: Record<string, { total: number, urgent: number }> = {};
    processedEquipments.forEach(eq => {
      const dept = eq.department || '공용 (미지정)';
      if (!stats[dept]) stats[dept] = { total: 0, urgent: 0 };
      stats[dept].total += 1;
      if (eq.isUrgent) stats[dept].urgent += 1;
    });
    return stats;
  }, [processedEquipments]);
  
  const totalUrgentCount = processedEquipments.filter(e => e.isUrgent).length;
  
  const sortedDepts = useMemo(() => {
    const depts = Object.keys(deptStats);
    const unitOrderMap = new Map();
    units.forEach((u, idx) => { unitOrderMap.set(u.unit_name, idx); });
  
    return depts.sort((a, b) => {
      if (a === 'KPCQA') return -1;
      if (b === 'KPCQA') return 1;
      if (a === '공용 (미지정)') return 1;
      if (b === '공용 (미지정)') return -1;
      
      const orderA = unitOrderMap.has(a) ? unitOrderMap.get(a) : 9999;
      const orderB = unitOrderMap.has(b) ? unitOrderMap.get(b) : 9999;
      if (orderA !== orderB) return orderA - orderB;
  
      const getWeight = (name: string) => {
        if (name.endsWith('본부')) return 1;
        if (name.endsWith('센터')) return 2;
        if (name.endsWith('팀') || name.endsWith('실')) return 3;
        return 4;
      };
      const weightA = getWeight(a);
      const weightB = getWeight(b);
      if (weightA !== weightB) return weightA - weightB;
      return a.localeCompare(b, 'ko-KR');
    });
  }, [deptStats, units]);
   
  const filteredEquipments = useMemo(() => {
    return processedEquipments.filter(eq => {
      const s = searchQuery.toLowerCase().trim();
      const matchSearch = !s || 
        (eq.name || '').toLowerCase().includes(s) || 
        (eq.model_name || '').toLowerCase().includes(s) ||
        (eq.asset_no || '').toLowerCase().includes(s);
        
      const matchDept = selectedDept === 'ALL' || (eq.department || '공용 (미지정)') === selectedDept;
      const matchUrgent = showUrgentOnly ? eq.isUrgent : true;
   
      return matchSearch && matchDept && matchUrgent;
    });
  }, [processedEquipments, searchQuery, selectedDept, showUrgentOnly]);
   
  useEffect(() => { setCurrentPage(1); }, [searchQuery, selectedDept, showUrgentOnly]);
   
  const totalPages = Math.max(1, Math.ceil(filteredEquipments.length / itemsPerPage));
  const paginatedEquipments = filteredEquipments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
   
  if (loading) return <div className="p-20 text-center font-black text-indigo-500 animate-pulse text-xl tracking-widest">Routing checking...</div>;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in relative z-10">
      
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[120px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex justify-between items-center w-full">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-1">Integrated Equipment Hub</p>
            <h1 className="text-2xl font-black tracking-tight text-white">전사 통합 장비 관제탑</h1>
            <p className="text-blue-100 text-xs font-semibold mt-2 opacity-90">전사 부서별 장비 보유 현황을 파악하고 다가오는 검교정 일정을 관리합니다.</p>
          </div>
  
          <div className="flex items-center gap-6 text-right">
            <div onClick={() => setShowUrgentOnly(!showUrgentOnly)} className={`cursor-pointer flex flex-col justify-center px-5 py-3 rounded-2xl border transition-all ${showUrgentOnly ? 'bg-red-500 border-red-400 text-white shadow-[0_0_20px_rgba(239,68,68,0.6)] scale-105' : 'bg-slate-900/40 border-white/10 text-white hover:bg-slate-900/60'}`}>
              <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 flex items-center justify-end gap-1.5 ${showUrgentOnly ? 'text-red-100' : 'text-red-300'}`}><span className="animate-pulse">🚨</span> 검교정 예정 (D-30)</p>
              <p className="text-2xl font-black">{totalUrgentCount} <span className="text-xs font-medium opacity-80">건 확인요망</span></p>
            </div>
            <div className="h-12 w-px bg-white/20"></div>
            <div className="flex flex-col justify-center pr-2">
              <p className="text-[11px] text-blue-200 font-bold uppercase tracking-widest mb-1">Total Active</p>
              <p className="text-4xl font-black text-white">{equipments.length} <span className="text-lg text-blue-200 font-medium">EA</span></p>
            </div>
          </div>
        </div>
      </div>
   
      <div>
        <div className="flex justify-between items-end mb-3 px-2 mt-4">
          <h3 className="font-black text-sm text-slate-800 flex items-center gap-2"><span>🏢</span> 부서별 장비 보유 현황</h3>
          <p className="text-[10px] text-slate-400 font-bold">카드를 클릭하면 하단 리스트가 필터링됩니다. 빨간 점(🚨)은 검교정이 임박한 장비가 있음을 뜻합니다.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div onClick={() => setSelectedDept('ALL')} className={`cursor-pointer p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1 shadow-sm relative ${selectedDept === 'ALL' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-indigo-50'}`}>
            {totalUrgentCount > 0 && selectedDept !== 'ALL' && (
               <span className="absolute top-3 right-3 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span></span>
            )}
            <span className="text-[10px] font-black uppercase tracking-widest opacity-80">전체 보기</span><span className="text-xl font-black">{equipments.length}</span>
          </div>
          
          {sortedDepts.map((dept) => {
            const hasUrgent = deptStats[dept].urgent > 0;
            const isSelected = selectedDept === dept;
            return (
              <div key={dept} onClick={() => setSelectedDept(dept)} className={`cursor-pointer p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1 shadow-sm relative ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : hasUrgent ? 'bg-red-50 border-red-200 text-slate-700 hover:bg-red-100' : 'bg-white border-slate-200 text-slate-600 hover:bg-indigo-50'}`}>
                {hasUrgent && !isSelected && (
                   <span className="absolute top-3 right-3 flex h-3 w-3" title={`긴급: ${deptStats[dept].urgent}건`}><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white"></span></span>
                )}
                <span className={`text-[11px] font-black truncate w-full text-center ${hasUrgent && !isSelected ? 'text-red-600' : 'opacity-90'}`}>{dept}</span>
                <span className="text-xl font-black">{deptStats[dept].total}</span>
              </div>
            );
          })}
        </div>
      </div>
   
      <div className={`mt-6 bg-white border rounded-[2.5rem] shadow-sm overflow-hidden transition-all duration-300 ${showUrgentOnly ? 'border-red-300 shadow-[0_4px_20px_rgba(239,68,68,0.1)]' : 'border-slate-200'}`}>
        <HeaderLight title={showUrgentOnly ? `🚨 검교정 임박/지연 장비 (${selectedDept === 'ALL' ? '전체' : selectedDept})` : selectedDept === 'ALL' ? '전체 장비 리스트' : `[${selectedDept}] 보유 장비`} count={filteredEquipments.length}>
          <div className="relative w-64"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span><input type="text" placeholder="품목명, 시리얼, 자산번호 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-1.5 text-[11px] font-bold bg-white border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-slate-400 transition-all" /></div>
        </HeaderLight>
   
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1350px]">
            <thead className={`${showUrgentOnly ? 'bg-red-50' : 'bg-slate-100'} text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200`}>
              <tr>
                <th className="h-12 pl-6 text-center w-12">NO</th>
                <th className="h-12 px-3 text-center w-16">사진</th>
                <th className="h-12 px-3 w-28">자산번호</th>
                <th className="h-12 px-3 w-40 text-indigo-600">품목명</th>
                <th className="h-12 px-3 w-28">제조사</th>
                <th className="h-12 px-3 w-32">모델명/S.N</th>
                <th className="h-12 px-3 w-20 text-center">보유개수</th>
                <th className="h-12 px-3 w-48">제품사양</th>
                <th className="h-12 px-3 w-36 text-center text-red-600">검교정예정일</th>
                <th className="h-12 px-3 w-32 text-center">장비관리소속</th>
                <th className="h-12 px-3 w-20 text-center">QR</th>
                <th className="h-12 pr-6 w-28 text-center">바로가기</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedEquipments.length === 0 ? (
                <tr><td colSpan={12} className="p-12 text-center text-slate-400">조건에 맞는 장비가 없습니다.</td></tr>
              ) : paginatedEquipments.map((eq, idx) => (
                <tr key={eq.id} className={`h-16 hover:bg-slate-50/50 transition-colors ${eq.isUrgent ? 'bg-red-50/30' : ''}`}>
                  <td className="pl-6 text-center text-slate-400 font-mono">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                  <td className="text-center">{parseFileData(eq.thumbnail_url)?.data || eq.thumbnail_url ? <img src={parseFileData(eq.thumbnail_url)?.data || eq.thumbnail_url} alt="IMG" className="w-10 h-10 object-cover rounded-md mx-auto border" /> : <div className="w-10 h-10 bg-slate-100 rounded-md mx-auto flex items-center justify-center text-[8px] text-slate-300 border">NO</div>}</td>
                  <td className="px-3 font-mono font-black text-slate-900">{displayAssetNo(eq.asset_no)}</td>
                  <td className="px-3 text-indigo-700 text-[12px]">{eq.name}</td>
                  <td className="px-3 text-slate-600 font-medium">{eq.brand || '-'}</td>
                  <td className="px-3 text-slate-500 font-medium text-[10px]">{eq.model_name || '-'}</td>
                  <td className="text-center font-bold text-slate-700">{eq.qty} EA</td>
                  <td className="px-3 text-slate-500 truncate max-w-[150px] font-medium text-[11px]">{eq.spec_summary || '-'}</td>
                  <td className="px-3 text-center">{eq.nCalib ? <div className="flex flex-col items-center justify-center"><span className={`font-mono ${eq.isUrgent ? 'text-red-600' : 'text-slate-700'}`}>{eq.nCalib}</span>{renderDDay(eq.nCalib)}</div> : <span className="text-slate-300">-</span>}</td>
                  <td className="text-center text-slate-600">{eq.department || '공용'}</td>
                  <td className="text-center"><button type="button" onClick={(e) => { e.stopPropagation(); setShowQrModal(eq); }} className="px-2 py-1 bg-white border border-purple-200 text-purple-600 rounded text-[10px] hover:bg-purple-50 transition-colors shadow-sm">QR보기</button></td>
                  <td className="pr-6 text-center">
                    {/* 🚀 1. 버튼 수정: 꼬리표(detailId) 달아서 관리페이지로 슛! */}
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        router.push(`/equipment/main/${eq.category}/inventory?detailId=${eq.id}`); 
                      }}
                      className={`px-3 py-1.5 border rounded-lg text-[10px] font-black transition-colors shadow-sm w-full ${eq.isUrgent ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-600 hover:text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-800 hover:text-white'}`}
                    >
                      상세 이동
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>)}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
          </div>
        )}
      </div>
  
      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4" onClick={() => setShowQrModal(null)}>
          <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center mb-6">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">장비 QR 라벨</h3>
              <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-[10px] font-black">{showQrModal.department || '공용'}</span>
            </div>
            <div className="bg-white p-4 border-2 border-slate-100 rounded-2xl shadow-sm mb-4">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`https://kpc-asset.vercel.app/equipment/verify?id=${displayAssetNo(showQrModal.asset_no)}`)}`} alt="Asset QR Code" className="w-48 h-48 bg-white p-2" />
            </div>
            <p className="text-slate-800 font-black text-xl mb-1">{displayAssetNo(showQrModal.asset_no)}</p>
            <p className="text-slate-400 text-xs font-bold mb-6 truncate max-w-[200px] text-center">{showQrModal.name} / {showQrModal.model_name || '모델명 없음'}</p>
            <div className="flex gap-2 w-full mt-6"><button type="button" onClick={() => setShowQrModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}