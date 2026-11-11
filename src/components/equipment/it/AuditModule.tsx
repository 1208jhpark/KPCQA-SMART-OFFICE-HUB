'use client';
     
import React, { useState, useEffect, useMemo } from 'react';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonthParts, isPastKSTDeadline } from '@/utils/dateUtils';
import { resolveTopOrgName } from '@/utils/orgUnits';
import { isSystemLv1User, resolveInterfaceEditState } from '@/lib/permission-utils';
import LoadingState from '@/components/common/LoadingState';
import DeptAssigneeLine, { useDeptAssignees } from '@/components/common/DeptAssigneeLine';
import ItMasterPageBanner from '@/components/equipment/it/ItMasterPageBanner';
import { auditTargetsOverlap } from '@/utils/itAuditTarget';
import { writeItAuditArchiveExcelBuffer } from '@/lib/it-personal-excel';

const MENU_PATH = '/equipment/it/master/audit';

function historyDateKey(h: any) {
  return h.archivedAt || h.endDate || h.createdAt || null;
}

/** 종료시각을 24시간제 HH:mm으로 정규화 */
function normalizeEndTime24(endTime?: string | null) {
  const raw = String(endTime || '23:59').trim() || '23:59';
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '23:59';
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
     
export default function AuditModule() {
  const [audits, setAudits] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  
  const [editModal, setEditModal] = useState<any | null>(null);
  
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const itemsPerPage = 10;
  
  const fetchAuditData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [auditRes, unitRes, meRes, ifRes] = await Promise.all([
        fetch(`/api/equipment/it/audit?t=${ts}`, { cache: 'no-store' }), 
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
        fetch('/api/auth/me'),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);
  
      if (meRes.ok) setCurrentUser(await meRes.json());
  
      if (auditRes.ok) {
        const loadedAudits = await auditRes.json();
        setAudits(loadedAudits);
      }
  
      if (unitRes.ok) setUnits(await unitRes.json());
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/it/master/audit'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => { fetchAuditData(); }, []);
  useEffect(() => {
    setHistoryPage(1);
    setSelectedHistoryIds(new Set());
  }, [selectedYear, selectedMonth]);

  const hasRunningAudit = useMemo(() => audits.some((a) => a.status === '진행중'), [audits]);

  // 진행 중 실사가 있으면 주기적으로 재조회 → API에서 종료시각 경과 시 자동 마감
  useEffect(() => {
    if (!hasRunningAudit) return;
    const timer = setInterval(() => {
      fetch(`/api/equipment/it/audit?t=${Date.now()}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (Array.isArray(data)) setAudits(data);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [hasRunningAudit]);
  
  const isLV1 = useMemo(() => isSystemLv1User(currentUser), [currentUser]);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  const { editorNames } = useDeptAssignees(MENU_PATH);

  const disabledActionClass =
    'bg-slate-200 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none opacity-70';
  
  const todayStr = getKSTDateString();
  const kstYear = String(getKSTNowYearMonth().year);
  const activeAudits = useMemo(
    () => audits.filter(a => a.status !== '보관됨').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [audits]
  );
  const historyAuditsRaw = useMemo(
    () => audits.filter(a => a.status === '보관됨').sort((a, b) => {
      const da = String(historyDateKey(a) || '');
      const db = String(historyDateKey(b) || '');
      return db.localeCompare(da);
    }),
    [audits]
  );

  // 연계필터: 연도 → 월 (보관일 기준, supplies/dept 동일 패턴)
  const availableYears = useMemo(() => {
    const years = historyAuditsRaw
      .map((h) => getKSTYearMonthParts(historyDateKey(h))?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years));
    if (!unique.includes(kstYear)) unique.push(kstYear);
    return unique.sort((a, b) => b.localeCompare(a));
  }, [historyAuditsRaw, kstYear]);

  const afterYearList = useMemo(() => {
    if (selectedYear === 'ALL') return historyAuditsRaw;
    return historyAuditsRaw.filter((h) => getKSTYearMonthParts(historyDateKey(h))?.year === selectedYear);
  }, [historyAuditsRaw, selectedYear]);

  const availableMonths = useMemo(() => {
    const months = afterYearList
      .map((h) => getKSTYearMonthParts(historyDateKey(h))?.month)
      .filter(Boolean) as string[];
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [afterYearList]);

  const filteredHistory = useMemo(() => {
    if (selectedMonth === 'ALL') return afterYearList;
    return afterYearList.filter((h) => getKSTYearMonthParts(historyDateKey(h))?.month === selectedMonth);
  }, [afterYearList, selectedMonth]);

  useEffect(() => {
    if (
      selectedYear !== 'ALL' &&
      availableYears.length > 0 &&
      !availableYears.includes(selectedYear)
    ) {
      setSelectedYear(kstYear);
    }
  }, [availableYears, selectedYear, kstYear]);

  useEffect(() => {
    if (selectedMonth !== 'ALL' && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth('ALL');
    }
  }, [availableMonths, selectedMonth]);
  
  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const paginatedHistory = filteredHistory.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage);
  const pageHistoryIds = paginatedHistory.map((h) => String(h.id));
  const allPageHistorySelected =
    pageHistoryIds.length > 0 && pageHistoryIds.every((id) => selectedHistoryIds.has(id));
  const toggleHistorySelectAllPage = () => {
    const next = new Set(selectedHistoryIds);
    if (allPageHistorySelected) pageHistoryIds.forEach((id) => next.delete(id));
    else pageHistoryIds.forEach((id) => next.add(id));
    setSelectedHistoryIds(next);
  };
  const toggleHistorySelect = (id: string) => {
    const next = new Set(selectedHistoryIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedHistoryIds(next);
  };

  const parseTargets = (target: string) =>
    String(target || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  const defaultTargetUnit = useMemo(() => {
    return resolveTopOrgName(units) || units.find((u) => u.unit_name)?.unit_name || '';
  }, [units]);

  const sortedUnits = useMemo(() => {
    return [...units].sort((a, b) => {
      const ao = Number(a.sort_order) || 0;
      const bo = Number(b.sort_order) || 0;
      if (ao !== bo) return ao - bo;
      return String(a.unit_name || '').localeCompare(String(b.unit_name || ''), 'ko');
    });
  }, [units]);

  const formatTargetLabel = (target: string) => {
    const parts = parseTargets(target);
    if (parts.length === 0) return '-';
    if (parts.length === 1) return parts[0];
    return parts.join(', ');
  };

  /** 대상범위 겹침: id 우선, 없으면 명칭 (레거시 '전사'는 전체 충돌) */
  const targetsOverlap = (
    a: { target?: string | null; target_unit_ids?: unknown },
    bTarget: string,
    bUnitIds?: unknown
  ) => auditTargetsOverlap(a.target, bTarget, units, a.target_unit_ids, bUnitIds);

  /** 운영 충돌: 작성중·게시중단·진행중 (마감·보관됨은 후속 실사 허용) */
  const findOverlappingActive = (
    target: string,
    excludeId?: string,
    targetUnitIds?: unknown
  ) =>
    audits.filter(
      (a) =>
        a.id !== excludeId &&
        (a.status === '작성중' || a.status === '게시중단' || a.status === '진행중') &&
        targetsOverlap(a, target, targetUnitIds)
    );

  /** 동시 운영 충돌: 진행중만 */
  const findOverlappingRunning = (
    target: string,
    excludeId?: string,
    targetUnitIds?: unknown
  ) =>
    audits.filter(
      (a) =>
        a.status === '진행중' &&
        a.id !== excludeId &&
        targetsOverlap(a, target, targetUnitIds)
    );

  const copyDeployLink = async (publicLink: string) => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(publicLink);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = publicLink;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      alert(
        '모바일/웹 배포 링크가 클립보드에 복사되었습니다!\n게시판이나 메신저에 붙여넣기 하세요.'
      );
    } else {
      alert(
        `클립보드 복사에 실패했습니다.\n아래 링크를 직접 선택해 복사하세요.\n\n${publicLink}`
      );
    }
  };

  const saveAuditPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return alert('편집 권한이 없습니다.');
    try {
      const { id, createdAt, updatedAt, responses, ...submitData } = editModal;
      submitData.endTime = normalizeEndTime24(submitData.endTime);

      if (submitData.startDate && submitData.endDate && submitData.startDate > submitData.endDate) {
        return alert('시작일이 종료일보다 늦을 수 없습니다.');
      }

      const pastDeadline = isPastKSTDeadline(submitData.endDate, submitData.endTime || '23:59');
      const status = String(submitData.status || '작성중');
      if (pastDeadline && (status === '작성중' || status === '게시중단')) {
        return alert(
          '종료 시각이 이미 지났습니다.\n종료일·마감 시각을 수정한 뒤 저장해 주세요.\n(지난 일정으로는 배포 시 즉시 자동마감됩니다.)'
        );
      }
      if (pastDeadline && status === '진행중') {
        if (
          !confirm(
            '종료 시각이 이미 지났습니다.\n오늘 23:59까지로 연장하여 저장할까요?\n(연장하지 않으면 다음 조회 때 자동 마감됩니다.)'
          )
        ) {
          return;
        }
        submitData.endDate = todayStr;
        submitData.endTime = '23:59';
      }

      const excludeId = String(id || '').startsWith('NEW_') ? undefined : id;
      const overlaps = findOverlappingActive(
        submitData.target || '',
        excludeId,
        submitData.target_unit_ids
      );
      if (overlaps.length > 0) {
        const names = overlaps.map((a) => `· ${a.title} (${formatTargetLabel(a.target)}) [${a.status}]`).join('\n');
        return alert(`대상범위가 겹치는 운영 중 실사가 있어 저장할 수 없습니다.\n\n${names}`);
      }

      const isNew = String(id).startsWith('NEW_');
      const res = await fetch('/api/equipment/it/audit', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? submitData : { id, ...submitData }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(`❌ 저장에 실패했습니다.${err?.error ? `\n${err.error}` : ''}`);
      }
      setEditModal(null);
      await fetchAuditData();
      alert('✅ 실사 계획이 저장되었습니다.');
    } catch (error) {
      alert('❌ 저장 중 오류가 발생했습니다.');
    }
  };

  const formatPeriodText = (audit: {
    startDate?: string;
    endDate?: string;
    endTime?: string | null;
  }) => {
    const time = normalizeEndTime24(audit.endTime);
    const start = String(audit.startDate || '').trim() || '-';
    const end = String(audit.endDate || '').trim() || '-';
    return `${start} ~ ${end} (마감 ${time})`;
  };

  const handleHistoryExcelDownload = async () => {
    const targetRows =
      selectedHistoryIds.size > 0
        ? filteredHistory.filter((h) => selectedHistoryIds.has(String(h.id)))
        : filteredHistory;
    if (targetRows.length === 0) return alert('엑셀 다운로드할 대상을 선택해 주세요.');
    try {
      const rows = targetRows.map((h) => ({
        postDate: h.postDate,
        title: h.title,
        description: h.description,
        periodLabel: formatPeriodText(h),
        targetLabel: formatTargetLabel(h.target),
      }));
      const buffer = await writeItAuditArchiveExcelBuffer(rows, {
        sheetName: '실사종료이력',
      });
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'IT_Audit_Archive.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };

  /** Archive 선택 이력 일괄 영구삭제 — LV_1 전용 */
  const handleDeleteSelectedHistory = async () => {
    if (!isLV1) return alert('❌ 삭제 권한이 거부되었습니다. (LV_1 전용)');
    if (selectedHistoryIds.size === 0) {
      return alert('삭제할 이력을 체크박스로 선택해 주세요.');
    }
    if (
      !confirm(
        `🚨 경고: 선택한 실사 이력 ${selectedHistoryIds.size}건을 영구 삭제하시겠습니까?\n데이터 복구가 불가능합니다.`
      )
    ) {
      return;
    }
    try {
      const ids = Array.from(selectedHistoryIds);
      let ok = 0;
      let failMsg = '';
      for (const id of ids) {
        const res = await fetch(`/api/equipment/it/audit?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          ok += 1;
        } else {
          const err = await res.json().catch(() => null);
          failMsg = err?.error || '삭제 실패';
        }
      }
      setSelectedHistoryIds(new Set());
      await fetchAuditData();
      if (ok === ids.length) {
        alert(`✅ ${ok}건이 영구 삭제되었습니다.`);
      } else {
        alert(`⚠️ ${ok}/${ids.length}건 삭제됨${failMsg ? `\n${failMsg}` : ''}`);
      }
    } catch {
      alert('❌ 삭제 중 오류가 발생했습니다.');
    }
  };

  const handleStatusChange = async (id: string, action: 'PUBLISH' | 'STOP' | 'CLOSE' | 'REOPEN' | 'ARCHIVE') => {
    if (!canEdit) return alert('편집 권한이 없습니다.');

    const row = audits.find((a) => a.id === id);

    if (action === 'PUBLISH' || action === 'REOPEN') {
      const overlaps = findOverlappingRunning(row?.target || '', id, row?.target_unit_ids);
      if (overlaps.length > 0) {
        const names = overlaps.map((a) => `· ${a.title} (${formatTargetLabel(a.target)})`).join('\n');
        return alert(`대상범위가 겹치는 진행 중 실사가 있어 ${action === 'PUBLISH' ? '실사 시작' : '마감취소'}할 수 없습니다.\n\n${names}`);
      }
    }

    const rowPastDeadline = row
      ? isPastKSTDeadline(row.endDate, normalizeEndTime24(row.endTime))
      : false;
  
    let patchData: any = { id };
    if (action === 'PUBLISH') {
      if (rowPastDeadline) {
        if (
          !confirm(
            '종료 시각이 이미 지났습니다.\n실사를 시작하면 오늘 23:59까지로 자동 연장됩니다.\n그래도 시작할까요?'
          )
        ) {
          return;
        }
      } else if (!confirm('이 실사를 시작할까요? (진행중)')) {
        return;
      }
      patchData = { id, status: '진행중', postDate: todayStr };
    }
    if (action === 'STOP') patchData = { id, status: '게시중단' };
    if (action === 'CLOSE') {
      if (!confirm("실사 운영을 강제로 마감하시겠습니까?\n해당 대상범위의 마감임박 독촉(audit_request_date)은 해제됩니다.\n자산별 실사 완료 기록(last_audit_date)은 유지됩니다.")) return;
      patchData = { id, status: '마감' };
    }
    if (action === 'REOPEN') {
      if (
        !confirm(
          rowPastDeadline
            ? "마감을 취소하고 다시 '진행중'으로 되돌릴까요?\n종료 시각이 이미 지나 오늘 23:59까지로 자동 연장됩니다."
            : "마감을 취소하고 실사를 다시 '진행중'으로 되돌릴까요?\n(종료일이 이미 지났다면 오늘 23:59까지로 자동 연장됩니다.)"
        )
      ) {
        return;
      }
      patchData = { id, status: '진행중' };
    }
    if (action === 'ARCHIVE') patchData = { id, status: '보관됨', archivedAt: todayStr };
  
    try {
      const res = await fetch('/api/equipment/it/audit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        return alert(`❌ 상태 변경에 실패했습니다.${err?.error ? `\n${err.error}` : ''}`);
      }
      const updated = await res.json().catch(() => null);
      await fetchAuditData();
      if (action === 'PUBLISH') {
        alert(
          updated?.deadlineExtended
            ? '✅ 실사가 시작되었습니다.\n종료 시각이 지나 오늘 23:59까지로 연장되었습니다. 필요하면 기간을 수정하세요.'
            : '✅ 실사가 시작되었습니다.'
        );
      }
      if (action === 'REOPEN') {
        alert(
          updated?.deadlineExtended
            ? "✅ '진행중'으로 복구했습니다.\n종료일이 지나 오늘 23:59까지로 연장되었습니다. 필요하면 기간을 수정하세요."
            : "✅ '진행중'으로 복구했습니다."
        );
      }
    } catch(err) { alert('상태 변경 실패'); }
  };

  const publicAuditLink = (auditId: string) => {
    const BASE_URL =
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    return `${BASE_URL}/audit/public/${auditId}`;
  };

  const statusBadgeClass = (status: string) => {
    if (status === '진행중') return 'bg-indigo-100 text-indigo-700';
    if (status === '마감') return 'bg-emerald-100 text-emerald-700';
    if (status === '보관됨') return 'bg-slate-200 text-slate-600';
    return 'bg-slate-200 text-slate-600';
  };

  const tableColgroup = (
    <colgroup>
      <col className="w-[44px]" />
      <col className="w-[88px]" />
      <col className="w-[160px]" />
      <col className="w-[180px]" />
      <col className="w-[220px]" />
      <col className="w-[150px]" />
      <col className="w-[210px]" />
      <col className="w-[72px]" />
      <col className="w-[158px]" />
    </colgroup>
  );

  const archiveColgroup = (
    <colgroup>
      <col className="w-[40px]" />
      <col className="w-[44px]" />
      <col className="w-[88px]" />
      <col className="w-[220px]" />
      <col className="w-[260px]" />
      <col className="w-[220px]" />
      <col className="w-[200px]" />
    </colgroup>
  );

  const formatPeriodLabel = (audit: { startDate?: string; endDate?: string; endTime?: string | null }) => {
    const time = normalizeEndTime24(audit.endTime);
    return (
      <td className="px-2 text-center text-slate-500 font-medium tabular-nums text-[11px] whitespace-nowrap">
        <div>{audit.startDate} ~ {audit.endDate}</div>
        <div className="text-[9px] font-medium text-slate-400 mt-0.5">마감 {time}</div>
      </td>
    );
  };

  if (loading) return <LoadingState />;
  
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      <ItMasterPageBanner
        label="IT Asset Audit Control Hub"
        title="IT 자산 정기 실사 관제 센터"
        description="실사 일정 수립·배포·마감과 배포 링크를 관리합니다. 자산별 실사·독촉은 마스터 대시보드에서 확인하세요."
        menuPath="/equipment/it/master/audit"
        canEdit={canEdit}
      />
  
      {/* 진행 중 현황판 */}
      <div className="mt-6 bg-white border border-emerald-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-emerald-600 border-b border-emerald-700 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-200 shrink-0" />
            <h2 className="text-sm font-medium text-white tracking-tight">운영 중인 실사 현황 (Active)</h2>
            <span className="text-[11px] font-medium bg-emerald-500/80 text-white px-2 py-0.5 rounded-md">{activeAudits.length}건</span>
            <DeptAssigneeLine editorNames={editorNames} onColor />
          </div>
          <button
            type="button"
            disabled={!canEdit}
            title={!canEdit ? '편집 권한 필요' : undefined}
            onClick={() => {
              if (!canEdit) return;
              setEditModal({ id: `NEW_${Date.now()}`, title: '', description: '', target: defaultTargetUnit, target_unit_ids: sortedUnits.find((u) => u.unit_name === defaultTargetUnit)?.id ? [sortedUnits.find((u) => u.unit_name === defaultTargetUnit)!.id] : [], startDate: todayStr, endDate: todayStr, endTime: '23:59', status: '작성중' });
            }}
            className={`px-4 py-2 rounded-xl font-medium text-xs whitespace-nowrap transition-all ${
              canEdit
                ? 'bg-white text-emerald-700 hover:bg-emerald-50 shadow-md border border-emerald-100 active:scale-95'
                : disabledActionClass
            }`}
          >
            + 신규 실사 계획 수립(Edit)
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1230px]">
            {tableColgroup}
            <thead className="bg-emerald-50 text-emerald-900 text-[10px] font-medium tracking-wide border-b border-emerald-100">
              <tr>
                <th className="h-12 pl-4 text-center">NO</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">게시일</th>
                <th className="h-12 px-3 text-left whitespace-nowrap">실사명</th>
                <th className="h-12 px-3 text-left whitespace-nowrap">내용 요약</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">실사 운영 기간</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">대상범위</th>
                <th className="h-12 px-2 text-center border-l border-emerald-100">
                  <div className="flex flex-col items-center justify-center gap-0.5 py-1">
                    <span className="whitespace-nowrap">모바일/웹 배포 링크</span>
                    <span className="text-[8px] font-medium text-emerald-600/70 leading-tight whitespace-nowrap">참여 시 계정로그인 또는 사번 인증</span>
                  </div>
                </th>
                <th className="h-12 px-2 text-center whitespace-nowrap">상태</th>
                <th className="h-12 pr-4 text-center border-l border-emerald-100 whitespace-nowrap">관리액션(Edit)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-medium text-slate-700">
              {activeAudits.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">운영 중인 실사가 없습니다.</td></tr>
              ) : activeAudits.map((a, idx) => {
                const publicLink = publicAuditLink(a.id);
                return (
                  <tr key={a.id} className="h-14 hover:bg-slate-50/50 transition-colors">
                    <td className="pl-4 text-center text-slate-400">{activeAudits.length - idx}</td>
                    <td className="px-2 text-center font-medium tabular-nums text-slate-500 whitespace-nowrap">{a.postDate || '-'}</td>
                    <td className="px-3">
                      <div className="font-medium text-slate-900 truncate" title={a.title}>{a.title || '-'}</div>
                    </td>
                    <td className="px-3">
                      <div className="text-[11px] font-medium text-slate-500 truncate" title={a.description}>{a.description || '-'}</div>
                    </td>
                    {formatPeriodLabel(a)}
                    <td className="px-2 text-center text-slate-600" title={a.target || ''}>
                      <div className="whitespace-normal break-keep leading-snug">{formatTargetLabel(a.target)}</div>
                    </td>
                    <td className="px-2 border-l border-slate-100">
                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1.5">
                        <input type="text" readOnly value={publicLink} className="w-full min-w-0 text-[9px] font-medium text-slate-500 outline-none bg-transparent" />
                        <button
                          type="button"
                          onClick={() => {
                            void copyDeployLink(publicLink);
                          }}
                          className="px-2 py-1 bg-white border border-slate-200 text-slate-700 rounded text-[9px] font-medium shrink-0 hover:bg-slate-100 whitespace-nowrap"
                        >
                          복사
                        </button>
                      </div>
                    </td>
                    <td className="px-2 text-center whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-medium ${statusBadgeClass(a.status)}`}>{a.status}</span>
                    </td>
                    <td className="pr-4 text-center border-l border-slate-100">
                      <div className="flex justify-center gap-1.5 whitespace-nowrap">
                        {a.status === '작성중' ? (
                          <>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'PUBLISH')} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium ${canEdit ? 'bg-indigo-600 text-white hover:bg-indigo-700' : disabledActionClass}`}>실사 시작</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => { if (!canEdit) return; setEditModal(a); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium border ${canEdit ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : disabledActionClass}`}>수정</button>
                          </>
                        ) : a.status === '게시중단' ? (
                          <>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'PUBLISH')} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium ${canEdit ? 'bg-indigo-600 text-white hover:bg-indigo-700' : disabledActionClass}`}>실사 시작</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => { if (!canEdit) return; setEditModal(a); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium border ${canEdit ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : disabledActionClass}`}>수정</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'CLOSE')} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium ${canEdit ? 'bg-emerald-600 text-white hover:bg-emerald-700' : disabledActionClass}`}>마감</button>
                          </>
                        ) : a.status === '진행중' ? (
                          <>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => { if (!canEdit) return; setEditModal(a); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium border ${canEdit ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : disabledActionClass}`}>수정</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'STOP')} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium border ${canEdit ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : disabledActionClass}`}>중단</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'CLOSE')} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium ${canEdit ? 'bg-emerald-600 text-white hover:bg-emerald-700' : disabledActionClass}`}>마감</button>
                          </>
                        ) : a.status === '마감' ? (
                          <>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'REOPEN')} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium border ${canEdit ? 'bg-white border-amber-200 text-amber-700 hover:bg-amber-50' : disabledActionClass}`}>마감취소</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'ARCHIVE')} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium ${canEdit ? 'bg-slate-800 text-white hover:bg-slate-700' : disabledActionClass}`}>보관함 이동</button>
                          </>
                        ) : (
                          <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'ARCHIVE')} className={`px-4 py-1.5 rounded-lg text-[10px] font-medium ${canEdit ? 'bg-slate-800 text-white hover:bg-slate-700' : disabledActionClass}`}>보관함 이동</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 이력 보관함 */}
      <div className="mt-6 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className={`p-4 px-6 bg-slate-200/70 flex flex-wrap items-center justify-between gap-4 ${isHistoryOpen ? 'border-b border-slate-300' : ''}`}>
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setIsHistoryOpen((v) => !v)}
              className="inline-flex items-center gap-2 min-w-0 rounded-lg hover:bg-white/50 px-1.5 py-1 -ml-1.5 transition-colors"
              aria-expanded={isHistoryOpen}
              title={isHistoryOpen ? '목록 접기' : '목록 펼치기'}
            >
              <span
                className={`text-slate-500 text-[10px] font-medium transition-transform ${isHistoryOpen ? 'rotate-90' : ''}`}
                aria-hidden
              >
                ▶
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
              <h2 className="text-sm font-medium text-slate-800 tracking-tight">실사 종료 이력 (Archive)</h2>
            </button>
            <span className="text-[11px] font-medium bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredHistory.length}건</span>
          </div>

          {!isHistoryOpen && (
            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              className="text-[10px] font-medium text-indigo-600 hover:underline shrink-0"
            >
              펼치기
            </button>
          )}

          {isHistoryOpen && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleHistoryExcelDownload}
              title={
                selectedHistoryIds.size > 0
                  ? `선택한 ${selectedHistoryIds.size}건 엑셀 다운로드`
                  : '필터된 전체 이력 엑셀 다운로드'
              }
              className="px-3 py-1.5 rounded-lg text-[10px] font-medium border transition-colors whitespace-nowrap bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 shadow-sm"
            >
              {selectedHistoryIds.size > 0
                ? `⬇️ 선택 엑셀(${selectedHistoryIds.size})`
                : '⬇️ 엑셀 다운로드'}
            </button>
            {isLV1 && (
              <button
                type="button"
                onClick={handleDeleteSelectedHistory}
                title="체크한 이력 영구 삭제 (LV_1)"
                className={`px-3 py-1.5 rounded-lg text-[10px] font-medium border transition-colors whitespace-nowrap ${
                  selectedHistoryIds.size > 0
                    ? 'bg-white border-red-200 text-red-600 hover:bg-red-50'
                    : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                disabled={selectedHistoryIds.size === 0}
              >
                {selectedHistoryIds.size > 0
                  ? `삭제(LV_1)(${selectedHistoryIds.size})`
                  : '삭제(LV_1)'}
              </button>
            )}
            <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 hidden group-hover/filter:block whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-medium text-white shadow-lg"
              >
                연도 → 월 · 연계필터
              </span>
              <span className="text-[10px] font-medium text-slate-400">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth('ALL');
                }}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
              <span className="text-[10px] font-medium text-slate-400">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{month}월</option>
                ))}
              </select>
            </div>
          </div>
          )}
        </div>

        {isHistoryOpen && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[980px]">
                {archiveColgroup}
                <thead className="bg-slate-100 text-slate-700 text-[10px] font-medium border-b border-slate-200">
                  <tr>
                    <th className="h-12 pl-3 pr-1 text-center">
                      <input
                        type="checkbox"
                        checked={allPageHistorySelected}
                        onChange={toggleHistorySelectAllPage}
                        title="현재 페이지 전체 선택"
                        className="accent-slate-800 cursor-pointer w-3 h-3"
                      />
                    </th>
                    <th className="h-12 text-center">NO</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">게시일</th>
                    <th className="h-12 px-3 text-left whitespace-nowrap">실사명</th>
                    <th className="h-12 px-3 text-left whitespace-nowrap">내용 요약</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">실사 운영 기간</th>
                    <th className="h-12 pr-4 px-2 text-center whitespace-nowrap">대상범위</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-medium text-slate-700">
                  {paginatedHistory.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-slate-400">데이터가 없습니다.</td></tr>
                  ) : paginatedHistory.map((h, idx) => {
                    const no = filteredHistory.length - ((historyPage - 1) * itemsPerPage + idx);
                    const rowId = String(h.id);
                    return (
                      <tr key={h.id} className="h-14 hover:bg-slate-50/50 transition-colors">
                        <td className="pl-3 pr-1 text-center">
                          <input
                            type="checkbox"
                            checked={selectedHistoryIds.has(rowId)}
                            onChange={() => toggleHistorySelect(rowId)}
                            className="accent-slate-800 cursor-pointer w-3 h-3"
                          />
                        </td>
                        <td className="text-center text-slate-400">{no}</td>
                        <td className="px-2 text-center font-medium tabular-nums text-slate-500 whitespace-nowrap">{h.postDate || '-'}</td>
                        <td className="px-3">
                          <div className="font-medium text-slate-900 truncate" title={h.title}>{h.title || '-'}</div>
                        </td>
                        <td className="px-3">
                          <div className="text-[11px] font-medium text-slate-500 truncate" title={h.description}>{h.description || '-'}</div>
                        </td>
                        {formatPeriodLabel(h)}
                        <td className="pr-4 px-2 text-center text-slate-600" title={h.target || ''}>
                          <div className="whitespace-normal break-keep leading-snug">{formatTargetLabel(h.target)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredHistory.length > 0 && (
              <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
                <button type="button" disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
                {Array.from({ length: totalHistoryPages }).map((_, i) => (
                  <button type="button" key={i} onClick={() => setHistoryPage(i + 1)} className={`w-8 h-8 rounded-xl font-medium text-xs transition-all ${historyPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
                ))}
                <button type="button" disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
              </div>
            )}
          </>
        )}
      </div>
  
      {editModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] rounded-lg overflow-hidden shadow-2xl">
            <div className="p-6 bg-slate-900 text-white flex justify-between items-center"><h3 className="font-medium text-sm">실사 계획 수립</h3><button type="button" onClick={() => setEditModal(null)} className="text-slate-400 hover:text-white">✕</button></div>
            <form onSubmit={saveAuditPlan} className="p-8 space-y-5 bg-slate-50">
              <div><label className="text-[11px] font-medium text-slate-500">실사 제목</label><input required type="text" value={editModal.title} onChange={e => setEditModal({...editModal, title: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
              <div><label className="text-[11px] font-medium text-slate-500">상세 설명</label><textarea required value={editModal.description} onChange={e => setEditModal({...editModal, description: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-indigo-500 mt-1 min-h-[80px] shadow-sm" /></div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 block mb-1">대상 부서</label>
                <select
                  required
                  value={editModal.target || ''}
                  onChange={(e) => {
                    const name = e.target.value;
                    const unit = sortedUnits.find((u) => u.unit_name === name);
                    setEditModal({
                      ...editModal,
                      target: name,
                      target_unit_ids: unit?.id ? [unit.id] : [],
                    });
                  }}
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-indigo-500 shadow-sm"
                >
                  <option value="" disabled>조직 선택</option>
                  {editModal.target && !sortedUnits.some((u) => u.unit_name === editModal.target) && (
                    <option value={editModal.target}>{editModal.target} (기존값)</option>
                  )}
                  {sortedUnits.map((u) => (
                    <option key={u.id} value={u.unit_name}>{u.unit_name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[11px] font-medium text-slate-500">시작일</label><input required type="date" value={editModal.startDate} onChange={e => setEditModal({...editModal, startDate: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
                <div><label className="text-[11px] font-medium text-slate-500">종료일</label><input required type="date" value={editModal.endDate} onChange={e => setEditModal({...editModal, endDate: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">종료 시각 (자동 마감 · 24시간제)</label>
                {(() => {
                  const [hh, mm] = normalizeEndTime24(editModal.endTime).split(':');
                  return (
                    <div className="mt-1 flex items-center gap-2">
                      <select
                        required
                        value={hh}
                        onChange={(e) => setEditModal({ ...editModal, endTime: `${e.target.value}:${mm}` })}
                        className="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium tabular-nums outline-none focus:border-indigo-500 shadow-sm"
                        aria-label="종료 시 (0-23)"
                      >
                        {HOURS_24.map((h) => (
                          <option key={h} value={h}>{h}시</option>
                        ))}
                      </select>
                      <span className="text-sm font-medium text-slate-400">:</span>
                      <select
                        required
                        value={mm}
                        onChange={(e) => setEditModal({ ...editModal, endTime: `${hh}:${e.target.value}` })}
                        className="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium tabular-nums outline-none focus:border-indigo-500 shadow-sm"
                        aria-label="종료 분 (0-59)"
                      >
                        {MINUTES_60.map((m) => (
                          <option key={m} value={m}>{m}분</option>
                        ))}
                      </select>
                    </div>
                  );
                })()}
                <p className="mt-1.5 text-[10px] font-medium text-slate-400 leading-relaxed">
                  예: 18:30 · 종료일·시각(KST, 24시간)이 지나면 자동으로 &apos;마감&apos; 처리됩니다.
                </p>
              </div>
              <div className="pt-4 flex gap-2 border-t border-slate-200 mt-4">
                <button type="button" onClick={() => setEditModal(null)} className="flex-1 py-3.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-600 text-xs hover:bg-slate-50">취소</button>
                <button
                  type="submit"
                  disabled={!canEdit}
                  title={!canEdit ? '편집 권한 필요' : undefined}
                  className={`flex-[2] py-3.5 rounded-xl font-medium text-xs shadow-md ${
                    canEdit
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                  }`}
                >
                  저장하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
