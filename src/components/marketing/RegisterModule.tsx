'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTYearMonth, getKSTNowYearMonth } from '@/utils/dateUtils';
import { resolveTopOrgName, canDistributeMarketingOwnerDept, canApplyViaViewRoles } from '@/utils/orgUnits';
import LoadingState from '@/components/common/LoadingState';

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

function getDistBusinessDate(d: { dist_date?: string | Date | null; createdAt?: string | Date | null }) {
  return d.dist_date || d.createdAt || null;
}

/** 승인 완료 후 3일(KST) 이내 — 최근 승인 하이라이트 */
function isRecentlyApproved(d: { status?: string | null; approved_at?: string | Date | null }, withinDays = 3) {
  if (d.status === 'PENDING' || d.status === 'REJECTED' || !d.approved_at) return false;
  const approvedYmd = getKSTDateString(d.approved_at);
  const todayYmd = getKSTDateString();
  if (!approvedYmd || !todayYmd) return false;
  const a = new Date(`${approvedYmd}T12:00:00+09:00`).getTime();
  const t = new Date(`${todayYmd}T12:00:00+09:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(t)) return false;
  const diffDays = Math.floor((t - a) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays < withinDays;
}

async function readApiError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

/** 역할 문자열 정규화 (CatalogModule과 동일) */
function normalizeRoles(roles: unknown): string[] {
  if (!roles) return [];
  const arr = Array.isArray(roles) ? roles : [roles];
  return arr.map((r) => {
    const s = String(r).trim();
    const m = s.match(/(\d+)/);
    return m ? `LV_${m[1]}` : s;
  });
}

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemIdFromUrl = searchParams.get('itemId');

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  /** 고객사 검색 팝업: 회사 → 부서 → 최근 지급 이력 */
  const [modalClient, setModalClient] = useState<any | null>(null);
  const [modalDept, setModalDept] = useState<string | null>(null);
  const [modalHistory, setModalHistory] = useState<any[]>([]);
  const [modalHistoryLoading, setModalHistoryLoading] = useState(false);
  const [modalHistoryPage, setModalHistoryPage] = useState(1);
  const modalHistoryPerPage = 10;

  const todayStr = getKSTDateString();
  const { year: kstYear } = getKSTNowYearMonth();

  const initialForm = {
    item_id: '',
    client_name: '',
    client_dept: '',
    qty: 1,
    purpose: '',
    dist_date: todayStr,
  };
  const [formData, setFormData] = useState(initialForm);

  const [searchItemQuery, setSearchItemQuery] = useState('');
  const [searchClientQuery, setSearchClientQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(kstYear.toString());
  // 🚀 [1] 월(달) 조회 필터 상태 추가
  const [selectedMonth, setSelectedMonth] = useState('ALL'); 
  const [itemOwnerFilter, setItemOwnerFilter] = useState('ALL');
  const [selectedClientFilter, setSelectedClientFilter] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const fetchMyDistributions = async () => {
    const dRes = await fetch(`/api/marketing/distributions?mine=1&t=${Date.now()}`);
    if (dRes.ok) setDistributions(await dRes.json());
    else {
      setDistributions([]);
      throw new Error(await readApiError(dRes, '지급 이력 로드 실패'));
    }
  };

  useEffect(() => {
    const initData = async () => {
      setLoadError(null);
      try {
        const ts = Date.now();
        const [uRes, iRes, cRes, unitsRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts),
          fetch('/api/marketing/items?t=' + ts),
          fetch('/api/marketing/clients?lite=1&t=' + ts),
          fetch('/api/admin/units?active=true&t=' + ts),
        ]);

        const failed: string[] = [];
        if (!uRes.ok) failed.push('사용자');
        if (!iRes.ok) failed.push('물품');
        if (!cRes.ok) failed.push('고객사');

        let user: any = null;
        if (uRes.ok) {
          user = await uRes.json();
          setCurrentUser(user);
        }
        if (iRes.ok) setItems(await iRes.json());
        else setItems([]);
        if (cRes.ok) setClients(await cRes.json());
        else setClients([]);
        if (unitsRes.ok) setUnits(await unitsRes.json());

        if (user?.email) {
          try {
            await fetchMyDistributions();
          } catch (e: any) {
            failed.push('지급이력');
          }
        }

        if (failed.length > 0) {
          const status = [uRes, iRes, cRes].find((r) => !r.ok)?.status;
          setLoadError(
            status === 401
              ? '로그인 세션이 만료되었거나 권한이 없습니다.'
              : status === 403
                ? '마케팅 메뉴 접근 권한이 없습니다.'
                : `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')})`
          );
        }
      } catch (e) {
        console.error('초기 데이터 로드 실패:', e);
        setLoadError('네트워크 오류로 데이터를 불러오지 못했습니다.');
      }
      setLoading(false);
    };
    initData();
  }, []);

  const topOrgName = useMemo(() => resolveTopOrgName(units), [units]);
  const myRoles = useMemo(() => normalizeRoles(currentUser?.roles), [currentUser]);
  const isLv1 = myRoles.includes('LV_1');

  /**
   * Catalog 윗줄「신청가능」과 동일 + 타부서 열람LV·신청허용 물품
   * Center → 본인+상위HQ+최상위 / HQ → 본인+하위Center+최상위 / Organization → 최상위만
   * LV_1만 전체
   */
  const checkDistributePermission = (item: {
    owner_dept?: string | null;
    view_role_ids?: unknown;
    view_allow_apply?: boolean | null;
  }) => {
    if (!currentUser) return false;
    if (
      canDistributeMarketingOwnerDept(item.owner_dept, {
        myUnitName: currentUser.unit?.unit_name,
        myUnitId: currentUser.dept_id || currentUser.unit_id || currentUser.unit?.id,
        myHqName: currentUser.unit?.parent?.unit_name,
        topOrgName,
        units,
        isPower: isLv1,
      })
    ) {
      return true;
    }
    return canApplyViaViewRoles(item, currentUser.roles);
  };

  /** Catalog와 동일: Organization 풀 · 열람LV 신청허용(타부서만) → 승인 요청 */
  const itemNeedsApprovalRequest = (item: {
    owner_dept?: string | null;
    view_role_ids?: unknown;
    view_allow_apply?: boolean | null;
  } | null | undefined) => {
    if (!item || !currentUser) return false;
    const isTopOrgItem = !!(topOrgName && item.owner_dept === topOrgName);
    const viaOwner = canDistributeMarketingOwnerDept(item.owner_dept, {
      myUnitName: currentUser.unit?.unit_name,
      myUnitId: currentUser.dept_id || currentUser.unit_id || currentUser.unit?.id,
      myHqName: currentUser.unit?.parent?.unit_name,
      topOrgName,
      units,
      isPower: isLv1,
    });
    const viaViewApply = canApplyViaViewRoles(item, currentUser.roles);
    return isTopOrgItem || (viaViewApply && !viaOwner);
  };

  /** Catalog 신청가능보기와 동일 스코프만 (종료 제외). 부서 순서는 admin/units(sort_order) = Org → HQ → Center */
  const availableItems = useMemo(() => {
    const deptOrder = new Map<string, number>();
    units.forEach((u: { unit_name?: string | null }, idx: number) => {
      const name = u?.unit_name?.trim();
      if (name && !deptOrder.has(name)) deptOrder.set(name, idx);
    });

    return items
      .filter((item) => !item.is_archived && checkDistributePermission(item))
      .sort((a, b) => {
        const ai = deptOrder.has(a.owner_dept) ? (deptOrder.get(a.owner_dept) as number) : Number.MAX_SAFE_INTEGER;
        const bi = deptOrder.has(b.owner_dept) ? (deptOrder.get(b.owner_dept) as number) : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
      });
  }, [items, currentUser, topOrgName, units, isLv1]);

  // URL로 타 부서 물품이 넘어오면 선택하지 않음 (신청 불가)
  useEffect(() => {
    if (!itemIdFromUrl || !currentUser) return;
    if (availableItems.some((i) => i.id === itemIdFromUrl)) {
      setFormData((prev) => ({ ...prev, item_id: itemIdFromUrl }));
      return;
    }
    if (items.length > 0 && items.some((i) => i.id === itemIdFromUrl)) {
      setFormData((prev) => (prev.item_id === itemIdFromUrl ? { ...prev, item_id: '' } : prev));
    }
  }, [itemIdFromUrl, availableItems, items, currentUser]);

  const selectedItemData = useMemo(
    () => availableItems.find((i) => i.id === formData.item_id),
    [availableItems, formData.item_id]
  );
  const needsApprovalRequest = itemNeedsApprovalRequest(selectedItemData);
  const totalPrice = selectedItemData ? selectedItemData.unit_price * formData.qty : 0;
  const GROUPWARE_URL = 'https://ep.kpcqa.or.kr/ea/edoc/eapproval/docCommonDrafWrite.do?template_key=8';

  const selectedClientData = useMemo(
    () => clients.find((c) => c.name === formData.client_name),
    [clients, formData.client_name]
  );

  const getNormalizedSortedDepts = (departments: any) => {
    if (!Array.isArray(departments)) return [];
    const depts = departments.map((d) =>
      typeof d === 'string' ? { name: d, is_hidden: false } : d
    );
    return depts.sort((a, b) => {
      if (a.name === '전사') return -1;
      if (b.name === '전사') return 1;
      return a.name.localeCompare(b.name, 'ko');
    });
  };

  const modalSearchResults = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return [];
    return clients.filter(
      (c) => !c.is_archived && String(c.name || '').toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  /** 최근 12개월(KST 지급일) 이력 */
  const modalHistoryRecent = useMemo(() => {
    const todayYmd = getKSTDateString();
    if (!todayYmd) return [];
    const [y, m, day] = todayYmd.split('-').map(Number);
    let cy = y;
    let cm = m - 12;
    while (cm <= 0) {
      cm += 12;
      cy -= 1;
    }
    const cutoff = `${cy}-${String(cm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return modalHistory.filter((d) => {
      if (d?.status === 'REJECTED') return false;
      const biz = getDistBusinessDate(d);
      if (!biz) return false;
      const ymd = getKSTDateString(biz as string);
      return !!ymd && ymd >= cutoff;
    });
  }, [modalHistory]);

  const modalHistoryTotalPages = Math.max(
    1,
    Math.ceil(modalHistoryRecent.length / modalHistoryPerPage)
  );
  const paginatedModalHistory = useMemo(() => {
    const start = (modalHistoryPage - 1) * modalHistoryPerPage;
    return modalHistoryRecent.slice(start, start + modalHistoryPerPage);
  }, [modalHistoryRecent, modalHistoryPage, modalHistoryPerPage]);

  useEffect(() => {
    if (modalHistoryPage > modalHistoryTotalPages) setModalHistoryPage(1);
  }, [modalHistoryPage, modalHistoryTotalPages]);

  const openClientModal = () => {
    setClientSearch('');
    setModalClient(null);
    setModalDept(null);
    setModalHistory([]);
    setModalHistoryLoading(false);
    setModalHistoryPage(1);
    setShowClientModal(true);
  };

  const closeClientModal = () => {
    setShowClientModal(false);
    setClientSearch('');
    setModalClient(null);
    setModalDept(null);
    setModalHistory([]);
    setModalHistoryLoading(false);
    setModalHistoryPage(1);
  };

  const selectModalClient = (c: any) => {
    setModalClient(c);
    setModalDept(null);
    setModalHistory([]);
    setModalHistoryPage(1);
  };

  const selectModalDept = async (deptName: string) => {
    if (!modalClient?.id) return;
    setModalDept(deptName);
    setModalHistoryLoading(true);
    setModalHistory([]);
    setModalHistoryPage(1);
    try {
      const qs = new URLSearchParams({
        clientId: modalClient.id,
        clientDept: deptName,
        t: String(Date.now()),
      });
      const res = await fetch(`/api/marketing/distributions?${qs}`);
      if (!res.ok) {
        setModalHistory([]);
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
      setModalHistory(sorted);
    } catch (e) {
      console.error(e);
      setModalHistory([]);
      alert('이력을 불러오지 못했습니다.');
    } finally {
      setModalHistoryLoading(false);
    }
  };

  const confirmModalClientDept = () => {
    if (!modalClient?.name || !modalDept) {
      return alert('고객사와 부서를 모두 선택해 주세요.');
    }
    setFormData((prev) => ({
      ...prev,
      client_name: modalClient.name,
      client_dept: modalDept,
    }));
    closeClientModal();
  };

  /** 폼 입력값 → 그룹웨어 결재용 텍스트 복사 */
  const handleCopyFormForApproval = async () => {
    if (!selectedItemData || !formData.client_name.trim() || !formData.purpose.trim()) {
      return alert('물품·고객사·지급목적을 먼저 입력한 뒤 복사해 주세요.');
    }
    const distDateLabel = needsApprovalRequest ? '지급대기' : formData.dist_date;
    const clientDeptStr = formData.client_dept ? ` ${formData.client_dept}` : '';
    const clientInfo = `${formData.client_name}${clientDeptStr} (성함 직급)`;
    const textToCopy = `[선물명] ${selectedItemData.name}\n[지급목적] ${formData.purpose}\n[지급일자] ${distDateLabel}\n[업체명] ${clientInfo}\n[신청개수] ${formData.qty || 1}개`;
    try {
      await navigator.clipboard.writeText(textToCopy);
      alert('✅ 결재용 텍스트가 복사되었습니다!\n\n업체명의 (성함 직급) 부분을 실제 담당자 정보로 수정 후 그룹웨어에 붙여넣으세요.');
    } catch {
      alert('복사에 실패했습니다.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.item_id || !formData.client_name || !formData.purpose) {
      return alert('필수 항목을 입력하세요.');
    }
    if (!selectedItemData || formData.qty > selectedItemData.current_stock) {
      return alert('입력 수량이 현재 재고보다 많습니다!');
    }

    const payload = {
      ...formData,
      client_id: selectedClientData?.id || null,
      requires_approval: needsApprovalRequest,
      // sender_* / email 은 서버 세션으로 기록
    };

    try {
      const res = await fetch('/api/marketing/distributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        alert(
          needsApprovalRequest
            ? '✅ 승인 요청이 등록되었습니다. (관리자 승인 후 지급이 확정됩니다.)'
            : '✅ 성공적으로 등록되었으며, 재고가 차감되었습니다.'
        );
        setFormData({ ...initialForm, dist_date: getKSTDateString() });
        setCurrentPage(1);
        setSelectedClientFilter(null);
        await fetchMyDistributions();
        const iRes = await fetch('/api/marketing/items?t=' + Date.now());
        if (iRes.ok) setItems(await iRes.json());
      } else {
        alert(await readApiError(res, '등록 실패'));
      }
    } catch (e) {
      alert('오류 발생');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 지급 신청을 철회하시겠습니까?\n(철회 시 카탈로그 재고가 원래대로 복구됩니다.)')) return;
    const res = await fetch(`/api/marketing/distributions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert('지급 신청이 정상적으로 철회되었습니다.');
      setDistributions((prev) => prev.filter((d) => d.id !== id));
      const iRes = await fetch('/api/marketing/items?t=' + Date.now());
      if (iRes.ok) setItems(await iRes.json());
    } else {
      alert(await readApiError(res, '철회 실패'));
    }
  };

  const availableYears = useMemo(() => {
    const years = distributions
      .map((d) => getKSTYearMonth(getDistBusinessDate(d) as string)?.year?.toString())
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const cur = getKSTNowYearMonth().year.toString();
    if (!unique.includes(cur)) unique.push(cur);
    return unique;
  }, [distributions]);

  const availableItemOwners = useMemo(() => {
    return Array.from(new Set(distributions.map((d) => d.item?.owner_dept || '미지정'))).sort((a, b) =>
      a.localeCompare(b, 'ko')
    );
  }, [distributions]);

  const baseFilteredList = useMemo(() => {
    return distributions
      .filter((d) => {
        const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
        const yearMatch = selectedYear === 'ALL' || (ym && ym.year.toString() === selectedYear);

        const dMonth = ym ? String(ym.month).padStart(2, '0') : '';
        const monthMatch = selectedMonth === 'ALL' || dMonth === selectedMonth;

        const ownerMatch =
          itemOwnerFilter === 'ALL' || (d.item?.owner_dept || '미지정') === itemOwnerFilter;

        const itemQ = searchItemQuery.trim();
        const clientQ = searchClientQuery.trim();
        const itemMatch = !itemQ || (d.item?.name || '').includes(itemQ);
        const clientMatch = !clientQ || (d.client_name || '').includes(clientQ);

        return yearMatch && monthMatch && ownerMatch && itemMatch && clientMatch;
      })
      // 신청 쌓인 순(최신 createdAt 위) — 순번은 이 순서 기준 reverseNo
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [distributions, selectedYear, selectedMonth, itemOwnerFilter, searchItemQuery, searchClientQuery]);

  const totalAmountForYear = useMemo(() => {
    return baseFilteredList.reduce((acc, cur) => {
      if (cur.status === 'REJECTED' || cur.status === 'PENDING') return acc;
      return acc + (cur.item?.unit_price || 0) * cur.qty;
    }, 0);
  }, [baseFilteredList]);

  const totalCountForYear = useMemo(
    () =>
      baseFilteredList.filter((d) => d.status !== 'REJECTED' && d.status !== 'PENDING').length,
    [baseFilteredList]
  );

  const clientStats = useMemo(() => {
    const statsMap: Record<string, { price: number; count: number }> = {};
    baseFilteredList.forEach((d) => {
      if (d.status === 'REJECTED' || d.status === 'PENDING') return;
      const amount = (d.item?.unit_price || 0) * d.qty;
      if (!statsMap[d.client_name]) statsMap[d.client_name] = { price: 0, count: 0 };
      statsMap[d.client_name].price += amount;
      statsMap[d.client_name].count += 1;
    });

    return Object.entries(statsMap)
      .map(([name, { price, count }]) => ({
        name,
        price,
        count,
        percent: totalAmountForYear > 0 ? ((price / totalAmountForYear) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.price - a.price);
  }, [baseFilteredList, totalAmountForYear]);

  const finalFilteredList = useMemo(() => {
    // 칩 미선택: 전체 이력(대기·반려 포함). 칩 선택: 칩 집계와 동일하게 확정만
    if (!selectedClientFilter) return baseFilteredList;
    return baseFilteredList.filter(
      (d) =>
        d.client_name === selectedClientFilter &&
        d.status !== 'REJECTED' &&
        d.status !== 'PENDING'
    );
  }, [baseFilteredList, selectedClientFilter]);

  const totalPages = Math.max(1, Math.ceil(finalFilteredList.length / itemsPerPage));
  const paginatedList = finalFilteredList.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedYear, selectedMonth, itemOwnerFilter, searchItemQuery, searchClientQuery, selectedClientFilter]);

  const toggleAll = () => {
    const currentPageIds = paginatedList.map((d) => d.id);
    const allSelected =
      currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach((id) => next.delete(id));
    else currentPageIds.forEach((id) => next.add(id));
    setSelectedIds(next);
  };

  const handleDownloadExcel = () => {
    // 선택 시에도 화면 연·월·검색 필터(finalFilteredList)와 교집합 — 범위 밖 ID 혼입 방지
    const targetList =
      selectedIds.size > 0
        ? finalFilteredList.filter((d) => selectedIds.has(d.id))
        : finalFilteredList;

    if (targetList.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const exportData = targetList.map((d) => ({
      '지급일자':
        d.status === 'PENDING'
          ? '지급대기'
          : d.status === 'REJECTED'
            ? '반려'
            : getKSTDateString(getDistBusinessDate(d) as string),
      '상태': d.status === 'REJECTED' ? '반려' : d.status === 'PENDING' ? '지급대기' : '확정',
      '반려사유': d.reject_reason || '',
      '고객사(회사명)': d.client_name,
      '고객사 부서': d.client_dept,
      '물품소속': d.item?.owner_dept || '-',
      '물품명': d.item?.name || '(삭제됨)',
      '단가(원)': d.item?.unit_price,
      '개수': d.status === 'REJECTED' ? '' : d.qty,
      '총 금액(원)': d.status === 'REJECTED' ? '' : (d.item?.unit_price || 0) * d.qty,
      '지급목적': d.purpose,
      '신청자': d.sender_name,
      '소속부서': d.sender_dept,
      '신청자이메일': d.sender_email || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '지급이력대장');
    XLSX.writeFile(
      wb,
      `지급이력대장_${selectedYear}년_${currentUser?.name || '관리자'}.xlsx`
    );
  };

  if (loading) return <LoadingState />;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2.5">
              GIFT DISTRIBUTION MANAGEMENT
            </h3>
            <h1 className="text-2xl tracking-tight leading-none">
              <span className="text-indigo-400 font-normal">{currentUser?.name || '임직원'} 님</span>
              <span className="text-white/30 font-normal mx-2.5">|</span>
              <span className="text-white font-extrabold">기념품 지급 신청/재고 확보</span>
            </h1>
            <p className="text-slate-400 text-xs mt-3 leading-relaxed">
              센터·본부 재고 내에서 고객사 기념품 지급을 등록·관리합니다.
            </p>
          </div>
          <a
            href={GROUPWARE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 self-start md:self-end inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[10px] font-black tracking-tight bg-white/10 border border-white/20 text-slate-200 shadow-sm hover:bg-white/15 hover:border-white/30 hover:text-white transition-colors"
          >
            <span>⚠️</span>
            <span>재고 확보 후 그룹웨어 별도 신청 필요</span>
            <span className="opacity-80">↗</span>
          </a>
        </div>
      </div>

      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-bold flex justify-between items-center gap-4 shadow-sm">
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-black hover:bg-amber-700"
          >
            새로고침
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4 px-2">
          <span className="w-6 h-6 bg-indigo-600 text-white rounded-md flex items-center justify-center text-xs font-black">
            🎁
          </span>
          <h3 className="text-sm font-black text-slate-900 tracking-tight">
            기념품 지급 신청
          </h3>
        </div>
        <form onSubmit={handleSubmit} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-indigo-600 uppercase ml-1">물품 선택 *</label>
              <div className="relative group/item">
                <select
                  required
                  value={formData.item_id}
                  onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
                  className={`w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 shadow-sm cursor-pointer ${
                    !formData.item_id
                      ? 'text-slate-700 focus:ring-indigo-500'
                      : needsApprovalRequest
                        ? 'text-amber-700 focus:ring-amber-400'
                        : 'text-indigo-600 focus:ring-indigo-500'
                  }`}
                >
                  <option value="" className="text-slate-500">
                    카탈로그에서 물품 선택 (신청가능 {availableItems.length}건)
                  </option>
                  {availableItems.map((i) => {
                    const approval = itemNeedsApprovalRequest(i);
                    return (
                      <option
                        key={i.id}
                        value={i.id}
                        disabled={i.current_stock <= 0}
                        className={approval ? 'text-amber-700' : 'text-indigo-600'}
                        style={{ color: approval ? '#b45309' : '#4f46e5' }}
                      >
                        [{i.owner_dept || '-'}] {i.name}{' '}
                        {i.current_stock <= 0
                          ? '(품절)'
                          : `(재고 ${i.current_stock}${i.unit || 'EA'})${approval ? ' · 승인필요' : ''}`}
                      </option>
                    );
                  })}
                </select>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute left-0 bottom-full z-20 mb-2 w-max max-w-[260px] px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold leading-relaxed shadow-lg opacity-0 translate-y-1 transition-all duration-150 group-hover/item:opacity-100 group-hover/item:translate-y-0 group-focus-within/item:opacity-100 group-focus-within/item:translate-y-0"
                >
                  승인 필요 물품은 앰버, 바로 신청 가능한 물품은 파란색으로 표시됩니다.
                  <span className="absolute left-4 top-full border-4 border-transparent border-t-slate-900" />
                </div>
              </div>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">단가 정보</label>
              <div className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-black text-slate-500 text-center shadow-sm">
                {selectedItemData ? `${selectedItemData.unit_price.toLocaleString()} 원` : '-'}
              </div>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-indigo-600 uppercase ml-1">지급 개수 *</label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max={selectedItemData?.current_stock || 1}
                  required
                  value={formData.qty}
                  onChange={(e) => setFormData({ ...formData, qty: Number(e.target.value) })}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm pr-12"
                  placeholder="수량"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">
                  / {selectedItemData?.current_stock || 0}
                </span>
              </div>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">총 금액 (단가 × 수량)</label>
              <div className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-black text-slate-500 text-right pr-4 shadow-sm">
                {totalPrice > 0 ? `${totalPrice.toLocaleString()} 원` : '-'}
              </div>
            </div>
            <div className="lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-indigo-600 uppercase ml-1">지급 목적 *</label>
              <input
                type="text"
                required
                value={formData.purpose}
                onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm text-slate-700"
                placeholder="예: 미팅 참석 기념품 제공"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-12 gap-2 items-end">
            <div className="col-span-2 lg:col-span-3 space-y-1 relative">
              <label className="text-[10px] font-black text-indigo-600 uppercase ml-1">고객사(회사명) *</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  readOnly
                  required
                  value={formData.client_name}
                  className="min-w-0 flex-1 p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold shadow-sm outline-none cursor-pointer text-slate-700"
                  placeholder="검색"
                  onClick={openClientModal}
                />
                <button
                  type="button"
                  onClick={openClientModal}
                  className="px-2.5 shrink-0 bg-indigo-100 text-indigo-700 font-black text-[10px] rounded-xl border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-colors shadow-sm"
                >
                  검색
                </button>
              </div>
            </div>

            <div className="col-span-2 lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">고객사 부서명</label>
              <input
                type="text"
                list="dept-list"
                value={formData.client_dept}
                onChange={(e) => setFormData({ ...formData, client_dept: e.target.value })}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm text-slate-700"
                placeholder="부서"
              />
              <datalist id="dept-list">
                {selectedClientData?.departments?.map((d: any, idx: number) => {
                  const name = typeof d === 'string' ? d : d.name;
                  const isHidden = typeof d === 'object' ? d.is_hidden : false;
                  if (isHidden) return null;
                  return <option key={idx} value={name} />;
                })}
              </datalist>
            </div>

            <div className="col-span-1 lg:col-span-1 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">재고신청일</label>
              <input
                type="text"
                readOnly
                value={todayStr}
                className="w-full min-w-0 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-bold text-slate-400 shadow-inner outline-none cursor-not-allowed text-center tabular-nums"
              />
            </div>

            <div className="col-span-1 lg:col-span-1 space-y-1">
              <label className="text-[10px] font-black text-indigo-600 uppercase ml-1">
                지급일자 *
              </label>
              {needsApprovalRequest ? (
                <div className="w-full min-w-0 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-bold text-slate-500 shadow-inner outline-none cursor-not-allowed text-center">
                  지급대기
                </div>
              ) : (
                <input
                  type="date"
                  required
                  value={formData.dist_date}
                  onChange={(e) => setFormData({ ...formData, dist_date: e.target.value })}
                  className="w-full min-w-0 p-2 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 shadow-sm outline-none focus:ring-2 ring-indigo-500"
                />
              )}
            </div>

            {/* 복사 → 재고확보/승인요청 → 그룹웨어 */}
            <div className="col-span-2 lg:col-span-4 space-y-1">
              <label className="text-[10px] font-black text-indigo-600 uppercase ml-1">
                다음 순서{' '}
                <span className="normal-case tracking-normal text-slate-400 font-bold">
                  {needsApprovalRequest
                    ? '(복사 → 승인요청 → 그룹웨어 결재)'
                    : '(복사 → 재고확보 → 그룹웨어 결재)'}
                </span>
              </label>
              <div className="flex items-end gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyFormForApproval}
                  className="flex-1 h-10 px-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl font-black text-[12px] hover:bg-indigo-600 hover:text-white transition-all shadow-sm whitespace-nowrap"
                >
                  1. 결재용 복사
                </button>
                <button
                  type="submit"
                  className={`flex-1 h-10 px-2 text-white rounded-xl font-black text-[12px] shadow-md active:scale-95 transition-all whitespace-nowrap ${
                    needsApprovalRequest
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {needsApprovalRequest ? '2. 승인요청 등록' : '2. 재고 확보 신청등록'}
                </button>
                <a
                  href={GROUPWARE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-10 px-2 inline-flex items-center justify-center bg-slate-700 text-slate-100 rounded-xl font-black text-[12px] shadow-md hover:bg-slate-800 transition-all whitespace-nowrap"
                >
                  3. 그룹웨어 바로가기 ↗
                </a>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <HeaderLight title="나의 지급 이력 대장" count={finalFilteredList.length}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase">물품소속</span>
              <select
                value={itemOwnerFilter}
                onChange={(e) => setItemOwnerFilter(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
              >
                <option value="ALL">전체</option>
                {availableItemOwners.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

              <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

              <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-40">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">📦</span>
                <input
                  type="text"
                  placeholder="물품명 검색..."
                  value={searchItemQuery}
                  onChange={(e) => setSearchItemQuery(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
              <div className="relative w-36">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🏢</span>
                <input
                  type="text"
                  placeholder="고객사 검색..."
                  value={searchClientQuery}
                  onChange={(e) => setSearchClientQuery(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadExcel}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
            >
              {selectedIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedIds.size})`
                : '화면 목록 EXCEL 다운로드'}
            </button>
          </div>
        </HeaderLight>

        <div className="p-6 bg-slate-50/70 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm min-h-[110px] flex flex-col justify-center">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
              나의 총 지급액/지급건 ({selectedYear === 'ALL' ? '전체' : `${selectedYear}년`})
            </span>
            <div className="text-xl font-mono font-black text-indigo-600 mt-1">
              {totalAmountForYear.toLocaleString()}
              <span className="text-xs text-slate-500 font-sans font-bold">원</span>
              <span className="text-slate-300 font-sans mx-1">/</span>
              <span className="text-slate-800">{totalCountForYear.toLocaleString()}</span>
              <span className="text-xs text-slate-500 font-sans font-bold">건</span>
            </div>
          </div>

          <div className="lg:col-span-9 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-2 block">
              고객사별 지급액 비중 요약 (클릭하여 해당 내역만 필터링)
            </span>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide max-h-[64px]">
              {clientStats.length === 0 ? (
                <span className="text-xs text-slate-400 font-bold py-2">
                  지급 통계 데이터가 존재하지 않습니다.
                </span>
              ) : (
                clientStats.map((stat) => {
                  const isSelected = selectedClientFilter === stat.name;
                  return (
                    <div
                      key={stat.name}
                      onClick={() =>
                        setSelectedClientFilter((prev) => (prev === stat.name ? null : stat.name))
                      }
                      className={`shrink-0 border rounded-xl px-3 py-1.5 flex flex-col justify-center text-right min-w-[120px] cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-100 border-indigo-300 shadow-sm'
                          : 'bg-slate-50 border-slate-200 hover:bg-white hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <span
                        className={`text-[10px] font-black truncate text-left ${
                          isSelected ? 'text-indigo-900' : 'text-slate-700'
                        }`}
                      >
                        {stat.name}
                      </span>
                      <span className="text-[11px] font-mono font-black text-indigo-600 mt-0.5">
                        {stat.price.toLocaleString()}원
                        <span className="text-slate-400 font-sans font-bold">/{stat.count}건</span>
                        <strong
                          className={`text-[10px] ml-1 ${
                            isSelected ? 'text-indigo-600' : 'text-emerald-500'
                          }`}
                        >
                          ({stat.percent}%)
                        </strong>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1280px] xl:min-w-full">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      paginatedList.length > 0 &&
                      paginatedList.every((d) => selectedIds.has(d.id))
                    }
                    onChange={toggleAll}
                    className="w-3 h-3 accent-indigo-600 cursor-pointer"
                  />
                </th>
                <th className="h-12 px-2 w-10 text-center">NO</th>
                <th className="h-12 px-2 w-[88px] text-center whitespace-nowrap">재고신청일</th>
                <th className="h-12 px-2 w-[88px] text-center whitespace-nowrap">지급일자</th>
                <th className="h-12 px-2 w-28">고객사</th>
                <th className="h-12 px-2 w-24">고객사부서</th>
                <th className="h-12 px-2 w-24 text-center whitespace-nowrap">물품소속</th>
                <th className="h-12 px-2 w-36 text-indigo-600">물품명</th>
                <th className="h-12 px-2 w-[72px] text-center whitespace-nowrap">단가(원)</th>
                <th className="h-12 px-2 w-14 text-center whitespace-nowrap">수량</th>
                <th className="h-12 px-2 w-[88px] text-center text-indigo-600 whitespace-nowrap">총금액(원)</th>
                <th className="h-12 px-2 w-28 text-left">지급목적</th>
                <th className="h-12 px-2 w-32 text-center whitespace-nowrap">신청자(소속)</th>
                <th className="h-12 pr-4 text-center w-28 whitespace-nowrap">관리기능</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-16 text-center text-slate-400 text-xs">
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                paginatedList.map((d, idx) => {
                  const isSelected = selectedIds.has(d.id);
                  // 🚀 날짜 데이터 2개로 분리 (생성일 / 실제지급일)
                  const reqDate = getKSTDateString(d.createdAt);
                  const isPending = d.status === 'PENDING';
                  const isRejected = d.status === 'REJECTED';
                  const isRecentApproved = isRecentlyApproved(d);
                  const distDate = getKSTDateString(d.dist_date || d.createdAt);
                  
                  const reverseNo = finalFilteredList.length - ((currentPage - 1) * itemsPerPage + idx);
                  const canCancel = !isRejected; // 반려 건은 이력 유지(재고 이미 복구)

                  return (
                    <tr
                      key={d.id}
                      className={`transition-colors h-12 ${
                        isRejected
                          ? isSelected
                            ? 'bg-slate-200/80 text-red-500 [&_td]:text-red-500 [&_td]:line-through'
                            : 'bg-slate-100/80 text-red-500 hover:bg-slate-100 [&_td]:text-red-500 [&_td]:line-through'
                          : isPending
                            ? isSelected
                              ? 'bg-amber-100/90'
                              : 'bg-amber-50 hover:bg-amber-100/80'
                            : isRecentApproved
                              ? isSelected
                                ? 'bg-emerald-100/90'
                                : 'bg-emerald-50 hover:bg-emerald-100/80'
                              : isSelected
                                ? 'bg-indigo-50/50'
                                : 'hover:bg-slate-50/50'
                      }`}
                    >
                      <td className="pl-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const next = new Set(selectedIds);
                            next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                            setSelectedIds(next);
                          }}
                          className="w-3 h-3 accent-indigo-600 cursor-pointer"
                        />
                      </td>
                      <td
                        className="px-2 text-center font-mono text-slate-500 tabular-nums !text-slate-500 !no-underline"
                        style={isRejected ? { textDecoration: 'none' } : undefined}
                      >
                        {reverseNo}
                      </td>
                      <td className={`px-2 text-center whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-800'}`}>{reqDate}</td>
                      <td className="px-2 text-center whitespace-nowrap">
                        {isRejected ? (
                          <span className="inline-flex flex-col items-center leading-tight" title={d.reject_reason || ''}>
                            <span className="inline-block font-black text-red-600 px-0.5 text-[10px]">
                              반려
                            </span>
                            {d.reject_reason ? (
                              <span className="text-[9px] font-bold text-red-400 truncate max-w-[88px] mt-0.5">
                                {d.reject_reason}
                              </span>
                            ) : null}
                          </span>
                        ) : isPending ? (
                          <span className="inline-block font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[10px]">
                            지급대기
                          </span>
                        ) : isRecentApproved ? (
                          <span className="inline-flex flex-col items-center leading-tight">
                            <span className="text-slate-800 tabular-nums">{distDate}</span>
                            <span className="text-[9px] font-black text-emerald-600">승인완료</span>
                          </span>
                        ) : (
                          <span className="text-slate-800 tabular-nums">{distDate}</span>
                        )}
                      </td>
                      <td className={`px-2 truncate max-w-[112px] ${isRejected ? '' : 'text-slate-800'}`} title={d.client_name}>
                        {d.client_name}
                      </td>
                      <td className={`px-2 truncate max-w-[96px] ${isRejected ? '' : 'text-slate-700'}`} title={d.client_dept || ''}>
                        {d.client_dept || '-'}
                      </td>
                      <td className="px-2 text-center">
                        <span className={`inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${isRejected ? 'bg-transparent border-red-200 text-red-500' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {d.item?.owner_dept || '-'}
                        </span>
                      </td>
                      <td className={`px-2 truncate max-w-[144px] ${isRejected ? '' : 'text-indigo-700'}`} title={d.item?.name || ''}>
                        {d.item?.name || '(삭제됨)'}
                      </td>
                      <td className={`px-2 text-center font-mono whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-700'}`}>
                        {d.item?.unit_price?.toLocaleString()}
                      </td>
                      <td className={`px-2 text-center font-mono whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-slate-700'}`}>
                        {d.qty}
                        <span className={`text-[10px] font-sans ml-0.5 ${isRejected ? '' : 'text-slate-500'}`}>{d.item?.unit || 'EA'}</span>
                      </td>
                      <td className={`px-2 text-center font-mono whitespace-nowrap tabular-nums ${isRejected ? '' : 'text-indigo-600'}`}>
                        {isRejected ? '-' : ((d.item?.unit_price || 0) * d.qty).toLocaleString()}
                      </td>
                      <td
                        className={`px-2 truncate max-w-[112px] ${isRejected ? '' : 'text-slate-700'}`}
                        title={isRejected && d.reject_reason ? `${d.purpose || ''} / 반려: ${d.reject_reason}` : d.purpose}
                      >
                        {d.purpose}
                      </td>
                      <td className={`px-2 text-center ${isRejected ? '' : 'text-slate-700'}`}>
                        <div className="flex flex-col items-center justify-center leading-tight min-w-[7rem]">
                          <span className="truncate max-w-[120px]" title={d.sender_name || ''}>
                            {d.sender_name || '-'}
                          </span>
                          <span className={`text-[10px] truncate max-w-[120px] ${isRejected ? '' : 'text-slate-500'}`} title={d.sender_dept || ''}>
                            ({d.sender_dept || '-'})
                          </span>
                        </div>
                      </td>

                      {/* 🚀 복사 & 철회 듀얼 버튼 */}
                      <td
                        className="pr-4 text-center !text-slate-700 !no-underline"
                        style={isRejected ? { textDecoration: 'none', color: 'inherit' } : undefined}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isRejected ? (
                          <span className="text-[10px] text-slate-300 font-bold">-</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const giftName = d.item?.name || '기념품명';
                                const purpose = d.purpose || '지급 목적';
                                const date = d.status === 'PENDING' ? '지급대기' : distDate;
                                const clientDeptStr = d.client_dept ? ` ${d.client_dept}` : '';
                                const clientInfo = `${d.client_name}${clientDeptStr} (성함 직급)`;
                                const qty = d.qty || 1;
                                const textToCopy = `[선물명] ${giftName}\n[지급목적] ${purpose}\n[지급일자] ${date}\n[업체명] ${clientInfo}\n[신청개수] ${qty}개`;
                                navigator.clipboard.writeText(textToCopy).then(() => {
                                  alert(
                                    '✅ 결재용 텍스트가 복사되었습니다!\n\n업체명의 (성함 직급) 부분을 실제 담당자 정보로 수정 후 결재를 올리세요.'
                                  );
                                }).catch(() => {
                                  alert('복사에 실패했습니다.');
                                });
                              }}
                              className="flex-1 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-md text-[10px] font-black hover:bg-indigo-600 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                            >
                              복사
                            </button>
                            {canCancel ? (
                              <button
                                type="button"
                                onClick={() => handleDelete(d.id)}
                                className="flex-1 py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                              >
                                철회
                              </button>
                            ) : (
                              <span className="flex-1 text-[10px] text-slate-300 font-bold">-</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {finalFilteredList.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
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
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>

      {showClientModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4"
          onClick={closeClientModal}
        >
          <div
            className="bg-white w-full max-w-4xl max-h-[90vh] p-6 md:p-8 rounded-[2.5rem] shadow-2xl flex flex-col border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-4 shrink-0">
              <h3 className="font-black text-lg text-slate-800 flex items-center gap-2">
                <span>🏢</span> 고객사 마스터 검색
              </h3>
              <button
                type="button"
                onClick={closeClientModal}
                className="text-2xl text-slate-400 hover:text-slate-700 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="relative mb-4 shrink-0">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">🔍</span>
              <input
                type="text"
                autoFocus
                placeholder="회사명 키워드 입력 후 검색..."
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setModalClient(null);
                  setModalDept(null);
                  setModalHistory([]);
                }}
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white shadow-inner"
              />
              <p className="mt-1.5 text-[10px] font-bold text-slate-400 px-1">
                회사 선택 → 부서 선택 → 최근 지급 이력 확인 후 적용 (신청자명은 비공개, 신청부서만 표시)
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-0.5">
              {/* 1) 검색 결과 회사 */}
              <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                <div className="bg-slate-100 px-4 py-2 text-[10px] text-slate-500 font-black uppercase tracking-widest">
                  1. 고객사 (키워드 검색 결과)
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {!clientSearch.trim() ? (
                    <p className="text-center py-8 text-slate-400 text-xs font-bold">
                      회사명 키워드를 입력하면 관련 고객사만 표시됩니다.
                    </p>
                  ) : modalSearchResults.length === 0 ? (
                    <p className="text-center py-8 text-slate-400 text-xs font-bold">
                      검색된 고객사가 없습니다.
                    </p>
                  ) : (
                    <table className="w-full text-left table-fixed">
                      <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700">
                        {modalSearchResults.map((c) => {
                          const selected = modalClient?.id === c.id;
                          return (
                            <tr
                              key={c.id}
                              onClick={() => selectModalClient(c)}
                              className={`cursor-pointer transition-colors h-11 ${
                                selected ? 'bg-indigo-50' : 'hover:bg-indigo-50/50'
                              }`}
                            >
                              <td className="px-4 py-2.5 font-black text-slate-800 text-[13px] truncate w-[45%]">
                                {c.name}
                              </td>
                              <td className="px-3 py-2.5 text-center text-indigo-600 font-black text-[11px] truncate w-[20%]">
                                {c.category || '-'}
                              </td>
                              <td className="px-3 py-2.5 text-slate-500 font-medium text-[11px] truncate w-[35%]">
                                {c.location || '소재지 미상'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* 2) 부서 */}
              {modalClient && (
                <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                  <div className="bg-slate-100 px-4 py-2 text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center justify-between gap-2">
                    <span>2. 고객사 부서 — {modalClient.name}</span>
                  </div>
                  <div className="p-3 flex flex-wrap gap-2">
                    {getNormalizedSortedDepts(modalClient.departments)
                      .filter((d) => !d.is_hidden)
                      .map((d) => {
                        const selected = modalDept === d.name;
                        return (
                          <button
                            key={d.name}
                            type="button"
                            onClick={() => selectModalDept(d.name)}
                            className={`px-3 py-2 rounded-xl text-[11px] font-black border transition-colors ${
                              selected
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
                            }`}
                          >
                            {d.name}
                          </button>
                        );
                      })}
                    {getNormalizedSortedDepts(modalClient.departments).filter((d) => !d.is_hidden)
                      .length === 0 && (
                      <p className="text-xs font-bold text-slate-400 py-2">등록된 부서가 없습니다.</p>
                    )}
                  </div>
                </div>
              )}

              {/* 3) 최근 지급 이력 — 최근 12개월 · 10건 페이지 */}
              {modalClient && modalDept && (
                <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                  <div className="bg-slate-100 px-4 py-2 text-[10px] text-slate-500 font-black uppercase tracking-widest flex flex-wrap items-center justify-between gap-2">
                    <span>
                      3. 최근 지급 이력 — {modalClient.name} / {modalDept}
                    </span>
                    {!modalHistoryLoading && (
                      <span className="normal-case tracking-normal text-slate-600">
                        최근 12개월 · 총 {modalHistoryRecent.length.toLocaleString()}건
                      </span>
                    )}
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {modalHistoryLoading ? (
                      <p className="text-center py-10 text-indigo-400 text-xs font-bold animate-pulse">
                        이력 불러오는 중...
                      </p>
                    ) : modalHistoryRecent.length === 0 ? (
                      <p className="text-center py-10 text-slate-400 text-xs font-bold">
                        최근 12개월 지급 이력이 없습니다.
                        {modalHistory.length > 0
                          ? ' (더 이전 이력은 고객사별 수령 현황에서 확인)'
                          : ''}
                      </p>
                    ) : (
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 text-[10px] text-slate-400 font-black uppercase sticky top-0 border-b border-slate-200">
                          <tr>
                            <th className="py-2.5 pl-3 w-10 text-center">NO</th>
                            <th className="py-2.5">지급일자</th>
                            <th className="py-2.5 text-indigo-600">물품명</th>
                            <th className="py-2.5 text-center">수량</th>
                            <th className="py-2.5">지급 목적</th>
                            <th className="py-2.5 text-center">신청부서</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                          {paginatedModalHistory.map((d, idx) => {
                            const no =
                              modalHistoryRecent.length -
                              ((modalHistoryPage - 1) * modalHistoryPerPage + idx);
                            return (
                              <tr key={d.id || idx} className="h-10">
                                <td className="py-2 pl-3 text-center text-slate-400 font-black">
                                  {no}
                                </td>
                              <td className="py-2 font-mono text-slate-400">
                                {d.status === 'PENDING' ? (
                                  <span className="font-black text-amber-600">지급대기</span>
                                ) : (
                                  getKSTDateString(getDistBusinessDate(d) as string)
                                )}
                              </td>
                                <td className="py-2 text-indigo-700 truncate max-w-[140px]">
                                  {d.item?.name || '(삭제됨)'}
                                </td>
                                <td className="py-2 text-center">{d.qty}</td>
                                <td
                                  className="py-2 text-slate-500 truncate max-w-[160px]"
                                  title={d.purpose}
                                >
                                  {d.purpose}
                                </td>
                                <td className="py-2 text-center text-[10px] text-slate-500">
                                  {d.sender_dept || '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                  {!modalHistoryLoading && modalHistoryRecent.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-slate-100">
                      <p className="text-[9px] font-bold text-slate-400">
                        더 이전·전체 이력은 고객사별 수령 현황에서 확인
                      </p>
                      {modalHistoryTotalPages > 1 && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={modalHistoryPage === 1}
                            onClick={() => setModalHistoryPage((p) => p - 1)}
                            className="px-2.5 py-1 text-[10px] bg-white border border-slate-200 rounded-lg font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50"
                          >
                            이전
                          </button>
                          <span className="text-[10px] font-black text-slate-600 tabular-nums px-1">
                            {modalHistoryPage} / {modalHistoryTotalPages}
                          </span>
                          <button
                            type="button"
                            disabled={modalHistoryPage === modalHistoryTotalPages}
                            onClick={() => setModalHistoryPage((p) => p + 1)}
                            className="px-2.5 py-1 text-[10px] bg-white border border-slate-200 rounded-lg font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50"
                          >
                            다음
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  closeClientModal();
                  router.push('/marketing/distribution/client-search');
                }}
                className="px-4 py-2.5 text-[11px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-colors"
              >
                고객사 통합 관리(신규등록)
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeClientModal}
                  className="px-5 py-2.5 bg-slate-100 text-slate-500 rounded-xl text-[11px] font-black hover:bg-slate-200"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={!modalClient || !modalDept}
                  onClick={confirmModalClientDept}
                  className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black shadow-md hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  이 고객사·부서로 선택
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RegisterModule() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RegisterContent />
    </Suspense>
  );
}