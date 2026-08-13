'use client';
     
import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx'; 
import { getKSTDateString, getKSTDaysUntil } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveTopOrgName } from '@/utils/orgUnits';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import {
  getCompletedAuditLabel,
  getDisplayFieldValue,
  hasInfoCorrectionPending,
  parseInfoCorrectionPending,
} from '@/utils/itInfoCorrection';

const MENU_PATH = '/asset/it/dept';

/** 이메일 @ 앞자리 — 동명이인 구분용 */
function emailLocalPart(email: string | null | undefined) {
  const e = String(email || '').trim();
  if (!e) return '';
  const at = e.indexOf('@');
  return (at > 0 ? e.slice(0, at) : e).toLowerCase();
}

/** 부서 화면 조회 범위: 본인 소속만 + (설정 시) 최상위 Organization */
function buildDeptViewScope(opts: {
  userDept: string;
  units: Array<{ id?: string; unit_name?: string | null; parent_id?: string | null; unit_type?: string | null }>;
  globalMgmtDept: string;
}): string[] {
  const depts = new Set<string>();
  const own = String(opts.userDept || '').trim();
  if (own) depts.add(own);

  const mgmt = String(opts.globalMgmtDept || '').trim();
  const topOrg = resolveTopOrgName(opts.units);
  if (!mgmt || !topOrg || !own) return Array.from(depts);

  const covers = (ancestorName: string, descendantName: string) => {
    if (ancestorName === descendantName) return true;
    let current = opts.units.find((u) => u.unit_name === descendantName);
    while (current?.parent_id) {
      const parent = opts.units.find((u) => u.id === current!.parent_id);
      if (!parent) break;
      if (parent.unit_name === ancestorName) return true;
      current = parent;
    }
    return false;
  };

  // admin/settings 전사(최상위) 총괄 부서 지정 — 지정 부서 및 하위 Center만 Organization 자산 조회
  if (own === mgmt || covers(mgmt, own)) {
    depts.add(topOrg);
  }
  return Array.from(depts);
}

export default function DeptModule() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [audits, setAudits] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [focusedAuditId, setFocusedAuditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [memoUnitId, setMemoUnitId] = useState('');
  const [memoDeptName, setMemoDeptName] = useState('');
  const [currentMemo, setCurrentMemo] = useState('');
  const [editableUnitIds, setEditableUnitIds] = useState<string[]>([]);
  const [memoEditing, setMemoEditing] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');
  const [memoSaving, setMemoSaving] = useState(false);
  
  const [typeLabel, setTypeLabel] = useState('자산 분류');
  const [globalMgmtDept, setGlobalMgmtDept] = useState('');
  const [rentalMasterLabels, setRentalMasterLabels] = useState<string[]>([]);
  const [colFilters, setColFilters] = useState({ category: '', it_type: '', is_rental: '', dept: '', user: '' });
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [ddayFilter, setDdayFilter] = useState<'all' | 'd-30' | 'd-day' | 'd-plus'>('all');
  const [showStatusFilter, setShowStatusFilter] = useState<'all' | 'done' | 'pending' | 'nudge' | 'info_correction'>('all');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const todayStr = getKSTDateString();

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [searchQuery, colFilters, showReplaceableOnly, showStatusFilter, ddayFilter, focusedAuditId]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [configRes, meRes, assetRes, auditRes, unitRes, summaryRes, ifRes, memoRes, masterRes] = await Promise.all([
        fetch('/api/admin/config').catch(() => null),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/asset/it?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/asset/it/dept?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);

      let mgmtDept = '';
      if (configRes && configRes.ok) {
        const configData = await configRes.json();
        if (configData?.it_master_label) setTypeLabel(configData.it_master_label);
        mgmtDept = String(configData?.global_mgmt_dept || '').trim();
        setGlobalMgmtDept(mgmtDept);
        if (masterRes && masterRes.ok) {
          const masterData = await masterRes.json();
          const rentalGroup = Array.isArray(masterData)
            ? masterData.find((g: any) => g.id === configData?.it_rental_group)
            : null;
          setRentalMasterLabels(
            rentalGroup?.codes
              ? rentalGroup.codes.filter((c: any) => !c.is_archived).map((c: any) => c.label)
              : []
          );
        } else {
          setRentalMasterLabels([]);
        }
      }

      let user: any = null;
      if (meRes && meRes.ok) {
        const userData = await meRes.json();
        user = {
          ...userData,
          name: String(userData.name || '').trim(),
          dept: String(userData.unit?.unit_name || userData.dept || '').trim(),
          email: userData.email,
          unit_id: userData.unit?.id || '',
        };
        setCurrentUser(user);
      }

      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH)
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }

      if (memoRes && memoRes.ok) {
        const memoData = await memoRes.json();
        setMemoUnitId(String(memoData.unit_id || ''));
        setMemoDeptName(String(memoData.dept_name || ''));
        setCurrentMemo(String(memoData.note || ''));
        setMemoDraft(String(memoData.note || ''));
        setEditableUnitIds(
          Array.isArray(memoData.editableUnitIds)
            ? memoData.editableUnitIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
            : []
        );
      } else {
        setMemoUnitId(user?.unit_id || '');
        setMemoDeptName(user?.dept || '');
        setCurrentMemo('');
        setMemoDraft('');
        setEditableUnitIds([]);
      }

      let unitData: any[] = [];
      if (unitRes && unitRes.ok) {
        const raw = await unitRes.json();
        unitData = Array.isArray(raw) ? raw : [];
        setUnits(unitData);
      }

      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);

      if (auditRes && auditRes.ok) setAudits(await auditRes.json());

      if (assetRes && assetRes.ok) {
        const allAssets = await assetRes.json();
        const list = Array.isArray(allAssets) ? allAssets : [];
        if (user) {
          const allowed = buildDeptViewScope({
            userDept: user.dept,
            units: unitData,
            globalMgmtDept: mgmtDept,
          });
          setAssets(list.filter((a: any) => allowed.includes(String(a.dept || '').trim())));
        } else {
          setAssets([]);
        }
      }
    } catch (e) {
      console.error('Data Sync Failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAllData(); }, []);

  const allowedDepts = useMemo(() => {
    if (!currentUser?.dept) return [];
    return buildDeptViewScope({
      userDept: currentUser.dept,
      units,
      globalMgmtDept,
    });
  }, [currentUser, units, globalMgmtDept]);

  const unitCovers = (ancestorName: string, descendantName: string) => {
    if (ancestorName === descendantName) return true;
    let current = units.find((u) => u.unit_name === descendantName);
    while (current?.parent_id) {
      const parent = units.find((u) => u.id === current.parent_id);
      if (!parent) break;
      if (parent.unit_name === ancestorName) return true;
      current = parent;
    }
    return false;
  };

  /** 로그인 사용자 소속(unit)이 실사 대상범위에 포함되는지 */
  const userInAuditTarget = (target: string) => {
    const dept = String(currentUser?.dept || '').trim();
    if (!dept) return false;
    const targets = String(target || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (targets.length === 0) return false;
    if (targets.includes('전사')) return true;
    return targets.some((t) => unitCovers(t, dept));
  };

  const formatAuditTargetLabel = (target: string) => {
    const parts = String(target || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length === 0) return '대상미정';
    if (parts.length === 1) return parts[0];
    return `${parts[0]} 외`;
  };

  /** 본인 소속에 해당하는 진행 중 실사만 */
  const myRunningAudits = useMemo(
    () =>
      audits
        .filter((a) => a.status === '진행중' && userInAuditTarget(a.target))
        .sort((a, b) => String(a.endDate || '').localeCompare(String(b.endDate || ''))),
    [audits, currentUser, units]
  );

  useEffect(() => {
    if (myRunningAudits.length === 0) {
      if (focusedAuditId) setFocusedAuditId(null);
      setShowStatusFilter((prev) =>
        prev === 'done' || prev === 'pending' || prev === 'nudge' ? 'all' : prev
      );
      return;
    }
    if (!focusedAuditId || !myRunningAudits.some((a) => a.id === focusedAuditId)) {
      setFocusedAuditId(myRunningAudits[0].id);
    }
  }, [myRunningAudits, focusedAuditId]);

  const focusedAudit = useMemo(
    () => myRunningAudits.find((a) => a.id === focusedAuditId) || myRunningAudits[0] || null,
    [myRunningAudits, focusedAuditId]
  );

  const isAuditActive = myRunningAudits.length > 0;
  const activeAudit = focusedAudit;

  const getCoveringAudit = (asset: any) => {
    const dept = String(asset?.dept || currentUser?.dept || '').trim();
    const covered = myRunningAudits.filter((a) => {
      const targets = String(a.target || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (targets.includes('전사')) return true;
      if (!dept) return userInAuditTarget(a.target);
      return targets.some((t) => unitCovers(t, dept));
    });
    if (covered.length === 0) return null;
    return covered.find((a) => a.id === focusedAuditId) || covered[0];
  };
  
  const getAssetLogic = (a: any) => {
    // 교체예정·D-day: API(마스터 규칙)가 부착한 값만 사용
    const repDate = a.replace_due_date || '-';
    const dday =
      typeof a.replace_dday === 'number'
        ? a.replace_dday
        : a.replace_dday === 0
          ? 0
          : null;
    const isTargetCount = dday !== null && dday <= 30;
    
    const lastAudit = a.last_audit_date || '';
    let auditStatusLabel = '미확인';
    let auditStatusDate: string | null = null;
    let auditStatusColor = 'bg-slate-100 text-slate-600 border-slate-300 border-dashed';
    let isVerified = false;
    const coveringAudit = getCoveringAudit(a);
    let isNudged = !!coveringAudit && !!a.audit_request_date;
    const hasInfoCorrection = hasInfoCorrectionPending(a);

    if (coveringAudit) {
      if (lastAudit && lastAudit >= coveringAudit.startDate) {
        isVerified = true;
        auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
        auditStatusDate = lastAudit;
        auditStatusColor = a.last_audit_by === 'admin'
          ? 'bg-violet-50 border-violet-200 text-violet-800'
          : 'bg-slate-100 border-slate-300 text-slate-600';
      } else if (hasInfoCorrection) {
        auditStatusLabel = '수정 대기중';
        auditStatusDate = parseInfoCorrectionPending(a.info_correction_pending)?.requestedAt || null;
        auditStatusColor = 'bg-amber-50 border-amber-300 text-amber-800';
      } else if (isNudged) {
        auditStatusLabel = '마감 임박';
        auditStatusDate = a.audit_request_date || null;
        auditStatusColor = 'bg-rose-100 text-rose-800 border-rose-300';
      } else {
        auditStatusLabel = '미실사';
        auditStatusColor = 'bg-indigo-50 text-indigo-700 border-indigo-200 border-dashed';
      }
    } else if (isAuditActive) {
      // 본인 소속 실사는 있으나 이 자산 부서가 해당 범위 밖
      if (lastAudit) {
        isVerified = true;
        auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
        auditStatusDate = lastAudit;
        auditStatusColor = 'bg-slate-100 text-slate-700 border-slate-300';
      } else {
        auditStatusLabel = '대상 외';
        auditStatusColor = 'bg-slate-100 text-slate-500 border-slate-200 border-dashed';
      }
    } else {
      if (hasInfoCorrection) {
        auditStatusLabel = '수정 대기중';
        auditStatusDate = parseInfoCorrectionPending(a.info_correction_pending)?.requestedAt || null;
        auditStatusColor = 'bg-amber-50 border-amber-300 text-amber-800';
      } else if (lastAudit) {
        auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
        auditStatusDate = lastAudit;
        // 실사 대기 중: 관리자확인 보라 강조 없이 이력만 회색 표시
        auditStatusColor = 'bg-slate-100 text-slate-600 border-slate-300';
        isVerified = true;
      } else {
        // dept는 조회 전용 — 대기 중 미실사는 '-' (개인 화면에서 정보수정/실사)
        auditStatusLabel = '-';
        auditStatusColor = 'bg-slate-100 text-slate-500 border-slate-200 border-dashed';
      }
    }
    const auditStatusText = auditStatusDate ? `${auditStatusLabel} (${auditStatusDate})` : auditStatusLabel;
     
    return {
      repDate, dday, isTargetCount, isVerified, isNudged, hasInfoCorrection,
      auditStatusLabel, auditStatusDate, auditStatusText, auditStatusColor,
    };
  };

  const stats = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    let verified = 0;
    let auditDoneCount = 0, auditPendingCount = 0, auditNudgeCount = 0, infoCorrectionCount = 0;
    let d30Count = 0, dDayCount = 0, dPlusCount = 0;
    assets.forEach(a => {
      typeCounts[a.it_type] = (typeCounts[a.it_type] || 0) + 1;
      const logic = getAssetLogic(a);
      if (logic.isVerified) verified++;

      if (logic.hasInfoCorrection) infoCorrectionCount++;
      if (isAuditActive) {
        if (logic.isVerified) auditDoneCount++;
        else if (logic.hasInfoCorrection) {
          /* already counted */
        } else if (logic.isNudged) auditNudgeCount++;
        else auditPendingCount++;
      }

      if (logic.dday !== null) {
        if (logic.dday > 0 && logic.dday <= 30) d30Count++;
        else if (logic.dday === 0) dDayCount++;
        else if (logic.dday < 0) dPlusCount++;
      }
    });
    return {
      verified,
      typeCounts,
      total: assets.length,
      replaceable: assets.filter(a => getAssetLogic(a).isTargetCount).length,
      d30Count,
      dDayCount,
      dPlusCount,
      unverified: assets.length - verified,
      auditDoneCount,
      auditPendingCount,
      auditNudgeCount,
      infoCorrectionCount,
    };
  }, [assets, activeAudit, isAuditActive, myRunningAudits, focusedAuditId]);

  /** 실사 종료일까지 남은 일수 (KST 일자 기준, 진행 중이 아니면 null) */
  const auditDaysLeft = useMemo(() => {
    if (!activeAudit?.endDate) return null;
    return getKSTDaysUntil(String(activeAudit.endDate));
  }, [activeAudit]);
  
  /** 나의 보유 자산 기준 — 건수 많은 순(랭크) */
  const uniqueCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    assets.forEach((a) => {
      const key = String(a.category || '').trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
  }, [assets]);

  const uniqueItTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    assets.forEach((a) => {
      const key = String(a.it_type || '').trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
  }, [assets]);

  const uniqueProcurementTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    assets.forEach((a) => {
      const key = String(a.is_rental || '').trim();
      if (!key || key === '-') return;
      counts[key] = (counts[key] || 0) + 1;
    });
    const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
    for (const label of rentalMasterLabels) {
      const key = String(label || '').trim();
      if (key && !ranked.includes(key)) ranked.push(key);
    }
    return ranked;
  }, [assets, rentalMasterLabels]);

  const uniqueDepts = useMemo(() => allowedDepts, [allowedDepts]);

  const uniqueUsers = useMemo(() => {
    const users = new Set(assets.map((a) => a.user).filter(Boolean));
    return Array.from(users).sort((a, b) => String(a).localeCompare(String(b), 'ko'));
  }, [assets]);
  
  const filteredAssets = useMemo(() => {
    return assets
      .filter((a) => {
        const s = searchQuery.toLowerCase().trim();
        const logic = getAssetLogic(a);
        const matchSearch = !s || [a.code, a.model, a.sn, a.brand, a.spec].some(v => String(v).toLowerCase().includes(s));
        const matchCategory = !colFilters.category || a.category === colFilters.category;
        const matchItType = !colFilters.it_type || a.it_type === colFilters.it_type;
        const matchRental = !colFilters.is_rental || a.is_rental === colFilters.is_rental;
        const matchDept = !colFilters.dept || a.dept === colFilters.dept;
        const matchUser = !colFilters.user || a.user === colFilters.user;

        const matchReplace = !showReplaceableOnly || logic.isTargetCount;
        let matchDday = true;
        if (ddayFilter !== 'all' && logic.dday !== null) {
          if (ddayFilter === 'd-30') matchDday = logic.dday > 0 && logic.dday <= 30;
          else if (ddayFilter === 'd-day') matchDday = logic.dday === 0;
          else if (ddayFilter === 'd-plus') matchDday = logic.dday < 0;
        } else if (ddayFilter !== 'all') {
          matchDday = false;
        }
        let matchStatus = true;
        if (showStatusFilter === 'done') matchStatus = logic.isVerified;
        else if (showStatusFilter === 'pending') {
          matchStatus = !logic.isVerified && !logic.hasInfoCorrection && !logic.isNudged;
        } else if (showStatusFilter === 'nudge') {
          matchStatus = !logic.isVerified && logic.isNudged && !logic.hasInfoCorrection;
        } else if (showStatusFilter === 'info_correction') {
          matchStatus = logic.hasInfoCorrection;
        }
        return matchSearch && matchCategory && matchItType && matchRental && matchDept && matchUser && matchReplace && matchDday && matchStatus;
      })
      // 최신 등록이 위 · NO는 큰 수가 위
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [assets, searchQuery, colFilters, showReplaceableOnly, ddayFilter, showStatusFilter, activeAudit, myRunningAudits, focusedAuditId]);
  
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));

  const toggleSelectAllFiltered = () => {
    const allIds = filteredAssets.map((a) => a.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  };

  const allFilteredSelected =
    filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.has(a.id));
  
  const handleExcelDownload = () => {
    const targetAssets = selectedIds.size > 0 ? filteredAssets.filter(a => selectedIds.has(a.id)) : filteredAssets;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const excelData = targetAssets.map((a, index) => {
      const logic = getAssetLogic(a);
      return {
        'NO': targetAssets.length - index,
        '조직': a.dept || '-',
        '사용자': a.user || '-',
        '이메일': emailLocalPart(a.user_email) || '-',
        '범주': a.category,
        '자산 분류': a.it_type,
        '조달유형': a.is_rental || '-',
        '자산번호': a.code,
        '모델명': a.model,
        'S/N': a.sn,
        '제조사': a.brand || '-',
        '기본 사양': a.spec,
        '입고일': a.in_date || '-',
        '교체주기(M)': a.cycle,
        '교체예정일': logic.repDate,
        '최근실사일': a.last_audit_date || '-',
        '기타(메모)': a.memo,
      };
    });
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dept_Assets"); XLSX.writeFile(wb, `부서업무자산현황_${currentUser?.dept || 'dept'}.xlsx`);
  };
  
  const editState = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig),
    [currentUser, interfaceConfig]
  );

  const canEditMemo =
    editState.isEditor &&
    !!memoUnitId &&
    editableUnitIds.includes(String(memoUnitId));

  const startMemoEdit = () => {
    if (!editState.isEditor) {
      return alert('공유 메모 수정 권한이 없습니다.\nadmin/interface에서 해당 메뉴 Edit 권한을 확인하세요.');
    }
    if (!canEditMemo) {
      return alert('선택한 조직은 Edit Scope 밖이라 공유 메모를 수정할 수 없습니다.');
    }
    setMemoDraft(currentMemo);
    setMemoEditing(true);
  };

  const cancelMemoEdit = () => {
    setMemoDraft(currentMemo);
    setMemoEditing(false);
  };

  const saveMemo = async () => {
    if (!editState.isEditor) return alert('공유 메모 수정 권한이 없습니다. (Edit 필요)');
    if (!canEditMemo) return alert('선택한 조직은 Edit Scope 밖이라 공유 메모를 수정할 수 없습니다.');
    if (!memoUnitId && !memoDeptName) return alert('대상 조직을 확인할 수 없습니다.');
    setMemoSaving(true);
    try {
      const res = await fetch('/api/asset/it/dept', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: memoUnitId || undefined,
          note: memoDraft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setCurrentMemo(String(data.note ?? memoDraft));
      setMemoDraft(String(data.note ?? memoDraft));
      if (data.unit_id) setMemoUnitId(String(data.unit_id));
      if (data.dept_name) setMemoDeptName(String(data.dept_name));
      setMemoEditing(false);
    } catch (e: any) {
      alert(e?.message || '공유 메모 저장 중 오류가 발생했습니다.');
    } finally {
      setMemoSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!currentUser) return <div className="p-20 text-center font-black text-red-500">인증 정보가 없습니다. 다시 로그인해주세요.</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">

      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2.5">
            IT ASSET DEPARTMENT DESK
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-indigo-400 font-normal">{currentUser?.dept || '-'}</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-extrabold">부서 IT·업무자산 현황</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            본인 소속 자산과 실사 현황을 조회합니다. (설정 시 최상위 조직 자산 포함)
          </p>
          {permissionSummary && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-slate-50 shadow-sm">
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
              {!editState.isEditor && (
                <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
                  편집 권한 없음 — 조회만 가능
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {/* 카드 1: 부서 보유 자산 요약 */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[168px]">
          <div className="flex items-start justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">부서 보유 자산</p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">유형별 요약</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-black text-slate-900 tracking-tighter leading-none tabular-nums">{stats.total}</p>
              <p className="text-[9px] font-bold text-slate-400 mt-1">총 보유</p>
            </div>
          </div>
          <div className="flex-1 min-h-0 mt-3 flex flex-wrap content-start gap-1.5">
            {Object.keys(stats.typeCounts).length === 0 ? (
              <div className="w-full h-full min-h-[64px] flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                <p className="text-[10px] font-bold text-slate-400">등록된 자산 없음</p>
              </div>
            ) : (
              Object.entries(stats.typeCounts).map(([type, count]) => {
                const isSelected = colFilters.it_type === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setColFilters({ ...colFilters, it_type: isSelected ? '' : type });
                    }}
                    className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-black transition-all ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {type} <span className={isSelected ? 'text-indigo-100' : 'text-indigo-600'}>{count}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="pt-3 mt-auto border-t border-slate-100 grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setShowReplaceableOnly(false);
                setDdayFilter((p) => (p === 'd-30' ? 'all' : 'd-30'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                ddayFilter === 'd-30'
                  ? 'bg-blue-500 border-blue-400 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-blue-600 hover:bg-blue-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D-30)</span>
              <span className="text-sm font-black tabular-nums">{stats.d30Count}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReplaceableOnly(false);
                setDdayFilter((p) => (p === 'd-day' ? 'all' : 'd-day'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                ddayFilter === 'd-day'
                  ? 'bg-amber-500 border-amber-400 text-amber-900 shadow-sm'
                  : 'bg-white border-slate-200 text-amber-600 hover:bg-amber-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D-Day)</span>
              <span className="text-sm font-black tabular-nums">{stats.dDayCount}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReplaceableOnly(false);
                setDdayFilter((p) => (p === 'd-plus' ? 'all' : 'd-plus'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                ddayFilter === 'd-plus'
                  ? 'bg-rose-500 border-rose-400 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D+)</span>
              <span className="text-sm font-black tabular-nums">{stats.dPlusCount}</span>
            </button>
          </div>
        </div>

        {/* 카드 2: 실사 운영 상태 */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[168px]">
          <div className="shrink-0 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">실사 운영 상태</p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">Audit Status</p>
            </div>
            {myRunningAudits.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end max-w-[58%]">
                {myRunningAudits.map((a) => {
                  const selected = focusedAudit?.id === a.id;
                  const label = formatAuditTargetLabel(a.target);
                  const endTime = (a.endTime || '23:59').trim() || '23:59';
                  return (
                    <button
                      key={a.id}
                      type="button"
                      title={`${a.title || '실사'}\n${a.startDate} ~ ${a.endDate} ${endTime}\n내 소속: ${currentUser?.dept || '-'}`}
                      onClick={() => setFocusedAuditId(a.id)}
                      className={`px-2 py-0.5 rounded-md text-[9px] font-black border transition-all whitespace-nowrap ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex-1 mt-3 flex flex-col justify-center gap-3">
            <div className="flex items-center justify-between gap-2">
              {isAuditActive ? (
                <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg font-black text-[11px] animate-pulse">
                  🟢 실사 진행 중{myRunningAudits.length > 1 ? ` · ${myRunningAudits.length}건` : ''}
                </span>
              ) : (
                <span className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-black text-[11px]">
                  ⚪ 실사 대기 중
                </span>
              )}
              {isAuditActive && auditDaysLeft !== null && (
                <div className="text-right">
                  <p className="text-xl font-black text-indigo-600 tracking-tighter leading-none tabular-nums">
                    {auditDaysLeft >= 0 ? `D-${auditDaysLeft}` : `D+${Math.abs(auditDaysLeft)}`}
                  </p>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5">남은 기간</p>
                </div>
              )}
            </div>
            {isAuditActive && focusedAudit && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  현재 실사 운영 기간
                </p>
                <p className="mt-1 text-[13px] font-black tracking-tight text-indigo-700">
                  {focusedAudit.startDate} ~ {focusedAudit.endDate}
                </p>
                <p className="mt-1 text-[10px] font-bold text-slate-400 font-mono">
                  마감 {(focusedAudit.endTime || '23:59').trim() || '23:59'}
                </p>
              </div>
            )}
          </div>
          <div className="pt-3 mt-auto border-t border-slate-100 grid grid-cols-4 gap-1.5">
            <button
              type="button"
              disabled={!isAuditActive}
              title={!isAuditActive ? '실사 진행 중에만 집계·필터됩니다.' : undefined}
              onClick={() => {
                if (!isAuditActive) return;
                setShowStatusFilter((prev) => (prev === 'done' ? 'all' : 'done'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                !isAuditActive
                  ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                  : showStatusFilter === 'done'
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">실사 완료장비</span>
              <span className="text-sm font-black tabular-nums">{isAuditActive ? stats.auditDoneCount : 0}</span>
            </button>
            <button
              type="button"
              disabled={!isAuditActive}
              title={!isAuditActive ? '실사 진행 중에만 집계·필터됩니다.' : undefined}
              onClick={() => {
                if (!isAuditActive) return;
                setShowStatusFilter((prev) => (prev === 'pending' ? 'all' : 'pending'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                !isAuditActive
                  ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                  : showStatusFilter === 'pending'
                    ? 'bg-slate-700 border-slate-600 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">미실사 장비</span>
              <span className="text-sm font-black tabular-nums">{isAuditActive ? stats.auditPendingCount : 0}</span>
            </button>
            <button
              type="button"
              disabled={!isAuditActive}
              title={!isAuditActive ? '실사 진행 중에만 집계·필터됩니다.' : undefined}
              onClick={() => {
                if (!isAuditActive) return;
                setShowStatusFilter((prev) => (prev === 'nudge' ? 'all' : 'nudge'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                !isAuditActive
                  ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                  : showStatusFilter === 'nudge'
                    ? 'bg-rose-600 border-rose-500 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">미실사/마감 임박 장비</span>
              <span className="text-sm font-black tabular-nums">{isAuditActive ? stats.auditNudgeCount : 0}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowStatusFilter((prev) => (prev === 'info_correction' ? 'all' : 'info_correction'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                showStatusFilter === 'info_correction'
                  ? 'bg-amber-500 border-amber-400 text-amber-900 shadow-sm'
                  : 'bg-white border-slate-200 text-amber-600 hover:bg-amber-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">정보수정 승인대기</span>
              <span className="text-sm font-black tabular-nums">{stats.infoCorrectionCount}</span>
            </button>
          </div>
        </div>

        {/* 카드 3: 공유 메모판 (소모품 부서와 동일 DB 필드) */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[168px]">
          <div className="shrink-0 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                <span>📌</span>
                <span>공유 메모판</span>
              </p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5 truncate">
                {memoDeptName || currentUser?.dept || '-'}
              </p>
            </div>
            {!memoEditing ? (
              <button
                type="button"
                onClick={startMemoEdit}
                disabled={!canEditMemo}
                title={canEditMemo ? '공유 메모 수정' : '편집 권한 필요'}
                className={`text-[9px] font-bold shrink-0 transition-colors ${
                  canEditMemo
                    ? 'text-slate-400 hover:text-indigo-600'
                    : 'text-slate-300 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md cursor-not-allowed opacity-70'
                }`}
              >
                수정
              </button>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={memoSaving}
                  onClick={cancelMemoEdit}
                  className="text-[9px] font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={memoSaving}
                  onClick={saveMemo}
                  className="text-[9px] font-black text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                >
                  {memoSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 mt-3 min-h-0 flex flex-col">
            {memoEditing ? (
              <textarea
                value={memoDraft}
                onChange={(e) => setMemoDraft(e.target.value)}
                rows={5}
                maxLength={4000}
                placeholder={'예)\n• 공용 노트북: 부서 입구 우측 캐비닛\n• 충전기/어댑터: 서랍장 2단'}
                className="w-full flex-1 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700 leading-relaxed outline-none focus:border-indigo-400 resize-none min-h-[88px]"
              />
            ) : (
              <div className="flex-1 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 text-[10px] font-bold text-slate-600 leading-relaxed whitespace-pre-wrap overflow-y-auto min-h-[88px]">
                {currentMemo.trim()
                  ? currentMemo
                  : canEditMemo
                    ? '등록된 안내가 없습니다. [수정]을 눌러 작성해 주세요.'
                    : '등록된 안내가 없습니다.'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">부서 업무자산 목록</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredAssets.length}건</span>
            {showReplaceableOnly && (
              <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">교체대상만</span>
            )}
            {ddayFilter !== 'all' && (
              <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                {ddayFilter === 'd-30' ? '교체(D-30)' : ddayFilter === 'd-day' ? '교체(D-Day)' : '교체(D+)'}만
              </span>
            )}
            {showStatusFilter === 'done' && (
              <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">실사 완료만</span>
            )}
            {showStatusFilter === 'pending' && (
              <span className="text-[10px] font-black text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">미실사만</span>
            )}
            {showStatusFilter === 'nudge' && (
              <span className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">마감 임박만</span>
            )}
            {showStatusFilter === 'info_correction' && (
              <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">정보수정 승인대기만</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase">부서</span>
              <select
                value={colFilters.dept}
                onChange={(e) => setColFilters({ ...colFilters, dept: e.target.value })}
                className="text-[11px] font-black text-indigo-700 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="">전체</option>
                {uniqueDepts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase">사용자</span>
              <select
                value={colFilters.user}
                onChange={(e) => setColFilters({ ...colFilters, user: e.target.value })}
                className="text-[11px] font-black text-blue-700 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="">전체</option>
                {uniqueUsers.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase">범주</span>
              <select
                value={colFilters.category}
                onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="">전체</option>
                {uniqueCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase">{typeLabel}</span>
              <select
                value={colFilters.it_type}
                onChange={(e) => setColFilters({ ...colFilters, it_type: e.target.value })}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="">전체</option>
                {uniqueItTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">조달유형</span>
              <select
                value={colFilters.is_rental}
                onChange={(e) => setColFilters({ ...colFilters, is_rental: e.target.value })}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="">전체</option>
                {uniqueProcurementTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="relative w-48">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input
                type="text"
                placeholder="모델명, S/N, 사양 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={handleExcelDownload}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
            >
              {selectedIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedIds.size})`
                : '화면 목록 EXCEL 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-hidden">
          <table className="w-full text-left border-collapse table-fixed">
            <colgroup>
              <col style={{ width: '2.5%' }} />
              <col style={{ width: '3%' }} />
              <col style={{ width: '6.5%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '5.5%' }} />
              <col style={{ width: '4.5%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '4.5%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '6.5%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '5.5%' }} />
              <col style={{ width: '4%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '5.5%' }} />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-2 text-center">
                  <input
                    type="checkbox"
                    title={`필터된 전체 ${filteredAssets.length}건 선택/해제`}
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    className="w-3.5 h-3.5 cursor-pointer appearance-none rounded-[3px] border-2 border-indigo-600 bg-white checked:bg-indigo-600 checked:border-indigo-600 relative
                      after:content-[''] after:absolute after:hidden checked:after:block
                      after:left-[3px] after:top-[0px] after:w-[4px] after:h-[8px]
                      after:border-white after:border-r-2 after:border-b-2 after:rotate-45"
                  />
                </th>
                <th className="h-12 px-1 text-center">NO</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">부서</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">사용자</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">이메일</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">범주</th>
                <th className="h-12 px-1 text-center bg-indigo-50 text-indigo-600 border-r border-slate-200 whitespace-nowrap">{typeLabel}</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">조달유형</th>
                <th className="h-12 px-2">자산번호</th>
                <th className="h-12 px-2">모델명</th>
                <th className="h-12 px-2 text-slate-900">S/N</th>
                <th className="h-12 px-2 text-slate-900 whitespace-nowrap">제조사</th>
                <th className="h-12 px-2 text-slate-900">기본 사양</th>
                <th className="h-12 px-1 text-center text-slate-900 whitespace-nowrap">입고일</th>
                <th className="h-12 px-1 text-center text-slate-900 whitespace-nowrap">교체주기(M)</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">교체예정일</th>
                <th className="h-12 px-1 text-center border-l border-slate-200 whitespace-nowrap">실사/정보수정</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedAssets.length === 0 ? (
                <tr><td colSpan={17} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 자산이 없습니다.</td></tr>
              ) : (
                paginatedAssets.map((a, idx) => {
                  const logic = getAssetLogic(a);
                  const isSelected = selectedIds.has(a.id);
                  const rowNo = filteredAssets.length - ((currentPage - 1) * itemsPerPage + idx);

                  return (
                    <tr key={a.id} className={`h-12 hover:bg-slate-50/50 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                      <td className="pl-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                      </td>
                      <td className="px-1 text-center font-mono text-slate-500 tabular-nums">
                        {rowNo}
                      </td>
                      <td className="px-1 text-center truncate" title={a.dept || ''}>
                        {a.dept || '-'}
                      </td>
                      <td className="px-1 text-center truncate" title={a.user || ''}>
                        {a.user || '-'}
                      </td>
                      <td className="px-1 text-center truncate text-slate-600" title={a.user_email || ''}>
                        {emailLocalPart(a.user_email) || '-'}
                      </td>
                      <td className="px-1 text-center truncate" title={a.category || ''}>
                        {a.category || '-'}
                      </td>
                      <td className="px-1 text-center text-indigo-700 font-black truncate border-r border-slate-200" title={a.it_type || ''}>
                        {a.it_type || '-'}
                      </td>
                      <td className="px-1 text-center whitespace-nowrap text-slate-800" title={a.is_rental || ''}>
                        {a.is_rental || '-'}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'code').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'code');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'model').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'model');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-800'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 font-mono truncate" title={getDisplayFieldValue(a, 'sn').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'sn');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'brand').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'brand');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'spec').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'spec');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-1 text-center text-slate-900 font-mono tabular-nums whitespace-nowrap" title={a.in_date || ''}>
                        {a.in_date || '-'}
                      </td>
                      <td className="px-1 text-center text-slate-900 tabular-nums">{a.cycle ?? '-'}</td>
                      <td className="px-1 text-center whitespace-nowrap" title={logic.repDate}>
                        <span className="text-slate-800 tabular-nums">{logic.repDate}</span>
                        {logic.dday !== null && logic.dday <= 30 && (
                          <span
                            className={`ml-1 px-2 py-0.5 rounded-md text-[9px] font-black animate-pulse shadow-sm ${
                              logic.dday > 0
                                ? 'bg-blue-500 text-white'
                                : logic.dday === 0
                                  ? 'bg-amber-400 text-amber-900'
                                  : 'bg-rose-500 text-white'
                            }`}
                          >
                            {logic.dday > 0 ? `D-${logic.dday}` : logic.dday === 0 ? 'D-Day' : `D+${Math.abs(logic.dday)}`}
                          </span>
                        )}
                      </td>
                      <td className="px-1 text-center border-l border-slate-200">
                        <div
                          title={logic.auditStatusText}
                          className={`w-full h-[2.25rem] px-0.5 rounded text-[10px] font-black tracking-tight border leading-tight flex flex-col items-center justify-center cursor-default ${logic.auditStatusColor}`}
                        >
                          <span className="truncate max-w-full">{logic.auditStatusLabel}</span>
                          {logic.auditStatusDate && (
                            <span className="text-[9px] font-bold tabular-nums mt-0.5 opacity-90">({logic.auditStatusDate})</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredAssets.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </div>

    </div>
  );
}
