'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#64748b'];

export default function DashboardModule() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 🚀 모달 상태 제어 ('CLIENT' 타입 추가)
  const [modalType, setModalType] = useState<'DIST' | 'ALERT' | 'CLIENT' | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [iRes, dRes, pRes] = await Promise.all([
          fetch('/api/marketing/items'),
          fetch('/api/marketing/distributions'),
          fetch('/api/marketing/purchases')
        ]);
        if (iRes.ok) setItems(await iRes.json());
        if (dRes.ok) setDistributions(await dRes.json());
        if (pRes.ok) setPurchases(await pRes.json());
      } catch (error) { console.error(error); }
      setLoading(false);
    };
    fetchData();
  }, []);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // 1. 핵심 지표 계산
  const kpi = useMemo(() => {
    const totalInventoryValue = items.reduce((acc, cur) => acc + (cur.unit_price * cur.current_stock), 0);
    const thisMonthDists = distributions.filter(d => {
      const dDate = new Date(d.createdAt);
      return dDate.getFullYear() === currentYear && dDate.getMonth() + 1 === currentMonth;
    });
    const alertItems = items.filter(i => i.alert_qty > 0 && i.current_stock <= i.alert_qty);
    return {
      totalInventoryValue,
      thisMonthDistList: thisMonthDists,
      thisMonthDistValue: thisMonthDists.reduce((acc, cur) => acc + ((cur.item?.unit_price || 0) * cur.qty), 0),
      alertItemsList: alertItems
    };
  }, [items, distributions, currentYear, currentMonth]);

  // 2. 월별 추이 데이터
  const monthlyData = useMemo(() => {
    const data = Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}월`, 지급금액: 0, 입고금액: 0 }));
    distributions.forEach(d => {
      const dDate = new Date(d.createdAt);
      if (dDate.getFullYear() === currentYear) data[dDate.getMonth()].지급금액 += (d.item?.unit_price || 0) * d.qty;
    });
    purchases.forEach(p => {
      const pDate = new Date(p.purchase_date);
      if (pDate.getFullYear() === currentYear) data[pDate.getMonth()].입고금액 += p.total_price || 0;
    });
    return data;
  }, [distributions, purchases, currentYear]);

  // 3. 인기 물품 TOP 5
  const topItemsData = useMemo(() => {
    const itemCounts: Record<string, number> = {};
    distributions.forEach(d => {
      if (new Date(d.createdAt).getFullYear() === currentYear) {
        const itemName = d.item?.name || '기타';
        itemCounts[itemName] = (itemCounts[itemName] || 0) + d.qty;
      }
    });
    return Object.entries(itemCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [distributions, currentYear]);

  // 4. 최다 수령 고객사 TOP 5
  const topClientsData = useMemo(() => {
    const clientCounts: Record<string, number> = {};
    distributions.forEach(d => {
      if (new Date(d.createdAt).getFullYear() === currentYear) {
        clientCounts[d.client_name] = (clientCounts[d.client_name] || 0) + d.qty;
      }
    });
    return Object.entries(clientCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [distributions, currentYear]);

  // 🚀 특정 고객사의 지급 상세 내역 (모달용)
  const clientDistList = useMemo(() => {
    if (modalType !== 'CLIENT' || !selectedClient) return [];
    return distributions
      .filter(d => d.client_name === selectedClient && new Date(d.createdAt).getFullYear() === currentYear)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [distributions, modalType, selectedClient, currentYear]);

  // 카탈로그 이동 함수 (검색어 + 부서 파라미터 동시 전달)
  const handleGoClick = (row: any) => {
    const itemName = encodeURIComponent(row.item?.name || row.name);
    const deptName = encodeURIComponent(row.owner_dept || 'ALL');
    router.push(`/marketing/distribution/catalog?dept=${deptName}&search=${itemName}`);
  };

  if (loading) return <div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">Syncing Hub Intelligence...</div>;

  // 🚀 현재 띄워야 할 모달의 데이터
  const modalData = modalType === 'DIST' ? kpi.thisMonthDistList : 
                    modalType === 'CLIENT' ? clientDistList : 
                    kpi.alertItemsList;

  return (
    <div className="p-8 space-y-6 font-sans max-w-[1600px] mx-auto pb-24 animate-fade-in relative z-10">
      
      <div className="bg-slate-900 px-8 py-5 rounded-[1.5rem] shadow-lg flex justify-between items-center text-white relative overflow-hidden border-b-4 border-indigo-500">
        <div className="relative z-10">
          <h2 className="text-xl font-black tracking-tight flex items-center gap-3 italic">
            <span className="text-indigo-400">●</span> 마케팅 통합 대시보드
          </h2>
        </div>
        <div className="relative z-10">
          <span className="bg-white/10 text-slate-300 font-bold px-3 py-1.5 rounded-lg text-[11px] border border-white/10">
            Current Analysis: {currentYear} YEAR
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">총 재고 자산 가치</p>
          <h3 className="text-xl font-black text-slate-900 mt-2">{kpi.totalInventoryValue.toLocaleString()} 원</h3>
        </div>
        
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentMonth}월 지급 예산</p>
          <h3 className="text-xl font-black text-emerald-600 mt-2">{kpi.thisMonthDistValue.toLocaleString()} 원</h3>
        </div>

        <div 
          onClick={() => setModalType('DIST')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-500 hover:bg-indigo-50/30 transition-all group"
        >
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-black text-slate-400 group-hover:text-indigo-600 transition-colors uppercase tracking-widest">{currentMonth}월 지급 건수</p>
            <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-black opacity-0 group-hover:opacity-100 transition-opacity">DETAIL</span>
          </div>
          <h3 className="text-xl font-black text-slate-900 mt-2 group-hover:text-indigo-600">{kpi.thisMonthDistList.length} 건</h3>
        </div>

        <div 
          onClick={() => setModalType('ALERT')}
          className={`p-5 rounded-2xl border shadow-sm cursor-pointer transition-all group ${kpi.alertItemsList.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}
        >
          <div className="flex justify-between items-start">
            <p className={`text-[10px] font-black uppercase tracking-widest ${kpi.alertItemsList.length > 0 ? 'text-red-500' : 'text-slate-400'}`}>재고 확보 요망</p>
            {kpi.alertItemsList.length > 0 && <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black animate-pulse">ACTION</span>}
          </div>
          <h3 className={`text-xl font-black mt-2 ${kpi.alertItemsList.length > 0 ? 'text-red-600' : 'text-slate-900'}`}>{kpi.alertItemsList.length} 종류</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2"><span>📈</span> 월별 예산 집행 및 수급 추이</h3>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(val) => `${val/10000}만`} />
                <Tooltip formatter={(val: any) => [`${Number(val).toLocaleString()}원`, '']} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                <Bar dataKey="지급금액" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar dataKey="입고금액" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col">
          <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><span>🏆</span> 인기 지급 물품 TOP 5</h3>
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={topItemsData} innerRadius={50} outerRadius={75} paddingAngle={5} dataKey="value">
                  {topItemsData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(val: any, name: any) => [`${val}개`, `${name}`]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2 flex-1">
            {topItemsData.map((item, i) => (
              <div 
                key={i} 
                onClick={() => router.push(`/marketing/distribution/catalog?search=${encodeURIComponent(item.name)}`)}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-indigo-50 cursor-pointer transition-colors border border-transparent hover:border-indigo-100 group"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white ${i < 3 ? 'bg-indigo-600' : 'bg-slate-300'}`}>{i + 1}</span>
                  <span className="text-[11px] font-bold text-slate-700 group-hover:text-indigo-700">{item.name}</span>
                </div>
                <span className="text-[11px] font-black text-indigo-600">{item.value}EA</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
        <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2"><span>🏢</span> 물품 최다 수령 고객사 Ranking</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {topClientsData.length === 0 ? (
            <p className="col-span-5 text-center text-slate-400 py-10 font-bold">지급 데이터가 없습니다.</p>
          ) : topClientsData.map((client, i) => (
            <div 
              key={i} 
              onClick={() => { setModalType('CLIENT'); setSelectedClient(client.name); }}
              className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col items-center text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/50 transition-all group"
            >
               <span className="text-[10px] font-black text-indigo-500 mb-1 group-hover:scale-110 transition-transform">Rank {i+1}</span>
               <h4 className="text-[13px] font-black text-slate-800 line-clamp-1 mb-2 group-hover:text-indigo-700">{client.name}</h4>
               <div className="px-3 py-1 bg-white rounded-full border border-slate-200 text-indigo-600 font-black text-[12px] group-hover:border-indigo-200 shadow-sm">
                 {client.value.toLocaleString()} <span className="text-[9px] text-slate-400 ml-0.5">EA</span>
               </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-black text-slate-800 mb-4 pl-2 flex items-center gap-2"><span>⚡</span> Quick Links</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Link href="/marketing/distribution/catalog" className="group bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-400 transition-all flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">🎁</div>
            <div><h4 className="font-black text-sm text-slate-800">기념품 카탈로그</h4><p className="text-[10px] text-slate-400 font-bold mt-0.5">재고 현황 및 신규 등록</p></div>
          </Link>
          <Link href="/marketing/distribution/client-search" className="group bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg transition-all flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">🏢</div>
            <div><h4 className="font-black text-sm text-slate-800">고객사별 수령 현황</h4><p className="text-[10px] text-slate-400 font-bold mt-0.5">고객사 관리 및 이력 조회</p></div>
          </Link>
          <Link href="/marketing/distribution/register" className="group bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg transition-all flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">✍️</div>
            <div><h4 className="font-black text-sm text-slate-800">나의 지급 등록</h4><p className="text-[10px] text-slate-400 font-bold mt-0.5">물품 지급 및 재고 차감</p></div>
          </Link>
          <Link href="/marketing/distribution/purchase" className="group bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg transition-all flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">📥</div>
            <div><h4 className="font-black text-sm text-slate-800">입고 내역 대장</h4><p className="text-[10px] text-slate-400 font-bold mt-0.5">구매 이력 및 입고 관리</p></div>
          </Link>
        </div>
      </div>

      {/* 🚀 상세 리스트 모달 (팝업) */}
      {modalType && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6" onClick={() => { setModalType(null); setSelectedClient(null); }}>
          <div className="bg-white w-full max-w-4xl max-h-[80vh] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className={`p-6 text-white flex justify-between items-center ${modalType === 'ALERT' ? 'bg-red-600' : 'bg-indigo-600'}`}>
              <h3 className="font-black text-lg flex items-center gap-2">
                <span>{modalType === 'ALERT' ? '🚨' : modalType === 'CLIENT' ? '🏢' : '📊'}</span>
                {modalType === 'DIST' && `${currentMonth}월 상세 지급 리스트`}
                {modalType === 'CLIENT' && `${selectedClient} 상세 수령 리스트 (${currentYear}년)`}
                {modalType === 'ALERT' && '재고 확보 필요 품목 리스트'}
              </h3>
              <button onClick={() => { setModalType(null); setSelectedClient(null); }} className="text-2xl hover:rotate-90 transition-transform">✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto bg-slate-50 flex-1">
              <table className="w-full text-left text-[11px] font-bold">
                <thead className="bg-white border-b sticky top-0 shadow-sm">
                  <tr className="text-slate-400 uppercase tracking-widest">
                    <th className="p-3 w-12 text-center">NO</th>
                    <th className="p-3">물품명</th>
                    {(modalType === 'DIST' || modalType === 'CLIENT') ? (
                      <>
                        <th className="p-3">수령 고객사</th>
                        <th className="p-3 text-center">지급수량</th>
                        <th className="p-3 text-center">지급일자</th>
                        <th className="p-3 text-center">신청자 (부서)</th>
                      </>
                    ) : (
                      <>
                        <th className="p-3">소속센터</th>
                        <th className="p-3 text-center">현재재고</th>
                        <th className="p-3 text-center text-red-500">알림기준</th>
                        <th className="p-3 text-center">이동</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {modalData.map((row, i) => (
                    <tr key={i} className="hover:bg-white transition-colors bg-transparent h-12">
                      <td className="p-3 text-center text-slate-400">{i + 1}</td>
                      <td className="p-3 font-black text-slate-800">{row.item?.name || row.name}</td>
                      {(modalType === 'DIST' || modalType === 'CLIENT') ? (
                        <>
                          <td className="p-3 text-slate-600">{row.client_name}</td>
                          <td className="p-3 text-center text-indigo-600 font-black">{row.qty}EA</td>
                          <td className="p-3 text-center text-slate-400 font-mono">{new Date(row.createdAt).toISOString().split('T')[0]}</td>
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
                              onClick={() => handleGoClick(row)}
                              className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-[9px] font-black hover:bg-indigo-600 transition-colors shadow-sm"
                            >GO</button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {modalData.length === 0 && (
                    <tr><td colSpan={6} className="p-12 text-center text-slate-300 font-black">표시할 데이터가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-white border-t text-center">
               <button onClick={() => { setModalType(null); setSelectedClient(null); }} className="px-10 py-3 bg-slate-900 text-white rounded-xl font-black text-xs shadow-md hover:bg-slate-800 active:scale-95 transition-all">확인 및 창 닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}