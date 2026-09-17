'use client';

import { useEffect, useMemo, useState } from 'react';
import LoadingState from '@/components/common/LoadingState';

type UnitRow = {
  id: string;
  unit_name: string;
  unit_name_en?: string;
  unit_code?: string;
  unit_type: string;
  parent_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
  member_count?: number;
  child_count?: number;
  active_child_count?: number;
};

export default function AdminUnitsPage() {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newUnit, setNewUnit] = useState({
    unit_name: '',
    unit_name_en: '',
    unit_code: '',
    unit_type: 'CENTER',
    parent_id: '',
  });
  /** 사용 중 목록: 이 행만 인라인 수정 가능 */
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  /** 미사용 아카이브: 기본 접힘 */
  const [archiveOpen, setArchiveOpen] = useState(false);

  const fetchUnits = async () => {
    try {
      setLoadError(null);
      const res = await fetch('/api/admin/units', { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoadError(err.message || `조직 목록 로드 실패 (${res.status})`);
        setUnits([]);
        return;
      }
      const data = await res.json();
      setUnits(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('조직 데이터 로드 실패', error);
      setLoadError('조직 데이터 로드 중 오류가 발생했습니다.');
      setUnits([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnits();
  }, []);

  const activeUnits = useMemo(() => units.filter((u) => u.is_active !== false), [units]);
  const unusedUnits = useMemo(() => units.filter((u) => u.is_active === false), [units]);

  /** 상위 후보: 사용 중 조직 전체 (자기 자신은 선택 시 제외) */
  const parentCandidates = useMemo(() => activeUnits, [activeUnits]);

  const unitNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of units) map.set(u.id, u.unit_name);
    return map;
  }, [units]);

  const handleLiveUpdate = async (id: string, payload: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/admin/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      });
      if (res.ok) {
        await fetchUnits();
        return true;
      }
      const data = await res.json().catch(() => ({}));
      alert(data.message || '조직 정보 저장에 실패했습니다.');
      await fetchUnits();
      return false;
    } catch {
      alert('수정 오류 발생');
      return false;
    }
  };

  const markUnused = async (u: UnitRow) => {
    const activeChildCount = Number(u.active_child_count ?? 0);
    if (activeChildCount > 0) {
      alert(
        `[${u.unit_name}] 사용 중인 하위 조직이 ${activeChildCount}개 있어 미사용으로 옮길 수 없습니다.\n하위를 먼저 미사용/이동해 주세요.`
      );
      return;
    }
    if (
      !confirm(
        `[${u.unit_name}] 조직을 미사용으로 옮길까요?\n\n· 소속 사용자는 조직 미지정으로 해제됩니다\n· 선택 목록에서는 숨겨집니다\n· 아카이브에서 다시 사용하거나 삭제할 수 있습니다`
      )
    ) {
      return;
    }
    if (editingUnitId === u.id) setEditingUnitId(null);
    await handleLiveUpdate(u.id, { is_active: false });
  };

  const restoreActive = async (u: UnitRow) => {
    await handleLiveUpdate(u.id, { is_active: true });
  };

  const handleDelete = async (u: UnitRow) => {
    const childCount = Number(u.child_count ?? 0);
    if (childCount > 0) {
      alert(
        `[${u.unit_name}] 하위 조직이 ${childCount}개 있어 삭제할 수 없습니다.\n하위를 먼저 정리해 주세요.`
      );
      return;
    }
    if (
      !confirm(
        `[${u.unit_name}] 조직을 삭제할까요?\n\n· 목록에서 숨기는 삭제입니다 (복구 UI 없음)\n· 조직코드는 다시 사용할 수 있습니다\n· 소모품 신청 등 과거 이력 참조는 유지됩니다`
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/admin/units', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '삭제에 실패했습니다.');
        return;
      }
      await fetchUnits();
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  const startEdit = (id: string) => setEditingUnitId(id);
  const finishEdit = () => setEditingUnitId(null);

  const handleAdd = async () => {
    if (!newUnit.unit_name.trim()) return alert('조직 명칭(국문)을 입력해 주세요.');
    if (!newUnit.unit_code.trim()) return alert('조직코드(unit_code)를 입력해 주세요. (예: PMD, PMC)');
    const res = await fetch('/api/admin/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newUnit,
        unit_name: newUnit.unit_name.trim(),
        unit_name_en: newUnit.unit_name_en.trim(),
        unit_code: newUnit.unit_code.trim(),
        parent_id: newUnit.unit_type === 'ORGANIZATION' ? '' : newUnit.parent_id,
      }),
    });
    if (res.ok) {
      setNewUnit({
        unit_name: '',
        unit_name_en: '',
        unit_code: '',
        unit_type: 'CENTER',
        parent_id: '',
      });
      fetchUnits();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.message || '조직 추가에 실패했습니다.');
    }
  };

  const renderUnitRow = (u: UnitRow, mode: 'active' | 'archive') => {
    const isEditing = mode === 'active' && editingUnitId === u.id;
    const editable = isEditing;
    const childCount = Number(u.child_count ?? 0);
    const parentMissingFromActive =
      !!u.parent_id && !parentCandidates.some((p) => p.id === u.parent_id);
    const parentLabel = u.parent_id ? unitNameById.get(u.parent_id) : null;

    return (
      <tr
        key={u.id}
        className={`transition-all ${
          mode === 'archive'
            ? 'bg-slate-50/80 opacity-80'
            : isEditing
              ? 'bg-indigo-50/40 ring-1 ring-inset ring-indigo-100'
              : 'hover:bg-blue-50/10'
        }`}
      >
        <td className="p-6 text-center">
          <input
            disabled={!editable}
            type="number"
            defaultValue={u.sort_order}
            key={`${u.id}-sort-${u.sort_order}-${isEditing ? 'e' : 'r'}`}
            onBlur={(e) =>
              editable &&
              handleLiveUpdate(u.id, { sort_order: parseInt(e.target.value, 10) || 0 })
            }
            className="w-12 text-center border-b border-transparent bg-transparent text-xs font-bold text-gray-500 disabled:opacity-70 disabled:cursor-default focus:outline-none focus:border-blue-500"
          />
        </td>

        <td className="p-6">
          <select
            disabled={!editable}
            value={u.unit_type}
            onChange={(e) => {
              const unit_type = e.target.value;
              handleLiveUpdate(
                u.id,
                unit_type === 'ORGANIZATION'
                  ? { unit_type, parent_id: null }
                  : { unit_type }
              );
            }}
            className="p-1 border border-transparent rounded bg-transparent text-[10px] font-black uppercase disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            <option value="ORGANIZATION">ORGANIZATION</option>
            <option value="HQ">HQ</option>
            <option value="CENTER">CENTER</option>
            <option value="DEPT">DEPT</option>
          </select>
        </td>

        <td className="p-6">
          <div className="flex flex-col gap-0.5 max-w-xs">
            <input
              disabled={!editable}
              type="text"
              defaultValue={u.unit_name}
              key={`${u.id}-name-${u.unit_name}-${isEditing ? 'e' : 'r'}`}
              onBlur={(e) => {
                if (!editable) return;
                const next = e.target.value.trim();
                if (!next) {
                  alert('조직 명칭(국문)을 입력해 주세요.');
                  e.target.value = u.unit_name;
                  return;
                }
                if (next !== u.unit_name) handleLiveUpdate(u.id, { unit_name: next });
              }}
              className="p-1 border-b border-transparent focus:border-blue-500 focus:outline-none bg-transparent font-black text-slate-800 w-full transition-all disabled:text-slate-700 disabled:cursor-default text-xs"
            />
            <input
              disabled={!editable}
              type="text"
              placeholder="영문 명칭 미지정"
              defaultValue={u.unit_name_en || ''}
              key={`${u.id}-en-${u.unit_name_en || ''}-${isEditing ? 'e' : 'r'}`}
              onBlur={(e) =>
                editable &&
                e.target.value !== (u.unit_name_en || '') &&
                handleLiveUpdate(u.id, { unit_name_en: e.target.value.trim() })
              }
              className="p-1 border-b border-transparent focus:border-blue-500 focus:outline-none bg-transparent font-bold text-slate-400 w-full transition-all disabled:cursor-default text-[10px]"
            />
          </div>
        </td>

        <td className="p-6">
          <input
            key={`${u.id}-${u.unit_code || ''}-${isEditing ? 'e' : 'r'}`}
            disabled={!editable}
            type="text"
            placeholder="PMD"
            defaultValue={u.unit_code || ''}
            onBlur={(e) => {
              if (!editable) return;
              const next = e.target.value.trim().toUpperCase();
              if (next !== (u.unit_code || '')) {
                handleLiveUpdate(u.id, { unit_code: next });
              }
            }}
            className="w-24 p-1.5 border border-slate-200 rounded-lg text-[11px] font-black font-mono text-indigo-700 bg-indigo-50/50 outline-none focus:border-indigo-400 disabled:opacity-70 disabled:cursor-default uppercase"
            title="제작물 관리번호용 고정 코드 (변경 시 신규 발행에만 반영)"
          />
        </td>

        <td className="p-6">
          {u.unit_type === 'ORGANIZATION' ? (
            <div className="text-gray-300 font-black text-[10px] italic bg-gray-50 py-2 px-3 rounded-lg border border-dashed border-gray-200 text-center">
              최상위 법인 (상위 없음)
            </div>
          ) : mode === 'archive' ? (
            <div className="text-xs font-bold text-slate-500 px-1">
              {parentLabel || (u.parent_id ? '(상위 없음/삭제됨)' : '최상위')}
            </div>
          ) : (
            <select
              disabled={!editable}
              value={parentMissingFromActive ? '' : u.parent_id || ''}
              onChange={(e) =>
                handleLiveUpdate(u.id, { parent_id: e.target.value || null })
              }
              className="p-2 border border-gray-100 rounded-xl text-xs bg-white w-full max-w-[200px] font-black text-blue-600 disabled:text-slate-500 disabled:cursor-default cursor-pointer shadow-sm"
            >
              <option value="">
                {parentMissingFromActive && parentLabel
                  ? `재선택 필요 (이전: ${parentLabel})`
                  : '최상위 (상위 없음)'}
              </option>
              {parentCandidates
                .filter((t) => t.id !== u.id)
                .map((hq) => (
                  <option key={hq.id} value={hq.id}>
                    {hq.unit_name}
                  </option>
                ))}
            </select>
          )}
        </td>

        <td className="p-6 text-center">
          {mode === 'archive' ? (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xs font-black text-slate-500 tabular-nums">
                하위 {childCount}
              </span>
              <span className="text-[10px] font-bold text-slate-400">
                인원 {Number(u.member_count ?? 0)}
              </span>
            </div>
          ) : (
            <>
              <span className="text-xs font-black text-slate-700 tabular-nums">
                {Number(u.member_count ?? 0)}
              </span>
              <span className="text-[10px] font-bold text-slate-400 ml-0.5">명</span>
              {childCount > 0 ? (
                <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                  하위 {childCount}
                  {Number(u.active_child_count ?? 0) > 0
                    ? ` (사용중 ${u.active_child_count})`
                    : ''}
                </div>
              ) : null}
            </>
          )}
        </td>

        <td className="p-6 text-center">
          {mode === 'active' ? (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {isEditing ? (
                <button
                  type="button"
                  onClick={finishEdit}
                  className="px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border shadow-sm text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100"
                >
                  완료
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(u.id)}
                  className="px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border shadow-sm text-slate-700 bg-white border-slate-200 hover:bg-slate-50"
                >
                  수정
                </button>
              )}
              <button
                type="button"
                onClick={() => markUnused(u)}
                className="px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border shadow-sm text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100"
                title="미사용 아카이브로 이동 (하위 사용 중 조직이 없어야 함)"
              >
                미사용
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => restoreActive(u)}
                className="px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border shadow-sm text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                title="사용 중 목록으로 복귀"
              >
                다시 사용
              </button>
              <button
                type="button"
                onClick={() => handleDelete(u)}
                disabled={childCount > 0}
                className="px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border shadow-sm text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  childCount > 0
                    ? '하위 조직이 있어 삭제할 수 없습니다'
                    : '잘못 만든 조직 정리'
                }
              >
                삭제
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  if (loading) return <LoadingState />;

  return (
    <div className="p-8 space-y-8 min-h-screen">
      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {loadError}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchUnits();
            }}
            className="ml-3 underline underline-offset-2 hover:text-rose-900"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">
            전사 조직 관리 (ORGANIZATION)
          </h2>
        </div>

        <div className="flex gap-2 bg-blue-50 p-3 rounded-[2rem] border border-blue-100 shadow-sm items-center flex-wrap">
          <select
            value={newUnit.unit_type}
            onChange={(e) => {
              const unit_type = e.target.value;
              setNewUnit({
                ...newUnit,
                unit_type,
                parent_id: unit_type === 'ORGANIZATION' ? '' : newUnit.parent_id,
              });
            }}
            className="p-2 border-0 rounded-xl text-xs font-bold bg-white outline-none"
          >
            <option value="ORGANIZATION">ORGANIZATION</option>
            <option value="HQ">HQ (본부)</option>
            <option value="CENTER">CENTER (센터)</option>
            <option value="DEPT">DEPT (부서)</option>
          </select>

          <input
            type="text"
            placeholder="새 조직 명칭 (국문)"
            value={newUnit.unit_name}
            onChange={(e) => setNewUnit({ ...newUnit, unit_name: e.target.value })}
            className="p-2 border-0 rounded-xl text-xs w-40 outline-none font-bold"
          />

          <input
            type="text"
            placeholder="조직코드 (예: PMD, PMC)"
            value={newUnit.unit_code}
            onChange={(e) =>
              setNewUnit({ ...newUnit, unit_code: e.target.value.toUpperCase() })
            }
            className="p-2 border-0 rounded-xl text-xs w-28 outline-none font-black uppercase"
          />

          <input
            type="text"
            placeholder="조직 명칭 (영문)"
            value={newUnit.unit_name_en}
            onChange={(e) => setNewUnit({ ...newUnit, unit_name_en: e.target.value })}
            className="p-2 border-0 rounded-xl text-xs w-48 outline-none font-bold"
          />

          <select
            value={newUnit.unit_type === 'ORGANIZATION' ? '' : newUnit.parent_id}
            disabled={newUnit.unit_type === 'ORGANIZATION'}
            onChange={(e) => setNewUnit({ ...newUnit, parent_id: e.target.value })}
            className="p-2 border-0 rounded-xl text-xs font-bold bg-white outline-none disabled:opacity-50"
          >
            <option value="">
              {newUnit.unit_type === 'ORGANIZATION'
                ? '최상위 법인 (상위 없음)'
                : '최상위 (상위 없음)'}
            </option>
            {newUnit.unit_type !== 'ORGANIZATION' &&
              parentCandidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unit_name}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-xs font-black transition-colors"
          >
            추가
          </button>
        </div>
      </div>

      {/* 사용 중 */}
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-slate-50/60 flex items-center justify-between">
          <h3 className="text-xs font-black text-slate-700 tracking-widest uppercase">
            사용 중 조직
          </h3>
          <span className="text-[10px] font-bold text-slate-400">{activeUnits.length}건</span>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50/50 border-b font-bold text-gray-400 uppercase text-[10px] tracking-widest">
            <tr>
              <th className="p-6 text-center">정렬</th>
              <th className="p-6">유형</th>
              <th className="p-6">조직 명칭</th>
              <th className="p-6">조직코드</th>
              <th className="p-6">상위 조직 연결</th>
              <th className="p-6 text-center">소속인원</th>
              <th className="p-6 text-center">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {activeUnits.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-10 text-center text-slate-400 text-xs font-bold">
                  사용 중 조직이 없습니다.
                </td>
              </tr>
            ) : (
              activeUnits.map((u) => renderUnitRow(u, 'active'))
            )}
          </tbody>
        </table>
      </div>

      {/* 미사용 아카이브 — 기본 접힘 */}
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-dashed border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setArchiveOpen((v) => !v)}
          className="w-full px-6 py-4 border-b border-slate-100 bg-slate-100/50 flex items-center justify-between text-left hover:bg-slate-100 transition-colors"
        >
          <h3 className="text-xs font-black text-slate-600 tracking-widest uppercase">
            미사용 아카이브
          </h3>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[10px] font-bold text-slate-400">{unusedUnits.length}건</span>
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              {archiveOpen ? '접기' : '펼치기'}
            </span>
          </div>
        </button>
        {archiveOpen ? (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b font-bold text-gray-400 uppercase text-[10px] tracking-widest">
              <tr>
                <th className="p-6 text-center">정렬</th>
                <th className="p-6">유형</th>
                <th className="p-6">조직 명칭</th>
                <th className="p-6">조직코드</th>
                <th className="p-6">상위 조직</th>
                <th className="p-6 text-center">하위/인원</th>
                <th className="p-6 text-center">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {unusedUnits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-400 text-xs font-bold">
                    미사용 조직이 없습니다.
                  </td>
                </tr>
              ) : (
                unusedUnits.map((u) => renderUnitRow(u, 'archive'))
              )}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
