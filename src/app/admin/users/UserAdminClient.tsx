"use client";
  
import { useState, useMemo } from "react";
  
export default function UserAdminClient({ initialUsers, departments, masterGroups }: any) {
  const [selectedParentId, setSelectedParentId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  
  // 🚀 조직계층필터 로직: 상위 선택 시 하위 자동 필터링
  const childDepartments = useMemo(() => {
    if (!selectedParentId) return [];
    return departments.filter((d: any) => d.parent_id === selectedParentId);
  }, [selectedParentId, departments]);
  
  // 🚀 마스터데이터셀렉 로직: 그룹 선택 시 세부 항목 로드
  const subItems = useMemo(() => {
    if (!selectedGroupId) return [];
    const group = masterGroups.find((g: any) => g.id === selectedGroupId);
    return group ? group.codes : [];
  }, [selectedGroupId, masterGroups]);
  
  return (
    <div className="space-y-6">
      {/* 🛠️ 관리 도구 섹션 (상단 배치) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* 1. 조직 계층 필터 */}
        <div className="bg-white p-6 rounded-xl border-2 border-slate-200 shadow-sm">
          <h2 className="text-sm font-black mb-4 text-slate-800 border-b pb-2 uppercase tracking-widest">조직 계층 필터</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">상위 조직 (HQ)</label>
              <select 
                onChange={(e) => setSelectedParentId(e.target.value)}
                className="w-full mt-1 p-3 border border-slate-200 rounded-lg font-bold text-sm outline-none focus:ring-2 ring-indigo-500"
              >
                <option value="">본부/조직 선택</option>
                {departments.filter((d: any) => !d.parent_id).map((d: any) => (
                  <option key={d.id} value={d.id}>{d.unit_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">하위 조직 (Center)</label>
              <select className="w-full mt-1 p-3 border border-slate-200 rounded-lg bg-slate-50 font-bold text-sm outline-none">
                <option value="">{childDepartments.length > 0 ? "센터 선택" : "상위 먼저 선택"}</option>
                {childDepartments.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.unit_name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
  
        {/* 2. 마스터 데이터 Select */}
        <div className="bg-white p-6 rounded-xl border-2 border-slate-200 shadow-sm">
          <h2 className="text-sm font-black mb-4 text-slate-800 border-b pb-2 uppercase tracking-widest">마스터 데이터 Select</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">카테고리 그룹</label>
              <select 
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full mt-1 p-3 border border-slate-200 rounded-lg font-bold text-sm outline-none focus:ring-2 ring-indigo-500"
              >
                <option value="">그룹 선택</option>
                {masterGroups.map((g: any) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">세부 코드 항목</label>
              <select className="w-full mt-1 p-3 border border-slate-200 rounded-lg bg-slate-50 font-bold text-sm outline-none">
                <option value="">{subItems.length > 0 ? "항목 확인" : "그룹 먼저 선택"}</option>
                {subItems.map((c: any) => (
                  <option key={c.id} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
  
      {/* 3. 사용자 목록 (하단 배치) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-white font-bold">
            <tr>
              <th className="px-6 py-4">사용자명</th>
              <th className="px-6 py-4">이메일</th>
              <th className="px-6 py-4">소속 부서</th>
              <th className="px-6 py-4">권한 레벨</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {initialUsers.map((user: any) => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-bold text-slate-900">{user.name}</td>
                <td className="px-6 py-4 text-slate-500">{user.email}</td>
                <td className="px-6 py-4 text-slate-600">{user.unit?.unit_name || "-"}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase ${
                    (user.roles as string[]).includes("LV_1") ? "bg-red-100 text-red-600" : 
                    (user.roles as string[]).includes("LV_2") ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    {(user.roles as string[])[0]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}