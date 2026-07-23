'use client';
  
import { useState, useEffect } from 'react';
  
export default function AdminSettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [masterGroups, setMasterGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const fetchData = async () => {
    try {
      setLoading(true);
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

  useEffect(() => {
    fetchData();
  }, []);
  
  // 💡 [지침 반영] 뭉치별(Group) 독립 저장 프로세스 엔진
  const handleSaveGroup = async (fields: string[], groupLabel: string) => {
    if (!config) return;
    try {
      // 현재 뭉치에 속한 필드들만 동적으로 추출하여 페이로드 구성
      const payload: any = {};
      fields.forEach(field => {
        payload[field] = config[field] || "";
      });

      const res = await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        alert(`✅ [${groupLabel}] 설정이 정상적으로 저장되었습니다.`);
        await fetchData(); // 최신 DB 데이터 재싱크
      } else {
        alert('❌ 저장 실패: DB 연동 중 오류가 발생했습니다.');
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

  const MAPPING_CONFIG = [
    { 
      groupName: "💼 인사 관리 및 명함 연동 (직책 / 직급)",
      theme: "indigo",
      // 해당 뭉치 제어를 위한 타겟 필드 정의
      fields: ["job_duty_group", "job_grade_group"],
      items: [
        { label: "사용자 마스터 관리 > 기본 직책(보직)", path: "/admin/users", field: "job_duty_group", tag: "job_duty_group" },
        { label: "사용자 마스터 관리 > 기본 직급(자격)", path: "/admin/users", field: "job_grade_group", tag: "job_grade_group" }
      ]
    },
    { 
      groupName: "📦 일반 관리 (고객사 / 소모품 / 단위)",
      theme: "emerald",
      fields: ["client_category_group", "supply_category_group", "unit_category_group"],
      items: [
        { label: "고객사 마스터 > 업무 범주", path: "/marketing/distribution/client-search", field: "client_category_group", tag: "client_category_group" },
        { label: "일반 소모품 관리 > 마스터 규격", path: "/asset/supplies/master/dashboard", field: "supply_category_group", tag: "supply_category_group" },
        { label: "전사 시스템 공통 > 구입 단위", path: "전역 공통 컴포넌트", field: "unit_category_group", tag: "unit_category_group" }
      ]
    },
    {
      groupName: "💻 IT · 업무자산 관리",
      theme: "blue",
      fields: ["it_category_group", "it_master_group", "it_rental_group"],
      items: [
        { label: "IT·업무자산 > 대범주 (HW/SW 등)", path: "/asset/it/master/dashboard", field: "it_category_group", tag: "it_category_group" },
        { label: "IT·업무자산 > 품목", path: "/asset/it/master/dashboard", field: "it_master_group", tag: "it_master_group" },
        { label: "IT·업무자산 > 조달 유형 (구매/렌탈)", path: "/asset/it/master/dashboard", field: "it_rental_group", tag: "it_rental_group" }
      ]
    },
    {
      groupName: "🤝 외주 업무 서비스",
      theme: "purple",
      fields: ["outsourcing_vendor_group", "outsourcing_item_group", "outsourcing_detail1_group", "outsourcing_detail2_group"],
      items: [
        { label: "외주업무 > 업체 마스터", path: "/asset/outsourcing", field: "outsourcing_vendor_group", tag: "outsourcing_vendor_group" },
        { label: "외주업무 > 품목 리스트", path: "/asset/outsourcing", field: "outsourcing_item_group", tag: "outsourcing_item_group" },
        { label: "외주업무 > 품목 상세 1", path: "/asset/outsourcing", field: "outsourcing_detail1_group", tag: "outsourcing_detail1_group" },
        { label: "외주업무 > 품목 상세 2", path: "/asset/outsourcing", field: "outsourcing_detail2_group", tag: "outsourcing_detail2_group" }
      ]
    }
  ];
  
  return (
    <div className="p-6 space-y-6 animate-fade-in font-sans text-slate-800 bg-slate-50 min-h-screen pb-24">
      
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
        <div className="px-8 py-5 bg-indigo-50/50 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-2xl">👑</span>
            <div>
              <h3 className="text-sm font-black text-slate-800">통합 권한 및 제어 부서 설정</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase">CRUD Governance & Department Logic</p>
            </div>
          </div>
          {/* 단독 저장 버튼 */}
          <button 
            onClick={() => handleSaveGroup(['global_mgmt_dept'], '통합 권한 및 제어 부서')} 
            className="px-4 py-1.5 bg-slate-800 text-white font-black text-[11px] rounded-xl hover:bg-slate-700 transition-all shadow-sm"
          >
            💾 관리부서 저장
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-50 text-slate-400 font-black tracking-widest uppercase border-b border-slate-200">
              <tr>
                <th className="py-4 px-8 w-[350px]">적용 서비스 모듈</th>
                <th className="py-4 px-5 w-[200px]">시스템 경로 (Path)</th>
                <th className="py-4 px-5 w-[150px] text-center">제어 키워드</th>
                <th className="py-4 px-8">CRUD 총괄 관리 부서 지정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
              <tr className="hover:bg-indigo-50/30 transition-colors h-16">
              <td className="px-8 flex flex-col justify-center">
    <span className="text-slate-800 font-black text-[13px]">전사(최상위 조직) 자산 총괄 부서 지정</span>
    <span className="text-[10px] text-slate-500 font-bold mt-1">최상위 조직의 입고/매입 및 종료 물품 장부 관리 권한</span>
  </td>
  <td className="px-5 text-slate-400 font-mono text-[10px]">/marketing/distribution/*</td>
  <td className="px-5 text-center">
    <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-black tracking-widest text-[9px]">GLOBAL_MGMT</span>
  </td>
  <td className="px-8">
                  <select 
                    value={config?.global_mgmt_dept || ''} 
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, global_mgmt_dept: e.target.value }))}
                    className="w-full max-w-sm p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-indigo-700 outline-none focus:ring-2 ring-indigo-500 shadow-sm cursor-pointer"
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
  
      {/* 🚀 3. 마스터 데이터 - UI 매핑 제어 (그룹별 렌더링 + 개별 저장식 캡슐화 완료) */}
      <div className="space-y-6">
        <div className="px-4 flex items-center gap-3 mb-2">
          <span className="text-2xl">🔗</span>
          <div>
            <h3 className="text-sm font-black text-slate-800">마스터 데이터 - UI 매핑 제어 (Select Group)</h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase">Master-Data Group Mapping Engine</p>
          </div>
        </div>

        {MAPPING_CONFIG.map((grp, idx) => {
          const headerBg = grp.theme === 'indigo' ? 'bg-indigo-50/80' : grp.theme === 'emerald' ? 'bg-emerald-50/80' : grp.theme === 'blue' ? 'bg-blue-50/80' : 'bg-purple-50/80';
          const tagBg = grp.theme === 'indigo' ? 'bg-indigo-100 text-indigo-700' : grp.theme === 'emerald' ? 'bg-emerald-100 text-emerald-700' : grp.theme === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700';
          const selectBorder = grp.theme === 'indigo' ? 'focus:border-indigo-500' : grp.theme === 'emerald' ? 'focus:border-emerald-500' : grp.theme === 'blue' ? 'focus:border-blue-500' : 'focus:border-purple-500';
          const textTheme = grp.theme === 'indigo' ? 'text-indigo-800' : grp.theme === 'emerald' ? 'text-emerald-800' : grp.theme === 'blue' ? 'text-blue-800' : 'text-purple-800';
          const btnBg = grp.theme === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-700' : grp.theme === 'emerald' ? 'bg-emerald-600 hover:bg-emerald-700' : grp.theme === 'blue' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700';

          return (
            <div key={idx} className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
              {/* 💡 대표님 아이디어 완벽 구현: 뭉치 헤더 우측에 독립식 저장 제어 버튼 레이아웃 안착 */}
              <div className={`px-8 py-4 border-b border-slate-100 flex justify-between items-center ${headerBg}`}>
                <h4 className={`text-[12px] font-black ${textTheme}`}>{grp.groupName}</h4>
                <button 
                  onClick={() => handleSaveGroup(grp.fields, grp.groupName)}
                  className={`px-4 py-1.5 text-white font-black text-[10px] rounded-xl shadow-md transition-all active:scale-95 ${btnBg}`}
                >
                  💾 현재 그룹 저장
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 text-slate-400 font-black tracking-widest uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-4 px-8 w-[350px]">적용 화면 (UI) 및 관리 경로</th>
                      <th className="py-4 px-5 w-[150px] text-center">데이터 성격 (코드 ID)</th>
                      <th className="py-4 px-8">연결할 마스터 그룹 선택</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                    {grp.items.map((item) => (
                      <tr key={item.field} className="hover:bg-slate-50/50 transition-colors h-16">
                        <td className="px-8">
                          <p className="text-slate-800 font-black text-[13px]">{item.label}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-tight flex items-center gap-1">
                            <span>📄</span> {item.path}
                          </p>
                        </td>
                        <td className="px-5 text-center">
                          <span className={`px-3 py-1 rounded-full font-black tracking-wide text-[9px] font-mono ${tagBg}`}>
                            {item.tag}
                          </span>
                        </td>
                        <td className="px-8">
                          <select 
                            value={config ? config[item.field] || '' : ''} 
                            onChange={(e) => setConfig((prev: any) => ({ ...prev, [item.field]: e.target.value }))}
                            className={`w-full max-w-md p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-800 outline-none shadow-sm cursor-pointer transition-colors ${selectBorder}`}
                          >
                            <option value="">마스터 그룹 선택 안함</option>
                            {masterGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
  
      {/* 🚀 4. 하단 경고 영역 */}
      <div className="pt-4">
        <div className="bg-slate-800 border border-slate-700 rounded-[2rem] p-8 shadow-md text-white flex items-center gap-6 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-2 bg-amber-500"></div>
          <div className="text-4xl">⚠️</div>
          <div>
            <h4 className="font-black text-amber-400 text-[12px] uppercase tracking-widest mb-1">Administrator Notice</h4>
            <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
              위의 설정값들은 <b>[현재 그룹 저장]</b> 버튼을 누르는 순간 시스템에 정식 동기화됩니다.<br/>
              마스터 그룹 매핑 구조 변경 시, 연동된 하위 인사 대장 및 명함 발급 라우터의 드롭다운 데이터 공급처가 유기적으로 전환됩니다.
            </p>
          </div>
        </div>
      </div>
  
    </div>
  );
}