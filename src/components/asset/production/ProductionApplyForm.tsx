'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { getProductionCategoryFolderTabClasses } from '@/lib/production-category-theme';
import { resolveInterfaceEditState } from '@/lib/permission-utils';

const MENU_PATH = '/asset/production/apply/request';

type CompanyAddressRow = {
  id: string;
  label: string;
  zipCode: string;
  addressKo: string;
  addressEn?: string;
  fax?: string;
  faxEn?: string;
  isActive: boolean;
};

type JebonSizeMasterRow = {
  code: string;
  label: string;
  size: string;
  description: string;
};

const isJebonCustomSizeCode = (code: string) => code === '비규격' || code === 'CUSTOM';

const formatJebonSizeSelectLabel = (row: JebonSizeMasterRow) => {
  const spec = row.size?.trim();
  const desc = row.description?.trim();
  if (spec && desc) return `${row.label} (${spec}) — ${desc}`;
  if (spec) return `${row.label} (${spec})`;
  if (desc) return `${row.label} — ${desc}`;
  return row.label;
};

const resolveJebonSizeSpec = (code: string, rows: JebonSizeMasterRow[]) => {
  if (isJebonCustomSizeCode(code)) return '';
  const row = rows.find((r) => r.code === code);
  return row?.size?.trim() || code;
};

type JebonCertMasterRow = {
  id: string;
  label: string;
  jebonFormat: string;
  jebonDefaultSizeType: string;
  jebonDefaultQuantity: number;
  useJebonCover: boolean;
  useJebonCoverDate: boolean;
  jebonCoverColor: string;
  jebonCoverPageCount: string;
  jebonInnerColor: string;
};

const JEBON_SIZE_FALLBACK: JebonSizeMasterRow[] = [
  { code: 'A4', label: 'A4', size: '210 × 297mm', description: '표준 기본' },
  { code: 'B5', label: 'B5', size: '182 × 257mm', description: '' },
  { code: 'A5', label: 'A5', size: '148 × 210mm', description: '' },
  { code: 'B6', label: 'B6', size: '128 × 182mm', description: '' },
  { code: '16절', label: '16절', size: '197 × 272mm', description: '' },
  { code: '비규격', label: '비규격', size: '', description: '직접 입력' },
];

/** 시드 판형 — 삭제(LV_1) 라벨·권한 구분용 */
const SEED_JEBON_SIZE_IDS = [
  'A4',
  'B5',
  'A5',
  'B6',
  '16절',
  '비규격',
] as const;

const isSeedJebonSizeCode = (code: string) =>
  SEED_JEBON_SIZE_IDS.includes(code as (typeof SEED_JEBON_SIZE_IDS)[number]);

/** 종류·규격·설명·버튼 열 너비 고정 (행마다 flex 밀림 방지) */
const JEBON_SIZE_MASTER_GRID =
  'grid grid-cols-1 md:grid-cols-[minmax(4rem,0.85fr)_minmax(7rem,1.5fr)_minmax(4rem,1fr)_7.25rem] gap-x-3 gap-y-2 items-end';

const buildProductionShippingAddress = (data: {
  shippingZipCode?: string;
  shippingAddressRoad?: string;
  shippingAddressDetail?: string;
  shippingAddress?: string;
}) => {
  const zip = data.shippingZipCode?.trim() || '';
  const road = data.shippingAddressRoad?.trim() || '';
  const detail = data.shippingAddressDetail?.trim() || '';
  if (zip && road) {
    return `[${zip}] ${road}${detail ? ` ${detail}` : ''}`;
  }
  return data.shippingAddress?.trim() || '';
};

const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none';

/** 시드 인증 — 버튼 라벨·삭제 권한(LV_1) 구분용 */
const SEED_CERT_IDS = [
  'GSEED',
  'BF',
  'CONDENDSATION',
  'EDUCATIONAL',
  'ENERGY',
  'OLD_ZEB',
  'INTEGRATED_ZEB',
  'ISO',
  'NORMAL',
  'GSEED_JEBON',
  'ENERGY_JEBON',
  'OLD_ZEB_JEBON',
  'INTEGRATED_ZEB_JEBON',
] as const;

type CustomRequestRow = { id: number; value: string };

// 카테고리 마스터 탭 설정
const CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

export default function ProductionApplyForm() {
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [isPrintItemModalOpen, setIsPrintItemModalOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('SIGN'); 
  const todayStr = getKSTDateString();
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

  const editState = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig),
    [currentUser, interfaceConfig]
  );
  const canEdit = editState.isEditor;
  /** 시드 인증 삭제(LV_1) — 시스템 LV_1 또는 메뉴 Master만 */
  const canDeleteLv1Cert = editState.isMaster;
  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
  const alertNoLv1Permission = () => alert('시드 항목 삭제는 LV_1(마스터) 권한이 필요합니다.');

  const handleVendorPriorityChange = async (
    vendor: {
      id: string;
      label: string;
      managerName?: string;
      contact?: string;
      email?: string;
      items?: string;
      priorityCategory?: string;
    },
    priorityCategory: string
  ) => {
    if (!canEdit) return alertNoEditPermission();
    try {
      const res = await fetch('/api/asset/production/master/vendors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...vendor, priorityCategory }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.message || '우선 연결 저장 실패');
      }
      await reloadMasters();
    } catch {
      alert('우선 연결 저장 중 오류가 발생했습니다.');
    }
  };

  const renderVendorPrioritySelect = (
    value: string,
    onChange: (next: string) => void,
    disabled = false
  ) => (
    <select
      value={value || ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`text-[10px] font-black rounded-lg border px-2 py-1 outline-none ${
        disabled
          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
          : 'bg-indigo-50 text-indigo-700 border-indigo-200 cursor-pointer focus:border-indigo-400'
      }`}
      title="이 업체를 우선 연결할 품목"
    >
      <option value="">우선 품목 없음</option>
      {CATEGORIES.map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.icon} {cat.label}
        </option>
      ))}
    </select>
  );

  // 공통 마스터 — DB API 로드 (localStorage/하드코딩 금지)
  const [plateMasterList, setPlateMasterList] = useState<
    { code: string; label: string; price: number; size: string }[]
  >([]);
  const [vendorMasterList, setVendorMasterList] = useState<{
    id: string;
    label: string;
    managerName?: string;
    contact?: string;
    email?: string;
    items?: string;
    priorityCategory?: string;
  }[]>([]);
  const [printItemMasterList, setPrintItemMasterList] = useState<
    {
      id: string;
      name: string;
      size: string;
      supplier: string;
      orderQty: number;
      unitValue: string;
      isCustom: boolean;
      sortOrder: number;
    }[]
  >([]);
  const [unitOptions, setUnitOptions] = useState<{ label: string; value: string }[]>([]);
  const [mastersReady, setMastersReady] = useState(false);

  // 팝업 내부 신규/수정 업체 입력 보조 상태
  const emptyVendorForm = {
    label: '',
    managerName: '',
    contact: '',
    email: '',
    items: '',
    priorityCategory: '',
  };
  const emptyPrintItemForm = {
    name: '',
    size: '',
    supplier: '',
    orderQty: 1,
    unitValue: 'VAL_1',
    isCustom: false,
    sortOrder: 0,
  };
  const [newPrintItemData, setNewPrintItemData] = useState(emptyPrintItemForm);
  const [editingPrintItemId, setEditingPrintItemId] = useState<string | null>(null);
  const [editingPrintItemData, setEditingPrintItemData] = useState(emptyPrintItemForm);
  const [isPrintItemMenuOpen, setIsPrintItemMenuOpen] = useState(false);
  const printItemMenuRef = useRef<HTMLDivElement | null>(null);
  const [newVendorData, setNewVendorData] = useState(emptyVendorForm);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [editingVendorData, setEditingVendorData] = useState(emptyVendorForm);

  const [signCertMasterList, setSignCertMasterList] = useState<
    {
      id: string;
      label: string;
      format: string;
      useCertNumber: boolean;
      useValidPeriod: boolean;
      useMultiGradeSelect: boolean;
      linkedPlateCodes: string[];
    }[]
  >([]);
  const [jebonCertMasterList, setJebonCertMasterList] = useState<JebonCertMasterRow[]>([]);

  // ⚙️ 모달 및 에디터 제어 변수 정의
  const [popSubTab, setPopSubTab] = useState<'SIGN_SUB' | 'JEBON_SUB'>('SIGN_SUB');
  const [jebonSettingsTab, setJebonSettingsTab] = useState<'CERT' | 'SIZE'>('CERT');
  const [jebonSizeMasterList, setJebonSizeMasterList] =
    useState<JebonSizeMasterRow[]>(JEBON_SIZE_FALLBACK);
  const [newJebonSize, setNewJebonSize] = useState({
    label: '',
    size: '',
    description: '',
  });
  const [editingJebonSizeCode, setEditingJebonSizeCode] = useState<string | null>(null);
  const [editingJebonSizeDraft, setEditingJebonSizeDraft] = useState<JebonSizeMasterRow | null>(
    null
  );
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [editingCertForm, setEditingCertForm] = useState({ label: '', format: '', jebonFormat: '' });
  const [editingJebonDraft, setEditingJebonDraft] = useState<{
    label: string;
    jebonDefaultSizeType: string;
    jebonDefaultQuantity: number;
    useJebonCover: boolean;
    jebonCoverColor: string;
    jebonCoverPageCount: string;
    jebonInnerColor: string;
    jebonFormat: string;
    useJebonCoverDate: boolean;
  } | null>(null);
  const [editingSignDraft, setEditingSignDraft] = useState<{
    label: string;
    useCertNumber: boolean;
    useValidPeriod: boolean;
    format: string;
  } | null>(null);
  const [newCertName, setNewCertName] = useState('');

  // 3. 🎯 [관계형 등급 맵 마스터] — cert API grades
  const [gradeMasterMap, setGradeMasterMap] = useState<Record<string, string[]>>({});

  // 🛠️ 모달 제어용 플래그 상태
  const [isPlateModalOpen, setIsPlateModalOpen] = useState(false);
  const [isCertModalOpen, setIsCertModalOpen] = useState(false);
  
  const [selectedMasterCertId, setSelectedMasterCertId] = useState<string>('GSEED');
  const [isSessionLoading, setIsSessionLoading] = useState(true);
// 🚀 [추가] 중복 제출 방지용 상태 락(Lock)
const [isSubmitting, setIsSubmitting] = useState(false);


// 📝 실무 신청서 폼 상태 대장
const [signData, setSignData] = useState({
  applyDate: todayStr,       
  dept: '',                   
  manager: '',              
  vendor: '',
  plateType: '',
  certType: '',         
  certLevel: '',          
  productionName: '', 
  
  // 🔒 [기존 코드 유지] 실제 현판/명판에 인쇄될 핵심 데이터 필드
  projectName: '', 
  jebonBuildingName: '',  // 제본(JEBON) 일반제본 전용 건물명
  jebonSubtitle: '',      // 📚 제본(JEBON) 일반제본(NORMAL) 전용 표지 서브 부제목 (신설!)

  // 🚀 [신설 및 중복 제거 완료] 각 탭별 '관리용 제목' 전용 청정 독립 그릇들
  signFormTitle: '',       // 📛 현판 관리용 제목
  jebonFormTitle: '',      // 📚 제본 관리용 제목
  printFormTitle: '',      // 📜 기성품 관리용 제목
  suppliesProjectName: '', // 📎 사무문구 관리용 제목
  
  certNumber: '',            
  validPeriodRaw: '',        
  receiverName: '',          
  receiverPhone: '',         
  shippingZipCode: '',
  shippingAddressRoad: '',
  shippingAddressDetail: '',
  shippingAddress: '',       
  companyName: '',           
  applicantName: '',         
  applicantPhone: '',
  quantity: 1,
  isoCompanyName: '', // 👈 신설: ISO 탭 전용 기업명 보관 그릇 추가!
  // 제본(JEBON) 전용 상태
  coverColor: '컬러',     
  innerColor: '흑백',     
  certPhase: '예비인증',    
  coverName: '', 
  compDateRaw: '', 
  coverPageCount: '', 
  innerPageCount: '',
  coverPageFromAttachment: false,
  innerPageFromAttachment: true,
  jebonSizeType: 'A4', 
  jebonSize: 'A4', 
  internalSystemSerial: '', 

  // 기성 서식/소모품 전용 상태
  printItemType: '',
  printItemId: '', 
  printItemDetails: '', // 🔒 3-1 내부 정산용 관리 비고 칸 전용
  printCustomName: '',
  printDeliveryDetails: '',
  printUnitValue: 'VAL_1', // 기타제작 신청 수량 단위 (unit_category_group) 
  
  // 사무문구류 텍스트 보관 그릇
  suppliesQuoteRawText: '', 
});

  // /api/auth/me + interface 권한 칩
  useEffect(() => {
    async function loadUserSession() {
      try {
        const ts = Date.now();
        const [meRes, ifRes, summaryRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
            cache: 'no-store',
          }).catch(() => null),
        ]);
        if (meRes.ok) {
          const user = await meRes.json();
          setCurrentUser(user);
          setSignData((prev) => ({
            ...prev,
            dept: user.unit?.unit_name || '소속 조직 없음',
            manager: user.name || '담당자명 없음',
          }));
        } else {
          setSignData((prev) => ({ ...prev, dept: '미인증 조직', manager: '익명 사용자' }));
        }
        if (ifRes && ifRes.ok) {
          const interfaces = await ifRes.json();
          const menu = Array.isArray(interfaces)
            ? interfaces.find(
                (m: any) =>
                  m.path === MENU_PATH || m.path?.includes('/production/apply/request')
              )
            : null;
          setInterfaceConfig(menu || null);
        } else {
          setInterfaceConfig(null);
        }
        if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
        else setPermissionSummary(null);
      } catch (error) {
        setSignData((prev) => ({ ...prev, dept: '오류 부서', manager: '오류 담당자' }));
      } finally {
        setIsSessionLoading(false);
      }
    }
    loadUserSession();
  }, []);

  const applyCertRows = (certs: any[]) => {
    const list = Array.isArray(certs) ? certs : [];
    const signRows = list
      .filter((c) => c.type === 'SIGN')
      .map((c) => ({
        id: c.certId,
        label: c.label,
        format: c.format || '',
        useCertNumber: c.useCertNumber !== false,
        useValidPeriod: c.useValidPeriod !== false,
        useMultiGradeSelect: c.useMultiGradeSelect === true,
        linkedPlateCodes: Array.isArray(c.linkedPlateCodes)
          ? c.linkedPlateCodes.map(String)
          : [],
      }));
    const jebonRows = list
      .filter((c) => c.type === 'JEBON')
      .map((c) => ({
        id: c.certId,
        label: c.label,
        jebonFormat: c.jebonFormat || '',
        jebonDefaultSizeType: c.jebonDefaultSizeType || 'A4',
        jebonDefaultQuantity: Math.max(1, Number(c.jebonDefaultQuantity) || 1),
        useJebonCover: c.useJebonCover !== false,
        useJebonCoverDate: c.useJebonCoverDate !== false,
        jebonCoverColor: c.jebonCoverColor || '컬러',
        jebonCoverPageCount: c.jebonCoverPageCount || '1',
        jebonInnerColor: c.jebonInnerColor || '흑백',
      }))
      .sort((a, b) => {
        // 일반제본(NORMAL)을 맨 위 고정
        if (a.id === 'NORMAL') return -1;
        if (b.id === 'NORMAL') return 1;
        return 0;
      });
    const grades: Record<string, string[]> = {};
    list.forEach((c) => {
      grades[c.certId] = Array.isArray(c.grades) ? c.grades.map(String) : [];
    });
    setSignCertMasterList(signRows);
    setJebonCertMasterList(jebonRows);
    setGradeMasterMap(grades);
    setSelectedMasterCertId((prev) => {
      const allIds = [...signRows.map((r) => r.id), ...jebonRows.map((r) => r.id)];
      if (prev && allIds.includes(prev)) return prev;
      return signRows[0]?.id || jebonRows[0]?.id || prev;
    });
  };

  const reloadUnitOptions = async () => {
    const ts = Date.now();
    try {
      const [configRes, masterRes] = await Promise.all([
        fetch(`/api/admin/config?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' }),
      ]);
      if (!configRes.ok || !masterRes.ok) return;
      const config = await configRes.json();
      const masterData = await masterRes.json();
      const groupId = config?.unit_category_group;
      if (!groupId || !Array.isArray(masterData)) return;
      const group = masterData.find((g: any) => g.id === groupId);
      const codes = (group?.codes || []).filter(
        (c: any) => c.is_active !== false && !c.is_archived
      );
      setUnitOptions(
        codes.map((c: any) => ({
          label: String(c.label || ''),
          value: String(c.value || ''),
        }))
      );
    } catch {
      /* ignore — 단위 미로드 시 기본 VAL_1 */
    }
  };

  const resolveUnitLabel = (unitValue?: string) => {
    const value = unitValue || 'VAL_1';
    return unitOptions.find((c) => c.value === value)?.label || '개(EA)';
  };

  /** 수량 옆 짧은 단위 표기: 개(EA) → 개 */
  const shortUnitLabel = (fullLabel: string) => {
    const short = String(fullLabel || '')
      .replace(/\([^)]*\)/g, '')
      .trim();
    return short || fullLabel || 'EA';
  };

  const resolveDefaultVendorId = (
    tab: string,
    rows: { id: string; priorityCategory?: string }[],
    currentVendor: string
  ) => {
    if (rows.some((r) => r.id === currentVendor)) return currentVendor;
    if (tab === 'PRINT') return '';
    const priority = rows.find((r) => r.priorityCategory === tab);
    return priority?.id || rows[0]?.id || '';
  };

  const reloadMasters = async () => {
    const ts = Date.now();
    const [vendorsRes, platesRes, certsRes, jebonSizesRes, addressesRes, printItemsRes] =
      await Promise.all([
      fetch(`/api/asset/production/master/vendors?t=${ts}`, { cache: 'no-store' }),
      fetch(`/api/asset/production/master/plates?t=${ts}`, { cache: 'no-store' }),
      fetch(`/api/asset/production/master/certs?t=${ts}`, { cache: 'no-store' }),
      fetch(`/api/asset/production/master/jebon-sizes?t=${ts}`, { cache: 'no-store' }),
      fetch(`/api/asset/businesscard/master/addresses?t=${ts}`, { cache: 'no-store' }),
      fetch(`/api/asset/production/master/print-items?t=${ts}`, { cache: 'no-store' }),
    ]);
    if (vendorsRes.ok) {
      const vendors = await vendorsRes.json();
      const rows = Array.isArray(vendors)
        ? vendors.map((v: any) => ({
            id: v.id,
            label: v.label,
            managerName: v.managerName || '',
            contact: v.contact || '',
            email: v.email || '',
            items: v.items || '',
            priorityCategory: v.priorityCategory || '',
          }))
        : [];
      setVendorMasterList(rows);
      setSignData((prev) => ({
        ...prev,
        vendor: resolveDefaultVendorId(activeTab, rows, prev.vendor),
      }));
    }
    if (platesRes.ok) {
      const plates = await platesRes.json();
      const rows = Array.isArray(plates)
        ? plates.map((p: any) => ({
            code: p.code,
            label: p.label,
            price: Number(p.price) || 0,
            size: p.size || '자율 규격',
          }))
        : [];
      setPlateMasterList(rows);
      setSignData((prev) => ({
        ...prev,
        plateType: rows.some((r) => r.code === prev.plateType)
          ? prev.plateType
          : rows[0]?.code || '',
      }));
    }
    if (certsRes.ok) {
      applyCertRows(await certsRes.json());
    }
    if (jebonSizesRes.ok) {
      const sizes = await jebonSizesRes.json();
      const rows = Array.isArray(sizes)
        ? sizes.map((s: any) => ({
            code: String(s.code || ''),
            label: String(s.label || s.code || ''),
            size: String(s.size || ''),
            description: String(s.description || ''),
          }))
        : [];
      setJebonSizeMasterList(rows.length > 0 ? rows : JEBON_SIZE_FALLBACK);
    }
    if (addressesRes.ok) {
      const rows = await addressesRes.json();
      setCompanyAddresses(Array.isArray(rows) ? rows : []);
    }
    if (printItemsRes.ok) {
      const items = await printItemsRes.json();
      const rows = Array.isArray(items)
        ? items.map((p: any) => ({
            id: p.id,
            name: p.name || '',
            size: p.size || '',
            supplier: p.supplier || '',
            orderQty: Math.max(1, Number(p.orderQty) || 1),
            unitValue: String(p.unitValue || 'VAL_1').trim() || 'VAL_1',
            isCustom: p.isCustom === true,
            sortOrder: Number(p.sortOrder) || 0,
          }))
        : [];
      setPrintItemMasterList(rows);
      setSignData((prev) => {
        const stillValid = rows.some((r) => r.id === prev.printItemId);
        const next = stillValid ? rows.find((r) => r.id === prev.printItemId)! : rows[0];
        if (!next) {
          return { ...prev, printItemId: '', printItemType: '', printCustomName: '' };
        }
        return {
          ...prev,
          printItemId: next.id,
          printItemType: next.name,
          printCustomName: next.isCustom ? prev.printCustomName || '' : next.name,
          printUnitValue: stillValid
            ? prev.printUnitValue || next.unitValue || 'VAL_1'
            : next.unitValue || 'VAL_1',
          ...(stillValid ? {} : { quantity: Math.max(1, Number(next.orderQty) || 1) }),
        };
      });
    }
    setMastersReady(true);
  };

  const prevActiveTabRef = useRef(activeTab);
  useEffect(() => {
    if (!mastersReady || vendorMasterList.length === 0) return;

    const tabChanged = prevActiveTabRef.current !== activeTab;
    prevActiveTabRef.current = activeTab;

    if (activeTab === 'PRINT') {
      if (tabChanged) {
        setDeliveryMode('HQ_RECEIVE');
        setSignData((prev) => ({ ...prev, vendor: '' }));
      }
      return;
    }

    if (tabChanged) {
      setDeliveryMode(
        activeTab === 'JEBON' || activeTab === 'OFFICE_SUPPLIES'
          ? 'HQ_RECEIVE'
          : 'CUSTOMER_DIRECT'
      );
      const priority = vendorMasterList.find((v) => v.priorityCategory === activeTab);
      if (priority) {
        setSignData((prev) => ({ ...prev, vendor: priority.id }));
      }
    }
  }, [activeTab, mastersReady, vendorMasterList]);

  useEffect(() => {
    Promise.all([
      reloadMasters().catch(() => setMastersReady(true)),
      reloadUnitOptions(),
    ]).catch(() => setMastersReady(true));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const scriptId = 'kakao-postcode-script-production';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  const openProductionPostcode = () => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          setSelectedCompanyAddressId('');
          setSignData((prev) => ({
            ...prev,
            shippingZipCode: data.zonecode,
            shippingAddressRoad: data.roadAddress || data.address,
          }));
        },
      }).open();
    } else {
      alert('주소 검색 엔진을 로드 중입니다. 잠시 후 다시 클릭해 주세요.');
    }
  };

  const applyCompanyAddress = (addrId: string) => {
    setSelectedCompanyAddressId(addrId);
    if (!addrId) return;
    const target = companyAddresses.find((a) => a.id === addrId);
    if (!target) return;
    setSignData((prev) => ({
      ...prev,
      shippingZipCode: target.zipCode,
      shippingAddressRoad: target.addressKo,
      shippingAddressDetail: '',
    }));
  };

  const persistCert = async (payload: {
    certId: string;
    type: 'SIGN' | 'JEBON';
    label: string;
    format?: string;
    jebonFormat?: string;
    grades?: string[];
    useCertNumber?: boolean;
    useValidPeriod?: boolean;
    useMultiGradeSelect?: boolean;
    linkedPlateCodes?: string[];
    jebonDefaultSizeType?: string;
    jebonDefaultQuantity?: number;
    useJebonCover?: boolean;
    useJebonCoverDate?: boolean;
    jebonCoverColor?: string;
    jebonCoverPageCount?: string;
    jebonInnerColor?: string;
  }) => {
    const res = await fetch('/api/asset/production/master/certs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || '인증 마스터 저장 실패');
    }
    await reloadMasters();
  }; 

// 🚀 인증 종류(certType) 변경에 따른 등급 안전 리셋 및 React 의존성 경고 해결
useEffect(() => {
  setSignData(prev => {
    const cert = signCertMasterList.find((c) => c.id === prev.certType);
    // 복수 선택 모드는 쉼표 구분 문자열이므로 단일 등급 리셋 로직을 건너뜀
    if (cert?.useMultiGradeSelect) return prev;

    const availableGrades = gradeMasterMap[prev.certType] || [];
    if (!availableGrades.includes(prev.certLevel)) {
      return { ...prev, certLevel: availableGrades[0] || '' };
    }
    return prev;
  });
}, [signData.certType, gradeMasterMap, signCertMasterList]);

// 🚀 탭 간 이동 시 존재하지 않는 인증 종류(certType) 잔재 청소
useEffect(() => {
  if (activeTab === 'SIGN') {
    if (!signCertMasterList.find(c => c.id === signData.certType)) {
      setSignData(prev => ({ ...prev, certType: signCertMasterList[0]?.id || '' }));
    }
  } else if (activeTab === 'JEBON') {
    if (!jebonCertMasterList.find(c => c.id === signData.certType)) {
      setSignData(prev => ({ ...prev, certType: jebonCertMasterList[0]?.id || '' }));
    }
  }
}, [activeTab, signCertMasterList, jebonCertMasterList]);

// 🚀 달력 팝업(type="date") 방식에 맞춘 제본 완료일자 포맷팅
const formattedCompDate = useMemo(() => {
  const targetCert = jebonCertMasterList.find((c) => c.id === signData.certType);
  if (targetCert?.useJebonCoverDate === false) return '';
  // 값이 없으면 빈 칸 반환
  if (!signData.compDateRaw) return '';

  // "YYYY-MM-DD" 형태를 쪼개서 가져오기
  const [y, mRaw, dRaw] = signData.compDateRaw.split('-');
  if (!y || !mRaw || !dRaw) return '';

  // 앞자리 0 제거 (예: "07" -> "7")
  const m = String(parseInt(mRaw, 10));
  const d = String(parseInt(dRaw, 10));

  const format = (targetCert?.jebonFormat || '').trim();
  // 양식 미설정 시 공란 (기본값으로 임의 포맷하지 않음)
  if (!format) return '';

  if (format.includes('0000. 00. 00')) {
    return `${y}. ${mRaw}. ${dRaw}.`;
  } else if (format.includes('0000. 0. 0')) {
    const hasTrailingDot = format.endsWith('.');
    return `${y}. ${m}. ${d}${hasTrailingDot ? '.' : ''}`;
  }
  return `${y}. ${m}. ${d}.`;
}, [signData.compDateRaw, signData.certType, jebonCertMasterList]);

// 🚀 명판 날인 유효기간 실시간 출력 포맷팅 (무한 루프 버그 완벽 해결)
const formattedValidPeriod = useMemo(() => {
  const raw = signData.validPeriodRaw.replace(/\D/g, ''); 
  const targetCert = signCertMasterList.find(c => c.id === signData.certType);
  let format = targetCert?.format || '0000.00.00.~0000.00.00.';

  // 입력값이 없으면 원본 포맷 그대로 반환
  if (raw.length === 0) return format;

  let result = '';
  let rawIndex = 0;

  // 💡 서식 문자열을 한 글자씩 돌면서 '0'을 만나면 입력한 숫자로 1:1 교체
  for (let i = 0; i < format.length; i++) {
    if (format[i] === '0') {
      if (rawIndex < raw.length) {
        result += raw[rawIndex]; // 입력한 숫자가 있으면 채워넣기
        rawIndex++;
      } else {
        result += '0'; // 더 이상 입력한 숫자가 없으면 빈자리 '0' 유지
      }
    } else {
      result += format[i]; // 점(.), 물결(~), 공백 등은 그대로 출력
    }
  }

  return result;
}, [signData.validPeriodRaw, signData.certType, signCertMasterList]);

  const [editingPlateIndex, setEditingPlateIndex] = useState<number | null>(null);
  const [newPlate, setNewPlate] = useState({ label: '', price: 0, size: '' });
  
  const [editingGradeIndex, setEditingGradeIndex] = useState<number | null>(null);
  const [editingGradeValue, setEditingGradeValue] = useState<string>('');
  const [newGradeName, setNewGradeName] = useState('');

  const [customRequests, setCustomRequests] = useState<CustomRequestRow[]>([]);
  const [companyAddresses, setCompanyAddresses] = useState<CompanyAddressRow[]>([]);
  const [selectedCompanyAddressId, setSelectedCompanyAddressId] = useState('');
  /** 실배송지 모드: 고객사 직발송 | 인증원 수령(부서 대장에서 입력) */
  const [deliveryMode, setDeliveryMode] = useState<'CUSTOMER_DIRECT' | 'HQ_RECEIVE'>('CUSTOMER_DIRECT');
  /** 제본 레거시 호환 — HQ_RECEIVE 와 동기 */
  const jebonBatchShipping = deliveryMode === 'HQ_RECEIVE';
  const setJebonBatchShipping = (checked: boolean) =>
    setDeliveryMode(checked ? 'HQ_RECEIVE' : 'CUSTOMER_DIRECT');

  const currentSelectedInfo = useMemo(() => {
    const target = plateMasterList.find(p => p.code === signData.plateType);
    return {
      label: target?.label || '미지정 품목',
      size: target?.size || '자율 규격',
      priceStr: target ? `${target.price.toLocaleString()}원` : '0원'
    };
  }, [signData.plateType, plateMasterList]);

  const selectedSignCert = useMemo(
    () => signCertMasterList.find((c) => c.id === signData.certType),
    [signCertMasterList, signData.certType]
  );
  const useCertNumberField = selectedSignCert?.useCertNumber !== false;
  const useValidPeriodField = selectedSignCert?.useValidPeriod !== false;
  const useMultiGradeField = selectedSignCert?.useMultiGradeSelect === true;

  /** 선택 인증에 연결된 현판 품목 (미연결 시 전체 — 설정 전 호환) */
  const availableSignPlates = useMemo(() => {
    const linked = selectedSignCert?.linkedPlateCodes || [];
    if (linked.length === 0) return plateMasterList;
    const set = new Set(linked);
    return plateMasterList.filter((p) => set.has(p.code));
  }, [selectedSignCert?.linkedPlateCodes, plateMasterList]);

  // 인증 변경 시 연결되지 않은 품목이면 첫 연결 품목으로 맞춤
  useEffect(() => {
    if (activeTab !== 'SIGN') return;
    if (availableSignPlates.length === 0) {
      if (signData.plateType) {
        setSignData((prev) => ({ ...prev, plateType: '' }));
      }
      return;
    }
    if (!availableSignPlates.some((p) => p.code === signData.plateType)) {
      setSignData((prev) => ({
        ...prev,
        plateType: availableSignPlates[0].code,
      }));
    }
  }, [activeTab, availableSignPlates, signData.plateType]);

  const selectedJebonCert = useMemo(
    () => jebonCertMasterList.find((c) => c.id === signData.certType),
    [jebonCertMasterList, signData.certType]
  );
  const useJebonCoverField = selectedJebonCert?.useJebonCover !== false;
  const useJebonCoverDateField = selectedJebonCert?.useJebonCoverDate !== false;

  const selectedPrintItem = useMemo(
    () => printItemMasterList.find((p) => p.id === signData.printItemId),
    [printItemMasterList, signData.printItemId]
  );
  const isPrintCustomItem = selectedPrintItem?.isCustom === true;

  const quantityUnitLabel = useMemo(() => {
    if (activeTab === 'JEBON') return '부';
    if (activeTab === 'PRINT') {
      return shortUnitLabel(resolveUnitLabel(signData.printUnitValue));
    }
    return 'EA';
  }, [activeTab, signData.printUnitValue, unitOptions]);

  /** 제본 탭: 필드 번호 고정 (인증 종류 무관) */
  const jebonFormSteps = useMemo(
    () => ({
      certType: 1,
      certPhase: 2,
      size: 3,
      cover: 4,
      inner: 5,
      building: 6,
      coverDate: 7,
      customRequest: 8,
    }),
    []
  );

  const customRequestStepNumber = useMemo(() => {
    if (activeTab === 'SIGN') return 7;
    if (activeTab === 'JEBON') return jebonFormSteps.customRequest;
    if (activeTab === 'PRINT') return 4;
    return 7;
  }, [activeTab, jebonFormSteps.customRequest]);

  const printItemReferenceText = (item: {
    size: string;
    supplier: string;
    orderQty: number;
    unitValue?: string;
  }) => {
    const unit = shortUnitLabel(resolveUnitLabel(item.unitValue));
    const parts = [
      item.size?.trim(),
      item.supplier?.trim(),
      item.orderQty > 0 ? `${item.orderQty}${unit}` : '',
    ].filter(Boolean);
    return parts.length ? `(${parts.join('/')})` : '';
  };

  useEffect(() => {
    if (!isPrintItemMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!printItemMenuRef.current?.contains(e.target as Node)) {
        setIsPrintItemMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isPrintItemMenuOpen]);

  const applyPrintItemSelection = (item: {
    id: string;
    name: string;
    size: string;
    supplier: string;
    orderQty: number;
    unitValue?: string;
    isCustom: boolean;
  }) => {
    setSignData((prev) => ({
      ...prev,
      printItemId: item.id,
      printItemType: item.name,
      printCustomName: item.isCustom ? '' : item.name,
      quantity: Math.max(1, Number(item.orderQty) || 1),
      printUnitValue: item.unitValue || 'VAL_1',
    }));
    setIsPrintItemMenuOpen(false);
  };

  const lastAppliedJebonDefaultsRef = useRef('');
  useEffect(() => {
    if (activeTab !== 'JEBON' || !signData.certType) return;
    const cert = jebonCertMasterList.find((c) => c.id === signData.certType);
    if (!cert) return;
    if (lastAppliedJebonDefaultsRef.current === cert.id) return;
    lastAppliedJebonDefaultsRef.current = cert.id;
    const sizeCode = cert.jebonDefaultSizeType || jebonSizeMasterList[0]?.code || 'A4';
    setSignData((prev) => ({
      ...prev,
      jebonSizeType: sizeCode,
      jebonSize: resolveJebonSizeSpec(sizeCode, jebonSizeMasterList),
      quantity: Math.max(1, Number(cert.jebonDefaultQuantity) || 1),
      coverColor: cert.jebonCoverColor || '컬러',
      coverPageCount: cert.useJebonCover ? cert.jebonCoverPageCount || '1' : '',
      innerColor: cert.jebonInnerColor || '흑백',
      coverPageFromAttachment: false,
      innerPageFromAttachment: true,
      innerPageCount: '',
      // 일반제본: 인증 단계 해당없음 · 표지 일자 비활성 시 입력 초기화
      ...(cert.id === 'NORMAL'
        ? { certPhase: '해당없음' }
        : {
            certPhase: prev.certPhase === '해당없음' ? '예비인증' : prev.certPhase,
          }),
      ...(cert.useJebonCoverDate === false ? { compDateRaw: '' } : {}),
    }));
  }, [activeTab, signData.certType, jebonCertMasterList, jebonSizeMasterList]);

  const persistJebonCertRow = async (
    c: JebonCertMasterRow,
    patch: Partial<JebonCertMasterRow>
  ) => {
    await persistCert({
      certId: c.id,
      type: 'JEBON',
      label: patch.label ?? c.label,
      format: '',
      jebonFormat: patch.jebonFormat ?? c.jebonFormat,
      grades: gradeMasterMap[c.id] || [],
      jebonDefaultSizeType: patch.jebonDefaultSizeType ?? c.jebonDefaultSizeType,
      jebonDefaultQuantity: patch.jebonDefaultQuantity ?? c.jebonDefaultQuantity,
      useJebonCover: patch.useJebonCover ?? c.useJebonCover,
      useJebonCoverDate: patch.useJebonCoverDate ?? c.useJebonCoverDate,
      jebonCoverColor: patch.jebonCoverColor ?? c.jebonCoverColor,
      jebonCoverPageCount: patch.jebonCoverPageCount ?? c.jebonCoverPageCount,
      jebonInnerColor: patch.jebonInnerColor ?? c.jebonInnerColor,
    });
  };

  const beginJebonRowEdit = (c: JebonCertMasterRow) => {
    if (!canEdit) return alertNoEditPermission();
    setEditingCertId(c.id);
    setEditingJebonDraft({
      label: c.label,
      jebonDefaultSizeType: c.jebonDefaultSizeType || 'A4',
      jebonDefaultQuantity: Math.max(1, Number(c.jebonDefaultQuantity) || 1),
      useJebonCover: c.useJebonCover !== false,
      useJebonCoverDate: c.useJebonCoverDate !== false,
      jebonCoverColor: c.jebonCoverColor || '컬러',
      jebonCoverPageCount: c.jebonCoverPageCount || '1',
      jebonInnerColor: c.jebonInnerColor || '흑백',
      jebonFormat: c.jebonFormat || '',
    });
  };

  const cancelJebonRowEdit = () => {
    setEditingCertId(null);
    setEditingJebonDraft(null);
  };

  const saveJebonRowEdit = async (c: JebonCertMasterRow) => {
    if (!canEdit) return alertNoEditPermission();
    if (!editingJebonDraft) return;
    if (!editingJebonDraft.label.trim()) return alert('인증 종류 명칭을 입력해 주세요.');
    try {
      await persistJebonCertRow(c, {
        label: editingJebonDraft.label.trim(),
        jebonDefaultSizeType: editingJebonDraft.jebonDefaultSizeType,
        jebonDefaultQuantity: Math.max(1, Number(editingJebonDraft.jebonDefaultQuantity) || 1),
        useJebonCover: editingJebonDraft.useJebonCover,
        useJebonCoverDate: editingJebonDraft.useJebonCoverDate,
        jebonCoverColor: editingJebonDraft.jebonCoverColor,
        jebonCoverPageCount: editingJebonDraft.jebonCoverPageCount || '1',
        jebonInnerColor: editingJebonDraft.jebonInnerColor,
        jebonFormat: editingJebonDraft.jebonFormat,
      });
      cancelJebonRowEdit();
    } catch (err: any) {
      alert(err?.message || '저장 실패');
    }
  };

  type SignCertMasterRow = {
    id: string;
    label: string;
    format: string;
    useCertNumber: boolean;
    useValidPeriod: boolean;
    useMultiGradeSelect: boolean;
  };

  const beginSignRowEdit = (c: SignCertMasterRow) => {
    if (!canEdit) return alertNoEditPermission();
    setEditingCertId(c.id);
    setEditingSignDraft({
      label: c.label,
      useCertNumber: c.useCertNumber !== false,
      useValidPeriod: c.useValidPeriod !== false,
      format: c.format || '',
    });
    setSelectedMasterCertId(c.id);
  };

  const cancelSignRowEdit = () => {
    setEditingCertId(null);
    setEditingSignDraft(null);
  };

  const saveSignRowEdit = async (c: SignCertMasterRow) => {
    if (!canEdit) return alertNoEditPermission();
    if (!editingSignDraft) return;
    if (!editingSignDraft.label.trim()) return alert('인증 종류 명칭을 입력해 주세요.');
    try {
      await persistCert({
        certId: c.id,
        type: 'SIGN',
        label: editingSignDraft.label.trim(),
        format: editingSignDraft.useValidPeriod ? editingSignDraft.format : '',
        jebonFormat: '',
        grades: gradeMasterMap[c.id] || [],
        useCertNumber: editingSignDraft.useCertNumber,
        useValidPeriod: editingSignDraft.useValidPeriod,
        useMultiGradeSelect: c.useMultiGradeSelect,
      });
      cancelSignRowEdit();
    } catch (err: any) {
      alert(err?.message || '저장 실패');
    }
  };

  const handleAddPlateMaster = async () => {
    if (!newPlate.label.trim()) return alert('판 명칭을 입력하세요.');
    const code = `PLATE_${Date.now()}`;
    try {
      const res = await fetch('/api/asset/production/master/plates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          label: newPlate.label.trim(),
          price: newPlate.price,
          size: newPlate.size || '자율 규격',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.message || '명판 마스터 저장 실패');
      }
      setNewPlate({ label: '', price: 0, size: '' });
      await reloadMasters();
    } catch {
      alert('명판 마스터 저장 중 오류가 발생했습니다.');
    }
  };

  const handleSavePlateRow = async (p: {
    code: string;
    label: string;
    price: number;
    size: string;
  }) => {
    if (!canEdit) return alertNoEditPermission();
    try {
      const res = await fetch('/api/asset/production/master/plates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.message || '명판 마스터 저장 실패');
      }
      setEditingPlateIndex(null);
      await reloadMasters();
    } catch {
      alert('명판 마스터 저장 중 오류가 발생했습니다.');
    }
  };

  const handleIdDeletePlate = async (code: string) => {
    if (!canEdit) return alertNoEditPermission();
    if (plateMasterList.length <= 1) return alert('최소 한 개 이상의 판 종류가 존재해야 합니다.');
    if (!confirm('해당 판 종류와 연동된 단가/규격 설정을 마스터 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(
        `/api/asset/production/master/plates?code=${encodeURIComponent(code)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.error || err.message || '삭제 실패');
      }
      await reloadMasters();
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  const handleAddJebonSizeMaster = async () => {
    if (!newJebonSize.label.trim()) return alert('종류를 입력하세요.');
    const code = `JSIZE_${Date.now()}`;
    try {
      const res = await fetch('/api/asset/production/master/jebon-sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          label: newJebonSize.label.trim(),
          size: newJebonSize.size.trim(),
          description: newJebonSize.description.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.error || err.message || '판형 저장 실패');
      }
      setNewJebonSize({ label: '', size: '', description: '' });
      await reloadMasters();
    } catch {
      alert('판형 저장 중 오류가 발생했습니다.');
    }
  };

  const handleSaveJebonSizeRow = async (row: JebonSizeMasterRow) => {
    if (!canEdit) return alertNoEditPermission();
    if (!row.label.trim()) return alert('종류를 입력하세요.');
    try {
      const res = await fetch('/api/asset/production/master/jebon-sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.error || err.message || '판형 저장 실패');
      }
      setEditingJebonSizeCode(null);
      setEditingJebonSizeDraft(null);
      await reloadMasters();
    } catch {
      alert('판형 저장 중 오류가 발생했습니다.');
    }
  };

  const handleDeleteJebonSize = async (code: string) => {
    if (isSeedJebonSizeCode(code)) {
      if (!canDeleteLv1Cert) return alertNoLv1Permission();
    } else if (!canEdit) {
      return alertNoEditPermission();
    }
    if (jebonSizeMasterList.length <= 1) {
      return alert('최소 한 개 이상의 판형이 존재해야 합니다.');
    }
    if (!confirm('해당 판형을 마스터에서 삭제(비활성)하시겠습니까?')) return;
    try {
      const res = await fetch(
        `/api/asset/production/master/jebon-sizes?code=${encodeURIComponent(code)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.error || err.message || '삭제 실패');
      }
      await reloadMasters();
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  const handleAddCertMaster = async () => {
    if (!canEdit) return alertNoEditPermission();
    if (!newCertName.trim()) return alert('인증 명칭을 기재해 주세요.');
    const type = popSubTab === 'SIGN_SUB' ? 'SIGN' : 'JEBON';
    const certId = `CERT_${Date.now()}`;
    try {
      await persistCert({
        certId,
        type,
        label: newCertName.trim(),
        format: type === 'SIGN' ? '0000.00.00.~0000.00.00.' : '',
        jebonFormat: type === 'JEBON' ? '0000. 0. 0.' : '',
        grades: ['기본 등급'],
        useCertNumber: true,
        useValidPeriod: true,
        useMultiGradeSelect: false,
        jebonDefaultSizeType: 'A4',
        jebonDefaultQuantity: 1,
        useJebonCover: true,
        useJebonCoverDate: true,
        jebonCoverColor: '컬러',
        jebonCoverPageCount: '1',
        jebonInnerColor: '흑백',
      });
      setSelectedMasterCertId(certId);
      setNewCertName('');
    } catch (e: any) {
      alert(e?.message || '인증 마스터 등록 실패');
    }
  };

  const isSeedCertId = (id: string) =>
    SEED_CERT_IDS.includes(id as (typeof SEED_CERT_IDS)[number]);

  const handleIdDeleteCert = async (id: string) => {
    if (isSeedCertId(id)) {
      if (!canDeleteLv1Cert) return alertNoLv1Permission();
    } else if (!canEdit) {
      return alertNoEditPermission();
    }
    if (!confirm('이 인증 종류를 리스트에서 마스터 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(
        `/api/asset/production/master/certs?certId=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.error || err.message || '삭제 실패');
      }
      await reloadMasters();
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

// 🚀 최종 폼 제출 핸들러 (중복 제출 방지 및 4개 탭 완벽 격리 버전)
const handleSubmit = async () => {
  if (!canEdit) return alertNoEditPermission();
  // 1. 이미 제출 중이면 함수를 바로 종료 (중복 클릭 연타 방지 락!)
  if (isSubmitting) return;

  if (!signData.vendor) {
    return alert(
      activeTab === 'PRINT'
        ? '외주 업체를 선택해 주세요.'
        : '외주 발주 처리 업체를 지정해 주세요.'
    );
  }

// [가드 2] 각 탭별 전용 필수 사양 검사
if (activeTab === 'SIGN') {
  if (!signData.signFormTitle.trim()) return alert("관리용 제목을 입력해 주세요.");
  if (!signData.plateType || availableSignPlates.length === 0) {
    return alert('현판 품목을 선택해 주세요. (인증별 서식 설정에서 품목 연결 필요)');
  }
  const projectOrOrg =
    signData.certType === 'ISO'
      ? String(signData.isoCompanyName || '').trim()
      : String(signData.projectName || '').trim();
  if (!projectOrOrg) {
    return alert('프로젝트명/건물명/경영시스템 조직명을 입력해 주세요.');
  }
} else if (activeTab === 'JEBON') {
    // 📚 jebonProjectName 대신 신설된 jebonFormTitle로 필수값 체크!
    if (!signData.jebonFormTitle.trim() && !signData.jebonBuildingName.trim() && !signData.coverName.trim()) {
      return alert("관리용 제목 또는 프로젝트명/건물명/표지제목 중 최소 하나는 반드시 입력하셔야 합니다.");
    }
  } else if (activeTab === 'PRINT') {
    // 📜 printProjectName 대신 신설된 printFormTitle로 필수값 체크!
    if (!signData.printFormTitle.trim()) return alert("관리용 제목을 입력해 주세요.");
    if (!signData.printItemId && !signData.printItemType) return alert("주문하실 소모품 종류를 선택해 주세요.");
    if (isPrintCustomItem && !signData.printCustomName.trim()) {
      return alert("기타소모품 명칭/규격을 직접 기재해 주세요.");
    }
  } else if (activeTab === 'OFFICE_SUPPLIES') {
    // 📎 사무문구는 기존에 정리된 suppliesProjectName을 그대로 검사합니다.
    if (!signData.suppliesProjectName.trim()) return alert("관리용 제목을 입력해 주세요.");
    if (!signData.suppliesQuoteRawText.trim()) return alert("견적서 텍스트 내용을 붙여넣어 주세요.");
  }

// [가드 3] 실배송지 및 수량 필수 검사
// 「인증원 수령/묶음 발주」선택 시 배송지 필수 검사 스킵 → 부서 대장에서 입력
{
  const skipShippingRequired = deliveryMode === 'HQ_RECEIVE';
  if (!skipShippingRequired) {
    if (!signData.receiverName.trim() || !signData.receiverPhone.trim()) {
      return alert('수령인 성명과 연락처를 입력해 주세요.');
    }
    if (!signData.shippingZipCode.trim() || !signData.shippingAddressRoad.trim()) {
      return alert('배송지 우편번호 검색 또는 전사 공통 주소 불러오기를 이용해 주세요.');
    }
    if (!signData.shippingAddressDetail.trim()) {
      return alert('배송지 상세주소(동·호수 등)를 입력해 주세요.');
    }
  }
  if (activeTab !== 'OFFICE_SUPPLIES' && signData.quantity < 1) {
    return alert('수량은 1개 이상이어야 합니다.');
  }
}

  const selectedPlate = plateMasterList.find(p => p.code === signData.plateType);
  // 🚀 현판(SIGN) 탭일 때만 단가를 계산하고, 다른 탭은 0원 처리!
  const estimatedPrice = activeTab === 'SIGN' ? (selectedPlate?.price || 0) * signData.quantity : 0;
  const selectedVendorInfo = vendorMasterList.find(v => v.id === signData.vendor);
  const currentCertList = activeTab === 'SIGN' ? signCertMasterList : jebonCertMasterList;
  const selectedCertInfo = currentCertList.find(c => c.id === signData.certType);

  const composedShippingAddress = buildProductionShippingAddress(signData);

  // 🚀 백엔드로 전송할 대표 제목(projectName) 4분할 맵핑 핵심 구간
  const payload = {
    category: activeTab,
    projectName: 
      activeTab === 'SIGN'            ? signData.signFormTitle :
      activeTab === 'JEBON'           ? (signData.jebonFormTitle || signData.jebonBuildingName || signData.coverName) :
      activeTab === 'PRINT'           ? signData.printFormTitle : 
                                        signData.suppliesProjectName,
    quantity: activeTab === 'OFFICE_SUPPLIES' ? 1 : signData.quantity,
    estimatedPrice: activeTab === 'OFFICE_SUPPLIES' ? 0 : estimatedPrice,
    options: {
      ...signData,
      ...(deliveryMode === 'HQ_RECEIVE'
        ? {
            receiverName: '',
            receiverPhone: '',
            shippingZipCode: '',
            shippingAddressRoad: '',
            shippingAddressDetail: '',
            shippingAddress: '',
            companyAddressLabel: '',
          }
        : {
            shippingAddress: composedShippingAddress,
            companyAddressLabel:
              companyAddresses.find((a) => a.id === selectedCompanyAddressId)?.label || '',
          }),
      deliveryMode,
      jebonBatchShipping: deliveryMode === 'HQ_RECEIVE',
      isoCompanyName: signData.isoCompanyName, // 👈 백엔드로 데이터 무사히 넘기기 위해 추가
      vendor: selectedVendorInfo ? selectedVendorInfo.label : signData.vendor,
      certType: selectedCertInfo ? selectedCertInfo.label : signData.certType,
      formattedValidPeriod:
        activeTab === 'SIGN' &&
        useValidPeriodField &&
        signData.validPeriodRaw.replace(/\D/g, '').length > 0
          ? formattedValidPeriod
          : '',
      formattedCompDate:
        activeTab === 'JEBON' &&
        useJebonCoverDateField &&
        signData.compDateRaw
          ? formattedCompDate
          : '',
      plateMasterInfo: currentSelectedInfo,
      printItemMasterInfo: selectedPrintItem
        ? {
            id: selectedPrintItem.id,
            name: selectedPrintItem.name,
            size: selectedPrintItem.size,
            supplier: selectedPrintItem.supplier,
            orderQty: selectedPrintItem.orderQty,
            unitValue: signData.printUnitValue || selectedPrintItem.unitValue || 'VAL_1',
            unitLabel: resolveUnitLabel(
              signData.printUnitValue || selectedPrintItem.unitValue
            ),
            isCustom: selectedPrintItem.isCustom,
          }
        : null,
      customRequests: customRequests
        .filter((req) => req.value.trim() !== '')
        .map((req) => ({ value: req.value.trim() })),
    }
  };

  // 🚀 모든 검사가 통과되었으므로 여기서부터 자물쇠를 잠급니다!
  setIsSubmitting(true);

  try {
    const res = await fetch('/api/asset/production/apply/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert("성공적으로 제작 신청이 접수되었습니다.");
      router.push('/asset/production/apply/history'); 
    } else {
      const errorData = await res.json();
      alert(`신청 실패: ${errorData.message}`);
    }
  } catch (error) {
    alert("네트워크 오류가 발생했습니다. 관리자에게 문의하세요.");
  } finally {
    // 🚀 성공하든 실패하든, 통신이 끝나면 무조건 자물쇠를 다시 풀어줍니다!
    setIsSubmitting(false);
  }
};

// 🚀 안전한 위치로 정착된 세션 로딩 가드
if (typeof isSessionLoading !== 'undefined' && (isSessionLoading || !mastersReady)) {
  return <LoadingState />;
}

// 🚀 메인 UI 렌더링 리턴 시작
return (
  <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
    
    {/* register 배너 규격 · catalog 색상(blue→indigo) + interface 칩 */}
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-sky-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-indigo-900/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-2.5">
            DEPARTMENT PRODUCTION PROCESS CENTER
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-blue-200 font-normal">{currentUser?.name || signData.manager || '임직원'} 님</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-extrabold">맞춤 제작물 신청 허브</span>
          </h1>
          <p className="text-white/70 text-xs mt-3 leading-relaxed max-w-xl">
            현판·제본·기타 제작·사무문구 발주 신청서를 작성하고 부서 관리 대장으로 이관합니다.
          </p>
          {permissionSummary && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-blue-50 shadow-sm">
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
              {!canEdit && (
                <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
                  편집 권한 없음 — 조회만 가능
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 동적 탭 네비게이션 */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-2xl mt-4">
        {[{ name: '✍️ 신규 제작물 신청', path: '/asset/production/apply/request' }, { name: '📂 나의 신청 이력 관리', path: '/asset/production/apply/history' }].map((tab) => {
          const isActive = pathname === tab.path || (tab.path === '/asset/production/apply' && pathname === '/asset/production/apply/request');
          return (
            <Link key={tab.path} href={tab.path} className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${isActive ? 'bg-white text-blue-600 shadow-sm border border-blue-200/50 scale-[1.01]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'}`}>
              {tab.name}
            </Link>
          );
        })}
      </div>

      {/* 분류 서류철 탭(좌) + MASTER CRITERIA 서류철(우) + 발급 신청서 */}
      <div className="w-full mt-2">
        {!canEdit && ['SIGN', 'JEBON', 'PRINT'].includes(activeTab) && (
          <p className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md mb-1.5 w-fit">
            마스터 수정·삭제·신청 제출은 편집 권한 필요
          </p>
        )}
        <div
          className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1 border-b border-slate-200"
          role="tablist"
          aria-label="제작 분류 및 마스터 기준"
        >
          <div className="flex flex-wrap items-end gap-1">
            {CATEGORIES.map((cat) => {
              const active = activeTab === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(cat.id)}
                  className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border ${getProductionCategoryFolderTabClasses(cat.id, active)}`}
                >
                  <span className="text-sm leading-none">{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          {['SIGN', 'JEBON', 'PRINT'].includes(activeTab) && (
            <div className="flex flex-wrap items-end gap-1 ml-auto">
              {activeTab === 'SIGN' && (
                <>
                  <button
                    type="button"
                    title="MASTER CRITERIA · 현판 품목/규격/단가"
                    onClick={() => setIsPlateModalOpen(true)}
                    className="relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border bg-slate-800 text-white border-slate-700 border-b-transparent hover:bg-slate-900"
                  >
                    <span className="text-sm leading-none">📊</span>
                    <span>현판 품목/규격/단가 설정</span>
                  </button>
                  <button
                    type="button"
                    title="MASTER CRITERIA · 인증별 현판 서식"
                    onClick={() => {
                      setPopSubTab('SIGN_SUB');
                      setEditingCertId(null);
                      setEditingJebonDraft(null);
                      setEditingSignDraft(null);
                      setSelectedMasterCertId(signCertMasterList[0]?.id || '');
                      setIsCertModalOpen(true);
                    }}
                    className="relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border bg-slate-800 text-white border-slate-700 border-b-transparent hover:bg-slate-900"
                  >
                    <span className="text-sm leading-none">📛</span>
                    <span>인증별 현판 서식 설정</span>
                  </button>
                </>
              )}
              {activeTab === 'JEBON' && (
                <button
                  type="button"
                  title="MASTER CRITERIA · 인증별 제본 서식"
                  onClick={() => {
                    setPopSubTab('JEBON_SUB');
                    setJebonSettingsTab('CERT');
                    setEditingCertId(null);
                    setEditingJebonDraft(null);
                    setEditingSignDraft(null);
                    setSelectedMasterCertId(jebonCertMasterList[0]?.id || '');
                    setIsCertModalOpen(true);
                  }}
                  className="relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border bg-slate-800 text-white border-slate-700 border-b-transparent hover:bg-slate-900"
                >
                  <span className="text-sm leading-none">📚</span>
                  <span>인증별 제본 서식 설정</span>
                </button>
              )}
              {activeTab === 'PRINT' && (
                <button
                  type="button"
                  title="MASTER CRITERIA · 기타제작 주문물품"
                  onClick={() => {
                    setEditingPrintItemId(null);
                    setNewPrintItemData(emptyPrintItemForm);
                    setIsPrintItemModalOpen(true);
                  }}
                  className="relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-tight transition-colors rounded-t-lg border bg-slate-800 text-white border-slate-700 border-b-transparent hover:bg-slate-900"
                >
                  <span className="text-sm leading-none">📜</span>
                  <span>기타제작 주문물품 설정</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 메인 폼 컨테이너 */}
        <div className="w-full bg-white rounded-b-[2rem] rounded-tr-2xl p-8 shadow-sm border border-t-0 border-slate-200/80">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <span className="text-xl">{CATEGORIES.find(c => c.id === activeTab)?.icon || '✍️'}</span>
          <h2 className="text-lg font-black text-slate-800">
            {CATEGORIES.find(c => c.id === activeTab)?.label || '부서 맞춤'} 제작 발급 신청서
          </h2>
        </div>

        {/* 요청자 자동 정보 (한 줄) — 외주 업체는 하단 제출 직전에 배치 */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl mt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase">요청일</span>
              <span className="text-xs font-bold text-slate-700">{signData.applyDate}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 min-w-0">
              <span className="text-[10px] font-black text-slate-400 uppercase">소속</span>
              <span className="text-xs font-bold text-slate-700 truncate max-w-[140px]">
                {signData.dept}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase">담당자</span>
              <span className="text-xs font-bold text-slate-700">{signData.manager}</span>
            </div>
          </div>
        </div>

        <div className="space-y-6 pt-6">
          <div className="bg-yellow-50 border-2 border-yellow-400 p-8 rounded-2xl transition-all shadow-inner space-y-6 relative mt-4">
            <div className="absolute -top-3 left-6 bg-yellow-400 text-yellow-900 px-4 py-1 rounded-full text-[10px] font-black tracking-widest shadow-sm">
              DYNAMIC AREA : {CATEGORIES.find(c => c.id === activeTab)?.label} 전용 입력 폼
            </div>

{/* 🔥 현판(SIGN) 탭일 때만 보이는 영역 */}
{activeTab === 'SIGN' && (
              <div className="space-y-6 animate-fade-in pt-2">

                <div className="p-6 bg-white rounded-2xl border border-yellow-200 space-y-6 shadow-sm">

                  {/* 1~2: 인증의 종류 | 등급/경영시스템 (좌우) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">1. 인증의 종류 <span className="text-red-500">*</span></label>
                      <select value={signData.certType} onChange={(e) => setSignData({ ...signData, certType: e.target.value, certLevel: '' })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white">
                        {signCertMasterList.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">2. 인증 등급/종류 설정 <span className="text-red-500">*</span></label>

                      {useMultiGradeField ? (
                        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                            {(gradeMasterMap[signData.certType] || []).map((grade) => {
                              const checked = signData.certLevel.includes(grade);
                              return (
                                <label key={grade} className="flex items-start gap-2 text-[11px] font-bold text-slate-700 cursor-pointer select-none hover:text-blue-600 transition-colors p-1.5 bg-white border border-slate-100 rounded-lg shadow-sm min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    className="mt-0.5 w-3.5 h-3.5 accent-blue-600 rounded cursor-pointer shrink-0"
                                    onChange={() => {
                                      let currentList = signData.certLevel ? signData.certLevel.split(', ') : [];
                                      if (checked) currentList = currentList.filter(x => x !== grade);
                                      else currentList = [...currentList, grade];
                                      setSignData({ ...signData, certLevel: currentList.join(', ') });
                                    }}
                                  />
                                  <span className="leading-snug break-keep">{grade}</span>
                                </label>
                              );
                            })}
                          </div>

                          {signData.certLevel && (
                            <div className="flex flex-wrap gap-1 border-t border-slate-200 pt-3 mt-1">
                              {signData.certLevel.split(', ').map(tag => (
                                <span key={tag} className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-black rounded-md shadow-sm animate-fade-in">✓ {tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : signData.certType === 'CONDENDSATION' ? (
                        <div className="w-full bg-slate-100 text-slate-400 font-medium rounded-xl px-4 py-3 text-xs border border-slate-200 select-none">
                          🚫 결로방지 성능평가는 별도의 마스터 등급 표기 사항이 없습니다.
                        </div>
                      ) : (
                        <select value={signData.certLevel} onChange={(e) => setSignData({ ...signData, certLevel: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white">
                          {(gradeMasterMap[signData.certType] || []).map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* 3: 현판 품목 — 선택 인증에 연결된 품목만 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start border-t border-slate-100 pt-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        3. 현판 품목 설정 <span className="text-red-500">*</span>
                      </label>
                      {availableSignPlates.length === 0 ? (
                        <div className="w-full bg-amber-50 text-amber-800 font-bold rounded-xl px-4 py-3 text-xs border border-amber-200">
                          이 인증에 연결된 현판 품목이 없습니다. 「인증별 현판 서식 설정」에서 품목을 체크해 주세요.
                        </div>
                      ) : (
                        <select
                          value={signData.plateType}
                          onChange={(e) => setSignData({ ...signData, plateType: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white"
                        >
                          {availableSignPlates.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.label} ({p.size})
                            </option>
                          ))}
                        </select>
                      )}
                      {(selectedSignCert?.linkedPlateCodes?.length || 0) === 0 && plateMasterList.length > 0 && (
                        <p className="mt-1.5 text-[9px] font-bold text-slate-400">
                          ※ 아직 품목 미연결 — 전체 품목이 표시됩니다. 서식 설정에서 연결하면 해당 품목만 남습니다.
                        </p>
                      )}
                    </div>

                    <div className="bg-slate-50/50 rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <table className="w-full text-left border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-slate-100 text-slate-500 font-black border-b border-slate-200 text-[9px]">
                            <th className="p-2 pl-4">선택 품명</th>
                            <th className="p-2 text-center">규격(mm)</th>
                            <th className="p-2 text-right pr-4">단가 (VAT별도)</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="font-bold text-slate-800 bg-white">
                            <td className="p-2.5 pl-4 text-blue-600 text-xs truncate">📦 {currentSelectedInfo.label}</td>
                            <td className="p-2.5 text-center font-mono text-slate-600">{currentSelectedInfo.size}</td>
                            <td className="p-2.5 text-right font-mono text-emerald-600 font-black pr-4">{currentSelectedInfo.priceStr}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 4~5행: 기존과 동일 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start border-t border-slate-100 pt-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        4. 프로젝트명/건물명/경영시스템 조직명{' '}
                        <span className="text-red-500">*</span>
                      </label>
                      {signData.certType === 'ISO' ? (
                        <input
                          type="text"
                          placeholder="프로젝트명·건물명·시설명·기업명 등 해당 시 기재"
                          value={signData.isoCompanyName || ''}
                          onChange={(e) =>
                            setSignData({ ...signData, isoCompanyName: e.target.value })
                          }
                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder="프로젝트명·건물명·시설명·기업명 등 해당 시 기재"
                          value={signData.projectName}
                          onChange={(e) =>
                            setSignData({ ...signData, projectName: e.target.value })
                          }
                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        5. 인증번호{' '}
                        {!useCertNumberField ? (
                          <span className="text-red-500 font-bold">(설정에 비활성화로 입력 불가)</span>
                        ) : null}
                      </label>
                      <input
                        type="text"
                        placeholder={
                          useCertNumberField
                            ? '인증번호를 기재 바랍니다.'
                            : '해당 인증은 인증번호를 입력할 수 없습니다. (설정에서 활성화 가능)'
                        }
                        value={useCertNumberField ? signData.certNumber : ''}
                        onChange={(e) =>
                          setSignData({ ...signData, certNumber: e.target.value })
                        }
                        disabled={!useCertNumberField}
                        className={`w-full border rounded-xl px-4 py-3 text-xs font-semibold outline-none transition-all ${
                          !useCertNumberField
                            ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed select-none'
                            : 'bg-white border-slate-200 text-slate-800 focus:ring-2 focus:ring-blue-500'
                        }`}
                      />
                    </div>
                  </div>

                  {/* 명판 유효기간 — 기존과 동일 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start border-t border-slate-100 pt-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        6. 현판 유효기간 (숫자 연속 입력){' '}
                        {!useValidPeriodField ? (
                          <span className="text-red-500 font-bold">(설정에 비활성화로 입력 불가)</span>
                        ) : (
                          <span className="text-slate-400 font-medium">(선택)</span>
                        )}
                      </label>
                      <input
                        type="text"
                        maxLength={16}
                        placeholder={
                          useValidPeriodField
                            ? '예: 2026071020310709 (미기입 시 날짜 없음)'
                            : '해당 인증은 유효기간을 입력할 수 없습니다.'
                        }
                        value={useValidPeriodField ? signData.validPeriodRaw : ''}
                        onChange={(e) =>
                          setSignData({
                            ...signData,
                            validPeriodRaw: e.target.value.replace(/\D/g, ''),
                          })
                        }
                        disabled={!useValidPeriodField}
                        className={`w-full border rounded-xl px-4 py-3 text-xs outline-none transition-all ${
                          !useValidPeriodField
                            ? 'font-semibold bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed select-none'
                            : 'font-black tracking-widest font-mono bg-white border-slate-200 text-blue-600 focus:ring-2 focus:ring-blue-500'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        출력 양식 미리보기
                      </label>
                      <div
                        className={`w-full min-h-[46px] flex items-center px-4 py-3 rounded-xl border text-xs ${
                          !useValidPeriodField
                            ? 'font-semibold bg-slate-100 border-slate-200 text-slate-400'
                            : 'font-mono font-black tracking-wider bg-yellow-100/50 border-yellow-200 shadow-inner'
                        }`}
                      >
                        <span className="truncate">
                          {!useValidPeriodField ? (
                            '입력 비활성'
                          ) : signData.validPeriodRaw.length > 0 ? (
                            formattedValidPeriod
                          ) : (
                            <span className="text-yellow-600/60 font-medium">
                              숫자 입력 시 실시간 반영
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 🔥 2. 제본(JEBON) 탭 뷰 */}
            {activeTab === 'JEBON' && (
              <div className="space-y-6 animate-fade-in pt-2">
              <div className="p-6 bg-white rounded-2xl border border-yellow-200 space-y-6 shadow-sm">

                {/* 🚀 3번: 제본 종류 (판형·표지·본문보다 먼저) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                      {jebonFormSteps.certType}. 제본 종류 선택 <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={signData.certType}
                      onChange={(e) => {
                        lastAppliedJebonDefaultsRef.current = '';
                        setSignData({ ...signData, certType: e.target.value });
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white"
                    >
                      {jebonCertMasterList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="animate-fade-in">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        {jebonFormSteps.certPhase}. 인증의 단계 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={signData.certPhase}
                        onChange={(e) => setSignData({ ...signData, certPhase: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white"
                      >
                        <option value="해당없음">해당없음</option>
                        <option value="예비인증">예비인증</option>
                        <option value="본인증">본인증</option>
                      </select>
                    </div>
                </div>

                {/* 🚀 1·2·3: 판형 / 표지 / 본문 — 한 줄 */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* 1. 제본 판형 */}
                  <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                      <span className="flex items-center gap-2">
                        <span>📏</span> {jebonFormSteps.size}. 제본 판형 지정{' '}
                        <span className="text-red-500">*</span>
                      </span>
                    </label>
                    <select
                      value={signData.jebonSizeType || jebonSizeMasterList[0]?.code || 'A4'}
                      onChange={(e) => {
                        const selectedType = e.target.value;
                        setSignData({
                          ...signData,
                          jebonSizeType: selectedType,
                          jebonSize: resolveJebonSizeSpec(selectedType, jebonSizeMasterList),
                        });
                      }}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-black text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                    >
                      {jebonSizeMasterList.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {formatJebonSizeSelectLabel(opt)}
                        </option>
                      ))}
                    </select>
                    {isJebonCustomSizeCode(signData.jebonSizeType) ? (
                      <input
                        type="text"
                        placeholder="예: A3 (297 x 420mm)"
                        value={signData.jebonSize || ''}
                        onChange={(e) => setSignData({ ...signData, jebonSize: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none text-slate-800 focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <div className="w-full bg-slate-100/80 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-500 flex items-center justify-between">
                        <span className="text-slate-700">{signData.jebonSize || 'A4'}</span>
                        <span className="text-[10px] text-slate-400 font-bold">✔️ 자동</span>
                      </div>
                    )}
                  </div>

                  {/* 2. 표지 Cover */}
                  <div
                    className={`p-4 rounded-2xl border space-y-3 ${
                      useJebonCoverField
                        ? 'bg-slate-50/50 border-slate-200'
                        : 'bg-slate-100/80 border-slate-200 opacity-80'
                    }`}
                  >
                    <h4 className="text-[10px] font-black text-slate-500 tracking-widest uppercase flex items-center gap-2 flex-wrap">
                      <span>📘</span> {jebonFormSteps.cover}. 표지 (Cover) 스펙{' '}
                      {useJebonCoverField ? (
                        <span className="text-red-500">*</span>
                      ) : (
                        <span className="text-red-500 font-bold">(설정에 비활성화로 입력 불가)</span>
                      )}
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1.5">
                          인쇄 방식
                        </label>
                        <select
                          value={useJebonCoverField ? signData.coverColor : ''}
                          onChange={(e) => setSignData({ ...signData, coverColor: e.target.value })}
                          disabled={!useJebonCoverField}
                          className={`w-full border rounded-xl px-3 py-2.5 text-xs outline-none ${
                            useJebonCoverField
                              ? 'bg-white border-slate-200 font-black text-slate-700 cursor-pointer focus:ring-2 focus:ring-blue-500'
                              : 'bg-slate-100 border-slate-200 font-semibold text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          {useJebonCoverField ? (
                            <>
                              <option value="컬러">컬러 인쇄</option>
                              <option value="흑백">흑백 인쇄</option>
                            </>
                          ) : (
                            <option value="">입력 비활성</option>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-1.5 leading-snug">
                          면수{' '}
                          <span className="font-semibold normal-case tracking-normal text-slate-400">
                            (ex. PDF 페이지 쪽수)
                          </span>
                        </label>
                        <input
                          type="number"
                          value={
                            useJebonCoverField && !signData.coverPageFromAttachment
                              ? signData.coverPageCount || ''
                              : ''
                          }
                          onChange={(e) =>
                            setSignData({
                              ...signData,
                              coverPageCount: e.target.value,
                              coverPageFromAttachment: false,
                            })
                          }
                          disabled={!useJebonCoverField || signData.coverPageFromAttachment}
                          className={`w-full border rounded-xl px-3 py-2.5 text-xs font-semibold outline-none text-right ${
                            useJebonCoverField && !signData.coverPageFromAttachment
                              ? 'bg-white border-slate-200 focus:ring-2 focus:ring-blue-500'
                              : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                          }`}
                        />
                        {useJebonCoverField && (
                          <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={signData.coverPageFromAttachment}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSignData({
                                  ...signData,
                                  coverPageFromAttachment: checked,
                                  coverPageCount: checked ? '' : signData.coverPageCount,
                                });
                              }}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            <span className="text-[10px] font-bold text-slate-500">면수는 첨부파일에 따름</span>
                          </label>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 3. 본문 Inner */}
                  <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 space-y-3">
                    <h4 className="text-[10px] font-black text-slate-500 tracking-widest uppercase flex items-center gap-2">
                      <span>📄</span> {jebonFormSteps.inner}. 본문 (Inner) 스펙{' '}
                      <span className="text-red-500">*</span>
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1.5">
                          인쇄 방식
                        </label>
                        <select
                          value={signData.innerColor}
                          onChange={(e) => setSignData({ ...signData, innerColor: e.target.value })}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-black text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                        >
                          <option value="흑백">흑백 인쇄</option>
                          <option value="컬러">컬러 인쇄</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-1.5 leading-snug">
                          면수{' '}
                          <span className="font-semibold normal-case tracking-normal text-slate-400">
                            (ex. PDF 페이지 쪽수)
                          </span>
                        </label>
                        <input
                          type="number"
                          value={signData.innerPageFromAttachment ? '' : signData.innerPageCount || ''}
                          onChange={(e) =>
                            setSignData({
                              ...signData,
                              innerPageCount: e.target.value,
                              innerPageFromAttachment: false,
                            })
                          }
                          disabled={signData.innerPageFromAttachment}
                          className={`w-full border rounded-xl px-3 py-2.5 text-xs font-semibold outline-none text-right ${
                            signData.innerPageFromAttachment
                              ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                              : 'bg-white border-slate-200 focus:ring-2 focus:ring-blue-500'
                          }`}
                        />
                        <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={signData.innerPageFromAttachment}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSignData({
                                ...signData,
                                innerPageFromAttachment: checked,
                                innerPageCount: checked ? '' : signData.innerPageCount,
                              });
                            }}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span className="text-[10px] font-bold text-slate-500">면수는 첨부파일에 따름</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                    {jebonFormSteps.building}. 프로젝트명/건물명/표지제목
                  </label>
                  <input
                    type="text"
                    placeholder="프로젝트명·건물명·표지 제목 등 해당 시 기재"
                    value={signData.jebonBuildingName || signData.coverName || ''}
                    onChange={(e) =>
                      setSignData({
                        ...signData,
                        jebonBuildingName: e.target.value,
                        coverName: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start border-t border-slate-100 pt-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                      {jebonFormSteps.coverDate}. 표지 일자(인증 완료일 등){' '}
                      <span className="text-slate-400 font-medium">(선택)</span>
                    </label>
                    <input
                      type="date"
                      value={signData.compDateRaw || ''}
                      disabled={!useJebonCoverDateField}
                      title={
                        !useJebonCoverDateField
                          ? '인증별 제본 서식 설정에서 표지 일자가 비활성화되어 있습니다'
                          : undefined
                      }
                      onChange={(e) => setSignData({ ...signData, compDateRaw: e.target.value })}
                      className={`w-full border rounded-xl px-4 py-3 text-xs font-black tracking-widest font-mono outline-none transition-all ${
                        useJebonCoverDateField
                          ? 'bg-white border-slate-200 text-slate-800 focus:ring-2 focus:ring-blue-500 cursor-pointer'
                          : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                      출력 양식 미리보기
                    </label>
                    <div className="w-full min-h-[46px] flex items-center px-4 py-3 rounded-xl border text-xs font-mono font-black tracking-wider bg-yellow-100/50 border-yellow-200 shadow-inner">
                      <span className="truncate">
                        {!useJebonCoverDateField ? (
                          <span className="text-slate-400 font-medium">표지 일자 미적용</span>
                        ) : formattedCompDate ? (
                          formattedCompDate
                        ) : (
                          <span className="text-yellow-600/60 font-medium">
                            달력 선택 시 실시간 반영
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            )}

 {/* 🔥 3. 기성 서식 / 소모품 제작 통합 탭 뷰 */}
 {activeTab === 'PRINT' && (
              <div className="space-y-6 animate-fade-in pt-2">
                <div className="p-6 bg-white rounded-2xl border border-purple-200 space-y-6 shadow-sm">
                  
                  {/* 헤더 타이틀 */}
                  <div className="border-b border-purple-100 pb-4">
                    <h4 className="text-sm font-black text-purple-800 flex items-center gap-2">
                      <span>📁</span> 기성 서식 및 제작성 소모품 일괄 신청 코너
                    </h4>
                    <p className="text-xs text-slate-500 mt-1.5 font-medium">
                      외주사에서 청구되는 물품을 선택하여 신청합니다.
                    </p>
                  </div>

                  {/* 🚀 1. 물품 선택을 가장 먼저 하도록 상단으로 이동! */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* 1. 주문 물품 선택 — 제품명(검정) + 참고(회색) */}
                    <div ref={printItemMenuRef} className="relative">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        1. 주문 물품 선택 <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsPrintItemMenuOpen((open) => !open)}
                        className="w-full bg-purple-50/50 border border-purple-200 rounded-xl px-4 py-3 text-left focus:ring-2 focus:ring-purple-500 outline-none cursor-pointer hover:bg-white transition-colors flex items-center justify-between gap-2"
                      >
                        {selectedPrintItem ? (
                          <span className="min-w-0 truncate text-xs">
                            <span className="font-black text-slate-900">{selectedPrintItem.name}</span>
                            {printItemReferenceText(selectedPrintItem) && (
                              <span className="font-semibold text-slate-400 ml-1.5">
                                {printItemReferenceText(selectedPrintItem)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-slate-400">
                            {printItemMasterList.length === 0
                              ? '등록된 주문 물품이 없습니다'
                              : '주문 물품을 선택해 주세요'}
                          </span>
                        )}
                        <span className="text-slate-400 text-[10px] shrink-0">
                          {isPrintItemMenuOpen ? '▲' : '▼'}
                        </span>
                      </button>
                      {isPrintItemMenuOpen && printItemMasterList.length > 0 && (
                        <div className="absolute z-30 mt-1.5 w-full max-h-64 overflow-y-auto rounded-xl border border-purple-200 bg-white shadow-lg">
                          {printItemMasterList.map((item) => {
                            const active = item.id === signData.printItemId;
                            const refText = printItemReferenceText(item);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => applyPrintItemSelection(item)}
                                className={`w-full px-4 py-2.5 text-left text-xs flex items-baseline gap-1.5 hover:bg-purple-50 transition-colors ${
                                  active ? 'bg-purple-50/80' : ''
                                }`}
                              >
                                <span className="font-black text-slate-900 shrink-0">{item.name}</span>
                                {refText && (
                                  <span className="font-semibold text-slate-400 truncate">
                                    {refText}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 2. 규격 매핑 및 동적 직접 입력 전환창 */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        {isPrintCustomItem ? (
                          <span className="text-purple-700 font-black animate-pulse">
                            1. 기타소모품 명칭/규격 직접 기재 *
                          </span>
                        ) : (
                          '선택 물품 정보/규격'
                        )}
                      </label>

                      {isPrintCustomItem ? (
                        <div className="relative animate-fade-in">
                          <input
                            type="text"
                            placeholder="직접 기재"
                            value={signData.printCustomName || ''}
                            onChange={(e) =>
                              setSignData({ ...signData, printCustomName: e.target.value })
                            }
                            className="w-full bg-white border-2 border-purple-400 focus:border-purple-600 focus:ring-2 focus:ring-purple-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none shadow-sm text-purple-900"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-purple-500 bg-purple-50 px-2 py-0.5 rounded-md">
                            입력모드
                          </span>
                        </div>
                      ) : (
                        <div className="w-full bg-slate-100/80 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-500 flex items-center justify-between gap-2 shadow-inner">
                          <span className="text-slate-700">
                            {[selectedPrintItem?.name, selectedPrintItem?.size]
                              .filter(Boolean)
                              .join(' ') || signData.printItemType || '—'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold tracking-wider shrink-0">
                            ✔️ 선택사항 확인
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 🚀 2, 3. 상세 내용 및 비고 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-purple-50 pt-6 mt-2">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        2. 인쇄 제작 문구1 <span className="text-slate-400 font-medium">(선택)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="예: 앞면 비고 또는 뒷면 비고 등"
                        value={signData.printItemDetails || ''}
                        onChange={(e) =>
                          setSignData({ ...signData, printItemDetails: e.target.value })
                        }
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-medium outline-none focus:ring-2 focus:ring-purple-500 shadow-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        3. 인쇄 제작 문구2 <span className="text-slate-400 font-medium">(선택)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="예: 앞면 비고 또는 뒷면 비고 등"
                        value={signData.printDeliveryDetails || ''}
                        onChange={(e) =>
                          setSignData({ ...signData, printDeliveryDetails: e.target.value })
                        }
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-medium outline-none focus:ring-2 focus:ring-purple-500 shadow-sm"
                      />
                    </div>
                  </div>

                  {/* 실무 주의사항 배너 */}
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-[10px] text-amber-800 font-medium leading-relaxed">
                    📌 **실무 프로세스 안내:** 이 탭에서 작성된 물품은 발주 및 비용 정산(계산서 대사) 프로세스를 전담합니다. 
                    <br /><br />
                    주문 완료 후 실제 물품이 입고되어 **사무실 내부 재고 관리가 수반되어야 하는 품목(쇼핑백, 상장케이스 등)**은 물품 수령 시 반드시 **[일반소모품 입고 대장 시스템]**에도 수량을 등록하여 입고 처리를 진행해 주시기 바랍니다.
                  </div>

                </div>
              </div>
            )}

{/* 🔥 4. 사무문구류 견적 키핑 탭 뷰 */}
{activeTab === 'OFFICE_SUPPLIES' && (
              <div className="space-y-6 animate-fade-in pt-2">
                <div className="p-6 bg-white rounded-2xl border border-blue-200 space-y-6 shadow-sm">
                  
                  {/* 헤더 */}
                  <div className="border-b border-blue-100 pb-4">
                    <h4 className="text-sm font-black text-blue-800 flex items-center gap-2">
                      <span>📎</span> 사무문구류 견적서 등록 내역
                    </h4>
                    <p className="text-xs text-slate-500 mt-1.5 font-medium">
                      외부 문구사에서 출력한 견적서 PDF의 내부 텍스트를 전체 복사(Ctrl + C)하여 전체 붙여넣기(Ctrl + V)하면 월말 정산 데이터로 키핑됩니다.
                    </p>
                  </div>

                 {/* 구분 타이틀 (라벨 바로 옆으로 버튼 이동 및 정렬 보정) */}
                 <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                        1. 관리용 제목 설정 <span className="text-red-500">*</span>
                      </label>
                      <button 
                        type="button"
                        onClick={() => {
                          setSignData({ 
                            ...signData, 
                            suppliesProjectName: `사무문구류 견적서 내역_${signData.dept || '해당부서'}` 
                          });
                        }}
                        className="text-[9px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 transition-colors shrink-0 cursor-pointer"
                      >
                        ⚡ 제목 자동 생성
                      </button>
                    </div>
                    <input 
                      type="text" 
                      placeholder="좌측 '제목 자동 생성' 버튼을 누르거나 직접 제목을 기재해 주세요." 
                      value={signData.suppliesProjectName || ''} 
                      onChange={(e) => setSignData({ ...signData, suppliesProjectName: e.target.value })} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:bg-white focus:border-blue-500 transition-colors"
                    />
                  </div>

                  {/* 텍스트 긁어붙이기 윈도우 */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                        2. 견적 내용 전체 복사 붙여넣기 (Ctrl + V) <span className="text-red-500">*</span>
                      </label>
                      <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded">텍스트 전용</span>
                    </div>
                    <textarea 
                      placeholder="견적서 PDF 파일의 텍스트 내용을 마우스로 긁어 그대로 붙여넣어 주세요. (품명, 규격, 수량, 단가 등이 포함되도록)" 
                      value={signData.suppliesQuoteRawText || ''} 
                      onChange={(e) => setSignData({ ...signData, suppliesQuoteRawText: e.target.value })} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-mono font-medium outline-none focus:bg-white focus:border-blue-500 min-h-[180px] resize-y"
                    />
                  </div>

                  {/* 실시간 텍스트 유무 가이드 데스크 */}
                  <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-700">📋 입력된 문자열 상태 분석</span>
                    <span className="text-[10px] font-mono font-black text-blue-800">
                      {signData.suppliesQuoteRawText ? `${signData.suppliesQuoteRawText.length} 자 감지됨 (저장 대기)` : '대기 중'}
                    </span>
                  </div>

                  {/* 안내말 */}
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-[10px] text-amber-800 font-medium leading-relaxed">
                    💡 **정산 프로세스 가이드:** 등록된 견적 텍스트는 내부 DB에 안전하게 키핑되며, 월말 정산 화면에서 통합 거래명세서 엑셀(Excel)을 파싱할 때 품명/수량을 1:1로 추출해 크로스매칭하여 빨간색 경고 등으로 불일치를 잡아내게 됩니다.
                  </div>

                </div>
              </div>
            )}

            {/* 🚀 공통 7번: 추가 제작 변수 요청사항 자유기재 (사무문구류 정산 탭일 때는 숨김) */}
            {activeTab !== 'OFFICE_SUPPLIES' && (
              <div className="p-4 bg-white rounded-xl border border-yellow-200 space-y-2 shadow-sm mt-4">
                <div className="flex justify-between items-center gap-2">
                  <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                    {customRequestStepNumber}. 추가 제작 변수 요청사항 자유기재 <span className="text-slate-400 font-medium">(선택)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setCustomRequests([
                        ...customRequests,
                        { id: Date.now(), value: '' },
                      ])
                    }
                    className="px-2 py-0.5 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 border border-yellow-300 rounded-md font-black text-[10px] flex items-center gap-1 transition-all shrink-0"
                  >
                    ➕ 추가
                  </button>
                </div>
                <p className="text-[9px] text-slate-400 font-bold leading-snug">
                  「➕ 추가」로 행을 만든 뒤, <span className="text-slate-500">내용을 입력한 항목만</span> 신청서에 포함됩니다. 빈 행은 제출 시 자동으로 제외됩니다.
                </p>
                {customRequests.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-2.5 text-center text-[10px] font-bold text-slate-400">
                    추가할 요청사항이 있으면 우측 상단 「➕ 추가」를 눌러주세요.
                  </div>
                ) : (
                  customRequests.map((req, index) => (
                  <div key={req.id} className="flex items-center gap-2 animate-fade-in">
                    <span className="text-slate-400 font-mono font-bold w-3.5 shrink-0 text-right text-[10px]">
                      {index + 1}.
                    </span>
                    <input
                      type="text"
                      placeholder="요청 사항 혹은 프리뷰 문구 보조 제어 스펙 등 자유롭게 기재"
                      value={req.value}
                      onChange={(e) => {
                        setCustomRequests(
                          customRequests.map((c) =>
                            c.id === req.id ? { ...c, value: e.target.value } : c
                          )
                        );
                      }}
                      className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setCustomRequests(customRequests.filter((c) => c.id !== req.id))
                      }
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0 text-sm"
                      title="이 행 삭제"
                    >
                      🗑️
                    </button>
                  </div>
                  ))
                )}
              </div>
            )}

          </div>
          {/* 🚀 [동적 변환 영역 종료] */}

  {/* 🚚 최종 제작물 실배송지 섹션 */}
        <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span>🚚 최종 제작물 실배송지</span>
              {deliveryMode === 'CUSTOMER_DIRECT' && (
                <span className="text-[11px] font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-lg border border-red-200">
                  고객사/현장 직발송 — 아래 실배송지를 입력해 주세요
                </span>
              )}
              {deliveryMode === 'HQ_RECEIVE' && (
                <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                  인증원 수령 — 실배송지는 부서 대장(발주)에서 입력합니다
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0 ml-auto">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deliveryMode === 'CUSTOMER_DIRECT'}
                  onChange={() => setDeliveryMode('CUSTOMER_DIRECT')}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-[11px] font-black text-slate-600">고객사 직발송</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deliveryMode === 'HQ_RECEIVE'}
                  onChange={() => setDeliveryMode('HQ_RECEIVE')}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-[11px] font-black text-slate-600">인증원 수령/묶음 발주</span>
              </label>
            </div>
          </h3>
          {deliveryMode === 'CUSTOMER_DIRECT' && (
          <div className="space-y-4 pt-2 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">수령인 성명</label>
                <input 
                  type="text" 
                  placeholder="수령인 성명" 
                  value={signData.receiverName} 
                  onChange={(e) => setSignData({...signData, receiverName: e.target.value})} 
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">수령인 연락처</label>
                <input 
                  type="text" 
                  placeholder="수령인 연락처" 
                  value={signData.receiverPhone} 
                  onChange={(e) => setSignData({...signData, receiverPhone: e.target.value})} 
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
              <div className="md:col-span-7">
                <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">
                  전사 공통 주소 불러오기
                </label>
                <select
                  value={selectedCompanyAddressId}
                  onChange={(e) => applyCompanyAddress(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                >
                  <option value="">직접 입력 / 주소 검색</option>
                  {companyAddresses
                    .filter((a) => a.isActive !== false)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        🏢 {a.label} — {a.addressKo}
                      </option>
                    ))}
                </select>
                <p className="text-[9px] text-slate-400 font-bold mt-1.5">
                  명함 마스터에 등록된 본사·센터 주소입니다. 선택 시 우편번호·도로명이 자동 입력됩니다.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
              <div className="flex flex-wrap items-stretch gap-2">
                <button
                  type="button"
                  onClick={openProductionPostcode}
                  className="shrink-0 px-3 h-10 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-sm hover:bg-slate-800 transition-all active:scale-95"
                >
                  🔍 주소 검색
                </button>
                <div className="flex items-center gap-1.5 shrink-0 bg-white border border-slate-200 rounded-xl px-2.5 h-10">
                  <span className="text-[9px] font-black text-slate-400">우편</span>
                  <input
                    type="text"
                    readOnly
                    value={signData.shippingZipCode}
                    placeholder="자동"
                    className="w-14 font-mono text-center text-xs font-black text-blue-600 bg-transparent outline-none"
                  />
                </div>
                <input
                  type="text"
                  readOnly
                  value={signData.shippingAddressRoad}
                  placeholder="도로명 주소 (검색 또는 전사 주소)"
                  className="flex-[2] min-w-[12rem] h-10 px-3 border border-slate-200 rounded-xl bg-white text-slate-700 text-xs font-bold outline-none"
                />
                <div className="flex items-center gap-1.5 flex-[1.2] min-w-[12rem] max-w-[22rem] bg-white border border-slate-200 rounded-xl px-2.5 h-10">
                  <span className="text-[9px] font-black text-blue-600 shrink-0">상세</span>
                  <input
                    type="text"
                    value={signData.shippingAddressDetail}
                    onChange={(e) => {
                      setSignData({ ...signData, shippingAddressDetail: e.target.value });
                      if (selectedCompanyAddressId) setSelectedCompanyAddressId('');
                    }}
                    placeholder="동·호수 등"
                    className="min-w-0 flex-1 text-xs font-semibold text-slate-800 outline-none bg-transparent"
                  />
                </div>
              </div>
              {buildProductionShippingAddress(signData) && (
                <p className="text-[10px] text-slate-500 font-bold">
                  미리보기: {buildProductionShippingAddress(signData)}
                </p>
              )}
            </div>
          </div>
          )}
        </div>

{/* 🗂️ 시스템 내부 보관 보조 서식 섹션 (현판 탭에서만 노출) */}
{activeTab === 'SIGN' && (
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 border-b border-slate-200/60 pb-3">
            <span className="text-yellow-500">🗂️</span> 시스템 내부 보관 보조 서식 
            <span className="text-slate-400 text-[10px] font-normal ml-1">(외주 발주서 제외 항목)</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">
                현판 신청 회사 <span className="text-slate-400 font-medium">(선택)</span>
              </label>
              <input 
                type="text" 
                placeholder="회사명" 
                value={signData.companyName} 
                onChange={(e) => setSignData({...signData, companyName: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">
                신청인 정보 <span className="text-slate-400 font-medium">(선택)</span>
              </label>
              <input 
                type="text" 
                placeholder="신청인 정보" 
                value={signData.applicantName} 
                onChange={(e) => setSignData({...signData, applicantName: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">
                기타 <span className="text-slate-400 font-medium">(선택)</span>
              </label>
              <input 
                type="text" 
                placeholder="기타" 
                value={signData.applicantPhone} 
                onChange={(e) => setSignData({...signData, applicantPhone: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
          </div>
        </div>
      )}

      {/* ⚡ 현판·제본·기타제작: 관리용 제목 — 스펙 입력 후 · 부수 입력 전 */}
      {['SIGN', 'JEBON', 'PRINT'].includes(activeTab) && (
        <div className="p-6 bg-white rounded-2xl border border-blue-200 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
              관리용 제목 설정 <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'SIGN') {
                  const projectPart =
                    (signData.certType === 'ISO'
                      ? signData.isoCompanyName?.trim()
                      : signData.projectName?.trim()) || '프로젝트명';
                  const certLabel =
                    signCertMasterList.find((c) => c.id === signData.certType)?.label ||
                    signData.certType ||
                    '인증종류';
                  setSignData({
                    ...signData,
                    signFormTitle: `${projectPart}_현판_${certLabel}`,
                  });
                } else if (activeTab === 'PRINT') {
                  const productPart =
                    (isPrintCustomItem
                      ? signData.printCustomName?.trim()
                      : selectedPrintItem?.name || signData.printItemType) || '제품명';
                  const sizePart = selectedPrintItem?.size?.trim() || '규격미정';
                  const centerPart = signData.dept?.trim() || '센터';
                  setSignData({
                    ...signData,
                    printFormTitle: `${productPart}_${sizePart}_${centerPart}`,
                  });
                } else {
                  const projectPart =
                    signData.jebonBuildingName?.trim() ||
                    signData.coverName?.trim() ||
                    '프로젝트명';
                  const certLabel =
                    jebonCertMasterList.find((c) => c.id === signData.certType)?.label ||
                    signData.certType ||
                    '제본종류';
                  const phasePart =
                    signData.certPhase && signData.certPhase !== '해당없음'
                      ? signData.certPhase
                      : null;
                  const jebonFormTitle =
                    phasePart
                      ? `${projectPart}_${phasePart}_${certLabel}_${
                          formattedCompDate ||
                          signData.compDateRaw?.replace(/-/g, '.') ||
                          '일자미정'
                        }`
                      : `${projectPart}_${certLabel}${
                          formattedCompDate
                            ? `_${formattedCompDate}`
                            : signData.compDateRaw
                              ? `_${signData.compDateRaw.replace(/-/g, '.')}`
                              : ''
                        }`;
                  setSignData({
                    ...signData,
                    jebonFormTitle,
                  });
                }
              }}
              className="text-[9px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 transition-colors shrink-0 cursor-pointer"
            >
              ⚡ 제목 자동 생성
            </button>
          </div>
          <input
            type="text"
            placeholder="위 스펙 입력 후 「제목 자동 생성」으로 연동하거나 직접 입력해 주세요."
            value={
              activeTab === 'SIGN'
                ? signData.signFormTitle || ''
                : activeTab === 'PRINT'
                  ? signData.printFormTitle || ''
                  : signData.jebonFormTitle || ''
            }
            onChange={(e) =>
              setSignData(
                activeTab === 'SIGN'
                  ? { ...signData, signFormTitle: e.target.value }
                  : activeTab === 'PRINT'
                    ? { ...signData, printFormTitle: e.target.value }
                    : { ...signData, jebonFormTitle: e.target.value }
              )
            }
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:bg-white focus:border-blue-500 transition-colors"
          />
        </div>
      )}

          {/* 제출 직전: 좌측 50%(수량·외주·업체관리) / 우측 50%(제출) */}
          <div className="pt-6 mt-6 border-t border-slate-100">
            <div className="flex flex-col lg:flex-row gap-3 items-stretch">
              <div className="lg:w-1/2 min-w-0 flex flex-wrap gap-3 items-start">
              {activeTab !== 'OFFICE_SUPPLIES' && (
                <div
                  className={`shrink-0 ${
                    activeTab === 'PRINT' ? 'w-48' : 'w-24'
                  }`}
                >
                  <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1.5 text-center h-4">
                    {activeTab === 'PRINT' ? '수량 / 단위' : `수량 (${quantityUnitLabel})`}
                  </label>
                  {activeTab === 'PRINT' ? (
                    <div className="flex gap-1.5 h-11">
                      <input
                        type="number"
                        min={1}
                        value={signData.quantity}
                        onChange={(e) =>
                          setSignData({
                            ...signData,
                            quantity: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                        className="w-[4.5rem] h-full bg-white border-2 border-emerald-500 rounded-xl px-2 text-xs font-black text-center outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                      <select
                        value={signData.printUnitValue || 'VAL_1'}
                        onChange={(e) =>
                          setSignData({ ...signData, printUnitValue: e.target.value })
                        }
                        className="flex-1 min-w-0 h-full bg-white border-2 border-emerald-500 rounded-xl px-2 text-[11px] font-black text-slate-700 outline-none focus:ring-2 focus:ring-emerald-200"
                        title="단위 (unit_category_group)"
                      >
                        {(unitOptions.length
                          ? unitOptions
                          : [{ label: '개(EA)', value: 'VAL_1' }]
                        ).map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      value={signData.quantity}
                      onChange={(e) =>
                        setSignData({
                          ...signData,
                          quantity: Math.max(1, parseInt(e.target.value) || 1),
                        })
                      }
                      className="w-full h-11 bg-white border-2 border-emerald-500 rounded-xl px-3 text-xs font-black text-center outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                  )}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1.5 h-4">
                  외주 업체 <span className="text-red-500">*</span>
                  <span className="ml-1.5 text-[9px] font-bold text-slate-400 normal-case tracking-normal">
                    제출 전 확인
                  </span>
                </label>
                <div className="flex gap-2 h-11 items-stretch">
                  <select
                    value={signData.vendor}
                    onChange={(e) => setSignData({ ...signData, vendor: e.target.value })}
                    title="본 제작 서식 데이터가 전송·다운로드될 최종 외주 업체"
                    className={`flex-1 min-w-0 h-full bg-white border-2 border-emerald-500 rounded-xl px-3 text-xs font-black outline-none focus:ring-2 focus:ring-emerald-200 cursor-pointer ${
                      activeTab === 'PRINT' && !signData.vendor
                        ? 'text-slate-400'
                        : 'text-slate-800'
                    }`}
                  >
                    {activeTab === 'PRINT' && (
                      <option value="">업체를 선택하세요</option>
                    )}
                    {vendorMasterList.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.priorityCategory === activeTab ? `★ ${v.label}` : v.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setIsVendorModalOpen(true)}
                    className="shrink-0 h-full px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-black text-[10px] shadow-sm active:scale-95 transition-all flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <span>🏢</span> 업체관리 설정
                  </button>
                </div>
                {(() => {
                  const memo = vendorMasterList
                    .find((v) => v.id === signData.vendor)
                    ?.items?.trim();
                  if (!memo) return null;
                  return (
                    <p className="mt-1.5 text-[11px] font-semibold text-slate-600 leading-snug truncate" title={memo}>
                      {memo}
                    </p>
                  );
                })()}
              </div>
              </div>

              <div className="lg:w-1/2 min-w-0">
                <div className="h-4 mb-1.5" aria-hidden />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting ||
                    !canEdit ||
                    (activeTab === 'PRINT' && !signData.vendor)
                  }
                  title={!canEdit ? '편집 권한 필요' : undefined}
                  className={`w-full h-11 font-black text-xs rounded-xl transition-all shadow-md
                    ${
                      !canEdit
                        ? DISABLED_ACTION_BTN
                        : isSubmitting
                          ? 'bg-slate-400 cursor-wait active:scale-100 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white'
                    }`}
                >
                  {isSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin text-lg">⏳</span> 데이터 전송 및 처리 중...
                    </span>
                  ) : activeTab === 'OFFICE_SUPPLIES' ? (
                    '사무문구류 정산 견적 원장 등록'
                  ) : (
                    '부서 맞춤 제작물 발급 신청서 제출'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

{/* 🏢 [모달 1] 외주 발주 처리 업체 종합 관리 센터 (상세 명함 카드 뷰 적용) */}
{isVendorModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-xs font-black tracking-widest text-blue-400 uppercase">Vendor Management Settings</h3>
                <h2 className="text-xl font-black mt-0.5">외주 업체(VENDOR) 관리 설정</h2>
              </div>
              <button type="button" onClick={() => setIsVendorModalOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95">닫기 ✕</button>
            </div>
            
            <div className="p-8 overflow-y-auto flex-1 bg-slate-50/50 space-y-6">
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                
                <div className="border-b border-slate-100 pb-3 flex justify-between items-end">
                  <div>
                    <h4 className="text-sm font-black text-slate-800">🏢 외주 제작사 등록 관리</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      DB 공통 마스터입니다. 등록은 누구나 가능하며, 수정·삭제는 Edit 권한이 필요합니다.
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                      등록한 업체는 신청서 <span className="font-bold text-slate-500">외주 업체 · 제출 전 확인</span> 선택란에 반영됩니다.
                      각 업체에 <span className="font-bold text-slate-500">우선 연결 품목</span>을 지정하면 해당 품목 탭에서 자동 선택·연락 카드가 표시됩니다.
                    </p>
                  </div>
                </div>

                {/* 🚀 신규 등록 (수정 폼과 동일한 기본 정보 입력 후 등록) */}
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">🏢 업체명 (필수)</label>
                    <input
                      type="text"
                      placeholder="예: ○○인쇄 / ○○제작소"
                      value={newVendorData.label}
                      onChange={(e) => setNewVendorData({ ...newVendorData, label: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-blue-500 text-slate-800"
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 mb-1">👤 담당자 성명 및 직급</label>
                      <input
                        type="text"
                        placeholder="예: 담당자명 직급"
                        value={newVendorData.managerName}
                        onChange={(e) => setNewVendorData({ ...newVendorData, managerName: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 mb-1">📞 연락처</label>
                      <input
                        type="text"
                        placeholder="예: 02-0000-0000"
                        value={newVendorData.contact}
                        onChange={(e) => setNewVendorData({ ...newVendorData, contact: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[9px] font-bold text-slate-400 mb-1">📧 이메일</label>
                      <input
                        type="text"
                        placeholder="예: order@vendor.com"
                        value={newVendorData.email}
                        onChange={(e) => setNewVendorData({ ...newVendorData, email: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">📦 주요 제작 품목 및 비고 메모</label>
                    <input
                      type="text"
                      placeholder="예: 현판제작, 명함제작, 인증서 용지 / 제본, 기타 제작, 쇼핑백, 상장케이스 / 사무문구류 등 "
                      value={newVendorData.items}
                      onChange={(e) => setNewVendorData({ ...newVendorData, items: e.target.value })}
                      className="w-full bg-yellow-50/50 border border-yellow-200/60 rounded-lg px-3 py-2 text-xs outline-none focus:border-yellow-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">🔗 우선 연결 품목</label>
                    {renderVendorPrioritySelect(newVendorData.priorityCategory || '', (next) =>
                      setNewVendorData({ ...newVendorData, priorityCategory: next })
                    )}
                  </div>

                  <div className="flex justify-end pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={async () => {
                        const label = newVendorData.label.trim();
                        if (!label) return alert('업체명을 입력하세요.');
                        try {
                          const res = await fetch('/api/asset/production/master/vendors', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              label,
                              managerName: newVendorData.managerName,
                              contact: newVendorData.contact,
                              email: newVendorData.email,
                              items: newVendorData.items,
                              priorityCategory: newVendorData.priorityCategory,
                            }),
                          });
                          const err = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            return alert(
                              err.error || err.message || `업체 등록 실패 (${res.status})`
                            );
                          }
                          setNewVendorData(emptyVendorForm);
                          const created = err?.data;
                          if (created?.id) {
                            setVendorMasterList((prev) =>
                              prev.some((v) => v.id === created.id)
                                ? prev
                                : [
                                    ...prev,
                                    {
                                      id: created.id,
                                      label: created.label,
                                      managerName: created.managerName || '',
                                      contact: created.contact || '',
                                      email: created.email || '',
                                      items: created.items || '',
                                    },
                                  ]
                            );
                            setSignData((prev) => ({
                              ...prev,
                              vendor: prev.vendor || created.id,
                            }));
                          }
                          await reloadMasters();
                        } catch {
                          alert('업체 등록 중 오류가 발생했습니다.');
                        }
                      }}
                      className="font-black text-xs px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      + 신규 업체 등록
                    </button>
                  </div>
                </div>

                {/* 🚀 마스터 리스트 (명함 카드형 UI) */}
                <div className="grid grid-cols-1 gap-3 max-h-[500px] overflow-y-auto pr-2 mt-4">
                  {vendorMasterList.map(v => (
                    <div key={v.id} className="bg-white border border-slate-200 p-4 rounded-2xl hover:border-blue-300 transition-all shadow-sm">
                      
                      {/* ==== ✏️ [수정 모드] ==== */}
                      {editingVendorId === v.id ? (
                        <div className="space-y-3 animate-fade-in">
                          <input type="text" placeholder="업체명 (필수)" value={editingVendorData.label} onChange={(e) => setEditingVendorData({...editingVendorData, label: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-blue-500 text-slate-800" />
                          
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">👤 담당자 성명 및 직급</label>
                              <input type="text" placeholder="예: 담당자명 직급" value={editingVendorData.managerName || ''} onChange={(e) => setEditingVendorData({...editingVendorData, managerName: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">📞 연락처</label>
                              <input type="text" placeholder="예: 02-0000-0000" value={editingVendorData.contact || ''} onChange={(e) => setEditingVendorData({...editingVendorData, contact: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">📧 이메일</label>
                              <input type="text" placeholder="예: order@vendor.com" value={editingVendorData.email || ''} onChange={(e) => setEditingVendorData({...editingVendorData, email: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                            </div>
                          </div>
                          
                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 mb-1">📦 주요 제작 품목 및 비고 메모</label>
                            <input type="text" placeholder="예: 현판제작, 명함제작, 인증서 용지 / 제본, 기타 제작, 쇼핑백, 상장케이스 / 사무문구류 등 " value={editingVendorData.items || ''} onChange={(e) => setEditingVendorData({...editingVendorData, items: e.target.value})} className="w-full bg-yellow-50/50 border border-yellow-200/60 rounded-lg px-3 py-2 text-xs outline-none focus:border-yellow-400" />
                          </div>

                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 mb-1">🔗 우선 연결 품목</label>
                            {renderVendorPrioritySelect(
                              editingVendorData.priorityCategory || '',
                              (next) => setEditingVendorData({ ...editingVendorData, priorityCategory: next })
                            )}
                          </div>

                          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button type="button" onClick={() => setEditingVendorId(null)} className="text-[10px] font-black text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">취소</button>
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={!canEdit ? '편집 권한 필요' : undefined}
                              onClick={async () => {
                                if (!canEdit) return alertNoEditPermission();
                                if (!editingVendorData.label.trim()) return alert('업체명은 필수입니다.');
                                try {
                                  const res = await fetch('/api/asset/production/master/vendors', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ id: v.id, ...editingVendorData }),
                                  });
                                  if (!res.ok) {
                                    const err = await res.json().catch(() => ({}));
                                    return alert(err.message || '저장 실패');
                                  }
                                  setEditingVendorId(null);
                                  await reloadMasters();
                                } catch {
                                  alert('저장 중 오류가 발생했습니다.');
                                }
                              }}
                              className={`text-[10px] font-black px-4 py-1.5 rounded-lg shadow-sm transition-colors ${
                                canEdit
                                  ? 'text-white bg-emerald-600 hover:bg-emerald-500'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              저장 완료
                            </button>
                          </div>
                        </div>

                      ) : (
                        
                        /* ==== 👀 [보기 모드] ==== */
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="text-sm font-black text-slate-800">🏢 {v.label}</span>
                              {renderVendorPrioritySelect(
                                v.priorityCategory || '',
                                (next) => handleVendorPriorityChange(v, next),
                                !canEdit
                              )}
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <button
                                type="button"
                                disabled={!canEdit}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={() => {
                                  if (!canEdit) return alertNoEditPermission();
                                  setEditingVendorId(v.id);
                                  setEditingVendorData({
                                    label: v.label,
                                    managerName: v.managerName || '',
                                    contact: v.contact || '',
                                    email: v.email || '',
                                    items: v.items || '',
                                    priorityCategory: v.priorityCategory || '',
                                  });
                                }}
                                className={`text-[10px] font-black px-2.5 py-1 rounded-lg transition-colors border ${
                                  canEdit
                                    ? 'text-slate-500 hover:text-blue-600 bg-white border-slate-200 hover:border-blue-200'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                disabled={!canEdit}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={async () => {
                                  if (!canEdit) return alertNoEditPermission();
                                  if (vendorMasterList.length <= 1)
                                    return alert('최소 한 개 이상의 외주업체가 필요합니다.');
                                  if (
                                    !confirm(
                                      `[${v.label}] 업체를 공통 마스터에서 삭제(비활성)하시겠습니까?\n(모든 신청자에게 동일하게 반영됩니다)`
                                    )
                                  )
                                    return;
                                  try {
                                    const res = await fetch(
                                      `/api/asset/production/master/vendors?id=${encodeURIComponent(v.id)}`,
                                      { method: 'DELETE' }
                                    );
                                    if (!res.ok) {
                                      const err = await res.json().catch(() => ({}));
                                      return alert(err.error || err.message || '삭제 실패');
                                    }
                                    await reloadMasters();
                                  } catch {
                                    alert('삭제 중 오류가 발생했습니다.');
                                  }
                                }}
                                className={`text-[10px] font-black px-2.5 py-1 rounded-lg transition-colors border ${
                                  canEdit
                                    ? 'text-red-400 hover:text-red-600 bg-white border-slate-200 hover:border-red-200'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                삭제
                              </button>
                            </div>
                          </div>

                          {/* 상세 정보 노출 구역 (데이터가 있을 때만 노출) */}
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1">
                            {v.managerName && <span className="text-[11px] font-medium text-slate-600">👤 <span className="font-bold text-slate-700">{v.managerName}</span></span>}
                            {v.contact && <span className="text-[11px] font-medium text-slate-600">📞 <span className="font-bold text-slate-700">{v.contact}</span></span>}
                            {v.email && <span className="text-[11px] font-medium text-slate-600">📧 <span className="font-bold text-slate-700">{v.email}</span></span>}
                          </div>
                          
                          {v.items && (
                            <div className="mt-1.5 bg-slate-50 border border-slate-100 rounded-lg p-2 text-[11px] text-slate-600 font-medium flex gap-2 items-start">
                              <span className="shrink-0">📦</span>
                              <span className="break-all">{v.items}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📜 [모달] 기타제작 주문물품 마스터 */}
      {isPrintItemModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-xs font-black tracking-widest text-fuchsia-400 uppercase">
                  Print / Consumable Item Master
                </h3>
                <h2 className="text-xl font-black mt-0.5">기타제작 주문물품 설정</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsPrintItemModalOpen(false)}
                className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95"
              >
                닫기 ✕
              </button>
            </div>

            <div className="p-8 overflow-y-auto flex-1 bg-slate-50/50 space-y-6">
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h4 className="text-sm font-black text-slate-800">📜 주문 물품 마스터</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    제품명·규격·단위를 신청서에 반영하고, 최근 공급처·제작 기본 수량은 참고용으로 관리합니다.
                    단위는 /admin/settings 의 단위 그룹(master-data)과 연동됩니다.
                  </p>
                </div>

                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <div className="md:col-span-2">
                      <label className="block text-[9px] font-bold text-slate-400 mb-1">제품명 *</label>
                      <input
                        type="text"
                        placeholder="예: 인증서 용지"
                        value={newPrintItemData.name}
                        onChange={(e) =>
                          setNewPrintItemData({ ...newPrintItemData, name: e.target.value })
                        }
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 mb-1">규격</label>
                      <input
                        type="text"
                        placeholder="예: 230*70*320"
                        value={newPrintItemData.size}
                        onChange={(e) =>
                          setNewPrintItemData({ ...newPrintItemData, size: e.target.value })
                        }
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 mb-1">최근 공급처</label>
                      <input
                        type="text"
                        placeholder="예: 아트로릭"
                        value={newPrintItemData.supplier}
                        onChange={(e) =>
                          setNewPrintItemData({ ...newPrintItemData, supplier: e.target.value })
                        }
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 mb-1">제작 기본 수량</label>
                      <input
                        type="number"
                        min={1}
                        value={newPrintItemData.orderQty}
                        onChange={(e) =>
                          setNewPrintItemData({
                            ...newPrintItemData,
                            orderQty: Math.max(1, parseInt(e.target.value, 10) || 1),
                          })
                        }
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 mb-1">단위 *</label>
                      <select
                        value={newPrintItemData.unitValue}
                        onChange={(e) =>
                          setNewPrintItemData({
                            ...newPrintItemData,
                            unitValue: e.target.value,
                          })
                        }
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-purple-500"
                      >
                        {(unitOptions.length
                          ? unitOptions
                          : [{ label: '개(EA)', value: 'VAL_1' }]
                        ).map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end md:col-span-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none pb-1.5">
                        <input
                          type="checkbox"
                          checked={newPrintItemData.isCustom}
                          onChange={(e) =>
                            setNewPrintItemData({
                              ...newPrintItemData,
                              isCustom: e.target.checked,
                            })
                          }
                          className="w-3.5 h-3.5 rounded border-slate-300 text-purple-600"
                        />
                        <span className="text-[10px] font-bold text-slate-500">직접입력(기타)</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-end pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={async () => {
                        const name = newPrintItemData.name.trim();
                        if (!name) return alert('제품명을 입력하세요.');
                        try {
                          const res = await fetch('/api/asset/production/master/print-items', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(newPrintItemData),
                          });
                          if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            return alert(err.message || '저장 실패');
                          }
                          setNewPrintItemData(emptyPrintItemForm);
                          await reloadMasters();
                        } catch {
                          alert('저장 중 오류가 발생했습니다.');
                        }
                      }}
                      className="font-black text-xs px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      + 신규 물품 등록
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 max-h-[420px] overflow-y-auto pr-2 mt-2">
                  {printItemMasterList.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white border border-slate-200 p-4 rounded-2xl hover:border-purple-300 transition-all shadow-sm"
                    >
                      {editingPrintItemId === item.id ? (
                        <div className="space-y-3 animate-fade-in">
                          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                            <div className="md:col-span-2">
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">제품명 *</label>
                              <input
                                type="text"
                                value={editingPrintItemData.name}
                                onChange={(e) =>
                                  setEditingPrintItemData({
                                    ...editingPrintItemData,
                                    name: e.target.value,
                                  })
                                }
                                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-black outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">규격</label>
                              <input
                                type="text"
                                value={editingPrintItemData.size}
                                onChange={(e) =>
                                  setEditingPrintItemData({
                                    ...editingPrintItemData,
                                    size: e.target.value,
                                  })
                                }
                                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">최근 공급처</label>
                              <input
                                type="text"
                                value={editingPrintItemData.supplier}
                                onChange={(e) =>
                                  setEditingPrintItemData({
                                    ...editingPrintItemData,
                                    supplier: e.target.value,
                                  })
                                }
                                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">제작 기본 수량</label>
                              <input
                                type="number"
                                min={1}
                                value={editingPrintItemData.orderQty}
                                onChange={(e) =>
                                  setEditingPrintItemData({
                                    ...editingPrintItemData,
                                    orderQty: Math.max(1, parseInt(e.target.value, 10) || 1),
                                  })
                                }
                                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">단위 *</label>
                              <select
                                value={editingPrintItemData.unitValue}
                                onChange={(e) =>
                                  setEditingPrintItemData({
                                    ...editingPrintItemData,
                                    unitValue: e.target.value,
                                  })
                                }
                                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                              >
                                {(unitOptions.length
                                  ? unitOptions
                                  : [{ label: '개(EA)', value: 'VAL_1' }]
                                ).map((u) => (
                                  <option key={u.value} value={u.value}>
                                    {u.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-end pb-1 md:col-span-2">
                              <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={editingPrintItemData.isCustom}
                                  onChange={(e) =>
                                    setEditingPrintItemData({
                                      ...editingPrintItemData,
                                      isCustom: e.target.checked,
                                    })
                                  }
                                  className="w-3.5 h-3.5 rounded border-slate-300 text-purple-600"
                                />
                                <span className="text-[10px] font-bold text-slate-500">직접입력(기타)</span>
                              </label>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => setEditingPrintItemId(null)}
                              className="text-[10px] font-black text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg"
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={!canEdit ? '편집 권한 필요' : undefined}
                              onClick={async () => {
                                if (!canEdit) return alertNoEditPermission();
                                if (!editingPrintItemData.name.trim())
                                  return alert('제품명은 필수입니다.');
                                try {
                                  const res = await fetch(
                                    '/api/asset/production/master/print-items',
                                    {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        id: item.id,
                                        ...editingPrintItemData,
                                      }),
                                    }
                                  );
                                  if (!res.ok) {
                                    const err = await res.json().catch(() => ({}));
                                    return alert(err.message || '저장 실패');
                                  }
                                  setEditingPrintItemId(null);
                                  await reloadMasters();
                                } catch {
                                  alert('저장 중 오류가 발생했습니다.');
                                }
                              }}
                              className={`text-[10px] font-black px-4 py-1.5 rounded-lg shadow-sm ${
                                canEdit
                                  ? 'text-white bg-emerald-600 hover:bg-emerald-500'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              저장 완료
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between items-start gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="text-sm font-black text-slate-800 truncate">
                              📜 {item.name}
                              {item.isCustom && (
                                <span className="ml-2 text-[9px] font-bold text-purple-600 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded">
                                  직접입력
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-bold text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                              {item.size && <span>규격: {item.size}</span>}
                              {item.supplier && <span>최근 공급처: {item.supplier}</span>}
                              <span>
                                제작 기본 수량: {item.orderQty}
                                {shortUnitLabel(resolveUnitLabel(item.unitValue))}
                              </span>
                              <span>단위: {resolveUnitLabel(item.unitValue)}</span>
                            </div>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={!canEdit ? '편집 권한 필요' : undefined}
                              onClick={() => {
                                if (!canEdit) return alertNoEditPermission();
                                setEditingPrintItemId(item.id);
                                setEditingPrintItemData({
                                  name: item.name,
                                  size: item.size,
                                  supplier: item.supplier,
                                  orderQty: item.orderQty,
                                  unitValue: item.unitValue || 'VAL_1',
                                  isCustom: item.isCustom,
                                  sortOrder: item.sortOrder,
                                });
                              }}
                              className={`text-[10px] font-black px-2.5 py-1 rounded-lg border ${
                                canEdit
                                  ? 'text-slate-500 hover:text-purple-600 bg-white border-slate-200'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={!canEdit ? '편집 권한 필요' : undefined}
                              onClick={async () => {
                                if (!canEdit) return alertNoEditPermission();
                                if (printItemMasterList.length <= 1)
                                  return alert('최소 한 개 이상의 물품이 필요합니다.');
                                if (!confirm(`「${item.name}」을(를) 삭제할까요?`)) return;
                                try {
                                  const res = await fetch(
                                    `/api/asset/production/master/print-items?id=${encodeURIComponent(item.id)}`,
                                    { method: 'DELETE' }
                                  );
                                  if (!res.ok) {
                                    const err = await res.json().catch(() => ({}));
                                    return alert(err.message || '삭제 실패');
                                  }
                                  await reloadMasters();
                                } catch {
                                  alert('삭제 중 오류가 발생했습니다.');
                                }
                              }}
                              className={`text-[10px] font-black px-2.5 py-1 rounded-lg border ${
                                canEdit
                                  ? 'text-red-500 hover:bg-red-50 bg-white border-slate-200'
                                  : DISABLED_ACTION_BTN
                              }`}
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📊 [모달 2] 품목/단가/규격 마스터 대장 모달 */}
      {isPlateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-xs font-black tracking-widest text-emerald-400 uppercase">Signage Specs & Pricing Settings</h3>
                <h2 className="text-xl font-black mt-0.5">현판 품목별 규격 및 단가 설정</h2>
              </div>
              <button type="button" onClick={() => setIsPlateModalOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95">닫기 ✕</button>
            </div>
            <div className="p-8 overflow-y-auto flex-1 bg-slate-50/50">
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
                <div className="border-b border-slate-100 pb-3">
                  <h4 className="text-sm font-black text-slate-800">📊 단가 & 규격 마스터</h4>
                  <p className="text-xs text-slate-400 mt-1">이곳에서 추가/수정한 품목 사양은 신청서 본문의 콤보박스와 미니 명세서 표에 실시간 연동됩니다.</p>
                  <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                    목록은 등록순이 아니라 <span className="font-bold text-slate-500">품목명 가나다순</span>으로 정렬되며, 같은 품목명은 <span className="font-bold text-slate-500">규격순</span>으로 이어집니다.
                  </p>
                </div>
                <div className="flex gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 items-end">
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-slate-400 block mb-1">신규 품목 명칭</label>
                    <input type="text" placeholder="예: 현판 A형" value={newPlate.label} onChange={(e) => setNewPlate({ ...newPlate, label: e.target.value })} className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl p-3 text-xs font-bold outline-none focus:border-blue-500" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-slate-400 block mb-1">규격</label>
                    <input type="text" placeholder="ex: 400*300" value={newPlate.size} onChange={(e) => setNewPlate({ ...newPlate, size: e.target.value })} className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl p-3 text-xs font-semibold outline-none focus:border-blue-500" />
                  </div>
                  <div className="w-32 shrink-0">
                    <label className="text-[10px] font-black text-slate-400 block mb-1">공급가 (원 · VAT별도)</label>
                    <input type="number" placeholder="0" value={newPlate.price || ''} onChange={(e) => setNewPlate({ ...newPlate, price: Number(e.target.value) })} className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl p-3 text-xs font-mono outline-none focus:border-blue-500" />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddPlateMaster}
                    className="font-black px-4 py-2.5 text-xs rounded-xl transition-all shadow-md active:scale-95 shrink-0 bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    + 신규 등록
                  </button>
                </div>
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                  {plateMasterList.map((p, idx) => (
                    <div key={p.code} className="p-4 rounded-xl border bg-white border-slate-200 hover:border-blue-300 transition-all shadow-sm">
                      <div className="flex justify-between items-center mb-2 gap-4">
                        <span className="font-black text-sm text-slate-800 truncate flex-1">📍 {p.label}</span>
                        <div className="flex gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={() => {
                              if (!canEdit) return alertNoEditPermission();
                              setEditingPlateIndex(editingPlateIndex === idx ? null : idx);
                            }}
                            className={`text-[10px] px-3 py-1.5 rounded-lg font-bold border ${
                              canEdit
                                ? 'text-slate-500 hover:text-slate-800 bg-slate-100 border-slate-200'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            {editingPlateIndex === idx ? '닫기' : '수정'}
                          </button>
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={() => handleIdDeletePlate(p.code)}
                            className={`text-[10px] px-3 py-1.5 rounded-lg font-bold border ${
                              canEdit
                                ? 'text-red-500 hover:text-red-700 bg-slate-100 border-slate-200'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                      {editingPlateIndex === idx ? (
                        <div className="flex gap-3 pt-3 animate-fade-in border-t border-slate-100 mt-2 items-end">
                          <div className="flex-1">
                            <label className="text-[10px] font-black text-slate-400 block mb-1">공급가액 (원 · VAT별도)</label>
                            <input type="number" value={p.price} onChange={(e) => {
                              const updated = [...plateMasterList]; updated[idx] = { ...updated[idx], price: Number(e.target.value) }; setPlateMasterList(updated);
                            }} className="w-full bg-slate-50 border border-slate-300 text-blue-600 font-mono font-black rounded-lg p-2.5 text-xs outline-none" />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] font-black text-slate-400 block mb-1">규격 수정 (mm)</label>
                            <input type="text" value={p.size} onChange={(e) => {
                              const updated = [...plateMasterList]; updated[idx] = { ...updated[idx], size: e.target.value }; setPlateMasterList(updated);
                            }} className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-semibold rounded-lg p-2.5 text-xs outline-none" />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSavePlateRow(plateMasterList[idx])}
                            className="shrink-0 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black rounded-lg"
                          >
                            DB 저장
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-between text-xs text-slate-500 font-mono border-t border-slate-100 pt-2 mt-1">
                          <span className="bg-slate-50 px-2 py-1 rounded font-bold">규격: {p.size}</span>
                          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-black">💵 공급단가: {p.price.toLocaleString()}원 (VAT별도)</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

{/* 🚀 인증 마스터: 외부 버튼으로 명판/제본 분리 진입 */}
{isCertModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-7xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* 팝업 헤더 — 진입 버튼에 따라 명판/제본 단독 표시 */}
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className={`text-xs font-black tracking-widest uppercase ${
                  popSubTab === 'SIGN_SUB' ? 'text-blue-400' : 'text-indigo-400'
                }`}>
                  {popSubTab === 'SIGN_SUB'
                    ? 'Certification Signage Template Settings'
                    : 'Certification Binding Template Settings'}
                </h3>
                <h2 className="text-xl font-black mt-0.5">
                  {popSubTab === 'SIGN_SUB'
                    ? '인증별 현판 서식 기준 설정'
                    : '인증별 제본 서식 기준 설정'}
                </h2>
              </div>
              <button type="button" onClick={() => setIsCertModalOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95">닫기 ✕</button>
            </div>

            {/* 팝업 본문 (선택된 서식만 단독 표시) */}
            <div className="px-10 py-8 overflow-y-auto flex-1 min-h-0 bg-slate-50/50">
              <div
                className={`grid gap-6 items-start ${
                  popSubTab === 'SIGN_SUB' ? 'grid-cols-1 xl:grid-cols-3' : 'grid-cols-1'
                }`}
              >
              
             {/* 왼쪽 분리형 대장 영역 — 제본은 전체 너비 */}
             <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col min-w-0">
                
                <div className="space-y-4 flex flex-col">
                  {popSubTab === 'JEBON_SUB' && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setJebonSettingsTab('CERT')}
                        className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-black border transition-all ${
                          jebonSettingsTab === 'CERT'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-white'
                        }`}
                      >
                        📋 인증별 서식
                      </button>
                      <button
                        type="button"
                        onClick={() => setJebonSettingsTab('SIZE')}
                        className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-black border transition-all ${
                          jebonSettingsTab === 'SIZE'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-white'
                        }`}
                      >
                        📏 제본 판형
                      </button>
                    </div>
                  )}

                  {popSubTab === 'JEBON_SUB' && jebonSettingsTab === 'SIZE' ? (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-3">
                        <h4 className="text-sm font-black text-slate-800">📏 제본 판형 마스터</h4>
                        <p className="text-[10px] text-slate-400 mt-1">
                          종류·규격·설명으로 관리합니다. 신청서 「제본 판형 지정」 콤보박스에 실시간 반영됩니다.
                        </p>
                        {!canEdit && (
                          <p className="text-[10px] text-amber-600 mt-1.5 font-bold">
                            ※ 신규 판형 수정·삭제는 편집 권한, 시드 판형 삭제는 LV_1(마스터) 권한이 필요합니다. 신규 등록은 메뉴 접근자 모두 가능합니다.
                          </p>
                        )}
                      </div>

                      <div className={`${JEBON_SIZE_MASTER_GRID} bg-slate-50 p-4 rounded-xl border border-slate-200`}>
                        <div>
                          <label className="text-[10px] font-black text-slate-400 block mb-1">종류</label>
                          <input
                            type="text"
                            placeholder="예: A4"
                            value={newJebonSize.label}
                            onChange={(e) =>
                              setNewJebonSize({ ...newJebonSize, label: e.target.value })
                            }
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-slate-400 block mb-1">규격</label>
                          <input
                            type="text"
                            placeholder="예: 210 × 297mm"
                            value={newJebonSize.size}
                            onChange={(e) =>
                              setNewJebonSize({ ...newJebonSize, size: e.target.value })
                            }
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-slate-400 block mb-1">설명</label>
                          <input
                            type="text"
                            placeholder="예: 표준 기본"
                            value={newJebonSize.description}
                            onChange={(e) =>
                              setNewJebonSize({ ...newJebonSize, description: e.target.value })
                            }
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-500"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleAddJebonSizeMaster}
                          className="font-black px-3 py-2.5 text-xs rounded-xl transition-all shadow-md active:scale-95 w-full bg-indigo-600 hover:bg-indigo-500 text-white whitespace-nowrap"
                        >
                          + 신규 등록
                        </button>
                      </div>

                      <div className={`${JEBON_SIZE_MASTER_GRID} px-3 hidden md:grid`}>
                        <span className="text-[9px] font-black text-slate-400">종류</span>
                        <span className="text-[9px] font-black text-slate-400">규격</span>
                        <span className="text-[9px] font-black text-slate-400">설명</span>
                        <span className="text-[9px] font-black text-slate-400 text-right">관리</span>
                      </div>

                      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                        {jebonSizeMasterList.map((row) => {
                          const isEditing = editingJebonSizeCode === row.code && !!editingJebonSizeDraft;
                          const draft = isEditing ? editingJebonSizeDraft! : row;
                          return (
                            <div
                              key={row.code}
                              className={`p-3 rounded-xl border ${
                                isEditing
                                  ? 'border-indigo-400 bg-indigo-50/40'
                                  : 'border-slate-200 bg-slate-50/80'
                              }`}
                            >
                              <div className={JEBON_SIZE_MASTER_GRID}>
                                <div className="min-w-0">
                                  <label className="text-[9px] font-black text-slate-400 block mb-1 md:sr-only">
                                    종류
                                  </label>
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={draft.label}
                                      onChange={(e) =>
                                        setEditingJebonSizeDraft({
                                          ...draft,
                                          label: e.target.value,
                                        })
                                      }
                                      className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold outline-none"
                                    />
                                  ) : (
                                    <span className="text-xs font-black text-slate-800 block truncate">
                                      {row.label}
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <label className="text-[9px] font-black text-slate-400 block mb-1 md:sr-only">
                                    규격
                                  </label>
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={draft.size}
                                      onChange={(e) =>
                                        setEditingJebonSizeDraft({
                                          ...draft,
                                          size: e.target.value,
                                        })
                                      }
                                      className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none"
                                    />
                                  ) : (
                                    <span className="text-xs font-semibold text-slate-700 block truncate">
                                      {row.size || '—'}
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <label className="text-[9px] font-black text-slate-400 block mb-1 md:sr-only">
                                    설명
                                  </label>
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={draft.description}
                                      onChange={(e) =>
                                        setEditingJebonSizeDraft({
                                          ...draft,
                                          description: e.target.value,
                                        })
                                      }
                                      className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none"
                                    />
                                  ) : (
                                    <span className="text-xs text-slate-600 block truncate">
                                      {row.description || '—'}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-1.5 justify-end w-full pb-0.5">
                                  {isEditing ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={!canEdit}
                                        onClick={() => handleSaveJebonSizeRow(draft)}
                                        className={`text-[9px] font-black px-2 py-1 rounded-md border whitespace-nowrap ${
                                          canEdit
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : DISABLED_ACTION_BTN
                                        }`}
                                      >
                                        저장
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingJebonSizeCode(null);
                                          setEditingJebonSizeDraft(null);
                                        }}
                                        className="text-[9px] font-black px-2 py-1 rounded-md border bg-white text-slate-500 border-slate-200 whitespace-nowrap"
                                      >
                                        취소
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        disabled={!canEdit}
                                        onClick={() => {
                                          if (!canEdit) return alertNoEditPermission();
                                          setEditingJebonSizeCode(row.code);
                                          setEditingJebonSizeDraft({ ...row });
                                        }}
                                        className={`text-[9px] font-black px-2 py-1 rounded-md border whitespace-nowrap ${
                                          canEdit
                                            ? 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                                            : DISABLED_ACTION_BTN
                                        }`}
                                      >
                                        수정
                                      </button>
                                      <button
                                        type="button"
                                        disabled={
                                          !(isSeedJebonSizeCode(row.code)
                                            ? canDeleteLv1Cert
                                            : canEdit)
                                        }
                                        title={
                                          isSeedJebonSizeCode(row.code) && !canDeleteLv1Cert
                                            ? '시드 판형 삭제는 LV_1 권한 필요'
                                            : !canEdit
                                              ? '편집 권한 필요'
                                              : undefined
                                        }
                                        onClick={() => handleDeleteJebonSize(row.code)}
                                        className={`text-[9px] font-black px-2 py-1 rounded-md border whitespace-nowrap ${
                                          (isSeedJebonSizeCode(row.code)
                                            ? canDeleteLv1Cert
                                            : canEdit)
                                            ? 'text-red-400 hover:text-red-600 bg-white border-slate-200'
                                            : DISABLED_ACTION_BTN
                                        }`}
                                      >
                                        {isSeedJebonSizeCode(row.code) ? '삭제(LV_1)' : '삭제'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className="border-b border-slate-100 pb-3 shrink-0">
                    <h4 className="text-sm font-black text-slate-800">
                      {popSubTab === 'SIGN_SUB' ? '📋 인증별 설정' : '📋 인증별 제본 서식·기본값 설정'}
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-1">
                      「수정」을 누른 행만 편집할 수 있습니다. 변경 후 「저장」으로 DB에 반영하세요.
                    </p>
                  </div>

                  {/* 마스터 카드 리스트 */}
                  <div className="space-y-2 pr-1">
                    {popSubTab === 'SIGN_SUB' ? (
                      signCertMasterList.map((c) => {
                        const isRowEditing = editingCertId === c.id && !!editingSignDraft;
                        const draft = isRowEditing ? editingSignDraft! : null;
                        const patchDraft = (
                          patch: Partial<NonNullable<typeof editingSignDraft>>
                        ) => {
                          if (!draft) return;
                          setEditingSignDraft({ ...draft, ...patch });
                        };
                        const locked =
                          'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed';
                        const editable =
                          'bg-white border-slate-300 text-slate-800 focus:border-blue-500';
                        return (
                        <div
                          key={c.id}
                          onClick={() => {
                            if (!isRowEditing) setSelectedMasterCertId(c.id);
                          }}
                          className={`p-3.5 rounded-2xl border flex flex-col gap-2 transition-all relative ${
                            isRowEditing
                              ? 'bg-blue-50/70 border-blue-500 shadow-sm'
                              : selectedMasterCertId === c.id
                                ? 'bg-blue-50/50 border-blue-500 shadow-sm cursor-pointer'
                                : 'bg-slate-50 border-slate-200/60 hover:bg-slate-100 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              {isRowEditing ? (
                                <input
                                  type="text"
                                  value={draft!.label}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => patchDraft({ label: e.target.value })}
                                  className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-black outline-none border ${editable}`}
                                  placeholder="인증 종류 명칭"
                                />
                              ) : (
                                <span className="font-black text-slate-800 text-xs block">
                                  📍 {c.label}
                                </span>
                              )}
                            </div>
                            <div
                              className="flex items-center gap-1 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isRowEditing ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={!canEdit}
                                    onClick={() => saveSignRowEdit(c)}
                                    className={`text-[9px] font-black px-2 py-1 rounded-md border ${
                                      canEdit
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : DISABLED_ACTION_BTN
                                    }`}
                                  >
                                    저장
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelSignRowEdit}
                                    className="text-[9px] font-black px-2 py-1 rounded-md border bg-white text-slate-500 border-slate-200"
                                  >
                                    취소
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() => beginSignRowEdit(c)}
                                  className={`text-[9px] font-black px-2 py-1 rounded-md border ${
                                    canEdit
                                      ? 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                      : DISABLED_ACTION_BTN
                                  }`}
                                >
                                  수정
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={
                                  !(isSeedCertId(c.id) ? canDeleteLv1Cert : canEdit) ||
                                  isRowEditing
                                }
                                title={
                                  isRowEditing
                                    ? '편집 중에는 삭제할 수 없습니다'
                                    : isSeedCertId(c.id) && !canDeleteLv1Cert
                                      ? '시드 인증 삭제는 LV_1 권한 필요'
                                      : !canEdit
                                        ? '편집 권한 필요'
                                        : undefined
                                }
                                onClick={() => handleIdDeleteCert(c.id)}
                                className={`text-[9px] font-black px-2 py-1 rounded-md border ${
                                  (isSeedCertId(c.id) ? canDeleteLv1Cert : canEdit) &&
                                  !isRowEditing
                                    ? 'text-red-400 hover:text-red-600 bg-white border-slate-200 hover:border-red-200'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                {isSeedCertId(c.id) ? '삭제(LV_1)' : '삭제'}
                              </button>
                            </div>
                          </div>

                          <div
                            className="w-full pt-2 border-t border-slate-200/60 mt-0.5 space-y-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <label
                              className={`flex items-center gap-2 text-[10px] font-black text-slate-600 select-none ${
                                isRowEditing ? 'cursor-pointer' : 'cursor-not-allowed'
                              }`}
                            >
                              <span className="shrink-0">인증번호 적용</span>
                              <input
                                type="checkbox"
                                checked={
                                  isRowEditing ? draft!.useCertNumber : c.useCertNumber
                                }
                                disabled={!isRowEditing}
                                onChange={(e) =>
                                  patchDraft({ useCertNumber: e.target.checked })
                                }
                                className="w-3.5 h-3.5 accent-blue-600 rounded disabled:cursor-not-allowed"
                              />
                              <span className="text-slate-400 font-bold">
                                {(isRowEditing ? draft!.useCertNumber : c.useCertNumber)
                                  ? '(신청폼 ON)'
                                  : '(신청폼 OFF)'}
                              </span>
                            </label>

                            <label
                              className={`flex items-center gap-2 text-[10px] font-black text-slate-600 select-none ${
                                isRowEditing ? 'cursor-pointer' : 'cursor-not-allowed'
                              }`}
                            >
                              <span className="shrink-0">명판 유효기간 적용</span>
                              <input
                                type="checkbox"
                                checked={
                                  isRowEditing ? draft!.useValidPeriod : c.useValidPeriod
                                }
                                disabled={!isRowEditing}
                                onChange={(e) =>
                                  patchDraft({ useValidPeriod: e.target.checked })
                                }
                                className="w-3.5 h-3.5 accent-blue-600 rounded disabled:cursor-not-allowed"
                              />
                              <span className="text-slate-400 font-bold">
                                {(isRowEditing ? draft!.useValidPeriod : c.useValidPeriod)
                                  ? '(신청폼 ON)'
                                  : '(신청폼 OFF)'}
                              </span>
                            </label>

                            <div className="flex items-center gap-2 min-w-0">
                              <span className="shrink-0 text-[10px] font-black text-slate-800">
                                출력양식설정 :
                              </span>
                              {isRowEditing ? (
                                <input
                                  type="text"
                                  value={draft!.format}
                                  placeholder="출력 양식 입력"
                                  disabled={!draft!.useValidPeriod}
                                  onChange={(e) => patchDraft({ format: e.target.value })}
                                  className={`flex-1 min-w-0 text-[11px] font-mono p-2 rounded-lg outline-none border ${
                                    draft!.useValidPeriod ? editable : locked
                                  }`}
                                />
                              ) : (
                                <span
                                  className={`flex-1 min-w-0 break-all text-[11px] font-mono font-bold leading-relaxed rounded-lg px-2 py-2 border ${
                                    c.useValidPeriod
                                      ? 'bg-white border-slate-200 text-slate-700'
                                      : 'bg-slate-100 border-slate-200 text-slate-400'
                                  }`}
                                >
                                  {c.format || '-'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })
                    ) : (
                      <>
                        {/* 열 헤더 */}
                        <div className="hidden md:flex items-center gap-0 px-3 pb-1.5 text-[9px] font-black text-slate-400 tracking-wider">
                          <span className="min-w-[15rem] flex-1">인증 종류</span>
                          <span className="w-[5.25rem] shrink-0 pl-3 ml-1 border-l border-transparent">판형</span>
                          <span className="w-[4.25rem] shrink-0 pl-3 ml-1 border-l border-transparent">부수</span>
                          <span className="w-[14.5rem] shrink-0 pl-3 ml-1 border-l border-transparent">
                            표지 (적용 · 색상 · 면수)
                          </span>
                          <span className="w-[5.5rem] shrink-0 pl-3 ml-1 border-l border-transparent">본문</span>
                          <span className="w-[11rem] shrink-0 pl-3 ml-1 border-l border-transparent">
                            표지 일자 양식 (적용 · 서식)
                          </span>
                          <span className="w-[5.75rem] shrink-0 pl-3 ml-1 border-l border-transparent text-right">
                            관리
                          </span>
                        </div>
                        {jebonCertMasterList.map((c) => {
                          const isRowEditing = editingCertId === c.id && !!editingJebonDraft;
                          const draft = isRowEditing ? editingJebonDraft! : null;
                          const useCoverDate = isRowEditing
                            ? draft!.useJebonCoverDate
                            : c.useJebonCoverDate !== false;
                          const colDivider = 'pl-3 ml-1.5 border-l border-slate-300';
                          const lockedInput =
                            'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed';
                          const editInput =
                            'bg-white border-slate-300 text-slate-800 focus:border-indigo-400';
                          const patchDraft = (patch: Partial<NonNullable<typeof editingJebonDraft>>) => {
                            if (!draft) return;
                            setEditingJebonDraft({ ...draft, ...patch });
                          };
                          return (
                            <div
                              key={c.id}
                              className={`px-3 py-2.5 rounded-xl border transition-all ${
                                isRowEditing
                                  ? 'border-indigo-400 bg-indigo-50/40 shadow-sm'
                                  : 'border-slate-200 bg-slate-50/80 hover:bg-slate-50'
                              }`}
                            >
                              <div
                                className="flex items-center gap-0 min-w-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* 인증명 — 너비 확보 */}
                                <div className="min-w-[15rem] flex-1 pr-1">
                                  {isRowEditing ? (
                                    <input
                                      type="text"
                                      value={draft!.label}
                                      onChange={(e) => patchDraft({ label: e.target.value })}
                                      className={`w-full rounded-lg px-2 py-1.5 text-xs font-black outline-none border ${editInput}`}
                                      placeholder="인증 종류 명칭"
                                    />
                                  ) : (
                                    <span className="font-black text-slate-800 text-xs block leading-snug break-words">
                                      📍 {c.label}
                                    </span>
                                  )}
                                </div>

                                {/* 판형 */}
                                <div className={`w-[5.25rem] shrink-0 ${colDivider}`}>
                                  <select
                                    value={isRowEditing ? draft!.jebonDefaultSizeType : c.jebonDefaultSizeType || 'A4'}
                                    disabled={!isRowEditing}
                                    title="판형"
                                    onChange={(e) =>
                                      patchDraft({ jebonDefaultSizeType: e.target.value })
                                    }
                                    className={`w-full rounded-lg px-1.5 py-1.5 text-[10px] font-bold outline-none border ${
                                      isRowEditing ? editInput : lockedInput
                                    }`}
                                  >
                                    {jebonSizeMasterList.map((opt) => (
                                      <option key={opt.code} value={opt.code}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                {/* 부수 */}
                                <div className={`w-[4.25rem] shrink-0 ${colDivider}`}>
                                  <div className="flex items-center gap-0.5">
                                    <input
                                      type="number"
                                      min={1}
                                      title="부수 기본값"
                                      value={
                                        isRowEditing
                                          ? draft!.jebonDefaultQuantity
                                          : c.jebonDefaultQuantity || 1
                                      }
                                      disabled={!isRowEditing}
                                      onChange={(e) =>
                                        patchDraft({
                                          jebonDefaultQuantity: Math.max(
                                            1,
                                            parseInt(e.target.value, 10) || 1
                                          ),
                                        })
                                      }
                                      className={`w-full min-w-0 rounded-lg px-1 py-1.5 text-[10px] font-bold outline-none text-right border ${
                                        isRowEditing ? editInput : lockedInput
                                      }`}
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold shrink-0">부</span>
                                  </div>
                                </div>

                                {/* 표지 그룹 */}
                                <div
                                  className={`w-[14.5rem] shrink-0 ${colDivider} ${
                                    !(isRowEditing ? draft!.useJebonCover : c.useJebonCover)
                                      ? 'opacity-60'
                                      : ''
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 rounded-lg bg-indigo-50/70 border border-indigo-100 px-1.5 py-1">
                                    <label
                                      className={`flex items-center gap-1 text-[10px] font-black text-slate-600 select-none shrink-0 ${
                                        isRowEditing ? 'cursor-pointer' : 'cursor-not-allowed'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={
                                          isRowEditing ? draft!.useJebonCover : c.useJebonCover
                                        }
                                        disabled={!isRowEditing}
                                        onChange={(e) =>
                                          patchDraft({ useJebonCover: e.target.checked })
                                        }
                                        className="w-3.5 h-3.5 accent-indigo-600 rounded disabled:cursor-not-allowed"
                                      />
                                      <span className="text-[9px] text-indigo-500 font-bold">
                                        {(isRowEditing ? draft!.useJebonCover : c.useJebonCover)
                                          ? 'ON'
                                          : 'OFF'}
                                      </span>
                                    </label>
                                    <select
                                      value={
                                        isRowEditing
                                          ? draft!.jebonCoverColor
                                          : c.jebonCoverColor || '컬러'
                                      }
                                      disabled={
                                        !isRowEditing ||
                                        !(isRowEditing ? draft!.useJebonCover : c.useJebonCover)
                                      }
                                      onChange={(e) =>
                                        patchDraft({ jebonCoverColor: e.target.value })
                                      }
                                      className={`flex-1 min-w-0 rounded-lg px-1 py-1 text-[10px] font-bold outline-none border ${
                                        isRowEditing &&
                                        (isRowEditing ? draft!.useJebonCover : c.useJebonCover)
                                          ? editInput
                                          : lockedInput
                                      }`}
                                    >
                                      <option value="컬러">컬러</option>
                                      <option value="흑백">흑백</option>
                                    </select>
                                    <input
                                      type="number"
                                      min={0}
                                      title="표지 면수"
                                      value={
                                        isRowEditing
                                          ? draft!.jebonCoverPageCount
                                          : c.jebonCoverPageCount || '1'
                                      }
                                      disabled={
                                        !isRowEditing ||
                                        !(isRowEditing ? draft!.useJebonCover : c.useJebonCover)
                                      }
                                      onChange={(e) =>
                                        patchDraft({ jebonCoverPageCount: e.target.value || '1' })
                                      }
                                      className={`w-10 shrink-0 rounded-lg px-1 py-1 text-[10px] font-bold outline-none text-right border ${
                                        isRowEditing &&
                                        (isRowEditing ? draft!.useJebonCover : c.useJebonCover)
                                          ? editInput
                                          : lockedInput
                                      }`}
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold shrink-0">면</span>
                                  </div>
                                </div>

                                {/* 본문 */}
                                <div className={`w-[5.5rem] shrink-0 ${colDivider}`}>
                                  <select
                                    value={
                                      isRowEditing
                                        ? draft!.jebonInnerColor
                                        : c.jebonInnerColor || '흑백'
                                    }
                                    disabled={!isRowEditing}
                                    onChange={(e) =>
                                      patchDraft({ jebonInnerColor: e.target.value })
                                    }
                                    className={`w-full rounded-lg px-1.5 py-1.5 text-[10px] font-bold outline-none border ${
                                      isRowEditing ? editInput : lockedInput
                                    }`}
                                  >
                                    <option value="흑백">흑백</option>
                                    <option value="컬러">컬러</option>
                                  </select>
                                </div>

                                {/* 표지 일자 양식 */}
                                <div
                                  className={`w-[11rem] shrink-0 ${colDivider} ${
                                    !useCoverDate ? 'opacity-60' : ''
                                  }`}
                                >
                                  <div className="flex items-center gap-1 rounded-lg bg-amber-50/70 border border-amber-100 px-1.5 py-1">
                                    <label
                                      className={`flex items-center gap-1 text-[10px] font-black text-slate-600 select-none shrink-0 ${
                                        isRowEditing ? 'cursor-pointer' : 'cursor-not-allowed'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={useCoverDate}
                                        disabled={!isRowEditing}
                                        onChange={(e) =>
                                          patchDraft({ useJebonCoverDate: e.target.checked })
                                        }
                                        className="w-3.5 h-3.5 accent-amber-600 rounded disabled:cursor-not-allowed"
                                      />
                                      <span className="text-[9px] text-amber-600 font-bold">
                                        {useCoverDate ? 'ON' : 'OFF'}
                                      </span>
                                    </label>
                                    {isRowEditing ? (
                                      <input
                                        type="text"
                                        value={draft!.jebonFormat}
                                        disabled={!useCoverDate}
                                        onChange={(e) =>
                                          patchDraft({ jebonFormat: e.target.value })
                                        }
                                        className={`flex-1 min-w-0 rounded-lg px-1 py-1 text-[10px] font-mono font-bold outline-none border ${
                                          useCoverDate ? editInput : lockedInput
                                        }`}
                                        placeholder="0000. 0. 0."
                                      />
                                    ) : (
                                      <span className="block flex-1 min-w-0 truncate text-[10px] font-mono font-bold text-indigo-600 bg-slate-100 border border-slate-200 rounded-lg px-1 py-1">
                                        {c.jebonFormat || '-'}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* 관리: 수정/저장 · 삭제 — 맨 오른쪽 */}
                                <div
                                  className={`w-[5.75rem] shrink-0 ${colDivider} flex items-center justify-end gap-1`}
                                >
                                  {isRowEditing ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={!canEdit}
                                        onClick={() => saveJebonRowEdit(c)}
                                        className={`text-[9px] font-black px-1.5 py-1 rounded-md border ${
                                          canEdit
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : DISABLED_ACTION_BTN
                                        }`}
                                      >
                                        저장
                                      </button>
                                      <button
                                        type="button"
                                        onClick={cancelJebonRowEdit}
                                        className="text-[9px] font-black px-1.5 py-1 rounded-md border bg-white text-slate-500 border-slate-200"
                                      >
                                        취소
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={!canEdit}
                                      onClick={() => beginJebonRowEdit(c)}
                                      className={`text-[9px] font-black px-1.5 py-1 rounded-md border ${
                                        canEdit
                                          ? 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                                          : DISABLED_ACTION_BTN
                                      }`}
                                    >
                                      수정
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={
                                      !(isSeedCertId(c.id) ? canDeleteLv1Cert : canEdit) ||
                                      isRowEditing
                                    }
                                    title={
                                      isRowEditing
                                        ? '편집 중에는 삭제할 수 없습니다'
                                        : isSeedCertId(c.id) && !canDeleteLv1Cert
                                          ? '시드 인증 삭제는 LV_1 권한 필요'
                                          : !canEdit
                                            ? '편집 권한 필요'
                                            : undefined
                                    }
                                    onClick={() => handleIdDeleteCert(c.id)}
                                    className={`text-[9px] font-black px-1.5 py-1 rounded-md border ${
                                      (isSeedCertId(c.id) ? canDeleteLv1Cert : canEdit) &&
                                      !isRowEditing
                                        ? 'text-red-400 hover:text-red-600 bg-white border-slate-200 hover:border-red-200'
                                        : DISABLED_ACTION_BTN
                                    }`}
                                  >
                                    {isSeedCertId(c.id) ? '삭제(LV_1)' : '삭제'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>

                {/* 하단 신규 등록 — Edit 권한 필요 */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex gap-2 shrink-0">
                  <input 
                    type="text" 
                    placeholder={popSubTab === 'SIGN_SUB' ? "➕ 새 명판 인증명 입력" : "➕ 새 제본 인증명 입력"} 
                    value={newCertName}
                    disabled={!canEdit}
                    title={!canEdit ? '편집 권한 필요' : undefined}
                    onChange={e => setNewCertName(e.target.value)} 
                    className={`flex-1 border rounded-xl px-3 py-2.5 text-xs font-semibold outline-none transition-all ${
                      canEdit
                        ? 'bg-slate-50 border-slate-200 focus:bg-white focus:border-blue-500'
                        : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  />
                  <button 
                    type="button"
                    disabled={!canEdit}
                    title={!canEdit ? '편집 권한 필요' : undefined}
                    onClick={handleAddCertMaster} 
                    className={`px-4 py-2.5 rounded-xl font-black text-xs transition-all shadow-md active:scale-95 text-white ${
                      !canEdit
                        ? DISABLED_ACTION_BTN
                        : popSubTab === 'SIGN_SUB'
                          ? 'bg-blue-600 hover:bg-blue-500'
                          : 'bg-indigo-600 hover:bg-indigo-500'
                    }`}
                  >
                    + 신규 등록
                  </button>
                </div>
                  </>
                  )}

              </div>
             </div>

              {/* 오른쪽 세부 등급 설정 패널 — 현판(SIGN) 전용 */}
              {popSubTab === 'SIGN_SUB' && (
              <div className="bg-slate-900 text-white rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4 flex flex-col min-w-0">
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-3">
                    <div className="text-[10px] font-black text-blue-400 uppercase tracking-wider">GRADE INTERACTION PANEL</div>
                    <h4 className="text-sm font-black text-slate-200 mt-0.5">
                      👑 [{signCertMasterList.find(c => c.id === selectedMasterCertId)?.label || '선택 없음'}] 인증 등급/종류 설정
                    </h4>
                    {!canEdit && (
                      <p className="text-[10px] text-amber-400/90 mt-1.5 font-bold">
                        ※ 등급 추가·수정·삭제는 편집 권한이 필요합니다.
                      </p>
                    )}
                  </div>

                  {(() => {
                    const row = signCertMasterList.find((c) => c.id === selectedMasterCertId);
                    if (!row) return null;
                    const saveGradeInputMode = async (useMultiGradeSelect: boolean) => {
                      if (!canEdit) return alertNoEditPermission();
                      if (row.useMultiGradeSelect === useMultiGradeSelect) return;
                      try {
                        await persistCert({
                          certId: selectedMasterCertId,
                          type: 'SIGN',
                          label: row.label,
                          format: row.format,
                          grades: gradeMasterMap[selectedMasterCertId] || [],
                          useCertNumber: row.useCertNumber,
                          useValidPeriod: row.useValidPeriod,
                          useMultiGradeSelect,
                        });
                      } catch (err: any) {
                        alert(err?.message || '저장 실패');
                      }
                    };
                    return (
                      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 space-y-2">
                        <div className="text-[10px] font-black text-slate-300">
                          신청폼 등급 입력 방식
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={() => saveGradeInputMode(true)}
                            className={`px-2.5 py-2 rounded-lg text-[10px] font-black border transition-all ${
                              row.useMultiGradeSelect
                                ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                            } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            ☑ 체크박스 복수 선택
                          </button>
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={() => saveGradeInputMode(false)}
                            className={`px-2.5 py-2 rounded-lg text-[10px] font-black border transition-all ${
                              !row.useMultiGradeSelect
                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                            } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            ▾ 셀렉트 단일 선택
                          </button>
                        </div>
                        <p className="text-[9px] text-slate-500 font-bold leading-relaxed">
                          클릭 즉시 저장됩니다. 신청서 「2. 인증 등급/종류 설정」 UI에 반영됩니다.
                        </p>
                      </div>
                    );
                  })()}

                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="➕ 새 등급 매핑 기입"
                      value={newGradeName}
                      disabled={!canEdit}
                      title={!canEdit ? '편집 권한 필요' : undefined}
                      onChange={e => setNewGradeName(e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl p-2.5 text-xs outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <button
                      type="button"
                      disabled={!canEdit}
                      title={!canEdit ? '편집 권한 필요' : undefined}
                      onClick={async () => {
                        if (!canEdit) return alertNoEditPermission();
                        if (!newGradeName.trim() || !selectedMasterCertId) return;
                        const nextGrades = [
                          ...(gradeMasterMap[selectedMasterCertId] || []),
                          newGradeName.trim(),
                        ];
                        const type = popSubTab === 'SIGN_SUB' ? 'SIGN' : 'JEBON';
                        const row =
                          type === 'SIGN'
                            ? signCertMasterList.find((c) => c.id === selectedMasterCertId)
                            : jebonCertMasterList.find((c) => c.id === selectedMasterCertId);
                        if (!row) return;
                        try {
                          await persistCert({
                            certId: selectedMasterCertId,
                            type,
                            label: row.label,
                            format: type === 'SIGN' ? (row as any).format || '' : '',
                            jebonFormat: type === 'JEBON' ? (row as any).jebonFormat || '' : '',
                            grades: nextGrades,
                          });
                          setNewGradeName('');
                        } catch (err: any) {
                          alert(err?.message || '등급 저장 실패');
                        }
                      }}
                      className={`font-black text-xs px-4 rounded-xl transition-all shadow-md ${
                        canEdit
                          ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          : 'bg-slate-700 text-slate-500 cursor-not-allowed opacity-60'
                      }`}
                    >
                      추가
                    </button>
                  </div>

                  <div className="space-y-2 pr-1">
                    {(gradeMasterMap[selectedMasterCertId] || []).map((grade, gIdx) => (
                      <div key={gIdx} className="flex justify-between items-center bg-slate-800 p-3 rounded-xl border border-slate-700/60 w-full gap-2">
                        {editingGradeIndex === gIdx ? (
                          <input type="text" value={editingGradeValue} onChange={e => setEditingGradeValue(e.target.value)} className="bg-slate-900 border border-slate-600 text-white rounded-lg px-2 py-1 text-xs flex-1 outline-none font-medium" />
                        ) : (
                          <span className="text-xs font-bold text-slate-200 truncate flex-1">🎖️ {grade}</span>
                        )}
                        <div className="flex gap-1.5 shrink-0">
                          {editingGradeIndex === gIdx ? (
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={async () => {
                                if (!canEdit) return alertNoEditPermission();
                                if (!editingGradeValue.trim() || !selectedMasterCertId) return;
                                const updatedGrades = [
                                  ...(gradeMasterMap[selectedMasterCertId] || []),
                                ];
                                updatedGrades[gIdx] = editingGradeValue.trim();
                                const type = popSubTab === 'SIGN_SUB' ? 'SIGN' : 'JEBON';
                                const row =
                                  type === 'SIGN'
                                    ? signCertMasterList.find((c) => c.id === selectedMasterCertId)
                                    : jebonCertMasterList.find((c) => c.id === selectedMasterCertId);
                                if (!row) return;
                                try {
                                  await persistCert({
                                    certId: selectedMasterCertId,
                                    type,
                                    label: row.label,
                                    format: type === 'SIGN' ? (row as any).format || '' : '',
                                    jebonFormat:
                                      type === 'JEBON' ? (row as any).jebonFormat || '' : '',
                                    grades: updatedGrades,
                                  });
                                  setEditingGradeIndex(null);
                                } catch (err: any) {
                                  alert(err?.message || '등급 저장 실패');
                                }
                              }}
                              className="text-[10px] font-black text-emerald-400 bg-slate-900 px-2 py-1 rounded-lg border border-slate-700"
                            >
                              저장
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => {
                                if (!canEdit) return alertNoEditPermission();
                                setEditingGradeIndex(gIdx);
                                setEditingGradeValue(grade);
                              }}
                              className={`text-[10px] font-black px-2 py-1 rounded-lg ${
                                canEdit
                                  ? 'text-blue-300 bg-slate-700'
                                  : 'text-slate-500 bg-slate-800 cursor-not-allowed opacity-50'
                              }`}
                            >
                              수정
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : undefined}
                            onClick={async () => {
                              if (!canEdit) return alertNoEditPermission();
                              if (!selectedMasterCertId) return;
                              const currentGrades = (
                                gradeMasterMap[selectedMasterCertId] || []
                              ).filter((_, idx) => idx !== gIdx);
                              const type = popSubTab === 'SIGN_SUB' ? 'SIGN' : 'JEBON';
                              const row =
                                type === 'SIGN'
                                  ? signCertMasterList.find((c) => c.id === selectedMasterCertId)
                                  : jebonCertMasterList.find((c) => c.id === selectedMasterCertId);
                              if (!row) return;
                              try {
                                await persistCert({
                                  certId: selectedMasterCertId,
                                  type,
                                  label: row.label,
                                  format: type === 'SIGN' ? (row as any).format || '' : '',
                                  jebonFormat:
                                    type === 'JEBON' ? (row as any).jebonFormat || '' : '',
                                  grades: currentGrades,
                                });
                              } catch (err: any) {
                                alert(err?.message || '등급 삭제 실패');
                              }
                            }}
                            className={`text-[10px] font-black px-2 py-1 rounded-lg ${
                              canEdit
                                ? 'text-red-400 bg-slate-700'
                                : 'text-slate-500 bg-slate-800 cursor-not-allowed opacity-50'
                            }`}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800 text-right">
                  <span className="text-[10px] text-slate-500 font-bold">※ 여기서 저장한 서식·등급은 신청서 본문과 즉시 동기화됩니다.</span>
                </div>
              </div>
              )}

              {/* 오른쪽 3열: 인증별 현판 품목 연동 — SIGN 전용 */}
              {popSubTab === 'SIGN_SUB' && (
              <div className="bg-emerald-950 text-white rounded-2xl p-6 border border-emerald-900 shadow-xl space-y-4 flex flex-col min-w-0 min-h-0">
                <div className="border-b border-emerald-900 pb-3 shrink-0">
                  <div className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                    PLATE LINK PANEL
                  </div>
                  <h4 className="text-sm font-black text-emerald-50 mt-0.5">
                    📛 [{signCertMasterList.find((c) => c.id === selectedMasterCertId)?.label || '선택 없음'}] 현판 품목별 규격 및 단가 설정
                  </h4>
                  <p className="text-[10px] text-emerald-200/70 mt-1.5 font-bold leading-relaxed">
                    체크한 품목만 해당 인증 선택 시 신청폼 「3. 현판 품목 설정」에 노출됩니다. 복수 선택 가능 · 클릭 즉시 저장.
                  </p>
                  {!canEdit && (
                    <p className="text-[10px] text-amber-400/90 mt-1.5 font-bold">
                      ※ 품목 연결 변경은 편집 권한이 필요합니다.
                    </p>
                  )}
                </div>

                {(() => {
                  const row = signCertMasterList.find((c) => c.id === selectedMasterCertId);
                  if (!row) {
                    return (
                      <div className="rounded-xl border border-dashed border-emerald-800 bg-emerald-900/40 px-3 py-6 text-center text-[11px] font-bold text-emerald-300/70">
                        좌측에서 인증을 선택해 주세요.
                      </div>
                    );
                  }
                  const linked = new Set(row.linkedPlateCodes || []);
                  const togglePlate = async (code: string, checked: boolean) => {
                    if (!canEdit) return alertNoEditPermission();
                    const next = checked
                      ? [...linked, code]
                      : [...linked].filter((c) => c !== code);
                    try {
                      await persistCert({
                        certId: selectedMasterCertId,
                        type: 'SIGN',
                        label: row.label,
                        format: row.format,
                        grades: gradeMasterMap[selectedMasterCertId] || [],
                        useCertNumber: row.useCertNumber,
                        useValidPeriod: row.useValidPeriod,
                        useMultiGradeSelect: row.useMultiGradeSelect,
                        linkedPlateCodes: Array.from(new Set(next)),
                      });
                    } catch (err: any) {
                      alert(err?.message || '품목 연결 저장 실패');
                    }
                  };
                  if (plateMasterList.length === 0) {
                    return (
                      <div className="rounded-xl border border-dashed border-emerald-800 bg-emerald-900/40 px-3 py-6 text-center text-[11px] font-bold text-emerald-300/70">
                        등록된 현판 품목이 없습니다. 「현판 품목별 규격 및 단가 설정」에서 품목을 먼저 등록해 주세요.
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2 overflow-y-auto max-h-[28rem] pr-1">
                      {plateMasterList.map((p) => {
                        const checked = linked.has(p.code);
                        return (
                          <label
                            key={p.code}
                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                              checked
                                ? 'bg-emerald-800/70 border-emerald-500 shadow-sm'
                                : 'bg-emerald-900/50 border-emerald-800 hover:border-emerald-600'
                            } ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canEdit}
                              onChange={(e) => togglePlate(p.code, e.target.checked)}
                              className="mt-0.5 w-3.5 h-3.5 accent-emerald-400 rounded disabled:cursor-not-allowed shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-black text-emerald-50 truncate">
                                {p.label}
                              </span>
                              <span className="block text-[10px] font-bold text-emerald-300/80 mt-0.5">
                                {p.size || '자율 규격'} · {(Number(p.price) || 0).toLocaleString()}원
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="pt-3 border-t border-emerald-900 text-right shrink-0">
                  <span className="text-[10px] text-emerald-500/80 font-bold">
                    ※ 선택 {signCertMasterList.find((c) => c.id === selectedMasterCertId)?.linkedPlateCodes?.length || 0}개 / 전체 {plateMasterList.length}개
                  </span>
                </div>
              </div>
              )}

              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}