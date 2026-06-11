'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

export default function EquipmentMainDashboard() {
  const router = useRouter();
  const [equipments, setEquipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    const initializePage = async () => {
      try {
        // 🚀 1. 어드민 라우팅 설정값(진입 동작 모드) 먼저 확인
        const menuRes = await fetch('/api/admin/interface');
        const menus = await menuRes.json();
        
        // 현재 경로(/equipment/main)의 설정값 찾기
        const currentMenu = menus.find((m: any) => m.path === '/equipment/main');
        
        // "1번 카드 즉시 실행"으로 설정되어 있다면, 하위 메뉴(L3)를 찾아 가장 빠른 순서로 튕겨냅니다.
        if (currentMenu && currentMenu.l2_entry_mode === 'L3_DEFAULT') {
          const children = menus
            .filter((m: any) => m.parent_id === currentMenu.id && m.is_active)
            .sort((a: any, b: any) => a.sort_order - b.sort_order);
            
          if (children.length > 0) {
            router.replace(children[0].path); // 즉시 1번 카드 경로로 이동
            return; // 렌더링 중단
          }
        }

        // 🚀 2. "기획화면" 모드일 경우에만 전사 장비 데이터를 가져와 대시보드 렌더링
        const eqRes = await fetch('/api/equipment');
        const eqData = await eqRes.json();
        
        const activeEquipments = eqData.filter((e: any) => e.status === '정상');
        setEquipments(activeEquipments);
        setLoading(false);

      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    };

    initializePage();
  }, [router]);

  const deptStats = useMemo(() => {
    const stats: Record<string, number> = {};
    equipments.forEach(eq => {
      const dept = eq.department || '공용 (미지정)';
      stats[dept] = (stats[dept] || 0) + 1;
    });
    return stats;
  }, [equipments]);

  const filteredEquipments = useMemo(() => {
    return equipments.filter(eq => {
      const s = searchQuery.toLowerCase().trim();
      const matchSearch = !s || 
        (eq.name || '').toLowerCase().includes(s) || 
        (eq.model_name || '').toLowerCase().includes(s) ||
        (eq.asset_no || '').toLowerCase().includes(s);
        
      const matchDept = selectedDept === 'ALL' || (eq.department || '공용 (미지정)') === selectedDept;

      return matchSearch && matchDept;
    });
  }, [equipments, searchQuery, selectedDept]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDept]);

  const totalPages = Math.max(1, Math.ceil(filteredEquipments.length / itemsPerPage));
  const paginatedEquipments = filteredEquipments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading) return <div className="p-20 text-center font-black text-indigo-500 animate-pulse text-xl tracking-widest">Routing checking...</div>;

  return (
    <div className="p-8 space-y-6 font-sans text-slate-900 animate-fade-in relative z-10 max-w-[1600px] mx-auto">
      
      {/* 1. 상단 대시보드 헤더 */}
      <div className="bg-slate-900 p-8 rounded-[2rem] shadow-xl flex justify-between items-center text-white bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-indigo-500 rounded-full blur-3xl opacity-20"></div>
        <div className="relative z-10">
          <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest mb-2">Integrated Equipment Hub</p>
          <h2 className="text-3xl font-black tracking-tight">전사 통합 장비 관제탑</h2>
        </div>
        <div className="relative z-10 text-right">
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total Active Equipments</p>
          <p className="text-5xl font-black text-white">{equipments.length} <span className="text-lg text-slate-400 font-medium">EA</span></p>
        </div>
      </div>

      {/* 2. 부서별 장비 보유 현황 (클릭 필터) */}
      <div>
        <div className="flex justify-between items-end mb-3 px-2">
          <h3 className="font-black text-sm text-slate-800 flex items-center gap-2"><span>🏢</span> 부서별 장비 보유 현황</h3>
          <p className="text-[10px] text-slate-400 font-bold">카드를 클릭하면 하단 리스트가 필터링됩니다.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div 
            onClick={() => setSelectedDept('ALL')}
            className={`cursor-pointer p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1 shadow-sm ${selectedDept === 'ALL' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-indigo-50'}`}
          >
            <span className="text-[10px] font-black uppercase tracking-widest opacity-80">전체 보기</span>
            <span className="text-xl font-black">{equipments.length}</span>
          </div>
          
          {Object.entries(deptStats).map(([dept, count]) => (
            <div 
              key={dept} 
              onClick={() => setSelectedDept(dept)}
              className={`cursor-pointer p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1 shadow-sm ${selectedDept === dept ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-indigo-50'}`}
            >
              <span className="text-[11px] font-black truncate w-full text-center opacity-90">{dept}</span>
              <span className="text-xl font-black">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. 토탈 검색 및 리스트 테이블 */}
      <div className="bg-white border border-slate-200 shadow-sm rounded-[2rem] overflow-hidden">
        <div className="p-5 px-6 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-4 justify-between items-center">
          <h3 className="font-black text-sm text-slate-800 flex items-center gap-2">
            <span>📋</span> {selectedDept === 'ALL' ? '전체 장비 리스트' : `[${selectedDept}] 보유 장비`} <span className="text-indigo-600 ml-1">({filteredEquipments.length}건)</span>
          </h3>
          <div className="relative w-full max-w-sm">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
            <input 
              type="text" 
              placeholder="품목명, 모델명/시리얼넘버, 자산번호 검색..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 transition-all shadow-inner"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1000px]">
            <thead className="bg-white text-[10px] text-slate-400 font-black border-b border-slate-200 tracking-tight uppercase">
              <tr>
                <th className="py-4 px-4 text-center w-16">NO</th>
                <th className="py-4 px-3 w-36">자산번호</th>
                <th className="py-4 px-3 w-48 text-indigo-600">품목명</th>
                <th className="py-4 px-3 w-40">모델명/시리얼넘버</th>
                <th className="py-4 px-3 w-32 text-center">장비관리소속</th>
                <th className="py-4 px-3 w-24 text-center">보유개수</th>
                <th className="py-4 px-4 w-32 text-center">바로가기</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedEquipments.length === 0 ? (
                <tr><td colSpan={7} className="p-12 text-center text-slate-400">조건에 맞는 장비가 없습니다.</td></tr>
              ) : paginatedEquipments.map((eq, idx) => (
                <tr key={eq.id} className="hover:bg-indigo-50/30 h-14 transition-colors">
                  <td className="text-center text-slate-400">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                  <td className="px-3 font-black text-slate-900">{eq.asset_no?.split('_ARC_')[0] || '-'}</td>
                  <td className="px-3 text-indigo-700 text-[12px]">{eq.name}</td>
                  <td className="px-3 text-slate-500">{eq.model_name || '-'}</td>
                  <td className="text-center text-slate-600">{eq.department || '공용'}</td>
                  <td className="text-center">{eq.qty} EA</td>
                  <td className="text-center px-4">
                    <button 
                      onClick={() => router.push(`/equipment/main/${eq.category}/inventory`)}
                      className="px-4 py-2 bg-slate-800 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 transition-colors shadow-sm w-full"
                    >
                      상세 카테고리로 이동
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center gap-1.5 p-5 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button 
                type="button" 
                key={i} 
                onClick={() => setCurrentPage(i + 1)} 
                className={`w-8 h-8 rounded-lg text-[11px] font-black border transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100 shadow-sm'}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}