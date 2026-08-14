'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import LoadingState from '@/components/common/LoadingState';
import ItMasterPageBanner from '@/components/asset/it/ItMasterPageBanner';

const MENU_PATH = '/asset/it/master/archive';

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

const HISTORY_MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function MasterArchiveContent() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [filterDept, setFilterDept] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | '반납' | '폐기' | '재판매'>('ALL');
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [codeQuery, setCodeQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const formatNumber = (val: any) => val?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') || '0';

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [filterDept, filterType, filterStatus, selectedYear, selectedMonth, codeQuery, modelQuery]);

  const fetchArchiveData = async () => {
    try {
      const res = await fetch(`/api/asset/it/archive?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        data.sort(
          (a: any, b: any) =>
            new Date(b.terminated_at || 0).getTime() - new Date(a.terminated_at || 0).getTime()
        );
        setHistory(data);
      }
    } catch (e) {
      console.error('Archive fetch error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const ts = Date.now();
        const [userRes, ifRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (userRes.ok) {
          const userData = await userRes.json();
          const roles = Array.isArray(userData.roles)
            ? userData.roles
            : (() => {
                try {
                  return JSON.parse(userData.roles || '[]');
                } catch {
                  return [];
                }
              })();
          setCurrentUser({
            ...userData,
            name: String(userData.name || '').trim(),
            dept: String(userData.unit?.unit_name || userData.dept || '').trim(),
            roles,
          });
        }
        if (ifRes && ifRes.ok) {
          const interfaces = await ifRes.json();
          const menu = Array.isArray(interfaces)
            ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/it/master/archive'))
            : null;
          setInterfaceConfig(menu || null);
        } else {
          setInterfaceConfig(null);
        }
      } catch (e) {
        console.error('User fetch error', e);
      }
      await fetchArchiveData();
    };
    init();
  }, []);

  const isLV1 = useMemo(() => !!currentUser?.roles?.includes('LV_1'), [currentUser]);
  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  const availableYears = useMemo(() => {
    const years = history
      .map((h) => getKSTYearMonthParts(h.terminated_at)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique.sort((a, b) => b.localeCompare(a));
  }, [history]);

  const uniqueDepts = useMemo(
    () =>
      Array.from(new Set(history.map((h) => String(h.dept || '').trim() || '-')))
        .sort((a, b) => String(a).localeCompare(String(b), 'ko')),
    [history]
  );

  const uniqueTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    history.forEach((h) => {
      const key = String(h.it_type || '').trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
  }, [history]);

  const filteredHistory = useMemo(() => {
    const codeQ = codeQuery.toLowerCase().trim();
    const modelQ = modelQuery.toLowerCase().trim();
    return history.filter((h) => {
      const ym = getKSTYearMonthParts(h.terminated_at);
      const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      const matchStatus = filterStatus === 'ALL' || h.status === filterStatus;
      const rDept = String(h.dept || '').trim() || '-';
      const matchDept = filterDept === 'ALL' || rDept === filterDept;
      const rType = h.it_type || '일반';
      const matchType = filterType === 'ALL' || rType === filterType;
      const matchCode = !codeQ || String(h.code || '').toLowerCase().includes(codeQ);
      const matchModel = !modelQ || String(h.model || '').toLowerCase().includes(modelQ);
      return matchYear && matchMonth && matchStatus && matchDept && matchType && matchCode && matchModel;
    });
  }, [history, selectedYear, selectedMonth, filterStatus, filterDept, filterType, codeQuery, modelQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const currentData = filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleSelectAllFiltered = () => {
    const allIds = filteredHistory.map((h) => h.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  };

  const allFilteredSelected =
    filteredHistory.length > 0 && filteredHistory.every((h) => selectedIds.has(h.id));

  const handleRestore = async (id: string) => {
    if (!canEdit) return alert('편집 권한이 없습니다.');
    if (!confirm('해당 자산을 운영 대장(Active) 리스트로 복구하시겠습니까?')) return;
    const target = history.find((h) => h.id === id);
    if (!target) return;

    try {
      const {
        terminated_at: _t,
        reason: _r,
        reseller: _rs,
        resellPrice: _rp,
        status: _s,
        createdAt: _c,
        updatedAt: _u,
        id: archiveId,
        ...restoreData
      } = target;

      const response = await fetch(`/api/asset/it`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...restoreData, is_active: true }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const msg = err.message || '서버 오류';
        if (
          confirm(
            `❌ 운영 대장 복구 실패: ${msg}\n\n이미 대시보드에 동일 자산이 있다면, 아카이브에 남은 이력만 삭제할까요?`
          )
        ) {
          const delOnly = await fetch(`/api/asset/it/archive?id=${encodeURIComponent(archiveId)}`, {
            method: 'DELETE',
          });
          if (delOnly.ok) {
            alert('✅ 아카이브 이력을 삭제했습니다.');
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(archiveId);
              return next;
            });
            fetchArchiveData();
          } else {
            alert('❌ 아카이브 이력 삭제에 실패했습니다.');
          }
        }
        return;
      }

      // 운영 대장 복구 후 아카이브 이력 제거 (종료 이관의 역순)
      const delRes = await fetch(`/api/asset/it/archive?id=${encodeURIComponent(archiveId)}`, {
        method: 'DELETE',
      });
      if (!delRes.ok) {
        alert('✅ 운영 대장에는 복구되었으나, 아카이브 이력 삭제에 실패했습니다. 새로고침 후 다시 확인해 주세요.');
        fetchArchiveData();
        return;
      }

      alert('✅ 성공적으로 마스터 운영 대장(DB)으로 복구되었습니다. 대시보드에서 확인하실 수 있습니다.');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(archiveId);
        return next;
      });
      fetchArchiveData();
    } catch (error) {
      console.error('Restore Error:', error);
      alert('❌ 서버 통신 중 오류가 발생했습니다.');
    }
  };

  const handleDeleteSelected = async () => {
    if (!isLV1) return alert('❌ 삭제 권한이 거부되었습니다. (LV_1 전용)');
    if (selectedIds.size === 0) {
      return alert('삭제할 항목을 체크박스로 선택해 주세요.');
    }
    if (!confirm(`선택한 아카이브 기록 ${selectedIds.size}건을 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
      const ids = Array.from(selectedIds);
      const res = await fetch(`/api/asset/it/archive?ids=${ids.map(encodeURIComponent).join(',')}`, { method: 'DELETE' });
      if (res.ok) {
        alert(`✅ ${ids.length}건이 영구 삭제되었습니다.`);
        setSelectedIds(new Set());
        fetchArchiveData();
      } else {
        alert('❌ 서버 삭제 처리에 실패했습니다.');
      }
    } catch {
      alert('❌ 서버 통신 중 오류가 발생했습니다.');
    }
  };

  const handleExportExcel = () => {
    const targets =
      selectedIds.size > 0 ? filteredHistory.filter((h) => selectedIds.has(h.id)) : filteredHistory;
    if (targets.length === 0) return alert('데이터가 없습니다.');
    const exportData = targets.map((h, idx) => ({
      NO: targets.length - idx,
      종료처리일자: h.terminated_at || '-',
      '부서/사용자': `${h.dept || '-'} / ${h.user || '공용'}`,
      자산분류: h.it_type,
      자산번호: h.code,
      모델명: h.model,
      'S/N': h.sn || '-',
      종료사유: h.reason || '-',
      '반납처/매각처': h.reseller || '-',
      '매각금액(원)': h.resellPrice || 0,
      상태: h.status,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Archive');
    XLSX.writeFile(
      wb,
      `IT_종료자산대장_${selectedYear === 'ALL' ? '전체' : selectedYear}_${getKSTDateString()}.xlsx`
    );
  };

  if (loading) return <LoadingState />;

  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      <ItMasterPageBanner
        label="TERMINATED ASSET ARCHIVE"
        title="종료 자산 아카이브 관리"
        description="종료처리된 IT·업무자산의 영구 이력 및 매각 관리"
        menuPath="/asset/it/master/archive"
        canEdit={canEdit}
      />

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        <div className="p-3 px-4 bg-slate-200/70 border-b border-slate-300 flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight whitespace-nowrap">종료 자산 데이터 대장</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-1.5 py-0.5 rounded-md whitespace-nowrap">
              {filteredHistory.length}건
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto min-w-0 ml-auto scrollbar-hide">
            <div className="flex items-center gap-0.5 bg-white p-0.5 rounded-lg border border-slate-200 shadow-sm shrink-0">
              <button
                type="button"
                onClick={() => setFilterStatus('ALL')}
                className={`px-2 py-1 rounded-md text-[10px] font-black transition-all whitespace-nowrap ${
                  filterStatus === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                전체
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('반납')}
                className={`px-2 py-1 rounded-md text-[10px] font-black transition-all whitespace-nowrap ${
                  filterStatus === '반납' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                반납
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('폐기')}
                className={`px-2 py-1 rounded-md text-[10px] font-black transition-all whitespace-nowrap ${
                  filterStatus === '폐기' ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                폐기
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('재판매')}
                className={`px-2 py-1 rounded-md text-[10px] font-black transition-all whitespace-nowrap ${
                  filterStatus === '재판매' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                매각
              </button>
            </div>

            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">조직</span>
              <select
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[88px]"
              >
                <option value="ALL">전체</option>
                {uniqueDepts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300" />

              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">분류</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[88px]"
              >
                <option value="ALL">전체</option>
                {uniqueTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300" />

              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">연도</span>
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

              <div className="w-px h-3.5 bg-slate-300" />

              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">월</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {HISTORY_MONTHS.map((month) => (
                  <option key={month} value={month}>{month}월</option>
                ))}
              </select>
            </div>

            <div className="relative w-28 shrink-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔢</span>
              <input
                type="text"
                placeholder="자산번호"
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                className="w-full pl-6 pr-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
            <div className="relative w-28 shrink-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">💻</span>
              <input
                type="text"
                placeholder="모델명"
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                className="w-full pl-6 pr-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-2 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap shrink-0"
            >
              {selectedIds.size > 0 ? `EXCEL(${selectedIds.size})` : 'EXCEL'}
            </button>
            {isLV1 && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="px-2 py-1 bg-white text-rose-600 border border-rose-200 rounded-lg text-[10px] font-black shadow-sm hover:bg-rose-50 transition-all whitespace-nowrap shrink-0"
              >
                {selectedIds.size > 0 ? `삭제(LV_1)(${selectedIds.size})` : '삭제(LV_1)'}
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1380px]">
            <colgroup>
              <col className="w-[44px]" />
              <col className="w-[48px]" />
              <col className="w-[100px]" />
              <col className="w-[120px]" />
              <col className="w-[100px]" />
              <col className="w-[120px]" />
              <col className="w-[140px]" />
              <col className="w-[120px]" />
              <col className="w-[160px]" />
              <col className="w-[110px]" />
              <col className="w-[100px]" />
              <col className="w-[72px]" />
              <col className="w-[110px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 px-2 text-center">
                  <input
                    type="checkbox"
                    title={`필터된 전체 ${filteredHistory.length}건 선택/해제`}
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    className="w-3.5 h-3.5 cursor-pointer appearance-none rounded-[3px] border-2 border-indigo-600 bg-white checked:bg-indigo-600 checked:border-indigo-600 relative
                      after:content-[''] after:absolute after:hidden checked:after:block
                      after:left-[3px] after:top-[0px] after:w-[4px] after:h-[8px]
                      after:border-white after:border-r-2 after:border-b-2 after:rotate-45"
                  />
                </th>
                <th className="h-12 px-2 text-center">NO</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">종료처리일자</th>
                <th className="h-12 px-2 whitespace-nowrap">부서/사용자</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">자산 분류</th>
                <th className="h-12 px-2">자산번호</th>
                <th className="h-12 px-2">모델명</th>
                <th className="h-12 px-2">S/N</th>
                <th className="h-12 px-2 border-l border-slate-200">종료사유</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">반납처/매각처</th>
                <th className="h-12 px-2 text-right whitespace-nowrap">매각금액</th>
                <th className="h-12 px-2 text-center">상태</th>
                <th className="h-12 px-2 text-center whitespace-nowrap border-l border-slate-200">관리 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {currentData.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-16 text-center text-slate-400 text-xs">
                    조건에 맞는 종료 이력이 없습니다.
                  </td>
                </tr>
              ) : (
                currentData.map((h, i) => {
                  const rowNo = filteredHistory.length - ((currentPage - 1) * itemsPerPage + i);
                  const terminatedAt =
                    (h.terminated_at && String(h.terminated_at).substring(0, 10)) ||
                    getKSTDateString(h.terminated_at) ||
                    '-';

                  return (
                    <tr
                      key={h.id}
                      className={`hover:bg-slate-50/50 h-12 transition-colors ${selectedIds.has(h.id) ? 'bg-slate-50' : ''}`}
                    >
                      <td className="px-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(h.id)}
                          onChange={() => {
                            const next = new Set(selectedIds);
                            next.has(h.id) ? next.delete(h.id) : next.add(h.id);
                            setSelectedIds(next);
                          }}
                          className="accent-slate-800"
                        />
                      </td>
                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">{terminatedAt}</td>
                      <td className="px-2">
                        <div className="leading-tight min-w-0" title={`${h.dept || '-'} / ${h.user || '공용'}`}>
                          <p className="text-slate-900 truncate">{h.dept || '-'}</p>
                          <p className="text-slate-900 truncate text-[10px]">{h.user || '공용'}</p>
                        </div>
                      </td>
                      <td className="px-2 text-center">
                        <span className="text-[9px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md whitespace-nowrap">
                          {h.it_type || '일반'}
                        </span>
                      </td>
                      <td className="px-2 text-slate-900 truncate" title={h.code || ''}>{h.code || '-'}</td>
                      <td className="px-2 text-slate-800 truncate" title={h.model || ''}>{h.model || '-'}</td>
                      <td className="px-2 text-slate-500 font-mono truncate" title={h.sn || ''}>{h.sn || '-'}</td>
                      <td className="px-2 border-l border-slate-200 text-slate-700 truncate" title={h.reason || ''}>
                        {h.reason ? `"${h.reason}"` : '-'}
                      </td>
                      <td className="px-2 text-center text-slate-800 truncate" title={h.reseller || ''}>
                        {h.reseller || <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums text-slate-800">
                        {h.resellPrice ? formatNumber(h.resellPrice) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-2 text-center">
                        <span
                          className={`inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                            h.status === '폐기'
                              ? 'bg-rose-50 text-rose-600 border-rose-200'
                              : h.status === '재판매'
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                                : 'bg-orange-50 text-orange-600 border-orange-200'
                          }`}
                        >
                          {h.status === '재판매' ? '매각' : h.status || '-'}
                        </span>
                      </td>
                      <td className="px-2 text-center border-l border-slate-200">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => handleRestore(h.id)}
                          title={canEdit ? '운영 대장으로 복구' : '편집 권한 필요'}
                          className={`px-1.5 py-1.5 rounded-md text-[10px] font-black whitespace-nowrap border ${
                            canEdit
                              ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100 shadow-sm'
                              : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
                          }`}
                        >
                          복구
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredHistory.length > 0 && (
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
    </div>
  );
}

export default function MasterArchiveModule() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MasterArchiveContent />
    </Suspense>
  );
}
