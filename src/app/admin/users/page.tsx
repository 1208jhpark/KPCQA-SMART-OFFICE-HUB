'use client';

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  DEFAULT_USER_DUTY_OPTIONS,
  DEFAULT_USER_GRADE_OPTIONS,
  type UserJobOption,
} from '@/lib/user-job-options';
import { COMPANY_EMAIL_SUFFIX, extractEmailLocalPart } from '@/utils/companyEmail';
import { getKSTDateString } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';

const EMPTY_CREATE_FORM = {
  name: '',
  name_en: '',
  emailLocal: '',
  employee_no: '',
  unit_id: '',
  duty: '',
  grade: '',
  role: 'LV_3',
  status: 'Active',
};

export default function AdminUsersPage() {
  const [data, setData] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE_FORM });
  const [createSaving, setCreateSaving] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    name_en: string;
    employee_no: string;
    duty: string;
    duty_en: string;
    grade: string;
    grade_en: string;
    unit_id: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [jobOptionsModal, setJobOptionsModal] = useState<{
    duties: UserJobOption[];
    grades: UserJobOption[];
  } | null>(null);
  const [jobOptionsSaving, setJobOptionsSaving] = useState(false);
  const [tempPasswordModal, setTempPasswordModal] = useState<{
    name: string;
    email: string;
    tempPassword: string;
  } | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 데이터 실시간 로드 (사용자 + 조직)
  const fetchData = async () => {
    try {
      setLoadError(null);
      const [uRes, nRes, meRes] = await Promise.all([
        fetch('/api/admin/users', { cache: 'no-store' }),
        fetch('/api/admin/units?active=true', { cache: 'no-store' }),
        fetch('/api/auth/me', { cache: 'no-store' }).catch(() => null),
      ]);

      if (meRes && meRes.ok) {
        const me = await meRes.json();
        setMeId(me?.id || null);
      }

      if (!uRes.ok) {
        const err = await uRes.json().catch(() => ({}));
        const msg = err.message || err.error || `사용자 목록 로드 실패 (${uRes.status})`;
        setLoadError(msg);
        setData({ users: [], stats: { totalUsers: 0 }, duties: [], grades: [] });
        return;
      }
      const usersPayload = await uRes.json();
      if (!usersPayload || !Array.isArray(usersPayload.users)) {
        setLoadError('사용자 목록 응답 형식이 올바르지 않습니다.');
        setData({ users: [], stats: { totalUsers: 0 }, duties: [], grades: [] });
        return;
      }
      setData(usersPayload);

      if (nRes.ok) {
        const unitsPayload = await nRes.json();
        setUnits(Array.isArray(unitsPayload) ? unitsPayload : []);
      } else {
        setUnits([]);
      }
    } catch (error) {
      console.error('데이터 동기화 실패', error);
      setLoadError('데이터 동기화 중 오류가 발생했습니다.');
      setData({ users: [], stats: { totalUsers: 0 }, duties: [], grades: [] });
    }
  };

  useEffect(() => { fetchData(); }, []);

  // [인라인 및 모달 수정 통합 처리 함수]
  const handleUpdate = async (userId: string, payload: any) => {
    try {
      const res = await fetch('/api/admin/users', { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...payload }) 
      });
      if (res.ok) { 
        await fetchData(); 
        setIsModalOpen(false); 
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || err.error || '서버 수정에 실패했습니다.');
        return false;
      }
    } catch (error) { 
      alert("통신 중 오류 발생"); 
      return false;
    }
  };

  const startEditUser = (u: any) => {
    const unassigned = !u.unit_id || u.unit?.is_active === false;
    setEditingUserId(u.id);
    setEditDraft({
      name: u.name || '',
      name_en: u.name_en || '',
      employee_no: u.employee_no || '',
      duty: u.duty || '',
      duty_en: u.duty_en || '',
      grade: u.grade || '',
      grade_en: u.grade_en || '',
      unit_id: unassigned ? '' : (u.unit_id || ''),
    });
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditDraft(null);
  };

  const saveEditUser = async () => {
    if (!editingUserId || !editDraft) return;
    setEditSaving(true);
    try {
      const ok = await handleUpdate(editingUserId, {
        name: editDraft.name.trim(),
        name_en: editDraft.name_en.trim(),
        employee_no: editDraft.employee_no.trim(),
        duty: editDraft.duty,
        duty_en: editDraft.duty_en,
        grade: editDraft.grade,
        grade_en: editDraft.grade_en,
        unit_id: editDraft.unit_id || null,
      });
      if (ok) cancelEditUser();
    } finally {
      setEditSaving(false);
    }
  };

  // [사용자 삭제]
  const handleDelete = async (userId: string) => {
    if (meId && userId === meId) {
      alert('본인 계정은 삭제할 수 없습니다.');
      return;
    }
    if (!confirm('⚠️ 정말 삭제하시겠습니까? 삭제된 정보는 복구할 수 없습니다.')) {
      return;
    }
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      fetchData();
    } else {
      alert(body.message || body.error || '삭제에 실패했습니다.');
    }
  };

  // [비밀번호 초기화] 임시 비밀번호 = 사번 + 다음 로그인 강제 변경
  const handleResetPassword = async (u: any) => {
    const empNo = String(u.employee_no || '').trim();
    if (!empNo) {
      alert('사번이 없어 비밀번호를 초기화할 수 없습니다.\n수정에서 사번을 먼저 등록해 주세요.');
      return;
    }
    if (
      !confirm(
        `${u.name} (${u.email}) 계정의 비밀번호를 사번으로 초기화하시겠습니까?\n\n` +
          `· 임시 비밀번호: 사번 (${empNo})\n` +
          `· 다음 로그인 시 비밀번호 변경이 필요합니다.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, action: 'resetPassword' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || data.error || '비밀번호 초기화에 실패했습니다.');
        return;
      }
      setTempPasswordModal({
        name: data.name || u.name,
        email: data.email || u.email,
        tempPassword: data.tempPassword || empNo,
      });
      await fetchData();
    } catch {
      alert('통신 중 오류가 발생했습니다.');
    }
  };

  const openJobOptionsModal = () => {
    setJobOptionsModal({
      duties: Array.isArray(data?.duties) && data.duties.length > 0
        ? data.duties.map((d: any) => ({ label: String(d.label || ''), value: String(d.value || '') }))
        : [...DEFAULT_USER_DUTY_OPTIONS],
      grades: Array.isArray(data?.grades) && data.grades.length > 0
        ? data.grades.map((g: any) => ({ label: String(g.label || ''), value: String(g.value || '') }))
        : [...DEFAULT_USER_GRADE_OPTIONS],
    });
  };

  const openCreateModal = () => {
    setCreateForm({ ...EMPTY_CREATE_FORM });
    setCreateModalOpen(true);
  };

  const handleCreateUser = async () => {
    const name = createForm.name.trim();
    const emailLocal = extractEmailLocalPart(createForm.emailLocal);
    if (!name) {
      alert('성명(한글)을 입력해 주세요.');
      return;
    }
    if (!emailLocal) {
      alert(`사내메일 앞자리를 입력해 주세요. (${COMPANY_EMAIL_SUFFIX})`);
      return;
    }

    const dutyOpt = (data?.duties || []).find((d: any) => d.label === createForm.duty);
    const gradeOpt = (data?.grades || []).find((g: any) => g.label === createForm.grade);

    setCreateSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          name_en: createForm.name_en.trim(),
          emailLocal,
          employee_no: createForm.employee_no.trim(),
          unit_id: createForm.unit_id || null,
          duty: createForm.duty,
          duty_en: dutyOpt?.value || '',
          grade: createForm.grade,
          grade_en: gradeOpt?.value || '',
          role: createForm.role,
          status: createForm.status,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.message || '신규 등록에 실패했습니다.');
        return;
      }
      setCreateModalOpen(false);
      setCreateForm({ ...EMPTY_CREATE_FORM });
      await fetchData();
      if (body.tempPassword) {
        setTempPasswordModal({
          name: body.user?.name || name,
          email: body.user?.email || `${emailLocal}${COMPANY_EMAIL_SUFFIX}`,
          tempPassword: body.tempPassword,
        });
      } else {
        alert(body.message || '등록되었습니다.');
      }
    } catch {
      alert('통신 중 오류가 발생했습니다.');
    } finally {
      setCreateSaving(false);
    }
  };

  const handleSaveJobOptions = async () => {
    if (!jobOptionsModal) return;
    setJobOptionsSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveJobOptions',
          duties: jobOptionsModal.duties,
          grades: jobOptionsModal.grades,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.message || '옵션 저장에 실패했습니다.');
        return;
      }
      setData((prev: any) =>
        prev
          ? { ...prev, duties: body.duties || jobOptionsModal.duties, grades: body.grades || jobOptionsModal.grades }
          : prev
      );
      setJobOptionsModal(null);
      alert(body.message || '저장되었습니다.');
    } catch {
      alert('통신 중 오류가 발생했습니다.');
    } finally {
      setJobOptionsSaving(false);
    }
  };

  const handleRestoreJobOptions = async () => {
    if (
      !confirm(
        '시드 기본 직책·직급 옵션으로 덮어쓸까요?\n현재 이 페이지에 저장된 옵션 목록이 기본값으로 바뀝니다.\n(이미 사용자에 저장된 직책/직급 값은 변경되지 않습니다.)'
      )
    ) {
      return;
    }
    setJobOptionsSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restoreJobOptions' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.message || '시드 복구에 실패했습니다.');
        return;
      }
      setJobOptionsModal({
        duties: body.duties || [...DEFAULT_USER_DUTY_OPTIONS],
        grades: body.grades || [...DEFAULT_USER_GRADE_OPTIONS],
      });
      setData((prev: any) =>
        prev ? { ...prev, duties: body.duties, grades: body.grades } : prev
      );
      alert(body.message || '시드 기본값으로 복구했습니다.');
    } catch {
      alert('통신 중 오류가 발생했습니다.');
    } finally {
      setJobOptionsSaving(false);
    }
  };

  if (!data) return <LoadingState />;

  // roles가 JSON 문자열로 올 수 있어 배열로 정규화
  const parseRoles = (roles: any): string[] => {
    if (Array.isArray(roles)) return roles.map(String);
    if (typeof roles === 'string' && roles.trim()) {
      try {
        const parsed = JSON.parse(roles);
        if (Array.isArray(parsed)) return parsed.map(String);
        return [String(parsed)];
      } catch {
        return roles.split(',').map((s: string) => s.trim().replace(/['"\[\]]/g, '')).filter(Boolean);
      }
    }
    return [];
  };

  // [지능형 필터] 조직이 없거나 비활성이면 '미지정' 간주
  const isUnassigned = (u: any) => !u.unit_id || u.unit?.is_active === false;

  const filteredUsers = data.users.filter((u: any) => {
    const roles = parseRoles(u.roles);
    if (activeFilter === 'LV_1') return roles.includes('LV_1');
    if (activeFilter === 'LV_2') return roles.includes('LV_2');
    if (activeFilter === 'UNASSIGNED') return isUnassigned(u);
    if (activeFilter === 'INACTIVE') return u.status?.toLowerCase() !== 'active';
    if (activeFilter === 'PW_RESET') return !!u.password_reset_requested;
    return true;
  }).filter((u: any) => {
    const s = searchTerm.toLowerCase().trim();
    if (!s) return true;
    return (
      u.name?.toLowerCase().includes(s) || 
      u.name_en?.toLowerCase().includes(s) ||
      u.employee_no?.toLowerCase().includes(s) ||
      u.unit?.unit_name?.toLowerCase().includes(s) || 
      u.email?.toLowerCase().includes(s) ||
      u.duty?.toLowerCase().includes(s) ||
      u.grade?.toLowerCase().includes(s)
    );
  });

  const handleExportExcel = () => {
    if (filteredUsers.length === 0) {
      alert('내보낼 사용자가 없습니다.');
      return;
    }
    const rows = filteredUsers.map((u: any, idx: number) => {
      const roles = parseRoles(u.roles);
      const unitName =
        !u.unit_id || u.unit?.is_active === false
          ? '조직 미지정'
          : u.unit?.unit_name || '조직 미지정';
      return {
        No: idx + 1,
        이메일: u.email || '',
        '성명(한글)': u.name || '',
        '성명(영문)': u.name_en || '',
        사번: u.employee_no || '',
        '직책(한글)': u.duty || '',
        '직책(영문)': u.duty_en || '',
        '직급(한글)': u.grade || '',
        '직급(영문)': u.grade_en || '',
        소속: unitName,
        권한: roles.join(', '),
        상태: u.status || '',
        '임시PW상태': u.must_reset_password ? 'Y' : 'N',
        'PW초기화요청': u.password_reset_requested ? 'Y' : 'N',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '사용자목록');
    const filterTag = activeFilter === 'ALL' ? '전체' : activeFilter;
    XLSX.writeFile(wb, `사용자목록_${filterTag}_${getKSTDateString()}.xlsx`);
  };

  return (
    <div className="p-8 space-y-8 min-h-screen bg-slate-50/50">
      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {loadError}
          <button
            type="button"
            onClick={() => fetchData()}
            className="ml-3 underline underline-offset-2 hover:text-rose-900"
          >
            다시 시도
          </button>
        </div>
      ) : null}
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">사용자 및 권한 관리</h2>
          <p className="text-sm text-gray-400 mt-1 font-medium italic">KPCQA ORGANIZATION 통합 인사 마스터 대시보드</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-4 py-2.5 bg-emerald-600 text-white rounded-2xl text-xs font-black shadow-sm hover:bg-emerald-700 transition-colors"
          >
            엑셀 다운
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2.5 bg-indigo-600 text-white rounded-2xl text-xs font-black shadow-sm hover:bg-indigo-700 transition-colors"
          >
            + 신규 인원 추가
          </button>
          <button
            type="button"
            onClick={openJobOptionsModal}
            className="px-4 py-2.5 bg-slate-800 text-white rounded-2xl text-xs font-black shadow-sm hover:bg-slate-900 transition-colors"
          >
            직책·직급 옵션 설정
          </button>
          <input 
            type="text" 
            placeholder="성명/영문명/사번/부서/직책/직급 검색..." 
            className="p-3 border border-gray-200 rounded-2xl text-sm w-80 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white transition-all font-bold"
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* 대시보드 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { id: 'ALL', label: '전체 사용자', count: data.stats.totalUsers, color: 'slate' },
          { id: 'LV_1', label: 'LV_1 [시스템 운영자]', count: data.users.filter((u:any)=>parseRoles(u.roles).includes('LV_1')).length, color: 'blue' },
          { id: 'LV_2', label: 'LV_2 [관리자]', count: data.users.filter((u:any)=>parseRoles(u.roles).includes('LV_2')).length, color: 'indigo' },
          { id: 'UNASSIGNED', label: '조직 미설정', count: data.users.filter((u:any) => isUnassigned(u)).length, color: 'orange' },
          { id: 'INACTIVE', label: '비활성/대기', count: data.users.filter((u:any)=>u.status?.toLowerCase() !== 'active').length, color: 'red' },
          { id: 'PW_RESET', label: '비밀번호 재설정 요청건', count: data.users.filter((u:any)=>!!u.password_reset_requested).length, color: 'amber' },
        ].map((card) => (
          <div 
            key={card.id} 
            onClick={() => setActiveFilter(card.id)} 
            className={`cursor-pointer p-5 rounded-[1.8rem] border transition-all duration-200 ${
              activeFilter === card.id 
                ? card.id === 'PW_RESET'
                  ? 'bg-white border-amber-500 shadow-md ring-2 ring-amber-500/10 scale-[1.02]'
                  : 'bg-white border-blue-500 shadow-md ring-2 ring-blue-500/10 scale-[1.02]' 
                : card.id === 'PW_RESET' && card.count > 0
                  ? 'bg-amber-50/80 border-amber-200 hover:shadow-sm hover:scale-[1.01]'
                  : 'bg-white border-gray-100 hover:shadow-sm hover:scale-[1.01]'
            }`}
          >
            <p className={`text-[10px] font-black uppercase tracking-tighter ${card.id === 'PW_RESET' ? 'text-amber-600' : 'text-slate-400'}`}>{card.label}</p>
            <h4 className={`text-2xl font-black mt-1 ${card.id === 'PW_RESET' && card.count > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{card.count}명</h4>
          </div>
        ))}
      </div>

      {/* 테이블 와이드 뷰포트 섹션 */}
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1200px]">
            <thead className="bg-slate-50 border-b font-bold text-slate-400 text-[10px] tracking-widest uppercase">
              <tr>
                <th className="p-6 w-44">사용자 성명 (국/영)</th>
                <th className="p-6 w-52">계정 정보 및 사번</th>
                <th className="p-6 w-44">직책 (국/영)</th>
                <th className="p-6 w-44">직급 (국/영)</th>
                <th className="p-6 w-48">소속 ORGANIZATION</th>
                <th className="p-6 text-center w-24">권한 레벨</th>
                <th className="p-6 text-center w-24">계정 상태</th>
                <th className="p-6 text-center w-40">관리 액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700 bg-white">
              {filteredUsers.map((u: any) => {
                const isEditing = editingUserId === u.id && !!editDraft;
                return (
                <tr key={u.id} className={`transition-colors h-20 ${isEditing ? 'bg-indigo-50/40' : 'hover:bg-slate-50/50'}`}>
                  
                  {/* 1️⃣ 사용자 성명 스택 */}
                  <td className="p-4 px-6">
                    <div className="flex flex-col gap-0.5">
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                            className="bg-white border border-indigo-200 rounded-lg px-2 py-1 outline-none font-black text-slate-800 text-sm focus:border-indigo-400"
                          />
                          <input
                            type="text"
                            placeholder="영문 성명"
                            value={editDraft.name_en}
                            onChange={(e) => setEditDraft({ ...editDraft, name_en: e.target.value })}
                            className="bg-white border border-indigo-200 rounded-lg px-2 py-1 outline-none font-bold text-slate-500 text-[10px] focus:border-indigo-400"
                          />
                        </>
                      ) : (
                        <>
                          <div className="font-black text-slate-800 text-sm py-0.5">{u.name}</div>
                          <div className="font-bold text-slate-400 text-[10px] py-0.5 min-h-[14px]">
                            {u.name_en || '영문 미등록'}
                          </div>
                        </>
                      )}
                    </div>
                  </td>

                  {/* 2️⃣ 계정 식별 및 사번 */}
                  <td className="p-4 px-6">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="text-slate-500 font-mono text-[11px] font-medium">{u.email}</div>
                        {u.password_reset_requested && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded text-[8px] font-black">
                            비번요청
                          </span>
                        )}
                      </div>
                      {isEditing ? (
                        <input
                          type="text"
                          placeholder="사번 미발급"
                          value={editDraft.employee_no}
                          onChange={(e) => setEditDraft({ ...editDraft, employee_no: e.target.value })}
                          className="bg-white px-2 py-1 border border-indigo-200 rounded-lg outline-none font-mono text-slate-600 text-[10px] w-36 focus:border-indigo-400"
                        />
                      ) : (
                        <div className="bg-slate-50/80 px-2 py-0.5 border border-slate-100 rounded font-mono text-slate-600 text-[10px] w-fit min-w-[5rem]">
                          {u.employee_no || '사번 미발급'}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* 3️⃣ 직책 */}
                  <td className="p-4 px-6">
                    <div className="flex flex-col gap-1">
                      {isEditing ? (
                        <select
                          value={editDraft.duty}
                          onChange={(e) => {
                            const targetLabel = e.target.value;
                            const matched = (data.duties || []).find((d: any) => d.label === targetLabel);
                            setEditDraft({
                              ...editDraft,
                              duty: targetLabel,
                              duty_en: matched ? matched.value : '',
                            });
                          }}
                          className="bg-white border border-indigo-200 text-slate-700 rounded-xl px-2 py-1.5 font-bold text-xs focus:outline-none cursor-pointer shadow-sm w-full"
                        >
                          <option value="">직책 없음</option>
                          {(data.duties || []).map((d: any) => (
                            <option key={d.label} value={d.label}>{d.label}</option>
                          ))}
                          {editDraft.duty && !(data.duties || []).some((d: any) => d.label === editDraft.duty) && (
                            <option value={editDraft.duty}>{editDraft.duty} (목록 외)</option>
                          )}
                        </select>
                      ) : (
                        <div className="px-2 py-1.5 text-slate-700 font-bold text-xs">
                          {u.duty || '직책 없음'}
                        </div>
                      )}
                      <div className="text-[9px] text-slate-400 font-mono min-h-[12px] pl-1 truncate" title={isEditing ? editDraft.duty_en : u.duty_en}>
                        {(isEditing ? editDraft.duty_en : u.duty_en) || '영문 미지정'}
                      </div>
                    </div>
                  </td>

                  {/* 4️⃣ 직급 */}
                  <td className="p-4 px-6">
                    <div className="flex flex-col gap-1">
                      {isEditing ? (
                        <select
                          value={editDraft.grade}
                          onChange={(e) => {
                            const targetLabel = e.target.value;
                            const matched = (data.grades || []).find((g: any) => g.label === targetLabel);
                            setEditDraft({
                              ...editDraft,
                              grade: targetLabel,
                              grade_en: matched ? matched.value : '',
                            });
                          }}
                          className="bg-white border border-indigo-200 text-slate-700 rounded-xl px-2 py-1.5 font-bold text-xs focus:outline-none cursor-pointer shadow-sm w-full"
                        >
                          <option value="">직급 미지정</option>
                          {(data.grades || []).map((g: any) => (
                            <option key={g.label} value={g.label}>{g.label}</option>
                          ))}
                          {editDraft.grade && !(data.grades || []).some((g: any) => g.label === editDraft.grade) && (
                            <option value={editDraft.grade}>{editDraft.grade} (목록 외)</option>
                          )}
                        </select>
                      ) : (
                        <div className="px-2 py-1.5 text-slate-700 font-bold text-xs">
                          {u.grade || '직급 미지정'}
                        </div>
                      )}
                      <div className="text-[9px] text-slate-400 font-mono min-h-[12px] pl-1 truncate" title={isEditing ? editDraft.grade_en : u.grade_en}>
                        {(isEditing ? editDraft.grade_en : u.grade_en) || '영문 미지정'}
                      </div>
                    </div>
                  </td>

                  {/* 5️⃣ 소속 조직 */}
                  <td className="p-4 px-6">
                    {isEditing ? (
                      <select
                        value={editDraft.unit_id}
                        onChange={(e) => setEditDraft({ ...editDraft, unit_id: e.target.value })}
                        className={`p-2 border rounded-xl text-xs font-bold w-full max-w-[180px] outline-none cursor-pointer shadow-sm transition-all ${
                          !editDraft.unit_id
                            ? 'border-orange-200 text-orange-600 bg-orange-50/30'
                            : 'border-indigo-200 bg-white text-slate-700'
                        }`}
                      >
                        <option value="">조직 미지정</option>
                        {units.map((unit: any) => (
                          <option key={unit.id} value={unit.id}>{unit.unit_name}</option>
                        ))}
                      </select>
                    ) : (
                      <div
                        className={`px-2 py-1.5 rounded-xl text-xs font-bold max-w-[180px] ${
                          isUnassigned(u)
                            ? 'text-orange-600 bg-orange-50/50'
                            : 'text-slate-700'
                        }`}
                      >
                        {isUnassigned(u) ? '조직 미지정' : (u.unit?.unit_name || '조직 미지정')}
                      </div>
                    )}
                  </td>

                  {/* 6️⃣ 권한 등급 뱃지 */}
                  <td className="p-4 text-center">
                    <div className="flex justify-center gap-1">
                      {parseRoles(u.roles).map((r: string) => (
                        <span key={r} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[9px] font-black border border-blue-100">{r}</span>
                      ))}
                    </div>
                  </td>

                  {/* 7️⃣ 계정 상태 토글 버튼 */}
                  <td className="p-4 text-center">
                    <button 
                      onClick={() => {
                        const nextStatus = u.status?.toLowerCase() === 'active' ? 'Suspended' : 'Active';
                        handleUpdate(u.id, { status: nextStatus });
                      }}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black transition-all ${
                        u.status?.toLowerCase() === 'active' 
                          ? 'bg-green-50 text-green-600 border border-green-200 hover:bg-green-100' 
                          : 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100'
                      }`}
                    >
                      {u.status?.toUpperCase() || 'PENDING'}
                    </button>
                  </td>

                  {/* 8️⃣ 제어 관리 액션 */}
                  <td className="p-4 text-center space-x-2 pr-6 whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          disabled={editSaving}
                          onClick={saveEditUser}
                          className="text-indigo-600 font-black text-xs hover:text-indigo-800 disabled:opacity-50"
                        >
                          {editSaving ? '저장중' : '저장'}
                        </button>
                        <button
                          type="button"
                          disabled={editSaving}
                          onClick={cancelEditUser}
                          className="text-slate-400 font-black text-xs hover:text-slate-600 disabled:opacity-50"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditUser(u)}
                          className="text-slate-700 font-black text-xs hover:text-indigo-600 transition-colors"
                        >
                          수정
                        </button>
                        <button onClick={() => {
                          const roles = parseRoles(u.roles);
                          const primary =
                            roles.includes('LV_1') ? 'LV_1' :
                            roles.includes('LV_2') ? 'LV_2' :
                            roles.includes('LV_3') ? 'LV_3' :
                            (roles[0] || 'LV_3');
                          setSelectedUser({ ...u, roles: [primary] });
                          setIsModalOpen(true);
                        }} className="text-slate-500 font-black text-xs hover:text-blue-600 transition-colors">권한설정</button>
                        <button
                          type="button"
                          onClick={() => handleResetPassword(u)}
                          className={`font-black text-xs transition-colors ${
                            u.must_reset_password
                              ? 'text-amber-500 hover:text-amber-700'
                              : 'text-amber-600 hover:text-amber-800'
                          }`}
                          title={
                            u.must_reset_password
                              ? '이미 강제 변경 대기 중 · 다시 클릭하면 사번으로 재설정'
                              : '임시 비밀번호=사번 · 다음 로그인 시 비밀번호 변경 강제'
                          }
                        >
                          PW초기화
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(u.id)}
                          disabled={!!meId && u.id === meId}
                          className={`font-black text-xs transition-colors ${
                            meId && u.id === meId
                              ? 'text-slate-200 cursor-not-allowed'
                              : 'text-slate-300 hover:text-rose-600'
                          }`}
                          title={
                            meId && u.id === meId
                              ? '본인 계정은 삭제할 수 없습니다'
                              : '사용자 삭제'
                          }
                        >
                          삭제
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 권한 설정 모달 — 단일 레벨만 선택 */}
      {isModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-md animate-in fade-in zoom-in duration-200 border border-slate-100">
            <h3 className="text-xl font-black text-slate-800 mb-2">{selectedUser.name} 님 권한 설정</h3>
            <p className="text-[11px] font-bold text-slate-400 mb-5">권한 레벨은 하나만 선택할 수 있습니다.</p>
            <div className="space-y-2.5 mb-6">
              {['LV_1', 'LV_2', 'LV_3'].map((role) => {
                const selected = (selectedUser.roles?.[0] || 'LV_3') === role;
                return (
                  <label
                    key={role}
                    className={`flex items-center gap-4 p-4 border rounded-2xl cursor-pointer transition-all ${
                      selected
                        ? 'border-blue-400 bg-blue-50/70 ring-1 ring-blue-200'
                        : 'border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="user-role-level"
                      className="w-4 h-4 accent-blue-600"
                      checked={selected}
                      onChange={() => setSelectedUser({ ...selectedUser, roles: [role] })}
                    />
                    <div>
                      <span className="font-black text-slate-700 text-sm">{role}</span>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {role === 'LV_1'
                          ? '[시스템 운영자]'
                          : role === 'LV_2'
                            ? '[관리자]'
                            : '[사용자]'}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-xl transition-colors">취소</button>
              <button
                onClick={() => {
                  const role = selectedUser.roles?.[0] || 'LV_3';
                  handleUpdate(selectedUser.id, { roles: [role] });
                }}
                className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg shadow-blue-600/20 text-sm hover:bg-blue-700 transition-colors"
              >
                설정 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 신규 인원 추가 */}
      {createModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl border border-slate-200/80 max-h-[92vh] overflow-hidden flex flex-col">
            <div className="px-8 pt-7 pb-5 border-b border-slate-100 shrink-0">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">신규 인원 추가</h3>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                등록 후 임시 비밀번호가 발급됩니다. 사번을 넣으면 사번이 임시 비밀번호가 되고, 없으면 랜덤 임시 비밀번호가 발급됩니다. 다음 로그인 시 비밀번호 변경이 필요합니다.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500">성명 (한글) *</span>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    placeholder="홍길동"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500">성명 (영문)</span>
                  <input
                    type="text"
                    value={createForm.name_en}
                    onChange={(e) => setCreateForm({ ...createForm, name_en: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    placeholder="Gil-dong Hong"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500">사내메일 *</span>
                  <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
                    <input
                      type="text"
                      value={createForm.emailLocal}
                      onChange={(e) => setCreateForm({ ...createForm, emailLocal: e.target.value })}
                      className="flex-1 px-3.5 py-2.5 text-sm outline-none bg-white"
                      placeholder="honggd"
                      autoComplete="off"
                    />
                    <span className="px-3 flex items-center bg-slate-50 text-slate-500 text-sm font-medium border-l border-slate-200 whitespace-nowrap">
                      {COMPANY_EMAIL_SUFFIX}
                    </span>
                  </div>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500">사번</span>
                  <input
                    type="text"
                    value={createForm.employee_no}
                    onChange={(e) => setCreateForm({ ...createForm, employee_no: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    placeholder="임시 비밀번호로 사용"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500">소속</span>
                  <select
                    value={createForm.unit_id}
                    onChange={(e) => setCreateForm({ ...createForm, unit_id: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-400 bg-white"
                  >
                    <option value="">조직 미지정</option>
                    {units.map((unit: any) => (
                      <option key={unit.id} value={unit.id}>{unit.unit_name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500">권한 레벨</span>
                  <select
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-400 bg-white"
                  >
                    <option value="LV_3">LV_3 [사용자]</option>
                    <option value="LV_2">LV_2 [관리자]</option>
                    <option value="LV_1">LV_1 [시스템 운영자]</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500">직책</span>
                  <select
                    value={createForm.duty}
                    onChange={(e) => setCreateForm({ ...createForm, duty: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-400 bg-white"
                  >
                    <option value="">직책 없음</option>
                    {(data.duties || []).map((d: any) => (
                      <option key={d.label} value={d.label}>{d.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500">직급</span>
                  <select
                    value={createForm.grade}
                    onChange={(e) => setCreateForm({ ...createForm, grade: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-400 bg-white"
                  >
                    <option value="">직급 미지정</option>
                    {(data.grades || []).map((g: any) => (
                      <option key={g.label} value={g.label}>{g.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1.5 block max-w-xs">
                <span className="text-xs font-semibold text-slate-500">계정 상태</span>
                <select
                  value={createForm.status}
                  onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-400 bg-white"
                >
                  <option value="Active">Active</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </label>
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/60 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={createSaving}
                onClick={() => setCreateModalOpen(false)}
                className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={createSaving}
                onClick={handleCreateUser}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
              >
                {createSaving ? '등록 중…' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 임시 비밀번호 표시 모달 */}
      {tempPasswordModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-slate-100">
            <h3 className="text-xl font-black text-slate-800 mb-2">임시 비밀번호 안내</h3>
            <p className="text-xs font-bold text-slate-500 mb-5 leading-relaxed">
              <span className="text-slate-800 font-black">{tempPasswordModal.name}</span>
              {' '}({tempPasswordModal.email}) 님에게 아래 임시 비밀번호를 전달해 주세요.
              <br />
              로그인 후 반드시 새 비밀번호로 변경하도록 안내해 주세요.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center mb-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Temporary Password
              </p>
              <p className="text-2xl font-black font-mono tracking-wider text-indigo-700 select-all">
                {tempPasswordModal.tempPassword}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(tempPasswordModal.tempPassword);
                    alert('임시 비밀번호가 클립보드에 복사되었습니다.');
                  } catch {
                    alert('복사에 실패했습니다. 직접 선택해 복사해 주세요.');
                  }
                }}
                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm hover:bg-indigo-700 transition-colors"
              >
                복사하기
              </button>
              <button
                type="button"
                onClick={() => setTempPasswordModal(null)}
                className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200 transition-colors"
              >
                닫기
              </button>
            </div>
            <p className="text-[10px] font-bold text-rose-500 text-center mt-4">
              비번초기화 시 임시 비밀번호는 사번과 동일합니다. 안내 후 창을 닫아 주세요.
            </p>
          </div>
        </div>
      )}

      {/* 직책·직급 옵션 설정 (이 페이지 전용 · 시드 복구) */}
      {jobOptionsModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[110] p-4 sm:p-6">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl border border-slate-200/80 max-h-[92vh] overflow-hidden flex flex-col">
            <div className="px-8 pt-7 pb-5 border-b border-slate-100 shrink-0">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">직책·직급 옵션 설정</h3>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                직책 및 직급 설정 화면입니다. 시드 기본값으로 복구할 수 있습니다.
                한글 선택 시 대응 영문이 사용자에게 자동 반영됩니다.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x lg:divide-slate-200">
                {/* 직책 */}
                <div className="lg:pr-8 space-y-4 pb-8 lg:pb-0 border-b border-slate-200 lg:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">직책</h4>
                      <p className="text-xs text-slate-400 mt-0.5">한글 / 영문 </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setJobOptionsModal({
                          ...jobOptionsModal,
                          duties: [...jobOptionsModal.duties, { label: '', value: '' }],
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                    >
                      + 추가
                    </button>
                  </div>

                  <div className="grid grid-cols-[1fr_1fr_2.5rem] gap-2 px-1">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">한글</span>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">영문</span>
                    <span />
                  </div>

                  <div className="space-y-2.5">
                    {jobOptionsModal.duties.map((row, idx) => (
                      <div key={`duty-${idx}`} className="grid grid-cols-[1fr_1fr_2.5rem] gap-2 items-center">
                        <input
                          type="text"
                          placeholder="예: 원장"
                          value={row.label}
                          onChange={(e) => {
                            const next = [...jobOptionsModal.duties];
                            next[idx] = { ...next[idx], label: e.target.value };
                            setJobOptionsModal({ ...jobOptionsModal, duties: next });
                          }}
                          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors"
                        />
                        <input
                          type="text"
                          placeholder="예: CEO"
                          value={row.value}
                          onChange={(e) => {
                            const next = [...jobOptionsModal.duties];
                            next[idx] = { ...next[idx], value: e.target.value };
                            setJobOptionsModal({ ...jobOptionsModal, duties: next });
                          }}
                          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 font-mono bg-slate-50/50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors"
                        />
                        <button
                          type="button"
                          title="삭제"
                          onClick={() =>
                            setJobOptionsModal({
                              ...jobOptionsModal,
                              duties: jobOptionsModal.duties.filter((_, i) => i !== idx),
                            })
                          }
                          className="h-10 w-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 직급 */}
                <div className="lg:pl-8 space-y-4 pt-8 lg:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">직급</h4>
                      <p className="text-xs text-slate-400 mt-0.5">한글 / 영문 </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setJobOptionsModal({
                          ...jobOptionsModal,
                          grades: [...jobOptionsModal.grades, { label: '', value: '' }],
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                    >
                      + 추가
                    </button>
                  </div>

                  <div className="grid grid-cols-[1fr_1fr_2.5rem] gap-2 px-1">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">한글</span>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">영문</span>
                    <span />
                  </div>

                  <div className="space-y-2.5">
                    {jobOptionsModal.grades.map((row, idx) => (
                      <div key={`grade-${idx}`} className="grid grid-cols-[1fr_1fr_2.5rem] gap-2 items-center">
                        <input
                          type="text"
                          placeholder="예: 수석전문위원"
                          value={row.label}
                          onChange={(e) => {
                            const next = [...jobOptionsModal.grades];
                            next[idx] = { ...next[idx], label: e.target.value };
                            setJobOptionsModal({ ...jobOptionsModal, grades: next });
                          }}
                          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors"
                        />
                        <input
                          type="text"
                          placeholder="예: Chief Expert Advisor"
                          value={row.value}
                          onChange={(e) => {
                            const next = [...jobOptionsModal.grades];
                            next[idx] = { ...next[idx], value: e.target.value };
                            setJobOptionsModal({ ...jobOptionsModal, grades: next });
                          }}
                          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 font-mono bg-slate-50/50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors"
                        />
                        <button
                          type="button"
                          title="삭제"
                          onClick={() =>
                            setJobOptionsModal({
                              ...jobOptionsModal,
                              grades: jobOptionsModal.grades.filter((_, i) => i !== idx),
                            })
                          }
                          className="h-10 w-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                disabled={jobOptionsSaving}
                onClick={handleRestoreJobOptions}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 transition-colors"
              >
                시드 기본값 복구
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={jobOptionsSaving}
                  onClick={() => setJobOptionsModal(null)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={jobOptionsSaving}
                  onClick={handleSaveJobOptions}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-colors"
                >
                  {jobOptionsSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}