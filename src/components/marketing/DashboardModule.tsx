'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getKSTDateString, getKSTYearMonth, getKSTNowYearMonth } from '@/utils/dateUtils';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#64748b'];

/** 지급 업무일: dist_date 우선 (없으면 createdAt) */
function getDistBusinessDate(d: { dist_date?: string | Date | null; createdAt?: string | Date | null }) {
  return d.dist_date || d.createdAt || null;
}

export default function DashboardModule() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalType, setModalType] = useState<'DIST' | 'ALERT' | 'CLIENT' | 'ITEM' | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
  /** 고객사 상세 모달 — 부서 필터 (null: 전체) */
  const [clientDeptFilter, setClientDeptFilter] = useState<string | null>(null);
  const [clientDeptMenuOpen, setClientDeptMenuOpen] = useState(false);

// 🚀 [추가] 모달 전용 현재 페이지 상태 관리 (기본값: 1페이지)
const [modalPage, setModalPage] = useState<number>(1);

// 🚀 [추가] 모달 종료 시 상태 일괄 클린업 헬퍼 함수
const closeModal = () => {
  setModalType(null);
  setSelectedClient(null);
  setSelectedItemName(null);
  setModalPage(1);
  setClientDeptFilter(null);
  setClientDeptMenuOpen(false);
};

  // 🚀 [수정 1] 하드코딩 없는 현재 연/월 추출 및 랭킹 기준 연도 상태(기본값: 올해)
  const { year: currentYear, month: currentMonth } = getKSTNowYearMonth();
  const [selectedRankingYear, setSelectedRankingYear] = useState<number>(currentYear);

// 🚀 [추가] 인기 물품 TOP 5 전용 연도 상태 (기본값: 올해)
const [selectedItemYear, setSelectedItemYear] = useState<number>(currentYear);

  useEffect(() => {
    const fetchData = async () => {
      setLoadError(null);
      try {
        const [iRes, dRes, pRes] = await Promise.all([
          fetch('/api/marketing/items'),
          fetch('/api/marketing/distributions'),
          fetch('/api/marketing/purchases')
        ]);

        const failed: string[] = [];
        if (!iRes.ok) failed.push('물품');
        if (!dRes.ok) failed.push('지급');
        if (!pRes.ok) failed.push('입고');

        if (iRes.ok) setItems(await iRes.json());
        else setItems([]);
        if (dRes.ok) setDistributions(await dRes.json());
        else setDistributions([]);
        if (pRes.ok) setPurchases(await pRes.json());
        else setPurchases([]);

        if (failed.length > 0) {
          const status = [iRes, dRes, pRes].find(r => !r.ok)?.status;
          setLoadError(
            status === 401
              ? '로그인 세션이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요.'
              : `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')})`
          );
        }
      } catch (error) {
        console.error(error);
        setItems([]);
        setDistributions([]);
        setPurchases([]);
        setLoadError('네트워크 오류로 대시보드 데이터를 불러오지 못했습니다.');
      }
      setLoading(false);
    };
    fetchData();
  }, []);


  // 활성(미종료) 품목만 KPI·알림에 사용
  const activeItems = useMemo(() => items.filter(i => !i.is_archived), [items]);

  const kpi = useMemo(() => {
    const totalInventoryValue = activeItems.reduce(
      (acc, cur) => acc + (Number(cur.unit_price) || 0) * (Number(cur.current_stock) || 0),
      0
    );
    const thisMonthDists = distributions.filter(d => {
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      return ym && ym.year === currentYear && ym.month === currentMonth;
    });
    const alertItems = activeItems.filter(
      i => Number(i.alert_qty) > 0 && Number(i.current_stock) <= Number(i.alert_qty)
    );
    return {
      totalInventoryValue,
      thisMonthDistList: thisMonthDists,
      thisMonthDistValue: thisMonthDists.reduce(
        (acc, cur) => acc + ((cur.item?.unit_price || 0) * cur.qty),
        0
      ),
      alertItemsList: alertItems
    };
  }, [activeItems, distributions, currentYear, currentMonth]);


// 🚀 [수정] 현재 연도(currentYear) 고정에서 선택된 연도(selectedItemYear) 기반으로 변경
const topItemsData = useMemo(() => {
  const itemCounts: Record<string, number> = {};
  distributions.forEach(d => {
    const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
    if (ym && ym.year === selectedItemYear) {
      const itemName = d.item?.name || '기타';
      itemCounts[itemName] = (itemCounts[itemName] || 0) + d.qty;
    }
  });
  return Object.entries(itemCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}, [distributions, selectedItemYear]);

// 🚀 [추가] 등록된 모든 지급 데이터에서 존재하는 연도만 추출 (올해는 무조건 포함)
const availableYears = useMemo(() => {
  const years = distributions.map(d => {
    const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
    return ym ? ym.year : null;
  }).filter(Boolean) as number[];
  const uniqueYears = Array.from(new Set(years)).sort((a, b) => b - a);
  if (!uniqueYears.includes(currentYear)) uniqueYears.unshift(currentYear);
  return uniqueYears;
}, [distributions, currentYear]);

// 🚀 [수정 2] 선택된 연도(selectedRankingYear) 기준으로 수량과 "누적 합계 금액"을 동시에 계산
const topClientsData = useMemo(() => {
  const clientStats: Record<string, { qty: number, amount: number }> = {};
  distributions.forEach(d => {
    const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
    if (ym && ym.year === selectedRankingYear) {
      const price = d.item?.unit_price || 0;
      if (!clientStats[d.client_name]) clientStats[d.client_name] = { qty: 0, amount: 0 };
      clientStats[d.client_name].qty += d.qty;
      clientStats[d.client_name].amount += (d.qty * price);
    }
  });
  return Object.entries(clientStats)
    .map(([name, stats]) => ({ name, value: stats.qty, amount: stats.amount }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}, [distributions, selectedRankingYear]);

// 🚀 [수정] 모달 상세 리스트도 선택된 랭킹 연도(selectedRankingYear)와 동기화
const clientDistListAll = useMemo(() => {
  if (modalType !== 'CLIENT' || !selectedClient) return [];
  return distributions
    .filter(d => {
      if (d.client_name !== selectedClient) return false;
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      return ym && ym.year === selectedRankingYear;
    })
    .sort((a, b) => {
      const ta = new Date(getDistBusinessDate(a) as string).getTime();
      const tb = new Date(getDistBusinessDate(b) as string).getTime();
      return tb - ta;
    });
}, [distributions, modalType, selectedClient, selectedRankingYear]);

/** 해당 고객사·연도에 지급된 부서명 목록 */
const clientDeptOptions = useMemo(() => {
  const set = new Set<string>();
  clientDistListAll.forEach((d) => {
    const dept = String(d.client_dept || '').trim();
    if (dept) set.add(dept);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
}, [clientDistListAll]);

const clientDistList = useMemo(() => {
  if (!clientDeptFilter) return clientDistListAll;
  return clientDistListAll.filter(
    (d) => String(d.client_dept || '').trim() === clientDeptFilter
  );
}, [clientDistListAll, clientDeptFilter]);

/** 인기 물품 TOP — 선택 연도·물품명 기준 지급 이력 */
const itemDistList = useMemo(() => {
  if (modalType !== 'ITEM' || !selectedItemName) return [];
  return distributions
    .filter((d) => {
      if ((d.item?.name || '기타') !== selectedItemName) return false;
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      return ym && ym.year === selectedItemYear;
    })
    .sort((a, b) => {
      const ta = new Date(getDistBusinessDate(a) as string).getTime();
      const tb = new Date(getDistBusinessDate(b) as string).getTime();
      return tb - ta;
    });
}, [distributions, modalType, selectedItemName, selectedItemYear]);

/** 동일 물품명이 활성(미종료)이면 카탈로그 이동 가능 */
const activeCatalogItem = useMemo(() => {
  if (!selectedItemName) return null;
  return activeItems.find((i) => i.name === selectedItemName) || null;
}, [activeItems, selectedItemName]);

  const handleGoClick = (row: any) => {
    const itemName = encodeURIComponent(row.item?.name || row.name);
    const deptName = encodeURIComponent(row.owner_dept || 'ALL');
    router.push(`/marketing/distribution/catalog?dept=${deptName}&search=${itemName}`);
  };

  // 원본 대상 데이터 바인딩
const rawModalData = useMemo(() => {
  if (modalType === 'DIST') return kpi.thisMonthDistList;
  if (modalType === 'CLIENT') return clientDistList;
  if (modalType === 'ITEM') return itemDistList;
  return kpi.alertItemsList;
}, [modalType, kpi, clientDistList, itemDistList]);

// 🚀 [추가] 모달 내 10개 단위 슬라이싱 및 페이지 계산 엔진
const modalItemsPerPage = 10;
const totalModalPages = Math.ceil(rawModalData.length / modalItemsPerPage);

const paginatedModalData = useMemo(() => {
  const start = (modalPage - 1) * modalItemsPerPage;
  return rawModalData.slice(start, start + modalItemsPerPage);
}, [rawModalData, modalPage]);


  if (loading) {
    return (
      <div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">
        Syncing Hub Intelligence...
      </div>
    );
  }


  return (
    <div className="p-8 space-y-6 font-sans max-w-[1600px] mx-auto pb-24 animate-fade-in relative z-10 bg-slate-50/30 min-h-screen">

      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-bold flex justify-between items-center gap-4">
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-black hover:bg-amber-700"
          >
            새로고침
          </button>
        </div>
      )}

      {/* 1️⃣ 최상단 타이틀 배너 (위치 이동 및 디자인 강화) */}
      <div className="bg-slate-900 px-8 py-6 rounded-[1.5rem] shadow-xl flex justify-between items-center text-white relative overflow-hidden border-b-4 border-indigo-500">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
            <span className="text-indigo-400">●</span> 마케팅 통합 대시보드
          </h2>
          <p className="text-slate-400 text-xs font-bold mt-1.5 pl-7">마케팅 물품 지급 현황 및 고객사 랭킹 모니터링</p>
        </div>
        <div className="relative z-10">
          <span className="bg-white/10 text-slate-300 font-bold px-4 py-2 rounded-xl text-[11px] border border-white/10 backdrop-blur-sm">
            Current Analysis: {currentYear} YEAR (KST)
          </span>
        </div>
      </div>

      {/* 2️⃣ KPI 요약 카드 (텍스트 띄어쓰기 및 비율 조정) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">(전사) 총 재고 자산 가치</p>
          <h3 className="text-xl font-black text-slate-900 mt-2">{kpi.totalInventoryValue.toLocaleString()} 원</h3>
        </div>

        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">(전사) {currentMonth}월 총 지급 예산</p>
          <h3 className="text-xl font-black text-emerald-600 mt-2">{kpi.thisMonthDistValue.toLocaleString()} 원</h3>
        </div>

        <div
          onClick={() => setModalType('DIST')}
          className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-500 hover:bg-indigo-50/30 hover:shadow-md transition-all group"
        >
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-black text-slate-400 group-hover:text-indigo-600 transition-colors uppercase tracking-widest">(전사) {currentMonth}월 총 지급 건수</p>
            <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-black opacity-0 group-hover:opacity-100 transition-opacity">DETAIL</span>
          </div>
          <h3 className="text-xl font-black text-slate-900 mt-2 group-hover:text-indigo-600">{kpi.thisMonthDistList.length} 건</h3>
        </div>

        <div
          onClick={() => setModalType('ALERT')}
          className={`p-5 rounded-[1.5rem] border shadow-sm cursor-pointer hover:shadow-md transition-all group ${kpi.alertItemsList.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex justify-between items-start">
            <p className={`text-[10px] font-black uppercase tracking-widest ${kpi.alertItemsList.length > 0 ? 'text-red-500' : 'text-slate-400'}`}>재고 확보 필요 품목</p>
            {kpi.alertItemsList.length > 0 && <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black animate-pulse">ACTION</span>}
          </div>
          <h3 className={`text-xl font-black mt-2 ${kpi.alertItemsList.length > 0 ? 'text-red-600' : 'text-slate-900'}`}>{kpi.alertItemsList.length} 종류</h3>
        </div>
      </div>

      {/* 3️⃣ 메인 데이터 영역 (1:1:1 황금비율 3단 콤보) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full items-start">
        
       {/* [왼쪽] 인기 지급 물품 TOP 5 (고정 5슬롯 적용 + 랭킹 뱃지 컬러 매칭) */}
       <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col w-full h-full">
          <div className="flex justify-between items-center mb-4 shrink-0">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><span>🏆</span> 인기 지급 물품 TOP 5</h3>
            <select 
              value={selectedItemYear} 
              onChange={(e) => setSelectedItemYear(Number(e.target.value))}
              className="text-[11px] font-bold bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer shadow-sm"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
          </div>
          <div className="h-[140px] w-full shrink-0 mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={topItemsData.length ? topItemsData : [{ name: '없음', value: 1 }]} innerRadius={40} outerRadius={65} paddingAngle={5} dataKey="value">
                  {(topItemsData.length ? topItemsData : [{ name: '없음', value: 1 }]).map((_, i) => (
                    <Cell key={i} fill={topItemsData.length ? COLORS[i % COLORS.length] : '#f1f5f9'} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: any, name: any) => [`${val}개`, `${name}`]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* 고정 5슬롯 렌더링 */}
          <div className="flex flex-col gap-2 flex-1">
            {[0, 1, 2, 3, 4].map((index) => {
              const item = topItemsData[index];
              if (item) {
                // 🚀 차트와 동일한 인덱스 컬러 추출
                const itemColor = COLORS[index % COLORS.length]; 
                
                return (
                  <div
                    key={index}
                    onClick={() => {
                      setModalType('ITEM');
                      setSelectedItemName(item.name);
                      setModalPage(1);
                      setClientDeptFilter(null);
                      setClientDeptMenuOpen(false);
                    }}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-indigo-50 cursor-pointer transition-colors border border-transparent hover:border-indigo-100 group h-[46px]"
                  >
                    <div className="flex items-center gap-3">
                      {/* 🚀 랭킹 뱃지 배경색을 파이 차트 조각 색상과 동일하게 적용 */}
                      <span 
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-sm"
                        style={{ backgroundColor: itemColor }}
                      >
                        {index + 1}
                      </span>
                      <span className="text-[11px] font-bold text-slate-700 group-hover:text-indigo-700">{item.name}</span>
                    </div>
                    {/* 수량은 기존의 깔끔한 인디고 톤 유지 */}
                    <span className="text-[11px] font-black text-indigo-600">{item.value}EA</span>
                  </div>
                );
              }
              // 빈 슬롯 (데이터가 부족할 때 공간을 지켜줌)
              return (
                <div key={`empty-${index}`} className="flex items-center justify-center p-2.5 rounded-xl bg-white border border-dashed border-slate-200 h-[46px]">
                  <span className="text-[10px] font-bold text-slate-300">순위 없음</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* [중앙] 물품 최다 수령 고객사 Ranking (고정 5슬롯 적용) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col w-full h-full">
          <div className="flex justify-between items-center mb-5 shrink-0">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><span>🏢</span> 최다 수령 고객사 Ranking</h3>
            <select 
              value={selectedRankingYear} 
              onChange={(e) => setSelectedRankingYear(Number(e.target.value))}
              className="text-[11px] font-bold bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer shadow-sm"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
          </div>
          {/* 고정 5슬롯 렌더링 */}
          <div className="flex flex-col gap-3 flex-1">
            {[0, 1, 2, 3, 4].map((index) => {
              const client = topClientsData[index];
              if (client) {
                return (
                  <div key={index} onClick={() => { setModalType('CLIENT'); setSelectedClient(client.name); setClientDeptFilter(null); setClientDeptMenuOpen(false); setModalPage(1); }}
                    className="bg-slate-50 p-3.5 rounded-2xl border border-transparent flex items-center justify-between cursor-pointer hover:border-indigo-200 hover:bg-indigo-50/50 transition-all group h-[68px]"
                  >
                     <div className="flex items-center gap-4">
                       <div className={`w-8 h-8 flex items-center justify-center rounded-xl font-black text-[12px] shadow-sm transition-colors ${index < 3 ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}>
                         {index + 1}
                       </div>
                       <h4 className="text-[13px] font-black text-slate-800 group-hover:text-indigo-700 transition-colors line-clamp-1 max-w-[120px]">{client.name}</h4>
                     </div>
                     <div className="flex flex-col items-end">
                       <div className="px-3 py-1 bg-white rounded-full border border-slate-200 text-indigo-600 font-black text-[11px] group-hover:border-indigo-200 shadow-sm transition-colors">
                         {client.value.toLocaleString()} <span className="text-[9px] text-slate-400 ml-0.5">EA</span>
                       </div>
                       <div className="mt-1.5 text-[10px] font-black text-slate-400 group-hover:text-indigo-500 transition-colors">
                         누적: {client.amount.toLocaleString()}원
                       </div>
                     </div>
                  </div>
                );
              }
              // 빈 슬롯
              return (
                <div key={`empty-${index}`} className="bg-white p-3.5 rounded-2xl border border-dashed border-slate-200 flex items-center justify-center h-[68px]">
                   <span className="text-[11px] font-bold text-slate-300">랭킹 없음</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* [오른쪽] Quick Links (세로형 액션 센터로 변신) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col w-full h-full">
          <h3 className="text-sm font-black text-slate-800 mb-5 flex items-center gap-2 shrink-0"><span>⚡</span> Quick Actions</h3>
          <div className="flex flex-col gap-3 flex-1">
            <Link href="/marketing/distribution/catalog" className="flex-1 group bg-slate-50 p-4 rounded-2xl border border-transparent hover:bg-white hover:shadow-md hover:border-indigo-200 transition-all flex items-center gap-4 min-h-[70px]">
              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform shadow-inner">🎁</div>
              <div><h4 className="font-black text-[13px] text-slate-800">기념품 조회 및 신청</h4><p className="text-[10px] text-slate-400 font-bold mt-0.5">재고 현황 및 신규 등록</p></div>
            </Link>
            <Link href="/marketing/distribution/client-search" className="flex-1 group bg-slate-50 p-4 rounded-2xl border border-transparent hover:bg-white hover:shadow-md hover:border-emerald-200 transition-all flex items-center gap-4 min-h-[70px]">
              <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform shadow-inner">🏢</div>
              <div><h4 className="font-black text-[13px] text-slate-800">고객사별 수령 현황</h4><p className="text-[10px] text-slate-400 font-bold mt-0.5">고객사 관리 및 이력 조회</p></div>
            </Link>
            <Link href="/marketing/distribution/register" className="flex-1 group bg-slate-50 p-4 rounded-2xl border border-transparent hover:bg-white hover:shadow-md hover:border-blue-200 transition-all flex items-center gap-4 min-h-[70px]">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform shadow-inner">✍️</div>
              <div><h4 className="font-black text-[13px] text-slate-800">나의 지급 대장</h4><p className="text-[10px] text-slate-400 font-bold mt-0.5">물품 지급 및 재고 차감</p></div>
            </Link>
            <Link href="/marketing/distribution/dept" className="flex-1 group bg-slate-50 p-4 rounded-2xl border border-transparent hover:bg-white hover:shadow-md hover:border-purple-200 transition-all flex items-center gap-4 min-h-[70px]">
              <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform shadow-inner">📥</div>
              <div><h4 className="font-black text-[13px] text-slate-800">부서 지급 대장</h4><p className="text-[10px] text-slate-400 font-bold mt-0.5">구매 이력 및 입고 관리</p></div>
            </Link>
          </div>
        </div>

      </div>

      {/* 모달창 (기존 로직 100% 동일 유지) */}
      {modalType && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6" onClick={closeModal}>
          <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className={`p-6 text-white flex justify-between items-center ${modalType === 'ALERT' ? 'bg-red-600' : 'bg-indigo-600'}`}>
              <h3 className="font-black text-lg flex items-center gap-2">
                <span>
                  {modalType === 'ALERT' ? '🚨' : modalType === 'CLIENT' ? '🏢' : modalType === 'ITEM' ? '🏆' : '📊'}
                </span>
                {modalType === 'DIST' && `${currentMonth}월 상세 지급 리스트`}
                {modalType === 'CLIENT' && `${selectedClient} 상세 수령 리스트 (${selectedRankingYear}년)`}
                {modalType === 'ITEM' && `${selectedItemName} 지급 이력 (${selectedItemYear}년)`}
                {modalType === 'ALERT' && '재고 확보 필요 품목 리스트'}
                <span className="text-xs bg-black/20 text-white/90 font-bold px-2 py-0.5 rounded-full ml-2">Total {rawModalData.length}건</span>
              </h3>
              <button onClick={closeModal} className="text-2xl hover:rotate-90 transition-transform">✕</button>
            </div>

            <div className="p-6 overflow-y-auto bg-slate-50 flex-1 flex flex-col justify-between">
              <div className={`w-full ${clientDeptMenuOpen ? 'overflow-visible' : 'overflow-x-auto'}`}>
                <table className="w-full text-left text-[11px] font-bold border-collapse">
                  <thead className="bg-white border-b sticky top-0 shadow-sm z-10">
                    <tr className="text-slate-400 uppercase tracking-widest">
                      <th className="p-3 w-12 text-center">NO</th>
                      <th className="p-3">물품명</th>
                      {(modalType === 'DIST' || modalType === 'CLIENT' || modalType === 'ITEM') ? (
                        <>
                          <th className="p-3">회사명</th>
                          <th className="p-3">
                            {modalType === 'CLIENT' ? (
                              <div className="relative inline-block">
                                <button
                                  type="button"
                                  title="지급 부서로 필터"
                                  onClick={() => setClientDeptMenuOpen((o) => !o)}
                                  className={`inline-flex items-center gap-1 hover:text-indigo-600 transition-colors ${
                                    clientDeptFilter ? 'text-indigo-600' : ''
                                  }`}
                                >
                                  부서명
                                  <span className={`text-[9px] leading-none ${clientDeptFilter || clientDeptMenuOpen ? 'text-indigo-600' : 'text-slate-300'}`} aria-hidden>
                                    ▼
                                  </span>
                                </button>
                                {clientDeptMenuOpen && (
                                  <div className="absolute left-0 top-full mt-1 z-30 min-w-[140px] max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1 normal-case tracking-normal">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setClientDeptFilter(null);
                                        setClientDeptMenuOpen(false);
                                        setModalPage(1);
                                      }}
                                      className={`w-full text-left px-3 py-1.5 text-[11px] font-bold hover:bg-indigo-50 ${
                                        !clientDeptFilter ? 'text-indigo-600 bg-indigo-50/60' : 'text-slate-600'
                                      }`}
                                    >
                                      전체 부서
                                    </button>
                                    {clientDeptOptions.length === 0 ? (
                                      <div className="px-3 py-2 text-[10px] text-slate-300 font-bold">부서 없음</div>
                                    ) : (
                                      clientDeptOptions.map((dept) => (
                                        <button
                                          key={dept}
                                          type="button"
                                          onClick={() => {
                                            setClientDeptFilter(dept);
                                            setClientDeptMenuOpen(false);
                                            setModalPage(1);
                                          }}
                                          className={`w-full text-left px-3 py-1.5 text-[11px] font-bold hover:bg-indigo-50 truncate ${
                                            clientDeptFilter === dept ? 'text-indigo-600 bg-indigo-50/60' : 'text-slate-700'
                                          }`}
                                          title={dept}
                                        >
                                          {dept}
                                        </button>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              '부서명'
                            )}
                          </th>
                          <th className="p-3 text-center">지급수량</th>
                          <th className="p-3 text-center">지급일자</th>
                          <th className="p-3 text-center">신청자 (부서)</th>
                        </>
                      ) : (
                        <>
                          <th className="p-3">관리센터</th>
                          <th className="p-3 text-center">현재재고</th>
                          <th className="p-3 text-center text-red-500">알림기준</th>
                          <th className="p-3 text-center">이동</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedModalData.map((row, i) => {
                      const globalNo = rawModalData.length - ((modalPage - 1) * modalItemsPerPage + i);
                      return (
                        <tr key={i} className="hover:bg-white transition-colors bg-transparent h-12">
                          <td className="p-3 text-center text-slate-400">{globalNo}</td>
                          <td className="p-3 font-black text-slate-800">{row.item?.name || row.name}</td>
                          {(modalType === 'DIST' || modalType === 'CLIENT' || modalType === 'ITEM') ? (
                            <>
                              <td className="p-3 text-slate-700 font-black">{row.client_name}</td>
                              <td className="p-3 text-slate-500 font-bold text-[11px]">{row.client_dept || '-'}</td>
                              <td className="p-3 text-center text-indigo-600 font-black">{row.qty}EA</td>
                              <td className="p-3 text-center text-slate-400 font-mono">
                                {getKSTDateString(getDistBusinessDate(row) as string)}
                              </td>
                              <td className="p-3 text-center text-slate-600">
                                 <span className="font-black block">{row.sender_name}</span>
                                 <span className="text-[9px] text-slate-400 block mt-0.5">{row.sender_dept}</span>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-3 text-slate-600">{row.owner_dept}</td>
                              <td className="p-3 text-center text-red-600 font-black">{row.current_stock}EA</td>
                              <td className="p-3 text-center text-slate-400">{row.alert_qty}EA</td>
                              <td className="p-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => { closeModal(); handleGoClick(row); }}
                                  className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-[9px] font-black hover:bg-indigo-600 transition-colors shadow-sm"
                                >GO</button>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {rawModalData.length === 0 && (
                      <tr><td colSpan={7} className="p-12 text-center text-slate-300 font-black">표시할 데이터가 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {totalModalPages > 1 && (
                <div className="flex justify-center items-center gap-1 py-4 mt-4 border-t bg-slate-50">
                  <button 
                    disabled={modalPage === 1} 
                    onClick={() => setModalPage(p => p - 1)} 
                    className="px-2.5 py-1 text-[11px] font-bold bg-white border border-slate-200 rounded-lg disabled:opacity-30 text-slate-600"
                  >
                    이전
                  </button>
                  {Array.from({ length: totalModalPages }).map((_, idx) => (
                    <button 
                      key={idx} 
                      onClick={() => setModalPage(idx + 1)} 
                      className={`w-6 h-6 rounded-lg text-[10px] font-black transition-all ${modalPage === idx + 1 ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 border'}`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                  <button 
                    disabled={modalPage === totalModalPages} 
                    onClick={() => setModalPage(p => p + 1)} 
                    className="px-2.5 py-1 text-[11px] font-bold bg-white border border-slate-200 rounded-lg disabled:opacity-30 text-slate-600"
                  >
                    다음
                  </button>
                </div>
              )}
            </div>
            
            <div className="p-4 bg-white border-t shrink-0 flex flex-wrap justify-center items-center gap-2">
              {modalType === 'ITEM' && activeCatalogItem && (
                <button
                  type="button"
                  onClick={() => {
                    const name = encodeURIComponent(activeCatalogItem.name);
                    const dept = encodeURIComponent(activeCatalogItem.owner_dept || 'ALL');
                    closeModal();
                    router.push(`/marketing/distribution/catalog?dept=${dept}&search=${name}`);
                  }}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs shadow-md hover:bg-indigo-500 active:scale-95 transition-all"
                >
                  카탈로그에서 보기
                </button>
              )}
              {modalType === 'ITEM' && !activeCatalogItem && (
                <span className="text-[11px] font-bold text-slate-400 mr-2">종료·미활성 물품 — 지급 이력만 조회됩니다</span>
              )}
              <button onClick={closeModal} className="px-10 py-3 bg-slate-900 text-white rounded-xl font-black text-xs shadow-md hover:bg-slate-800 active:scale-95 transition-all">확인 및 창 닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}