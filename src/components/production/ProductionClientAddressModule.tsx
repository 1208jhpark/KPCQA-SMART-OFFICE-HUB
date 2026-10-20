'use client';

/**
 * 제작물 코너 — 고객사 주소 관리
 * ClientSearchModule 기능을 복사·축소.
 * 제외: 부서관리 · 지급이력 · 보관함(주고객사는 운영/보관 구분 없음)
 * 데이터: 동일 `/api/marketing/clients`
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { getKSTDateString } from '@/utils/dateUtils';
import { resolveInterfaceEditState, isSystemLv1User } from '@/lib/permission-utils';
import { formatMarketingClientLocation } from '@/lib/marketing-client-address';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';

const MENU_PATH = '/production/custom/clients';

const HeaderLight = ({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children?: React.ReactNode;
}) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <div className="flex items-center gap-2 shrink-0">
      <div className="w-2.5 h-2.5 rounded-full bg-sky-600" />
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
        {count}건
      </span>
    </div>
    {children ? (
      <div className="flex items-center gap-2 flex-wrap justify-end min-w-0">{children}</div>
    ) : null}
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

const emptyClientForm = {
  name: '',
  zip_code: '',
  address_road: '',
  address_detail: '',
  category: '',
  note: '',
};

export default function ProductionClientAddressModule() {
  const [clients, setClients] = useState<any[]>([]);
  const [masterCategories, setMasterCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchNameQuery, setSearchNameQuery] = useState('');
  const [searchLocationQuery, setSearchLocationQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState<any>(null);
  const [formData, setFormData] = useState(emptyClientForm);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const excelUploadInputRef = useRef<HTMLInputElement>(null);

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
  const [restoringSeeds, setRestoringSeeds] = useState(false);

  const fetchClients = async () => {
    setLoadError(null);
    try {
      const ts = Date.now();
      const [cRes, mRes, sysRes, ifRes, meRes, summaryRes] = await Promise.all([
        fetch('/api/marketing/clients?includeArchived=1&t=' + ts),
        fetch('/api/admin/master-data?t=' + ts),
        fetch('/api/admin/config?t=' + ts),
        fetch('/api/admin/interface?t=' + ts),
        fetch('/api/auth/me?t=' + ts),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`),
      ]);

      const failed: string[] = [];
      if (cRes.ok) setClients(await cRes.json());
      else {
        setClients([]);
        failed.push('고객사');
      }
      if (meRes.ok) setCurrentUser(await meRes.json());
      else failed.push('사용자');

      let configData: any = null;
      if (sysRes.ok) configData = await sysRes.json();

      if (ifRes.ok) {
        const interfaces = await ifRes.json();
        const config = Array.isArray(interfaces)
          ? interfaces.find(
              (m: any) => m.path === MENU_PATH || m.path?.includes('/production/custom/clients')
            )
          : null;
        setInterfaceConfig(config || null);
      }

      if (summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);

      if (mRes.ok && configData?.client_category_group) {
        const masterData = await mRes.json();
        const categoryGroup = masterData.find(
          (g: any) => g.id === configData.client_category_group
        );
        if (categoryGroup?.codes) {
          setMasterCategories(
            categoryGroup.codes
              .filter((c: any) => c.is_active && !c.is_archived)
              .sort((a: any, b: any) => a.sort_order - b.sort_order)
              .map((c: any) => c.label)
          );
        }
      }

      if (failed.length > 0) {
        const status = [cRes, meRes].find((r) => !r.ok)?.status;
        setLoadError(
          status === 401
            ? '로그인 세션이 만료되었거나 권한이 없습니다.'
            : status === 403
              ? '고객사 주소 메뉴 접근 권한이 없습니다.'
              : `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')})`
        );
      }
    } catch (e) {
      console.error('Production client fetch error:', e);
      setClients([]);
      setLoadError('네트워크 오류로 데이터를 불러오지 못했습니다.');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const uniqueCategories = useMemo(() => {
    const categories = clients.map((c) => c.category).filter(Boolean);
    return Array.from(new Set(categories)).sort();
  }, [clients]);

  const filteredClients = useMemo(() => {
    const nameQ = searchNameQuery.trim().toLowerCase();
    const locQ = searchLocationQuery.trim().toLowerCase();
    return clients
      .filter((c) => {
        const matchCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
        const matchName = !nameQ || (c.name || '').toLowerCase().includes(nameQ);
        const locText = formatMarketingClientLocation(c);
        const matchLocation = !locQ || locText.toLowerCase().includes(locQ);
        return matchCategory && matchName && matchLocation;
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  }, [clients, searchNameQuery, searchLocationQuery, selectedCategory]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedClientIds(new Set());
  }, [searchNameQuery, searchLocationQuery, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / itemsPerPage));
  const paginatedClients = filteredClients.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const myRoles = useMemo(() => normalizeRoles(currentUser?.roles), [currentUser]);
  const isLv1 = myRoles.includes('LV_1');
  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  useEffect(() => {
    if (!canEditMaster) setSelectedClientIds(new Set());
  }, [canEditMaster]);

  const clientHasDistributions = (client: any) => Number(client?.distCount ?? 0) > 0;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const visibleIds = paginatedClients.map((c) => c.id);
      setSelectedClientIds(new Set([...selectedClientIds, ...visibleIds]));
    } else {
      const next = new Set(selectedClientIds);
      paginatedClients.forEach((c) => next.delete(c.id));
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
    if (!canEditMaster) return alert('엑셀 다운로드는 편집 권한이 필요합니다.');
    const targetList =
      selectedClientIds.size > 0
        ? clients.filter((c) => selectedClientIds.has(c.id))
        : filteredClients;
    if (targetList.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const dataToExport = targetList.map((c) => ({
      고객사명: c.name,
      업무범주: c.category || '-',
      소재지: formatMarketingClientLocation(c) || '-',
      우편번호: c.zip_code || '-',
      '기본(도로명)주소': c.address_road || '-',
      상세주소: c.address_detail || '-',
      비고: c.note || '-',
      등록일: c.createdAt ? getKSTDateString(c.createdAt) : '-',
      수정일: c.updatedAt ? getKSTDateString(c.updatedAt) : '-',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '고객사_주소');
    XLSX.writeFile(wb, `고객사_주소_${getKSTDateString()}.xlsx`);
  };

  const cellStr = (row: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null) {
        const s = String(row[key]).trim().replace(/\s+/g, ' ');
        if (s && s !== '-' && s !== '—') return s;
      }
    }
    return '';
  };

  const handleExcelTemplateDownload = async () => {
    if (!canEditMaster) return alert('업로드 양식 다운로드는 편집 권한이 필요합니다.');
    const categories =
      masterCategories.length > 0
        ? masterCategories.map((c) => String(c).trim()).filter(Boolean)
        : [
            '건물 인증 관련',
            'ISO 인증 관련',
            '지속가능 인증 관련',
            'ESG 인증 관련',
            '협력사',
            '용역',
            '행사',
            '기타',
          ];
    const sampleCategory = categories[0] || '';

    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'KPCQA WISE';

      const sheet = workbook.addWorksheet('고객사_업로드양식');
      const headers = [
        '고객사명',
        '업무범주',
        '소재지',
        '우편번호',
        '기본(도로명)주소',
        '상세주소',
        '비고',
      ];
      sheet.addRow(headers);
      sheet.addRow([
        '예시고객사',
        sampleCategory,
        '',
        '12345',
        '서울특별시 예시구 예시로 1',
        '101호',
        '',
      ]);
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
      [22, 22, 16, 12, 36, 18, 24].forEach((w, i) => {
        sheet.getColumn(i + 1).width = w;
      });

      const listSheet = workbook.addWorksheet('업무범주목록');
      categories.forEach((cat, i) => {
        listSheet.getCell(i + 1, 1).value = cat;
      });
      listSheet.getColumn(1).width = 28;
      listSheet.state = 'hidden';

      const listEnd = Math.max(categories.length, 1);
      const dvFormula = `'업무범주목록'!$A$1:$A$${listEnd}`;
      for (let r = 2; r <= 501; r++) {
        sheet.getCell(r, 2).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [dvFormula],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: '업무범주',
          error: `다음 중 선택해 주세요.\n${categories.join('\n')}`,
          showInputMessage: true,
          promptTitle: '업무범주',
          prompt: `선택 가능: ${categories.join(' / ')}`,
        };
      }

      const guide = workbook.addWorksheet('작성안내');
      guide.getCell(1, 1).value = '고객사 주소 엑셀 업로드 안내';
      guide.getCell(1, 1).font = { bold: true, size: 13 };
      guide.getCell(3, 1).value =
        '1) 「고객사_업로드양식」시트에 데이터를 입력한 뒤 업로드하세요.';
      guide.getCell(4, 1).value = '2) 업무범주 칸은 드롭다운에서 선택하세요.';
      guide.getCell(5, 1).value =
        '3) 이미 등록된 고객사명은 업로드되지 않습니다. 상태는 운영중으로 등록됩니다.';
      guide.getColumn(1).width = 72;

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `고객사_주소_업로드양식_${getKSTDateString()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('업로드 양식 생성에 실패했습니다.');
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEditMaster) {
      e.target.value = '';
      return alert('엑셀 업로드는 편집 권한이 필요합니다.');
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'array', cellDates: true });
        const preferred =
          wb.SheetNames.find((n) => n === '고객사_업로드양식') || wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[preferred]);
        if (!rows.length) {
          alert('엑셀에 업로드할 데이터가 없습니다.');
          return;
        }

        const existingNames = new Set(
          clients.map((c) => String(c.name || '').trim().toLowerCase()).filter(Boolean)
        );
        const valid: Array<{
          name: string;
          category: string;
          zip_code: string;
          address_road: string;
          address_detail: string;
          location: string;
          note: string;
        }> = [];
        let skippedDup = 0;
        let skippedInvalid = 0;

        for (const row of rows) {
          const name = cellStr(row, '고객사명');
          if (!name) {
            skippedInvalid++;
            continue;
          }
          const nameKey = name.toLowerCase();
          if (existingNames.has(nameKey)) {
            skippedDup++;
            continue;
          }

          let category = cellStr(row, '업무범주');
          if (masterCategories.length > 0) {
            if (!category) {
              skippedInvalid++;
              continue;
            }
            const matched = masterCategories.find(
              (c) => c.trim().toLowerCase() === category.toLowerCase()
            );
            if (!matched) {
              skippedInvalid++;
              continue;
            }
            category = matched;
          }

          existingNames.add(nameKey);
          valid.push({
            name,
            category,
            zip_code: cellStr(row, '우편번호'),
            address_road: cellStr(row, '기본(도로명)주소'),
            address_detail: cellStr(row, '상세주소'),
            location: cellStr(row, '소재지'),
            note: cellStr(row, '비고'),
          });
        }

        if (valid.length === 0) {
          alert(
            `업로드할 신규 고객사가 없습니다.\n(전체 ${rows.length}건 · 중복 ${skippedDup}건 · 형식오류 ${skippedInvalid}건)`
          );
          return;
        }

        if (skippedDup > 0 || skippedInvalid > 0) {
          alert(
            `총 ${rows.length}건 중 신규 ${valid.length}건을 등록합니다.\n(중복 제외 ${skippedDup}건 · 형식오류 ${skippedInvalid}건)`
          );
        }

        let ok = 0;
        let fail = 0;
        for (const item of valid) {
          const res = await fetch('/api/marketing/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (res.ok) ok++;
          else fail++;
        }

        alert(
          `고객사 주소 엑셀 업로드 완료\n성공 ${ok}건 · 실패 ${fail}건 · 중복 제외 ${skippedDup}건 · 형식오류 ${skippedInvalid}건`
        );
        fetchClients();
      } catch (error) {
        console.error(error);
        alert('엑셀 업로드 중 오류가 발생했습니다.');
        fetchClients();
      } finally {
        if (excelUploadInputRef.current) excelUploadInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
    if (excelUploadInputRef.current) excelUploadInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clientName = formData.name.trim().replace(/\s+/g, ' ');
    if (!clientName) return alert('고객사명은 필수입니다.');
    if (masterCategories.length > 0 && !formData.category) return alert('업무 범주를 선택해주세요.');

    const nameTaken = clients.some((c) => {
      if (editClient && c.id === editClient.id) return false;
      return String(c.name || '').trim().toLowerCase() === clientName.toLowerCase();
    });
    if (nameTaken) return alert(`이미 등록된 고객사명입니다. ("${clientName}")`);

    const method = editClient ? 'PATCH' : 'POST';
    const payload = editClient
      ? { id: editClient.id, ...formData, name: clientName }
      : { ...formData, name: clientName };
    const res = await fetch('/api/marketing/clients', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      alert(editClient ? '수정되었습니다.' : '등록되었습니다.');
      setShowModal(false);
      setEditClient(null);
      setFormData(emptyClientForm);
      fetchClients();
    } else {
      alert(await readApiError(res, editClient ? '수정에 실패했습니다.' : '등록에 실패했습니다.'));
    }
  };

  const handleRestoreSeeds = async () => {
    if (!isLv1) {
      return alert('시드 고객사 복구는 최고 관리자(LV_1)만 가능합니다.');
    }
    if (
      !confirm(
        '시드 고객사 중 아직 없는 회사명만 추가합니다.\n이미 등록된 회사명은 덮어쓰지 않습니다. 계속할까요?'
      )
    ) {
      return;
    }
    setRestoringSeeds(true);
    try {
      const res = await fetch('/api/marketing/clients/restore-seeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore-seeds' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || data.message || '시드 고객사 복구 실패');
        return;
      }
      alert(data.message || '시드 고객사 복구 완료');
      await fetchClients();
    } catch {
      alert('시드 고객사 복구 중 오류가 발생했습니다.');
    } finally {
      setRestoringSeeds(false);
    }
  };

  const handleDeleteClient = async (id: string) => {
    const client = clients.find((c) => c.id === id);
    if (!canEditMaster) {
      return alert('삭제는 편집(Edit) 권한이 필요합니다.');
    }
    if (clientHasDistributions(client)) {
      return alert('지급 이력이 있어 삭제할 수 없습니다.');
    }
    if (
      !confirm(
        '정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 마스터에서 완전히 삭제됩니다.'
      )
    ) {
      return;
    }
    const res = await fetch(`/api/marketing/clients?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchClients();
      alert('삭제되었습니다.');
    } else {
      alert(await readApiError(res, '삭제 실패'));
    }
  };

  if (loading) return <LoadingState />;

  const isAllPageSelected =
    paginatedClients.length > 0 && paginatedClients.every((c) => selectedClientIds.has(c.id));
  const showSelection = canEditMaster;
  const tableColCount = (showSelection ? 1 : 0) + 7;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-bold flex justify-between items-center gap-4">
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchClients();
            }}
            className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-black hover:bg-amber-700"
          >
            다시 시도
          </button>
        </div>
      )}

      <div className="w-full bg-gradient-to-r from-sky-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-sky-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-sky-300 mb-2.5">
            PRODUCTION CLIENT ADDRESS
          </h3>
          <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
            고객사 주소관리
          </h1>
          <p className="text-sky-100/90 text-xs mt-3 leading-relaxed">
            제작물 배송·현판 신청에 쓰는 고객사 주소(회사명·업무범주·소재지)를 등록·관리합니다.
          </p>
          {permissionSummary && isSystemLv1User(currentUser) && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-sky-50 shadow-sm">
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
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-sky-400/20 border-sky-300/40 text-sky-100 shadow-sm">
                <span>✍️ Edit:</span>
                <span>{permissionSummary.editDesignate}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.editLevel}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 flex-wrap px-0.5">
        {canEditMaster && (
          <>
            <button
              type="button"
              onClick={handleExcelDownload}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm whitespace-nowrap transition-all bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {selectedClientIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedClientIds.size})(Edit)`
                : '화면 목록 EXCEL 다운로드(Edit)'}
            </button>
            <button
              type="button"
              onClick={handleExcelTemplateDownload}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm whitespace-nowrap transition-all bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50"
            >
              업로드 양식 다운(Edit)
            </button>
            <button
              type="button"
              onClick={() => excelUploadInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm whitespace-nowrap transition-all bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-600 hover:text-white"
            >
              + 엑셀 업로드(Edit)
            </button>
            <input
              type="file"
              ref={excelUploadInputRef}
              onChange={handleExcelUpload}
              accept=".xlsx,.xls"
              className="hidden"
            />
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setEditClient(null);
            setFormData(emptyClientForm);
            setShowModal(true);
          }}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-sky-700 transition-all whitespace-nowrap"
        >
          + 신규 등록
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <HeaderLight title="고객사 주소 대장" count={filteredClients.length}>
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <span className="text-[10px] font-black text-slate-400 uppercase">업무범주</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
            >
              <option value="ALL">전체</option>
              {uniqueCategories.map((cat) => (
                <option key={cat as string} value={cat as string}>
                  {cat as string}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-40">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">
                🏢
              </span>
              <input
                type="text"
                placeholder="회사명 검색..."
                value={searchNameQuery}
                onChange={(e) => setSearchNameQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-sky-500 shadow-sm"
              />
            </div>
            <div className="relative w-36">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">
                📍
              </span>
              <input
                type="text"
                placeholder="소재지 검색..."
                value={searchLocationQuery}
                onChange={(e) => setSearchLocationQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-sky-500 shadow-sm"
              />
            </div>
          </div>
        </HeaderLight>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                {showSelection && (
                  <th className="h-12 text-center w-[40px] pl-4">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      onChange={handleSelectAll}
                      className="w-3 h-3 accent-sky-600 cursor-pointer"
                    />
                  </th>
                )}
                <th className="h-12 text-center w-[50px]">NO</th>
                <th className="h-12 pl-3 text-left w-[240px]">회사명</th>
                <th className="h-12 px-3 text-left w-[140px]">업무범주</th>
                <th className="h-12 px-3 text-left">소재지 주소</th>
                <th className="h-12 px-3 text-left w-[180px]">비고</th>
                <th className="h-12 px-2 text-center w-[110px] whitespace-nowrap">등록/수정일</th>
                <th className="h-12 pr-4 text-center w-[160px] whitespace-nowrap">관리액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedClients.length === 0 ? (
                <tr>
                  <td colSpan={tableColCount} className="p-16 text-center text-slate-400 text-sm">
                    조건에 맞는 고객사가 없습니다.
                  </td>
                </tr>
              ) : (
                paginatedClients.map((client, idx) => (
                    <tr key={client.id} className="h-14 hover:bg-slate-50 transition-colors">
                      {showSelection && (
                        <td className="text-center pl-4">
                          <input
                            type="checkbox"
                            checked={selectedClientIds.has(client.id)}
                            onChange={(e) => handleSelectOne(client.id, e.target.checked)}
                            className="w-3 h-3 accent-sky-600 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="text-center font-black tabular-nums text-slate-400">
                        {filteredClients.length - ((currentPage - 1) * itemsPerPage + idx)}
                      </td>
                      <td className="pl-3 truncate pr-2 text-left">
                        <span className="font-black text-[13px] text-slate-900 truncate" title={client.name}>
                          {client.name}
                        </span>
                      </td>
                      <td
                        className="px-3 text-left text-sky-700 font-black text-[11px] truncate"
                        title={client.category}
                      >
                        {client.category || '-'}
                      </td>
                      <td
                        className="px-3 text-left text-slate-500 text-[11px] truncate"
                        title={formatMarketingClientLocation(client) || '-'}
                      >
                        {formatMarketingClientLocation(client) || '-'}
                      </td>
                      <td
                        className="px-3 text-left text-slate-500 text-[11px] truncate"
                        title={client.note || '-'}
                      >
                        {client.note || '-'}
                      </td>
                      <td className="px-2 text-center whitespace-nowrap">
                        {(() => {
                          // DB: createdAt(@default(now)) · updatedAt(@updatedAt) — 신규/수정 시 Prisma 자동 반영
                          // 표시: 코드베이스 공통 getKSTDateString → KST YYYY-MM-DD
                          const created = client.createdAt
                            ? getKSTDateString(client.createdAt) || '-'
                            : '-';
                          const updated = client.updatedAt
                            ? getKSTDateString(client.updatedAt) || '-'
                            : '-';
                          return (
                            <div
                              className="flex flex-col items-center gap-0.5 leading-tight"
                              title={`등록 ${created} · 수정 ${updated}`}
                            >
                              <span className="text-[9px] font-bold text-slate-400">
                                등록{' '}
                                <span className="font-mono tabular-nums text-slate-600">
                                  {created}
                                </span>
                              </span>
                              <span className="text-[9px] font-bold text-slate-400">
                                수정{' '}
                                <span className="font-mono tabular-nums text-slate-700">
                                  {updated}
                                </span>
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="pr-4 text-center whitespace-nowrap">
                          <div className="flex justify-center items-center gap-1 flex-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditClient(client);
                                    setFormData({
                                      name: client.name,
                                      zip_code: client.zip_code || '',
                                      address_road: client.address_road || '',
                                      address_detail: client.address_detail || '',
                                      category: client.category || '',
                                      note: client.note || '',
                                    });
                                    setShowModal(true);
                                  }}
                                  className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[9px] font-black hover:bg-slate-50 shadow-sm"
                                >
                                  수정
                                </button>
                            {canEditMaster && !clientHasDistributions(client) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteClient(client.id)}
                                className="px-3 py-1 bg-red-50 border border-red-200 text-red-500 rounded-lg text-[9px] font-black hover:bg-red-500 hover:text-white shadow-sm"
                              >
                                삭제(Edit)
                              </button>
                            )}
                            {canEditMaster && clientHasDistributions(client) && (
                                <span
                                  className="px-2 py-1 text-[9px] font-black text-slate-400 border border-slate-200 rounded-lg"
                                  title="지급 이력이 있어 삭제할 수 없습니다"
                                >
                                  삭제불가
                                </span>
                              )}
                          </div>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>

        {filteredClients.length > 0 && (
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      {isLv1 && (
        <div className="flex justify-start px-1">
          <button
            type="button"
            onClick={handleRestoreSeeds}
            disabled={restoringSeeds}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm whitespace-nowrap bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {restoringSeeds ? '시드 복구 중…' : '시드 복구하기(LV_1)'}
          </button>
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-6"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white w-full max-w-[420px] p-8 rounded-[2rem] shadow-2xl flex flex-col border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-black text-lg text-slate-900 border-b border-slate-100 pb-4 mb-6 flex items-center gap-2">
              <span>{editClient ? '✏️' : '✨'}</span>
              {editClient ? '고객사 주소 수정' : '고객사 주소 신규 등록'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[12px] font-black text-slate-600">고객사 공식 회사명 *</label>
                <input
                  required
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-sky-500 focus:bg-white"
                  placeholder="회사명 풀명칭 입력"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-black text-slate-600">업무 범주 *</label>
                {masterCategories.length > 0 ? (
                  <select
                    required
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-sky-500 cursor-pointer"
                  >
                    <option value="">범주 선택</option>
                    {masterCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full p-3.5 bg-red-50 border border-red-200 rounded-xl text-[13px] font-bold outline-none"
                    placeholder="마스터 그룹 미매핑 — 직접 입력"
                  />
                )}
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-black text-slate-600">우편번호</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={formData.zip_code}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        zip_code: e.target.value.replace(/[^\d]/g, '').slice(0, 5),
                      })
                    }
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-sky-500 font-mono"
                    placeholder="5자리 우편번호"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-black text-slate-600">기본(도로명) 주소</label>
                  <input
                    type="text"
                    value={formData.address_road}
                    onChange={(e) => setFormData({ ...formData, address_road: e.target.value })}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-sky-500"
                    placeholder="도로명 주소"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-black text-slate-600">상세주소</label>
                  <input
                    type="text"
                    value={formData.address_detail}
                    onChange={(e) => setFormData({ ...formData, address_detail: e.target.value })}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-sky-500"
                    placeholder="동·호수·층 등"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-black text-slate-600">비고</label>
                  <textarea
                    value={formData.note}
                    onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                    rows={2}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-sky-500 resize-y min-h-[64px]"
                    placeholder="주소변경 이력기록, 선호 명판 등(선택)"
                  />
                </div>
              </div>
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-xl font-black text-[12px] hover:bg-slate-200"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-[2] py-4 bg-sky-600 text-white rounded-xl font-black text-[12px] shadow-lg hover:bg-sky-700"
                >
                  {editClient ? '수정 완료' : '등록 완료'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
