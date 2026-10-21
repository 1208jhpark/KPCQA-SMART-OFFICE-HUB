'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth } from '@/utils/dateUtils';
import { resolveInterfaceEditState, isSystemLv1User } from '@/lib/permission-utils';
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
import {
  formatBusinessCardEnNumber,
  stripBusinessCardEnPlus,
} from '@/lib/businesscard-phone';
import { formatKrPhoneInput } from '@/lib/format-kr-phone';
import { formatCompanyAddressKo } from '@/lib/businesscard-seed-addresses';
import {
  applyBcMailTemplate,
  formatBcMailApplicants,
  sumBcMailPacks,
  DEFAULT_BC_MAIL_BODY,
  DEFAULT_BC_MAIL_SUBJECT,
  resolveBcMailBodyTemplate,
  resolveBcMailSubjectTemplate,
} from '@/lib/businesscard-mail-template';
import { rowMatchesOrgUnit } from '@/lib/org-unit-match';
import {
  DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL,
  buildGroupwareMailOpenUrl,
  sanitizeGroupwareMailShortcutUrl,
} from '@/lib/groupware-mail-shortcut';
import WindowedPagination from '@/components/common/WindowedPagination';

const MENU_PATH = '/asset/businesscard/master/order';
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none hover:bg-slate-100';
/** 그룹웨어 메일 작성 기본 URL — DB 미설정·빈 값일 때 사용 (설정에서 변경 가능) */
const DEFAULT_MAIL_SHORTCUT_URL = DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;
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
  unitId?: string | null;
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
  proofFileName?: string | null;
  proofUploadedAt?: string | null;
  proofConfirmedAt?: string | null;
  proofConfirmedBy?: string | null;
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
  /** 명세표 대조(수기)로 확정했는지 */
  settlementManual?: boolean;
  /** 검수에서 따라온 기준 단가 (주황 하이라이트 비교용) */
  settlementBaselines?: Record<string, number>;
  settlementLastEdit?: { date?: string; userName?: string };
}

function moneyDigitsOnly(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/[^\d]/g, '');
}

function formatMoneyDigits(digits: string): string {
  const d = moneyDigitsOnly(digits);
  if (!d) return '';
  return Number(d).toLocaleString('ko-KR');
}

function moneyDigitsToNumber(digits: string): number | null {
  const d = moneyDigitsOnly(digits);
  if (!d) return null;
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

interface OrderBatch {
  id: string;
  orderDate: string;
  /** 실제 외주 발주 요청일 (YYYY-MM-DD) */
  dispatchedDate?: string | null;
  totalCount: number;
  deptHeadGroup: string;
  status: '발주완료' | '수령완료' | '견적비교완료' | '지급완료';
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
      title={disabled ? '편집 권한 필요' : `${label} 칼럼 설정(Edit)`}
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
  addressDetailKo?: string;
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

function displayDeptName(
  item: { unitId?: string | null; deptName?: string | null },
  units: UnitItem[]
) {
  const uid = String(item.unitId || '').trim();
  if (uid && units.length) {
    const u = units.find((x) => x.id === uid);
    if (u?.unit_name) return u.unit_name;
  }
  return String(item.deptName || '').trim();
}

function itemMatchesOrg(
  item: { unitId?: string | null; deptHead?: string | null; deptName?: string | null },
  orgId: string,
  units: UnitItem[]
) {
  return rowMatchesOrgUnit({
    selectedOrgId: orgId,
    units,
    unitId: item.unitId,
    legacyNames: [item.deptName, item.deptHead],
  });
}

function isBusinessCardHqUnit(unit: { unit_type?: string | null; unit_name?: string | null } | null | undefined) {
  const t = String(unit?.unit_type || '').trim().toUpperCase();
  if (t === 'HQ' || t.startsWith('HQ')) return true;
  const n = String(unit?.unit_name || '').trim();
  return /^hq\b/i.test(n) || /^hq[_-]/i.test(n);
}

function formatEnNumber(type: 'mobile' | 'phone', value: string) {
  return formatBusinessCardEnNumber(type, value) || value;
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
  
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  
  const [detailTarget, setDetailTarget] = useState<RequestHistory | null>(null);
  const [detailReadOnly, setDetailReadOnly] = useState(false);
  const [isRequestEditing, setIsRequestEditing] = useState(false);
  const [requestEditForm, setRequestEditForm] = useState<RequestHistory | null>(null);
  const [adminMemoInput, setAdminMemoInput] = useState('');
  
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [dispatchModalBatch, setDispatchModalBatch] = useState<OrderBatch | null>(null);
  const [dispatchDateInput, setDispatchDateInput] = useState(() => getKSTDateString());
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [settlementBatch, setSettlementBatch] = useState<OrderBatch | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [priceBaselines, setPriceBaselines] = useState<Record<string, string>>({});
  const [savingSettlement, setSavingSettlement] = useState(false);

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
const [mailShortcutUrl, setMailShortcutUrl] = useState(DEFAULT_MAIL_SHORTCUT_URL);
const [mailShortcutEditor, setMailShortcutEditor] = useState<string | null>(null);
const [mailSubjectTemplate, setMailSubjectTemplate] = useState(DEFAULT_BC_MAIL_SUBJECT);
const [mailBodyTemplate, setMailBodyTemplate] = useState(DEFAULT_BC_MAIL_BODY);
const [mailTemplateEditor, setMailTemplateEditor] = useState<{
  subjectTemplate: string;
  bodyTemplate: string;
} | null>(null);
const [manualDrafts, setManualDrafts] = useState<Record<string, Record<StatementColKey, string>>>({});
const [manualEditRows, setManualEditRows] = useState<Record<string, boolean>>({});
const statementFileInputRef = useRef<HTMLInputElement>(null);
  const proofFileInputRef = useRef<HTMLInputElement>(null);
  const [proofUploadTargetId, setProofUploadTargetId] = useState<string | null>(null);
  const [proofUploadingId, setProofUploadingId] = useState<string | null>(null);
 

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
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
  const [batchPage, setBatchPage] = useState(1);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 발주 묶음 대장 로드
      const batchRes = await fetch(`/api/asset/businesscard/master/order?t=${Date.now()}`, { cache: 'no-store' });
      if (batchRes.ok) {
        const batchData = await batchRes.json();
        setBatches(batchData);
        const maps = collectInspectMaps(Array.isArray(batchData) ? batchData : []);
        setItemMatchStatus(maps.status);
        setItemMatchPrice(maps.price); 
      }
      
      const tsMaster = Date.now();
      const [unitRes, addrRes, settingsRes] = await Promise.all([
        fetch(`/api/admin/units?active=true&t=${tsMaster}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/master/addresses?t=${tsMaster}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/master/settings?t=${tsMaster}`, { cache: 'no-store' }),
      ]);
      if (unitRes.ok) {
        const raw = await unitRes.json();
        setUnits(Array.isArray(raw) ? raw : []);
      } else setUnits([]);
      if (addrRes.ok) setAddresses(await addrRes.json());
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        if (Array.isArray(settings?.duties)) {
          setDuties(
            settings.duties
              .filter((o: any) => o?.label)
              .map((o: any, i: number) => ({
                id: `duty-${i}-${o.label}`,
                label: String(o.label),
                value: String(o.value ?? ''),
              }))
          );
        }
        if (Array.isArray(settings?.grades)) {
          setGrades(
            settings.grades
              .filter((o: any) => o?.label)
              .map((o: any, i: number) => ({
                id: `grade-${i}-${o.label}`,
                label: String(o.label),
                value: String(o.value ?? ''),
              }))
          );
        }
      }

      // 외주업체 마스터 로드
      const vendorRes = await fetch(`/api/asset/businesscard/master/vendors?t=${Date.now()}`, { cache: 'no-store' });
      if (vendorRes.ok) {
        const vData = await vendorRes.json();
        setVendors(vData);
        if (vData.length > 0) setSelectedVendorId(vData[0].id);
      } else {
        setVendors([]);
      }

      // 권한 배너용 인터페이스 요약
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
        setMailShortcutUrl(
          sanitizeGroupwareMailShortcutUrl(data?.mailShortcutUrl)
        );
        setMailSubjectTemplate(resolveBcMailSubjectTemplate(data?.mailSubjectTemplate));
        setMailBodyTemplate(resolveBcMailBodyTemplate(data?.mailBodyTemplate));
      })
      .catch(() => {});
  }, []);

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
  if (!canEditMaster) return alertNoEditPermission();
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
  if (!canEditMaster) return alertNoEditPermission();
  if (compareResult.status === 'success') {
    if (!confirm('이전 교차 검증 결과를 지우고 새 거래명세표로 다시 비교할까요?')) return;
  }
  statementFileInputRef.current?.click();
};

const openProofUpload = (itemId: string) => {
  if (!canEditMaster) return alertNoEditPermission();
  setProofUploadTargetId(itemId);
  window.setTimeout(() => proofFileInputRef.current?.click(), 0);
};

const handleProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  const requestId = proofUploadTargetId;
  setProofUploadTargetId(null);
  if (!file || !requestId) return;
  if (!canEditMaster) return alertNoEditPermission();

  setProofUploadingId(requestId);
  try {
    const fd = new FormData();
    fd.append('requestId', requestId);
    fd.append('file', file);
    const res = await fetch('/api/asset/businesscard/proof', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || '시안 업로드에 실패했습니다.');
      return;
    }
    setBatches((prev) =>
      prev.map((b) => ({
        ...b,
        items: (b.items || []).map((it) =>
          it.id === requestId
            ? {
                ...it,
                proofFileName: data.proofFileName || file.name,
                proofUploadedAt: data.proofUploadedAt || new Date().toISOString(),
                proofConfirmedAt: null,
              }
            : it
        ),
      }))
    );
    alert(data.message || '시안이 업로드되었습니다.');
  } catch {
    alert('시안 업로드 중 오류가 발생했습니다.');
  } finally {
    setProofUploadingId(null);
  }
};

const handleProofDownloadAdmin = (itemId: string, fileName?: string | null) => {
  const a = document.createElement('a');
  a.href = `/api/asset/businesscard/proof?id=${encodeURIComponent(itemId)}&download=1`;
  a.download = fileName || '시안';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

const handleAdminProofConfirm = async (item: RequestHistory) => {
  if (!canEditMaster) return alertNoEditPermission();
  if (!item.proofFileName) {
    return alert('업로드된 시안이 없습니다. 먼저 시안을 업로드해 주세요.');
  }
  if (item.proofConfirmedAt) {
    return alert('이미 시안이 확정되었습니다.');
  }
  if (
    !confirm(
      `[${item.postNumber}] ${item.userName || ''} 님 시안을 관리자 권한으로 확정할까요?`
    )
  ) {
    return;
  }
  try {
    const res = await fetch('/api/asset/businesscard/proof', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || '시안 확정에 실패했습니다.');
      return;
    }
    setBatches((prev) =>
      prev.map((b) => ({
        ...b,
        items: (b.items || []).map((it) =>
          it.id === item.id
            ? {
                ...it,
                proofConfirmedAt: data.proofConfirmedAt || new Date().toISOString(),
                proofConfirmedBy: data.proofConfirmedBy || null,
              }
            : it
        ),
      }))
    );
    alert(data.message || '시안이 확정되었습니다.');
  } catch {
    alert('시안 확정 중 오류가 발생했습니다.');
  }
};

const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!canEditMaster) return alertNoEditPermission();

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

const handleExecuteUpdate = async () => {
  if (!canEditMaster) return alertNoEditPermission();
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
    const nextValue = field === 'mobile' ? formatKrPhoneInput(value) : value;
    const updated = { ...prev, [field]: nextValue };
    if (field === 'email') updated.emailEn = nextValue;
    if (field === 'mobile') updated.mobileEn = formatEnNumber('mobile', nextValue);
    if (field === 'phone') updated.phoneEn = formatEnNumber('phone', nextValue);
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
      addressKo: formatCompanyAddressKo(target),
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
      unitId: keepCenter ? prev.unitId : null,
    };
  });
};

const handleEditSubChange = (unitName: string) => {
  const selected = units.find((u) => u.unit_name === unitName);
  setRequestEditForm((prev) => {
    if (!prev) return prev;
    if (!selected) return { ...prev, deptName: '', deptNameEn: '', unitId: null };
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
      unitId: selected.id,
      deptHead: headKo,
      deptHeadEn: headEn,
    };
  });
};

const beginRequestEdit = (row: RequestHistory) => {
  if (!canEditMaster) return alertNoEditPermission();
  const matched =
    addresses.find((a) => a.id === row.addressId) ||
    addresses.find(
      (a) => a.zipCode === row.zipCode && formatCompanyAddressKo(a) === row.addressKo
    );
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
    '영문 휴대전화': stripBusinessCardEnPlus(r.mobileEn || ''),
    '영문전화': stripBusinessCardEnPlus(r.phoneEn || ''),
    '영문팩스': stripBusinessCardEnPlus(r.faxEn || ''),
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
const getPreviewSubject = () => {
  if (!currentBatch) return '';
  const items = currentBatch.items || [];
  return applyBcMailTemplate(mailSubjectTemplate, {
    batchNo: formatBatchNo(currentBatch.id),
    count: items.length || currentBatch.totalCount || 0,
    packs: sumBcMailPacks(items),
    vendorName: activeVendor?.companyName,
    vendorManager: activeVendor?.managerName,
    applicants: formatBcMailApplicants(items),
  });
};
const getPreviewBody = () => {
  if (!currentBatch) return '';
  if (!activeVendor) return '등록된 외주 업체가 없습니다. [업체 관리]에서 협력사를 먼저 등록해 주세요.';
  const items = currentBatch.items || [];
  return applyBcMailTemplate(mailBodyTemplate, {
    batchNo: formatBatchNo(currentBatch.id),
    count: items.length || currentBatch.totalCount || 0,
    packs: sumBcMailPacks(items),
    vendorName: activeVendor.companyName,
    vendorManager: activeVendor.managerName,
    applicants: formatBcMailApplicants(items),
  });
};

const handleSaveMailTemplates = async () => {
  if (!canEditMaster) return alertNoEditPermission();
  if (!mailTemplateEditor) return;
  const nextSubject = resolveBcMailSubjectTemplate(mailTemplateEditor.subjectTemplate);
  const nextBody = resolveBcMailBodyTemplate(mailTemplateEditor.bodyTemplate);
  try {
    const res = await fetch('/api/asset/businesscard/master/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mailSubjectTemplate: nextSubject,
        mailBodyTemplate: nextBody,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '서버 저장 실패');
    }
    const data = await res.json().catch(() => null);
    setMailSubjectTemplate(resolveBcMailSubjectTemplate(data?.mailSubjectTemplate ?? nextSubject));
    setMailBodyTemplate(resolveBcMailBodyTemplate(data?.mailBodyTemplate ?? nextBody));
    setMailTemplateEditor(null);
  } catch (error: any) {
    alert(`메일 양식 저장에 실패했습니다.\n${error.message || ''}`);
  }
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
  const next = sanitizeGroupwareMailShortcutUrl(
    mailShortcutEditor.trim() || DEFAULT_MAIL_SHORTCUT_URL
  );
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
  const url = buildGroupwareMailOpenUrl(
    mailShortcutUrl,
    currentUser?.email || currentUser?.userEmail || ''
  );
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

const resolveItemSettlementPrice = (batch: OrderBatch, itemId: string): number => {
  if (itemMatchPrice[itemId] != null && Number.isFinite(itemMatchPrice[itemId])) {
    return Number(itemMatchPrice[itemId]) || 0;
  }
  const mapped = batch.inspectResult?.itemPrice?.[itemId];
  if (mapped != null && Number.isFinite(Number(mapped))) return Number(mapped) || 0;
  const detail = batch.inspectResult?.details?.find((d) => d.id === itemId);
  if (detail?.docPrice != null && Number.isFinite(Number(detail.docPrice))) {
    return Number(detail.docPrice) || 0;
  }
  return 0;
};

const openSettlementModal = (batch: OrderBatch) => {
  if (!canEditMaster) return alertNoEditPermission();
  const drafts: Record<string, string> = {};
  const baselines: Record<string, string> = {};
  const storedBases = batch.inspectResult?.settlementBaselines || {};
  for (const item of batch.items || []) {
    const price = resolveItemSettlementPrice(batch, item.id);
    const digits = price > 0 ? String(Math.trunc(price)) : '';
    drafts[item.id] = digits;
    const baseRaw = storedBases[item.id];
    baselines[item.id] =
      baseRaw != null && Number.isFinite(Number(baseRaw)) && Number(baseRaw) > 0
        ? String(Math.trunc(Number(baseRaw)))
        : digits;
  }
  setPriceDrafts(drafts);
  setPriceBaselines(baselines);
  setSettlementBatch(batch);
};

const isPriceDraftChanged = (itemId: string) => {
  const cur = moneyDigitsToNumber(priceDrafts[itemId] || '');
  const base = moneyDigitsToNumber(priceBaselines[itemId] || '');
  if (cur == null && base == null) return false;
  if (cur == null || base == null) return true;
  return cur !== base;
};

const handleSaveSettlement = async () => {
  if (!settlementBatch) return;
  if (!canEditMaster) return alertNoEditPermission();
  const items = settlementBatch.items || [];
  if (items.length === 0) return alert('대조할 신청 건이 없습니다.');

  const itemPrice: Record<string, number> = {};
  const itemStatus: Record<string, ItemInspectStatus> = {};
  const details: StatementMatchRow[] = [];
  let totalPrice = 0;

  for (const item of items) {
    const n = moneyDigitsToNumber(priceDrafts[item.id] || '');
    if (n == null || n < 0) {
      return alert(`[${item.postNumber}] 정산단가(원)를 입력해 주세요.`);
    }
    itemPrice[item.id] = n;
    itemStatus[item.id] = 'match';
    totalPrice += n;
    const prev = settlementBatch.inspectResult?.details?.find((d) => d.id === item.id);
    details.push({
      id: item.id,
      name: prev?.name || item.userName || '',
      dept: prev?.dept || item.deptName || '',
      deptHead: prev?.deptHead || item.deptHead,
      deptName: prev?.deptName || item.deptName,
      dbQty: prev?.dbQty ?? item.quantity ?? 1,
      nameMatch: prev?.nameMatch ?? true,
      deptMatch: prev?.deptMatch ?? true,
      qtyMatch: prev?.qtyMatch ?? true,
      docQty: prev?.docQty ?? item.quantity ?? 1,
      docDept: prev?.docDept || item.deptName || '',
      docDepts: prev?.docDepts || [item.deptName || ''].filter(Boolean),
      docQtyParts: prev?.docQtyParts || [],
      docPrice: n,
      matchStatus: 'match',
      resultNote: prev?.resultNote || '명세표 대조(수기)로 확정',
      adminOverride: true,
      adminEditedFields: prev?.adminEditedFields,
    });
  }

  const settlementBaselines: Record<string, number> = {};
  for (const item of items) {
    const b = moneyDigitsToNumber(priceBaselines[item.id] || '');
    if (b != null && b > 0) settlementBaselines[item.id] = b;
    else if (itemPrice[item.id] > 0) settlementBaselines[item.id] = itemPrice[item.id];
  }

  const prevResult = settlementBatch.inspectResult || {};
  const inspectResult: BatchInspectResult = {
    ...prevResult,
    fileName: prevResult.fileName || settlementBatch.inspectFileName || '수기 명세표 대조',
    matched: true,
    docTotalQty: items.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
    docTotalPrice: totalPrice,
    logs: [
      ...(Array.isArray(prevResult.logs) ? prevResult.logs : []),
      `✍️ 명세표 대조(수기) 확정 · ${getKSTDateString()} · ${String(currentUser?.name || '-').trim() || '-'}`,
    ],
    details,
    itemStatus,
    itemPrice,
    settlementManual: true,
    settlementBaselines,
    settlementLastEdit: {
      date: getKSTDateString(),
      userName: String(currentUser?.name || '').trim() || '-',
    },
  };

  setSavingSettlement(true);
  try {
    const res = await fetch('/api/asset/businesscard/master/order/inspect', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batches: [
          {
            batchId: settlementBatch.id,
            inspectStatus: 'match',
            inspectFileName: inspectResult.fileName || null,
            inspectResult,
          },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '명세표 대조 저장 실패');

    setBatches((prev) =>
      prev.map((b) =>
        b.id === settlementBatch.id
          ? {
              ...b,
              inspectStatus: 'match',
              inspectFileName: inspectResult.fileName || b.inspectFileName,
              inspectResult,
            }
          : b
      )
    );
    setItemMatchPrice((prev) => ({ ...prev, ...itemPrice }));
    setItemMatchStatus((prev) => ({ ...prev, ...itemStatus }));
    setSettlementBatch(null);
    setPriceBaselines({});
    setPriceDrafts({});
    alert('명세표 대조(수기)를 저장했습니다.\n명세서 검수가 일치로 확정되어 보관함 이동이 가능합니다.');
  } catch (error: any) {
    alert(error.message || '명세표 대조 저장 중 오류가 발생했습니다.');
  } finally {
    setSavingSettlement(false);
  }
};

const handleCancelOrderBatch = async (batch: OrderBatch, e: React.MouseEvent) => {
  e.stopPropagation();
  if (!canEditMaster) return alertNoEditPermission();
  if (batch.status === '지급완료') {
    return alert('지급완료 처리된 묶음은 발주대기로 되돌릴 수 없습니다.');
  }
  if (
    !confirm(
      `[${formatBatchNo(batch.id)}] 묶음을 해제하고 소속 건을 접수완료 발주 대기열로 되돌릴까요?`
    )
  )
    return;
  try {
    const res = await fetch(`/api/asset/businesscard/master/order?batchId=${encodeURIComponent(batch.id)}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '발주대기 복귀 실패');
    setExpandedBatchIds((prev) => {
      if (!prev.has(batch.id)) return prev;
      const next = new Set(prev);
      next.delete(batch.id);
      return next;
    });
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      next.delete(batch.id);
      return next;
    });
    alert('발주대기열로 되돌렸습니다. 건은 접수완료 발주 대기열로 돌아갑니다.');
    fetchData();
  } catch (error: any) {
    alert(error.message || '발주대기 복귀 중 오류가 발생했습니다.');
  }
};

/** 묶음 내 모든 신청 시안확정 여부 */
const isBatchProofConfirmed = (batch: OrderBatch) => {
  const items = batch.items || [];
  if (items.length === 0) return false;
  return items.every((it) => Boolean(it.proofConfirmedAt));
};

/** 묶음 시안확인 상태: 업로드대기 → 확정대기 → 확정완료 */
const getBatchProofStatus = (
  batch: OrderBatch
): '업로드대기' | '확정대기' | '확정완료' => {
  const items = batch.items || [];
  if (items.length === 0) return '업로드대기';
  const allUploaded = items.every((it) => Boolean(it.proofFileName));
  if (!allUploaded) return '업로드대기';
  const allConfirmed = items.every((it) => Boolean(it.proofConfirmedAt));
  if (!allConfirmed) return '확정대기';
  return '확정완료';
};

const openDispatchModal = (batch: OrderBatch) => {
  if (!canEditMaster) return alertNoEditPermission();
  if (!isBatchProofConfirmed(batch)) {
    const pending = (batch.items || []).filter((it) => !it.proofConfirmedAt).length;
    return alert(
      `상세보기의 시안확정이 모두 끝난 뒤 발주확정할 수 있습니다.\n(미확정 ${pending}건)`
    );
  }
  setDispatchModalBatch(batch);
  setDispatchDateInput(getKSTDateString());
};

const handleConfirmDispatch = async () => {
  if (!dispatchModalBatch) return;
  if (!canEditMaster) return alertNoEditPermission();
  const dateVal = dispatchDateInput.trim();
  if (!dateVal) return alert('발주완료일을 선택해주세요.');
  setDispatchSubmitting(true);
  try {
    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'confirm-dispatch',
        batchId: dispatchModalBatch.id,
        dispatchedDate: dateVal,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || '발주완료 처리에 실패했습니다.');
      return;
    }
    alert(data.message || '발주완료 처리되었습니다.');
    setDispatchModalBatch(null);
    fetchData();
  } catch {
    alert('서버와 통신할 수 없습니다.');
  } finally {
    setDispatchSubmitting(false);
  }
};

const applyReceiveLocal = (batchId: string, requestIds: string[]) => {
  const idSet = new Set(requestIds);
  setBatches((prev) =>
    prev.map((b) => {
      if (b.id !== batchId) return b;
      const items = b.items.map((it) =>
        idSet.has(it.id) ? { ...it, adminStatus: '수령완료' } : it
      );
      const allReceived = items.every(
        (it) => it.adminStatus === '수령완료' || it.adminStatus === '지급완료'
      );
      return {
        ...b,
        items,
        status: allReceived ? '수령완료' : b.status,
      };
    })
  );
};

const handleConfirmReceiveItem = async (item: RequestHistory, batchId: string) => {
  if (!canEditMaster) return alertNoEditPermission();
  if (item.adminStatus !== '발주완료') {
    return alert('발주완료 상태의 건만 수령확인할 수 있습니다.');
  }
  const parent = batches.find((b) => b.id === batchId);
  if (!parent?.dispatchedDate) {
    return alert('발주완료일을 먼저 기록한 뒤 수령확인할 수 있습니다.');
  }
  if (!confirm(`[${item.postNumber}] 수령확인 처리할까요?`)) return;

  try {
    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm-receive', requestId: item.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || '수령확인 처리에 실패했습니다.');
      return;
    }

    applyReceiveLocal(batchId, [item.id]);
    alert(data.message || '수령확인 처리되었습니다.');
  } catch {
    alert('서버와 통신할 수 없습니다.');
  }
};

/** 묶음 내 미수령(발주완료) 건 일괄 수령확인 */
const handleConfirmReceiveAll = async (batch: OrderBatch) => {
  if (!canEditMaster) return alertNoEditPermission();
  if (!batch.dispatchedDate) {
    return alert('발주확정일을 먼저 기록한 뒤 수령확인할 수 있습니다.');
  }
  const pending = (batch.items || []).filter((it) => it.adminStatus === '발주완료');
  if (pending.length === 0) {
    return alert('수령확인할 건이 없습니다.');
  }
  if (
    !confirm(
      `[${formatBatchNo(batch.id)}] 미수령 ${pending.length}건을 한 번에 수령확인 처리할까요?`
    )
  ) {
    return;
  }

  const okIds: string[] = [];
  let failMsg = '';
  for (const item of pending) {
    try {
      const res = await fetch('/api/asset/businesscard/master/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm-receive', requestId: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        failMsg = data.message || '수령확인 처리에 실패했습니다.';
        break;
      }
      okIds.push(item.id);
    } catch {
      failMsg = '서버와 통신할 수 없습니다.';
      break;
    }
  }

  if (okIds.length > 0) applyReceiveLocal(batch.id, okIds);

  if (failMsg) {
    alert(
      okIds.length > 0
        ? `${okIds.length}건 수령확인 후 오류: ${failMsg}`
        : failMsg
    );
    return;
  }
  alert(`${okIds.length}건 수령확인 처리되었습니다.`);
};

const handleMarkAsDistributed = async (batchId: string, e: React.MouseEvent) => {
  e.stopPropagation(); // 행 클릭(아코디언 펼침) 방지
  if (!canEditMaster) return alertNoEditPermission();

  const batch = batches.find((b) => b.id === batchId);
  if (!batch) return;
  const pendingReceive = (batch.items || []).filter(
    (it) => it.adminStatus !== '수령완료' && it.adminStatus !== '지급완료'
  );
  if (pendingReceive.length > 0) {
    return alert(
      `수령검수가 끝나지 않은 건이 ${pendingReceive.length}건 있습니다.\n상세보기에서 수령확인을 먼저 완료해 주세요.`
    );
  }

  if (
    !confirm(
      `이 묶음의 명함을 임직원에게 지급 완료 처리할까요?\n(확인 시 사용자 화면에서도 '지급완료'로 변경됩니다.)`
    )
  ) {
    return;
  }

  try {
    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'DB 업데이트 실패');

    setBatches((prev) =>
      prev.map((b) =>
        b.id === batchId
          ? {
              ...b,
              status: '지급완료',
              items: b.items.map((item) => ({ ...item, adminStatus: '지급완료' })),
            }
          : b
      )
    );

    alert('🎁 지급완료 처리가 DB에 정상적으로 저장되었습니다.');
  } catch (error: any) {
    alert(`❌ ${error?.message || '처리 중 오류가 발생했습니다.'}`);
  }
};

const handleMoveBatchToArchive = async (batch: OrderBatch, e: React.MouseEvent) => {
  e.stopPropagation();
  if (!canEditMaster) return alertNoEditPermission();
  if (batch.status !== '지급완료') {
    return alert('지급완료 처리된 묶음만 보관함으로 이동할 수 있습니다.\n배송 도착 후 [지급완료 처리]를 먼저 해 주세요.');
  }
  if (getBatchInspectStatus(batch) !== 'match') {
    return alert(
      '명세서 검수가 일치하거나, [명세표 대조]에서 수기 단가를 확정한 묶음만 이동할 수 있습니다.'
    );
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
    setExpandedBatchIds((prev) => {
      if (!prev.has(batch.id)) return prev;
      const next = new Set(prev);
      next.delete(batch.id);
      return next;
    });
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
const filteredBatches = useMemo(() => {
  return afterPeriodList.filter((b) => {
    const hasMatch = (b.items || []).some((item) => {
      if (!itemMatchesOrg(item, selectedOrg, units)) return false;
      if (q && !String(item.userName || '').toLowerCase().includes(q)) return false;
      return true;
    });
    return hasMatch;
  });
}, [afterPeriodList, selectedOrg, units, q]);

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

/** 대상자 검색 시 매칭 묶음 하위 상세(아코디언) 자동 펼침 */
useEffect(() => {
  const qUser = searchUserQuery.trim();
  if (!qUser) {
    setExpandedBatchIds(new Set());
    return;
  }
  const start = (batchPage - 1) * BATCH_PAGE_SIZE;
  const pageIds = filteredBatches
    .slice(start, start + BATCH_PAGE_SIZE)
    .map((b) => b.id);
  setExpandedBatchIds(new Set(pageIds));
}, [searchUserQuery, batchPage, filteredBatches]);

const toggleBatchExpand = (batchId: string) => {
  setExpandedBatchIds((prev) => {
    const next = new Set(prev);
    if (next.has(batchId)) next.delete(batchId);
    else next.add(batchId);
    return next;
  });
};

return (
  <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
    <input
      ref={proofFileInputRef}
      type="file"
      className="hidden"
      accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.ai,.zip"
      onChange={handleProofFileChange}
    />
    
{/* client-search 배너 규격: emerald→teal · orbs · permission chips */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
  <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
  <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
  <div className="relative z-10">
    <h3 className="text-[10px] font-medium uppercase tracking-widest text-emerald-400 mb-2.5">
      BUSINESS CARD TOTAL GOVERNANCE
    </h3>
    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
      전사 임직원 명함 통합 관리 대장
    </h1>
    <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
      발주서 전송, 물품 수령·지급 확인 및 거래명세표 대조를 통합 관제하는 마스터 컨트롤 허브입니다.
    </p>
    {permissionSummary && isSystemLv1User(currentUser) && (
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
          <span>👑 Master 책임자:</span>
          <span>{permissionSummary.masterName}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
          <span>👁️ Access:</span>
          <span>{permissionSummary.accessDesignate}</span>
          <span className="opacity-50">|</span>
          <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
          <span className="opacity-50">|</span>
          <span>Level: {permissionSummary.accessLevel}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
          <span>✍️ Edit:</span>
          <span>{permissionSummary.editDesignate}</span>
          <span className="opacity-50">|</span>
          <span>Level: {permissionSummary.editLevel}</span>
        </div>
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
          className={`px-5 py-2 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${
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
  <p className="text-[10px] text-slate-400 font-medium px-3 hidden sm:block">
    ※ 탭을 클릭하여 신청현황·외주발주·보관함을 전환합니다.
  </p>
</div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-[10px] text-amber-800 font-medium leading-relaxed">
        <div className="grid grid-cols-[1.25rem_8.5rem_1fr] gap-x-2 gap-y-1.5 items-start">
          <span className="pt-px">💡</span>
          <span className="font-medium text-slate-900 whitespace-nowrap">1) 발주진행</span>
          <span>
            발주서 엑셀↓ + 메일 작성(그룹웨어){' '}
            <b className="font-medium text-amber-600">→</b> 시안업로드(신청자 공유됨){' '}
            <b className="font-medium text-amber-600">→</b> 시안확정(신청자 또는 관리자 클릭){' '}
            <b className="font-medium text-amber-600">→</b> 최종 발주확정일 지정 (시안확정 후 최종메일 송부)
          </span>

          <span aria-hidden />
          <span className="font-medium text-slate-900 whitespace-nowrap">2) 수령 및 지급</span>
          <span>
            물품 수령검수 <b className="font-medium text-amber-600">→</b> 사용자 지급
          </span>

          <span aria-hidden />
          <span className="font-medium text-slate-900 whitespace-nowrap">3) 명세 대조·검수</span>
          <span>
            명세서 업로드 또는 수기 검수 확정{' '}
            <b className="font-medium text-amber-600">→</b> 완료 보관함 이동
          </span>
        </div>
      </div>

    {/* 외주 발주 묶음 대장 */}
    <div className={`bg-white border border-indigo-200 rounded-[2.5rem] shadow-sm ${orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
      <div className={`p-4 px-6 bg-indigo-50 border-b border-indigo-200 flex flex-wrap items-center justify-between gap-4 relative ${orgMenuOpen ? 'z-[80] overflow-visible' : ''}`}>
        <div className="flex items-start gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 mt-1.5 shrink-0" />
          <div>
            <h2 className="text-sm font-medium text-slate-800 tracking-tight">외주 발주 묶음 관리 대장</h2>
          </div>
        </div>
        
        <div className={`flex items-center gap-2 flex-wrap ml-auto ${orgMenuOpen ? 'relative z-[90] overflow-visible' : ''}`}>
            <div className={`relative group/filter flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-indigo-200 shadow-sm h-7 box-border ${orgMenuOpen ? 'relative z-[90]' : ''}`}>
              <span
                role="tooltip"
                className={`pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-medium text-white shadow-lg ${orgMenuOpen ? '' : 'group-hover/filter:block'}`}
              >
                연도 → 월 · 연계필터 / 조직은 마스터 정렬
              </span>
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth('ALL');
                }}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                }}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{parseInt(month, 10)}월</option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">조직</span>
              <div className="relative inline-flex items-center" ref={orgMenuRef}>
                <button
                  type="button"
                  onClick={() => setOrgMenuOpen((open) => !open)}
                  className={`max-w-[220px] truncate text-left text-[11px] leading-none py-0 px-0 m-0 h-4 inline-flex items-center border-0 appearance-none outline-none cursor-pointer bg-transparent ${
                    selectedOrgUnit && isBoldOrgType(selectedOrgUnit.unit_type) ? 'font-medium text-slate-900' : 'font-medium text-slate-800'
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
                            bold ? 'font-medium text-slate-900' : 'font-medium text-slate-600'
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
                className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-indigo-200 rounded-lg text-[11px] font-medium outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="text-indigo-900 text-[10px] font-medium border-b border-indigo-200">
            <tr>
              <th
                colSpan={4}
                className="bg-slate-100 text-slate-700 border-b border-r border-slate-300 font-medium text-center text-xs py-1.5 normal-case tracking-normal"
              >
                신청/기본정보
              </th>
              <th
                colSpan={4}
                className="bg-blue-50 text-blue-700 border-b border-r border-blue-200 font-medium text-center text-xs py-1.5 normal-case tracking-normal"
              >
                <div className="flex flex-col items-center gap-1 px-2">
                  <span>발주진행</span>
                  <div
                    className="flex w-full max-w-full items-center"
                    title="발주 진행 방향"
                    aria-hidden
                  >
                    <div className="h-2.5 flex-1 rounded-l-full bg-blue-500/80" />
                    <div
                      className="h-0 w-0 shrink-0 border-y-[10px] border-y-transparent border-l-[16px] border-l-blue-500/80"
                    />
                  </div>
                </div>
              </th>
              <th
                colSpan={2}
                className="bg-sky-50 text-sky-800 border-b border-r border-sky-200 font-medium text-center text-xs py-1.5 normal-case tracking-normal"
              >
                <div className="flex flex-col items-center gap-1 px-2">
                  <span>수령 및 지급</span>
                  <div
                    className="flex w-full max-w-full items-center"
                    title="수령·지급 진행 방향"
                    aria-hidden
                  >
                    <div className="h-2.5 flex-1 rounded-l-full bg-sky-500/80" />
                    <div
                      className="h-0 w-0 shrink-0 border-y-[10px] border-y-transparent border-l-[16px] border-l-sky-500/80"
                    />
                  </div>
                </div>
              </th>
              <th
                colSpan={2}
                className="bg-amber-50 text-amber-800 border-b border-r border-amber-200 font-medium text-center text-xs py-1.5 normal-case tracking-normal"
              >
                <div className="flex flex-col items-center gap-1 px-2">
                  <span>명세 대조·검수</span>
                  <div
                    className="flex w-full max-w-full items-center"
                    title="명세 검수 진행 방향"
                    aria-hidden
                  >
                    <div className="h-2.5 flex-1 rounded-l-full bg-amber-500/80" />
                    <div
                      className="h-0 w-0 shrink-0 border-y-[10px] border-y-transparent border-l-[16px] border-l-amber-500/80"
                    />
                  </div>
                </div>
              </th>
              <th
                colSpan={2}
                className="bg-indigo-50 text-indigo-700 border-b border-indigo-200 font-medium text-center text-xs py-1.5 normal-case tracking-normal"
              >
                관리 액션
              </th>
            </tr>
            <tr className="bg-indigo-100">
              <th className="h-12 px-4 w-[50px] text-center"><input type="checkbox" onChange={handleSelectAllBatches} checked={allPageBatchesSelected} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></th>
              <th className="h-12 px-2 w-[160px] text-left">묶음 번호</th>
              <th className="h-12 px-4 w-[120px] text-center">발주생성일</th>
              <th className="h-12 px-2 w-[140px] text-left border-r border-slate-300">신청 상세</th>
              <th className="h-12 px-2 text-center w-[120px]">
                <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                  <span className="whitespace-nowrap">발주서다운</span>
                  <span className="text-[10px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                    (Edit · 엑셀)
                  </span>
                </div>
              </th>
              <th className="h-12 px-2 text-center w-[100px]">
                <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                  <span className="whitespace-nowrap">메일 작성</span>
                  <span className="text-[10px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                    (그룹웨어)
                  </span>
                </div>
              </th>
              <th className="h-12 px-1 text-center w-[100px]">
                <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                  <span className="whitespace-nowrap">시안확인</span>
                  <span className="text-[10px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                    (Edit)
                  </span>
                </div>
              </th>
              <th className="h-12 px-1 text-center w-[110px] border-r border-blue-200">
                <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                  <span className="whitespace-nowrap">발주확정일</span>
                  <span className="text-[10px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                    (Edit)
                  </span>
                </div>
              </th>
              <th className="h-12 px-1 text-center w-[100px]">
                <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                  <span className="whitespace-nowrap">수령 검수</span>
                  <span className="text-[9px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                    (물품 수령)
                  </span>
                </div>
              </th>
              <th className="h-12 px-2 text-center w-[110px] border-r border-blue-200">
                <span className="whitespace-nowrap">사용자 지급</span>
              </th>
              <th className="h-12 px-1 text-center w-[132px]">
                <div className="flex flex-col items-center justify-center gap-1">
                  <span className="whitespace-nowrap">명세서 업로드 검수</span>
                  <button
                    type="button"
                    onClick={openCompareModal}
                    disabled={!canEditMaster || selectedBatchIds.size === 0}
                    title={!canEditMaster ? '편집 권한 필요' : undefined}
                    className={`px-1.5 py-1 font-medium text-[9px] rounded-lg shadow-sm whitespace-nowrap normal-case tracking-normal leading-tight ${
                      canEditMaster
                        ? 'bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40'
                        : DISABLED_ACTION_BTN
                    }`}
                  >
                    선택 검수({selectedBatchIds.size}건)
                  </button>
                </div>
              </th>
              <th className="h-12 px-1 text-center w-[132px] border-r border-amber-200">
                <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                  <span className="whitespace-nowrap">명세표 수기 대조</span>
                  <span className="text-[10px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                    (Edit)
                  </span>
                </div>
              </th>
              <th className="h-12 px-2 text-center w-[150px]">완료 보관함 이동</th>
              <th className="h-12 px-2 text-center w-[100px]">
                <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                  <span className="whitespace-nowrap">↺ 발주대기</span>
                  <span className="text-[10px] font-medium text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                    (Edit)
                  </span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white text-[11px] font-medium text-slate-700 divide-y divide-slate-100">
            {filteredBatches.length === 0 ? (
              <tr>
                <td colSpan={14} className="p-16 text-center text-slate-400 text-xs">발주 묶음이 없습니다.</td>
              </tr>
            ) : paginatedBatches.map((batch) => {
              const allDispatched = Boolean(batch.dispatchedDate);
              /** 발주확정 후 발주서·메일작성은 회색 (클릭은 유지) — 제작물 inspection과 동일 */
              const prepActionBtnClass = allDispatched
                ? 'bg-slate-100 hover:bg-slate-200/80 text-slate-400 border border-slate-200'
                : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200';
              return (
              <React.Fragment key={batch.id}>
                <tr className={`h-16 hover:bg-indigo-50/40 transition-colors ${selectedBatchIds.has(batch.id) ? 'bg-indigo-50/50' : ''}`}>
                  <td className="px-4 text-center"><input type="checkbox" checked={selectedBatchIds.has(batch.id)} onChange={() => handleSelectBatchRow(batch.id)} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></td>
                  <td
                    className="px-2 text-left text-slate-800 cursor-pointer whitespace-nowrap truncate overflow-hidden"
                    title={formatBatchNo(batch.id)}
                    onClick={() => toggleBatchExpand(batch.id)}
                  >
                    {formatBatchNo(batch.id)}
                  </td>
                  <td className="px-4 text-center text-slate-800 whitespace-nowrap">{batch.orderDate}</td>
                  <td
                    className="px-2 text-left cursor-pointer border-r border-slate-200"
                    onClick={() => toggleBatchExpand(batch.id)}
                  >
                    {(() => {
                      const items = batch.items || [];
                      const count = items.length;
                      const packs = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
                      const names = Array.from(
                        new Set(items.map((i) => i.userName).filter(Boolean))
                      );
                      const nameLabel = names.join(', ');
                      return (
                        <>
                          <span className="text-slate-700 underline underline-offset-2 whitespace-nowrap">
                            상세보기({count}건/{packs}통)
                          </span>
                          {nameLabel ? (
                            <p className="text-[10px] text-slate-400 mt-0.5 truncate" title={nameLabel}>
                              {nameLabel}
                            </p>
                          ) : null}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-2 text-center whitespace-nowrap">
                    <button
                      type="button"
                      disabled={!canEditMaster}
                      title={
                        !canEditMaster
                          ? '편집 권한 필요'
                          : allDispatched
                            ? '발주완료 후에도 다시 받을 수 있습니다'
                            : '발주서 엑셀 다운로드'
                      }
                      onClick={() => handleBatchExcelDownload(batch)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-lg w-full whitespace-nowrap transition-colors ${
                        canEditMaster ? prepActionBtnClass : DISABLED_ACTION_BTN
                      }`}
                    >
                      발주서↓
                    </button>
                  </td>
                  <td className="px-2 text-center">
                    <button
                      type="button"
                      onClick={() => openEmailModal(batch)}
                      title={
                        allDispatched
                          ? '발주완료 후에도 메일 양식을 다시 열 수 있습니다'
                          : '그룹웨어 발송용 메일 양식 열기'
                      }
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-lg w-full whitespace-nowrap transition-colors ${prepActionBtnClass}`}
                    >
                      메일 작성
                    </button>
                  </td>
                  <td
                    className="px-1 text-center cursor-pointer"
                    onClick={() => toggleBatchExpand(batch.id)}
                    title="클릭하면 상세에서 시안 업로드·확정"
                  >
                    {(() => {
                      const proofStatus = getBatchProofStatus(batch);
                      const cls =
                        proofStatus === '확정완료'
                          ? 'text-emerald-600'
                          : proofStatus === '확정대기'
                            ? 'text-amber-600'
                            : 'text-slate-500';
                      return (
                        <span className={`font-medium whitespace-nowrap ${cls}`}>
                          {proofStatus}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-2 text-center border-r border-slate-200">
                    {allDispatched ? (
                      <span className="font-medium text-emerald-600 whitespace-nowrap">
                        {batch.dispatchedDate}
                      </span>
                    ) : (
                      (() => {
                        const proofReady = isBatchProofConfirmed(batch);
                        const canDispatch = canEditMaster && proofReady;
                        return (
                          <button
                            type="button"
                            disabled={!canDispatch}
                            title={
                              !canEditMaster
                                ? '편집 권한 필요'
                                : !proofReady
                                  ? '상세보기에서 시안확정을 모두 완료해 주세요'
                                  : '발주완료일 기록'
                            }
                            onClick={() => openDispatchModal(batch)}
                            className={`px-2 py-1 text-[11px] font-medium rounded-lg w-full whitespace-nowrap transition-colors ${
                              canDispatch
                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            → 발주확정
                          </button>
                        );
                      })()
                    )}
                  </td>
                  <td
                    className="px-1 text-center cursor-pointer"
                    onClick={() => toggleBatchExpand(batch.id)}
                    title="클릭하면 신청 상세를 펼칩니다"
                  >
                    {(() => {
                      const items = batch.items || [];
                      const total = items.length;
                      const received = items.filter(
                        (it) => it.adminStatus === '수령완료' || it.adminStatus === '지급완료'
                      ).length;
                      /** 발주확정 후 미수령만 빨강 — 확정 전에는 차분히 */
                      const pendingCls = allDispatched ? 'text-red-600' : 'text-slate-500';
                      if (total > 0 && received >= total) {
                        return (
                          <span className="font-medium text-emerald-600 whitespace-nowrap">
                            수령완료
                          </span>
                        );
                      }
                      return (
                        <span className={`font-medium whitespace-nowrap ${pendingCls}`}>
                          수령 {received}/{total}
                          {total - received > 0 ? ` · 대기 ${total - received}` : null}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-2 text-center border-r border-slate-200">
                    {batch.status === '지급완료' ? (
                      <span className="font-medium whitespace-nowrap text-slate-900">지급완료</span>
                    ) : batch.status === '수령완료' ||
                      ((batch.items || []).length > 0 &&
                        (batch.items || []).every(
                          (it) => it.adminStatus === '수령완료' || it.adminStatus === '지급완료'
                        )) ? (
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={(e) => handleMarkAsDistributed(batch.id, e)}
                        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                          canEditMaster
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        <span>→</span>
                        <span>명함지급완료</span>
                      </button>
                    ) : (
                      <span className="font-medium text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-1 text-center w-[132px]">
                    <div className="flex items-center justify-center">
                      {(() => {
                        const inspect = getBatchInspectStatus(batch);
                        if (inspect === 'match') {
                          return <span className="font-medium text-indigo-600">일치</span>;
                        }
                        if (inspect === 'mismatch') {
                          return <span className="font-medium text-rose-600">불일치</span>;
                        }
                        return <span className="font-medium text-slate-400">미검수</span>;
                      })()}
                    </div>
                  </td>
                  <td className="px-1 text-center w-[132px] border-r border-slate-200">
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={
                          !canEditMaster
                            ? '편집 권한 필요'
                            : batch.inspectResult?.settlementManual
                              ? '수기 대조로 확정됨 · 다시 열어 수정 가능'
                              : '검수 불일치여도 수기 단가로 확정할 수 있습니다'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          openSettlementModal(batch);
                        }}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg whitespace-nowrap transition-colors ${
                          canEditMaster
                            ? batch.inspectResult?.settlementManual
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        {batch.inspectResult?.settlementManual ? '대조 확정됨' : '명세표 대조'}
                      </button>
                    </div>
                  </td>
                  <td className="px-2 text-center">
                    {batch.status === '지급완료' && getBatchInspectStatus(batch) === 'match' ? (
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={(e) => handleMoveBatchToArchive(batch, e)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg w-full whitespace-nowrap transition-colors ${
                          canEditMaster
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        → 완료 보관함 이동
                      </button>
                    ) : (
                      <span className="font-medium text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-2 text-center">
                    {batch.status === '발주완료' ? (
                      <button
                        type="button"
                        disabled={!canEditMaster}
                        title={!canEditMaster ? '편집 권한 필요' : undefined}
                        onClick={(e) => handleCancelOrderBatch(batch, e)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg w-full whitespace-nowrap transition-colors ${
                          canEditMaster
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200'
                            : DISABLED_ACTION_BTN
                        }`}
                      >
                        ↺ 발주대기
                      </button>
                    ) : (
                      <span className="font-medium text-slate-300">—</span>
                    )}
                  </td>
                </tr>
                
                {expandedBatchIds.has(batch.id) && (
                  <tr className="bg-slate-200/90 text-slate-700 text-[10px] font-medium border-y border-slate-300">
                    <td className="h-9 px-4 text-center border-l-4 border-l-blue-500 bg-slate-200/90">NO</td>
                    <td className="h-9 px-2 text-left whitespace-nowrap">관리번호</td>
                    <td className="h-9 px-4 text-center whitespace-nowrap">신청일</td>
                    <td className="h-9 px-2 text-left border-r border-slate-300 whitespace-nowrap">신청주체 / 부서·이름</td>
                    <td className="h-9 px-2 text-center whitespace-nowrap">원문확인</td>
                    <td className="h-9 px-2 text-center text-slate-400">—</td>
                    <td className="h-9 px-1 text-center whitespace-nowrap">시안업로드·확정</td>
                    <td className="h-9 px-2 text-center text-slate-400 border-r border-slate-300">—</td>
                    <td className="h-9 px-1 text-center whitespace-nowrap align-middle">
                      <div className="inline-flex flex-col items-center gap-0.5 py-1">
                        <span>수령확인</span>
                        {(() => {
                          const pendingCount = (batch.items || []).filter(
                            (it) => it.adminStatus === '발주완료'
                          ).length;
                          const canBulk =
                            canEditMaster &&
                            Boolean(batch.dispatchedDate) &&
                            pendingCount > 0;
                          return (
                            <button
                              type="button"
                              disabled={!canBulk}
                              title={
                                !canEditMaster
                                  ? '편집 권한 필요'
                                  : !batch.dispatchedDate
                                    ? '발주확정일을 먼저 기록해 주세요'
                                    : pendingCount === 0
                                      ? '수령 대기 건이 없습니다'
                                      : `미수령 ${pendingCount}건 일괄 수령확인`
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleConfirmReceiveAll(batch);
                              }}
                              className={`px-2 py-0.5 text-[9px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                canBulk
                                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              일괄 수령확인
                              {pendingCount > 0 ? `(${pendingCount})` : ''}
                            </button>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="h-9 px-2 text-center text-slate-400 border-r border-slate-300">—</td>
                    <td className="h-9 px-1 text-center whitespace-nowrap">명세</td>
                    <td className="h-9 px-1 text-center whitespace-nowrap border-r border-slate-300">금액</td>
                    <td className="h-9 px-2 text-center text-slate-400">—</td>
                    <td className="h-9 px-2 text-center text-slate-400">—</td>
                  </tr>
                )}
                {expandedBatchIds.has(batch.id) &&
                  (batch.items || []).map((item, idx) => {
                    const mStatus = itemMatchStatus[item.id] || 'idle';
                    const deptLabel =
                      displayDeptName(item, units) ||
                      String(item.deptHead || '').trim() ||
                      '-';
                    return (
                      <tr
                        key={item.id}
                        className={`h-12 bg-slate-50/80 hover:bg-slate-100/80 text-[11px] font-medium text-slate-700 border-y border-slate-200 ${
                          mStatus === 'mismatch' || mStatus === 'missing' ? 'bg-rose-50/80' : ''
                        }`}
                      >
                        {/* 체크박스 자리 · 파란 바 최좌측 */}
                        <td className="px-4 text-center border-l-4 border-l-blue-500 bg-slate-100/70">
                          <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                            {idx + 1}
                          </span>
                        </td>
                        {/* 묶음번호 ↓ 관리번호 */}
                        <td
                          className="px-2 text-left text-slate-900 truncate bg-slate-50/80"
                          title={item.postNumber}
                        >
                          {item.postNumber}
                        </td>
                        {/* 발주생성일 ↓ 신청일 */}
                        <td className="px-4 text-center whitespace-nowrap tabular-nums text-slate-800 bg-slate-50/80">
                          {item.applyDate || '-'}
                        </td>
                        {/* 신청상세 ↓ 신청주체 + 부서/이름 */}
                        <td
                          className="px-2 text-left min-w-0 border-r border-slate-200 bg-slate-50/80"
                          title={[item.deptHead, displayDeptName(item, units), item.title]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <span className="text-[10px] font-medium whitespace-nowrap block">
                            {item.applicantType === '관리자대행' ? (
                              <span className="text-indigo-700">관리자대행</span>
                            ) : (
                              <span className="text-slate-500">본인</span>
                            )}
                            <span className="text-slate-300 mx-1">·</span>
                            <span className="text-slate-500">{deptLabel}</span>
                          </span>
                          <span className="text-slate-800 block truncate">{item.userName || '-'}</span>
                        </td>
                        {/* 발주서 ↓ 원문확인 + 수량 */}
                        <td className="px-2 text-center bg-slate-50/80">
                          <div className="inline-flex flex-col items-center gap-0.5">
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
                              className={`px-2 py-1 text-[10px] font-medium rounded-lg transition-colors ${
                                canEditMaster
                                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              원문확인
                            </button>
                            <span className="text-[9px] font-medium text-slate-400 tabular-nums">
                              {item.quantity || 1}통
                            </span>
                          </div>
                        </td>
                        {/* 메일 ↓ — */}
                        <td className="px-2 text-center text-slate-300 bg-slate-50/80">—</td>
                        {/* 시안확인 ↓ 업로드·확정 (Edit 권한) */}
                        <td className="px-1 text-center bg-slate-50/80">
                          {item.adminStatus === '발주완료' ||
                          item.adminStatus === '수령완료' ||
                          item.adminStatus === '지급완료' ? (
                            <div className="inline-flex flex-col items-center gap-1">
                              <button
                                type="button"
                                disabled={!canEditMaster || proofUploadingId === item.id}
                                title={
                                  !canEditMaster
                                    ? '편집 권한 필요'
                                    : item.proofFileName
                                      ? `재업로드: ${item.proofFileName}`
                                      : '시안 파일 업로드'
                                }
                                onClick={() => {
                                  if (!canEditMaster) return alertNoEditPermission();
                                  openProofUpload(item.id);
                                }}
                                className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                  canEditMaster
                                    ? item.proofFileName
                                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                                      : 'bg-blue-600 text-white hover:bg-blue-700'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                {proofUploadingId === item.id
                                  ? '업로드중…'
                                  : item.proofFileName
                                    ? '재업로드'
                                    : '시안업로드'}
                              </button>
                              {item.proofFileName ? (
                                <button
                                  type="button"
                                  disabled={!canEditMaster}
                                  title={
                                    !canEditMaster
                                      ? '편집 권한 필요'
                                      : item.proofFileName || '시안 다운로드'
                                  }
                                  onClick={() => {
                                    if (!canEditMaster) return alertNoEditPermission();
                                    handleProofDownloadAdmin(item.id, item.proofFileName);
                                  }}
                                  className={`text-[9px] font-medium underline ${
                                    canEditMaster
                                      ? 'text-slate-500 hover:text-blue-600'
                                      : 'text-slate-300 cursor-not-allowed no-underline'
                                  }`}
                                >
                                  다운로드
                                </button>
                              ) : null}
                              {item.proofConfirmedAt ? (
                                <span
                                  className="text-[9px] font-medium text-emerald-600 whitespace-nowrap"
                                  title={item.proofConfirmedBy || undefined}
                                >
                                  확정
                                  <span className="text-slate-400 mx-0.5">·</span>
                                  {String(item.proofConfirmedBy || '').startsWith('관리자')
                                    ? '관리자'
                                    : '신청자'}
                                </span>
                              ) : item.proofFileName ? (
                                <button
                                  type="button"
                                  disabled={!canEditMaster}
                                  title={
                                    !canEditMaster
                                      ? '편집 권한 필요'
                                      : '관리자가 시안을 직접 확정'
                                  }
                                  onClick={() => {
                                    if (!canEditMaster) return alertNoEditPermission();
                                    handleAdminProofConfirm(item);
                                  }}
                                  className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                    canEditMaster
                                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                      : DISABLED_ACTION_BTN
                                  }`}
                                >
                                  확정
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[10px] font-medium text-slate-300">—</span>
                          )}
                        </td>
                        {/* 발주완료 ↓ — */}
                        <td className="px-2 text-center text-slate-300 border-r border-slate-200 bg-slate-50/80">—</td>
                        {/* 수령검수 ↓ 수령확인 */}
                        <td className="px-1 text-center bg-slate-50/80">
                          {item.adminStatus === '수령완료' || item.adminStatus === '지급완료' ? (
                            <span className="text-[10px] font-medium text-emerald-600 whitespace-nowrap">
                              수령완료
                            </span>
                          ) : item.adminStatus === '발주완료' ? (
                            <button
                              type="button"
                              disabled={!canEditMaster || !batch.dispatchedDate}
                              title={
                                !canEditMaster
                                  ? '편집 권한 필요'
                                  : !batch.dispatchedDate
                                    ? '발주완료일을 먼저 기록해 주세요'
                                    : undefined
                              }
                              onClick={() => handleConfirmReceiveItem(item, batch.id)}
                              className={`px-2 py-1 text-[10px] font-medium rounded-lg transition-colors ${
                                canEditMaster && batch.dispatchedDate
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              수령확인
                            </button>
                          ) : (
                            <span className="text-[10px] font-medium text-slate-300">—</span>
                          )}
                        </td>
                        {/* 사용자지급 ↓ — */}
                        <td className="px-2 text-center text-slate-300 border-r border-slate-200 bg-slate-50/80">
                          —
                        </td>
                        {/* 명세서검수 ↓ O/X */}
                        <td className="px-1 text-center text-base font-medium bg-slate-50/80">
                          {mStatus === 'idle' && <span className="text-slate-300">-</span>}
                          {mStatus === 'match' && <span className="text-indigo-600">O</span>}
                          {(mStatus === 'mismatch' || mStatus === 'missing') && (
                            <span className="text-rose-500">X</span>
                          )}
                        </td>
                        {/* 명세표대조 ↓ 금액 */}
                        <td className="px-1 text-center font-mono tabular-nums text-[11px] border-r border-slate-200 bg-slate-50/80">
                          {mStatus === 'idle' ? (
                            <span className="text-slate-300">-</span>
                          ) : (
                            <span
                              className={
                                itemMatchPrice[item.id] ? 'text-slate-900' : 'text-slate-400'
                              }
                            >
                              ₩{(itemMatchPrice[item.id] || 0).toLocaleString()}
                            </span>
                          )}
                        </td>
                        <td className="px-2 text-center text-slate-300 bg-slate-50/80">—</td>
                        <td className="px-2 text-center text-slate-300 bg-slate-50/80">—</td>
                      </tr>
                    );
                  })}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {filteredBatches.length > 0 && (
        <WindowedPagination
          currentPage={batchPage}
          totalPages={batchTotalPages}
          onPageChange={setBatchPage}
          className="border-indigo-100"
        />
      )}
    </div>
    {detailTarget && (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-medium text-blue-600 font-mono tracking-widest">{isRequestEditing ? '⚡ 원문 편집 모드 활성화 (발주 전 최종)' : (detailReadOnly ? '🔎 원문 확인' : '🔎 발주 원문 검수 모드')}</span>
              <h2 className="text-base font-medium text-slate-900 mt-1">{detailReadOnly ? `명함 신청 원문 확인 (${detailTarget.userName} 님)` : `명함 신청 데이터 세부 검수창 (${detailTarget.userName} 님)`}</h2>
            </div>
            <button onClick={() => { setDetailTarget(null); setIsRequestEditing(false); setDetailReadOnly(false); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-medium text-sm transition-colors">✕</button>
          </div>

          {detailTarget.isModifiedByAdmin && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium">⚠️ 주의: 이 신청서는 관리자에 의해 이미 한 번 수정된 이력이 있습니다. (사유: {detailTarget.adminMemo})</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-100">
            {(() => {
              const preview = isRequestEditing && requestEditForm ? requestEditForm : detailTarget;
              const titleInMaster =
                duties.some((d) => d.label === preview.title) ||
                grades.some((g) => g.label === preview.title);
              const matchedAddress =
                addresses.find((a) => a.id === preview.addressId) ||
                addresses.find(
                  (a) =>
                    a.zipCode === preview.zipCode &&
                    formatCompanyAddressKo(a) === preview.addressKo
                );
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
              const syncedCls = 'w-full p-1.5 border border-slate-200 rounded bg-slate-50 text-xs font-medium text-slate-500 cursor-not-allowed';
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
              <h3 className="text-xs font-medium text-slate-800 border-b pb-1.5">1. 국문 조판 데이터</h3>
              <div className="space-y-1.5 text-xs font-medium text-slate-600 flex-1">
                <label className="block text-[10px] text-slate-400 mt-1">성명</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.userName || ''} onChange={e => handleEditKoField('userName', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white text-xs font-medium" /> : <p className="text-slate-900 font-medium">{detailTarget.userName}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">본부 (상위 조직)</label>
                {isRequestEditing ? (
                  <select
                    value={preview.deptHead || ''}
                    onChange={(e) => handleEditHeadChange(e.target.value)}
                    className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-medium"
                  >
                    <option value="">선택</option>
                    {hqUnits.map((u) => (
                      <option key={`h-${u.id}`} value={u.unit_name}>{u.unit_name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-slate-900 font-medium">{detailTarget.deptHead || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">센터 (하위 조직)</label>
                {isRequestEditing ? (
                  <select
                    value={preview.deptName || ''}
                    disabled={!preview.deptHead}
                    onChange={(e) => handleEditSubChange(e.target.value)}
                    className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-medium disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">(본부의 하위 센터만 선택)</option>
                    {childCenterUnits.map((u) => (
                      <option key={`s-${u.id}`} value={u.unit_name}>{u.unit_name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-slate-900 font-medium">{detailTarget.deptName || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">직책/직급</label>
                {isRequestEditing ? (
                  <select
                    value={preview.title}
                    onChange={(e) => handleEditTitleChange(e.target.value)}
                    className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-medium"
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
                  <p className="text-slate-900 font-medium">{detailTarget.title}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">자격사항</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.additionalKo || ''} onChange={e => handleEditKoField('additionalKo', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-medium" /> : <p className="text-slate-900 font-medium">{detailTarget.additionalKo || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">휴대전화</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.mobile || ''} onChange={e => handleEditKoField('mobile', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-medium" /> : <p className="text-slate-900 font-mono font-medium">{detailTarget.mobile}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">내선전화</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.phone || ''} onChange={e => handleEditKoField('phone', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-medium" /> : <p className="text-slate-900 font-mono">{detailTarget.phone || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">이메일</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.email || ''} onChange={e => handleEditKoField('email', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-medium" /> : <p className="text-slate-900 font-mono">{detailTarget.email}</p>}
              </div>
              <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                {isRequestEditing ? (
                  <>
                    <label className="block text-[10px] text-slate-400">주소지 선택</label>
                    <select
                      value={addressSelectValue}
                      onChange={(e) => handleEditAddressChange(e.target.value)}
                      className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-medium"
                    >
                      <option value="">선택</option>
                      {addressOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                    <p className="text-[11px] font-medium text-slate-500">팩스: <span className="font-mono text-slate-800">{preview.fax || '-'}</span></p>
                    <p className="text-[11px] font-medium text-slate-500 leading-relaxed">주소: <span className="text-slate-800">[{preview.zipCode}] {preview.addressKo}</span></p>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-medium text-slate-600 mb-1">팩스: <span className="font-mono text-slate-900">{detailTarget.fax || '-'}</span></p>
                    <p className="text-[11px] font-medium text-slate-600 leading-relaxed">주소: <span className="text-slate-900">[{detailTarget.zipCode}] {detailTarget.addressKo}</span></p>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2 pl-1 flex flex-col">
              <h3 className="text-xs font-medium text-indigo-800 border-b border-indigo-100 pb-1.5">2. 영문 조판 데이터</h3>
              <div className="space-y-1.5 text-xs font-medium text-slate-600 flex-1">
                <label className="block text-[10px] text-slate-400 mt-1">영문 성명</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.userNameEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, userNameEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-medium" /> : <p className="text-indigo-900 font-medium">{detailTarget.userNameEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 본부 (상위 조직) (조직 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.deptHeadEn || '-'} className={syncedCls} />
                ) : (
                  <p className="text-indigo-900 font-medium">{detailTarget.deptHeadEn || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 센터 (하위 조직) (조직 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.deptNameEn || '-'} className={syncedCls} />
                ) : (
                  <p className="text-indigo-900 font-medium">{detailTarget.deptNameEn || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 직책/직급🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.titleEn || '-'} className={syncedCls} />
                ) : (
                  <p className="text-indigo-900 font-medium">{detailTarget.titleEn || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 자격사항</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.additionalEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, additionalEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-medium" /> : <p className="text-indigo-900 font-medium">{detailTarget.additionalEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 휴대전화 (국문 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={stripBusinessCardEnPlus(preview.mobileEn) || '-'} className={`${syncedCls} font-mono`} />
                ) : (
                  <p className="text-indigo-900 font-mono font-medium">{stripBusinessCardEnPlus(detailTarget.mobileEn) || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 내선전화 (국문 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={stripBusinessCardEnPlus(preview.phoneEn) || '-'} className={`${syncedCls} font-mono`} />
                ) : (
                  <p className="text-indigo-900 font-mono">{stripBusinessCardEnPlus(detailTarget.phoneEn) || '-'}</p>
                )}
                <label className="block text-[10px] text-slate-400 mt-1">영문 이메일 (국문 연동)🔒</label>
                {isRequestEditing ? (
                  <input type="text" readOnly value={preview.emailEn || '-'} className={`${syncedCls} font-mono`} />
                ) : (
                  <p className="text-indigo-900 font-mono">{detailTarget.emailEn || '-'}</p>
                )}
              </div>
              <div className="mt-4 p-3 bg-white rounded-xl border border-indigo-100">
                <p className="text-[11px] font-medium text-slate-600 mb-1">영문 팩스: <span className="font-mono text-indigo-900">{stripBusinessCardEnPlus(preview.faxEn) || '-'}</span></p>
                <p className="text-[11px] font-medium text-slate-600 leading-relaxed">영문 주소: <span className="text-indigo-900">{preview.addressEn || '-'}</span></p>
              </div>
            </div>
            </>
              );
            })()}
          </div> 

          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between shadow-inner">
            <div>
              <label className="block text-sm font-medium text-rose-900 mb-0.5">📦 명함 발주 최종 수량 (통)</label>
              <p className="text-[10px] text-rose-700 font-medium">{detailReadOnly ? '인쇄소에 전달된 제작 수량입니다. 변경이 필요하면 묶음의 [↺ 발주대기]로 대기열에 되돌린 뒤 수정하세요.' : '인쇄소에 전달될 최종 제작 수량입니다. 수정이 필요할 경우 우측 폼에서 조정하세요.'}</p>
            </div>
            <div className="w-32">
              {isRequestEditing ? (
                <input type="number" min="1" value={requestEditForm?.quantity || 1} onChange={e => setRequestEditForm({...requestEditForm!, quantity: parseInt(e.target.value)})} className="w-full p-2.5 border-2 border-rose-400 rounded-xl bg-white text-rose-700 font-medium text-base text-center outline-none focus:border-rose-600" />
              ) : (
                <div className="w-full p-2.5 bg-white border-2 border-rose-200 rounded-xl text-rose-600 font-medium text-base text-center shadow-sm">{detailTarget.quantity || 1} 통</div>
              )}
            </div>
          </div>

          {isRequestEditing && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <label className="block text-xs font-medium text-amber-900 mb-2">📝 발주 전 최종 수정 사유 (임직원 마이페이지에 표시됩니다) *</label>
              <input type="text" value={adminMemoInput} onChange={(e) => setAdminMemoInput(e.target.value)} placeholder="예: 직급 오기재 수정, 영문 성명 스펠링 최종 수정 등" className="w-full p-2.5 text-xs font-medium text-slate-800 border border-amber-300 rounded-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200" />
            </div>
          )}

          <div className="flex gap-2 justify-end pt-3 border-t border-slate-100 mt-2">
            {isRequestEditing ? (
              <>
                <button onClick={() => { setIsRequestEditing(false); setAdminMemoInput(''); }} className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-xl font-medium text-xs hover:bg-slate-300 transition-colors">수정 취소</button>
                <button onClick={handleExecuteUpdate} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-xs hover:bg-blue-700 transition-colors shadow-md">변경사항 DB 저장</button>
              </>
            ) : (
              <>
                <button onClick={() => { setDetailTarget(null); setDetailReadOnly(false); }} className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium text-xs hover:bg-slate-200 transition-colors">닫기</button>
                {!detailReadOnly && (
                  <button
                    type="button"
                    disabled={!canEditMaster}
                    title={!canEditMaster ? '편집 권한 필요' : undefined}
                    onClick={() => beginRequestEdit(detailTarget)}
                    className={`px-5 py-2.5 rounded-xl font-medium text-xs transition-colors shadow-sm ${
                      canEditMaster
                        ? 'bg-amber-500 text-white hover:bg-amber-600'
                        : DISABLED_ACTION_BTN
                    }`}
                  >
                    ✏️ 발주 전 직접 수정하기(Edit)
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )}

    {dispatchModalBatch && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-medium text-slate-800 flex items-center gap-2">
              <span>📅</span>
              <span>발주완료일을 기록합니다.</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              실제 메일 발송일 등 발주 요청일을 입력하세요.
              <br />
              기본값은 오늘(Today)이며 달력에서 변경할 수 있습니다.
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/80 space-y-2">
            <div className="font-mono font-medium text-indigo-700 text-xs sm:text-[13px] break-all leading-snug tracking-tight">
              {formatBatchNo(dispatchModalBatch.id)}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-200/70">
              <span className="font-medium text-slate-500">수량 / 건수:</span>
              <span className="font-medium text-slate-800">
                {(dispatchModalBatch.items || []).reduce((s, it) => s + (it.quantity || 1), 0)}통 (
                {(dispatchModalBatch.items || []).length}건)
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">날짜:</label>
              <button
                type="button"
                onClick={() => setDispatchDateInput(getKSTDateString())}
                className="text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
              >
                오늘(Today)로 설정
              </button>
            </div>
            <input
              type="date"
              value={dispatchDateInput}
              onChange={(e) => setDispatchDateInput(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono font-medium text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 shadow-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDispatchModalBatch(null)}
              disabled={dispatchSubmitting}
              className="rounded-xl bg-slate-100 hover:bg-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirmDispatch}
              disabled={dispatchSubmitting}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50"
            >
              {dispatchSubmitting ? '처리중…' : '발주완료 확정'}
            </button>
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
              <h2 className="text-lg font-medium text-slate-900 flex items-center gap-2">📋 그룹웨어 발송용 메일 양식 미리보기</h2>
              <p className="text-xs text-slate-500 font-medium mt-2 leading-relaxed">
                수신 업체를 선택하면 본문이 자동으로 변경됩니다.
                <br />
                복사 후 그룹웨어에 붙여넣으세요. 제목·본문 양식은 설정에서 수정할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)} className="bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-medium py-2.5 px-3 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 w-48 cursor-pointer">
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
                  setMailTemplateEditor({
                    subjectTemplate: mailSubjectTemplate,
                    bodyTemplate: mailBodyTemplate,
                  });
                }}
                className={`px-4 py-2.5 font-medium text-xs rounded-xl transition-colors whitespace-nowrap shadow-sm ${
                  canEditMaster
                    ? 'bg-slate-800 text-white hover:bg-slate-900'
                    : DISABLED_ACTION_BTN
                }`}
              >
                ⚙️ 양식 설정(Edit)
              </button>
              <button
                type="button"
                disabled={!canEditMaster}
                title={!canEditMaster ? '편집 권한 필요' : undefined}
                onClick={() => {
                  if (!canEditMaster) return alertNoEditPermission();
                  setIsVendorModalOpen(true);
                }}
                className={`px-4 py-2.5 font-medium text-xs rounded-xl transition-colors whitespace-nowrap shadow-sm ${
                  canEditMaster
                    ? 'bg-slate-800 text-white hover:bg-slate-900'
                    : DISABLED_ACTION_BTN
                }`}
              >
                ⚙️ 업체 관리(Edit)
              </button>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">담당자 이메일</label>
              <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 select-all cursor-text">
                {activeVendor?.email?.trim() || <span className="text-slate-400">선택한 업체 이메일이 없습니다.</span>}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">메일 제목 (클릭 시 자동 선택)</label>
              <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 select-all cursor-text">{getPreviewSubject()}</div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">메일 본문 (클릭 시 자동 선택)</label>
              <textarea readOnly rows={8} value={getPreviewBody()} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 whitespace-pre-wrap resize-none focus:outline-none select-all cursor-text" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
            <button onClick={() => setIsEmailModalOpen(false)} className="px-5 py-2.5 bg-slate-100 font-medium text-xs rounded-xl hover:bg-slate-200 text-slate-700 transition-colors">닫기</button>
            <button onClick={handleCopyToClipboard} className="px-6 py-2.5 bg-indigo-600 text-white font-medium text-xs rounded-xl hover:bg-indigo-700 shadow-md transition-colors">📝 메일·제목·본문 전체 복사하기</button>
            <div className="flex items-center">
              <button
                type="button"
                onClick={handleOpenMailShortcut}
                className="px-6 py-2.5 bg-slate-800 text-white font-medium text-xs rounded-l-xl hover:bg-slate-900 shadow-md transition-colors"
              >
                그룹웨어 메일로 바로가기 ↗
              </button>
              <button
                type="button"
                disabled={!canEditMaster}
                title={!canEditMaster ? '편집 권한 필요' : undefined}
                onClick={() => {
                  if (!canEditMaster) return alertNoEditPermission();
                  setMailShortcutEditor(mailShortcutUrl || DEFAULT_MAIL_SHORTCUT_URL);
                }}
                className={`px-3 py-2.5 font-medium text-xs rounded-r-xl shadow-md border-l border-slate-600 ${
                  canEditMaster
                    ? 'bg-slate-700 text-white hover:bg-slate-600'
                    : DISABLED_ACTION_BTN
                }`}
              >
                ⚙ 설정(Edit)
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {mailTemplateEditor && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
        <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
          <div>
            <h3 className="text-base font-medium text-slate-900">명함 메일 양식 설정</h3>
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">
              플레이스홀더: {'{{BATCH_NO}}'}(묶음번호), {'{{APPLICANTS}}'}(신청인 이름·통수),{' '}
              {'{{COUNT}}'}(건수), {'{{PACKS}}'}(통수), {'{{VENDOR_NAME}}'}(업체명),{' '}
              {'{{VENDOR_MANAGER}}'}(담당자)
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1">제목 양식</label>
            <input
              type="text"
              value={mailTemplateEditor.subjectTemplate}
              onChange={(e) =>
                setMailTemplateEditor({
                  ...mailTemplateEditor,
                  subjectTemplate: e.target.value,
                })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1">본문 양식</label>
            <textarea
              rows={12}
              value={mailTemplateEditor.bodyTemplate}
              onChange={(e) =>
                setMailTemplateEditor({
                  ...mailTemplateEditor,
                  bodyTemplate: e.target.value,
                })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-indigo-400 whitespace-pre-wrap"
            />
          </div>
          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                setMailTemplateEditor({
                  subjectTemplate: DEFAULT_BC_MAIL_SUBJECT,
                  bodyTemplate: DEFAULT_BC_MAIL_BODY,
                })
              }
              className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600"
            >
              기본값 불러오기(Edit)
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMailTemplateEditor(null)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveMailTemplates}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white"
              >
                저장
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
              <h2 className="text-lg font-medium text-slate-900 flex items-center gap-2">⚙️ 외주업체 마스터 데이터 관리</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">명함 조판 협력사 정보를 관리합니다. 사용하지 않는 업체는 삭제할 수 있으며, 발주 이력은 그대로 남습니다.</p>
            </div>
            {vendorForm.id && <span className="bg-amber-100 text-amber-800 text-[11px] font-medium px-3 py-1 rounded-lg animate-pulse">✏️ 현재 업체 정보 수정 중</span>}
          </div>

          <div className={`flex flex-wrap gap-2 items-end p-4 rounded-2xl border transition-all ${vendorForm.id ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] font-medium text-slate-500 mb-1 ml-1">업체명</label>
              <input type="text" value={vendorForm.companyName || ''} onChange={e => setVendorForm({...vendorForm, companyName: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-medium outline-none bg-white" placeholder="업체명을 작성하세요" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] font-medium text-slate-500 mb-1 ml-1">담당자명/직급</label>
              <input type="text" value={vendorForm.managerName || ''} onChange={e => setVendorForm({...vendorForm, managerName: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-medium outline-none bg-white" placeholder="ex) 홍길동 팀장 / 담당자" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] font-medium text-slate-500 mb-1 ml-1">이메일</label>
              <input type="email" value={vendorForm.email || ''} onChange={e => setVendorForm({...vendorForm, email: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-medium outline-none bg-white" placeholder="print@..." />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] font-medium text-slate-500 mb-1 ml-1">비고</label>
              <input type="text" value={vendorForm.memo || ''} onChange={e => setVendorForm({...vendorForm, memo: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-medium outline-none bg-white" placeholder="자유 기재" />
            </div>
            <div className="flex gap-1">
              {vendorForm.id ? (
                <>
                  <button onClick={() => setVendorForm(EMPTY_VENDOR_FORM)} className="px-3 py-2 h-[34px] bg-slate-200 text-slate-700 font-medium text-xs rounded-lg hover:bg-slate-300">취소</button>
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
                  }} className="px-4 py-2 h-[34px] bg-amber-500 text-white font-medium text-xs rounded-lg hover:bg-amber-600 shadow-sm">수정 완료</button>
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
                }} className="px-5 py-2 h-[34px] bg-indigo-600 text-white font-medium text-xs rounded-lg hover:bg-indigo-700 shadow-sm">신규 등록</button>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-medium tracking-widest sticky top-0">
                <tr>
                  <th className="p-3 pl-4">업체명</th>
                  <th className="p-3">담당자</th>
                  <th className="p-3">이메일</th>
                  <th className="p-3">비고</th>
                  <th className="p-3 text-center pr-4">제어 기능</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {vendors.map(v => (
                  <tr key={v.id} className={`hover:bg-slate-50 ${vendorForm.id === v.id ? 'bg-amber-50/40' : ''}`}>
                    <td className="p-3 pl-4 font-medium text-slate-900">{v.companyName}</td>
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
                        ✏️ 수정(Edit)
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
                        삭제(Edit)
                      </button>
                    </td>
                  </tr>
                ))}
                {vendors.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">등록된 업체가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button onClick={() => { setIsVendorModalOpen(false); setVendorForm(EMPTY_VENDOR_FORM); }} className="px-6 py-2.5 bg-slate-900 text-white font-medium text-xs rounded-xl hover:bg-black transition-colors">닫기 및 적용</button>
          </div>
        </div>
      </div>
    )}

    {/* 명세표 대조(수기 단가) 모달 */}
    {settlementBatch && (
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-slate-200">
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-base font-medium text-slate-900">명세표 대조</h3>
            <p className="text-xs text-slate-500 mt-1.5 font-semibold">
              {formatBatchNo(settlementBatch.id)} · 외주 명세 단가를 건별로 입력합니다.
            </p>
            <p className="text-[10px] font-medium text-amber-700/90 mt-1.5">
              ※ 명세서 검수에서 따라온 단가와 <strong>다른 숫자</strong>로 저장한 칸만{' '}
              <span className="rounded px-1 bg-amber-100 border border-amber-200">주황</span>
              으로 남습니다. 같은 숫자로 되돌리면 표시되지 않습니다.
              검수가 불일치여도 여기서 확정하면 보관함 이동이 가능합니다.
            </p>
          </div>
          <div className="p-6 overflow-x-auto space-y-3">
            {(() => {
              const items = settlementBatch.items || [];
              const totalQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
              const totalPrice = items.reduce((s, i) => {
                const n = moneyDigitsToNumber(priceDrafts[i.id] || '');
                return s + (n ?? 0);
              }, 0);
              return (
                <div className="flex items-center justify-end gap-4 px-1">
                  <div className="text-right">
                    <p className="text-[10px] font-medium text-slate-400">수량 합계</p>
                    <p className="text-sm font-medium text-slate-800 font-mono">
                      {totalQty.toLocaleString()}통
                    </p>
                  </div>
                  <div className="text-right min-w-[140px]">
                    <p className="text-[10px] font-medium text-slate-400">최종 정산단가(원) 합계</p>
                    <p className="text-base font-medium text-indigo-600 font-mono">
                      ₩{totalPrice.toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })()}
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="h-10 px-2 text-center">관리번호</th>
                  <th className="h-10 px-2 text-left">대상자</th>
                  <th className="h-10 px-2 text-left">직책 / 직급</th>
                  <th className="h-10 px-2 text-center">수량</th>
                  <th className="h-10 px-2 text-right w-[140px]">정산단가(원)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {(settlementBatch.items || []).map((item) => (
                  <tr key={item.id} className="h-12">
                    <td className="px-2 text-center font-mono text-[11px] tabular-nums">{item.postNumber}</td>
                    <td className="px-2 text-left text-[11px]">{item.userName}</td>
                    <td className="px-2 text-left text-[11px] truncate max-w-[200px]" title={item.title}>
                      {item.title || '-'}
                    </td>
                    <td className="px-2 text-center text-[11px] tabular-nums">{item.quantity || 1}통</td>
                    <td className="px-2 text-right">
                      {(() => {
                        const changed = isPriceDraftChanged(item.id);
                        const digits = moneyDigitsOnly(priceDrafts[item.id] || '');
                        return (
                          <input
                            type="text"
                            inputMode="numeric"
                            value={formatMoneyDigits(digits)}
                            title={
                              changed
                                ? '검수 따라온 단가와 다른 값으로 수정됨'
                                : priceBaselines[item.id]
                                  ? '검수에서 따라온 단가와 동일'
                                  : '단가 미입력'
                            }
                            onChange={(e) => {
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [item.id]: moneyDigitsOnly(e.target.value),
                              }));
                            }}
                            className={`w-full rounded-lg px-2 py-1.5 text-right text-[11px] font-mono outline-none transition-colors ${
                              changed
                                ? 'bg-amber-50 border-2 border-amber-400 text-amber-950 focus:border-amber-500 focus:ring-1 focus:ring-amber-200'
                                : 'bg-slate-50 border border-slate-200 text-slate-800 focus:border-indigo-400'
                            }`}
                            placeholder="0"
                          />
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-6 border-t border-slate-100 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[11px] font-semibold text-slate-500">
              {settlementBatch.inspectResult?.settlementLastEdit
                ? `최종 수정 ${settlementBatch.inspectResult.settlementLastEdit.date || '-'} · ${settlementBatch.inspectResult.settlementLastEdit.userName || '-'}`
                : ''}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={savingSettlement}
                onClick={() => {
                  setSettlementBatch(null);
                  setPriceBaselines({});
                  setPriceDrafts({});
                }}
                className="px-4 py-2.5 rounded-xl text-[11px] font-medium text-slate-500 bg-slate-100 hover:bg-slate-200"
              >
                취소
              </button>
              <button
                type="button"
                disabled={savingSettlement || !canEditMaster}
                onClick={handleSaveSettlement}
                title={!canEditMaster ? '편집 권한 필요' : '명세표 대조 저장'}
                className="px-4 py-2.5 rounded-xl text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
              >
                {savingSettlement ? '저장 중…' : '대조 저장(Edit)'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* 외주사 거래명세표 교차 검증 모달 */}
    {isCompareModalOpen && (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-7xl w-full p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-medium text-slate-900 flex items-center gap-2">외주사 거래명세표 교차 검증 결과</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">선택한 <strong className="text-indigo-600">{selectedBatchIds.size}개</strong> 묶음과 업체의 거래명세표(<strong>PDF 우선</strong>, Excel 가능)를 대조합니다.</p>
              <p className="text-[11px] text-indigo-700 font-medium mt-2 leading-relaxed bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
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
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-medium ${
                      canEditMaster
                        ? 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700'
                        : DISABLED_ACTION_BTN
                    }`}
                  >
                    <span>{field.label}</span>
                    <span className={canEditMaster ? 'font-medium text-indigo-600' : 'font-medium text-slate-400'}>
                      {statementColMap[field.key].join(', ')}
                    </span>
                    <span className="text-slate-400">⚙</span>
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => { setIsCompareModalOpen(false); setCompareResult({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] }); setManualDrafts({}); setManualEditRows({}); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-medium transition-colors">✕</button>
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
                <p className="mb-2 text-sm font-medium text-indigo-700">여기를 클릭하여 거래명세표 업로드</p>
                <p className="text-xs text-indigo-400 font-medium leading-relaxed">
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
              <p className="text-sm font-medium text-indigo-800 animate-pulse">{compareResult.fileName} 문서를 해독하고 있습니다...</p>
            </div>
          )}

          {/* 3. 에러 화면 */}
          {compareResult.status === 'error' && (
            <div className="flex flex-col items-center justify-center h-48 space-y-4 bg-rose-50 rounded-2xl border border-rose-200">
              <span className="text-4xl">❌</span>
              <p className="text-sm font-medium text-rose-800">문서 분석에 실패했습니다.</p>
              <div className="text-[10px] text-rose-500 font-mono text-center px-4">{compareResult.logs[compareResult.logs.length - 1]}</div>
              <button
                type="button"
                onClick={handleReuploadClick}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium text-xs rounded-xl shadow-sm"
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
                  <h3 className={`text-lg font-medium flex items-center gap-2 ${compareResult.matched ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {compareResult.matched ? '✅ 이름·소속·수량 모두 일치' : '⚠️ 교차 검증 불일치 항목 감지'}
                  </h3>
                  
                  <div className="mt-2.5 space-y-3">
                    <p className={`text-xs font-medium leading-relaxed ${compareResult.matched ? 'text-emerald-700/80' : 'text-rose-700/80'}`}>
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
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-medium tracking-tight ${nameOk === total ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
                        {nameOk === total ? '✔️' : '❌'} 이름 {nameOk}/{total}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-medium tracking-tight ${deptOk === total ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
                        {deptOk === total ? '✔️' : '❌'} 소속 {deptOk}/{total}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-medium tracking-tight ${qtyOk === total ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
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
                    className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium text-[11px] rounded-xl shadow-sm whitespace-nowrap"
                  >
                    거래명세표 다시 업로드
                  </button>
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-[10px] text-slate-500 font-medium mb-1">문서 공급가액 (행 합산)</p>
                  <p className="text-2xl font-medium text-slate-900 font-mono">₩{compareResult.docTotalPrice.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-1 leading-relaxed">
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
                    <p key={idx} className="text-[11px] font-medium text-amber-800 leading-relaxed">{line}</p>
                  ))}
                  <p className="text-[10px] font-medium text-amber-700/80">칼럼 제목은 거래명세표 제목줄과 같아야 합니다. 이 문서는 이름=품목, 소속=비고 인 경우가 많습니다.</p>
                </div>
              )}

              {/* 상세 매칭 결과 리스트 */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-72 overflow-y-auto shadow-inner">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-600 font-medium sticky top-0 z-10">
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
                      <th className="p-2 pl-4 font-medium whitespace-nowrap min-w-[88px]">이름</th>
                      <th className="p-2 text-center w-12 font-medium">일치</th>
                      <th className="p-2 text-center w-[96px] font-medium border-r-2 border-slate-300">관리자 처리</th>
                      <th className="p-2 font-medium">DB 본부·센터 / 문서 표기</th>
                      <th className="p-2 text-center w-12 font-medium">일치</th>
                      <th className="p-2 text-center w-[110px] font-medium border-r-2 border-slate-300">관리자 처리</th>
                      <th className="p-2 text-center w-[52px] font-medium">DB</th>
                      <th className="p-2 text-center w-[56px] font-medium whitespace-nowrap">문서</th>
                      <th className="p-2 text-center w-[44px] font-medium">일치</th>
                      <th className="p-2 text-center w-[72px] font-medium border-r-2 border-slate-300">관리자 처리</th>
                      <th className="p-2 font-medium border-r-2 border-slate-300 min-w-[220px]">상세</th>
                      <th className="p-2 text-center w-[84px] font-medium">문서 인식</th>
                      <th className="p-2 text-center w-[72px] font-medium border-r-2 border-slate-300">관리자 처리</th>
                      <th className="p-2 text-center w-[132px] font-medium">관리자 점검</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {compareResult.details.map((detail, idx) => (
                      <tr key={detail.id || idx} className={detail.matchStatus === 'match' ? 'bg-white' : 'bg-rose-50/60'}>
                        {(() => {
                          const isManualEditing = !!manualEditRows[detail.id];
                          return (
                            <>
                        <td className={`p-2.5 pl-4 whitespace-nowrap ${detail.adminEditedFields?.includes('name') ? 'text-blue-600' : 'text-slate-800'}`}>{detail.name}</td>
                        <td className={`p-2.5 text-center text-[11px] font-medium ${detail.nameMatch ? 'text-emerald-600' : 'text-rose-500'}`}>{detail.nameMatch ? 'O' : 'X'}</td>
                        <td className="p-2 text-center border-r-2 border-slate-200 min-w-[96px]">
                          {isManualEditing ? (
                            <input value={manualDrafts[detail.id]?.name ?? detail.name} onChange={(e) => setManualDraftValue(detail.id, 'name', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700" />
                          ) : (
                            <span className="text-[10px] font-medium text-slate-300">비활성</span>
                          )}
                        </td>
                        <td className="p-2.5 text-slate-700">
                          <p className="text-[10px] text-slate-400 font-medium">본부 {detail.deptHead || '-'}</p>
                          <p className="text-[10px] text-slate-400 font-medium">센터 {detail.deptName || detail.dept || '-'}</p>
                          {(detail.docQtyParts || []).length > 0 ? (
                            <div className="mt-1 space-y-0.5">
                              {(detail.docQtyParts || []).map((part, pIdx) => (
                                <p key={`${detail.id}-dept-${pIdx}`} className={`text-[10px] font-medium ${detail.adminEditedFields?.includes('dept') ? 'text-blue-600' : 'text-emerald-600'}`}>
                                  문서: {part.dept} {part.qty}통
                                </p>
                              ))}
                            </div>
                          ) : detail.docDept ? (
                            <p className={`text-[10px] font-medium mt-1 ${detail.adminEditedFields?.includes('dept') ? 'text-blue-600' : 'text-emerald-600'}`}>문서: {detail.docDept}</p>
                          ) : null}
                        </td>
                        <td className={`p-2.5 text-center text-[11px] font-medium ${detail.deptMatch ? 'text-emerald-600' : 'text-rose-500'}`}>{detail.deptMatch ? 'O' : 'X'}</td>
                        <td className="p-2 text-center border-r-2 border-slate-200 min-w-[110px]">
                          {isManualEditing ? (
                            <input value={manualDrafts[detail.id]?.dept ?? detail.docDept} onChange={(e) => setManualDraftValue(detail.id, 'dept', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700" />
                          ) : (
                            <span className="text-[10px] font-medium text-slate-300">비활성</span>
                          )}
                        </td>
                        <td className="p-2.5 text-center text-slate-800 font-mono whitespace-nowrap">{detail.dbQty}</td>
                        <td className={`p-2.5 text-center font-mono whitespace-nowrap ${detail.adminEditedFields?.includes('qty') ? 'text-blue-600' : 'text-slate-600'}`}>
                          {detail.docQty || 0}
                          {(detail.docQtyParts || []).length > 1 ? (
                            <p className={`text-[10px] font-medium mt-0.5 whitespace-nowrap ${detail.adminEditedFields?.includes('qty') ? 'text-blue-600' : 'text-emerald-600'}`}>
                              합계 {(detail.docQtyParts || []).map((p) => p.qty).join('+')}
                            </p>
                          ) : null}
                        </td>
                        <td className={`p-2.5 text-center text-[11px] font-medium ${detail.qtyMatch ? 'text-emerald-600' : 'text-rose-500'}`}>{detail.qtyMatch ? 'O' : 'X'}</td>
                        <td className="p-2 text-center border-r-2 border-slate-200 min-w-[72px]">
                          {isManualEditing ? (
                            <input value={manualDrafts[detail.id]?.qty ?? String(detail.docQty || detail.dbQty || '')} onChange={(e) => setManualDraftValue(detail.id, 'qty', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700 text-center" />
                          ) : (
                            <span className="text-[10px] font-medium text-slate-300">비활성</span>
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
                            <input value={manualDrafts[detail.id]?.price ?? String(detail.docPrice || 0)} onChange={(e) => setManualDraftValue(detail.id, 'price', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700 text-right" />
                          ) : (
                            <span className="text-[10px] font-medium text-slate-300">비활성</span>
                          )}
                        </td>
                        <td className="p-2.5 text-center min-w-[132px]">
                          {isManualEditing ? (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => completeManualEditRow(detail.id)}
                                className="w-full rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white"
                              >
                                완료
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelManualEditRow(detail)}
                                className="w-full rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600"
                              >
                                취소
                              </button>
                            </div>
                          ) : detail.matchStatus === 'match' || detail.adminOverride ? (
                            <div className="space-y-1">
                              <span className={`block text-[10px] font-medium ${detail.adminEditedFields?.length ? 'text-blue-600' : 'text-emerald-600'}`}>{detail.adminEditedFields?.length ? '수동 처리 완료' : '점검완료'}</span>
                              <button
                                type="button"
                                disabled={!canEditMaster}
                                title={!canEditMaster ? '편집 권한 필요' : undefined}
                                onClick={() => openManualEditRow(detail)}
                                className={`w-full rounded-lg px-2 py-1 text-[10px] font-medium ${
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
                              className={`px-2 py-1 text-[10px] font-medium rounded-lg ${
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
            <button onClick={() => { setIsCompareModalOpen(false); setCompareResult({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] }); setManualDrafts({}); setManualEditRows({}); }} className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-xl transition-colors">닫기</button>
          </div>
        </div>
      </div>
    )}

    {mailShortcutEditor != null && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <h3 className="text-base font-medium text-slate-900">메일 바로가기 경로 설정</h3>
          <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">
            기본 경로가 이미 들어 있습니다. 전체 URL을 붙여넣어도{' '}
            <span className="text-slate-700">token·currentemail은 저장 시 자동 제거</span>됩니다.
            (token은 세션용, 메일은 열 때 로그인 계정으로 붙입니다.)
          </p>
          <input
            type="text"
            value={mailShortcutEditor}
            onChange={(e) => setMailShortcutEditor(e.target.value)}
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-indigo-400"
            placeholder={DEFAULT_MAIL_SHORTCUT_URL}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setMailShortcutEditor(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600">취소</button>
            <button type="button" onClick={handleSaveMailShortcut} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white">저장</button>
          </div>
        </div>
      </div>
    )}
    {colMapEditor && (() => {
      const meta = STATEMENT_COL_FIELDS.find((f) => f.key === colMapEditor.key);
      return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-medium text-slate-900">{meta?.label} 칼럼 제목 지정</h3>
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">
              문서 제목의 띄어쓰기는 무시합니다. 비 고, 비   고 모두 비고와 같습니다.
              쉼표로 여러 개 가능합니다.
            </p>
            <p className="mt-1 text-[10px] font-medium text-indigo-600">{meta?.hint}</p>
            <textarea
              value={colMapEditor.draft}
              onChange={(e) => setColMapEditor({ ...colMapEditor, draft: e.target.value })}
              rows={3}
              className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-indigo-400"
              placeholder="예: 공급가액"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setColMapEditor(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600">취소</button>
              <button
                type="button"
                disabled={!canEditMaster}
                title={!canEditMaster ? '편집 권한 필요' : undefined}
                onClick={handleSaveColMap}
                className={`rounded-xl px-4 py-2 text-xs font-medium ${
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