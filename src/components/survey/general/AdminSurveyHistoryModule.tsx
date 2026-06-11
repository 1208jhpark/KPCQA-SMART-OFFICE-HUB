'use client';
  
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
  
export default function AdminSurveyHistoryModule() {
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  
  useEffect(() => { setCurrentPage(1); }, [selectedYear]);
  
  useEffect(() => {
    const fetchArchiveData = async () => {
      try {
        const storedSurveys = localStorage.getItem('admin_surveys_db');
        if (storedSurveys) setSurveys(JSON.parse(storedSurveys));
  
        const [uRes, unitRes, meRes] = await Promise.all([ 
          fetch('/api/admin/users'), 
          fetch('/api/admin/units?active=true'),
          fetch('/api/auth/me') 
        ]);

        if (meRes.ok) {
          const meData = await meRes.json();
          setCurrentUser(meData);
        }

        if (uRes.ok && unitRes.ok) {
          const uData = await uRes.json();
          const unitData = await unitRes.json();
          const mappedUsers = (uData.users || []).map((u:any) => ({ 
            ...u, 
            dept: unitData.find((un:any) => un.id === u.unit_id)?.unit_name || '소속없음' 
          }));
          setUsers(mappedUsers);
  
          const realRes: Record<string, any> = {};
          mappedUsers.forEach((u:any) => {
            if (!u.email) return;
            const stored = localStorage.getItem(`my_responses_${u.email}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              Object.keys(parsed).forEach(surveyId => {
                realRes[`${surveyId}_${u.email}`] = {
                  isDone: true,
                  date: parsed[surveyId].submittedAt?.split(' ')[0],
                  result: '제출완료',
                  answers: parsed[surveyId].answers
                };
              });
            }
          });
          setResponses(realRes);
        }
      } catch (error) { 
        console.error(error); 
      } finally { 
        setLoading(false); 
      }
    };
    fetchArchiveData();
  }, []);

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
  
  const handleRestore = (id: string) => {
    if (!confirm('이 설문을 운영(현황판) 리스트로 다시 복원하시겠습니까?')) return;
    const updatedSurveys = surveys.map(s => s.id === id ? { ...s, status: '완료' } : s);
    setSurveys(updatedSurveys);
    localStorage.setItem('admin_surveys_db', JSON.stringify(updatedSurveys));
    alert('운영 리스트로 복원되었습니다. (현황판에서 확인 가능)');
  };

  const handlePermanentDelete = (id: string) => {
    if (!confirm('경고: 이 보관된 설문을 영구적으로 삭제하시겠습니까?\n모든 정보와 이력이 완전히 유실되며 복구할 수 없습니다.')) return;
    const updatedSurveys = surveys.filter(s => s.id !== id);
    setSurveys(updatedSurveys);
    localStorage.setItem('admin_surveys_db', JSON.stringify(updatedSurveys));
    alert('데이터가 시스템에서 영구 삭제되었습니다.');
  };
  
  const checkHierarchyTarget = (targetString: string, userDeptName: string) => {
    if (!targetString || targetString === '전사') return true;
    const targetDepts = targetString.split(',').map(t => t.trim());
    if (!userDeptName) return false;
    if (targetDepts.includes(userDeptName)) return true;
    return false;
  };
  
  const isOrgAllowed = (targetDepts: string[], userDeptName: string) => {
    if (targetDepts.includes('전사')) return true;
    if (targetDepts.includes(userDeptName)) return true;
    return false;
  };

  // 🚀 [신규 기능 추가]: 단일 보관 설문조사에 대한 3단 행 분리형 엑셀 다운로드 엔진
  const handleDownloadSingleExcel = (survey: any) => {
    const storedQuestions = JSON.parse(localStorage.getItem(`survey_builder_${survey.id}`) || '[]');
    const questions = storedQuestions.length > 0 ? storedQuestions : [{ id: 'q1', title: '1. 의견 및 건의사항' }];
    
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    const targetUsers = targetDepts.includes('전사') ? users : users.filter(u => targetDepts.includes(u.dept));
    const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
    
    if (submittedUsers.length === 0) return alert("본 설문에 접수된 완료 데이터가 없어 엑셀을 도출할 수 없습니다.");
    
    // ⭕ 관리자 요구사항: 1행(부서), 2행(이름), 3행(제출일), 4행~(질문/답변) 완전 분할 구조화
    const deptRow = ['제출조직(부서)', ...submittedUsers.map(u => survey.isAnonymous ? '익명조직' : u.dept)];
    const nameRow = ['제출자이름', ...submittedUsers.map((u, i) => survey.isAnonymous ? `익명응답자 ${i + 1}` : u.name)];
    const dateRow = ['제출일자', ...submittedUsers.map(u => responses[`${survey.id}_${u.email}`]?.date || '-')];
    
    const contentRows = questions.map((q: any) => {
      const rowData = [q.title];
      submittedUsers.forEach(u => {
        const ans = responses[`${survey.id}_${u.email}`]?.answers;
        if (!ans || !ans[q.id]) rowData.push('(미응답)');
        else {
          const a = ans[q.id];
          rowData.push(Array.isArray(a) ? a.join(', ') : (a.fileName ? `[첨부파일] ${a.fileName}` : a));
        }
      });
      return rowData;
    });

    const ws = XLSX.utils.aoa_to_sheet([deptRow, nameRow, dateRow, ...contentRows]);
    const wb = XLSX.utils.book_new();
    const safeTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
    XLSX.utils.book_append_sheet(wb, ws, safeTitle);
    XLSX.writeFile(wb, `[개별응답분석]_${safeTitle}.xlsx`);
  };
  
  const handleDownloadZip = async (survey: any) => {
    const zip = new JSZip();
    const targetDepts = survey.target.split(',').map((t:string) => t.trim());
    const targetUsers = targetDepts.includes('전사') ? users : users.filter(u => targetDepts.includes(u.dept));
    const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
  
    if (submittedUsers.length === 0) return alert("제출된 응답이 없습니다.");
    alert(`${submittedUsers.length}명의 데이터를 압축 파일로 생성합니다. 잠시만 기다려주세요...`);
  
    const safeFolderTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-');
    const folder = zip.folder(safeFolderTitle);
    const storedQuestions = JSON.parse(localStorage.getItem(`survey_builder_${survey.id}`) || '[]');
  
    submittedUsers.forEach((user, idx) => {
      const resp = responses[`${survey.id}_${user.email}`];
      const identifier = survey.isAnonymous ? `익명응답자_${idx + 1}` : `${user.dept}_${user.name}`;
      const fileNameBase = `${identifier}_${safeFolderTitle}`; 
  
      let content = `■ 설문명: ${survey.title}\n■ 제출자: ${survey.isAnonymous ? '익명' : user.dept + ' ' + user.name}\n■ 제출일: ${resp.date}\n------------------------------------------\n\n`;
      
      storedQuestions.forEach((q: any, i: number) => {
         content += `Q${i+1}. ${q.title}\n`;
         const ans = resp.answers ? resp.answers[q.id] : null;
  
         if (ans && ans.fileName) {
             content += `A. [첨부파일] ${ans.fileName} (별도 파일로 추출됨)\n\n`;
             if (ans.fileData) {
                 const base64Data = ans.fileData.split(',')[1];
                 folder?.file(`${identifier}_${ans.fileName}`, base64Data, {base64: true});
             }
         } else {
             content += `A. ${Array.isArray(ans) ? ans.join(', ') : (ans || '미답변')}\n\n`;
         }
      });
      folder?.file(`${fileNameBase}_응답요약.txt`, "\ufeff" + content); 
    });
  
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `[응답전체모음]_${safeFolderTitle}.zip`);
  };
  
  const handleExportListExcel = () => {
    if (filteredHistory.length === 0) return alert("데이터가 없습니다.");
    const exportData = filteredHistory.map((h, idx) => {
      const targetDepts = h.target.split(',').map((t:string) => t.trim());
      const targetUsers = targetDepts.includes('전사') ? users : users.filter(u => targetDepts.includes(u.dept));
      const done = targetUsers.filter(u => responses[`${h.id}_${u.email}`]?.isDone).length;
      const total = targetUsers.length;
  
      return {
        'NO': filteredHistory.length - idx,
        '식별코드': h.code,
        '게시번호': h.postNumber,
        '게시일': h.postDate,
        '게시명': h.title,
        '유형': h.type,
        '익명여부': h.isAnonymous ? '익명' : '기명',
        '대상': h.target,
        '시작일': h.startDate,
        '종료일': h.endDate,
        '참여율': total > 0 ? Math.round((done/total)*100) + '%' : '0%',
        '참여인원': done,
        '미참여인원': total - done,
        '보관 상태': h.status
      };
    });
  
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "설문이력대장");
    XLSX.writeFile(wb, `설문조사_보관이력_${selectedYear}년.xlsx`);
  };
  
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const currentHistory = filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  if (loading) return <div className="p-10 font-black text-indigo-400 animate-pulse text-center tracking-widest text-xl mt-20">아카이브 데이터를 동기화 중입니다...</div>;
  
  return (
    <div className="p-6 space-y-6 font-sans text-slate-900 animate-fade-in pb-20 max-w-[1600px] mx-auto text-[11px]">
      <div className="bg-slate-900 p-6 px-8 rounded-[2rem] text-white shadow-xl flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-black mb-1 flex items-center gap-2"><span className="text-2xl">📦</span> 종료 조사 아카이브 (보관함)</h1>
          <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">Archived Survey Inventory</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/survey/general/admin/active-surveys" className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[11px] font-black border border-slate-700 transition-all mr-2">⬅️ 현황판으로 돌아가기</Link>
          <div className="flex items-center gap-2 bg-slate-800 px-4 py-2.5 rounded-xl border border-slate-700 shadow-inner">
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">🗓️ 조회 연도</span>
            <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="bg-transparent text-[12px] font-black text-white outline-none cursor-pointer">
              {availableYears.map(year => <option key={year} value={year} className="text-slate-900">{year}년</option>)}
            </select>
          </div>
          <button onClick={handleExportListExcel} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[11px] font-black flex items-center gap-2 transition-all shadow-lg active:scale-95"><span>📋</span> 리스트 엑셀 다운로드</button>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-medium min-w-[1400px]">
            <thead className="bg-slate-50 text-[10px] text-slate-500 font-black border-b border-slate-200 tracking-tight uppercase">
              <tr>
                <th className="py-3 pl-4 w-10 text-center">NO</th>
                <th className="py-3 px-2 w-20">식별코드</th>
                <th className="py-3 px-2 w-16 text-center text-indigo-500">게시번호</th>
                <th className="py-3 px-2 w-20 text-center">게시일</th>
                <th className="py-3 px-2 w-[220px]">게시명 / 유형</th>
                <th className="py-3 px-2 w-14 text-center text-indigo-500">익명여부</th>
                <th className="py-3 px-2 w-24 text-center">대상</th>
                <th className="py-3 px-2 w-32 text-center">기간</th>
                <th className="py-3 px-2 w-12 text-center border-l bg-slate-100/50">참여율</th>
                <th className="py-3 px-2 w-12 text-center bg-blue-50/50 text-blue-600">참여</th>
                <th className="py-3 px-2 w-14 text-center bg-red-50/50 text-red-600 border-r">미참여</th>
                <th className="py-3 px-2 w-16 text-center">상태</th>
                <th className="py-3 px-2 w-20 text-center border-l border-slate-200">운영복원</th>
                {/* 🚀 응답 관리 컬럼 가로폭 확장 */}
                <th className="py-3 px-2 w-36 text-center">응답 관리</th>
                {isLv1 && <th className="py-3 pr-4 w-20 text-center text-red-500">데이터 삭제</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredHistory.length === 0 ? (
                <tr><td colSpan={isLv1 ? 15 : 14} className="py-20 text-center text-slate-400 font-black text-sm">{selectedYear}년도에 보관된 조사가 없습니다.</td></tr>
              ) : currentHistory.map((s, i) => {
                const targetDepts = s.target.split(',').map((t:string) => t.trim());
                const targetUsers = targetDepts.includes('전사') ? users : users.filter(u => targetDepts.includes(u.dept));
                const done = targetUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                const total = targetUsers.length;
                const notDone = total - done;
                const rate = total > 0 ? Math.round((done/total)*100) : 0;
  
                return (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors h-12 group">
                    <td className="py-2 text-center text-slate-400 font-bold align-middle pl-4">{filteredHistory.length - ((currentPage - 1) * itemsPerPage + i)}</td>
                    <td className="py-2 px-2 font-mono font-black text-slate-600 tracking-tighter align-middle">{s.code}</td>
                    <td className="py-2 px-2 font-black text-center text-indigo-600 text-[12px] align-middle">{s.postNumber}</td>
                    <td className="py-2 px-2 font-mono text-center text-slate-500 whitespace-nowrap align-middle">{s.postDate || '-'}</td>
                    <td className="py-2 px-2 align-middle">
                      <div className="font-black text-slate-800 text-[11px] line-clamp-1">{s.title}</div>
                      <div className="text-[9px] text-slate-400 mt-0.5">{s.type}</div>
                    </td>
                    <td className="py-2 px-2 text-center align-middle">
                      {s.isAnonymous ? (
                        <span className="px-1.5 py-0.5 bg-slate-700 text-white text-[9px] font-black rounded">익명</span>
                      ) : (
                        <span className="px-1.5 py-0.5 border border-slate-300 text-slate-500 text-[9px] font-bold rounded">기명</span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-bold text-slate-600 align-middle text-center">
                      <div className="text-[10px] leading-tight truncate w-20 mx-auto" title={s.target}>
                        {s.target === '전사' ? '전사' : <span className="underline decoration-dashed decoration-slate-300">{s.target.split(',').length}개 부서 지정</span>}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-slate-500 tracking-tighter text-center text-[9px] whitespace-nowrap align-middle"><div>{s.startDate} ~</div><div>{s.endDate}</div></td>
                    <td className="py-2 px-2 text-center font-black text-slate-700 border-l bg-slate-50/30 align-middle">{rate}%</td>
                    <td className="py-2 px-2 text-center text-blue-600 font-black bg-blue-50/30 align-middle">{done}명</td>
                    <td className="py-2 px-2 text-center text-red-500 font-black bg-red-50/30 border-r align-middle">{notDone}명</td>
                    <td className="py-2 px-2 text-center align-middle"><span className="px-2 py-0.5 rounded font-black text-[9px] bg-slate-200 text-slate-600">{s.status}</span></td>
                    
                    <td className="py-2 px-2 text-center align-middle border-l border-slate-200">
                      <button onClick={() => handleRestore(s.id)} className="w-full py-1.5 border border-slate-300 bg-white text-slate-700 rounded hover:bg-slate-900 hover:text-white transition-all font-black text-[9px] whitespace-nowrap shadow-sm">🔄 복원</button>
                    </td>
                    {/* 🚀 [요구사항 반영] ZIP 버튼 우측에 분할형 개별 엑설 버튼 나열 배치 */}
                    <td className="py-2 px-2 align-middle">
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