'use client';
  
import { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
  
function MasterArchiveContent() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 🚀 표준 규격: 배너는 고정, 하단 표 영역만 접기
  const [isTableOpen, setIsTableOpen] = useState(true);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15; 
  
  // 🚀 [수정] 기본값을 'ALL'로 변경
  const [selectedYear, setSelectedYear] = useState('ALL');
  
  useEffect(() => { setCurrentPage(1); }, [selectedYear]);
  
  useEffect(() => {
    const loadArchive = () => {
      const savedHistory = localStorage.getItem('it_assets_history_db');
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
      setLoading(false);
    };
    loadArchive();
    window.addEventListener('focus', loadArchive);
    return () => window.removeEventListener('focus', loadArchive);
  }, []);
  
  const availableYears = useMemo(() => {
    const years = history.map(h => (h.terminated_at || '').substring(0, 4)).filter(Boolean);
    const uniqueYears = Array.from(new Set(years));
    const currentYear = new Date().getFullYear().toString();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
    return uniqueYears.sort((a, b) => b.localeCompare(a)); 
  }, [history]);
  
  // 🚀 [수정] selectedYear가 'ALL'일 경우 조건없이 전체 반환
  const filteredHistory = useMemo(() => {
    return history.filter(h => 
      selectedYear === 'ALL' || (h.terminated_at || '').startsWith(selectedYear)
    );
  }, [history, selectedYear]);
  
  const handleRestore = (id: string) => {
    if (!confirm('운영 리스트로 복구하시겠습니까?')) return;
    const target = history.find(h => h.id === id);
    if (target) {
      const currentAssets = JSON.parse(localStorage.getItem('it_assets_db') || '[]');
      localStorage.setItem('it_assets_db', JSON.stringify([{ ...target, status: 'Active' }, ...currentAssets]));
      const newHistory = history.filter(h => h.id !== id);
      setHistory(newHistory);
      localStorage.setItem('it_assets_history_db', JSON.stringify(newHistory));
      alert('복구되었습니다.');
    }
  };
  
  const handleExportExcel = () => {
    if (filteredHistory.length === 0) return alert("해당 조건의 데이터가 없습니다.");
    const exportData = filteredHistory.map((h, idx) => ({
      'NO': filteredHistory.length - idx,
      '종료 처리일': h.terminated_at,
      '자산 분류': h.it_type,
      '자산번호': h.code,
      '모델명': h.model,
      'S/N': h.sn || '-',
      '종료 사유': h.reason,
      '기존 사용자': h.user || '공용',
      '기존 조직': h.dept || '-',
      '최종 상태': h.status
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Archive");
    
    // 🚀 [수정] 파일명에도 '전체' 연도 표시
    const fileNameYear = selectedYear === 'ALL' ? '전체' : selectedYear;
    XLSX.writeFile(wb, `IT_Archive_${fileNameYear}.xlsx`);
  };
  
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const currentHistory = filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Archive Loading...</div>;
  
  return (
    <div className="space-y-6 font-sans text-slate-800 pb-20">
      
      {/* 🚀 [표준 모듈 배너] 규격 적용 (h-20 고정) */}
      <div className="bg-slate-900 h-20 rounded-[2rem] shadow-lg relative flex items-center px-8">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4">
            <span className="text-2xl text-white">📦</span>
            <div className="flex flex-col justify-center">
              <h2 className="font-black tracking-tight uppercase text-white text-lg">
                종료 자산 아카이브
              </h2>
              {/* 🚀 [수정] 배너 부제목 한글로 변경 */}
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                종료처리(반납/폐기)된 IT·업무자산 관리
              </p>
            </div>
          </div>
          <button 
            onClick={() => setIsTableOpen(!isTableOpen)} 
            className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-xl text-[10px] font-black text-white transition-colors uppercase whitespace-nowrap"
          >
            {isTableOpen ? '리스트 닫기 ▲' : '리스트 열기 ▼'}
          </button>
        </div>
      </div>
  
      {/* 🚀 데이터 리스트 영역 */}
      {isTableOpen && (
        <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
          
          {/* 상단 컨트롤러: 필터 및 엑셀 */}
          <div className="p-6 bg-slate-50 border-b flex justify-between items-center">
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
              Total Terminated: <span className="text-indigo-600">{filteredHistory.length}</span>
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">조회연도</span>
                {/* 🚀 [수정] TOTAL 모두보기 추가 */}
                <select
                  value={selectedYear}
                  onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }}
                  className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
                >
                  <option value="ALL">TOTAL 모두보기</option>
                  {availableYears.map(year => (
                    <option key={year} value={year}>{year}년</option>
                  ))}
                </select>
              </div>
              <button 
                onClick={handleExportExcel}
                className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-[10px] font-black hover:bg-emerald-700 transition-all shadow-md flex items-center gap-2"
              >
                <span>📊</span> EXCEL 다운로드
              </button>
            </div>
          </div>
  
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] min-w-[1200px]">
              <thead className="bg-slate-50 text-slate-400 font-black border-b uppercase">
                <tr>
                  <th className="p-4 w-[60px] text-center">NO</th>
                  <th className="p-4 w-[120px]">종료 처리일</th>
                  <th className="p-4 w-[120px]">자산 분류</th>
                  <th className="p-4 w-[150px]">자산번호</th>
                  <th className="p-4 w-[200px]">모델명</th>
                  <th className="p-4 w-[150px]">S/N</th>
                  <th className="p-4">종료 사유</th>
                  <th className="p-4 w-[120px]">기존 사용자</th>
                  <th className="p-4 w-[100px] text-center">상태</th>
                  <th className="p-4 w-[80px] text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold">
                {filteredHistory.length === 0 ? (
                  <tr><td colSpan={10} className="p-16 text-center text-slate-300 italic font-bold">해당 조건의 아카이브 내역이 없습니다.</td></tr>
                ) : (
                  currentHistory.map((h, i) => (
                    <tr key={h.id} className="hover:bg-slate-50 transition-colors h-16">
                      <td className="p-4 text-center text-slate-300 font-mono">
                        {filteredHistory.length - ((currentPage - 1) * itemsPerPage + i)}
                      </td>
                      <td className="p-4 font-mono text-slate-500">{h.terminated_at}</td>
                      <td className="p-4 text-indigo-600">{h.it_type}</td>
                      <td className="p-4 font-black">{h.code}</td>
                      <td className="p-4 text-slate-800 truncate max-w-[200px]" title={h.model}>{h.model}</td>
                      <td className="p-4 text-slate-400 font-mono">{h.sn || '-'}</td>
                      <td className="p-4 text-slate-500 italic truncate max-w-[250px]" title={h.reason}>
                        "{h.reason}"
                      </td>
                      <td className="p-4 font-black">
                        {h.dept || '-'}<br/>
                        <span className="text-indigo-500 text-[10px]">{h.user || '공용'}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${h.status === '폐기' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'}`}>
                          {h.status}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => handleRestore(h.id)} 
                          className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-900 hover:text-white transition-all text-[10px] font-black shadow-sm"
                        >
                          복구
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="p-6 bg-white border-t flex justify-center items-center gap-2">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button 
                  key={i} 
                  onClick={() => setCurrentPage(i + 1)} 
                  className={`w-8 h-8 rounded-xl text-[10px] font-black transition-all ${currentPage === i + 1 ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 border border-slate-100'}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
  
export default function MasterArchiveModule() {
  return (
    <Suspense fallback={<div className="p-10 font-black animate-pulse text-indigo-400 text-center uppercase tracking-widest">Loading Archive...</div>}>
      <MasterArchiveContent />
    </Suspense>
  );
}