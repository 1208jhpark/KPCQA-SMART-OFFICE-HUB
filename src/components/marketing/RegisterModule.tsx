'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTYearMonth, getKSTNowYearMonth } from '@/utils/dateUtils';
import { resolveTopOrgName, canDistributeMarketingOwnerDept } from '@/utils/orgUnits';

const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
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

  const [searchQuery, setSearchQuery] = useState('');
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
   * Catalog 윗줄「신청가능」과 동일 — 타 부서 물품은 목록에 넣지 않음
   * Center → 본인+상위HQ+최상위 / HQ → 본인+하위Center+최상위 / Organization → 최상위만
   * LV_1만 전체
   */
  const checkDistributePermission = (itemOwnerDept: string) => {
    if (!currentUser) return false;
    return canDistributeMarketingOwnerDept(itemOwnerDept, {
      myUnitName: currentUser.unit?.unit_name,
      myUnitId: currentUser.dept_id || currentUser.unit_id || currentUser.unit?.id,
      myHqName: currentUser.unit?.parent?.unit_name,
      topOrgName,
      units,
      isPower: isLv1,
    });
  };

  /** Catalog 신청가능보기와 동일 스코프만 (종료 제외). 부서 순서는 admin/units(sort_order) = Org → HQ → Center */
  const availableItems = useMemo(() => {
    const deptOrder = new Map<string, number>();
    units.forEach((u: { unit_name?: string | null }, idx: number) => {
      const name = u?.unit_name?.trim();
      if (name && !deptOrder.has(name)) deptOrder.set(name, idx);
    });

    return items
      .filter((item) => !item.is_archived && checkDistributePermission(item.owner_dept))
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
  const totalPrice = selectedItemData ? selectedItemData.unit_price * formData.qty : 0;

  const selectedClientData = useMemo(
    () => clients.find((c) => c.name === formData.client_name),
    [clients, formData.client_name]
  );

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
      // sender_* / email 은 서버 세션으로 기록
    };

    try {
      const res = await fetch('/api/marketing/distributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        alert('✅ 성공적으로 등록되었으며, 재고가 차감되었습니다.');
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

        const searchMatch =
          !searchQuery ||
          d.client_name.includes(searchQuery) ||
          d.item?.name?.includes(searchQuery);

        return yearMatch && monthMatch && ownerMatch && searchMatch;
      })
      // 신청 쌓인 순(최신 createdAt 위) — 순번은 이 순서 기준 reverseNo
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [distributions, selectedYear, selectedMonth, itemOwnerFilter, searchQuery]);

  const totalAmountForYear = useMemo(() => {
    return baseFilteredList.reduce((acc, cur) => acc + (cur.item?.unit_price || 0) * cur.qty, 0);
  }, [baseFilteredList]);

  const totalCountForYear = baseFilteredList.length;

  const clientStats = useMemo(() => {
    const statsMap: Record<string, { price: number; count: number }> = {};
    baseFilteredList.forEach((d) => {
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
    if (!selectedClientFilter) return baseFilteredList;
    return baseFilteredList.filter((d) => d.client_name === selectedClientFilter);
  }, [baseFilteredList, selectedClientFilter]);

  const totalPages = Math.max(1, Math.ceil(finalFilteredList.length / itemsPerPage));
  const paginatedList = finalFilteredList.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedYear, selectedMonth, itemOwnerFilter, searchQuery, selectedClientFilter]);

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
    const targetList =
      selectedIds.size > 0
        ? distributions.filter((d) => selectedIds.has(d.id))
        : finalFilteredList;

    if (targetList.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const exportData = targetList.map((d) => ({
      '지급일자': getKSTDateString(getDistBusinessDate(d) as string),
      '고객사(회사명)': d.client_name,
      '고객사 부서': d.client_dept,
      '물품소속': d.item?.owner_dept || '-',
      '물품명': d.item?.name || '(삭제됨)',
      '단가(원)': d.item?.unit_price,
      '개수': d.qty,
      '총 금액(원)': (d.item?.unit_price || 0) * d.qty,
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

  if (loading) {
    return (
      <div className="p-10 font-black text-center text-indigo-400 animate-pulse mt-20 tracking-widest">
        Syncing Database...
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-bold flex justify-between items-center gap-4">
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

      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[140px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden group">
        <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-3">
              GIFT DISTRIBUTION MANAGEMENT
            </h3>
            <h1 className="text-2xl font-black tracking-tight text-white leading-none flex items-center flex-wrap gap-2.5">
              <span className="bg-white/10 border border-white/20 text-blue-100 px-4 py-2 rounded-2xl text-lg font-black tracking-tight shrink-0 shadow-sm">
                {currentUser?.unit?.unit_name || '조직'}
              </span>
              <span className="text-blue-100 shrink-0">{currentUser?.name || '임직원'} 님</span>
              <span className="text-white">기념품 지급 신청/재고 확보</span>
            </h1>
            <p className="text-blue-200 text-xs font-semibold mt-4 opacity-95">
              보유하고 있는 센터 및 본부 재고 내에서 고객사 대상 기념품 지급을 등록하고 관리합니다.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-500 rounded-[2.5rem] shadow-sm p-6">
        <form onSubmit={handleSubmit} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-indigo-600 uppercase ml-1">물품 선택 *</label>
              <select
                required
                value={formData.item_id}
                onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm cursor-pointer text-slate-700"
              >
                <option value="">카탈로그에서 물품 선택 (신청가능 {availableItems.length}건)</option>
                {availableItems.map((i) => (
                  <option key={i.id} value={i.id} disabled={i.current_stock <= 0}>
                    [{i.owner_dept || '-'}] {i.name}{' '}
                    {i.current_stock <= 0 ? '(품절)' : `(재고 ${i.current_stock}${i.unit || 'EA'})`}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">단가 정보</label>
              <div className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-black text-slate-500 text-center shadow-sm">
                {selectedItemData ? `${selectedItemData.unit_price.toLocaleString()} 원` : '-'}
              </div>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">지급 개수 *</label>
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
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-indigo-400">
                  / {selectedItemData?.current_stock || 0}
                </span>
              </div>
            </div>
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-indigo-500 uppercase ml-1">총 금액 (단가 × 수량)</label>
              <div className="w-full p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs font-mono font-black text-indigo-600 text-right pr-4 shadow-inner">
                {totalPrice > 0 ? `${totalPrice.toLocaleString()} 원` : '-'}
              </div>
            </div>
            <div className="lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">지급 목적 *</label>
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

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            
            {/* 고객사(회사명) - 너비를 4에서 3으로 약간 축소 */}
            <div className="lg:col-span-3 space-y-1 relative">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">고객사(회사명) *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  required
                  value={formData.client_name}
                  className="flex-1 p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold shadow-sm outline-none cursor-pointer text-slate-700"
                  placeholder="검색버튼 클릭"
                  onClick={() => setShowClientModal(true)}
                />
                <button
                  type="button"
                  onClick={() => setShowClientModal(true)}
                  className="px-3 shrink-0 bg-indigo-100 text-indigo-700 font-black text-[10px] rounded-xl border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-colors shadow-sm"
                >
                  검색
                </button>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">고객사 부서명</label>
              <input
                type="text"
                list="dept-list"
                value={formData.client_dept}
                onChange={(e) => setFormData({ ...formData, client_dept: e.target.value })}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500 shadow-sm text-slate-700"
                placeholder="부서 선택 또는 입력"
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

            {/* 🚀 [추가] 재고신청일자 (수정 불가, 오늘 날짜 고정) */}
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">재고신청일(자동)</label>
              <input
                type="text"
                readOnly
                value={todayStr}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-400 shadow-inner outline-none cursor-not-allowed text-center"
              />
            </div>

            {/* 🚀 [수정] 실제 지급일자 (사용자 선택) */}
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] font-black text-indigo-500 uppercase ml-1">실제 지급일자 *</label>
              <input
                type="date"
                required
                value={formData.dist_date}
                onChange={(e) => setFormData({ ...formData, dist_date: e.target.value })}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 shadow-sm outline-none focus:ring-2 ring-indigo-500"
              />
            </div>

            <div className="lg:col-span-2">
              <button
                type="submit"
                className="w-full p-2.5 bg-slate-900 text-white rounded-xl font-black text-[11px] shadow-md hover:bg-indigo-600 active:scale-95 transition-all h-10"
              >
                신청 등록하기
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <HeaderLight title="나의 지급 이력 대장" count={finalFilteredList.length}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
              <span>🗓️ 연도:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="outline-none bg-transparent cursor-pointer font-black"
              >
                <option value="ALL">전체 내역 보기</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}년도
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
              <span>📅 월:</span>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                <option value="ALL">전체 월</option>
                {Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
              <span>🏢 물품소속:</span>
              <select
                value={itemOwnerFilter}
                onChange={(e) => setItemOwnerFilter(e.target.value)}
                className="outline-none bg-transparent cursor-pointer font-black"
              >
                <option value="ALL">전체 보기</option>
                {availableItemOwners.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleDownloadExcel}
              className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1 outline-none hover:bg-slate-50 transition-colors shadow-sm text-slate-700"
            >
              {selectedIds.size > 0
                ? `선택 엑셀 다운로드 (${selectedIds.size})`
                : '화면 목록 엑셀 다운로드'}
            </button>

            <div className="relative w-40">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px]">🔍</span>
              <input
                type="text"
                placeholder="물품, 고객사 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-6 pr-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-indigo-500 transition-all shadow-inner"
              />
            </div>
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
              고객사별 지급 비율 요약 (클릭하여 해당 내역만 필터링)
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
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-16 text-center text-slate-400">
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                paginatedList.map((d, idx) => {
                  const isSelected = selectedIds.has(d.id);
                  // 🚀 날짜 데이터 2개로 분리 (생성일 / 실제지급일)
                  const reqDate = getKSTDateString(d.createdAt);
                  const distDate = getKSTDateString(d.dist_date || d.createdAt);
                  
                  const reverseNo = finalFilteredList.length - ((currentPage - 1) * itemsPerPage + idx);
                  const canCancel = true; // 본인 지급 이력 화면이므로 철회 가능

                  return (
                    <tr
                      key={d.id}
                      className={`transition-colors h-14 ${
                        isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50/50'
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
                      <td className="px-2 text-center text-slate-800 font-black">{reverseNo}</td>
                      <td className="px-2 text-center font-mono text-slate-800 text-[11px] whitespace-nowrap">{reqDate}</td>
                      <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">{distDate}</td>
                      <td className="px-2 font-black text-slate-800 text-[12px] truncate max-w-[112px]">
                        {d.client_name}
                      </td>
                      <td className="px-2 text-slate-800 truncate max-w-[96px]">
                        {d.client_dept || '-'}
                      </td>
                      <td className="px-2 text-center">
                        <span className="bg-slate-100 text-slate-800 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-black whitespace-nowrap">
                          {d.item?.owner_dept || '-'}
                        </span>
                      </td>
                      <td className="px-2 text-indigo-700 text-[12px] font-black truncate max-w-[144px]">
                        {d.item?.name || '(삭제됨)'}
                      </td>
                      <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">
                        {d.item?.unit_price?.toLocaleString()}
                      </td>
                      <td className="px-2 text-center font-mono text-slate-800 whitespace-nowrap">
                        {d.qty}
                        <span className="text-[9px] text-slate-800 font-sans ml-0.5">{d.item?.unit || 'EA'}</span>
                      </td>
                      <td className="px-2 text-center font-mono font-black text-indigo-600 whitespace-nowrap">
                        {((d.item?.unit_price || 0) * d.qty).toLocaleString()}
                      </td>
                      <td className="px-2 text-slate-800 truncate max-w-[112px]" title={d.purpose}>
                        {d.purpose}
                      </td>
                      <td className="px-2 text-center text-slate-800">
                        <div className="flex flex-col items-center justify-center leading-tight min-w-[7rem]">
                          <span className="text-[11px] font-bold truncate max-w-[120px]" title={d.sender_name || ''}>
                            {d.sender_name || '-'}
                          </span>
                          <span className="text-[9px] text-slate-800 truncate max-w-[120px]" title={d.sender_dept || ''}>
                            ({d.sender_dept || '-'})
                          </span>
                        </div>
                      </td>

                      {/* 🚀 복사 & 철회 듀얼 버튼 */}
                      <td className="pr-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                        <button
  onClick={() => {
    const giftName = d.item?.name || "기념품명";
    const purpose = d.purpose || "지급 목적";
    const date = distDate;
    
    // 🚀 회사명 + 부서명 + (성함/직급 입력 가이드) 조합
    const clientDeptStr = d.client_dept ? ` ${d.client_dept}` : '';
    const clientInfo = `${d.client_name}${clientDeptStr} (성함 직급)`; 
    // 만약 (OOO)로 깔끔하게 가고 싶다면 위 줄을 `${d.client_name}${clientDeptStr} (OOO)`; 로 변경하시면 됩니다.

    const qty = d.qty || 1;

    // 결재 태우기용 텍스트 양식
    const textToCopy = `[선물명] ${giftName}\n[지급목적] ${purpose}\n[지급일자] ${date}\n[업체명] ${clientInfo}\n[신청개수] ${qty}개`;

    navigator.clipboard.writeText(textToCopy).then(() => {
      alert('✅ 결재용 텍스트가 복사되었습니다!\n\n업체명의 (성함 직급) 부분을 실제 담당자 정보로 수정 후 결재를 올리세요.');
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
                              onClick={() => handleDelete(d.id)}
                              className="flex-1 py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap"
                            >
                              철회
                            </button>
                          ) : (
                            <span className="flex-1 text-[10px] text-slate-300 font-bold">-</span>
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

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
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
          onClick={() => setShowClientModal(false)}
        >
          <div
            className="bg-white w-[800px] p-8 rounded-[2.5rem] shadow-2xl flex flex-col border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b pb-4 mb-5">
              <h3 className="font-black text-lg text-slate-800 flex items-center gap-2">
                <span>🏢</span> 고객사 마스터 검색
              </h3>
              <button
                onClick={() => setShowClientModal(false)}
                className="text-2xl text-slate-400 hover:text-slate-700 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="relative mb-5">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
                🔍
              </span>
              <input
                type="text"
                placeholder="회사명 검색..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white shadow-inner"
              />
            </div>
            <div className="flex-1 overflow-y-auto max-h-72 border border-slate-200 rounded-xl bg-white mb-6">
              <table className="w-full text-left table-fixed">
                <thead className="bg-slate-100 text-[10px] text-slate-500 font-black uppercase tracking-widest sticky top-0 shadow-sm">
                  <tr>
                    <th className="p-3 pl-5 w-[45%]">고객사 (회사명)</th>
                    <th className="p-3 w-[20%] text-center">업무범주</th>
                    <th className="p-3 w-[35%]">소재지 주소</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700">
                  {clients.filter((c) => !c.is_archived && c.name.includes(clientSearch)).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center py-12 text-slate-400 text-xs font-bold">
                        검색된 고객사가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    clients
                      .filter((c) => !c.is_archived && c.name.includes(clientSearch))
                      .map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              client_name: c.name,
                              client_dept: '',
                            }));
                            setShowClientModal(false);
                          }}
                          className="cursor-pointer hover:bg-indigo-50/50 transition-colors h-12"
                        >
                          <td className="p-3 pl-5 font-black text-slate-800 text-[13px] truncate">
                            {c.name}
                          </td>
                          <td className="p-3 text-center text-indigo-600 font-black text-[11px] truncate">
                            {c.category || '-'}
                          </td>
                          <td className="p-3 text-slate-500 font-medium text-[11px] truncate">
                            {c.location || '소재지 미상'}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 flex flex-col items-center">
              <p className="text-[13px] font-black text-indigo-900 mb-3">
                검색되지 않을 경우, 고객사 마스터를 먼저 등록해 주세요.
              </p>
              <button
                onClick={() => {
                  setShowClientModal(false);
                  router.push('/marketing/distribution/client-search');
                }}
                className="px-8 py-3.5 bg-indigo-600 text-white rounded-xl text-xs font-black shadow-lg hover:bg-indigo-700 flex items-center gap-2 transition-all active:scale-95"
              >
                <span>📝</span> 고객사 마스터 등록 페이지로 이동
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RegisterModule() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">
          Loading Application Environment...
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  );
}