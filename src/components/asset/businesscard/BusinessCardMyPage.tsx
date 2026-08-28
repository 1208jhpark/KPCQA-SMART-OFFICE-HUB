'use client';

import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import { getKSTNowYearMonth, formatKSTDateTime } from '@/utils/dateUtils';

const MENU_PATH = '/asset/businesscard/my-page';
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none';

interface CurrentUserProps {
  currentUser?: {
    name: string;
    email: string;
    dept?: string;
  };
}

interface UnitItem {
  id: string;
  unit_name: string;
  unit_name_en: string;
  unit_type?: string;
  parent_id: string | null;
}

/** 명함: 본부=HQ, 소속=Center */
function isBusinessCardHqUnit(unit: { unit_type?: string | null; unit_name?: string | null } | null | undefined) {
  const t = String(unit?.unit_type || '').trim().toUpperCase();
  if (t === 'HQ' || t.startsWith('HQ')) return true;
  // 레거시·표기 변형: 이름이 HQ로 시작하는 경우
  const n = String(unit?.unit_name || '').trim();
  return /^hq\b/i.test(n) || /^hq[_-]/i.test(n);
}

interface MasterCode {
  id: string;
  label: string;  
  value: string | null; 
}

interface RequestHistory {
  id: string;
  postNumber: string;
  applyDate: string;
  processDate: string; 
  userName: string;
  userNameEn?: string;
  deptHead?: string;
  deptHeadEn?: string;
  deptName: string;
  deptNameEn?: string;
  title: string;
  titleEn?: string;
  mobile?: string;
  mobileEn?: string;
  phone?: string;
  phoneEn?: string;
  fax?: string;
  faxEn?: string;
  email?: string;
  emailEn?: string;
  additionalKo?: string;
  additionalEn?: string;
  addressId: string;
  zipCode: string;
  addressKo: string;
  addressEn: string;
  adminStatus: '대기중' | '접수완료' | '발주완료' | '지급완료' | string; // 🚀 '수령' 제거 완료
  isModifiedByAdmin?: boolean;
  adminMemo?: string | null;
  applicantType?: string | null;
  adminModifierName?: string | null;
  adminModifiedAt?: string | null;
  quantity?: number;
}

const MANUAL_QUAL_PREFIX = '__MANUAL__:';
const MANUAL_QUAL_OPTION = '__MANUAL__';

function isManualQualValue(value: string, masterNames: string[]) {
  const v = String(value || '');
  if (!v) return false;
  if (v.startsWith(MANUAL_QUAL_PREFIX) || v === MANUAL_QUAL_OPTION) return true;
  return !masterNames.includes(v);
}

function qualDisplayKo(value: string) {
  const v = String(value || '');
  if (v.startsWith(MANUAL_QUAL_PREFIX)) return v.slice(MANUAL_QUAL_PREFIX.length);
  if (v === MANUAL_QUAL_OPTION) return '';
  return v;
}

function toManualQualValue(text: string) {
  return `${MANUAL_QUAL_PREFIX}${text}`;
}

export default function BusinessCardMyPage({ currentUser }: CurrentUserProps) {
  const [loginUser, setLoginUser] = useState({
    name: '',
    nameEn: '',
    email: '',
    deptName: '',
  });
  /** /api/auth/me + unit — admin/user와 동일 출처 */
  const [profile, setProfile] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  /** 배너 아래 작성 폼: 기본 접힘 */
  const [isFormOpen, setIsFormOpen] = useState(false);

  const activeUser = {
    name: currentUser?.name || loginUser.name,
    nameEn: loginUser.nameEn,
    email: currentUser?.email || loginUser.email,
    dept: currentUser?.dept || loginUser.deptName
  };

  const pickNameEn = (me: any) =>
    String(me?.name_en ?? me?.nameEn ?? '').trim();

  const [formMode, setFormMode] = useState<'NEW' | 'VIEW' | 'EDIT'>('NEW');
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [duties, setDuties] = useState<MasterCode[]>([]);
  const [grades, setGrades] = useState<MasterCode[]>([]);
  const [history, setHistory] = useState<RequestHistory[]>([]);
  
  const [historyPage, setHistoryPage] = useState(1);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const itemsPerPage = 10;

  // 연도: KST 접속 연도 기본, 월: 전체
  const [yearFilter, setYearFilter] = useState<string>(() => String(getKSTNowYearMonth().year));
  const [monthFilter, setMonthFilter] = useState<string>('ALL');

  const [addresses, setAddresses] = useState<any[]>([]);
  const [qualifications, setQualifications] = useState<any[]>([]); 
  const [memoPopupTarget, setMemoPopupTarget] = useState<RequestHistory | null>(null);
  const [sheetsPerPack, setSheetsPerPack] = useState(200); 

  const canEdit = useMemo(
    () => resolveInterfaceEditState(profile || { email: activeUser.email }, interfaceConfig).isEditor,
    [profile, interfaceConfig, activeUser.email]
  );
  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');

  const [form, setForm] = useState({
    id: '', 
    userName: '', userNameEn: '',
    deptHead: '', deptHeadEn: '',
    deptName: '', deptNameEn: '',
    dutyName: '', dutyEn: '',
    gradeName: '', gradeEn: '',
    title: '', titleEn: '',
    additionalQuals: [] as string[],
    additionalQualsEn: [] as string[],
    mobile: '', mobileEn: '',
    phone: '', phoneEn: '',
    fax: '', faxEn: '', 
    email: '', emailEn: '',
    addressId: '', 
    zipCode: '',
    addressKo: '',
    addressEn: '',
    adminStatus: '대기중' as '대기중' | '접수완료' | '발주완료' | '지급완료' | string,
    isModifiedByAdmin: false,
    adminMemo: '',
    adminModifierName: '',
    adminModifiedAt: '',
    quantity: 1, 
  });

  const [backupForm, setBackupForm] = useState<typeof form | null>(null);

  const emptyFormBase = (addr?: any) => ({
    id: '',
    userName: '',
    userNameEn: '',
    deptHead: '',
    deptHeadEn: '',
    deptName: '',
    deptNameEn: '',
    dutyName: '',
    dutyEn: '',
    gradeName: '',
    gradeEn: '',
    title: '',
    titleEn: '',
    additionalQuals: [] as string[],
    additionalQualsEn: [] as string[],
    mobile: '',
    mobileEn: '',
    phone: '',
    phoneEn: '',
    fax: addr?.fax || '',
    faxEn: addr?.faxEn || '',
    email: '',
    emailEn: '',
    addressId: addr?.id || '',
    zipCode: addr?.zipCode || '',
    addressKo: addr?.addressKo || '',
    addressEn: addr?.addressEn || '',
    adminStatus: '대기중' as const,
    isModifiedByAdmin: false,
    adminMemo: '',
    adminModifierName: '',
    adminModifiedAt: '',
    quantity: 1,
  });

  /** admin/user(+소속 unit)에서 채울 수 있는 항목 동기화 — 없는 칸만 비워 둠 */
  const applyProfileSync = (
    me: any,
    unitList: UnitItem[],
    dutyList: MasterCode[],
    gradeList: MasterCode[],
    addrList: any[]
  ) => {
    const addr = addrList[0];
    const base = emptyFormBase(addr);
    if (!me) {
      return {
        ...base,
        userName: activeUser.name,
        userNameEn: activeUser.nameEn || '',
        email: activeUser.email,
        emailEn: activeUser.email,
        deptName: activeUser.dept,
      };
    }

    const unit = me.unit;
    const parent = unit?.parent;
    const unitName = String(unit?.unit_name || '').trim();
    const unitNameEn = String(unit?.unit_name_en || '').trim();

    let deptHead = '';
    let deptHeadEn = '';
    let deptName = '';
    let deptNameEn = '';

    // 명함 규칙: 소속=Center, 본부=HQ
    // - Center 소속 → 소속(센터)+본부(상위 HQ) 모두
    // - HQ 소속 → 본부에만 기입, 소속(센터)은 비움
    if (unit && isBusinessCardHqUnit(unit)) {
      deptHead = unitName;
      deptHeadEn = unitNameEn;
      deptName = '';
      deptNameEn = '';
    } else if (unit) {
      deptName = unitName;
      deptNameEn = unitNameEn;
      deptHead = String(parent?.unit_name || '').trim();
      deptHeadEn = String(parent?.unit_name_en || '').trim();
    }

    if (deptHead && !unitList.some((u) => u.unit_name === deptHead)) deptHead = '';
    if (deptName && !unitList.some((u) => u.unit_name === deptName)) {
      /* keep for display */
    }

    const dutyRaw = String(me.duty || '').trim();
    const dutyMatch =
      dutyList.find((d) => d.label === dutyRaw) ||
      dutyList.find((d) => String(d.value || '') === String(me.duty_en || '').trim());
    const gradeRaw = String(me.grade || '').trim();
    const gradeMatch =
      gradeList.find((g) => g.label === gradeRaw) ||
      gradeList.find((g) => String(g.value || '') === String(me.grade_en || '').trim());

    const dutyName = dutyMatch?.label || dutyRaw;
    const dutyEn = dutyMatch?.value || String(me.duty_en || '').trim() || '';
    const gradeName = gradeMatch?.label || gradeRaw;
    const gradeEn = gradeMatch?.value || String(me.grade_en || '').trim() || '';
    // 직책 우선, 없으면 직급
    const useDuty = !!dutyName;

    return {
      ...base,
      userName: String(me.name || activeUser.name || '').trim(),
      userNameEn: pickNameEn(me) || activeUser.nameEn || '',
      email: String(me.email || activeUser.email || '').trim(),
      emailEn: String(me.email || activeUser.email || '').trim(),
      deptHead,
      deptHeadEn,
      deptName,
      deptNameEn,
      dutyName: useDuty ? dutyName : '',
      dutyEn: useDuty ? dutyEn : '',
      gradeName: useDuty ? '' : gradeName,
      gradeEn: useDuty ? '' : gradeEn,
      title: useDuty ? dutyName : gradeName,
      titleEn: useDuty ? dutyEn : gradeEn,
      // mobile / phone / 추가자격 등은 User에 없음 → 직접 입력
    };
  };

  const openNewApplication = async (opts?: {
    me?: any;
    unitList?: UnitItem[];
    dutyList?: MasterCode[];
    gradeList?: MasterCode[];
    addrList?: any[];
  }) => {
    if (!canEdit) return alertNoEditPermission();
    let me = opts?.me ?? profile;
    // 동기화 직전 /api/auth/me 재조회 — name_en 등 최신 인사값 반영
    if (!opts?.me) {
      try {
        const meRes = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: 'no-store' });
        if (meRes.ok) {
          me = await meRes.json();
          setProfile(me);
          setLoginUser((prev) => ({
            ...prev,
            name: me.name || prev.name,
            nameEn: pickNameEn(me) || prev.nameEn,
            email: me.email || prev.email,
            deptName: me.unit?.unit_name || prev.deptName,
          }));
        }
      } catch {
        /* keep cached profile */
      }
    }

    const synced = applyProfileSync(
      me,
      opts?.unitList ?? units,
      opts?.dutyList ?? duties,
      opts?.gradeList ?? grades,
      opts?.addrList ?? addresses
    );
    setForm(synced);
    setFormMode('NEW');
    setBackupForm(null);
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const initPortalData = async () => {
    try {
      setLoading(true);
      const ts = Date.now();
      
      const meRes = await fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' });
      let sessionEmail = '';
      let mePayload: any = null;
      
      if (meRes.ok) {
        mePayload = await meRes.json();
        setProfile(mePayload);
        const resolvedDept =
          mePayload.unit?.unit_name ||
          mePayload.dept_name ||
          mePayload.unit_name ||
          '소속 미지정';
        setLoginUser({
          name: mePayload.name || '',
          nameEn: pickNameEn(mePayload),
          email: mePayload.email || '',
          deptName: resolvedDept
        });
        sessionEmail = mePayload.email;
      }

      if (!sessionEmail && !currentUser?.email) {
        setLoading(false);
        return;
      }

      const [configRes, unitsRes, masterRes, historyRes, addrMasterRes, qualRes, settingsRes, ifRes] = await Promise.all([
        fetch(`/api/admin/config?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/my-page?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/master/addresses?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/master/qualifications?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/master/settings?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);

      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/businesscard/my-page'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }

      let nextDuties: MasterCode[] = [];
      let nextGrades: MasterCode[] = [];
      if (configRes.ok && masterRes.ok) {
        const config = await configRes.json();
        const allMaster = await masterRes.json();
        const dutyGroup = allMaster.find((g: any) => g.id === config.job_duty_group);
        const gradeGroup = allMaster.find((g: any) => g.id === config.job_grade_group);
        if (dutyGroup?.codes) {
          nextDuties = dutyGroup.codes;
          setDuties(dutyGroup.codes);
        }
        if (gradeGroup?.codes) {
          nextGrades = gradeGroup.codes;
          setGrades(gradeGroup.codes);
        }
      }

      let nextUnits: UnitItem[] = [];
      if (unitsRes.ok) {
        nextUnits = await unitsRes.json();
        setUnits(nextUnits);
      }
      if (historyRes.ok) setHistory(await historyRes.json());

      let nextAddrs: any[] = [];
      if (addrMasterRes.ok) {
        const addrData = await addrMasterRes.json();
        nextAddrs = addrData.filter((a: any) => a.isActive);
        setAddresses(nextAddrs);
      }

      if (qualRes.ok) {
        const qualData = await qualRes.json();
        setQualifications(qualData.filter((q: any) => q.isActive));
      }

      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        const n = Number(settings?.sheetsPerPack);
        if (Number.isFinite(n) && n > 0) setSheetsPerPack(Math.round(n));
      }
      
    } catch (error) {
      console.error("데이터 인프라 동기화 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initPortalData();
  }, [currentUser]);

  useEffect(() => {
    if (formMode !== 'VIEW') {
      const titleKo = form.dutyName || form.gradeName || '';
      const titleEn = form.dutyEn || form.gradeEn || '';
      setForm(p => (p.title === titleKo && p.titleEn === titleEn ? p : { ...p, title: titleKo, titleEn }));
    }
  }, [form.dutyName, form.gradeName, form.dutyEn, form.gradeEn, formMode]);

  const roleSelectValue = form.dutyName || form.gradeName || '';

  const handleRoleSelect = (value: string) => {
    if (!value) {
      setForm((p) => ({
        ...p,
        dutyName: '',
        dutyEn: '',
        gradeName: '',
        gradeEn: '',
        title: '',
        titleEn: '',
      }));
      return;
    }
    const duty = duties.find((d) => d.label === value);
    if (duty) {
      setForm((p) => ({
        ...p,
        dutyName: duty.label,
        dutyEn: duty.value || '',
        gradeName: '',
        gradeEn: '',
        title: duty.label,
        titleEn: duty.value || '',
      }));
      return;
    }
    const grade = grades.find((g) => g.label === value);
    if (grade) {
      setForm((p) => ({
        ...p,
        dutyName: '',
        dutyEn: '',
        gradeName: grade.label,
        gradeEn: grade.value || '',
        title: grade.label,
        titleEn: grade.value || '',
      }));
    }
  };

  const handleResetToNew = () => {
    if (!canEdit) return alertNoEditPermission();
    openNewApplication();
  };

  const handleDetailView = (row: RequestHistory) => {
    const matchedDuty = duties.find(d => row.title.includes(d.label))?.label || '';
    const matchedGrade = grades.find(g => row.title.includes(g.label))?.label || '';
    const useDuty = !!matchedDuty;

    const parsedQuals = row.additionalKo
      ? row.additionalKo.split(',').map(s => s.trim()).filter(Boolean).map((ko) => {
          const inMaster = qualifications.some((q) => q.nameKo === ko);
          return inMaster ? ko : toManualQualValue(ko);
        })
      : [];
    const parsedEnList = row.additionalEn
      ? row.additionalEn.split(',').map(s => s.trim())
      : [];
    const parsedQualsEn = parsedQuals.map((q, i) => {
      const masterNames = qualifications.map((x) => x.nameKo);
      if (isManualQualValue(q, masterNames)) {
        // 영문 쪽 "(수동 기재)" 접미 제거
        return String(parsedEnList[i] || '').replace(/\s*\(수동 기재\)\s*$/, '').trim();
      }
      return qualifications.find((x) => x.nameKo === q)?.nameEn || parsedEnList[i] || '';
    });

    const targetData = {
      id: row.id,
      userName: row.userName,
      userNameEn: row.userNameEn || '',
      deptHead: row.deptHead || '',
      deptHeadEn: row.deptHeadEn || '',
      deptName: row.deptName,
      deptNameEn: row.deptNameEn || '',
      dutyName: useDuty ? matchedDuty : '',
      dutyEn: useDuty ? (duties.find(d => d.label === matchedDuty)?.value || '') : '',
      gradeName: useDuty ? '' : matchedGrade,
      gradeEn: useDuty ? '' : (grades.find(g => g.label === matchedGrade)?.value || ''),
      title: row.title,
      titleEn: row.titleEn || '',
      additionalQuals: parsedQuals,
      additionalQualsEn: parsedQualsEn,
      mobile: row.mobile || '',
      mobileEn: row.mobileEn || '',
      phone: row.phone || '',
      phoneEn: row.phoneEn || '',
      fax: row.fax || '',
      faxEn: row.faxEn || '',
      email: row.email || '',
      emailEn: row.emailEn || '',
      addressId: row.addressId || '',
      zipCode: row.zipCode || '',
      addressKo: row.addressKo || '',
      addressEn: row.addressEn || '',
      adminStatus: row.adminStatus,
      isModifiedByAdmin: row.isModifiedByAdmin || false, 
      adminMemo: row.adminMemo || '',
      adminModifierName: row.adminModifierName || '',
      adminModifiedAt: row.adminModifiedAt || '',
      quantity: row.quantity || 1
    };

    setForm(targetData);
    setFormMode('VIEW');
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEnableEdit = () => {
    if (!canEdit) return alertNoEditPermission();
    setBackupForm({ ...form });
    setFormMode('EDIT');
  };

  const handleCancelEdit = () => {
    if (backupForm) setForm(backupForm);
    setFormMode('VIEW');
  };

  const handleHeadChange = (unitName: string) => {
    const selected = units.find((u) => u.unit_name === unitName);
    const childNames = new Set(
      selected ? units.filter((u) => u.parent_id === selected.id).map((u) => u.unit_name) : []
    );
    setForm((p) => {
      const keepCenter = !!p.deptName && childNames.has(p.deptName);
      return {
        ...p,
        deptHead: unitName,
        deptHeadEn: selected?.unit_name_en || '',
        deptName: keepCenter ? p.deptName : '',
        deptNameEn: keepCenter ? p.deptNameEn : '',
      };
    });
  };

  const handleSubChange = (unitName: string) => {
    const selected = units.find(u => u.unit_name === unitName);
    if (!selected) {
      setForm(p => ({ ...p, deptName: '', deptNameEn: '' }));
      return;
    }
    let headKo = form.deptHead;
    let headEn = form.deptHeadEn;
    if (selected.parent_id) {
      const parent = units.find(u => u.id === selected.parent_id);
      if (parent) {
        headKo = parent.unit_name;
        headEn = parent.unit_name_en || '';
      }
    }
    setForm(p => ({ ...p, deptName: selected.unit_name, deptNameEn: selected.unit_name_en || '', deptHead: headKo, deptHeadEn: headEn }));
  };

  const handleAddressChange = (addrId: string) => {
    const target = addresses.find(a => a.id === addrId);
    if (target) {
      setForm(p => ({ 
        ...p, 
        addressId: addrId, 
        zipCode: target.zipCode, 
        addressKo: target.addressKo, 
        addressEn: target.addressEn,
        fax: target.fax,
        faxEn: target.faxEn
      }));
    }
  };

  const formatEnNumber = (type: 'mobile' | 'phone' | 'fax', value: string) => {
    const clean = value.replace(/[^0-9]/g, '');
    if (!clean) return '';
    if (type === 'mobile') {
      return clean.startsWith('010') && clean.length === 11 ? `+82-10-${clean.substring(3, 7)}-${clean.substring(7)}` : value;
    } else {
      if (clean.startsWith('02')) {
        const rest = clean.substring(2);
        if (rest.length === 7 || rest.length === 8) {
          const mid = rest.length === 8 ? rest.substring(0, 4) : rest.substring(0, 3);
          return `+82-2-${mid}-${rest.substring(rest.length - 4)}`;
        }
      } else if (clean.startsWith('0')) {
        const areaCode = clean.substring(1, 3);
        const rest = clean.substring(3);
        if (rest.length === 7 || rest.length === 8) {
          const mid = rest.length === 8 ? rest.substring(0, 4) : rest.substring(0, 3);
          return `+82-${areaCode}-${mid}-${rest.substring(rest.length - 4)}`;
        }
      }
      return value;
    }
  };

  const handleTextChange = (field: string, value: string) => {
    setForm(prev => {
      const updated = { ...prev, [field]: value };
      // 성명/영문성명은 인사 연동 독립 필드 — 국문 수정 시 영문을 지우지 않음
      if (field === 'email') updated.emailEn = value;
      if (field === 'mobile') updated.mobileEn = formatEnNumber('mobile', value);
      if (field === 'phone') updated.phoneEn = formatEnNumber('phone', value);
      return updated;
    });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return alertNoEditPermission();
    if (!form.userName || !form.deptHead || !form.title || !form.mobile || !form.phone) {
      alert('⚠️ 필수 필드 항목들이 누락되었습니다.');
      return;
    }

    const isEdit = formMode === 'EDIT';

    const masterNames = qualifications.map((q) => q.nameKo);
    const paired = form.additionalQuals
      .map((q, i) => {
        const ko = qualDisplayKo(q).trim();
        if (!ko) return null;
        const en = isManualQualValue(q, masterNames)
          ? String(form.additionalQualsEn[i] || '').trim()
          : qualifications.find((x) => x.nameKo === ko)?.nameEn || '';
        return { ko, en };
      })
      .filter(Boolean) as Array<{ ko: string; en: string }>;
    const finalKo = paired.map((p) => p.ko).join(', ');
    const finalEn = paired.map((p) => p.en).filter(Boolean).join(', ');

    const payload = {
      id: isEdit ? form.id : undefined,
      userName: form.userName, userNameEn: form.userNameEn,
      deptName: form.deptName, deptNameEn: form.deptNameEn,
      deptHead: form.deptHead, deptHeadEn: form.deptHeadEn,
      title: form.title, titleEn: form.titleEn,
      additionalKo: finalKo, additionalEn: finalEn,
      mobile: form.mobile, mobileEn: form.mobileEn,
      phone: form.phone, phoneEn: form.phoneEn,
      fax: form.fax, faxEn: form.faxEn,
      addressId: form.addressId, zipCode: form.zipCode, addressKo: form.addressKo, addressEn: form.addressEn,
      email: form.email, emailEn: form.emailEn,
      quantity: form.quantity
    };

    try {
      const res = await fetch('/api/asset/businesscard/my-page', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert(isEdit ? '💾 명함 정보 변경사항이 정상적으로 저장되었습니다.' : '🚀 신규 명함 발급 신청이 완료되었습니다.');
        setFormMode('NEW');
        setBackupForm(null);
        setIsFormOpen(false);
        initPortalData(); 
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || err.error || '처리 중 오류가 발생했습니다.');
      }
    } catch (err) {
      alert('데이터베이스 트랜잭션 처리 중 오류가 발생했습니다.');
    }
  };

  const handleCancelRequest = async (id: string, postNo: string) => {
    if (!canEdit) return alert('편집 권한이 없습니다.');
    if (!confirm(`⚠️ [${postNo}] 명함 발급 신청을 취소하시겠습니까?\n취소 후에는 복구할 수 없습니다.`)) return;
    try {
      const res = await fetch(`/api/asset/businesscard/my-page?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert("🚀 신청이 정상적으로 취소되었습니다.");
        setFormMode('NEW');
        setBackupForm(null);
        setIsFormOpen(false);
        initPortalData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || err.error || '신청 취소에 실패했습니다.');
      }
    } catch (err) {
      alert("서버 통신 오류가 발생했습니다.");
    }
  };

  // KST 접속 연도는 내역이 없어도 목록에 포함
  const currentYear = String(getKSTNowYearMonth().year);
  const availableYears = useMemo(
    () =>
      Array.from(new Set([currentYear, ...history.map((h) => h.applyDate?.substring(0, 4) || '')]))
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a)),
    [history, currentYear]
  );
  const availableMonths = useMemo(() => {
    const inYear = history.filter(
      (h) => yearFilter === 'ALL' || h.applyDate?.startsWith(yearFilter)
    );
    return Array.from(new Set(inYear.map((h) => h.applyDate?.substring(5, 7) || '')))
      .filter(Boolean)
      .sort();
  }, [history, yearFilter]);

  // 🚀 조건부 필터 적용
  const filteredHistory = history.filter(h => {
    const matchYear = yearFilter === 'ALL' || h.applyDate?.startsWith(yearFilter);
    const matchMonth = monthFilter === 'ALL' || h.applyDate?.substring(5, 7) === monthFilter;
    return matchYear && matchMonth;
  });

  const handleExportExcel = () => {
    if (filteredHistory.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = filteredHistory.map((row, idx) => ({
      NO: filteredHistory.length - idx,
      신청일자: row.applyDate || '',
      관리번호: row.postNumber || '',
      본부: row.deptHead || '',
      센터: row.deptName || '',
      이름: row.userName || '',
      수량통: row.quantity || 1,
      관리자의견: row.adminMemo || '',
      공정상태: row.adminStatus || '',
      신청주체: row.applicantType || '본인',
      처리일자: row.processDate || '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명함신청내역');
    const monthStr = monthFilter !== 'ALL' ? `_${monthFilter}월` : '';
    XLSX.writeFile(
      wb,
      `명함_나의신청내역_${yearFilter === 'ALL' ? '전체' : yearFilter}년${monthStr}.xlsx`
    );
  };

  // 🚀 필터 변경 시 페이지 리셋
  useEffect(() => {
    setHistoryPage(1);
  }, [yearFilter, monthFilter]);

  useEffect(() => {
    if (monthFilter === 'ALL') return;
    if (!availableMonths.includes(monthFilter)) setMonthFilter('ALL');
  }, [availableMonths, monthFilter]);

  const totalHistoryPages = Math.ceil(filteredHistory.length / itemsPerPage) || 1;
  const paginatedHistory = filteredHistory.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage);
  
  const isReadOnly = formMode === 'VIEW';
  const hqUnits = useMemo(() => {
    const hqs = units.filter((u) => isBusinessCardHqUnit(u) || !u.parent_id);
    if (form.deptHead && !hqs.some((u) => u.unit_name === form.deptHead)) {
      const extra = units.find((u) => u.unit_name === form.deptHead);
      if (extra) return [...hqs, extra];
    }
    return hqs;
  }, [units, form.deptHead]);
  const selectedHeadUnit = units.find((u) => u.unit_name === form.deptHead);
  const childCenterUnits = useMemo(() => {
    const children = selectedHeadUnit
      ? units.filter((u) => u.parent_id === selectedHeadUnit.id && !isBusinessCardHqUnit(u))
      : [];
    if (form.deptName && !children.some((u) => u.unit_name === form.deptName)) {
      const extra = units.find((u) => u.unit_name === form.deptName);
      if (extra) return [...children, extra];
    }
    return children;
  }, [units, selectedHeadUnit, form.deptName]);
  /** 인사 연동 칸(수정 가능하되 회색 바탕) */
  const syncedFieldCls =
    'w-full p-2 border border-slate-200 rounded-lg text-xs font-bold bg-slate-50 text-slate-800 disabled:opacity-60 outline-slate-400';
  /** 직접 입력 칸(하늘색 바탕) */
  const manualFieldCls =
    'w-full p-2 border border-sky-200 rounded-lg text-xs font-bold bg-sky-50 text-slate-800 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200 outline-sky-400';

  if (loading) return <LoadingState />;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
 
      {/* register 배너 규격 · catalog 색상(blue→indigo) */}
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-sky-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-indigo-900/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-2.5">
              BUSINESS CARD PROCESS CENTER
            </h3>
            <h1 className="text-2xl tracking-tight leading-none">
              <span className="text-blue-200 font-normal">{activeUser?.name || '임직원'} 님</span>
              <span className="text-white/30 font-normal mx-2.5">|</span>
              <span className="text-white font-extrabold">명함 발급 신청 허브</span>
            </h1>
            <p className="text-white/70 text-xs mt-3 leading-relaxed max-w-xl">
              Hub 인사정보(성명·소속·직책·직급·이메일)를 불러와 명함 신청에 맞춥니다.
            </p>
          </div>
          <div className="shrink-0 self-start md:self-end">
            {!isFormOpen ? (
              <button
                type="button"
                disabled={!canEdit}
                title={!canEdit ? '편집 권한 필요' : undefined}
                onClick={() => openNewApplication()}
                className={`group inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl font-black text-[12px] transition-all duration-200 ${
                  canEdit
                    ? 'bg-white text-indigo-700 shadow-lg shadow-indigo-950/25 ring-1 ring-white/60 hover:bg-indigo-50 hover:text-indigo-800 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0'
                    : DISABLED_ACTION_BTN
                }`}
              >
                <span className="text-indigo-500 group-hover:text-indigo-700 transition-colors">+</span>
                명함신청하기
              </button>
            ) : formMode !== 'NEW' ? (
              <button
                type="button"
                disabled={!canEdit}
                title={!canEdit ? '편집 권한 필요' : undefined}
                onClick={handleResetToNew}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[10px] font-black tracking-tight border shadow-sm transition-colors ${
                  canEdit
                    ? 'bg-white/15 border-white/25 text-white hover:bg-white/25 hover:border-white/40'
                    : DISABLED_ACTION_BTN
                }`}
              >
                <span>+</span>
                <span>신규 신청 / 정보 동기화</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {isFormOpen && (
      <form onSubmit={handleFormSubmit} className="bg-white border border-slate-200 rounded-[2.5rem] p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-100">
          <p className="text-[11px] font-black text-slate-600">
            현재 모드:{' '}
            <span
              className={
                formMode === 'NEW'
                  ? 'text-indigo-600'
                  : formMode === 'VIEW'
                    ? 'text-slate-800'
                    : 'text-amber-600'
              }
            >
              {formMode === 'NEW' && '신규 발급 신청 (인사정보 동기화됨)'}
              {formMode === 'VIEW' && '신청 내역 상세 보기 (읽기 전용)'}
              {formMode === 'EDIT' && '신청 내역 정보 수정 중'}
            </span>
          </p>
          <div className="flex items-center gap-2">
            {formMode === 'NEW' && (
              <button
                type="button"
                onClick={() => openNewApplication()}
                className="text-[10px] font-black px-3 py-1.5 rounded-lg bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-600 hover:text-white transition-colors"
              >
                🔄 인사정보 다시 동기화
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                setFormMode('NEW');
                setBackupForm(null);
              }}
              className="text-[10px] font-black px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 transition-colors"
            >
              작성창 접기 ▲
            </button>
          </div>
        </div>
        
        {formMode === 'VIEW' && form.adminStatus === '반려' && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5">⛔</span>
            <div>
              <p className="text-rose-900 text-xs font-black mb-1">신청이 반려되었습니다. 사유를 확인한 뒤 수정하여 다시 신청해 주세요.</p>
              <p className="text-[11px] font-bold text-rose-700/90">반려 사유: {form.adminMemo || '-'}</p>
            </div>
          </div>
        )}

        {/* 관리자 직접 수정 이력 감지 배너 */}
        {formMode === 'VIEW' && form.isModifiedByAdmin && form.adminStatus !== '반려' && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5">⚠️</span>
            <div>
              <p className="text-amber-900 text-xs font-black mb-1">관리자 검수 과정에서 정보가 일부 수정되었습니다.</p>
              <p className="text-[11px] font-bold text-amber-700/90">변경 사유: {form.adminMemo}</p>
            </div>
          </div>
        )}

        {/* ── 1. 국문 정보 섹션 ── */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b-[3px] border-slate-600 pb-1.5">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">1. 국문 정보 (Korean Info)</h4>
            <p className="text-[9px] font-bold text-slate-400">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-200 border border-slate-300 align-middle mr-1" />
              회색 = 인사 연동
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-50 border border-sky-200 align-middle mr-1" />
              하늘색 = 직접 입력
            </p>
          </div>
          <div className="space-y-3">
            {/* 1행: 이름 > 본부 > 소속(센터) > 직책/직급 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">성명 *</label>
                <input type="text" required disabled={isReadOnly} value={form.userName} onChange={(e) => handleTextChange('userName', e.target.value)} className={syncedFieldCls} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">본부 (상위 조직) *</label>
                <select required disabled={isReadOnly} value={form.deptHead} onChange={(e) => handleHeadChange(e.target.value)} className={syncedFieldCls}>
                  <option value="">선택</option>
                  {hqUnits.map(u => <option key={`h-${u.id}`} value={u.unit_name}>{u.unit_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">센터 (하위 조직)</label>
                <select disabled={isReadOnly || !form.deptHead} value={form.deptName} onChange={(e) => handleSubChange(e.target.value)} className={syncedFieldCls}>
                  <option value="">(본부의 하위 센터만 선택)</option>
                  {childCenterUnits.map(u => <option key={`s-${u.id}`} value={u.unit_name}>{u.unit_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">직책 / 직급 *</label>
                <select
                  required
                  disabled={isReadOnly}
                  value={roleSelectValue}
                  onChange={(e) => handleRoleSelect(e.target.value)}
                  className={syncedFieldCls}
                >
                  <option value="">선택</option>
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
                <p className="text-[9px] text-slate-400 font-bold mt-1">직책 우선 · 없으면 직급 연동</p>
              </div>
            </div>

            {/* 2행: 추가사항(자격증) — 직접 입력 */}
            <div className="space-y-2 border border-sky-100 rounded-xl p-3 bg-sky-50/40">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-black text-blue-600">추가사항 (자격증 선택)</label>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        additionalQuals: [...p.additionalQuals, ''],
                        additionalQualsEn: [...(p.additionalQualsEn || []), ''],
                      }))
                    }
                    className="px-2.5 py-1 bg-white hover:bg-sky-100 text-sky-800 text-[10px] font-black rounded border border-sky-200 transition-colors"
                  >
                    + 자격증 추가
                  </button>
                )}
              </div>
              {form.additionalQuals.length === 0 && (
                <p className="text-[11px] text-slate-400 italic py-1">추가할 자격사항이 없습니다.</p>
              )}
              {form.additionalQuals.map((qualKo, idx) => {
                const masterNames = qualifications.map((q) => q.nameKo);
                const manualMode = isManualQualValue(qualKo, masterNames);
                const selectValue = manualMode ? MANUAL_QUAL_OPTION : qualKo;
                const manualText = manualMode ? qualDisplayKo(qualKo) : '';
                return (
                <div key={idx} className="flex gap-2 items-center animate-fade-in">
                  {manualMode ? (
                    <input
                      type="text"
                      disabled={isReadOnly}
                      autoFocus={!manualText}
                      value={manualText}
                      onChange={(e) => {
                        const newQuals = [...form.additionalQuals];
                        newQuals[idx] = toManualQualValue(e.target.value);
                        setForm(p => ({ ...p, additionalQuals: newQuals }));
                      }}
                      placeholder="자격증·추가사항을 직접 입력하세요 (목록에 없을 때)"
                      className={`flex-1 min-w-0 ${manualFieldCls}`}
                    />
                  ) : (
                    <select
                      disabled={isReadOnly}
                      value={selectValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        const newQuals = [...form.additionalQuals];
                        const newEns = [...(form.additionalQualsEn || [])];
                        while (newEns.length < newQuals.length) newEns.push('');
                        if (v === MANUAL_QUAL_OPTION) {
                          newQuals[idx] = toManualQualValue('');
                          newEns[idx] = '';
                        } else {
                          newQuals[idx] = v;
                          newEns[idx] = qualifications.find((q) => q.nameKo === v)?.nameEn || '';
                        }
                        setForm(p => ({ ...p, additionalQuals: newQuals, additionalQualsEn: newEns }));
                      }}
                      className={`flex-1 min-w-0 ${manualFieldCls}`}
                    >
                      <option value="">(마스터 표준 자격증 선택)</option>
                      {qualifications.map(q => (
                        <option
                          key={q.id}
                          value={q.nameKo}
                          disabled={form.additionalQuals.some((x, i) => i !== idx && x === q.nameKo)}
                        >
                          {q.nameKo}
                        </option>
                      ))}
                      <option value={MANUAL_QUAL_OPTION}>상단 리스트에 없을때 수동 기재</option>
                    </select>
                  )}
                  {!isReadOnly && (
                    <>
                      {manualMode && (
                        <button
                          type="button"
                          title="목록 선택으로 돌아가기"
                          onClick={() => {
                            const newQuals = [...form.additionalQuals];
                            const newEns = [...(form.additionalQualsEn || [])];
                            while (newEns.length < newQuals.length) newEns.push('');
                            newQuals[idx] = '';
                            newEns[idx] = '';
                            setForm(p => ({ ...p, additionalQuals: newQuals, additionalQualsEn: newEns }));
                          }}
                          className="px-2.5 py-2 bg-slate-100 text-slate-600 rounded-lg font-black text-[10px] hover:bg-slate-200 border border-slate-200 shrink-0 whitespace-nowrap"
                        >
                          목록
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setForm(p => ({
                            ...p,
                            additionalQuals: p.additionalQuals.filter((_, i) => i !== idx),
                            additionalQualsEn: (p.additionalQualsEn || []).filter((_, i) => i !== idx),
                          }));
                        }}
                        className="px-3 py-2 bg-rose-50 text-rose-600 rounded-lg font-black text-xs hover:bg-rose-100 border border-rose-200 shrink-0"
                      >
                        삭제
                      </button>
                    </>
                  )}
                </div>
                );
              })}
            </div>

            {/* 3행: 주소지 · 우편번호 · 국문주소 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">주소지 선택 *</label>
                <select disabled={isReadOnly} value={form.addressId} onChange={(e) => handleAddressChange(e.target.value)} className={manualFieldCls}>
                  {addresses.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">우편번호(주소지 선택 연동)🔒</label>
                <input type="text" readOnly value={form.zipCode} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 mb-1">국문 주소(주소지 선택 연동)🔒</label>
                <input type="text" readOnly value={form.addressKo} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
            </div>

            {/* 4행: 휴대전화 · 내선 · 팩스 · 이메일 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">휴대전화 *</label>
                <input type="text" required disabled={isReadOnly} value={form.mobile} onChange={(e) => handleTextChange('mobile', e.target.value)} placeholder="ex. 010-0000-0000" className={manualFieldCls} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">전화번호 (내선) *</label>
                <input type="text" required disabled={isReadOnly} value={form.phone} onChange={(e) => handleTextChange('phone', e.target.value)} placeholder="ex. 02-6973-0000" className={manualFieldCls} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">팩스 번호(주소지 선택 연동)🔒</label>
                <input type="text" readOnly value={form.fax} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">이메일 *</label>
                <input type="email" required disabled={isReadOnly} value={form.email} onChange={(e) => handleTextChange('email', e.target.value)} className={syncedFieldCls} />
              </div>
            </div>
          </div>
        </div>

        {/* ── 2. 영문 정보 섹션 ── */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b-[3px] border-slate-600 pb-1.5 flex items-center justify-between">
            <span>2. 영문 정보 (English Info)</span>
            <span className="text-[9px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-bold">국문 연동 · 국제번호 변환 ⚡</span>
          </h4>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">영문 성명</label>
                <input type="text" disabled={isReadOnly} value={form.userNameEn} onChange={(e) => setForm({ ...form, userNameEn: e.target.value })} className={syncedFieldCls} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 본부 (상위 조직)🔒</label>
                <input type="text" readOnly value={form.deptHeadEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 센터 (하위 조직)🔒</label>
                <input type="text" readOnly value={form.deptNameEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 직책/직급🔒</label>
                <input type="text" readOnly value={form.titleEn || form.dutyEn || form.gradeEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" />
              </div>
            </div>

            <div className="space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/40">
              <label className="block text-[10px] font-black text-blue-600">
                영문 추가사항{' '}
                <span className="font-bold">(마스터는 자동 · 수동 기재는 직접 입력)</span>
              </label>
              {form.additionalQuals.length === 0 && (
                <p className="text-[11px] text-slate-400 italic py-1">추가된 영문 자격사항이 없습니다.</p>
              )}
              {form.additionalQuals.map((qualKo, idx) => {
                const masterNames = qualifications.map((q) => q.nameKo);
                const manualMode = isManualQualValue(qualKo, masterNames);
                const masterEn = qualifications.find(q => q.nameKo === qualKo)?.nameEn || '';
                const enValue = manualMode
                  ? String(form.additionalQualsEn?.[idx] || '')
                  : masterEn;
                return (
                  <div key={idx} className="flex gap-2 animate-fade-in">
                    <input
                      type="text"
                      readOnly={!manualMode || isReadOnly}
                      disabled={!manualMode ? true : isReadOnly}
                      value={enValue}
                      onChange={(e) => {
                        if (!manualMode) return;
                        const newEns = [...(form.additionalQualsEn || [])];
                        while (newEns.length < form.additionalQuals.length) newEns.push('');
                        newEns[idx] = e.target.value;
                        setForm((p) => ({ ...p, additionalQualsEn: newEns }));
                      }}
                      placeholder={
                        manualMode
                          ? '영문 자격증명을 직접 입력하세요'
                          : '(국문 마스터 선택 시 자동 연동)'
                      }
                      className={`w-full p-2 rounded-lg text-xs font-bold ${
                        manualMode && !isReadOnly
                          ? 'bg-sky-50 text-slate-800 border border-sky-200 outline-sky-400'
                          : 'bg-slate-50 text-slate-500 border border-slate-100 cursor-not-allowed'
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div className="md:col-span-4">
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 주소🔒</label>
                <input type="text" readOnly value={form.addressEn} className="w-full p-2 bg-slate-50 text-slate-400 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 휴대전화🔒</label>
                <input type="text" readOnly value={form.mobileEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 전화🔒</label>
                <input type="text" readOnly value={form.phoneEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 팩스🔒</label>
                <input type="text" readOnly value={form.faxEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 이메일🔒</label>
                <input type="text" readOnly value={form.emailEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
              </div>
            </div>
          </div>
        </div>

        {/* 발주: 수량 + 신청 버튼 나란히 */}
        <div className="pt-3 mt-1 border-t-[3px] border-slate-600">
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <div
              className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/60 shrink-0 ${
                isReadOnly ? 'opacity-70' : ''
              }`}
            >
              <p className="text-[10px] font-black text-indigo-900 whitespace-nowrap">
                발주 수량
                <span className="ml-1.5 font-bold text-indigo-400">1통={sheetsPerPack}장</span>
              </p>
              <div className="flex items-center gap-1 bg-white px-1 py-0.5 rounded-lg border border-indigo-200">
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => setForm({ ...form, quantity: Math.max(1, (form.quantity || 1) - 1) })}
                  className="w-7 h-7 flex items-center justify-center bg-slate-50 border border-slate-200 text-slate-700 text-sm font-black rounded-md hover:bg-indigo-100 hover:border-indigo-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  −
                </button>
                <span className="w-7 text-center font-black text-indigo-700 text-sm tabular-nums">
                  {form.quantity || 1}
                </span>
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => setForm({ ...form, quantity: (form.quantity || 1) + 1 })}
                  className="w-7 h-7 flex items-center justify-center bg-slate-50 border border-slate-200 text-slate-700 text-sm font-black rounded-md hover:bg-indigo-100 hover:border-indigo-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  +
                </button>
                <span className="text-[10px] font-black text-indigo-700 pl-0.5 pr-1">통</span>
              </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
              {formMode === 'NEW' && (
                <button
                  type="submit"
                  disabled={!canEdit}
                  title={!canEdit ? '편집 권한 필요' : undefined}
                  className={`w-full py-2.5 font-black text-[11px] rounded-lg shadow-sm transition-all tracking-widest uppercase ${
                    canEdit
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  🚀 명함 원본 데이터 발주 신청
                </button>
              )}

              {formMode === 'VIEW' && (form.adminStatus === '대기중' || form.adminStatus === '반려') && (
                <button
                  type="button"
                  disabled={!canEdit}
                  title={!canEdit ? '편집 권한 필요' : undefined}
                  onClick={handleEnableEdit}
                  className={`w-full py-2.5 font-black text-[11px] rounded-lg shadow-sm transition-colors tracking-widest uppercase ${
                    canEdit
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : DISABLED_ACTION_BTN
                  }`}
                >
                  📝 신청 정보 수정하기
                </button>
              )}

              {formMode === 'VIEW' && form.adminStatus !== '대기중' && form.adminStatus !== '반려' && (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 bg-slate-200 text-slate-500 font-black text-[11px] rounded-lg shadow-inner cursor-not-allowed tracking-widest uppercase"
                >
                  정보 확인
                </button>
              )}

              {formMode === 'EDIT' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="py-2.5 bg-slate-200 text-slate-700 font-black text-[11px] rounded-lg shadow-sm hover:bg-slate-300 transition-colors tracking-widest uppercase"
                  >
                    ❌ 변경 취소하기
                  </button>
                  <button
                    type="submit"
                    disabled={!canEdit}
                    title={!canEdit ? '편집 권한 필요' : undefined}
                    className={`py-2.5 font-black text-[11px] rounded-lg shadow-sm transition-colors tracking-widest uppercase ${
                      canEdit
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : DISABLED_ACTION_BTN
                    }`}
                  >
                    💾 변경사항 저장하기
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </form>
      )}

      {/* 내역 보관함 테이블 — supplies/dept 동일 헤더·표 스타일 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">나의 명함 신청 내역 및 실시간 공정 보관함</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
              {filteredHistory.length}건
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 hidden group-hover/filter:block whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg"
              >
                연도 → 월 · 연계필터
              </span>
              <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
              <select
                value={yearFilter}
                onChange={(e) => {
                  setYearFilter(e.target.value);
                  setMonthFilter('ALL');
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
              <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>{parseInt(m)}월</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
            >
              화면 목록 EXCEL 다운로드
            </button>
            <button
              type="button"
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className="text-[11px] font-black bg-white text-slate-900 border border-slate-200 rounded-lg px-4 py-1.5 hover:bg-slate-100 transition-colors shadow-sm shrink-0"
            >
              {isHistoryOpen ? '보관함 접기 ▲' : '보관함 펼치기 ▼'}
            </button>
          </div>
        </div>

        {isHistoryOpen && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[1200px]">
                <colgroup>
                  <col className="w-[56px]" />
                  <col className="w-[110px]" />
                  <col className="w-[140px]" />
                  <col className="w-[140px]" />
                  <col className="w-[88px]" />
                  <col className="w-[120px]" />
                  <col className="w-[72px]" />
                  <col className="w-[100px]" />
                  <col className="w-[100px]" />
                  <col className="w-[110px]" />
                  <col className="w-[110px]" />
                </colgroup>
                <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                  <tr>
                    <th className="h-12 px-2 text-center">NO</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">신청일자</th>
                    <th className="h-12 px-2">본부 (상위 조직)</th>
                    <th className="h-12 px-2">센터 (하위 조직)</th>
                    <th className="h-12 px-2">이름</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">신청내역</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">수량(통)</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">관리자의견</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">공정상태</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">처리일자</th>
                    <th className="h-12 px-2 text-center whitespace-nowrap">상태변경</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                  {paginatedHistory.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="p-16 text-center text-slate-400 text-xs">
                        조건에 일치하는 신청 내역이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    paginatedHistory.map((row, index) => {
                      const rowNo = filteredHistory.length - ((historyPage - 1) * itemsPerPage + index);
                      const isModifiable = row.adminStatus === '대기중' || row.adminStatus === '반려';
                      const statusClass =
                        row.adminStatus === '지급완료'
                          ? 'text-violet-700'
                          : row.adminStatus === '발주완료'
                            ? 'text-emerald-600'
                            : row.adminStatus === '접수완료'
                              ? 'text-blue-600'
                              : row.adminStatus === '반려'
                                ? 'text-red-600'
                                : 'text-orange-600';

                      return (
                        <tr key={row.id} className="hover:bg-slate-50/50 h-12 transition-colors">
                          <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                          <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">{row.applyDate}</td>
                          <td className="px-2 truncate" title={row.deptHead || ''}>{row.deptHead || '-'}</td>
                          <td className="px-2 truncate" title={row.deptName || ''}>{row.deptName || <span className="text-slate-300">-</span>}</td>
                          <td className="px-2 text-slate-800 truncate">{row.userName}</td>
                          <td className="px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDetailView(row)}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-lg shadow-sm transition-colors ${
                                isModifiable
                                  ? 'bg-slate-800 text-white hover:bg-slate-700'
                                  : 'bg-slate-200 text-slate-600 hover:bg-slate-300 border border-slate-300'
                              }`}
                            >
                              상세보기
                            </button>
                          </td>
                          <td className="px-2 text-center font-mono tabular-nums text-indigo-600">{row.quantity || 1}</td>
                          <td className="px-2 text-center">
                            {row.adminMemo ? (
                              <button
                                type="button"
                                onClick={() => setMemoPopupTarget(row)}
                                className="text-[11px] font-bold text-blue-600 underline hover:text-blue-800"
                              >
                                내용 확인
                              </button>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className="px-2 text-center">
                            <span className={`text-[10px] font-bold whitespace-nowrap ${statusClass}`}>
                              {row.adminStatus}
                            </span>
                            {row.applicantType === '관리자대행' && (
                              <span className="ml-1 text-[10px] font-bold whitespace-nowrap text-indigo-700">
                                관리자대행
                              </span>
                            )}
                          </td>
                          <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                            {row.processDate || <span className="text-slate-300">-</span>}
                          </td>
                          <td className="px-2 text-center">
                            {isModifiable ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                title={!canEdit ? '편집 권한 필요' : undefined}
                                onClick={() => handleCancelRequest(row.id, row.postNumber)}
                                className={`px-2 py-1 text-[10px] font-black rounded-lg transition-colors ${
                                  canEdit
                                    ? 'bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600'
                                    : DISABLED_ACTION_BTN
                                }`}
                              >
                                신청취소
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-normal">변경 불가</span>
                            )}
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
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage((p) => p - 1)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  이전
                </button>
                {Array.from({ length: totalHistoryPages }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setHistoryPage(i + 1)}
                    className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
                      historyPage === i + 1
                        ? 'bg-slate-800 text-white shadow-sm scale-105'
                        : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={historyPage === totalHistoryPages}
                  onClick={() => setHistoryPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 관리자 의견(메모) 확인 심플 팝업 컴포넌트 */}
      {memoPopupTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-sm font-black text-slate-800 tracking-tight">📝 관리자 의견</h3>
              <button onClick={() => setMemoPopupTarget(null)} className="text-slate-400 hover:text-slate-600 font-black text-sm">✕</button>
            </div>
            
            <div className="p-5">
              <p className="text-xs text-slate-700 font-bold leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100 break-words">
                {memoPopupTarget.adminMemo}
              </p>
              
              <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-500 font-black">
                <span>수정자: {memoPopupTarget.adminModifierName || '-'}</span>
                <span>
                  {memoPopupTarget.adminModifiedAt
                    ? formatKSTDateTime(memoPopupTarget.adminModifiedAt)
                    : '-'}
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-100">
               <button onClick={() => setMemoPopupTarget(null)} className="w-full py-2.5 bg-slate-800 text-white text-xs font-black rounded-lg hover:bg-slate-900 transition-colors">
                 닫기
               </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}