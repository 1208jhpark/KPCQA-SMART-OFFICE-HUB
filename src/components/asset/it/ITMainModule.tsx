'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';

function ITMainContent() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => { 
    fetchData(); 
    fetchCurrentUser();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) setCurrentUser(await res.json());
    } catch (e) { console.error("User fetch error", e); }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asset/it/dashboard?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } catch (e) { console.error("Data fetch error", e); }
    setLoading(false);
  };

  // 🚀 전사 자산 통계 계산 (레이아웃에 맞게 가공)
  const assetStats = useMemo(() => {
    if (!data) return { totalTypes: 0, totalStock: 0, hw: 0, sw: 0 };
    
    const items = data.items || [];
    const activeItems = items.filter((i: any) => i.is_active !== false);
    
    return { 
      totalTypes: data.types ? Object.keys(data.types).length : 0,
      totalStock: data.stats?.total || activeItems.length || 0,
      hw: data.stats?.hw || activeItems.filter((i: any) => String(i.category).includes('하드웨어') || String(i.category).toUpperCase().includes('HARDWARE')).length || 0,
      sw: data.stats?.sw || activeItems.filter((i: any) => String(i.category).includes('소프트웨어') || String(i.category).toUpperCase().includes('SOFTWARE')).length || 0,
    };
  }, [data]);

  let myRole = 'LV_3';
  if (currentUser) {
    let rolesArr = [];
    try { rolesArr = Array.isArray(currentUser.roles) ? currentUser.roles : (currentUser.roles ? JSON.parse(currentUser.roles) : []); } catch(e) {}
    const firstRole = rolesArr[0] || currentUser.role || currentUser.level || 'LV_3';
    myRole = String(firstRole).toUpperCase().replace(/LV/g, 'LV_').replace(/__/g, '_');
  }
  const isLV1 = myRole === 'LV_1';

  const notice = data?.notice || { isActive: false };
  const participationRate = data?.auditProgress || 0;

  if (loading) return <div className="p-20 text-center font-black animate-pulse text-slate-400 uppercase tracking-widest">Loading IT Intelligence...</div>;

  return (
    <div className="space-y-6 font-sans text-slate-800 pb-20 max-w-6xl mx-auto px-4 md:px-0 animate-fade-in">
      
      {/* 🚀 1. 헤더 배너 (고급스러운 다크 슬레이트) */}
      <div className="bg-slate-900 h-24 rounded-[1.5rem] shadow-xl relative flex items-center px-10 overflow-hidden">
        <div className="absolute right-0 top-0 w-80 h-full bg-gradient-to-l from-indigo-500/20 to-transparent pointer-events-none" />
        <div className="flex items-center gap-5 z-10">
          <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-2xl shadow-inner backdrop-blur-sm">💻</div>
          <div className="flex flex-col justify-center">
            <h2 className="font-black tracking-tight text-white text-xl uppercase">IT·업무자산 통합 관제 대시보드</h2>
            <p className="text-[10px] text-indigo-300 font-bold tracking-widest mt-0.5 opacity-80 uppercase">H/W, S/W, Office Equipment Governance</p>
          </div>
        </div>
      </div>

      {/* 🚀 2. 상단 3개 카드 섹션 (타이트한 그리드) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* 나의 IT 자산 바로가기 */}
        <Link href="/asset/it/personal" className="group bg-white rounded-[1.5rem] p-6 border border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-400 transition-all flex flex-col justify-between h-48">
          <div className="flex justify-between items-start">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🧑‍💻</div>
            <span className="text-slate-300 group-hover:text-indigo-500 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </span>
          </div>
          <div>
            <h3 className="text-base font-black text-slate-800">나의 IT·업무자산</h3>
            <p className="text-[11px] text-slate-400 font-bold mt-1 leading-tight">개인 지급 물품 확인 및 장애/반납 관리</p>
          </div>
        </Link>

        {/* 부서 자산 현황 바로가기 */}
        <Link href="/asset/it/dept" className="group bg-white rounded-[1.5rem] p-6 border border-slate-200 shadow-sm hover:shadow-lg hover:border-emerald-400 transition-all flex flex-col justify-between h-48">
          <div className="flex justify-between items-start">
            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🏢</div>
            <span className="text-slate-300 group-hover:text-emerald-500 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </span>
          </div>
          <div>
            <h3 className="text-base font-black text-slate-800">부서 IT·업무자산 현황</h3>
            <p className="text-[11px] text-slate-400 font-bold mt-1 leading-tight">부서 공용 자산 및 구성원 지급 내역 조회</p>
          </div>
        </Link>

        {/* 전사 자산 요약 (그래프 삭제 후 타이트한 요약으로 변경) */}
        <div className="bg-slate-900 rounded-[1.5rem] p-6 text-white shadow-lg flex flex-col justify-between h-48">
          <div className="flex justify-between items-center">
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Total Assets Stats</h3>
            <span className="text-[10px] text-slate-500 font-bold">실시간 집계</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-center flex-1 border-r border-slate-800">
              <p className="text-[10px] text-slate-500 font-bold mb-1 uppercase">H/W</p>
              <p className="text-xl font-black text-white font-mono">{assetStats.hw}</p>
            </div>
            <div className="text-center flex-1 border-r border-slate-800">
              <p className="text-[10px] text-slate-500 font-bold mb-1 uppercase">S/W</p>
              <p className="text-xl font-black text-white font-mono">{assetStats.sw}</p>
            </div>
            <div className="text-center flex-1">
              <p className="text-[10px] text-slate-500 font-bold mb-1 uppercase">Total</p>
              <p className="text-xl font-black text-indigo-400 font-mono">{assetStats.totalStock}</p>
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 flex justify-between items-center border border-white/10">
            <span className="text-[10px] font-bold text-slate-400">품목 분류 체계</span>
            <span className="text-[11px] font-black text-indigo-300">{assetStats.totalTypes} <span className="text-[9px] text-slate-500">종</span></span>
          </div>
        </div>
      </div>

      {/* 🚀 3. 실사 공지 섹션 (보다 정돈된 디자인) */}
      {notice.isActive && (
        <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in slide-in-from-bottom-2 duration-500">
          <div className="p-5 bg-slate-50 border-b flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="bg-red-500 w-2 h-2 rounded-full animate-ping" />
              <h3 className="font-black text-slate-800 text-sm">{notice.title || '정기 실사 안내'}</h3>
            </div>
            {isLV1 && (
              <Link href="/asset/it/notices" className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-[9px] font-black hover:bg-slate-700 transition-colors">
                ⚙️ 실사 공지 및 이력 관리
              </Link>
            )}
          </div>
          
          <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            {/* 공지 상세 정보 */}
            <div className="md:col-span-7 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">실사 기준일</span>
                  <p className="text-sm font-black text-indigo-600 font-mono">{notice.targetDate || '-'}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">참여 기간</span>
                  <p className="text-sm font-bold text-slate-700 font-mono">{notice.startDate || '-'} ~ {notice.endDate || '-'}</p>
                </div>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-inner">
                <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">관리자 공지</span>
                <p className="text-[12px] font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">{notice.description || '내용이 없습니다.'}</p>
              </div>
            </div>

            {/* 참여도 및 행동 버튼 */}
            <div className="md:col-span-5 flex flex-col justify-center space-y-5 border-l border-slate-100 pl-8">
              {notice.showProgress !== false && (
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">전사 실사 진행률</span>
                    <span className="text-2xl font-black text-indigo-600 font-mono leading-none">{participationRate}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all duration-1000" style={{ width: `${participationRate}%` }} />
                  </div>
                </div>
              )}
              
              <Link href="/asset/it/personal" className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[13px] font-black hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2 group">
                👉 나의 IT·업무자산 실사하러 가기
                <span className="opacity-0 group-hover:translate-x-1 group-hover:opacity-100 transition-all">→</span>
              </Link>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}

export default function ITMainModule() {
  return (
    <Suspense fallback={<div className="p-10 font-black animate-pulse text-indigo-400 text-center uppercase tracking-widest">Booting Hub Dashboard...</div>}>
      <ITMainContent />
    </Suspense>
  );
}