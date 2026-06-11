'use client';

import React, { useState, useEffect } from 'react';

export default function SettingsModule() {
  const [config, setConfig] = useState<any>({ unit_category_group: '' });
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. 시스템 설정 가져오기
      const configRes = await fetch('/api/admin/settings');
      if (configRes.ok) {
        const configData = await configRes.json();
        setConfig(configData);
      }
      
      // 2. 마스터 데이터 그룹 목록 가져오기 (API 경로는 실제 환경에 맞게 조정)
      const groupsRes = await fetch('/api/admin/master/groups'); 
      if (groupsRes.ok) {
        setGroups(await groupsRes.json());
      }
    } catch (e) {
      console.error("데이터 로드 실패");
    }
    setLoading(false);
  };

  const handleSave = async () => {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_category_group: config.unit_category_group })
    });

    if (res.ok) {
      alert('시스템 설정이 저장되었습니다.');
    } else {
      alert('저장 실패');
    }
  };

  if (loading) return <div className="p-10 font-black animate-pulse">Loading Settings...</div>;

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 font-sans">
      <div className="bg-slate-900 text-white p-8 rounded-[2rem] shadow-xl">
        <h2 className="text-2xl font-black mb-2 flex items-center gap-3"><span>⚙️</span> 시스템 글로벌 설정</h2>
        <p className="text-slate-400 font-bold text-sm">각종 모듈에서 공통으로 사용하는 마스터 데이터를 매핑합니다.</p>
      </div>

      <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
        <div>
          <label className="block text-xs font-black text-slate-500 uppercase mb-2">
            소모품 단위 마스터 데이터 그룹 매핑
          </label>
          <div className="flex gap-4">
            <select 
              value={config.unit_category_group || ''} 
              onChange={e => setConfig({...config, unit_category_group: e.target.value})}
              className="flex-1 p-4 border border-slate-300 rounded-xl font-bold bg-slate-50 outline-none focus:border-indigo-500"
            >
              <option value="">-- 마스터 데이터 그룹 선택 --</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name} ({g.code})</option>
              ))}
            </select>
            <button 
              onClick={handleSave}
              className="bg-indigo-600 text-white px-8 py-4 rounded-xl font-black shadow-md hover:bg-indigo-700 transition-colors"
            >
              저장
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 font-bold">
            💡 여기서 선택한 마스터 그룹의 하위 코드들이 소모품 등록 시 '단위(박스, EA 등)' 드롭다운에 노출됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}