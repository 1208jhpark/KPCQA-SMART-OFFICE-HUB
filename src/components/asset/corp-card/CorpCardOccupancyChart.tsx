'use client';

import React, { useMemo } from 'react';
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
  Legend,
} from 'recharts';

type OrgUnitItem = {
  id: string;
  unit_name: string;
  parent_id?: string | null;
  sort_order?: number;
  unit_type?: string | null;
};

type ChartOrgMode = 'DEPT' | 'CENTER' | 'HQ';

type CardLike = {
  id: string;
  unitId: string;
  status?: string;
};

type UsageLike = {
  cardId: string;
  unitId?: string;
  status: string;
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

export function collectUnitScopeIds(rootId: string, units: OrgUnitItem[]) {
  const ids = collectDescendantUnitIds(rootId, units);
  ids.add(rootId);
  return ids;
}

export default function CorpCardOccupancyChart({
  cards,
  items,
  units,
  chartOrgMode,
  onChartOrgMode,
  listUnitId,
  onListUnitId,
}: {
  cards: CardLike[];
  items: UsageLike[];
  units: OrgUnitItem[];
  chartOrgMode: ChartOrgMode;
  onChartOrgMode: (mode: ChartOrgMode) => void;
  listUnitId: string;
  onListUnitId: (unitId: string) => void;
}) {
  const chartRows = useMemo(() => {
    const cardById = new Map(cards.map((card) => [card.id, card]));
    const heldByUnit = new Map<string, number>();
    cards.forEach((card) => {
      if (card.status === 'SUSPENDED') return;
      const uid = String(card.unitId || '').trim();
      if (!uid) return;
      heldByUnit.set(uid, (heldByUnit.get(uid) || 0) + 1);
    });

    const checkedOutByUnit = new Map<string, Set<string>>();
    const returningByUnit = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, unitId: string, cardId: string) => {
      const uid = String(unitId || '').trim();
      const cid = String(cardId || '').trim();
      if (!uid || !cid) return;
      const set = map.get(uid) || new Set<string>();
      set.add(cid);
      map.set(uid, set);
    };
    items.forEach((row) => {
      const card = cardById.get(row.cardId);
      const uid = card?.unitId || row.unitId || '';
      if (row.status === 'CHECKED_OUT') add(checkedOutByUnit, uid, row.cardId);
      if (row.status === 'RETURNING') add(returningByUnit, uid, row.cardId);
    });

    const sumSet = (map: Map<string, Set<string>>, ids: Iterable<string>) => {
      const seen = new Set<string>();
      for (const id of ids) {
        for (const cardId of map.get(id) || []) seen.add(cardId);
      }
      return seen.size;
    };
    const sumHeld = (ids: Iterable<string>) => {
      let n = 0;
      for (const id of ids) n += heldByUnit.get(id) || 0;
      return n;
    };

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
      const ids =
        chartOrgMode === 'DEPT' ? new Set([unit.id]) : collectUnitScopeIds(unit.id, units);
      const checkedOut = sumSet(checkedOutByUnit, ids);
      const returning = sumSet(returningByUnit, ids);
      const held = sumHeld(ids);
      return {
        name: String(unit.unit_name || '').trim() || '(이름없음)',
        unitId: unit.id,
        held,
        checkedOut,
        returning,
        occupied: checkedOut + returning,
        isSelected: listUnitId === unit.id,
      };
    });
  }, [cards, items, units, chartOrgMode, listUnitId]);

  const chartHeight = 196;
  const chartMinWidth = Math.max(560, chartRows.length * 52);
  const totalCheckedOut = chartRows.reduce((n, row) => n + row.checkedOut, 0);
  const totalReturning = chartRows.reduce((n, row) => n + row.returning, 0);
  const orgLabel = chartOrgMode === 'HQ' ? '본부별' : chartOrgMode === 'CENTER' ? '센터별' : '부서별';

  const selectUnit = (data: any) => {
    const unitId = data?.unitId || data?.payload?.unitId;
    if (!unitId) return;
    onListUnitId(listUnitId === unitId ? '' : unitId);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden">
      <div className="px-3 py-1.5 bg-slate-100/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
          <h2 className="text-[11px] font-medium text-slate-800 tracking-tight">
            📊 {orgLabel} 카드 반출 현황
            <span className="ml-2 text-[9px] font-medium text-slate-500">
              대여중·반납 대기중만 집계
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
            {(
              [
                { id: 'DEPT', label: '부서별조회' },
                { id: 'CENTER', label: '센터별조회' },
                { id: 'HQ', label: '본부별조회' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  onChartOrgMode(mode.id);
                  onListUnitId('');
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
            대여중 {totalCheckedOut.toLocaleString()}
          </span>
          <span className="text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-md">
            반납 대기중 {totalReturning.toLocaleString()}
          </span>
          {listUnitId ? (
            <button
              type="button"
              onClick={() => onListUnitId('')}
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
                    height={68}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tick={(props: any) => {
                      const { x, y, payload } = props;
                      const row = chartRows.find((r) => r.name === payload?.value);
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text
                            textAnchor="end"
                            transform="rotate(-28)"
                            fontSize={8}
                            fontWeight={500}
                            fill="#334155"
                          >
                            {payload?.value}
                          </text>
                          <text
                            textAnchor="end"
                            transform="rotate(-28)"
                            dy={10}
                            fontSize={8}
                            fontWeight={500}
                            fill="#64748b"
                          >
                            보유 {(row?.held || 0).toLocaleString()}장
                          </text>
                        </g>
                      );
                    }}
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
                      const row = payload[0].payload as (typeof chartRows)[number];
                      return (
                        <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-md">
                          <p className="text-[10px] font-medium text-slate-800">{row.name}</p>
                          <p className="text-[10px] font-medium text-slate-500 mt-0.5">
                            보유 {row.held.toLocaleString()}장
                          </p>
                          <p className="text-[10px] font-medium text-sky-600 mt-0.5">
                            대여중 {row.checkedOut.toLocaleString()}
                          </p>
                          <p className="text-[10px] font-medium text-violet-700 mt-0.5">
                            반납 대기중 {row.returning.toLocaleString()}
                          </p>
                          <p className="text-[9px] font-medium text-slate-400 mt-0.5">
                            클릭하면 목록 조직 필터
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 10, fontWeight: 500, paddingBottom: 4 }}
                  />
                  <Bar
                    dataKey="checkedOut"
                    name="대여중"
                    stackId="occ"
                    maxBarSize={28}
                    cursor="pointer"
                    onClick={selectUnit}
                  >
                    {chartRows.map((row) => (
                      <Cell key={`out-${row.unitId}`} fill={row.isSelected ? '#0284c7' : '#38bdf8'} />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="returning"
                    name="반납 대기중"
                    stackId="occ"
                    maxBarSize={28}
                    cursor="pointer"
                    onClick={selectUnit}
                  >
                    {chartRows.map((row) => (
                      <Cell key={`ret-${row.unitId}`} fill={row.isSelected ? '#6d28d9' : '#a78bfa'} />
                    ))}
                    <LabelList
                      dataKey="occupied"
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
  );
}
