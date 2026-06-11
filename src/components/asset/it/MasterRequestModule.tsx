'use client';
  
import { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
  
function ITMasterRequestContent() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 🚀 표준 규격: 배너 높이 고정(h-20), 하단 리스트만 접기
  const [isTableOpen, setIsTableOpen] = useState(true);
  
  const [showOpinionModal, setShowOpinionModal] = useState<string | null>(null);
  const [adminOpinion, setAdminOpinion] = useState('');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20; 
  
  // 🚀 [수정] 기본값을 'ALL'로 변경하여 초기에 전체 보기가 되도록 설정
  const [selectedYear, setSelectedYear] = useState('ALL');
  
  useEffect(() => { fetchData(); }, []);
  
  const fetchData = () => {
    setLoading(true);
    const savedReqs = localStorage.getItem('it_requests_db') || localStorage.getItem('user_requests');
    if (savedReqs) {
      const allReqs = JSON.parse(savedReqs);
      // 최신순 정렬
      allReqs.sort((a: any, b: any) => {
        const dateA = a.requestDate || a.createdAt || '';
        const dateB = b.requestDate || b.createdAt || '';
        return dateB.localeCompare(dateA);
      });
      setRequests(allReqs);
    }
    setLoading(false);
  };
  
  // 헬퍼: 자산 정보 추출
  const getAssetInfo = (req: any) => {
    const target = req.asset || req.item || req.targetAsset || req;
    return {
      code: target.assetCode || target.asset_code || target.code || target.assetNo || '-',
      model: target.modelName || target.model_name || target.model || '-',
      type: target.assetType || target.asset_type || target.category || '일반'
    };
  };
  
  // 헬퍼: 신청자 정보 추출
  const getUserInfo = (req: any) => {
    return {
      name: req.userName || req.name || req.requester || '알수없음',
      dept: req.dept || req.department || req.org || '소속 미정'
    };
  };
  
  const handleProcessRequest = (id: string) => {
    setShowOpinionModal(id);
  };
  
  const confirmCompleteRequest = () => {
    if (!adminOpinion.trim()) return alert("처리의견을 입력해주세요.");
    
    const dbKey = localStorage.getItem('it_requests_db') ? 'it_requests_db' : 'user_requests';
    const rawReqs = JSON.parse(localStorage.getItem(dbKey) || '[]');
    const today = new Date().toISOString().split('T')[0];
  
    const updated = rawReqs.map((req: any) => {
      if (req.id === showOpinionModal) {
        return { 
          ...req, 
          status: '완료', 
          adminOpinion, 
          adminName: 'IT 관리자', // 실제 환경에선 로그인 유저 정보 사용
          adminDept: 'IT 운영팀',
          completedAt: today 
        };
      }
      return req;
    });
    
    localStorage.setItem('it_requests_db', JSON.stringify(updated));
    setRequests(updated);
    setShowOpinionModal(null); 
    setAdminOpinion('');
    alert("처리가 완료되었습니다.");
  };
  
  const availableYears = useMemo(() => {
    const years = requests.map(r => (r.requestDate || r.createdAt || '').substring(0, 4)).filter(Boolean);
    const uniqueYears = Array.from(new Set(years));
    const currentYear = new Date().getFullYear().toString();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
    return uniqueYears.sort((a, b) => b.localeCompare(a)); 
  }, [requests]);
  
  // 🚀 [수정] selectedYear가 'ALL'일 경우 모든 데이터를 반환하도록 필터링 조건 추가
  const filteredRequests = useMemo(() => {
    return requests.filter(r => 
      selectedYear === 'ALL' || (r.requestDate || r.createdAt || '').startsWith(selectedYear)
    );
  }, [requests, selectedYear]);
  
  const handleExportExcel = () => {
    if (filteredRequests.length === 0) return alert("해당 조건의 데이터가 없습니다.");
    const exportData = filteredRequests.map((req, idx) => {
      const asset = getAssetInfo(req);
      const user = getUserInfo(req);
      return {
        'NO': filteredRequests.length - idx,
        '신청일': req.requestDate || req.createdAt || '-',
        '신청자': user.name,
        '소속': user.dept,
        '자산분류': asset.type,
        '자산번호': asset.code,
        '모델명': asset.model,
        '요청내용': req.content,
        '관리자의견': req.adminOpinion || '-',
        '처리자': req.adminName || '-',
        '상태': req.status,
        '완료일': req.completedAt || '-'
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IT_Requests");
    
    // 🚀 [수정] 파일명에도 '전체' 연도 표시
    const fileNameYear = selectedYear === 'ALL' ? '전체' : selectedYear;
    XLSX.writeFile(wb, `IT_Requests_${fileNameYear}.xlsx`);
  };
  
  const totalPages = Math.ceil(filteredRequests.length / itemsPerPage) || 1;
  const currentData = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">Loading IT Requests...</div>;
  
  return (
    <div className="space-y-6 font-sans text-slate-800 pb-20">
      
      {/* 🚀 [표준 모듈 배너] (h-20 고정) */}
      <div className="bg-slate-900 h-20 rounded-[2rem] shadow-lg relative flex items-center px-8">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4">
            <span className="text-2xl text-white">📩</span>
            <div className="flex flex-col justify-center">
              <h2 className="font-black tracking-tight uppercase text-white text-lg">
                IT 요구사항 관리
              </h2>
              {/* 🚀 [수정] 배너 부제목 한글로 변경 */}
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                사용자의 IT·업무자산 요구사항의 관리
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
  
      {isTableOpen && (
        <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
          
          {/* 상단 컨트롤러 */}
          <div className="p-6 bg-slate-50 border-b flex justify-between items-center">
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
              Total Requests: <span className="text-indigo-600">{filteredRequests.length}</span>
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
            <table className="w-full text-left text-[11px] min-w-[1300px]">
              <thead className="bg-slate-50 text-slate-400 font-black border-b uppercase">
                <tr>
                  <th className="p-4 w-[60px] text-center">NO</th>
                  <th className="p-4 w-[120px]">신청일</th>
                  <th className="p-4 w-[160px]">신청자 (소속)</th>
                  <th className="p-4 w-[200px]">대상 자산 정보</th>
                  <th className="p-4 w-[220px]">사용자 요청내용</th>
                  <th className="p-4 w-[220px]">관리자 처리의견</th>
                  <th className="p-4 w-[100px] text-center">상태</th>
                  <th className="p-4 w-[200px] text-center">처리자 정보 / 액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold">
                {currentData.length === 0 ? (
                  <tr><td colSpan={8} className="p-16 text-center text-slate-300 italic font-bold">해당 연도의 요청 내역이 없습니다.</td></tr>
                ) : (
                  currentData.map((req, i) => {
                    const asset = getAssetInfo(req);
                    const user = getUserInfo(req);
                    const isPending = req.status === '대기중';
  
                    return (
                      <tr key={req.id} className="hover:bg-slate-50 transition-colors h-16">
                        <td className="p-4 text-center text-slate-300 font-mono">
                          {filteredRequests.length - ((currentPage - 1) * itemsPerPage + i)}
                        </td>
                        <td className="p-4 font-mono text-slate-500">
                          {req.requestDate || req.createdAt || '-'}
                        </td>
                        <td className="p-4">
                          <span className="text-slate-800">{user.name}</span>
                          <span className="text-slate-400 font-normal block text-[10px]">({user.dept})</span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-indigo-600 font-black truncate">{asset.code}</span>
                            <span className="text-slate-500 text-[10px] truncate">{asset.model} / {asset.type}</span>
                          </div>
                        </td>
                        <td className="p-4 text-slate-500 italic truncate max-w-[220px]" title={req.content}>
                          "{req.content}"
                        </td>
                        <td className="p-4 text-slate-800 truncate max-w-[220px]">
                          {isPending ? <span className="text-slate-300">-</span> : (req.adminOpinion || '의견 없음')}
                        </td>
                        <td className="p-4 text-center">
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            isPending ? 'bg-orange-100 text-orange-600' : 'bg-emerald-100 text-emerald-600'
                          }`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="p-4">
                          {isPending ? (
                            <div className="flex justify-center">
                              <button 
                                onClick={() => handleProcessRequest(req.id)}
                                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black shadow-md hover:bg-indigo-600 transition-all"
                              >
                                처리하기
                              </button>
                            </div>
                          ) : (
                            <div className="text-center">
                              <span className="text-slate-700 block">{req.adminName}</span>
                              <span className="text-slate-400 text-[9px] block">{req.completedAt} 처리</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
  
          {totalPages > 1 && (
            <div className="p-6 bg-white border-t flex justify-center items-center gap-2">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button 
                  key={i} 
                  onClick={() => setCurrentPage(i + 1)} 
                  className={`w-8 h-8 rounded-xl font-black text-[10px] transition-all ${currentPage === i + 1 ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 border border-slate-100'}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
  
      {/* 처리 의견 모달 */}
      {showOpinionModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-[450px] rounded-[2.5rem] shadow-2xl p-8 border">
            <h4 className="font-black border-b pb-4 mb-6 text-sm text-indigo-600 flex items-center gap-2"><span>✍️</span> 조치 결과 및 의견 작성</h4>
            <textarea 
              value={adminOpinion} 
              onChange={e => setAdminOpinion(e.target.value)} 
              placeholder="사용자에게 전달될 조치 내용을 입력하세요." 
              className="w-full h-32 bg-slate-50 border border-slate-200 p-4 text-xs font-bold outline-none rounded-2xl focus:border-indigo-500 resize-none leading-relaxed" 
            />
            <div className="flex gap-3 mt-6">
              <button 
                onClick={() => { setShowOpinionModal(null); setAdminOpinion(''); }} 
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-bold hover:bg-slate-200 transition-colors"
              >
                취소
              </button>
              <button 
                onClick={confirmCompleteRequest} 
                className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-lg hover:bg-indigo-600 active:scale-[0.98] transition-all"
              >
                완료 처리
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
  
export default function MasterRequestModule() {
  return (
    <Suspense fallback={<div className="p-10 font-black animate-pulse text-indigo-400 text-center uppercase tracking-widest">Loading IT Requests...</div>}>
      <ITMasterRequestContent />
    </Suspense>
  );
}