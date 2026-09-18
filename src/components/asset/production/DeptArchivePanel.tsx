'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StatementFileRecord } from '@/app/api/asset/production/master/statement-file/route';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonthParts } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState, isSystemLv1User } from '@/lib/permission-utils';
import ProductionRequestDetailModal from '@/components/asset/production/ProductionRequestDetailModal';
import ProductionStatementCompareModal from '@/components/asset/production/ProductionStatementCompareModal';
import {
  getProductionCategoryBadgeClass,
  getProductionCategoryFolderTabClasses,
} from '@/lib/production-category-theme';
import {
  PRODUCTION_STATUS,
  productionStatusLabel,
  productionStatusTextClass,
} from '@/lib/production-status';
import {
  buildJebonOrderExcelRows,
  buildOfficeSuppliesOrderExcelRows,
  buildPrintOrderExcelRows,
  buildSignOrderExcelRows,
} from '@/lib/production-sign-excel';
import {
  getOfficeQuoteLinesFromOptions,
  makeOfficeQuoteLineId,
  normalizeOfficeQuoteLines,
  type OfficeQuoteLine,
} from '@/lib/production-office-statement-match';

const DEPT_SETTLEMENT_MENU_PATH = '/asset/production/dept-master/settlement';
const DEPT_ARCHIVE_MENU_PATH = '/asset/production/dept-master/archive';
const MASTER_MENU_PATH = '/asset/production/master/dashboard';
const DEPT_SETTLEMENT_API_PATH = '/api/asset/production/dept-master/settlement';
const DEPT_ARCHIVE_API_PATH = '/api/asset/production/dept-master/archive';
const MASTER_API_PATH = '/api/asset/production/master/dashboard';
const BATCH_PAGE_SIZE = 10;
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none';

const HISTORY_CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

const CATEGORY_LABEL: Record<string, string> = {
  SIGN: '현판/명판/상패',
  JEBON: '제본',
  PRINT: '기타 제작물',
  OFFICE_SUPPLIES: '사무문구류',
};

type BatchItem = {
  id: string;
  postNumber: string;
  category: string;
  title: string;
  quantity: number;
  status: string;
  userName: string;
  unitId?: string | null;
  deptName: string;
  deptHead?: string;
  createdAt: string;
  finalPrice?: number | null;
  options?: Record<string, unknown>;
};

type ArchiveBatch = {
  id: string;
  status: string;
  totalCount: number;
  totalQuantity: number;
  vendors: string[];
  depts?: string[];
  deptHeads?: string[];
  orderedAt: string | null;
  dispatchedAt?: string | null;
  archivedAt: string | null;
  items: BatchItem[];
  inspectStatus?: 'idle' | 'match' | 'mismatch';
  inspectFileName?: string | null;
  inspectResult?: any;
  inspectedAt?: string | null;
  masterSettledArchived?: boolean;
};

type DeptArchivePanelProps = {
  /** dept: 부서 정산 / dept-archive: 부서 정산완료 보관함 / master: 마스터 대시보드 / master-archive: 마스터 정산완료 아카이브 */
  variant?: 'dept' | 'dept-archive' | 'master' | 'master-archive';
};

function formatQuantityUnit(item: BatchItem) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'OFFICE_SUPPLIES') return '개';
  if (item.category === 'PRINT') {
    const label = (item.options as any)?.printItemMasterInfo?.unitLabel;
    if (label) return String(label);
  }
  return 'EA';
}

function getOfficeQuoteStats(item: BatchItem): {
  lines: OfficeQuoteLine[];
  lineCount: number;
  qtySum: number;
  amountSum: number;
} {
  const lines = getOfficeQuoteLinesFromOptions(
    (item.options || {}) as Record<string, unknown>
  );
  return {
    lines,
    lineCount: lines.length,
    qtySum: lines.reduce((s, l) => s + (l.qty || 0), 0),
    amountSum: lines.reduce((s, l) => s + (l.supplyPrice || 0), 0),
  };
}

/** 묶음 총 수량 표시 — 사무문구는 견적 제품 수량 합 */
function formatBatchQuantityLabel(batch: ArchiveBatch): string {
  const items = batch.items || [];
  if (items.length === 0) return '0 건';
  const allOffice = items.every((i) => i.category === 'OFFICE_SUPPLIES');
  if (allOffice) {
    let qty = 0;
    let lines = 0;
    for (const item of items) {
      const s = getOfficeQuoteStats(item);
      if (s.lineCount > 0) {
        qty += s.qtySum;
        lines += s.lineCount;
      } else {
        qty += Number(item.quantity) || 1;
        lines += 1;
      }
    }
    return `${qty.toLocaleString('ko-KR')}개 · ${lines}품목`;
  }
  return `${items.length} 건`;
}

/** 명세표 검수에서 따라온 기준 단가 (최종 정산단가와 비교용) */
function resolveInspectMatchedPrice(item: BatchItem): number | null {
  const opts = (item.options || {}) as Record<string, unknown>;
  const stored = Number(opts.inspectMatchedPrice);
  if (Number.isFinite(stored) && stored > 0) return Math.trunc(stored);
  const fromResult = Number(
    (opts.inspectResult as { itemPrice?: Record<string, number> } | undefined)?.itemPrice?.[
      item.id
    ]
  );
  if (Number.isFinite(fromResult) && fromResult > 0) return Math.trunc(fromResult);
  return null;
}

type SettlementLastEdit = {
  date: string;
  userName: string;
  deptName: string;
};

/** 명세표 대조 최종 수정 메타 (options.settlementLastEdit) */
function resolveSettlementLastEdit(batch: ArchiveBatch | null): SettlementLastEdit | null {
  if (!batch?.items?.length) return null;
  for (const item of batch.items) {
    const raw = (item.options || {}).settlementLastEdit;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const date = String(rec.date || '').trim();
    const userName = String(rec.userName || '').trim();
    const deptName = String(rec.deptName || '').trim();
    if (!date && !userName) continue;
    return { date, userName, deptName };
  }
  return null;
}

function formatSettlementLastEditLabel(edit: SettlementLastEdit): string {
  // 예: 최종 수정: 2026-09-10 000센터 이름
  return `최종 수정: ${[edit.date, edit.deptName, edit.userName].filter(Boolean).join(' ')}`;
}

/** 명세표 대조에서 단가를 수정·저장한 묶음인지 (수기확정) */
function isBatchHandConfirmed(batch: ArchiveBatch): boolean {
  if (!resolveSettlementLastEdit(batch)) return false;
  const items = batch.items || [];
  return items.some((item) => {
    const final = Number(item.finalPrice);
    if (!Number.isFinite(final) || final <= 0) return false;
    const matched = resolveInspectMatchedPrice(item);
    if (matched == null) return true;
    return Math.trunc(final) !== matched;
  });
}

/** 명세표 대조 저장으로 확정된 묶음 (수기 변경 없이도 대조확정) */
function isBatchCompareConfirmed(batch: ArchiveBatch): boolean {
  return Boolean(resolveSettlementLastEdit(batch));
}

/** 마스터 보관함 이동 가능: 검수 일치 또는 명세표 대조 수기확정/대조확정 */
function canMoveBatchToMasterArchive(batch: ArchiveBatch): boolean {
  if (getBatchInspectStatus(batch) === 'match') return true;
  if (isBatchHandConfirmed(batch)) return true;
  if (isBatchCompareConfirmed(batch)) return true;
  return false;
}

function getBatchFinalAmount(batch: ArchiveBatch): number {
  return (batch.items || []).reduce((sum, item) => {
    const price = Number(item.finalPrice);
    return sum + (Number.isFinite(price) && price > 0 ? Math.trunc(price) : 0);
  }, 0);
}

type PersonLabel = { deptName: string; userName: string };

function resolvePersonFromOptions(
  batch: ArchiveBatch,
  key: 'masterSettledArchivedBy' | 'settlementMovedBy'
): PersonLabel | null {
  for (const item of batch.items || []) {
    const raw = (item.options || {})[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const deptName = String(rec.deptName || '').trim();
    const userName = String(rec.userName || '').trim();
    if (deptName || userName) return { deptName, userName };
  }
  return null;
}

/** 보관함 이관 처리자 */
function getBatchProcessor(batch: ArchiveBatch): PersonLabel | null {
  return resolvePersonFromOptions(batch, 'masterSettledArchivedBy');
}

/** 명세대조(정산) 이동 처리자 → 발주담당자 */
function getBatchOrderManager(batch: ArchiveBatch): PersonLabel | null {
  return resolvePersonFromOptions(batch, 'settlementMovedBy');
}

function renderPersonTwoLine(person: PersonLabel | null) {
  if (!person) {
    return <span className="text-[10px] font-bold text-slate-300">—</span>;
  }
  const title = [person.deptName, person.userName].filter(Boolean).join(' ');
  return (
    <span
      className="inline-flex flex-col items-center gap-0.5 leading-tight"
      title={title}
    >
      <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">
        {person.deptName || '—'}
      </span>
      <span className="text-[10px] font-black text-slate-800 whitespace-nowrap">
        {person.userName || '—'}
      </span>
    </span>
  );
}

function getBatchClosingDateLabel(batch: ArchiveBatch): string {
  const items = batch.items || [];
  let latest = 0;
  for (const item of items) {
    const raw = (item.options || {}).masterSettledArchivedAt;
    if (typeof raw === 'string' && raw.trim()) {
      const t = new Date(raw).getTime();
      if (Number.isFinite(t) && t > latest) latest = t;
    }
  }
  if (latest > 0) return getKSTDateString(new Date(latest).toISOString());
  if (batch.archivedAt) return getKSTDateString(batch.archivedAt);
  return '-';
}

type OrgUnitItem = {
  id: string;
  unit_name: string;
  unit_name_en?: string;
  unit_type?: string;
  parent_id: string | null;
  sort_order?: number;
};

function isBoldOrgType(unitType?: string | null) {
  const t = String(unitType || '').trim().toUpperCase();
  return t === 'ORGANIZATION' || t === 'HQ';
}

function flattenUnitsInSortOrder(units: OrgUnitItem[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depthOf = (unit: OrgUnitItem) => {
    let depth = 0;
    let current: OrgUnitItem | undefined = unit;
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

function descendantOrgIds(unitId: string, units: OrgUnitItem[]) {
  const ids = new Set<string>();
  if (!unitId || unitId === 'ALL') return ids;
  const selected = units.find((u) => u.id === unitId);
  if (selected?.id) ids.add(selected.id);
  const walk = (parentId: string) => {
    for (const child of units.filter((u) => u.parent_id === parentId)) {
      ids.add(child.id);
      walk(child.id);
    }
  };
  walk(unitId);
  return ids;
}

function descendantOrgNames(unitId: string, units: OrgUnitItem[]) {
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

function itemMatchesOrg(
  item: { unitId?: string | null; deptHead?: string | null; deptName?: string | null },
  orgId: string,
  units: OrgUnitItem[]
) {
  if (orgId === 'ALL') return true;
  const unitId = String(item.unitId || '').trim();
  if (unitId) {
    return descendantOrgIds(orgId, units).has(unitId);
  }
  // 레거시(unitId 없음): 신청 시점 명칭 폴백
  const names = descendantOrgNames(orgId, units);
  const head = String(item.deptHead || '').trim();
  const center = String(item.deptName || '').trim();
  return names.has(head) || names.has(center);
}

function batchMatchesOrg(batch: ArchiveBatch, orgId: string, units: OrgUnitItem[]) {
  if (orgId === 'ALL') return true;
  if ((batch.items || []).some((item) => itemMatchesOrg(item, orgId, units))) return true;
  const names = descendantOrgNames(orgId, units);
  if ((batch.depts || []).some((d) => names.has(String(d || '').trim()))) return true;
  if ((batch.deptHeads || []).some((d) => names.has(String(d || '').trim()))) return true;
  return false;
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

function formatBatchNo(id: string) {
  return String(id || '').replace(/^BATCH-/, '');
}

function getBatchLabelKind(
  batch: ArchiveBatch,
  activeCategory: string
): 'sign' | 'jebon' | 'print' | 'office' | 'other' {
  if (activeCategory === 'SIGN') return 'sign';
  if (activeCategory === 'JEBON') return 'jebon';
  if (activeCategory === 'PRINT') return 'print';
  if (activeCategory === 'OFFICE_SUPPLIES') return 'office';
  const items = batch.items || [];
  if (items.length > 0 && items.every((i) => i.category === 'SIGN')) return 'sign';
  if (items.length > 0 && items.every((i) => i.category === 'JEBON')) return 'jebon';
  if (items.length > 0 && items.every((i) => i.category === 'PRINT')) return 'print';
  if (items.length > 0 && items.every((i) => i.category === 'OFFICE_SUPPLIES')) return 'office';
  return 'other';
}

function formatBatchDisplayName(batchId: string, kind: ReturnType<typeof getBatchLabelKind>) {
  const no = formatBatchNo(batchId);
  if (kind === 'sign') return `현판_${no}`;
  if (kind === 'jebon') return `제본_${no}`;
  if (kind === 'print') return `제작물_${no}`;
  if (kind === 'office') return `사무문구류_${no}`;
  return no;
}

function formatBatchExcelBaseName(
  batchId: string,
  opts?: { sign?: boolean; jebon?: boolean; print?: boolean; office?: boolean }
) {
  const no = formatBatchNo(batchId);
  if (opts?.sign) return `현판_발주서_${no}`;
  if (opts?.jebon) return `제본_발주서_${no}`;
  if (opts?.print) return `제작물_${no}`;
  if (opts?.office) return `사무문구류_${no}`;
  return `제작물_${no}`;
}

function batchLabelOpts(kind: 'sign' | 'jebon' | 'print' | 'office' | 'other') {
  if (kind === 'sign') return { sign: true as const };
  if (kind === 'jebon') return { jebon: true as const };
  if (kind === 'print') return { print: true as const };
  if (kind === 'office') return { office: true as const };
  return {};
}

function getBatchInspectStatus(batch: ArchiveBatch): 'idle' | 'match' | 'mismatch' {
  if (batch.inspectStatus === 'match' || batch.inspectStatus === 'mismatch') {
    return batch.inspectStatus;
  }
  const items = batch.items || [];
  if (items.length === 0) return 'idle';
  const statuses = items.map((item) => {
    const opts = (item.options || {}) as Record<string, unknown>;
    return (opts.inspectStatus as string) || 'idle';
  });
  if (statuses.every((s) => s === 'idle')) return 'idle';
  if (statuses.every((s) => s === 'match')) return 'match';
  if (statuses.some((s) => s === 'mismatch')) return 'mismatch';
  if (statuses.some((s) => s === 'match')) return 'mismatch';
  return 'idle';
}

/** 명세서 검수 건수 (일치/불일치) */
function getBatchInspectCounts(batch: ArchiveBatch): { matchCount: number; mismatchCount: number } {
  const result = batch.inspectResult || {};
  if (
    typeof result.matchCount === 'number' ||
    typeof result.mismatchCount === 'number'
  ) {
    return {
      matchCount: Number(result.matchCount) || 0,
      mismatchCount: Number(result.mismatchCount) || 0,
    };
  }

  const itemStatus = result.itemStatus as Record<string, string> | undefined;
  if (itemStatus && typeof itemStatus === 'object') {
    let matchCount = 0;
    let mismatchCount = 0;
    for (const s of Object.values(itemStatus)) {
      if (s === 'match') matchCount += 1;
      else if (s === 'mismatch') mismatchCount += 1;
    }
    return { matchCount, mismatchCount };
  }

  let matchCount = 0;
  let mismatchCount = 0;
  for (const item of batch.items || []) {
    const opts = (item.options || {}) as Record<string, unknown>;
    const s = String(opts.inspectStatus || 'idle');
    if (s === 'match') matchCount += 1;
    else if (s === 'mismatch') mismatchCount += 1;
  }
  return { matchCount, mismatchCount };
}

function isBatchMasterSettledArchived(batch: ArchiveBatch): boolean {
  if (batch.masterSettledArchived === true) return true;
  const items = batch.items || [];
  return (
    items.length > 0 &&
    items.every((i) => (i.options || {}).masterSettledArchived === true)
  );
}

export default function DeptArchivePanel({ variant = 'dept' }: DeptArchivePanelProps) {
  const isMasterDashboard = variant === 'master';
  const isMasterArchive = variant === 'master-archive';
  const isDeptArchive = variant === 'dept-archive';
  const isSettledArchiveView = isMasterArchive || isDeptArchive;
  /** 부서 정산완료 보관함은 조회 전용 — 선택 체크박스 불필요 */
  const showBatchSelect = !isDeptArchive;
  /** 대조완료/정산완료 보관함 공통 대장 표 (조직 솔트는 마스터만) */
  const useArchiveLedgerTable = isSettledArchiveView;
  const isDeptSettlement = variant === 'dept';
  /** 정산·마스터 대시보드 공통: 2단 그룹헤더 + 명세표 대조 + 세로줄 */
  const showGroupedSettlementTable = isDeptSettlement || isMasterDashboard;
  /** 마스터 대시보드·부서 정산: 명세표 대조 상태 칼럼 (대조완료 보관함은 제외) */
  const showStatementCompareColumn = showGroupedSettlementTable;
  const isMaster = isMasterDashboard || isMasterArchive;
  const menuPath = isMasterArchive
    ? '/asset/production/master/archive'
    : isMasterDashboard
      ? MASTER_MENU_PATH
      : isDeptArchive
        ? DEPT_ARCHIVE_MENU_PATH
        : DEPT_SETTLEMENT_MENU_PATH;
  const apiPath = isMaster
    ? MASTER_API_PATH
    : isDeptArchive
      ? DEPT_ARCHIVE_API_PATH
      : DEPT_SETTLEMENT_API_PATH;
  const apiListUrl = isMasterArchive
    ? `${MASTER_API_PATH}?view=settled-archive`
    : apiPath;

  const router = useRouter();
  const [batches, setBatches] = useState<ArchiveBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [activeCategory, setActiveCategory] = useState('SIGN');
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  // 부서·마스터 대시보드: 접속월 / 정산완료 보관함·아카이브: 월 전체
  const [selectedMonth, setSelectedMonth] = useState(() =>
    isSettledArchiveView
      ? 'ALL'
      : String(getKSTNowYearMonth().month).padStart(2, '0')
  );
  const [selectedOrg, setSelectedOrg] = useState('ALL');
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [units, setUnits] = useState<OrgUnitItem[]>([]);
  const orgMenuRef = useRef<HTMLDivElement | null>(null);
  const [selectedVendor, setSelectedVendor] = useState('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [searchTitleQuery, setSearchTitleQuery] = useState('');
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [detailItem, setDetailItem] = useState<BatchItem | null>(null);
  const [officeEditRequestId, setOfficeEditRequestId] = useState<string | null>(null);
  const [officeEditDrafts, setOfficeEditDrafts] = useState<OfficeQuoteLine[]>([]);
  const [officeEditSaving, setOfficeEditSaving] = useState(false);
  const [statementBatch, setStatementBatch] = useState<ArchiveBatch | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  /** 모달 오픈 시 따라온 단가(검수 확정값) — 수정 여부 하이라이트용 */
  const [priceBaselines, setPriceBaselines] = useState<Record<string, string>>({});
  const [savingStatement, setSavingStatement] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const selectedBatchesForCompare = useMemo(
    () => batches.filter((b) => selectedBatchIds.has(b.id)),
    [batches, selectedBatchIds]
  );

  const openCompareModal = () => {
    if (isDeptSettlement && !statementPublished) {
      return alert('마스터가 명세표를 게시한 뒤에 명세서 검수를 사용할 수 있습니다.');
    }
    if (selectedBatchIds.size === 0) {
      return alert('비교할 발주 묶음을 먼저 체크박스로 선택해 주세요.');
    }
    setIsCompareModalOpen(true);
  };

  const handlePurgeSelectedArchivedBatches = async () => {
    if (!isMasterArchive) return;
    if (!canPurgeLv1) {
      return alert('영구삭제는 LV_1만 가능합니다.');
    }
    const ids = Array.from(selectedBatchIds);
    if (ids.length === 0) {
      return alert('삭제할 묶음을 체크박스로 선택해 주세요.');
    }
    if (
      !confirm(
        `선택한 ${ids.length}묶음을 정산완료 아카이브에서 영구삭제할까요?\n복구할 수 없습니다. (테스트 데이터 정리용)`
      )
    ) {
      return;
    }
    if (
      !confirm(
        `정말 영구삭제할까요?\n묶음 ${ids.length}개에 속한 신청 건이 DB에서 삭제됩니다.`
      )
    ) {
      return;
    }
    setPurgingBatches(true);
    try {
      const res = await fetch(MASTER_API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'purge-archived-batches',
          batchIds: ids,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '영구삭제에 실패했습니다.');
        return;
      }
      alert(data.message || '영구삭제되었습니다.');
      setSelectedBatchIds(new Set());
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setPurgingBatches(false);
    }
  };

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  /** 정산완료 아카이브 영구삭제 — 시스템 LV_1만 (메뉴 Master 제외) */
  const canPurgeLv1 = useMemo(() => isSystemLv1User(currentUser), [currentUser]);
  const [purgingBatches, setPurgingBatches] = useState(false);

  // 이달의 외주 명세표 카테고리/외주업체별 파일 목록 상태
  const [statementFiles, setStatementFiles] = useState<StatementFileRecord[]>([]);
  const [vendorList, setVendorList] = useState<
    Array<{ id: string; label: string; priorityCategory: string }>
  >([]);

  // 명세표 업로드 모달 상태
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string>('SIGN');
  const [uploadVendorName, setUploadVendorName] = useState<string>('');
  const [uploadCustomVendor, setUploadCustomVendor] = useState<string>('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [statementUploading, setStatementUploading] = useState(false);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  /** 확인 완료 요청일·부서관리자 전달사항 (코너별) */
  type ConfirmRequestInfo = {
    category: string;
    requestedAt: string;
    memo: string;
    updatedAt: string;
    updatedBy: string;
  };
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequestInfo | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmRequestedAt, setConfirmRequestedAt] = useState('');
  const [confirmMemo, setConfirmMemo] = useState('');
  const [confirmSaving, setConfirmSaving] = useState(false);

  /** 코너별 명세표 부서 게시 여부 (false=숨김) */
  const [statementPublished, setStatementPublished] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);

  /** 부서 정산: 게시된 코너만 명세표 노출·검수/대조 활성 */
  const settlementActionsEnabled = isMasterDashboard || statementPublished;

  const fetchStatementFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/asset/production/master/statement-file', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setStatementFiles(Array.isArray(data.files) ? data.files : []);
      }
    } catch {
      setStatementFiles([]);
    }
  }, []);

  const fetchConfirmRequest = useCallback(async (category: string) => {
    try {
      const res = await fetch(
        `/api/asset/production/master/confirm-request?category=${encodeURIComponent(category)}&t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        setConfirmRequest(null);
        return;
      }
      const data = await res.json();
      setConfirmRequest(data.item || null);
    } catch {
      setConfirmRequest(null);
    }
  }, []);

  const fetchStatementPublish = useCallback(async (category: string) => {
    try {
      const res = await fetch(
        `/api/asset/production/master/statement-publish?category=${encodeURIComponent(category)}&t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        setStatementPublished(false);
        return;
      }
      const data = await res.json();
      setStatementPublished(data.published === true);
    } catch {
      setStatementPublished(false);
    }
  }, []);

  const handleSetStatementPublish = async (published: boolean) => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    if (published === statementPublished) return;
    const label = CATEGORY_LABEL[activeCategory] || activeCategory;
    if (
      !confirm(
        published
          ? `[${label}] 코너 명세표를 부서 정산 화면에 게시할까요?\n게시 후 부서에서 명세표 조회·검수·대조가 가능합니다.`
          : `[${label}] 코너 명세표를 부서 정산 화면에서 숨길까요?\n숨기면 부서에서 명세표·검수·대조가 비활성됩니다.`
      )
    ) {
      return;
    }
    setPublishBusy(true);
    try {
      const res = await fetch('/api/asset/production/master/statement-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: activeCategory, published }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '게시 상태 변경에 실패했습니다.');
        return;
      }
      setStatementPublished(published);
      alert(data.message || (published ? '게시했습니다.' : '숨겼습니다.'));
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setPublishBusy(false);
    }
  };

  const fetchVendors = useCallback(async () => {
    try {
      const res = await fetch('/api/asset/production/master/vendors', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setVendorList(Array.isArray(data) ? data : []);
      }
    } catch {
      setVendorList([]);
    }
  }, []);

  const toDatetimeLocalValue = (isoOrLocal?: string | null) => {
    if (isoOrLocal && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(isoOrLocal)) {
      return isoOrLocal.slice(0, 16);
    }
    try {
      const parts = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
      return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
    } catch {
      const now = getKSTNowYearMonth();
      return `${now.year}-${String(now.month).padStart(2, '0')}-01T09:00`;
    }
  };

  const formatConfirmRequestLabel = (requestedAt: string) => {
    if (!requestedAt) return '—';
    const [datePart, timePart] = requestedAt.split('T');
    if (!datePart) return requestedAt;
    const base = timePart ? `${datePart} ${timePart.slice(0, 5)}` : datePart;
    return `${base}까지`;
  };

  const handleOpenConfirmModal = () => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    setConfirmRequestedAt(toDatetimeLocalValue(confirmRequest?.requestedAt));
    setConfirmMemo(confirmRequest?.memo || '');
    setIsConfirmModalOpen(true);
  };

  const handleSaveConfirmRequest = async () => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    if (!confirmRequestedAt.trim()) return alert('확인 완료 기한(날짜·시간)을 선택해 주세요.');
    setConfirmSaving(true);
    try {
      const res = await fetch('/api/asset/production/master/confirm-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: activeCategory,
          requestedAt: confirmRequestedAt.trim().slice(0, 16),
          memo: confirmMemo.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '확인 완료 요청 등록에 실패했습니다.');
        return;
      }
      setConfirmRequest(data.item || null);
      setIsConfirmModalOpen(false);
      alert(data.message || '확인 완료 기한이 등록되었습니다.');
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setConfirmSaving(false);
    }
  };

  const handleClearConfirmRequest = async () => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    if (!confirmRequest) return;
    if (!confirm('이 코너의 확인 완료 기한을 삭제할까요?')) return;
    setConfirmSaving(true);
    try {
      const res = await fetch(
        `/api/asset/production/master/confirm-request?category=${encodeURIComponent(activeCategory)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '삭제에 실패했습니다.');
        return;
      }
      setConfirmRequest(null);
      setIsConfirmModalOpen(false);
      alert(data.message || '삭제되었습니다.');
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setConfirmSaving(false);
    }
  };

  // 현재 활성 카테고리에 해당하는 명세표 목록 (하단 탭 클릭 시 자동 연동)
  const currentCategoryStatementFiles = useMemo(() => {
    return statementFiles.filter((f) => f.category === activeCategory);
  }, [statementFiles, activeCategory]);

  const handleOpenUploadModal = () => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    setUploadCategory(activeCategory);
    setUploadVendorName('');
    setUploadCustomVendor('');
    setUploadFile(null);
    setIsUploadModalOpen(true);
  };

  const handleUploadStatementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    if (!uploadFile) return alert('업로드할 명세표 파일(PDF 또는 Excel)을 선택해 주세요.');

    const finalVendor = (
      uploadVendorName === '__CUSTOM__' ? uploadCustomVendor : uploadVendorName
    ).trim();
    if (!finalVendor) return alert('외주업체명을 선택하거나 직접 입력해 주세요.');

    setStatementUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('category', uploadCategory);
      formData.append('vendorName', finalVendor);

      const res = await fetch('/api/asset/production/master/statement-file', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '업로드 실패');

      alert(data.message || '외주 거래명세표가 성공적으로 등록되었습니다.');
      setIsUploadModalOpen(false);
      await fetchStatementFiles();
    } catch (err: any) {
      alert(`업로드 중 오류: ${err.message}`);
    } finally {
      setStatementUploading(false);
    }
  };

  const handleDeleteStatement = async (fileId: string, vendorName: string) => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    if (
      !confirm(
        `[${vendorName}] 거래명세표 파일을 삭제하시겠습니까?\n삭제 시 부서 화면에서도 해당 외주사의 명세표가 노출되지 않습니다.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/asset/production/master/statement-file?id=${fileId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('파일 삭제 실패');
      alert('해당 외주 거래명세표가 삭제되었습니다.');
      await fetchStatementFiles();
    } catch (err: any) {
      alert(`파일 삭제 중 오류: ${err.message}`);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [archiveRes, meRes, ifaceRes, unitsRes] = await Promise.all([
        fetch(`${apiListUrl}${apiListUrl.includes('?') ? '&' : '?'}t=${ts}`, {
          cache: 'no-store',
        }),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        isMaster
          ? fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const data = await archiveRes.json().catch(() => ({}));
      if (!archiveRes.ok) {
        alert(data.error || data.message || '보관함 내역을 불러오지 못했습니다.');
        setBatches([]);
      } else {
        setBatches(Array.isArray(data.batches) ? data.batches : []);
      }
      if (meRes?.ok) setCurrentUser(await meRes.json());
      if (ifaceRes?.ok) {
        const menus = await ifaceRes.json();
        const row = Array.isArray(menus)
          ? menus.find((m: any) => m.path === menuPath)
          : null;
        setInterfaceConfig(row || null);
      }
      if (unitsRes?.ok) {
        const list = await unitsRes.json();
        setUnits(Array.isArray(list) ? list : []);
      }
    } catch {
      alert('서버와 통신할 수 없습니다.');
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, [apiListUrl, menuPath, isMaster]);

  useEffect(() => {
    fetchData();
    if (!isSettledArchiveView) {
      fetchStatementFiles();
      fetchVendors();
    }
  }, [fetchData, fetchStatementFiles, fetchVendors, isSettledArchiveView]);

  useEffect(() => {
    if (isSettledArchiveView) return;
    fetchConfirmRequest(activeCategory);
    fetchStatementPublish(activeCategory);
  }, [activeCategory, fetchConfirmRequest, fetchStatementPublish, isSettledArchiveView]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedBatchIds(new Set());
  }, [
    activeCategory,
    selectedYear,
    selectedMonth,
    selectedOrg,
    selectedVendor,
    searchUserQuery,
    searchTitleQuery,
  ]);

  const orgOptions = useMemo(() => flattenUnitsInSortOrder(units), [units]);
  const organizationUnit = useMemo(
    () =>
      orgOptions.find((u) => String(u.unit_type || '').trim().toUpperCase() === 'ORGANIZATION') ||
      null,
    [orgOptions]
  );
  const selectedOrgUnit =
    orgOptions.find((u) => u.id === selectedOrg) ||
    (selectedOrg === 'ALL' ? organizationUnit : null) ||
    null;

  useEffect(() => {
    if (!isMaster || selectedOrg !== 'ALL' || !organizationUnit) return;
    setSelectedOrg(organizationUnit.id);
  }, [isMaster, selectedOrg, organizationUnit]);

  useEffect(() => {
    if (!orgMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) {
        setOrgMenuOpen(false);
      }
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
    const years = batches
      .map((b) => getKSTYearMonthParts(b.dispatchedAt || b.archivedAt || b.orderedAt)?.year)
      .filter((y): y is string => Boolean(y));
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const kstYear = String(getKSTNowYearMonth().year);
    if (!unique.includes(kstYear)) unique.unshift(kstYear);
    return unique;
  }, [batches]);

  const availableMonths = useMemo(() => {
    if (selectedYear === 'ALL') return [];
    const months = batches
      .filter(
        (b) =>
          getKSTYearMonthParts(b.dispatchedAt || b.archivedAt || b.orderedAt)?.year ===
          selectedYear
      )
      .map((b) => getKSTYearMonthParts(b.dispatchedAt || b.archivedAt || b.orderedAt)?.month)
      .filter((m): m is string => Boolean(m));
    const unique = Array.from(new Set(months));
    const now = getKSTNowYearMonth();
    const nowMonth = String(now.month).padStart(2, '0');
    // 선택 중인 월·접속월이 데이터에 없어도 셀렉트에 표시
    if (selectedMonth !== 'ALL') unique.push(selectedMonth);
    if (selectedYear === String(now.year)) unique.push(nowMonth);
    return Array.from(new Set(unique)).sort((a, b) => a.localeCompare(b));
  }, [batches, selectedYear, selectedMonth]);

  const availableVendors = useMemo(() => {
    const names = new Set<string>();
    for (const b of batches) {
      (b.vendors || []).forEach((v) => {
        if (v) names.add(v);
      });
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [batches]);

  const filteredBatches = useMemo(() => {
    const qUser = searchUserQuery.trim().toLowerCase();
    const qTitle = searchTitleQuery.trim().toLowerCase();
    return batches.filter((batch) => {
      const items = batch.items || [];
      if (activeCategory !== 'ALL' && !items.some((i) => i.category === activeCategory)) {
        return false;
      }
      if (isMaster && !batchMatchesOrg(batch, selectedOrg, units)) return false;
      if (selectedVendor !== 'ALL') {
        if (!(batch.vendors || []).includes(selectedVendor)) return false;
      }
      const ym = getKSTYearMonthParts(batch.dispatchedAt || batch.archivedAt || batch.orderedAt);
      if (selectedYear !== 'ALL' && ym?.year !== selectedYear) return false;
      if (selectedMonth !== 'ALL' && ym?.month !== selectedMonth) return false;
      const matchUser =
        !qUser || items.some((i) => String(i.userName || '').toLowerCase().includes(qUser));
      const matchTitle =
        !qTitle || items.some((i) => String(i.title || '').toLowerCase().includes(qTitle));
      return matchUser && matchTitle;
    });
  }, [
    batches,
    activeCategory,
    selectedYear,
    selectedMonth,
    selectedOrg,
    selectedVendor,
    searchUserQuery,
    searchTitleQuery,
    isMaster,
    units,
  ]);

  /** 분류 탭 배지 — 연/월·조직·검색 반영, 해당 분류 건이 있는 묶음 수 (부서 order/검수와 동일 표기) */
  const categoryTabCounts = useMemo(() => {
    const qUser = searchUserQuery.trim().toLowerCase();
    const qTitle = searchTitleQuery.trim().toLowerCase();
    const counts: Record<string, number> = {
      SIGN: 0,
      JEBON: 0,
      PRINT: 0,
      OFFICE_SUPPLIES: 0,
    };
    for (const catId of Object.keys(counts)) {
      for (const batch of batches) {
        const items = (batch.items || []).filter((i) => i.category === catId);
        if (items.length === 0) continue;
        if (isMaster && !batchMatchesOrg(batch, selectedOrg, units)) continue;
        if (selectedVendor !== 'ALL' && !(batch.vendors || []).includes(selectedVendor)) {
          continue;
        }
        const ym = getKSTYearMonthParts(
          batch.dispatchedAt || batch.archivedAt || batch.orderedAt
        );
        if (selectedYear !== 'ALL' && ym?.year !== selectedYear) continue;
        if (selectedMonth !== 'ALL' && ym?.month !== selectedMonth) continue;
        if (
          qUser &&
          !items.some((i) => String(i.userName || '').toLowerCase().includes(qUser))
        ) {
          continue;
        }
        if (
          qTitle &&
          !items.some((i) => String(i.title || '').toLowerCase().includes(qTitle))
        ) {
          continue;
        }
        counts[catId] += 1;
      }
    }
    return counts;
  }, [
    batches,
    selectedYear,
    selectedMonth,
    selectedOrg,
    selectedVendor,
    searchUserQuery,
    searchTitleQuery,
    isMaster,
    units,
  ]);

  /** 마스터 아카이브 상단 통계 — 연/월·조직·검색 반영, 분류별 정산단가 합계 */
  const archiveCategoryAmountStats = useMemo(() => {
    const qUser = searchUserQuery.trim().toLowerCase();
    const qTitle = searchTitleQuery.trim().toLowerCase();
    const totals: Record<string, { amount: number; count: number; quantity: number }> = {
      SIGN: { amount: 0, count: 0, quantity: 0 },
      JEBON: { amount: 0, count: 0, quantity: 0 },
      PRINT: { amount: 0, count: 0, quantity: 0 },
      OFFICE_SUPPLIES: { amount: 0, count: 0, quantity: 0 },
    };
    for (const batch of batches) {
      const ym = getKSTYearMonthParts(
        batch.dispatchedAt || batch.archivedAt || batch.orderedAt
      );
      if (selectedYear !== 'ALL' && ym?.year !== selectedYear) continue;
      if (selectedMonth !== 'ALL' && ym?.month !== selectedMonth) continue;
      for (const item of batch.items || []) {
        if (!totals[item.category]) continue;
        if (isMaster && !itemMatchesOrg(item, selectedOrg, units)) continue;
        if (qUser && !String(item.userName || '').toLowerCase().includes(qUser)) continue;
        if (qTitle && !String(item.title || '').toLowerCase().includes(qTitle)) continue;
        const price = Number(item.finalPrice);
        totals[item.category].amount += Number.isFinite(price) && price > 0 ? price : 0;
        totals[item.category].count += 1;
        totals[item.category].quantity += Number(item.quantity) || 0;
      }
    }
    return totals;
  }, [
    batches,
    selectedYear,
    selectedMonth,
    selectedOrg,
    searchUserQuery,
    searchTitleQuery,
    isMaster,
    units,
  ]);

  const archiveStatsGrandTotal = useMemo(
    () =>
      Object.values(archiveCategoryAmountStats).reduce((s, row) => s + row.amount, 0),
    [archiveCategoryAmountStats]
  );

  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / BATCH_PAGE_SIZE));
  const pageBatches = useMemo(() => {
    const start = (currentPage - 1) * BATCH_PAGE_SIZE;
    return filteredBatches.slice(start, start + BATCH_PAGE_SIZE);
  }, [filteredBatches, currentPage]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  /** 대상자·제목 검색 시 매칭 묶음 하위 상세(아코디언) 자동 펼침 */
  useEffect(() => {
    const qUser = searchUserQuery.trim();
    const qTitle = searchTitleQuery.trim();
    if (!qUser && !qTitle) {
      setExpandedBatchIds(new Set());
      return;
    }
    const start = (currentPage - 1) * BATCH_PAGE_SIZE;
    const pageIds = filteredBatches
      .slice(start, start + BATCH_PAGE_SIZE)
      .map((b) => b.id);
    setExpandedBatchIds(new Set(pageIds));
  }, [searchUserQuery, searchTitleQuery, currentPage, filteredBatches]);

  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };
  const allPageBatchesSelected =
    pageBatches.length > 0 && pageBatches.every((b) => selectedBatchIds.has(b.id));

  const handleSelectAllBatches = () => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (allPageBatchesSelected) {
        pageBatches.forEach((b) => next.delete(b.id));
      } else {
        pageBatches.forEach((b) => next.add(b.id));
      }
      return next;
    });
  };

  const handleSelectBatchRow = (batchId: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const handleBatchExcel = (batch: ArchiveBatch) => {
    const exportItems =
      activeCategory === 'ALL'
        ? batch.items
        : batch.items.filter((i) => i.category === activeCategory);

    if (exportItems.length === 0) {
      return alert('다운로드할 데이터가 없습니다.');
    }

    const allSign = exportItems.every((i) => i.category === 'SIGN');
    const allJebon = exportItems.every((i) => i.category === 'JEBON');
    const labelKind = getBatchLabelKind(batch, activeCategory);
    if (allSign || activeCategory === 'SIGN') {
      const signRows = buildSignOrderExcelRows(
        exportItems.map((r) => ({
          ...r,
          batchId: batch.id,
        }))
      );
      if (signRows.length === 0) {
        return alert('다운로드할 현판(SIGN) 데이터가 없습니다.');
      }
      const ws = XLSX.utils.json_to_sheet(signRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '현판상세');
      XLSX.writeFile(wb, `${formatBatchExcelBaseName(batch.id, { sign: true })}.xlsx`);
      return;
    }

    if (allJebon || activeCategory === 'JEBON') {
      const jebonRows = buildJebonOrderExcelRows(
        exportItems.map((r) => ({ ...r, batchId: batch.id }))
      );
      if (jebonRows.length === 0) {
        return alert('다운로드할 제본(JEBON) 데이터가 없습니다.');
      }
      const ws = XLSX.utils.json_to_sheet(jebonRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '제본발주');
      XLSX.writeFile(wb, `${formatBatchExcelBaseName(batch.id, { jebon: true })}.xlsx`);
      return;
    }

    const allPrint = exportItems.every((i) => i.category === 'PRINT');
    if (allPrint || activeCategory === 'PRINT') {
      const printRows = buildPrintOrderExcelRows(
        exportItems.map((r) => ({ ...r, batchId: batch.id }))
      );
      if (printRows.length === 0) {
        return alert('다운로드할 기타 제작물(PRINT) 데이터가 없습니다.');
      }
      const ws = XLSX.utils.json_to_sheet(printRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '기타제작발주');
      XLSX.writeFile(wb, `${formatBatchExcelBaseName(batch.id, { print: true })}.xlsx`);
      return;
    }

    const allOffice = exportItems.every((i) => i.category === 'OFFICE_SUPPLIES');
    if (allOffice || activeCategory === 'OFFICE_SUPPLIES') {
      const officeRows = buildOfficeSuppliesOrderExcelRows(
        exportItems.map((r) => ({ ...r, batchId: batch.id }))
      );
      if (officeRows.length === 0) {
        return alert('다운로드할 사무문구류 데이터가 없습니다.');
      }
      const ws = XLSX.utils.json_to_sheet(officeRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '사무문구발주');
      XLSX.writeFile(wb, `${formatBatchExcelBaseName(batch.id, { office: true })}.xlsx`);
      return;
    }

    const rows = exportItems.map((r, rowIdx) => ({
      NO: rowIdx + 1,
      관리번호: r.postNumber,
      신청일: getKSTDateString(r.createdAt),
      본부: r.deptHead || '',
      소속부서: r.deptName,
      신청자: r.userName,
      분류: CATEGORY_LABEL[r.category] || r.category,
      관리용제목: r.title,
      수량: `${r.quantity}${formatQuantityUnit(r)}`,
      외주업체: (r.options as any)?.vendor || '',
      상태: productionStatusLabel(r.status, r.options as Record<string, unknown> | null),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '제작발주');
    XLSX.writeFile(
      wb,
      `${formatBatchExcelBaseName(batch.id, batchLabelOpts(labelKind))}.xlsx`
    );
  };

  const beginOfficeForceEdit = (item: BatchItem) => {
    if (!isMasterDashboard) return;
    if (!canEdit) return alert('편집 권한(Edit)이 필요합니다.');
    if ((item.options || {}).masterSettledArchived === true) {
      return alert('정산완료 보관함으로 이동된 건은 수정할 수 없습니다.');
    }
    const lines = getOfficeQuoteLinesFromOptions(
      (item.options || {}) as Record<string, unknown>
    );
    setOfficeEditRequestId(item.id);
    setOfficeEditDrafts(
      lines.length > 0
        ? lines.map((l) => ({ ...l }))
        : [
            {
              lineNo: 1,
              code: '',
              productName: '',
              unitPrice: 0,
              qty: 1,
              supplyPrice: 0,
            },
          ]
    );
  };

  const cancelOfficeForceEdit = () => {
    setOfficeEditRequestId(null);
    setOfficeEditDrafts([]);
    setOfficeEditSaving(false);
  };

  const saveOfficeForceEdit = async (item: BatchItem) => {
    if (!isMasterDashboard) return;
    if (!canEdit) return alert('편집 권한(Edit)이 필요합니다.');
    const lines = normalizeOfficeQuoteLines(officeEditDrafts);
    if (lines.length === 0) {
      return alert('제품명이 있는 항목이 최소 1개 필요합니다.');
    }
    if (!confirm(`견적 리스트 ${lines.length}품목을 저장할까요?`)) return;
    setOfficeEditSaving(true);
    try {
      const res = await fetch(MASTER_API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-office-quote-lines',
          requestId: item.id,
          lines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '저장에 실패했습니다.');
        return;
      }
      cancelOfficeForceEdit();
      alert(data.message || '저장되었습니다.');
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setOfficeEditSaving(false);
    }
  };

  const openStatementModal = (batch: ArchiveBatch) => {
    if (isDeptSettlement && !statementPublished) {
      return alert('마스터가 명세표를 게시한 뒤에 명세표 대조를 사용할 수 있습니다.');
    }
    const drafts: Record<string, string> = {};
    const baselines: Record<string, string> = {};
    (batch.items || []).forEach((item) => {
      const matched = resolveInspectMatchedPrice(item);
      const current =
        item.finalPrice != null && Number.isFinite(Number(item.finalPrice))
          ? Math.trunc(Number(item.finalPrice))
          : null;
      const opts = (item.options || {}) as Record<string, unknown>;
      const savedLines = Array.isArray(opts.suppliesLineSettlements)
        ? (opts.suppliesLineSettlements as Array<{ lineNo?: number; finalPrice?: number }>)
        : [];
      const quoteStats = getOfficeQuoteStats(item);

      if (item.category === 'OFFICE_SUPPLIES' && quoteStats.lines.length > 0) {
        const inspectDetails = (
          opts.inspectResult as { details?: Array<{ id?: string; docUnitPrice?: number }> } | undefined
        )?.details;
        for (const line of quoteStats.lines) {
          const lineId = makeOfficeQuoteLineId(item.id, line.lineNo);
          const saved = savedLines.find((s) => Number(s.lineNo) === line.lineNo);
          const fromInspect = inspectDetails?.find((d) => d.id === lineId);
          const linePrice =
            saved?.finalPrice != null && Number.isFinite(Number(saved.finalPrice))
              ? Math.trunc(Number(saved.finalPrice))
              : fromInspect?.docUnitPrice != null && Number(fromInspect.docUnitPrice) > 0
                ? Math.trunc(Number(fromInspect.docUnitPrice))
                : line.supplyPrice > 0
                  ? line.supplyPrice
                  : null;
          drafts[lineId] = linePrice != null && linePrice > 0 ? String(linePrice) : '';
          baselines[lineId] =
            fromInspect?.docUnitPrice != null && Number(fromInspect.docUnitPrice) > 0
              ? String(Math.trunc(Number(fromInspect.docUnitPrice)))
              : line.supplyPrice > 0
                ? String(line.supplyPrice)
                : '';
        }
        // 신청 합계 키도 보관(표시용 아님)
        drafts[item.id] =
          current != null && current > 0
            ? String(current)
            : quoteStats.amountSum > 0
              ? String(quoteStats.amountSum)
              : '';
        const baseline = matched ?? (quoteStats.amountSum > 0 ? quoteStats.amountSum : current);
        baselines[item.id] = baseline != null && baseline > 0 ? String(baseline) : '';
      } else {
        drafts[item.id] = current != null && current > 0 ? String(current) : '';
        const baseline = matched ?? current;
        baselines[item.id] = baseline != null && baseline > 0 ? String(baseline) : '';
      }
    });
    setPriceDrafts(drafts);
    setPriceBaselines(baselines);
    setStatementBatch(batch);
  };

  const isPriceDraftChanged = (itemId: string) => {
    const cur = moneyDigitsToNumber(priceDrafts[itemId] || '');
    const base = moneyDigitsToNumber(priceBaselines[itemId] || '');
    if (base == null) return false; // 따라온 기준가 없으면 수정 표시 안 함
    if (cur == null) return true; // 기준가는 있는데 비움 → 변경
    return cur !== base;
  };

  /** 마스터 보관함 이동 이후(또는 마스터 아카이브): 조회만 (닫기) */
  const isStatementModalReadOnly = useMemo(() => {
    if (!statementBatch) return false;
    if (isSettledArchiveView) return true;
    if (isMasterDashboard) return false;
    // 부서 정산: 마스터에서 →보관함 이동 처리된 뒤에만 조회전용
    return isBatchMasterSettledArchived(statementBatch);
  }, [statementBatch, isSettledArchiveView, isMasterDashboard]);

  const handleMasterArchiveBatch = async (batch: ArchiveBatch) => {
    if (!isMasterDashboard) return;
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    if (!canMoveBatchToMasterArchive(batch)) {
      return alert(
        '명세서 검수가 일치하거나, 명세표 대조가 확정(수기확정/대조확정)된 묶음만 아카이브로 이동할 수 있습니다.'
      );
    }
    if (
      !confirm(
        `[${formatBatchNo(batch.id)}] 정산완료 아카이브(보관함)로 이동할까요?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(MASTER_API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'master-archive-batch',
          batchId: batch.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '보관함 이동에 실패했습니다.');
        return;
      }
      alert(data.message || '정산완료 아카이브로 이동했습니다.');
      await fetchData();
      if (confirm('정산완료 아카이브 화면으로 이동할까요?')) {
        router.push('/asset/production/master/archive');
      }
    } catch {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  const handleSaveStatementMatch = async () => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    if (!statementBatch) return;
    if (isStatementModalReadOnly) return;

    const prices: Array<{
      requestId: string;
      finalPrice: number;
      baselinePrice?: number;
      suppliesLineSettlements?: Array<{
        lineNo: number;
        code: string;
        productName: string;
        qty: number;
        finalPrice: number;
      }>;
    }> = [];

    for (const item of statementBatch.items || []) {
      const quoteStats = getOfficeQuoteStats(item);
      if (item.category === 'OFFICE_SUPPLIES' && quoteStats.lines.length > 0) {
        const lineSettlements = quoteStats.lines.map((line) => {
          const lineId = makeOfficeQuoteLineId(item.id, line.lineNo);
          const finalPrice = Number(moneyDigitsOnly(priceDrafts[lineId] || '') || 'NaN');
          return {
            lineNo: line.lineNo,
            code: line.code,
            productName: line.productName,
            qty: line.qty,
            finalPrice: Number.isFinite(finalPrice) && finalPrice >= 0 ? finalPrice : 0,
          };
        });
        const sum = lineSettlements.reduce((s, l) => s + l.finalPrice, 0);
        if (!lineSettlements.some((l) => l.finalPrice > 0) && sum <= 0) continue;
        const baseline = Number(moneyDigitsOnly(priceBaselines[item.id] || '') || 'NaN');
        prices.push({
          requestId: item.id,
          finalPrice: sum,
          ...(Number.isFinite(baseline) && baseline > 0 ? { baselinePrice: baseline } : {}),
          suppliesLineSettlements: lineSettlements,
        });
      } else {
        const finalPrice = Number(moneyDigitsOnly(priceDrafts[item.id] || '') || 'NaN');
        if (!Number.isFinite(finalPrice) || finalPrice < 0) continue;
        const baselinePrice = Number(moneyDigitsOnly(priceBaselines[item.id] || '') || 'NaN');
        prices.push({
          requestId: item.id,
          finalPrice,
          ...(Number.isFinite(baselinePrice) && baselinePrice > 0
            ? { baselinePrice }
            : {}),
        });
      }
    }

    if (prices.length === 0) {
      return alert('저장할 단가를 입력해 주세요.');
    }

    setSavingStatement(true);
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'statement-match',
          batchId: statementBatch.id,
          prices,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '명세표 대조 저장에 실패했습니다.');
        return;
      }
      alert(data.message || '저장되었습니다.');
      setStatementBatch(null);
      setPriceBaselines({});
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setSavingStatement(false);
    }
  };

  return (
    <>
      <div className="w-full space-y-3">
        {/* 거래명세표 등록·목록 — 정산 화면만 (정산완료 보관함/아카이브 제외) */}
        {!isSettledArchiveView && (
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-white to-indigo-50/50 p-4 shadow-sm flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xl shrink-0">📑</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black text-indigo-950">
                    {isMasterDashboard ? '이달의 외주 거래명세표' : '마스터 등록 외주 거래명세표'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200">
                    {CATEGORY_LABEL[activeCategory] || activeCategory}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black ${
                      currentCategoryStatementFiles.length > 0
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {currentCategoryStatementFiles.length > 0
                      ? `${currentCategoryStatementFiles.length}개 외주사 등록됨`
                      : '등록 명세표 없음'}
                  </span>
                </div>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                  {isMasterDashboard
                    ? `[${CATEGORY_LABEL[activeCategory] || activeCategory}] 코너의 외주사별 명세표(PDF/Excel)를 등록하면 부서 및 관리자 페이지 명세 대조에 즉시 연동됩니다.`
                    : `[${CATEGORY_LABEL[activeCategory] || activeCategory}] 코너에 관리자가 등록한 외주 거래명세표 목록입니다.`}
                </p>
              </div>
            </div>

            {/* 확인 완료 기한 · 전달사항 — 여백에 표시 (부서 정산·마스터 공통) */}
            {confirmRequest && (
              <div className="flex-1 min-w-[220px] max-w-xl mx-auto px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 shadow-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-black text-amber-800 tracking-wide">
                    확인 완료 기한
                  </span>
                  <span className="text-[12px] font-black text-amber-950 font-mono tabular-nums">
                    {formatConfirmRequestLabel(confirmRequest.requestedAt)}
                  </span>
                  {confirmRequest.updatedBy ? (
                    <span className="text-[10px] font-bold text-amber-700/80">
                      · {confirmRequest.updatedBy}
                    </span>
                  ) : null}
                </div>
                {confirmRequest.memo ? (
                  <p className="mt-1 text-[11px] font-bold text-amber-900/90 whitespace-pre-wrap break-words leading-snug">
                    📝 {confirmRequest.memo}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[10px] font-bold text-amber-700/60">전달사항 없음</p>
                )}
              </div>
            )}

            {isMasterDashboard && (
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={handleOpenConfirmModal}
                  title={!canEdit ? '편집 권한(Edit) 필요' : undefined}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black shadow-sm transition-colors flex items-center gap-1.5 ${
                    canEdit
                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  <span>➕ 확인 완료 기한 등록(Edit)</span>
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={handleOpenUploadModal}
                  title={!canEdit ? '편집 권한(Edit) 필요' : undefined}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black shadow-sm transition-colors flex items-center gap-1.5 ${
                    canEdit
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  <span>
                    ➕ {CATEGORY_LABEL[activeCategory] || activeCategory} 명세표 등록(Edit)
                  </span>
                </button>
                <div className="inline-flex items-center gap-1.5 shrink-0">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-black border shadow-sm ${
                      statementPublished
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                    title={
                      statementPublished
                        ? '부서 정산 화면에 명세표가 공개된 상태입니다'
                        : '부서 정산 화면에서 명세표가 숨겨진 상태입니다'
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        statementPublished ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                    />
                    {statementPublished ? '게시중' : '숨김'}
                  </span>
                  <button
                    type="button"
                    disabled={!canEdit || publishBusy}
                    onClick={() => handleSetStatementPublish(!statementPublished)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-black shadow-sm transition-colors ${
                      !canEdit || publishBusy
                        ? DISABLED_ACTION_BTN
                        : statementPublished
                          ? 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                    title={
                      !canEdit
                        ? '편집 권한(Edit) 필요'
                        : statementPublished
                          ? '부서 화면에서 명세표 숨기기 · 검수/대조 비활성'
                          : '부서 화면에 명세표 게시하기 · 검수/대조 활성'
                    }
                  >
                    {publishBusy
                      ? '처리 중…'
                      : statementPublished
                        ? '숨기기(Edit)'
                        : '게시하기(Edit)'}
                  </button>
                </div>
              </div>
            )}
            {isDeptSettlement && (
              <div
                className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black border ${
                  statementPublished
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
              >
                {statementPublished ? '명세표 게시중' : '명세표 미게시 (마스터 대기)'}
              </div>
            )}
          </div>

          {/* 현재 코너에 등록된 외주사별 명세표 카드 리스트 */}
          {isDeptSettlement && !statementPublished ? (
            <div className="py-2.5 px-3 bg-slate-50/70 rounded-xl border border-dashed border-slate-200 text-center">
              <span className="text-[11px] font-bold text-slate-400">
                마스터가 이 코너 명세표를 게시하면 파일 목록과 명세서 검수·대조가 활성화됩니다.
              </span>
            </div>
          ) : currentCategoryStatementFiles.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
              {currentCategoryStatementFiles.map((file) => (
                <div
                  key={file.id}
                  className="p-3 bg-white/95 border border-indigo-100 rounded-xl shadow-xs flex items-center justify-between gap-3 text-xs hover:border-indigo-200 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 truncate max-w-[140px]">
                        🏢 {file.vendorName}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold">
                        ({(file.fileSize / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <p
                      className="font-mono text-slate-800 text-[11px] font-black truncate mt-1"
                      title={file.fileName}
                    >
                      {file.fileName}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {getKSTDateString(file.uploadedAt)} · {file.uploadedBy}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        window.open(
                          `/api/asset/production/master/statement-file?download=1&id=${file.id}`,
                          '_blank'
                        )
                      }
                      className="px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 transition-colors flex items-center justify-center gap-0.5"
                      title="명세표 다운로드"
                    >
                      <span>📥 다운</span>
                    </button>
                    {isMasterDashboard && (
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => handleDeleteStatement(file.id, file.vendorName)}
                        className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-[10px] font-bold transition-colors"
                        title={!canEdit ? '편집 권한 필요' : '명세표 삭제'}
                      >
                        🗑 삭제(Edit)
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2.5 px-3 bg-slate-50/70 rounded-xl border border-dashed border-slate-200 text-center">
              <span className="text-[11px] font-bold text-slate-400">
                현재 [{CATEGORY_LABEL[activeCategory] || activeCategory}] 코너에 등록된 외주 거래명세표가 없습니다.
                {isMasterDashboard &&
                  ' 우측의 [➕ 명세표 등록] 버튼을 눌러 외주사별 명세표를 등록하세요.'}
              </span>
            </div>
          )}
        </div>
        )}

        {/* 마스터 아카이브: 거래명세표 영역 자리 → 분류별 정산금액 통계 */}
        {isSettledArchiveView && (
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 p-4 shadow-sm flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xl shrink-0">📊</span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-slate-900">분류별 정산금액 합계</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200">
                      {selectedYear === 'ALL' ? '전체 연도' : `${selectedYear}년`}
                      {selectedMonth === 'ALL'
                        ? ' · 월 전체'
                        : ` · ${parseInt(selectedMonth, 10)}월`}
                    </span>
                  </div>
                  <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                    아카이브 이관 건 기준입니다. 연·월·부서·검색 필터가 반영됩니다.
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0 px-3 py-1.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400">합계</p>
                <p className="text-sm font-black text-indigo-700 font-mono tabular-nums">
                  ₩{archiveStatsGrandTotal.toLocaleString('ko-KR')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
              {HISTORY_CATEGORIES.map((cat) => {
                const row = archiveCategoryAmountStats[cat.id] || {
                  amount: 0,
                  count: 0,
                  quantity: 0,
                };
                return (
                  <div
                    key={cat.id}
                    className="p-3 bg-white/95 border border-slate-200 rounded-xl shadow-xs flex flex-col gap-2 min-h-[88px]"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-base leading-none shrink-0">{cat.icon}</span>
                      <span className="text-[11px] font-black text-slate-700 truncate">
                        {cat.label}
                      </span>
                    </div>
                    <p className="text-lg font-black text-slate-900 font-mono tabular-nums tracking-tight">
                      ₩{row.amount.toLocaleString('ko-KR')}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400">
                      {row.count.toLocaleString('ko-KR')}건
                      {row.quantity > 0
                        ? ` · 수량 ${row.quantity.toLocaleString('ko-KR')}`
                        : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div
            className="flex flex-wrap items-end gap-1 border-b border-slate-200"
            role="tablist"
            aria-label="제작 분류 필터"
          >
          {HISTORY_CATEGORIES.map((cat) => {
            const active = activeCategory === cat.id;
            const badgeCount = categoryTabCounts[cat.id] ?? 0;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCategory(cat.id)}
                title={badgeCount > 0 ? `묶음 ${badgeCount}건` : undefined}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
              >
                <span className="text-sm leading-none">{cat.icon}</span>
                <span className="flex items-center gap-1">
                  <span>{cat.label}</span>
                  {badgeCount > 0 ? (
                    <span
                      className={`tabular-nums ${
                        active ? 'opacity-95' : 'text-indigo-600'
                      }`}
                    >
                      ({badgeCount})
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={`bg-white border border-t-0 border-slate-200 rounded-b-[2.5rem] rounded-tr-2xl shadow-sm animate-in fade-in duration-300 ${
            orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'
          }`}
        >
          <div
            className={`p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4 relative ${
              orgMenuOpen ? 'z-[80] overflow-visible' : ''
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-700 mt-1.5 shrink-0" />
              <div>
                <h2 className="text-sm font-black text-slate-800 tracking-tight">
                  {isMasterArchive
                    ? '대조완료 보관함'
                    : isDeptArchive
                      ? '정산완료 보관함'
                      : isMaster
                        ? '전사 수령완료 묶음 대장 (명세 대조)'
                        : '명세서 정산'}
                </h2>
                <p className="text-[11px] text-slate-500 font-bold mt-1">
                  {isMasterArchive
                    ? '마스터에서 명세 대조 확정 후 보관함으로 이관된 묶음'
                    : isDeptArchive
                      ? '마스터에서 정산완료 이관된 묶음 · 조회 전용'
                      : isMaster
                        ? '각 부서에서 수령 완료 후 이관된 묶음 · 부서별 조회 · 정산상태'
                        : '명세서 검수 및 정산상태 확인/관리자페이지와 내용이 공유됩니다.'}
                </p>
              </div>
            </div>

            <div
              className={`flex items-center gap-2 flex-wrap ml-auto ${
                orgMenuOpen ? 'relative z-[90] overflow-visible' : ''
              }`}
            >
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
                {filteredBatches.length}묶음
              </span>
              {isMasterArchive && (
                <button
                  type="button"
                  onClick={handlePurgeSelectedArchivedBatches}
                  disabled={purgingBatches || selectedBatchIds.size === 0 || !canPurgeLv1}
                  title={
                    !canPurgeLv1
                      ? '영구삭제는 LV_1만 가능합니다'
                      : selectedBatchIds.size === 0
                        ? '삭제할 묶음을 체크박스로 선택해 주세요'
                        : '선택한 정산완료 아카이브 묶음을 DB에서 영구삭제합니다 (테스트용)'
                  }
                  className={
                    !canPurgeLv1
                      ? `h-7 px-2.5 rounded-lg text-[10px] font-black whitespace-nowrap ${DISABLED_ACTION_BTN}`
                      : 'h-7 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black shadow-sm disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap'
                  }
                >
                  {purgingBatches
                    ? '삭제 중…'
                    : `선택 삭제(LV_1) ${selectedBatchIds.size}묶음`}
                </button>
              )}
              <div
                className={`relative group/filter flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border ${
                  orgMenuOpen ? 'relative z-[90]' : ''
                }`}
              >
                <span
                  role="tooltip"
                  className={`pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg ${
                    orgMenuOpen ? '' : 'group-hover/filter:block'
                  }`}
                >
                  연도 → 월 · 연계필터{isMaster ? ' / 조직은 마스터 정렬' : ''}
                </span>
                <span className="text-[10px] font-black text-slate-400 uppercase leading-none">
                  연도
                </span>
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
                    <option key={year} value={year}>
                      {year}년
                    </option>
                  ))}
                </select>
                <div className="w-px h-3 bg-slate-300 shrink-0" />
                <span className="text-[10px] font-black text-slate-400 uppercase leading-none">
                  월별
                </span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
                >
                  <option value="ALL">전체</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>
                      {parseInt(month, 10)}월
                    </option>
                  ))}
                </select>
                {isMaster && (
                  <>
                    <div className="w-px h-3 bg-slate-300 shrink-0" />
                    <span className="text-[10px] font-black text-slate-400 uppercase leading-none">
                      조직
                    </span>
                    <div className="relative inline-flex items-center" ref={orgMenuRef}>
                      <button
                        type="button"
                        onClick={() => setOrgMenuOpen((open) => !open)}
                        className={`max-w-[220px] truncate text-left text-[11px] leading-none py-0 px-0 m-0 h-4 inline-flex items-center border-0 appearance-none outline-none cursor-pointer bg-transparent ${
                          selectedOrgUnit && isBoldOrgType(selectedOrgUnit.unit_type)
                            ? 'font-black text-slate-900'
                            : 'font-bold text-slate-800'
                        }`}
                      >
                        {selectedOrgUnit
                          ? selectedOrgUnit.unit_name
                          : organizationUnit?.unit_name || '조직 선택'}
                      </button>
                      {orgMenuOpen && (
                        <div className="absolute right-0 top-full mt-1.5 z-[100] min-w-[240px] max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1">
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
                  </>
                )}
              </div>
              <div className="relative flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border">
                <span className="text-[10px] font-black text-slate-400 uppercase leading-none whitespace-nowrap">
                  외주업체
                </span>
                <select
                  value={selectedVendor}
                  onChange={(e) => setSelectedVendor(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0 max-w-[140px]"
                >
                  <option value="ALL">전체</option>
                  {availableVendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relative w-32 h-7">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] leading-none pointer-events-none">
                  👤
                </span>
                <input
                  type="text"
                  placeholder="대상자 검색..."
                  value={searchUserQuery}
                  onChange={(e) => setSearchUserQuery(e.target.value)}
                  className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-indigo-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
              <div className="relative w-36 h-7">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] leading-none pointer-events-none">
                  📝
                </span>
                <input
                  type="text"
                  placeholder="제목 검색..."
                  value={searchTitleQuery}
                  onChange={(e) => setSearchTitleQuery(e.target.value)}
                  className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-indigo-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto min-h-[360px]">
            {loading ? (
              <LoadingState />
            ) : (
              <table
                className={`w-full border-collapse ${
                  useArchiveLedgerTable || showGroupedSettlementTable
                    ? 'table-fixed'
                    : 'text-left'
                }`}
              >
                {useArchiveLedgerTable && (
                  <colgroup>
                    {showBatchSelect && <col className="w-10" />}
                    <col className="w-12" />
                    <col className="w-64" />
                    {/* 발주확정일 ~ 처리자: 남은 폭 균등 분배 */}
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col className="w-28" />
                  </colgroup>
                )}
                {isMasterDashboard && (
                  <colgroup>
                    <col className="w-10" />
                    <col className="w-12" />
                    <col className="w-64" />
                    {/* 발주확정일 ~ 관리액션: 남은 폭 균등 분배 */}
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                )}
                {isDeptSettlement && (
                  <colgroup>
                    <col className="w-10" />
                    <col className="w-12" />
                    <col className="w-64" />
                    {/* 발주확정일 ~ 명세표 대조: 남은 폭 균등 분배 (정산상태 제외) */}
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                )}
                <thead className="text-indigo-900 text-[10px] font-black uppercase tracking-widest border-b border-indigo-200">
                  {showGroupedSettlementTable && (
                    <tr>
                      <th
                        colSpan={9}
                        className="bg-slate-100 text-slate-700 border-b border-r border-slate-300 font-semibold text-center text-xs py-1.5 normal-case tracking-normal"
                      >
                        신청/발주 정보
                      </th>
                      <th
                        colSpan={isDeptSettlement ? 2 : 3}
                        className="bg-amber-50 text-amber-800 border-b border-amber-200 font-semibold text-center text-xs py-1.5 normal-case tracking-normal"
                      >
                        명세 대조 및 마감
                      </th>
                    </tr>
                  )}
                  <tr className="bg-indigo-100">
                    {showBatchSelect && (
                    <th
                      className={`h-12 text-center ${
                        useArchiveLedgerTable || showGroupedSettlementTable
                          ? 'w-10 px-0'
                          : 'w-[72px] px-2'
                      }`}
                    >
                      <input
                        type="checkbox"
                        onChange={handleSelectAllBatches}
                        checked={allPageBatchesSelected}
                        className="w-3 h-3 accent-indigo-600 cursor-pointer"
                        title="현재 페이지 전체 선택"
                      />
                    </th>
                    )}
                    <th
                      className={`h-12 text-center ${
                        useArchiveLedgerTable || showGroupedSettlementTable
                          ? 'w-12 px-0'
                          : 'w-[48px] px-2'
                      }`}
                    >
                      NO
                    </th>
                    <th
                      className={`h-12 whitespace-nowrap ${
                        useArchiveLedgerTable || showGroupedSettlementTable
                          ? 'w-64 px-3 text-left'
                          : 'min-w-[280px] px-2 text-left'
                      }`}
                    >
                      묶음 번호
                    </th>
                    <th
                      className={`h-12 text-center ${
                        useArchiveLedgerTable || showGroupedSettlementTable
                          ? 'px-1'
                          : 'w-[120px] px-4'
                      }`}
                    >
                      발주확정일
                    </th>
                    <th
                      className={`h-12 ${
                        useArchiveLedgerTable || showGroupedSettlementTable
                          ? 'px-1 text-center'
                          : 'min-w-[140px] px-4 text-left'
                      }`}
                    >
                      외주업체
                    </th>
                    <th
                      className={`h-12 text-center ${
                        useArchiveLedgerTable || showGroupedSettlementTable
                          ? 'px-1'
                          : 'w-[80px] px-4'
                      }`}
                    >
                      총 수량
                    </th>
                    {!isSettledArchiveView && (
                      <th
                        className={`h-12 text-center ${
                          showGroupedSettlementTable ? 'px-1' : 'px-4 min-w-[120px]'
                        }`}
                      >
                        신청 상세
                      </th>
                    )}
                    <th
                      className={`h-12 text-center ${
                        useArchiveLedgerTable || showGroupedSettlementTable
                          ? 'px-1'
                          : 'w-[120px] px-2'
                      }`}
                    >
                      <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                        <span className="whitespace-nowrap">발주서</span>
                        <span className="text-[10px] font-bold text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                          (엑셀 다운)
                        </span>
                      </div>
                    </th>
                    {(showGroupedSettlementTable || useArchiveLedgerTable) && (
                      <th
                        className={`h-12 text-center px-1 ${
                          showGroupedSettlementTable && !useArchiveLedgerTable
                            ? 'border-r border-slate-300'
                            : ''
                        }`}
                      >
                        발주담당자
                      </th>
                    )}
                    {useArchiveLedgerTable && (
                      <>
                        <th className="h-12 px-1 text-center">
                          <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                            <span className="whitespace-nowrap">최종 정산 금액</span>
                            <span className="text-[9px] font-bold text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                              (클릭·상세)
                            </span>
                          </div>
                        </th>
                        <th className="h-12 px-1 text-center">처리자</th>
                        <th className="h-12 w-28 px-1 text-center">마감일자</th>
                      </>
                    )}
                    {!isSettledArchiveView && (
                      <th className="h-12 w-[96px] min-w-[96px] max-w-[96px] px-0.5 text-center">
                        <div className="flex flex-col items-center justify-center gap-0.5 px-0.5">
                          <span className="whitespace-nowrap text-[10px]">명세서 검수</span>
                          <button
                            type="button"
                            onClick={openCompareModal}
                            disabled={!canEdit || !settlementActionsEnabled}
                            title={
                              !settlementActionsEnabled
                                ? '마스터 명세표 게시 후 이용 가능'
                                : !canEdit
                                  ? '편집 권한 필요'
                                  : selectedBatchIds.size === 0
                                    ? '비교할 발주 묶음을 체크박스로 선택해 주세요'
                                    : `상단 등록 명세표와 선택 ${selectedBatchIds.size}건을 대조 검수합니다`
                            }
                            className={`w-full max-w-[92px] px-1 py-1 font-black text-[9px] leading-tight rounded-md shadow-sm normal-case tracking-normal ${
                              canEdit && settlementActionsEnabled
                                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            <span className="block">명세서 검수(Edit)</span>
                            <span className="block tabular-nums opacity-90">
                              선택 {selectedBatchIds.size}건
                            </span>
                          </button>
                        </div>
                      </th>
                    )}
                    {showStatementCompareColumn && (
                      <th className="h-12 w-[92px] min-w-[92px] px-0.5 text-center">
                        <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                          <span className="whitespace-nowrap text-[10px]">명세표 대조</span>
                          <span className="text-[9px] font-bold text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                            (Edit·수기)
                          </span>
                        </div>
                      </th>
                    )}
                    {isMasterDashboard && (
                      <th className="h-12 w-[88px] min-w-[88px] px-0.5 text-center">
                        <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                          <span className="whitespace-nowrap text-[10px]">관리 액션</span>
                          <span className="text-[9px] font-bold text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                            (보관함)
                          </span>
                        </div>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                  {filteredBatches.length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          isMasterDashboard
                            ? 12
                            : isDeptSettlement
                              ? 11
                              : useArchiveLedgerTable
                                ? showBatchSelect
                                  ? 11
                                  : 10
                                : 10
                        }
                        className="p-16 text-center text-slate-400 text-[11px] font-bold"
                      >
                        {isMasterArchive
                          ? '대조완료 보관함에 이동된 묶음이 없습니다.'
                          : isSettledArchiveView
                            ? '정산완료 보관함에 이동된 묶음이 없습니다.'
                            : '정산 대상 묶음이 없습니다. 검수 탭에서 수령완료 후 정산 이동해 주세요.'}
                      </td>
                    </tr>
                  ) : (
                    pageBatches.map((batch, idx) => {
                      const kind = getBatchLabelKind(batch, activeCategory);
                      const expanded = expandedBatchIds.has(batch.id);
                      const rowNo =
                        filteredBatches.length -
                        ((currentPage - 1) * BATCH_PAGE_SIZE + idx);
                      const ledgerCell =
                        useArchiveLedgerTable || showGroupedSettlementTable;
                      return (
                        <React.Fragment key={batch.id}>
                          <tr
                            className={`h-16 transition-colors ${
                              selectedBatchIds.has(batch.id)
                                ? 'bg-indigo-50/50'
                                : 'hover:bg-indigo-50/40'
                            }`}
                          >
                            {showBatchSelect && (
                            <td
                              className={`text-center ${
                                ledgerCell ? 'w-10 px-0' : 'px-4'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedBatchIds.has(batch.id)}
                                onChange={() => handleSelectBatchRow(batch.id)}
                                className="w-3 h-3 accent-indigo-600 cursor-pointer"
                              />
                            </td>
                            )}
                            <td
                              className={`text-center font-mono text-slate-500 tabular-nums ${
                                ledgerCell ? 'w-12 px-0' : 'px-2'
                              }`}
                            >
                              {rowNo}
                            </td>
                            <td
                              className={`font-mono text-indigo-600 whitespace-nowrap tabular-nums truncate ${
                                ledgerCell ? 'w-64 px-3 text-left' : 'px-2'
                              } ${isSettledArchiveView ? '' : 'cursor-pointer'}`}
                              onClick={
                                isSettledArchiveView
                                  ? undefined
                                  : () => toggleBatchExpand(batch.id)
                              }
                              title={formatBatchDisplayName(batch.id, kind)}
                            >
                              {formatBatchDisplayName(batch.id, kind)}
                            </td>
                            <td
                              className={`text-center font-mono text-slate-800 tabular-nums whitespace-nowrap ${
                                ledgerCell ? 'px-1' : 'px-4'
                              }`}
                            >
                              {batch.dispatchedAt
                                ? getKSTDateString(batch.dispatchedAt)
                                : '-'}
                            </td>
                            <td
                              className={`text-slate-700 truncate ${
                                ledgerCell
                                  ? 'px-1 text-center'
                                  : 'px-4 max-w-[160px] text-left'
                              }`}
                              title={(batch.vendors || []).join(', ') || ''}
                            >
                              {(batch.vendors || []).join(', ') || '-'}
                            </td>
                            <td
                              className={`text-center text-indigo-700 tabular-nums ${
                                ledgerCell ? 'px-1' : 'px-4'
                              }`}
                            >
                              {formatBatchQuantityLabel(batch)}
                            </td>
                            {!isSettledArchiveView && (
                              <td
                                className={`text-center cursor-pointer ${
                                  showGroupedSettlementTable ? 'px-1' : 'px-4'
                                }`}
                                onClick={() => toggleBatchExpand(batch.id)}
                              >
                                <span className="text-indigo-600 underline underline-offset-2">
                                  상세보기
                                </span>
                              </td>
                            )}
                            <td
                              className={`text-center ${
                                ledgerCell ? 'px-1' : 'px-2'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => handleBatchExcel(batch)}
                                className="p-1.5 px-2 font-bold text-[10px] rounded-lg w-full bg-white hover:bg-slate-50 text-slate-700 border border-slate-200"
                              >
                                📊엑셀 저장
                              </button>
                            </td>
                            {(showGroupedSettlementTable || useArchiveLedgerTable) && (
                              <td
                                className={`text-center px-1 ${
                                  showGroupedSettlementTable && !useArchiveLedgerTable
                                    ? 'border-r border-slate-200'
                                    : ''
                                }`}
                              >
                                {renderPersonTwoLine(getBatchOrderManager(batch))}
                              </td>
                            )}
                            {useArchiveLedgerTable && (
                              <>
                                <td className="px-1 text-center">
                                  {(() => {
                                    const amount = getBatchFinalAmount(batch);
                                    if (amount <= 0) {
                                      return (
                                        <span className="text-[10px] font-bold text-slate-300">—</span>
                                      );
                                    }
                                    return (
                                      <button
                                        type="button"
                                        title="건별 정산금액 표 보기"
                                        onClick={() => openStatementModal(batch)}
                                        className="text-[11px] font-black text-indigo-700 font-mono tabular-nums underline underline-offset-2 hover:text-indigo-900"
                                      >
                                        ₩{amount.toLocaleString('ko-KR')}
                                      </button>
                                    );
                                  })()}
                                </td>
                                <td className="px-1 text-center">
                                  {renderPersonTwoLine(getBatchProcessor(batch))}
                                </td>
                                <td className="w-28 px-1 text-center font-mono text-slate-800 tabular-nums whitespace-nowrap text-[11px]">
                                  {getBatchClosingDateLabel(batch)}
                                </td>
                              </>
                            )}
                            {!isSettledArchiveView && (
                              <td className="px-1 text-center">
                                {(() => {
                                  const inspect = getBatchInspectStatus(batch);
                                  const { matchCount, mismatchCount } =
                                    getBatchInspectCounts(batch);
                                  if (inspect === 'match') {
                                    return (
                                      <span className="text-[10px] font-black text-emerald-600 whitespace-nowrap">
                                        일치{matchCount > 0 ? ` ${matchCount}건` : ''}
                                      </span>
                                    );
                                  }
                                  if (inspect === 'mismatch') {
                                    return (
                                      <span
                                        className="text-[10px] font-black text-rose-600 whitespace-nowrap"
                                        title={`일치 ${matchCount}건 / 불일치 ${mismatchCount}건`}
                                      >
                                        불일치 {mismatchCount}건 / 일치 {matchCount}건
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="text-[10px] font-black text-slate-400 whitespace-nowrap">
                                      미검수
                                    </span>
                                  );
                                })()}
                              </td>
                            )}
                            {showStatementCompareColumn && (
                              <td className="px-1 text-center">
                                {(() => {
                                  const handConfirmed = isBatchHandConfirmed(batch);
                                  const compareConfirmed =
                                    !handConfirmed && isBatchCompareConfirmed(batch);
                                  const label = handConfirmed
                                    ? '수기확정'
                                    : compareConfirmed
                                      ? '대조확정'
                                      : '명세표 대조';
                                  const locked = !settlementActionsEnabled;
                                  const editBlocked = !canEdit;
                                  return (
                                    <button
                                      type="button"
                                      disabled={locked || editBlocked}
                                      title={
                                        locked
                                          ? '마스터 명세표 게시 후 이용 가능'
                                          : editBlocked
                                            ? '편집 권한 필요'
                                          : handConfirmed
                                            ? '수기 단가 확정됨 · 다시 열어 수정 가능'
                                            : compareConfirmed
                                              ? '명세표 대조 확정됨 · 다시 열어 수정 가능'
                                              : '검수 불일치여도 수기 단가로 확정할 수 있습니다'
                                      }
                                      onClick={() => openStatementModal(batch)}
                                      className={`px-2.5 py-1 text-[10px] font-black rounded-lg w-full whitespace-nowrap transition-colors ${
                                        locked || editBlocked
                                          ? DISABLED_ACTION_BTN
                                          : handConfirmed || compareConfirmed
                                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                            : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  );
                                })()}
                              </td>
                            )}
                            {isMasterDashboard && (
                              <td className="px-1 text-center">
                                {canMoveBatchToMasterArchive(batch) ? (
                                  <button
                                    type="button"
                                    disabled={!canEdit}
                                    title={
                                      !canEdit
                                        ? '편집 권한 필요'
                                        : '검수 일치·대조확정 → 정산완료 아카이브로 이동'
                                    }
                                    onClick={() => handleMasterArchiveBatch(batch)}
                                    className={`px-2.5 py-1 text-[10px] font-black rounded-lg w-full whitespace-nowrap transition-colors ${
                                      canEdit
                                        ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                                        : DISABLED_ACTION_BTN
                                    }`}
                                  >
                                    →보관함 이동(Edit)
                                  </button>
                                ) : (
                                  <span className="text-[10px] font-bold text-slate-300">—</span>
                                )}
                              </td>
                            )}
                          </tr>

                          {!isSettledArchiveView && expanded && (
                            <tr className="bg-transparent">
                              <td className="w-10 bg-slate-100/70 border-y border-slate-200" />
                              <td className="w-12 bg-slate-100/70 border-y border-slate-200" />
                              <td
                                colSpan={
                                  isMasterDashboard ? 10 : isDeptSettlement ? 9 : 8
                                }
                                className="bg-slate-100/70 p-4 border-y border-slate-200 border-l-4 border-l-blue-500"
                              >
                            <div className="overflow-hidden bg-transparent">
                              <table className="w-full table-fixed text-left border-collapse bg-transparent">
                                <colgroup>
                                  <col className="w-[44px]" />
                                  <col className="w-[145px]" />
                                  <col className="w-[85px]" />
                                  <col className="w-[130px]" />
                                  <col className="w-[65px]" />
                                  <col className="w-[115px]" />
                                  <col />
                                  <col className="w-[100px]" />
                                  <col className="w-[80px]" />
                                </colgroup>
                                <thead>
                                  <tr className="bg-slate-200/80 text-slate-700 font-semibold border-b border-slate-300 text-[10px] tracking-widest">
                                    <th className="h-10 px-1 text-center whitespace-nowrap bg-transparent">NO</th>
                                    <th className="h-10 px-2 text-center whitespace-nowrap bg-transparent">
                                      관리번호
                                    </th>
                                    <th className="h-10 px-1 text-center whitespace-nowrap bg-transparent">
                                      신청일
                                    </th>
                                    <th className="h-10 px-2 text-left truncate whitespace-nowrap bg-transparent">
                                      소속 부서
                                    </th>
                                    <th className="h-10 px-2 text-center whitespace-nowrap bg-transparent">대상자</th>
                                    <th className="h-10 px-1 text-center whitespace-nowrap bg-transparent">
                                      분류
                                    </th>
                                    <th className="h-10 px-2 text-left whitespace-nowrap bg-transparent">관리용 제목</th>
                                    <th className="h-10 px-1 text-center whitespace-nowrap bg-transparent">
                                      수량
                                    </th>
                                    <th className="h-10 px-1 text-center whitespace-nowrap bg-transparent">
                                      원문확인
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/80 text-[11px] font-bold text-slate-700 bg-transparent">
                                  {(batch.items || []).flatMap((item, idx) => {
                                    const officeStats =
                                      item.category === 'OFFICE_SUPPLIES'
                                        ? getOfficeQuoteStats(item)
                                        : null;
                                    if (item.category === 'OFFICE_SUPPLIES') {
                                      const canForceEdit =
                                        isMasterDashboard &&
                                        canEdit &&
                                        (item.options || {}).masterSettledArchived !== true;
                                      const editing =
                                        isMasterDashboard && officeEditRequestId === item.id;
                                      const displayLines = editing
                                        ? officeEditDrafts
                                        : officeStats?.lines || [];
                                      const lineRows =
                                        displayLines.length > 0
                                          ? displayLines
                                          : [
                                              {
                                                lineNo: 0,
                                                code: '',
                                                productName: '(견적 품목 없음)',
                                                unitPrice: 0,
                                                qty: 0,
                                                supplyPrice: 0,
                                              } as OfficeQuoteLine,
                                            ];

                                      const mapped = lineRows.map((line, lineIdx) => (
                                        <tr
                                          key={`${item.id}-${editing ? `e${lineIdx}` : line.lineNo}`}
                                          className={`h-12 bg-transparent hover:bg-slate-200/40 transition-colors ${
                                            editing ? 'bg-amber-50/40' : ''
                                          }`}
                                        >
                                          <td className="px-1 text-center font-mono text-slate-500 tabular-nums bg-transparent">
                                            {idx + 1}-{editing ? lineIdx + 1 : line.lineNo || '-'}
                                          </td>
                                          <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate bg-transparent" title={item.postNumber}>
                                            {item.postNumber}
                                          </td>
                                          <td className="px-1 text-center whitespace-nowrap tabular-nums text-slate-800 bg-transparent">
                                            {getKSTDateString(item.createdAt)}
                                          </td>
                                          <td
                                            className="px-2 truncate text-slate-700 bg-transparent"
                                            title={item.deptName || ''}
                                          >
                                            {item.deptName || (
                                              <span className="text-slate-300">-</span>
                                            )}
                                          </td>
                                          <td className="px-2 text-center text-slate-800 truncate bg-transparent" title={item.userName || ''}>
                                            {item.userName || '-'}
                                          </td>
                                          <td className="px-1 text-center whitespace-nowrap bg-transparent">
                                            <span
                                              className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-tight border whitespace-nowrap inline-block ${getProductionCategoryBadgeClass(item.category)}`}
                                            >
                                              {CATEGORY_LABEL[item.category] || item.category}
                                            </span>
                                          </td>
                                          <td className="px-2 text-slate-800 bg-transparent">
                                            {editing ? (
                                              <input
                                                type="text"
                                                value={line.productName}
                                                onChange={(e) => {
                                                  const v = e.target.value;
                                                  setOfficeEditDrafts((prev) =>
                                                    prev.map((row, i) =>
                                                      i === lineIdx ? { ...row, productName: v } : row
                                                    )
                                                  );
                                                }}
                                                className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold outline-none focus:border-amber-500"
                                                placeholder="제품명"
                                              />
                                            ) : (
                                              <span className="truncate block" title={line.productName}>
                                                {line.lineNo > 0 && (
                                                  <span className="text-[10px] text-slate-400 font-mono mr-1">
                                                    #{line.lineNo}
                                                  </span>
                                                )}
                                                {line.productName}
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-1 text-center whitespace-nowrap bg-transparent">
                                            {editing ? (
                                              <input
                                                type="number"
                                                min={1}
                                                value={line.qty || 1}
                                                onChange={(e) => {
                                                  const qty = Math.max(
                                                    1,
                                                    parseInt(e.target.value, 10) || 1
                                                  );
                                                  setOfficeEditDrafts((prev) =>
                                                    prev.map((row, i) =>
                                                      i === lineIdx
                                                        ? {
                                                            ...row,
                                                            qty,
                                                            supplyPrice:
                                                              row.unitPrice > 0
                                                                ? row.unitPrice * qty
                                                                : row.supplyPrice,
                                                          }
                                                        : row
                                                    )
                                                  );
                                                }}
                                                className="w-14 rounded-lg border border-amber-300 bg-white px-1 py-1 text-center text-[11px] font-mono outline-none"
                                              />
                                            ) : (
                                              <>
                                                <span className="font-mono tabular-nums">
                                                  {line.qty || '-'}
                                                </span>
                                                {line.qty > 0 && (
                                                  <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                                                    개
                                                  </span>
                                                )}
                                              </>
                                            )}
                                          </td>
                                          <td className="px-1 text-center whitespace-nowrap bg-transparent">
                                            {editing ? (
                                              <button
                                                type="button"
                                                disabled={officeEditDrafts.length <= 1}
                                                onClick={() =>
                                                  setOfficeEditDrafts((prev) =>
                                                    prev.filter((_, i) => i !== lineIdx)
                                                  )
                                                }
                                                className="px-2 py-1 text-[10px] font-bold rounded-lg text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 disabled:opacity-40"
                                              >
                                                삭제
                                              </button>
                                            ) : lineIdx === 0 ? (
                                              <button
                                                type="button"
                                                onClick={() => setDetailItem(item)}
                                                className="px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
                                              >
                                                원문확인
                                              </button>
                                            ) : (
                                              <span className="text-slate-300 text-[10px]">—</span>
                                            )}
                                          </td>
                                        </tr>
                                      ));

                                      if (isMasterDashboard) {
                                        if (editing) {
                                          mapped.push(
                                            <tr key={`${item.id}-office-edit`} className="bg-amber-50/70">
                                              <td colSpan={9} className="px-3 py-2">
                                                <div className="flex flex-wrap items-center justify-end gap-2">
                                                  <button
                                                    type="button"
                                                    disabled={officeEditSaving}
                                                    onClick={() =>
                                                      setOfficeEditDrafts((prev) => [
                                                        ...prev,
                                                        {
                                                          lineNo: prev.length + 1,
                                                          code: '',
                                                          productName: '',
                                                          unitPrice: 0,
                                                          qty: 1,
                                                          supplyPrice: 0,
                                                        },
                                                      ])
                                                    }
                                                    className="px-2.5 py-1 text-[10px] font-black rounded-lg bg-white border border-amber-300 text-amber-900"
                                                  >
                                                    + 항목 추가
                                                  </button>
                                                  <button
                                                    type="button"
                                                    disabled={officeEditSaving}
                                                    onClick={cancelOfficeForceEdit}
                                                    className="px-2.5 py-1 text-[10px] font-black rounded-lg bg-slate-100 text-slate-600"
                                                  >
                                                    취소
                                                  </button>
                                                  <button
                                                    type="button"
                                                    disabled={officeEditSaving || !canEdit}
                                                    onClick={() => saveOfficeForceEdit(item)}
                                                    className="px-2.5 py-1 text-[10px] font-black rounded-lg bg-indigo-600 text-white disabled:opacity-50"
                                                  >
                                                    {officeEditSaving ? '저장 중…' : '저장'}
                                                  </button>
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        } else if (canForceEdit) {
                                          mapped.push(
                                            <tr key={`${item.id}-office-force`} className="bg-slate-50/80">
                                              <td colSpan={9} className="px-3 py-2 text-right">
                                                <button
                                                  type="button"
                                                  onClick={() => beginOfficeForceEdit(item)}
                                                  className="px-2.5 py-1 text-[10px] font-black rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
                                                >
                                                  강제수정모드
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        }
                                      }

                                      return mapped;
                                    }
                                    return [
                                      <tr
                                        key={item.id}
                                        className="h-12 bg-transparent hover:bg-slate-200/40 transition-colors"
                                      >
                                      <td className="px-1 text-center font-mono text-slate-500 tabular-nums bg-transparent">
                                        {idx + 1}
                                      </td>
                                      <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate bg-transparent" title={item.postNumber}>
                                        {item.postNumber}
                                      </td>
                                      <td className="px-1 text-center whitespace-nowrap tabular-nums text-slate-800 bg-transparent">
                                        {getKSTDateString(item.createdAt)}
                                      </td>
                                      <td
                                        className="px-2 truncate text-slate-700 bg-transparent"
                                        title={item.deptName || ''}
                                      >
                                        {item.deptName || (
                                          <span className="text-slate-300">-</span>
                                        )}
                                      </td>
                                      <td className="px-2 text-center text-slate-800 truncate bg-transparent" title={item.userName || ''}>
                                        {item.userName || '-'}
                                      </td>
                                      <td className="px-1 text-center whitespace-nowrap bg-transparent">
                                        <span
                                          className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-tight border whitespace-nowrap inline-block ${getProductionCategoryBadgeClass(item.category)}`}
                                        >
                                          {CATEGORY_LABEL[item.category] || item.category}
                                        </span>
                                      </td>
                                      <td
                                        className="px-2 text-slate-800 truncate bg-transparent"
                                        title={item.title || ''}
                                      >
                                        {item.title || '-'}
                                      </td>
                                      <td className="px-1 text-center whitespace-nowrap bg-transparent">
                                        <span className="font-mono tabular-nums">
                                          {item.quantity}
                                        </span>
                                        <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                                          {formatQuantityUnit(item)}
                                        </span>
                                      </td>
                                      <td className="px-1 text-center whitespace-nowrap bg-transparent">
                                        <button
                                          type="button"
                                          onClick={() => setDetailItem(item)}
                                          className="px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
                                        >
                                          원문확인
                                        </button>
                                      </td>
                                    </tr>,
                                    ];
                                  })}
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
            )}
          </div>

          {!loading && filteredBatches.length > 0 && (
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
    </div>

      {statementBatch && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">명세표 대조</h3>
              <p className="text-xs text-slate-500 mt-1.5 font-semibold">
                {formatBatchDisplayName(
                  statementBatch.id,
                  getBatchLabelKind(statementBatch, activeCategory)
                )}{' '}
                ·{' '}
                {isStatementModalReadOnly
                  ? '외주 명세 단가 확인 (조회 전용)'
                  : '외주 명세 단가를 건별로 입력합니다.'}
              </p>
              {!isStatementModalReadOnly && (
              <p className="text-[10px] font-bold text-amber-700/90 mt-1.5">
                ※ 명세표 검수에서 따라온 단가와 <strong>다른 숫자</strong>로 저장한 칸만{' '}
                <span className="rounded px-1 bg-amber-100 border border-amber-200">주황</span>
                으로 남습니다. 같은 숫자로 되돌리면 표시되지 않습니다.
              </p>
              )}
            </div>
            <div className="p-6 overflow-x-auto space-y-3">
              {(() => {
                const items = statementBatch.items || [];
                const officeRows = items.flatMap((item) => {
                  if (item.category !== 'OFFICE_SUPPLIES') return [];
                  const stats = getOfficeQuoteStats(item);
                  return stats.lines.map((line) => ({
                    key: makeOfficeQuoteLineId(item.id, line.lineNo),
                    item,
                    line,
                  }));
                });
                const useOfficeLines = officeRows.length > 0;
                const totalQty = useOfficeLines
                  ? officeRows.reduce((s, r) => s + (r.line.qty || 0), 0)
                  : items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
                const totalPrice = useOfficeLines
                  ? officeRows.reduce((s, r) => {
                      const n = moneyDigitsToNumber(priceDrafts[r.key] || '');
                      return s + (n ?? 0);
                    }, 0)
                  : items.reduce((s, i) => {
                      const n = moneyDigitsToNumber(priceDrafts[i.id] || '');
                      return s + (n ?? 0);
                    }, 0);
                const qtyUnit = useOfficeLines
                  ? '개'
                  : items[0]
                    ? formatQuantityUnit(items[0])
                    : '';
                return (
                  <>
                  <div className="flex items-center justify-end gap-4 px-1">
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-400">
                        {useOfficeLines ? '수량 합계 · 품목' : '수량 합계'}
                      </p>
                      <p className="text-sm font-black text-slate-800 font-mono">
                        {totalQty.toLocaleString()}
                        {qtyUnit}
                        {useOfficeLines ? ` · ${officeRows.length}품목` : ''}
                      </p>
                    </div>
                    <div className="text-right min-w-[140px]">
                      <p className="text-[10px] font-bold text-slate-400">최종 정산단가(원) 합계</p>
                      <p className="text-base font-black text-indigo-600 font-mono">
                        ₩{totalPrice.toLocaleString()}
                      </p>
                    </div>
                  </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-black border-b border-slate-200 text-[10px]">
                  <tr>
                    <th className="h-10 px-2">관리번호</th>
                    {useOfficeLines ? (
                      <>
                        <th className="h-10 px-2">No</th>
                        <th className="h-10 px-2">제품명</th>
                        <th className="h-10 px-2 text-center">수량</th>
                        <th className="h-10 px-2 text-right w-[140px]">정산금액(원)</th>
                      </>
                    ) : (
                      <>
                        <th className="h-10 px-2">대상자</th>
                        <th className="h-10 px-2">제목</th>
                        <th className="h-10 px-2 text-center">수량</th>
                        <th className="h-10 px-2 text-right w-[140px]">정산단가(원)</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                  {useOfficeLines
                    ? officeRows.map(({ key, item, line }) => (
                        <tr key={key} className="h-12">
                          <td className="px-2 font-mono text-[11px]">{item.postNumber}</td>
                          <td className="px-2 text-[11px] font-mono text-slate-500">{line.lineNo}</td>
                          <td className="px-2 text-[11px] truncate max-w-[280px]" title={line.productName}>
                            {line.productName}
                          </td>
                          <td className="px-2 text-center text-[11px]">
                            {line.qty}개
                          </td>
                          <td className="px-2 text-right">
                            {(() => {
                              const changed = isPriceDraftChanged(key);
                              const digits = moneyDigitsOnly(priceDrafts[key] || '');
                              return (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  readOnly={isStatementModalReadOnly}
                                  value={formatMoneyDigits(digits)}
                                  title={
                                    isStatementModalReadOnly
                                      ? '조회 전용'
                                      : changed
                                        ? '견적/검수 기준과 다른 값으로 수정됨'
                                        : priceBaselines[key]
                                          ? '견적·검수 기준과 동일'
                                          : '금액 미입력'
                                  }
                                  onChange={(e) => {
                                    if (isStatementModalReadOnly) return;
                                    setPriceDrafts((prev) => ({
                                      ...prev,
                                      [key]: moneyDigitsOnly(e.target.value),
                                    }));
                                  }}
                                  className={`w-full rounded-lg px-2 py-1.5 text-right text-[11px] font-mono outline-none transition-colors ${
                                    isStatementModalReadOnly
                                      ? 'bg-slate-50 border border-slate-200 text-slate-600 cursor-default'
                                      : changed
                                        ? 'bg-amber-50 border-2 border-amber-400 text-amber-950 focus:border-amber-500 focus:ring-1 focus:ring-amber-200'
                                        : 'bg-slate-50 border border-slate-200 text-slate-800 focus:border-indigo-400'
                                  }`}
                                  placeholder="0"
                                />
                              );
                            })()}
                          </td>
                        </tr>
                      ))
                    : (statementBatch.items || []).map((item) => (
                    <tr key={item.id} className="h-12">
                      <td className="px-2 font-mono text-[11px]">{item.postNumber}</td>
                      <td className="px-2 text-[11px]">{item.userName}</td>
                      <td className="px-2 text-[11px] truncate max-w-[200px]" title={item.title}>
                        {item.title || '-'}
                      </td>
                      <td className="px-2 text-center text-[11px]">
                        {item.quantity}
                        {formatQuantityUnit(item)}
                      </td>
                      <td className="px-2 text-right">
                        {(() => {
                          const changed = isPriceDraftChanged(item.id);
                          const digits = moneyDigitsOnly(priceDrafts[item.id] || '');
                          return (
                            <input
                              type="text"
                              inputMode="numeric"
                              readOnly={isStatementModalReadOnly}
                              value={formatMoneyDigits(digits)}
                              title={
                                isStatementModalReadOnly
                                  ? '조회 전용'
                                  : changed
                                    ? '검수 따라온 단가와 다른 값으로 수정됨'
                                    : priceBaselines[item.id]
                                      ? '검수에서 따라온 단가와 동일'
                                      : '단가 미입력'
                              }
                              onChange={(e) => {
                                if (isStatementModalReadOnly) return;
                                setPriceDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: moneyDigitsOnly(e.target.value),
                                }));
                              }}
                              className={`w-full rounded-lg px-2 py-1.5 text-right text-[11px] font-mono outline-none transition-colors ${
                                isStatementModalReadOnly
                                  ? 'bg-slate-50 border border-slate-200 text-slate-600 cursor-default'
                                  : changed
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
                  </>
                );
              })()}
            </div>
            <div className="p-6 border-t border-slate-100 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-[11px] font-semibold text-slate-500">
                {(() => {
                  const edit = resolveSettlementLastEdit(statementBatch);
                  return edit ? formatSettlementLastEditLabel(edit) : '';
                })()}
              </p>
              <div className="flex shrink-0 gap-2">
                {isStatementModalReadOnly ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStatementBatch(null);
                      setPriceBaselines({});
                    }}
                    className="px-4 py-2.5 rounded-xl text-[11px] font-black text-slate-600 bg-slate-100 hover:bg-slate-200"
                  >
                    닫기
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={savingStatement}
                      onClick={() => {
                        setStatementBatch(null);
                        setPriceBaselines({});
                      }}
                      className="px-4 py-2.5 rounded-xl text-[11px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      disabled={savingStatement || !canEdit}
                      onClick={handleSaveStatementMatch}
                      title={!canEdit ? '편집 권한 필요' : '명세표 대조 저장'}
                      className="px-4 py-2.5 rounded-xl text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {savingStatement ? '저장 중…' : '대조 저장(Edit)'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 확인 완료 요청일 등록 모달 */}
      {isMasterDashboard && isConfirmModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl border border-slate-200 space-y-5">
            <div className="border-b border-slate-100 pb-3 flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <span>📅 확인 완료 기한 등록</span>
                </h3>
                <p className="mt-1 text-xs text-slate-500 font-bold leading-relaxed">
                  [{CATEGORY_LABEL[activeCategory] || activeCategory}] 코너 부서관리자에게{' '}
                  <strong className="text-amber-700">이 시각까지</strong> 확인 완료해 달라는 기한과
                  전달사항을 남깁니다. 정산(명세 대조) 화면 명세표 영역에 표시됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-700">
                  확인 완료 기한 <span className="text-amber-600 font-bold">(이 시각까지)</span>
                </label>
                <input
                  type="datetime-local"
                  value={confirmRequestedAt}
                  onChange={(e) => setConfirmRequestedAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-500 bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-700">
                  부서관리자 전달사항 (메모)
                </label>
                <textarea
                  value={confirmMemo}
                  onChange={(e) => setConfirmMemo(e.target.value)}
                  rows={5}
                  placeholder="예) 기한까지 명세 대조·확인 완료 부탁드립니다."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-500 bg-white resize-y min-h-[120px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                disabled={confirmSaving || !confirmRequest}
                onClick={handleClearConfirmRequest}
                className="px-3 py-2 rounded-xl text-xs font-black text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-40"
              >
                기한 삭제(Edit)
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={confirmSaving}
                  onClick={() => setIsConfirmModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-black text-slate-600 bg-slate-100 hover:bg-slate-200"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={confirmSaving || !confirmRequestedAt}
                  onClick={handleSaveConfirmRequest}
                  className="px-4 py-2 rounded-xl text-xs font-black text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 shadow-sm"
                >
                  {confirmSaving ? '저장 중…' : '등록 완료'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 마스터 외주 거래명세표 등록 모달 */}
      {isMasterDashboard && isUploadModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <form
            onSubmit={handleUploadStatementSubmit}
            className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl border border-slate-200 space-y-5"
          >
            <div className="border-b border-slate-100 pb-3 flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <span>📑 외주 거래명세표 등록</span>
                </h3>
                <p className="mt-1 text-xs text-slate-500 font-bold leading-relaxed">
                  코너와 외주업체를 지정하여 이달의 거래명세표(PDF/Excel)를 등록합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* 코너(카테고리) 선택 */}
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-700">제작 코너 (분류)</label>
                <div className="grid grid-cols-2 gap-2">
                  {HISTORY_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setUploadCategory(cat.id);
                        setUploadVendorName('');
                        setUploadCustomVendor('');
                      }}
                      className={`px-3 py-2 rounded-xl text-xs font-black border transition-all flex items-center gap-1.5 ${
                        uploadCategory === cat.id
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <span>{cat.icon}</span>
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 외주업체명 선택/입력 */}
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-700">외주 업체명</label>
                <select
                  value={uploadVendorName}
                  onChange={(e) => setUploadVendorName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                >
                  <option value="">선택</option>
                  {vendorList.map((v) => (
                    <option key={v.id} value={v.label}>
                      {v.label} {v.priorityCategory ? `(${CATEGORY_LABEL[v.priorityCategory] || v.priorityCategory} 우선)` : ''}
                    </option>
                  ))}
                  <option value="__CUSTOM__">✏️ 직접 입력</option>
                </select>

                {uploadVendorName === '__CUSTOM__' && (
                  <input
                    type="text"
                    value={uploadCustomVendor}
                    onChange={(e) => setUploadCustomVendor(e.target.value)}
                    placeholder="외주업체명을 직접 입력하세요"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 mt-1"
                    autoFocus
                  />
                )}
                <p className="text-[11px] text-slate-400 font-bold">
                  * 업체별/차수별로 여러 개의 명세표 파일을 자유롭게 등록할 수 있습니다. (동일한 파일명인 경우에만 최신 파일로 교체)
                </p>
              </div>

              {/* 파일 선택 */}
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-700">명세표 파일 (PDF 또는 Excel)</label>
                <div
                  onClick={() => uploadFileInputRef.current?.click()}
                  className="border-2 border-dashed border-indigo-200 rounded-2xl p-5 text-center cursor-pointer hover:bg-indigo-50/30 transition-colors"
                >
                  <input
                    ref={uploadFileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.xlsx,.xls"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setUploadFile(f);
                    }}
                  />
                  {uploadFile ? (
                    <div className="space-y-1">
                      <span className="text-2xl">📄</span>
                      <p className="text-xs font-black text-indigo-700 font-mono truncate">
                        {uploadFile.name}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        ({(uploadFile.size / 1024).toFixed(1)} KB) - 클릭하여 변경
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-2xl text-slate-400">📁</span>
                      <p className="text-xs font-black text-slate-700">
                        클릭하여 명세표 파일 선택
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold">
                        PDF (.pdf) 또는 엑셀 (.xlsx, .xls)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={statementUploading}
                onClick={() => setIsUploadModalOpen(false)}
                className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-200 transition-colors"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={statementUploading || !uploadFile}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-5 py-2.5 text-xs font-black text-white shadow-sm transition-colors flex items-center gap-1.5"
              >
                {statementUploading ? '업로드 중...' : '명세표 등록 완료'}
              </button>
            </div>
          </form>
        </div>
      )}

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem as any}
          onClose={() => setDetailItem(null)}
        />
      )}

      <ProductionStatementCompareModal
        open={isCompareModalOpen}
        onClose={() => setIsCompareModalOpen(false)}
        selectedBatches={selectedBatchesForCompare}
        canEdit={canEdit}
        canEditRules={isMasterDashboard}
        apiPath={apiPath}
        categoryKey={activeCategory}
        categoryStatementFiles={currentCategoryStatementFiles}
        categoryName={CATEGORY_LABEL[activeCategory] || activeCategory}
        onSaved={fetchData}
      />
    </>
  );
}
