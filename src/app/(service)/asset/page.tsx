'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function AssetManagementPage() {
  const [user, setUser] = useState<any>(null);
  const [menus, setMenus] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  
  const [activeL2Id, setActiveL2Id] = useState<string>(''); 
  const [activeL3Id, setActiveL3Id] = useState<string>(''); 
  const [selectedDept, setSelectedDept] = useState<string>('all'); 
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [meRes, menuRes, unitRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/admin/interface'),
          fetch('/api/admin/units?active=true')
        ]);
        if (meRes.ok) {
          const userData = await meRes.json();
          setUser(userData);
          setSelectedDept(userData.deptName || 'all');
        }
        if (menuRes.ok) {
          const menuData = await menuRes.json();
          setMenus(menuData);
          const root = menuData.find((m: any) => m.name === '경영자산관리');
          const firstChild = menuData.find((m: any) => m.parent_id === root?.id);
          if (firstChild) setActiveL2Id(firstChild.id);
        }
        if (unitRes.ok) setUnits(await unitRes.json());
      } catch (err) { console.error(err); }
    };
    loadData();
  }, []);

  const currentL2 = menus.find(m => m.id === activeL2Id);
  const l3Items = menus.filter(m => m.parent_id === activeL2Id).sort((a, b) => a.sort_order - b.sort_order);
  const currentL3 = menus.find(m => m.id === activeL3Id);
  const isMaster = user?.roles?.[0] === 'LV_1' || currentL2?.master_editor_id === user?.id;

  if (!user) return <div className="p-10 font-black text-slate-300 animate-pulse uppercase tracking-tighter">Syncing Hub Data...</div>;

  return (
    <div className="flex flex-col h-full bg-[#F8FAFC]">
      {/* 🚀 [변경사항] 기존의 <header> 섹션을 완전히 삭제했습니다. 
          상단바는 이제 layout.tsx에서 통합 관리하므로 중복 및 이름 불일치가 해결됩니다. */}
      
      <div className="flex flex-1 overflow-hidden">
        {/* 사이드바 영역 */}
        {currentL2?.entry_sidebar && (
          <aside className="w-64 bg-white border-r border-slate-200 p-6 flex flex-col gap-2 shrink-0 overflow-y-auto shadow-sm">
            <p className="text-[10px] font-black text-slate-300 uppercase px-3 mb-4 tracking-[0.2em]">Asset Category</p>
            {l3Items.map(m => (
              <button key={m.id} onClick={() => setActiveL3Id(m.id)} 
                className={`text-left px-5 py-4 rounded-2xl text-[12px] font-black transition-all flex items-center justify-between group ${activeL3Id === m.id ? 'bg-slate-900 text-white shadow-xl translate-x-1' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-800'}`}>
                <span className="flex items-center gap-3">
                  <span className={activeL3Id === m.id ? 'opacity-100' : 'opacity-40 grayscale'}>{m.icon}</span>
                  {m.name}
                </span>
                {activeL3Id === m.id && <span className="text-[10px]">●</span>}
              </button>
            ))}
          </aside>
        )}

        {/* 메인 콘텐츠 영역 */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500">
            {/* 부서 필터 바 */}
            <div className="bg-white p-7 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center justify-between gap-6">
              <div className="flex items-center gap-8">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1 tracking-widest font-sans">Organization Filter</label>
                  <select 
                    value={selectedDept}
                    onChange={(e) => setSelectedDept(e.target.value)}
                    disabled={!isMaster}
                    className="block w-64 p-3 bg-slate-50 border-0 rounded-xl text-xs font-black outline-none focus:ring-2 ring-blue-600 transition-all disabled:opacity-50"
                  >
                    <option value="all">전체 부서 데이터</option>
                    {units.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
                  </select>
                </div>
                <div className="h-10 w-[1px] bg-slate-100" />
                <div className="flex gap-8">
                  <div className="text-center">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Assets</p>
                    <p className="text-xl font-black text-slate-900 tracking-tighter">124 <span className="text-[10px] text-slate-300">EA</span></p>
                  </div>
                  <div className="text-center">
                    <p className="text-[9px] font-black text-red-400 uppercase tracking-widest">Replacement</p>
                    <p className="text-xl font-black text-red-600 tracking-tighter">3 <span className="text-[10px] text-red-300">건</span></p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button className="px-6 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black shadow-lg shadow-slate-200 hover:bg-blue-600 transition-all">
                  + {currentL3?.name || '신규'} 신청서 작성
                </button>
              </div>
            </div>

            {/* 자산 목록 테이블 패널 */}
            <div className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                <h3 className="text-lg font-black text-slate-900 tracking-tighter uppercase italic">
                  {currentL3?.name || currentL2?.name} <span className="text-slate-300 font-light mx-2">/</span> 
                  <span className="text-blue-600">{selectedDept === 'all' ? 'Enterprise' : selectedDept}</span>
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead>
                    <tr className="bg-white text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                      <th className="p-6 pl-10">자산번호</th>
                      <th className="p-6 border-r border-slate-50">모델명</th>
                      <th className="p-6 text-center">교체여부(4년)</th>
                      <th className="p-6">사용자</th>
                      <th className="p-6">상태</th>
                      <th className="p-6 pr-10">특이사항</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-[11px] font-bold">
                    {[1, 2, 3].map((i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors group">
                        <td className="p-6 pl-10 font-mono text-slate-500 tracking-tighter">KPCQA-AS-{202600 + i}</td>
                        <td className="p-6 text-slate-900 font-black border-r border-slate-50">{i % 2 === 0 ? 'MacBook Pro 16' : 'Dell Latitude 5540'}</td>
                        <td className="p-6 text-center">
                          <span className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-[9px] font-black uppercase">D-532</span>
                        </td>
                        <td className="p-6 text-slate-800 font-black">사용자 {i}</td>
                        <td className="p-6 text-blue-600 font-black tracking-widest uppercase text-[9px]">Confirmed</td>
                        <td className="p-6 pr-10 text-slate-400 italic">특이사항 없음</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}