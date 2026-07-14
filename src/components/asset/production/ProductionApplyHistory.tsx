'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

const CATEGORIES = [
  { id: 'ALL', label: '전체 내역', icon: '📋' },
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'BANNER', label: '현수막', icon: '📜' },
  { id: 'MEDAL', label: '기타 제작물', icon: '🏆' },
];

// 🚀 [디펜스 코드] DB에 ID로 저장된 값들을 이력 대장에서 완벽한 명칭으로 복원하는 마스터 매핑 대장
const VENDOR_MAP: Record<string, string> = {
  'VEND_01': '아트로릭',
  'VEND_02': '제로에너지인증센터 제작공장',
  'VEND_03': 'ESG인증센터 제작 총괄처',
  'VEND_04': '적합성인증센터 지정 외주사',
};

const CERT_MAP: Record<string, string> = {
  'GREEN': '녹색건축인증',
  'ENERGY': '건축물에너지효율등급인증',
  'OLD_ZEB': '(구) 제로에너지건축물인증',
  'INTEGRATED_ZEB': '(통합) 제로에너지건축물인증',
  'CONFORMITY': '적합성인증센터',
  'ESG_CENTER': 'ESG인증센터',
};

const ITEMS_PER_PAGE = 20;

export default function ProductionApplyHistory() {
  const [histories, setHistories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailItem, setDetailItem] = useState<any>(null);

  useEffect(() => {
    fetch('/api/asset/production/apply/history?scope=OWN')
      .then(res => res.json())
      .then(data => {
        setHistories(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
  }, [activeCategory, selectedYear, selectedMonth]);

  // 🚀 ID인 경우 한글 명칭으로 변환해 주는 헬퍼 함수 (이미 명칭인 경우 그대로 유지)
  const getVendorLabel = (val: string) => VENDOR_MAP[val] || val || '-';
  const getCertLabel = (val: string) => CERT_MAP[val] || val || '-';

  const filteredHistories = useMemo(() => {
    return histories.filter(item => {
      const date = new Date(item.createdAt);
      const itemYear = date.getFullYear().toString();
      const itemMonth = (date.getMonth() + 1).toString().padStart(2, '0');

      const matchCategory = activeCategory === 'ALL' || item.category === activeCategory;
      const matchYear = selectedYear === 'ALL' || itemYear === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || itemMonth === selectedMonth;

      return matchCategory && matchYear && matchMonth;
    });
  }, [histories, activeCategory, selectedYear, selectedMonth]);

  const totalPages = Math.ceil(filteredHistories.length / ITEMS_PER_PAGE);
  const paginatedHistories = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredHistories.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredHistories, currentPage]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedIds(paginatedHistories.map(item => item.id));
    else setSelectedIds([]);
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  // 🚀 외주 발주용 엑셀 다운로드 (내부 정보인 예상단가, 보조서식 제외 + 한글 라벨 완벽 파싱)
  const handleExcelDownload = () => {
    const targetData = selectedIds.length > 0 
      ? filteredHistories.filter(item => selectedIds.includes(item.id))
      : filteredHistories;

    if (targetData.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const headers = [
      '관리번호', '분류', '업체명', '신청일자', '소속조직', '담당자', '신청수량', 
      '품목사양', '인증종류', '인증등급', '프로젝트명', '인증번호', '출력유효기간', 
      '배송지_수령인', '배송지_연락처', '배송지_주소', '추가요청사항'
    ];

    const rows = targetData.map(item => {
      const opt = item.options || {};
      const customReqs = Array.isArray(opt.customRequests) ? opt.customRequests.join(' / ') : '';
      const plateInfo = opt.plateMasterInfo ? `${opt.plateMasterInfo.label}(${opt.plateMasterInfo.size})` : '';

      return [
        item.postNumber,
        CATEGORIES.find(c => c.id === item.category)?.label || item.category,
        `"${getVendorLabel(opt.vendor).replace(/"/g, '""')}"`, // 🚀 ID 치환 컴파일 가드 적용
        new Date(item.createdAt).toISOString().split('T')[0],
        `"${(item.deptName || '').replace(/"/g, '""')}"`,
        `"${(item.userName || '').replace(/"/g, '""')}"`,
        item.quantity,
        `"${(plateInfo || '').replace(/"/g, '""')}"`,
        `"${getCertLabel(opt.certType).replace(/"/g, '""')}"`, // 🚀 ID 치환 컴파일 가드 적용
        `"${(opt.certLevel || '').replace(/"/g, '""')}"`,
        `"${(item.title || '').replace(/"/g, '""')}"`,
        `"${(opt.certNumber || '').replace(/"/g, '""')}"`,
        `"${(opt.formattedValidPeriod || '').replace(/"/g, '""')}"`,
        `"${(opt.receiverName || '').replace(/"/g, '""')}"`,
        `"${(opt.receiverPhone || '').replace(/"/g, '""')}"`,
        `"${(opt.shippingAddress || '').replace(/"/g, '""')}"`,
        `"${customReqs.replace(/"/g, '""')}"`
      ].join(',');
    });

    const csvContent = "\uFEFF" + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `제작발주_요청서_${selectedIds.length > 0 ? '선택항목' : '전체항목'}.csv`;
    link.click();
  };

  const DetailRow = ({ label, value, highlight = false }: { label: string, value: React.ReactNode, highlight?: boolean }) => (
    <div className="flex flex-col gap-1 border-b border-slate-100 pb-3">
      <span className="text-[10px] font-black text-slate-400">{label}</span>
      <span className={`text-xs font-bold ${highlight ? 'text-blue-600' : 'text-slate-800'}`}>
        {value || <span className="text-slate-300 font-medium">미입력 / 해당없음</span>}
      </span>
    </div>
  );

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      {/* 배너 */}
      <div className="w-full bg-slate-50 border-2 border-blue-500 p-6 rounded-[2.5rem] shadow-sm relative overflow-hidden flex flex-col justify-center min-h-[140px]">
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-3">APPLICATION HISTORY TRACKER</h3>
            <h1 className="text-2xl font-black tracking-tight text-slate-800 leading-none flex items-center flex-wrap gap-2.5">
              <span>나의 맞춤 제작물 신청 이력</span>
            </h1>
            <p className="text-slate-500 text-xs font-semibold mt-4 opacity-95">🔒 현재 모드: 신청 내역 상세 보기 및 추적 (읽기 전용)</p>
          </div>
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-2xl mt-4">
        {[
          { name: '✍️ 신규 제작물 신청', path: '/asset/production/apply/request' }, 
          { name: '📂 나의 신청 이력 관리', path: '/asset/production/apply/history' }
        ].map((tab) => (
          <Link key={tab.path} href={tab.path} className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${tab.path === '/asset/production/apply/history' ? 'bg-white text-blue-600 shadow-sm border border-blue-200/50 scale-[1.01]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'}`}>
            {tab.name}
          </Link>
        ))}
      </div>

      {/* 카테고리 필터 */}
      <div className="flex flex-wrap gap-3 pt-2 w-full">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-xs transition-all duration-200 shadow-sm
              ${activeCategory === cat.id 
                ? 'bg-slate-800 text-white shadow-lg scale-[1.02] border-transparent' 
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
          >
            <span className="text-sm">{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* 데이터시트 영역 */}
      <div className="mt-4 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">제작물 신청 내역 대장</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredHistories.length}건</span>
            {selectedIds.length > 0 && (
              <span className="text-[10px] font-black text-blue-600 ml-2 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                {selectedIds.length}개 선택됨
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-slate-400">
              <option value="ALL">전체 년도</option>
              <option value="2026">2026년</option>
              <option value="2025">2025년</option>
            </select>
            
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-slate-400">
              <option value="ALL">전체 월</option>
              {Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')).map(m => (
                <option key={m} value={m}>{m}월</option>
              ))}
            </select>

            <button 
              onClick={handleExcelDownload}
              className="ml-2 flex items-center gap-1.5 px-4 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-black hover:bg-emerald-100 transition-colors shadow-sm"
            >
              <span>📊</span> {selectedIds.length > 0 ? '선택 외주 발주서 다운로드' : '전체 외주 발주서 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <div className="p-20 text-center text-blue-500 font-black animate-pulse uppercase tracking-widest">
              Fetching History Data...
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-6 w-12 text-center">
                    <input 
                      type="checkbox" 
                      className="w-3.5 h-3.5 accent-blue-600 rounded cursor-pointer"
                      checked={paginatedHistories.length > 0 && selectedIds.length === paginatedHistories.length}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th className="h-12 px-2">관리번호</th>
                  <th className="h-12 px-3 text-center">분류</th>
                  <th className="h-12 px-4">프로젝트 명칭</th>
                  <th className="h-12 px-3 text-center">수량</th>
                  <th className="h-12 px-3 text-center">신청일</th>
                  <th className="h-12 pr-6 text-center">액션 및 상태</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedHistories.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-10 text-slate-400">조건에 맞는 신청 내역이 없습니다.</td>
                  </tr>
                ) : paginatedHistories.map((item: any) => (
                  <tr key={item.id} className={`h-16 transition-colors group ${selectedIds.includes(item.id) ? 'bg-blue-50/30' : 'hover:bg-slate-50/50'}`}>
                    <td className="pl-6 text-center">
                      <input 
                        type="checkbox" 
                        className="w-3.5 h-3.5 accent-blue-600 rounded cursor-pointer"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => handleSelectOne(item.id)}
                      />
                    </td>
                    <td className="px-2 text-slate-500 font-mono text-[10px] group-hover:text-blue-600 transition-colors">
                      {item.postNumber}
                    </td>
                    <td className="px-3 text-center">
                      <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-[10px] font-black">
                        {CATEGORIES.find(c => c.id === item.category)?.label || item.category}
                      </span>
                    </td>
                    <td className="px-4">
                      <div className="font-black text-slate-900 line-clamp-1">{item.title || '-'}</div>
                      <div className="text-[10px] text-slate-400 font-normal mt-0.5 line-clamp-1">
                        {item.options?.plateMasterInfo?.label || '세부 옵션'} / {getVendorLabel(item.options?.vendor)}
                      </div>
                    </td>
                    <td className="px-3 text-center text-slate-500 font-mono">
                      {item.quantity}EA
                    </td>
                    <td className="px-3 text-center text-slate-500 text-[10px]">
                      {new Date(item.createdAt).toISOString().split('T')[0]}
                    </td>
                    <td className="pr-6 text-center space-x-2 flex items-center justify-center h-16">
                      <button 
                        onClick={() => setDetailItem(item)}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-[9px] font-black text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-all shadow-sm"
                      >
                        내용보기
                      </button>
                      <span className={`inline-block w-[64px] px-1 py-1 rounded text-[9px] font-black tracking-tight border shadow-sm
                        ${item.status === 'PENDING' ? 'bg-amber-50 text-amber-600 border-amber-200' : 
                          item.status === 'ORDERED' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                          item.status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                          'bg-slate-100 text-slate-500 border-slate-200'}`}
                      >
                        {item.status === 'PENDING' ? '⏳ 대기중' : 
                         item.status === 'ORDERED' ? '🚚 제작중' : 
                         item.status === 'VERIFIED' ? '✅ 정산완료' : item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => {
              const pageNum = i + 1;
              if (pageNum < currentPage - 2 || pageNum > currentPage + 2) return null;
              return (
                <button key={i} onClick={() => setCurrentPage(pageNum)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === pageNum ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{pageNum}</button>
              );
            })}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </div>

      {/* 🚀 상세 보기 모달 팝업 (치환 가드 컴파일 완료) */}
      {detailItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-[10px] font-black tracking-widest text-blue-400 uppercase">APPLICATION FULL SPECIFICATION</h3>
                <h2 className="text-lg font-black mt-0.5">신청 내역 원장 보기 ({detailItem.postNumber})</h2>
              </div>
              <button type="button" onClick={() => setDetailItem(null)} className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95">닫기 ✕</button>
            </div>
            
            <div className="p-8 overflow-y-auto bg-slate-50 space-y-8 flex-1">
              
              {/* 1. 기본 정보 블록 */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h4 className="font-black text-slate-700 text-sm border-b pb-2">기본 연동 정보</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <DetailRow label="관리번호" value={detailItem.postNumber} highlight />
                  <DetailRow label="분류" value={CATEGORIES.find(c => c.id === detailItem.category)?.label || detailItem.category} />
                  <DetailRow label="업체명" value={getVendorLabel(detailItem.options?.vendor)} highlight />
                  <DetailRow label="신청일" value={new Date(detailItem.createdAt).toISOString().split('T')[0]} />
                  <DetailRow label="소속조직" value={detailItem.deptName} />
                  <DetailRow label="담당자" value={detailItem.userName} />
                </div>
              </div>

              {/* 2. 명판 사양 블록 */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h4 className="font-black text-slate-700 text-sm border-b pb-2">제작 사양 및 인증서 정보</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <DetailRow label="신청수량" value={`${detailItem.quantity} EA`} />
                  <div className="col-span-2">
                    <DetailRow label="품목사양" value={detailItem.options?.plateMasterInfo ? `${detailItem.options.plateMasterInfo.label} (${detailItem.options.plateMasterInfo.size})` : null} />
                  </div>
                  <DetailRow label="예상가격 (내부참고용)" value={`${detailItem.estimatedPrice?.toLocaleString()} 원`} highlight />
                  
                  <DetailRow label="인증의 종류" value={getCertLabel(detailItem.options?.certType)} />
                  <DetailRow label="인증 등급" value={detailItem.options?.certLevel} />
                  <div className="col-span-2">
                    <DetailRow label="프로젝트명" value={detailItem.title} />
                  </div>
                  
                  <DetailRow label="인증번호" value={detailItem.options?.certNumber} />
                  <div className="col-span-3">
                    <DetailRow label="명판유효기간 (출력양식)" value={detailItem.options?.formattedValidPeriod} highlight />
                  </div>
                </div>
              </div>

              {/* 3. 배송지 및 추가 요청사항 */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h4 className="font-black text-slate-700 text-sm border-b pb-2">배송지 및 추가 요청사항</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2">
                    <DetailRow 
                      label="추가요청사항" 
                      value={
                        detailItem.options?.customRequests && detailItem.options.customRequests.length > 0
                        ? <ul className="list-disc list-inside">{detailItem.options.customRequests.map((req: string, i: number) => <li key={i}>{req}</li>)}</ul>
                        : null
                      } 
                    />
                  </div>
                  <DetailRow label="배송지 수령인 이름" value={detailItem.options?.receiverName} />
                  <DetailRow label="배송지 연락처" value={detailItem.options?.receiverPhone} />
                  <div className="col-span-2">
                    <DetailRow label="최종 배송지 주소" value={detailItem.options?.shippingAddress} />
                  </div>
                </div>
              </div>

              {/* 4. 내부 보조 서식 블록 */}
              <div className="bg-slate-100/50 p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h4 className="font-black text-slate-700 text-sm border-b border-slate-200 pb-2">시스템 내부 보조 서식</h4>
                <div className="grid grid-cols-3 gap-6">
                  <DetailRow label="회사 법인명" value={detailItem.options?.companyName} />
                  <DetailRow label="신청인 성명" value={detailItem.options?.applicantName} />
                  <DetailRow label="신청인 연락처" value={detailItem.options?.applicantPhone} />
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}