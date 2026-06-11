'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';

function NoticeContent() {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentAuditProgress, setCurrentAuditProgress] = useState(0); 
  
  // 1. 현재 공지 상태
  const [currentNotice, setCurrentNotice] = useState({
    isActive: false, 
    showProgress: true, 
    title: '', 
    targetDate: '', 
    startDate: '', 
    endDate: '', 
    description: '',
  });

  // 2. 과거 공지 이력 상태
  const [history, setHistory] = useState<any[]>([]);

  // 3. UI 및 테이블 제어 상태
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => { fetchInitialData(); }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [meRes, noticeRes, dashRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch(`/api/asset/it/notices?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/it/dashboard?t=${ts}`, { cache: 'no-store' })
      ]);
      
      if (meRes.ok) setCurrentUser(await meRes.json());
      
      if (dashRes.ok) {
        const dData = await dashRes.json();
        // 대시보드 API에서 계산된 현재 실사 진행률을 가져옴
        setCurrentAuditProgress(dData.auditProgress || 0);
      }

      if (noticeRes.ok) {
        const data = await noticeRes.json();
        // 데이터 구조가 { current, history } 인지 확인 후 세팅
        if (data.current !== undefined) {
          setCurrentNotice(data.current);
          setHistory(data.history || []);
        } else if (Object.keys(data).length > 0) {
          // 구버전 데이터 호환 처리
          setCurrentNotice(data);
          setHistory([]);
        }
      }
    } catch (e) { console.error("데이터 로드 실패:", e); }
    setLoading(false);
  };

  // 권한 확인 (LV_1 감지)
  const isLV1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : JSON.parse(currentUser.roles || '[]');
    return roles.includes('LV_1');
  }, [currentUser]);

  // 저장 로직 (API 통신)
  const handleSave = async (updatedCurrent: any, updatedHistory: any[]) => {
    const payload = { current: updatedCurrent, history: updatedHistory };
    try {
      const res = await fetch('/api/asset/it/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert('✅ 설정이 저장되었습니다. 대시보드 및 실사 기준일이 즉시 반영됩니다.');
        setCurrentNotice(updatedCurrent);
        setHistory(updatedHistory);
      } else { alert('저장 중 서버 오류가 발생했습니다.'); }
    } catch (e) { alert('통신 오류가 발생했습니다.'); }
  };

  // 폼 제출 핸들러 (이름 오류 수정 완료)
  const onSubmitCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    handleSave(currentNotice, history);
  };

  // 현재 공지를 종료하고 이력으로 내리기
  const handleArchive = () => {
    if (!currentNotice.title) return alert("저장된 공지가 없습니다.");
    if (!confirm('현재 공지를 종료하고 이력 보관함으로 내리시겠습니까?')) return;

    const archivedItem = {
      ...currentNotice,
      id: `NOTI-${Date.now()}`,
      archivedAt: new Date().toISOString().split('T')[0],
      participationRate: currentAuditProgress // 당시 진행률 박제
    };

    const newHistory = [archivedItem, ...history];
    const resetNotice = { 
      isActive: false, showProgress: true, title: '', targetDate: '', startDate: '', endDate: '', description: '' 
    };
    
    handleSave(resetNotice, newHistory);
  };

  // 이력 삭제 (LV_1 전용)
  const handleDeleteHistory = (ids: string[]) => {
    if (!isLV1) return alert("삭제 권한이 없습니다. (최고 관리자 전용)");
    if (!confirm(`선택한 ${ids.length}건의 이력을 영구 삭제하시겠습니까?`)) return;
    
    const newHistory = history.filter(h => !ids.includes(h.id));
    handleSave(currentNotice, newHistory);
    setSelectedIds(new Set());
  };

  // 연도 필터링 데이터
  const availableYears = useMemo(() => {
    const years = history.map(h => (h.archivedAt || '').substring(0, 4)).filter(Boolean);
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = new Date().getFullYear().toString();
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [history]);

  // 필터링된 이력 리스트
  const filteredHistory = useMemo(() => {
    return history.filter(h => {
      const yearMatch = selectedYear === 'ALL' || (h.archivedAt || '').startsWith(selectedYear);
      const searchMatch = !searchQuery || h.title?.toLowerCase().includes(searchQuery.toLowerCase());
      return yearMatch && searchMatch;
    }).sort((a, b) => new Date(b.archivedAt || 0).getTime() - new Date(a.archivedAt || 0).getTime());
  }, [history, selectedYear, searchQuery]);

  // 페이지네이션 및 체크박스 로직 (오류 수정 완료)
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const paginatedHistory = filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleAll = () => {
    const currentPageIds = paginatedHistory.map(h => h.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };

  // 엑셀 다운로드
  const handleExportExcel = () => {
    const target = selectedIds.size > 0 ? history.filter(h => selectedIds.has(h.id)) : filteredHistory;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = target.map((h, idx) => ({
      'NO': target.length - idx,
      '종료처리일': h.archivedAt || '-',
      '실사 기준일': h.targetDate || '-',
      '시작일': h.startDate || '-',
      '종료일': h.endDate || '-',
      '공지 제목': h.title,
      '참여결과(%)': `${h.participationRate || 0}%`,
      '상세내용': h.description
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AuditNoticeHistory");
    XLSX.writeFile(wb, `IT자산_실사공지이력_${selectedYear}.xlsx`);
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading Manager...</div>;

  return (
    <div className="space-y-6 font-sans text-slate-800 pb-20 max-w-6xl mx-auto animate-fade-in">
      
      {/* 🚀 1. 상단 섹션 배너 */}
      <div className="bg-slate-900 h-28 rounded-[2rem] shadow-lg relative flex items-center px-10 overflow-hidden">
        <div className="absolute right-0 top-0 w-64 h-full bg-gradient-to-l from-indigo-600/30 to-transparent pointer-events-none" />
        <div className="flex items-center gap-5 z-10">
          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center text-3xl shadow-inner">📢</div>
          <div className="flex flex-col justify-center">
            <h2 className="font-black tracking-tight uppercase text-white text-xl">실사 공지사항 통합 관리</h2>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-1">현재 공지 제어 및 실사 기준일 자동 연동</p>
          </div>
        </div>
      </div>

      {/* 🚀 2. 현재 공지 설정 카드 */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-50 p-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><span>🟢</span> 현재 대시보드 노출 설정</h3>
          {currentNotice.title && (
            <button type="button" onClick={handleArchive} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 transition-colors shadow-sm">
              📥 이 공지를 종료하고 이력으로 내리기
            </button>
          )}
        </div>
        
        <form onSubmit={onSubmitCurrent} className="p-8 space-y-8">
          <div className="flex justify-between items-center bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100">
             <div>
               <h4 className="font-black text-indigo-900">대시보드 공지 활성화</h4>
               <p className="text-[11px] text-indigo-400 font-bold mt-1">ON 설정 시 IT 메인 대시보드에 배너가 노출되며 지정한 실사 기준일이 시스템에 적용됩니다.</p>
             </div>
             <label className="relative inline-flex items-center cursor-pointer">
               <input type="checkbox" className="sr-only peer" checked={currentNotice.isActive} onChange={e => setCurrentNotice({...currentNotice, isActive: e.target.checked})} />
               <div className="w-14 h-7 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-indigo-600 shadow-inner"></div>
             </label>
          </div>

          <div className={`space-y-5 transition-all ${currentNotice.isActive ? 'opacity-100' : 'opacity-40 grayscale pointer-events-none'}`}>
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">공지 제목 *</label>
              <input required type="text" value={currentNotice.title} onChange={e=>setCurrentNotice({...currentNotice, title: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black outline-none focus:bg-white focus:border-indigo-500 transition-all shadow-inner" placeholder="예: 2026년 상반기 IT 자산 정기 실사 안내" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-black text-slate-600 mb-2">실사 기준일 (대시보드 연동) *</label>
                <input required type="date" value={currentNotice.targetDate} onChange={e=>setCurrentNotice({...currentNotice, targetDate: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:bg-white focus:border-indigo-500 shadow-inner" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-2">참여 시작일 *</label>
                <input required type="date" value={currentNotice.startDate} onChange={e=>setCurrentNotice({...currentNotice, startDate: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:bg-white focus:border-indigo-500 shadow-inner" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-2">참여 종료일 *</label>
                <input required type="date" value={currentNotice.endDate} onChange={e=>setCurrentNotice({...currentNotice, endDate: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:bg-white focus:border-indigo-500 shadow-inner" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">상세 공지 내용 *</label>
              <textarea required value={currentNotice.description} onChange={e=>setCurrentNotice({...currentNotice, description: e.target.value})} rows={4} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:bg-white focus:border-indigo-500 shadow-inner resize-none leading-relaxed" placeholder="사용자들에게 전달할 상세 내용을 기재하세요." />
            </div>

            <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
              <span className="font-black text-slate-700 text-xs">참여도(%) 진행률 바 노출 여부</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={currentNotice.showProgress} onChange={e => setCurrentNotice({...currentNotice, showProgress: e.target.checked})} />
                <div className="w-10 h-5 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
          </div>

          <button type="submit" className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition-all tracking-widest uppercase text-sm">
            🚀 현재 공지 설정 저장 및 대시보드 반영
          </button>
        </form>
      </div>

      {/* 🚀 3. 지난 실사 공지 이력 (표준 모듈 배너 및 테이블) */}
      <div className="bg-slate-900 h-20 rounded-[2rem] shadow-lg relative flex items-center px-8 mt-12">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4">
            <span className="text-2xl text-white">📂</span>
            <div className="flex flex-col justify-center">
              <h2 className="font-black tracking-tight uppercase text-white text-lg">지난 실사 공지 이력 (History)</h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">과거 정기 실사 종료 내역 및 아카이브</p>
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

      {isTableOpen && (
        <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
          <div className="p-5 bg-slate-50 border-b flex justify-between items-center flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total History: <span className="text-indigo-600">{filteredHistory.length}</span></span>
              <button 
                onClick={() => handleDeleteHistory(Array.from(selectedIds))} 
                disabled={!isLV1 || selectedIds.size === 0} 
                className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${isLV1 && selectedIds.size > 0 ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white shadow-sm' : 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed'}`}
              >
                🗑️ 선택 삭제 ({selectedIds.size})
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-black text-slate-400 uppercase">조회연도</span>
                <select value={selectedYear} onChange={e => { setSelectedYear(e.target.value); setCurrentPage(1); }} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                  <option value="ALL">TOTAL 모두보기</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
                </select>
              </div>
              <div className="relative w-56">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
                <input type="text" placeholder="제목 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm" />
              </div>
              <button onClick={handleExportExcel} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-700 transition-all shadow-md flex items-center gap-1.5">
                <span>📊</span> EXCEL 다운로드
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] min-w-[1200px] border-collapse">
              <thead className="bg-slate-50 text-slate-400 font-black border-b border-slate-200 uppercase tracking-widest">
                <tr>
                  <th className="p-4 w-10 text-center"><input type="checkbox" checked={paginatedHistory.length > 0 && paginatedHistory.every(h => selectedIds.has(h.id))} onChange={toggleAll} className="accent-indigo-600 cursor-pointer" /></th>
                  <th className="p-4 w-14 text-center">NO</th>
                  <th className="p-4 w-32 text-center">종료처리일</th>
                  <th className="p-4 w-32 text-center text-emerald-600">실사기준일</th>
                  <th className="p-4 w-48 text-center">실사기간 (시작~종료)</th>
                  <th className="p-4 text-indigo-600">공지 제목</th>
                  <th className="p-4 w-28 text-center text-indigo-600">참여결과(%)</th>
                  <th className="p-4 w-16 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium bg-white">
                {paginatedHistory.length === 0 ? (
                  <tr><td colSpan={8} className="p-20 text-center text-slate-300 italic font-bold">보관된 과거 공지 이력이 없습니다.</td></tr>
                ) : (
                  paginatedHistory.map((h, i) => {
                    const isSelected = selectedIds.has(h.id);
                    return (
                      <tr key={h.id} className={`hover:bg-slate-50 transition-colors h-14 ${isSelected ? 'bg-indigo-50/30' : ''}`}>
                        <td className="p-4 text-center"><input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); isSelected ? next.delete(h.id) : next.add(h.id); setSelectedIds(next); }} className="accent-indigo-600 cursor-pointer" /></td>
                        <td className="p-4 text-center text-slate-400 font-mono font-bold">{filteredHistory.length - ((currentPage - 1) * itemsPerPage + i)}</td>
                        <td className="p-4 text-center font-mono text-slate-500">{h.archivedAt}</td>
                        <td className="p-4 text-center font-black text-emerald-600">{h.targetDate}</td>
                        <td className="p-4 text-center text-slate-400 font-mono text-[10px]">{h.startDate} ~ {h.endDate}</td>
                        <td className="p-4 font-black text-slate-800 truncate" title={h.title}>{h.title}</td>
                        <td className="p-4 text-center">
                          <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full font-black border border-blue-100 shadow-sm text-[10px]">{h.participationRate || 0}%</span>
                        </td>
                        <td className="p-4 text-center">
                          {isLV1 ? (
                            <button onClick={() => handleDeleteHistory([h.id])} className="text-slate-300 hover:text-red-500 transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          ) : <span className="text-slate-200 font-bold">-</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 🚀 페이지네이션 영역 */}
          {totalPages > 1 && (
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-center items-center gap-2">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button 
                  key={i} 
                  onClick={() => setCurrentPage(i + 1)} 
                  className={`w-8 h-8 rounded-xl font-black text-[10px] transition-all ${currentPage === i + 1 ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}
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

export default function NoticeModule() {
  return (
    <Suspense fallback={<div className="p-10 font-black animate-pulse text-indigo-400 text-center uppercase tracking-widest">Loading IT Notice Hub...</div>}>
      <NoticeContent />
    </Suspense>
  );
}