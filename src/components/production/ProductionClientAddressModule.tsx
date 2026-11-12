'use client';

/**
 * 제작물 코너 — 고객사 주소 관리 (구 마케팅 client-search 이관)
 * 제외: 부서관리 · 지급이력 · 보관함(주고객사는 운영/보관 구분 없음)
 * 데이터: `/api/marketing/clients`
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { getKSTDateString } from '@/utils/dateUtils';
import { resolveInterfaceEditState, isSystemLv1User } from '@/lib/permission-utils';
import {
  formatMarketingClientLocation,
  marketingClientNameDupKey,
} from '@/lib/marketing-client-address';
import {
  writeClientAddressListExcelBuffer,
  writeClientAddressUploadTemplateBuffer,
} from '@/lib/production-sign-excel';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
import DeptAssigneeLine, { useDeptAssignees } from '@/components/common/DeptAssigneeLine';

const MENU_PATH = '/production/custom/clients';

const HeaderLight = ({
  title,
  count,
  extraLeft,
  children,
}: {
  title: string;
  count: number;
  extraLeft?: React.ReactNode;
  children?: React.ReactNode;
}) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <div className="flex items-center gap-2 shrink-0 flex-wrap">
      <div className="w-2.5 h-2.5 rounded-full bg-sky-600" />
      <h2 className="text-sm font-medium text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-medium bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
        {count}건
      </span>
      {extraLeft}
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

/** 등록 직후 updatedAt ≈ createdAt 이면 수정한 적 없음 → '-' */
function displayUpdatedDate(createdAt: unknown, updatedAt: unknown): string {
  if (!updatedAt) return '-';
  const updatedMs = new Date(updatedAt as string | Date).getTime();
  if (!Number.isFinite(updatedMs)) return '-';
  if (createdAt) {
    const createdMs = new Date(createdAt as string | Date).getTime();
    if (Number.isFinite(createdMs) && updatedMs <= createdMs + 2000) return '-';
  }
  return getKSTDateString(updatedAt as string | number | Date) || '-';
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
  const { editorNames } = useDeptAssignees(MENU_PATH);
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
  const [actionMenu, setActionMenu] = useState<{ id: string; top: number; left: number } | null>(
    null
  );
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

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
      let clientsFailDetail = '';
      if (cRes.ok) setClients(await cRes.json());
      else {
        setClients([]);
        failed.push('고객사');
        try {
          const errBody = await cRes.json();
          clientsFailDetail = String(errBody?.error || errBody?.message || '').trim();
        } catch {
          clientsFailDetail = '';
        }
        if (clientsFailDetail) {
          clientsFailDetail = `${clientsFailDetail} [${cRes.status}]`;
        } else {
          clientsFailDetail = `HTTP ${cRes.status}`;
        }
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
              : clientsFailDetail
                ? `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')}) — ${clientsFailDetail}`
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

  useEffect(() => {
    setActionMenu(null);
  }, [currentPage, searchNameQuery, searchLocationQuery, selectedCategory]);

  useEffect(() => {
    if (!actionMenu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (actionMenuRef.current?.contains(t)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-action-kebab]')) return;
      setActionMenu(null);
    };
    const onWin = () => setActionMenu(null);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onWin, true);
    window.addEventListener('resize', onWin);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onWin, true);
      window.removeEventListener('resize', onWin);
    };
  }, [actionMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const scriptId = 'kakao-postcode-script-production-clients';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  const openClientPostcode = () => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: { zonecode?: string; roadAddress?: string; address?: string }) => {
          setFormData((prev) => ({
            ...prev,
            zip_code: String(data.zonecode || '').trim(),
            address_road: String(data.roadAddress || data.address || '').trim(),
            address_detail: '',
          }));
        },
      }).open();
    } else {
      alert('주소 검색 엔진을 로드 중입니다. 잠시 후 다시 클릭해 주세요.');
    }
  };

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

  const handleExcelDownload = async () => {
    if (!canEditMaster) return alert('엑셀 다운로드는 편집 권한이 필요합니다.');
    const targetList =
      selectedClientIds.size > 0
        ? clients.filter((c) => selectedClientIds.has(c.id))
        : filteredClients;
    if (targetList.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const dash = (v: unknown) => {
      const s = String(v ?? '').trim();
      return s || '-';
    };

    const rows = targetList.map((c, idx) => {
      const listIdx = filteredClients.findIndex((row) => row.id === c.id);
      const no = listIdx >= 0 ? filteredClients.length - listIdx : idx + 1;
      return {
        NO: no,
        고객사명: dash(c.name),
        업무범주: dash(c.category),
        우편번호: dash(c.zip_code),
        '기본(도로명)주소': dash(c.address_road),
        상세주소: dash(c.address_detail),
        소재지: dash(formatMarketingClientLocation(c)),
        관리비고: dash(c.note),
        등록일: c.createdAt ? getKSTDateString(c.createdAt) || '-' : '-',
        수정일: displayUpdatedDate(c.createdAt, c.updatedAt),
      };
    });

    try {
      const buffer = await writeClientAddressListExcelBuffer(rows);
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `고객사_주소_목록_${getKSTDateString()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
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
      const buffer = await writeClientAddressUploadTemplateBuffer(
        categories,
        sampleCategory
      );
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

  const clientAddressSheetRows = (
    sheet: XLSX.WorkSheet
  ): Record<string, unknown>[] => {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as unknown[][];
    if (!aoa.length) return [];
    const asText = (row: unknown[] | undefined) =>
      (row || []).map((c) => String(c ?? '').trim());
    const row0 = asText(aoa[0]);
    const row1 = asText(aoa[1]);
    const grouped =
      row1.includes('고객사명') &&
      (row0.includes('고객사정보') || row0.includes('주소정보') || row0.includes('NO'));
    const headerRow = grouped ? row1 : row0;
    const dataStart = grouped ? 2 : 1;
    const keys = headerRow.map((h, i) => h || `col${i}`);
    const out: Record<string, unknown>[] = [];
    for (let r = dataStart; r < aoa.length; r += 1) {
      const line = aoa[r] || [];
      const rec: Record<string, unknown> = {};
      keys.forEach((k, i) => {
        rec[k] = line[i];
      });
      out.push(rec);
    }
    return out;
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'array', cellDates: true });
        const skipSheets = new Set(['작성안내', '업무범주목록']);
        const preferred =
          wb.SheetNames.find((n) => n === '고객사_주소') ||
          wb.SheetNames.find((n) => n === '고객사_업로드양식') ||
          wb.SheetNames.find((n) => !skipSheets.has(n)) ||
          wb.SheetNames[0];
        const rows = clientAddressSheetRows(wb.Sheets[preferred]);
        if (!rows.length) {
          alert('엑셀에 업로드할 데이터가 없습니다.');
          return;
        }

        /** (주)/주식회사·공백 무시 키 */
        const existingNames = new Set(
          clients.map((c) => marketingClientNameDupKey(c.name)).filter(Boolean)
        );
        const valid: Array<{
          name: string;
          category: string;
          zip_code: string;
          address_road: string;
          address_detail: string;
          note: string;
        }> = [];
        let skippedDup = 0;
        let skippedInvalid = 0;
        let scanned = 0;

        for (const row of rows) {
          const name = cellStr(row, '고객사명');
          const categoryRaw = cellStr(row, '업무범주');
          const zip = cellStr(row, '우편번호');
          const road = cellStr(row, '기본(도로명)주소');
          const detail = cellStr(row, '상세주소');
          const note = cellStr(row, '관리비고', '비고');
          if (!name && !categoryRaw && !zip && !road && !detail && !note) continue;
          if (name === '예시고객사') continue;
          scanned++;
          if (!name) {
            skippedInvalid++;
            continue;
          }
          const nameKey = marketingClientNameDupKey(name);
          if (!nameKey || existingNames.has(nameKey)) {
            if (nameKey) skippedDup++;
            else skippedInvalid++;
            continue;
          }

          let category = categoryRaw;
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
            zip_code: zip,
            address_road: road,
            address_detail: detail,
            note,
          });
        }

        if (scanned === 0) {
          alert('엑셀에 업로드할 데이터가 없습니다.');
          return;
        }

        if (valid.length === 0) {
          alert(
            `업로드할 신규 고객사가 없습니다.\n(전체 ${scanned}건 · 중복 ${skippedDup}건 · 형식오류 ${skippedInvalid}건)`
          );
          return;
        }

        if (skippedDup > 0 || skippedInvalid > 0) {
          alert(
            `총 ${scanned}건 중 신규 ${valid.length}건을 등록합니다.\n(중복 제외 ${skippedDup}건 · 형식오류 ${skippedInvalid}건)`
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

  const myEmail = String(currentUser?.email || '')
    .trim()
    .toLowerCase();
  const isOwnClient = (client: { creator_email?: string | null }) => {
    const creator = String(client?.creator_email || '')
      .trim()
      .toLowerCase();
    return Boolean(myEmail && creator && myEmail === creator);
  };
  const canDeleteClient = (client: any) => canEditMaster || isOwnClient(client);

  const openClientEdit = (client: any) => {
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
  };

  const openActionMenu = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    const width = 160;
    const r = e.currentTarget.getBoundingClientRect();
    setActionMenu((prev) =>
      prev?.id === id
        ? null
        : {
            id,
            top: r.bottom + 4,
            left: Math.min(Math.max(12, r.right - width), window.innerWidth - width - 12),
          }
    );
  };

  const handleDeleteClient = async (id: string) => {
    const client = clients.find((c) => c.id === id);
    if (!client) return;
    if (!canDeleteClient(client)) {
      return alert('삭제는 편집(Edit) 권한이 있거나, 본인이 등록한 고객사만 가능합니다.');
    }
    if (
      !confirm(
        '정말 삭제하시겠습니까?\n주소 목록에서 제거되며, 기존 지급 이력 문구는 유지됩니다.'
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
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-lg text-xs font-bold flex justify-between items-center gap-4">
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

      <div className="w-full bg-gradient-to-r from-sky-900 to-slate-800 rounded-lg text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-sky-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-sky-300 mb-2.5">
            PRODUCTION CLIENT ADDRESS
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-white font-medium">고객사 주소관리</span>
          </h1>
          <p className="text-sky-100/90 text-xs mt-3 leading-relaxed">
            제작물 배송·현판 신청에 쓰는 고객사 주소(회사명·업무범주·소재지)를 등록·관리합니다.
          </p>
          {permissionSummary && isSystemLv1User(currentUser) && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-white/10 border-white/25 text-sky-50 shadow-sm">
                <span>👑 Master 책임자:</span>
                <span>{permissionSummary.masterName}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
                <span>👁️ Access:</span>
                <span>{permissionSummary.accessDesignate}</span>
                <span className="opacity-50">|</span>
                <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.accessLevel}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-sky-400/20 border-sky-300/40 text-sky-100 shadow-sm">
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
          <button
            type="button"
            onClick={handleExcelDownload}
            className="px-3 py-1.5 rounded-lg text-[10px] font-medium shadow-sm whitespace-nowrap transition-all bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {selectedClientIds.size > 0
              ? `선택 EXCEL 다운로드(${selectedClientIds.size})(Edit)`
              : '목록 EXCEL 다운로드(Edit)'}
          </button>
        )}
        <button
          type="button"
          onClick={handleExcelTemplateDownload}
          className="px-3 py-1.5 rounded-lg text-[10px] font-medium shadow-sm whitespace-nowrap transition-all bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50"
        >
          업로드 양식 다운
        </button>
        <button
          type="button"
          onClick={() => excelUploadInputRef.current?.click()}
          className="px-3 py-1.5 rounded-lg text-[10px] font-medium shadow-sm whitespace-nowrap transition-all bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-600 hover:text-white"
        >
          + 엑셀 업로드
        </button>
        <input
          type="file"
          ref={excelUploadInputRef}
          onChange={handleExcelUpload}
          accept=".xlsx,.xls"
          className="hidden"
        />
        <button
          type="button"
          onClick={() => {
            setEditClient(null);
            setFormData(emptyClientForm);
            setShowModal(true);
          }}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-medium shadow-sm hover:bg-sky-700 transition-all whitespace-nowrap"
        >
          + 신규 등록
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <HeaderLight
          title="고객사 주소 대장"
          count={filteredClients.length}
          extraLeft={
            <DeptAssigneeLine
              editorNames={editorNames}
              label="👤 편집 권한자"
              popupLabel="편집 권한자"
              showIcon={false}
            />
          }
        >
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <span className="text-[10px] font-medium text-slate-400 uppercase">업무범주</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent max-w-[140px]"
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
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:border-sky-500 shadow-sm"
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
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:border-sky-500 shadow-sm"
              />
            </div>
          </div>
        </HeaderLight>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left border-collapse min-w-[960px]">
            <colgroup>
              {showSelection && <col className="w-10" />}
              <col className="w-12" />
              <col className="w-[20%]" />
              <col className="w-[12%]" />
              <col className="w-[36%]" />
              <col className="w-[12%]" />
              <col className="w-[128px]" />
              <col className="w-14" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-medium uppercase tracking-widest border-b border-slate-200">
              <tr>
                {showSelection && (
                  <th className="h-12 text-center pl-4">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      onChange={handleSelectAll}
                      className="w-3 h-3 accent-sky-600 cursor-pointer"
                    />
                  </th>
                )}
                <th className="h-12 text-center">NO</th>
                <th className="h-12 pl-3 text-left">회사명</th>
                <th className="h-12 px-3 text-left">업무범주</th>
                <th className="h-12 px-3 text-left">소재지 주소</th>
                <th className="h-12 pl-5 pr-3 text-left">관리비고</th>
                <th className="h-12 pl-6 pr-3 text-left whitespace-nowrap">등록/수정일</th>
                <th className="h-12 pr-4 text-center whitespace-nowrap">관리액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-medium text-slate-700">
              {paginatedClients.length === 0 ? (
                <tr>
                  <td colSpan={tableColCount} className="p-16 text-center text-slate-400 text-xs font-medium">
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
                      <td className="text-center font-medium tabular-nums text-slate-400">
                        {filteredClients.length - ((currentPage - 1) * itemsPerPage + idx)}
                      </td>
                      <td className="pl-3 pr-2 text-left max-w-0">
                        <span
                          className="block font-bold text-[13px] text-slate-900 truncate"
                          title={client.name}
                        >
                          {client.name}
                        </span>
                      </td>
                      <td
                        className="px-3 text-left text-sky-700 font-medium truncate max-w-0"
                        title={client.category}
                      >
                        {client.category || '-'}
                      </td>
                      <td
                        className="px-3 text-left text-slate-500 truncate max-w-0"
                        title={formatMarketingClientLocation(client) || '-'}
                      >
                        {formatMarketingClientLocation(client) || '-'}
                      </td>
                      <td
                        className="pl-5 pr-3 text-left text-slate-500 truncate"
                        title={client.note || '-'}
                      >
                        {client.note || '-'}
                      </td>
                      <td className="pl-6 pr-3 text-left whitespace-nowrap">
                        {(() => {
                          // DB: createdAt(@default(now)) · updatedAt(@updatedAt) — 신규/수정 시 Prisma 자동 반영
                          // 표시: 코드베이스 공통 getKSTDateString → KST YYYY-MM-DD
                          const created = client.createdAt
                            ? getKSTDateString(client.createdAt) || '-'
                            : '-';
                          const updated = displayUpdatedDate(
                            client.createdAt,
                            client.updatedAt
                          );
                          return (
                            <div
                              className="flex flex-col items-start gap-0.5 leading-tight"
                              title={`등록 ${created} · 수정 ${updated}`}
                            >
                              <span className="text-xs font-medium text-slate-400">
                                등록{' '}
                                <span className="font-mono tabular-nums text-slate-600">
                                  {created}
                                </span>
                              </span>
                              <span className="text-xs font-medium text-slate-400">
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
                        <button
                          type="button"
                          data-action-kebab
                          title="더보기"
                          onClick={(e) => openActionMenu(e, client.id)}
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
                            actionMenu?.id === client.id
                              ? 'bg-slate-200 text-slate-800'
                              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                          }`}
                        >
                          <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor" aria-hidden>
                            <circle cx="10" cy="4.5" r="1.6" />
                            <circle cx="10" cy="10" r="1.6" />
                            <circle cx="10" cy="15.5" r="1.6" />
                          </svg>
                        </button>
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

      {actionMenu &&
        createPortal(
          <div
            ref={actionMenuRef}
            style={{ top: actionMenu.top, left: actionMenu.left }}
            className="fixed z-[500] w-[160px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-left"
          >
            {(() => {
              const row = clients.find((c) => c.id === actionMenu.id);
              if (!row) return null;
              return (
                <>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setActionMenu(null);
                      openClientEdit(row);
                    }}
                  >
                    수정
                  </button>
                  {canDeleteClient(row) ? (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                      onClick={() => {
                        setActionMenu(null);
                        void handleDeleteClient(row.id);
                      }}
                    >
                      {isOwnClient(row) ? '삭제' : '삭제(Edit)'}
                    </button>
                  ) : null}
                </>
              );
            })()}
          </div>,
          document.body
        )}

      {showModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-6"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white w-full max-w-[420px] p-8 rounded-lg shadow-2xl flex flex-col border border-slate-200"
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-slate-600">배송지 주소</span>
                  <button
                    type="button"
                    onClick={openClientPostcode}
                    className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-medium hover:bg-slate-800 transition-colors shadow-sm"
                    title="우편번호 검색"
                  >
                    신규 검색
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-slate-600">우편번호</label>
                  <input
                    type="text"
                    readOnly
                    value={formData.zip_code}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-medium outline-none font-mono text-sky-700"
                    placeholder="신규 검색으로 자동 입력"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-slate-600">기본(도로명) 주소</label>
                  <input
                    type="text"
                    value={formData.address_road}
                    onChange={(e) => setFormData({ ...formData, address_road: e.target.value })}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-medium outline-none focus:border-sky-500 focus:bg-white"
                    placeholder="검색 후 필요 시 수정 가능"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-slate-600">상세주소</label>
                  <input
                    type="text"
                    value={formData.address_detail}
                    onChange={(e) => setFormData({ ...formData, address_detail: e.target.value })}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-medium outline-none focus:border-sky-500 focus:bg-white"
                    placeholder="동·호수·층 등"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-slate-600">관리비고</label>
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
