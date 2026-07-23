'use client';

import { useEffect, useState } from 'react';

export default function AdminUsersPage() {
  const [data, setData] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempPasswordModal, setTempPasswordModal] = useState<{
    name: string;
    email: string;
    tempPassword: string;
  } | null>(null);

  // 데이터 실시간 로드 (부서 및 유저 병렬 호출 - 직책/직급 마스터 번들 포함)
  const fetchData = async () => {
    try {
      const [uRes, nRes] = await Promise.all([
        fetch('/api/admin/users', { cache: 'no-store' }),
        fetch('/api/admin/units?active=true', { cache: 'no-store' }) 
      ]);
      setData(await uRes.json());
      setUnits(await nRes.json());
    } catch (error) { 
      console.error("데이터 동기화 실패"); 
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
      } else {
        alert("서버 수정에 실패했습니다.");
      }
    } catch (error) { 
      alert("통신 중 오류 발생"); 
    }
  };

  // [사용자 삭제 함수]
  const handleDelete = async (userId: string) => {
    if (confirm("⚠️ 정말 삭제하시겠습니까? 삭제된 정보는 복구할 수 없습니다.")) {
      const res = await fetch('/api/admin/users', { 
        method: 'DELETE', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }) 
      });
      if (res.ok) fetchData();
    }
  };

  // [관리자 비밀번호 강제 초기화]
  const handleResetPassword = async (u: any) => {
    if (!confirm(`${u.name} (${u.email}) 계정의 비밀번호를 임시 비밀번호로 초기화할까요습니까?\n\n사용자는 다음 로그인 시 새 비밀번호로 변경해야 합니다.`)) {
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
        tempPassword: data.tempPassword,
      });
      await fetchData();
    } catch {
      alert('통신 중 오류가 발생했습니다.');
    }
  };

  if (!data) return <div className="p-10 text-center font-bold text-gray-400 italic">KPCQA 시스템 로딩 중...</div>;

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

  return (
    <div className="p-8 space-y-8 min-h-screen bg-slate-50/50">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">사용자 및 권한 관리</h2>
          <p className="text-sm text-gray-400 mt-1 font-medium italic">KPCQA ORGANIZATION 통합 인사 마스터 대시보드</p>
        </div>
        <input 
          type="text" 
          placeholder="성명/영문명/사번/부서/직책/직급 검색..." 
          className="p-3 border border-gray-200 rounded-2xl text-sm w-96 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white transition-all font-bold"
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* 대시보드 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { id: 'ALL', label: '전체 사용자', count: data.stats.totalUsers, color: 'slate' },
          { id: 'LV_1', label: '운영관리자(LV_1)', count: data.users.filter((u:any)=>parseRoles(u.roles).includes('LV_1')).length, color: 'blue' },
          { id: 'LV_2', label: '센터장 이상(LV_2)', count: data.users.filter((u:any)=>parseRoles(u.roles).includes('LV_2')).length, color: 'indigo' },
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
                <th className="p-6 w-44">직책 (보직 마스터)</th>
                <th className="p-6 w-44">직급 (자격 마스터)</th>
                <th className="p-6 w-48">소속 ORGANIZATION</th>
                <th className="p-6 text-center w-24">권한 레벨</th>
                <th className="p-6 text-center w-24">계정 상태</th>
                <th className="p-6 text-center w-40">관리 액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700 bg-white">
              {filteredUsers.map((u: any) => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors h-20">
                  
                  {/* 1️⃣ 사용자 성명 스택 */}
                  <td className="p-4 px-6">
                    <div className="flex flex-col gap-0.5">
                      <input 
                        type="text"
                        defaultValue={u.name}
                        onBlur={(e) => e.target.value !== u.name && handleUpdate(u.id, { name: e.target.value })}
                        className="bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 outline-none font-black text-slate-800 text-sm py-0.5 transition-all"
                      />
                      <input 
                        type="text"
                        placeholder="영문 성명 입력"
                        defaultValue={u.name_en || ''}
                        onBlur={(e) => e.target.value !== (u.name_en || '') && handleUpdate(u.id, { name_en: e.target.value })}
                        className="bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 outline-none font-bold text-slate-400 text-[10px] py-0.5 transition-all"
                      />
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
                      <input 
                        type="text"
                        placeholder="사번 미발급"
                        defaultValue={u.employee_no || ''}
                        onBlur={(e) => e.target.value !== (u.employee_no || '') && handleUpdate(u.id, { employee_no: e.target.value })}
                        className="bg-slate-50/80 px-2 py-0.5 border border-slate-100 hover:border-slate-200 focus:border-blue-400 rounded outline-none font-mono text-slate-600 text-[10px] w-36 transition-all"
                      />
                    </div>
                  </td>

                  {/* 3️⃣ 직책(보직) 마스터 연동 드롭다운 구역 */}
                  <td className="p-4 px-6">
                    <div className="flex flex-col gap-1">
                      <select
                        value={u.duty || ''}
                        onChange={(e) => {
                          const targetLabel = e.target.value;
                          const matched = data.duties?.find((d: any) => d.label === targetLabel);
                          handleUpdate(u.id, { 
                            duty: targetLabel, 
                            duty_en: matched ? matched.value : '' 
                          });
                        }}
                        className="bg-white border border-slate-200 text-slate-700 rounded-xl px-2 py-1.5 font-bold text-xs focus:outline-none cursor-pointer shadow-sm w-full"
                      >
                        <option value="">직책 없음</option>
                        {data.duties?.map((d: any) => (
                          <option key={d.id} value={d.label}>{d.label}</option>
                        ))}
                      </select>
                      <div className="text-[9px] text-slate-400 font-mono min-h-[12px] pl-1 truncate" title={u.duty_en}>
                        {u.duty_en || '영문 보직 미매핑'}
                      </div>
                    </div>
                  </td>

                  {/* 4️⃣ 직급(자격) 마스터 연동 드롭다운 구역 */}
                  <td className="p-4 px-6">
                    <div className="flex flex-col gap-1">
                      <select
                        value={u.grade || ''}
                        onChange={(e) => {
                          const targetLabel = e.target.value;
                          const matched = data.grades?.find((g: any) => g.label === targetLabel);
                          handleUpdate(u.id, { 
                            grade: targetLabel, 
                            grade_en: matched ? matched.value : '' 
                          });
                        }}
                        className="bg-white border border-slate-200 text-slate-700 rounded-xl px-2 py-1.5 font-bold text-xs focus:outline-none cursor-pointer shadow-sm w-full"
                      >
                        <option value="">직급 미지정</option>
                        {data.grades?.map((g: any) => (
                          <option key={g.id} value={g.label}>{g.label}</option>
                        ))}
                      </select>
                      <div className="text-[9px] text-slate-400 font-mono min-h-[12px] pl-1 truncate" title={u.grade_en}>
                        {u.grade_en || '영문 직급 미매핑'}
                      </div>
                    </div>
                  </td>

                  {/* 5️⃣ 소속 조직 매핑 */}
                  <td className="p-4 px-6">
                    <select 
                      value={isUnassigned(u) ? "" : u.unit_id} 
                      onChange={(e) => handleUpdate(u.id, { unit_id: e.target.value || null })}
                      className={`p-2 border rounded-xl text-xs font-bold w-full max-w-[180px] outline-none cursor-pointer shadow-sm transition-all ${
                        isUnassigned(u) 
                          ? 'border-orange-200 text-orange-600 bg-orange-50/30' 
                          : 'border-slate-200 bg-white text-slate-700 focus:border-blue-500'
                      }`}
                    >
                      <option value="">조직 미지정</option>
                      {units.map((unit: any) => (
                        <option key={unit.id} value={unit.id}>{unit.unit_name}</option>
                      ))}
                    </select>
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
                    <button onClick={() => handleResetPassword(u)} className="text-amber-600 font-black text-xs hover:text-amber-700 transition-colors">비번초기화</button>
                    <button onClick={() => handleDelete(u.id)} className="text-slate-300 font-black text-xs hover:text-rose-600 transition-colors">삭제</button>
                  </td>
                </tr>
              ))}
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
                          ? '운영 관리자 권한'
                          : role === 'LV_2'
                            ? '센터장 이상 관리자 권한'
                            : '일반 임직원 권한'}
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

      {/* 임시 비밀번호 표시 모달 */}
      {tempPasswordModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-slate-100">
            <h3 className="text-xl font-black text-slate-800 mb-2">임시 비밀번호 발급 완료</h3>
            <p className="text-xs font-bold text-slate-500 mb-5 leading-relaxed">
              <span className="text-slate-800 font-black">{tempPasswordModal.name}</span>
              {' '}({tempPasswordModal.email}) 님에게 아래 임시 비밀번호를 전달해 주세요.
              <br />
              로그인 후 반드시 새 비밀번호로 변경하도록 안내해 주세요.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center mb-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Temporary Password</p>
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
              이 창을 닫으면 임시 비밀번호를 다시 볼 수 없습니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}