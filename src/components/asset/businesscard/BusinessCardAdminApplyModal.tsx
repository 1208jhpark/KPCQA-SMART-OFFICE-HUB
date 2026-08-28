'use client';

import { useEffect, useMemo, useState } from 'react';

interface UnitItem {
  id: string;
  unit_name: string;
  unit_name_en: string;
  unit_type?: string;
  parent_id: string | null;
}

interface MasterCode {
  id: string;
  label: string;
  value: string | null;
}

interface HubUser {
  id: string;
  name: string;
  name_en: string;
  email: string;
  duty: string;
  duty_en: string;
  grade: string;
  grade_en: string;
  unit_id: string | null;
  unit: {
    id: string;
    unit_name: string;
    unit_name_en: string;
    unit_type: string;
    parent_id: string | null;
    parent: {
      id: string;
      unit_name: string;
      unit_name_en: string;
      unit_type: string;
    } | null;
  } | null;
}

const MANUAL_QUAL_PREFIX = '__MANUAL__:';
const MANUAL_QUAL_OPTION = '__MANUAL__';
const MANUAL_TARGET = '__MANUAL__';

function isBusinessCardHqUnit(unit: { unit_type?: string | null; unit_name?: string | null } | null | undefined) {
  const t = String(unit?.unit_type || '').trim().toUpperCase();
  if (t === 'HQ' || t.startsWith('HQ')) return true;
  const n = String(unit?.unit_name || '').trim();
  return /^hq\b/i.test(n) || /^hq[_-]/i.test(n);
}

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

function formatEnNumber(type: 'mobile' | 'phone', value: string) {
  const clean = value.replace(/[^0-9]/g, '');
  if (!clean) return '';
  if (type === 'mobile') {
    return clean.startsWith('010') && clean.length === 11
      ? `+82-10-${clean.substring(3, 7)}-${clean.substring(7)}`
      : value;
  }
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

const emptyForm = (addr?: any) => ({
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
  quantity: 1,
});

const syncedFieldCls =
  'w-full p-2 border border-slate-200 rounded-lg text-xs font-bold bg-slate-50 text-slate-800 outline-slate-400';
const manualFieldCls =
  'w-full p-2 border border-sky-200 rounded-lg text-xs font-bold bg-sky-50 text-slate-800 outline-sky-400';

export default function BusinessCardAdminApplyModal({
  open,
  onClose,
  onSaved,
  units,
  duties,
  grades,
  addresses,
  qualifications,
  sheetsPerPack,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  units: UnitItem[];
  duties: MasterCode[];
  grades: MasterCode[];
  addresses: any[];
  qualifications: any[];
  sheetsPerPack: number;
}) {
  const [hubUsers, setHubUsers] = useState<HubUser[]>([]);
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => emptyForm(addresses[0]));

  useEffect(() => {
    if (!open) return;
    setTargetId('');
    setForm(emptyForm(addresses[0]));
    fetch(`/api/asset/businesscard/master/users?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((data) => setHubUsers(Array.isArray(data.users) ? data.users : []))
      .catch(() => setHubUsers([]));
  }, [open, addresses]);

  const hqUnits = useMemo(
    () => units.filter((u) => isBusinessCardHqUnit(u) || !u.parent_id),
    [units]
  );
  const selectedHeadUnit = units.find((u) => u.unit_name === form.deptHead);
  const childCenterUnits = useMemo(() => {
    if (!selectedHeadUnit) return [];
    return units.filter((u) => u.parent_id === selectedHeadUnit.id && !isBusinessCardHqUnit(u));
  }, [units, selectedHeadUnit]);

  const orgUsers = useMemo(() => {
    if (!form.deptHead) return [];
    const hq = units.find((u) => u.unit_name === form.deptHead);
    const center = form.deptName ? units.find((u) => u.unit_name === form.deptName) : null;
    const allowedIds = new Set<string>();
    if (hq) {
      allowedIds.add(hq.id);
      units.filter((u) => u.parent_id === hq.id).forEach((u) => allowedIds.add(u.id));
    }
    return hubUsers.filter((u) => {
      const uid = u.unit?.id || u.unit_id;
      if (!uid || !allowedIds.has(uid)) return false;
      if (center) return uid === center.id;
      return true;
    });
  }, [hubUsers, units, form.deptHead, form.deptName]);

  const fillFromHubUser = (user: HubUser) => {
    const unit = user.unit;
    const parent = unit?.parent;
    const unitName = String(unit?.unit_name || '').trim();
    const unitNameEn = String(unit?.unit_name_en || '').trim();
    let deptHead = form.deptHead;
    let deptHeadEn = form.deptHeadEn;
    let deptName = form.deptName;
    let deptNameEn = form.deptNameEn;
    if (unit && isBusinessCardHqUnit(unit)) {
      deptHead = unitName;
      deptHeadEn = unitNameEn;
      deptName = '';
      deptNameEn = '';
    } else if (unit) {
      deptName = unitName;
      deptNameEn = unitNameEn;
      deptHead = String(parent?.unit_name || form.deptHead).trim();
      deptHeadEn = String(parent?.unit_name_en || form.deptHeadEn).trim();
    }
    const dutyName = String(user.duty || '').trim();
    const dutyEn = String(user.duty_en || '').trim();
    const gradeName = String(user.grade || '').trim();
    const gradeEn = String(user.grade_en || '').trim();
    const useDuty = !!dutyName;
    const addr = addresses.find((a) => a.id === form.addressId) || addresses[0];
    setForm((p) => ({
      ...p,
      userName: user.name,
      userNameEn: user.name_en || '',
      email: user.email,
      emailEn: user.email,
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
      addressId: addr?.id || p.addressId,
      zipCode: addr?.zipCode || p.zipCode,
      addressKo: addr?.addressKo || p.addressKo,
      addressEn: addr?.addressEn || p.addressEn,
      fax: addr?.fax || p.fax,
      faxEn: addr?.faxEn || p.faxEn,
    }));
  };

  const handleHeadChange = (unitName: string) => {
    const selected = units.find((u) => u.unit_name === unitName);
    setTargetId('');
    setForm((p) => ({
      ...emptyForm(addresses.find((a) => a.id === p.addressId) || addresses[0]),
      addressId: p.addressId,
      zipCode: p.zipCode,
      addressKo: p.addressKo,
      addressEn: p.addressEn,
      fax: p.fax,
      faxEn: p.faxEn,
      quantity: p.quantity,
      deptHead: unitName,
      deptHeadEn: selected?.unit_name_en || '',
      deptName: '',
      deptNameEn: '',
    }));
  };

  const handleSubChange = (unitName: string) => {
    const selected = units.find((u) => u.unit_name === unitName);
    setTargetId('');
    setForm((p) => ({
      ...p,
      userName: '',
      userNameEn: '',
      email: '',
      emailEn: '',
      title: '',
      titleEn: '',
      dutyName: '',
      dutyEn: '',
      gradeName: '',
      gradeEn: '',
      deptName: selected?.unit_name || '',
      deptNameEn: selected?.unit_name_en || '',
    }));
  };

  const handleTargetChange = (value: string) => {
    setTargetId(value);
    if (!value || value === MANUAL_TARGET) {
      setForm((p) => ({
        ...p,
        userName: '',
        userNameEn: '',
        email: '',
        emailEn: '',
        title: p.title,
        titleEn: p.titleEn,
      }));
      return;
    }
    const user = hubUsers.find((u) => u.id === value);
    if (user) fillFromHubUser(user);
  };

  const handleRoleSelect = (value: string) => {
    if (!value) {
      setForm((p) => ({ ...p, dutyName: '', dutyEn: '', gradeName: '', gradeEn: '', title: '', titleEn: '' }));
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

  const handleAddressChange = (addrId: string) => {
    const target = addresses.find((a) => a.id === addrId);
    if (!target) return;
    setForm((p) => ({
      ...p,
      addressId: addrId,
      zipCode: target.zipCode,
      addressKo: target.addressKo,
      addressEn: target.addressEn,
      fax: target.fax,
      faxEn: target.faxEn,
    }));
  };

  const handleTextChange = (field: string, value: string) => {
    setForm((prev) => {
      const updated = { ...prev, [field]: value } as typeof prev;
      if (field === 'email') updated.emailEn = value;
      if (field === 'mobile') updated.mobileEn = formatEnNumber('mobile', value);
      if (field === 'phone') updated.phoneEn = formatEnNumber('phone', value);
      return updated;
    });
  };

  const roleSelectValue = form.dutyName || form.gradeName || form.title || '';
  const isManualTarget = targetId === MANUAL_TARGET;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.userName || !form.deptHead || !form.title || !form.mobile || !form.phone || !form.email) {
      return alert('⚠️ 필수 필드 항목들이 누락되었습니다.');
    }
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

    const selectedUser = hubUsers.find((u) => u.id === targetId);
    const userEmail = selectedUser?.email || '__unregistered__';

    setSaving(true);
    try {
      const res = await fetch('/api/asset/businesscard/master/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: form.userName,
          userNameEn: form.userNameEn,
          deptName: form.deptName,
          deptNameEn: form.deptNameEn,
          deptHead: form.deptHead,
          deptHeadEn: form.deptHeadEn,
          title: form.title,
          titleEn: form.titleEn,
          additionalKo: paired.map((p) => p.ko).join(', '),
          additionalEn: paired.map((p) => p.en).filter(Boolean).join(', '),
          mobile: form.mobile,
          mobileEn: form.mobileEn,
          phone: form.phone,
          phoneEn: form.phoneEn,
          fax: form.fax,
          faxEn: form.faxEn,
          addressId: form.addressId,
          zipCode: form.zipCode,
          addressKo: form.addressKo,
          addressEn: form.addressEn,
          email: form.email,
          emailEn: form.emailEn,
          quantity: form.quantity,
          userEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || data.error || '대행 신청 저장에 실패했습니다.');
        return;
      }
      alert('관리자 대행 신청을 등록했습니다. 진행 대장에서 접수해 주세요.');
      onSaved();
      onClose();
    } catch {
      alert('서버 연결 실패');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-indigo-50 shrink-0">
          <div>
            <p className="text-[10px] font-black text-indigo-600 tracking-widest">ADMIN PROXY</p>
            <h2 className="text-base font-black text-slate-900 mt-0.5">관리자 직접 신청 (대행)</h2>
            <p className="text-[11px] font-bold text-slate-500 mt-1">
              본부·센터를 고른 뒤 대상자를 선택하세요. Hub 회원이면 해당 마이페이지 이력에도 남습니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-white text-slate-500 hover:bg-slate-100 font-black text-sm border border-slate-200">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-xl border border-indigo-100 bg-indigo-50/40">
            <div>
              <label className="block text-[10px] font-black text-blue-600 mb-1">본부 (상위 조직) *</label>
              <select required value={form.deptHead} onChange={(e) => handleHeadChange(e.target.value)} className={syncedFieldCls}>
                <option value="">선택</option>
                {hqUnits.map((u) => (
                  <option key={`h-${u.id}`} value={u.unit_name}>{u.unit_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-blue-600 mb-1">센터 (하위 조직)</label>
              <select disabled={!form.deptHead} value={form.deptName} onChange={(e) => handleSubChange(e.target.value)} className={syncedFieldCls}>
                <option value="">(본부의 하위 센터만 선택)</option>
                {childCenterUnits.map((u) => (
                  <option key={`s-${u.id}`} value={u.unit_name}>{u.unit_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-blue-600 mb-1">대상자 *</label>
              <select required disabled={!form.deptHead} value={targetId} onChange={(e) => handleTargetChange(e.target.value)} className={syncedFieldCls}>
                <option value="">선택</option>
                {orgUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
                <option value={MANUAL_TARGET}>목록에 없음 (미가입자 수동 입력)</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b-[3px] border-slate-600 pb-1.5">1. 국문 정보</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">성명 *</label>
                <input type="text" required value={form.userName} onChange={(e) => handleTextChange('userName', e.target.value)} className={isManualTarget ? manualFieldCls : syncedFieldCls} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">본부</label>
                <input type="text" readOnly value={form.deptHead} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">센터</label>
                <input type="text" readOnly value={form.deptName} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">직책 / 직급 *</label>
                <select required value={roleSelectValue} onChange={(e) => handleRoleSelect(e.target.value)} className={syncedFieldCls}>
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
              </div>
            </div>

            <div className="space-y-2 border border-sky-100 rounded-xl p-3 bg-sky-50/40">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-black text-blue-600">추가사항 (자격증 선택)</label>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, additionalQuals: [...p.additionalQuals, ''], additionalQualsEn: [...p.additionalQualsEn, ''] }))}
                  className="px-2.5 py-1 bg-white hover:bg-sky-100 text-sky-800 text-[10px] font-black rounded border border-sky-200"
                >
                  + 자격증 추가
                </button>
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
                  <div key={idx} className="flex gap-2 items-center">
                    {manualMode ? (
                      <input
                        type="text"
                        value={manualText}
                        onChange={(e) => {
                          const newQuals = [...form.additionalQuals];
                          newQuals[idx] = toManualQualValue(e.target.value);
                          setForm((p) => ({ ...p, additionalQuals: newQuals }));
                        }}
                        placeholder="자격증·추가사항을 직접 입력하세요"
                        className={`flex-1 min-w-0 ${manualFieldCls}`}
                      />
                    ) : (
                      <select
                        value={selectValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          const newQuals = [...form.additionalQuals];
                          const newEns = [...form.additionalQualsEn];
                          while (newEns.length < newQuals.length) newEns.push('');
                          if (v === MANUAL_QUAL_OPTION) {
                            newQuals[idx] = toManualQualValue('');
                            newEns[idx] = '';
                          } else {
                            newQuals[idx] = v;
                            newEns[idx] = qualifications.find((q) => q.nameKo === v)?.nameEn || '';
                          }
                          setForm((p) => ({ ...p, additionalQuals: newQuals, additionalQualsEn: newEns }));
                        }}
                        className={`flex-1 min-w-0 ${manualFieldCls}`}
                      >
                        <option value="">(마스터 표준 자격증 선택)</option>
                        {qualifications.map((q) => (
                          <option key={q.id} value={q.nameKo} disabled={form.additionalQuals.some((x, i) => i !== idx && x === q.nameKo)}>
                            {q.nameKo}
                          </option>
                        ))}
                        <option value={MANUAL_QUAL_OPTION}>상단 리스트에 없을때 수동 기재</option>
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({
                        ...p,
                        additionalQuals: p.additionalQuals.filter((_, i) => i !== idx),
                        additionalQualsEn: p.additionalQualsEn.filter((_, i) => i !== idx),
                      }))}
                      className="px-3 py-2 bg-rose-50 text-rose-600 rounded-lg font-black text-xs hover:bg-rose-100 border border-rose-200 shrink-0"
                    >
                      삭제
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">주소지 선택 *</label>
                <select required value={form.addressId} onChange={(e) => handleAddressChange(e.target.value)} className={manualFieldCls}>
                  <option value="">선택</option>
                  {addresses.filter((a) => a.isActive !== false).map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">우편번호🔒</label>
                <input type="text" readOnly value={form.zipCode} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 mb-1">국문 주소🔒</label>
                <input type="text" readOnly value={form.addressKo} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">휴대전화 *</label>
                <input type="text" required value={form.mobile} onChange={(e) => handleTextChange('mobile', e.target.value)} placeholder="ex. 010-0000-0000" className={manualFieldCls} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">전화번호 (내선) *</label>
                <input type="text" required value={form.phone} onChange={(e) => handleTextChange('phone', e.target.value)} placeholder="ex. 02-6973-0000" className={manualFieldCls} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">팩스🔒</label>
                <input type="text" readOnly value={form.fax} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">이메일 *</label>
                <input type="email" required value={form.email} onChange={(e) => handleTextChange('email', e.target.value)} className={isManualTarget ? manualFieldCls : syncedFieldCls} />
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b-[3px] border-slate-600 pb-1.5">2. 영문 정보</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div>
                <label className="block text-[10px] font-black text-blue-600 mb-1">영문 성명</label>
                <input type="text" value={form.userNameEn} onChange={(e) => setForm({ ...form, userNameEn: e.target.value })} className={syncedFieldCls} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 본부🔒</label>
                <input type="text" readOnly value={form.deptHeadEn} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 센터🔒</label>
                <input type="text" readOnly value={form.deptNameEn} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 직책/직급🔒</label>
                <input type="text" readOnly value={form.titleEn} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed`} />
              </div>
            </div>
            <div className="space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/40">
              <label className="block text-[10px] font-black text-blue-600">영문 추가사항</label>
              {form.additionalQuals.map((qualKo, idx) => {
                const masterNames = qualifications.map((q) => q.nameKo);
                const manualMode = isManualQualValue(qualKo, masterNames);
                const masterEn = qualifications.find((q) => q.nameKo === qualKo)?.nameEn || '';
                return (
                  <input
                    key={idx}
                    type="text"
                    readOnly={!manualMode}
                    value={manualMode ? String(form.additionalQualsEn[idx] || '') : masterEn}
                    onChange={(e) => {
                      if (!manualMode) return;
                      const newEns = [...form.additionalQualsEn];
                      while (newEns.length < form.additionalQuals.length) newEns.push('');
                      newEns[idx] = e.target.value;
                      setForm((p) => ({ ...p, additionalQualsEn: newEns }));
                    }}
                    className={`w-full p-2 rounded-lg text-xs font-bold ${manualMode ? 'bg-sky-50 text-slate-800 border border-sky-200' : 'bg-slate-50 text-slate-500 border border-slate-100 cursor-not-allowed'}`}
                  />
                );
              })}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
              <div className="md:col-span-4">
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 주소🔒</label>
                <input type="text" readOnly value={form.addressEn} className={`${syncedFieldCls} text-slate-400 cursor-not-allowed font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 휴대전화🔒</label>
                <input type="text" readOnly value={form.mobileEn} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 전화🔒</label>
                <input type="text" readOnly value={form.phoneEn} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 팩스🔒</label>
                <input type="text" readOnly value={form.faxEn} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">영문 이메일🔒</label>
                <input type="text" readOnly value={form.emailEn} className={`${syncedFieldCls} text-slate-500 cursor-not-allowed font-mono`} />
              </div>
            </div>
          </div>

          <div className="pt-3 mt-1 border-t-[3px] border-slate-600 flex flex-col md:flex-row md:items-center gap-2">
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/60 shrink-0">
              <p className="text-[10px] font-black text-indigo-900 whitespace-nowrap">
                발주 수량<span className="ml-1.5 font-bold text-indigo-400">1통={sheetsPerPack}장</span>
              </p>
              <div className="flex items-center gap-1 bg-white px-1 py-0.5 rounded-lg border border-indigo-200">
                <button type="button" onClick={() => setForm({ ...form, quantity: Math.max(1, form.quantity - 1) })} className="w-7 h-7 flex items-center justify-center bg-slate-50 border border-slate-200 text-slate-700 text-sm font-black rounded-md">−</button>
                <span className="w-7 text-center font-black text-indigo-700 text-sm tabular-nums">{form.quantity}</span>
                <button type="button" onClick={() => setForm({ ...form, quantity: form.quantity + 1 })} className="w-7 h-7 flex items-center justify-center bg-slate-50 border border-slate-200 text-slate-700 text-sm font-black rounded-md">+</button>
                <span className="text-[10px] font-black text-indigo-700 pl-0.5 pr-1">통</span>
              </div>
            </div>
            <div className="flex-1 flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-slate-200 text-slate-700 font-black text-[11px] rounded-lg hover:bg-slate-300">취소</button>
              <button type="submit" disabled={saving} className="flex-[2] py-2.5 bg-indigo-600 text-white font-black text-[11px] rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? '저장중...' : '+ 관리자 대행 신청 등록'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
