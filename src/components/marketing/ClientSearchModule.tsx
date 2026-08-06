'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTYearMonth, getKSTNowYearMonth, getDistBusinessDate } from '@/utils/dateUtils';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import LoadingState from '@/components/common/LoadingState';

// 🚀 [UI 표준] 공통 HeaderLight 컴포넌트
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);

function normalizeRoles(roles: unknown): string[] {
  if (!roles) return [];
  const arr = Array.isArray(roles) ? roles : [roles];
  return arr.map((r) => {
    const s = String(r).trim();
    const m = s.match(/(\d+)/);
    return m ? `LV_${m[1]}` : s;
  });
}

async function readApiError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}
  
export default function ClientSearchModule() {
  const [clients, setClients] = useState<any[]>([]);
  const [masterCategories, setMasterCategories] = useState<string[]>([]);
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchNameQuery, setSearchNameQuery] = useState('');
  const [searchLocationQuery, setSearchLocationQuery] = useState('');
  
  // 🚀 [추가] 탭 상태 관리 (운영중 / 보관함)
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');

  const [showHiddenDepts, setShowHiddenDepts] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
     
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const { year: kstYear } = getKSTNowYearMonth();
     
  const [historyModal, setHistoryModal] = useState<{
    isOpen: boolean;
    clientId: string;
    clientName: string;
    deptName: string;
    list: any[];
    loading: boolean;
  }>({
    isOpen: false, clientId: '', clientName: '', deptName: '', list: [], loading: false
  });
  /** 이력 모달: year / month(0=전체) / page */
  const [historyYear, setHistoryYear] = useState(kstYear);
  const [historyMonth, setHistoryMonth] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyItemFilter, setHistoryItemFilter] = useState('');
  const [historyItemMenuOpen, setHistoryItemMenuOpen] = useState(false);
  const historyPerPage = 10;
  
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', location: '', category: '' });
     
  const [deptModal, setDeptModal] = useState<{ isOpen: boolean; client: any; deptIndex: number | null; name: string }>({
    isOpen: false, client: null, deptIndex: null, name: ''
  });
     
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  /** 펼침 시 지연 로딩한 부서 집계 (clientId → deptStats) */
  const [deptStatsByClient, setDeptStatsByClient] = useState<Record<string, any>>({});
  const [deptStatsLoadingIds, setDeptStatsLoadingIds] = useState<Set<string>>(new Set());
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());

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
  const MENU_PATH = '/marketing/distribution/client-search';
     
  useEffect(() => { fetchClients(); }, []);
     
  const fetchClients = async () => {
    setLoadError(null);
    try {
      const ts = Date.now();
      const [cRes, mRes, sysRes, ifRes, meRes, summaryRes] = await Promise.all([
        fetch('/api/marketing/clients?t=' + ts),
        fetch('/api/admin/master-data?t=' + ts),
        fetch('/api/admin/config?t=' + ts),
        fetch('/api/admin/interface?t=' + ts),
        fetch('/api/auth/me?t=' + ts),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`),
      ]);

      const failed: string[] = [];
      if (cRes.ok) {
        setClients(await cRes.json());
        setDeptStatsByClient({});
      } else {
        setClients([]);
        failed.push('고객사');
      }
      if (meRes.ok) setCurrentUser(await meRes.json());
      else failed.push('사용자');

      let configData = null;
      if (sysRes.ok) {
        configData = await sysRes.json();
        setSystemConfig(configData);
      }

      if (ifRes.ok) {
        const interfaces = await ifRes.json();
        const config = interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('client-search'));
        setInterfaceConfig(config);
      }

      if (summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);
      
      if (mRes.ok && configData?.client_category_group) {
        const masterData = await mRes.json();
        const categoryGroup = masterData.find((g: any) => g.id === configData.client_category_group);
        if (categoryGroup && categoryGroup.codes) {
          const activeCodes = categoryGroup.codes
            .filter((c: any) => c.is_active && !c.is_archived)
            .sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((c: any) => c.label);
          setMasterCategories(activeCodes);
        }
      }

      if (failed.length > 0) {
        const status = [cRes, meRes].find((r) => !r.ok)?.status;
        setLoadError(
          status === 401
            ? '로그인 세션이 만료되었거나 권한이 없습니다.'
            : status === 403
              ? '고객사 메뉴 접근 권한이 없습니다.'
              : `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')})`
        );
      }
    } catch (e) {
      console.error('Data Fetch Error:', e);
      setClients([]);
      setLoadError('네트워크 오류로 데이터를 불러오지 못했습니다.');
    }
    setLoading(false);
  };
     
  const getNormalizedSortedDepts = (departments: any) => {
    if (!Array.isArray(departments)) return [];
    const depts = departments.map(d => typeof d === 'string' ? { name: d, is_hidden: false } : d);
    return depts.sort((a, b) => {
      if (a.name === "전사") return -1;
      if (b.name === "전사") return 1;
      return a.name.localeCompare(b.name, 'ko');
    });
  };
     
  const uniqueCategories = useMemo(() => {
    const categories = clients.map(c => c.category).filter(Boolean);
    return Array.from(new Set(categories)).sort();
  }, [clients]);
     
  // 🚀 필터링 시 Active 탭과 Archived 탭 구분 — 최신 등록이 위, No는 등록순(최신=큰 번호)
  const filteredClients = useMemo(() => {
    const baseList = clients.filter(c => activeTab === 'ACTIVE' ? !c.is_archived : c.is_archived);
    const nameQ = searchNameQuery.trim().toLowerCase();
    const locQ = searchLocationQuery.trim().toLowerCase();
    return baseList
      .filter((c) => {
        const matchCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
        const matchName = !nameQ || (c.name || '').toLowerCase().includes(nameQ);
        const matchLocation = !locQ || (c.location || '').toLowerCase().includes(locQ);
        return matchCategory && matchName && matchLocation;
      })
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [clients, searchNameQuery, searchLocationQuery, selectedCategory, activeTab]);
     
  // 🚀 탭이나 필터가 변경되면 1페이지로 리셋
  useEffect(() => { setCurrentPage(1); setSelectedClientIds(new Set()); }, [searchNameQuery, searchLocationQuery, selectedCategory, activeTab]);
     
  const totalPages = Math.max(1, Math.ceil(filteredClients.length / itemsPerPage));
  const paginatedClients = filteredClients.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
     
  const fetchDeptStats = async (clientId: string) => {
    setDeptStatsLoadingIds((prev) => {
      const next = new Set(prev);
      next.add(clientId);
      return next;
    });
    try {
      const res = await fetch(
        `/api/marketing/clients?deptStatsClientId=${encodeURIComponent(clientId)}&t=${Date.now()}`
      );
      if (!res.ok) {
        alert(await readApiError(res, '부서별 집계를 불러오지 못했습니다.'));
        return;
      }
      const body = await res.json();
      setDeptStatsByClient((prev) => ({
        ...prev,
        [clientId]: body?.deptStats && typeof body.deptStats === 'object' ? body.deptStats : {},
      }));
    } catch (e) {
      console.error(e);
      alert('부서별 집계를 불러오지 못했습니다.');
    } finally {
      setDeptStatsLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(clientId);
        return next;
      });
    }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedClients);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      // 아직 안 불러왔으면 펼칠 때 로드
      if (deptStatsByClient[id] === undefined && !deptStatsLoadingIds.has(id)) {
        void fetchDeptStats(id);
      }
    }
    setExpandedClients(next);
  };

  // 목록 새로고침(캐시 클리어) 후, 펼쳐 둔 행만 부서 집계 재요청
  useEffect(() => {
    for (const id of expandedClients) {
      if (deptStatsByClient[id] === undefined && !deptStatsLoadingIds.has(id)) {
        void fetchDeptStats(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clients 갱신 시에만
  }, [clients]);
     
  const openHistory = async (clientId: string, clientName: string, deptName?: string | null) => {
    const scopeLabel = String(deptName || '').trim() || '전체';
    setHistoryYear(kstYear);
    setHistoryMonth(0);
    setHistoryPage(1);
    setHistoryItemFilter('');
    setHistoryItemMenuOpen(false);
    setHistoryModal({ isOpen: true, clientId, clientName, deptName: scopeLabel, list: [], loading: true });
    try {
      const qs = new URLSearchParams({
        clientId,
        t: String(Date.now()),
      });
      if (scopeLabel !== '전체') qs.set('clientDept', scopeLabel);
      const res = await fetch(`/api/marketing/distributions?${qs}`);
      if (!res.ok) {
        setHistoryModal((prev) => ({ ...prev, list: [], loading: false }));
        alert(await readApiError(res, '이력을 불러오지 못했습니다.'));
        return;
      }
      const list = await res.json();
      const sorted = Array.isArray(list)
        ? [...list]
            .filter((d) => d?.status !== 'REJECTED')
            .sort((a, b) => {
              const ta = new Date(getDistBusinessDate(a) as string).getTime();
              const tb = new Date(getDistBusinessDate(b) as string).getTime();
              return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
            })
        : [];
      // 올해 이력이 없으면 이력이 있는 최신 연도로 열어준다
      const years = sorted
        .map((d) => getKSTYearMonth(getDistBusinessDate(d) as string)?.year)
        .filter((y): y is number => !!y);
      if (years.length > 0 && !years.includes(kstYear)) {
        setHistoryYear(Math.max(...years));
      }
      setHistoryModal({ isOpen: true, clientId, clientName, deptName: scopeLabel, list: sorted, loading: false });
    } catch (e) {
      console.error(e);
      setHistoryModal((prev) => ({ ...prev, list: [], loading: false }));
      alert('이력을 불러오지 못했습니다.');
    }
  };

  const historyYearOptions = useMemo(() => {
    const years = new Set<number>([kstYear]);
    for (const d of historyModal.list) {
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      if (ym?.year) years.add(ym.year);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [historyModal.list, kstYear]);

  /** 연·월만 적용한 목록 (물품 필터 옵션 산출용) */
  const historyByPeriod = useMemo(() => {
    return historyModal.list.filter((d) => {
      if (d?.status === 'REJECTED') return false;
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      if (!ym || ym.year !== historyYear) return false;
      if (historyMonth !== 0 && ym.month !== historyMonth) return false;
      return true;
    });
  }, [historyModal.list, historyYear, historyMonth]);

  const historyItemOptions = useMemo(() => {
    const names = new Set<string>();
    for (const d of historyByPeriod) {
      names.add(d.item?.name || '(삭제됨)');
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [historyByPeriod]);

  const filteredHistoryList = useMemo(() => {
    if (!historyItemFilter) return historyByPeriod;
    return historyByPeriod.filter((d) => (d.item?.name || '(삭제됨)') === historyItemFilter);
  }, [historyByPeriod, historyItemFilter]);

  const historyAgg = useMemo(() => {
    let totalQty = 0;
    let pendingCount = 0;
    for (const d of filteredHistoryList) {
      // 지급대기는 확정 수량에서 제외 (목록 합계와 동일 기준)
      if (d?.status === 'PENDING') {
        pendingCount += 1;
        continue;
      }
      totalQty += Number(d.qty) || 0;
    }
    return { count: filteredHistoryList.length, totalQty, pendingCount };
  }, [filteredHistoryList]);

  const historyTotalPages = Math.max(1, Math.ceil(filteredHistoryList.length / historyPerPage));
  const paginatedHistory = filteredHistoryList.slice(
    (historyPage - 1) * historyPerPage,
    historyPage * historyPerPage
  );

  useEffect(() => {
    if (historyPage > historyTotalPages) setHistoryPage(1);
  }, [historyPage, historyTotalPages]);

  const closeHistoryModal = () => {
    setHistoryItemFilter('');
    setHistoryItemMenuOpen(false);
    setHistoryModal({
      isOpen: false, clientId: '', clientName: '', deptName: '', list: [], loading: false
    });
  };

  const safeArray = (val: any) => {
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val) || []; } catch(e) { return []; }
  };

  const myRoles = useMemo(() => normalizeRoles(currentUser?.roles), [currentUser]);
  const isLv1 = myRoles.includes('LV_1');

  /**
   * 편집자: 엑셀 다운로드 · 부서관리 · 마스터 관리(수정/보관/복구 등)
   * 신규 등록(+ 버튼)은 메뉴 접근자 전원 — API POST와 동일
   */
  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  useEffect(() => {
    if (!canEditMaster) {
      setShowHiddenDepts(false);
      setActiveTab('ACTIVE');
      setSelectedClientIds(new Set());
    }
  }, [canEditMaster]);

  /** 영구삭제: LV_1만 — 지급 이력 0건일 때만 (서버와 동일) */
  const canHardDeleteClient = () => !!currentUser && isLv1;

  /** distCount는 대기·반려 포함 전체 이력 — DELETE 차단 기준과 동일 */
  const clientHasDistributions = (client: any) =>
    Number(client?.distCount ?? 0) > 0;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const visibleIds = paginatedClients.map(c => c.id);
      setSelectedClientIds(new Set([...selectedClientIds, ...visibleIds]));
    } else {
      const next = new Set(selectedClientIds);
      paginatedClients.forEach(c => next.delete(c.id));
      setSelectedClientIds(next);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedClientIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedClientIds(next);
  };

  const handleExcelDownload = () => {
    if (!canEditMaster) {
      return alert('엑셀 다운로드는 편집 권한이 필요합니다.');
    }
    const targetList =
      selectedClientIds.size > 0
        ? clients.filter((c) => selectedClientIds.has(c.id))
        : filteredClients;

    if (targetList.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const dataToExport = targetList.map((c) => {
      return {
        '고객사명': c.name,
        '업무범주': c.category || '-',
        '소재지': c.location || '-',
        '상태': c.is_archived ? '보관됨' : '운영중',
        '등록된 하위부서 수': getNormalizedSortedDepts(c.departments).filter((d: any) => !d.is_hidden).length,
        '이번달 지급 수량': Number(c.monthQty ?? 0),
        '올해 누적 지급 수량': Number(c.yearQty ?? 0),
        '올해 지급 건수': Number(c.yearDistCount ?? 0),
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "고객사_수령현황");
    XLSX.writeFile(wb, `고객사_수령현황_${getKSTDateString()}.xlsx`);
  };

  const handleSaveDept = async () => {
    if (!canEditMaster) return alert("부서 편집 권한이 없습니다."); 
    const { client, deptIndex } = deptModal;
    const name = deptModal.name.trim().replace(/\s+/g, ' ');
    if (!name) return alert("부서명을 입력하세요.");

    const depts = getNormalizedSortedDepts(client.departments);
    // 추가·수정 공통: 자기 자신 제외하고 같은 이름(대소문자·공백 무시) 금지
    const isDuplicate = depts.some(
      (d, i) => i !== deptIndex && String(d.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (isDuplicate) return alert(`이미 존재하는 부서명입니다. ("${name}")`);

    let oldName = '';
    if (deptIndex !== null) {
      oldName = depts[deptIndex].name;
      if (oldName === name) {
        setDeptModal({ ...deptModal, isOpen: false });
        return;
      }
      depts[deptIndex].name = name;
    } else {
      depts.push({ name, is_hidden: false });
    }
    const res = await fetch('/api/marketing/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: client.id, departments: depts, oldDeptName: oldName || undefined, newDeptName: oldName ? name : undefined })
    });
    if (res.ok) { setDeptModal({ ...deptModal, isOpen: false }); fetchClients(); }
    else alert(await readApiError(res, '부서 저장에 실패했습니다.'));
  };
     
  const handleDeleteDept = async (client: any, deptName: string) => {
    if (!canEditMaster) return alert("부서 삭제 권한이 없습니다."); 
    if (deptName === "전사") return alert("기본 부서 '전사'는 삭제할 수 없습니다.");
    if (!confirm(`'${deptName}' 부서를 완전히 삭제하시겠습니까?\n(지급 이력이 있는 경우 삭제가 거부됩니다.)`)) return;
    const res = await fetch('/api/marketing/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: client.id, action: 'delete_dept', targetDeptName: deptName })
    });
    if (res.ok) { alert('부서가 삭제되었습니다.'); fetchClients(); }
    else alert(await readApiError(res, '삭제 실패'));
  };
     
  const handleToggleDeptHide = async (client: any, index: number) => {
    if (!canEditMaster) return alert("부서 상태 제어 권한이 없습니다."); 
    const depts = getNormalizedSortedDepts(client.departments);
    if (depts[index]?.name === "전사" && !depts[index].is_hidden) {
      return alert("기본 부서 '전사'는 숨길 수 없습니다.\n(지급 신청에서 선택 대상이 사라집니다.)");
    }
    depts[index].is_hidden = !depts[index].is_hidden;
    const res = await fetch('/api/marketing/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: client.id, departments: depts })
    });
    if (res.ok) fetchClients();
    else alert(await readApiError(res, '부서 상태 변경에 실패했습니다.'));
  };
     
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editClient && !canEditMaster) return alert("고객사 마스터 수정 권한이 없습니다.");
    const clientName = formData.name.trim().replace(/\s+/g, ' ');
    if (!clientName) return alert("고객사명은 필수입니다.");
    if (masterCategories.length > 0 && !formData.category) return alert("업무 범주를 선택해주세요.");

    // FE 선검사 (서버도 동일 검증)
    const nameTaken = clients.some((c) => {
      if (editClient && c.id === editClient.id) return false;
      return String(c.name || '').trim().toLowerCase() === clientName.toLowerCase();
    });
    if (nameTaken) {
      return alert(`이미 등록된 고객사명입니다. ("${clientName}")`);
    }
      
    const url = '/api/marketing/clients';
    const method = editClient ? 'PATCH' : 'POST';
    const payload = editClient
      ? { id: editClient.id, ...formData, name: clientName }
      : { ...formData, name: clientName };
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert(editClient ? '수정되었습니다.' : '등록되었습니다.');
      setShowModal(false);
      setEditClient(null);
      setFormData({ name: '', location: '', category: '' });
      fetchClients();
    } else {
      alert(await readApiError(res, editClient ? '수정에 실패했습니다.' : '등록에 실패했습니다.'));
    }
  };
     
// 보관(Archive) / 복구(Restore) / 영구삭제(Hard Delete)
  const handleArchiveClient = async (id: string) => {
    if (!canEditMaster) return alert('고객사 보관 권한이 없습니다.');
    if (!confirm('이 고객사를 보관함으로 이동하시겠습니까?')) return;

    const res = await fetch('/api/marketing/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_archived: true }),
    });

    if (res.ok) {
      await fetchClients();
      setActiveTab('ARCHIVED');
      alert('보관함으로 이동되었습니다.');
    } else {
      alert(await readApiError(res, '보관 처리에 실패했습니다.'));
    }
  };

  const handleRestoreClient = async (id: string) => {
    if (!canEditMaster) return alert('고객사 복구 권한이 없습니다.');
    if (!confirm('이 고객사를 운영중인 마스터 목록으로 복구하시겠습니까?')) return;
    const res = await fetch('/api/marketing/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_archived: false }),
    });
    if (res.ok) {
      await fetchClients();
      setActiveTab('ACTIVE');
      alert('목록으로 복구되었습니다.');
    } else {
      alert(await readApiError(res, '복구에 실패했습니다.'));
    }
  };

  const handleHardDeleteClient = async (id: string) => {
    const client = clients.find((c) => c.id === id);
    if (!canHardDeleteClient()) {
      return alert('영구 삭제는 최고 관리자(LV_1)만 가능합니다.');
    }
    if (clientHasDistributions(client)) {
      return alert('지급 이력이 있어 영구 삭제할 수 없습니다. 보관 처리만 가능합니다.');
    }
    if (!confirm('정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 마스터에서 완전히 영구 삭제됩니다.')) return;
    const res = await fetch(`/api/marketing/clients?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchClients();
      alert('완전히 삭제되었습니다.');
    } else {
      alert(await readApiError(res, '삭제 실패'));
    }
  };

  if (loading) return <LoadingState />;
  
  const isAllPageSelected = paginatedClients.length > 0 && paginatedClients.every(c => selectedClientIds.has(c.id));
  /** 선택 체크박스는 엑셀 다운로드(편집 권한) 전용 */
  const showSelection = canEditMaster;
  const tableColCount = (showSelection ? 1 : 0) + (activeTab === 'ARCHIVED' ? 11 : 9);

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">

      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-bold flex justify-between items-center gap-4">
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchClients(); }}
            className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-black hover:bg-amber-700"
          >
            다시 시도
          </button>
        </div>
      )}
      
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 */}
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
            CLIENT DISTRIBUTION STATUS
          </h3>
          <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
            고객사 통합 관리
          </h1>
          <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
            고객사를 (각 부서 관리 가능) 신규 등록할 수 있습니다. 등록된 고객사와 각 부서별 물품 지급 내역을 확인합니다.
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
                  편집 권한 없음 — 신규 등록은 가능 · 엑셀·부서·마스터 관리는 불가
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 탭 네비게이션 — equipment inventory / survey admin 스위처 규격 · 보관함은 Edit 권한만 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('ACTIVE')}
            className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
              activeTab === 'ACTIVE'
                ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>🏢 운영중인 고객사</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              activeTab === 'ACTIVE' ? 'bg-indigo-50 text-indigo-600 font-bold' : 'bg-slate-200 text-slate-600'
            }`}>
              {clients.filter((c) => !c.is_archived).length}
            </span>
          </button>
          {canEditMaster && (
            <button
              type="button"
              onClick={() => setActiveTab('ARCHIVED')}
              className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                activeTab === 'ARCHIVED'
                  ? 'bg-white text-slate-800 shadow-sm border border-slate-200/80'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>🛑 보관함</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'ARCHIVED' ? 'bg-slate-200 text-slate-700 font-bold' : 'bg-slate-200 text-slate-600'
              }`}>
                {clients.filter((c) => c.is_archived).length}
              </span>
            </button>
          )}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
          ※ 탭을 클릭하여 운영 중 고객사와 보관함을 전환합니다.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <HeaderLight title={activeTab === 'ACTIVE' ? "고객사 데이터 대장" : "보관된 고객사 목록"} count={filteredClients.length}>
          <div className="flex items-center gap-2 flex-wrap">
            {canEditMaster && (
              <label className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" checked={showHiddenDepts} onChange={(e) => setShowHiddenDepts(e.target.checked)} className="sr-only peer" />
                <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:bg-indigo-500 relative transition-colors shadow-inner">
                  <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${showHiddenDepts ? 'translate-x-4' : ''} shadow-sm`}></div>
                </div>
                <span className="text-[10px] font-black text-slate-400 group-hover:text-indigo-600 transition-colors whitespace-nowrap">숨김 부서 보기</span>
              </label>
            )}

            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase">업무범주</span>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
              >
                <option value="ALL">전체</option>
                {uniqueCategories.map((cat) => (
                  <option key={cat as string} value={cat as string}>{cat as string}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-40">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🏢</span>
                <input
                  type="text"
                  placeholder="회사명 검색..."
                  value={searchNameQuery}
                  onChange={(e) => setSearchNameQuery(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
              <div className="relative w-36">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">📍</span>
                <input
                  type="text"
                  placeholder="소재지 검색..."
                  value={searchLocationQuery}
                  onChange={(e) => setSearchLocationQuery(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
            </div>

            {canEditMaster && (
              <button
                type="button"
                onClick={handleExcelDownload}
                title={
                  selectedClientIds.size > 0
                    ? `선택한 ${selectedClientIds.size}건 엑셀 다운로드`
                    : '현재 화면 목록 엑셀 다운로드'
                }
                className="px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm whitespace-nowrap transition-all bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {selectedClientIds.size > 0
                  ? `선택 EXCEL 다운로드(${selectedClientIds.size})`
                  : '화면 목록 EXCEL 다운로드'}
              </button>
            )}

            {activeTab === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => { setEditClient(null); setFormData({ name: '', location: '', category: '' }); setShowModal(true); }}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-indigo-600 transition-all whitespace-nowrap"
              >
                + 신규 등록
              </button>
            )}
          </div>
        </HeaderLight>

        <div className="overflow-x-auto">
          <table className={`w-full text-left border-collapse ${activeTab === 'ARCHIVED' ? 'min-w-[1520px]' : 'min-w-[1340px]'}`}>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                {showSelection && (
                  <th className="h-12 text-center w-[40px] pl-4">
                    <input type="checkbox" checked={isAllPageSelected} onChange={handleSelectAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                  </th>
                )}
                <th className="h-12 text-center w-[50px]">NO</th>
                <th className="h-12 pl-2 w-[280px]">회사명 (클릭 상세보기)</th>
                <th className="h-12 text-center w-[220px]">부서관리</th>
                <th className="h-12 px-3 text-center w-[120px]">업무범주</th>
                <th className="h-12 px-3 w-[260px] text-center">소재지 (주소)</th>
                <th className="h-12 px-3 w-[100px] text-right whitespace-nowrap">이번 달 지급 수량</th>
                <th className="h-12 px-3 w-[110px] text-right whitespace-nowrap">올해 누적 지급 수량</th>
                <th className="h-12 text-center w-[100px]">지급 이력</th>
                {activeTab === 'ARCHIVED' && (
                  <>
                    <th className="h-12 px-2 text-center w-[96px] whitespace-nowrap">보관함처리일</th>
                    <th className="h-12 px-2 text-center w-[120px] whitespace-nowrap">처리자(소속)</th>
                  </>
                )}
                <th className="h-12 pr-4 text-center w-[160px] whitespace-nowrap">마스터 관리</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedClients.length === 0 ? (
                <tr><td colSpan={tableColCount} className="p-16 text-center text-slate-400 text-sm">{activeTab === 'ACTIVE' ? '조건에 맞는 고객사가 없습니다.' : '보관된 고객사가 없습니다.'}</td></tr>
              ) : paginatedClients.map((client, idx) => {
                const isExpanded = expandedClients.has(client.id);
                const allDepts = getNormalizedSortedDepts(client.departments);
                const deptStats = deptStatsByClient[client.id] || {};
                const deptStatsReady = deptStatsByClient[client.id] !== undefined;
                const deptStatsLoading = deptStatsLoadingIds.has(client.id);

                /**
                 * 부서 개수 배지는 운영중(비숨김) 부서만. 수량은 과거 지급도 잡히므로
                 * 숨김·마스터 미등록 부서도 올해 이력이 있으면 행으로 노출 → 회사 합과 부서 합 일치
                 */
                const deptHasQty = (deptName: string) => {
                  const s = deptStats[deptName];
                  return Number(s?.yearQty ?? 0) > 0 || Number(s?.monthQty ?? 0) > 0;
                };
                const masterDeptNames = new Set(allDepts.map((d: any) => String(d.name)));
                const orphanDepts = deptStatsReady
                  ? Object.keys(deptStats)
                      .filter((n) => !masterDeptNames.has(n) && deptHasQty(n))
                      .sort((a, b) => a.localeCompare(b, 'ko'))
                      .map((name) => ({ name, is_hidden: false, is_orphan: true }))
                  : [];
                const visibleDepts = [
                  ...allDepts.filter(
                    d => !d.is_hidden || (deptStatsReady && deptHasQty(d.name)) || (canEditMaster && showHiddenDepts)
                  ),
                  ...orphanDepts,
                ];
                
                const archivedAt = client.archived_at ? getKSTDateString(client.archived_at) : '-';
                const archiverName = client.archived_by_name || '-';
                const archiverDept = client.archived_by_dept || '-';
                const monthQty = Number(client.monthQty ?? 0);
                const yearQty = Number(client.yearQty ?? 0);
     
                return (
                  <React.Fragment key={client.id}>
                    <tr
                      onClick={() => toggleExpand(client.id)}
                      className={`h-16 cursor-pointer transition-colors ${
                        isExpanded
                          ? 'bg-indigo-100/80 hover:bg-indigo-100 shadow-[inset_3px_0_0_0_theme(colors.indigo.500)]'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      {showSelection && (
                        <td className="text-center pl-4" onClick={(e)=>e.stopPropagation()}>
                          <input type="checkbox" checked={selectedClientIds.has(client.id)} onChange={(e) => handleSelectOne(client.id, e.target.checked)} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                        </td>
                      )}
                      <td className={`text-center font-black ${isExpanded ? 'text-indigo-500' : 'text-slate-400'}`}>{filteredClients.length - ((currentPage - 1) * itemsPerPage + idx)}</td>
                      <td className="pl-2 truncate pr-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] transition-transform ${isExpanded ? 'rotate-90 text-indigo-500' : 'text-slate-400'}`}>▶</span>
                          <span className={`font-black text-[13px] truncate ${isExpanded ? 'text-indigo-900' : 'text-slate-900'}`} title={client.name}>{client.name}</span>
                        </div>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-black border border-slate-200">
                            {allDepts.filter(d => !d.is_hidden).length}
                          </span>
                          {canEditMaster && activeTab === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDeptModal({ isOpen: true, client, deptIndex: null, name: '' }); }}
                              className="px-1.5 py-0.5 flex items-center justify-center bg-indigo-600 text-white rounded-md text-[9px] font-black hover:bg-slate-800 shadow-sm whitespace-nowrap"
                              title="부서 추가"
                            >
                              부서+
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 text-center text-indigo-600 font-black text-[11px] truncate" title={client.category}>{client.category || '-'}</td>
                      <td className="px-3 text-center text-slate-500 text-[11px] truncate" title={client.location}>{client.location || '-'}</td>
                      
                      <td className="px-3 border-l border-slate-100 text-right font-mono text-[13px] text-slate-800 whitespace-nowrap">
                        {monthQty.toLocaleString()}
                      </td>
                      <td className="px-3 border-l border-slate-100 text-right font-mono text-[13px] text-slate-800 whitespace-nowrap">
                        {yearQty.toLocaleString()}
                      </td>
                      
                      <td className="text-center border-l border-slate-100" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openHistory(client.id, client.name)}
                          className="px-2.5 py-1 rounded-lg text-[9px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                        >
                          지급 이력
                        </button>
                      </td>

                      {activeTab === 'ARCHIVED' && (
                        <>
                          <td className="px-2 text-center font-mono text-[10px] text-slate-700 border-l border-slate-100 whitespace-nowrap">
                            {archivedAt}
                          </td>
                          <td className="px-2 text-center text-slate-800 border-l border-slate-100">
                            <div className="flex flex-col items-center justify-center leading-tight min-w-[6.5rem]">
                              <span className="text-[11px] font-bold truncate max-w-[110px]" title={archiverName}>{archiverName}</span>
                              <span className="text-[9px] text-slate-600 truncate max-w-[110px]" title={archiverDept}>({archiverDept})</span>
                            </div>
                          </td>
                        </>
                      )}

                      <td className="pr-4 border-l border-slate-100 text-center whitespace-nowrap" onClick={(e)=>e.stopPropagation()}>
                        {activeTab === 'ACTIVE' ? (
                          <div className="flex justify-center items-center gap-1 flex-nowrap">
                            {canEditMaster && (
                              <>
                                <button onClick={() => { setEditClient(client); setFormData({name:client.name, location:client.location||'', category:client.category||''}); setShowModal(true); }} className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[9px] font-black hover:bg-slate-50 transition-colors shadow-sm whitespace-nowrap">수정</button>
                                <button onClick={() => handleArchiveClient(client.id)} className="px-3 py-1 bg-slate-50 border border-slate-200 text-slate-400 rounded-lg text-[9px] font-black hover:bg-slate-200 transition-colors shadow-sm whitespace-nowrap">보관함</button>
                              </>
                            )}
                            {canHardDeleteClient() && !clientHasDistributions(client) && (
                              <button
                                type="button"
                                onClick={() => handleHardDeleteClient(client.id)}
                                className="px-3 py-1 bg-red-50 border border-red-200 text-red-500 rounded-lg text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                                title="최고 관리자(LV_1) 전용"
                              >
                                영구삭제(LV_1)
                              </button>
                            )}
                            {canHardDeleteClient() && clientHasDistributions(client) && !canEditMaster && (
                              <span className="px-2 py-1 text-[9px] font-black text-slate-400 border border-slate-200 rounded-lg cursor-not-allowed whitespace-nowrap" title="지급 이력이 얽혀 있어 삭제 불가">
                                삭제불가
                              </span>
                            )}
                            {!canEditMaster && !canHardDeleteClient() && (
                              <span className="text-slate-300 text-[10px] whitespace-nowrap">권한제한</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex justify-center items-center gap-1 flex-nowrap">
                            {canEditMaster && (
                              <button onClick={() => handleRestoreClient(client.id)} className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[9px] font-black hover:bg-slate-50 transition-colors shadow-sm whitespace-nowrap">복구</button>
                            )}
                            {canHardDeleteClient() && (
                              clientHasDistributions(client) ? (
                                <span className="px-2 py-1 text-[9px] font-black text-slate-400 border border-slate-200 rounded-lg cursor-not-allowed whitespace-nowrap" title="지급 이력이 얽혀 있어 삭제 불가">삭제불가</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleHardDeleteClient(client.id)}
                                  className="px-3 py-1 bg-red-50 border border-red-200 text-red-500 rounded-lg text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                                  title="최고 관리자(LV_1) 전용"
                                >
                                  영구삭제(LV_1)
                                </button>
                              )
                            )}
                            {!canEditMaster && !canHardDeleteClient() && (
                              <span className="text-slate-300 text-[10px] whitespace-nowrap">권한제한</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
     
                    {isExpanded && (deptStatsLoading || !deptStatsReady) && (
                      <tr className="bg-indigo-50/40 border-t border-dashed border-indigo-200">
                        <td colSpan={tableColCount} className="py-6 text-center text-[11px] font-bold text-indigo-400 animate-pulse">
                          부서별 집계 불러오는 중...
                        </td>
                      </tr>
                    )}

                    {isExpanded && deptStatsReady && !deptStatsLoading && visibleDepts.map((dept: any) => {
                      const originalIndex = allDepts.findIndex(ad => ad.name === dept.name);
                      const stats = deptStats[dept.name] || {};
                      return (
                        <tr key={`${client.id}-${dept.name}`} className={`bg-indigo-50/40 border-t border-dashed border-indigo-200 h-12 ${dept.is_hidden ? 'opacity-50 grayscale' : ''}`}>
                          <td colSpan={showSelection ? 2 : 1} className="text-center border-r border-slate-100"></td>
                          <td className="pl-6 text-slate-600 text-[11px] font-bold border-r border-slate-100">
                            <div className="flex items-center gap-2">
                                <span className="text-slate-300">└</span> 
                                <span className={`${dept.is_hidden ? 'line-through text-slate-400' : ''} ${dept.is_orphan ? 'text-slate-400' : ''} truncate max-w-[160px]`} title={dept.name}>
                                  {dept.name}
                                </span>
                            </div>
                          </td>
                          <td className="px-1.5 text-center border-r border-slate-100">
                            {dept.is_orphan ? (
                              <span
                                className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded whitespace-nowrap"
                                title="지급 이력에만 있는 부서명입니다. 부서관리는 마스터에 등록된 부서만 가능합니다."
                              >
                                마스터 미등록
                              </span>
                            ) : canEditMaster && activeTab === 'ACTIVE' ? (
                              <div className="flex flex-wrap justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setDeptModal({ isOpen: true, client, deptIndex: originalIndex, name: dept.name })}
                                    className="px-1.5 py-1 bg-white border border-slate-200 rounded text-[9px] font-black text-slate-500 hover:bg-indigo-600 hover:text-white shadow-sm transition-colors whitespace-nowrap"
                                  >
                                    부서명수정
                                  </button>
                                  {(dept.name !== "전사" || dept.is_hidden) && (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleDeptHide(client, originalIndex)}
                                      className={`px-1.5 py-1 border rounded text-[9px] font-black shadow-sm transition-colors whitespace-nowrap ${dept.is_hidden ? 'bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-600 hover:text-white' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-600 hover:text-white'}`}
                                    >
                                      {dept.is_hidden ? '숨김복구' : '부서숨김'}
                                    </button>
                                  )}
                                  {dept.name !== "전사" && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteDept(client, dept.name)}
                                      className="px-1.5 py-1 bg-red-50 border border-red-100 text-red-400 rounded text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                                    >
                                      삭제
                                    </button>
                                  )}
                              </div>
                            ) : (
                              <span className="text-slate-300 text-[9px]">
                                {activeTab === 'ARCHIVED' ? '조작불가' : '권한제한'}
                              </span>
                            )}
                          </td>
                          <td className="border-r border-slate-100"></td>
                          <td className="border-r border-slate-100"></td>
                          <td className="px-3 border-r border-slate-100 text-right font-mono text-[12px] text-slate-700 whitespace-nowrap">
                            {Number(stats.monthQty ?? 0).toLocaleString()}
                          </td>
                          <td className="px-3 border-r border-slate-100 text-right font-mono text-[12px] text-slate-700 whitespace-nowrap">
                            {Number(stats.yearQty ?? 0).toLocaleString()}
                          </td>
                          <td className="text-center border-l border-slate-100">
                            <button
                              type="button"
                              onClick={() => openHistory(client.id, client.name, dept.name)}
                              className="px-2.5 py-1 rounded-lg text-[9px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                            >
                              지급 이력
                            </button>
                          </td>
                          <td colSpan={activeTab === 'ARCHIVED' ? 3 : 1}></td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {filteredClients.length > 0 && (
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
                type="button"
                key={i}
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
     
      {/* 지급 이력 조회 모달 (회사 전체 / 부서) */}
      {historyModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-6" onClick={closeHistoryModal}>
          <div className="bg-white w-full max-w-4xl p-8 rounded-[2.5rem] shadow-2xl flex flex-col max-h-[85vh]" onClick={e=>e.stopPropagation()}>
            <div className="flex justify-between items-start border-b border-slate-100 pb-5 mb-4 gap-4">
              <div className="min-w-0">
                <h3 className="text-xl font-black text-slate-900 truncate">
                  {historyModal.clientName}
                  {historyModal.deptName && historyModal.deptName !== '전체' ? (
                    <> - <span className="text-indigo-600">{historyModal.deptName}</span></>
                  ) : (
                    <> - <span className="text-indigo-600">전체</span></>
                  )}
                </h3>
                <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">
                  {historyModal.deptName === '전체' ? 'CLIENT DISTRIBUTION HISTORY' : 'DEPARTMENT DISTRIBUTION HISTORY'}
                </p>
              </div>
              <button type="button" onClick={closeHistoryModal} className="w-10 h-10 shrink-0 flex items-center justify-center bg-slate-100 text-slate-400 rounded-full hover:bg-slate-900 hover:text-white transition-all text-xl">✕</button>
            </div>

            {/* 연·월 필터 + 집계 */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
                <select
                  value={historyYear}
                  onChange={(e) => {
                    setHistoryYear(Number(e.target.value));
                    setHistoryMonth(0);
                    setHistoryItemFilter('');
                    setHistoryItemMenuOpen(false);
                    setHistoryPage(1);
                  }}
                  disabled={historyModal.loading}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent disabled:opacity-50"
                >
                  {historyYearOptions.map((y) => (
                    <option key={y} value={y}>{y}년</option>
                  ))}
                </select>

                <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

                <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
                <select
                  value={historyMonth}
                  onChange={(e) => {
                    setHistoryMonth(Number(e.target.value));
                    setHistoryItemFilter('');
                    setHistoryItemMenuOpen(false);
                    setHistoryPage(1);
                  }}
                  disabled={historyModal.loading}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent disabled:opacity-50"
                >
                  <option value={0}>전체</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>
              {!historyModal.loading && (
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-600">
                  <span className="bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                    {historyAgg.count}건
                  </span>
                  <span className="bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                    수량 {historyAgg.totalQty.toLocaleString()}
                  </span>
                  {historyAgg.pendingCount > 0 && (
                    <span className="bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 rounded-lg" title="승인 전이라 수량 합계에서 제외">
                      지급대기 {historyAgg.pendingCount}건
                    </span>
                  )}
                </div>
              )}
            </div>
     
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-0">
              {historyModal.loading ? (
                <div className="py-20 text-center text-indigo-400 font-bold animate-pulse">이력 불러오는 중...</div>
              ) : historyByPeriod.length === 0 ? (
                <div className="py-20 text-center text-slate-300 font-bold">
                  {historyMonth === 0
                    ? `${historyYear}년 지급 이력이 없습니다.`
                    : `${historyYear}년 ${historyMonth}월 지급 이력이 없습니다.`}
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 text-[10px] text-slate-400 font-black uppercase sticky top-0 border-b border-slate-200 z-10">
                    <tr>
                      <th className="py-3 pl-3 w-12 text-center">NO</th>
                      <th className="py-3">지급일자</th>
                      <th className="py-3 text-indigo-600">
                        <div className="relative inline-flex items-center gap-1">
                          <span>물품명{historyItemFilter ? ` · ${historyItemFilter}` : ''}</span>
                          <button
                            type="button"
                            onClick={() => setHistoryItemMenuOpen((v) => !v)}
                            className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${
                              historyItemFilter || historyItemMenuOpen
                                ? 'text-indigo-600 bg-indigo-50'
                                : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                            }`}
                            title="물품명 필터"
                            aria-label="물품명 필터"
                          >
                            ▼
                          </button>
                          {historyItemMenuOpen && (
                            <div className="absolute left-0 top-full mt-1 min-w-[160px] max-w-[240px] max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-20 normal-case tracking-normal">
                              <button
                                type="button"
                                onClick={() => {
                                  setHistoryItemFilter('');
                                  setHistoryItemMenuOpen(false);
                                  setHistoryPage(1);
                                }}
                                className={`w-full text-left px-3 py-2 text-[11px] font-bold hover:bg-indigo-50 ${
                                  !historyItemFilter ? 'text-indigo-600 bg-indigo-50/60' : 'text-slate-600'
                                }`}
                              >
                                전체
                              </button>
                              {historyItemOptions.map((name) => (
                                <button
                                  key={name}
                                  type="button"
                                  onClick={() => {
                                    setHistoryItemFilter(name);
                                    setHistoryItemMenuOpen(false);
                                    setHistoryPage(1);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-[11px] font-bold truncate hover:bg-indigo-50 ${
                                    historyItemFilter === name ? 'text-indigo-600 bg-indigo-50/60' : 'text-slate-700'
                                  }`}
                                  title={name}
                                >
                                  {name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </th>
                      <th className="py-3 text-center">수량</th>
                      <th className="py-3">지급 목적</th>
                      <th className="py-3 text-center">신청부서</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                    {filteredHistoryList.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-16 text-center text-slate-300 font-bold">
                          {historyItemFilter
                            ? `'${historyItemFilter}' 이력이 없습니다.`
                            : '표시할 이력이 없습니다.'}
                        </td>
                      </tr>
                    ) : (
                      paginatedHistory.map((d, idx) => {
                        const no = filteredHistoryList.length - ((historyPage - 1) * historyPerPage + idx);
                        return (
                          <tr key={d.id || idx} className="hover:bg-indigo-50/30 transition-colors h-12">
                            <td className="py-3 pl-3 text-center text-slate-400 font-black">{no}</td>
                            <td className="py-3 font-mono text-slate-400">
                              {d.status === 'PENDING' ? (
                                <span className="font-black text-amber-600">지급대기</span>
                              ) : (
                                getKSTDateString(getDistBusinessDate(d) as string)
                              )}
                            </td>
                            <td className="py-3 text-indigo-700">{d.item?.name || '(삭제됨)'}</td>
                            <td className="py-3 text-center bg-slate-50/50">
                              {d.qty} EA
                            </td>
                            <td className="py-3 text-slate-500 truncate max-w-[200px]" title={d.purpose}>{d.purpose}</td>
                            <td className="py-3 text-center text-[10px] text-slate-500">{d.sender_dept || '-'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {!historyModal.loading && filteredHistoryList.length > 0 && historyTotalPages > 1 && (
              <div className="flex justify-center items-center gap-1.5 pt-4 mt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage((p) => p - 1)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  이전
                </button>
                {Array.from({ length: historyTotalPages }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setHistoryPage(i + 1)}
                    className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
                      historyPage === i + 1
                        ? 'bg-slate-800 text-white shadow-sm scale-105'
                        : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={historyPage === historyTotalPages}
                  onClick={() => setHistoryPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  다음
                </button>
              </div>
            )}
          </div>
        </div>
      )}
     
      {/* 부서 추가/수정 모달 */}
      {deptModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4" onClick={() => setDeptModal({...deptModal, isOpen: false})}>
          <div className="bg-white w-[380px] p-7 rounded-[2rem] shadow-2xl flex flex-col border" onClick={e=>e.stopPropagation()}>
            <h3 className="font-black text-sm text-slate-800 mb-5 border-b border-slate-100 pb-3 flex items-center gap-2">
              <span className="text-lg">🏢</span> {deptModal.client.name} <span className="text-indigo-600">{deptModal.deptIndex !== null ? '부서명 수정' : '신규 부서 추가'}</span>
            </h3>
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-slate-500 uppercase tracking-tight ml-1">부서 명칭</label>
                <input type="text" value={deptModal.name} onChange={e=>setDeptModal({...deptModal, name: e.target.value})} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-inner" placeholder="예: 인사팀, 기획팀..." />
                {deptModal.deptIndex !== null && <p className="text-[9px] text-indigo-500 mt-1 font-bold">※ 수정 시 과거 지급 내역의 부서명도 일괄 업데이트됩니다.</p>}
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setDeptModal({...deptModal, isOpen: false})} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-black text-[11px] hover:bg-slate-200 transition-colors">취소</button>
                <button onClick={handleSaveDept} className="flex-[2] py-3.5 bg-indigo-600 text-white rounded-xl font-black text-[11px] shadow-lg hover:bg-indigo-700 transition-colors">저장하기</button>
              </div>
            </div>
          </div>
        </div>
      )}
     
      {/* 고객사 마스터 등록/수정 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white w-[420px] p-8 rounded-[2rem] shadow-2xl flex flex-col border" onClick={e=>e.stopPropagation()}>
            <h3 className="font-black text-lg text-slate-900 border-b border-slate-100 pb-4 mb-6 flex items-center gap-2">
              <span>{editClient ? '✏️' : '✨'}</span>
              고객사 마스터 {editClient ? '정보 수정' : '신규 등록'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[12px] font-black text-slate-600 tracking-tight">고객사 공식 회사명 *</label>
                <input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm placeholder:text-slate-400" placeholder="회사명 풀명칭 입력" />
                {editClient && (
                  <p className="text-[9px] text-indigo-500 mt-1 font-bold">※ 수정 시 과거 지급 내역의 회사명도 일괄 업데이트됩니다.</p>
                )}
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[12px] font-black text-slate-600 tracking-tight">업무 범주 (CATEGORY) *</label>
                {masterCategories.length > 0 ? (
                  <select 
                    required 
                    value={formData.category} 
                    onChange={e=>setFormData({...formData, category: e.target.value})} 
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm cursor-pointer text-slate-700"
                  >
                    <option value="">범주 선택</option>
                    {masterCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                ) : (
                  <div className="relative">
                    <input 
                      required type="text" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} 
                      className="w-full p-3.5 bg-red-50 border border-red-200 rounded-xl text-[13px] font-bold outline-none focus:border-red-500 transition-all shadow-sm text-red-700 placeholder:text-red-300" 
                      placeholder="어드민 설정에서 마스터 그룹을 매핑해주세요!" 
                    />
                    <p className="text-[9px] text-red-500 font-bold mt-1 ml-1">※ 현재 매핑된 마스터 그룹이 없어 직접 입력 모드입니다.</p>
                  </div>
                )}
              </div>
     
              <div className="space-y-1.5">
                <label className="text-[12px] font-black text-slate-600 tracking-tight">소재지 주소</label>
                <input type="text" value={formData.location} onChange={e=>setFormData({...formData, location: e.target.value})} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm placeholder:text-slate-400" placeholder="풀주소 입력" />
              </div>
     
              {!editClient && (
                <div className="bg-indigo-50/50 p-4 rounded-2xl border border-dashed border-indigo-200">
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">💡 <strong>기본 부서(전사)</strong>가 자동으로 생성됩니다.</p>
                </div>
              )}
              
              <div className="flex gap-2.5 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-xl font-black text-[12px] hover:bg-slate-200 transition-colors">취소</button>
                <button type="submit" className="flex-[2] py-4 bg-indigo-600 text-white rounded-xl font-black text-[12px] shadow-lg hover:bg-indigo-700 transition-colors">{editClient ? '수정 완료' : '등록 완료'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}