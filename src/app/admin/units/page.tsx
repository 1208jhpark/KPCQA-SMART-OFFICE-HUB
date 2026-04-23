'use client';

import { useEffect, useState } from 'react';

export default function AdminUnitsPage() {
  const [units, setUnits] = useState<any[]>([]);
  const [newUnit, setNewUnit] = useState({ 
    unit_name: '', 
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
        body: JSON.stringify({ id, ...payload }) 
      });
      if (res.ok) await fetchUnits();
    } catch (error) {
      alert("수정 오류 발생");
    }
  };

  const handleAdd = async () => {
    if (!newUnit.unit_name.trim()) return alert("조직 명칭을 입력해 주세요.");
    const res = await fetch('/api/admin/units', { 
      method: 'POST', 
      body: JSON.stringify(newUnit) 
    });
    if (res.ok) {
      setNewUnit({ unit_name: '', unit_type: 'CENTER', parent_id: '', sort_order: 0 });
      fetchUnits();
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("⚠️ 삭제하더라도 기존 데이터는 보존되나 신규 배정은 불가합니다. 삭제하시겠습니까?")) {
      const res = await fetch('/api/admin/units', { method: 'DELETE', body: JSON.stringify({ id }) });
      if (!res.ok) alert((await res.json()).message);
      else fetchUnits();
    }
  };

  return (
    <div className="p-8 space-y-8 min-h-screen">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">전사 조직 관리 (ORGANIZATION)</h2>
          <p className="text-sm text-gray-400 mt-1 font-medium italic">KPCQA 체계 기반의 조직 위계를 관리합니다.</p>
        </div>
        
        {/* 신규 조직 추가 바 */}
        <div className="flex gap-2 bg-blue-50 p-3 rounded-[2rem] border border-blue-100 shadow-sm items-center">
          <select 
            value={newUnit.unit_type} 
            onChange={e => setNewUnit({...newUnit, unit_type: e.target.value})} 
            className="p-2 border-0 rounded-xl text-xs font-bold bg-white outline-none"
          >
            <option value="ORGANIZATION">ORGANIZATION</option>
            <option value="HQ">HQ (본부)</option>
            <option value="CENTER">CENTER (센터)</option>
          </select>
          <input 
            type="text" 
            placeholder="새 조직 명칭" 
            value={newUnit.unit_name} 
            onChange={e => setNewUnit({...newUnit, unit_name: e.target.value})} 
            className="p-2 border-0 rounded-xl text-xs w-48 outline-none" 
          />
          <select 
            value={newUnit.parent_id} 
            onChange={e => setNewUnit({...newUnit, parent_id: e.target.value})} 
            className="p-2 border-0 rounded-xl text-xs font-bold bg-white outline-none"
          >
            <option value="">KPCQA (전사 기본)</option>
            {units.filter(u => u.unit_type === 'HQ').map((u:any) => (
              <option key={u.id} value={u.id}>{u.unit_name}</option>
            ))}
          </select> 
          <button onClick={handleAdd} className="bg-blue-600 text-white px-5 py-2 rounded-xl text-xs font-black">추가</button>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50/50 border-b font-bold text-gray-400 uppercase text-[10px] tracking-widest">
            <tr>
              <th className="p-6">유형</th>
              <th className="p-6">조직 명칭 (수정 가능)</th>
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
                    className="p-1 border border-transparent rounded bg-transparent text-[10px] font-black uppercase disabled:cursor-not-allowed"
                  >
                    <option value="ORGANIZATION">ORGANIZATION</option>
                    <option value="HQ">HQ</option>
                    <option value="CENTER">CENTER</option>
                  </select>
                </td>

                {/* 2. 조직 명칭 (비활성 시 잠금) */}
                <td className="p-6">
                  <input 
                    disabled={!u.is_active}
                    type="text" 
                    defaultValue={u.unit_name} 
                    onBlur={(e) => e.target.value !== u.unit_name && handleLiveUpdate(u.id, { unit_name: e.target.value })}
                    className="p-2 border-b-2 border-transparent focus:border-blue-500 focus:outline-none bg-transparent font-black text-slate-700 w-full transition-all disabled:text-gray-400"
                  />
                </td>

                {/* 3. 상위 조직 선택 (비활성 시 잠금) */}
                <td className="p-6">
                  {u.unit_type === 'ORGANIZATION' ? (
                    <div className="text-gray-300 font-black text-[10px] italic bg-gray-50 py-2 px-3 rounded-lg border border-dashed border-gray-200 text-center">
                      KPCQA (최상위 법인)
                    </div>
                  ) : (
                    <select 
                      disabled={!u.is_active}
                      value={u.parent_id || ''} 
                      onChange={(e) => handleLiveUpdate(u.id, { parent_id: e.target.value || null })}
                      className="p-2 border border-gray-100 rounded-xl text-xs bg-white w-full max-w-[200px] font-black text-blue-600 disabled:text-gray-300"
                    >
                      <option value="">KPCQA (전사)</option>
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
                    onBlur={(e) => handleLiveUpdate(u.id, { sort_order: parseInt(e.target.value) })}
                    className="w-12 text-center border-b border-transparent bg-transparent text-xs font-bold text-gray-500 disabled:opacity-30"
                  />
                </td>

                {/* 5. 상태 및 삭제 제어 (언제나 가능) */}
                <td className="p-6 text-center space-x-3">
                  <button 
                    onClick={() => handleLiveUpdate(u.id, { is_active: !u.is_active })}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-black transition-all ${
                      u.is_active ? 'text-green-600 bg-green-50 hover:bg-green-100' : 'text-gray-400 bg-gray-100 hover:bg-gray-200'
                    }`}
                  >
                    {u.is_active ? '활성' : '비활성'}
                  </button>
                  <button onClick={() => handleDelete(u.id)} className="text-red-300 font-bold text-xs hover:text-red-600">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}