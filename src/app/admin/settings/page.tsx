'use client';
  
import { useState, useEffect } from 'react';
  
export default function AdminSettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [masterGroups, setMasterGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 🚀 초기 데이터 로드: 시스템 설정, 조직 목록, 마스터 그룹 목록
  useEffect(() => {
    const fetchData = async () => {
      try {
        const ts = Date.now();
        const [cRes, uRes, mRes] = await Promise.all([
          fetch(`/api/admin/config?t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' })
        ]);
        
        if (cRes.ok) setConfig(await cRes.json());
        if (uRes.ok) setUnits(await uRes.json());
        if (mRes.ok) setMasterGroups(await mRes.json());
      } catch (error) {
        console.error("Settings Load Error:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);
  
  // 🚀 설정값 업데이트 함수
  const handleUpdateConfig = async (key: string, value: any) => {
    try {
      // 1. UI 즉각 반영 (낙관적 업데이트)
      setConfig((prev: any) => ({ ...prev, [key]: value }));

      // 2. DB 저장
      const res = await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });
      
      if (!res.ok) {
        alert('설정 저장 중 오류가 발생했습니다. (DB 스키마 필드 누락 여부 확인 필요)');
      }
    } catch (error) {
      alert('네트워크 오류가 발생했습니다.');
    }
  };
  
  if (loading) return (
    <div className="p-10 text-center font-black animate-pulse text-indigo-500 tracking-widest uppercase">
      System Configuration Syncing...
    </div>
  );
  
  return (
    <div className="p-6 space-y-6 animate-fade-in font-sans text-slate-800 bg-slate-50 min-h-screen">
      
      {/* 🚀 1. 상단 타이틀 영역 */}
      <div className="bg-slate-900 p-8 rounded-[2rem] shadow-xl flex justify-between items-center text-white relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-3 italic">
            <span className="text-blue-400">05.</span> SYSTEM GLOBAL CONFIGURATION
          </h2>
          <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-widest pl-10">
            시스템 전반의 마스터 규칙 및 UI-Data 매핑 엔진 제어
          </p>
        </div>
      </div>
  
      {/* 🚀 2. 통합 권한 및 제어 부서 설정 (CRUD 거버넌스) */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-5 bg-indigo-50/50 border-b border-slate-100 flex items-center gap-3">
          <span className="text-2xl">👑</span>
          <div>
            <h3 className="text-sm font-black text-slate-800">통합 권한 및 제어 부서 설정</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase">CRUD Governance & Department Logic</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-50 text-slate-400 font-black tracking-widest uppercase border-b border-slate-200">
              <tr>
                <th className="py-4 px-8 w-[300px]">적용 서비스 모듈</th>
                <th className="py-4 px-5 w-[250px]">시스템 경로 (Path)</th>
                <th className="py-4 px-5 w-[150px] text-center">제어 키워드</th>
                <th className="py-4 px-8 w-[300px]">CRUD 총괄 관리 부서 지정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
              <tr className="hover:bg-indigo-50/30 transition-colors h-16">
                <td className="px-8">
                  <span className="text-slate-800 font-black text-[13px]">마케팅 자산관리 {'>'} 카탈로그 관리</span>
                </td>
                <td className="px-5 text-slate-400 font-mono text-[10px]">/marketing/distribution/catalog</td>
                <td className="px-5 text-center">
                  <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-black tracking-widest text-[9px]">GLOBAL_MGMT</span>
                </td>
                <td className="px-8">
                  <select 
                    value={config?.global_mgmt_dept || ''} 
                    onChange={(e) => handleUpdateConfig('global_mgmt_dept', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-indigo-700 outline-none focus:ring-2 ring-indigo-500 shadow-sm cursor-pointer"
                  >
                    <option value="">부서 선택 없음</option>
                    {units.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
  
      {/* 🚀 3. 마스터 데이터 - UI 매핑 제어 (핵심 연결 고리) */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-5 bg-emerald-50/50 border-b border-slate-100 flex items-center gap-3">
          <span className="text-2xl">🔗</span>
          <div>
            <h3 className="text-sm font-black text-slate-800">마스터 데이터 - UI 매핑 제어 (Select Group)</h3>
            <p className="text-[10px] text-emerald-400 font-bold uppercase">Master-Data Group Mapping Engine</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-50 text-slate-400 font-black tracking-widest uppercase border-b border-slate-200">
              <tr>
                <th className="py-4 px-8 w-[300px]">적용 화면 (UI)</th>
                <th className="py-4 px-5 w-[250px]">연동 대상 필드</th>
                <th className="py-4 px-5 w-[180px] text-center">데이터 성격</th>
                <th className="py-4 px-8 w-[300px]">연결된 설정 / 마스터 그룹</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
              
              {/* 고객사 업무범위 */}
              <tr className="hover:bg-emerald-50/30 transition-colors h-16">
                <td className="px-8"><span className="text-slate-800 font-black text-[13px]">고객사 마스터 {'>'} 업무 범주</span></td>
                <td className="px-5 text-slate-500 font-mono text-[10px]">client_category_group</td>
                <td className="px-5 text-center"><span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-black text-[9px]">Client Category</span></td>
                <td className="px-8">
                  <select 
                    value={config?.client_category_group || ''} 
                    onChange={(e) => handleUpdateConfig('client_category_group', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-emerald-700 outline-none focus:border-emerald-500 shadow-sm"
                  >
                    <option value="">그룹 선택 안함</option>
                    {masterGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
              </tr>
  
              {/* 소모품 규격 */}
              <tr className="hover:bg-emerald-50/30 transition-colors h-16">
                <td className="px-8"><span className="text-slate-800 font-black text-[13px]">일반 소모품 관리 {'>'} 마스터 규격</span></td>
                <td className="px-5 text-slate-500 font-mono text-[10px]">supply_category_group</td>
                <td className="px-5 text-center"><span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-black text-[9px]">Supply Spec</span></td>
                <td className="px-8">
                  <select 
                    value={config?.supply_category_group || ''} 
                    onChange={(e) => handleUpdateConfig('supply_category_group', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-emerald-700 outline-none focus:border-emerald-500 shadow-sm"
                  >
                    <option value="">그룹 선택 안함</option>
                    {masterGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
              </tr>
  
              {/* 공통 단위 매핑 */}
              <tr className="hover:bg-emerald-50/30 transition-colors h-16">
                <td className="px-8"><span className="text-slate-800 font-black text-[13px]">전사 시스템 공통 {'>'} 구입 단위</span></td>
                <td className="px-5 text-slate-500 font-mono text-[10px]">unit_category_group</td>
                <td className="px-5 text-center"><span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-black text-[9px]">Standard Unit</span></td>
                <td className="px-8">
                  <select 
                    value={config?.unit_category_group || ''} 
                    onChange={(e) => handleUpdateConfig('unit_category_group', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-emerald-700 outline-none focus:border-emerald-500 shadow-sm"
                  >
                    <option value="">그룹 선택 안함</option>
                    {masterGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
              </tr>

              {/* 🚀 [추가] IT 자산관리 마스터 그룹 선택 (드롭다운으로 복구!) */}
              <tr className="hover:bg-blue-50/30 transition-colors h-16 bg-blue-50/10">
                <td className="px-8">
                   <div className="flex items-center gap-2">
                     <span className="text-slate-800 font-black text-[13px]">IT 자산관리 {'>'} 분류 마스터 데이터</span>
                     <span className="bg-blue-600 text-white text-[8px] px-1.5 py-0.5 rounded font-black">NEW</span>
                   </div>
                </td>
                <td className="px-5 text-slate-500 font-mono text-[10px]">it_category_group</td>
                <td className="px-5 text-center"><span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-black text-[9px]">Master Group</span></td>
                <td className="px-8">
                  <select 
                    value={config?.it_category_group || ''} 
                    onChange={(e) => handleUpdateConfig('it_category_group', e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-blue-200 rounded-xl text-xs font-black text-blue-700 outline-none focus:ring-2 ring-blue-500 shadow-sm cursor-pointer"
                  >
                    <option value="">마스터 그룹 선택 안함</option>
                    {masterGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
              </tr>

            </tbody>
          </table>
        </div>
      </div>
  
      {/* 🚀 4. 시스템 공통 변수 및 경고 영역 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <h4 className="font-black text-slate-800 text-[14px] flex items-center gap-2">
              <span>📅</span> 자산 실사 기준일 (Audit Baseline)
            </h4>
            <p className="text-[10px] text-slate-400 font-bold uppercase pl-6">Standard Audit Date for Enterprise Assets</p>
          </div>
          <input 
            type="date" 
            value={config?.audit_baseline || ''} 
            onChange={(e) => handleUpdateConfig('audit_baseline', e.target.value)}
            className="p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-slate-700 outline-none focus:border-indigo-500 text-xs shadow-inner"
          />
        </div>
  
        <div className="bg-slate-800 border border-slate-700 rounded-[2rem] p-8 shadow-md text-white flex items-center gap-6 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-2 bg-amber-500"></div>
          <div className="text-4xl">⚠️</div>
          <div>
            <h4 className="font-black text-amber-400 text-[12px] uppercase tracking-widest mb-1">Administrator Notice</h4>
            <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
              위의 설정값들은 시스템의 <b>실시간 로직(API 및 UI 권한)</b>에 즉시 반영됩니다.<br/>
              마스터 그룹 매핑 해제 시 하위 서비스의 드롭다운이 작동하지 않을 수 있습니다.
            </p>
          </div>
        </div>
      </div>
  
    </div>
  );
}
