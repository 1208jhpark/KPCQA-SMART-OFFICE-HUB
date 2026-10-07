// src/app/(service)/equipment/main/page.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTDaysUntil } from '@/utils/dateUtils';
import { resolveCalibSchedule, toCalibYmd } from '@/utils/equipmentCalib';
import EquipmentQrImage from '@/components/equipment/EquipmentQrImage';
import { generateEquipmentQrDataUrls } from '@/utils/equipmentQr';
import { rowMatchesOrgUnit } from '@/lib/org-unit-match';
import { SEED_EQUIPMENT_BY_CATEGORY } from '@/lib/equipment-seed-performance';
import { isActiveEquipmentRow } from '@/utils/equipmentActive';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import WindowedPagination from '@/components/common/WindowedPagination';

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
  const [qtyUnitLabelByValue, setQtyUnitLabelByValue] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [restoringSeedCategory, setRestoringSeedCategory] = useState<string | null>(null);
  
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

  const isLv1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : [currentUser.role];
    return roles.some((r: unknown) => {
      const m = String(r || '').match(/(\d+)/);
      return m ? `LV_${m[0]}` === 'LV_1' : String(r) === 'LV_1';
    });
  }, [currentUser]);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  const seedCategoryCards = useMemo(
    () => [
      { code: 'safety' as const, label: '안전 장비' },
      { code: 'performance' as const, label: '기계설비성능점검 장비' },
      { code: 'airtightness' as const, label: '창호·기밀성능측정 장비' },
    ],
    []
  );

  const reloadEquipments = async () => {
    const eqRes = await fetch('/api/equipment?activeOnly=1');
    if (!eqRes.ok) return;
    const eqData = await eqRes.json();
    const activeEquipments = Array.isArray(eqData)
      ? eqData.filter((e: any) => isActiveEquipmentRow(e))
      : [];
    setEquipments(activeEquipments);
  };

  const handleRestoreSeedEquipment = async (categoryCode: string, categoryLabel: string) => {
    if (!isLv1) {
      alert('시드 장비 복구는 LV_1만 가능합니다.');
      return;
    }
    const seedCount =
      SEED_EQUIPMENT_BY_CATEGORY[
        categoryCode as keyof typeof SEED_EQUIPMENT_BY_CATEGORY
      ]?.length ?? 0;
    if (seedCount === 0) {
      alert(`「${categoryLabel}」시드 데이터가 아직 없습니다.\n엑셀 시드 준비 후 반영됩니다.`);
      return;
    }
    if (
      !confirm(
        `「${categoryLabel}」시드 ${seedCount}건 중 없는 항목만 추가합니다.\n이미 있는 자산번호는 덮어쓰지 않습니다. 계속할까요?`
      )
    ) {
      return;
    }
    setRestoringSeedCategory(categoryCode);
    try {
      const res = await fetch('/api/equipment/restore-seeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore-seeds', categoryCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || data.message || '시드 장비 복구 실패');
        return;
      }
      alert(data.message || '시드 장비 복구 완료');
      await reloadEquipments();
    } catch {
      alert('시드 장비 복구 중 오류가 발생했습니다.');
    } finally {
      setRestoringSeedCategory(null);
    }
  };
   
  useEffect(() => {
    const initializePage = async () => {
      try {
        const menuRes = await fetch('/api/admin/interface');
        const menus = await menuRes.json();
        const currentMenu = menus.find((m: any) => m.path === '/equipment/main');
        if (currentMenu) setInterfaceConfig(currentMenu);
        
        if (currentMenu && currentMenu.l2_entry_mode === 'L3_DEFAULT') {
          const children = menus
            .filter((m: any) => m.parent_id === currentMenu.id && m.is_active)
            .sort((a: any, b: any) => a.sort_order - b.sort_order);
          if (children.length > 0) {
            router.replace(children[0].path); return; 
          }
        }
   
        const [eqRes, unitRes, meRes, configRes, masterRes] = await Promise.all([
          fetch('/api/equipment?activeOnly=1'),
          fetch('/api/admin/units?active=true').catch(() => null),
          fetch(`/api/auth/me?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
          fetch('/api/admin/config', { cache: 'no-store' }).catch(() => null),
          fetch('/api/admin/master-data', { cache: 'no-store' }).catch(() => null),
        ]);

        if (meRes && meRes.ok) {
          const me = await meRes.json();
          setCurrentUser(me?.user || me);
        }

        if (configRes?.ok && masterRes?.ok) {
          const config = await configRes.json();
          const masterData = await masterRes.json();
          const groupId = config?.unit_category_group;
          const group = Array.isArray(masterData)
            ? masterData.find((g: any) => g.id === groupId)
            : null;
          const map: Record<string, string> = { EA: 'EA', VAL_1: 'EA' };
          for (const c of group?.codes || []) {
            if (c?.value) map[String(c.value)] = String(c.label || c.value);
          }
          setQtyUnitLabelByValue(map);
        }

        if (!eqRes.ok) {
          console.error('equipment load failed', eqRes.status);
          setEquipments([]);
          setLoading(false);
          return;
        }
  
        const eqData = await eqRes.json();
        const unitData = unitRes && unitRes.ok ? await unitRes.json() : [];
        
        const activeEquipments = Array.isArray(eqData)
          ? eqData.filter((e: any) => isActiveEquipmentRow(e))
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
      const { nCalib, isDue, applicable } = resolveCalibSchedule(eq);
      return { ...eq, nCalib, isUrgent: isDue, calibApplicable: applicable };
    });
  }, [equipments]);
   
  const deptStats = useMemo(() => {
    const stats: Record<string, { total: number; urgent: number; filterKey: string }> = {};
    processedEquipments.forEach((eq) => {
      const uid = String(eq.unit_id || '').trim();
      const name =
        (uid
          ? String(units.find((u: any) => u.id === uid)?.unit_name || '').trim()
          : '') ||
        eq.department ||
        '공용 (미지정)';
      const key = uid || `legacy:${name}`;
      if (!stats[key]) stats[key] = { total: 0, urgent: 0, filterKey: key };
      // 활성 장비 건수(행) — 하단 리스트 「N건」과 동일 기준 (보유개수 qty 합산 아님)
      stats[key].total += 1;
      if (eq.isUrgent) stats[key].urgent += 1;
      (stats[key] as any).label = name;
    });
    return stats;
  }, [processedEquipments, units]);
  
  /** Total Active = 활성 장비 건수 (행). 보유개수(EA) 합과 혼동하지 않음 */
  const totalActiveCount = processedEquipments.length;

  const totalUrgentCount = processedEquipments.filter(e => e.isUrgent).length;
  
  const sortedDepts = useMemo(() => {
    const entries = Object.entries(deptStats).map(([key, v]) => ({
      key,
      label: (v as any).label as string,
      ...v,
    }));
    const unitOrderMap = new Map();
    units.forEach((u, idx) => {
      unitOrderMap.set(u.id, idx);
      unitOrderMap.set(u.unit_name, idx);
    });
  
    return entries.sort((a, b) => {
      if (a.label === 'KPCQA') return -1;
      if (b.label === 'KPCQA') return 1;
      if (a.label === '공용 (미지정)') return 1;
      if (b.label === '공용 (미지정)') return -1;
      
      const orderA = unitOrderMap.has(a.key)
        ? unitOrderMap.get(a.key)
        : unitOrderMap.has(a.label)
          ? unitOrderMap.get(a.label)
          : 9999;
      const orderB = unitOrderMap.has(b.key)
        ? unitOrderMap.get(b.key)
        : unitOrderMap.has(b.label)
          ? unitOrderMap.get(b.label)
          : 9999;
      if (orderA !== orderB) return orderA - orderB;
  
      const getWeight = (name: string) => {
        if (name.endsWith('본부')) return 1;
        if (name.endsWith('센터')) return 2;
        if (name.endsWith('팀') || name.endsWith('실')) return 3;
        return 4;
      };
      const weightA = getWeight(a.label);
      const weightB = getWeight(b.label);
      if (weightA !== weightB) return weightA - weightB;
      return a.label.localeCompare(b.label, 'ko-KR');
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
        
      let matchDept = selectedDept === 'ALL';
      if (!matchDept) {
        if (selectedDept.startsWith('legacy:')) {
          const name = selectedDept.slice('legacy:'.length);
          matchDept = !eq.unit_id && (eq.department || '공용 (미지정)') === name;
        } else {
          matchDept = rowMatchesOrgUnit({
            selectedOrgId: selectedDept,
            units,
            unitId: eq.unit_id,
            legacyNames: [eq.department],
            includeDescendants: false,
          });
        }
      }
      const matchUrgent = showUrgentOnly ? eq.isUrgent : true;
   
      return matchSearch && matchDept && matchUrgent;
    });
  }, [processedEquipments, searchQuery, selectedDept, showUrgentOnly, units]);
   
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
    if (!canEdit) {
      return alert('QR 일괄출력은 Edit 권한이 필요합니다.');
    }
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

  /** fixed 모달 인쇄는 장 나눔이 깨지므로 A4 iframe으로 분리 인쇄 */
  const runFormtecLabelPrint = () => {
    if (!bulkQrReady || bulkPrintAssets.length === 0) return;
    const LABELS_PER_PAGE = 28;
    const pageCount = Math.max(1, Math.ceil(bulkPrintAssets.length / LABELS_PER_PAGE));
    const escapeHtml = (s: string) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    let pagesHtml = '';
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageStart = pageIndex * LABELS_PER_PAGE;
      let cells = '';
      for (let cellIndex = 0; cellIndex < LABELS_PER_PAGE; cellIndex += 1) {
        const a = bulkPrintAssets[pageStart + cellIndex];
        if (!a) {
          cells += `<div class="cell empty"></div>`;
          continue;
        }
        const qr = bulkQrMap[a.id] || '';
        cells += `<div class="cell">
          <div class="top">
            <div class="badge-row"><span class="badge">장비</span><span class="name">${escapeHtml(String(a.name || ''))}</span></div>
            <div class="title">${escapeHtml(String(a.model_name || '모델번호 미상'))}</div>
            ${a.serial_no ? `<div class="serial">시리얼 ${escapeHtml(String(a.serial_no))}</div>` : ''}
          </div>
          <div class="qr">${qr ? `<img src="${qr}" alt="QR" />` : ''}</div>
          <div class="bot">
            <div class="code">${escapeHtml(displayAssetNo(a.asset_no))}</div>
            <div class="dept">${escapeHtml(String(a.department || '공용'))}</div>
          </div>
        </div>`;
      }
      pagesHtml += `<section class="page"><div class="grid">${cells}</div></section>`;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'equipment-formtec-qr-print');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      alert('인쇄 창을 열 수 없습니다. 브라우저 팝업/권한을 확인해 주세요.');
      return;
    }
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8" />
<title>한국폼텍 QR 라벨</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: 210mm; height: 297mm; margin: 0; padding: 0; overflow: hidden; background: #fff; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .grid { display: grid; grid-template-columns: repeat(4, 40mm); width: 185mm; margin: 0 auto; padding-top: 8mm; padding-left: 5mm; column-gap: 4.5mm; row-gap: 1mm; }
  .cell { width: 40mm; height: 40mm; padding: 2.5mm 2mm 2mm; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; text-align: center; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .cell.empty { visibility: hidden; }
  .badge-row { display: flex; justify-content: center; align-items: center; gap: 2px; }
  .badge { font-size: 7px; font-weight: 900; background: #0f172a; color: #fff; padding: 1px 4px; border-radius: 999px; line-height: 1; }
  .name, .title { font-size: 8px; font-weight: 900; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-size: 7px; color: #334155; max-width: 26mm; }
  .serial { font-size: 7px; font-family: ui-monospace, monospace; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .code { font-size: 9px; font-weight: 900; font-family: ui-monospace, monospace; color: #4338ca; line-height: 1; }
  .dept { font-size: 6.5px; font-weight: 700; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .qr { display: flex; justify-content: center; align-items: center; }
  .qr img { width: 20mm; height: 20mm; object-fit: contain; }
</style></head><body>${pagesHtml}</body></html>`);
    doc.close();

    const finish = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => iframe.remove(), 800);
      }
    };
    const imgs = Array.from(doc.images || []);
    if (imgs.length === 0) {
      setTimeout(finish, 50);
      return;
    }
    let left = imgs.length;
    imgs.forEach((img) => {
      if (img.complete) {
        left -= 1;
        if (left <= 0) setTimeout(finish, 50);
      } else {
        img.onload = img.onerror = () => {
          left -= 1;
          if (left <= 0) setTimeout(finish, 50);
        };
      }
    });
  };

  useEffect(() => {
    if (bulkPrintAssets.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (bulkQrReady) runFormtecLabelPrint();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bulkPrintAssets, bulkQrReady, bulkQrMap]);

  const handleExportExcel = () => {
    const targetAssets =
      selectedMainIds.size > 0
        ? filteredEquipments.filter((a) => selectedMainIds.has(a.id))
        : filteredEquipments;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = targetAssets.map((a, idx) => {
      const { nCalib, applicable } = resolveCalibSchedule(a);
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
        검교정예정일: !applicable ? '대상 아님' : nCalib || '-',
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

            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelectedDept('ALL');
                setShowUrgentOnly(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedDept('ALL');
                  setShowUrgentOnly(false);
                }
              }}
              title="전체 활성 장비 보기"
              className={`cursor-pointer flex items-center gap-4 px-5 py-3.5 min-h-[76px] rounded-xl border transition-all ${
                selectedDept === 'ALL' && !showUrgentOnly
                  ? 'bg-sky-500/25 border-sky-300/70 ring-1 ring-sky-300/40'
                  : 'bg-sky-500/15 border-sky-400/40 hover:bg-sky-500/20'
              }`}
            >
              <div className="w-10 h-10 rounded-md bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-lg text-sky-300 shrink-0">
                📦
              </div>
              <div className="text-right leading-tight">
                <p className="text-[10px] font-black uppercase tracking-wider text-sky-300">Total Active</p>
                <p className="text-[9px] font-bold text-sky-200/70 mt-0.5">보유 장비</p>
                <p className="text-xl font-black font-mono text-white mt-1">
                  {totalActiveCount} <span className="text-[10px] text-sky-200/80 font-sans font-normal">건</span>
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
            ※ 부서 클릭 시 하단 필터 · 다시 클릭 또는 Total Active로 전체 보기. 빨간 점(🚨)은 검교정 일정(D-30/D+) 보유 부서입니다.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {sortedDepts.map((dept) => {
            const hasUrgent = dept.urgent > 0;
            const isSelected = selectedDept === dept.key;
            return (
              <button
                key={dept.key}
                type="button"
                onClick={() => setSelectedDept(isSelected ? 'ALL' : dept.key)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-all relative group ${
                  isSelected
                    ? 'bg-sky-500 border-sky-500 text-white font-black shadow-sm'
                    : hasUrgent
                    ? 'bg-red-950/40 border-red-800/60 text-red-400 font-bold hover:bg-red-900/60 hover:border-red-500/50'
                    : 'bg-white/5 border-white/10 text-slate-300 font-bold hover:bg-white/10 hover:border-white/20 hover:text-white'
                }`}
              >
                {hasUrgent && !isSelected && (
                  <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5" title={`검교정 일정 확인: ${dept.urgent}건`}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border border-slate-900" />
                  </span>
                )}

                <span className={`truncate ${hasUrgent && !isSelected ? 'text-red-400' : ''}`} title={dept.label}>
                  {dept.label}
                </span>

                <span className={`text-[11px] font-black font-mono ml-1.5 px-1.5 py-0.2 rounded shrink-0 ${
                  isSelected
                    ? 'bg-white/20 text-white'
                    : hasUrgent
                    ? 'bg-red-900/50 text-red-300'
                    : 'bg-slate-900/70 text-slate-300 group-hover:bg-slate-900 group-hover:text-white'
                }`}>
                  {dept.total}
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
                ? `🚨 검교정 일정 확인 D-30/D+ (${selectedDept === 'ALL' ? '전체' : (sortedDepts.find((d) => d.key === selectedDept)?.label || selectedDept)})`
                : selectedDept === 'ALL'
                  ? '전체 활성 장비 리스트'
                  : `[${sortedDepts.find((d) => d.key === selectedDept)?.label || selectedDept}] 보유 장비`}
            </h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredEquipments.length}건</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                if (!canEdit) return;
                openBulkQRPrint();
              }}
              title={
                canEdit
                  ? '선택 자산 QR 일괄출력'
                  : 'QR 일괄출력은 Edit 권한이 필요합니다.'
              }
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm transition-all whitespace-nowrap ${
                canEdit
                  ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer'
                  : 'bg-slate-200 text-slate-400 border border-slate-200 cursor-not-allowed'
              }`}
            >
              {selectedMainIds.size > 0
                ? `🖨️ QR 일괄출력(${selectedMainIds.size})(Edit)`
                : '🖨️ QR 일괄출력(Edit)'}
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
          <table className="w-full text-left border-collapse min-w-[1320px]">
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
                <th className="h-12 px-3 w-28 text-left">자산번호</th>
                <th className="h-12 px-3 min-w-[10rem] w-48 text-left">품목명(장비명칭)</th>
                <th className="h-12 px-2 w-24 text-left">제조사</th>
                <th className="h-12 px-2 w-28 text-left">모델번호</th>
                <th className="h-12 px-2 w-24 text-left">시리얼번호</th>
                <th className="h-12 px-3 w-20 text-center">보유개수</th>
                <th className="h-12 px-3 w-28 text-center ">구매일</th>
                <th className="h-12 px-3 w-36 text-center whitespace-nowrap">검교정예정일</th>
                <th className="h-12 px-3 min-w-[9.5rem] w-40 text-left whitespace-nowrap">관리소속</th>
                <th className="h-12 px-3 w-20 text-center">QR</th>
                <th className="h-12 pr-6 w-28 text-center whitespace-nowrap">액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedEquipments.length === 0 ? (
                <tr><td colSpan={14} className="h-24 text-center text-slate-400 italic">조건에 맞는 장비가 없습니다.</td></tr>
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
                  <td className="px-3 text-center text-slate-400 font-mono text-[10px] tabular-nums">{filteredEquipments.length - ((currentPage - 1) * itemsPerPage + idx)}</td>
                  <td className="text-center">
                    {resolveImageSrc(eq.thumbnail_url) ? (
                      <img src={resolveImageSrc(eq.thumbnail_url)!} alt="" className="w-10 h-10 object-cover rounded-md mx-auto border" />
                    ) : (
                      <div className="w-10 h-10 bg-slate-100 rounded-md mx-auto flex items-center justify-center text-[8px] text-slate-300 border">NO</div>
                    )}
                  </td>
                  <td className="px-3 text-left font-mono font-black text-slate-900">{displayAssetNo(eq.asset_no)}</td>
                  <td className="px-3 text-left text-blue-700 max-w-[13rem]" title={eq.name || ''}>
                    <span className="line-clamp-1">{eq.name}</span>
                  </td>
                  <td className="px-2 text-left truncate max-w-[6rem]" title={eq.brand || ''}>{eq.brand || '-'}</td>
                  <td className="px-2 text-left text-[10px] text-slate-500 truncate max-w-[7.5rem]" title={eq.model_name || ''}>{eq.model_name || '-'}</td>
                  <td className="px-2 text-left text-[10px] font-mono text-slate-500 truncate max-w-[6.5rem]" title={eq.serial_no || ''}>{eq.serial_no || '-'}</td>
                  <td className="text-center tabular-nums">
                    {eq.qty}{' '}
                    {(qtyUnitLabelByValue[String(eq.qty_unit || 'EA')] || eq.qty_unit || 'EA')
                      .replace(/\([^)]*\)/g, '')
                      .trim() || 'EA'}
                  </td>
                  <td className="text-center font-bold text-slate-700 tabular-nums">
                    {eq.purchase_date ? String(eq.purchase_date).split('T')[0] : '-'}
                  </td>
                  <td className="text-center font-black tabular-nums">
                    {eq.calibApplicable === false ? (
                      <span className="text-slate-400 font-bold">대상 아님</span>
                    ) : eq.nCalib ? (
                      <div className="inline-flex items-center justify-center flex-nowrap whitespace-nowrap">
                        <span className="text-slate-900">{eq.nCalib}</span>
                        {renderDDay(eq.nCalib)}
                      </div>
                    ) : <span className="text-slate-300">-</span>}
                  </td>
                  <td
                    className="px-3 text-left text-slate-600 whitespace-nowrap"
                    title={eq.department || ''}
                  >
                    {eq.department || '-'}
                  </td>
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
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      {isLv1 && (
        <div className="mt-6 mb-2 space-y-3 px-1">
          <p className="text-[11px] font-bold text-slate-400 leading-relaxed">
            LV_1 전용 · 범주별 시드 복구 (없는 자산번호만 추가 · 창호·기밀은 시드 준비 중)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {seedCategoryCards.map((card) => {
              const seedCount = SEED_EQUIPMENT_BY_CATEGORY[card.code].length;
              const restoring = restoringSeedCategory === card.code;
              const canRestore = seedCount > 0;
              return (
                <button
                  key={card.code}
                  type="button"
                  disabled={!canRestore || !!restoringSeedCategory}
                  onClick={() => {
                    if (!canRestore) return;
                    handleRestoreSeedEquipment(card.code, card.label);
                  }}
                  title={
                    seedCount === 0
                      ? '시드 데이터 준비 중'
                      : `시드 ${seedCount}건 중 없는 항목만 추가 (LV_1)`
                  }
                  className={`px-3 py-2.5 rounded-xl text-[10px] font-black border text-left transition-all ${
                    seedCount === 0
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : restoringSeedCategory
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 opacity-50 cursor-not-allowed'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 shadow-sm cursor-pointer'
                  }`}
                >
                  <span className="block text-[9px] opacity-70 mb-0.5">{card.label}</span>
                  {restoring
                    ? '복구 중…'
                    : seedCount === 0
                      ? '시드 준비 중'
                      : `시드 장비 복구(${seedCount})`}
                </button>
              );
            })}
          </div>
        </div>
      )}


      {bulkPrintAssets.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/90 z-[600] flex flex-col p-8 overflow-y-auto print:p-0 print:bg-white" onClick={() => setBulkPrintAssets([])}>
          <div className="max-w-5xl w-full mx-auto bg-white rounded-[2rem] p-8 shadow-2xl print:shadow-none print:rounded-none print:p-0" onClick={e => e.stopPropagation()}>

            <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-4 print:hidden">
              <div>
                <h2 className="text-xl font-black text-slate-800">🖨️ 한국폼텍 28칸 정사각 QR 라벨 발행 센터</h2>
                <p className="text-slate-500 text-xs font-bold mt-1">드림디포 구매 규격 [QR-3990] 적용 (40mm × 40mm 정사각형) | 총 {bulkPrintAssets.length}개의 라벨</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={!bulkQrReady} onClick={runFormtecLabelPrint} className={`px-6 py-2 font-black rounded-xl shadow-md flex items-center gap-2 text-xs transition-colors ${bulkQrReady ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}><span>🖨️</span> {bulkQrReady ? '라벨 인쇄 실행' : 'QR 생성 중…'}</button>
                <button type="button" onClick={() => setBulkPrintAssets([])} className="px-6 py-2 bg-slate-100 text-slate-600 font-black rounded-xl hover:bg-slate-200 text-xs">닫기</button>
              </div>
            </div>

            {(() => {
              const LABELS_PER_PAGE = 28;
              const pageCount = Math.max(1, Math.ceil(bulkPrintAssets.length / LABELS_PER_PAGE));
              return (
            <div className="equipment-formtec-print-root">
              <div className="text-center font-black text-slate-800 text-xs mb-4 print:hidden bg-indigo-50 border border-indigo-100 py-2.5 rounded-xl max-w-[190mm] mx-auto">
                📍 한국폼텍 28칸 기본 (드림디포 QR-3990 전용 4열 × 7행 정사각 매핑 완료) <br/>
                <span className="text-[10px] text-indigo-500 font-medium font-sans mt-0.5 block">
                  ※ 회색 점선·장 구분선은 인쇄되지 않는 안전 가이드입니다. 28칸마다 새 A4 장으로 나뉩니다. (총 {pageCount}장)
                </span>
              </div>

              <div className="max-w-[190mm] mx-auto mb-4 print:hidden bg-blue-50 border-2 border-blue-200 p-4 rounded-2xl text-left">
                <p className="text-center font-black text-slate-800 text-[13px] mb-2">📍 한국폼텍 28칸 정사각 [QR-3990] 전용 출력 가이드</p>
                <div className="grid grid-cols-3 gap-2 text-[10px] font-black text-blue-900 border-t border-blue-200 pt-2 bg-white/60 p-2 rounded-xl">
                  <div className="border-r border-blue-100 pr-2">무조건 <span className="text-red-600 font-bold">"실제 크기 (100%)"</span></div>
                  <div className="border-r border-blue-100 px-2">무조건 <span className="text-red-600 font-bold">"여백 없음 (None)"</span></div>
                  <div className="pl-2"><span className="text-red-600 font-bold">"배경 그래픽"</span> 반드시 체크</div>
                </div>
              </div>

              {Array.from({ length: pageCount }).map((_, pageIndex) => {
                const pageStart = pageIndex * LABELS_PER_PAGE;
                return (
                  <React.Fragment key={`eq-formtec-sheet-${pageIndex}`}>
                    {pageIndex > 0 && (
                      <div className="print:hidden my-8 max-w-[190mm] mx-auto px-2">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 border-t-2 border-dashed border-slate-300" />
                          <span className="text-[11px] font-black text-slate-500 tracking-wider whitespace-nowrap">
                            {pageIndex}장 --- {pageIndex + 1}장
                          </span>
                          <div className="flex-1 border-t-2 border-dashed border-slate-300" />
                        </div>
                        <p className="text-center text-[10px] font-bold text-slate-400 mt-2">
                          인쇄 시 이 구분선은 출력되지 않으며, 여기서부터 새 A4(28칸)로 넘어갑니다.
                        </p>
                      </div>
                    )}
                    <div
                      className="equipment-formtec-page bg-white p-0 relative border border-slate-100 print:border-none shadow-sm print:shadow-none mb-6 print:mb-0"
                      style={{
                        width: '210mm',
                        height: '297mm',
                        margin: '0 auto',
                        boxSizing: 'border-box',
                        overflow: 'hidden',
                      }}
                    >
                      <div className="print:hidden absolute top-3 right-4 z-10 text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-lg">
                        {pageIndex + 1} / {pageCount}장
                      </div>
                      <div
                        className="grid grid-cols-4 print:grid-cols-4"
                        style={{
                          width: '185mm',
                          margin: '0 auto',
                          paddingTop: '8mm',
                          paddingLeft: '5mm',
                          columnGap: '4.5mm',
                          rowGap: '1mm',
                        }}
                      >
                        {Array.from({ length: LABELS_PER_PAGE }).map((_, cellIndex) => {
                          const idx = pageStart + cellIndex;
                          const a = bulkPrintAssets[idx];
                          if (!a) {
                            return (
                              <div
                                key={`empty-${pageIndex}-${cellIndex}`}
                                className="border border-dashed border-slate-200 print:border-none opacity-30 print:opacity-0"
                                style={{ width: '40mm', height: '40mm', boxSizing: 'border-box' }}
                              />
                            );
                          }
                          return (
                            <div
                              key={a.id}
                              className="flex flex-col justify-between bg-white overflow-hidden relative border border-dashed border-slate-200 print:border-none break-inside-avoid text-center"
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
                                <p className="text-[6.5px] font-bold text-slate-400 truncate mt-0.5 scale-90">{a.department || '공용'}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
              );
            })()}
          </div>

          <style jsx global>{`
            @media print {
              @page { size: A4 portrait; margin: 0; }
              html, body {
                width: 210mm !important;
                height: auto !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: visible !important;
                background: white !important;
              }
              body * { visibility: hidden; }
              .equipment-formtec-print-root, .equipment-formtec-print-root * { visibility: visible; }
              .equipment-formtec-print-root {
                position: absolute;
                left: 0;
                top: 0;
                width: 210mm;
                height: auto !important;
                background: white !important;
              }
              .equipment-formtec-page {
                display: block;
                width: 210mm !important;
                height: 297mm !important;
                overflow: hidden !important;
                margin: 0 !important;
                box-shadow: none !important;
                border: none !important;
                page-break-after: always;
                break-after: page;
                break-inside: avoid;
                page-break-inside: avoid;
              }
              .equipment-formtec-page:last-child {
                page-break-after: auto;
                break-after: auto;
              }
            }
          `}</style>
        </div>
      )}

      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4" onClick={() => setShowQrModal(null)}>
          <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center mb-4">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">장비 QR 라벨</h3>
              <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-[10px] font-black">실제 출력 미리보기</span>
            </div>

            {/* 실제 인쇄되는 40mm 정사각 라벨과 동일한 형태 (화면용 확대) */}
            <div
              className="flex flex-col justify-between bg-white border-2 border-dashed border-slate-300 rounded-lg text-center mb-4"
              style={{ width: '260px', height: '260px', padding: '14px 12px 12px 12px', boxSizing: 'border-box' }}
            >
              <div className="w-full space-y-1">
                <div className="flex justify-center items-center gap-1.5">
                  <span className="text-[11px] font-black bg-slate-900 text-white px-2 py-0.5 rounded-full leading-none">장비</span>
                  <span className="text-[12px] font-black text-slate-700 truncate max-w-[170px]">{showQrModal.name}</span>
                </div>
                <p className="text-[13px] font-black text-slate-900 truncate tracking-tight">{showQrModal.model_name || '모델번호 미상'}</p>
                {showQrModal.serial_no ? (
                  <p className="text-[11px] font-mono text-slate-500 truncate">시리얼 {showQrModal.serial_no}</p>
                ) : null}
              </div>
              <div className="w-full flex justify-center items-center my-1">
                <EquipmentQrImage
                  equipmentId={showQrModal.id}
                  size={150}
                  alt="Asset QR Code"
                  className="w-[130px] h-[130px] object-contain"
                />
              </div>
              <div className="w-full">
                <p className="text-[15px] font-black font-mono tracking-tighter text-indigo-700 leading-none">{displayAssetNo(showQrModal.asset_no)}</p>
                <p className="text-[10px] font-bold text-slate-400 truncate mt-1">{showQrModal.department || '공용'}</p>
              </div>
            </div>

            <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-center">
              <p className="text-[11px] font-black text-amber-800">📡 QR 스캔 안내</p>
              <p className="text-[10px] font-bold text-amber-700 mt-0.5 leading-relaxed">
                스캔 시 <span className="underline decoration-2">로그인 없이</span> 공개 요약 카드가 열립니다.
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