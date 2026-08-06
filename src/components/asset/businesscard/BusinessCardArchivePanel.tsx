'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import * as XLSX from 'xlsx'; // 🚀 엑셀 다운로드를 위한 라이브러리 추가
import Link from 'next/link';
import { resolveInterfaceEditState } from '@/lib/permission-utils';

const MENU_PATH = '/asset/businesscard/master/archive';

const MASTER_TABS = [
  { id: 'requests', path: '/asset/businesscard/master/requests', name: '📋 사용자 신청현황 관리', activeColor: 'text-indigo-600' },
  { id: 'order', path: '/asset/businesscard/master/order', name: '📦 외주 발주 관리/견적 비교', activeColor: 'text-emerald-600' },
  { id: 'archive', path: '/asset/businesscard/master/archive', name: '📁 정산 완료 보관함', activeColor: 'text-slate-800' },
] as const;

interface RequestItem {
  id: string;
  postNumber: string;
  userName: string;
  deptHead: string;
  deptName: string;
  title: string;
  quantity: number;
  adminStatus: string;
}

interface ArchivedBatch {
  id: string;
  orderDate: string;
  deptHeadGroup: string;
  totalCount: number;
  status: string;
  items: RequestItem[];
  displayItems?: RequestItem[]; 
}

export default function BusinessCardArchivePanel() {
  const pathname = usePathname();
  const [archivedBatches, setArchivedBatches] = useState<ArchivedBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);

  // 검색 및 다중 필터 상태
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [nameSearch, setNameSearch] = useState<string>('');

  // 🚀 페이지네이션 상태 추가
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  useEffect(() => {
    const fetchArchivedData = async () => {
      try {
        const ts = Date.now();
        const [res, meRes, ifRes, summaryRes] = await Promise.all([
          fetch(`/api/asset/businesscard/master/order?isArchived=true&t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
            cache: 'no-store',
          }).catch(() => null),
        ]);
        if (res.ok) {
          const data = await res.json();
          setArchivedBatches(data);
        }
        if (meRes && meRes.ok) setCurrentUser(await meRes.json());
        if (ifRes && ifRes.ok) {
          const interfaces = await ifRes.json();
          const menu = Array.isArray(interfaces)
            ? interfaces.find(
                (m: any) =>
                  m.path === MENU_PATH || m.path?.includes('/businesscard/master/archive')
              )
            : null;
          setInterfaceConfig(menu || null);
        } else {
          setInterfaceConfig(null);
        }
        if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
        else setPermissionSummary(null);
      } catch (error) {
        console.error("보관함 데이터 로딩 실패:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchArchivedData();
  }, []);

  // 🚀 필터가 변경될 때마다 페이지를 1페이지로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [yearFilter, monthFilter, deptFilter, nameSearch]);

  const availableYears = Array.from(new Set(archivedBatches.map(b => b.orderDate?.substring(0, 4) || ''))).filter(Boolean).sort((a, b) => b.localeCompare(a));
  const availableMonths = Array.from(new Set(archivedBatches.map(b => b.orderDate?.substring(5, 7) || ''))).filter(Boolean).sort();
  const availableDepts = Array.from(new Set(archivedBatches.flatMap(b => b.items.map(item => item.deptHead)))).filter(Boolean).sort();

  const processedBatches = archivedBatches
    .filter(b => (yearFilter === 'ALL' || b.orderDate?.startsWith(yearFilter)) && 
                 (monthFilter === 'ALL' || b.orderDate?.split('-')[1] === monthFilter))
    .map(b => ({
      ...b,
      displayItems: b.items.filter(item => 
        (deptFilter === 'ALL' || item.deptHead === deptFilter) &&
        (nameSearch.trim() === '' || item.userName.includes(nameSearch.trim()))
      )
    }))
    .filter(b => b.displayItems && b.displayItems.length > 0);

  // 🚀 페이지네이션 계산
  const totalPages = Math.ceil(processedBatches.length / itemsPerPage) || 1;
  const paginatedBatches = processedBatches.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  let totalQty = 0;
  const deptStatsMap: Record<string, { names: Set<string>; qty: number }> = {};

  processedBatches.forEach(batch => {
    batch.displayItems?.forEach(item => {
      const q = item.quantity || 1;
      totalQty += q;
      
      if (!deptStatsMap[item.deptHead]) {
        deptStatsMap[item.deptHead] = { names: new Set(), qty: 0 };
      }
      deptStatsMap[item.deptHead].names.add(item.userName);
      deptStatsMap[item.deptHead].qty += q;
    });
  });

  const totalCalculatedPrice = totalQty * 20000; 

  // 🚀 엑셀 다운로드 함수 추가
  const handleBatchExcelDownload = (batch: ArchivedBatch, e: React.MouseEvent) => {
    e.stopPropagation(); // 행 클릭(아코디언) 방지
    const excelData = batch.displayItems?.map(r => ({
      '관리번호': r.postNumber,
      '수량(통)': r.quantity || 1,
      '성명': r.userName,
      '본부': r.deptHead,
      '소속': r.deptName || '',
      '직책/직급': r.title,
      '최종 정산액': (r.quantity || 1) * 20000
    })) || [];
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "정산완료데이터");
    XLSX.writeFile(wb, `명함결산내역_${batch.id}.xlsx`);
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 고정 헤더 영역 */}
{/* client-search 배너 규격: emerald→teal · orbs · permission chips */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
  <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
  <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
  <div className="relative z-10">
    <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
      BUSINESS CARD TOTAL GOVERNANCE
    </h3>
    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
      전사 임직원 명함 발주 접수 통제 대장
    </h1>
    <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
      임직원이 신청한 명함의 국/영문 원본 조판 텍스트 데이터를 검수하고 외주 조판 공정으로 이관 제어하는 마스터 컨트롤 허브입니다.
    </p>
    {permissionSummary && (
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
          <span>👑 Master 책임자:</span>
          <span>{permissionSummary.masterName}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
          <span>👁️ Access:</span>
          <span>{permissionSummary.accessDesignate}</span>
          <span className="opacity-50">|</span>
          <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
          <span className="opacity-50">|</span>
          <span>Level: {permissionSummary.accessLevel}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
          <span>✍️ Edit:</span>
          <span>{permissionSummary.editDesignate}</span>
          <span className="opacity-50">|</span>
          <span>Level: {permissionSummary.editLevel}</span>
        </div>
        {!canEditMaster && (
          <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
            편집 권한 없음 — 조회만 가능
          </span>
        )}
      </div>
    )}
  </div>
</div>

{/* 탭 네비게이션 — client-search / distribution 스위처 규격 */}
<div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
  <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
    {MASTER_TABS.map((tab) => {
      const isActive = pathname.startsWith(tab.path);
      return (
        <Link
          key={tab.id}
          href={tab.path}
          className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
            isActive
              ? `bg-white ${tab.activeColor} shadow-sm border border-slate-200/80`
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>{tab.name}</span>
        </Link>
      );
    })}
  </div>
  <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
    ※ 탭을 클릭하여 신청현황·외주발주·보관함을 전환합니다.
  </p>
</div>

      {/* ========================================== */}
      {/* 🚀 패널 1: 상단 필터 및 대시보드 (Light Mode 분리) */}
      {/* ========================================== */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm p-8 space-y-6">
        
        {/* 타이틀 및 종합 필터바 */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-slate-100 pb-5">
          <div>
            <h2 className="text-xl font-black flex items-center gap-2 text-slate-800">🗄️ 과거 발주 및 지급 완료 묶음 결산 이력</h2>
            <p className="text-xs text-slate-500 mt-1.5">조건을 설정하면 해당 기간/부서의 명함 발주 통계와 결산 금액이 즉시 계산됩니다.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="bg-white text-slate-700 text-xs font-black p-2 rounded-xl border border-slate-200 outline-none cursor-pointer focus:border-indigo-400">
              <option value="ALL">🗓️ 전체 년도</option>
              {availableYears.map(year => <option key={year} value={year}>{year}년</option>)}
            </select>
            <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="bg-white text-slate-700 text-xs font-black p-2 rounded-xl border border-slate-200 outline-none cursor-pointer focus:border-indigo-400">
              <option value="ALL">📅 전체 월</option>
              {availableMonths.map(month => <option key={month} value={month}>{parseInt(month)}월</option>)}
            </select>
            <div className="w-[1px] h-6 bg-slate-300 mx-1"></div>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="bg-white text-slate-700 text-xs font-black p-2 rounded-xl border border-slate-200 outline-none cursor-pointer max-w-[180px] focus:border-indigo-400">
              <option value="ALL">🏢 전체 본부/부서</option>
              {availableDepts.map(dept => <option key={dept} value={dept}>{dept}</option>)}
            </select>
            <input 
              type="text" 
              placeholder="🔍 성명 검색..." 
              value={nameSearch}
              onChange={e => setNameSearch(e.target.value)}
              className="bg-white text-slate-700 text-xs font-black p-2 px-3 rounded-xl border border-slate-200 outline-none focus:border-indigo-400 w-32 placeholder-slate-400"
            />
          </div>
        </div>

{/* 실시간 결산 통계 대시보드 */}
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  {/* 좌측: 총계 요약 카드 (전체 테마와 어울리는 다크 그레이 톤으로 정돈) */}
  <div className="bg-slate-800 rounded-3xl p-6 shadow-md flex flex-col justify-center border border-slate-700">
    <h3 className="text-slate-400 text-[10px] font-black tracking-widest mb-4">TOTAL SUMMARY</h3>
    <div className="space-y-4">
      <div className="flex justify-between items-end border-b border-slate-600/50 pb-3">
        <span className="text-sm font-bold text-slate-300">총 발주 수량</span>
        <span className="text-3xl font-black text-white font-mono">{totalQty} <span className="text-sm font-normal text-slate-400 ml-0.5">통</span></span>
      </div>
      <div className="flex justify-between items-end">
        <span className="text-sm font-bold text-slate-300">외주 정산 총액 <span className="text-[10px] text-slate-400 font-normal ml-1">(단가 2만/통)</span></span>
        <span className="text-3xl font-black text-emerald-400 font-mono tracking-tight">₩{totalCalculatedPrice.toLocaleString()}</span>
      </div>
    </div>
  </div>

  {/* 🚀 우측: 부서별 결산 상세 현황 (스크롤 없이 최대한 많이 보이도록 초압축 디자인 적용) */}
  <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 h-48 flex flex-col overflow-hidden shadow-sm">
    {/* 리스트 헤더 (고정) */}
    <div className="bg-slate-50/90 backdrop-blur-sm px-5 py-3 border-b border-slate-200 flex justify-between items-center z-10 shrink-0">
      <h3 className="text-slate-500 text-[10px] font-black tracking-widest uppercase">Department Breakdown</h3>
      <span className="text-[10px] font-bold text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded-md">{Object.keys(deptStatsMap).length}개 부서</span>
    </div>

    {/* 데이터 리스트 (여백 다이어트 및 1줄 강제 정렬) */}
    <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
      {Object.keys(deptStatsMap).length === 0 ? (
        <p className="text-slate-400 text-xs text-center py-10 font-bold">조건에 맞는 데이터가 없습니다.</p>
      ) : (
        <div className="space-y-0.5">
          {Object.entries(deptStatsMap).sort((a,b) => b[1].qty - a[1].qty).map(([dept, data], idx) => (
            <div key={idx} className="flex flex-row items-center justify-between hover:bg-slate-50 transition-colors px-3 py-2 rounded-lg gap-3">
              {/* 부서명 (공간 최적화) */}
              <div className="w-[140px] shrink-0 font-black text-slate-700 text-[11px] truncate" title={dept}>
                {dept}
              </div>
              
              {/* 이름 나열 (여러 명이라도 강제로 1줄 처리하여 세로 공간 절약) */}
              <div className="flex-1 text-[11px] font-medium text-slate-500 truncate" title={Array.from(data.names).join(', ')}>
                {Array.from(data.names).join(', ')}
              </div>
              
              {/* 수량 및 정산액 */}
              <div className="shrink-0 flex items-center justify-end gap-4">
                <span className="text-[11px] font-black text-slate-500 w-8 text-right">{data.qty}통</span>
                <span className="text-[12px] font-black text-emerald-600 font-mono w-[70px] text-right">₩{(data.qty * 20000).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
</div>
</div>

      {/* ========================================== */}
      {/* 🚀 패널 2: 하단 보관함 데이터 표 (Light Mode 분리) */}
      {/* ========================================== */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 px-6 w-[180px]">묶음 번호</th>
                <th className="h-12 px-4 w-[120px]">발주 일자</th>
                <th className="h-12 px-4 min-w-[280px]">결산 포함 소속 (필터기준)</th>
                <th className="h-12 px-4 text-center w-[100px]">묶음 내 수량</th>
                <th className="h-12 px-4 text-center w-[120px]">결산 상태</th>
                <th className="h-12 px-6 text-center w-[140px]">엑셀 다운로드</th>
              </tr>
            </thead>
            
            <tbody className="text-xs font-bold divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">데이터를 불러오는 중입니다...</td></tr>
              ) : paginatedBatches.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400 font-mono">검색 조건에 일치하는 결산 내역이 없습니다.</td></tr>
              ) : (
                paginatedBatches.map((batch) => (
                  <React.Fragment key={batch.id}>
                    {/* 🚀 메인 행 (밝은 톤) */}
                    <tr 
                      className="h-16 hover:bg-slate-50 cursor-pointer transition-colors" 
                      onClick={() => setExpandedBatchId(expandedBatchId === batch.id ? null : batch.id)}
                    >
                      <td className="px-6 font-mono text-indigo-600">{expandedBatchId === batch.id ? '📂' : '📁'} {batch.id}</td>
                      <td className="px-4 text-slate-500 font-mono">{batch.orderDate}</td>
                      <td className="px-4 text-slate-700 truncate max-w-xs">{Array.from(new Set(batch.displayItems?.map(i => i.deptHead))).join(', ')}</td>
                      <td className="px-4 text-center text-rose-500 font-black">{batch.displayItems?.reduce((sum, item) => sum + (item.quantity||1), 0)} 통</td>
                      <td className="px-4 text-center">
                        <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 text-[10px]">정산완료 🔒</span>
                      </td>
                      <td className="px-6 text-center">
                        <button 
                          onClick={(e) => handleBatchExcelDownload(batch, e)} 
                          className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-black text-[10px] rounded-lg border border-slate-300 w-full transition-colors shadow-sm"
                        >
                          📊 엑셀 내역
                        </button>
                      </td>
                    </tr>
                    
                    {/* 🚀 아코디언 상세 내역 (밝은 톤) */}
                    {expandedBatchId === batch.id && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50 p-6 border-l-4 border-indigo-400 shadow-inner">
                          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-indigo-50/50 text-indigo-900 font-black tracking-widest border-b border-indigo-100 text-[10px]">
                                <tr>
                                  <th className="h-10 px-4 w-[60px]">NO</th>
                                  <th className="h-10 px-4 w-[120px]">관리번호</th>
                                  <th className="h-10 px-4 w-[200px]">소속</th>
                                  <th className="h-10 px-4 w-[120px]">이름</th>
                                  <th className="h-10 px-4 w-[150px]">직책 / 직급</th>
                                  <th className="h-10 px-4 text-center w-[80px]">수량(통)</th>
                                  <th className="h-10 px-4 text-right w-[120px]">최종 정산액</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                                {batch.displayItems?.map((item: any, idx: number) => (
                                  <tr key={item.id} className="h-12 hover:bg-slate-50/50">
                                    <td className="px-4 font-mono text-slate-400">{idx + 1}</td>
                                    <td className="px-4 font-mono text-indigo-600">{item.postNumber}</td>
                                    <td className="px-4 text-slate-600">{item.deptHead} <span className="text-[10px] text-slate-400">({item.deptName})</span></td>
                                    <td className="px-4 font-black text-slate-900">{item.userName}</td>
                                    <td className="px-4 font-medium text-slate-500">{item.title}</td>
                                    <td className="px-4 text-center text-rose-600 font-black">{item.quantity || 1}</td>
                                    <td className="px-4 text-right font-mono text-emerald-600">₩{((item.quantity || 1) * 20000).toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 🚀 페이지네이션 컨트롤러 */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button 
                key={i} 
                onClick={() => setCurrentPage(i + 1)} 
                className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-indigo-600 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                {i + 1}
              </button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
          </div>
        )}
      </div>

    </div>
  );
}