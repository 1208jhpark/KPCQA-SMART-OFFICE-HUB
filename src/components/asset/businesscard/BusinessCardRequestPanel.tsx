'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth } from '@/utils/dateUtils';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import {
  BUSINESS_CARD_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';
import BusinessCardAdminApplyModal from '@/components/asset/businesscard/BusinessCardAdminApplyModal';
import { formatBusinessCardEnNumber, stripBusinessCardEnPlus } from '@/lib/businesscard-phone';
import { formatBusinessCardAdminStatusLabel } from '@/lib/businesscard-status';

const MENU_PATH = '/asset/businesscard/master/requests';
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none hover:bg-slate-100';

const FOLDER_TABS = [
  { id: 'PENDING' as const, label: '접수대기', icon: '⏳', activeClass: 'bg-slate-900 text-white border-slate-900 border-b-white z-10 -mb-px' },
  { id: 'ACCEPTED' as const, label: '발주대기', icon: '📋', activeClass: 'bg-indigo-600 text-white border-indigo-500 border-b-white z-10 -mb-px shadow-sm' },
];
const FOLDER_TAB_IDLE =
  'bg-slate-100 text-slate-400 border-slate-200 border-b-transparent hover:bg-slate-200/80 hover:text-slate-600';

/** 묶음 미지정 접수완료(=발주대기 서류철) 여부 */
function isOrderWaitItem(r: { adminStatus?: string | null; orderGroupId?: string | null; batchId?: string | null }) {
  if (r.orderGroupId || r.batchId) return false;
  return r.adminStatus === '접수완료' || r.adminStatus === '발주완료';
}

interface RequestHistory {
  id: string;
  postNumber: string;
  applyDate: string;
  processDate: string | null;
  userName: string;
  userNameEn: string;
  deptHead: string;
  deptHeadEn: string;
  deptName: string;
  deptNameEn: string;
  title: string;
  titleEn: string;
  mobile: string;
  mobileEn: string;
  phone: string;
  phoneEn: string;
  fax: string;
  faxEn: string;
  email: string;
  emailEn: string;
  additionalKo: string | null;
  additionalEn: string | null;
  addressId?: string | null;
  zipCode: string;
  addressKo: string;
  addressEn: string;
  adminStatus: string; // 🚀 5단계 확장을 위해 string으로 유연성 확보
  isModifiedByAdmin?: boolean; 
  adminMemo?: string | null;   
  quantity: number;
  isArchived?: boolean;
  orderGroupId?: string | null;
  batchId?: string | null;
  applicantType?: string | null;
  applicantName?: string | null;
  applicantEmail?: string | null;
}

interface AddressMaster {
  id: string;
  label: string;
  zipCode: string;
  addressKo: string;
  addressEn: string;
  fax: string;
  faxEn: string;
  isActive: boolean;
}

interface MasterCode {
  id: string;
  label: string;
  value: string | null;
}

interface UnitItem {
  id: string;
  unit_name: string;
  unit_name_en: string;
  unit_type?: string;
  parent_id: string | null;
  sort_order?: number;
}

function isBoldOrgType(unitType?: string | null) {
  const t = String(unitType || '').trim().toUpperCase();
  return t === 'ORGANIZATION' || t === 'HQ';
}

function flattenUnitsInSortOrder(units: UnitItem[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depthOf = (unit: UnitItem) => {
    let depth = 0;
    let current: UnitItem | undefined = unit;
    const seen = new Set<string>();
    while (current?.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parent_id);
    }
    return depth;
  };
  return [...units]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((unit) => ({ ...unit, depth: depthOf(unit) }));
}

function descendantNames(unitId: string, units: UnitItem[]) {
  const names = new Set<string>();
  const selected = units.find((u) => u.id === unitId);
  if (selected?.unit_name) names.add(selected.unit_name.trim());
  const walk = (parentId: string) => {
    for (const child of units.filter((u) => u.parent_id === parentId)) {
      if (child.unit_name) names.add(child.unit_name.trim());
      walk(child.id);
    }
  };
  walk(unitId);
  return names;
}

function itemMatchesOrg(item: { deptHead?: string | null; deptName?: string | null }, orgId: string, units: UnitItem[]) {
  if (orgId === 'ALL') return true;
  const names = descendantNames(orgId, units);
  const head = String(item.deptHead || '').trim();
  const center = String(item.deptName || '').trim();
  return names.has(head) || names.has(center);
}

function isBusinessCardHqUnit(unit: { unit_type?: string | null; unit_name?: string | null } | null | undefined) {
  const t = String(unit?.unit_type || '').trim().toUpperCase();
  if (t === 'HQ' || t.startsWith('HQ')) return true;
  const n = String(unit?.unit_name || '').trim();
  return /^hq\b/i.test(n) || /^hq[_-]/i.test(n);
}

export default function BusinessCardRequestPanel() {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(BUSINESS_CARD_MASTER_TABS, '/asset/businesscard/master');
  const [requests, setRequests] = useState<RequestHistory[]>([]);
  const [loading, setLoading] = useState(true);
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

  // 서류철: 접수대기 | 발주대기
  const [activeFolder, setActiveFolder] = useState<'PENDING' | 'ACCEPTED'>('PENDING');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedOrg, setSelectedOrg] = useState('ALL');
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  const [searchUserQuery, setSearchUserQuery] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailTarget, setDetailTarget] = useState<RequestHistory | null>(null);

  const [isRequestEditing, setIsRequestEditing] = useState(false);
  const [requestEditForm, setRequestEditForm] = useState<RequestHistory | null>(null);
  const [adminMemoInput, setAdminMemoInput] = useState('');
  const [rejectTarget, setRejectTarget] = useState<RequestHistory | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [savingReject, setSavingReject] = useState(false);

  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [addresses, setAddresses] = useState<AddressMaster[]>([]); 
  const [newAddress, setNewAddress] = useState<Partial<AddressMaster>>({});
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [editAddressForm, setEditAddressForm] = useState<Partial<AddressMaster>>({});

  const [isQualModalOpen, setIsQualModalOpen] = useState(false);
  const [qualifications, setQualifications] = useState<any[]>([]);
  const [newQual, setNewQual] = useState({ nameKo: '', nameEn: '' });
  const [editingQualId, setEditingQualId] = useState<string | null>(null);
  const [editQualForm, setEditQualForm] = useState({ nameKo: '', nameEn: '' });

  const [sheetsPerPack, setSheetsPerPack] = useState(200);
  const [savingSheets, setSavingSheets] = useState(false);
  const [duties, setDuties] = useState<MasterCode[]>([]);
  const [grades, setGrades] = useState<MasterCode[]>([]);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [isAdminApplyOpen, setIsAdminApplyOpen] = useState(false);

  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  const isLV1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : [currentUser.role];
    return roles?.some((r: any) => String(r).includes('LV_1')) || currentUser.permissionLevel === 'LV_1';
  }, [currentUser]);
  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
  const [deletingBulk, setDeletingBulk] = useState(false);

  const fetchAddresses = async () => {
    const res = await fetch(`/api/asset/businesscard/master/addresses?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) setAddresses(await res.json());
  };

  const fetchQualifications = async () => {
    const res = await fetch(`/api/asset/businesscard/master/qualifications?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) setQualifications(await res.json());
  };

  const handleRestoreSeedQualifications = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    if (
      !confirm(
        '시드 기본 자격사항 중 없거나 미사용인 항목만 다시 채웁니다.\n이미 있는 항목의 국문·영문명은 변경되지 않습니다. 계속할까요?'
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/asset/businesscard/master/qualifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore-seeds' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.message || '시드 자격사항 복구 실패');
      alert(data.message || '시드 자격사항 복구 완료');
      await fetchQualifications();
    } catch {
      alert('시드 자격사항 복구 중 오류가 발생했습니다.');
    }
  };

  const handleRestoreSeedAddresses = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    if (
      !confirm(
        '시드 기본 주소/팩스 중 없거나 미사용인 항목만 다시 채웁니다.\n이미 있는 항목의 주소·팩스는 변경되지 않습니다. 계속할까요?'
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/asset/businesscard/master/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore-seeds' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.message || '시드 주소 복구 실패');
      alert(data.message || '시드 주소 복구 완료');
      await fetchAddresses();
    } catch {
      alert('시드 주소 복구 중 오류가 발생했습니다.');
    }
  };

  const fetchSheetsPerPack = async () => {
    const res = await fetch(`/api/asset/businesscard/master/settings?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const n = Number(data?.sheetsPerPack);
      if (Number.isFinite(n) && n > 0) setSheetsPerPack(Math.round(n));
      // 직책·직급: /admin/users SystemConfig 옵션
      if (Array.isArray(data?.duties)) {
        setDuties(
          data.duties
            .filter((o: any) => o?.label)
            .map((o: any, i: number) => ({
              id: `duty-${i}-${o.label}`,
              label: String(o.label),
              value: String(o.value ?? ''),
            }))
        );
      }
      if (Array.isArray(data?.grades)) {
        setGrades(
          data.grades
            .filter((o: any) => o?.label)
            .map((o: any, i: number) => ({
              id: `grade-${i}-${o.label}`,
              label: String(o.label),
              value: String(o.value ?? ''),
            }))
        );
      }
    }
  };

  const fetchUnits = async () => {
    const res = await fetch(`/api/admin/units?active=true&t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) setUnits(await res.json());
  };

  const saveSheetsPerPack = async () => {
    if (!canEditMaster) return alert('1통당 장수 수정 권한이 없습니다.');
    const n = Math.max(1, Math.min(9999, Math.round(Number(sheetsPerPack) || 200)));
    setSavingSheets(true);
    try {
      const res = await fetch('/api/asset/businesscard/master/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetsPerPack: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || data.error || data.detail || '1통당 장수 저장에 실패했습니다.');
        return;
      }
      setSheetsPerPack(Number(data.sheetsPerPack) || n);
      alert(`저장했습니다. 신청 화면에 1통=${data.sheetsPerPack || n}장으로 표시됩니다.`);
    } finally {
      setSavingSheets(false);
    }
  };

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const ts = Date.now();
      const [reqRes, meRes, ifRes, summaryRes] = await Promise.all([
        fetch(`/api/asset/businesscard/master/requests?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
      ]);

      let meUser: any = null;
      if (meRes && meRes.ok) {
        meUser = await meRes.json();
        setCurrentUser(meUser);
      }

      let nextInterface: any = null;
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        nextInterface = Array.isArray(interfaces)
          ? interfaces.find(
              (m: any) =>
                m.path === MENU_PATH || m.path?.includes('/businesscard/master/requests')
            )
          : null;
        setInterfaceConfig(nextInterface || null);
      } else {
        setInterfaceConfig(null);
      }

      const canHealOrphans = resolveInterfaceEditState(meUser, nextInterface).isEditor;

      if (reqRes.ok) {
        const data = await reqRes.json();
        const list = Array.isArray(data) ? data : [];
        const orphans = list.filter((r: any) => r.adminStatus === '발주완료' && !r.orderGroupId);
        if (canHealOrphans && orphans.length > 0) {
          await Promise.all(
            orphans.map((r: any) =>
              fetch('/api/asset/businesscard/master/requests', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: r.id, adminStatus: '접수완료' }),
              })
            )
          );
          setRequests(
            list.map((r: any) =>
              orphans.some((o: any) => o.id === r.id) ? { ...r, adminStatus: '접수완료' } : r
            )
          );
        } else {
          setRequests(list);
        }
      }
      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    fetchAddresses(); 
    fetchQualifications();
    fetchSheetsPerPack();
    fetchUnits();
  }, []);

  // 🚀 [핵심] 보관함으로 간 데이터(isArchived)는 메인 리스트에서 원천 차단!
  const activeRequests = requests.filter(r => !r.isArchived);

  const availableYears = useMemo(() => {
    const kstYear = String(getKSTNowYearMonth().year);
    const years = activeRequests
      .map((r) => String(r.applyDate || '').substring(0, 4))
      .filter((y) => y.length === 4);
    return Array.from(new Set([kstYear, ...years])).sort((a, b) => b.localeCompare(a));
  }, [activeRequests]);

  const afterYearList = useMemo(() => {
    if (selectedYear === 'ALL') return activeRequests;
    return activeRequests.filter((r) => String(r.applyDate || '').startsWith(selectedYear));
  }, [activeRequests, selectedYear]);

  const availableMonths = useMemo(() => {
    const months = afterYearList
      .map((r) => String(r.applyDate || '').substring(5, 7))
      .filter(Boolean);
    return Array.from(new Set(months)).sort((a, b) => a.localeCompare(b));
  }, [afterYearList]);

  const afterPeriodList = useMemo(() => {
    if (selectedMonth === 'ALL') return afterYearList;
    return afterYearList.filter((r) => String(r.applyDate || '').substring(5, 7) === selectedMonth);
  }, [afterYearList, selectedMonth]);

  const orgOptions = useMemo(() => flattenUnitsInSortOrder(units), [units]);
  const organizationUnit = useMemo(
    () => orgOptions.find((u) => String(u.unit_type || '').trim().toUpperCase() === 'ORGANIZATION') || null,
    [orgOptions]
  );
  const selectedOrgUnit =
    orgOptions.find((u) => u.id === selectedOrg) || (selectedOrg === 'ALL' ? organizationUnit : null) || null;

  useEffect(() => {
    if (selectedOrg !== 'ALL' || !organizationUnit) return;
    setSelectedOrg(organizationUnit.id);
  }, [selectedOrg, organizationUnit]);

  useEffect(() => {
    if (!orgMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setOrgMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOrgMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [orgMenuOpen]);

  // 서류철 배지 카운트 — 제작물 dept-master/order와 동일: 접수대기=대기중, 발주대기=접수완료(미묶음)
  const folderCounts = {
    pending: activeRequests.filter((r) => r.adminStatus === '대기중').length,
    accepted: activeRequests.filter((r) => isOrderWaitItem(r)).length,
  };

  const statusFiltered = afterPeriodList.filter((r) => {
    if (activeFolder === 'ACCEPTED') return isOrderWaitItem(r);
    return r.adminStatus === '대기중';
  });

  const q = searchUserQuery.trim().toLowerCase();
  const filteredRequests = statusFiltered.filter((r) => {
    if (!itemMatchesOrg(r, selectedOrg, units)) return false;
    if (q && !String(r.userName || '').toLowerCase().includes(q)) return false;
    return true;
  });

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [activeFolder, selectedYear, selectedMonth, selectedOrg, searchUserQuery]);
  
  const totalPages = Math.ceil(filteredRequests.length / itemsPerPage) || 1;
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allPageIds = paginatedRequests.map(r => r.id);
      setSelectedIds(new Set([...selectedIds, ...allPageIds]));
    } else {
      const nextSet = new Set(selectedIds);
      paginatedRequests.forEach(r => nextSet.delete(r.id));
      setSelectedIds(nextSet);
    }
  };

  const handleSelectRow = (id: string) => {
    const nextSet = new Set(selectedIds);
    if (nextSet.has(id)) nextSet.delete(id);
    else nextSet.add(id);
    setSelectedIds(nextSet);
  };

  const handleExcelDownload = () => {
    if (!canEditMaster) return alertNoEditPermission();
    const targets = requests.filter(r => selectedIds.has(r.id));
    if (targets.length === 0) return alert('⚠️ 다운로드할 행을 체크박스로 선택해 주세요.');

    const excelData = targets.map((r) => ({
      '성명': r.userName,
      '신청일자': r.applyDate,
      '본부': r.deptHead,
      '소속': r.deptName || '',
      '직책/직급': r.title,
      '추가사항': r.additionalKo || '',
      '우편번호': r.zipCode,
      '주소': r.addressKo,
      '휴대전화': r.mobile,
      '전화번호': r.phone || '',
      '팩스': r.fax || '',
      '이메일': r.email,
      '영문이름': r.userNameEn || '',
      '영문본부': r.deptHeadEn || '',
      '영문소속': r.deptNameEn || '',
      '영문직책': r.titleEn || '',
      '영문추가': r.additionalEn || '',
      '영문주소': r.addressEn || '',
      '영문 휴대전화': stripBusinessCardEnPlus(r.mobileEn || ''),
      '영문전화': stripBusinessCardEnPlus(r.phoneEn || ''),
      '영문팩스': stripBusinessCardEnPlus(r.faxEn || ''),
      '이메일(영문)': r.emailEn || r.email
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "명함신청데이터");
    XLSX.writeFile(wb, `명함발주데이터_${getKSTDateString()}.xlsx`);
  };

  const handleApprove = async (id: string, postNumber: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!confirm(`[${postNumber}] 접수 완료 처리하시겠습니까?`)) return;
    const todayStr = getKSTDateString();
    try {
      const res = await fetch(`/api/asset/businesscard/master/requests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, adminStatus: '접수완료', processDate: todayStr })
      });
      if (res.ok) {
        alert('✅ 발주대기 서류철로 이관되었습니다.');
        fetchRequests();
      }
    } catch (err) {
      alert("서버 연결 실패");
    }
  };

  const handleCancelAccept = async (id: string, postNumber: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!confirm(`[${postNumber}] 접수를 취소하고 접수대기(대기중)로 되돌릴까요?`)) return;
    try {
      const res = await fetch('/api/asset/businesscard/master/requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, adminStatus: '대기중', processDate: null, batchId: null }),
      });
      if (res.ok) {
        alert('접수를 취소했습니다. 접수대기 서류철로 돌아갑니다.');
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetchRequests();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || '접수 취소에 실패했습니다.');
      }
    } catch {
      alert('서버 연결 실패');
    }
  };

  const createOrderBatch = async (targets: RequestHistory[]) => {
    if (targets.length === 0) throw new Error('발주 처리할 명함이 없습니다.');
    const dayKey = getKSTDateString().replace(/-/g, '');
    const idPrefix = `PO-BC-${dayKey}-`;
    const ts = Date.now();
    // 미보관 + 보관함 모두 조회 — 같은 날 발주번호 충돌 방지 (보관 이관 시 번호는 그대로 유지됨)
    const [activeRes, archivedRes] = await Promise.all([
      fetch(`/api/asset/businesscard/master/order?t=${ts}`, { cache: 'no-store' }),
      fetch(`/api/asset/businesscard/master/order?isArchived=true&t=${ts}`, { cache: 'no-store' }),
    ]);
    const [activeData, archivedData] = await Promise.all([
      activeRes.ok ? activeRes.json() : [],
      archivedRes.ok ? archivedRes.json() : [],
    ]);
    const allBatches = [
      ...(Array.isArray(activeData) ? activeData : []),
      ...(Array.isArray(archivedData) ? archivedData : []),
    ];
    let maxSeq = 0;
    for (const b of allBatches) {
      const id = String(b?.id || '');
      if (!id.includes(dayKey)) continue;
      const m = id.match(/-(\d+)$/);
      if (!m) continue;
      maxSeq = Math.max(maxSeq, parseInt(m[1], 10) || 0);
    }
    const batchId = `${idPrefix}${String(maxSeq + 1).padStart(2, '0')}`;
    const distinctDepts = Array.from(new Set(targets.map((t) => t.deptHead))).join(', ');

    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: batchId,
        orderDate: getKSTDateString(),
        totalCount: targets.length,
        deptHeadGroup: distinctDepts || '전사종합',
        status: '발주완료',
        itemIds: targets.map((t) => t.id),
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || errData.message || 'DB 묶음 생성 실패');
    }
    return batchId;
  };

  const handleCreateBatch = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    if (selectedIds.size === 0) return alert('⚠️ 발주 처리할 명함을 선택해 주세요.');
    const targets = requests.filter((r) => selectedIds.has(r.id) && isOrderWaitItem(r));
    if (targets.length === 0) return alert('⚠️ 발주 처리할 명함을 선택해 주세요.');

    setCreatingBatch(true);
    try {
      await createOrderBatch(targets);
      setSelectedIds(new Set());
      alert('🚀 발주 묶음이 생성되었습니다. 외주발주 탭에서 확인할 수 있습니다.');
      fetchRequests();
    } catch (error: any) {
      console.error(error);
      alert(`❌ 발주 처리 실패: ${error.message}`);
    } finally {
      setCreatingBatch(false);
    }
  };

  const handleSingleOrder = async (row: RequestHistory) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!isOrderWaitItem(row)) return alert('발주대기 상태의 건만 개별발주할 수 있습니다.');
    if (!confirm(`[${row.postNumber}] 개별발주로 외주발주 대장에 이동할까요?`)) return;

    setActionBusyId(row.id);
    setCreatingBatch(true);
    try {
      await createOrderBatch([row]);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      alert('🚀 개별발주가 생성되었습니다. 외주발주 탭에서 확인할 수 있습니다.');
      fetchRequests();
    } catch (error: any) {
      console.error(error);
      alert(`❌ 개별발주 실패: ${error.message}`);
    } finally {
      setActionBusyId(null);
      setCreatingBatch(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) return alert('반려 사유를 입력해 주세요.');
    setSavingReject(true);
    try {
      const res = await fetch('/api/asset/businesscard/master/requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rejectTarget.id,
          adminStatus: '반려',
          processDate: getKSTDateString(),
          adminMemo: reason,
          isModifiedByAdmin: true,
          adminModifierName: currentUser?.name || currentUser?.email || '',
          adminModifiedAt: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        alert(`[${rejectTarget.postNumber}] 반려 처리했습니다.`);
        setRejectTarget(null);
        setRejectReason('');
        fetchRequests();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || '반려 처리에 실패했습니다.');
      }
    } catch {
      alert('서버 연결 실패');
    } finally {
      setSavingReject(false);
    }
  };

  const handleCancelProxy = async (row: RequestHistory) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (row.applicantType !== '관리자대행') return;
    if (!confirm(`[${row.postNumber}] ${row.userName} 님 대행 신청을 취소하시겠습니까?\n대장과 대상자 마이페이지에서 삭제됩니다.`)) return;
    try {
      const res = await fetch(`/api/asset/businesscard/master/requests?id=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        alert(`[${row.postNumber}] 대행 신청을 취소했습니다.`);
        fetchRequests();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || '취소 처리에 실패했습니다.');
      }
    } catch {
      alert('서버 연결 실패');
    }
  };

  const handleBulkDeleteLv1 = async () => {
    if (!isLV1) return alert('삭제는 LV_1만 가능합니다.');
    if (deletingBulk) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return alert('삭제할 신청을 체크박스로 선택해 주세요.');
    const folderLabel = activeFolder === 'PENDING' ? '접수대기' : '발주대기';
    if (
      !confirm(
        `경고: 선택한 ${ids.length}건(${folderLabel})을 영구 삭제하시겠습니까?\n대상자 마이페이지 내역에서도 함께 삭제됩니다.`
      )
    ) {
      return;
    }

    setDeletingBulk(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const id of ids) {
        const res = await fetch(
          `/api/asset/businesscard/master/requests?id=${encodeURIComponent(id)}&purge=1`,
          { method: 'DELETE' }
        );
        if (res.ok) ok += 1;
        else fail += 1;
      }
      alert(
        fail > 0
          ? `삭제 완료 ${ok}건 / 실패 ${fail}건`
          : `🗑️ ${ok}건 삭제되었습니다.`
      );
      setSelectedIds(new Set());
      await fetchRequests();
    } catch {
      alert('일괄 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleSaveRequestPayload = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!requestEditForm) return;
    if (!adminMemoInput.trim()) return alert('⚠️ 변경 이력 관리를 위해 하단에 [수정 사유]를 반드시 입력해 주세요.');

    try {
      const res = await fetch('/api/asset/businesscard/master/requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestEditForm,
          mobileEn:
            formatBusinessCardEnNumber('mobile', requestEditForm.mobile) ||
            stripBusinessCardEnPlus(requestEditForm.mobileEn),
          phoneEn:
            formatBusinessCardEnNumber('phone', requestEditForm.phone) ||
            stripBusinessCardEnPlus(requestEditForm.phoneEn),
          faxEn: stripBusinessCardEnPlus(requestEditForm.faxEn),
          isModifiedByAdmin: true,
          adminMemo: adminMemoInput,
          adminModifierName: currentUser?.name || currentUser?.email || '',
          adminModifiedAt: new Date().toISOString(),
          isFormPayload: true
        })
      });

      if (res.ok) {
        alert("💾 원문 정보가 수정되었으며 변경 이력이 등록되었습니다.");
        setIsRequestEditing(false);
        setDetailTarget(null);
        setAdminMemoInput(''); 
        fetchRequests(); 
      } else {
        const errorText = await res.text();
        alert(`❌ 서버 처리 실패: ${errorText}`);
      }
    } catch (err) {
      alert("📡 수정 데이터 전송 중 네트워크 오류가 발생했습니다.");
    }
  };

  const handleEditKoField = (field: 'userName' | 'additionalKo' | 'mobile' | 'phone' | 'email', value: string) => {
    setRequestEditForm((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [field]: value };
      if (field === 'email') updated.emailEn = value;
      if (field === 'mobile') updated.mobileEn = formatBusinessCardEnNumber('mobile', value);
      if (field === 'phone') updated.phoneEn = formatBusinessCardEnNumber('phone', value);
      return updated;
    });
  };

  const handleEditTitleChange = (value: string) => {
    setRequestEditForm((prev) => {
      if (!prev) return prev;
      const duty = duties.find((d) => d.label === value);
      const grade = grades.find((g) => g.label === value);
      return {
        ...prev,
        title: value,
        titleEn: duty?.value || grade?.value || (value === prev.title ? prev.titleEn : ''),
      };
    });
  };

  const handleEditAddressChange = (addrId: string) => {
    const target = addresses.find((a) => a.id === addrId);
    if (!target) return;
    setRequestEditForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        addressId: addrId,
        zipCode: target.zipCode,
        addressKo: target.addressKo,
        addressEn: target.addressEn,
        fax: target.fax,
        faxEn: target.faxEn,
      };
    });
  };

  const handleEditHeadChange = (unitName: string) => {
    const selected = units.find((u) => u.unit_name === unitName);
    const childNames = new Set(
      selected ? units.filter((u) => u.parent_id === selected.id).map((u) => u.unit_name) : []
    );
    setRequestEditForm((prev) => {
      if (!prev) return prev;
      const keepCenter = !!prev.deptName && childNames.has(prev.deptName);
      return {
        ...prev,
        deptHead: unitName,
        deptHeadEn: selected?.unit_name_en || '',
        deptName: keepCenter ? prev.deptName : '',
        deptNameEn: keepCenter ? prev.deptNameEn : '',
      };
    });
  };

  const handleEditSubChange = (unitName: string) => {
    const selected = units.find((u) => u.unit_name === unitName);
    setRequestEditForm((prev) => {
      if (!prev) return prev;
      if (!selected) return { ...prev, deptName: '', deptNameEn: '' };
      let headKo = prev.deptHead;
      let headEn = prev.deptHeadEn;
      if (selected.parent_id) {
        const parent = units.find((u) => u.id === selected.parent_id);
        if (parent) {
          headKo = parent.unit_name;
          headEn = parent.unit_name_en || '';
        }
      }
      return {
        ...prev,
        deptName: selected.unit_name,
        deptNameEn: selected.unit_name_en || '',
        deptHead: headKo,
        deptHeadEn: headEn,
      };
    });
  };

  const toggleAddressActive = async (id: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    const target = addresses.find(a => a.id === id);
    if (!target) return;
    await fetch('/api/asset/businesscard/master/addresses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !target.isActive })
    });
    fetchAddresses(); 
  };

  const saveNewAddress = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!newAddress.label || !newAddress.addressKo) return alert('필수 정보(선택지명, 주소)를 입력하세요.');
    await fetch('/api/asset/businesscard/master/addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newAddress, isActive: true })
    });
    setNewAddress({});
    fetchAddresses(); 
    alert("✅ 공통 주소지가 등록되었습니다.");
  };

  const executeUpdateAddress = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!editAddressForm.label || !editAddressForm.addressKo) return alert('필수 입력 누락');
    const res = await fetch('/api/asset/businesscard/master/addresses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editAddressForm)
    });
    if (res.ok) {
      setEditingAddressId(null);
      fetchAddresses();
    }
  };

  const executeDeleteAddress = async (id: string, label: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!confirm(`⚠️ [${label}] 주소 설정을 영구 삭제하시겠습니까?`)) return;
    const res = await fetch(`/api/asset/businesscard/master/addresses?id=${id}`, { method: 'DELETE' });
    if (res.ok) fetchAddresses();
  };

  const toggleQualActive = async (id: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    const target = qualifications.find(q => q.id === id);
    if (!target) return;
    await fetch('/api/asset/businesscard/master/qualifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !target.isActive })
    });
    fetchQualifications();
  };

  const saveNewQual = async () => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!newQual.nameKo || !newQual.nameEn) return alert('국문과 영문 명칭을 모두 입력하세요.');
    await fetch('/api/asset/businesscard/master/qualifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nameKo: newQual.nameKo, nameEn: newQual.nameEn, isActive: true })
    });
    setNewQual({ nameKo: '', nameEn: '' });
    fetchQualifications();
    alert("✅ 신규 자격사항이 등록되었습니다.");
  };

  const executeUpdateQual = async (id: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!editQualForm.nameKo || !editQualForm.nameEn) return alert('필수 명칭 누락');
    const res = await fetch('/api/asset/businesscard/master/qualifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...editQualForm })
    });
    if (res.ok) {
      setEditingQualId(null);
      fetchQualifications();
    }
  };

  const executeDeleteQual = async (id: string, nameKo: string) => {
    if (!canEditMaster) return alertNoEditPermission();
    if (!confirm(`⚠️ [${nameKo}] 자격 단어를 영구 삭제하시겠습니까?`)) return;
    const res = await fetch(`/api/asset/businesscard/master/qualifications?id=${id}`, { method: 'DELETE' });
    if (res.ok) fetchQualifications();
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* client-search 배너 규격: emerald→teal · orbs · permission chips */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
  <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
  <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
  <div className="relative z-10">
    <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
      BUSINESS CARD TOTAL GOVERNANCE
    </h3>
    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
      전사 임직원 명함 발주 접수 통제 대장
    </h1>
    <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
      [접수대기] 원문 검수 후 접수확정 → [발주대기] 개별 또는 묶음 발주로 넘깁니다. (원문 검수 가능)
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
            편집 권한 없음 — 조회만 가능
          </span>
        )}
      </div>
    )}
  </div>
</div>

{/* 탭 네비게이션 — client-search / distribution 스위처 규격 */}
<div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
  <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
    {tabs.map((tab) => {
      const isActive = pathname.startsWith(tab.path);
      return (
        <Link
          key={tab.id}
          href={tab.path}
          className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
            isActive
              ? `bg-white ${tab.activeColor || 'text-indigo-600'} shadow-sm border border-slate-200/80`
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>{tab.label}</span>
        </Link>
      );
    })}
  </div>
  <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
    ※ 탭을 클릭하여 신청현황·외주발주·보관함을 전환합니다.
  </p>
</div>

     <div className="flex justify-end gap-2 mb-2 flex-wrap items-center">
        <button onClick={() => setIsQualModalOpen(true)} className="px-5 py-2.5 bg-indigo-700 text-white font-black text-xs rounded-xl hover:bg-indigo-800 transition-colors shadow-sm flex items-center gap-2">
          🎓 자격사항 표준단어 (국/영문) 관리
        </button>
        <button onClick={() => setIsAddressModalOpen(true)} className="px-5 py-2.5 bg-slate-800 text-white font-black text-xs rounded-xl hover:bg-slate-700 transition-colors shadow-sm flex items-center gap-2">
          ⚙️ 시스템 공통선택지 (주소/팩스) 관리
        </button>
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
          <span className="text-[10px] font-black text-slate-500 whitespace-nowrap">1통 =</span>
          <input
            type="number"
            min={1}
            max={9999}
            disabled={!canEditMaster || savingSheets}
            value={sheetsPerPack}
            onChange={(e) => setSheetsPerPack(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 p-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-black text-indigo-700 text-center outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <span className="text-[10px] font-black text-slate-500">장</span>
          <button
            type="button"
            disabled={!canEditMaster || savingSheets}
            title={!canEditMaster ? '편집 권한 필요' : undefined}
            onClick={saveSheetsPerPack}
            className={`px-2.5 py-1.5 font-black text-[10px] rounded-lg transition-colors ${
              canEditMaster
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed'
                : DISABLED_ACTION_BTN
            }`}
          >
            {savingSheets ? '저장중' : '저장'}
          </button>
        </div>
      </div>

      {/* 접수대기 / 발주대기 서류철 */}
      <div className="w-full">
        <div
          className="flex flex-wrap items-end gap-1 border-b border-slate-200"
          role="tablist"
          aria-label="명함 접수·발주 서류철"
        >
          {FOLDER_TABS.map((tab) => {
            const active = activeFolder === tab.id;
            const badgeCount = tab.id === 'PENDING' ? folderCounts.pending : folderCounts.accepted;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveFolder(tab.id)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border ${
                  active ? tab.activeClass : FOLDER_TAB_IDLE
                }`}
              >
                <span className="text-sm leading-none">{tab.icon}</span>
                <span className="flex items-center gap-1">
                  <span>{tab.label}</span>
                  {badgeCount > 0 ? (
                    <span className={`tabular-nums ${active ? 'opacity-95' : 'text-indigo-600'}`}>
                      ({badgeCount})
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

      <div className={`bg-white border border-t-0 border-slate-200 rounded-b-[2.5rem] rounded-tr-2xl shadow-sm animate-in fade-in duration-300 ${orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
        <div className={`p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4 relative ${orgMenuOpen ? 'z-[80] overflow-visible' : ''}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">
              {activeFolder === 'ACCEPTED'
                ? '발주대기 서류철 (접수완료 · 묶음발주)'
                : '접수대기 서류철 (원문검수 · 접수)'}
            </h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredRequests.length}건</span>
            {selectedIds.size > 0 && (
              <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                {selectedIds.size}개 선택
              </span>
            )}
          </div>

          <div className={`flex items-center gap-2 flex-wrap ml-auto ${orgMenuOpen ? 'relative z-[90] overflow-visible' : ''}`}>
            {isLV1 && (
              <button
                type="button"
                disabled={selectedIds.size === 0 || deletingBulk}
                onClick={handleBulkDeleteLv1}
                title="체크한 신청을 영구 삭제 (LV_1 전용 · 접수대기/발주대기)"
                className="h-7 px-2.5 rounded-lg text-[10px] font-black border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {deletingBulk
                  ? '삭제중…'
                  : selectedIds.size > 0
                    ? `삭제(LV_1) ${selectedIds.size}`
                    : '삭제(LV_1)'}
              </button>
            )}
            {activeFolder === 'ACCEPTED' && (
              <button
                type="button"
                onClick={handleCreateBatch}
                disabled={!canEditMaster || creatingBatch || selectedIds.size === 0}
                title={!canEditMaster ? '편집 권한 필요' : undefined}
                className={`inline-flex items-center gap-1 text-[10px] font-black rounded-lg px-4 py-1.5 transition-colors shadow-sm h-7 ${
                  canEditMaster
                    ? 'bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-700 disabled:opacity-50'
                    : DISABLED_ACTION_BTN
                }`}
              >
                <span>→</span>
                <span>
                  {creatingBatch
                    ? '발주 처리 중…'
                    : `선택된 ${selectedIds.size}건 묶음 발주 생성 🚀`}
                </span>
              </button>
            )}
            <div className={`relative group/filter flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border ${orgMenuOpen ? 'relative z-[90]' : ''}`}>
              <span
                role="tooltip"
                className={`pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg ${orgMenuOpen ? '' : 'group-hover/filter:block'}`}
              >
                연도 → 월 · 연계필터 / 조직은 마스터 정렬
              </span>
              <span className="text-[10px] font-black text-slate-400 uppercase leading-none">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth('ALL');
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-black text-slate-400 uppercase leading-none">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{parseInt(month, 10)}월</option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-black text-slate-400 uppercase leading-none">조직</span>
              <div className="relative inline-flex items-center" ref={orgMenuRef}>
                <button
                  type="button"
                  onClick={() => setOrgMenuOpen((open) => !open)}
                  className={`max-w-[220px] truncate text-left text-[11px] leading-none py-0 px-0 m-0 h-4 inline-flex items-center border-0 appearance-none outline-none cursor-pointer bg-transparent ${
                    selectedOrgUnit && isBoldOrgType(selectedOrgUnit.unit_type) ? 'font-black text-slate-900' : 'font-bold text-slate-800'
                  }`}
                >
                  {selectedOrgUnit ? selectedOrgUnit.unit_name : organizationUnit?.unit_name || '조직 선택'}
                </button>
                {orgMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 z-[100] min-w-[240px] max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1">
                    {orgOptions.map((dept) => {
                      const bold = isBoldOrgType(dept.unit_type);
                      return (
                        <button
                          key={dept.id}
                          type="button"
                          onClick={() => {
                            setSelectedOrg(dept.id);
                            setOrgMenuOpen(false);
                          }}
                          className={`w-full text-left pr-3 py-1.5 text-[11px] ${
                            bold ? 'font-black text-slate-900' : 'font-medium text-slate-600'
                          } ${selectedOrg === dept.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                          style={{ paddingLeft: `${12 + dept.depth * 12}px` }}
                        >
                          {dept.unit_name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="relative w-32 h-7">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] leading-none pointer-events-none">👤</span>
              <input
                type="text"
                placeholder="대상자 검색..."
                value={searchUserQuery}
                onChange={(e) => setSearchUserQuery(e.target.value)}
                className="w-full h-7 box-border pl-7 pr-3 py-0 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
            <button
              type="button"
              disabled={!canEditMaster}
              title={!canEditMaster ? '편집 권한 필요' : undefined}
              onClick={handleExcelDownload}
              className={`h-7 px-3 rounded-lg text-[10px] font-black shadow-sm transition-all whitespace-nowrap leading-none ${
                canEditMaster
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : DISABLED_ACTION_BTN
              }`}
            >
              {selectedIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedIds.size})`
                : '선택 데이터 엑셀 다운로드'}
            </button>
            <button
              type="button"
              disabled={!canEditMaster}
              title={!canEditMaster ? '편집 권한 필요' : undefined}
              onClick={() => {
                if (!canEditMaster) return alertNoEditPermission();
                setIsAdminApplyOpen(true);
              }}
              className={`h-7 px-3 rounded-lg text-[10px] font-black shadow-sm transition-all whitespace-nowrap leading-none ${
                canEditMaster
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : DISABLED_ACTION_BTN
              }`}
            >
              + 관리자 직접 신청(Edit)
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1280px]">
            <colgroup>
              <col className="w-[40px]" />
              <col className="w-[48px]" />
              <col className="w-[160px]" />
              <col className="w-[96px]" />
              <col className="w-[72px]" />
              <col className="w-[140px]" />
              <col className="w-[140px]" />
              <col className="w-[88px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[72px]" />
              <col className="w-[88px]" />
              <col className="w-[140px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-4 text-center">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={paginatedRequests.length > 0 && paginatedRequests.every((r) => selectedIds.has(r.id))}
                    className="w-3 h-3 accent-indigo-600 cursor-pointer"
                  />
                </th>
                <th className="h-12 px-2 text-center">NO</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">관리번호</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">신청일</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">신청주체</th>
                <th className="h-12 px-2">본부 (상위 조직)</th>
                <th className="h-12 px-2">센터 (하위 조직)</th>
                <th className="h-12 px-2">대상자</th>
                <th className="h-12 px-2">직책 / 직급</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">신청내역 (Edit)</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">수량(통)</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">관리액션(Edit)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedRequests.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-16 text-center text-slate-400 text-xs">표시할 명함 데이터가 존재하지 않습니다.</td>
                </tr>
              ) : (
                paginatedRequests.map((row, index) => {
                  const rowNo = filteredRequests.length - ((currentPage - 1) * itemsPerPage + index);
                  const isPending = row.adminStatus === '대기중';
                  const isSelected = selectedIds.has(row.id);
                  const appliedTitle = String(row.title || '').trim() || '-';
                  const statusClass =
                    row.adminStatus === '지급완료'
                      ? 'text-purple-700'
                      : row.adminStatus === '수령완료'
                        ? 'text-teal-700'
                        : row.adminStatus === '발주완료'
                          ? 'text-emerald-600'
                          : row.adminStatus === '접수완료'
                            ? 'text-blue-600'
                            : row.adminStatus === '반려'
                              ? 'text-red-600'
                              : 'text-orange-600';

                  return (
                    <tr key={row.id} className={`hover:bg-slate-50/50 h-12 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                      <td className="pl-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectRow(row.id)}
                          className="w-3 h-3 accent-indigo-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                      <td className="px-2 text-center font-mono text-slate-900 tabular-nums truncate">{row.postNumber}</td>
                      <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">{row.applyDate}</td>
                      <td className="px-2 text-center">
                        {row.applicantType === '관리자대행' ? (
                          <span className="text-[10px] font-bold whitespace-nowrap text-indigo-700" title={row.applicantName || ''}>
                            관리자대행
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold whitespace-nowrap text-slate-600">
                            본인
                          </span>
                        )}
                      </td>
                      <td className="px-2 truncate" title={row.deptHead || ''}>{row.deptHead || '-'}</td>
                      <td className="px-2 truncate" title={row.deptName || ''}>{row.deptName || <span className="text-slate-300">-</span>}</td>
                      <td className="px-2 text-slate-800 truncate">{row.userName || '-'}</td>
                      <td className="px-2 text-slate-800 truncate" title={appliedTitle}>{appliedTitle}</td>
                      <td className="px-2 text-center">
                        {isPending ? (
                          <button
                            type="button"
                            disabled={!canEditMaster}
                            title={!canEditMaster ? '편집 권한 필요' : undefined}
                            onClick={() => {
                              if (!canEditMaster) return alertNoEditPermission();
                              setDetailTarget(row);
                            }}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-lg shadow-sm transition-colors ${
                              canEditMaster
                                ? 'bg-rose-600 text-white hover:bg-rose-700'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            원문검수
                          </button>
                        ) : activeFolder === 'ACCEPTED' ? (
                          <button
                            type="button"
                            disabled={!canEditMaster}
                            title={!canEditMaster ? '편집 권한 필요' : undefined}
                            onClick={() => {
                              if (!canEditMaster) return alertNoEditPermission();
                              setDetailTarget(row);
                            }}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-lg shadow-sm transition-colors ${
                              canEditMaster
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            원문최종검수
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!canEditMaster}
                            title={!canEditMaster ? '편집 권한 필요' : undefined}
                            onClick={() => {
                              if (!canEditMaster) return alertNoEditPermission();
                              setDetailTarget(row);
                            }}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors ${
                              canEditMaster
                                ? 'bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            원문확인
                          </button>
                        )}
                      </td>
                      <td className="px-2 text-center font-mono tabular-nums text-slate-900">{row.quantity || 1}</td>
                      <td className="px-2 text-center">
                        <span className={`text-[10px] font-bold whitespace-nowrap ${statusClass}`}>
                          {formatBusinessCardAdminStatusLabel(row.adminStatus)}
                        </span>
                      </td>
                      <td className="px-2 text-center">
                        {activeFolder === 'ACCEPTED' ? (
                          <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={!canEditMaster || creatingBatch || actionBusyId === row.id}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => handleSingleOrder(row)}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                canEditMaster
                                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              <span>→</span>
                              <span>
                                {creatingBatch || actionBusyId === row.id ? '처리중' : '개별발주 이동'}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={!canEditMaster || creatingBatch || actionBusyId === row.id}
                              title={!canEditMaster ? '편집 권한 필요' : '접수대기(대기중)로 되돌리기'}
                              onClick={() => handleCancelAccept(row.id, row.postNumber)}
                              className={`px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                canEditMaster
                                  ? 'bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600 disabled:opacity-50'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              {actionBusyId === row.id ? '처리중' : '접수취소'}
                            </button>
                          </div>
                        ) : isPending ? (
                          <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => handleApprove(row.id, row.postNumber)}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                canEditMaster
                                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              →접수확정
                            </button>
                            {row.applicantType === '관리자대행' ? (
                              <button
                                type="button"
                                disabled={!canEditMaster}
                                title={!canEditMaster ? '편집 권한 필요' : undefined}
                                onClick={() => handleCancelProxy(row)}
                                className={`px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                  canEditMaster
                                    ? 'bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                취소
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={!canEditMaster}
                                title={!canEditMaster ? '편집 권한 필요' : undefined}
                                onClick={() => {
                                  if (!canEditMaster) return alertNoEditPermission();
                                  setRejectTarget(row);
                                  setRejectReason('');
                                }}
                                className={`px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                  canEditMaster
                                    ? 'bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                신청반려
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-bold whitespace-nowrap">
                            {row.adminStatus === '발주완료'
                              ? '수령 검수 대기'
                              : row.adminStatus === '수령완료'
                                ? '지급 대기'
                                : row.adminStatus === '지급완료'
                                  ? '명세표 검수 대기'
                                  : row.adminStatus === '반려'
                                    ? '반려됨'
                                    : '-'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredRequests.length > 0 && (
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
                className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
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
      </div>

{/* 반려 사유 입력 */}
{rejectTarget && (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-rose-50">
        <h3 className="text-sm font-black text-rose-800 tracking-tight">반려 사유 입력</h3>
        <button
          type="button"
          onClick={() => { setRejectTarget(null); setRejectReason(''); }}
          className="text-slate-400 hover:text-slate-600 font-black text-sm"
        >
          ✕
        </button>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-[11px] font-bold text-slate-500">
          [{rejectTarget.postNumber}] {rejectTarget.userName} 님 신청을 반려합니다. 사유는 신청자 마이페이지에 표시됩니다.
        </p>
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={4}
          placeholder="예: 영문 성명 오기재, 내선번호 확인 필요 등"
          className="w-full p-3 text-xs font-bold text-slate-800 border border-rose-200 rounded-xl outline-none focus:border-rose-400 bg-white resize-none"
        />
      </div>
      <div className="p-3 bg-slate-50 border-t border-slate-100 flex gap-2">
        <button
          type="button"
          onClick={() => { setRejectTarget(null); setRejectReason(''); }}
          className="flex-1 py-2.5 bg-slate-200 text-slate-700 text-xs font-black rounded-lg hover:bg-slate-300"
        >
          취소
        </button>
        <button
          type="button"
          disabled={!canEditMaster || savingReject}
          title={!canEditMaster ? '편집 권한 필요' : undefined}
          onClick={handleRejectSubmit}
          className={`flex-1 py-2.5 text-xs font-black rounded-lg ${
            canEditMaster
              ? 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50'
              : DISABLED_ACTION_BTN
          }`}
        >
          {savingReject ? '전송중' : '반려 전송'}
        </button>
      </div>
    </div>
  </div>
)}

{/* 🚀 상세 뷰 모달 (관리자 직접 인라인 수정 및 이력 컴포넌트 탑재) */}
{detailTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            
            {/* 헤더 구역 */}
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black text-blue-600 font-mono tracking-widest">
                  {isRequestEditing ? '⚡ 원문 편집 모드 활성화' : '🔎 원문 검수 모드'}
                </span>
                <h2 className="text-base font-black text-slate-900 mt-1">
                  명함 신청 데이터 세부 검수창 ({detailTarget.userName} 님)
                </h2>
              </div>
              <button onClick={() => { setDetailTarget(null); setIsRequestEditing(false); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black text-sm transition-colors">✕</button>
            </div>

            {/* 경고 배너 */}
            {detailTarget.isModifiedByAdmin && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-bold">
                ⚠️ 주의: 이 신청서는 관리자에 의해 이미 한 번 수정된 이력이 있습니다. (사유: {detailTarget.adminMemo})
              </div>
            )}

            {/* 1. 국/영문 조판 데이터 2단 그리드 구역 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              {(() => {
                const preview = isRequestEditing && requestEditForm ? requestEditForm : detailTarget;
                const titleInMaster =
                  duties.some((d) => d.label === preview.title) ||
                  grades.some((g) => g.label === preview.title);
                const matchedAddress =
                  addresses.find((a) => a.id === preview.addressId) ||
                  addresses.find((a) => a.zipCode === preview.zipCode && a.addressKo === preview.addressKo);
                const addressSelectValue = matchedAddress?.id || preview.addressId || '';
                const addressOptions = [
                  ...addresses.filter((a) => a.isActive || a.id === addressSelectValue),
                ];
                if (addressSelectValue && !addressOptions.some((a) => a.id === addressSelectValue)) {
                  addressOptions.unshift({
                    id: addressSelectValue,
                    label: '현재 주소',
                    zipCode: preview.zipCode,
                    addressKo: preview.addressKo,
                    addressEn: preview.addressEn,
                    fax: preview.fax,
                    faxEn: preview.faxEn,
                    isActive: false,
                  });
                }
                const syncedCls = 'w-full p-1.5 border border-slate-200 rounded bg-slate-50 text-xs font-black text-slate-500 cursor-not-allowed';
                const previewMobileEn =
                  formatBusinessCardEnNumber('mobile', preview.mobile || '') ||
                  stripBusinessCardEnPlus(preview.mobileEn) ||
                  '';
                const previewPhoneEn =
                  formatBusinessCardEnNumber('phone', preview.phone || '') ||
                  stripBusinessCardEnPlus(preview.phoneEn) ||
                  '';
                const hqUnits = (() => {
                  const hqs = units.filter((u) => isBusinessCardHqUnit(u) || !u.parent_id);
                  if (preview.deptHead && !hqs.some((u) => u.unit_name === preview.deptHead)) {
                    const extra = units.find((u) => u.unit_name === preview.deptHead);
                    if (extra) return [...hqs, extra];
                    return [...hqs, { id: `current-hq`, unit_name: preview.deptHead, unit_name_en: preview.deptHeadEn || '', parent_id: null }];
                  }
                  return hqs;
                })();
                const selectedHeadUnit = units.find((u) => u.unit_name === preview.deptHead);
                const childCenterUnits = (() => {
                  const children = selectedHeadUnit
                    ? units.filter((u) => u.parent_id === selectedHeadUnit.id && !isBusinessCardHqUnit(u))
                    : [];
                  if (preview.deptName && !children.some((u) => u.unit_name === preview.deptName)) {
                    const extra = units.find((u) => u.unit_name === preview.deptName);
                    if (extra) return [...children, extra];
                    return [...children, { id: `current-center`, unit_name: preview.deptName, unit_name_en: preview.deptNameEn || '', parent_id: selectedHeadUnit?.id || null }];
                  }
                  return children;
                })();
                return (
              <>
              {/* 국문 영역 (좌측) */}
              <div className="space-y-2 border-r border-slate-200 pr-5 flex flex-col">
                <h3 className="text-xs font-black text-slate-800 border-b pb-1.5">1. 국문 조판 데이터</h3>
                <div className="space-y-1.5 text-xs font-bold text-slate-600 flex-1">
                  <label className="block text-[10px] text-slate-400 mt-1">성명</label>
                  {isRequestEditing ? <input type="text" value={requestEditForm?.userName || ''} onChange={e => handleEditKoField('userName', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white text-xs font-black" /> : <p className="text-slate-900 font-black">{detailTarget.userName}</p>}
                  <label className="block text-[10px] text-slate-400 mt-1">본부 (상위 조직)</label>
                  {isRequestEditing ? (
                    <select
                      value={preview.deptHead || ''}
                      onChange={(e) => handleEditHeadChange(e.target.value)}
                      className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black"
                    >
                      <option value="">선택</option>
                      {hqUnits.map((u) => (
                        <option key={`h-${u.id}`} value={u.unit_name}>{u.unit_name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-slate-900 font-black">{detailTarget.deptHead || '-'}</p>
                  )}
                  <label className="block text-[10px] text-slate-400 mt-1">센터 (하위 조직)</label>
                  {isRequestEditing ? (
                    <select
                      value={preview.deptName || ''}
                      disabled={!preview.deptHead}
                      onChange={(e) => handleEditSubChange(e.target.value)}
                      className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">(본부의 하위 센터만 선택)</option>
                      {childCenterUnits.map((u) => (
                        <option key={`s-${u.id}`} value={u.unit_name}>{u.unit_name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-slate-900 font-black">{detailTarget.deptName || '-'}</p>
                  )}
                  <label className="block text-[10px] text-slate-400 mt-1">직책/직급</label>
                  {isRequestEditing ? (
                    <select
                      value={preview.title}
                      onChange={(e) => handleEditTitleChange(e.target.value)}
                      className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black"
                    >
                      <option value="">선택</option>
                      {!titleInMaster && preview.title ? (
                        <option value={preview.title}>{preview.title} (현재값)</option>
                      ) : null}
                      {duties.length > 0 && (
                        <optgroup label="직책">
                          {duties.map((d) => (
                            <option key={`duty-${d.id}`} value={d.label}>{d.label}</option>
                          ))}
                        </optgroup>
                      )}
                      {grades.length > 0 && (
                        <optgroup label="직급 (직책 없을 때)">
                          {grades.map((g) => (
                            <option key={`grade-${g.id}`} value={g.label}>{g.label}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  ) : (
                    <p className="text-slate-900 font-black">{detailTarget.title}</p>
                  )}
                  <label className="block text-[10px] text-slate-400 mt-1">자격사항</label>
                  {isRequestEditing ? <input type="text" value={requestEditForm?.additionalKo || ''} onChange={e => handleEditKoField('additionalKo', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black" /> : <p className="text-slate-900 font-black">{detailTarget.additionalKo || '-'}</p>}
                  <label className="block text-[10px] text-slate-400 mt-1">휴대전화</label>
                  {isRequestEditing ? <input type="text" value={requestEditForm?.mobile || ''} onChange={e => handleEditKoField('mobile', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono font-black">{detailTarget.mobile}</p>}
                  <label className="block text-[10px] text-slate-400 mt-1">내선전화</label>
                  {isRequestEditing ? <input type="text" value={requestEditForm?.phone || ''} onChange={e => handleEditKoField('phone', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono">{detailTarget.phone || '-'}</p>}
                  <label className="block text-[10px] text-slate-400 mt-1">이메일</label>
                  {isRequestEditing ? <input type="text" value={requestEditForm?.email || ''} onChange={e => handleEditKoField('email', e.target.value)} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono">{detailTarget.email}</p>}
                </div>
                <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                  {isRequestEditing ? (
                    <>
                      <label className="block text-[10px] text-slate-400">주소지 선택</label>
                      <select
                        value={addressSelectValue}
                        onChange={(e) => handleEditAddressChange(e.target.value)}
                        className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black"
                      >
                        <option value="">선택</option>
                        {addressOptions.map((a) => (
                          <option key={a.id} value={a.id}>{a.label}</option>
                        ))}
                      </select>
                      <p className="text-[11px] font-bold text-slate-500">팩스: <span className="font-mono text-slate-800">{preview.fax || '-'}</span></p>
                      <p className="text-[11px] font-bold text-slate-500 leading-relaxed">주소: <span className="text-slate-800">[{preview.zipCode}] {preview.addressKo}</span></p>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-bold text-slate-600 mb-1">팩스: <span className="font-mono text-slate-900">{detailTarget.fax || '-'}</span></p>
                      <p className="text-[11px] font-bold text-slate-600 leading-relaxed">주소: <span className="text-slate-900">[{detailTarget.zipCode}] {detailTarget.addressKo}</span></p>
                    </>
                  )}
                </div>
              </div>

              {/* 영문 영역 (우측) */}
              <div className="space-y-2 pl-1 flex flex-col">
                <h3 className="text-xs font-black text-indigo-800 border-b border-indigo-100 pb-1.5">2. 영문 조판 데이터</h3>
                <div className="space-y-1.5 text-xs font-bold text-slate-600 flex-1">
                  <label className="block text-[10px] text-slate-400 mt-1">영문 성명</label>
                  {isRequestEditing ? <input type="text" value={requestEditForm?.userNameEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, userNameEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-black" /> : <p className="text-indigo-900 font-black">{detailTarget.userNameEn || '-'}</p>}
                  <label className="block text-[10px] text-slate-400 mt-1">영문 본부 (상위 조직) (조직 연동)🔒</label>
                  {isRequestEditing ? (
                    <input type="text" readOnly value={preview.deptHeadEn || '-'} className={syncedCls} />
                  ) : (
                    <p className="text-indigo-900 font-black">{detailTarget.deptHeadEn || '-'}</p>
                  )}
                  <label className="block text-[10px] text-slate-400 mt-1">영문 센터 (하위 조직) (조직 연동)🔒</label>
                  {isRequestEditing ? (
                    <input type="text" readOnly value={preview.deptNameEn || '-'} className={syncedCls} />
                  ) : (
                    <p className="text-indigo-900 font-black">{detailTarget.deptNameEn || '-'}</p>
                  )}
                  <label className="block text-[10px] text-slate-400 mt-1">영문 직책/직급🔒</label>
                  {isRequestEditing ? (
                    <input type="text" readOnly value={preview.titleEn || '-'} className={syncedCls} />
                  ) : (
                    <p className="text-indigo-900 font-black">{detailTarget.titleEn || '-'}</p>
                  )}
                  <label className="block text-[10px] text-slate-400 mt-1">영문 자격사항</label>
                  {isRequestEditing ? <input type="text" value={requestEditForm?.additionalEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, additionalEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-black" /> : <p className="text-indigo-900 font-black">{detailTarget.additionalEn || '-'}</p>}
                  <label className="block text-[10px] text-slate-400 mt-1">영문 휴대전화 (국문 연동)🔒</label>
                  {isRequestEditing ? (
                    <input type="text" readOnly value={previewMobileEn || '-'} className={`${syncedCls} font-mono`} />
                  ) : (
                    <p className="text-indigo-900 font-mono font-black">{previewMobileEn || '-'}</p>
                  )}
                  <label className="block text-[10px] text-slate-400 mt-1">영문 내선전화 (국문 연동)🔒</label>
                  {isRequestEditing ? (
                    <input type="text" readOnly value={previewPhoneEn || '-'} className={`${syncedCls} font-mono`} />
                  ) : (
                    <p className="text-indigo-900 font-mono">{previewPhoneEn || '-'}</p>
                  )}
                  <label className="block text-[10px] text-slate-400 mt-1">영문 이메일 (국문 연동)🔒</label>
                  {isRequestEditing ? (
                    <input type="text" readOnly value={preview.emailEn || '-'} className={`${syncedCls} font-mono`} />
                  ) : (
                    <p className="text-indigo-900 font-mono">{detailTarget.emailEn || '-'}</p>
                  )}
                </div>
                <div className="mt-4 p-3 bg-white rounded-xl border border-indigo-100">
                  <p className="text-[11px] font-bold text-slate-600 mb-1">영문 팩스: <span className="font-mono text-indigo-900">{stripBusinessCardEnPlus(preview.faxEn) || '-'}</span></p>
                  <p className="text-[11px] font-bold text-slate-600 leading-relaxed">영문 주소: <span className="text-indigo-900">{preview.addressEn || '-'}</span></p>
                </div>
              </div>
              </>
                );
              })()}
            </div> 

            {/* 2. 발주 수량 컨트롤러 구역 */}
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between shadow-inner">
              <div>
                <label className="block text-sm font-black text-rose-900 mb-0.5">📦 명함 발주 최종 수량 (통)</label>
                <p className="text-[10px] text-rose-700 font-bold">인쇄소에 전달될 최종 제작 수량입니다. 수정이 필요할 경우 우측 폼에서 조정하세요.</p>
              </div>
              <div className="w-32">
                {isRequestEditing ? (
                  <input type="number" min="1" value={requestEditForm?.quantity || 1} onChange={e => setRequestEditForm({...requestEditForm!, quantity: parseInt(e.target.value)})} className="w-full p-2.5 border-2 border-rose-400 rounded-xl bg-white text-rose-700 font-black text-base text-center outline-none focus:border-rose-600" />
                ) : (
                  <div className="w-full p-2.5 bg-white border-2 border-rose-200 rounded-xl text-rose-600 font-black text-base text-center shadow-sm">{detailTarget.quantity || 1} 통</div>
                )}
              </div>
            </div>

            {/* 정보 수정 모드 관리자 메모 */}
            {isRequestEditing && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <label className="block text-xs font-black text-amber-900 mb-2">📝 수정 사유 (임직원 마이페이지에 표시됩니다) *</label>
                <input type="text" value={adminMemoInput} onChange={(e) => setAdminMemoInput(e.target.value)} placeholder="예: 직급 오기재 수정, 영문 성명 스펠링 수정 등" className="w-full p-2.5 text-xs font-bold text-slate-800 border border-amber-300 rounded-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200" />
              </div>
            )}

            {/* 하단 버튼 구역 */}
            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100 mt-2">
              {isRequestEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setIsRequestEditing(false); setAdminMemoInput(''); }}
                    className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-xl font-black text-xs hover:bg-slate-300 transition-colors"
                  >
                    수정 취소
                  </button>
                  <button
                    type="button"
                    disabled={!canEditMaster}
                    title={!canEditMaster ? '편집 권한 필요' : undefined}
                    onClick={handleSaveRequestPayload}
                    className={`px-6 py-2.5 rounded-xl font-black text-xs transition-colors shadow-md ${
                      canEditMaster
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : DISABLED_ACTION_BTN
                    }`}
                  >
                    변경사항 DB 저장
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setDetailTarget(null)} className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-black text-xs hover:bg-slate-200 transition-colors">닫기</button>
                  {detailTarget.adminStatus === '대기중' && (
                    <button
                      type="button"
                      disabled={!canEditMaster}
                      title={!canEditMaster ? '편집 권한 필요' : undefined}
                      onClick={() => {
                      if (!canEditMaster) return alertNoEditPermission();
                      const matched =
                        addresses.find((a) => a.id === detailTarget.addressId) ||
                        addresses.find((a) => a.zipCode === detailTarget.zipCode && a.addressKo === detailTarget.addressKo);
                      setIsRequestEditing(true);
                      setRequestEditForm({
                        ...detailTarget,
                        addressId: matched?.id || detailTarget.addressId || '',
                      });
                      setAdminMemoInput('');
                    }}
                      className={`px-5 py-2.5 rounded-xl font-black text-xs transition-colors shadow-sm ${
                        canEditMaster
                          ? 'bg-amber-500 text-white hover:bg-amber-600'
                          : DISABLED_ACTION_BTN
                      }`}
                    >
                      ✏️ 정보 직접 수정하기
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🚀 자격사항 및 주소 마스터 모달 (기존 동일 유지) */}
      {isQualModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-black text-slate-900">🎓 명함 전용 자격사항 (국/영문) 단어장 관리</h2>
                <p className="text-[10px] text-slate-400 mt-1">
                  ※ 「시드 항목 복구(Edit)」는 누락·미사용분만 다시 채우며 기존 국문·영문명은 유지합니다.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!canEditMaster}
                  title={!canEditMaster ? '편집 권한 필요' : '시드 기본 자격사항 중 없거나 미사용인 항목만 추가/재활성'}
                  onClick={handleRestoreSeedQualifications}
                  className={`text-[10px] font-black px-3 py-2 rounded-xl border transition-all ${
                    canEditMaster
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  시드 항목 복구(Edit)
                </button>
                <button onClick={() => setIsQualModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 font-black text-sm">✕</button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div>
                <h3 className="text-xs font-black text-slate-800 mb-3 tracking-widest uppercase">등록된 자격사항 매핑 목록</h3>
                <div className="space-y-2">
                  {qualifications.map(q => (
                    <div key={q.id} className={`p-3 border rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-2 transition-colors ${q.isActive ? 'border-indigo-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                      {editingQualId === q.id ? (
                        <div className="flex flex-1 gap-2 w-full">
                          <input type="text" value={editQualForm.nameKo} onChange={e => setEditQualForm({...editQualForm, nameKo: e.target.value})} className="border p-1 text-xs rounded font-bold w-1/2" placeholder="국문명" />
                          <input type="text" value={editQualForm.nameEn} onChange={e => setEditQualForm({...editQualForm, nameEn: e.target.value})} className="border p-1 text-xs rounded font-bold w-1/2" placeholder="영문명" />
                        </div>
                      ) : (
                        <div className="flex gap-4 items-center flex-1">
                          <span className={`text-xs font-black w-32 ${q.isActive ? 'text-indigo-700' : 'text-slate-400'}`}>{q.nameKo}</span>
                          <span className="text-slate-300 font-light">|</span>
                          <span className={`text-[11px] font-bold ${q.isActive ? 'text-slate-700' : 'text-slate-400'}`}>{q.nameEn}</span>
                          {!q.isActive && <span className="ml-2 text-[9px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded">미사용</span>}
                        </div>
                      )}
                      <div className="flex items-center gap-1 w-full md:w-auto justify-end">
                        {editingQualId === q.id ? (
                          <>
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => executeUpdateQual(q.id)}
                              className={`px-2 py-1 font-black text-[10px] rounded ${
                                canEditMaster ? 'bg-emerald-600 text-white hover:bg-emerald-700' : DISABLED_ACTION_BTN
                              }`}
                            >
                              저장
                            </button>
                            <button onClick={() => setEditingQualId(null)} className="px-2 py-1 bg-slate-200 text-slate-600 font-black text-[10px] rounded hover:bg-slate-300">취소</button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => {
                                if (!canEditMaster) return alertNoEditPermission();
                                setEditingQualId(q.id);
                                setEditQualForm({ nameKo: q.nameKo, nameEn: q.nameEn });
                              }}
                              className={`px-2 py-1 font-black text-[10px] rounded ${
                                canEditMaster
                                  ? 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              수정(Edit)
                            </button>
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => toggleQualActive(q.id)}
                              className={`px-2 py-1 text-[10px] font-black rounded ${
                                !canEditMaster
                                  ? DISABLED_ACTION_BTN
                                  : q.isActive
                                    ? 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
                                    : 'bg-slate-800 border border-slate-800 text-white hover:bg-slate-700'
                              }`}
                            >
                              {q.isActive ? '중단(Edit)' : '사용(Edit)'}
                            </button>
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => executeDeleteQual(q.id, q.nameKo)}
                              className={`px-2 py-1 font-black text-[10px] rounded ${
                                canEditMaster
                                  ? 'bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              삭제(Edit)
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {qualifications.length === 0 && <p className="text-xs text-slate-400 text-center py-4">등록된 자격사항 단어가 없습니다.</p>}
                </div>
              </div>

              <div className="p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-4">
                <h3 className="text-xs font-black text-indigo-900 tracking-widest uppercase">➕ 신규 자격사항(국/영문 대칭) 등록</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">국문 자격명</label>
                    <input type="text" value={newQual.nameKo} onChange={e => setNewQual({...newQual, nameKo: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">영문 자격명</label>
                    <input type="text" value={newQual.nameEn} onChange={e => setNewQual({...newQual, nameEn: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canEditMaster}
                  title={!canEditMaster ? '편집 권한 필요' : undefined}
                  onClick={saveNewQual}
                  className={`w-full py-3 font-black text-xs rounded-xl shadow-sm transition-colors ${
                    canEditMaster
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  위 설정으로 단어장에 등록하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddressModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-black text-slate-900">⚙️ 전사 공통 주소지 및 팩스번호 설정</h2>
                <p className="text-[10px] text-slate-400 mt-1">
                  ※ 「시드 항목 복구(Edit)」는 누락·미사용분만 다시 채우며 기존 주소·팩스는 유지합니다.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!canEditMaster}
                  title={!canEditMaster ? '편집 권한 필요' : '시드 기본 주소 중 없거나 미사용인 항목만 추가/재활성'}
                  onClick={handleRestoreSeedAddresses}
                  className={`text-[10px] font-black px-3 py-2 rounded-xl border transition-all ${
                    canEditMaster
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  시드 항목 복구(Edit)
                </button>
                <button onClick={() => setIsAddressModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 font-black text-sm">✕</button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div>
                <h3 className="text-xs font-black text-slate-800 mb-3 tracking-widest uppercase">등록된 공통 선택지 목록</h3>
                <div className="space-y-3">
                  {addresses.map(a => (
                    <div key={a.id} className={`p-4 border rounded-2xl flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 transition-colors ${a.isActive ? 'border-slate-300 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                      {editingAddressId === a.id ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1">
                          <input type="text" value={editAddressForm.label || ''} onChange={e => setEditAddressForm({...editAddressForm, label: e.target.value})} className="border p-1 text-xs rounded font-bold" placeholder="선택지명" />
                          <input type="text" value={editAddressForm.zipCode || ''} onChange={e => setEditAddressForm({...editAddressForm, zipCode: e.target.value})} className="border p-1 text-xs rounded font-mono" placeholder="우편번호" />
                          <input type="text" value={editAddressForm.addressKo || ''} onChange={e => setEditAddressForm({...editAddressForm, addressKo: e.target.value})} className="border p-1 text-xs rounded md:col-span-2" placeholder="국문 주소" />
                          <input type="text" value={editAddressForm.addressEn || ''} onChange={e => setEditAddressForm({...editAddressForm, addressEn: e.target.value})} className="border p-1 text-xs rounded md:col-span-2" placeholder="영문 주소" />
                          <input type="text" value={editAddressForm.fax || ''} onChange={e => setEditAddressForm({...editAddressForm, fax: e.target.value})} className="border p-1 text-xs rounded font-mono" placeholder="국문 팩스" />
                          <input type="text" value={editAddressForm.faxEn || ''} onChange={e => setEditAddressForm({...editAddressForm, faxEn: e.target.value})} className="border p-1 text-xs rounded font-mono" placeholder="영문 팩스" />
                        </div>
                      ) : (
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-black ${a.isActive ? 'text-blue-700' : 'text-slate-400'}`}>{a.label}</span>
                            {!a.isActive && <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded">미사용</span>}
                          </div>
                          <p className="text-[11px] text-slate-600 font-bold">[{a.zipCode}] {a.addressKo}</p>
                          <p className="text-[11px] text-slate-400 leading-normal">{a.addressEn}</p>
                          <p className="text-[11px] font-mono text-slate-500">Fax: {a.fax} / En Fax: {a.faxEn}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-1 md:flex-col justify-end min-w-[80px]">
                        {editingAddressId === a.id ? (
                          <>
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={executeUpdateAddress}
                              className={`w-full py-1 font-black text-[10px] rounded ${
                                canEditMaster ? 'bg-emerald-600 text-white hover:bg-emerald-700' : DISABLED_ACTION_BTN
                              }`}
                            >
                              저장
                            </button>
                            <button onClick={() => setEditingAddressId(null)} className="w-full py-1 bg-slate-200 text-slate-600 font-black text-[10px] rounded hover:bg-slate-300">취소</button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => {
                                if (!canEditMaster) return alertNoEditPermission();
                                setEditingAddressId(a.id);
                                setEditAddressForm(a);
                              }}
                              className={`w-full py-1 font-black text-[10px] rounded ${
                                canEditMaster
                                  ? 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              수정(Edit)
                            </button>
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => toggleAddressActive(a.id)}
                              className={`w-full py-1 text-[10px] font-black rounded ${
                                !canEditMaster
                                  ? DISABLED_ACTION_BTN
                                  : a.isActive
                                    ? 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
                                    : 'bg-slate-800 border border-slate-800 text-white hover:bg-slate-700'
                              }`}
                            >
                              {a.isActive ? '중단(Edit)' : '사용(Edit)'}
                            </button>
                            <button
                              type="button"
                              disabled={!canEditMaster}
                              title={!canEditMaster ? '편집 권한 필요' : undefined}
                              onClick={() => executeDeleteAddress(a.id, a.label)}
                              className={`w-full py-1 font-black text-[10px] rounded ${
                                canEditMaster
                                  ? 'bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              삭제(Edit)
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                <h3 className="text-xs font-black text-slate-800 tracking-widest uppercase">➕ 신규 선택지(주소/팩스) 등록</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">선택지명 (예: 부산지사)</label>
                    <input type="text" value={newAddress.label || ''} onChange={e => setNewAddress({...newAddress, label: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">우편번호</label>
                    <input type="text" value={newAddress.zipCode || ''} onChange={e => setNewAddress({...newAddress, zipCode: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs font-mono" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">국문 상세 주소</label>
                    <input type="text" value={newAddress.addressKo || ''} onChange={e => setNewAddress({...newAddress, addressKo: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">영문 상세 주소</label>
                    <input type="text" value={newAddress.addressEn || ''} onChange={e => setNewAddress({...newAddress, addressEn: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">팩스 번호 (국문)</label>
                    <input type="text" value={newAddress.fax || ''} onChange={e => setNewAddress({...newAddress, fax: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs font-mono" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">팩스 번호 (영문)</label>
                    <input type="text" value={newAddress.faxEn || ''} onChange={e => setNewAddress({...newAddress, faxEn: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs font-mono" />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canEditMaster}
                  title={!canEditMaster ? '편집 권한 필요' : undefined}
                  onClick={saveNewAddress}
                  className={`w-full mt-2 py-3 font-black text-xs rounded-xl shadow-sm transition-colors ${
                    canEditMaster
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  위 설정으로 공통 주소지 등록하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BusinessCardAdminApplyModal
        open={isAdminApplyOpen}
        onClose={() => setIsAdminApplyOpen(false)}
        onSaved={fetchRequests}
        units={units}
        duties={duties}
        grades={grades}
        addresses={addresses}
        qualifications={qualifications}
        sheetsPerPack={sheetsPerPack}
      />
    </div>
  );
}