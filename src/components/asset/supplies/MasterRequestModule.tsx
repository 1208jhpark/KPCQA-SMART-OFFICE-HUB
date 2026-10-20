'use client';
import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth, formatKSTDateTime } from '@/utils/dateUtils';
import {
  isCompletedSupplyRequest,
  isPendingSupplyRequest,
  isReadySupplyRequest,
  isRejectedSupplyRequest,
  isCancelledSupplyRequest,
  supplyRequestStatusLabel,
  type SupplyRequestStatus,
} from '@/utils/supplyRequestStatus';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
import { resolveInterfaceEditState, isSystemLv1User } from '@/lib/permission-utils';
import {
  SUPPLIES_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';
import * as XLSX from 'xlsx';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';

const MENU_PATH = '/asset/supplies/master/requests';

/** 마케팅 예약대기 취소와 동일 — 드롭다운 고정 사유 · 자유 입력 없음 */
const CANCEL_REASON_OPTIONS = [
  '재고부족',
  '물품단종',
  '입고지연',
  '물품불량/파손',
  '중복신청',
  '기타',
] as const;

const FOLDER_TAB_IDLE =
  'bg-slate-100 text-slate-500 border-slate-200 border-b-transparent hover:bg-slate-50 hover:text-slate-700';

const FOLDER_TABS = [
  {
    id: 'ACTIVE' as const,
    label: '접수 대기',
    icon: '📄',
    activeClass:
      'bg-slate-900 text-white border-slate-900 border-b-white z-10 -mb-px',
  },
  {
    id: 'COMPLETED' as const,
    label: '처리 완료 내역',
    icon: '✅',
    activeClass:
      'bg-emerald-600 text-white border-emerald-500 border-b-white z-10 -mb-px shadow-sm',
  },
];

type LedgerFolder = (typeof FOLDER_TABS)[number]['id'];

function isBoldOrgType(unitType?: string | null) {
  const t = String(unitType || '').trim().toUpperCase();
  return t === 'ORGANIZATION' || t === 'HQ';
}

function normalizeOrgUnitType(unitType?: string | null) {
  return String(unitType || '').trim().toUpperCase();
}

/** admin/units sort_order 기준 정렬 (하드코딩 없음) */
function sortUnitsByOrder<T extends { sort_order?: number | null; unit_name?: string | null }>(
  units: T[]
) {
  return [...units].sort((a, b) => {
    const ao = Number(a.sort_order) || 0;
    const bo = Number(b.sort_order) || 0;
    if (ao !== bo) return ao - bo;
    return String(a.unit_name || '').localeCompare(String(b.unit_name || ''), 'ko');
  });
}

/** 특정 조직의 하위(재귀) 조직명 집합 */
function collectDescendantUnitNames(
  rootId: string,
  units: Array<{ id: string; unit_name?: string | null; parent_id?: string | null }>
) {
  const names = new Set<string>();
  const walk = (parentId: string) => {
    for (const child of units.filter((u) => u.parent_id === parentId)) {
      const n = String(child.unit_name || '').trim();
      if (n) names.add(n);
      walk(child.id);
    }
  };
  walk(rootId);
  return names;
}

type ChartOrgMode = 'CENTER' | 'HQ';

function flattenUnitsInSortOrder<T extends { id: string; parent_id?: string | null; sort_order?: number | null; unit_name?: string | null }>(units: T[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depthOf = (unit: T) => {
    let depth = 0;
    let current: T | undefined = unit;
    const seen = new Set<string>();
    while (current?.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parent_id);
    }
    return depth;
  };
  return [...units]
    .sort((a, b) => {
      const ao = Number(a.sort_order) || 0;
      const bo = Number(b.sort_order) || 0;
      if (ao !== bo) return ao - bo;
      return String(a.unit_name || '').localeCompare(String(b.unit_name || ''), 'ko');
    })
    .map((unit) => ({ ...unit, depth: depthOf(unit) }));
}

function descendantUnitNames(unitName: string, units: Array<{ id: string; unit_name?: string | null; parent_id?: string | null }>) {
  const names = new Set<string>();
  const selected = units.find((u) => String(u.unit_name || '').trim() === unitName);
  if (!selected) {
    if (unitName) names.add(unitName);
    return names;
  }
  if (selected.unit_name) names.add(String(selected.unit_name).trim());
  const walk = (parentId: string) => {
    for (const child of units.filter((u) => u.parent_id === parentId)) {
      const n = String(child.unit_name || '').trim();
      if (n) names.add(n);
      walk(child.id);
    }
  };
  walk(selected.id);
  return names;
}

/** KST 기준 연·월 문자열 (year: '2026', month: '07') — 파싱 실패 시 null */
function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return {
    year: String(ym.year),
    month: String(ym.month).padStart(2, '0'),
  };
}
     
function MasterRequestContent({ currentUser: propUser }: { currentUser?: any }) {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(SUPPLIES_MASTER_TABS, '/asset/supplies/master');
  
  // 데이터 상태 관리
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(propUser || null);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  
  // 하단 장부 상태 관리
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 장부(표) 물품 필터 */
  const [selectedItem, setSelectedItem] = useState('ALL');
  /** 상단 지급 수량 차트 물품 선택 (장부와 분리) */
  const [chartSelectedItem, setChartSelectedItem] = useState('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  /** 장부(서류철)용 연·월 — 접수대기는 월 ALL, 처리완료는 접속월 */
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  /**
   * 상단 센터별 지급 수량 차트 전용 연·월.
   * 지급완료만 집계 · 서류철(접수대기↔처리완료) 전환과 무관하게 유지.
   * 처리완료 장부에서 연·월을 바꾸면 동기화.
   */
  const [chartYear, setChartYear] = useState(() => String(getKSTNowYearMonth().year));
  const [chartMonth, setChartMonth] = useState(() =>
    String(getKSTNowYearMonth().month).padStart(2, '0')
  );
  /** 상단 차트: 센터별(CENTER) / 본부별(HQ·하위센터 합산) */
  const [chartOrgMode, setChartOrgMode] = useState<ChartOrgMode>('CENTER');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [orgUnits, setOrgUnits] = useState<any[]>([]);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  const [selectedStatus, setSelectedStatus] = useState('ALL'); 
  /** 서류철: 신청현황(미완료) | 지급완료(수령완료) */
  const [activeFolder, setActiveFolder] = useState<LedgerFolder>('ACTIVE');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [processingId, setProcessingId] = useState<string | null>(null);
  /** 마케팅 기념품 반려(취소) 모달과 동일 — 사유 → admin_opinion */
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');
     
  useEffect(() => { 
    fetchRequestsData(); 
  }, []);
     
  const fetchRequestsData = async () => {
    setLoading(true);
    try { 
      const ts = Date.now();
      const [reqRes, userRes, summaryRes, ifRes, unitsRes] = await Promise.all([
        fetch(`/api/asset/supplies/master/requests?t=${ts}`, { cache: 'no-store' }),
        !propUser ? fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }) : Promise.resolve(null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);
      
      if (reqRes.ok) {
        setRequests(await reqRes.json());
      } else if (reqRes.status === 401 || reqRes.status === 403) {
        const err = await reqRes.json().catch(() => ({}));
        alert(err.error || '신청현황 관리 권한이 없습니다.');
      }
      if (!propUser && userRes?.ok) setCurrentUser(await userRes.json());
      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);

      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/supplies/master/requests'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
      if (unitsRes && unitsRes.ok) {
        const raw = await unitsRes.json();
        setOrgUnits(Array.isArray(raw) ? raw : []);
      } else setOrgUnits([]);
    } catch(e) {
      console.error("Requests Sync Error", e);
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };
     
  const isLV1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : [currentUser.role];
    return roles?.includes('LV_1');
  }, [currentUser]);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
     
  // 장부 필터용 옵션 (Asia/Seoul)
  const availableYears = useMemo(() => {
    const years = requests
      .map((r) => getKSTYearMonthParts(r.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [requests]);
  const availableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const sortedOrgs = useMemo(() => flattenUnitsInSortOrder(orgUnits), [orgUnits]);
  const organizationUnit = useMemo(
    () =>
      sortedOrgs.find((u) => String(u.unit_type || '').trim().toUpperCase() === 'ORGANIZATION') ||
      sortedOrgs.find((u) => !u.parent_id) ||
      null,
    [sortedOrgs]
  );
  const isOrgWideFilter = useMemo(() => {
    if (selectedDept === 'ALL') return true;
    if (!selectedDept) return true;
    if (organizationUnit && selectedDept === organizationUnit.unit_name) return true;
    const unit = sortedOrgs.find((u) => u.unit_name === selectedDept);
    return String(unit?.unit_type || '').trim().toUpperCase() === 'ORGANIZATION';
  }, [selectedDept, organizationUnit, sortedOrgs]);

  const selectedOrgUnit = useMemo(
    () =>
      isOrgWideFilter
        ? organizationUnit
        : sortedOrgs.find((o) => o.unit_name === selectedDept) || null,
    [sortedOrgs, selectedDept, isOrgWideFilter, organizationUnit]
  );
  const selectedDeptNames = useMemo(() => {
    if (isOrgWideFilter || !selectedDept) return null;
    return descendantUnitNames(selectedDept, orgUnits);
  }, [selectedDept, orgUnits, isOrgWideFilter]);

  useEffect(() => {
    if (!organizationUnit?.unit_name) return;
    if (selectedDept === 'ALL' || !selectedDept) {
      setSelectedDept(String(organizationUnit.unit_name));
    }
  }, [organizationUnit, selectedDept]);

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

  const matchesDeptFilter = (deptName: string | null | undefined) => {
    if (isOrgWideFilter) return true;
    const name = String(deptName || '').trim();
    if (!name) return false;
    if (name === selectedDept) return true;
    return selectedDeptNames ? selectedDeptNames.has(name) : false;
  };

  const resetOrgFilter = () => {
    setSelectedDept(String(organizationUnit?.unit_name || 'ALL'));
  };

  const availableItems = useMemo(() => {
    const names = requests
      .map((r) => r.item_name || r.item?.name || '')
      .filter(Boolean) as string[];
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [requests]);

  /** 장부·차트 공통 필터 (조직 제외) — 차트는 항상 센터별로 펼침 */
  const matchesSharedFilters = (r: any, folder: LedgerFolder = activeFolder) => {
    const ym = getKSTYearMonthParts(r.createdAt);
    const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
    const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
    const isPending = isPendingSupplyRequest(r.status);
    const isReady = isReadySupplyRequest(r.status);
    const isCompleted = isCompletedSupplyRequest(r.status);
    const isRejected = isRejectedSupplyRequest(r.status);

    // 신청 현황: 대기·수령대기만 / 처리 완료: 지급완료·반려 (신청취소 제외)
    const folderMatch =
      folder === 'COMPLETED'
        ? isCompleted || isRejected
        : isPending || isReady;
    if (!folderMatch) return false;

    const statusMatch =
      selectedStatus === 'ALL' ||
      (selectedStatus === 'PENDING' && isPending) ||
      (selectedStatus === 'READY' && isReady) ||
      (selectedStatus === 'COMPLETED' && isCompleted) ||
      (selectedStatus === 'REJECTED' && isRejected);
    const itemName = r.item_name || r.item?.name || '';
    const itemMatch = selectedItem === 'ALL' || itemName === selectedItem;
    const userMatch =
      !searchUserQuery ||
      (r.user_name || '').toLowerCase().includes(searchUserQuery.toLowerCase());
    return yearMatch && monthMatch && statusMatch && itemMatch && userMatch;
  };

  const filteredRequests = useMemo(() => {
    return requests
      .filter((r) => {
        const deptMatch = matchesDeptFilter(r.dept_name);
        return matchesSharedFilters(r, activeFolder) && deptMatch;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, selectedYear, selectedMonth, selectedDept, selectedStatus, selectedItem, searchUserQuery, selectedDeptNames, orgUnits, isOrgWideFilter, activeFolder]);

  /** 차트: 지급완료만 · 접수대기/반려 제외 · 연·월은 chartYear/chartMonth (서류철과 분리) */
  const matchesChartBaseFilters = (r: any) => {
    if (!isCompletedSupplyRequest(r.status)) return false;
    const ym = getKSTYearMonthParts(r.createdAt);
    const yearMatch = chartYear === 'ALL' || ym?.year === chartYear;
    const monthMatch = chartMonth === 'ALL' || ym?.month === chartMonth;
    const userMatch =
      !searchUserQuery ||
      (r.user_name || '').toLowerCase().includes(searchUserQuery.toLowerCase());
    return yearMatch && monthMatch && userMatch;
  };

  /** 지급완료 물품 목록 (단위가 달라 서로 비교 그래프는 쓰지 않음 · 선택용) */
  const paidItemOptions = useMemo(() => {
    const byItem = new Map<string, number>();
    requests.forEach((r) => {
      if (!matchesChartBaseFilters(r)) return;
      const item = String(r.item_name || r.item?.name || '').trim() || '미지정';
      byItem.set(item, (byItem.get(item) || 0) + (Number(r.qty) || 0));
    });
    return Array.from(byItem.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [requests, chartYear, chartMonth, searchUserQuery]);

  // 지급완료 물품이 있으면 차트는 첫 항목을 기본 선택 (빈 차트 방지)
  useEffect(() => {
    if (paidItemOptions.length === 0) {
      if (chartSelectedItem !== 'ALL') setChartSelectedItem('ALL');
      return;
    }
    const stillValid = paidItemOptions.some((o) => o.name === chartSelectedItem);
    if (!stillValid) setChartSelectedItem(paidItemOptions[0].name);
  }, [paidItemOptions, chartSelectedItem]);

  /**
   * 선택한 물품 지급 수량 차트
   * - CENTER: admin/units 의 CENTER 전부(0포함) · sort_order
   * - HQ: HQ 전부 · 하위 조직 신청 수량 합산 · sort_order
   */
  const itemOrgChartData = useMemo(() => {
    if (chartSelectedItem === 'ALL') return [];

    const qtyByDept = new Map<string, number>();
    requests.forEach((r) => {
      if (!matchesChartBaseFilters(r)) return;
      const item = String(r.item_name || r.item?.name || '').trim();
      if (item !== chartSelectedItem) return;
      const dept = String(r.dept_name || '').trim() || '미지정';
      qtyByDept.set(dept, (qtyByDept.get(dept) || 0) + (Number(r.qty) || 0));
    });

    const axisUnits = sortUnitsByOrder(
      orgUnits.filter((u) => {
        const t = normalizeOrgUnitType(u.unit_type);
        if (chartOrgMode === 'CENTER') return t === 'CENTER';
        if (t !== 'HQ') return false;
        // 본부별 조회: 직함성 HQ(원장/부원장/상무) 제외 — units 명칭에 해당 글자 있으면 거름
        const name = String(u.unit_name || '');
        if (/원장|부원장|상무/.test(name)) return false;
        return true;
      })
    );

    const rows = axisUnits.map((unit) => {
      const name = String(unit.unit_name || '').trim() || '(이름없음)';
      let qty = 0;
      if (chartOrgMode === 'CENTER') {
        qty = qtyByDept.get(name) || 0;
      } else {
        const childNames = collectDescendantUnitNames(unit.id, orgUnits);
        childNames.add(name);
        for (const n of childNames) {
          qty += qtyByDept.get(n) || 0;
        }
      }
      return { name, qty, unitId: unit.id };
    });

    const total = rows.reduce((sum, row) => sum + row.qty, 0);
    return rows.map((row) => ({
      ...row,
      percent: total > 0 ? (row.qty / total) * 100 : 0,
      label:
        row.qty > 0
          ? `${row.qty.toLocaleString()}${total > 0 ? ` · ${((row.qty / total) * 100).toFixed(1)}%` : ''}`
          : '0',
      isSelected: !isOrgWideFilter && matchesDeptFilter(row.name),
      hasQty: row.qty > 0,
    }));
  }, [
    requests,
    chartYear,
    chartMonth,
    searchUserQuery,
    chartSelectedItem,
    selectedDept,
    selectedDeptNames,
    orgUnits,
    isOrgWideFilter,
    chartOrgMode,
  ]);

  const chartPeriodLabel = `${chartYear === 'ALL' ? '전체 연도' : `${chartYear}년`}${
    chartMonth === 'ALL' ? '' : ` ${Number(chartMonth)}월`
  }`;

  const chartRows = itemOrgChartData;

  const chartTotalQty = useMemo(
    () => chartRows.reduce((sum, row) => sum + row.qty, 0),
    [chartRows]
  );

  const chartAxisCount = chartRows.length;
  const chartHeight = 180;
  const chartMinWidth = Math.max(560, chartAxisCount * 52);
     
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedYear, selectedMonth, selectedDept, selectedStatus, selectedItem, searchUserQuery, activeFolder]);

  useEffect(() => {
    // 서류철 전환 시 장부(표)용 상태칩·월별만 조정
    // 접수 대기: 상태 ALL · 월 ALL (차트 연·월은 유지)
    // 처리 완료: 접속월(KST) + 차트도 동일 기간으로 맞춤
    if (activeFolder === 'ACTIVE') {
      if (selectedStatus !== 'ALL') setSelectedStatus('ALL');
      setSelectedMonth('ALL');
      return;
    }
    if (
      selectedStatus === 'PENDING' ||
      selectedStatus === 'READY'
    ) {
      setSelectedStatus('ALL');
    }
    const m = String(getKSTNowYearMonth().month).padStart(2, '0');
    setSelectedMonth(m);
    setChartYear(selectedYear);
    setChartMonth(m);
  }, [activeFolder]);

  // 처리완료 장부에서 연·월을 수동 변경할 때 차트 동기화 (접수대기에서는 차트 유지)
  useEffect(() => {
    if (activeFolder !== 'COMPLETED') return;
    setChartYear(selectedYear);
    setChartMonth(selectedMonth);
    // activeFolder는 가드만 — 서류철 전환 시 selectedMonth=ALL로 차트를 덮지 않도록 deps에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [selectedYear, selectedMonth]);
     
  const toggleSelectAll = () => {
    const currentPageIds = paginatedRequests.map(r => r.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id)); else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };

  const handleExportExcel = () => {
    const target = selectedIds.size > 0
      ? filteredRequests.filter((r) => selectedIds.has(r.id))
      : filteredRequests;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const exportData = target.map((r, idx) => {
      let sUnit = '';
      try {
        const itemExt = r.item?.description ? JSON.parse(r.item.description) : {};
        sUnit = r.unit || itemExt.s_unit || itemExt.r_unit || '';
      } catch (e) {}

      const itemName = r.item_name || r.item?.name || '';
      const statusKo = supplyRequestStatusLabel(r.status);
      return {
        NO: target.length - idx,
        신청일시: formatKSTDateTime(r.createdAt),
        소속조직: r.dept_name || '',
        신청자: r.user_name || '',
        물품명: itemName,
        신청수량: sUnit ? `${r.qty} ${sUnit}` : r.qty,
        '신청자 특이요청 사항': r.note || '',
        처리자: r.admin_name || '',
        처리일시: r.processedAt ? formatKSTDateTime(r.processedAt) : '',
        상태: statusKo,
        취소사유: r.admin_opinion || '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '사용자신청내역');

    const monthStr = selectedMonth !== 'ALL' ? `_${selectedMonth}월` : '';
    const deptStr = !isOrgWideFilter && selectedDept ? `_${selectedDept}` : '';
    const statusStr = selectedStatus !== 'ALL' ? `_${selectedStatus}` : '';
    XLSX.writeFile(
      wb,
      `소모품_사용자신청현황_${selectedYear === 'ALL' ? '전체' : selectedYear}년${monthStr}${deptStr}${statusStr}.xlsx`
    );
  };
     
  // 상태 변경 — 재고 복구/재차감은 서버가 이전 status 기준으로 처리
  // 지급승인 = PENDING → COMPLETED (지급대기 단계 없음)
  // 취소 = REJECTED + admin_opinion (마케팅 reject_reason 패턴)
  const handleProcessRequest = async (
    req: any,
    status: Extract<SupplyRequestStatus, 'COMPLETED' | 'REJECTED'>,
    adminOpinion?: string
  ) => {
    if (!canEdit) return alertNoEditPermission();
    const reqId = req.id;
    if (processingId) return;
    const fromPending = isPendingSupplyRequest(req.status);

    if (status === 'REJECTED') {
      const reason = String(adminOpinion || '').trim();
      if (!reason || !(CANCEL_REASON_OPTIONS as readonly string[]).includes(reason)) {
        alert('취소 사유를 선택해 주세요.');
        return;
      }
    } else {
      const confirmMsg = fromPending
        ? '지급승인 처리하시겠습니까?\n(즉시 지급완료로 처리됩니다.)'
        : '지급완료 처리하시겠습니까?';
      if (!confirm(confirmMsg)) return;
    }

    setProcessingId(reqId);
    try {
      const body: Record<string, unknown> = { id: reqId, status };
      if (status === 'REJECTED') {
        body.admin_opinion = String(adminOpinion || '').trim();
      }
      const res = await fetch('/api/asset/supplies/master/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        alert(
          status === 'COMPLETED'
            ? fromPending
              ? '✅ 지급승인 · 지급완료 처리됨'
              : '✅ 지급완료 처리됨'
            : '✅ 취소 처리 · 재고 복구 완료'
        );
        setCancelTarget(null);
        setCancelReason('');
        fetchRequestsData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 처리 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('처리 중 오류가 발생했습니다.');
    } finally {
      setProcessingId(null);
    }
  };

  const openCancelModal = (req: any) => {
    if (!canEdit) return alertNoEditPermission();
    setCancelTarget(req);
    setCancelReason('');
  };

  const submitCancelWithReason = () => {
    if (!cancelTarget) return;
    void handleProcessRequest(cancelTarget, 'REJECTED', cancelReason);
  };

  /** LV_1 전용 — 체크 선택 건 일괄 삭제 */
  const handleBulkDelete = async () => {
    if (!isLV1) return alert('삭제는 LV_1만 가능합니다.');
    if (processingId) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return alert('삭제할 신청을 체크박스로 선택해 주세요.');
    if (
      !confirm(
        `경고: 선택한 ${ids.length}건을 영구 삭제하시겠습니까?\n(대기·수령대기·지급완료 건은 선차감 재고가 복구됩니다.)`
      )
    ) {
      return;
    }

    setProcessingId('bulk');
    let ok = 0;
    let fail = 0;
    try {
      for (const id of ids) {
        const res = await fetch(`/api/asset/supplies/master/requests?id=${id}`, {
          method: 'DELETE',
        });
        if (res.ok) ok += 1;
        else fail += 1;
      }
      alert(
        fail > 0
          ? `삭제 완료 ${ok}건 / 실패 ${fail}건`
          : `🗑️ ${ok}건 삭제되었습니다.`
      );
      setSelectedIds(new Set());
      fetchRequestsData();
    } catch {
      alert('일괄 삭제 중 오류가 발생했습니다.');
    } finally {
      setProcessingId(null);
    }
  };
     
  if (loading) return <LoadingState />;

  // 장부 칩 집계: 현재 서류철 · 조직·연도·월·물품 필터 반영 (상태 칩·신청자 검색 제외)
  const scopedForStatusChips = requests.filter((r) => {
    const ym = getKSTYearMonthParts(r.createdAt);
    const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
    const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
    const deptMatch = matchesDeptFilter(r.dept_name);
    const itemName = r.item_name || r.item?.name || '';
    const itemMatch = selectedItem === 'ALL' || itemName === selectedItem;
    const isCompleted = isCompletedSupplyRequest(r.status);
    const isRejected = isRejectedSupplyRequest(r.status);
    const isPending = isPendingSupplyRequest(r.status);
    const isReady = isReadySupplyRequest(r.status);
    const folderMatch =
      activeFolder === 'COMPLETED'
        ? isCompleted || isRejected
        : isPending || isReady;
    return yearMatch && monthMatch && deptMatch && itemMatch && folderMatch;
  });
  const countAll = scopedForStatusChips.length;
  const countCompletedInFolder = scopedForStatusChips.filter((r) =>
    isCompletedSupplyRequest(r.status)
  ).length;
  const countRejected = scopedForStatusChips.filter((r) =>
    isRejectedSupplyRequest(r.status)
  ).length;
  const countActiveFolder = requests.filter(
    (r) => isPendingSupplyRequest(r.status) || isReadySupplyRequest(r.status)
  ).length;
  // 탭 배지: 전사 대기건 (필터 무관)
  const tabPendingCount = requests.filter((r) => isPendingSupplyRequest(r.status)).length;
     
  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* client-search 배너 규격: emerald→teal · orbs · label 10px / title 2xl / desc xs */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
  <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
  <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
  <div className="relative z-10">
    <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
      CENTRAL SUPPLIES CONTROL TOWER
    </h3>
    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
      소모품 마스터 관리 통제실
    </h1>
    <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
      임직원의 소모품 신청내역을 검토하고 지급승인·취소 등 관리합니다.
    </p>
    {permissionSummary && isSystemLv1User(currentUser) && (
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
      </div>
    )}
  </div>
</div>

      {/* 탭 네비게이션 — client-search / distribution 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            const showPendingBadge = tab.id === 'requests' && tabPendingCount > 0;
            return (
              <Link
                key={tab.id}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                  isActive
                    ? `bg-white ${tab.activeColor || 'text-indigo-600'} shadow-sm border border-slate-200/80`
                    : 'text-slate-500 hover:text-slate-800'
                } ${showPendingBadge && !isActive ? 'ring-1 ring-red-300/80' : ''}`}
              >
                <span>{tab.label}</span>
                {showPendingBadge && (
                  <span className="inline-flex items-center justify-center min-w-[1.35rem] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-black font-mono shadow-sm animate-pulse">
                    {tabPendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden lg:block">
          ※ 탭을 클릭하여 대시보드·신청·입고·아카이브를 전환합니다.
        </p>
      </div>
     
      {/* 물품 선택 → 센터/본부별 지급 수량 (admin/units 축 · 세로 막대) */}
      <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden mt-4">
        <div className="px-3 py-1.5 bg-slate-100/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></div>
            <div className="min-w-0">
              <h2 className="text-[11px] font-medium text-slate-800 tracking-tight">
                {chartSelectedItem !== 'ALL'
                  ? `📊 ${chartSelectedItem} · ${chartOrgMode === 'HQ' ? '본부별' : '센터별'} 지급 수량`
                  : `📊 ${chartOrgMode === 'HQ' ? '본부별' : '센터별'} 지급 수량`}
                <span className="ml-2 text-[9px] font-medium text-slate-500">
                  지급완료만 · {chartPeriodLabel} · units 순서 · 0건 포함
                </span>
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setChartOrgMode('CENTER')}
                className={`px-2 py-1 rounded-md text-[9px] font-medium transition-colors ${
                  chartOrgMode === 'CENTER'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                센터별조회
              </button>
              <button
                type="button"
                onClick={() => setChartOrgMode('HQ')}
                className={`px-2 py-1 rounded-md text-[9px] font-medium transition-colors ${
                  chartOrgMode === 'HQ'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                본부별조회
              </button>
            </div>
            {chartSelectedItem !== 'ALL' && (
              <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md">
                총 지급 합계 {chartTotalQty.toLocaleString()}
              </span>
            )}
            {!isOrgWideFilter && (
              <button
                type="button"
                onClick={resetOrgFilter}
                className="text-[9px] font-medium text-slate-500 hover:text-indigo-600 underline"
              >
                조직 필터 해제
              </button>
            )}
          </div>
        </div>

        <div className="px-3 pt-1.5 pb-1.5 border-b border-slate-100">
          <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-1">
            지급 물품 선택
          </p>
          {paidItemOptions.length === 0 ? (
            <p className="text-[10px] font-medium text-slate-400 py-0.5">지급완료된 물품이 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {paidItemOptions.map((opt) => {
                const active = chartSelectedItem === opt.name;
                return (
                  <button
                    key={opt.name}
                    type="button"
                    onClick={() => setChartSelectedItem(opt.name)}
                    className={`inline-flex items-center gap-1.5 max-w-full px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
                    }`}
                    title={opt.name}
                  >
                    <span className="truncate max-w-[160px]">{opt.name}</span>
                    <span className={`tabular-nums shrink-0 ${active ? 'text-indigo-100' : 'text-slate-400'}`}>
                      {opt.qty.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-2 py-1">
          {chartSelectedItem === 'ALL' ? (
            <div className="h-[72px] flex items-center justify-center border border-dashed border-slate-200 bg-slate-50/60">
              <p className="text-[10px] font-medium text-slate-400">
                지급완료 물품이 없으면 그래프를 표시할 수 없습니다.
              </p>
            </div>
          ) : chartRows.length === 0 ? (
            <div className="h-[72px] flex items-center justify-center border border-dashed border-slate-200 bg-slate-50/60">
              <p className="text-[10px] font-medium text-slate-400">
                admin/units에 {chartOrgMode === 'HQ' ? 'HQ(본부)' : 'CENTER'} 조직이 없습니다.
              </p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <div style={{ height: chartHeight, minWidth: chartMinWidth }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartRows}
                    margin={{ top: 16, right: 8, left: 4, bottom: 4 }}
                    barCategoryGap="18%"
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      type="category"
                      dataKey="name"
                      interval={0}
                      angle={-28}
                      textAnchor="end"
                      height={54}
                      tick={{ fontSize: 8, fontWeight: 500, fill: '#334155' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <YAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 8, fontWeight: 500, fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                      width={28}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as {
                          name: string;
                          qty: number;
                          percent: number;
                          hasQty: boolean;
                        };
                        return (
                          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-md">
                            <p className="text-[10px] font-medium text-slate-800">{row.name}</p>
                            <p className="text-[10px] font-medium text-indigo-600 mt-0.5">
                              {row.qty.toLocaleString()}
                              {row.hasQty ? ` · ${row.percent.toFixed(1)}%` : ' · 미지급'}
                            </p>
                            <p className="text-[9px] font-medium text-slate-400 mt-0.5">
                              클릭하면 장부 조직 필터
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="qty"
                      radius={[0, 0, 0, 0]}
                      maxBarSize={28}
                      cursor="pointer"
                      onClick={(data: any) => {
                        const name = data?.name || data?.payload?.name;
                        if (!name) return;
                        const orgWideName = String(organizationUnit?.unit_name || 'ALL');
                        setSelectedDept((prev) => (prev === name ? orgWideName : name));
                      }}
                    >
                      {chartRows.map((row) => (
                        <Cell
                          key={row.unitId || row.name}
                          fill={
                            row.isSelected
                              ? '#4f46e5'
                              : row.hasQty
                                ? '#34d399'
                                : '#e2e8f0'
                          }
                        />
                      ))}
                      <LabelList
                        dataKey="qty"
                        position="top"
                        content={(props: any) => {
                          const { x, y, width, value } = props;
                          if (x == null || y == null || value == null) return null;
                          const n = Number(value) || 0;
                          return (
                            <text
                              x={Number(x) + Number(width || 0) / 2}
                              y={Number(y) - 4}
                              textAnchor="middle"
                              fontSize={9}
                              fontWeight={500}
                              fill={n > 0 ? '#334155' : '#cbd5e1'}
                            >
                              {n.toLocaleString()}
                            </text>
                          );
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>
     
      {/* 사용자 신청 현황 / 지급 완료 내역 서류철 */}
      <div className="w-full mt-6">
        <div
          className="flex flex-wrap items-end gap-1 border-b border-slate-200"
          role="tablist"
          aria-label="소모품 신청·지급 서류철"
        >
          {FOLDER_TABS.map((tab) => {
            const active = activeFolder === tab.id;
            // 처리 완료 내역 탭은 건수 미표시 (칩으로 충분)
            const badgeCount = tab.id === 'ACTIVE' ? countActiveFolder : null;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setActiveFolder(tab.id);
                  setSelectedStatus('ALL');
                }}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border ${
                  active ? tab.activeClass : FOLDER_TAB_IDLE
                }`}
              >
                <span className="text-sm leading-none">{tab.icon}</span>
                <span className="flex items-center gap-1">
                  <span>{tab.label}</span>
                  {badgeCount != null && (
                    <span className={`tabular-nums ${active ? 'opacity-95' : 'text-indigo-600'}`}>
                      ({badgeCount})
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

      <section className={`bg-white border border-t-0 border-slate-200 rounded-b-[2.5rem] rounded-tr-2xl shadow-sm animate-in fade-in duration-300 ${orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
          
          <div className={`p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4 relative ${orgMenuOpen ? 'z-[80] overflow-visible' : ''}`}>
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">
                {activeFolder === 'COMPLETED'
                  ? selectedStatus === 'REJECTED'
                    ? '취소 처리건'
                    : selectedStatus === 'COMPLETED'
                      ? '지급 완료건'
                      : '처리 완료 내역'
                  : '접수 대기'}
              </h2>
              {activeFolder === 'COMPLETED' && (
              <div className="flex items-center gap-1 ml-1">
                <button
                  type="button"
                  onClick={() => setSelectedStatus('ALL')}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                    selectedStatus === 'ALL'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  전체 {countAll}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus((prev) => (prev === 'COMPLETED' ? 'ALL' : 'COMPLETED'))}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                    selectedStatus === 'COMPLETED'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100'
                  }`}
                >
                  지급완료 {countCompletedInFolder}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus((prev) => (prev === 'REJECTED' ? 'ALL' : 'REJECTED'))}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                    selectedStatus === 'REJECTED'
                      ? 'bg-red-500 text-white'
                      : 'bg-red-50 text-red-600 border border-red-100 hover:bg-red-100'
                  }`}
                >
                  취소 {countRejected}
                </button>
              </div>
              )}
            </div>

            <div className="soh-filter-bar flex items-center gap-2 flex-wrap">
              {isLV1 && (
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || processingId === 'bulk'}
                  onClick={handleBulkDelete}
                  className="h-7 px-2.5 rounded-lg text-[10px] font-medium border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  title="체크한 신청을 영구 삭제 (LV_1 전용)"
                >
                  {processingId === 'bulk'
                    ? '삭제중…'
                    : selectedIds.size > 0
                      ? `삭제(LV_1) ${selectedIds.size}`
                      : '삭제(LV_1)'}
                </button>
              )}
              <div className={`flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border ${orgMenuOpen ? 'relative z-[90]' : ''}`}>
                <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">조직</span>
                <div className="relative inline-flex items-center" ref={orgMenuRef}>
                  <button
                    type="button"
                    onClick={() => setOrgMenuOpen((open) => !open)}
                    className="max-w-[160px] truncate text-left text-[11px] font-medium leading-none py-0 px-0 m-0 h-4 inline-flex items-center border-0 appearance-none outline-none cursor-pointer bg-transparent text-slate-800"
                  >
                    {selectedOrgUnit?.unit_name || organizationUnit?.unit_name || '조직 선택'}
                  </button>
                  {orgMenuOpen && (
                    <div className="absolute left-0 top-full mt-1.5 z-[100] min-w-[240px] max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1">
                      {sortedOrgs.map((o) => {
                        const bold = isBoldOrgType(o.unit_type);
                        const active =
                          selectedDept === o.unit_name ||
                          (isOrgWideFilter && o.id === organizationUnit?.id);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => {
                              setSelectedDept(String(o.unit_name || ''));
                              setOrgMenuOpen(false);
                            }}
                            className={`w-full text-left pr-3 py-1.5 text-[11px] font-medium ${
                              bold ? 'text-slate-900' : 'text-slate-600'
                            } ${active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                            style={{ paddingLeft: `${12 + o.depth * 12}px` }}
                          >
                            {o.unit_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="w-px h-3 bg-slate-300 shrink-0" />

                <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">연도</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
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
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
                >
                  <option value="ALL">전체</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>{month}월</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border">
                  <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">물품</span>
                  <select
                    value={selectedItem}
                    onChange={(e) => setSelectedItem(e.target.value)}
                    className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent max-w-[160px] h-4 leading-none py-0"
                  >
                    <option value="ALL">전체 물품</option>
                    {availableItems.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div className="relative w-32 h-7">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] leading-none pointer-events-none">👤</span>
                  <input
                    type="text"
                    placeholder="신청자 검색..."
                    value={searchUserQuery}
                    onChange={(e) => setSearchUserQuery(e.target.value)}
                    className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:border-indigo-500 shadow-sm transition-colors placeholder:font-medium"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="h-7 px-3 bg-emerald-600 text-white rounded-lg text-[10px] font-medium shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap leading-none"
              >
                {selectedIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table
              className={`w-full text-left border-collapse table-fixed ${
                activeFolder === 'COMPLETED' ? 'min-w-[1080px]' : 'min-w-[920px]'
              }`}
            >
            <colgroup>
              <col className="w-[40px]" />
              <col className="w-[48px]" />
              <col className="w-[90px]" />
              <col className="w-[120px]" />
              <col className="w-[150px]" />
              <col className="w-[88px]" />
              <col className={activeFolder === 'COMPLETED' ? 'w-[280px]' : 'w-[300px]'} />
              {activeFolder === 'COMPLETED' && (
                <>
                  <col className="w-[110px]" />
                  <col className="w-[88px]" />
                </>
              )}
              <col className="w-[130px]" />
            </colgroup>
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 text-center"><input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></th>
                  <th className="h-12 px-2 text-center">NO</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청 일자</th>
                  <th className="h-12 px-2 text-left">부서 / 신청자</th>
                  <th className="h-12 px-2 text-left">물품명</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청수량</th>
                  <th className="h-12 px-2 text-left">신청자 특이요청 사항</th>
                  {activeFolder === 'COMPLETED' && (
                    <>
                      <th className="h-12 px-2 text-left whitespace-nowrap border-l border-slate-200">부서 / 처리자</th>
                      <th className="h-12 px-2 text-center whitespace-nowrap">처리 일자</th>
                    </>
                  )}
                  <th className="h-12 px-2 text-center whitespace-nowrap border-l border-slate-200">
                    {activeFolder === 'COMPLETED' ? '상태' : '관리액션(Edit)'}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr>
                    <td
                      colSpan={activeFolder === 'COMPLETED' ? 10 : 8}
                      className="p-16 text-center text-slate-400 text-xs"
                    >
                      조건에 맞는 내역이 없습니다.
                    </td>
                  </tr>
                ) : paginatedRequests.map((req, i) => {
                  const isPending = isPendingSupplyRequest(req.status);
                  const isReady = isReadySupplyRequest(req.status);
                  const isRejected = isRejectedSupplyRequest(req.status);
                  const isCancelled = isCancelledSupplyRequest(req.status);
                  const isCompleted = isCompletedSupplyRequest(req.status);
                  const statusLabel = supplyRequestStatusLabel(req.status);
                  const itemName = req.item_name || req.item?.name || '(삭제된 물품)';
                  const itemExt = req.item?.description ? JSON.parse(req.item.description) : {};
                  const sUnit = req.unit || itemExt.r_unit || itemExt.s_unit || 'EA';
                  const processDate = getKSTDateString(req.processedAt) || '-';
                  const createdDate = getKSTDateString(req.createdAt) || '-';
                  const rowNo = filteredRequests.length - ((currentPage - 1) * itemsPerPage + i);
     
                  const isSelected = selectedIds.has(req.id);

                  return (
                    <tr
                      key={req.id}
                      className={`h-12 transition-colors ${
                        isRejected
                          ? isSelected
                            ? 'bg-slate-200/80 text-red-500 [&_td]:text-red-500 [&_td]:line-through'
                            : 'bg-slate-100/80 text-red-500 hover:bg-slate-100 [&_td]:text-red-500 [&_td]:line-through'
                          : isSelected
                            ? 'bg-indigo-50/50 hover:bg-slate-50/50'
                            : 'hover:bg-slate-50/50'
                      }`}
                    >
                      <td className="pl-4 text-center !no-underline" style={isRejected ? { textDecoration: 'none' } : undefined}>
                        <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); isSelected ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                      </td>
                      <td className="px-2 text-center font-mono tabular-nums !text-slate-500 !no-underline" style={isRejected ? { textDecoration: 'none' } : undefined}>{rowNo}</td>
                      <td className={`px-2 text-center whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-800'}`}>{createdDate}</td>
                      <td className="px-2 text-left truncate">
                        <span className={`text-[10px] block truncate ${isRejected ? '' : 'text-slate-500'}`}>{req.dept_name || '-'}</span>
                        <span className={`truncate ${isRejected ? '' : 'text-slate-800'}`}>{req.user_name || '-'}</span>
                      </td>
                      <td className={`px-2 text-left truncate ${isRejected ? '' : 'text-slate-800'}`} title={itemName}>{itemName}</td>
                      <td className={`px-2 text-center font-mono whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-800'}`}>
                        {req.qty}
                        <span className={`text-[10px] font-sans ml-0.5 ${isRejected ? '' : 'text-slate-500'}`}>{sUnit}</span>
                      </td>
                      <td className={`px-2 text-left truncate ${isRejected ? '' : 'text-slate-700'}`} title={req.note}>{req.note ? `"${req.note}"` : '-'}</td>
                      {activeFolder === 'COMPLETED' && (
                        <>
                          <td className="px-2 text-left border-l border-slate-200">
                            <div className="truncate">
                              <span className={`text-[10px] block truncate ${isRejected ? '' : 'text-slate-500'}`}>{req.admin_dept || '-'}</span>
                              <span className={`truncate ${isRejected ? '' : 'text-slate-800'}`}>{req.admin_name || '관리자'}</span>
                            </div>
                          </td>
                          <td className={`px-2 text-center whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-800'}`}>
                            {processDate}
                          </td>
                        </>
                      )}
     
                      <td className="px-1 text-center border-l border-slate-200 !no-underline" style={isRejected ? { textDecoration: 'none' } : undefined}>
                        {isPending ? (
                          <div className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openCancelModal(req)}
                              title={canEdit ? '취소 (사유 선택)' : '편집 권한 필요'}
                              className={
                                canEdit
                                  ? 'inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-red-50 text-red-500 border-red-100 hover:bg-red-500 hover:text-white transition-colors shadow-sm'
                                  : 'inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
                              }
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              onClick={() => handleProcessRequest(req, 'COMPLETED')}
                              title={canEdit ? '지급승인 → 지급완료' : '편집 권한 필요'}
                              className={
                                canEdit
                                  ? 'inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-indigo-600 text-white border-indigo-700 shadow-sm hover:bg-indigo-700'
                                  : 'inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
                              }
                            >
                              지급승인
                            </button>
                          </div>
                        ) : isReady ? (
                          <div className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openCancelModal(req)}
                              title={canEdit ? '취소 (사유 선택)' : '편집 권한 필요'}
                              className={
                                canEdit
                                  ? 'inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-red-50 text-red-500 border-red-100 hover:bg-red-500 hover:text-white transition-colors shadow-sm'
                                  : 'inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
                              }
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              onClick={() => handleProcessRequest(req, 'COMPLETED')}
                              title={canEdit ? '지급완료 (레거시 READY 잔여)' : '편집 권한 필요'}
                              className={
                                canEdit
                                  ? 'inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-emerald-600 text-white border-emerald-700 shadow-sm hover:bg-emerald-700'
                                  : 'inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
                              }
                            >
                              지급완료
                            </button>
                          </div>
                        ) : isRejected ? (
                          <span
                            className="inline-flex flex-col items-center leading-tight"
                            title={req.admin_opinion || ''}
                          >
                            <span className="text-[10px] font-medium tracking-normal whitespace-nowrap text-red-600">
                              취소
                            </span>
                            {req.admin_opinion ? (
                              <span className="text-[9px] font-medium text-red-400 truncate max-w-[88px] mt-0.5">
                                {req.admin_opinion}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span
                            className={`text-[10px] font-bold whitespace-nowrap ${
                              isCancelled
                                ? 'text-slate-500'
                                : isCompleted
                                  ? 'text-emerald-600'
                                  : 'text-slate-500'
                            }`}
                          >
                            {isCompleted ? '지급완료' : statusLabel}
                          </span>
                        )}
                      </td>
     
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
  
          {filteredRequests.length > 0 && (
            <WindowedPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </section>
      </div>

      {cancelTarget && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-red-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-red-100 bg-red-50/70">
              <h3 className="text-sm font-semibold text-red-800">취소 사유 선택</h3>
              <p className="text-[11px] font-normal text-red-600/80 mt-0.5">
                센터 소모품 현황에 취소로 표시되며, 선차감 재고가 복구됩니다.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] font-medium text-slate-600">
                <p className="truncate">
                  {cancelTarget.item_name || cancelTarget.item?.name || '(삭제된 물품)'} · {cancelTarget.qty}
                  건
                </p>
                <p className="truncate text-slate-400 mt-0.5">
                  {cancelTarget.dept_name || '-'} / {cancelTarget.user_name || '-'}
                </p>
              </div>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                autoFocus
                className="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 bg-white outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
              >
                <option value="">사유 선택</option>
                {CANCEL_REASON_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  disabled={processingId === cancelTarget.id}
                  onClick={() => {
                    setCancelTarget(null);
                    setCancelReason('');
                  }}
                  className="px-3.5 py-2 rounded-xl text-[11px] font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  닫기
                </button>
                <button
                  type="button"
                  disabled={processingId === cancelTarget.id || !cancelReason.trim()}
                  onClick={() => submitCancelWithReason()}
                  className="px-3.5 py-2 rounded-xl text-[11px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                >
                  취소 확정
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
     
export default function MasterRequestModule() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MasterRequestContent />
    </Suspense>
  );
}