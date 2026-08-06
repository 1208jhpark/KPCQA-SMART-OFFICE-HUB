'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/navigation';
import { usePathname } from 'next/navigation';
import { getKSTDateString } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';

// 🚀 [신청 페이지 CATEGORIES와 1:1 싱크 통일 + 전체내역 탭 추가]
const HISTORY_CATEGORIES = [
  { id: 'ALL', label: '전체 내역', icon: '📋' },
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

const ITEMS_PER_PAGE = 20;

export default function ProductionApplyHistory() {
  const [histories, setHistories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  const [activeCategory, setActiveCategory] = useState('ALL');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailItem, setDetailItem] = useState<any>(null);

  // 🎯 본인(scope=OWN) 자료만 가져오도록 명확하게 필터 벨트 바인딩
  useEffect(() => {
    setLoading(true);
    fetch('/api/asset/production/apply/history?scope=OWN', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setHistories(data);
        } else {
          setHistories([]);
        }
      })
      .catch((err) => console.error('히스토리 로드 실패:', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
  }, [activeCategory, selectedYear, selectedMonth]);

  // 🚀 코드가 아닌 한글 매핑 명칭을 안전하게 추출하는 공통 헬퍼
  const getCategoryLabel = (catId: string) => {
    const found = HISTORY_CATEGORIES.find((c) => c.id === catId);
    return found ? found.label : catId;
  };

  const filteredHistories = useMemo(() => {
    return histories.filter((item) => {
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
    if (e.target.checked) setSelectedIds(paginatedHistories.map((item) => item.id));
    else setSelectedIds([]);
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // 🚀 [지침 완벽 반영]: 시스템 내부 보조 서식을 철저히 배제하고 순서대로 엑셀(CSV) 추출
  const handleExcelDownload = () => {
    const targetData =
      selectedIds.length > 0
        ? filteredHistories.filter((item) => selectedIds.includes(item.id))
        : filteredHistories;

    if (targetData.length === 0) return alert('다운로드할 데이터가 없습니다.');

    // 외주 제작사 전달용 최적화 헤더 스펙 (보조 서식 차단 완료)
    const headers = [
      '관리번호',
      '분류명',
      '배정업체',
      '신청일자',
      '소속부서',
      '담당자',
      '신청수량',
      '예상단가 합계',
      '주요 제작물 명세 및 옵션',
      '배송지 수령인',
      '수령인 연락처',
      '최종 배송지 주소',
    ];

    const rows = targetData.map((item) => {
      const opt = item.options || {};
      
      // 카테고리별 옵션 명세 문자열 가공
      let detailSpec = '';
      if (item.category === 'SIGN') {
        detailSpec = `사양: ${opt.plateMasterInfo?.label || ''}(${opt.plateMasterInfo?.size || ''}) / 인증: ${opt.certType || ''} / 등급: ${opt.certLevel || ''} / 유효기간: ${opt.formattedValidPeriod || '해당없음'}`;
      } else if (item.category === 'JEBON') {
        detailSpec = `판형: ${opt.jebonSize || 'A4'} / 표지: ${opt.coverColor || ''}(${opt.coverPageCount || 0}p) / 본문: ${opt.innerColor || ''}(${opt.innerPageCount || 0}p) / 단계: ${opt.certPhase || ''} / 지정일: ${opt.formattedCompDate || '해당없음'}`;
      } else if (item.category === 'PRINT') {
        detailSpec = `품목: ${opt.printCustomName || opt.printItemType || ''} / 인쇄문구1: ${opt.printItemDetails || ''} / 인쇄문구2: ${opt.printDeliveryDetails || ''}`;
      } else if (item.category === 'OFFICE_SUPPLIES') {
        detailSpec = `견적 원장 텍스트 키pping 내역 존재`;
      }

      return [
        item.postNumber,
        getCategoryLabel(item.category),
        `"${(opt.vendor || '-').replace(/"/g, '""')}"`,
        getKSTDateString(item.createdAt),
        `"${(item.deptName || '').replace(/"/g, '""')}"`,
        `"${(item.userName || '').replace(/"/g, '""')}"`,
        item.quantity,
        item.estimatedPrice,
        `"${detailSpec.replace(/"/g, '""')}"`,
        `"${(opt.receiverName || '-').replace(/"/g, '""')}"`,
        `"${(opt.receiverPhone || '-').replace(/"/g, '""')}"`,
        `"${(opt.shippingAddress || '-').replace(/"/g, '""')}"`,
      ].join(',');
    });

    const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `나의_제작신청_이력대장_${selectedIds.length > 0 ? '선택분' : '전체분'}.csv`;
    link.click();
  };

  const DetailSectionTitle = ({ title }: { title: string }) => (
    <h4 className="font-black text-slate-800 text-sm border-b pb-2 mb-3 mt-2 tracking-tight flex items-center gap-1.5">
      <span className="w-1.5 h-3.5 bg-blue-600 rounded-sm"></span>
      {title}
    </h4>
  );

  const DetailRow = ({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) => (
    <div className="flex flex-col gap-1 border-b border-slate-100 pb-2.5">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight">{label}</span>
      <span className={`text-xs font-bold ${highlight ? 'text-blue-600' : 'text-slate-800'}`}>
        {value || <span className="text-slate-300 font-medium">해당없음 / 미기입</span>}
      </span>
    </div>
  );

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      {/* 배너 영역 */}
      <div className="w-full bg-slate-50 border-2 border-blue-500 p-6 rounded-[2.5rem] shadow-sm relative overflow-hidden flex flex-col justify-center min-h-[140px]">
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-3">
              APPLICATION ACCOUNTABILITY CENTER
            </h3>
            <h1 className="text-2xl font-black tracking-tight text-slate-800 leading-none flex items-center flex-wrap gap-2.5">
              <span>나의 맞춤 제작물 신청 이력 관리</span>
            </h1>
            <p className="text-slate-500 text-xs font-semibold mt-4 opacity-95">
              🔒 보완 완료: 본인 인증 계정 기반 데이터 엄격 격리 모드 (실시간 연동 완료)
            </p>
          </div>
        </div>
      </div>

      {/* 탭 네비게이션 구조화 */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-2xl mt-4">
        {[
          { name: '✍️ 신규 제작물 신청', path: '/asset/production/apply/request' },
          { name: '📂 나의 신청 이력 관리', path: '/asset/production/apply/history' },
        ].map((tab) => {
          const isActive = pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => (window.location.href = tab.path)}
              className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${
                isActive
                  ? 'bg-white text-blue-600 shadow-sm border border-blue-200/50 scale-[1.01]'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              {tab.name}
            </button>
          );
        })}
      </div>

      {/* 🚀 상단 카테고리 탭 대장 스위치 (신청 페이지 CATEGORIES 배열과 완벽 매핑 동기화) */}
      <div className="flex flex-wrap gap-3 pt-2 w-full">
        {HISTORY_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={`flex items-center gap-2.5 px-5 py-3.5 rounded-2xl font-black text-xs transition-all duration-200 shadow-sm
              ${
                activeCategory === cat.id
                  ? 'bg-slate-900 text-white shadow-lg scale-[1.02] border-transparent'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
          >
            <span className="text-sm">{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* 테이블 시트 구조부 */}
      <div className="mt-4 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">개인 신청 내역 관리 대장</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
              {filteredHistories.length}건
            </span>
            {selectedIds.length > 0 && (
              <span className="text-[10px] font-black text-blue-600 ml-2 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                {selectedIds.length}개 선택됨
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-slate-400"
            >
              <option value="ALL">전체 년도</option>
              <option value="2026">2026년</option>
              <option value="2025">2025년</option>
            </select>

            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-slate-400"
            >
              <option value="ALL">전체 월</option>
              {Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>

            <button
              onClick={handleExcelDownload}
              className="ml-2 flex items-center gap-1.5 px-4 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-black hover:bg-emerald-100 transition-colors shadow-sm"
            >
              <span>📊</span> {selectedIds.length > 0 ? '선택외주 발주명세 추출' : '전체외주 발주명세 추출'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <LoadingState />
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-6 w-12 text-center">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 accent-blue-600 rounded cursor-pointer"
                      checked={
                        paginatedHistories.length > 0 &&
                        selectedIds.length === paginatedHistories.length
                      }
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th className="h-12 px-2">관리번호</th>
                  {/* 🚀 영문 코드가 아닌 한글 매핑 카테고리명이 뜨도록 완벽 조치 */}
                  <th className="h-12 px-3 text-center">분류</th>
                  {/* 🚀 프로젝트 명칭을 '관리용 제목' 헤더로 치환 맵핑 */}
                  <th className="h-12 px-4">관리용 제목</th>
                  <th className="h-12 px-3 text-center">수량</th>
                  <th className="h-12 px-3 text-center">신청일</th>
                  {/* 🚀 본인 데이터 식별을 직관적으로 보조하는 소속 및 이름 배치 */}
                  <th className="h-12 px-4">소속 부서</th>
                  <th className="h-12 px-4">신청자</th>
                  <th className="h-12 pr-6 Regal-center text-center">액션 및 상태</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedHistories.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center p-10 text-slate-400">
                      신청 가드 범위 내에 해당하는 내역이 존재하지 않습니다.
                    </td>
                  </tr>
                ) : (
                  paginatedHistories.map((item: any) => (
                    <tr
                      key={item.id}
                      className={`h-16 transition-colors group ${
                        selectedIds.includes(item.id) ? 'bg-blue-50/30' : 'hover:bg-slate-50/50'
                      }`}
                    >
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
                        <span className="bg-slate-800 text-slate-100 px-2.5 py-1 rounded text-[10px] font-black tracking-tight">
                          {getCategoryLabel(item.category)}
                        </span>
                      </td>
                      <td className="px-4">
                        <div className="font-black text-slate-900 line-clamp-1">{item.title || '-'}</div>
                        <div className="text-[10px] text-slate-400 font-normal mt-0.5 line-clamp-1">
                          옵션: {item.options?.plateMasterInfo?.label || item.options?.printItemType || '지정 명세'} / 발주처: {item.options?.vendor || '기본'}
                        </div>
                      </td>
                      <td className="px-3 text-center text-slate-500 font-mono">
                        {item.quantity}EA
                      </td>
                      <td className="px-3 text-center text-slate-500 text-[10px]">
                        {getKSTDateString(item.createdAt)}
                      </td>
                      {/* 🚀 추가된 컬럼 데이터 바인딩 */}
                      <td className="px-4 text-slate-600 font-black">{item.deptName || '-'}</td>
                      <td className="px-4 text-blue-600 font-black">{item.userName || '-'}</td>
                      
                      <td className="pr-6 text-center space-x-2 flex items-center justify-center h-16">
                        <button
                          onClick={() => setDetailItem(item)}
                          className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-[10px] font-black hover:bg-slate-50 hover:text-blue-600 transition-all shadow-sm active:scale-95"
                        >
                          🔍 내용보기
                        </button>
                        <span
                          className={`inline-block w-[68px] px-1 py-1 rounded-xl text-[9px] font-black tracking-tight border text-center shadow-sm
                            ${
                              item.status === 'PENDING'
                                ? 'bg-amber-50 text-amber-600 border-amber-200'
                                : item.status === 'ORDERED'
                                ? 'bg-blue-50 text-blue-600 border-blue-200'
                                : item.status === 'VERIFIED'
                                ? 'bg-green-50 text-green-600 border-green-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                        >
                          {item.status === 'PENDING'
                            ? '⏳ 발주대기'
                            : item.status === 'ORDERED'
                            ? '🚚 제작중'
                            : item.status === 'VERIFIED'
                            ? '✅ 정산승인'
                            : item.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* 페이징 패널 */}
        {!loading && totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => {
              const pageNum = i + 1;
              if (pageNum < currentPage - 2 || pageNum > currentPage + 2) return null;
              return (
                <button
                  key={i}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
                    currentPage === pageNum
                      ? 'bg-slate-800 text-white shadow-sm scale-105'
                      : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>

      {/* 🚀 [내용보기 모달의 다이나믹 격리 뷰 조립] */}
      {detailItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-[10px] font-black tracking-widest text-blue-400 uppercase">
                  DEPARTMENTAL PRODUCTION SPECIFICATION LEDGER
                </h3>
                <h2 className="text-xl font-black mt-0.5">제작 신청서 상세 내역 원장 ({detailItem.postNumber})</h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95"
              >
                닫기 ✕
              </button>
            </div>

            <div className="p-8 overflow-y-auto bg-slate-50 space-y-6 flex-1">
              
              {/* 블록 1. 공통 신청 및 소속 담당 정보 */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <DetailSectionTitle title="기본 정보 및 계정 연동 상태" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <DetailRow label="관리번호" value={detailItem.postNumber} highlight />
                  <DetailRow label="업무 분류" value={getCategoryLabel(detailItem.category)} />
                  <DetailRow label="외주 처리사 배정" value={detailItem.options?.vendor} highlight />
                  <DetailRow label="원장 신청일자" value={getKSTDateString(detailItem.createdAt)} />
                  <DetailRow label="소속 본부/부서" value={detailItem.deptName} />
                  <DetailRow label="원장 담당요청자" value={detailItem.userName} />
                  <DetailRow label="신청 총 수량" value={`${detailItem.quantity} EA`} />
                  <DetailRow label="조율 확정 금액" value={detailItem.finalPrice > 0 ? `${detailItem.finalPrice.toLocaleString()} 원` : '대조대기 (월말 확정)'} highlight />
                </div>
              </div>

              {/* 블록 2. 💥 카테고리별 다이나믹 전용 스펙 분기 렌더링 구역 */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                
                {/* CASE A: 현판 / 명판 / 상패 (SIGN) 전용 화면 */}
                {detailItem.category === 'SIGN' && (
                  <div className="animate-fade-in space-y-4">
                    <DetailSectionTitle title="📛 현판 / 명판 / 상패 제작 및 인증 세부 명세" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <DetailRow label="관리용 제목" value={detailItem.title} highlight />
                      <DetailRow label="품목 사양 및 규격" value={detailItem.options?.plateMasterInfo ? `${detailItem.options.plateMasterInfo.label} (${detailItem.options.plateMasterInfo.size})` : null} />
                      <DetailRow label="인증 마스터 대장 종류" value={detailItem.options?.certType} />
                      <DetailRow label="인증 등급/자격" value={detailItem.options?.certLevel} />
                    </div>
                    
                    <div className="p-4 bg-blue-50/40 rounded-xl border border-blue-100 grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                      {detailItem.options?.certType === 'ISO 인증' ? (
                        <>
                          <DetailRow label="[ISO] 표기 기업명" value={detailItem.options?.isoCompanyName} highlight />
                          <DetailRow label="[ISO] 국문 메인문구" value={detailItem.options?.certNumber} />
                          <DetailRow label="[ISO] 영문 메인문구" value={detailItem.options?.isoEngPhrase} />
                        </>
                      ) : (
                        <>
                          <DetailRow label="인쇄용 프로젝트(건물)명" value={detailItem.options?.projectName} highlight />
                          <DetailRow label="인증번호 명세" value={detailItem.options?.certNumber} />
                          <DetailRow label="명판 출력 유효기간 양식" value={detailItem.options?.formattedValidPeriod} highlight />
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* CASE B: 제본 (JEBON) 전용 화면 */}
                {detailItem.category === 'JEBON' && (
                  <div className="animate-fade-in space-y-4">
                    <DetailSectionTitle title="📚 제본 인쇄 도서 제작 명세" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <DetailRow label="관리용 제목" value={detailItem.title} highlight />
                      <DetailRow label="지정 제본 판형" value={detailItem.options?.jebonSize} highlight />
                      <DetailRow label="제본 마스터 종류" value={detailItem.options?.certType} />
                      <DetailRow label="인증 단계 구분" value={detailItem.options?.certPhase} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border mt-2">
                      <div className="p-3 bg-white rounded-lg border shadow-sm">
                        <div className="text-[10px] font-black text-blue-500 mb-2">📘 표지 (Cover) 스펙</div>
                        <div className="grid grid-cols-2 gap-2">
                          <DetailRow label="인쇄 컬러" value={detailItem.options?.coverColor} />
                          <DetailRow label="표지 면수" value={`${detailItem.options?.coverPageCount || 0} 면`} />
                        </div>
                      </div>
                      <div className="p-3 bg-white rounded-lg border shadow-sm">
                        <div className="text-[10px] font-black text-purple-500 mb-2">📄 본문 (Inner) 스펙</div>
                        <div className="grid grid-cols-2 gap-2">
                          <DetailRow label="인쇄 컬러" value={detailItem.options?.innerColor} />
                          <DetailRow label="본문 면수" value={`${detailItem.options?.innerPageCount || 0} 면`} />
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-yellow-50/40 border border-yellow-200 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      {detailItem.options?.certType === '일반제본' ? (
                        <>
                          <DetailRow label="표지 메인 제목" value={detailItem.options?.coverName} highlight />
                          <DetailRow label="표지 서브 부제목" value={detailItem.options?.jebonSubtitle} />
                        </>
                      ) : (
                        <DetailRow label="대상 프로젝트명(건물명)" value={detailItem.options?.jebonBuildingName} highlight />
                      )}
                      <div className="col-span-1 md:col-span-2">
                        <DetailRow label="완료/지정 일자 포맷 출력" value={detailItem.options?.formattedCompDate} highlight />
                      </div>
                    </div>
                  </div>
                )}

                {/* CASE C: 기성품 / 기타 제작물 (PRINT) 전용 화면 */}
                {detailItem.category === 'PRINT' && (
                  <div className="animate-fade-in space-y-4">
                    <DetailSectionTitle title="📜 기성서식 및 제작성 소모품 청구 명세" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <DetailRow label="관리용 제목" value={detailItem.title} highlight />
                      <DetailRow label="주문 기성 물품 종류" value={detailItem.options?.printItemType} highlight />
                      <DetailRow label="인쇄 제작 문구1" value={detailItem.options?.printItemDetails} />
                      <DetailRow label="인쇄 제작 문구2" value={detailItem.options?.printDeliveryDetails} />
                    </div>
                  </div>
                )}

                {/* CASE D: 사무문구류 정산 (OFFICE_SUPPLIES) 전용 화면 */}
                {detailItem.category === 'OFFICE_SUPPLIES' && (
                  <div className="animate-fade-in space-y-4">
                    <DetailSectionTitle title="📎 외부 문구사 견적 파일 텍스트 캡처 본문" />
                    <DetailRow label="관리용 제목" value={detailItem.title} highlight />
                    <div className="bg-slate-900 text-emerald-400 p-4 rounded-xl font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto shadow-inner border border-slate-800">
                      {detailItem.options?.suppliesQuoteRawText || '저장된 원장 텍스트 데이터가 비어 있습니다.'}
                    </div>
                  </div>
                )}

              </div>

              {/* 블록 3. 배송지 주소 명세 (사무문구류 정산 탭 제외 노출) */}
              {detailItem.category !== 'OFFICE_SUPPLIES' && (
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                  <DetailSectionTitle title="🚚 최종 제작 사양 배송 주소지" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <DetailRow label="수령인 이름" value={detailItem.options?.receiverName} />
                    <DetailRow label="수령인 연락처" value={detailItem.options?.receiverPhone} />
                    <div className="col-span-1 md:col-span-3">
                      <DetailRow label="배송지 도로명 상세주소" value={detailItem.options?.shippingAddress} highlight />
                    </div>
                  </div>
                </div>
              )}

              {/* 블록 4. 추가 자유 기재사항 스펙 로그 */}
              {detailItem.category !== 'OFFICE_SUPPLIES' && detailItem.options?.customRequests?.length > 0 && (
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <DetailSectionTitle title="➕ 추가 변수 요청사항 리스트" />
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5 font-bold text-slate-700">
                    {detailItem.options.customRequests.map((req: string, i: number) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-blue-500 font-mono">{i + 1}.</span>
                        <span>{req}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 🚀 시스템 내부 보조 서식 명세 블록은 UI 상세 모달 하단에 명확히 격리 배치 */}
              {['SIGN', 'JEBON'].includes(detailItem.category) && (
                <div className="bg-slate-200/50 p-6 rounded-2xl border border-slate-300 shadow-inner space-y-3">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">INTERNAL SYSTEM ONLY</div>
                  <div className="text-xs font-black text-slate-700">🔒 시스템 내부 참고용 보조 데이터 (외주서 제외 항목)</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <DetailRow label="신청 회사 법인명" value={detailItem.options?.companyName} />
                    <DetailRow label="신청인 성명" value={detailItem.options?.applicantName} />
                    <DetailRow label="신청인 연락처" value={detailItem.options?.applicantPhone} />
                    {detailItem.category === 'SIGN' && detailItem.options?.certType === 'ISO 인증' && (
                      <div className="col-span-1 md:col-span-3 pt-2">
                        <DetailRow label="신청 현판 일련번호 (ISO 내부 보관)" value={detailItem.options?.internalSystemSerial} highlight />
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
            
            <div className="p-5 bg-white border-t border-slate-200 mt-auto shrink-0 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-xs transition-colors shadow-md"
              >
                원장 확인 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}