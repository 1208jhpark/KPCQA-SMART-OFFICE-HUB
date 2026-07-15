'use client';
     
import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link'; // 🚀 표준 규격 next/link로 복구
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
  
export default function AdminDeliveryHistoryModule() {
  const pathname = usePathname();
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  
  useEffect(() => { setCurrentPage(1); }, [selectedYear]);
  
  // 🚀 [DB 연동 핵심]: 외부 캐시를 완벽히 차단하고 무조건 서버 DB만 바라보게 강제하는 함수
  const fetchArchiveData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      
      const surveyRes = await fetch(`/api/survey/delivery?t=${ts}`, { cache: 'no-store' });
      if (surveyRes.ok) {
        const dbSurveys = await surveyRes.json();
        setSurveys(dbSurveys);
      } else {
        setSurveys([]);
      }

      const [uRes, unitRes, meRes] = await Promise.all([ 
        fetch(`/api/admin/users?t=${ts}`, { cache: 'no-store' }), 
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }) 
      ]);
   
      if (meRes.ok) {
        const meData = await meRes.json();
        setCurrentUser(meData);
      }
   
      let unitData: any[] = [];
      if (unitRes.ok) {
        unitData = await unitRes.json();
        setUnitsList(unitData);
      }

      if (uRes.ok && unitRes.ok) {
        const uData = await uRes.json();
        const mappedUsers = (uData.users || []).map((u:any) => ({ 
          ...u, 
          dept: unitData.find((un:any) => un.id === u.unit_id)?.unit_name || '소속없음' 
        }));
        setUsers(mappedUsers);
      }

      const respRes = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'GET_RESPONSES' }),
        cache: 'no-store'
      });

      if (respRes.ok) {
        const dbResponses = await respRes.json();
        const realRes: Record<string, any> = {};
        dbResponses.forEach((r: any) => {
          realRes[`${r.surveyId}_${r.userEmail}`] = {
            isDone: true,
            date: r.submittedAt ? r.submittedAt.split('T')[0] : '-',
            answers: r.answers
          };
        });
        setResponses(realRes);
      }
    } catch (error) { 
      console.error("Archive Data Sync Error:", error); 
    } finally { 
      setLoading(false); 
    }
  };

  useEffect(() => {
    fetchArchiveData();
  }, []);
     
  // 최고 어드민 등급 식별 검증 가드
  const isLv1 = useMemo(() => {
    if (!currentUser) return false;
    const roleStr = currentUser.role || '';
    const rolesArr = currentUser.roles || [];
    return roleStr === 'LV_1' || rolesArr.includes('LV_1');
  }, [currentUser]);
  
  const archivedSurveys = useMemo(() => surveys.filter(s => s.status === '보관됨'), [surveys]);
  const availableYears = useMemo(() => {
    const years = archivedSurveys.map(h => (h.endDate || h.postDate || '').substring(0, 4)).filter(Boolean);
    const uniqueYears = Array.from(new Set(years));
    const currentYear = new Date().getFullYear().toString();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
    return uniqueYears.sort((a, b) => b.localeCompare(a)); 
  }, [archivedSurveys]);
  
  const filteredHistory = useMemo(() => archivedSurveys.filter(h => (h.endDate || h.postDate || '').startsWith(selectedYear)), [archivedSurveys, selectedYear]);
  
  const handleRestore = async (id: string) => {
    if (!confirm('이 배달 지원 공고를 운영(현황판) 리스트로 다시 복원하시겠습니까?')) return;
    const surveyToRestore = surveys.find(s => s.id === id);
    if (!surveyToRestore) return;
     
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...surveyToRestore, status: '게시중단' }) 
      });
      
      if (res.ok) {
        alert('운영 공고 리스트로 정상 복원되었습니다.');
        fetchArchiveData();
      } else {
        alert('서버 처리 중 오류가 발생하여 복원하지 못했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('네트워크 오류가 발생했습니다.');
    }
  };
     
 // 🚀 [LV_1 전용]: 보관함 내 테스트용 찌꺼기 완벽 소멸 엔진 (DB 연동)
 const handlePermanentDelete = async (id: string) => {
  if (!confirm('경고: 선택한 아카이브 배달 명세 정보를 영구 삭제하시겠습니까?\n이 작업은 데이터베이스 파기 처리이며 복구할 수 없습니다.')) return;
  
  try {
    const res = await fetch(`/api/survey/delivery?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert('시스템에서 해당 명세 공고가 완전히 영구 삭제되었습니다.');
      fetchArchiveData(); // 🚀 [DB 연동] 삭제 후 서버 데이터 즉시 재동기화
    } else {
      alert('서버 처리 중 오류가 발생하여 삭제하지 못했습니다.');
    }
  } catch (e) {
    console.error(e);
    alert('네트워크 오류로 삭제를 실패했습니다.');
  }
};
  
  const isOrgAllowed = (targetDepts: string[], userDeptName: string) => {
    if (targetDepts.includes('전사')) return true;
    if (targetDepts.includes(userDeptName)) return true;
    let currentUnit = unitsList.find(u => u.unit_name === userDeptName);
    while (currentUnit && currentUnit.parent_id) {
      const parentUnit = unitsList.find(u => u.id === currentUnit.parent_id);
      if (parentUnit && targetDepts.includes(parentUnit.unit_name)) return true;
      currentUnit = parentUnit;
    }
    return false;
  };

  const getTargetUsers = (target: string) => {
    const targetDepts = target.split(',').map((t: string) => t.trim());
    return users.filter(u => isOrgAllowed(targetDepts, u.dept));
  };

  const formatAddressAnswer = (q: any, ans: Record<string, any>) => {
    const zip = ans[`${q.id}_zip`] || ans[q.id]?.zipCode;
    const road = ans[`${q.id}_road`] || ans[q.id]?.roadAddress;
    const detail = ans[`${q.id}_detail`] || ans[q.id]?.detailAddress;
    if (zip || road) return `[${zip || ''}] ${road || ''} ${detail || ''}`;
    return '(미입력)';
  };
     
  // 🚀 [기능 100% 보존]: 배달 전용 3단 가로 분할 시안 엑셀 시트 도출 팩토리
  const handleDownloadSingleExcel = (survey: any) => {
    let parsedQuestions = [];
    try {
      parsedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []);
    } catch (e) { parsedQuestions = []; }
    const questions = parsedQuestions.length > 0 ? parsedQuestions : [{ id: 'dq1', title: '1. 상세 배송 주소지 정보 명세' }];
    
    const targetUsers = getTargetUsers(survey.target);
    const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
    
    if (submittedUsers.length === 0) return alert("본 공고에 신청된 명세 완료 데이터가 없어 엑셀을 출력할 수 없습니다.");
    
    const deptRow = ['제출조직(부서)', ...submittedUsers.map(u => u.dept)];
    const nameRow = ['신청자이름', ...submittedUsers.map(u => u.name)];
    const dateRow = ['접수일자', ...submittedUsers.map(u => responses[`${survey.id}_${u.email}`]?.date || '-')];
    
    const contentRows = questions.map((q: any) => {
      const rowData = [q.title];
      submittedUsers.forEach(u => {
        const ans = responses[`${survey.id}_${u.email}`]?.answers;
        if (!ans) {
          rowData.push('(미입력)');
        } else if (q.type === 'SEARCH_ADDRESS') {
          rowData.push(formatAddressAnswer(q, ans));
        } else {
          const a = ans[q.id];
          if (a === undefined || a === null || a === '') {
            rowData.push('(미입력)');
          } else {
            rowData.push(Array.isArray(a) ? a.join(', ') : (a.fileName ? `[첨부파일] ${a.fileName}` : a));
          }
        }
      });
      return rowData;
    });
     
    const ws = XLSX.utils.aoa_to_sheet([deptRow, nameRow, dateRow, ...contentRows]);
    const wb = XLSX.utils.book_new();
    const safeTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
    XLSX.utils.book_append_sheet(wb, ws, safeTitle);
    XLSX.writeFile(wb, `[사내배송_보관이력]_${safeTitle}.xlsx`);
  };
  
  // 🚀 [기능 100% 보존]: ZIP 패키징 다운로드
  const handleDownloadZip = async (survey: any) => {
    const zip = new JSZip();
    const targetUsers = getTargetUsers(survey.target);
    const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
  
    if (submittedUsers.length === 0) return alert("제출된 배송 명세 응답 내역이 없습니다.");
    alert(`${submittedUsers.length}명의 명세서 데이터를 압축 패키징 파일로 생성합니다...`);
  
    const safeFolderTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-');
    const folder = zip.folder(safeFolderTitle);
    
    let storedQuestions = [];
    try {
      storedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []);
    } catch (e) { storedQuestions = []; }
  
    submittedUsers.forEach((user) => {
      const resp = responses[`${survey.id}_${user.email}`];
      const identifier = `${user.dept}_${user.name}`;
      const fileNameBase = `${identifier}_${safeFolderTitle}`; 
  
      let content = `■ 배달공고명: ${survey.title}\n■ 신청자: ${user.dept + ' ' + user.name}\n■ 제출일: ${resp.date}\n------------------------------------------\n\n`;
      
      storedQuestions.forEach((q: any, i: number) => {
         content += `Q${i+1}. ${q.title}\n`;
         const answers = resp.answers || {};

         if (q.type === 'SEARCH_ADDRESS') {
           content += `A. ${formatAddressAnswer(q, answers).replace('(미입력)', '미입력')}\n\n`;
         } else {
           const ans = answers[q.id];
           if (ans && ans.fileName) {
             content += `A. [첨부파일 명세] ${ans.fileName}\n\n`;
             if (ans.fileData) {
               folder?.file(`${identifier}_${ans.fileName}`, ans.fileData.split(',')[1], {base64: true});
             }
           } else {
             content += `A. ${Array.isArray(ans) ? ans.join(', ') : (ans || '미입력')}\n\n`;
           }
         }
      });
      folder?.file(`${fileNameBase}_배송명세확인서.txt`, "\ufeff" + content); 
    });
  
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `[사내배송명세집계]_${safeFolderTitle}.zip`);
  };
  
  // 🚀 [기능 100% 보존]: 아카이브 대장 엑셀 추출
  const handleExportListExcel = () => {
    if (filteredHistory.length === 0) return alert("추출할 아카이브 리스트 내역이 없습니다.");
    const exportData = filteredHistory.map((h, idx) => {
      const targetUsers = getTargetUsers(h.target);
      const done = targetUsers.filter(u => responses[`${h.id}_${u.email}`]?.isDone).length;
      const total = targetUsers.length;
  
      return {
        'NO': filteredHistory.length - idx,
        '공고식별코드': h.code,
        '게시번호': h.postNumber,
        '게시일': h.postDate,
        '배달 복지 공고명': h.title,
        '신청분류': h.deliveryType === 'ALWAYS' ? '상시' : '기간',
        '대상 범위': h.target,
        '시작일': h.startDate,
        '종료일': h.endDate,
        '최종접수율': total > 0 ? Math.round((done/total)*100) + '%' : '0%',
        '접수완료인원': done,
        '미접수인원': total - done,
        '보관 상태': h.status
      };
    });
  
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "배달아카이브대장");
    XLSX.writeFile(wb, `사내복지_배달공고_보관이력_${selectedYear}년.xlsx`);
  };
  
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const currentHistory = filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  if (loading) return <div className="p-10 font-black text-teal-500 animate-pulse text-center tracking-widest text-xl mt-20">배달 이력 아카이브 데이터를 동기화 중입니다...</div>;
  
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      {/* 🚀 1. 배송 아카이브 통제실 배너 (소모품/전사마스터 표준 에메랄드 테마 동기화) */}
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[140px]">
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">
              ARCHIVED DELIVERY SURVEY INVENTORY
            </h3>
            <h1 className="text-2xl font-black tracking-tight text-white leading-none">
              종료 사내배송 복지 아카이브 (보관함)
            </h1>
            <p className="text-emerald-100/90 text-xs font-semibold mt-4 opacity-90">
              공고 기한이 마감되어 최종 보관 처리된 과거 배송 복지 공고 명세와 누적 신청 데이터 대장입니다.
            </p>
          </div>
        </div>
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
          📦
        </div>
      </div>

      {/* 🚀 2. 배송 관리자 전용 동적 탭 네비게이션 (이력 페이지 활성화 매칭) */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-2xl mt-4">
        {[
          { name: '📋 상시/기간 배달 신청 현황', path: '/survey/delivery/admin/active-surveys', exact: true },
          { name: '🗂️ 배송조사 결과 이력 관리', path: '/survey/delivery/admin/history', exact: false },
        ].map((tab) => {
          const isActive = tab.exact ? pathname === tab.path : pathname.startsWith(tab.path);
          return (
            <Link 
              key={tab.path} 
              href={tab.path} 
              className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${
                isActive 
                  ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200/50 scale-[1.01]' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>

      {/* 🚀 3. [배너 밖 탈출 완료] 연도 필터 및 엑셀 다운로드 전용 컨트롤 바 */}
      <div className="flex justify-end items-center gap-3 w-full pt-2">
        {/* 🗓️ 조회 연도 선택 컨트롤 */}
        <div className="flex items-center gap-2.5 bg-slate-100 border border-slate-300 p-1.5 px-4 rounded-xl shadow-sm">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">🗓️ 조회 연도</span>
          <select 
            value={selectedYear} 
            onChange={(e) => setSelectedYear(e.target.value)} 
            className="bg-transparent text-[11px] font-black text-slate-800 outline-none cursor-pointer border-none p-0 focus:ring-0"
          >
            {availableYears.map(year => (
              <option key={year} value={year} className="text-slate-900">{year}년도 내역</option>
            ))}
          </select>
        </div>

        {/* 📊 리스트 엑셀 다운로드 버튼 */}
        <button 
          type="button"
          onClick={handleExportListExcel} 
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black shadow-sm transition-all flex items-center gap-1.5 active:scale-98"
        >
          <span>📋</span> 리스트 엑셀 다운로드
        </button>
      </div>
  
      {/* 데이터 테이블 그리드 레이어 */}
      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-medium min-w-[1400px]">
            <thead className="bg-slate-50 text-[10px] text-slate-500 font-black border-b border-slate-200 tracking-tight uppercase">
              <tr>
                <th className="py-4 pl-4 w-10 text-center">NO</th>
                <th className="py-4 px-2 w-20">공고식별코드</th>
                <th className="py-4 px-2 w-16 text-center text-teal-500">신청분류</th>
                <th className="py-4 px-2 w-16 text-center text-indigo-500">게시번호</th>
                <th className="py-4 px-2 w-20 text-center">게시일</th>
                <th className="py-4 px-4 w-[220px]">배달 복지 공고명 / 포맷</th>
                <th className="py-4 px-2 w-24 text-center">대상 범위</th>
                <th className="py-4 px-2 w-32 text-center">운영 신청 기간</th>
                <th className="py-4 px-2 w-12 text-center border-l bg-slate-100/50">접수율</th>
                <th className="py-4 px-2 w-12 text-center bg-blue-50/50 text-blue-600">접수완료</th>
                <th className="py-4 px-2 w-14 text-center bg-red-50/50 text-red-600 border-r">미접수</th>
                <th className="py-4 px-2 w-16 text-center">보관상태</th>
                <th className="py-4 px-2 w-20 text-center border-l border-slate-200">운영복원</th>
                <th className="py-4 px-2 w-36 text-center bg-slate-50">명세서 보관</th>
                {isLv1 && <th className="py-4 pr-4 w-20 text-center text-red-500">데이터 삭제</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredHistory.length === 0 ? (
                <tr><td colSpan={isLv1 ? 15 : 14} className="py-20 text-center text-slate-400 font-black text-sm">{selectedYear}년도에 보관된 배달 복지 이력이 없습니다.</td></tr>
              ) : currentHistory.map((s, i) => {
                const targetUsers = getTargetUsers(s.target);
                const done = targetUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                const total = targetUsers.length;
                const notDone = total - done;
                const rate = total > 0 ? Math.round((done/total)*100) : 0;
  
                return (
                  <tr key={s.id} className="hover:bg-teal-50/5 transition-colors h-14 group">
                    <td className="py-2 text-center text-slate-400 font-bold align-middle pl-4">{filteredHistory.length - ((currentPage - 1) * itemsPerPage + i)}</td>
                    <td className="py-2 px-2 font-mono font-black text-slate-600 tracking-tighter align-middle">{s.code}</td>
                    <td className="py-2 px-2 text-center align-middle">
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${s.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700' : 'bg-amber-100 text-amber-700'}`}>
                        {s.deliveryType === 'ALWAYS' ? '상시' : '기간'}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-black text-center text-indigo-600 text-[12px] align-middle">{s.postNumber}</td>
                    <td className="py-2 px-2 font-mono text-center text-slate-500 whitespace-nowrap align-middle">{s.postDate || '-'}</td>
                    <td className="py-2 px-4 align-middle">
                      <div className="font-black text-slate-800 text-[11px] line-clamp-1">{s.title}</div>
                      <div className="text-[9px] text-slate-400 font-bold mt-0.5">{s.type || '배달 신청 포맷형'}</div>
                    </td>
                    <td className="py-2 px-2 font-bold text-slate-600 align-middle text-center">
                      <div className="text-[10px] leading-tight truncate w-20 mx-auto" title={s.target}>
                        {s.target === '전사' ? '전사' : <span className="underline decoration-dashed decoration-slate-300">{s.target.split(',').length}개 부서 지정</span>}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-slate-500 tracking-tighter text-center text-[9px] whitespace-nowrap align-middle"><div>{s.startDate} ~</div><div>{s.endDate}</div></td>
                    <td className="py-2 px-2 text-center font-black text-slate-700 border-l bg-slate-50/30 align-middle">{rate}%</td>
                    <td className="py-2 px-2 text-center text-teal-600 font-black bg-teal-50/30 align-middle">{done}명</td>
                    <td className="py-2 px-2 text-center text-red-500 font-black bg-red-50/30 border-r align-middle">{notDone}명</td>
                    <td className="py-2 px-2 text-center align-middle"><span className="px-2 py-0.5 rounded font-black text-[9px] bg-slate-200 text-slate-600">{s.status}</span></td>
                    
                    <td className="py-2 px-2 text-center align-middle border-l border-slate-200">
                      <button onClick={() => handleRestore(s.id)} className="w-full py-1.5 border border-slate-300 bg-white text-slate-700 rounded hover:bg-slate-900 hover:text-white transition-all font-black text-[9px] whitespace-nowrap shadow-sm">🔄 복원</button>
                    </td>
                    
                    <td className="py-2 px-2 align-middle bg-slate-50/20">
                      <div className="flex items-center justify-center gap-1.5 max-w-[120px] mx-auto">
                        <button onClick={() => handleDownloadZip(s)} className="flex-1 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg shadow-sm hover:bg-indigo-600 hover:text-white transition-all font-black text-[9px] whitespace-nowrap flex items-center justify-center gap-1">
                          <span>📥</span> ZIP
                        </button>
                        <button onClick={() => handleDownloadSingleExcel(s)} className="flex-1 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg shadow-sm hover:bg-emerald-600 hover:text-white transition-all font-black text-[9px] whitespace-nowrap flex items-center justify-center gap-1">
                          <span>📈</span> 엑셀
                        </button>
                      </div>
                    </td>
     
                    {isLv1 && (
                      <td className="py-2 pr-4 text-center align-middle">
                        <button onClick={() => handlePermanentDelete(s.id)} className="w-full py-1.5 bg-white border border-red-200 text-red-500 rounded hover:bg-red-50 transition-all font-black text-[9px] whitespace-nowrap shadow-sm">
                          🗑️ 완전삭제
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex justify-center gap-1.5 p-4 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-lg text-[11px] font-black shadow-sm transition-all flex items-center justify-center ${currentPage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-200 border border-slate-200'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}