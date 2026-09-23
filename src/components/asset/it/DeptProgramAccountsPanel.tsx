'use client';

import React, { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { getKSTDateString } from '@/utils/dateUtils';

type ProgramRow = {
  id: string;
  unit_id: string;
  dept?: string | null;
  person_name: string;
  registered_date?: string | null;
  program_type: string;
  program_used: boolean;
  program_id: string;
  program_password: string;
  password_revealed?: boolean;
  ip_address: string;
  mac_address: string;
  note1: string;
  note2: string;
  note3: string;
};

const emptyForm = (): Omit<ProgramRow, 'id' | 'unit_id'> & { unit_id?: string } => ({
  person_name: '',
  registered_date: getKSTDateString(),
  program_type: '',
  program_used: false,
  program_id: '',
  program_password: '',
  ip_address: '',
  mac_address: '',
  note1: '',
  note2: '',
  note3: '',
});

type Props = {
  /** 메뉴 Edit 권한 (신규·수정·삭제·비밀번호 평문) */
  isEditor: boolean;
  defaultUnitId: string;
  defaultDeptName: string;
};

export default function DeptProgramAccountsPanel({
  isEditor,
  defaultUnitId,
  defaultDeptName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProgramRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asset/it/dept/program-accounts?t=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '조회 실패');
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e: any) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (open) loadRows();
  }, [open, loadRows]);

  const openAdd = () => {
    if (!isEditor) return alert('신규 등록은 Edit 권한이 필요합니다.');
    setEditingId(null);
    setForm({ ...emptyForm(), unit_id: defaultUnitId });
    setModalMode('add');
  };

  const openEdit = async (row: ProgramRow) => {
    if (!isEditor) return alert('수정은 Edit 권한이 필요합니다.');
    setEditingId(row.id);
    setForm({
      person_name: row.person_name,
      registered_date: row.registered_date || getKSTDateString(),
      program_type: row.program_type || '',
      program_used: !!row.program_used,
      program_id: row.program_id || '',
      program_password: '',
      ip_address: row.ip_address || '',
      mac_address: row.mac_address || '',
      note1: row.note1 || '',
      note2: row.note2 || '',
      note3: row.note3 || '',
      unit_id: row.unit_id,
    });
    setModalMode('edit');
    // Edit만: 수정 모달 열릴 때 비밀번호 평문 조회
    try {
      const res = await fetch(
        `/api/asset/it/dept/program-accounts?id=${encodeURIComponent(row.id)}&t=${Date.now()}`,
        { cache: 'no-store' }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.row) {
        setForm((prev) => ({
          ...prev,
          program_password: String(data.row.program_password || ''),
        }));
      }
    } catch {
      /* 목록 값은 유지, 비밀번호만 비움 */
    }
  };

  const handleSave = async () => {
    if (!isEditor) return;
    if (!String(form.person_name || '').trim()) return alert('이름을 입력해 주세요.');
    setSaving(true);
    try {
      const payload = {
        id: editingId || undefined,
        unit_id: form.unit_id || defaultUnitId,
        person_name: form.person_name,
        registered_date: form.registered_date,
        program_type: form.program_type,
        program_used: form.program_used,
        program_id: form.program_id,
        program_password: form.program_password,
        ip_address: form.ip_address,
        mac_address: form.mac_address,
        note1: form.note1,
        note2: form.note2,
        note3: form.note3,
      };
      const res = await fetch('/api/asset/it/dept/program-accounts', {
        method: modalMode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setModalMode(null);
      await loadRows();
    } catch (e: any) {
      alert(e?.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ProgramRow) => {
    if (!isEditor) return alert('삭제는 Edit 권한이 필요합니다.');
    if (!confirm(`「${row.person_name}」 행을 삭제할까요?`)) return;
    try {
      const res = await fetch('/api/asset/it/dept/program-accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '삭제 실패');
      await loadRows();
    } catch (e: any) {
      alert(e?.message || '삭제 중 오류가 발생했습니다.');
    }
  };

  const handleExcel = async () => {
    let exportRows = rows;
    // Edit: 서버에서 평문 재조회 후 엑셀에 비밀번호 포함 / Access: ****
    if (isEditor) {
      try {
        const res = await fetch(
          `/api/asset/it/dept/program-accounts?reveal=1&t=${Date.now()}`,
          { cache: 'no-store' }
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.rows)) {
          exportRows = data.rows;
        }
      } catch {
        /* 목록 마스킹 값으로 폴백 */
      }
    }

    const excelData = exportRows.map((r, i) => {
      const pw = String(r.program_password || '').trim();
      const passwordCell =
        isEditor && pw && pw !== '****' ? pw : pw ? '****' : '-';
      return {
        NO: exportRows.length - i,
        이름: r.person_name,
        등록일: r.registered_date || '-',
        프로그램종류: r.program_type || '-',
        '프로그램 사용': r.program_used ? '사용' : '-',
        '프로그램 아이디': r.program_id || '-',
        '프로그램 비밀번호': passwordCell,
        'IP 주소': r.ip_address || '-',
        'MAC 주소': r.mac_address || '-',
        'S/N': r.note1 || '-',
        비고1: r.note2 || '-',
        비고2: r.note3 || '-',
        소속: r.dept || defaultDeptName || '-',
      };
    });
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ProgramAccounts');
    XLSX.writeFile(
      wb,
      `부서인력_프로그램사용_${defaultDeptName || 'dept'}_${getKSTDateString()}.xlsx`
    );
  };

  const displayPassword = (row: ProgramRow) => {
    // 목록에서는 Access/Edit 무관하게 항상 마스킹 (평문은 수정 모달에서만)
    if (!row.program_password) return '-';
    return '****';
  };

  return (
    <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full p-4 px-6 bg-slate-100/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-slate-500 font-black text-sm tabular-nums w-4">
            {open ? '▾' : '▸'}
          </span>
          <div className="w-2.5 h-2.5 rounded-full bg-violet-600 shrink-0" />
          <h2 className="text-sm font-black text-slate-800 tracking-tight">
            부서 인력별 프로그램사용 관리
          </h2>
          <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
            {rows.length}건
          </span>
          <span className="text-[10px] font-bold text-slate-400">
            부서 전용 장부 · 마스터와 공유되지 않음
          </span>
        </div>
        <span className="text-[10px] font-bold text-slate-400 shrink-0">
          {open ? '접기' : '펼치기'}
        </span>
      </button>

      {open && (
        <>
          <div className="p-4 px-6 border-b border-slate-100 flex flex-wrap items-center justify-end gap-2 bg-white">
            <button
              type="button"
              onClick={handleExcel}
              disabled={rows.length === 0}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              EXCEL 다운로드
            </button>
            <button
              type="button"
              disabled={!isEditor}
              onClick={openAdd}
              title={isEditor ? '신규 등록' : '신규 등록은 Edit 권한이 필요합니다.'}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm transition-all ${
                isEditor
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              + 신규 추가(Edit)
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1280px]">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-11 px-2 text-center w-12">NO</th>
                  <th className="h-11 px-2">이름</th>
                  <th className="h-11 px-2 text-center whitespace-nowrap">등록일</th>
                  <th className="h-11 px-2 whitespace-nowrap">프로그램종류</th>
                  <th className="h-11 px-2 text-center whitespace-nowrap">프로그램 사용</th>
                  <th className="h-11 px-2">프로그램 아이디</th>
                  <th className="h-11 px-2">프로그램 비밀번호</th>
                  <th className="h-11 px-2">IP 주소</th>
                  <th className="h-11 px-2">MAC 주소</th>
                  <th className="h-11 px-2 whitespace-nowrap">S/N</th>
                  <th className="h-11 px-2">비고1</th>
                  <th className="h-11 px-2">비고2</th>
                  <th className="h-11 px-2 text-center whitespace-nowrap">관리액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan={13} className="p-10 text-center text-slate-400 text-xs">
                      불러오는 중…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-10 text-center text-slate-400 text-xs">
                      등록된 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={row.id} className="h-12 hover:bg-slate-50/60">
                      <td className="px-2 text-center text-slate-400 font-mono text-[10px]">
                        {rows.length - idx}
                      </td>
                      <td className="px-2 text-slate-900">{row.person_name}</td>
                      <td className="px-2 text-center tabular-nums">
                        {row.registered_date || '-'}
                      </td>
                      <td className="px-2 max-w-[140px] truncate" title={row.program_type || ''}>
                        {row.program_type || '-'}
                      </td>
                      <td className="px-2 text-center">
                        {row.program_used ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100">
                            사용
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-2 font-mono text-[10px]">{row.program_id || '-'}</td>
                      <td className="px-2 font-mono text-[10px] tracking-wider">
                        {displayPassword(row)}
                      </td>
                      <td className="px-2 font-mono text-[10px] tracking-normal">{row.ip_address || '-'}</td>
                      <td className="px-2 font-mono text-[10px] tracking-normal">{row.mac_address || '-'}</td>
                      <td className="px-2 max-w-[140px] truncate font-mono text-[10px] tracking-normal" title={row.note1 || ''}>
                        {row.note1 || '-'}
                      </td>
                      <td className="px-2 max-w-[120px] truncate" title={row.note2 || ''}>
                        {row.note2 || '-'}
                      </td>
                      <td className="px-2 max-w-[120px] truncate" title={row.note3 || ''}>
                        {row.note3 || '-'}
                      </td>
                      <td className="px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={!isEditor}
                            onClick={() => openEdit(row)}
                            title={isEditor ? '수정' : '수정은 Edit 권한이 필요합니다.'}
                            className={`px-2 py-1 rounded-lg text-[9px] font-black border transition-colors ${
                              isEditor
                                ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer'
                                : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                            }`}
                          >
                            수정(Edit)
                          </button>
                          <button
                            type="button"
                            disabled={!isEditor}
                            onClick={() => handleDelete(row)}
                            title={isEditor ? '삭제' : '삭제는 Edit 권한이 필요합니다.'}
                            className={`px-2 py-1 rounded-lg text-[9px] font-black border transition-colors ${
                              isEditor
                                ? 'bg-white border-red-200 text-red-500 hover:bg-red-50 cursor-pointer'
                                : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                            }`}
                          >
                            삭제(Edit)
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modalMode && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800">
                {modalMode === 'add' ? '프로그램 사용 신규 등록' : '프로그램 사용 수정'}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                닫기
              </button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              {(
                [
                  ['person_name', '이름 *', 'text'],
                  ['registered_date', '등록일', 'date'],
                  ['program_type', '프로그램종류', 'text'],
                  ['program_id', '프로그램 아이디', 'text'],
                  ['program_password', '프로그램 비밀번호', 'text'],
                  ['ip_address', 'IP 주소', 'text'],
                  ['mac_address', 'MAC 주소', 'text'],
                  ['note1', 'S/N', 'text'],
                  ['note2', '비고1', 'text'],
                  ['note3', '비고2', 'text'],
                ] as const
              ).map(([key, label, type]) => {
                const monoKeys = new Set(['ip_address', 'mac_address', 'note1', 'program_id']);
                return (
                  <label key={key} className="block">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide">
                      {label}
                    </span>
                    <input
                      type={type}
                      value={String((form as any)[key] ?? '')}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className={`mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 outline-none focus:border-indigo-400 ${
                        monoKeys.has(key) ? 'font-mono tracking-normal' : ''
                      }`}
                    />
                  </label>
                );
              })}
              <label className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={!!form.program_used}
                  onChange={(e) => setForm({ ...form, program_used: e.target.checked })}
                  className="accent-indigo-600 w-3.5 h-3.5"
                />
                <span className="text-xs font-bold text-slate-700">프로그램 사용여부: 사용</span>
              </label>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                disabled={saving}
                onClick={() => setModalMode(null)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-500 border border-slate-200 bg-white"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
