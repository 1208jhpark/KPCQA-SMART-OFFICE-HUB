'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import ProductionDeptShell from '@/components/asset/production/ProductionDeptShell';
import ProductionRequestDetailModal from '@/components/asset/production/ProductionRequestDetailModal';
import { getProductionCategoryBadgeClass, getProductionCategoryFolderTabClasses } from '@/lib/production-category-theme';
import { PRODUCTION_STATUS, productionStatusLabel, productionStatusTextClass } from '@/lib/production-status';
import {
  buildJebonOrderExcelRows,
  buildOfficeSuppliesOrderExcelRows,
  buildPrintOrderExcelRows,
  buildSignOrderExcelRows,
} from '@/lib/production-sign-excel';
import {
  applyProdMailTemplate,
  DEFAULT_PROD_MAIL_BODY,
  DEFAULT_PROD_MAIL_SUBJECT,
  resolveProdMailBodyTemplate,
  resolveProdMailSubjectTemplate,
} from '@/lib/production-mail-template';
import {
  isCustomerDirectShip,
  isVendorDispatched,
} from '@/lib/production-shipping';

const MENU_PATH = '/asset/production/dept-master/inspection';
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
  deptName: string;
  deptHead?: string;
  createdAt: string;
  finalPrice?: number;
  options?: Record<string, unknown>;
};

type OrderBatch = {
  id: string;
  status: string;
  totalCount: number;
  totalQuantity: number;
  vendors: string[];
  orderedAt: string | null;
  dispatchedAt?: string | null;
  items: BatchItem[];
};

type ProductionVendor = {
  id: string;
  label: string;
  managerName?: string;
  email?: string;
  items?: string;
  contact?: string;
};

type MailSettingsState = {
  mailShortcutUrl: string;
  subjectTemplate: string;
  bodyTemplate: string;
};

const EMPTY_VENDOR_FORM: {
  id?: string;
  label: string;
  managerName: string;
  email: string;
  items: string;
} = { label: '', managerName: '', email: '', items: '' };

function formatQuantityUnit(item: BatchItem) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'OFFICE_SUPPLIES') return '건';
  if (item.category === 'PRINT') {
    const label = (item.options as any)?.printItemMasterInfo?.unitLabel;
    if (label) return String(label);
  }
  return 'EA';
}

function formatBatchNo(id: string) {
  return id.replace(/^BATCH-/, '');
}

function getBatchLabelKind(
  batch: OrderBatch,
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

/** 발주 엑셀 파일명(확장자 제외) · 묶음 번호 UI 표시 — 분류별 접두어 */
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

function sanitizeExcelFilePart(value: string) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim();
  return cleaned || '미지정';
}

function resolveBatchCenterName(items: { deptName?: string }[]) {
  const names = Array.from(
    new Set(
      (items || [])
        .map((i) => String(i.deptName || '').trim())
        .filter(Boolean)
    )
  );
  if (names.length === 0) return '미지정';
  return names[0];
}

/** 발주서 다운로드 파일명: [현판]_발주서_소속센터_발주생성일 */
function formatOrderExcelDownloadName(
  kind: 'sign' | 'jebon' | 'print' | 'office' | 'other',
  items: { deptName?: string }[],
  orderedAt: string | null | undefined
) {
  const tag =
    kind === 'sign'
      ? '[현판]'
      : kind === 'jebon'
        ? '[제본]'
        : kind === 'print'
          ? '[기타제작물]'
          : kind === 'office'
            ? '[사무문구류]'
            : '[제작물]';
  const center = sanitizeExcelFilePart(resolveBatchCenterName(items));
  const date = sanitizeExcelFilePart(
    orderedAt ? getKSTDateString(orderedAt) : '미정'
  );
  return `${tag}_발주서_${center}_${date}`;
}

function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput == null) return null;
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return { year: String(ym.year), month: String(ym.month).padStart(2, '0') };
}

export default function DeptInspectionPanel() {
  const router = useRouter();
  const [batches, setBatches] = useState<OrderBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [batchPage, setBatchPage] = useState(1);
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<BatchItem | null>(null);
  const [emailBatch, setEmailBatch] = useState<OrderBatch | null>(null);
  const [vendors, setVendors] = useState<ProductionVendor[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [mailSettings, setMailSettings] = useState<MailSettingsState>({
    mailShortcutUrl: '',
    subjectTemplate: DEFAULT_PROD_MAIL_SUBJECT,
    bodyTemplate: DEFAULT_PROD_MAIL_BODY,
  });
  const [mailShortcutEditor, setMailShortcutEditor] = useState<string | null>(null);
  const [mailTemplateEditor, setMailTemplateEditor] = useState<{
    subjectTemplate: string;
    bodyTemplate: string;
  } | null>(null);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState(EMPTY_VENDOR_FORM);

  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [searchTitleQuery, setSearchTitleQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('SIGN');

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const fetchMailSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/asset/production/dept-master/mail-settings?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setMailSettings({
        mailShortcutUrl: String(data.mailShortcutUrl || '').trim(),
        subjectTemplate: resolveProdMailSubjectTemplate(data.subjectTemplate),
        bodyTemplate: resolveProdMailBodyTemplate(data.bodyTemplate),
      });
    } catch {
      /* ignore */
    }
  }, []);

  const fetchVendors = useCallback(async () => {
    try {
      const res = await fetch(`/api/asset/production/master/vendors?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      const rows = Array.isArray(data)
        ? data.map((v: any) => ({
            id: String(v.id),
            label: String(v.label || ''),
            managerName: String(v.managerName || ''),
            email: String(v.email || ''),
            items: String(v.items || ''),
            contact: String(v.contact || ''),
          }))
        : [];
      setVendors(rows);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, batchRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/production/dept-master/inspection?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);

      if (userRes.ok) setCurrentUser(await userRes.json());
      if (ifRes?.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH)
          : null;
        setInterfaceConfig(menu || null);
      }

      if (batchRes.ok) {
        const data = await batchRes.json();
        setBatches(Array.isArray(data.batches) ? data.batches : []);
      } else {
        const err = await batchRes.json().catch(() => ({}));
        alert(err.error || err.message || '발주 묶음을 불러오지 못했습니다.');
        setBatches([]);
      }
    } catch {
      alert('서버와 통신할 수 없습니다.');
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchVendors();
    fetchMailSettings();
  }, [fetchData, fetchVendors, fetchMailSettings]);

  const availableYears = useMemo(() => {
    const years = batches
      .map((b) => getKSTYearMonthParts(b.orderedAt)?.year)
      .filter((y): y is string => Boolean(y));
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const kstYear = String(getKSTNowYearMonth().year);
    if (!unique.includes(kstYear)) unique.unshift(kstYear);
    return unique;
  }, [batches]);

  const availableMonths = useMemo(() => {
    const base =
      selectedYear === 'ALL'
        ? batches
        : batches.filter((b) => getKSTYearMonthParts(b.orderedAt)?.year === selectedYear);
    const months = base
      .map((b) => getKSTYearMonthParts(b.orderedAt)?.month)
      .filter((m): m is string => Boolean(m));
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [batches, selectedYear]);

  const filteredBatches = useMemo(() => {
    const qUser = searchUserQuery.trim().toLowerCase();
    const qTitle = searchTitleQuery.trim().toLowerCase();
    return batches
      .map((b) => {
        const items =
          activeCategory === 'ALL'
            ? b.items || []
            : (b.items || []).filter((i) => i.category === activeCategory);
        return { ...b, items, totalCount: items.length };
      })
      .filter((b) => {
        if (b.items.length === 0) return false;
        const ym = getKSTYearMonthParts(b.orderedAt);
        const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
        const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
        const matchUser =
          !qUser || (b.items || []).some((i) => (i.userName || '').toLowerCase().includes(qUser));
        const matchTitle =
          !qTitle || (b.items || []).some((i) => (i.title || '').toLowerCase().includes(qTitle));
        return matchYear && matchMonth && matchUser && matchTitle;
      });
  }, [batches, selectedYear, selectedMonth, searchUserQuery, searchTitleQuery, activeCategory]);

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
      for (const b of batches) {
        const items = (b.items || []).filter((i) => i.category === catId);
        if (items.length === 0) continue;
        const ym = getKSTYearMonthParts(b.orderedAt);
        if (selectedYear !== 'ALL' && ym?.year !== selectedYear) continue;
        if (selectedMonth !== 'ALL' && ym?.month !== selectedMonth) continue;
        if (qUser && !items.some((i) => (i.userName || '').toLowerCase().includes(qUser))) {
          continue;
        }
        if (qTitle && !items.some((i) => (i.title || '').toLowerCase().includes(qTitle))) {
          continue;
        }
        counts[catId] += 1;
      }
    }
    return counts;
  }, [batches, selectedYear, selectedMonth, searchUserQuery, searchTitleQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / BATCH_PAGE_SIZE));
  const paginatedBatches = filteredBatches.slice(
    (batchPage - 1) * BATCH_PAGE_SIZE,
    batchPage * BATCH_PAGE_SIZE
  );

  useEffect(() => {
    setBatchPage(1);
    setSelectedBatchIds(new Set());
  }, [selectedYear, selectedMonth, searchUserQuery, searchTitleQuery, activeCategory]);

  /** 대상자·제목 검색 시 매칭 묶음 하위 상세(아코디언) 자동 펼침 */
  useEffect(() => {
    const qUser = searchUserQuery.trim();
    const qTitle = searchTitleQuery.trim();
    if (!qUser && !qTitle) {
      setExpandedBatchIds(new Set());
      return;
    }
    const start = (batchPage - 1) * BATCH_PAGE_SIZE;
    const pageIds = filteredBatches
      .slice(start, start + BATCH_PAGE_SIZE)
      .map((b) => b.id);
    setExpandedBatchIds(new Set(pageIds));
  }, [searchUserQuery, searchTitleQuery, batchPage, filteredBatches]);

  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const allPageBatchesSelected =
    paginatedBatches.length > 0 &&
    paginatedBatches.every((b) => selectedBatchIds.has(b.id));

  const handleSelectAllBatches = () => {
    const next = new Set(selectedBatchIds);
    if (allPageBatchesSelected) {
      paginatedBatches.forEach((b) => next.delete(b.id));
    } else {
      paginatedBatches.forEach((b) => next.add(b.id));
    }
    setSelectedBatchIds(next);
  };

  const handleSelectBatchRow = (id: string) => {
    const next = new Set(selectedBatchIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBatchIds(next);
  };

  const handleBatchExcel = (batch: OrderBatch) => {
    if (!canEdit) return alert('엑셀 저장 권한(Edit)이 없습니다.');

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
    const downloadName = (kind: 'sign' | 'jebon' | 'print' | 'office' | 'other') =>
      `${formatOrderExcelDownloadName(kind, exportItems, batch.orderedAt)}.xlsx`;

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
      XLSX.writeFile(wb, downloadName('sign'));
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
      XLSX.writeFile(wb, downloadName('jebon'));
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
      XLSX.writeFile(wb, downloadName('print'));
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
      XLSX.writeFile(wb, downloadName('office'));
      return;
    }

    const rows = exportItems.map((r, idx) => ({
      NO: idx + 1,
      관리번호: r.postNumber,
      신청일: getKSTDateString(r.createdAt),
      본부: r.deptHead || '',
      소속부서: r.deptName,
      신청자: r.userName,
      분류: CATEGORY_LABEL[r.category] || r.category,
      관리용제목: r.title,
      수량: `${r.quantity}${formatQuantityUnit(r)}`,
      외주업체: (r.options as any)?.vendor || '',
      상태: productionStatusLabel(r.status),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '제작발주');
    XLSX.writeFile(wb, downloadName(labelKind));
  };

  const handleCancelBatch = async (batch: OrderBatch) => {
    if (!canEdit) return alert('발주 취소 권한(Edit)이 없습니다.');
    if (batch.status === PRODUCTION_STATUS.VERIFIED) {
      return alert('수령완료된 묶음은 발주 취소할 수 없습니다. (보관함 이동 대상)');
    }
    if (
      !confirm(
        `[${formatBatchNo(batch.id)}] 발주를 취소하고 소속 건을 발주대기열로 되돌릴까요?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/asset/production/dept-master/inspection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel-batch', batchId: batch.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '발주 취소에 실패했습니다.');
        return;
      }
      alert(data.message || '발주를 취소했습니다.');
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  const handleConfirmDispatch = async (batch: OrderBatch) => {
    if (!canEdit) return alert('발주완료 권한(Edit)이 없습니다.');
    if (
      !confirm(
        `[${formatBatchNo(batch.id)}] 외주 발주완료 처리할까요?\n(엑셀·메일 발송 후 눌러 주세요)\n고객사 직발송 건은 수령검수를 생략합니다.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/asset/production/dept-master/inspection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm-dispatch', batchId: batch.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '발주완료 처리에 실패했습니다.');
        return;
      }
      alert(data.message || '발주완료 처리되었습니다.');
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  const handleConfirmReceive = async (item: BatchItem) => {
    if (!canEdit) return alert('수령완료 권한(Edit)이 없습니다.');
    if (
      !confirm(`[${item.postNumber}] 수령완료 처리할까요?`)
    ) {
      return;
    }
    try {
      const res = await fetch('/api/asset/production/dept-master/inspection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm-receive', requestId: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '수령완료 처리에 실패했습니다.');
        return;
      }
      alert(data.message || '수령완료 처리되었습니다.');
      await fetchData();
    } catch {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  const handleArchiveBatch = async (batch: OrderBatch) => {
    if (!canEdit) return alert('보관함 이동 권한(Edit)이 없습니다.');
    if (batch.status !== PRODUCTION_STATUS.VERIFIED) {
      return alert('수령완료된 묶음만 보관함으로 이동할 수 있습니다.');
    }
    if (!confirm(`[${formatBatchNo(batch.id)}] 검수 완료 보관함으로 이동할까요?`)) return;
    try {
      const res = await fetch('/api/asset/production/dept-master/inspection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive-batch', batchId: batch.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '보관함 이동에 실패했습니다.');
        return;
      }
      alert(data.message || '보관함으로 이동했습니다.');
      await fetchData();
      if (confirm('검수 완료 보관함으로 이동할까요?')) {
        router.push('/asset/production/dept-master/archive');
      }
    } catch {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  const getBatchDispatchState = (batch: OrderBatch) => {
    const items = batch.items || [];
    if (items.length === 0) return { allDispatched: false, anyDispatched: false };
    const flags = items.map((i) => isVendorDispatched(i.options || {}));
    return {
      allDispatched: flags.every(Boolean),
      anyDispatched: flags.some(Boolean),
    };
  };

  const getBatchReceiveSummary = (batch: OrderBatch) => {
    const items = batch.items || [];
    const direct = items.filter((i) => isCustomerDirectShip(i)).length;
    const received = items.filter((i) => i.status === PRODUCTION_STATUS.VERIFIED).length;
    const pendingReceive = items.filter(
      (i) =>
        i.status === PRODUCTION_STATUS.ORDERED &&
        isVendorDispatched(i.options || {}) &&
        !isCustomerDirectShip(i)
    ).length;
    return { direct, received, pendingReceive, total: items.length };
  };

  const openEmailModal = (batch: OrderBatch) => {
    setEmailBatch(batch);
    const batchVendorNames = (batch.vendors || []).map((v) => String(v || '').trim()).filter(Boolean);
    const matched =
      vendors.find((v) => batchVendorNames.includes(v.label)) ||
      vendors.find((v) =>
        batchVendorNames.some((name) => name.includes(v.label) || v.label.includes(name))
      ) ||
      vendors[0];
    setSelectedVendorId(matched?.id || '');
  };

  const activeVendor = useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) || vendors[0] || null,
    [vendors, selectedVendorId]
  );

  const emailBatchLabel = emailBatch
    ? formatBatchExcelBaseName(
        emailBatch.id,
        batchLabelOpts(getBatchLabelKind(emailBatch, activeCategory))
      )
    : '';

  const emailSubject = emailBatch
    ? applyProdMailTemplate(mailSettings.subjectTemplate, {
        batchNo: emailBatchLabel,
        count: emailBatch.totalCount,
        vendorName: activeVendor?.label,
        vendorManager: activeVendor?.managerName,
      })
    : '';

  const emailBody = emailBatch
    ? applyProdMailTemplate(mailSettings.bodyTemplate, {
        batchNo: emailBatchLabel,
        count: emailBatch.totalCount,
        vendorName: activeVendor?.label,
        vendorManager: activeVendor?.managerName,
      })
    : '';

  const copyEmailPreview = async () => {
    if (!emailBatch) return;
    try {
      const vendorEmail = activeVendor?.email?.trim() || '';
      await navigator.clipboard.writeText(
        [
          vendorEmail ? `수신 메일: ${vendorEmail}` : '수신 메일: (업체 이메일 없음)',
          `제목: ${emailSubject}`,
          '',
          emailBody,
        ].join('\n')
      );
      alert('수신 메일·제목·본문이 복사되었습니다.\n사내 그룹웨어 메일 창에 붙여넣기(Ctrl+V) 해주세요.');
    } catch {
      alert('복사에 실패했습니다. 내용을 직접 드래그해서 복사해 주세요.');
    }
  };

  const handleOpenMailShortcut = () => {
    const url = String(mailSettings.mailShortcutUrl || '').trim();
    if (!url) {
      alert('메일 바로가기 경로가 비어 있습니다.\n⚙ 설정에서 그룹웨어 메일 작성 URL을 먼저 저장해 주세요.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSaveMailShortcut = async () => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    if (mailShortcutEditor == null) return;
    const next = mailShortcutEditor.trim();
    try {
      const res = await fetch('/api/asset/production/dept-master/mail-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailShortcutUrl: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '저장 실패');
      setMailSettings((prev) => ({
        ...prev,
        mailShortcutUrl: String(data.mailShortcutUrl || next).trim(),
        subjectTemplate: resolveProdMailSubjectTemplate(data.subjectTemplate || prev.subjectTemplate),
        bodyTemplate: resolveProdMailBodyTemplate(data.bodyTemplate || prev.bodyTemplate),
      }));
      setMailShortcutEditor(null);
    } catch (error: any) {
      alert(`서버 저장에 실패했습니다.\n${error.message || ''}`);
    }
  };

  const handleSaveMailTemplates = async () => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    if (!mailTemplateEditor) return;
    try {
      const res = await fetch('/api/asset/production/dept-master/mail-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectTemplate: mailTemplateEditor.subjectTemplate,
          bodyTemplate: mailTemplateEditor.bodyTemplate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '저장 실패');
      setMailSettings((prev) => ({
        ...prev,
        mailShortcutUrl: String(data.mailShortcutUrl ?? prev.mailShortcutUrl).trim(),
        subjectTemplate: resolveProdMailSubjectTemplate(data.subjectTemplate),
        bodyTemplate: resolveProdMailBodyTemplate(data.bodyTemplate),
      }));
      setMailTemplateEditor(null);
      alert('부서 메일 양식이 저장되었습니다.');
    } catch (error: any) {
      alert(`서버 저장에 실패했습니다.\n${error.message || ''}`);
    }
  };

  const handleCreateVendor = async () => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    if (!vendorForm.label.trim()) return alert('업체명을 입력하세요.');
    try {
      const res = await fetch('/api/asset/production/master/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: vendorForm.label.trim(),
          managerName: vendorForm.managerName.trim(),
          email: vendorForm.email.trim(),
          items: vendorForm.items.trim(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || '등록 실패');
      const saved = payload.data || payload;
      const next: ProductionVendor = {
        id: String(saved.id),
        label: String(saved.label || vendorForm.label),
        managerName: String(saved.managerName || ''),
        email: String(saved.email || ''),
        items: String(saved.items || ''),
        contact: String(saved.contact || ''),
      };
      setVendors((prev) =>
        [...prev, next].sort((a, b) => a.label.localeCompare(b.label, 'ko'))
      );
      setSelectedVendorId(next.id);
      setVendorForm(EMPTY_VENDOR_FORM);
    } catch (error: any) {
      alert(error.message || '등록 실패');
    }
  };

  const handleUpdateVendor = async () => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    if (!vendorForm.id) return;
    if (!vendorForm.label.trim()) return alert('업체명을 입력하세요.');
    try {
      const res = await fetch('/api/asset/production/master/vendors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: vendorForm.id,
          label: vendorForm.label.trim(),
          managerName: vendorForm.managerName.trim(),
          email: vendorForm.email.trim(),
          items: vendorForm.items.trim(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || '수정 실패');
      const saved = payload.data || payload;
      setVendors((prev) =>
        prev
          .map((v) =>
            v.id === vendorForm.id
              ? {
                  ...v,
                  label: String(saved.label || vendorForm.label),
                  managerName: String(saved.managerName || ''),
                  email: String(saved.email || ''),
                  items: String(saved.items || ''),
                }
              : v
          )
          .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
      );
      setVendorForm(EMPTY_VENDOR_FORM);
      alert('업체 정보가 성공적으로 수정되었습니다.');
    } catch (error: any) {
      alert(error.message || '수정 실패');
    }
  };

  const handleDeleteVendor = async (vendor: ProductionVendor) => {
    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
    if (
      !confirm(
        `[${vendor.label}] 업체를 삭제할까요?\n발주 이력은 그대로 남습니다.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/asset/production/master/vendors?id=${encodeURIComponent(vendor.id)}`,
        { method: 'DELETE' }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || '삭제 실패');
      const remain = vendors.filter((item) => item.id !== vendor.id);
      setVendors(remain);
      if (selectedVendorId === vendor.id) {
        setSelectedVendorId(remain[0]?.id || '');
      }
      if (vendorForm.id === vendor.id) setVendorForm(EMPTY_VENDOR_FORM);
    } catch (error: any) {
      alert(error.message || '삭제 실패');
    }
  };

  return (
    <ProductionDeptShell pageHint="부서 묶음 발주 건을 외주 발주 묶음 대장으로 관리합니다. 엑셀 저장·메일 복사 → 명세 대조 → 보관함 이동.">
      <div className="w-full">
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

      <div className="bg-white border border-t-0 border-indigo-200 rounded-b-[2.5rem] rounded-tr-2xl shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-indigo-50 border-b border-indigo-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 mt-1.5 shrink-0" />
            <div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">
                외주 발주 묶음 관리 대장
              </h2>
              <p className="text-[11px] text-indigo-700/70 font-bold mt-1">
                엑셀 저장·메일 복사(그룹웨어 첨부) → 발주완료 → 수령완료 → 보관함 이동
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative group/filter flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-indigo-200 shadow-sm h-7 box-border">
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
            <table className="w-full table-fixed text-left border-collapse">
              <colgroup>
                <col style={{ width: '3%' }} />
                <col style={{ width: '3%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead className="bg-indigo-100 text-indigo-900 text-[10px] font-black uppercase tracking-widest border-b border-indigo-200">
                <tr>
                  <th className="h-12 px-2">
                    <input
                      type="checkbox"
                      onChange={handleSelectAllBatches}
                      checked={allPageBatchesSelected}
                      className="w-3 h-3 accent-indigo-600 cursor-pointer"
                    />
                  </th>
                  <th className="h-12 px-1 text-center">NO</th>
                  <th className="h-12 px-2 whitespace-nowrap">묶음 번호</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">발주 생성일</th>
                  <th className="h-12 px-2 whitespace-nowrap">외주업체</th>
                  <th className="h-12 px-1 text-center whitespace-nowrap">총 수량</th>
                  <th className="h-12 px-2 whitespace-nowrap">신청 상세</th>
                  <th className="h-12 px-1 text-center whitespace-nowrap">발주서(엑셀)</th>
                  <th className="h-12 px-1 text-center whitespace-nowrap">메일 양식(복사)</th>
                  <th className="h-12 px-1 text-center whitespace-nowrap">발주 완료</th>
                  <th className="h-12 px-1 text-center whitespace-nowrap">수령 검수</th>
                  <th className="h-12 px-1 text-center">
                    <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                      <span className="whitespace-nowrap">보관함 이동</span>
                      <span className="text-[10px] font-bold text-indigo-700/80 normal-case tracking-normal whitespace-nowrap">
                        (수령 완료 후)
                      </span>
                    </div>
                  </th>
                  <th className="h-12 px-1 text-center whitespace-nowrap">발주 취소</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-16 text-center text-slate-400 text-[11px] font-bold">
                      발주 묶음이 없습니다. 발주 관리 탭에서 접수 후 묶음 발주해 주세요.
                    </td>
                  </tr>
                ) : (
                  paginatedBatches.map((batch, idx) => {
                    const rowNo =
                      filteredBatches.length - ((batchPage - 1) * BATCH_PAGE_SIZE + idx);
                    return (
                    <React.Fragment key={batch.id}>
                      <tr
                        className={`h-16 transition-colors ${
                          selectedBatchIds.has(batch.id)
                            ? 'bg-indigo-50/50'
                            : 'hover:bg-indigo-50/40'
                        }`}
                      >
                        <td className="px-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.has(batch.id)}
                            onChange={() => handleSelectBatchRow(batch.id)}
                            className="w-3 h-3 accent-indigo-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-2 text-center font-mono text-slate-500 tabular-nums">
                          {rowNo}
                        </td>
                        <td
                          className="px-2 font-mono text-indigo-600 cursor-pointer whitespace-nowrap tabular-nums truncate overflow-hidden"
                          title={formatBatchExcelBaseName(
                            batch.id,
                            batchLabelOpts(getBatchLabelKind(batch, activeCategory))
                          )}
                          onClick={() => toggleBatchExpand(batch.id)}
                        >
                          {formatBatchExcelBaseName(
                            batch.id,
                            batchLabelOpts(getBatchLabelKind(batch, activeCategory))
                          )}
                        </td>
                        <td className="px-4 text-center font-mono text-slate-800 tabular-nums whitespace-nowrap">
                          {batch.orderedAt ? getKSTDateString(batch.orderedAt) : '-'}
                        </td>
                        <td
                          className="px-4 text-slate-700 truncate overflow-hidden"
                          title={(batch.vendors || []).join(', ') || ''}
                        >
                          {(batch.vendors || []).join(', ') || '-'}
                        </td>
                        <td className="px-2 text-center text-indigo-700 tabular-nums whitespace-nowrap">
                          {batch.items?.length || 0} 건
                        </td>
                        <td
                          className="px-4 cursor-pointer"
                          onClick={() => toggleBatchExpand(batch.id)}
                        >
                          <span className="text-indigo-600 underline underline-offset-2">
                            상세보기
                          </span>
                        </td>
                        <td className="px-2 text-center whitespace-nowrap">
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={() => handleBatchExcel(batch)}
                            className={`px-2.5 py-1 text-[10px] font-black rounded-lg w-full whitespace-nowrap transition-colors ${
                              canEdit
                                ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            📥 발주서 다운로드
                          </button>
                        </td>
                        <td className="px-2 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEmailModal(batch)}
                            className="px-2.5 py-1 text-[10px] font-black rounded-lg w-full whitespace-nowrap transition-colors bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200"
                          >
                            📋텍스트 복사
                          </button>
                        </td>
                        <td className="px-2 text-center">
                          {(() => {
                            const { allDispatched } = getBatchDispatchState(batch);
                            if (allDispatched) {
                              const dateLabel = batch.dispatchedAt
                                ? getKSTDateString(batch.dispatchedAt)
                                : null;
                              return (
                                <span className="inline-flex flex-col items-center gap-0.5 text-[10px] font-bold text-emerald-700 leading-tight">
                                  <span>발주 완료</span>
                                  {dateLabel ? (
                                    <span className="font-mono tabular-nums text-emerald-600/90">
                                      ({dateLabel})
                                    </span>
                                  ) : null}
                                </span>
                              );
                            }
                            return (
                              <button
                                type="button"
                                disabled={!canEdit}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={() => handleConfirmDispatch(batch)}
                                className={`px-2 py-1 text-[10px] font-black rounded-lg w-full whitespace-nowrap transition-colors ${
                                  canEdit
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                → 발주 완료
                              </button>
                            );
                          })()}
                        </td>
                        <td className="px-2 text-center">
                          {(() => {
                            const sum = getBatchReceiveSummary(batch);
                            if (sum.total > 0 && sum.received === sum.total) {
                              return (
                                <span className="text-[10px] font-bold text-emerald-600 whitespace-nowrap">
                                  수령 완료 {sum.received}/{sum.total}
                                </span>
                              );
                            }
                            if (sum.direct === sum.total && sum.total > 0) {
                              return (
                                <span className="text-[10px] font-bold text-indigo-600 whitespace-nowrap">
                                  고객사 직발송
                                </span>
                              );
                            }
                            return (
                              <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">
                                수령 {sum.received}/{sum.total}
                                {sum.pendingReceive > 0 ? (
                                  <span className="text-red-600">
                                    {` · 대기 ${sum.pendingReceive}`}
                                  </span>
                                ) : null}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-2 text-center">
                          {batch.status === PRODUCTION_STATUS.VERIFIED ? (
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={!canEdit ? '편집 권한 필요' : undefined}
                              onClick={() => handleArchiveBatch(batch)}
                              className={`px-2 py-1 text-[10px] font-black rounded-lg shadow-sm w-full whitespace-nowrap transition-colors ${
                                canEdit
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              → 검수 완료 보관함 이동
                            </button>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 text-center whitespace-nowrap">
                          {batch.status === PRODUCTION_STATUS.ORDERED ? (
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={!canEdit ? '편집 권한 필요' : undefined}
                              onClick={() => handleCancelBatch(batch)}
                              className={`px-2 py-1 text-[10px] font-black rounded-lg w-full whitespace-nowrap transition-colors ${
                                canEdit
                                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              발주 취소
                            </button>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-300">—</span>
                          )}
                        </td>
                      </tr>

                      {expandedBatchIds.has(batch.id) && (
                        <tr>
                          <td className="w-[50px] bg-indigo-50/60 border-b border-indigo-100" />
                          <td className="w-[48px] bg-indigo-50/60 border-b border-indigo-100" />
                          <td
                            colSpan={11}
                            className="bg-indigo-50/60 py-3 pr-4 pl-0 border-b border-indigo-100 border-l-4 border-l-indigo-400"
                          >
                            <div className="bg-white border border-indigo-100 rounded-2xl overflow-hidden shadow-sm">
                              <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50 text-slate-600 text-[10px] font-black tracking-widest border-b border-slate-200">
                                  <tr>
                                    <th className="h-10 px-2 w-[48px] text-center">NO</th>
                                    <th className="h-10 px-2 w-[110px] text-center whitespace-nowrap">
                                      관리번호
                                    </th>
                                    <th className="h-10 px-2 w-[96px] text-center whitespace-nowrap">
                                      신청일
                                    </th>
                                    <th className="h-10 px-2">본부 (상위 조직)</th>
                                    <th className="h-10 px-2">센터 (하위 조직)</th>
                                    <th className="h-10 px-2">대상자</th>
                                    <th className="h-10 px-2 text-center whitespace-nowrap">
                                      분류
                                    </th>
                                    <th className="h-10 px-2">관리용 제목</th>
                                    <th className="h-10 px-2 text-center w-[72px] whitespace-nowrap">
                                      수량
                                    </th>
                                    <th className="h-10 px-2 text-center w-[120px] whitespace-nowrap">
                                      원문 확인
                                    </th>
                                    <th className="h-10 px-2 text-center w-[120px] whitespace-nowrap">
                                      수령 검수
                                    </th>
                                    <th className="h-10 px-2 text-center w-[96px] whitespace-nowrap">
                                      상태
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                                  {batch.items?.map((item, idx) => (
                                    <tr
                                      key={item.id}
                                      className="h-12 hover:bg-slate-50/50 transition-colors"
                                    >
                                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums">
                                        {idx + 1}
                                      </td>
                                      <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate">
                                        {item.postNumber}
                                      </td>
                                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                                        {getKSTDateString(item.createdAt)}
                                      </td>
                                      <td
                                        className="px-2 truncate"
                                        title={item.deptHead || ''}
                                      >
                                        {item.deptHead || '-'}
                                      </td>
                                      <td
                                        className="px-2 truncate"
                                        title={item.deptName || ''}
                                      >
                                        {item.deptName || (
                                          <span className="text-slate-300">-</span>
                                        )}
                                      </td>
                                      <td className="px-2 text-slate-800 truncate">
                                        {item.userName || '-'}
                                      </td>
                                      <td className="px-2 text-center">
                                        <span
                                          className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-tight border ${getProductionCategoryBadgeClass(item.category)}`}
                                        >
                                          {CATEGORY_LABEL[item.category] || item.category}
                                        </span>
                                      </td>
                                      <td
                                        className="px-2 text-slate-800 truncate"
                                        title={item.title || ''}
                                      >
                                        {item.title || '-'}
                                      </td>
                                      <td className="px-2 text-center">
                                        <span className="font-mono tabular-nums">{item.quantity}</span>
                                        <span className="ml-0.5 text-[10px] font-medium text-slate-500">
                                          {formatQuantityUnit(item)}
                                        </span>
                                      </td>
                                      <td className="px-2 text-center">
                                        <button
                                          type="button"
                                          onClick={() => setDetailItem(item)}
                                          className="px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300"
                                        >
                                          원문 확인
                                        </button>
                                      </td>
                                      <td className="px-2 text-center">
                                        {(() => {
                                          const direct = isCustomerDirectShip(item);
                                          const dispatched = isVendorDispatched(item.options || {});
                                          if (direct) {
                                            return (
                                              <span className="text-[10px] font-bold text-indigo-600 whitespace-nowrap">
                                                고객사 직발송
                                              </span>
                                            );
                                          }
                                          if (item.status === PRODUCTION_STATUS.VERIFIED) {
                                            return (
                                              <span className="text-[10px] font-bold text-emerald-600 whitespace-nowrap">
                                                수령 완료
                                              </span>
                                            );
                                          }
                                          if (!dispatched) {
                                            return (
                                              <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
                                                발주 완료 대기
                                              </span>
                                            );
                                          }
                                          return (
                                            <button
                                              type="button"
                                              disabled={!canEdit}
                                              title={!canEdit ? '편집 권한 필요' : undefined}
                                              onClick={() => handleConfirmReceive(item)}
                                              className={`px-2.5 py-1 text-[10px] font-black rounded-lg whitespace-nowrap transition-colors ${
                                                canEdit
                                                  ? 'bg-red-600 hover:bg-red-700 text-white'
                                                  : DISABLED_ACTION_BTN
                                              }`}
                                            >
                                              수령 대기→완료
                                            </button>
                                          );
                                        })()}
                                      </td>
                                      <td className="px-2 text-center">
                                        <span
                                          className={`text-[10px] font-bold whitespace-nowrap ${productionStatusTextClass(item.status)}`}
                                        >
                                          {productionStatusLabel(item.status)}
                                        </span>
                                      </td>
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
          )}
        </div>

        {!loading && filteredBatches.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button
              type="button"
              disabled={batchPage === 1}
              onClick={() => setBatchPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
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
              disabled={batchPage === totalPages}
              onClick={() => setBatchPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>
      </div>

      {emailBatch && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-4xl w-full p-8 space-y-6">
            <div className="border-b border-slate-100 pb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex-1">
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  📋 그룹웨어 발송용 메일 양식 미리보기
                </h2>
                <p className="text-xs text-slate-500 font-bold mt-2 leading-relaxed">
                  수신 업체를 선택하면 본문이 자동으로 변경됩니다.
                  <br />
                  복사 후 그룹웨어에 붙여넣으세요. 제목·본문 양식은 부서 설정에서 수정할 수 있습니다.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={selectedVendorId}
                  onChange={(e) => setSelectedVendorId(e.target.value)}
                  className="bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-black py-2.5 px-3 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 w-48 cursor-pointer"
                >
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.label}
                      {vendor.managerName ? ` (${vendor.managerName})` : ''}
                    </option>
                  ))}
                  {vendors.length === 0 && <option value="">등록된 업체 없음</option>}
                </select>
                <button
                  type="button"
                  disabled={!canEdit}
                  title={!canEdit ? '편집 권한 필요' : undefined}
                  onClick={() => {
                    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
                    setMailTemplateEditor({
                      subjectTemplate: mailSettings.subjectTemplate,
                      bodyTemplate: mailSettings.bodyTemplate,
                    });
                  }}
                  className={`px-4 py-2.5 font-black text-xs rounded-xl transition-colors whitespace-nowrap shadow-sm ${
                    canEdit
                      ? 'bg-slate-800 text-white hover:bg-slate-900'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  ⚙️ 양식 설정
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  title={!canEdit ? '편집 권한 필요' : undefined}
                  onClick={() => {
                    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
                    setVendorForm(EMPTY_VENDOR_FORM);
                    setIsVendorModalOpen(true);
                  }}
                  className={`px-4 py-2.5 font-black text-xs rounded-xl transition-colors whitespace-nowrap shadow-sm ${
                    canEdit
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
                <label className="block text-xs font-black text-slate-500 mb-1.5 ml-1">
                  담당자 이메일
                </label>
                <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-800 select-all cursor-text">
                  {activeVendor?.email?.trim() || (
                    <span className="text-slate-400">선택한 업체 이메일이 없습니다.</span>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 mb-1.5 ml-1">
                  메일 제목 (클릭 시 자동 선택)
                </label>
                <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-800 select-all cursor-text">
                  {emailSubject}
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 mb-1.5 ml-1">
                  메일 본문 (클릭 시 자동 선택)
                </label>
                <textarea
                  readOnly
                  rows={10}
                  value={emailBody}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 whitespace-pre-wrap resize-none focus:outline-none select-all cursor-text"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
              <button
                type="button"
                onClick={() => setEmailBatch(null)}
                className="px-5 py-2.5 bg-slate-100 font-black text-xs rounded-xl hover:bg-slate-200 text-slate-700 transition-colors"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={copyEmailPreview}
                className="px-6 py-2.5 bg-indigo-600 text-white font-black text-xs rounded-xl hover:bg-indigo-700 shadow-md transition-colors"
              >
                📝 메일·제목·본문 전체 복사하기
              </button>
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
                  disabled={!canEdit}
                  title={!canEdit ? '편집 권한 필요' : undefined}
                  onClick={() => {
                    if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
                    setMailShortcutEditor(mailSettings.mailShortcutUrl);
                  }}
                  className={`px-3 py-2.5 font-black text-xs rounded-r-xl shadow-md border-l border-slate-600 ${
                    canEdit ? 'bg-slate-700 text-white hover:bg-slate-600' : DISABLED_ACTION_BTN
                  }`}
                >
                  ⚙
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mailShortcutEditor != null && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-black text-slate-900">메일 바로가기 경로 설정</h3>
            <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-500">
              그룹웨어 메일 작성 화면 주소를 붙여넣으세요. 이 부서 설정으로 저장됩니다.
            </p>
            <input
              type="text"
              value={mailShortcutEditor}
              onChange={(e) => setMailShortcutEditor(e.target.value)}
              className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400"
              placeholder="https://사내그룹웨어/mail/..."
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMailShortcutEditor(null)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveMailShortcut}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {isVendorModalOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-5xl w-full p-8 space-y-6">
            <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  ⚙️ 외주업체 마스터 데이터 관리
                </h2>
                <p className="text-xs text-slate-500 font-bold mt-1">
                  제작물 외주 협력사 정보를 관리합니다. 명함 업체와는 별도이며, 사용하지 않는
                  업체는 삭제할 수 있고 발주 이력은 그대로 남습니다.
                </p>
              </div>
              {vendorForm.id && (
                <span className="bg-amber-100 text-amber-800 text-[11px] font-black px-3 py-1 rounded-lg animate-pulse">
                  ✏️ 현재 업체 정보 수정 중
                </span>
              )}
            </div>

            <div
              className={`flex flex-wrap gap-2 items-end p-4 rounded-2xl border transition-all ${
                vendorForm.id ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">
                  업체명
                </label>
                <input
                  type="text"
                  value={vendorForm.label}
                  onChange={(e) => setVendorForm({ ...vendorForm, label: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white"
                  placeholder="업체명을 작성하세요"
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">
                  담당자명/직급
                </label>
                <input
                  type="text"
                  value={vendorForm.managerName}
                  onChange={(e) => setVendorForm({ ...vendorForm, managerName: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white"
                  placeholder="ex) 홍길동 팀장 / 담당자"
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={vendorForm.email}
                  onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white"
                  placeholder="print@..."
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">
                  비고
                </label>
                <input
                  type="text"
                  value={vendorForm.items}
                  onChange={(e) => setVendorForm({ ...vendorForm, items: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white"
                  placeholder="자유 기재"
                />
              </div>
              <div className="flex gap-1">
                {vendorForm.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setVendorForm(EMPTY_VENDOR_FORM)}
                      className="px-3 py-2 h-[34px] bg-slate-200 text-slate-700 font-black text-xs rounded-lg hover:bg-slate-300"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleUpdateVendor}
                      className="px-4 py-2 h-[34px] bg-amber-500 text-white font-black text-xs rounded-lg hover:bg-amber-600 shadow-sm"
                    >
                      수정 완료
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleCreateVendor}
                    className="px-5 py-2 h-[34px] bg-indigo-600 text-white font-black text-xs rounded-lg hover:bg-indigo-700 shadow-sm"
                  >
                    신규 등록
                  </button>
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
                  {vendors.map((v) => (
                    <tr
                      key={v.id}
                      className={`hover:bg-slate-50 ${vendorForm.id === v.id ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="p-3 pl-4 font-black text-slate-900">{v.label}</td>
                      <td className="p-3">{v.managerName || '-'}</td>
                      <td className="p-3 font-mono text-slate-500">{v.email || '-'}</td>
                      <td
                        className="p-3 text-slate-500 max-w-[180px] truncate"
                        title={v.items || ''}
                      >
                        {v.items || <span className="text-slate-300">-</span>}
                      </td>
                      <td className="p-3 pr-4 text-center">
                        <div className="flex justify-center gap-1">
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={() => {
                              if (!canEdit) return alert('편집 권한(Edit)이 없습니다.');
                              setVendorForm({
                                id: v.id,
                                label: v.label || '',
                                managerName: v.managerName || '',
                                email: v.email || '',
                                items: v.items || '',
                              });
                            }}
                            className={`px-2.5 py-1 rounded-md text-[10px] border ${
                              canEdit
                                ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            ✏️ 수정
                          </button>
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={() => handleDeleteVendor(v)}
                            className={`px-2.5 py-1 rounded-md text-[10px] border ${
                              canEdit
                                ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {vendors.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-400">
                        등록된 업체가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsVendorModalOpen(false);
                  setVendorForm(EMPTY_VENDOR_FORM);
                }}
                className="px-6 py-2.5 bg-slate-900 text-white font-black text-xs rounded-xl hover:bg-black transition-colors"
              >
                닫기 및 적용
              </button>
            </div>
          </div>
        </div>
      )}

      {mailTemplateEditor && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-black text-slate-900">부서 메일 양식 설정</h3>
              <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-500">
                플레이스홀더: {'{{BATCH_NO}}'}(묶음번호), {'{{COUNT}}'}(건수),{' '}
                {'{{VENDOR_NAME}}'}(업체명), {'{{VENDOR_MANAGER}}'}(담당자)
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">제목 양식</label>
              <input
                type="text"
                value={mailTemplateEditor.subjectTemplate}
                onChange={(e) =>
                  setMailTemplateEditor({
                    ...mailTemplateEditor,
                    subjectTemplate: e.target.value,
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">본문 양식</label>
              <textarea
                rows={12}
                value={mailTemplateEditor.bodyTemplate}
                onChange={(e) =>
                  setMailTemplateEditor({
                    ...mailTemplateEditor,
                    bodyTemplate: e.target.value,
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400 whitespace-pre-wrap"
              />
            </div>
            <div className="flex justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setMailTemplateEditor({
                    subjectTemplate: DEFAULT_PROD_MAIL_SUBJECT,
                    bodyTemplate: DEFAULT_PROD_MAIL_BODY,
                  })
                }
                className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-600"
              >
                기본값 불러오기
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMailTemplateEditor(null)}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-600"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveMailTemplates}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailItem && (
        <ProductionRequestDetailModal
          item={detailItem as any}
          onClose={() => setDetailItem(null)}
          allowEdit={false}
        />
      )}
    </ProductionDeptShell>
  );
}
