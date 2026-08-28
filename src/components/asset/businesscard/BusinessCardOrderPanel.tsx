'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth } from '@/utils/dateUtils';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import {
  applyStatementMatches,
  DEFAULT_STATEMENT_COL_MAP,
  extractExcelStatementLines,
  formatAliasInput,
  normalizeStatementColMap,
  parseAliasInput,
  STATEMENT_COL_FIELDS,
  type StatementColKey,
  type StatementColMap,
  type StatementMatchRow,
} from '@/lib/businesscard-statement-match';
import {
  BUSINESS_CARD_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';

const MENU_PATH = '/asset/businesscard/master/order';
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none hover:bg-slate-100';
const BATCH_PAGE_SIZE = 10;

interface RequestHistory {
  id: string;
  postNumber: string;
  applyDate: string;
  processDate: string | null;
  userName: string;
  userNameEn: string;
  deptHead: string;
  deptHeadEn: string;
  deptName: string;
  deptNameEn: string;
  title: string;
  titleEn: string;
  mobile: string;
  mobileEn: string;
  phone: string;
  phoneEn: string;
  fax: string;
  faxEn: string;
  email: string;
  emailEn: string;
  additionalKo: string | null;
  additionalEn: string | null;
  addressId?: string | null;
  zipCode: string;
  addressKo: string;
  addressEn: string;
  adminStatus: string;
  batchId?: string | null;
  quantity: number;
  isModifiedByAdmin?: boolean;
  adminMemo?: string | null;
  applicantType?: string | null;
  applicantName?: string | null;
  adminModifierName?: string | null;
  adminModifiedAt?: string | null;
}

type ItemInspectStatus = 'match' | 'mismatch' | 'missing' | 'idle';

interface BatchInspectResult {
  fileName?: string;
  matched?: boolean;
  docTotalQty?: number;
  docTotalPrice?: number;
  logs?: string[];
  details?: StatementMatchRow[];
  itemStatus?: Record<string, ItemInspectStatus>;
  itemPrice?: Record<string, number>;
}

interface OrderBatch {
  id: string;
  orderDate: string;
  totalCount: number;
  deptHeadGroup: string;
  status: '발주완료' | '견적비교완료' | '지급완료';
  items: RequestHistory[];
  inspectStatus?: 'idle' | 'match' | 'mismatch';
  inspectFileName?: string | null;
  inspectResult?: BatchInspectResult | null;
}

function collectInspectMaps(batchList: OrderBatch[]) {
  const status: Record<string, ItemInspectStatus> = {};
  const price: Record<string, number> = {};
  for (const batch of batchList) {
    const result = batch.inspectResult;
    if (result?.itemStatus) Object.assign(status, result.itemStatus);
    if (result?.itemPrice) Object.assign(price, result.itemPrice);
    for (const detail of result?.details || []) {
      if (!detail?.id) continue;
      if (!status[detail.id] && detail.matchStatus) status[detail.id] = detail.matchStatus;
      if (price[detail.id] == null && detail.docPrice != null) price[detail.id] = Number(detail.docPrice) || 0;
    }
  }
  return { status, price };
}

function formatBatchNo(id: string) {
  return String(id || '').replace(/^BATCH-/, 'PO-BC-');
}

function ColumnGearButton({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? '편집 권한 필요' : `${label} 칼럼 제목 지정`}
      className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
        disabled
          ? 'text-slate-300 cursor-not-allowed opacity-60'
          : 'text-slate-400 hover:bg-white hover:text-indigo-600'
      }`}
    >
      ⚙
    </button>
  );
}

// 🚀 [신설] 외주업체 마스터 데이터 타입
interface Vendor {
  id: string;
  companyName: string;
  managerName: string;
  email: string;
  memo?: string;
  isActive: boolean;
}

const EMPTY_VENDOR_FORM: Partial<Vendor> = { companyName: '', managerName: '', email: '', memo: '', isActive: true };

interface AddressMaster {
  id: string;
  label: string;
  zipCode: string;
  addressKo: string;
  addressEn: string;
  fax: string;
  faxEn: string;
  isActive: boolean;
}

interface MasterCode {
  id: string;
  label: string;
  value: string | null;
}

interface UnitItem {
  id: string;
  unit_name: string;
  unit_name_en: string;
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

function itemMatchesOrg(item: { deptHead?: string | null; deptName?: string | null }, orgId: string, units: UnitItem[]) {
  if (orgId === 'ALL') return true;
  const names = descendantNames(orgId, units);
  const head = String(item.deptHead || '').trim();
  const center = String(item.deptName || '').trim();
  return names.has(head) || names.has(center);
}

function isBusinessCardHqUnit(unit: { unit_type?: string | null; unit_name?: string | null } | null | undefined) {
  const t = String(unit?.unit_type || '').trim().toUpperCase();
  if (t === 'HQ' || t.startsWith('HQ')) return true;
  const n = String(unit?.unit_name || '').trim();
  return /^hq\b/i.test(n) || /^hq[_-]/i.test(n);
}

function formatEnNumber(type: 'mobile' | 'phone', value: string) {
  const clean = value.replace(/[^0-9]/g, '');
  if (!clean) return '';
  if (type === 'mobile') {
    return clean.startsWith('010') && clean.length === 11
      ? `+82-10-${clean.substring(3, 7)}-${clean.substring(7)}`
      : value;
  }
  if (clean.startsWith('02')) {
    const rest = clean.substring(2);
    if (rest.length === 7 || rest.length === 8) {
      const mid = rest.length === 8 ? rest.substring(0, 4) : rest.substring(0, 3);
      return `+82-2-${mid}-${rest.substring(rest.length - 4)}`;
    }
  } else if (clean.startsWith('0')) {
    const areaCode = clean.substring(1, 3);
    const rest = clean.substring(3);
    if (rest.length === 7 || rest.length === 8) {
      const mid = rest.length === 8 ? rest.substring(0, 4) : rest.substring(0, 3);
      return `+82-${areaCode}-${mid}-${rest.substring(rest.length - 4)}`;
    }
  }
  return value;
}

const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);

export default function BusinessCardOrderPanel() {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(BUSINESS_CARD_MASTER_TABS, '/asset/businesscard/master');
  const [requests, setRequests] = useState<RequestHistory[]>([]);
  const [batches, setBatches] = useState<OrderBatch[]>([]);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [addresses, setAddresses] = useState<AddressMaster[]>([]);
  const [duties, setDuties] = useState<MasterCode[]>([]);
  const [grades, setGrades] = useState<MasterCode[]>([]);
  const [loading, setLoading] = useState(true);
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
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  
  const [detailTarget, setDetailTarget] = useState<RequestHistory | null>(null);
  const [detailReadOnly, setDetailReadOnly] = useState(false);
  const [isRequestEditing, setIsRequestEditing] = useState(false);
  const [requestEditForm, setRequestEditForm] = useState<RequestHistory | null>(null);
  const [adminMemoInput, setAdminMemoInput] = useState('');
  
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
// 🚀 [수정] 견적 대조 상태 변수 (id 추가)
const [compareResult, setCompareResult] = useState<{
  status: 'idle' | 'analyzing' | 'success' | 'error';
  dbTotalQty: number;
  docTotalQty: number;
  docTotalPrice: number;
  matched: boolean;
  fileName: string;
  logs: string[];
  details: StatementMatchRow[];
}>({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] });

// 🚀 [신설] 개별 명함 행(Row)에 O, X, - 를 표시하기 위한 상태 저장소
const [itemMatchStatus, setItemMatchStatus] = useState<Record<string, 'match' | 'mismatch' | 'missing' | 'idle'>>({});
const [itemMatchPrice, setItemMatchPrice] = useState<Record<string, number>>({});
const [statementColMap, setStatementColMap] = useState<StatementColMap>(DEFAULT_STATEMENT_COL_MAP);
const [colMapEditor, setColMapEditor] = useState<{ key: StatementColKey; draft: string } | null>(null);
const [mailShortcutUrl, setMailShortcutUrl] = useState('');
const [mailShortcutEditor, setMailShortcutEditor] = useState<string | null>(null);
const [manualDrafts, setManualDrafts] = useState<Record<string, Record<StatementColKey, string>>>({});
const [manualEditRows, setManualEditRows] = useState<Record<string, boolean>>({});
const statementFileInputRef = useRef<HTMLInputElement>(null);
 

  const [currentBatch, setCurrentBatch] = useState<OrderBatch | null>(null);

  // 🚀 외주업체 마스터 데이터 상태 및 모달 제어
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState<Partial<Vendor>>(EMPTY_VENDOR_FORM);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');

  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedOrg, setSelectedOrg] = useState('ALL');
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [batchPage, setBatchPage] = useState(1);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 1. 상단 대기열 데이터 로드 (아직 묶이지 않은 접수완료 건만)
      const reqRes = await fetch(`/api/asset/businesscard/master/requests?t=${Date.now()}`, { cache: 'no-store' });
      if (reqRes.ok) {
        const data = await reqRes.json();
        const orphans = data.filter((r: any) => r.adminStatus === '발주완료' && !r.orderGroupId);
        if (orphans.length > 0) {
          await Promise.all(orphans.map((r: any) =>
            fetch('/api/asset/businesscard/master/requests', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: r.id, adminStatus: '접수완료' }),
            })
          ));
        }
        const orderWaitData = data
          .filter((r: any) => !r.orderGroupId && (r.adminStatus === '접수완료' || r.adminStatus === '발주완료'))
          .map((r: any) => ({ ...r, quantity: r.quantity || 1, adminStatus: '접수완료' }));
        setRequests(orderWaitData);
      }
      
      // 🚀 2. 하단 관리대장(발주 묶음) 데이터 로드 (증발 해결의 핵심!)
      const batchRes = await fetch(`/api/asset/businesscard/master/order?t=${Date.now()}`, { cache: 'no-store' });
      if (batchRes.ok) {
        const batchData = await batchRes.json();
        setBatches(batchData);
        const maps = collectInspectMaps(Array.isArray(batchData) ? batchData : []);
        setItemMatchStatus(maps.status);
        setItemMatchPrice(maps.price); 
      }
      
      const tsMaster = Date.now();
      const [unitRes, addrRes, configRes, masterRes] = await Promise.all([
        fetch(`/api/admin/units?active=true&t=${tsMaster}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/master/addresses?t=${tsMaster}`, { cache: 'no-store' }),
        fetch(`/api/admin/config?t=${tsMaster}`, { cache: 'no-store' }),
        fetch(`/api/admin/master-data?t=${tsMaster}`, { cache: 'no-store' }),
      ]);
      if (unitRes.ok) {
        const raw = await unitRes.json();
        setUnits(Array.isArray(raw) ? raw : []);
      } else setUnits([]);
      if (addrRes.ok) setAddresses(await addrRes.json());
      if (configRes.ok && masterRes.ok) {
        const config = await configRes.json();
        const allMaster = await masterRes.json();
        const dutyGroup = allMaster.find((g: any) => g.id === config.job_duty_group);
        const gradeGroup = allMaster.find((g: any) => g.id === config.job_grade_group);
        if (dutyGroup?.codes) setDuties(dutyGroup.codes);
        if (gradeGroup?.codes) setGrades(gradeGroup.codes);
      }

      // 4. 외주업체 마스터 로드
      const vendorRes = await fetch(`/api/asset/businesscard/master/vendors?t=${Date.now()}`, { cache: 'no-store' });
      if (vendorRes.ok) {
        const vData = await vendorRes.json();
        setVendors(vData);
        if (vData.length > 0) setSelectedVendorId(vData[0].id);
      } else {
        setVendors([]);
      }

      // 5. 권한 배너용 인터페이스 요약
      const ts = Date.now();
      const [meRes, ifRes, summaryRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
      ]);
      if (meRes && meRes.ok) setCurrentUser(await meRes.json());
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find(
              (m: any) =>
                m.path === MENU_PATH || m.path?.includes('/businesscard/master/order')
            )
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

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

  useEffect(() => {
    fetch(`/api/asset/businesscard/master/settings?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.statementColMap) {
          setStatementColMap(normalizeStatementColMap(data.statementColMap));
        }
        const shortcut = String(data?.mailShortcutUrl || '').trim();
        setMailShortcutUrl(shortcut);
      })
      .catch(() => {});
  }, []);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedIds(new Set(requests.map(r => r.id)));
    else setSelectedIds(new Set());
  };
  const handleSelectRow = (id: string) => {
    const nextSet = new Set(selectedIds);
    if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
    setSelectedIds(nextSet);
  };

  const handleCancelAccept = async (id: string, postNumber: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!confirm(`[${postNumber}] 접수를 취소하고 신청현황(대기중)으로 되돌릴까요?`)) return;
    try {
      const res = await fetch('/api/asset/businesscard/master/requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, adminStatus: '대기중', processDate: null, batchId: null }),
      });
      if (res.ok) {
        alert('접수를 취소했습니다. 신청현황 대기열로 돌아갑니다.');
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || '접수 취소에 실패했습니다.');
      }
    } catch {
      alert('서버 연결 실패');
    }
  };

  const handleSelectAllBatches = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pageIds = filteredBatches
      .slice((batchPage - 1) * BATCH_PAGE_SIZE, batchPage * BATCH_PAGE_SIZE)
      .map((b) => b.id);
    if (e.target.checked) {
      setSelectedBatchIds((prev) => new Set([...prev, ...pageIds]));
    } else {
      setSelectedBatchIds((prev) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  };
  const handleSelectBatchRow = (id: string) => {
    const nextSet = new Set(selectedBatchIds);
    if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
    setSelectedBatchIds(nextSet);
  };

// 🚀 이름/소속 기반 1:1 파일 분석 엔진 (조건부 3+1 핀셋 매칭 알고리즘 탑재)
const persistInspectResults = async (
  details: StatementMatchRow[],
  meta: { fileName: string; logs: string[]; matched: boolean; docTotalQty: number; docTotalPrice: number }
) => {
  const selectedBatches = batches.filter((b) => selectedBatchIds.has(b.id));
  if (selectedBatches.length === 0) return;

  const payload = selectedBatches.map((batch) => {
    const ids = new Set((batch.items || []).map((item) => item.id));
    const batchDetails = details.filter((d) => ids.has(d.id));
    const itemStatus: Record<string, ItemInspectStatus> = {};
    const itemPrice: Record<string, number> = {};
    batchDetails.forEach((d) => {
      itemStatus[d.id] = d.matchStatus || 'idle';
      itemPrice[d.id] = Number(d.docPrice) || 0;
    });
    const matched = batchDetails.length > 0 && batchDetails.every((d) => d.matchStatus === 'match' || d.adminOverride);
    const inspectStatus: 'idle' | 'match' | 'mismatch' = batchDetails.length === 0
      ? 'idle'
      : matched ? 'match' : 'mismatch';
    return {
      batchId: batch.id,
      inspectStatus,
      inspectFileName: meta.fileName || null,
      inspectResult: {
        fileName: meta.fileName,
        matched,
        docTotalQty: meta.docTotalQty,
        docTotalPrice: meta.docTotalPrice,
        logs: meta.logs,
        details: batchDetails,
        itemStatus,
        itemPrice,
      } as BatchInspectResult,
    };
  });

  setBatches((prev) => prev.map((batch) => {
    const row = payload.find((p) => p.batchId === batch.id);
    if (!row) return batch;
    return {
      ...batch,
      inspectStatus: row.inspectStatus,
      inspectFileName: row.inspectFileName,
      inspectResult: row.inspectResult,
    };
  }));

  try {
    const res = await fetch('/api/asset/businesscard/master/order/inspect', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batches: payload }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '검수 결과 저장 실패');
    }
  } catch (error: any) {
    console.error(error);
    alert(error.message || '검수 결과는 화면에 반영됐지만 서버 저장에 실패했습니다. 새로고침 시 사라질 수 있습니다.');
  }
};

const openCompareModal = () => {
  if (selectedBatchIds.size === 0) return alert('비교할 발주 묶음을 먼저 체크박스로 선택해 주세요.');
  const selected = batches.filter((b) => selectedBatchIds.has(b.id));
  const allInspected = selected.length > 0 && selected.every((b) => b.inspectStatus && b.inspectStatus !== 'idle' && b.inspectResult);
  if (allInspected) {
    const details = selected.flatMap((b) => b.inspectResult?.details || []);
    const logs = selected.flatMap((b) => b.inspectResult?.logs || []);
    const fileName = selected.find((b) => b.inspectFileName)?.inspectFileName || selected[0]?.inspectResult?.fileName || '';
    const docTotalQty = details.reduce((sum, d) => sum + (d.docQty || 0), 0);
    const docTotalPrice = details.reduce((sum, d) => sum + (d.docPrice || 0), 0);
    const dbTotal = selected.flatMap((b) => b.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
    const matched = details.length > 0 && details.every((d) => d.matchStatus === 'match' || d.adminOverride);
    setCompareResult({
      status: 'success',
      dbTotalQty: dbTotal,
      docTotalQty,
      docTotalPrice,
      matched,
      fileName,
      logs: logs.length > 0 ? logs : ['저장된 검수 결과를 불러왔습니다.'],
      details,
    });
    setManualDrafts(Object.fromEntries(
      details.map((d) => [d.id, {
        name: d.name || '',
        dept: d.docDept || '',
        qty: String(d.docQty || d.dbQty || ''),
        price: String(d.docPrice || 0),
      }])
    ));
    setManualEditRows({});
  } else {
    setCompareResult({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] });
    setManualDrafts({});
    setManualEditRows({});
  }
  setIsCompareModalOpen(true);
};

const handleReuploadClick = () => {
  if (compareResult.status === 'success') {
    if (!confirm('이전 교차 검증 결과를 지우고 새 거래명세표로 다시 비교할까요?')) return;
  }
  statementFileInputRef.current?.click();
};

const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  if (selectedBatchIds.size === 0) return alert("비교할 발주 묶음을 먼저 체크박스로 선택해 주세요.");

  const dbItems = batches.filter(b => selectedBatchIds.has(b.id)).flatMap(b => b.items || []);
  const dbTotal = dbItems.reduce((sum, item) => sum + (item.quantity || 1), 0);

  const baseItems = dbItems.map(item => ({
    id: item.id,
    name: item.userName,
    dept: item.deptName || item.deptHead,
    deptHead: item.deptHead,
    deptName: item.deptName,
    dbQty: item.quantity || 1,
  }));

  setCompareResult(prev => ({ ...prev, status: 'analyzing', fileName: file.name, dbTotalQty: dbTotal, logs: ['거래명세표 제목줄을 찾아 이름 행의 같은 열을 읽습니다...'], details: [] }));

  try {
    let logs = [`✅ DB 기준 대상자: 총 ${baseItems.length}명 (${dbTotal}통)`];
    let matched: StatementMatchRow[] = [];
    let docTotalQty = 0;
    let docTotalPrice = 0;
    const lower = file.name.toLowerCase();
    const colMapJson = JSON.stringify(statementColMap);

    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    const extracted = extractExcelStatementLines(jsonData, statementColMap);
    const lines = extracted.lines;
    logs.push(...extracted.warnings.map((w) => `⚠️ ${w}`));
    logs.push(`✅ 엑셀 파싱 완료. 이름 행 ${lines.length}건 인식`);
      lines.forEach((line) => {
        logs.push(`🔍 이름: ${line.name || '(미인식)'} / 수량: ${line.qty || 0}통 / 소속: ${line.dept || '(미인식)'} / 공급가액: ${line.price || 0}`);
      });
      matched = applyStatementMatches(baseItems, lines);
    } else if (lower.endsWith('.pdf')) {
      logs.push('⏳ PDF 감지. 지정한 칼럼 제목으로 같은 행을 추출합니다...');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('batchDetails', JSON.stringify(baseItems));
      formData.append('colMap', colMapJson);

      const ocrRes = await fetch('/api/asset/businesscard/master/compare-ocr', {
        method: 'POST',
        body: formData
      });

      if (!ocrRes.ok) throw new Error('PDF 분석 서버 응답 실패');

      const ocrData = await ocrRes.json();
      matched = ocrData.details || [];
      logs.push(...(ocrData.logs || []));
    } else {
      throw new Error('지원 형식은 PDF, Excel(.xlsx/.xls) 입니다.');
    }

    docTotalQty = matched.reduce((sum, d) => sum + (d.docQty || 0), 0);
    docTotalPrice = matched.reduce((sum, d) => sum + (d.docPrice || 0), 0);

    const selectedItemIds = new Set(dbItems.map((item) => item.id));
    const newMatchStatus = { ...itemMatchStatus };
    const newMatchPrice = { ...itemMatchPrice };
    selectedItemIds.forEach((id) => {
      newMatchStatus[id] = 'idle';
      delete newMatchPrice[id];
    });
    let isAllMatched = matched.length > 0;
    matched.forEach((d) => {
      const passed = d.nameMatch && d.deptMatch && d.qtyMatch;
      d.matchStatus = passed ? 'match' : (d.nameMatch ? 'mismatch' : 'missing');
      newMatchStatus[d.id] = d.matchStatus;
      newMatchPrice[d.id] = Number(d.docPrice) || 0;
      if (!passed) isAllMatched = false;
    });

    if (isAllMatched) logs.push('🎉 검증 완료: 모든 건의 이름·소속·수량이 일치합니다.');
    else logs.push('❌ 검증 실패: 이름·소속·수량 중 불일치 또는 누락이 있습니다. 통과는 3항목 모두 일치할 때만 됩니다.');

    setCompareResult(prev => ({
      ...prev, status: 'success', docTotalQty, docTotalPrice, matched: isAllMatched, logs, details: matched
    }));
    setItemMatchStatus(newMatchStatus);
    setItemMatchPrice(newMatchPrice);
    setManualDrafts(Object.fromEntries(
      matched.map((d) => [d.id, {
        name: d.name || '',
        dept: d.docDept || '',
        qty: String(d.docQty || d.dbQty || ''),
        price: String(d.docPrice || 0),
      }])
    ));
    setManualEditRows({});
    void persistInspectResults(matched, {
      fileName: file.name,
      logs,
      matched: isAllMatched,
      docTotalQty,
      docTotalPrice,
    });

  } catch (error: any) {
    console.error(error);
    setCompareResult(prev => ({ ...prev, status: 'error', logs: [...prev.logs, `❌ 오류 발생: ${error.message}`], details: [] }));
  }
};

const persistFromDetails = (details: StatementMatchRow[]) => {
  const matched = details.length > 0 && details.every((d) => d.matchStatus === 'match' || d.adminOverride);
  void persistInspectResults(details, {
    fileName: compareResult.fileName,
    logs: compareResult.logs,
    matched,
    docTotalQty: details.reduce((sum, d) => sum + (d.docQty || 0), 0),
    docTotalPrice: details.reduce((sum, d) => sum + (d.docPrice || 0), 0),
  });
};

const handleAdminAcceptMatch = (id: string) => {
  if (!confirm('문서에 적힌 이름·소속·수량을 확인한 뒤 이 건을 일치 처리할까요?\n(같은 이름이 여러 행으로 나뉜 경우·동명이인 여부는 관리자가 판단합니다.)')) return;
  const details: StatementMatchRow[] = compareResult.details.map((d) =>
    d.id === id
      ? {
          ...d,
          adminOverride: true,
          adminEditedFields: ['name', 'dept', 'qty', 'price'] as StatementColKey[],
          nameMatch: true,
          deptMatch: true,
          qtyMatch: true,
          matchStatus: 'match' as const,
          resultNote: d.resultNote,
        }
      : d
  );
  const allOk = details.length > 0 && details.every((d) => d.matchStatus === 'match' || d.adminOverride);
  setCompareResult((prev) => ({ ...prev, details, matched: allOk }));
  setItemMatchStatus((prev) => ({ ...prev, [id]: 'match' }));
  persistFromDetails(details);
};

const setManualDraftValue = (id: string, key: StatementColKey, value: string) => {
  setManualDrafts((prev) => ({
    ...prev,
    [id]: {
      name: prev[id]?.name ?? '',
      dept: prev[id]?.dept ?? '',
      qty: prev[id]?.qty ?? '',
      price: prev[id]?.price ?? '',
      [key]: value,
    },
  }));
};

const openManualEditRow = (detail: StatementMatchRow) => {
  if (!canEditMaster) return alertNoEditPermission();
  setManualDrafts((prev) => ({
    ...prev,
    [detail.id]: {
      name: prev[detail.id]?.name ?? detail.name ?? '',
      dept: prev[detail.id]?.dept ?? detail.docDept ?? '',
      qty: prev[detail.id]?.qty ?? String(detail.docQty || detail.dbQty || ''),
      price: prev[detail.id]?.price ?? String(detail.docPrice || 0),
    },
  }));
  setManualEditRows((prev) => ({ ...prev, [detail.id]: true }));
};

const cancelManualEditRow = (detail: StatementMatchRow) => {
  setManualDrafts((prev) => ({
    ...prev,
    [detail.id]: {
      name: detail.name ?? '',
      dept: detail.docDept ?? '',
      qty: String(detail.docQty || detail.dbQty || ''),
      price: String(detail.docPrice || 0),
    },
  }));
  setManualEditRows((prev) => ({ ...prev, [detail.id]: false }));
};

const completeManualEditRow = (id: string) => {
  const current = compareResult.details.find((detail) => detail.id === id);
  if (!current) return;
  const draft = manualDrafts[id] || {
    name: current.name || '',
    dept: current.docDept || '',
    qty: String(current.docQty || current.dbQty || ''),
    price: String(current.docPrice || 0),
  };
  const qty = Number(String(draft.qty || '').replace(/[^\d]/g, ''));
  const price = Number(String(draft.price || '').replace(/[^\d]/g, ''));
  if (!draft.name.trim()) return alert('임직원명을 입력해 주세요.');
  if (!draft.dept.trim()) return alert('소속을 입력해 주세요.');
  if (!Number.isFinite(qty) || qty <= 0) return alert('신청수량은 1 이상이어야 합니다.');
  if (!Number.isFinite(price) || price < 0) return alert('공급가액을 확인해 주세요.');

  setCompareResult((prev) => {
    const details: StatementMatchRow[] = prev.details.map((detail) => {
      if (detail.id !== id) return detail;
      return {
        ...detail,
        name: draft.name.trim(),
        nameMatch: true,
        docDept: draft.dept.trim(),
        docDepts: [draft.dept.trim()],
        docQty: qty,
        docQtyParts: [{ dept: draft.dept.trim(), qty }],
        deptMatch: true,
        qtyMatch: true,
        docPrice: price,
        adminOverride: true,
        adminEditedFields: ['name', 'dept', 'qty', 'price'],
        matchStatus: 'match',
      };
    });
    const matched = details.length > 0 && details.every((d) => d.matchStatus === 'match' || d.adminOverride);
    return {
      ...prev,
      docTotalQty: details.reduce((sum, d) => sum + (d.docQty || 0), 0),
      docTotalPrice: details.reduce((sum, d) => sum + (d.docPrice || 0), 0),
      matched,
      details,
    };
  });
  setItemMatchStatus((prev) => ({ ...prev, [id]: 'match' }));
  setItemMatchPrice((prev) => ({ ...prev, [id]: price }));
  setManualEditRows((prev) => ({ ...prev, [id]: false }));
  const nextDetails: StatementMatchRow[] = compareResult.details.map((detail) => {
    if (detail.id !== id) return detail;
    return {
      ...detail,
      name: draft.name.trim(),
      nameMatch: true,
      docDept: draft.dept.trim(),
      docDepts: [draft.dept.trim()],
      docQty: qty,
      docQtyParts: [{ dept: draft.dept.trim(), qty }],
      deptMatch: true,
      qtyMatch: true,
      docPrice: price,
      adminOverride: true,
      adminEditedFields: ['name', 'dept', 'qty', 'price'],
      matchStatus: 'match',
    };
  });
  persistFromDetails(nextDetails);
};

const applyManualField = (id: string, key: StatementColKey) => {
  const current = compareResult.details.find((detail) => detail.id === id);
  if (!current) return;
  const draft = manualDrafts[id]?.[key]?.trim() ?? '';
  let nextStatus: 'match' | 'mismatch' | 'missing' = current.matchStatus;
  if (key === 'name' && draft) nextStatus = (true && current.deptMatch && current.qtyMatch) ? 'match' : 'mismatch';
  if (key === 'dept' && draft) nextStatus = (current.nameMatch && true && current.qtyMatch) ? 'match' : 'mismatch';
  if (key === 'qty' && Number(draft.replace(/[^\d]/g, '')) > 0) nextStatus = (current.nameMatch && current.deptMatch && true) ? 'match' : 'mismatch';
  if (key === 'price') nextStatus = current.matchStatus;

  setCompareResult((prev) => {
    const details: StatementMatchRow[] = prev.details.map((detail) => {
      if (detail.id !== id) return detail;
      const editedFields = [...new Set([...(detail.adminEditedFields || []), key])] as StatementColKey[];
      if (key !== 'price' && !draft) return detail;

      if (key === 'name') {
        return {
          ...detail,
          name: draft,
          nameMatch: true,
          adminOverride: true,
          adminEditedFields: editedFields,
          matchStatus: (detail.deptMatch && detail.qtyMatch) ? 'match' as const : 'mismatch' as const,
        };
      }

      if (key === 'dept') {
        const qty = detail.docQty || detail.dbQty || 0;
        return {
          ...detail,
          docDept: draft,
          docDepts: draft ? [draft] : [],
          docQtyParts: draft ? [{ dept: draft, qty }] : detail.docQtyParts,
          deptMatch: true,
          adminOverride: true,
          adminEditedFields: editedFields,
          matchStatus: (detail.nameMatch && detail.qtyMatch) ? 'match' as const : 'mismatch' as const,
        };
      }

      if (key === 'qty') {
        const qty = Number(draft.replace(/[^\d]/g, ''));
        if (!Number.isFinite(qty) || qty <= 0) return detail;
        const dept = detail.docDept || detail.deptName || detail.deptHead || detail.dept || '(관리자 처리)';
        return {
          ...detail,
          docQty: qty,
          docQtyParts: [{ dept, qty }],
          qtyMatch: true,
          adminOverride: true,
          adminEditedFields: editedFields,
          matchStatus: (detail.nameMatch && detail.deptMatch) ? 'match' as const : 'mismatch' as const,
        };
      }

      const price = Number(draft.replace(/[^\d]/g, ''));
      if (!Number.isFinite(price) || price < 0) return detail;
      return {
        ...detail,
        docPrice: price,
        adminOverride: true,
        adminEditedFields: editedFields,
        matchStatus: (detail.nameMatch && detail.deptMatch && detail.qtyMatch) ? 'match' as const : 'mismatch' as const,
      };
    });

    const matched = details.length > 0 && details.every((d) => d.matchStatus === 'match' || d.adminOverride);
    return {
      ...prev,
      docTotalQty: details.reduce((sum, d) => sum + (d.docQty || 0), 0),
      docTotalPrice: details.reduce((sum, d) => sum + (d.docPrice || 0), 0),
      matched,
      details,
    };
  });

  setItemMatchStatus((prev) => ({
    ...prev,
    [id]: nextStatus === 'match' ? 'match' : (current.nameMatch ? 'mismatch' : 'missing'),
  }));
  if (key === 'price') {
    const price = Number((manualDrafts[id]?.price || '').replace(/[^\d]/g, ''));
    if (Number.isFinite(price) && price >= 0) {
      setItemMatchPrice((prev) => ({ ...prev, [id]: price }));
    }
  }
  persistFromDetails(compareResult.details.map((detail) => {
    if (detail.id !== id) return detail;
    const editedFields = [...new Set([...(detail.adminEditedFields || []), key])] as StatementColKey[];
    if (key !== 'price' && !draft) return detail;
    if (key === 'name') {
      return {
        ...detail,
        name: draft,
        nameMatch: true,
        adminOverride: true,
        adminEditedFields: editedFields,
        matchStatus: (detail.deptMatch && detail.qtyMatch) ? 'match' as const : 'mismatch' as const,
      };
    }
    if (key === 'dept') {
      const qty = detail.docQty || detail.dbQty || 0;
      return {
        ...detail,
        docDept: draft,
        docDepts: draft ? [draft] : [],
        docQtyParts: draft ? [{ dept: draft, qty }] : detail.docQtyParts,
        deptMatch: true,
        adminOverride: true,
        adminEditedFields: editedFields,
        matchStatus: (detail.nameMatch && detail.qtyMatch) ? 'match' as const : 'mismatch' as const,
      };
    }
    if (key === 'qty') {
      const qty = Number(draft.replace(/[^\d]/g, ''));
      if (!Number.isFinite(qty) || qty <= 0) return detail;
      const dept = detail.docDept || detail.deptName || detail.deptHead || detail.dept || '(관리자 처리)';
      return {
        ...detail,
        docQty: qty,
        docQtyParts: [{ dept, qty }],
        qtyMatch: true,
        adminOverride: true,
        adminEditedFields: editedFields,
        matchStatus: (detail.nameMatch && detail.deptMatch) ? 'match' as const : 'mismatch' as const,
      };
    }
    const price = Number(draft.replace(/[^\d]/g, ''));
    if (!Number.isFinite(price) || price < 0) return detail;
    return {
      ...detail,
      docPrice: price,
      adminOverride: true,
      adminEditedFields: editedFields,
      matchStatus: (detail.nameMatch && detail.deptMatch && detail.qtyMatch) ? 'match' as const : 'mismatch' as const,
    };
  }));
};

const openColMapEditor = (key: StatementColKey) => {
  if (!canEditMaster) return alertNoEditPermission();
  setColMapEditor({ key, draft: formatAliasInput(statementColMap[key]) });
};

const handleSaveColMap = async () => {
  if (!canEditMaster) return alertNoEditPermission();
  if (!colMapEditor) return;
  const aliases = parseAliasInput(colMapEditor.draft);
  if (aliases.length === 0) return alert('칼럼 제목을 한 개 이상 입력해 주세요.');
  const next = { ...statementColMap, [colMapEditor.key]: aliases };
  setStatementColMap(next);
  try {
    const res = await fetch('/api/asset/businesscard/master/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statementColMap: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '서버 저장 실패');
    }
  } catch (error: any) {
    alert(`서버 저장에 실패했습니다.\n${error.message || ''}`);
    return;
  }
  setColMapEditor(null);
};

// 🚀 새로운 /order API를 사용하는 발주 묶음 생성 함수
const handleCreateBatch = async () => {
  if (!canEditMaster) return alertNoEditPermission();
  if (selectedIds.size === 0) return alert('⚠️ 발주 처리할 명함을 선택해 주세요.');
  const targets = requests.filter(r => selectedIds.has(r.id));
  const dayKey = getKSTDateString().replace(/-/g, '');
  const sameDayCount = batches.filter((b) => String(b.id || '').includes(dayKey)).length;
  const batchId = `PO-BC-${dayKey}-${String(sameDayCount + 1).padStart(2, '0')}`;
  const distinctDepts = Array.from(new Set(targets.map(t => t.deptHead))).join(', ');
  
  try {
    const payload = {
      id: batchId,
      orderDate: getKSTDateString(),
      totalCount: targets.length,
      deptHeadGroup: distinctDepts || '전사종합',
      status: '발주완료',
      itemIds: targets.map(t => t.id)
    };

    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'DB 묶음 생성 실패');
    }

    const newBatch: OrderBatch = {
      id: batchId, 
      orderDate: payload.orderDate,
      totalCount: payload.totalCount, 
      deptHeadGroup: payload.deptHeadGroup,
      status: '발주완료', 
      items: targets.map(t => ({ ...t, adminStatus: '발주완료', batchId }))
    };
    
    setBatches([newBatch, ...batches]);
    setRequests(requests.filter(r => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    alert("🚀 발주 묶음이 성공적으로 생성되어 DB에 완벽히 반영되었습니다.");
  } catch (error: any) {
    console.error(error);
    alert(`❌ 발주 처리 실패: ${error.message}`);
  }
};

const handleExecuteUpdate = async () => {
  if (!requestEditForm) return;
  if (!adminMemoInput.trim()) return alert('⚠️ 변경 이력 관리를 위해 하단에 [수정 사유]를 반드시 입력해 주세요.');

  try {
    const payload = {
      ...requestEditForm,
      isModifiedByAdmin: true,
      adminMemo: adminMemoInput,
      adminModifierName: currentUser?.name || currentUser?.email || '',
      adminModifiedAt: new Date().toISOString()
    };

    const res = await fetch('/api/asset/businesscard/master/requests', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      alert("💾 원문 정보가 DB에 완벽히 동기화 되었습니다.");
      setRequests(requests.map(r => r.id === payload.id ? payload : r));
      setBatches(batches.map(b => ({ 
        ...b, items: b.items.map(item => item.id === payload.id ? payload : item) 
      })));
      setIsRequestEditing(false);
      setDetailTarget(null);
      setAdminMemoInput('');
    } else {
      alert("❌ 서버 업데이트 실패");
    }
  } catch (e) { alert("네트워크 오류"); }
};

const handleEditKoField = (field: 'userName' | 'additionalKo' | 'mobile' | 'phone' | 'email', value: string) => {
  setRequestEditForm((prev) => {
    if (!prev) return prev;
    const updated = { ...prev, [field]: value };
    if (field === 'email') updated.emailEn = value;
    if (field === 'mobile') updated.mobileEn = formatEnNumber('mobile', value);
    if (field === 'phone') updated.phoneEn = formatEnNumber('phone', value);
    return updated;
  });
};

const handleEditTitleChange = (value: string) => {
  setRequestEditForm((prev) => {
    if (!prev) return prev;
    const duty = duties.find((d) => d.label === value);
    const grade = grades.find((g) => g.label === value);
    return {
      ...prev,
      title: value,
      titleEn: duty?.value || grade?.value || (value === prev.title ? prev.titleEn : ''),
    };
  });
};

const handleEditAddressChange = (addrId: string) => {
  const target = addresses.find((a) => a.id === addrId);
  if (!target) return;
  setRequestEditForm((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      addressId: addrId,
      zipCode: target.zipCode,
      addressKo: target.addressKo,
      addressEn: target.addressEn,
      fax: target.fax,
      faxEn: target.faxEn,
    };
  });
};

const handleEditHeadChange = (unitName: string) => {
  const selected = units.find((u) => u.unit_name === unitName);
  const childNames = new Set(
    selected ? units.filter((u) => u.parent_id === selected.id).map((u) => u.unit_name) : []
  );
  setRequestEditForm((prev) => {
    if (!prev) return prev;
    const keepCenter = !!prev.deptName && childNames.has(prev.deptName);
    return {
      ...prev,
      deptHead: unitName,
      deptHeadEn: selected?.unit_name_en || '',
      deptName: keepCenter ? prev.deptName : '',
      deptNameEn: keepCenter ? prev.deptNameEn : '',
    };
  });
};

const handleEditSubChange = (unitName: string) => {
  const selected = units.find((u) => u.unit_name === unitName);
  setRequestEditForm((prev) => {
    if (!prev) return prev;
    if (!selected) return { ...prev, deptName: '', deptNameEn: '' };
    let headKo = prev.deptHead;
    let headEn = prev.deptHeadEn;
    if (selected.parent_id) {
      const parent = units.find((u) => u.id === selected.parent_id);
      if (parent) {
        headKo = parent.unit_name;
        headEn = parent.unit_name_en || '';
      }
    }
    return {
      ...prev,
      deptName: selected.unit_name,
      deptNameEn: selected.unit_name_en || '',
      deptHead: headKo,
      deptHeadEn: headEn,
    };
  });
};

const beginRequestEdit = (row: RequestHistory) => {
  const matched =
    addresses.find((a) => a.id === row.addressId) ||
    addresses.find((a) => a.zipCode === row.zipCode && a.addressKo === row.addressKo);
  setIsRequestEditing(true);
  setRequestEditForm({
    ...row,
    addressId: matched?.id || row.addressId || '',
  });
  setAdminMemoInput(row.adminMemo || '');
};

const handleBatchExcelDownload = (batch: OrderBatch) => {
  if (!canEditMaster) return alertNoEditPermission();
  const excelData = batch.items.map(r => ({
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
    '이메일(영문)': r.emailEn || r.email
  }));
  const ws = XLSX.utils.json_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "명함발주데이터");
  XLSX.writeFile(wb, `명함발주서_${formatBatchNo(batch.id)}.xlsx`);
};

const openEmailModal = (batch: OrderBatch) => {
  setCurrentBatch(batch);
  setIsEmailModalOpen(true);
};

const activeVendor = vendors.find(v => v.id === selectedVendorId) || vendors[0];
const getPreviewSubject = () => currentBatch ? `[명함발주] 한국생산성본부인증원 명함 제작 요청 (${formatBatchNo(currentBatch.id)})` : '';
const getPreviewBody = () => {
  if (!currentBatch) return '';
  if (!activeVendor) return '등록된 외주 업체가 없습니다. [업체 관리]에서 협력사를 먼저 등록해 주세요.';
  return `안녕하세요, ${activeVendor.companyName} ${activeVendor.managerName}님.\n한국생산성본부인증원 명함 신청 담당자입니다.\n\n금일 발주 확정된 명함 리스트 총 ${currentBatch.totalCount}건 송부해 드립니다.\n첨부된 엑셀 데이터로 명함 제작 부탁드립니다.\n\n- 발주 번호: ${formatBatchNo(currentBatch.id)}\n- 총 수량: ${currentBatch.totalCount}건\n\n감사합니다.`;
};

const handleCopyToClipboard = async () => {
  try {
    const vendorEmail = activeVendor?.email?.trim() || '';
    const copyText = [
      vendorEmail ? `수신 메일: ${vendorEmail}` : '수신 메일: (업체 이메일 없음)',
      `제목: ${getPreviewSubject()}`,
      '',
      getPreviewBody(),
    ].join('\n');
    await navigator.clipboard.writeText(copyText);
    alert('✅ 수신 메일·제목·본문이 복사되었습니다.\n사내 그룹웨어 메일 창에 붙여넣기(Ctrl+V) 해주세요.');
  } catch (err) { alert('복사에 실패했습니다. 내용을 직접 드래그해서 복사해 주세요.'); }
};

const handleSaveMailShortcut = async () => {
  if (!canEditMaster) return alertNoEditPermission();
  if (mailShortcutEditor == null) return;
  const next = mailShortcutEditor.trim();
  setMailShortcutUrl(next);
  try {
    const res = await fetch('/api/asset/businesscard/master/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailShortcutUrl: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '서버 저장 실패');
    }
  } catch (error: any) {
    alert(`서버 저장에 실패했습니다.\n${error.message || ''}`);
    return;
  }
  setMailShortcutEditor(null);
};

const handleOpenMailShortcut = () => {
  const url = String(mailShortcutUrl || '').trim();
  if (!url) {
    alert('메일 바로가기 경로가 비어 있습니다.\n⚙ 설정에서 그룹웨어 메일 작성 URL을 먼저 저장해 주세요.');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

// 🚀 개별 묶음 현물 지급 완료 처리 함수 (DB 연동 완료)
const getBatchInspectStatus = (batch: OrderBatch): 'idle' | 'match' | 'mismatch' => {
  if (batch.inspectStatus === 'match' || batch.inspectStatus === 'mismatch') return batch.inspectStatus;
  const items = batch.items || [];
  if (items.length === 0) return 'idle';
  const statuses = items.map((item) => itemMatchStatus[item.id] || 'idle');
  if (statuses.every((s) => s === 'idle')) return 'idle';
  if (statuses.every((s) => s === 'match')) return 'match';
  return 'mismatch';
};

const handleCancelOrderBatch = async (batch: OrderBatch, e: React.MouseEvent) => {
  e.stopPropagation();
  if (!canEditMaster) return alertNoEditPermission();
  if (batch.status === '지급완료') {
    return alert('지급완료 처리된 묶음은 발주 취소할 수 없습니다.');
  }
  if (!confirm(`[${formatBatchNo(batch.id)}] 발주를 취소하고 소속 건을 접수완료 발주 대기열로 되돌릴까요?`)) return;
  try {
    const res = await fetch(`/api/asset/businesscard/master/order?batchId=${encodeURIComponent(batch.id)}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '발주 취소 실패');
    setExpandedBatchId((prev) => (prev === batch.id ? null : prev));
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      next.delete(batch.id);
      return next;
    });
    alert('발주를 취소했습니다. 건은 접수완료 발주 대기열로 돌아갑니다.');
    fetchData();
  } catch (error: any) {
    alert(error.message || '발주 취소 중 오류가 발생했습니다.');
  }
};

const handleMarkAsDistributed = async (batchId: string, e: React.MouseEvent) => {
  e.stopPropagation(); // 행 클릭(아코디언 펼침) 방지
  if (!canEditMaster) return alertNoEditPermission();
  
  if (!confirm(`이 묶음의 명함 현물이 도착하여 임직원에게 지급을 완료하셨습니까?\n(확인 시 사용자 화면에서도 '지급완료'로 변경됩니다.)`)) return;

  try {
    // 💡 백엔드 DB 업데이트 요청 (주석 해제 및 활성화)
    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId })
    });
    
    if (!res.ok) throw new Error('DB 업데이트 실패');

    // 화면(UI) 즉각 업데이트
    setBatches(batches.map(b => 
      b.id === batchId 
        ? { 
            ...b, 
            status: '지급완료', 
            items: b.items.map(item => ({ ...item, adminStatus: '지급완료' })) 
          } 
        : b
    ));
    
    alert('🎁 지급완료 처리가 DB에 정상적으로 저장되었습니다.');
  } catch (error) {
    alert('❌ 처리 중 오류가 발생했습니다.');
  }
};

const handleMoveBatchToArchive = async (batch: OrderBatch, e: React.MouseEvent) => {
  e.stopPropagation();
  if (!canEditMaster) return alertNoEditPermission();
  if (batch.status !== '지급완료') {
    return alert('지급완료 처리된 묶음만 보관함으로 이동할 수 있습니다.\n배송 도착 후 [지급완료 처리]를 먼저 해 주세요.');
  }
  if (getBatchInspectStatus(batch) !== 'match') {
    return alert('명세서 검수(거래명세표)가 일치한 묶음만 이동할 수 있습니다.');
  }
  if (!confirm(`[${formatBatchNo(batch.id)}] 검수 완료 보관함으로 이동하시겠습니까?`)) return;

  try {
    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchIds: [batch.id] })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '이관 처리 실패');
    }
    setBatches((prev) => prev.filter((b) => b.id !== batch.id));
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      next.delete(batch.id);
      return next;
    });
    setExpandedBatchId((prev) => (prev === batch.id ? null : prev));
    alert('검수 완료 보관함으로 이동했습니다.');
  } catch (error: any) {
    console.error(error);
    alert(error.message || '보관함 이동 중 서버 오류가 발생했습니다.');
  }
};

const availableYears = useMemo(() => {
  const years = batches
    .map((b) => String(b.orderDate || '').substring(0, 4))
    .filter((y) => y.length === 4);
  const set = new Set(years);
  set.add(String(getKSTNowYearMonth().year));
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}, [batches]);

const afterYearList = useMemo(() => {
  if (selectedYear === 'ALL') return batches;
  return batches.filter((b) => String(b.orderDate || '').startsWith(selectedYear));
}, [batches, selectedYear]);

const availableMonths = useMemo(() => {
  const months = afterYearList
    .map((b) => String(b.orderDate || '').substring(5, 7))
    .filter(Boolean);
  return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
}, [afterYearList]);

const afterPeriodList = useMemo(() => {
  if (selectedMonth === 'ALL') return afterYearList;
  return afterYearList.filter((b) => String(b.orderDate || '').substring(5, 7) === selectedMonth);
}, [afterYearList, selectedMonth]);

const orgOptions = useMemo(() => flattenUnitsInSortOrder(units), [units]);
const organizationUnit = useMemo(
  () => orgOptions.find((u) => String(u.unit_type || '').trim().toUpperCase() === 'ORGANIZATION') || null,
  [orgOptions]
);
const selectedOrgUnit = orgOptions.find((u) => u.id === selectedOrg) || (selectedOrg === 'ALL' ? organizationUnit : null) || null;

useEffect(() => {
  if (selectedOrg !== 'ALL' || !organizationUnit) return;
  setSelectedOrg(organizationUnit.id);
}, [selectedOrg, organizationUnit]);

const q = searchUserQuery.trim().toLowerCase();
const filteredBatches = afterPeriodList.filter((b) => {
  const hasMatch = (b.items || []).some((item) => {
    if (!itemMatchesOrg(item, selectedOrg, units)) return false;
    if (q && !String(item.userName || '').toLowerCase().includes(q)) return false;
    return true;
  });
  return hasMatch;
});

const batchTotalPages = Math.max(1, Math.ceil(filteredBatches.length / BATCH_PAGE_SIZE));
const paginatedBatches = filteredBatches.slice(
  (batchPage - 1) * BATCH_PAGE_SIZE,
  batchPage * BATCH_PAGE_SIZE
);
const pageBatchIds = paginatedBatches.map((b) => b.id);
const allPageBatchesSelected =
  pageBatchIds.length > 0 && pageBatchIds.every((id) => selectedBatchIds.has(id));

useEffect(() => {
  setBatchPage(1);
}, [selectedYear, selectedMonth, selectedOrg, searchUserQuery]);

useEffect(() => {
  if (batchPage > batchTotalPages) setBatchPage(batchTotalPages);
}, [batchPage, batchTotalPages]);

return (
  <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
    
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

    {/* 상단 대기열 */}
    <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
      <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
          <h2 className="text-sm font-black text-slate-800 tracking-tight">접수완료/발주 대기열</h2>
          <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{requests.length}건</span>
        </div>
        <button
          type="button"
          onClick={handleCreateBatch}
          disabled={!canEditMaster || selectedIds.size === 0}
          title={!canEditMaster ? '편집 권한 필요' : undefined}
          className={`inline-flex items-center gap-1 text-[10px] font-black rounded-lg px-4 py-1.5 transition-colors shadow-sm ${
            canEditMaster
              ? 'bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-700 disabled:opacity-50'
              : DISABLED_ACTION_BTN
          }`}
        >
          <span>→</span>
          <span>선택된 {selectedIds.size}건 묶음 발주 생성 🚀</span>
        </button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse table-fixed min-w-[1200px]">
          <colgroup>
            <col className="w-[40px]" />
            <col className="w-[48px]" />
            <col className="w-[110px]" />
            <col className="w-[96px]" />
            <col className="w-[72px]" />
            <col className="w-[140px]" />
            <col className="w-[140px]" />
            <col className="w-[88px]" />
            <col className="w-[120px]" />
            <col className="w-[120px]" />
            <col className="w-[72px]" />
            <col className="w-[88px]" />
            <col className="w-[88px]" />
          </colgroup>
          <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
            <tr>
              <th className="h-12 pl-4 text-center">
                <input
                  type="checkbox"
                  onChange={handleSelectAll}
                  checked={requests.length > 0 && selectedIds.size === requests.length}
                  className="w-3 h-3 accent-indigo-600 cursor-pointer"
                />
              </th>
              <th className="h-12 px-2 text-center">NO</th>
              <th className="h-12 px-2 text-center whitespace-nowrap">관리번호</th>
              <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
              <th className="h-12 px-2 text-center whitespace-nowrap">신청주체</th>
              <th className="h-12 px-2">본부 (상위 조직)</th>
              <th className="h-12 px-2">센터 (하위 조직)</th>
              <th className="h-12 px-2">대상자</th>
              <th className="h-12 px-2">직책 / 직급</th>
              <th className="h-12 px-2 text-center whitespace-nowrap">신청내역</th>
              <th className="h-12 px-2 text-center whitespace-nowrap">수량(통)</th>
              <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
              <th className="h-12 px-2 text-center whitespace-nowrap">상태</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
            {requests.length === 0 ? (
              <tr>
                <td colSpan={13} className="p-16 text-center text-slate-400 text-xs">대기열이 비어있습니다.</td>
              </tr>
            ) : (
              requests.map((row, idx) => {
                const rowNo = requests.length - idx;
                const appliedTitle = String(row.title || '').trim() || '-';
                const isSelected = selectedIds.has(row.id);
                return (
                  <tr key={row.id} className={`hover:bg-slate-50/50 h-12 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                    <td className="pl-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectRow(row.id)}
                        className="w-3 h-3 accent-indigo-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                    <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate">{row.postNumber}</td>
                    <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">{row.applyDate}</td>
                    <td className="px-2 text-center">
                      {row.applicantType === '관리자대행' ? (
                        <span className="text-[10px] font-bold whitespace-nowrap text-indigo-700" title={row.applicantName || ''}>
                          관리자대행
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold whitespace-nowrap text-slate-600">
                          본인
                        </span>
                      )}
                    </td>
                    <td className="px-2 truncate" title={row.deptHead || ''}>{row.deptHead || '-'}</td>
                    <td className="px-2 truncate" title={row.deptName || ''}>{row.deptName || <span className="text-slate-300">-</span>}</td>
                    <td className="px-2 text-slate-800 truncate">{row.userName || '-'}</td>
                    <td className="px-2 text-slate-800 truncate" title={appliedTitle}>{appliedTitle}</td>
                    <td className="px-2 text-center">
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={() => {
                          if (!canEditMaster) return alertNoEditPermission();
                          setDetailReadOnly(false);
                          setIsRequestEditing(false);
                          setDetailTarget(row);
                        }}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-lg shadow-sm transition-colors ${
                          canEditMaster
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        원문 최종 검수
                      </button>
                    </td>
                    <td className="px-2 text-center font-mono tabular-nums text-slate-900">{row.quantity || 1}</td>
                    <td className="px-2 text-center">
                      <span className={`text-[10px] font-bold whitespace-nowrap ${
                        row.adminStatus === '지급완료'
                          ? 'text-purple-700'
                          : row.adminStatus === '발주완료'
                            ? 'text-emerald-600'
                            : row.adminStatus === '접수완료'
                              ? 'text-blue-600'
                              : row.adminStatus === '반려'
                                ? 'text-red-600'
                                : 'text-orange-600'
                      }`}>
                        {row.adminStatus}
                      </span>
                    </td>
                    <td className="px-2 text-center">
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={() => handleCancelAccept(row.id, row.postNumber)}
                        className={`px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                          canEditMaster
                            ? 'bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        접수 취소
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>

    {/* 하단 발주 묶음 대장 — 위 대기열과 동일 흰 카드, 헤더만 푸른 톤으로 구분 */}
    <div className={`bg-white border border-indigo-200 rounded-[2.5rem] shadow-sm mt-8 ${orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
      <div className={`p-4 px-6 bg-indigo-50 border-b border-indigo-200 flex flex-wrap items-center justify-between gap-4 relative ${orgMenuOpen ? 'z-[80] overflow-visible' : ''}`}>
        <div className="flex items-start gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 mt-1.5 shrink-0" />
          <div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">외주 발주 묶음 관리 대장</h2>
            <p className="text-[11px] text-indigo-700/70 font-bold mt-1">엑셀 저장·메일 복사(그룹웨어 첨부) → 배송 도착 후 지급처리 → 거래명세표 검수 → 보관함 이동</p>
          </div>
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
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth('ALL');
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
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
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
                    selectedOrgUnit && isBoldOrgType(selectedOrgUnit.unit_type) ? 'font-black text-slate-900' : 'font-bold text-slate-800'
                  }`}
                >
                  {selectedOrgUnit ? selectedOrgUnit.unit_name : organizationUnit?.unit_name || '조직 선택'}
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
                            setSelectedOrg(dept.id);
                            setOrgMenuOpen(false);
                          }}
                          className={`w-full text-left pr-3 py-1.5 text-[11px] ${
                            bold ? 'font-black text-slate-900' : 'font-medium text-slate-600'
                          } ${selectedOrg === dept.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
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
                value={searchUserQuery}
                onChange={(e) => setSearchUserQuery(e.target.value)}
                className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-indigo-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-indigo-100 text-indigo-900 text-[10px] font-black uppercase tracking-widest border-b border-indigo-200">
            <tr>
              <th className="h-12 px-4 w-[50px]"><input type="checkbox" onChange={handleSelectAllBatches} checked={allPageBatchesSelected} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></th>
              <th className="h-12 px-2 w-[160px]">묶음 번호</th>
              <th className="h-12 px-4 w-[120px]">발주 일자</th>
              <th className="h-12 px-4 min-w-[160px]">신청 상세</th>
              <th className="h-12 px-4 text-center w-[80px]">총 수량</th>
              <th className="h-12 px-2 text-center w-[120px]">엑셀 다운로드</th>
              <th className="h-12 px-2 text-center w-[120px]">업체 메일 발송</th>
              <th className="h-12 px-2 text-center w-[110px]">지급처리</th>
              <th className="h-12 px-2 text-center min-w-[128px]">
                <div className="flex flex-col items-center justify-center gap-1">
                  <span>명세서 검수</span>
                  <button
                    type="button"
                    onClick={openCompareModal}
                    disabled={selectedBatchIds.size === 0}
                    className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white font-black text-[10px] rounded-lg shadow-sm disabled:opacity-40 whitespace-nowrap normal-case tracking-normal"
                  >
                    선택 명세서 검수({selectedBatchIds.size}건)
                  </button>
                </div>
              </th>
              <th className="h-12 px-2 text-center w-[150px]">
                <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                  <span>보관함 이동</span>
                  <span className="text-[9px] font-bold text-indigo-700/80 normal-case tracking-normal">(지급/검수 완료 후)</span>
                </div>
              </th>
              <th className="h-12 px-2 text-center w-[90px]">발주 취소</th>
            </tr>
          </thead>
          <tbody className="bg-white text-xs font-bold text-slate-700 divide-y divide-slate-100">
            {filteredBatches.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-16 text-center text-slate-400 text-xs">발주 묶음이 없습니다.</td>
              </tr>
            ) : paginatedBatches.map((batch) => (
              <React.Fragment key={batch.id}>
                <tr className={`h-16 hover:bg-indigo-50/40 transition-colors ${selectedBatchIds.has(batch.id) ? 'bg-indigo-50/50' : ''}`}>
                  <td className="px-4"><input type="checkbox" checked={selectedBatchIds.has(batch.id)} onChange={() => handleSelectBatchRow(batch.id)} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></td>
                  <td className="px-2 font-mono text-indigo-600 cursor-pointer" onClick={() => setExpandedBatchId(expandedBatchId === batch.id ? null : batch.id)}>{expandedBatchId === batch.id ? '👇' : '👉'} {formatBatchNo(batch.id)}</td>
                  <td className="px-4 text-slate-600 font-mono">{batch.orderDate}</td>
                  <td className="px-4 cursor-pointer" onClick={() => setExpandedBatchId(expandedBatchId === batch.id ? null : batch.id)}>
                    <span className="text-indigo-600 underline underline-offset-2 font-black">상세 보기</span>
                    {(() => {
                      const names = Array.from(new Set((batch.items || []).map((i) => i.userName).filter(Boolean)));
                      if (names.length === 0) return null;
                      const label = names.join(', ');
                      return <p className="text-[10px] text-slate-400 mt-0.5 truncate" title={label}>{label}</p>;
                    })()}
                  </td>
                  <td className="px-4 text-center text-indigo-700 font-black">{batch.items?.length || 0} 건</td>
                  <td className="px-2 text-center">
                    <button
                      type="button"
                      disabled={!canEditMaster}
                      title={!canEditMaster ? '편집 권한 필요' : undefined}
                      onClick={() => handleBatchExcelDownload(batch)}
                      className={`p-1.5 px-3 font-black text-[10px] rounded-lg w-full ${
                        canEditMaster
                          ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                          : DISABLED_ACTION_BTN
                      }`}
                    >
                      📊 엑셀 저장
                    </button>
                  </td>
                  <td className="px-2 text-center">
                    <button
                      type="button"
                      onClick={() => openEmailModal(batch)}
                      className="p-1.5 px-3 font-black text-[10px] rounded-lg w-full transition-colors bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200"
                    >
                      📋 미리보기
                    </button>
                  </td>
                  <td className="px-2 text-center">
                      {batch.status === '발주완료' ? (
                        <button 
                          type="button"
                          disabled={!canEditMaster}
                          title={!canEditMaster ? '편집 권한 필요' : undefined}
                          onClick={(e) => handleMarkAsDistributed(batch.id, e)} 
                          className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                            canEditMaster
                              ? 'bg-blue-600 hover:bg-blue-700 text-white'
                              : DISABLED_ACTION_BTN
                          }`}
                        >
                          <span>→</span>
                          <span>명함지급완료</span>
                        </button>
                      ) : (
                        <span className="text-[10px] font-bold whitespace-nowrap text-violet-700">지급완료</span>
                      )}
                    </td>
                  <td className="px-2 text-center">
                    {(() => {
                      const inspect = getBatchInspectStatus(batch);
                      if (inspect === 'match') return <span className="text-[10px] font-black text-emerald-600">일치</span>;
                      if (inspect === 'mismatch') return <span className="text-[10px] font-black text-rose-600">불일치</span>;
                      return <span className="text-[10px] font-black text-slate-400">미검수</span>;
                    })()}
                  </td>
                  <td className="px-2 text-center">
                    {batch.status === '지급완료' && getBatchInspectStatus(batch) === 'match' ? (
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={(e) => handleMoveBatchToArchive(batch, e)}
                        className={`p-1.5 px-2 font-black text-[10px] rounded-lg shadow-sm w-full whitespace-nowrap ${
                          canEditMaster
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        → 검수 완료 보관함 이동
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-2 text-center">
                    {batch.status === '발주완료' ? (
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={(e) => handleCancelOrderBatch(batch, e)}
                        className={`p-1.5 px-2 font-black text-[10px] rounded-lg w-full ${
                          canEditMaster
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        발주 취소
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                </tr>
                
                {expandedBatchId === batch.id && (
                  <tr>
                    <td colSpan={11} className="bg-indigo-50/60 p-6 border-l-4 border-indigo-400">
                      <div className="bg-white border border-indigo-100 rounded-2xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-600 font-black tracking-widest border-b border-slate-200 text-[10px]">
                            <tr>
                              <th className="h-10 px-2 w-[48px] text-center">NO</th>
                              <th className="h-10 px-2 w-[110px] text-center whitespace-nowrap">관리번호</th>
                              <th className="h-10 px-2 w-[96px] text-center whitespace-nowrap">신청일</th>
                              <th className="h-10 px-2 w-[72px] text-center whitespace-nowrap">신청주체</th>
                              <th className="h-10 px-2">본부 (상위 조직)</th>
                              <th className="h-10 px-2">센터 (하위 조직)</th>
                              <th className="h-10 px-2">대상자</th>
                              <th className="h-10 px-2">직책 / 직급</th>
                              <th className="h-10 px-2 text-center w-[72px] whitespace-nowrap">수량(통)</th>
                              <th className="h-10 px-2 text-center w-[120px] whitespace-nowrap">원문 확인</th>
                              <th className="h-10 px-2 text-center w-[80px] whitespace-nowrap">명세서 대조</th>
                              <th className="h-10 px-2 text-center w-[96px] whitespace-nowrap">금액결과</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                            {batch.items?.map((item, idx) => {
                              const mStatus = itemMatchStatus[item.id] || 'idle';
                              return (
                              <tr key={item.id} className={`h-12 hover:bg-slate-50/50 text-[11px] font-bold text-slate-700 ${mStatus === 'mismatch' || mStatus === 'missing' ? 'bg-rose-50/40' : ''}`}>
                                <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{idx + 1}</td>
                                <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate">{item.postNumber}</td>
                                <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">{item.applyDate || '-'}</td>
                                <td className="px-2 text-center">
                                  {item.applicantType === '관리자대행' ? (
                                    <span className="text-[10px] font-bold whitespace-nowrap text-indigo-700">관리자대행</span>
                                  ) : (
                                    <span className="text-[10px] font-bold whitespace-nowrap text-slate-600">본인</span>
                                  )}
                                </td>
                                <td className="px-2 truncate" title={item.deptHead || ''}>{item.deptHead || '-'}</td>
                                <td className="px-2 truncate" title={item.deptName || ''}>{item.deptName || <span className="text-slate-300">-</span>}</td>
                                <td className="px-2 text-slate-800 truncate">{item.userName || '-'}</td>
                                <td className="px-2 text-slate-800 truncate" title={item.title || ''}>{item.title || '-'}</td>
                                <td className="px-2 text-center font-mono tabular-nums text-slate-900">{item.quantity || 1}</td>
                                <td className="px-4 text-center">
                                  <button
                                    type="button"
                                    disabled={!canEditMaster}
                                    title={!canEditMaster ? '편집 권한 필요' : undefined}
                                    onClick={() => {
                                      if (!canEditMaster) return alertNoEditPermission();
                                      setDetailReadOnly(true);
                                      setIsRequestEditing(false);
                                      setDetailTarget(item);
                                    }}
                                    className={`px-3 py-1.5 text-[11px] font-black rounded-lg transition-colors ${
                                      canEditMaster
                                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                                        : DISABLED_ACTION_BTN
                                    }`}
                                  >
                                    원문 확인
                                  </button>
                                </td>
                                <td className="px-4 text-center text-base font-black">
                                  {mStatus === 'idle' && <span className="text-slate-300">-</span>}
                                  {mStatus === 'match' && <span className="text-emerald-500">O</span>}
                                  {(mStatus === 'mismatch' || mStatus === 'missing') && <span className="text-rose-500">X</span>}
                                </td>
                                <td className="px-2 text-center font-mono tabular-nums text-[11px]">
                                  {mStatus === 'idle' ? (
                                    <span className="text-slate-300">-</span>
                                  ) : (
                                    <span className={itemMatchPrice[item.id] ? 'text-slate-900' : 'text-slate-400'}>
                                      ₩{(itemMatchPrice[item.id] || 0).toLocaleString()}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )})}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {filteredBatches.length > 0 && (
        <div className="flex justify-center items-center gap-1.5 py-3 border-t border-indigo-100 bg-white">
          <button
            type="button"
            disabled={batchPage === 1}
            onClick={() => setBatchPage((p) => p - 1)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
          >
            이전
          </button>
          {Array.from({ length: batchTotalPages }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setBatchPage(i + 1)}
              className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
                batchPage === i + 1
                  ? 'bg-slate-800 text-white shadow-sm scale-105'
                  : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            disabled={batchPage === batchTotalPages}
            onClick={() => setBatchPage((p) => p + 1)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
          >
            다음
          </button>
        </div>
      )}
    </div>
    {detailTarget && (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-black text-blue-600 font-mono tracking-widest">{isRequestEditing ? '⚡ 원문 편집 모드 활성화 (발주 전 최종)' : (detailReadOnly ? '🔎 원문 확인' : '🔎 발주 원문 검수 모드')}</span>
              <h2 className="text-base font-black text-slate-900 mt-1">{detailReadOnly ? `명함 신청 원문 확인 (${detailTarget.userName} 님)` : `명함 신청 데이터 세부 검수창 (${detailTarget.userName} 님)`}</h2>
            </div>
            <button onClick={() => { setDetailTarget(null); setIsRequestEditing(false); setDetailReadOnly(false); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black text-sm transition-colors">✕</button>
          </div>

          {detailTarget.isModifiedByAdmin && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-bold">⚠️ 주의: 이 신청서는 관리자에 의해 이미 한 번 수정된 이력이 있습니다. (사유: {detailTarget.adminMemo})</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-100">
            {(() => {
              const preview = isRequestEditing && requestEditForm ? requestEditForm : detailTarget;
              const titleInMaster =
                duties.some((d) => d.label === preview.title) ||
                grades.some((g) => g.label === preview.title);
              const matchedAddress =
                addresses.find((a) => a.id === preview.addressId) ||
                addresses.find((a) => a.zipCode === preview.zipCode && a.addressKo === preview.addressKo);
              const addressSelectValue = matchedAddress?.id || preview.addressId || '';
              const addressOptions = [
                ...addresses.filter((a) => a.isActive || a.id === addressSelectValue),
              ];
              if (addressSelectValue && !addressOptions.some((a) => a.id === addressSelectValue)) {
                addressOptions.unshift({
                  id: addressSelectValue,
                  label: '현재 주소',
                  zipCode: preview.zipCode,
                  addressKo: preview.addressKo,
                  addressEn: preview.addressEn,
                  fax: preview.fax,
                  faxEn: preview.faxEn,
                  isActive: false,
                });
              }
              const syncedCls = 'w-full p-1.5 border border-slate-200 rounded bg-slate-50 text-xs font-black text-slate-500 cursor-not-allowed';
              const hqUnits = (() => {
                const hqs = units.filter((u) => isBusinessCardHqUnit(u) || !u.parent_id);
                if (preview.deptHead && !hqs.some((u) => u.unit_name === preview.deptHead)) {
                  const extra = units.find((u) => u.unit_name === preview.deptHead);
                  if (extra) return [...hqs, extra];
                  return [...hqs, { id: `current-hq`, unit_name: preview.deptHead, unit_name_en: preview.deptHeadEn || '', parent_id: null }];
                }
                return hqs;
              })();
              const selectedHeadUnit = units.find((u) => u.unit_name === preview.deptHead);
              const childCenterUnits = (() => {
                const children = selectedHeadUnit
                  ? units.filter((u) => u.parent_id === selectedHeadUnit.id && !isBusinessCardHqUnit(u))
                  : [];
                if (preview.deptName && !children.some((u) => u.unit_name === preview.deptName)) {
                  const extra = units.find((u) => u.unit_name === preview.deptName);
                  if (extra) return [...children, extra];
                  return [...children, { id: `current-center`, unit_name: preview.deptName, unit_name_en: preview.deptNameEn || '', parent_id: selectedHeadUnit?.id || null }];
                }
                return children;
              })();
              return (
            <>
            <div className="space-y-2 border-r border-slate-200 pr-5 flex flex-col">
              <h3 className="text-xs font-black text-slate-800 border-b pb-1.5">1. 국문 조판 데이터</h3>
              <div className="space-y-1.5 text-xs font-bold text-slate-600 flex-1">
                <label className="block text-[10px] text-slate-400 mt-1">성명</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.userName || ''} onChange={e => handleEditKoField('userName', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white text-xs font-black" /> : <p className="text-slate-900 font-black">{detailTarget.userName}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">본부 (상위 조직)</label>
                {isRequestEditing ? (
                  <select
                    value={preview.deptHead || ''}
                    onChange={(e) => handleEditHeadChange(e.target.value)}
                    className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black"
                  >
                    <option value="">선택</option>
                    {hqUnits.map((u) => (
                      <option key={`h-${u.id}`} value={u.unit_name}>{u.unit_name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-slate-900 font-black">{detailTarget.deptHead || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">센터 (하위 조직)</label>
                {isRequestEditing ? (
                  <select
                    value={preview.deptName || ''}
                    disabled={!preview.deptHead}
                    onChange={(e) => handleEditSubChange(e.target.value)}
                    className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">(본부의 하위 센터만 선택)</option>
                    {childCenterUnits.map((u) => (
                      <option key={`s-${u.id}`} value={u.unit_name}>{u.unit_name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-slate-900 font-black">{detailTarget.deptName || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">직책/직급</label>
                {isRequestEditing ? (
                  <select
                    value={preview.title}
                    onChange={(e) => handleEditTitleChange(e.target.value)}
                    className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black"
                  >
                    <option value="">선택</option>
                    {!titleInMaster && preview.title ? (
                      <option value={preview.title}>{preview.title} (현재값)</option>
                    ) : null}
                    {duties.length > 0 && (
                      <optgroup label="직책">
                        {duties.map((d) => (
                          <option key={`duty-${d.id}`} value={d.label}>{d.label}</option>
                        ))}
                      </optgroup>
                    )}
                    {grades.length > 0 && (
                      <optgroup label="직급 (직책 없을 때)">
                        {grades.map((g) => (
                          <option key={`grade-${g.id}`} value={g.label}>{g.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : (
                  <p className="text-slate-900 font-black">{detailTarget.title}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">자격사항</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.additionalKo || ''} onChange={e => handleEditKoField('additionalKo', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black" /> : <p className="text-slate-900 font-black">{detailTarget.additionalKo || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">휴대전화</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.mobile || ''} onChange={e => handleEditKoField('mobile', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono font-black">{detailTarget.mobile}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">내선전화</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.phone || ''} onChange={e => handleEditKoField('phone', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono">{detailTarget.phone || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">이메일</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.email || ''} onChange={e => handleEditKoField('email', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono">{detailTarget.email}</p>}
              </div>
              <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                {isRequestEditing ? (
                  <>
                    <label className="block text-[10px] text-slate-400">주소지 선택</label>
                    <select
                      value={addressSelectValue}
                      onChange={(e) => handleEditAddressChange(e.target.value)}
                      className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black"
                    >
                      <option value="">선택</option>
                      {addressOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                    <p className="text-[11px] font-bold text-slate-500">팩스: <span className="font-mono text-slate-800">{preview.fax || '-'}</span></p>
                    <p className="text-[11px] font-bold text-slate-500 leading-relaxed">주소: <span className="text-slate-800">[{preview.zipCode}] {preview.addressKo}</span></p>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-bold text-slate-600 mb-1">팩스: <span className="font-mono text-slate-900">{detailTarget.fax || '-'}</span></p>
                    <p className="text-[11px] font-bold text-slate-600 leading-relaxed">주소: <span className="text-slate-900">[{detailTarget.zipCode}] {detailTarget.addressKo}</span></p>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2 pl-1 flex flex-col">
              <h3 className="text-xs font-black text-indigo-800 border-b border-indigo-100 pb-1.5">2. 영문 조판 데이터</h3>
              <div className="space-y-1.5 text-xs font-bold text-slate-600 flex-1">
                <label className="block text-[10px] text-slate-400 mt-1">영문 성명</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.userNameEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, userNameEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-black" /> : <p className="text-indigo-900 font-black">{detailTarget.userNameEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 본부 (상위 조직) (조직 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.deptHeadEn || '-'} className={syncedCls} />
                ) : (
                  <p className="text-indigo-900 font-black">{detailTarget.deptHeadEn || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 센터 (하위 조직) (조직 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.deptNameEn || '-'} className={syncedCls} />
                ) : (
                  <p className="text-indigo-900 font-black">{detailTarget.deptNameEn || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 직책/직급 (마스터 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.titleEn || '-'} className={syncedCls} />
                ) : (
                  <p className="text-indigo-900 font-black">{detailTarget.titleEn || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 자격사항</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.additionalEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, additionalEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-black" /> : <p className="text-indigo-900 font-black">{detailTarget.additionalEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 휴대전화 (국문 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.mobileEn || '-'} className={`${syncedCls} font-mono`} />
                ) : (
                  <p className="text-indigo-900 font-mono font-black">{detailTarget.mobileEn || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 내선전화 (국문 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.phoneEn || '-'} className={`${syncedCls} font-mono`} />
                ) : (
                  <p className="text-indigo-900 font-mono">{detailTarget.phoneEn || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 이메일 (국문 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.emailEn || '-'} className={`${syncedCls} font-mono`} />
                ) : (
                  <p className="text-indigo-900 font-mono">{detailTarget.emailEn || '-'}</p>
                )}
              </div>
              <div className="mt-4 p-3 bg-white rounded-xl border border-indigo-100">
                <p className="text-[11px] font-bold text-slate-600 mb-1">영문 팩스: <span className="font-mono text-indigo-900">{preview.faxEn || '-'}</span></p>
                <p className="text-[11px] font-bold text-slate-600 leading-relaxed">영문 주소: <span className="text-indigo-900">{preview.addressEn || '-'}</span></p>
              </div>
            </div>
            </>
              );
            })()}
          </div> 

          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between shadow-inner">
            <div>
              <label className="block text-sm font-black text-rose-900 mb-0.5">📦 명함 발주 최종 수량 (통)</label>
              <p className="text-[10px] text-rose-700 font-bold">{detailReadOnly ? '인쇄소에 전달된 제작 수량입니다. 변경이 필요하면 묶음의 [발주 취소]로 대기열에 되돌린 뒤 수정하세요.' : '인쇄소에 전달될 최종 제작 수량입니다. 수정이 필요할 경우 우측 폼에서 조정하세요.'}</p>
            </div>
            <div className="w-32">
              {isRequestEditing ? (
                <input type="number" min="1" value={requestEditForm?.quantity || 1} onChange={e => setRequestEditForm({...requestEditForm!, quantity: parseInt(e.target.value)})} className="w-full p-2.5 border-2 border-rose-400 rounded-xl bg-white text-rose-700 font-black text-base text-center outline-none focus:border-rose-600" />
              ) : (
                <div className="w-full p-2.5 bg-white border-2 border-rose-200 rounded-xl text-rose-600 font-black text-base text-center shadow-sm">{detailTarget.quantity || 1} 통</div>
              )}
            </div>
          </div>

          {isRequestEditing && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <label className="block text-xs font-black text-amber-900 mb-2">📝 발주 전 최종 수정 사유 (임직원 마이페이지에 표시됩니다) *</label>
              <input type="text" value={adminMemoInput} onChange={(e) => setAdminMemoInput(e.target.value)} placeholder="예: 직급 오기재 수정, 영문 성명 스펠링 최종 수정 등" className="w-full p-2.5 text-xs font-bold text-slate-800 border border-amber-300 rounded-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200" />
            </div>
          )}

          <div className="flex gap-2 justify-end pt-3 border-t border-slate-100 mt-2">
            {isRequestEditing ? (
              <>
                <button onClick={() => { setIsRequestEditing(false); setAdminMemoInput(''); }} className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-xl font-black text-xs hover:bg-slate-300 transition-colors">수정 취소</button>
                <button onClick={handleExecuteUpdate} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-black text-xs hover:bg-blue-700 transition-colors shadow-md">변경사항 DB 저장</button>
              </>
            ) : (
              <>
                <button onClick={() => { setDetailTarget(null); setDetailReadOnly(false); }} className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-black text-xs hover:bg-slate-200 transition-colors">닫기</button>
                {!detailReadOnly && (
                  <button onClick={() => beginRequestEdit(detailTarget)} className="px-5 py-2.5 bg-amber-500 text-white rounded-xl font-black text-xs hover:bg-amber-600 transition-colors shadow-sm">✏️ 발주 전 직접 수정하기</button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )}

    {/* 🚀 그룹웨어 발송용 메일 양식 미리보기 모달 */}
    {isEmailModalOpen && (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-4xl w-full p-8 space-y-6">
          <div className="border-b border-slate-100 pb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex-1">
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">📋 그룹웨어 발송용 메일 양식 미리보기</h2>
              <p className="text-xs text-slate-500 font-bold mt-2 leading-relaxed">수신 업체를 선택하면 본문이 자동으로 변경됩니다.<br/>복사 후 그룹웨어에 붙여넣으세요.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)} className="bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-black py-2.5 px-3 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 w-48 cursor-pointer">
                {vendors.map(vendor => (
                  <option key={vendor.id} value={vendor.id}>{vendor.companyName} ({vendor.managerName})</option>
                ))}
                {vendors.length === 0 && <option value="">등록된 업체 없음</option>}
              </select>
              <button
                type="button"
                disabled={!canEditMaster}
                title={!canEditMaster ? '편집 권한 필요' : undefined}
                onClick={() => {
                  if (!canEditMaster) return alertNoEditPermission();
                  setIsVendorModalOpen(true);
                }}
                className={`px-4 py-2.5 font-black text-xs rounded-xl transition-colors whitespace-nowrap shadow-sm ${
                  canEditMaster
                    ? 'bg-slate-800 text-white hover:bg-slate-900'
                    : DISABLED_ACTION_BTN
                }`}
              >
                ⚙️ 업체 관리
              </button>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5 ml-1">담당자 이메일</label>
              <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-800 select-all cursor-text">
                {activeVendor?.email?.trim() || <span className="text-slate-400">선택한 업체 이메일이 없습니다.</span>}
              </div>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5 ml-1">메일 제목 (클릭 시 자동 선택)</label>
              <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-800 select-all cursor-text">{getPreviewSubject()}</div>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5 ml-1">메일 본문 (클릭 시 자동 선택)</label>
              <textarea readOnly rows={8} value={getPreviewBody()} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 whitespace-pre-wrap resize-none focus:outline-none select-all cursor-text" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
            <button onClick={() => setIsEmailModalOpen(false)} className="px-5 py-2.5 bg-slate-100 font-black text-xs rounded-xl hover:bg-slate-200 text-slate-700 transition-colors">닫기</button>
            <button onClick={handleCopyToClipboard} className="px-6 py-2.5 bg-indigo-600 text-white font-black text-xs rounded-xl hover:bg-indigo-700 shadow-md transition-colors">📝 메일·제목·본문 전체 복사하기</button>
            <div className="flex items-center">
              <button
                type="button"
                onClick={handleOpenMailShortcut}
                className="px-6 py-2.5 bg-slate-800 text-white font-black text-xs rounded-l-xl hover:bg-slate-900 shadow-md transition-colors"
              >
                메일로 바로가기 ↗
              </button>
              <button
                type="button"
                disabled={!canEditMaster}
                title={!canEditMaster ? '편집 권한 필요' : undefined}
                onClick={() => {
                  if (!canEditMaster) return alertNoEditPermission();
                  setMailShortcutEditor(mailShortcutUrl);
                }}
                className={`px-3 py-2.5 font-black text-xs rounded-r-xl shadow-md border-l border-slate-600 ${
                  canEditMaster
                    ? 'bg-slate-700 text-white hover:bg-slate-600'
                    : DISABLED_ACTION_BTN
                }`}
              >
                ⚙
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* 🚀 외주업체 마스터 관리 모달 */}
    {isVendorModalOpen && (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-5xl w-full p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">⚙️ 외주업체 마스터 데이터 관리</h2>
              <p className="text-xs text-slate-500 font-bold mt-1">명함 조판 협력사 정보를 관리합니다. 사용하지 않는 업체는 삭제할 수 있으며, 발주 이력은 그대로 남습니다.</p>
            </div>
            {vendorForm.id && <span className="bg-amber-100 text-amber-800 text-[11px] font-black px-3 py-1 rounded-lg animate-pulse">✏️ 현재 업체 정보 수정 중</span>}
          </div>

          <div className={`flex flex-wrap gap-2 items-end p-4 rounded-2xl border transition-all ${vendorForm.id ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">업체명</label>
              <input type="text" value={vendorForm.companyName || ''} onChange={e => setVendorForm({...vendorForm, companyName: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white" placeholder="업체명을 작성하세요" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">담당자명/직급</label>
              <input type="text" value={vendorForm.managerName || ''} onChange={e => setVendorForm({...vendorForm, managerName: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white" placeholder="ex) 홍길동 팀장 / 담당자" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">이메일</label>
              <input type="email" value={vendorForm.email || ''} onChange={e => setVendorForm({...vendorForm, email: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white" placeholder="print@..." />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">비고</label>
              <input type="text" value={vendorForm.memo || ''} onChange={e => setVendorForm({...vendorForm, memo: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white" placeholder="자유 기재" />
            </div>
            <div className="flex gap-1">
              {vendorForm.id ? (
                <>
                  <button onClick={() => setVendorForm(EMPTY_VENDOR_FORM)} className="px-3 py-2 h-[34px] bg-slate-200 text-slate-700 font-black text-xs rounded-lg hover:bg-slate-300">취소</button>
                  <button onClick={async () => {
                    if(!vendorForm.companyName) return alert('업체명을 입력하세요.');
                    try {
                      const res = await fetch('/api/asset/businesscard/master/vendors', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(vendorForm)
                      });
                      if (res.ok) {
                        const updated = await res.json();
                        setVendors(vendors.map(v => v.id === updated.id ? updated : v));
                        setVendorForm(EMPTY_VENDOR_FORM);
                        alert("✅ 업체 정보가 성공적으로 수정되었습니다.");
                      }
                    } catch (e) { alert("수정 실패"); }
                  }} className="px-4 py-2 h-[34px] bg-amber-500 text-white font-black text-xs rounded-lg hover:bg-amber-600 shadow-sm">수정 완료</button>
                </>
              ) : (
                <button onClick={async () => {
                  if(!vendorForm.companyName) return alert('업체명을 입력하세요.');
                  try {
                    const res = await fetch('/api/asset/businesscard/master/vendors', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(vendorForm)
                    });
                    if (res.ok) {
                      const savedVendor = await res.json();
                      setVendors([savedVendor, ...vendors]);
                      setVendorForm(EMPTY_VENDOR_FORM);
                    }
                  } catch (e) { alert("등록 실패"); }
                }} className="px-5 py-2 h-[34px] bg-indigo-600 text-white font-black text-xs rounded-lg hover:bg-indigo-700 shadow-sm">신규 등록</button>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-black tracking-widest sticky top-0">
                <tr>
                  <th className="p-3 pl-4">업체명</th>
                  <th className="p-3">담당자</th>
                  <th className="p-3">이메일</th>
                  <th className="p-3">비고</th>
                  <th className="p-3 text-center pr-4">제어 기능</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                {vendors.map(v => (
                  <tr key={v.id} className={`hover:bg-slate-50 ${vendorForm.id === v.id ? 'bg-amber-50/40' : ''}`}>
                    <td className="p-3 pl-4 font-black text-slate-900">{v.companyName}</td>
                    <td className="p-3">{v.managerName}</td>
                    <td className="p-3 font-mono text-slate-500">{v.email}</td>
                    <td className="p-3 text-slate-500 max-w-[180px] truncate" title={v.memo || ''}>{v.memo || <span className="text-slate-300">-</span>}</td>
                    <td className="p-3 pr-4 text-center flex justify-center gap-1">
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={() => {
                          if (!canEditMaster) return alertNoEditPermission();
                          setVendorForm(v);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[10px] border ${
                          canEditMaster
                            ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        ✏️ 수정
                      </button>
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={async () => {
                          if (!canEditMaster) return alertNoEditPermission();
                          if (!confirm(`[${v.companyName}] 업체를 삭제할까요?\n발주 이력은 그대로 남습니다.`)) return;
                          try {
                            const res = await fetch(`/api/asset/businesscard/master/vendors?id=${encodeURIComponent(v.id)}`, {
                              method: 'DELETE',
                            });
                            if (!res.ok) throw new Error('삭제 실패');
                            setVendors((prev) => prev.filter((item) => item.id !== v.id));
                            if (selectedVendorId === v.id) {
                              setSelectedVendorId((prev) => {
                                const remain = vendors.filter((item) => item.id !== v.id);
                                return remain[0]?.id || '';
                              });
                            }
                            if (vendorForm.id === v.id) setVendorForm(EMPTY_VENDOR_FORM);
                          } catch (e) { alert("삭제 실패"); }
                        }}
                        className={`px-2.5 py-1 rounded-md text-[10px] border ${
                          canEditMaster
                            ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {vendors.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">등록된 업체가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button onClick={() => { setIsVendorModalOpen(false); setVendorForm(EMPTY_VENDOR_FORM); }} className="px-6 py-2.5 bg-slate-900 text-white font-black text-xs rounded-xl hover:bg-black transition-colors">닫기 및 적용</button>
          </div>
        </div>
      </div>
    )}

    {/* 🚀 견적 대조 업로드 및 분석 모달 */}
    {isCompareModalOpen && (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-7xl w-full p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">외주사 거래명세표 교차 검증 결과</h2>
              <p className="text-xs text-slate-500 font-bold mt-1">선택한 <strong className="text-indigo-600">{selectedBatchIds.size}개</strong> 묶음과 업체의 거래명세표(<strong>PDF 우선</strong>, Excel 가능)를 대조합니다.</p>
              <p className="text-[11px] text-indigo-700 font-bold mt-2 leading-relaxed bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
              이름 행 기준으로, 제목줄에서 ⚙에 지정한 문자열만 찾아 비교합니다. (띄어쓰기 무시)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {STATEMENT_COL_FIELDS.map((field) => (
                  <button
                    key={field.key}
                    type="button"
                    disabled={!canEditMaster}
                    title={!canEditMaster ? '편집 권한 필요' : undefined}
                    onClick={() => openColMapEditor(field.key)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-black ${
                      canEditMaster
                        ? 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700'
                        : DISABLED_ACTION_BTN
                    }`}
                  >
                    <span>{field.label}</span>
                    <span className={canEditMaster ? 'font-bold text-indigo-600' : 'font-bold text-slate-400'}>
                      {statementColMap[field.key].join(', ')}
                    </span>
                    <span className="text-slate-400">⚙</span>
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => { setIsCompareModalOpen(false); setCompareResult({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] }); setManualDrafts({}); setManualEditRows({}); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black transition-colors">✕</button>
          </div>

          <input
            ref={statementFileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.xlsx,.xls"
            onChange={handleFileUpload}
          />

          {/* 1. 업로드 대기 화면 */}
          {compareResult.status === 'idle' && (
            <button
              type="button"
              onClick={() => statementFileInputRef.current?.click()}
              className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50 rounded-2xl cursor-pointer transition-colors group relative overflow-hidden"
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📄</span>
                <p className="mb-2 text-sm font-black text-indigo-700">여기를 클릭하여 거래명세표 업로드</p>
                <p className="text-xs text-indigo-400 font-bold leading-relaxed">
                  지원양식: PDF(권장), Excel(.xlsx/.xls)
                  <br />
                  
                </p>
              </div>
            </button>
          )}

          {/* 2. 분석 중 화면 */}
          {compareResult.status === 'analyzing' && (
            <div className="flex flex-col items-center justify-center h-48 space-y-4">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
              <p className="text-sm font-black text-indigo-800 animate-pulse">{compareResult.fileName} 문서를 해독하고 있습니다...</p>
            </div>
          )}

          {/* 3. 에러 화면 */}
          {compareResult.status === 'error' && (
            <div className="flex flex-col items-center justify-center h-48 space-y-4 bg-rose-50 rounded-2xl border border-rose-200">
              <span className="text-4xl">❌</span>
              <p className="text-sm font-black text-rose-800">문서 분석에 실패했습니다.</p>
              <div className="text-[10px] text-rose-500 font-mono text-center px-4">{compareResult.logs[compareResult.logs.length - 1]}</div>
              <button
                type="button"
                onClick={handleReuploadClick}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-sm"
              >
                거래명세표 다시 업로드
              </button>
            </div>
          )}

          {/* 🚀 4. 분석 완료 결과 화면 (4대 카테고리 검증 및 요약 설명판) */}
          {compareResult.status === 'success' && (
            <div className="space-y-4 animate-fade-in">
              {/* 상단 요약 바 */}
              <div className={`p-6 rounded-3xl border-2 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${compareResult.matched ? 'bg-emerald-50/80 border-emerald-200' : 'bg-rose-50/80 border-rose-200'}`}>
                <div className="flex-1">
                  <h3 className={`text-lg font-black flex items-center gap-2 ${compareResult.matched ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {compareResult.matched ? '✅ 이름·소속·수량 모두 일치' : '⚠️ 교차 검증 불일치 항목 감지'}
                  </h3>
                  
                  <div className="mt-2.5 space-y-3">
                    <p className={`text-xs font-bold leading-relaxed ${compareResult.matched ? 'text-emerald-700/80' : 'text-rose-700/80'}`}>
                      {compareResult.matched 
                        ? '지정한 이름·소속·수량 열이 모두 일치하여 통과입니다.' 
                        : '통과는 이름·소속·수량이 모두 맞을 때만입니다. 하단 표의 일치 여부와 판별 상세를 확인하세요.'}
                    </p>
                    
                    {(() => {
                      const total = compareResult.details.length || 1;
                      const nameOk = compareResult.details.filter((d) => d.nameMatch).length;
                      const deptOk = compareResult.details.filter((d) => d.deptMatch).length;
                      const qtyOk = compareResult.details.filter((d) => d.qtyMatch).length;
                      return (
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-tight ${nameOk === total ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
                        {nameOk === total ? '✔️' : '❌'} 이름 {nameOk}/{total}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-tight ${deptOk === total ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
                        {deptOk === total ? '✔️' : '❌'} 소속 {deptOk}/{total}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-tight ${qtyOk === total ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
                        {qtyOk === total ? '✔️' : '❌'} 수량 {qtyOk}/{total}
                      </span>
                    </div>
                      );
                    })()}
                  </div>
                </div>
                
                <div className="text-right md:ml-4 shrink-0 space-y-2">
                  <button
                    type="button"
                    onClick={handleReuploadClick}
                    className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-[11px] rounded-xl shadow-sm whitespace-nowrap"
                  >
                    거래명세표 다시 업로드
                  </button>
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-[10px] text-slate-500 font-bold mb-1">문서 공급가액 (행 합산)</p>
                  <p className="text-2xl font-black text-slate-900 font-mono">₩{compareResult.docTotalPrice.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-400 font-bold mt-1 leading-relaxed">
                    {compareResult.docTotalPrice > 0
                      ? `아래 공급가액 칸의 합계 · 제목: ${statementColMap.price.join(', ')}`
                      : `지정 제목(${statementColMap.price.join(', ')}) 열에서 금액을 읽지 못했습니다`}
                  </p>
                  </div>
                </div>
              </div>

              {compareResult.logs.filter((l) => l.startsWith('⚠️')).length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
                  {compareResult.logs.filter((l) => l.startsWith('⚠️')).map((line, idx) => (
                    <p key={idx} className="text-[11px] font-bold text-amber-800 leading-relaxed">{line}</p>
                  ))}
                  <p className="text-[10px] font-bold text-amber-700/80">칼럼 제목은 거래명세표 제목줄과 같아야 합니다. 이 문서는 이름=품목, 소속=비고 인 경우가 많습니다.</p>
                </div>
              )}

              {/* 상세 매칭 결과 리스트 */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-72 overflow-y-auto shadow-inner">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-600 font-black sticky top-0 z-10">
                    <tr>
                      <th colSpan={3} className="p-2 pl-4 text-center border-r-2 border-slate-300">
                        <span className="inline-flex items-center justify-center">임직원명<ColumnGearButton label="임직원명" disabled={!canEditMaster} onClick={() => openColMapEditor('name')} /></span>
                      </th>
                      <th colSpan={3} className="p-2 text-center border-r-2 border-slate-300 min-w-[320px]">
                        <span className="inline-flex items-center justify-center">소속<ColumnGearButton label="소속" disabled={!canEditMaster} onClick={() => openColMapEditor('dept')} /></span>
                      </th>
                      <th colSpan={4} className="p-2 text-center border-r-2 border-slate-300">
                        <span className="inline-flex items-center justify-center">신청수량<ColumnGearButton label="신청수량" disabled={!canEditMaster} onClick={() => openColMapEditor('qty')} /></span>
                      </th>
                      <th className="p-2 border-r-2 border-slate-300">판별 결과 상세</th>
                      <th colSpan={2} className="p-2 text-center border-r-2 border-slate-300">
                        <span className="inline-flex items-center justify-center">공급가액<ColumnGearButton label="공급가액" disabled={!canEditMaster} onClick={() => openColMapEditor('price')} /></span>
                      </th>
                      <th className="p-2 text-center w-[132px] min-w-[132px]">관리자 점검</th>
                    </tr>
                    <tr className="text-[10px] text-slate-400">
                      <th className="p-2 pl-4 font-bold whitespace-nowrap min-w-[88px]">이름</th>
                      <th className="p-2 text-center w-12 font-bold">일치</th>
                      <th className="p-2 text-center w-[96px] font-bold border-r-2 border-slate-300">관리자 처리</th>
                      <th className="p-2 font-bold">DB 본부·센터 / 문서 표기</th>
                      <th className="p-2 text-center w-12 font-bold">일치</th>
                      <th className="p-2 text-center w-[110px] font-bold border-r-2 border-slate-300">관리자 처리</th>
                      <th className="p-2 text-center w-[52px] font-bold">DB</th>
                      <th className="p-2 text-center w-[56px] font-bold whitespace-nowrap">문서</th>
                      <th className="p-2 text-center w-[44px] font-bold">일치</th>
                      <th className="p-2 text-center w-[72px] font-bold border-r-2 border-slate-300">관리자 처리</th>
                      <th className="p-2 font-bold border-r-2 border-slate-300 min-w-[220px]">상세</th>
                      <th className="p-2 text-center w-[84px] font-bold">문서 인식</th>
                      <th className="p-2 text-center w-[72px] font-bold border-r-2 border-slate-300">관리자 처리</th>
                      <th className="p-2 text-center w-[132px] font-bold">관리자 점검</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold">
                    {compareResult.details.map((detail, idx) => (
                      <tr key={detail.id || idx} className={detail.matchStatus === 'match' ? 'bg-white' : 'bg-rose-50/60'}>
                        {(() => {
                          const isManualEditing = !!manualEditRows[detail.id];
                          return (
                            <>
                        <td className={`p-2.5 pl-4 whitespace-nowrap ${detail.adminEditedFields?.includes('name') ? 'text-blue-600' : 'text-slate-800'}`}>{detail.name}</td>
                        <td className={`p-2.5 text-center text-[11px] font-black ${detail.nameMatch ? 'text-emerald-600' : 'text-rose-500'}`}>{detail.nameMatch ? 'O' : 'X'}</td>
                        <td className="p-2 text-center border-r-2 border-slate-200 min-w-[96px]">
                          {isManualEditing ? (
                            <input value={manualDrafts[detail.id]?.name ?? detail.name} onChange={(e) => setManualDraftValue(detail.id, 'name', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700" />
                          ) : (
                            <span className="text-[10px] font-bold text-slate-300">비활성</span>
                          )}
                        </td>
                        <td className="p-2.5 text-slate-700">
                          <p className="text-[10px] text-slate-400 font-bold">본부 {detail.deptHead || '-'}</p>
                          <p className="text-[10px] text-slate-400 font-bold">센터 {detail.deptName || detail.dept || '-'}</p>
                          {(detail.docQtyParts || []).length > 0 ? (
                            <div className="mt-1 space-y-0.5">
                              {(detail.docQtyParts || []).map((part, pIdx) => (
                                <p key={`${detail.id}-dept-${pIdx}`} className={`text-[10px] font-black ${detail.adminEditedFields?.includes('dept') ? 'text-blue-600' : 'text-emerald-600'}`}>
                                  문서: {part.dept} {part.qty}통
                                </p>
                              ))}
                            </div>
                          ) : detail.docDept ? (
                            <p className={`text-[10px] font-black mt-1 ${detail.adminEditedFields?.includes('dept') ? 'text-blue-600' : 'text-emerald-600'}`}>문서: {detail.docDept}</p>
                          ) : null}
                        </td>
                        <td className={`p-2.5 text-center text-[11px] font-black ${detail.deptMatch ? 'text-emerald-600' : 'text-rose-500'}`}>{detail.deptMatch ? 'O' : 'X'}</td>
                        <td className="p-2 text-center border-r-2 border-slate-200 min-w-[110px]">
                          {isManualEditing ? (
                            <input value={manualDrafts[detail.id]?.dept ?? detail.docDept} onChange={(e) => setManualDraftValue(detail.id, 'dept', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700" />
                          ) : (
                            <span className="text-[10px] font-bold text-slate-300">비활성</span>
                          )}
                        </td>
                        <td className="p-2.5 text-center text-slate-800 font-mono whitespace-nowrap">{detail.dbQty}</td>
                        <td className={`p-2.5 text-center font-mono whitespace-nowrap ${detail.adminEditedFields?.includes('qty') ? 'text-blue-600' : 'text-slate-600'}`}>
                          {detail.docQty || 0}
                          {(detail.docQtyParts || []).length > 1 ? (
                            <p className={`text-[10px] font-bold mt-0.5 whitespace-nowrap ${detail.adminEditedFields?.includes('qty') ? 'text-blue-600' : 'text-emerald-600'}`}>
                              합계 {(detail.docQtyParts || []).map((p) => p.qty).join('+')}
                            </p>
                          ) : null}
                        </td>
                        <td className={`p-2.5 text-center text-[11px] font-black ${detail.qtyMatch ? 'text-emerald-600' : 'text-rose-500'}`}>{detail.qtyMatch ? 'O' : 'X'}</td>
                        <td className="p-2 text-center border-r-2 border-slate-200 min-w-[72px]">
                          {isManualEditing ? (
                            <input value={manualDrafts[detail.id]?.qty ?? String(detail.docQty || detail.dbQty || '')} onChange={(e) => setManualDraftValue(detail.id, 'qty', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700 text-center" />
                          ) : (
                            <span className="text-[10px] font-bold text-slate-300">비활성</span>
                          )}
                        </td>
                        <td className="p-2.5 text-[11px] border-r-2 border-slate-200 min-w-[220px] align-top">
                          {(detail.matchStatus === 'match' || detail.adminOverride) && <span className={detail.adminEditedFields?.length ? 'text-blue-600' : 'text-emerald-600'}>{detail.adminEditedFields?.length ? '-관리자 처리-' : detail.resultNote}</span>}
                          {detail.matchStatus !== 'match' && !detail.adminOverride && <span className="text-rose-600">{detail.resultNote}</span>}
                        </td>
                        <td className={`p-2.5 text-center font-mono tabular-nums whitespace-nowrap ${detail.adminEditedFields?.includes('price') ? 'text-blue-600' : 'text-slate-900'}`}>
                          ₩{(detail.docPrice || 0).toLocaleString()}
                        </td>
                        <td className="p-2 text-center border-r-2 border-slate-200 min-w-[72px]">
                          {isManualEditing ? (
                            <input value={manualDrafts[detail.id]?.price ?? String(detail.docPrice || 0)} onChange={(e) => setManualDraftValue(detail.id, 'price', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700 text-right" />
                          ) : (
                            <span className="text-[10px] font-bold text-slate-300">비활성</span>
                          )}
                        </td>
                        <td className="p-2.5 text-center min-w-[132px]">
                          {isManualEditing ? (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => completeManualEditRow(detail.id)}
                                className="w-full rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-black text-white"
                              >
                                완료
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelManualEditRow(detail)}
                                className="w-full rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600"
                              >
                                취소
                              </button>
                            </div>
                          ) : detail.matchStatus === 'match' || detail.adminOverride ? (
                            <div className="space-y-1">
                              <span className={`block text-[10px] font-black ${detail.adminEditedFields?.length ? 'text-blue-600' : 'text-emerald-600'}`}>{detail.adminEditedFields?.length ? '수동 처리 완료' : '점검완료'}</span>
                              <button
                                type="button"
                                disabled={!canEditMaster}
                                title={!canEditMaster ? '편집 권한 필요' : undefined}
                                onClick={() => openManualEditRow(detail)}
                                className={`w-full rounded-lg px-2 py-1 text-[10px] font-black ${
                                  canEditMaster
                                    ? 'bg-slate-100 text-slate-700'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                관리자 수동 처리
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => openManualEditRow(detail)}
                              className={`px-2 py-1 text-[10px] font-black rounded-lg ${
                                canEditMaster
                                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              관리자 수동 처리
                            </button>
                          )}
                        </td>
                            </>
                          );
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button onClick={() => { setIsCompareModalOpen(false); setCompareResult({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] }); setManualDrafts({}); setManualEditRows({}); }} className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl transition-colors">닫기</button>
          </div>
        </div>
      </div>
    )}

    {mailShortcutEditor != null && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <h3 className="text-base font-black text-slate-900">메일 바로가기 경로 설정</h3>
          <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-500">
            그룹웨어 메일 작성 화면 주소를 붙여넣으세요. 경로가 바뀌면 여기만 수정하면 됩니다.
          </p>
          <input
            type="text"
            value={mailShortcutEditor}
            onChange={(e) => setMailShortcutEditor(e.target.value)}
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400"
            placeholder="https://사내그룹웨어/mail/..."
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setMailShortcutEditor(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-600">취소</button>
            <button type="button" onClick={handleSaveMailShortcut} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white">저장</button>
          </div>
        </div>
      </div>
    )}
    {colMapEditor && (() => {
      const meta = STATEMENT_COL_FIELDS.find((f) => f.key === colMapEditor.key);
      return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-black text-slate-900">{meta?.label} 칼럼 제목 지정</h3>
            <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-500">
              문서 제목의 띄어쓰기는 무시합니다. 비 고, 비   고 모두 비고와 같습니다.
              쉼표로 여러 개 가능합니다.
            </p>
            <p className="mt-1 text-[10px] font-bold text-indigo-600">{meta?.hint}</p>
            <textarea
              value={colMapEditor.draft}
              onChange={(e) => setColMapEditor({ ...colMapEditor, draft: e.target.value })}
              rows={3}
              className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400"
              placeholder="예: 공급가액"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setColMapEditor(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-600">취소</button>
              <button
                type="button"
                disabled={!canEditMaster}
                title={!canEditMaster ? '편집 권한 필요' : undefined}
                onClick={handleSaveColMap}
                className={`rounded-xl px-4 py-2 text-xs font-black ${
                  canEditMaster ? 'bg-indigo-600 text-white' : DISABLED_ACTION_BTN
                }`}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      );
    })()}
  </div>
);
}