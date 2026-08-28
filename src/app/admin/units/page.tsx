'use client';

import { useEffect, useState } from 'react';

export default function AdminUnitsPage() {
  const [units, setUnits] = useState<any[]>([]);
  const [newUnit, setNewUnit] = useState({ 
    unit_name: '', 
    unit_name_en: '',
    unit_code: '',
    unit_type: 'CENTER', 
    parent_id: '', 
    sort_order: 0 
  });

  const fetchUnits = async () => {
    try {
      const res = await fetch('/api/admin/units');
      setUnits(await res.json());
    } catch (error) {
      console.error("조직 데이터 로드 실패");
    }
  };

  useEffect(() => { fetchUnits(); }, []);

  const handleLiveUpdate = async (id: string, payload: any) => {
    try {
      const res = await fetch('/api/admin/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      });
      if (res.ok) {
        await fetchUnits();
        return true;
      }
      const data = await res.json().catch(() => ({}));
      alert(data.message || '조직 정보 저장에 실패했습니다.');
      await fetchUnits();
      return false;
    } catch (error) {
      alert('수정 오류 발생');
      return false;
    }
  };

  const handleAdd = async () => {
    if (!newUnit.unit_name.trim()) return alert("조직 명칭(국문)을 입력해 주세요.");
    if (!newUnit.unit_code.trim()) return alert("조직코드(unit_code)를 입력해 주세요. (예: PMD, PMC)");
    const res = await fetch('/api/admin/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUnit),
    });
    if (res.ok) {
      setNewUnit({ unit_name: '', unit_name_en: '', unit_code: '', unit_type: 'CENTER', parent_id: '', sort_order: 0 });
      fetchUnits();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.message || '조직 추가에 실패했습니다.');
    }
  };

  return (
    <div className="p-8 space-y-8 min-h-screen">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">전사 조직 관리 (ORGANIZATION)</h2>
          <p className="text-sm text-gray-400 mt-1 font-medium italic">KPCQA 체계 기반의 조직 위계를 관리합니다.</p>
        </div>
        
        {/* 🚀 신규 조직 추가 바 확장 (영문명 기입 인풋 추가) */}
        <div className="flex gap-2 bg-blue-50 p-3 rounded-[2rem] border border-blue-100 shadow-sm items-center">
          <select 
            value={newUnit.unit_type} 
            onChange={e => setNewUnit({...newUnit, unit_type: e.target.value})} 
            className="p-2 border-0 rounded-xl text-xs font-bold bg-white outline-none"
          >
            <option value="ORGANIZATION">ORGANIZATION</option>
            <option value="HQ">HQ (본부)</option>
            <option value="CENTER">CENTER (센터)</option>
            <option value="DEPT">TEAM (팀)</option>
          </select>
          
          <input 
            type="text" 
            placeholder="새 조직 명칭 (국문)" 
            value={newUnit.unit_name} 
            onChange={e => setNewUnit({...newUnit, unit_name: e.target.value})} 
            className="p-2 border-0 rounded-xl text-xs w-40 outline-none font-bold" 
          />

          {/* 💡 [신설] 영문 조직명 입력란 */}
          <input 
            type="text" 
            placeholder="조직코드 (예: PMD, PMC)" 
            value={newUnit.unit_code} 
            onChange={e => setNewUnit({...newUnit, unit_code: e.target.value.toUpperCase()})} 
            className="p-2 border-0 rounded-xl text-xs w-28 outline-none font-black uppercase" 
          />

          <input 
            type="text" 
            placeholder="조직 명칭 (영문)" 
            value={newUnit.unit_name_en} 
            onChange={e => setNewUnit({...newUnit, unit_name_en: e.target.value})} 
            className="p-2 border-0 rounded-xl text-xs w-48 outline-none font-bold" 
          />

          <select 
            value={newUnit.parent_id} 
            onChange={e => setNewUnit({...newUnit, parent_id: e.target.value})} 
            className="p-2 border-0 rounded-xl text-xs font-bold bg-white outline-none"
          >
            <option value="">최상위 (상위 없음)</option>
            {units.filter(u => u.unit_type === 'HQ' || u.unit_type === 'ORGANIZATION').map((u:any) => (
              <option key={u.id} value={u.id}>{u.unit_name}</option>
            ))}
          </select> 
          <button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-xs font-black transition-colors">추가</button>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50/50 border-b font-bold text-gray-400 uppercase text-[10px] tracking-widest">
            <tr>
              <th className="p-6">유형</th>
              <th className="p-6">조직 명칭 (수정 가능)</th>
              <th className="p-6">조직코드</th>
              <th className="p-6">상위 조직 (이동 가능)</th>
              <th className="p-6">관리자(LV.2)</th>
              <th className="p-6 text-center">정렬</th>
              <th className="p-6 text-center">상태 / 제어</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {units.map((u: any) => (
              <tr key={u.id} className={`transition-all ${!u.is_active ? 'bg-gray-100/50 opacity-60' : 'hover:bg-blue-50/10'}`}>
                
                {/* 1. 유형 선택 (비활성 시 잠금) */}
                <td className="p-6">
                  <select 
                    disabled={!u.is_active}
                    value={u.unit_type} 
                    onChange={(e) => handleLiveUpdate(u.id, { unit_type: e.target.value })}
                    className="p-1 border border-transparent rounded bg-transparent text-[10px] font-black uppercase disabled:cursor-not-allowed cursor-pointer"
                  >
                    <option value="ORGANIZATION">ORGANIZATION</option>
                    <option value="HQ">HQ</option>
                    <option value="CENTER">CENTER</option>
                    <option value="DEPT">TEAM</option>
                  </select>
                </td>

                {/* 2. 조직 명칭 세로 스택 (국문명 + 영문명 개별 갱신 장착) */}
                <td className="p-6">
                  <div className="flex flex-col gap-0.5 max-w-xs">
                    {/* 국문명 인풋 */}
                    <input 
                      disabled={!u.is_active}
                      type="text" 
                      defaultValue={u.unit_name} 
                      onBlur={(e) => e.target.value !== u.unit_name && handleLiveUpdate(u.id, { unit_name: e.target.value })}
                      className="p-1 border-b border-transparent focus:border-blue-500 focus:outline-none bg-transparent font-black text-slate-800 w-full transition-all disabled:text-gray-400 text-xs"
                    />
                    {/* 💡 [신설] 영문명 인풋: 국문명 바로 아래 은은한 톤으로 배치 및 포커싱 시 블루 라인 제어 */}
                    <input 
                      disabled={!u.is_active}
                      type="text" 
                      placeholder="영문 명칭 미지정"
                      defaultValue={u.unit_name_en || ''} 
                      onBlur={(e) => e.target.value !== (u.unit_name_en || '') && handleLiveUpdate(u.id, { unit_name_en: e.target.value })}
                      className="p-1 border-b border-transparent focus:border-blue-500 focus:outline-none bg-transparent font-bold text-slate-400 w-full transition-all disabled:text-gray-300 text-[10px]"
                    />
                  </div>
                </td>

                <td className="p-6">
                  <input
                    key={`${u.id}-${u.unit_code || ''}`}
                    disabled={!u.is_active}
                    type="text"
                    placeholder="PMD"
                    defaultValue={u.unit_code || ''}
                    onBlur={(e) => {
                      const next = e.target.value.trim().toUpperCase();
                      if (next !== (u.unit_code || '')) {
                        handleLiveUpdate(u.id, { unit_code: next });
                      }
                    }}
                    className="w-24 p-1.5 border border-slate-200 rounded-lg text-[11px] font-black font-mono text-indigo-700 bg-indigo-50/50 outline-none focus:border-indigo-400 disabled:opacity-40 uppercase"
                    title="제작물 관리번호용 고정 코드 (변경 시 신규 번호에만 반영)"
                  />
                </td>

                {/* 3. 상위 조직 선택 (비활성 시 잠금) */}
                <td className="p-6">
                  {u.unit_type === 'ORGANIZATION' ? (
                    <div className="text-gray-300 font-black text-[10px] italic bg-gray-50 py-2 px-3 rounded-lg border border-dashed border-gray-200 text-center">
                      최상위 법인 (상위 없음)
                    </div>
                  ) : (
                    <select 
                      disabled={!u.is_active}
                      value={u.parent_id || ''} 
                      onChange={(e) => handleLiveUpdate(u.id, { parent_id: e.target.value || null })}
                      className="p-2 border border-gray-100 rounded-xl text-xs bg-white w-full max-w-[200px] font-black text-blue-600 disabled:text-gray-300 cursor-pointer shadow-sm"
                    >
                      <option value="">최상위 (상위 없음)</option>
                      {units.filter(t => (t.unit_type === 'HQ' || t.unit_type === 'ORGANIZATION') && t.id !== u.id).map((hq: any) => (
                        <option key={hq.id} value={hq.id}>{hq.unit_name}</option>
                      ))}
                    </select>
                  )}
                </td>

                <td className="p-6 text-gray-400 font-bold text-[10px]">
                  {u.users?.map((usr:any) => usr.name).join(', ') || '미지정'}
                </td>

                {/* 4. 정렬 순서 (비활성 시 잠금) */}
                <td className="p-6 text-center">
                  <input 
                    disabled={!u.is_active}
                    type="number" 
                    defaultValue={u.sort_order} 
                    onBlur={(e) => handleLiveUpdate(u.id, { sort_order: parseInt(e.target.value) || 0 })}
                    className="w-12 text-center border-b border-transparent bg-transparent text-xs font-bold text-gray-500 disabled:opacity-30 focus:outline-none focus:border-blue-500"
                  />
                </td>

                {/* 🚨 [지침 완벽 반영] 삭제 버튼 영구 퇴출 -> 활성/비활성 및 표시/숨김 스위치 멀티 체인 셋 구축 */}
                <td className="p-6 text-center">
                  <div className="flex items-center justify-center gap-3">
                    {/* 활성 / 비활성 토글 */}
                    <button 
                      onClick={() => handleLiveUpdate(u.id, { is_active: !u.is_active })}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border shadow-sm ${
                        u.is_active 
                          ? 'text-green-600 bg-green-50 border-green-200 hover:bg-green-100' 
                          : 'text-gray-400 bg-gray-100 border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      {u.is_active ? '● 활성' : '○ 비활성'}
                    </button>

                    {/* 표시 / 숨김 토글 (Prisma의 is_visible 필드와 완벽 매핑 작동) */}
                    <button 
                      onClick={() => handleLiveUpdate(u.id, { is_visible: !u.is_visible })}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border shadow-sm ${
                        u.is_visible 
                          ? 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100' 
                          : 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      {u.is_visible ? '👁️ 표시' : '🙈 숨김'}
                    </button>
                  </div>
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}