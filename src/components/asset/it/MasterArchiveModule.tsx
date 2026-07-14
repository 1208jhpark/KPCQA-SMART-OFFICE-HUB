'use client';
     
import { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { useRouter } from 'next/navigation'; // 🚀 Next.js App Router 필수 임포트
     
// 🚀 전사 표준 HeaderLight 컴포넌트
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);
     
function MasterArchiveContent() {
  const router = useRouter(); // 🚀 이 선언문이 있어야 router.push를 사용할 수 있습니다!
  const [currentUser, setCurrentUser] = useState<{name: string, dept: string, level: string} | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
     
  // 🚀 검색 및 복합 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | '반납' | '폐기' | '재판매'>('ALL');
  
  // 🚀 페이지네이션 및 날짜 필터 상태
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10; 
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  
  const formatNumber = (val: any) => val?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") || '0';
     
  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterDept, filterType, filterStatus, selectedYear, selectedMonth]);
  
  // 🚀 DB 통신 전용: 아카이브 데이터 패치 함수
  const fetchArchiveData = async () => {
    try {
      // (주의: 백엔드 라우터 경로가 다를 경우 '/api/asset/it/archive' 부분을 맞춰주세요)
      const res = await fetch(`/api/asset/it/archive?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        data.sort((a: any, b: any) => new Date(b.terminated_at || 0).getTime() - new Date(a.terminated_at || 0).getTime());
        setHistory(data);
      }
    } catch (e) {
      console.error("Archive fetch error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const userRes = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: 'no-store' }); 
        if (userRes.ok) {
          const userData = await userRes.json();
          setCurrentUser({ 
            name: userData.name || '알수없음', 
            dept: userData.unit?.unit_name || '소속 미정',
            level: userData.level || 'LV-1'
          });
        }
      } catch(e) { console.error("User fetch error", e); }
     
      // 로컬 스토리지 대신 DB에서 직접 가져옵니다.
      await fetchArchiveData();
    };
     
    init();
    // 로컬 스토리지 이벤트 리스너 완전 제거됨
  }, []);
  
  const availableYears = useMemo(() => {
    const years = history.map(h => (h.terminated_at || '').substring(0, 4)).filter(Boolean);
    const uniqueYears = Array.from(new Set(years));
    const currentYear = new Date().getFullYear().toString();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
    return uniqueYears.sort((a, b) => b.localeCompare(a)); 
  }, [history]);
     
  const uniqueDepts = useMemo(() => Array.from(new Set(history.map(h => h.dept || '소속 미정'))).filter(Boolean).sort(), [history]);
  const uniqueTypes = useMemo(() => Array.from(new Set(history.map(h => h.it_type || '일반'))).filter(Boolean).sort(), [history]);
     
  const filteredHistory = useMemo(() => {
    return history.filter(h => {
      const matchYear = selectedYear === 'ALL' || (h.terminated_at || '').startsWith(selectedYear);
      const matchMonth = selectedMonth === 'ALL' || (h.terminated_at || '').substring(5, 7) === selectedMonth;
      
      const matchStatus = filterStatus === 'ALL' || h.status === filterStatus;
      const rDept = h.dept || '소속 미정';
      const matchDept = !filterDept || rDept === filterDept;
      const rType = h.it_type || '일반';
      const matchType = !filterType || rType === filterType;
      const s = searchQuery.toLowerCase().trim();
      const matchSearch = !s || [h.user, rDept, h.code, h.model, h.sn, h.reason, h.reseller].some(v => 
        String(v).toLowerCase().includes(s)
      );
     
      return matchYear && matchMonth && matchStatus && matchDept && matchType && matchSearch;
    });
  }, [history, selectedYear, selectedMonth, filterStatus, filterDept, filterType, searchQuery]);
     
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const currentData = filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
     
  const handleRestore = async (id: string) => {
    if (!confirm('해당 자산을 운영 대장(Active) 리스트로 복구하시겠습니까?')) return;
    
    const target = history.find(h => h.id === id);
    if (!target) return;
     
    try {
      const { terminated_at, reason, reseller, resellPrice, status, ...restoreData } = target;
     
      const response = await fetch(`/api/asset/it`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restoreData),
      });
     
      if (response.ok) {
        // 🚀 로컬스토리지 삭제 대신 서버 데이터를 재호출하여 동기화
        alert('✅ 성공적으로 마스터 운영 대장(DB)으로 복구되었습니다. 대시보드에서 확인하실 수 있습니다.');
        fetchArchiveData(); 
      } else {
        const err = await response.json();
        alert(`❌ 복구 실패: ${err.message || '서버 오류'}`);
      }
    } catch (error) {
      console.error("Restore Error:", error);
      alert('❌ 서버 통신 중 오류가 발생했습니다.');
    }
  };
  
  // 🚀 DB 통신 전용: 아카이브 삭제 함수
  const handleDelete = async (id: string) => {
    if (currentUser?.level !== 'LV-1') return alert("❌ 삭제 권한이 거부되었습니다.");
    if (!confirm("해당 아카이브 기록을 영구 삭제하시겠습니까?")) return;
    
    try {
      const res = await fetch(`/api/asset/it/archive?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('✅ 해당 이력이 영구 삭제되었습니다.');
        fetchArchiveData(); // 서버 동기화
      } else {
        alert('❌ 서버 삭제 처리에 실패했습니다.');
      }
    } catch (error) {
      alert('❌ 서버 통신 중 오류가 발생했습니다.');
    }
  };
  
  const handleExportExcel = () => {
    const targets = selectedIds.size > 0 ? filteredHistory.filter(h => selectedIds.has(h.id)) : filteredHistory;
    if (targets.length === 0) return alert("데이터가 없습니다.");
    const exportData = targets.map((h, idx) => ({
      'NO': targets.length - idx,
      '종료처리일자': h.terminated_at || '-',
      '기존 사용자': h.user || '공용',
      '기존 소속': h.dept || '-',
      '자산분류': h.it_type,
      '자산번호': h.code,
      '모델명': h.model,
      'S/N': h.sn || '-',
      '종료사유': h.reason || '-',
      '매각처': h.reseller || '-', 
      '매각금액(원)': h.resellPrice || 0, 
      '상태': h.status
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Archive");
    XLSX.writeFile(wb, `IT_Archive_${selectedYear}_${selectedMonth}.xlsx`);
  };
  
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading...</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* 🚀 딥 에메랄드 테마 기반 IT 마스터 아카이브 배너 */}
<div className="w-full bg-teal-950 border border-teal-850 p-6 rounded-[2.5rem] text-white shadow-lg relative overflow-hidden flex flex-col justify-center min-h-[140px] mb-6">
  <div className="flex items-center justify-between relative z-10 w-full px-4">
    <div>
      {/* 1. 상단 라벨 (마스터 컬러 매칭 text-teal-400) */}
      <p className="text-[10px] font-black uppercase tracking-widest text-teal-400 mb-2">
        TERMINATED ASSET ARCHIVE
      </p>
      
      {/* 2. 메인 타이틀 */}
      <h2 className="text-2xl font-black tracking-tight text-white leading-none">
        종료 자산 아카이브 관리
      </h2>
      
      {/* 3. 하단 설명 (간격 mt-4 표준화 및 선명도 조절) */}
      <p className="text-teal-200/80 text-xs font-semibold mt-4 opacity-95">
        종료처리된 IT·업무자산의 영구 이력 및 매각 관리
      </p>
    </div>
  </div>
</div>

{/* 🚀 URL 기반 4버튼 동적 탭 네비게이션 (IT 마스터 컴패니언 킷 표준 장착) */}
<div className="bg-slate-100 p-2 rounded-3xl flex flex-wrap gap-2 max-w-max border border-slate-200/50 shadow-inner mb-6">
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/dashboard')}
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname === '/asset/it/master/dashboard'
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📊 IT 마스터 대시보드
  </button>
  
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/audit')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/audit')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    🔍 정기 자산 실사 관리
  </button>
  
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/requests')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/requests')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📋 서비스 요청/조치 대장
  </button>

  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/archive')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/archive')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📁 불용자산 아카이브
  </button>
</div>
     
      {/* 필터 영역 */}
      <div className="bg-white border border-slate-200 px-5 py-4 shadow-sm rounded-[2rem] flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          <button onClick={() => setFilterStatus('ALL')} className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all ${filterStatus === 'ALL' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>전체보기</button>
          <button onClick={() => setFilterStatus('반납')} className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all ${filterStatus === '반납' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>반납</button>
          <button onClick={() => setFilterStatus('폐기')} className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all ${filterStatus === '폐기' ? 'bg-rose-100 text-rose-700 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>폐기</button>
          <button onClick={() => setFilterStatus('재판매')} className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all ${filterStatus === '재판매' ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>매각</button>
        </div>
     
        <div className="flex-1 min-w-[300px]">
          <input 
            type="text" 
            placeholder="[통합검색] 기존 사용자, 부서, 자산번호, 모델명, 매각처 검색..." 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)} 
            className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-[11px] font-bold outline-none focus:border-indigo-500" 
          />
        </div>
     
        <div className="flex gap-2">
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="p-2.5 border border-slate-200 font-black text-[11px] rounded-xl outline-none bg-white">
            <option value="">부서 (전체)</option>
            {uniqueDepts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="p-2.5 border border-slate-200 font-black text-[11px] rounded-xl outline-none bg-white">
            <option value="">분류 (전체)</option>
            {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
  
      {/* 테이블 영역 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        <HeaderLight title="종료 자산 데이터 대장" count={filteredHistory.length}>
          <div className="flex items-center gap-2">
            <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-3 py-1.5 outline-none cursor-pointer">
              <option value="ALL">전체 연도</option>
              {availableYears.map(year => <option key={year} value={year}>{year}년도</option>)}
            </select>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-3 py-1.5 outline-none cursor-pointer">
              <option value="ALL">전체 월</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={String(m).padStart(2, '0')}>{m}월</option>
              ))}
            </select>
            <button onClick={handleExportExcel} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-700 shadow-sm transition-all ml-1">⬇️ 엑셀 다운로드</button>
          </div>
        </HeaderLight>
  
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1600px] table-fixed">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 w-[60px] text-center border-r border-slate-200">NO</th>
                <th className="h-12 w-[120px] text-center border-r border-slate-200">종료처리일자</th>
                <th className="h-12 w-[160px] pl-6 border-r border-slate-200">사용자 (소속)</th>
                <th className="h-12 w-[120px] text-center border-r border-slate-200">자산분류</th>
                <th className="h-12 w-[200px] pl-6 border-r border-slate-200">자산번호</th>
                <th className="h-12 w-[220px] px-4 border-r border-slate-200">모델명</th>
                <th className="h-12 w-[150px] px-4 border-r border-slate-200">시리얼넘버</th>
                <th className="h-12 w-[220px] px-4 border-r border-slate-200">종료사유</th>
                <th className="h-12 w-[140px] px-4 border-r border-slate-200">매각처 (재판매)</th>
                <th className="h-12 w-[120px] px-4 text-right border-r border-slate-200">매각금액(원)</th>
                <th className="h-12 w-[100px] text-center bg-slate-50">상태</th>
                <th className="h-12 w-[100px] text-center bg-slate-50">관리</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {currentData.map((h, i) => (
                <tr key={h.id} className="h-16 hover:bg-slate-50/50 transition-colors">
                  <td className="text-center text-slate-400 font-mono border-r border-slate-50">
                    {filteredHistory.length - ((currentPage - 1) * itemsPerPage + i)}
                  </td>
                  <td className="text-center font-mono text-slate-500 border-r border-slate-50">{h.terminated_at}</td>
                  <td className="pl-6 border-r border-slate-50">
                    <span className="text-slate-900 font-black">{h.user || '공용'}</span>
                    <span className="text-slate-400 block text-[10px]">({h.dept || '-'})</span>
                  </td>
                  <td className="text-center text-indigo-700 font-black border-r border-slate-50">{h.it_type}</td>
                  <td className="pl-6 font-black text-slate-900 border-r border-slate-50">{h.code}</td>
                  <td className="px-4 truncate max-w-[220px] border-r border-slate-50" title={h.model}>{h.model}</td>
                  <td className="px-4 text-slate-500 font-mono border-r border-slate-50">{h.sn || '-'}</td>
                  <td className="px-4 text-slate-500 italic truncate max-w-[220px] border-r border-slate-50" title={h.reason}>"{h.reason}"</td>
                  
                  <td className="px-4 text-emerald-700 font-black truncate max-w-[140px] border-r border-slate-50">{h.reseller || '-'}</td>
                  <td className="px-4 text-right font-mono text-slate-700 border-r border-slate-50">{h.resellPrice ? formatNumber(h.resellPrice) : '-'}</td>
                  
                  <td className="text-center border-l border-slate-50 bg-slate-50/30">
                    <span className={`px-2 py-1 rounded text-[10px] font-black shadow-sm ${
                      h.status === '폐기' ? 'bg-rose-100 text-rose-700 border border-rose-200' : 
                      h.status === '재판매' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-amber-100 text-amber-700 border border-amber-200'
                    }`}>
                      {h.status}
                    </span>
                  </td>
                  <td className="text-center border-l border-slate-50 px-2 space-x-1 whitespace-nowrap bg-slate-50/30">
                    <button onClick={() => handleRestore(h.id)} className="px-2.5 py-1.5 bg-white border border-slate-300 rounded text-[9px] font-black text-slate-600 hover:bg-slate-800 hover:text-white shadow-sm transition-all">복구</button>
                    <button onClick={() => handleDelete(h.id)} className="px-2.5 py-1.5 bg-white border border-rose-200 rounded text-[9px] font-black text-rose-600 hover:bg-rose-600 hover:text-white shadow-sm transition-all">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
  
        {/* 하단 페이지네이션 컨트롤러 */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
            <button 
              disabled={currentPage === 1} 
              onClick={() => setCurrentPage(p => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button 
                key={i} 
                onClick={() => setCurrentPage(i + 1)}
                className={`w-8 h-8 rounded-xl font-black text-[11px] transition-all ${
                  currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button 
              disabled={currentPage === totalPages} 
              onClick={() => setCurrentPage(p => p + 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
  
export default function MasterArchiveModule() {
  return (
    <Suspense fallback={<div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading...</div>}>
      <MasterArchiveContent />
    </Suspense>
  );
}