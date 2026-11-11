'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
import CorpCardScaffold from '@/components/asset/corp-card/CorpCardScaffold';
import { CORP_CARD_MASTER_TABS } from '@/lib/interface-step-tabs';
import { getKSTDateString } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
import DeptAssigneeLine, { useDeptAssignees } from '@/components/common/DeptAssigneeLine';

const API_PATH = '/api/asset/corp-card/master/registry';
const MENU_PATH = '/asset/corp-card/master/registry';
const DISABLED_BTN =
  'text-[9px] font-medium px-2 py-1 rounded-md border whitespace-nowrap bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70';
const ACTION_BTN =
  'text-[9px] font-medium px-2 py-1 rounded-md border whitespace-nowrap bg-white text-slate-600 border-slate-200 hover:border-sky-300';

const CARD_ISSUERS = [
  '신한',
  '삼성',
  '현대',
  'KB국민',
  '우리',
  '하나',
  'NH농협',
  '롯데',
  'BC',
  '기업',
] as const;

type OrgUnitItem = {
  id: string;
  unit_name: string;
  parent_id?: string | null;
  sort_order?: number;
  unit_type?: string | null;
};

type ChartOrgMode = 'DEPT' | 'CENTER' | 'HQ';

type CorpCardItem = {
  id: string;
  name: string;
  issuer: string;
  last4: string;
  unitId: string;
  unitName: string;
  status: 'ACTIVE' | 'SUSPENDED' | string;
  memo: string;
  hasUsage?: boolean;
  createdAt: string;
};

type EditDraft = {
  name: string;
  issuer: string;
  last4: string;
  unitId: string;
  status: 'ACTIVE' | 'SUSPENDED';
  memo: string;
};

function normalizeOrgUnitType(unitType?: string | null) {
  return String(unitType || '').trim().toUpperCase();
}

function isExecutiveOrgName(name?: string | null) {
  return /원장|부원장|상무/.test(String(name || ''));
}

function sortUnitsByOrder(units: OrgUnitItem[]) {
  return [...units].sort((a, b) => {
    const ao = Number(a.sort_order) || 0;
    const bo = Number(b.sort_order) || 0;
    if (ao !== bo) return ao - bo;
    return String(a.unit_name || '').localeCompare(String(b.unit_name || ''), 'ko');
  });
}

function collectDescendantUnitIds(rootId: string, units: OrgUnitItem[]) {
  const ids = new Set<string>();
  const walk = (parentId: string) => {
    for (const child of units.filter((u) => u.parent_id === parentId)) {
      ids.add(child.id);
      walk(child.id);
    }
  };
  walk(rootId);
  return ids;
}

function flattenUnitsInApiOrder(units: OrgUnitItem[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depthOf = (unit: OrgUnitItem) => {
    let depth = 0;
    let current: OrgUnitItem | undefined = unit;
    const seen = new Set<string>();
    while (current?.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parent_id);
    }
    return depth;
  };
  return units.map((unit) => ({ ...unit, depth: depthOf(unit) }));
}

function statusLabel(status: string) {
  return status === 'SUSPENDED' ? '정지' : '활성화';
}

const IDENTITY_HINT = '사용자 신청 이력이 발생하면 정보를 변경할 수 없습니다.';

function ColumnHint() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);

  const show = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    setOpen(true);
  };

  return (
    <span className="relative inline-flex items-center align-middle">
      <button
        ref={btnRef}
        type="button"
        className="normal-case tracking-normal text-[11px] font-medium text-slate-400 hover:text-sky-600 leading-none px-0.5"
        aria-label={IDENTITY_HINT}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
      >
        ⓘ
      </button>
      {open ? (
        <span
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-[80] -translate-x-1/2 w-max max-w-[220px] rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-[10px] font-medium leading-snug text-white normal-case tracking-normal shadow-lg"
        >
          {IDENTITY_HINT}
        </span>
      ) : null}
    </span>
  );
}

async function readApiError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

function UnitSelect({
  value,
  onChange,
  units,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  units: { id: string; unit_name: string; depth: number }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ||
        'w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none focus:border-sky-500'
      }
    >
      <option value="">부서 선택</option>
      {units.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {`${'\u00A0'.repeat(unit.depth * 2)}${unit.unit_name}`}
        </option>
      ))}
    </select>
  );
}

function RegistryPanel() {
  const { editorNames } = useDeptAssignees(MENU_PATH);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [items, setItems] = useState<CorpCardItem[]>([]);
  const [units, setUnits] = useState<OrgUnitItem[]>([]);
  const [newName, setNewName] = useState('');
  const [newIssuer, setNewIssuer] = useState('');
  const [newLast4, setNewLast4] = useState('');
  const [newUnitId, setNewUnitId] = useState('');
  const [newStatus, setNewStatus] = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [chartOrgMode, setChartOrgMode] = useState<ChartOrgMode>('DEPT');
  const [listUnitId, setListUnitId] = useState('');
  const [last4Query, setLast4Query] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const unitOptions = useMemo(() => flattenUnitsInApiOrder(units), [units]);

  const chartRows = useMemo(() => {
    const countByUnitId = new Map<string, number>();
    items.forEach((card) => {
      if (card.status === 'SUSPENDED') return;
      const uid = String(card.unitId || '').trim();
      if (!uid) return;
      countByUnitId.set(uid, (countByUnitId.get(uid) || 0) + 1);
    });

    const axisUnits = sortUnitsByOrder(
      units.filter((u) => {
        if (isExecutiveOrgName(u.unit_name)) return false;
        const t = normalizeOrgUnitType(u.unit_type);
        if (t === 'ORGANIZATION') return false;
        if (chartOrgMode === 'CENTER') return t === 'CENTER';
        if (chartOrgMode === 'HQ') return t === 'HQ';
        return true;
      })
    );

    return axisUnits.map((unit) => {
      const name = String(unit.unit_name || '').trim() || '(이름없음)';
      let qty = 0;
      if (chartOrgMode === 'DEPT') {
        qty = countByUnitId.get(unit.id) || 0;
      } else {
        const ids = collectDescendantUnitIds(unit.id, units);
        ids.add(unit.id);
        for (const id of ids) qty += countByUnitId.get(id) || 0;
      }
      return {
        name,
        qty,
        unitId: unit.id,
        hasQty: qty > 0,
        isSelected: listUnitId === unit.id,
      };
    });
  }, [items, units, chartOrgMode, listUnitId]);

  const chartHeight = 180;
  const chartMinWidth = Math.max(560, chartRows.length * 52);

  const scopedItems = useMemo(() => {
    const q = last4Query.trim();
    return items.filter((card) => {
      if (q && !String(card.last4 || '').includes(q)) return false;
      if (!listUnitId) return true;
      const ids = collectDescendantUnitIds(listUnitId, units);
      ids.add(listUnitId);
      return ids.has(card.unitId);
    });
  }, [items, listUnitId, last4Query, units]);

  const countActive = scopedItems.filter((card) => card.status !== 'SUSPENDED').length;
  const countInactive = scopedItems.filter((card) => card.status === 'SUSPENDED').length;

  const filteredItems = useMemo(() => {
    if (statusFilter === 'ALL') return scopedItems;
    if (statusFilter === 'SUSPENDED') {
      return scopedItems.filter((card) => card.status === 'SUSPENDED');
    }
    return scopedItems.filter((card) => card.status !== 'SUSPENDED');
  }, [scopedItems, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));
  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [listUnitId, last4Query, statusFilter, items.length]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const load = async () => {
    setLoadError(null);
    try {
      const ts = Date.now();
      const [cardRes, unitRes] = await Promise.all([
        fetch(`${API_PATH}?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
      ]);
      if (cardRes.ok) {
        const data = await cardRes.json();
        setItems(Array.isArray(data.items) ? data.items : []);
        setCanEdit(Boolean(data.canEdit));
      } else {
        setItems([]);
        setLoadError(await readApiError(cardRes, '카드 대장을 불러오지 못했습니다.'));
      }
      if (unitRes.ok) {
        const rows = await unitRes.json();
        setUnits(Array.isArray(rows) ? rows : []);
      }
    } catch {
      setLoadError('네트워크 오류로 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const alertNoEdit = () => alert('편집 권한이 없습니다.');

  const handleCreate = async () => {
    if (!canEdit) return alertNoEdit();
    const name = newName.trim();
    const issuer = newIssuer.trim();
    const last4 = newLast4.replace(/\s+/g, '').slice(0, 4);
    if (!name) return alert('카드관리명을 입력해 주세요.');
    if (!issuer) return alert('카드사를 선택해 주세요.');
    if (last4.length !== 4) return alert('카드번호 끝 4자리를 입력해 주세요.');
    if (!newUnitId) return alert('할당부서를 선택해 주세요.');
    setSaving(true);
    try {
      const res = await fetch(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, issuer, last4, unitId: newUnitId, status: newStatus }),
      });
      if (!res.ok) {
        alert(await readApiError(res, '등록에 실패했습니다.'));
        return;
      }
      setNewName('');
      setNewIssuer('');
      setNewLast4('');
      setNewUnitId('');
      setNewStatus('ACTIVE');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: CorpCardItem) => {
    if (!canEdit) return alertNoEdit();
    setEditingId(row.id);
    setDraft({
      name: row.name || '',
      issuer: row.issuer || '',
      last4: row.last4 || '',
      unitId: row.unitId,
      status: row.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      memo: row.memo || '',
    });
  };

  const handleSave = async (id: string) => {
    if (!canEdit) return alertNoEdit();
    if (!draft?.unitId) return alert('할당부서를 선택해 주세요.');
    const name = draft.name.trim();
    if (!name) return alert('카드관리명을 입력해 주세요.');
    const editingRow = items.find((row) => row.id === id);
    const canEditIdentity = !editingRow?.hasUsage;
    const issuer = draft.issuer.trim();
    const last4 = draft.last4.replace(/\s+/g, '').slice(0, 4);
    if (canEditIdentity) {
      if (!issuer) return alert('카드사를 선택해 주세요.');
      if (last4.length !== 4) return alert('카드번호 끝 4자리를 입력해 주세요.');
    }
    setSaving(true);
    try {
      const res = await fetch(API_PATH, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          unitId: draft.unitId,
          status: draft.status,
          memo: draft.memo,
          ...(canEditIdentity ? { issuer, last4 } : {}),
        }),
      });
      if (!res.ok) {
        alert(await readApiError(res, '수정에 실패했습니다.'));
        return;
      }
      setEditingId(null);
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: CorpCardItem) => {
    if (!canEdit) return alertNoEdit();
    if (!confirm(`「${row.name}」 카드를 삭제할까요?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_PATH}?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        alert(await readApiError(res, '삭제에 실패했습니다.'));
        return;
      }
      if (editingId === row.id) {
        setEditingId(null);
        setDraft(null);
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleExportExcel = () => {
    if (filteredItems.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = filteredItems.map((row, idx) => ({
      NO: filteredItems.length - idx,
      카드관리명: row.name || '',
      카드사: row.issuer || '',
      카드번호: row.last4 || '',
      할당부서: row.unitName || '',
      상태: statusLabel(row.status),
      등록일자: row.createdAt ? getKSTDateString(row.createdAt) || '' : '',
      관리메모: row.memo || '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) continue;
        ws[addr].s = {
          alignment: { horizontal: 'center', vertical: 'center' },
        };
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '등록된카드');
    const unitName = listUnitId
      ? units.find((u) => u.id === listUnitId)?.unit_name || ''
      : '';
    const deptStr = unitName ? `_${unitName}` : '';
    const last4Safe = last4Query.trim().replace(/[\\/:*?"<>|]/g, '_');
    const last4Str = last4Safe ? `_끝자리${last4Safe}` : '';
    XLSX.writeFile(wb, `법인카드_대장${deptStr}${last4Str}_${getKSTDateString()}.xlsx`);
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {loadError ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-medium">
          ⚠️ {loadError}
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden">
        <div className="px-3 py-1.5 bg-slate-100/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
            <h2 className="text-[11px] font-medium text-slate-800 tracking-tight">
              📊{' '}
              {chartOrgMode === 'HQ' ? '본부별' : chartOrgMode === 'CENTER' ? '센터별' : '부서별'}{' '}
              할당 카드
              <span className="ml-2 text-[9px] font-medium text-slate-500">
                활성화 카드만 집계
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
              {([
                { id: 'DEPT', label: '부서별조회' },
                { id: 'CENTER', label: '센터별조회' },
                { id: 'HQ', label: '본부별조회' },
              ] as const).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setChartOrgMode(mode.id);
                    setListUnitId('');
                  }}
                  className={`px-2 py-1 rounded-md text-[9px] font-medium transition-colors ${
                    chartOrgMode === mode.id
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <span className="text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded-md">
              총 {items.length.toLocaleString()}장
            </span>
            {listUnitId ? (
              <button
                type="button"
                onClick={() => setListUnitId('')}
                className="text-[9px] font-medium text-slate-500 hover:text-sky-600 underline"
              >
                조직 필터 해제
              </button>
            ) : null}
          </div>
        </div>
        <div className="px-2 py-1">
          {chartRows.length === 0 ? (
            <div className="h-[72px] flex items-center justify-center border border-dashed border-slate-200 bg-slate-50/60">
              <p className="text-[10px] font-medium text-slate-400">
                admin/units에{' '}
                {chartOrgMode === 'HQ' ? 'HQ(본부)' : chartOrgMode === 'CENTER' ? 'CENTER' : '부서'}{' '}
                조직이 없습니다.
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
                      cursor={{ fill: 'rgba(14, 165, 233, 0.06)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as {
                          name: string;
                          qty: number;
                          hasQty: boolean;
                        };
                        return (
                          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-md">
                            <p className="text-[10px] font-medium text-slate-800">{row.name}</p>
                            <p className="text-[10px] font-medium text-sky-600 mt-0.5">
                              {row.hasQty ? `${row.qty.toLocaleString()}장` : '미할당'}
                            </p>
                            <p className="text-[9px] font-medium text-slate-400 mt-0.5">
                              클릭하면 목록 조직 필터
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
                        const unitId = data?.unitId || data?.payload?.unitId;
                        if (!unitId) return;
                        setListUnitId((prev) => (prev === unitId ? '' : unitId));
                      }}
                    >
                      {chartRows.map((row) => (
                        <Cell
                          key={row.unitId}
                          fill={
                            row.isSelected ? '#0284c7' : row.hasQty ? '#38bdf8' : '#e2e8f0'
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

      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-600" />
            <h2 className="text-sm font-medium text-slate-800 tracking-tight">신규 카드 등록</h2>
          </div>
        </div>
        <div className="p-5 md:p-6">
          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_0.7fr_0.7fr_1.1fr_0.6fr_auto] gap-3 items-end">
            <div>
              <label className="text-[10px] font-medium text-slate-400 block mb-1">카드관리명</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="예: 경영기획 법인카드"
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 block mb-1">카드사</label>
              <select
                value={newIssuer}
                onChange={(e) => setNewIssuer(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-sky-500"
              >
                <option value="">카드사 선택</option>
                {CARD_ISSUERS.map((issuer) => (
                  <option key={issuer} value={issuer}>
                    {issuer}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 block mb-1">카드번호 (끝 4자리)</label>
              <input
                type="text"
                maxLength={4}
                value={newLast4}
                onChange={(e) => setNewLast4(e.target.value.replace(/\s+/g, '').slice(0, 4))}
                placeholder="1234 또는 ****"
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 block mb-1">할당부서</label>
              <UnitSelect value={newUnitId} onChange={setNewUnitId} units={unitOptions} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 block mb-1">상태</label>
              <select
                value={newStatus}
                onChange={(e) =>
                  setNewStatus(e.target.value === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE')
                }
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-sky-500"
              >
                <option value="ACTIVE">활성화</option>
                <option value="SUSPENDED">정지</option>
              </select>
            </div>
            <button
              type="button"
              disabled={saving || !canEdit}
              title={canEdit ? '신규 카드 등록' : 'Edit 권한이 필요합니다.'}
              onClick={handleCreate}
              className={`font-medium px-4 py-2.5 text-xs rounded-xl transition-all shadow-md active:scale-95 whitespace-nowrap ${
                canEdit
                  ? 'bg-sky-600 hover:bg-sky-500 text-white'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
              }`}
            >
              +신규카드등록(Edit)
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-sky-600 border-b border-sky-700 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-300" />
            <h2 className="text-sm font-medium text-white tracking-tight">등록된 카드</h2>
            <span className="text-[11px] font-medium bg-white/15 text-white px-2 py-0.5 rounded-md">
              {scopedItems.length}건
            </span>
            <DeptAssigneeLine editorNames={editorNames} onColor />
            <div className="flex items-center gap-1 ml-1">
              <button
                type="button"
                onClick={() =>
                  setStatusFilter((prev) => (prev === 'ACTIVE' ? 'ALL' : 'ACTIVE'))
                }
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100'
                }`}
              >
                활성화 {countActive}
              </button>
              <button
                type="button"
                onClick={() =>
                  setStatusFilter((prev) => (prev === 'SUSPENDED' ? 'ALL' : 'SUSPENDED'))
                }
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  statusFilter === 'SUSPENDED'
                    ? 'bg-slate-700 text-white'
                    : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                비활성화 {countInactive}
              </button>
            </div>
          </div>
          <div className="soh-filter-bar flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border">
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">부서</span>
              <select
                value={listUnitId}
                onChange={(e) => setListUnitId(e.target.value)}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent max-w-[180px] h-4 leading-none py-0"
              >
                <option value="">전체 부서</option>
                {unitOptions.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {`${'\u00A0'.repeat(unit.depth * 2)}${unit.unit_name}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative w-36 h-7">
              <input
                type="text"
                maxLength={4}
                placeholder="카드번호 검색"
                value={last4Query}
                onChange={(e) => setLast4Query(e.target.value.replace(/\s+/g, '').slice(0, 4))}
                className="w-full h-7 box-border px-3 py-0 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:border-sky-500 shadow-sm placeholder:font-medium"
              />
            </div>
            <button
              type="button"
              onClick={handleExportExcel}
              className="h-7 px-3 bg-white text-sky-700 rounded-lg text-[10px] font-medium shadow-sm hover:bg-sky-50 transition-all whitespace-nowrap leading-none"
            >
              화면 목록 EXCEL 다운로드
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-center border-collapse min-w-[1080px]">
            <colgroup>
              <col className="w-[52px]" />
              <col className="w-[14%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[13%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-medium uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 text-center">NO</th>
                <th className="h-12 px-2 text-center">카드관리명</th>
                <th className="h-12 px-2 text-center">
                  <span className="inline-flex items-center justify-center gap-0.5">
                    카드사
                    <ColumnHint />
                  </span>
                </th>
                <th className="h-12 px-2 text-center">
                  <span className="inline-flex items-center justify-center gap-0.5">
                    카드번호
                    <ColumnHint />
                  </span>
                </th>
                <th className="h-12 px-2 text-center">할당부서</th>
                <th className="h-12 px-2 text-center">상태</th>
                <th className="h-12 px-2 text-center">등록일자</th>
                <th className="h-12 px-2 text-center">관리메모</th>
                <th className="h-12 px-2 text-center">관리액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-medium text-slate-700">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-16 text-center text-slate-400 text-xs font-medium">
                    {listUnitId || last4Query || statusFilter !== 'ALL'
                      ? '조건에 맞는 카드가 없습니다.'
                      : '등록된 카드가 없습니다.'}
                  </td>
                </tr>
              ) : (
                paginatedItems.map((row, i) => {
                  const isEditing = editingId === row.id && !!draft;
                  const rowNo = filteredItems.length - ((currentPage - 1) * itemsPerPage + i);
                  return (
                    <tr
                      key={row.id}
                      className={`h-14 transition-colors ${
                        isEditing ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="text-center font-medium tabular-nums text-slate-400">{rowNo}</td>
                      <td className="px-2 font-medium text-[13px] text-slate-900 truncate" title={row.name}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none focus:border-sky-500 text-center"
                          />
                        ) : (
                          row.name
                        )}
                      </td>
                      <td
                        className="px-2 text-slate-700 truncate"
                        title={
                          row.hasUsage
                            ? '사용자 신청 이력이 발생하면 정보를 변경할 수 없습니다.'
                            : row.issuer || '-'
                        }
                      >
                        {isEditing && !row.hasUsage ? (
                          <select
                            value={draft.issuer}
                            onChange={(e) => setDraft({ ...draft, issuer: e.target.value })}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none focus:border-sky-500 text-center"
                          >
                            <option value="">카드사 선택</option>
                            {(CARD_ISSUERS.includes(draft.issuer as (typeof CARD_ISSUERS)[number])
                              ? CARD_ISSUERS
                              : draft.issuer
                                ? [draft.issuer, ...CARD_ISSUERS]
                                : CARD_ISSUERS
                            ).map((issuer) => (
                              <option key={issuer} value={issuer}>
                                {issuer}
                              </option>
                            ))}
                          </select>
                        ) : (
                          row.issuer || '-'
                        )}
                      </td>
                      <td
                        className="px-2 tabular-nums text-slate-600"
                        title={
                          row.hasUsage
                            ? '사용자 신청 이력이 발생하면 정보를 변경할 수 없습니다.'
                            : undefined
                        }
                      >
                        {isEditing && !row.hasUsage ? (
                          <input
                            type="text"
                            maxLength={4}
                            value={draft.last4}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                last4: e.target.value.replace(/\s+/g, '').slice(0, 4),
                              })
                            }
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none focus:border-sky-500 text-center"
                          />
                        ) : (
                          row.last4
                        )}
                      </td>
                      <td className="px-2">
                        {isEditing ? (
                          <UnitSelect
                            value={draft.unitId}
                            onChange={(unitId) => setDraft({ ...draft, unitId })}
                            units={unitOptions}
                            className="mx-auto max-w-[180px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none focus:border-sky-500 text-center"
                          />
                        ) : (
                          <span className="truncate block" title={row.unitName}>
                            {row.unitName || '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-2">
                        {isEditing ? (
                          <select
                            value={draft.status}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                status: e.target.value === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
                              })
                            }
                            className="mx-auto max-w-[110px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none focus:border-sky-500 text-center"
                          >
                            <option value="ACTIVE">활성화</option>
                            <option value="SUSPENDED">정지</option>
                          </select>
                        ) : (
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium ${
                              row.status === 'SUSPENDED'
                                ? 'bg-rose-50 text-rose-600 border border-rose-100'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            }`}
                          >
                            {statusLabel(row.status)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 tabular-nums text-slate-500 whitespace-nowrap">
                        {row.createdAt ? getKSTDateString(row.createdAt) || '-' : '-'}
                      </td>
                      <td className="px-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={draft.memo}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                memo: e.target.value.replace(/[\r\n]+/g, ' '),
                              })
                            }
                            maxLength={80}
                            placeholder="메모"
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-medium outline-none focus:border-sky-500 text-center"
                          />
                        ) : (
                          <span className="truncate block text-[11px] font-medium text-slate-600" title={row.memo || ''}>
                            {row.memo || '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-2">
                        <div className="flex gap-1.5 justify-center">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => handleSave(row.id)}
                                className="text-[9px] font-medium px-2 py-1 rounded-md border whitespace-nowrap bg-sky-600 text-white border-sky-600"
                              >
                                저장
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(null);
                                  setDraft(null);
                                }}
                                className={ACTION_BTN}
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => startEdit(row)}
                                className={canEdit ? ACTION_BTN : DISABLED_BTN}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                disabled={!canEdit || saving}
                                onClick={() => handleDelete(row)}
                                className={
                                  canEdit
                                    ? 'text-[9px] font-medium px-2 py-1 rounded-md border whitespace-nowrap bg-white text-rose-500 border-rose-200 hover:border-rose-400'
                                    : DISABLED_BTN
                                }
                              >
                                삭제(Edit)
                              </button>
                            </>
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
        {filteredItems.length > 0 ? (
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function MasterRegistryModule() {
  return (
    <CorpCardScaffold
      titleEn="CORPORATE CARD · MASTER REGISTRY"
      title="법인카드 대장"
      description="법인카드 발급·보유·반납 대장을 관리합니다."
      tabs={CORP_CARD_MASTER_TABS}
      tabPrefix="/asset/corp-card/master"
      hideUserName
      bannerTone="emerald"
      showPermissionChips
      menuPath="/asset/corp-card/master/registry"
    >
      <RegistryPanel />
    </CorpCardScaffold>
  );
}
