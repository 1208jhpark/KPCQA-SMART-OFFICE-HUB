// src/app/(service)/equipment/main/page.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTDaysUntil } from '@/utils/dateUtils';
import { resolveCalibSchedule, toCalibYmd } from '@/utils/equipmentCalib';
import EquipmentQrImage from '@/components/equipment/EquipmentQrImage';
import { generateEquipmentQrDataUrls } from '@/utils/equipmentQr';

const LoadingSkeleton = () => (
  <div className="w-full max-w-[1600px] mx-auto py-16 px-8 space-y-6 animate-pulse">
    <div className="w-full h-36 bg-slate-200 rounded-xl" />
    <div className="w-full h-28 bg-slate-200 rounded-xl" />
    <div className="w-64 h-8 bg-slate-200 rounded-lg" />
    <div className="w-full h-72 bg-slate-200 rounded-xl" />
  </div>
);

const displayAssetNo = (no: string) => no?.split('_ARC_')[0] || '-';
const parseFileData = (str: string | null) => { try { return str ? JSON.parse(str) : null; } catch { return null; } };

const resolveImageSrc = (raw: string | null | undefined) => {
  if (!raw) return null;
  const parsed = parseFileData(raw);
  const candidate = parsed?.data || (typeof raw === 'string' && !raw.trim().startsWith('{') ? raw : null);
  if (typeof candidate === 'string' && (candidate.startsWith('data:') || candidate.startsWith('http'))) {
    return candidate;
  }
  return null;
};

const renderDDay = (targetDate: string | null) => {
  if (!targetDate) return null;
  const ymd = toCalibYmd(targetDate);
  if (!ymd) return null;
  const diffDays = getKSTDaysUntil(ymd);
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
  const [selectedMainIds, setSelectedMainIds] = useState<Set<string>>(new Set());
  const [bulkPrintAssets, setBulkPrintAssets] = useState<any[]>([]);
  const [bulkQrMap, setBulkQrMap] = useState<Record<string, string>>({});
  const [bulkQrReady, setBulkQrReady] = useState(false);
   
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

        if (!eqRes.ok) {
          console.error('equipment load failed', eqRes.status);
          setEquipments([]);
          setLoading(false);
          return;
        }
  
        const eqData = await eqRes.json();
        const unitData = unitRes && unitRes.ok ? await unitRes.json() : [];
        
        const activeEquipments = Array.isArray(eqData)
          ? eqData.filter((e: any) => e.status === '정상')
          : [];
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
      const { nCalib, isDue } = resolveCalibSchedule(eq);
      return { ...eq, nCalib, isUrgent: isDue };
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
        (eq.serial_no || '').toLowerCase().includes(s) ||
        (eq.asset_no || '').toLowerCase().includes(s);
        
      const matchDept = selectedDept === 'ALL' || (eq.department || '공용 (미지정)') === selectedDept;
      const matchUrgent = showUrgentOnly ? eq.isUrgent : true;
   
      return matchSearch && matchDept && matchUrgent;
    });
  }, [processedEquipments, searchQuery, selectedDept, showUrgentOnly]);
   
  useEffect(() => {
    setCurrentPage(1);
    setSelectedMainIds(new Set());
  }, [searchQuery, selectedDept, showUrgentOnly]);
   
  const totalPages = Math.max(1, Math.ceil(filteredEquipments.length / itemsPerPage));
  const paginatedEquipments = filteredEquipments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleSelectMainAll = () => {
    const currentPageIds = paginatedEquipments.map((a) => a.id);
    const allSelected = currentPageIds.every((id) => selectedMainIds.has(id));
    const next = new Set(selectedMainIds);
    if (allSelected) currentPageIds.forEach((id) => next.delete(id));
    else currentPageIds.forEach((id) => next.add(id));
    setSelectedMainIds(next);
  };

  const openBulkQRPrint = () => {
    const targetAssets = filteredEquipments.filter((a) => selectedMainIds.has(a.id));
    if (targetAssets.length === 0) return alert('출력할 자산을 좌측 체크박스로 선택해주세요.');
    setBulkPrintAssets(targetAssets);
  };

  // 🖨️ 인쇄 전 QR 이미지를 전부 미리 생성 (생성 완료 전 인쇄 시 빈칸 방지)
  useEffect(() => {
    if (bulkPrintAssets.length === 0) {
      setBulkQrMap({});
      setBulkQrReady(false);
      return;
    }
    let cancelled = false;
    setBulkQrReady(false);
    generateEquipmentQrDataUrls(bulkPrintAssets.map((a) => a.id), 150)
      .then((map) => {
        if (!cancelled) {
          setBulkQrMap(map);
          setBulkQrReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setBulkQrReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bulkPrintAssets]);

  const handleExportExcel = () => {
    const targetAssets =
      selectedMainIds.size > 0
        ? filteredEquipments.filter((a) => selectedMainIds.has(a.id))
        : filteredEquipments;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = targetAssets.map((a, idx) => {
      const { nCalib } = resolveCalibSchedule(a);
      return {
        NO: targetAssets.length - idx,
        자산번호: displayAssetNo(a.asset_no),
        품목명: a.name,
        제조사: a.brand || '-',
        모델번호: a.model_name || '-',
        시리얼번호: a.serial_no || '-',
        보유개수: a.qty,
        제품사양: a.spec_summary || '-',
        구매일: a.purchase_date ? String(a.purchase_date).split('T')[0] : '-',
        검교정예정일: nCalib || '-',
        장비관리소속: a.department || '-',
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '전체장비');
    XLSX.writeFile(wb, `전체장비리스트_${getKSTDateString()}.xlsx`);
  };
   
  if (loading) return <LoadingSkeleton />;

  return (
<div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in relative z-10">
   
  
    {/* 관제탑 히어로 + 부서 현황 — 단일 배경 슬랩 (배너 카드 분리 없음) */}
    <div className="w-full relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white shadow-lg">
      <div className="absolute right-0 top-0 w-[28rem] h-[28rem] bg-sky-500/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
      <div className="absolute left-1/4 bottom-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl translate-y-1/3 pointer-events-none" />

      <div className="relative z-10 px-6 md:px-8 pt-6 pb-5">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center w-full gap-6">
          <div className="flex flex-col justify-center min-w-0">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <p className="text-[10px] font-black uppercase tracking-widest text-sky-400">
                CENTRAL EQUIPMENT CONTROL TOWER
              </p>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
              전사 통합 장비 관제탑
            </h1>
            <p className="text-slate-400 text-xs mt-3 leading-relaxed">
              전 부서 보유 자산 현황을 실시간 모니터링하고, 검교정 주기 및 만료 예정 장비를 관리합니다.
            </p>
          </div>

          <div className="flex items-stretch gap-3 shrink-0">
            <div
              onClick={() => setShowUrgentOnly(!showUrgentOnly)}
              className={`cursor-pointer flex items-center gap-4 px-5 py-3.5 min-h-[76px] rounded-xl border transition-all duration-200 ${
                showUrgentOnly
                  ? 'bg-red-950/80 border-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                  : 'bg-white/10 border-red-500/50 text-slate-200 hover:bg-white/15 hover:border-red-400/70'
              }`}
            >
              <div className="w-10 h-10 rounded-md bg-red-500/10 border border-red-500/30 flex items-center justify-center text-lg text-red-400 shrink-0">
                🚨
              </div>
              <div className="text-right leading-tight">
                <p className="text-[10px] font-black uppercase tracking-wider text-red-400">검교정 일정 확인</p>
                <p className="text-[9px] font-bold text-red-300/80 mt-0.5">D-30 · D+</p>
                <p className="text-xl font-black font-mono text-white mt-1">
                  {totalUrgentCount} <span className="text-[10px] text-slate-400 font-sans font-normal">건</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 px-5 py-3.5 min-h-[76px] rounded-xl bg-sky-500/15 border border-sky-400/40">
              <div className="w-10 h-10 rounded-md bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-lg text-sky-300 shrink-0">
                📦
              </div>
              <div className="text-right leading-tight">
                <p className="text-[10px] font-black uppercase tracking-wider text-sky-300">Total Active</p>
                <p className="text-[9px] font-bold text-sky-200/70 mt-0.5">보유 장비</p>
                <p className="text-xl font-black font-mono text-white mt-1">
                  {equipments.length} <span className="text-[10px] text-sky-200/80 font-sans font-normal">EA</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 px-6 md:px-8 pb-6 pt-4 border-t border-white/10 space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-2 px-0.5">
          <div className="flex items-center gap-2">
            <span className="text-base">🏢</span>
            <h3 className="font-black text-xs text-white tracking-tight">부서별 장비 보유 현황</h3>
            <span className="text-[10px] font-bold bg-white/10 text-slate-300 px-2 py-0.5 rounded-full border border-white/10">
              {sortedDepts.length}개 조직
            </span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium">
            ※ 부서를 클릭하면 하단 리스트가 필터링됩니다. 빨간 점(🚨)은 검교정 일정(D-30 또는 D+) 장비를 보유한 부서입니다.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          <button
            type="button"
            onClick={() => setSelectedDept('ALL')}
            className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-all relative ${
              selectedDept === 'ALL'
                ? 'bg-sky-500 border-sky-500 text-white font-black shadow-sm'
                : 'bg-white/5 border-white/10 text-slate-300 font-bold hover:bg-white/10 hover:border-white/20 hover:text-white'
            }`}
          >
            <span className="truncate">전체 보기</span>
            <span className={`text-[11px] font-black font-mono ml-2 px-1.5 py-0.2 rounded ${
              selectedDept === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-400'
            }`}>
              {equipments.length}
            </span>
          </button>

          {sortedDepts.map((dept) => {
            const hasUrgent = deptStats[dept].urgent > 0;
            const isSelected = selectedDept === dept;
            return (
              <button
                key={dept}
                type="button"
                onClick={() => setSelectedDept(dept)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-all relative group ${
                  isSelected
                    ? 'bg-sky-500 border-sky-500 text-white font-black shadow-sm'
                    : hasUrgent
                    ? 'bg-red-950/40 border-red-800/60 text-red-400 font-bold hover:bg-red-900/60 hover:border-red-500/50'
                    : 'bg-white/5 border-white/10 text-slate-300 font-bold hover:bg-white/10 hover:border-white/20 hover:text-white'
                }`}
              >
                {hasUrgent && !isSelected && (
                  <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5" title={`검교정 일정 확인: ${deptStats[dept].urgent}건`}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border border-slate-900" />
                  </span>
                )}

                <span className={`truncate ${hasUrgent && !isSelected ? 'text-red-400' : ''}`} title={dept}>
                  {dept}
                </span>

                <span className={`text-[11px] font-black font-mono ml-1.5 px-1.5 py-0.2 rounded shrink-0 ${
                  isSelected
                    ? 'bg-white/20 text-white'
                    : hasUrgent
                    ? 'bg-red-900/50 text-red-300'
                    : 'bg-slate-900/70 text-slate-300 group-hover:bg-slate-900 group-hover:text-white'
                }`}>
                  {deptStats[dept].total}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
   
      <div className={`mt-6 bg-white border rounded-[2.5rem] shadow-sm overflow-hidden transition-all duration-300 ${showUrgentOnly ? 'border-red-300 shadow-[0_4px_20px_rgba(239,68,68,0.1)]' : 'border-slate-200'}`}>
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`w-2.5 h-2.5 rounded-full ${showUrgentOnly ? 'bg-red-500' : 'bg-blue-600'}`}></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">
              {showUrgentOnly
                ? `🚨 검교정 일정 확인 D-30/D+ (${selectedDept === 'ALL' ? '전체' : selectedDept})`
                : selectedDept === 'ALL'
                  ? '전체 활성 장비 리스트'
                  : `[${selectedDept}] 보유 장비`}
            </h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredEquipments.length}건</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={openBulkQRPrint}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-[10px] font-black shadow-sm hover:bg-slate-50 transition-all whitespace-nowrap"
            >
              {selectedMainIds.size > 0
                ? `🖨️ QR 일괄출력(${selectedMainIds.size})`
                : '🖨️ QR 일괄출력'}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
            >
              {selectedMainIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedMainIds.size})`
                : '화면 목록 EXCEL 다운로드'}
            </button>
            <div className="relative w-56">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
              <input
                type="text"
                placeholder="품목명, 모델번호, 시리얼번호, 자산번호 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-[11px] font-bold bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
          </div>
        </div>
   
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1480px]">
            <thead className={`${showUrgentOnly ? 'bg-red-50' : 'bg-slate-100'} text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200`}>
              <tr>
                <th className="h-12 w-12 text-center pl-4">
                  <input
                    type="checkbox"
                    checked={paginatedEquipments.length > 0 && paginatedEquipments.every((a) => selectedMainIds.has(a.id))}
                    onChange={toggleSelectMainAll}
                    className="accent-indigo-600 cursor-pointer w-3.5 h-3.5"
                  />
                </th>
                <th className="h-12 px-3 text-center w-12">NO</th>
                <th className="h-12 px-3 text-center w-16">사진</th>
                <th className="h-12 px-3 w-28">자산번호</th>
                <th className="h-12 px-3 w-40">품목명(장비명칭)</th>
                <th className="h-12 px-3 w-28">제조사</th>
                <th className="h-12 px-3 w-32">모델번호</th>
                <th className="h-12 px-3 w-32">시리얼번호</th>
                <th className="h-12 px-3 w-20 text-center">보유개수</th>
                <th className="h-12 px-3 w-48">제품사양</th>
                <th className="h-12 px-3 w-28 text-center ">구매일</th>
                <th className="h-12 px-3 w-28 text-center ">검교정예정일</th>
                <th className="h-12 px-3 w-32 text-center">관리소속</th>
                <th className="h-12 px-3 w-20 text-center">QR</th>
                <th className="h-12 pr-6 w-28 text-center whitespace-nowrap">액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedEquipments.length === 0 ? (
                <tr><td colSpan={15} className="h-24 text-center text-slate-400 italic">조건에 맞는 장비가 없습니다.</td></tr>
              ) : paginatedEquipments.map((eq, idx) => (
                <tr key={eq.id} className={`h-16 hover:bg-slate-50/50 transition-colors ${eq.isUrgent ? 'bg-red-50/30' : ''}`}>
                  <td className="pl-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedMainIds.has(eq.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        const next = new Set(selectedMainIds);
                        next.has(eq.id) ? next.delete(eq.id) : next.add(eq.id);
                        setSelectedMainIds(next);
                      }}
                      className="accent-indigo-600 cursor-pointer w-3.5 h-3.5"
                    />
                  </td>
                  <td className="px-3 text-center text-slate-400 font-mono text-[10px]">{filteredEquipments.length - ((currentPage - 1) * itemsPerPage + idx)}</td>
                  <td className="text-center">
                    {resolveImageSrc(eq.thumbnail_url) ? (
                      <img src={resolveImageSrc(eq.thumbnail_url)!} alt="" className="w-10 h-10 object-cover rounded-md mx-auto border" />
                    ) : (
                      <div className="w-10 h-10 bg-slate-100 rounded-md mx-auto flex items-center justify-center text-[8px] text-slate-300 border">NO</div>
                    )}
                  </td>
                  <td className="px-3 font-mono font-black text-slate-900">{displayAssetNo(eq.asset_no)}</td>
                  <td className="px-3 text-blue-700">{eq.name}</td>
                  <td className="px-3">{eq.brand || '-'}</td>
                  <td className="px-3 text-[10px] text-slate-500">{eq.model_name || '-'}</td>
                  <td className="px-3 text-[10px] font-mono text-slate-500">{eq.serial_no || '-'}</td>
                  <td className="text-center">{eq.qty} EA</td>
                  <td className="px-3 text-slate-500 truncate max-w-[150px] font-medium">{eq.spec_summary || '-'}</td>
                  <td className="text-center font-bold text-slate-700">
                    {eq.purchase_date ? String(eq.purchase_date).split('T')[0] : '-'}
                  </td>
                  <td className="text-center font-black">
                    {eq.nCalib ? (
                      <div className="flex flex-col items-center justify-center">
                        <span className="text-slate-900">{eq.nCalib}</span>
                        {renderDDay(eq.nCalib)}
                      </div>
                    ) : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="text-center text-slate-600">{eq.department || '-'}</td>
                  <td className="text-center">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setShowQrModal(eq); }} className="px-2 py-1 bg-white border border-sky-200 text-sky-600 rounded text-[10px] whitespace-nowrap hover:bg-sky-50 transition-colors shadow-sm">QR보기</button>
                  </td>
                  <td className="pr-6 pl-2 text-center whitespace-nowrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/equipment/main/${eq.category}/inventory?detailId=${eq.id}`);
                      }}
                      className={`px-2.5 py-1.5 border rounded-lg text-[10px] font-black transition-colors shadow-sm whitespace-nowrap ${eq.isUrgent ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-600 hover:text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-800 hover:text-white'}`}
                    >
                      상세이동
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredEquipments.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </div>


      {bulkPrintAssets.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/90 z-[600] flex flex-col p-8 overflow-y-auto print:p-0 print:bg-white" onClick={() => setBulkPrintAssets([])}>
          <div className="max-w-5xl w-full mx-auto bg-white rounded-[2rem] p-8 shadow-2xl print:shadow-none print:rounded-none print:p-0" onClick={e => e.stopPropagation()}>

            <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-4 print:hidden">
              <div>
                <h2 className="text-xl font-black text-slate-800">🖨️ 한국폼텍 28칸 정사각 QR 라벨 발행 센터</h2>
                <p className="text-slate-500 text-xs font-bold mt-1">드림디포 구매 규격 [QR-3990] 적용 (40mm × 40mm 정사각형) | 총 {bulkPrintAssets.length}개의 라벨</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={!bulkQrReady} onClick={() => window.print()} className={`px-6 py-2 font-black rounded-xl shadow-md flex items-center gap-2 text-xs transition-colors ${bulkQrReady ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}><span>🖨️</span> {bulkQrReady ? '라벨 인쇄 실행 (Ctrl+P)' : 'QR 생성 중…'}</button>
                <button type="button" onClick={() => setBulkPrintAssets([])} className="px-6 py-2 bg-slate-100 text-slate-600 font-black rounded-xl hover:bg-slate-200 text-xs">닫기</button>
              </div>
            </div>

            <div className="equipment-formtec-page bg-white p-0 relative" style={{ width: '210mm', minHeight: '297mm', margin: '0 auto', boxSizing: 'border-box' }}>
              <div className="text-center font-black text-slate-800 text-xs mb-4 print:hidden bg-indigo-50 border border-indigo-100 py-2.5 rounded-xl max-w-[190mm] mx-auto">
                📍 한국폼텍 28칸 기본 (드림디포 QR-3990 전용 4열 × 7행 정사각 매핑 완료) <br/>
                <span className="text-[10px] text-indigo-500 font-medium font-sans mt-0.5 block">※ 화면에 보이는 회색 점선은 인쇄 시 출력되지 않는 안전 가이드 칼선입니다.</span>
              </div>

              <div className="max-w-[190mm] mx-auto mb-4 print:hidden bg-blue-50 border-2 border-blue-200 p-4 rounded-2xl text-left">
                <p className="text-center font-black text-slate-800 text-[13px] mb-2">📍 한국폼텍 28칸 정사각 [QR-3990] 전용 출력 가이드</p>
                <div className="grid grid-cols-3 gap-2 text-[10px] font-black text-blue-900 border-t border-blue-200 pt-2 bg-white/60 p-2 rounded-xl">
                  <div className="border-r border-blue-100 pr-2">무조건 <span className="text-red-600 font-bold">"실제 크기 (100%)"</span></div>
                  <div className="border-r border-blue-100 px-2">무조건 <span className="text-red-600 font-bold">"여백 없음 (None)"</span></div>
                  <div className="pl-2"><span className="text-red-600 font-bold">"배경 그래픽"</span> 반드시 체크</div>
                </div>
              </div>

              <div
                className="grid grid-cols-4 print:grid-cols-4"
                style={{
                  width: '185mm',
                  margin: '0 auto',
                  paddingTop: '12mm',
                  paddingLeft: '5mm',
                  columnGap: '4.5mm',
                  rowGap: '1.5mm'
                }}
              >
                {Array.from({ length: Math.max(28, Math.ceil(bulkPrintAssets.length / 4) * 4) }).map((_, idx) => {
                  const a = bulkPrintAssets[idx];
                  if (!a) return <div key={`empty-${idx}`} className="border border-dashed border-slate-200 print:border-none opacity-30 print:opacity-0" style={{ width: '40mm', height: '40mm', boxSizing: 'border-box' }} />;

                  return (
                    <div
                      key={a.id}
                      className="flex flex-col justify-between bg-white overflow-hidden relative border border-dashed border-slate-200 print:border-none print:break-inside-avoid text-center"
                      style={{ width: '40mm', height: '40mm', padding: '2.5mm 2mm 2mm 2mm', boxSizing: 'border-box' }}
                    >
                      <div className="w-full space-y-0.5">
                        <div className="flex justify-center items-center gap-1">
                          <span className="text-[7px] font-black bg-slate-900 text-white px-1.5 py-0.5 rounded-full leading-none">장비</span>
                          <span className="text-[7px] font-black text-slate-700 truncate max-w-[26mm]">{a.name}</span>
                        </div>
                        <p className="text-[8px] font-black text-slate-900 truncate tracking-tight">{a.model_name || '모델번호 미상'}</p>
                        {a.serial_no ? (
                          <p className="text-[7px] font-mono text-slate-500 truncate">시리얼 {a.serial_no}</p>
                        ) : null}
                      </div>
                      <div className="w-full flex justify-center items-center my-0.5">
                        {bulkQrMap[a.id] ? (
                          <img src={bulkQrMap[a.id]} alt="QR" className="w-[20mm] h-[20mm] object-contain" />
                        ) : (
                          <div className="w-[20mm] h-[20mm] flex items-center justify-center bg-slate-50 text-[6px] font-bold text-slate-400 animate-pulse">생성 중…</div>
                        )}
                      </div>
                      <div className="w-full">
                        <p className="text-[9px] font-black font-mono tracking-tighter text-indigo-700 leading-none">{displayAssetNo(a.asset_no)}</p>
                        <p className="text-[6.5px] font-bold text-slate-400 truncate mt-0.5 scale-90">{a.department || '공용'} · <span className="text-amber-700 font-black">사내 Wi-Fi 스캔</span></p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <style jsx global>{`
            @media print {
              body * { visibility: hidden; }
              .equipment-formtec-page, .equipment-formtec-page * { visibility: visible; }
              .equipment-formtec-page { position: absolute; left: 0; top: 0; width: 210mm; height: 297mm; background: white !important; }
              @page { size: A4 portrait; margin: 0; }
            }
          `}</style>
        </div>
      )}

      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4" onClick={() => setShowQrModal(null)}>
          <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center mb-6">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">장비 QR 라벨</h3>
              <span className="bg-sky-100 text-sky-700 px-2 py-1 rounded text-[10px] font-black">{showQrModal.department || '공용'}</span>
            </div>
            <div className="bg-white p-4 border-2 border-slate-100 rounded-2xl shadow-sm mb-4">
              <EquipmentQrImage
                equipmentId={showQrModal.id}
                size={250}
                className="w-48 h-48 bg-white p-2"
                alt="Asset QR Code"
              />
            </div>
            <p className="text-slate-800 font-black text-xl mb-1">{displayAssetNo(showQrModal.asset_no)}</p>
            <p className="text-slate-400 text-xs font-bold mb-4 truncate max-w-[200px] text-center">
              {showQrModal.name} / {showQrModal.model_name || '모델번호 없음'}
              {showQrModal.serial_no ? ` · 시리얼 ${showQrModal.serial_no}` : ''}
            </p>
            <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-center">
              <p className="text-[11px] font-black text-amber-800">📡 QR 스캔 안내</p>
              <p className="text-[10px] font-bold text-amber-700 mt-0.5 leading-relaxed">
                스캔 시 <span className="underline decoration-2">로그인 없이</span> 공개 요약 카드가 열립니다.
                <br />
                <span className="font-black">⚠ 반드시 사내 Wi-Fi 연결 후 스캔하세요.</span>
                <br />
                (외부망·LTE에서는 조회되지 않습니다)
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <button type="button" onClick={() => setShowQrModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}