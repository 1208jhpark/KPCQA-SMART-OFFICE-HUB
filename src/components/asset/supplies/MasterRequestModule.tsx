'use client';
import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth, formatKSTDateTime } from '@/utils/dateUtils';
import {
  isCompletedSupplyRequest,
  isPendingSupplyRequest,
  isRejectedSupplyRequest,
  normalizeSupplyRequestStatus,
  supplyRequestStatusLabel,
} from '@/utils/supplyRequestStatus';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
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

function isBoldOrgType(unitType?: string | null) {
  const t = String(unitType || '').trim().toUpperCase();
  return t === 'ORGANIZATION' || t === 'HQ';
}

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
  const [selectedItem, setSelectedItem] = useState('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  /** 진입 시점 KST 연도 (하드코딩 아님) */
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [orgUnits, setOrgUnits] = useState<any[]>([]);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  const [selectedStatus, setSelectedStatus] = useState('ALL'); 
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [processOpinion, setProcessOpinion] = useState<{ [key: string]: string }>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
     
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
  const matchesSharedFilters = (r: any) => {
    const ym = getKSTYearMonthParts(r.createdAt);
    const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
    const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
    const isPending = isPendingSupplyRequest(r.status);
    const isCompleted = isCompletedSupplyRequest(r.status);
    const isRejected = isRejectedSupplyRequest(r.status);
    const statusMatch =
      selectedStatus === 'ALL' ||
      (selectedStatus === 'PENDING' && isPending) ||
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
        return matchesSharedFilters(r) && deptMatch;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, selectedYear, selectedMonth, selectedDept, selectedStatus, selectedItem, searchUserQuery, selectedDeptNames, orgUnits, isOrgWideFilter]);

  /** 차트용 공통 필터 — 물품·조직은 차트 모드에서 따로 적용 */
  const matchesChartBaseFilters = (r: any) => {
    const ym = getKSTYearMonthParts(r.createdAt);
    const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
    const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
    const isPending = isPendingSupplyRequest(r.status);
    const isCompleted = isCompletedSupplyRequest(r.status);
    const isRejected = isRejectedSupplyRequest(r.status);
    const statusMatch =
      selectedStatus === 'ALL' ||
      (selectedStatus === 'PENDING' && isPending) ||
      (selectedStatus === 'COMPLETED' && isCompleted) ||
      (selectedStatus === 'REJECTED' && isRejected);
    const userMatch =
      !searchUserQuery ||
      (r.user_name || '').toLowerCase().includes(searchUserQuery.toLowerCase());
    return yearMatch && monthMatch && statusMatch && userMatch;
  };

  /** 물품별 신청 수량 (개요) · 조직 필터 반영 · 수량 내림차순 */
  const itemChartData = useMemo(() => {
    const byItem = new Map<string, number>();
    requests.forEach((r) => {
      if (!matchesChartBaseFilters(r)) return;
      if (!matchesDeptFilter(r.dept_name)) return;
      const item = String(r.item_name || r.item?.name || '').trim() || '미지정';
      byItem.set(item, (byItem.get(item) || 0) + (Number(r.qty) || 0));
    });
    const rows = Array.from(byItem.entries()).map(([item, qty]) => ({ name: item, qty }));
    const total = rows.reduce((sum, row) => sum + row.qty, 0);
    return rows
      .map((row) => ({
        ...row,
        percent: total > 0 ? (row.qty / total) * 100 : 0,
        label: `${row.qty.toLocaleString()} · ${total > 0 ? ((row.qty / total) * 100).toFixed(1) : '0.0'}%`,
        isSelected: selectedItem !== 'ALL' && selectedItem === row.name,
      }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ko'));
  }, [requests, selectedYear, selectedMonth, selectedStatus, searchUserQuery, selectedDept, selectedDeptNames, orgUnits, isOrgWideFilter, selectedItem]);

  /** 선택한 물품의 조직별 신청 수량 (드릴다운) */
  const itemOrgChartData = useMemo(() => {
    if (selectedItem === 'ALL') return [];
    const byDept = new Map<string, number>();
    requests.forEach((r) => {
      if (!matchesChartBaseFilters(r)) return;
      const item = String(r.item_name || r.item?.name || '').trim();
      if (item !== selectedItem) return;
      if (!matchesDeptFilter(r.dept_name)) return;
      const dept = r.dept_name || '미지정';
      byDept.set(dept, (byDept.get(dept) || 0) + (Number(r.qty) || 0));
    });
    const rows = Array.from(byDept.entries()).map(([dept, qty]) => ({ name: dept, qty }));
    const total = rows.reduce((sum, row) => sum + row.qty, 0);
    const orderOf = (name: string) => {
      const unit = orgUnits.find((u) => String(u.unit_name || '').trim() === name);
      return unit?.sort_order != null ? Number(unit.sort_order) : Number.MAX_SAFE_INTEGER;
    };
    return rows
      .map((row) => ({
        ...row,
        percent: total > 0 ? (row.qty / total) * 100 : 0,
        label: `${row.qty.toLocaleString()} · ${total > 0 ? ((row.qty / total) * 100).toFixed(1) : '0.0'}%`,
        isSelected: !isOrgWideFilter && matchesDeptFilter(row.name),
      }))
      .sort((a, b) => b.qty - a.qty || orderOf(a.name) - orderOf(b.name) || a.name.localeCompare(b.name, 'ko'));
  }, [requests, selectedYear, selectedMonth, selectedStatus, searchUserQuery, selectedItem, selectedDept, selectedDeptNames, orgUnits, isOrgWideFilter]);

  const isItemDrillDown = selectedItem !== 'ALL';
  const chartRows = isItemDrillDown ? itemOrgChartData : itemChartData;

  const chartTotalQty = useMemo(
    () => chartRows.reduce((sum, row) => sum + row.qty, 0),
    [chartRows]
  );

  const chartHeight = Math.max(140, chartRows.length * 22 + 28);
     
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / itemsPerPage));
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  useEffect(() => { setCurrentPage(1); }, [selectedYear, selectedMonth, selectedDept, selectedStatus, selectedItem, searchUserQuery]);
     
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
      return {
        NO: target.length - idx,
        신청일시: formatKSTDateTime(r.createdAt),
        소속조직: r.dept_name || '',
        신청자: r.user_name || '',
        물품명: itemName,
        신청수량: sUnit ? `${r.qty} ${sUnit}` : r.qty,
        '사용자 의견': r.note || '',
        '관리자 답변': r.admin_opinion || '',
        처리자: r.admin_name || '',
        처리일시: r.processedAt ? formatKSTDateTime(r.processedAt) : '',
        상태: supplyRequestStatusLabel(r.status),
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
  const handleProcessRequest = async (req: any, status: 'COMPLETED' | 'REJECTED') => {
    if (!canEdit) return alertNoEditPermission();
    const reqId = req.id;
    if (processingId) return;
    const opinion = processOpinion[reqId] || '';
    if (!confirm(status === 'COMPLETED' ? '지급 처리하시겠습니까?' : '요청을 반려하시겠습니까?\n(선차감된 재고가 다시 창고로 복구됩니다.)')) return;
    
    setProcessingId(reqId);
    try {
      const res = await fetch('/api/asset/supplies/master/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reqId, status, admin_opinion: opinion })
      });
     
      if (res.ok) { 
        alert(status === 'COMPLETED' ? '✅ 지급 확정 완료' : '🚨 반려 및 재고 복구 완료'); 
        fetchRequestsData(); 
        setProcessOpinion({...processOpinion, [reqId]: ''}); 
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 처리 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) { alert("처리 중 오류가 발생했습니다."); }
    finally { setProcessingId(null); }
  };
     
  const handleCancelDispense = async (req: any) => {
    if (!canEdit) return alertNoEditPermission();
    if (processingId) return;
    if (!confirm(`[경고] 지급철회 하시겠습니까?\n상태가 다시 '대기'로 변경됩니다.\n(선차감 재고는 대기 중에도 유지됩니다.)`)) return;
    
    setProcessingId(req.id);
    try {
      const res = await fetch('/api/asset/supplies/master/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: req.id, status: 'PENDING', admin_opinion: '지급철회(대기 상태로 원복)'
        })
      });
     
      if (res.ok) { 
        alert('✅ 지급철회가 완료되었습니다. (대기 상태로 원복)'); 
        fetchRequestsData(); 
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 지급철회 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) { alert("처리 중 오류가 발생했습니다."); }
    finally { setProcessingId(null); }
  };
     
  const handleDeleteRequest = async (req: any) => {
    if (!canEdit) return alertNoEditPermission();
    if (processingId) return;

    const status = normalizeSupplyRequestStatus(req.status);
    const isCompleted = status === 'COMPLETED';

    if (isCompleted && !isLV1) {
      return alert('지급완료 건 삭제는 LV_1만 가능합니다.');
    }

    const confirmMsg = isCompleted
      ? '경고: 지급완료 건을 영구 삭제하시겠습니까? (LV_1)\n삭제 시 선차감 재고가 창고로 복구됩니다.'
      : '경고: 해당 신청 내역을 영구 삭제하시겠습니까?\n대기 건은 선차감 재고가 창고로 복구됩니다.';
    if (!confirm(confirmMsg)) return;
    
    setProcessingId(req.id);
    try {
      const res = await fetch(`/api/asset/supplies/master/requests?id=${req.id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('🗑️ 삭제되었습니다.');
        fetchRequestsData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 삭제 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) { alert("서버 통신 오류가 발생했습니다."); }
    finally { setProcessingId(null); }
  };
     
  if (loading) return <LoadingState />;

  // 장부 칩 집계: 조직·연도·월·물품 필터 반영 (상태 칩·신청자 검색 제외)
  const scopedForStatusChips = requests.filter((r) => {
    const ym = getKSTYearMonthParts(r.createdAt);
    const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
    const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
    const deptMatch = matchesDeptFilter(r.dept_name);
    const itemName = r.item_name || r.item?.name || '';
    const itemMatch = selectedItem === 'ALL' || itemName === selectedItem;
    return yearMatch && monthMatch && deptMatch && itemMatch;
  });
  const countAll = scopedForStatusChips.length;
  const countPending = scopedForStatusChips.filter((r) => isPendingSupplyRequest(r.status)).length;
  const countCompleted = scopedForStatusChips.filter((r) => isCompletedSupplyRequest(r.status)).length;
  const countRejected = scopedForStatusChips.filter((r) => isRejectedSupplyRequest(r.status)).length;
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
      임직원의 소모품 신청내역을 검토하고 승인/반려 등 관리합니다.
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
        {!canEdit && (
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
     
      {/* 물품별 신청 수량 · 클릭 시 조직별 드릴다운 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></div>
            <div className="min-w-0">
              <h2 className="text-[12px] font-black text-slate-800 tracking-tight">
                {isItemDrillDown ? `📊 ${selectedItem} · 조직별 신청 수량` : '📊 물품별 신청 수량'}
                <span className="ml-2 text-[9px] font-bold text-slate-500">
                  {isItemDrillDown
                    ? '하단 필터 기준 · 막대 클릭 시 조직 필터'
                    : '하단 필터 기준 · 막대 클릭 시 물품 드릴다운'}
                </span>
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-bold bg-slate-300/80 text-slate-700 px-1.5 py-0.5 rounded-md">
              {isItemDrillDown ? `${chartRows.length}개 조직` : `${chartRows.length}개 물품`}
            </span>
            <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md">
              합계 {chartTotalQty.toLocaleString()}
            </span>
            {isItemDrillDown && (
              <button
                type="button"
                onClick={() => setSelectedItem('ALL')}
                className="text-[9px] font-black text-slate-500 hover:text-indigo-600 underline"
              >
                ← 물품 목록
              </button>
            )}
            {!isOrgWideFilter && (
              <button
                type="button"
                onClick={resetOrgFilter}
                className="text-[9px] font-black text-slate-500 hover:text-indigo-600 underline"
              >
                조직 필터 해제
              </button>
            )}
          </div>
        </div>
        <div className="px-3 py-2">
          {chartRows.length === 0 ? (
            <div className="h-[100px] flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
              <p className="text-[10px] font-bold text-slate-400">조건에 맞는 집계 데이터가 없습니다.</p>
            </div>
          ) : (
            <div style={{ height: chartHeight }} className="w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={chartRows}
                  margin={{ top: 2, right: 72, left: 0, bottom: 0 }}
                  barCategoryGap="32%"
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                    height={22}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={148}
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#334155' }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as {
                        name: string;
                        qty: number;
                        percent: number;
                      };
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-md">
                          <p className="text-[10px] font-black text-slate-800">{row.name}</p>
                          <p className="text-[10px] font-bold text-indigo-600 mt-0.5">
                            {row.qty.toLocaleString()} · {row.percent.toFixed(1)}%
                          </p>
                          <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                            {isItemDrillDown ? '클릭하면 장부 조직 필터' : '클릭하면 조직별 드릴다운'}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="qty"
                    radius={[0, 3, 3, 0]}
                    maxBarSize={12}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const name = data?.name || data?.payload?.name;
                      if (!name) return;
                      if (isItemDrillDown) {
                        const orgWideName = String(organizationUnit?.unit_name || 'ALL');
                        setSelectedDept((prev) => (prev === name ? orgWideName : name));
                        return;
                      }
                      setSelectedItem(name);
                    }}
                  >
                    {chartRows.map((row) => (
                      <Cell
                        key={row.name}
                        fill={row.isSelected ? '#4f46e5' : isItemDrillDown ? '#34d399' : '#818cf8'}
                      />
                    ))}
                    <LabelList
                      dataKey="label"
                      position="right"
                      content={(props: any) => {
                        const { x, y, width, height, value } = props;
                        if (x == null || y == null || value == null) return null;
                        const text = String(value);
                        const sep = ' · ';
                        const sepIdx = text.lastIndexOf(sep);
                        const left = sepIdx >= 0 ? text.slice(0, sepIdx + sep.length) : text;
                        const right = sepIdx >= 0 ? text.slice(sepIdx + sep.length) : '';
                        const tx = Number(x) + Number(width || 0) + 6;
                        const ty = Number(y) + Number(height || 0) / 2;
                        return (
                          <text
                            x={tx}
                            y={ty}
                            dominantBaseline="central"
                            fontSize={9}
                            fontWeight={800}
                          >
                            <tspan fill="#334155">{left}</tspan>
                            {right ? <tspan fill="#4f46e5">{right}</tspan> : null}
                          </text>
                        );
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
     
      <section className={`bg-white rounded-[2.5rem] border border-slate-200 shadow-sm animate-in fade-in duration-300 slide-in-from-top-4 mt-6 ${orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
          
          <div className={`p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4 relative ${orgMenuOpen ? 'z-[80] overflow-visible' : ''}`}>
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">
                {selectedStatus === 'ALL' ? '사용자 신청 내역 장부' :
                 selectedStatus === 'PENDING' ? '신규 신청 대기건' :
                 selectedStatus === 'COMPLETED' ? '지급 완료건' : '반려 처리건'}
              </h2>
              <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredRequests.length}건</span>
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
                  onClick={() => setSelectedStatus((prev) => (prev === 'PENDING' ? 'ALL' : 'PENDING'))}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                    selectedStatus === 'PENDING'
                      ? 'bg-orange-500 text-white'
                      : 'bg-orange-50 text-orange-600 border border-orange-100 hover:bg-orange-100'
                  }`}
                >
                  신규 대기 {countPending}
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
                  지급완료 {countCompleted}
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
                  반려 {countRejected}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className={`flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border ${orgMenuOpen ? 'relative z-[90]' : ''}`}>
                <span className="text-[10px] font-black text-slate-400 uppercase leading-none">조직</span>
                <div className="relative inline-flex items-center" ref={orgMenuRef}>
                  <button
                    type="button"
                    onClick={() => setOrgMenuOpen((open) => !open)}
                    className={`max-w-[160px] truncate text-left text-[11px] leading-none py-0 px-0 m-0 h-4 inline-flex items-center border-0 appearance-none outline-none cursor-pointer bg-transparent ${
                      selectedOrgUnit && isBoldOrgType(selectedOrgUnit.unit_type)
                        ? 'font-black text-slate-900'
                        : 'font-bold text-slate-800'
                    }`}
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
                            className={`w-full text-left pr-3 py-1.5 text-[11px] ${
                              bold ? 'font-black text-slate-900' : 'font-medium text-slate-600'
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

                <span className="text-[10px] font-black text-slate-400 uppercase leading-none">연도</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
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
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
                >
                  <option value="ALL">전체</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>{month}월</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border">
                  <span className="text-[10px] font-black text-slate-400 uppercase leading-none">물품</span>
                  <select
                    value={selectedItem}
                    onChange={(e) => setSelectedItem(e.target.value)}
                    className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[160px] h-4 leading-none py-0"
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
                    className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="h-7 px-3 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap leading-none"
              >
                {selectedIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
            </div>
          </div>
     
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed min-w-[1300px]">
            <colgroup>
              <col className="w-[40px]" />
              <col className="w-[48px]" />
              <col className="w-[90px]" />
              <col className="w-[120px]" />
              <col className="w-[180px]" />
              <col className="w-[100px]" />
              <col className="w-[180px]" />
              <col className="w-[180px]" />
              <col className="w-[110px]" />
              <col className="w-[90px]" />
              <col className="w-[64px]" />
              <col className="w-[128px]" />
            </colgroup>
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 text-center"><input type="checkbox" checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></th>
                  <th className="h-12 px-2 text-center">NO</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">신청 일자</th>
                  <th className="h-12 px-2">부서 / 신청자</th>
                  <th className="h-12 px-2 text-indigo-600">물품명</th>
                  <th className="h-12 px-2 text-center text-indigo-600 whitespace-nowrap">신청수량</th>
                  <th className="h-12 px-2">사용자 의견</th>
                  <th className="h-12 px-2 border-l border-slate-200">관리자 답변</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">부서 / 처리자</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap">처리 일자</th>
                  <th className="h-12 px-2 text-center">상태</th>
                  <th className="h-12 px-2 text-center whitespace-nowrap border-l border-slate-200">관리 액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedRequests.length === 0 ? (
                  <tr><td colSpan={12} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 내역이 없습니다.</td></tr>
                ) : paginatedRequests.map((req, i) => {
                  const isPending = isPendingSupplyRequest(req.status);
                  const isRejected = isRejectedSupplyRequest(req.status);
                  const isCompleted = isCompletedSupplyRequest(req.status);
                  const statusLabel = supplyRequestStatusLabel(req.status);
                  const itemName = req.item_name || req.item?.name || '(삭제된 물품)';
                  const itemExt = req.item?.description ? JSON.parse(req.item.description) : {};
                  const sUnit = req.unit || itemExt.r_unit || itemExt.s_unit || 'EA';
                  const processDate = getKSTDateString(req.processedAt) || '-';
                  const createdDate = getKSTDateString(req.createdAt) || '-';
                  const rowNo = filteredRequests.length - ((currentPage - 1) * itemsPerPage + i);
     
                  return (
                    <tr key={req.id} className={`hover:bg-slate-50/50 h-12 transition-colors ${selectedIds.has(req.id) ? 'bg-indigo-50/50' : ''}`}>
                      <td className="pl-4 text-center"><input type="checkbox" checked={selectedIds.has(req.id)} onChange={() => { const next = new Set(selectedIds); selectedIds.has(req.id) ? next.delete(req.id) : next.add(req.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" /></td>
                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">{createdDate}</td>
                      <td className="px-2 truncate">
                        <span className="text-[10px] text-slate-500 block truncate">{req.dept_name || '-'}</span>
                        <span className="text-slate-800 truncate">{req.user_name || '-'}</span>
                      </td>
                      <td className="px-2 text-indigo-700 truncate" title={itemName}>{itemName}</td>
                      <td className="px-2 text-center font-mono whitespace-nowrap tabular-nums text-indigo-600">
                        {req.qty}
                        <span className="text-[10px] font-sans ml-0.5 text-slate-500">{sUnit}</span>
                      </td>
                      <td className="px-2 text-slate-700 truncate" title={req.note}>{req.note ? `"${req.note}"` : '-'}</td>
                      <td className="px-2 border-l border-slate-200">
                        {isPending ? (
                          <input 
                            placeholder="답변..." 
                            value={processOpinion[req.id] || ''} 
                            onChange={(e)=>setProcessOpinion({...processOpinion, [req.id]: e.target.value})} 
                            className="w-full min-w-0 p-1.5 border border-slate-300 rounded-md text-[10px] font-bold text-slate-700 outline-none focus:border-indigo-500 shadow-inner bg-white" 
                          />
                        ) : (
                          <span className="text-slate-700 truncate block w-full" title={req.admin_opinion}>
                            {req.admin_opinion ? `" ${req.admin_opinion} "` : '-'}
                          </span>
                        )}
                      </td>
     
                      <td className="px-2 text-center">
                        {!isPending ? (
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 block truncate">{req.admin_dept || '-'}</span>
                            <span className="text-slate-800 truncate">{req.admin_name || '관리자'}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                        {!isPending ? processDate : <span className="text-slate-300">-</span>}
                      </td>

                      <td className="px-2 text-center">
                        <span className={`inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                          isPending ? 'bg-orange-50 text-orange-600 border-orange-200' :
                          isRejected ? 'bg-red-50 text-red-600 border-red-200' :
                          'bg-emerald-50 text-emerald-600 border-emerald-200'
                        }`}>
                          {statusLabel === '대기중' ? '대기' : statusLabel}
                        </span>
                      </td>
     
                      <td className="px-2 text-center border-l border-slate-200">
                        {isPending ? (
                          <div className="flex items-center justify-center gap-0.5 w-full flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleProcessRequest(req, 'REJECTED')}
                              title={canEdit ? '반려' : '편집 권한 필요'}
                              className={
                                canEdit
                                  ? 'px-1.5 py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap'
                                  : 'px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70'
                              }
                            >
                              반려
                            </button>
                            <button
                              type="button"
                              onClick={() => handleProcessRequest(req, 'COMPLETED')}
                              title={canEdit ? '지급' : '편집 권한 필요'}
                              className={
                                canEdit
                                  ? 'px-1.5 py-1.5 bg-indigo-600 text-white border border-indigo-700 rounded-md text-[10px] font-black shadow-sm hover:bg-indigo-700 whitespace-nowrap'
                                  : 'px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70'
                              }
                            >
                              지급
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRequest(req)}
                              title={canEdit ? '대기 건 영구 삭제 (재고 복구)' : '편집 권한 필요'}
                              className={
                                canEdit
                                  ? 'px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap'
                                  : 'px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70'
                              }
                            >
                              삭제
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-0.5 w-full flex-wrap">
                            {isCompleted && (
                              <button
                                type="button"
                                onClick={() => handleCancelDispense(req)}
                                title={canEdit ? '지급철회(대기 상태로 원복 · 선차감 재고 유지)' : '편집 권한 필요'}
                                className={
                                  canEdit
                                    ? 'px-1.5 py-1.5 bg-orange-50 text-orange-600 border border-orange-200 rounded-md text-[10px] font-black hover:bg-orange-100 shadow-sm whitespace-nowrap'
                                    : 'px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70'
                                }
                              >
                                철회
                              </button>
                            )}
                            {isCompleted ? (
                              canEdit ? (
                                isLV1 ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRequest(req)}
                                    title="지급완료 건 영구 삭제 — LV_1 전용"
                                    className="px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap"
                                  >
                                    삭제(LV_1)
                                  </button>
                                ) : null
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRequest(req)}
                                  title="편집 권한 필요"
                                  className="px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70"
                                >
                                  삭제(LV_1)
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleDeleteRequest(req)}
                                title={canEdit ? '반려 건 영구 삭제' : '편집 권한 필요'}
                                className={
                                  canEdit
                                    ? 'px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap'
                                    : 'px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70'
                                }
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        )}
                      </td>
     
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
  
          {filteredRequests.length > 0 && (
            <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
            </div>
          )}
        </section>
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