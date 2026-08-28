'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import { getKSTNowYearMonth } from '@/utils/dateUtils';
import {
  BUSINESS_CARD_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';

const MENU_PATH = '/asset/businesscard/master/archive';
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none hover:bg-slate-100';

interface RequestItem {
  id: string;
  postNumber: string;
  userName: string;
  applyDate?: string;
  deptHead: string;
  deptName: string;
  title: string;
  quantity: number;
  adminStatus: string;
  applicantType?: string | null;
  applicantName?: string | null;
  additionalKo?: string | null;
  zipCode?: string | null;
  addressKo?: string | null;
  mobile?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  userNameEn?: string | null;
  deptHeadEn?: string | null;
  deptNameEn?: string | null;
  titleEn?: string | null;
  additionalEn?: string | null;
  addressEn?: string | null;
  mobileEn?: string | null;
  phoneEn?: string | null;
  faxEn?: string | null;
  emailEn?: string | null;
}

interface InspectSnapshot {
  itemPrice?: Record<string, number>;
  details?: Array<{ id?: string; docPrice?: number }>;
}

interface ArchivedBatch {
  id: string;
  orderDate: string;
  deptHeadGroup: string;
  totalCount: number;
  status: string;
  items: RequestItem[];
  displayItems?: RequestItem[];
  inspectResult?: InspectSnapshot | null;
}

function formatBatchNo(id: string) {
  return String(id || '').replace(/^BATCH-/, 'PO-BC-');
}

function toOrderExcelRows(items: RequestItem[]) {
  return items.map((r) => ({
    '관리번호': r.postNumber,
    '수량(통)': r.quantity || 1,
    '성명': r.userName,
    '신청일자': r.applyDate,
    '본부': r.deptHead,
    '소속': r.deptName || '',
    '직책/직급': r.title,
    '추가사항': r.additionalKo || '',
    '우편번호': r.zipCode,
    '주소': r.addressKo,
    '휴대전화': r.mobile,
    '전화번호': r.phone || '',
    '팩스': r.fax || '',
    '이메일': r.email,
    '영문이름': r.userNameEn || '',
    '영문본부': r.deptHeadEn || '',
    '영문소속': r.deptNameEn || '',
    '영문직책': r.titleEn || '',
    '영문추가': r.additionalEn || '',
    '영문주소': r.addressEn || '',
    '영문 휴대전화': r.mobileEn || '',
    '영문전화': r.phoneEn || '',
    '영문팩스': r.faxEn || '',
    '이메일(영문)': r.emailEn || r.email,
  }));
}

function toBulkOrderExcelRows(batch: ArchivedBatch, items: RequestItem[]) {
  return items.map((r) => ({
    '관리번호': r.postNumber,
    '수량(통)': r.quantity || 1,
    '정산금액': itemInspectPrice(batch, r) ?? '-',
    '성명': r.userName,
    '신청일자': r.applyDate,
    '본부': r.deptHead,
    '소속': r.deptName || '',
    '직책/직급': r.title,
    '추가사항': r.additionalKo || '',
    '우편번호': r.zipCode,
    '주소': r.addressKo,
    '휴대전화': r.mobile,
    '전화번호': r.phone || '',
    '팩스': r.fax || '',
    '이메일': r.email,
    '영문이름': r.userNameEn || '',
    '영문본부': r.deptHeadEn || '',
    '영문소속': r.deptNameEn || '',
    '영문직책': r.titleEn || '',
    '영문추가': r.additionalEn || '',
    '영문주소': r.addressEn || '',
    '영문 휴대전화': r.mobileEn || '',
    '영문전화': r.phoneEn || '',
    '영문팩스': r.faxEn || '',
    '이메일(영문)': r.emailEn || r.email,
  }));
}

function downloadOrderExcelFile(batch: ArchivedBatch) {
  const excelData = toOrderExcelRows(batch.items || []);
  if (excelData.length === 0) {
    alert('내려받을 내역이 없습니다.');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '명함발주데이터');
  XLSX.writeFile(wb, `명함발주서_${formatBatchNo(batch.id)}.xlsx`);
}

interface UnitItem {
  id: string;
  unit_name: string;
  unit_name_en?: string;
  unit_type?: string;
  parent_id: string | null;
  sort_order?: number;
}

function isBoldOrgType(unitType?: string | null) {
  const t = String(unitType || '').trim().toUpperCase();
  return t === 'ORGANIZATION' || t === 'HQ';
}

function flattenUnitsInSortOrder(units: UnitItem[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depthOf = (unit: UnitItem) => {
    let depth = 0;
    let current: UnitItem | undefined = unit;
    const seen = new Set<string>();
    while (current?.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parent_id);
    }
    return depth;
  };
  return [...units]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((unit) => ({ ...unit, depth: depthOf(unit) }));
}

function descendantNames(unitId: string, units: UnitItem[]) {
  const names = new Set<string>();
  const selected = units.find((u) => u.id === unitId);
  if (selected?.unit_name) names.add(selected.unit_name.trim());
  const walk = (parentId: string) => {
    for (const child of units.filter((u) => u.parent_id === parentId)) {
      if (child.unit_name) names.add(child.unit_name.trim());
      walk(child.id);
    }
  };
  walk(unitId);
  return names;
}

function itemMatchesOrg(item: RequestItem, orgId: string, units: UnitItem[]) {
  if (orgId === 'ALL') return true;
  const names = descendantNames(orgId, units);
  const head = String(item.deptHead || '').trim();
  const center = String(item.deptName || '').trim();
  return names.has(head) || names.has(center);
}

function breakdownGroupKey(item: RequestItem, selected: UnitItem | null, units: UnitItem[]) {
  if (!selected) return String(item.deptHead || item.deptName || '-').trim() || '-';
  const children = units
    .filter((u) => u.parent_id === selected.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (children.length === 0) return selected.unit_name;
  const head = String(item.deptHead || '').trim();
  const center = String(item.deptName || '').trim();
  for (const child of children) {
    const names = descendantNames(child.id, units);
    if (names.has(head) || names.has(center)) return child.unit_name;
  }
  return selected.unit_name;
}

/** 검수 단가 없으면 null (추정 단가 금지) */
function itemInspectPrice(batch: ArchivedBatch, item: RequestItem): number | null {
  const mapped = batch.inspectResult?.itemPrice?.[item.id];
  if (mapped != null && Number.isFinite(Number(mapped))) return Number(mapped);
  const detail = batch.inspectResult?.details?.find((d) => d.id === item.id);
  if (detail?.docPrice != null && Number.isFinite(Number(detail.docPrice))) return Number(detail.docPrice);
  return null;
}

function formatPriceWon(price: number | null) {
  if (price == null) return '-';
  return `₩${price.toLocaleString()}`;
}

function sumKnownPrices(batch: ArchivedBatch, items: RequestItem[] | undefined) {
  let sum = 0;
  let known = 0;
  for (const item of items || []) {
    const p = itemInspectPrice(batch, item);
    if (p == null) continue;
    sum += p;
    known += 1;
  }
  return { sum, known };
}

export default function BusinessCardArchivePanel() {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(BUSINESS_CARD_MASTER_TABS, '/asset/businesscard/master');
  const [archivedBatches, setArchivedBatches] = useState<ArchivedBatch[]>([]);
  const [units, setUnits] = useState<UnitItem[]>([]);
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

  const [yearFilter, setYearFilter] = useState(() => String(getKSTNowYearMonth().year));
  const [monthFilter, setMonthFilter] = useState('ALL');
  const [orgFilter, setOrgFilter] = useState('ALL');
  const [nameSearch, setNameSearch] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');

  useEffect(() => {
    const fetchArchivedData = async () => {
      try {
        const ts = Date.now();
        const [res, meRes, ifRes, summaryRes, unitRes] = await Promise.all([
          fetch(`/api/asset/businesscard/master/order?isArchived=true&t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
            cache: 'no-store',
          }).catch(() => null),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (res.ok) {
          const data = await res.json();
          setArchivedBatches(data);
        }
        if (unitRes && unitRes.ok) {
          const raw = await unitRes.json();
          setUnits(Array.isArray(raw) ? raw : []);
        } else setUnits([]);
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
        console.error('보관함 데이터 로딩 실패:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchArchivedData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedBatchIds(new Set());
  }, [yearFilter, monthFilter, orgFilter, nameSearch]);

  useEffect(() => {
    if (!orgMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setOrgMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOrgMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [orgMenuOpen]);

  const availableYears = useMemo(() => {
    const years = archivedBatches
      .map((b) => String(b.orderDate || '').substring(0, 4))
      .filter((y) => y.length === 4);
    const current = String(getKSTNowYearMonth().year);
    return Array.from(new Set([current, ...years])).sort((a, b) => b.localeCompare(a));
  }, [archivedBatches]);

  const afterYearList = useMemo(() => {
    if (yearFilter === 'ALL') return archivedBatches;
    return archivedBatches.filter((b) => String(b.orderDate || '').startsWith(yearFilter));
  }, [archivedBatches, yearFilter]);

  const availableMonths = useMemo(() => {
    const months = afterYearList
      .map((b) => String(b.orderDate || '').substring(5, 7))
      .filter(Boolean);
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [afterYearList]);

  const afterPeriodList = useMemo(() => {
    if (monthFilter === 'ALL') return afterYearList;
    return afterYearList.filter((b) => String(b.orderDate || '').substring(5, 7) === monthFilter);
  }, [afterYearList, monthFilter]);

  const orgOptions = useMemo(() => flattenUnitsInSortOrder(units), [units]);
  const organizationUnit = useMemo(
    () => orgOptions.find((u) => String(u.unit_type || '').trim().toUpperCase() === 'ORGANIZATION') || null,
    [orgOptions]
  );
  const selectedOrg = orgOptions.find((u) => u.id === orgFilter) || (orgFilter === 'ALL' ? organizationUnit : null) || null;

  useEffect(() => {
    if (orgFilter !== 'ALL' || !organizationUnit) return;
    setOrgFilter(organizationUnit.id);
  }, [orgFilter, organizationUnit]);

  const processedBatches = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    return afterPeriodList
      .map((b) => ({
        ...b,
        displayItems: (b.items || []).filter((item) => {
          if (!itemMatchesOrg(item, orgFilter, units)) return false;
          if (q && !String(item.userName || '').toLowerCase().includes(q)) return false;
          return true;
        }),
      }))
      .filter((b) => (b.displayItems || []).length > 0);
  }, [afterPeriodList, orgFilter, nameSearch, units]);

  const totalPages = Math.ceil(processedBatches.length / itemsPerPage) || 1;
  const paginatedBatches = processedBatches.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  let totalQty = 0;
  let totalCalculatedPrice = 0;
  let totalPriceKnown = 0;
  const deptStatsMap: Record<string, { names: Set<string>; qty: number; price: number; priceKnown: number }> = {};

  processedBatches.forEach((batch) => {
    batch.displayItems?.forEach((item) => {
      const q = item.quantity || 1;
      const price = itemInspectPrice(batch, item);
      totalQty += q;
      const dept = breakdownGroupKey(item, selectedOrg, units);
      if (!deptStatsMap[dept]) deptStatsMap[dept] = { names: new Set(), qty: 0, price: 0, priceKnown: 0 };
      deptStatsMap[dept].names.add(item.userName);
      deptStatsMap[dept].qty += q;
      if (price != null) {
        totalCalculatedPrice += price;
        totalPriceKnown += 1;
        deptStatsMap[dept].price += price;
        deptStatsMap[dept].priceKnown += 1;
      }
    });
  });

  const handleListExcelDownload = () => {
    if (!canEditMaster) return alertNoEditPermission();
    const targets = selectedBatchIds.size > 0
      ? processedBatches.filter((b) => selectedBatchIds.has(b.id))
      : processedBatches;
    const excelData = targets.flatMap((batch) =>
      toBulkOrderExcelRows(batch, batch.displayItems || batch.items || [])
    );
    if (excelData.length === 0) return alert('내려받을 내역이 없습니다.');
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명함발주데이터');
    XLSX.writeFile(wb, '명함발주서_보관함.xlsx');
  };

  const pageBatchIds = paginatedBatches.map((b) => b.id);
  const allPageBatchesSelected =
    pageBatchIds.length > 0 && pageBatchIds.every((id) => selectedBatchIds.has(id));
  const allFilteredBatchesSelected =
    processedBatches.length > 0 && processedBatches.every((b) => selectedBatchIds.has(b.id));

  const handleSelectAllBatches = () => {
    // 테이블 헤더: 현재 페이지분만 토글
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (allPageBatchesSelected) pageBatchIds.forEach((id) => next.delete(id));
      else pageBatchIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    // 상단 「전체」: 필터된 전체 건 선택/해제
    if (allFilteredBatchesSelected) setSelectedBatchIds(new Set());
    else setSelectedBatchIds(new Set(processedBatches.map((b) => b.id)));
  };

  const handleSelectBatchRow = (id: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
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

      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            return (
              <Link
                key={tab.id}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                  isActive
                    ? `bg-white ${tab.activeColor || 'text-indigo-600'} shadow-sm border border-slate-200/80`
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
          ※ 탭을 클릭하여 신청현황·외주발주·보관함을 전환합니다.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm p-8 space-y-6">
        <div className="border-b border-slate-100 pb-5">
          <h2 className="text-xl font-black flex items-center gap-2 text-slate-800">🗄️ 과거 발주 및 지급 완료 묶음 결산 이력</h2>
          <p className="text-xs text-slate-500 mt-1.5">아래 표의 연도·월·조직·대상자 검색에 맞춰 수량과 금액이 바로 집계됩니다.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-slate-800 rounded-3xl p-6 shadow-md flex flex-col justify-center border border-slate-700">
            <h3 className="text-slate-400 text-[10px] font-black tracking-widest mb-4">TOTAL SUMMARY</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-end border-b border-slate-600/50 pb-3">
                <span className="text-sm font-bold text-slate-300">총 발주 수량</span>
                <span className="text-3xl font-black text-white font-mono">{totalQty} <span className="text-sm font-normal text-slate-400 ml-0.5">통</span></span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-sm font-bold text-slate-300">외주 정산 총액</span>
                <span className="text-3xl font-black text-emerald-400 font-mono tracking-tight">
                  {totalPriceKnown > 0 ? `₩${totalCalculatedPrice.toLocaleString()}` : '-'}
                </span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 h-48 flex flex-col overflow-hidden shadow-sm">
            <div className="bg-slate-50/90 backdrop-blur-sm px-5 py-3 border-b border-slate-200 flex justify-between items-center z-10 shrink-0">
              <h3 className="text-slate-500 text-[10px] font-black tracking-widest">조직별 조회</h3>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded-md">{Object.keys(deptStatsMap).length}개 조직</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {Object.keys(deptStatsMap).length === 0 ? (
                <p className="text-slate-400 text-xs text-center py-10 font-bold">조건에 맞는 데이터가 없습니다.</p>
              ) : (
                <div className="space-y-0.5">
                  {Object.entries(deptStatsMap)
                    .sort((a, b) => {
                      const orderOf = (name: string) => {
                        const unit = units.find((u) => u.unit_name === name);
                        return unit?.sort_order ?? Number.MAX_SAFE_INTEGER;
                      };
                      const byOrder = orderOf(a[0]) - orderOf(b[0]);
                      if (byOrder !== 0) return byOrder;
                      return b[1].qty - a[1].qty;
                    })
                    .map(([dept, data], idx) => (
                    <div key={idx} className="flex flex-row items-center justify-between hover:bg-slate-50 transition-colors px-3 py-2 rounded-lg gap-3">
                      <div className="w-[140px] shrink-0 font-black text-slate-700 text-[11px] truncate" title={dept}>
                        {dept}
                      </div>
                      <div className="flex-1 text-[11px] font-medium text-slate-500 truncate" title={Array.from(data.names).join(', ')}>
                        {Array.from(data.names).join(', ')}
                      </div>
                      <div className="shrink-0 flex items-center justify-end gap-4">
                        <span className="text-[11px] font-black text-slate-500 w-8 text-right">{data.qty}통</span>
                        <span className="text-[12px] font-black text-emerald-600 font-mono w-[70px] text-right">
                          {data.priceKnown > 0 ? `₩${data.price.toLocaleString()}` : '-'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={`bg-white border border-indigo-200 rounded-[2.5rem] shadow-sm ${orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
        <div className={`p-4 px-6 bg-indigo-50 border-b border-indigo-200 flex flex-wrap items-center justify-between gap-4 relative ${orgMenuOpen ? 'z-[80] overflow-visible' : ''}`}>
          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-1 cursor-pointer shrink-0"
              title={`필터된 전체 ${processedBatches.length}건 선택/해제`}
            >
              <input
                type="checkbox"
                checked={allFilteredBatchesSelected}
                onChange={handleSelectAllFiltered}
                className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
              />
              <span className="text-[10px] font-black text-indigo-700 whitespace-nowrap">전체</span>
            </label>
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">검수 완료 보관함 대장</h2>
            <span className="text-[11px] font-bold bg-indigo-200/80 text-indigo-800 px-2 py-0.5 rounded-md">{processedBatches.length}건</span>
          </div>
          <div className={`flex items-center gap-2 flex-wrap ml-auto ${orgMenuOpen ? 'relative z-[90] overflow-visible' : ''}`}>
            <div className={`relative group/filter flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-indigo-200 shadow-sm h-7 box-border ${orgMenuOpen ? 'relative z-[90]' : ''}`}>
              <span
                role="tooltip"
                className={`pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg ${orgMenuOpen ? '' : 'group-hover/filter:block'}`}
              >
                연도 → 월 · 연계필터 / 조직은 마스터 정렬
              </span>
              <span className="text-[10px] font-black text-slate-400 uppercase leading-none">연도</span>
              <select
                value={yearFilter}
                onChange={(e) => {
                  setYearFilter(e.target.value);
                  setMonthFilter('ALL');
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-black text-slate-400 uppercase leading-none">월별</span>
              <select
                value={monthFilter}
                onChange={(e) => {
                  setMonthFilter(e.target.value);
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{parseInt(month, 10)}월</option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-black text-slate-400 uppercase leading-none">조직</span>
              <div className="relative inline-flex items-center" ref={orgMenuRef}>
                <button
                  type="button"
                  onClick={() => setOrgMenuOpen((open) => !open)}
                  className={`max-w-[220px] truncate text-left text-[11px] leading-none py-0 px-0 m-0 h-4 inline-flex items-center border-0 appearance-none outline-none cursor-pointer bg-transparent ${
                    selectedOrg && isBoldOrgType(selectedOrg.unit_type) ? 'font-black text-slate-900' : 'font-bold text-slate-800'
                  }`}
                >
                  {selectedOrg ? selectedOrg.unit_name : organizationUnit?.unit_name || '조직 선택'}
                </button>
                {orgMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 z-[100] min-w-[240px] max-h-72 overflow-y-auto bg-white border border-indigo-200 rounded-lg shadow-xl py-1">
                    {orgOptions.map((dept) => {
                      const bold = isBoldOrgType(dept.unit_type);
                      return (
                        <button
                          key={dept.id}
                          type="button"
                          onClick={() => {
                            setOrgFilter(dept.id);
                            setOrgMenuOpen(false);
                          }}
                          className={`w-full text-left pr-3 py-1.5 text-[11px] ${
                            bold ? 'font-black text-slate-900' : 'font-medium text-slate-600'
                          } ${orgFilter === dept.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                          style={{ paddingLeft: `${12 + dept.depth * 12}px` }}
                        >
                          {dept.unit_name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="relative w-32 h-7">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] leading-none pointer-events-none">👤</span>
              <input
                type="text"
                placeholder="대상자 검색..."
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-indigo-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
            <button
              type="button"
              disabled={!canEditMaster}
              title={!canEditMaster ? '편집 권한 필요' : undefined}
              onClick={handleListExcelDownload}
              className={`h-7 px-3 rounded-lg text-[10px] font-black shadow-sm transition-all whitespace-nowrap leading-none ${
                canEditMaster
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : DISABLED_ACTION_BTN
              }`}
            >
              {selectedBatchIds.size > 0
                ? `선택 발주서 다운로드(${selectedBatchIds.size})`
                : '발주서 엑셀 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-indigo-100 text-indigo-900 text-[10px] font-black uppercase tracking-widest border-b border-indigo-200">
              <tr>
                <th className="h-12 px-4 w-[50px]">
                  <input
                    type="checkbox"
                    title="현재 페이지(최대 10건)만 선택"
                    onChange={handleSelectAllBatches}
                    checked={allPageBatchesSelected}
                    className="w-3 h-3 accent-indigo-600 cursor-pointer"
                  />
                </th>
                <th className="h-12 px-2 w-[48px] text-center">NO</th>
                <th className="h-12 px-2 w-[160px]">묶음 번호</th>
                <th className="h-12 px-4 w-[120px]">발주 일자</th>
                <th className="h-12 px-4 min-w-[200px]">결산 포함 대상자</th>
                <th className="h-12 px-4 text-center w-[100px]">묶음 내 수량</th>
                <th className="h-12 px-4 text-center w-[100px]">정산 금액</th>
                <th className="h-12 px-4 text-center w-[100px]">상태</th>
                <th className="h-12 px-2 text-center w-[120px]">엑셀 다운로드</th>
              </tr>
            </thead>
            <tbody className="bg-white text-xs font-bold text-slate-700 divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={9} className="p-16 text-center text-slate-400 text-xs">데이터를 불러오는 중입니다...</td></tr>
              ) : paginatedBatches.length === 0 ? (
                <tr><td colSpan={9} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 보관 내역이 없습니다.</td></tr>
              ) : (
                paginatedBatches.map((batch, index) => {
                  const rowNo = processedBatches.length - ((currentPage - 1) * itemsPerPage + index);
                  const batchQty = batch.displayItems?.reduce((sum, item) => sum + (item.quantity || 1), 0) || 0;
                  const { sum: batchPriceSum, known: batchPriceKnown } = sumKnownPrices(batch, batch.displayItems);
                  return (
                    <React.Fragment key={batch.id}>
                      <tr
                        className={`h-16 hover:bg-indigo-50/40 cursor-pointer transition-colors ${selectedBatchIds.has(batch.id) ? 'bg-indigo-50/50' : ''}`}
                        onClick={() => setExpandedBatchId(expandedBatchId === batch.id ? null : batch.id)}
                      >
                        <td className="px-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.has(batch.id)}
                            onChange={(e) => handleSelectBatchRow(batch.id, e)}
                            className="w-3 h-3 accent-indigo-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                        <td className="px-2 font-mono text-indigo-600">{expandedBatchId === batch.id ? '👇' : '👉'} {formatBatchNo(batch.id)}</td>
                        <td className="px-4 text-slate-600 font-mono">{batch.orderDate}</td>
                        <td className="px-4 text-slate-700 truncate max-w-xs" title={Array.from(new Set(batch.displayItems?.map((i) => i.userName).filter(Boolean))).join(', ')}>
                          {Array.from(new Set(batch.displayItems?.map((i) => i.userName).filter(Boolean))).join(', ') || '-'}
                        </td>
                        <td className="px-4 text-center text-indigo-700 font-black">{batchQty} 통</td>
                        <td className="px-4 text-center font-mono tabular-nums text-slate-800">
                          {batchPriceKnown > 0 ? `₩${batchPriceSum.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-4 text-center">
                          <span className="text-[10px] font-bold whitespace-nowrap text-emerald-600">검수완료</span>
                        </td>
                        <td className="px-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            disabled={!canEditMaster}
                            title={!canEditMaster ? '편집 권한 필요' : undefined}
                            onClick={() => {
                              if (!canEditMaster) return alertNoEditPermission();
                              downloadOrderExcelFile(batch);
                            }}
                            className={`p-1.5 px-3 font-black text-[10px] rounded-lg w-full ${
                              canEditMaster
                                ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            📊 엑셀 저장
                          </button>
                        </td>
                      </tr>
                      {expandedBatchId === batch.id && (
                        <tr>
                          <td colSpan={9} className="bg-indigo-50/60 p-6 border-l-4 border-indigo-400">
                            <div className="bg-white border border-indigo-100 rounded-2xl overflow-hidden shadow-sm">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 text-slate-600 font-black tracking-widest border-b border-slate-200 text-[10px]">
                                  <tr>
                                    <th className="h-10 px-2 w-[48px] text-center">NO</th>
                                    <th className="h-10 px-2 w-[110px] text-center whitespace-nowrap">관리번호</th>
                                    <th className="h-10 px-2 w-[72px] text-center whitespace-nowrap">신청주체</th>
                                    <th className="h-10 px-2">본부 (상위 조직)</th>
                                    <th className="h-10 px-2">센터 (하위 조직)</th>
                                    <th className="h-10 px-2">대상자</th>
                                    <th className="h-10 px-2">직책 / 직급</th>
                                    <th className="h-10 px-2 text-center w-[72px] whitespace-nowrap">수량(통)</th>
                                    <th className="h-10 px-2 text-center w-[96px] whitespace-nowrap">정산액</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                                  {batch.displayItems?.map((item, idx) => (
                                    <tr key={item.id} className="h-12 hover:bg-slate-50/50 text-[11px] font-bold text-slate-700">
                                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{idx + 1}</td>
                                      <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate">{item.postNumber}</td>
                                      <td className="px-2 text-center">
                                        {item.applicantType === '관리자대행' ? (
                                          <span className="text-[10px] font-bold whitespace-nowrap text-indigo-700" title={item.applicantName || ''}>관리자대행</span>
                                        ) : (
                                          <span className="text-[10px] font-bold whitespace-nowrap text-slate-600">본인</span>
                                        )}
                                      </td>
                                      <td className="px-2 truncate" title={item.deptHead || ''}>{item.deptHead || '-'}</td>
                                      <td className="px-2 truncate" title={item.deptName || ''}>{item.deptName || <span className="text-slate-300">-</span>}</td>
                                      <td className="px-2 text-slate-800 truncate">{item.userName || '-'}</td>
                                      <td className="px-2 text-slate-800 truncate" title={item.title || ''}>{item.title || '-'}</td>
                                      <td className="px-2 text-center font-mono tabular-nums text-slate-900">{item.quantity || 1}</td>
                                      <td className="px-2 text-center font-mono tabular-nums text-slate-800">{formatPriceWon(itemInspectPrice(batch, item))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {processedBatches.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentPage(i + 1)}
                className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
                  currentPage === i + 1
                    ? 'bg-slate-800 text-white shadow-sm scale-105'
                    : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
