'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function AssetMainDashboard() {
  return (
    <div className="p-12 space-y-10 bg-slate-50/30 min-h-screen font-sans">
      <div className="space-y-2">
        <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic">Asset Management</h2>
        <p className="text-slate-400 font-black text-sm tracking-widest uppercase">경영자산 통합 대시보드</p>
        <div className="h-1.5 w-12 bg-blue-600 rounded-full mt-4" />
      </div>

      <div className="grid grid-cols-3 gap-8">
        {/* 요약 카드들 */}
        <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-xl">
          <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Total IT Assets</p>
          <p className="text-4xl font-black text-blue-600">124 <span className="text-sm text-slate-300">EA</span></p>
        </div>
        <div className="bg-slate-900 p-8 rounded-[3rem] shadow-xl text-white">
          <p className="text-[10px] font-black text-slate-500 uppercase mb-2 text-blue-400">Monthly Supplies</p>
          <p className="text-4xl font-black italic tracking-tighter">98% <span className="text-sm text-slate-500">Stock</span></p>
        </div>
      </div>

      <div className="bg-blue-50 p-10 rounded-[4rem] border border-blue-100 flex items-center justify-between">
        <div className="space-y-1">
          <h4 className="text-xl font-black text-slate-900">상단 메뉴를 선택하여 상세 관리를 시작하세요.</h4>
          <p className="text-sm text-slate-500 font-bold">IT정보자산, 소모품, 마케팅물품 등 카테고리별 업무가 분리되어 있습니다.</p>
        </div>
        <Link href="/asset/it/master" className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs hover:bg-blue-600 transition-all">
          IT 관리자 페이지 바로가기 →
        </Link>
      </div>
    </div>
  );
}