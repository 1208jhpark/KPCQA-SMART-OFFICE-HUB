'use client';
     
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth, isPastKSTDeadline } from '@/utils/dateUtils';
import { resolveTopOrgName } from '@/utils/orgUnits';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import LoadingState from '@/components/common/LoadingState';
import ItMasterPageBanner from '@/components/asset/it/ItMasterPageBanner';

const MENU_PATH = '/asset/it/master/audit';

/** KST 기준 연·월 문자열 (year: '2026', month: '07') */
function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const raw = String(dateInput).trim();
  const ymd = raw.match(/^(\d{4})-(\d{2})/);
  if (ymd) return { year: ymd[1], month: ymd[2] };
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return {
    year: String(ym.year),
    month: String(ym.month).padStart(2, '0'),
  };
}

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
  const itemsPerPage = 10;
  
  const fetchAuditData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [auditRes, unitRes, meRes, ifRes] = await Promise.all([
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }), 
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
  useEffect(() => { setHistoryPage(1); }, [selectedYear, selectedMonth]);

  const hasRunningAudit = useMemo(() => audits.some((a) => a.status === '진행중'), [audits]);

  // 진행 중 실사가 있으면 주기적으로 재조회 → API에서 종료시각 경과 시 자동 마감
  useEffect(() => {
    if (!hasRunningAudit) return;
    const timer = setInterval(() => {
      fetch(`/api/asset/it/audit?t=${Date.now()}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (Array.isArray(data)) setAudits(data);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [hasRunningAudit]);
  
  const isLV1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles)
      ? currentUser.roles
      : (() => {
          try {
            return JSON.parse(currentUser.roles || '[]');
          } catch {
            return [];
          }
        })();
    return roles.some((r: any) => {
      const m = String(r).match(/\d+/);
      return m ? `LV_${m[0]}` === 'LV_1' : String(r).includes('LV_1');
    });
  }, [currentUser]);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

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

  const handleExportExcel = () => {
    if (filteredHistory.length === 0) {
      return alert('내보낼 실사 이력이 없습니다.');
    }
    const rows = filteredHistory.map((h, index) => ({
      NO: filteredHistory.length - index,
      게시일: h.postDate || '-',
      실사명: h.title || '-',
      대상범위: formatTargetLabel(h.target),
      시작일: h.startDate || '-',
      종료일: h.endDate || '-',
      종료시각: h.endTime || '23:59',
      보관일: h.archivedAt || '-',
      상태: h.status || '-',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'IT_Audit_Archive');
    const yearStr = selectedYear === 'ALL' ? '전체' : `${selectedYear}년`;
    const monthStr = selectedMonth === 'ALL' ? '' : `_${selectedMonth}월`;
    XLSX.writeFile(wb, `IT실사이력_${yearStr}${monthStr}.xlsx`);
  };
  
  const parseTargets = (target: string) =>
    String(target || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  /** A가 B의 상위(또는 동일) 조직인지 */
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

  /** 대상범위 겹침: 동일/상·하위 조직 (레거시 '전사'는 전체 충돌로 간주) */
  const targetsOverlap = (aTarget: string, bTarget: string) => {
    const ta = parseTargets(aTarget);
    const tb = parseTargets(bTarget);
    if (ta.length === 0 || tb.length === 0) return false;
    if (ta.includes('전사') || tb.includes('전사')) return true;
    for (const x of ta) {
      for (const y of tb) {
        if (unitCovers(x, y) || unitCovers(y, x)) return true;
      }
    }
    return false;
  };

  /** 운영 충돌: 작성중·게시중단·진행중 (마감·보관됨은 후속 실사 허용) */
  const findOverlappingActive = (target: string, excludeId?: string) =>
    audits.filter(
      (a) =>
        a.id !== excludeId &&
        (a.status === '작성중' || a.status === '게시중단' || a.status === '진행중') &&
        targetsOverlap(a.target, target)
    );

  /** 동시 운영 충돌: 진행중만 */
  const findOverlappingRunning = (target: string, excludeId?: string) =>
    audits.filter(
      (a) => a.status === '진행중' && a.id !== excludeId && targetsOverlap(a.target, target)
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
        '모바일/웹 배포 링크가 클립보드에 복사되었습니다!\n게시판이나 메신저에 붙여넣기 하세요.\n\n⚠ 사내 LAN 및 Wi-Fi에서만 접속 가능합니다. (외부망·LTE 불가)'
      );
    } else {
      alert(
        `클립보드 복사에 실패했습니다.\n아래 링크를 직접 선택해 복사하세요.\n\n${publicLink}\n\n⚠ 사내 LAN 및 Wi-Fi에서만 접속 가능합니다.`
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
      const overlaps = findOverlappingActive(submitData.target || '', excludeId);
      if (overlaps.length > 0) {
        const names = overlaps.map((a) => `· ${a.title} (${formatTargetLabel(a.target)}) [${a.status}]`).join('\n');
        return alert(`대상범위가 겹치는 운영 중 실사가 있어 저장할 수 없습니다.\n\n${names}`);
      }

      const isNew = String(id).startsWith('NEW_');
      const res = await fetch('/api/asset/it/audit', {
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

  const handleStatusChange = async (id: string, action: 'PUBLISH' | 'STOP' | 'CLOSE' | 'REOPEN' | 'ARCHIVE' | 'RESTORE' | 'DELETE') => {
    if (action === 'DELETE') {
      if (!isLV1) return alert('데이터 영구 삭제는 최고 관리자(LV_1) 권한이 필요합니다.');
      if (!confirm('🚨 경고: 이 실사 이력을 영구적으로 삭제하시겠습니까? 데이터 복구가 불가능합니다.')) return;
      try {
        const res = await fetch(`/api/asset/it/audit?id=${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          return alert(`❌ 삭제에 실패했습니다.${err?.error ? `\n${err.error}` : ''}`);
        }
        await fetchAuditData();
      } catch {
        alert('❌ 삭제 중 오류가 발생했습니다.');
      }
      return;
    }

    if (!canEdit) return alert('편집 권한이 없습니다.');

    const row = audits.find((a) => a.id === id);

    if (action === 'PUBLISH' || action === 'REOPEN') {
      const overlaps = findOverlappingRunning(row?.target || '', id);
      if (overlaps.length > 0) {
        const names = overlaps.map((a) => `· ${a.title} (${formatTargetLabel(a.target)})`).join('\n');
        return alert(`대상범위가 겹치는 진행 중 실사가 있어 ${action === 'PUBLISH' ? '배포' : '마감취소'}할 수 없습니다.\n\n${names}`);
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
            '종료 시각이 이미 지났습니다.\n배포하면 오늘 23:59까지로 자동 연장됩니다.\n그래도 배포할까요?'
          )
        ) {
          return;
        }
      } else if (!confirm('이 실사를 배포(진행중)할까요?')) {
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
    if (action === 'RESTORE') {
      const targetAudit = historyAuditsRaw.find((h) => h.id === id);
      const overlaps = findOverlappingRunning(targetAudit?.target || '', id);
      if (overlaps.length > 0) {
        const names = overlaps.map((a) => `· ${a.title} (${a.target})`).join('\n');
        return alert(`대상범위가 겹치는 진행 중 실사가 있어 복구할 수 없습니다.\n\n${names}`);
      }
      if (!confirm("선택한 이력을 현황판(운영 리스트)으로 복구하시겠습니까?")) return;
      patchData = { id, status: '마감' }; 
    }
  
    try {
      const res = await fetch('/api/asset/it/audit', {
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
            ? '✅ 배포되었습니다.\n종료 시각이 지나 오늘 23:59까지로 연장되었습니다. 필요하면 기간을 수정하세요.'
            : '✅ 배포되었습니다.'
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

  const formatPeriodLabel = (audit: { startDate?: string; endDate?: string; endTime?: string | null }) => {
    const time = normalizeEndTime24(audit.endTime);
    return (
      <td className="px-2 text-center text-slate-500 font-mono tracking-tight text-[11px] whitespace-nowrap">
        <div>{audit.startDate} ~ {audit.endDate}</div>
        <div className="text-[9px] font-bold text-slate-400 mt-0.5">마감 {time}</div>
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
        menuPath="/asset/it/master/audit"
        canEdit={canEdit}
      />
  
      {/* 진행 중 현황판 */}
      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">운영 중인 실사 현황 (Active)</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{activeAudits.length}건</span>
          </div>
          <button
            type="button"
            disabled={!canEdit}
            title={!canEdit ? '편집 권한 필요' : undefined}
            onClick={() => {
              if (!canEdit) return;
              setEditModal({ id: `NEW_${Date.now()}`, title: '', description: '', target: defaultTargetUnit, startDate: todayStr, endDate: todayStr, endTime: '23:59', status: '작성중' });
            }}
            className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap transition-all ${
              canEdit
                ? 'bg-teal-600 hover:bg-teal-500 text-white shadow-md active:scale-95'
                : disabledActionClass
            }`}
          >
            + 신규 실사 계획 수립
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1230px]">
            {tableColgroup}
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-4 text-center">NO</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">게시일</th>
                <th className="h-12 px-3 text-left whitespace-nowrap">실사명</th>
                <th className="h-12 px-3 text-left whitespace-nowrap">내용 요약</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">실사 운영 기간</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">대상범위</th>
                <th className="h-12 px-2 text-center border-l border-slate-200 whitespace-nowrap">모바일/웹 배포 링크 (사내망)</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">상태</th>
                <th className="h-12 pr-4 text-center border-l border-slate-200 whitespace-nowrap">관리 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {activeAudits.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">운영 중인 실사가 없습니다.</td></tr>
              ) : activeAudits.map((a, idx) => {
                const publicLink = publicAuditLink(a.id);
                return (
                  <tr key={a.id} className="h-14 hover:bg-slate-50/50 transition-colors">
                    <td className="pl-4 text-center text-slate-400">{activeAudits.length - idx}</td>
                    <td className="px-2 text-center font-mono text-slate-500 whitespace-nowrap">{a.postDate || '-'}</td>
                    <td className="px-3">
                      <div className="font-black text-slate-900 truncate" title={a.title}>{a.title || '-'}</div>
                    </td>
                    <td className="px-3">
                      <div className="text-[11px] font-semibold text-slate-500 truncate" title={a.description}>{a.description || '-'}</div>
                    </td>
                    {formatPeriodLabel(a)}
                    <td className="px-2 text-center text-slate-600" title={a.target || ''}>
                      <div className="whitespace-normal break-keep leading-snug">{formatTargetLabel(a.target)}</div>
                    </td>
                    <td className="px-2 border-l border-slate-100">
                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1.5">
                        <input type="text" readOnly value={publicLink} className="w-full min-w-0 text-[9px] font-mono text-slate-500 outline-none bg-transparent" />
                        <button
                          type="button"
                          onClick={() => {
                            void copyDeployLink(publicLink);
                          }}
                          className="px-2 py-1 bg-white border border-slate-200 text-slate-700 rounded text-[9px] font-black shrink-0 hover:bg-slate-100 whitespace-nowrap"
                        >
                          복사
                        </button>
                      </div>
                    </td>
                    <td className="px-2 text-center whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-md text-[10px] ${statusBadgeClass(a.status)}`}>{a.status}</span>
                    </td>
                    <td className="pr-4 text-center border-l border-slate-100">
                      <div className="flex justify-center gap-1.5 whitespace-nowrap">
                        {a.status === '작성중' || a.status === '게시중단' ? (
                          <>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'PUBLISH')} className={`px-3 py-1.5 rounded-lg text-[10px] ${canEdit ? 'bg-indigo-600 text-white hover:bg-indigo-700' : disabledActionClass}`}>배포</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => { if (!canEdit) return; setEditModal(a); }} className={`px-3 py-1.5 rounded-lg text-[10px] border ${canEdit ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : disabledActionClass}`}>수정</button>
                          </>
                        ) : a.status === '진행중' ? (
                          <>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => { if (!canEdit) return; setEditModal(a); }} className={`px-3 py-1.5 rounded-lg text-[10px] border ${canEdit ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : disabledActionClass}`}>수정</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'STOP')} className={`px-3 py-1.5 rounded-lg text-[10px] border ${canEdit ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : disabledActionClass}`}>중단</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'CLOSE')} className={`px-3 py-1.5 rounded-lg text-[10px] ${canEdit ? 'bg-emerald-600 text-white hover:bg-emerald-700' : disabledActionClass}`}>마감</button>
                          </>
                        ) : a.status === '마감' ? (
                          <>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'REOPEN')} className={`px-3 py-1.5 rounded-lg text-[10px] border ${canEdit ? 'bg-white border-amber-200 text-amber-700 hover:bg-amber-50' : disabledActionClass}`}>마감취소</button>
                            <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'ARCHIVE')} className={`px-3 py-1.5 rounded-lg text-[10px] ${canEdit ? 'bg-slate-800 text-white hover:bg-slate-700' : disabledActionClass}`}>보관함 이동</button>
                          </>
                        ) : (
                          <button type="button" disabled={!canEdit} title={!canEdit ? '편집 권한 필요' : undefined} onClick={() => handleStatusChange(a.id, 'ARCHIVE')} className={`px-4 py-1.5 rounded-lg text-[10px] ${canEdit ? 'bg-slate-800 text-white hover:bg-slate-700' : disabledActionClass}`}>보관함 이동</button>
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

      {/* 배포 링크 안내 — 한 줄 요약 */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-[11px] font-bold text-amber-800 leading-snug">
        <span className="font-black">📡 배포 링크 안내</span>
        <span className="mx-1.5 text-amber-300">·</span>
        참여 시 <span className="underline decoration-2">이메일 + Hub 비밀번호 또는 사번</span> 인증
        <span className="mx-1.5 text-amber-300">·</span>
        <span className="font-black">사내 LAN/Wi-Fi만</span> 접속 (외부망·LTE 불가, Wi-Fi 시 모바일 가능)
      </div>
  
      {/* 이력 보관함 */}
      <div className="mt-6 bg-white border border-slate-300 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-700 border-b border-slate-600 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300 shrink-0" />
            <h2 className="text-sm font-black text-white tracking-tight">실사 종료 이력 (Archive)</h2>
            <span className="text-[11px] font-bold bg-slate-600 text-slate-200 px-2 py-0.5 rounded-md">{filteredHistory.length}건</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative group/filter flex items-center gap-2 bg-white/95 px-3 py-1.5 rounded-lg border border-slate-400 shadow-sm">
              <span
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 hidden group-hover/filter:block whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg"
              >
                연도 → 월 · 연계필터
              </span>
              <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth('ALL');
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
              <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{month}월</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-black hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
            >
              📥 엑셀
            </button>
            <button
              type="button"
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className="text-[11px] font-black bg-white text-slate-900 border border-slate-200 rounded-lg px-4 py-1.5 hover:bg-slate-100 transition-colors shadow-sm shrink-0"
            >
              {isHistoryOpen ? '보관함 접기 ▲' : '보관함 펼치기 ▼'}
            </button>
          </div>
        </div>

        {isHistoryOpen && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[1230px]">
                {tableColgroup}
                <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                  <tr>
                    <th className="h-12 pl-4 text-center">NO</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">게시일</th>
                    <th className="h-12 px-3 text-left whitespace-nowrap">실사명</th>
                    <th className="h-12 px-3 text-left whitespace-nowrap">내용 요약</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">실사 운영 기간</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">대상범위</th>
                    <th className="h-12 px-2 text-center border-l border-slate-200 whitespace-nowrap">모바일/웹 배포 링크 (사내망)</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">상태</th>
                    <th className="h-12 pr-4 text-center border-l border-slate-200 whitespace-nowrap">관리 액션</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                  {paginatedHistory.length === 0 ? (
                    <tr><td colSpan={9} className="py-12 text-center text-slate-400">데이터가 없습니다.</td></tr>
                  ) : paginatedHistory.map((h, idx) => {
                    const publicLink = publicAuditLink(h.id);
                    const no = filteredHistory.length - ((historyPage - 1) * itemsPerPage + idx);
                    const restoreBlocked = findOverlappingRunning(h.target, h.id).length > 0;
                    return (
                      <tr key={h.id} className="h-14 hover:bg-slate-50/50 transition-colors">
                        <td className="pl-4 text-center text-slate-400">{no}</td>
                        <td className="px-2 text-center font-mono text-slate-500 whitespace-nowrap">{h.postDate || '-'}</td>
                        <td className="px-3">
                          <div className="font-black text-slate-900 truncate" title={h.title}>{h.title || '-'}</div>
                        </td>
                        <td className="px-3">
                          <div className="text-[11px] font-semibold text-slate-500 truncate" title={h.description}>{h.description || '-'}</div>
                        </td>
                        {formatPeriodLabel(h)}
                        <td className="px-2 text-center text-slate-600" title={h.target || ''}>
                          <div className="whitespace-normal break-keep leading-snug">{formatTargetLabel(h.target)}</div>
                        </td>
                        <td className="px-2 border-l border-slate-100">
                          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1.5">
                            <input type="text" readOnly value={publicLink} className="w-full min-w-0 text-[9px] font-mono text-slate-500 outline-none bg-transparent" />
                            <button
                          type="button"
                          onClick={() => {
                            void copyDeployLink(publicLink);
                          }}
                          className="px-2 py-1 bg-white border border-slate-200 text-slate-700 rounded text-[9px] font-black shrink-0 hover:bg-slate-100 whitespace-nowrap"
                        >
                          복사
                        </button>
                          </div>
                        </td>
                        <td className="px-2 text-center whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-md text-[10px] ${statusBadgeClass(h.status)}`}>{h.status}</span>
                        </td>
                        <td className="pr-4 text-center border-l border-slate-100">
                          <div className="flex justify-center gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => handleStatusChange(h.id, 'RESTORE')}
                              title={
                                !canEdit
                                  ? '편집 권한 필요 (admin/interface)'
                                  : restoreBlocked
                                    ? '진행 중 실사와 대상범위가 겹칩니다. 클릭 시 안내가 표시됩니다.'
                                    : '현황판으로 복구'
                              }
                              className={`px-3 py-1.5 rounded-lg text-[10px] transition-colors border ${
                                !canEdit
                                  ? disabledActionClass
                                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-800 hover:text-white'
                              }`}
                            >
                              복구
                            </button>
                            {isLV1 ? (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(h.id, 'DELETE')}
                                title="최고 관리자(LV_1) 전용 · 영구 삭제"
                                className="px-3 py-1.5 rounded-lg text-[10px] border transition-colors bg-white border-red-200 text-red-500 hover:bg-red-50"
                              >
                                삭제(LV_1)
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                title="최고 관리자(LV_1)만 삭제할 수 있습니다."
                                className={`px-3 py-1.5 rounded-lg text-[10px] border ${disabledActionClass}`}
                              >
                                삭제(LV_1)
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredHistory.length > 0 && (
              <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
                <button type="button" disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
                {Array.from({ length: totalHistoryPages }).map((_, i) => (
                  <button type="button" key={i} onClick={() => setHistoryPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${historyPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
                ))}
                <button type="button" disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
              </div>
            )}
          </>
        )}
      </div>
  
      {editModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] rounded-[2.5rem] overflow-hidden shadow-2xl">
            <div className="p-6 bg-slate-900 text-white flex justify-between items-center"><h3 className="font-black text-sm">실사 계획 수립</h3><button type="button" onClick={() => setEditModal(null)} className="text-slate-400 hover:text-white">✕</button></div>
            <form onSubmit={saveAuditPlan} className="p-8 space-y-5 bg-slate-50">
              <div><label className="text-[11px] font-black text-slate-500 uppercase">실사 제목</label><input required type="text" value={editModal.title} onChange={e => setEditModal({...editModal, title: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-black outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
              <div><label className="text-[11px] font-black text-slate-500 uppercase">상세 설명</label><textarea required value={editModal.description} onChange={e => setEditModal({...editModal, description: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 mt-1 min-h-[80px] shadow-sm" /></div>
              <div>
                <label className="text-[11px] font-black text-slate-500 uppercase block mb-1">대상 부서</label>
                <select
                  required
                  value={editModal.target || ''}
                  onChange={e => setEditModal({ ...editModal, target: e.target.value })}
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 shadow-sm"
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
                <div><label className="text-[11px] font-black text-slate-500 uppercase">시작일</label><input required type="date" value={editModal.startDate} onChange={e => setEditModal({...editModal, startDate: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
                <div><label className="text-[11px] font-black text-slate-500 uppercase">종료일</label><input required type="date" value={editModal.endDate} onChange={e => setEditModal({...editModal, endDate: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 mt-1 shadow-sm" /></div>
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-500 uppercase">종료 시각 (자동 마감 · 24시간제)</label>
                {(() => {
                  const [hh, mm] = normalizeEndTime24(editModal.endTime).split(':');
                  return (
                    <div className="mt-1 flex items-center gap-2">
                      <select
                        required
                        value={hh}
                        onChange={(e) => setEditModal({ ...editModal, endTime: `${e.target.value}:${mm}` })}
                        className="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold font-mono outline-none focus:border-indigo-500 shadow-sm"
                        aria-label="종료 시 (0-23)"
                      >
                        {HOURS_24.map((h) => (
                          <option key={h} value={h}>{h}시</option>
                        ))}
                      </select>
                      <span className="text-sm font-black text-slate-400">:</span>
                      <select
                        required
                        value={mm}
                        onChange={(e) => setEditModal({ ...editModal, endTime: `${hh}:${e.target.value}` })}
                        className="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold font-mono outline-none focus:border-indigo-500 shadow-sm"
                        aria-label="종료 분 (0-59)"
                      >
                        {MINUTES_60.map((m) => (
                          <option key={m} value={m}>{m}분</option>
                        ))}
                      </select>
                    </div>
                  );
                })()}
                <p className="mt-1.5 text-[10px] font-bold text-slate-400 leading-relaxed">
                  예: 18:30 · 종료일·시각(KST, 24시간)이 지나면 자동으로 &apos;마감&apos; 처리됩니다.
                </p>
              </div>
              <div className="pt-4 flex gap-2 border-t border-slate-200 mt-4">
                <button type="button" onClick={() => setEditModal(null)} className="flex-1 py-3.5 bg-white border border-slate-200 rounded-xl font-black text-slate-600 text-xs hover:bg-slate-50">취소</button>
                <button
                  type="submit"
                  disabled={!canEdit}
                  title={!canEdit ? '편집 권한 필요' : undefined}
                  className={`flex-[2] py-3.5 rounded-xl font-black text-xs shadow-md ${
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
