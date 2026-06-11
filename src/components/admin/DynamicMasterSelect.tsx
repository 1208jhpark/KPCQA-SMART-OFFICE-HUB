'use client';
import { useState, useEffect } from 'react';

export default function DynamicMasterSelect() {
  const [masterData, setMasterData] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [subItems, setSubItems] = useState<any[]>([]);

  // 회원님의 통합 마스터 데이터 API 호출
  useEffect(() => {
    fetch('/api/admin/master-data')
      .then(res => res.json())
      .then(data => setMasterData(data));
  }, []);

  // Group 선택 시 하위 항목 필터링
  const handleGroupChange = (groupId: string) => {
    setSelectedGroupId(groupId);
    const selectedGroup = masterData.find(g => g.id === groupId);
    setSubItems(selectedGroup ? selectedGroup.codes : []);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">마스터 그룹</label>
        <select 
          onChange={(e) => handleGroupChange(e.target.value)}
          className="w-full border p-3 rounded-lg font-bold text-slate-700 outline-none focus:ring-2 ring-blue-500"
        >
          <option value="">그룹을 선택하세요</option>
          {masterData.map((group: any) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">세부 코드 항목</label>
        <select 
          className="w-full border p-3 rounded-lg font-bold text-slate-700 outline-none disabled:bg-slate-100"
          disabled={!selectedGroupId}
        >
          <option value="">{selectedGroupId ? '세부 항목 선택' : '먼저 그룹을 선택하세요'}</option>
          {subItems.map((item: any) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}