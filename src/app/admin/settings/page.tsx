'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import LoadingState from '@/components/common/LoadingState';

export default function AdminSettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [masterGroups, setMasterGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  type PageViewRow = {
    path: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    level: number;
    hits: number;
    users: number;
    inMenu: boolean;
  };
  const nowY = new Date().getFullYear();
  const [pvYear, setPvYear] = useState(nowY);
  const [pvMonth, setPvMonth] = useState<'all' | number>('all');
  const [pvYears, setPvYears] = useState<number[]>([nowY]);
  const [pvRows, setPvRows] = useState<PageViewRow[]>([]);
  const [pvTotalHits, setPvTotalHits] = useState(0);
  const [pvTotalUsers, setPvTotalUsers] = useState(0);
  const [pvLoading, setPvLoading] = useState(false);
  const [pvError, setPvError] = useState<string | null>(null);
  /** 기본 접힘 — 클릭 시 펼침 */
  const [pvOpen, setPvOpen] = useState(false);

  const fetchData = async () => {
    try {
      setLoadError(null);
      setLoading(true);
      const ts = Date.now();
      const [cRes, uRes, mRes] = await Promise.all([
        fetch(`/api/admin/config?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/master-data?admin=1&t=${ts}`, { cache: 'no-store' }),
      ]);

      const failures: string[] = [];

      let nextConfig: any = null;
      let nextUnits: any[] = [];

      if (cRes.ok) {
        nextConfig = await cRes.json();
      } else {
        const err = await cRes.json().catch(() => ({}));
        failures.push(err.message || err.error || `설정 로드 실패 (${cRes.status})`);
      }

      if (uRes.ok) {
        const data = await uRes.json();
        nextUnits = Array.isArray(data) ? data : [];
      } else {
        const err = await uRes.json().catch(() => ({}));
        failures.push(err.message || err.error || `조직 로드 실패 (${uRes.status})`);
      }

      if (mRes.ok) {
        const data = await mRes.json();
        setMasterGroups(Array.isArray(data) ? data : []);
      } else {
        setMasterGroups([]);
        const err = await mRes.json().catch(() => ({}));
        failures.push(err.message || err.error || `마스터 그룹 로드 실패 (${mRes.status})`);
      }

      // 레거시 unit_name → OrgUnit.id 로 표시·DB 이관
      if (nextConfig && nextUnits.length > 0) {
        const ref = String(nextConfig.global_mgmt_dept || '').trim();
        if (ref) {
          const byId = nextUnits.find((u) => u.id === ref);
          if (!byId) {
            const byName = nextUnits.find((u) => u.unit_name === ref);
            if (byName?.id) {
              nextConfig = { ...nextConfig, global_mgmt_dept: byName.id };
              fetch('/api/admin/config', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ global_mgmt_dept: byName.id }),
              }).catch(() => {});
            }
          }
        }
      }

      setConfig(nextConfig);
      setUnits(nextUnits);

      if (failures.length > 0) {
        setLoadError(failures.join(' · '));
      }
    } catch (error) {
      console.error('Settings Load Error:', error);
      setConfig(null);
      setUnits([]);
      setMasterGroups([]);
      setLoadError('데이터 로드 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPageViews = async (year: number, month: 'all' | number) => {
    setPvLoading(true);
    setPvError(null);
    try {
      const q = new URLSearchParams({
        year: String(year),
        month: month === 'all' ? 'all' : String(month),
        t: String(Date.now()),
      });
      const res = await fetch(`/api/admin/page-views?${q}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPvRows(Array.isArray(data.rows) ? data.rows : []);
        setPvError(data.error || data.message || `집계 로드 실패 (${res.status})`);
        return;
      }
      setPvRows(Array.isArray(data.rows) ? data.rows : []);
      setPvTotalHits(Number(data.totalHits) || 0);
      setPvTotalUsers(Number(data.totalUsers) || 0);
      if (Array.isArray(data.years) && data.years.length) {
        setPvYears(data.years);
      }
      setPvError(data.warning ? String(data.warning) : null);
    } catch {
      setPvRows([]);
      setPvError('페이지 접속 집계 통신 오류');
    } finally {
      setPvLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!pvOpen) return;
    fetchPageViews(pvYear, pvMonth);
  }, [pvOpen, pvYear, pvMonth]);

  const downloadPageViewsExcel = () => {
    if (pvRows.length === 0) {
      return alert('다운로드할 집계 데이터가 없습니다.');
    }
    const monthLabel = pvMonth === 'all' ? '전체' : `${pvMonth}월`;
    const exportData = pvRows.map((r) => ({
      Step1: r.step1,
      Step2: r.step2,
      Step3: r.step3,
      Step4: r.step4,
      경로: r.path,
      조회수: Number(r.hits) || 0,
      접속자: Number(r.users) || 0,
    }));
    exportData.push({
      Step1: '',
      Step2: '',
      Step3: '',
      Step4: '합계',
      경로: `${pvYear}년 ${monthLabel}`,
      조회수: pvTotalHits,
      접속자: pvTotalUsers,
    } as any);
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '페이지접속집계');
    XLSX.writeFile(wb, `페이지접속집계_${pvYear}년_${monthLabel}.xlsx`);
  };

  const handleSaveGroup = async (fields: string[], groupLabel: string) => {
    if (!config) return;
    try {
      const payload: Record<string, string> = {};
      fields.forEach((field) => {
        payload[field] = config[field] ?? '';
      });

      const res = await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json().catch(() => ({}));

      if (res.ok) {
        alert(`✅ [${groupLabel}] 설정이 정상적으로 저장되었습니다.`);
        await fetchData();
      } else {
        alert(`❌ 저장 실패: ${result.message || result.error || 'DB 연동 중 오류가 발생했습니다.'}`);
      }
    } catch {
      alert('네트워크 오류가 발생했습니다.');
    }
  };

  if (loading) return <LoadingState />;

  const MAPPING_CONFIG = [
    {
      groupName: '📦 일반 관리 (고객사 / 소모품 / 단위)',
      theme: 'emerald',
      fields: ['client_category_group', 'supply_category_group', 'unit_category_group'],
      items: [
        {
          label: '고객사 마스터 > 업무 범주',
          path: '/marketing/distribution/client-search',
          field: 'client_category_group',
          tag: 'client_category_group',
        },
        {
          label: '일반 소모품 관리 > 마스터 규격',
          path: '/asset/supplies/master/dashboard',
          field: 'supply_category_group',
          tag: 'supply_category_group',
        },
        {
          label: '전사 시스템 공통 > 구입 단위',
          path: '전역 공통 컴포넌트',
          field: 'unit_category_group',
          tag: 'unit_category_group',
        },
      ],
    },
    {
      groupName: '💻 IT · 업무자산 관리',
      theme: 'blue',
      fields: ['it_category_group', 'it_master_group', 'it_rental_group'],
      items: [
        {
          label: 'IT·업무자산 > 대범주 (HW/SW 등)',
          path: '/asset/it/master/dashboard',
          field: 'it_category_group',
          tag: 'it_category_group',
        },
        {
          label: 'IT·업무자산 > 품목',
          path: '/asset/it/master/dashboard',
          field: 'it_master_group',
          tag: 'it_master_group',
        },
        {
          label: 'IT·업무자산 > 조달 유형 (구매/렌탈)',
          path: '/asset/it/master/dashboard',
          field: 'it_rental_group',
          tag: 'it_rental_group',
        },
      ],
    },
  ];

  return (
    <div className="p-6 space-y-6 animate-fade-in font-sans text-slate-800 bg-slate-50 min-h-screen pb-24">
      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 shrink-0">
          {loadError}
          <button
            type="button"
            onClick={() => fetchData()}
            className="ml-3 underline underline-offset-2 hover:text-rose-900"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      <div className="bg-slate-900 p-8 rounded-[2rem] shadow-xl flex justify-between items-center text-white relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-3 italic">
            <span className="text-blue-400">05.</span> 시스템 환경 설정
          </h2>
          <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-widest pl-10">
            시스템 전반의 마스터 규칙 및 UI-Data 매핑 엔진 제어
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-5 bg-indigo-50/50 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-2xl">👑</span>
            <div>
              <h3 className="text-sm font-black text-slate-800">통합 권한 및 제어 부서 설정</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase">
                CRUD Governance & Department Logic
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleSaveGroup(['global_mgmt_dept'], '통합 권한 및 제어 부서')}
            disabled={!config}
            className="px-4 py-1.5 bg-slate-800 text-white font-black text-[11px] rounded-xl hover:bg-slate-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
              <tr className="hover:bg-indigo-50/30 transition-colors align-top">
                <td className="px-8 py-4 flex flex-col justify-center">
                  <span className="text-slate-800 font-black text-[13px]">
                    전사(최상위 조직) 자산 총괄 부서 지정
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold mt-1 leading-relaxed">
                    최상위 Organization 자산의 입고·수정·폐기·지급승인 등 CRUD를 총괄하는 부서
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-500 font-mono text-[10px] leading-relaxed">
                  <div>/marketing/distribution/catalog</div>
                  <div>/marketing/distribution/dept</div>
                  <div>/equipment/main</div>
                  <div>/asset/it/dept</div>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-black tracking-widest text-[9px]">
                    GLOBAL_MGMT
                  </span>
                </td>
                <td className="px-8 py-4">
                  <select
                    value={config?.global_mgmt_dept || ''}
                    onChange={(e) =>
                      setConfig((prev: any) => ({ ...prev, global_mgmt_dept: e.target.value }))
                    }
                    disabled={!config}
                    className="w-full max-w-sm p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-indigo-700 outline-none focus:ring-2 ring-indigo-500 shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <option value="">부서 선택 없음</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unit_name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[10px] text-slate-500 font-bold leading-relaxed max-w-sm">
                    HQ(본부)를 지정하면 그 하위 Center·조직에도 동일하게 총괄 권한이 적용됩니다.
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-6">
        <div className="px-4 flex items-center gap-3 mb-2">
          <span className="text-2xl">🔗</span>
          <div>
            <h3 className="text-sm font-black text-slate-800">
              마스터 데이터 - UI 매핑 제어 (Select Group)
            </h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase">
              Master-Data Group Mapping Engine
            </p>
          </div>
        </div>

        {MAPPING_CONFIG.map((grp, idx) => {
          const headerBg =
            grp.theme === 'indigo'
              ? 'bg-indigo-50/80'
              : grp.theme === 'emerald'
                ? 'bg-emerald-50/80'
                : grp.theme === 'blue'
                  ? 'bg-blue-50/80'
                  : 'bg-purple-50/80';
          const tagBg =
            grp.theme === 'indigo'
              ? 'bg-indigo-100 text-indigo-700'
              : grp.theme === 'emerald'
                ? 'bg-emerald-100 text-emerald-700'
                : grp.theme === 'blue'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700';
          const selectBorder =
            grp.theme === 'indigo'
              ? 'focus:border-indigo-500'
              : grp.theme === 'emerald'
                ? 'focus:border-emerald-500'
                : grp.theme === 'blue'
                  ? 'focus:border-blue-500'
                  : 'focus:border-purple-500';
          const textTheme =
            grp.theme === 'indigo'
              ? 'text-indigo-800'
              : grp.theme === 'emerald'
                ? 'text-emerald-800'
                : grp.theme === 'blue'
                  ? 'text-blue-800'
                  : 'text-purple-800';
          const btnBg =
            grp.theme === 'indigo'
              ? 'bg-indigo-600 hover:bg-indigo-700'
              : grp.theme === 'emerald'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : grp.theme === 'blue'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-purple-600 hover:bg-purple-700';

          return (
            <div
              key={idx}
              className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden"
            >
              <div
                className={`px-8 py-4 border-b border-slate-100 flex justify-between items-center ${headerBg}`}
              >
                <h4 className={`text-[12px] font-black ${textTheme}`}>{grp.groupName}</h4>
                <button
                  type="button"
                  onClick={() => handleSaveGroup(grp.fields, grp.groupName)}
                  disabled={!config}
                  className={`px-4 py-1.5 text-white font-black text-[10px] rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${btnBg}`}
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
                          <span
                            className={`px-3 py-1 rounded-full font-black tracking-wide text-[9px] font-mono ${tagBg}`}
                          >
                            {item.tag}
                          </span>
                        </td>
                        <td className="px-8">
                          <select
                            value={config ? config[item.field] || '' : ''}
                            onChange={(e) =>
                              setConfig((prev: any) => ({
                                ...prev,
                                [item.field]: e.target.value,
                              }))
                            }
                            disabled={!config}
                            className={`w-full max-w-md p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-800 outline-none shadow-sm cursor-pointer transition-colors disabled:opacity-50 ${selectBorder}`}
                          >
                            <option value="">마스터 그룹 선택 안함</option>
                            {masterGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.is_active === false ? `[비활성] ${g.name}` : g.name}
                              </option>
                            ))}
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

      <div className="bg-white border border-indigo-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setPvOpen((v) => !v)}
          className={`w-full px-8 py-5 bg-indigo-50/70 flex flex-wrap justify-between items-center gap-3 text-left transition-colors hover:bg-indigo-50 ${
            pvOpen ? 'border-b border-indigo-100' : ''
          }`}
          aria-expanded={pvOpen}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl shrink-0">📊</span>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                페이지 접속 집계 (LV_1)
                <span className="text-[10px] font-black text-indigo-600 bg-white border border-indigo-200 px-2 py-0.5 rounded-full">
                  {pvOpen ? '접기' : '닫힘 · 클릭하여 펼치기'}
                </span>
              </h3>
              <p className="text-[10px] text-slate-500 font-bold mt-0.5 leading-relaxed">
                {pvOpen
                  ? '조회수 = 페이지를 연 횟수(동일 경로 20초 내 중복은 1회) · 접속자 = 그 기간에 해당 경로를 연 사람 수(고유 계정, 서울 시각)'
                  : '평소에는 접혀 있습니다. 필요할 때 펼쳐 연·월 집계를 확인하세요.'}
              </p>
            </div>
          </div>
          <span
            className={`text-indigo-700 font-black text-lg shrink-0 transition-transform ${
              pvOpen ? 'rotate-180' : ''
            }`}
            aria-hidden
          >
            ▾
          </span>
        </button>

        {pvOpen ? (
          <>
            <div className="px-8 py-3 border-b border-slate-100 bg-slate-50/80 flex flex-wrap justify-end items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-500">
                년도
                <select
                  value={pvYear}
                  onChange={(e) => setPvYear(Number(e.target.value))}
                  className="px-2.5 py-1.5 bg-white border border-indigo-200 rounded-lg text-[11px] font-black text-slate-800 outline-none focus:ring-2 ring-indigo-300"
                >
                  {pvYears.map((y) => (
                    <option key={y} value={y}>
                      {y}년
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-500">
                월
                <select
                  value={pvMonth === 'all' ? 'all' : String(pvMonth)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPvMonth(v === 'all' ? 'all' : Number(v));
                  }}
                  className="px-2.5 py-1.5 bg-white border border-indigo-200 rounded-lg text-[11px] font-black text-slate-800 outline-none focus:ring-2 ring-indigo-300"
                >
                  <option value="all">전체</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {m}월
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => fetchPageViews(pvYear, pvMonth)}
                disabled={pvLoading}
                className="px-4 py-1.5 bg-white border border-indigo-200 text-indigo-700 font-black text-[11px] rounded-xl hover:bg-indigo-50 transition-all shadow-sm disabled:opacity-50"
              >
                {pvLoading ? '집계 중…' : '새로고침'}
              </button>
              <button
                type="button"
                onClick={downloadPageViewsExcel}
                disabled={pvLoading || pvRows.length === 0}
                className="px-4 py-1.5 bg-emerald-600 text-white font-black text-[11px] rounded-xl hover:bg-emerald-700 transition-all shadow-sm disabled:opacity-50"
              >
                엑셀 다운로드
              </button>
            </div>

            <div className="px-8 py-3 border-b border-slate-100 bg-slate-50/80 flex flex-wrap gap-4 text-[11px] font-bold text-slate-600">
              <span>
                조회수 합계{' '}
                <span className="text-indigo-700 font-black tabular-nums">
                  {pvTotalHits.toLocaleString()}
                </span>
                <span className="text-slate-400 font-medium ml-1">(열람 횟수)</span>
              </span>
              <span>
                기간 내 접속자{' '}
                <span className="text-indigo-700 font-black tabular-nums">
                  {pvTotalUsers.toLocaleString()}
                </span>
                <span className="text-slate-400 font-medium ml-1">(고유 계정 수)</span>
              </span>
              {pvError ? <span className="text-rose-600">{pvError}</span> : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] table-fixed min-w-[1080px]">
                <colgroup>
                  <col className="w-[140px]" />
                  <col className="w-[140px]" />
                  <col className="w-[150px]" />
                  <col className="w-[150px]" />
                  <col />
                  <col className="w-[88px]" />
                  <col className="w-[88px]" />
                </colgroup>
                <thead className="bg-slate-50 text-slate-400 font-black tracking-widest uppercase border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-2">Step1</th>
                    <th className="py-3 px-2">Step2</th>
                    <th className="py-3 px-2">Step3</th>
                    <th className="py-3 px-2">Step4</th>
                    <th className="py-3 px-3">경로</th>
                    <th className="py-3 px-3 text-right" title="페이지를 연 횟수">
                      조회수
                    </th>
                    <th className="py-3 px-3 text-right" title="해당 경로를 연 고유 계정 수">
                      접속자
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                  {pvLoading && pvRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-8 py-10 text-center text-slate-400">
                        집계 불러오는 중…
                      </td>
                    </tr>
                  ) : pvRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-8 py-10 text-center text-slate-400">
                        경로 목록을 불러오지 못했습니다. 새로고침하거나 서버 로그를 확인해 주세요.
                      </td>
                    </tr>
                  ) : (
                    pvRows.map((r, idx) => {
                      const prev = idx > 0 ? pvRows[idx - 1] : null;
                      const showStep1 = !prev || prev.step1 !== r.step1;
                      const showStep2 = showStep1 || !prev || prev.step2 !== r.step2;
                      const showStep3 = showStep2 || !prev || prev.step3 !== r.step3;
                      return (
                        <tr
                          key={`${r.path}-${r.level}-${idx}`}
                          className={`align-top hover:bg-slate-50/60 ${
                            showStep1 && idx > 0 ? 'border-t-2 border-slate-200' : ''
                          } ${r.hits > 0 ? '' : 'opacity-60'}`}
                        >
                          <td className="px-2 py-2.5">
                            {showStep1 ? (
                              <span className="text-[11px] font-black text-indigo-800 leading-snug break-keep">
                                {r.step1}
                              </span>
                            ) : (
                              <span className="text-slate-200">·</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            {showStep2 ? (
                              <span className="text-[11px] font-black text-slate-700 leading-snug break-keep">
                                {r.step2}
                              </span>
                            ) : (
                              <span className="text-slate-200">·</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            {showStep3 ? (
                              <span className="text-[11px] font-bold text-slate-600 leading-snug break-keep">
                                {r.step3}
                              </span>
                            ) : (
                              <span className="text-slate-200">·</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="text-[11px] font-bold text-slate-600 leading-snug break-keep">
                              {r.step4}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-slate-500">
                            <span className="truncate block" title={r.path}>
                              {r.path}
                            </span>
                            {!r.inMenu && r.step1 === '기타' ? (
                              <span className="text-[9px] text-amber-600 font-sans font-bold">
                                카탈로그 외 접속 경로
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 font-black">
                            {Number(r.hits || 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-800 font-black">
                            {Number(r.users || 0).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      <div className="pt-4">
        <div className="bg-slate-800 border border-slate-700 rounded-[2rem] p-8 shadow-md text-white flex items-center gap-6 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-2 bg-amber-500"></div>
          <div className="text-4xl">⚠️</div>
          <div>
            <h4 className="font-black text-amber-400 text-[12px] uppercase tracking-widest mb-1">
              Administrator Notice
            </h4>
            <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
              위의 설정값들은 <b>[현재 그룹 저장]</b> 버튼을 누르는 순간 시스템에 정식 동기화됩니다.
              <br />
              마스터 그룹 매핑 변경 시, 연동된 서비스 화면의 드롭다운 데이터 공급처가 함께 전환됩니다.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
