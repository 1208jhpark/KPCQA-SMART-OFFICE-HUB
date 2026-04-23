'use client';

import { useEffect, useState } from 'react';

export default function AdminUsersPage() {
  const [data, setData] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 데이터 실시간 로드 (캐시 무효화 포함)
  const fetchData = async () => {
    try {
      const [uRes, nRes] = await Promise.all([
        fetch('/api/admin/users', { cache: 'no-store' }),
        fetch('/api/admin/units?active=true', { cache: 'no-store' }) 
      ]);
      setData(await uRes.json());
      setUnits(await nRes.json());
    } catch (error) { console.error("데이터 동기화 실패"); }
  };

  useEffect(() => { fetchData(); }, []);

  // [수정/삭제 통합 함수] - 서버가 이해할 수 있게 Header를 강화했습니다.
  const handleUpdate = async (userId: string, payload: any) => {
    try {
      const res = await fetch('/api/admin/users', { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, // 이게 있어야 서버가 읽습니다!
        body: JSON.stringify({ userId, ...payload }) 
      });
      if (res.ok) { 
        await fetchData(); 
        setIsModalOpen(false); 
      } else {
        alert("서버 수정에 실패했습니다.");
      }
    } catch (error) { alert("통신 중 오류 발생"); }
  };

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

  if (!data) return <div className="p-10 text-center font-bold text-gray-400 italic">KPCQA 시스템 로딩 중...</div>;

  // [지능형 필터] 조직이 없거나 비활성이면 '미지정'으로 간주하지만 데이터는 유지함
  const isUnassigned = (u: any) => !u.unit_id || u.unit?.is_active === false;

  const filteredUsers = data.users.filter((u: any) => {
    if (activeFilter === 'LV_1') return u.roles?.includes('LV_1');
    if (activeFilter === 'LV_2') return u.roles?.includes('LV_2');
    if (activeFilter === 'UNASSIGNED') return isUnassigned(u);
    if (activeFilter === 'INACTIVE') return u.status?.toLowerCase() !== 'active';
    return true;
  }).filter((u: any) => {
    const s = searchTerm.toLowerCase().trim();
    if (!s) return true;
    return u.name?.toLowerCase().includes(s) || u.unit?.unit_name?.toLowerCase().includes(s) || u.email?.toLowerCase() === s;
  });

  return (
    <div className="p-8 space-y-8 min-h-screen">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">사용자 및 권한 관리</h2>
          <p className="text-sm text-gray-400 mt-1 font-medium italic">KPCQA ORGANIZATION 통합 대시보드</p>
        </div>
        <input 
          type="text" 
          placeholder="성명/부서 검색 (메일은 전체 입력)..." 
          className="p-3 border border-gray-200 rounded-2xl text-sm w-96 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* 5단계 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          { id: 'ALL', label: '전체 사용자', count: data.stats.totalUsers, color: 'slate' },
          { id: 'LV_1', label: '운영관리자(LV_1)', count: data.users.filter((u:any)=>u.roles?.includes('LV_1')).length, color: 'blue' },
          { id: 'LV_2', label: '센터관리자(LV_2)', count: data.users.filter((u:any)=>u.roles?.includes('LV_2')).length, color: 'indigo' },
          { id: 'UNASSIGNED', label: '조직 미설정', count: data.users.filter((u:any) => isUnassigned(u)).length, color: 'orange' },
          { id: 'INACTIVE', label: '비활성/대기', count: data.users.filter((u:any)=>u.status?.toLowerCase() !== 'active').length, color: 'red' },
        ].map((card) => (
          <div key={card.id} onClick={() => setActiveFilter(card.id)} className={`cursor-pointer p-5 rounded-[1.8rem] border transition-all ${activeFilter === card.id ? `bg-${card.color}-50 border-${card.color}-200 shadow-lg scale-105` : 'bg-white border-gray-100 hover:shadow-md'}`}>
            <p className={`text-[10px] font-black uppercase tracking-tighter text-${card.color}-400`}>{card.label}</p>
            <h4 className={`text-2xl font-black mt-1 text-${card.color}-600`}>{card.count}명</h4>
          </div>
        ))}
      </div>

      {/* 테이블 섹션 */}
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50/50 border-b font-bold text-gray-400 text-[10px] tracking-widest uppercase">
            <tr>
              <th className="p-6">사용자 정보</th>
              <th className="p-6">소속 ORGANIZATION</th>
              <th className="p-6 text-center">권한 레벨</th>
              <th className="p-6 text-center">계정 상태</th>
              <th className="p-6 text-center">관리 액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredUsers.map((u: any) => (
              <tr key={u.id} className="hover:bg-blue-50/10 transition-colors">
                <td className="p-6">
                  <div className="font-bold text-gray-900 text-base">{u.name}</div>
                  <div className="text-[11px] text-gray-400 font-medium">{u.email}</div>
                </td>
                <td className="p-6">
                  {/* [지능형 드롭다운] 부서가 비활성이면 '미지정'으로 보이지만, 내부 ID는 살아있음 */}
                  <select 
                    value={isUnassigned(u) ? "" : u.unit_id} 
                    onChange={(e) => handleUpdate(u.id, { unit_id: e.target.value })}
                    className={`p-2 border rounded-xl text-xs font-bold w-full max-w-[180px] ${isUnassigned(u) ? 'border-orange-200 text-orange-600 bg-orange-50/30' : 'border-gray-200 bg-white'}`}
                  >
                    <option value="">조직 미지정</option>
                    {units.map((unit: any) => (
                      <option key={unit.id} value={unit.id}>{unit.unit_name}</option>
                    ))}
                  </select>
                </td>
                <td className="p-6 text-center">
                  <div className="flex justify-center gap-1">
                    {u.roles?.map((r: string) => (
                      <span key={r} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[10px] font-black border border-blue-100">{r}</span>
                    ))}
                  </div>
                </td>
                <td className="p-6 text-center">
                  <button 
                    onClick={() => {
                      const nextStatus = u.status?.toLowerCase() === 'active' ? 'Suspended' : 'Active';
                      handleUpdate(u.id, { status: nextStatus });
                    }}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-black transition-all ${u.status?.toLowerCase() === 'active' ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}
                  >
                    {u.status?.toUpperCase() || 'UNKNOWN'}
                  </button>
                </td>
                <td className="p-6 text-center space-x-3">
                  <button onClick={() => { setSelectedUser({...u}); setIsModalOpen(true); }} className="text-slate-600 font-black text-xs hover:text-blue-600">권한설정</button>
                  <button onClick={() => handleDelete(u.id)} className="text-red-400 font-black text-xs hover:text-red-600">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 권한 설정 모달 */}
      {isModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white p-8 rounded-[3rem] shadow-2xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <h3 className="text-2xl font-black text-slate-800 mb-6">{selectedUser.name} 님 권한 설정</h3>
            <div className="space-y-3 mb-8">
              {['LV_1', 'LV_2', 'LV_3'].map((role) => (
                <label key={role} className="flex items-center gap-4 p-5 border border-gray-100 rounded-2xl hover:bg-blue-50 cursor-pointer transition-all">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 accent-blue-600"
                    checked={selectedUser.roles?.includes(role)}
                    onChange={(e) => {
                      const currentRoles = selectedUser.roles || [];
                      const newRoles = e.target.checked 
                        ? [...currentRoles, role] 
                        : currentRoles.filter((r: string) => r !== role);
                      setSelectedUser({ ...selectedUser, roles: Array.from(new Set(newRoles)) });
                    }}
                  />
                  <div>
                    <span className="font-black text-slate-700">{role}</span>
                    <p className="text-[11px] text-gray-400 mt-0.5">{role === 'LV_1' ? '전체 관리' : role === 'LV_2' ? '센터 관리' : '일반'}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-4">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-4 text-gray-400 font-bold">취소</button>
              <button onClick={() => handleUpdate(selectedUser.id, { roles: selectedUser.roles })} className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-100">설정 저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}