'use client';

import { useState, useEffect } from 'react';

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
  parent_id: string | null;
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
  adminModifierName?: string | null;
  adminModifiedAt?: string | null;
  quantity?: number;
}

const HeaderDark = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-800 border-b border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div className="flex items-center gap-2 shrink-0">
      <div className="w-2.5 h-2.5 rounded-full bg-indigo-400"></div>
      <h2 className="text-sm font-black text-white tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-700/80 text-slate-200 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    <div className="w-full md:w-auto">
      {children}
    </div>
  </div>
);

export default function BusinessCardMyPage({ currentUser }: CurrentUserProps) {
  const [loginUser, setLoginUser] = useState({
    name: '',
    email: '',
    deptName: '',
  });

  const activeUser = {
    name: currentUser?.name || loginUser.name,
    email: currentUser?.email || loginUser.email,
    dept: currentUser?.dept || loginUser.deptName
  };

  const [formMode, setFormMode] = useState<'NEW' | 'VIEW' | 'EDIT'>('NEW');
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [duties, setDuties] = useState<MasterCode[]>([]);
  const [grades, setGrades] = useState<MasterCode[]>([]);
  const [history, setHistory] = useState<RequestHistory[]>([]);
  
  const [historyPage, setHistoryPage] = useState(1);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const itemsPerPage = 10;

  // 🚀 년/월 필터 상태 추가
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');

  const [addresses, setAddresses] = useState<any[]>([]);
  const [qualifications, setQualifications] = useState<any[]>([]); 
  const [memoPopupTarget, setMemoPopupTarget] = useState<RequestHistory | null>(null); 

  const [form, setForm] = useState({
    id: '', 
    userName: '', userNameEn: '',
    deptHead: '', deptHeadEn: '',
    deptName: '', deptNameEn: '',
    dutyName: '', dutyEn: '',
    gradeName: '', gradeEn: '',
    title: '', titleEn: '',
    additionalQuals: [] as string[],
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

  const initPortalData = async () => {
    try {
      setLoading(true);
      const ts = Date.now();
      
      const meRes = await fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' });
      let sessionEmail = '';
      
      if (meRes.ok) {
        const me = await meRes.json();
        const resolvedDept = me.dept_name || me.unit_name || me.unit?.unit_name || '소속 미지정';
        setLoginUser({
          name: me.name || '',
          email: me.email || '',
          deptName: resolvedDept
        });
        sessionEmail = me.email;
      }

      if (!sessionEmail && !currentUser?.email) {
        setLoading(false);
        return;
      }

      const targetEmail = sessionEmail || currentUser?.email || '';

      const [configRes, unitsRes, masterRes, historyRes, addrMasterRes, qualRes] = await Promise.all([
        fetch(`/api/admin/config?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/my-page?email=${encodeURIComponent(targetEmail)}&t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/master/addresses?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/businesscard/master/qualifications?t=${ts}`, { cache: 'no-store' }) 
      ]);

      if (configRes.ok && masterRes.ok) {
        const config = await configRes.json();
        const allMaster = await masterRes.json();
        const dutyGroup = allMaster.find((g: any) => g.id === config.job_duty_group);
        const gradeGroup = allMaster.find((g: any) => g.id === config.job_grade_group);
        if (dutyGroup?.codes) setDuties(dutyGroup.codes);
        if (gradeGroup?.codes) setGrades(gradeGroup.codes);
      }

      if (unitsRes.ok) setUnits(await unitsRes.json());
      if (historyRes.ok) setHistory(await historyRes.json());

      if (addrMasterRes.ok) {
        const addrData = await addrMasterRes.json();
        const activeAddrs = addrData.filter((a: any) => a.isActive);
        setAddresses(activeAddrs);
        
        if (activeAddrs.length > 0 && formMode === 'NEW') {
          const defaultAddr = activeAddrs[0];
          setForm(p => ({
            ...p,
            addressId: defaultAddr.id,
            zipCode: defaultAddr.zipCode,
            addressKo: defaultAddr.addressKo,
            addressEn: defaultAddr.addressEn,
            fax: defaultAddr.fax,
            faxEn: defaultAddr.faxEn
          }));
        }
      }

      if (qualRes.ok) {
        const qualData = await qualRes.json();
        setQualifications(qualData.filter((q: any) => q.isActive));
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
      const titleKo = [form.dutyName, form.gradeName].filter(Boolean).join(' / ');
      const titleEn = [form.dutyEn, form.gradeEn].filter(Boolean).join(' / ');
      setForm(p => ({ ...p, title: titleKo, titleEn }));
    }
  }, [form.dutyName, form.gradeName, form.dutyEn, form.gradeEn]);

  const handleResetToNew = () => {
    const activeDefaultAddr = addresses[0];

    setFormMode('NEW');
    setForm({
      id: '',
      userName: activeUser.name, userNameEn: '',
      deptHead: '', deptHeadEn: '',
      deptName: activeUser.dept, deptNameEn: '',
      dutyName: '', dutyEn: '',
      gradeName: '', gradeEn: '',
      title: '', titleEn: '',
      additionalQuals: [], 
      mobile: '', mobileEn: '',
      phone: '', phoneEn: '',
      email: activeUser.email, emailEn: activeUser.email,
      addressId: activeDefaultAddr?.id || '',
      zipCode: activeDefaultAddr?.zipCode || '',
      addressKo: activeDefaultAddr?.addressKo || '',
      addressEn: activeDefaultAddr?.addressEn || '',
      fax: activeDefaultAddr?.fax || '',
      faxEn: activeDefaultAddr?.faxEn || '',
      adminStatus: '대기중',
      isModifiedByAdmin: false,
      adminMemo: '',
      adminModifierName: '',
      adminModifiedAt: '',
      quantity: 1
    });
    setBackupForm(null);
  };

  const handleDetailView = (row: RequestHistory) => {
    const matchedDuty = duties.find(d => row.title.includes(d.label))?.label || '';
    const matchedGrade = grades.find(g => row.title.includes(g.label))?.label || '';

    const parsedQuals = row.additionalKo
      ? row.additionalKo.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const targetData = {
      id: row.id,
      userName: row.userName,
      userNameEn: row.userNameEn || '',
      deptHead: row.deptHead || '',
      deptHeadEn: row.deptHeadEn || '',
      deptName: row.deptName,
      deptNameEn: row.deptNameEn || '',
      dutyName: matchedDuty,
      dutyEn: duties.find(d => d.label === matchedDuty)?.value || '',
      gradeName: matchedGrade,
      gradeEn: grades.find(g => g.label === matchedGrade)?.value || '',
      title: row.title,
      titleEn: row.titleEn || '',
      additionalQuals: parsedQuals,
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEnableEdit = () => {
    setBackupForm({ ...form });
    setFormMode('EDIT');
  };

  const handleCancelEdit = () => {
    if (backupForm) setForm(backupForm);
    setFormMode('VIEW');
  };

  const handleHeadChange = (unitName: string) => {
    const selected = units.find(u => u.unit_name === unitName);
    setForm(p => ({ ...p, deptHead: unitName, deptHeadEn: selected?.unit_name_en || '' }));
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
      if (field === 'userName') updated.userNameEn = ''; 
      if (field === 'email') updated.emailEn = value;
      if (field === 'mobile') updated.mobileEn = formatEnNumber('mobile', value);
      if (field === 'phone') updated.phoneEn = formatEnNumber('phone', value);
      return updated;
    });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.userName || !form.deptHead || !form.title || !form.mobile) {
      alert('⚠️ 필수 필드 항목들이 누락되었습니다.');
      return;
    }

    const isEdit = formMode === 'EDIT';

    const finalKo = form.additionalQuals.filter(Boolean).join(', ');
    const finalEn = form.additionalQuals.map(ko => qualifications.find(q => q.nameKo === ko)?.nameEn || '').filter(Boolean).join(', ');

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
      userEmail: activeUser.email,
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
        handleResetToNew();
        initPortalData(); 
      } else {
        alert('처리 중 오류가 발생했습니다.');
      }
    } catch (err) {
      alert('데이터베이스 트랜잭션 처리 중 오류가 발생했습니다.');
    }
  };

  const handleCancelRequest = async (id: string, postNo: string) => {
    if (!confirm(`⚠️ [${postNo}] 명함 발급 신청을 취소하시겠습니까?\n취소 후에는 복구할 수 없습니다.`)) return;
    try {
      const res = await fetch(`/api/asset/businesscard/my-page?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert("🚀 신청이 정상적으로 취소되었습니다.");
        handleResetToNew();
        initPortalData();
      }
    } catch (err) {
      alert("서버 통신 오류가 발생했습니다.");
    }
  };

  // 🚀 필터링 옵션 추출
  const availableYears = Array.from(new Set(history.map(h => h.applyDate?.substring(0, 4) || ''))).filter(Boolean).sort((a, b) => b.localeCompare(a));
  const availableMonths = Array.from(new Set(history.map(h => h.applyDate?.substring(5, 7) || ''))).filter(Boolean).sort();

  // 🚀 조건부 필터 적용
  const filteredHistory = history.filter(h => {
    const matchYear = yearFilter === 'ALL' || h.applyDate?.startsWith(yearFilter);
    const matchMonth = monthFilter === 'ALL' || h.applyDate?.substring(5, 7) === monthFilter;
    return matchYear && matchMonth;
  });

  // 🚀 필터 변경 시 페이지 리셋
  useEffect(() => {
    setHistoryPage(1);
  }, [yearFilter, monthFilter]);

  const totalHistoryPages = Math.ceil(filteredHistory.length / itemsPerPage) || 1;
  const paginatedHistory = filteredHistory.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage);
  
  const isReadOnly = formMode === 'VIEW';

  if (loading) return <div className="p-20 text-center font-black animate-pulse text-slate-400 tracking-widest text-xs">LOADING PORTAL DATA...</div>;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
 
      {/* 최상단 명함신청배너 */}
  
      <div className="w-full bg-slate-50 border-2 border-blue-500 p-6 rounded-[2.5rem] shadow-sm relative overflow-hidden flex flex-col justify-center min-h-[140px]">
  <div className="relative z-10 flex justify-between items-end w-full">
    <div>
      {/* 1. 상단 라벨 (표준 mb-3 및 브랜드 컬러 매칭) */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-3"> 
        BUSINESS CARD PROCESS CENTER
      </h3>
      
      {/* 2. 메인 타이틀 (부서/이름 독립형 뱃지화 및 한 줄 수평 정렬 보장) */}
      <h1 className="text-2xl font-black tracking-tight text-slate-800 leading-none flex items-center flex-wrap gap-2">

        {/* 🏢 소속 부서 뱃지 (소모품 대장과 완벽하게 스케일을 맞춘 text-lg 버전) */}
<span className="bg-blue-50 border border-blue-200 text-blue-600 px-4 py-2 rounded-2xl text-lg font-black tracking-tight shrink-0 shadow-sm">
  {activeUser?.dept || '조직'}
</span>
        
        {/* 👤 사용자 이름 뱃지 (주체 명시용 투명도 톤 유지) */}
        <span className="text-slate-700 shrink-0">{activeUser?.name || '임직원'} 님</span>{' '}
        
        {/* 🎯 메인 타이틀 텍스트 */}
        <span className="text-slate-800">명함 발급 신청 허브</span>
      </h1>
      
      {/* 3. 하단 설명 (현재 모드 상태 안내 - mt-4 간격 표준화) */}
      <p className="text-slate-500 text-xs font-semibold mt-4 opacity-95 flex items-center gap-1">
        <span>현재 모드:</span>
        <span className={`font-black ${
          formMode === 'NEW' ? 'text-blue-600' : 
          formMode === 'VIEW' ? 'text-slate-600' : 'text-amber-600'
        }`}>
          {formMode === 'NEW' && '✨ 신규 발급 신청 입력'}
          {formMode === 'VIEW' && '🔒 신청 내역 상세 보기 (읽기 전용)'}
          {formMode === 'EDIT' && '📝 신청 내역 정보 수정 중'}
        </span>
      </p>
    </div>

    {/* 🚀 우측 동적 액션 버튼 (기존 기능 완전 유지) */}
    {formMode !== 'NEW' && (
      <button 
        type="button" 
        onClick={handleResetToNew} 
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black rounded-xl transition-colors shadow-sm whitespace-nowrap"
      >
        + 신규 신청 양식 띄우기
      </button>
    )}
  </div>
</div>


      <form onSubmit={handleFormSubmit} className="bg-white border border-slate-200 rounded-[2.5rem] p-6 shadow-sm space-y-5">
        
        {/* 관리자 직접 수정 이력 감지 배너 */}
        {formMode === 'VIEW' && form.isModifiedByAdmin && (
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
          <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b-2 border-slate-100 pb-1.5">1. 국문 정보 (Korean Info)</h4>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-x-4 gap-y-3">
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">성명 *</label>
              <input type="text" required disabled={isReadOnly} value={form.userName} onChange={(e) => handleTextChange('userName', e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg text-xs font-bold disabled:bg-slate-50 disabled:text-slate-400 outline-slate-400" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">직책</label>
              <select disabled={isReadOnly} value={form.dutyName} onChange={(e) => {
                const sel = duties.find(d => d.label === e.target.value);
                setForm(p => ({ ...p, dutyName: e.target.value, dutyEn: sel?.value || '' }));
              }} className="w-full p-2 border border-slate-200 rounded-lg text-xs font-bold disabled:bg-slate-50 outline-slate-400">
                <option value="">선택</option>
                {duties.map(d => <option key={d.id} value={d.label}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">직급</label>
              <select disabled={isReadOnly} value={form.gradeName} onChange={(e) => {
                const sel = grades.find(g => g.label === e.target.value);
                setForm(p => ({ ...p, gradeName: e.target.value, gradeEn: sel?.value || '' }));
              }} className="w-full p-2 border border-slate-200 rounded-lg text-xs font-bold disabled:bg-slate-50 outline-slate-400">
                <option value="">선택</option>
                {grades.map(g => <option key={g.id} value={g.label}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">본부 *</label>
              <select required disabled={isReadOnly} value={form.deptHead} onChange={(e) => handleHeadChange(e.target.value)} className="w-full p-2 border border-slate-200 bg-slate-50 rounded-lg text-xs font-black text-slate-800 disabled:opacity-60 outline-slate-400">
                <option value="">선택</option>
                {units.map(u => <option key={`h-${u.id}`} value={u.unit_name}>{u.unit_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">소속</label>
              <select disabled={isReadOnly} value={form.deptName} onChange={(e) => handleSubChange(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 disabled:bg-slate-50 outline-slate-400">
                <option value="">선택</option>
                {units.map(u => <option key={`s-${u.id}`} value={u.unit_name}>{u.unit_name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">휴대전화 *</label>
              <input type="text" required disabled={isReadOnly} value={form.mobile} onChange={(e) => handleTextChange('mobile', e.target.value)} placeholder="010-0000-0000" className="w-full p-2 border border-slate-200 rounded-lg text-xs font-bold disabled:bg-slate-50 outline-slate-400" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">전화번호 (내선)</label>
              <input type="text" disabled={isReadOnly} value={form.phone} onChange={(e) => handleTextChange('phone', e.target.value)} placeholder="02-0000-0000" className="w-full p-2 border border-slate-200 rounded-lg text-xs font-bold disabled:bg-slate-50 outline-slate-400" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">팩스 번호 🔒</label>
              <input type="text" readOnly value={form.fax} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black text-slate-500 mb-1">이메일 주소 *</label>
              <input type="email" required disabled={isReadOnly} value={form.email} onChange={(e) => handleTextChange('email', e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg text-xs font-bold disabled:bg-slate-50 outline-slate-400" />
            </div>

            <div className="md:col-span-5 space-y-2 border-t border-slate-100 pt-3 mt-1">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-black text-slate-500">추가사항 (자격증 선택)</label>
                {!isReadOnly && (
                  <button 
                    type="button" 
                    onClick={() => setForm(p => ({ ...p, additionalQuals: [...p.additionalQuals, ''] }))} 
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black rounded border border-slate-200 transition-colors"
                  >
                    + 자격증 추가
                  </button>
                )}
              </div>
              
              {form.additionalQuals.length === 0 && (
                <p className="text-[11px] text-slate-400 italic py-1">추가할 자격사항이 없습니다.</p>
              )}
              
              {form.additionalQuals.map((qualKo, idx) => (
                <div key={idx} className="flex gap-2 items-center animate-fade-in">
                  <select 
                    disabled={isReadOnly} 
                    value={qualKo} 
                    onChange={(e) => {
                      const newQuals = [...form.additionalQuals];
                      newQuals[idx] = e.target.value;
                      setForm(p => ({ ...p, additionalQuals: newQuals }));
                    }} 
                    className="flex-1 p-2 border border-slate-200 rounded-lg text-xs font-bold disabled:bg-slate-50 outline-slate-400"
                  >
                    <option value="">(마스터 표준 자격증 선택)</option>
                    {qualifications.map(q => (
                      <option 
                        key={q.id} 
                        value={q.nameKo} 
                        disabled={form.additionalQuals.includes(q.nameKo) && form.additionalQuals[idx] !== q.nameKo}
                      >
                        {q.nameKo}
                      </option>
                    ))}
                  </select>
                  {!isReadOnly && (
                    <button 
                      type="button" 
                      onClick={() => {
                        const newQuals = form.additionalQuals.filter((_, i) => i !== idx);
                        setForm(p => ({ ...p, additionalQuals: newQuals }));
                      }} 
                      className="px-3 py-2 bg-rose-50 text-rose-600 rounded-lg font-black text-xs hover:bg-rose-100 border border-rose-200"
                    >
                      삭제
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 2. 영문 정보 섹션 ── */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest border-b-2 border-slate-100 pb-1.5 flex items-center justify-between">
            <span>2. 영문 정보 (English Info)</span>
            <span className="text-[9px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-bold">지능형 국제 지역번호 포맷 변환 완료 ⚡</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-x-4 gap-y-3">
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">영문 성명</label>
              <input type="text" disabled={isReadOnly} value={form.userNameEn} onChange={(e) => setForm({ ...form, userNameEn: e.target.value })} className="w-full p-2 border border-slate-200 rounded-lg text-xs font-black disabled:bg-slate-50" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">영문 직책 🔒</label>
              <input type="text" readOnly value={form.dutyEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">영문 직급 🔒</label>
              <input type="text" readOnly value={form.gradeEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">영문 본부 🔒</label>
              <input type="text" readOnly value={form.deptHeadEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">영문 소속 🔒</label>
              <input type="text" readOnly value={form.deptNameEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">영문 휴대전화 🔒</label>
              <input type="text" readOnly value={form.mobileEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">영문 전화 🔒</label>
              <input type="text" readOnly value={form.phoneEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">영문 팩스 🔒</label>
              <input type="text" readOnly value={form.faxEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black text-slate-400 mb-1">영문 이메일 🔒</label>
              <input type="text" readOnly value={form.emailEn} className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
            </div>

            <div className="md:col-span-5 space-y-2 border-t border-slate-100 pt-3 mt-1">
              <label className="block text-[10px] font-black text-slate-400">영문 추가사항 🔒 (국문 마스터 자동 연동)</label>
              
              {form.additionalQuals.length === 0 && (
                <p className="text-[11px] text-slate-400 italic py-1">추가된 영문 자격사항이 없습니다.</p>
              )}

              {form.additionalQuals.map((qualKo, idx) => {
                const matchedEn = qualifications.find(q => q.nameKo === qualKo)?.nameEn || '';
                return (
                  <div key={idx} className="flex gap-2 animate-fade-in">
                    <input 
                      type="text" 
                      readOnly 
                      value={matchedEn} 
                      placeholder="(국문에서 자격증을 선택하면 영문 표기가 자동 적용됩니다)"
                      className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" 
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── 3. 시스템 등록 주소지 섹션 ── */}
        <div className="space-y-3 pt-2 border-t border-slate-50">
          <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest pb-1">3. 시스템 등록 주소지 (Address)</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1">주소지 선택 *</label>
              <select disabled={isReadOnly} value={form.addressId} onChange={(e) => handleAddressChange(e.target.value)} className="w-full p-2 border border-slate-200 bg-slate-50 rounded-lg text-xs font-bold text-slate-800 disabled:opacity-60 outline-slate-400">
                {addresses.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-300 mb-1">우편번호</label>
              <input type="text" readOnly value={form.zipCode} className="w-full p-2 bg-slate-50 text-slate-400 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black text-slate-300 mb-1">국문 전사 주소</label>
              <input type="text" readOnly value={form.addressKo} className="w-full p-2 bg-slate-50 text-slate-400 border border-slate-100 rounded-lg text-xs font-bold cursor-not-allowed" />
            </div>
            <div className="md:col-span-4">
              <label className="block text-[10px] font-black text-slate-300 mb-1">영문 전사 주소</label>
              <input type="text" readOnly value={form.addressEn} className="w-full p-2 bg-slate-50 text-slate-400 border border-slate-100 rounded-lg text-xs font-mono cursor-not-allowed" />
            </div>
          </div>
        </div>

        {/* 🚀 4. 발주 신청 수량 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-800">4. 발주 신청 수량</h3>
              <p className="text-[11px] text-slate-500 font-medium mt-1">필요한 명함의 수량(통)을 선택해 주세요. (기본 1통 = 200장)</p>
            </div>
            <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
              <button 
                type="button" 
                onClick={() => setForm({ ...form, quantity: Math.max(1, (form.quantity || 1) - 1) })}
                className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 text-slate-600 font-black rounded-lg hover:bg-slate-100 transition-colors"
              >
                -
              </button>
              <span className="w-8 text-center font-black text-indigo-700 text-lg">
                {form.quantity || 1}
              </span>
              <button 
                type="button" 
                onClick={() => setForm({ ...form, quantity: (form.quantity || 1) + 1 })}
                className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 text-slate-600 font-black rounded-lg hover:bg-slate-100 transition-colors"
              >
                +
              </button>
              <span className="text-xs font-bold text-slate-500 ml-1">통</span>
            </div>
          </div>
        </div>

        <div className="pt-2">
        {formMode === 'NEW' && (
            <button type="submit" className="w-full py-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-black text-xs rounded-xl shadow-md hover:from-blue-600 hover:to-indigo-700 transition-all tracking-widest uppercase">
              🚀 명함 원본 데이터 발주 신청
            </button>
          )}

          {formMode === 'VIEW' && form.adminStatus === '대기중' && (
            <button type="button" onClick={handleEnableEdit} className="w-full py-4 bg-indigo-600 text-white font-black text-xs rounded-xl shadow-md hover:bg-indigo-700 transition-colors tracking-widest uppercase">
              📝 신청 정보 수정하기
            </button>
          )}

          {formMode === 'VIEW' && form.adminStatus !== '대기중' && (
            <button type="button" disabled className="w-full py-4 bg-slate-200 text-slate-500 font-black text-xs rounded-xl shadow-inner cursor-not-allowed tracking-widest uppercase">
              🔒 공정 진행 중 (수정 불가)
            </button>
          )}

          {formMode === 'EDIT' && (
            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={handleCancelEdit} className="py-4 bg-slate-200 text-slate-700 font-black text-xs rounded-xl shadow-sm hover:bg-slate-300 transition-colors tracking-widest uppercase">
                ❌ 변경 취소하기
              </button>
              <button type="submit" className="py-4 bg-emerald-600 text-white font-black text-xs rounded-xl shadow-md hover:bg-emerald-700 transition-colors tracking-widest uppercase">
                💾 변경사항 저장하기
              </button>
            </div>
          )}
        </div>
      </form>

      {/* 내역 보관함 테이블 대장 */}
      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        
        {/* 🚀 HeaderDark 내부에 필터 및 버튼 탑재 */}
        <HeaderDark title="나의 명함 신청 내역 및 실시간 공정 보관함" count={filteredHistory.length}>
          <div className="flex items-center gap-2 mt-3 md:mt-0 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="bg-slate-900 text-white text-[11px] font-black p-2 rounded-lg border border-slate-700 outline-none cursor-pointer">
              <option value="ALL">전체 년도</option>
              {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="bg-slate-900 text-white text-[11px] font-black p-2 rounded-lg border border-slate-700 outline-none cursor-pointer">
              <option value="ALL">전체 월</option>
              {availableMonths.map(m => <option key={m} value={m}>{parseInt(m)}월</option>)}
            </select>
            <button onClick={() => setIsHistoryOpen(!isHistoryOpen)} className="text-[11px] font-black bg-white text-slate-900 border border-slate-200 rounded-lg px-4 py-2 hover:bg-slate-100 transition-colors shadow-sm ml-1 shrink-0">
              {isHistoryOpen ? '보관함 접기 ▲' : '보관함 펼치기 ▼'}
            </button>
          </div>
        </HeaderDark>
        
        {isHistoryOpen && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                  <tr>
                    <th className="h-12 pl-8 w-[80px]">번호</th>
                    <th className="h-12 px-4 w-[130px]">신청일자</th>
                    <th className="h-12 px-4 w-[180px]">조직</th>
                    <th className="h-12 px-4 w-[120px]">이름</th>
                    <th className="h-12 px-4 w-[180px] text-center">신청내역 상세보기</th>
                    <th className="h-12 px-2 text-center w-[80px]">수량(통)</th>
                    <th className="h-12 px-3 text-center w-[120px]">관리자의견</th>
                    <th className="h-12 px-3 text-center w-[120px]">공정상태</th>
                    <th className="h-12 px-4 w-[130px] text-center">처리일자</th>
                    <th className="h-12 pr-8 text-center w-[130px]">상태변경</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                  {paginatedHistory.map((row, index) => {
                    const globalIndex = (historyPage - 1) * itemsPerPage + index + 1;
                    const isModifiable = row.adminStatus === '대기중';
                    
                    // 🚀 4단계 상태 컬러 완벽 분리
                    const statusClass = 
                      row.adminStatus === '지급완료' ? 'bg-purple-100 text-purple-800' :
                      row.adminStatus === '발주완료' ? 'bg-emerald-100 text-emerald-800' :
                      row.adminStatus === '접수완료' ? 'bg-blue-100 text-blue-800' : 
                      'bg-amber-100 text-amber-800'; // 대기중

                    return (
                      <tr key={row.id} className="h-16 hover:bg-slate-50/50 transition-colors">
                        <td className="pl-8 font-mono text-slate-500">{globalIndex}</td>
                        <td className="px-4 text-slate-400 font-mono">{row.applyDate}</td>
                        <td className="px-4 text-slate-500 font-medium">
                          {row.deptHead} {row.deptName ? `/ ${row.deptName}` : ''}
                        </td>
                        <td className="px-4 font-black text-slate-900">{row.userName}</td>
                        <td className="px-4 text-center">
                          <button type="button" onClick={() => handleDetailView(row)} className="px-3 py-1 bg-slate-800 text-white text-[11px] font-bold rounded-lg hover:bg-slate-700 shadow-sm transition-colors">
                            상세내용보기 🔎
                          </button>
                        </td>
                        
                        <td className="px-2 text-center text-rose-600 font-black">
                          {row.quantity || 1}
                        </td>

                        <td className="px-3 text-center">
                          {row.adminMemo ? (
                            <span 
                              onClick={() => setMemoPopupTarget(row)}
                              className="text-[11px] font-bold text-blue-600 underline cursor-pointer hover:text-blue-800"
                            >
                              내용 확인
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-bold">-</span>
                          )}
                        </td>

                        <td className="px-3 text-center">
                          <span className={`px-2.5 py-1 rounded-full font-black text-[10px] ${statusClass}`}>
                            {row.adminStatus}
                          </span>
                        </td>
                        <td className="px-4 text-center font-mono text-slate-400 text-[11px]">
                          {row.processDate || '-'}
                        </td>
                        <td className="pr-8 text-center">
                          {isModifiable ? (
                            <button type="button" onClick={() => handleCancelRequest(row.id, row.postNumber)} className="px-2.5 py-1.5 bg-rose-50 border border-rose-200 text-[11px] font-black rounded-lg hover:bg-rose-100 text-rose-600 transition-colors">
                              신청취소
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic font-normal">변경 불가 🔒</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredHistory.length === 0 && (
                    <tr className="h-16">
                      <td colSpan={10} className="text-center font-black text-slate-400 text-xs py-10 bg-slate-50/50">조건에 일치하는 신청 내역이 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            {/* 🚀 페이지네이션 */}
            {totalHistoryPages > 1 && (
              <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
                <button disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
                {Array.from({ length: totalHistoryPages }).map((_, i) => (
                  <button key={i} onClick={() => setHistoryPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${historyPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
                ))}
                <button disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
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
                <span>수정자: {memoPopupTarget.adminModifierName || '관리자'}</span>
                <span>
                  {memoPopupTarget.adminModifiedAt 
                    ? new Date(memoPopupTarget.adminModifiedAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) 
                    : '-'}
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-100">
               <button onClick={() => setMemoPopupTarget(null)} className="w-full py-2.5 bg-slate-800 text-white text-xs font-black rounded-lg hover:bg-slate-900 transition-colors">
                 확인했습니다
               </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}