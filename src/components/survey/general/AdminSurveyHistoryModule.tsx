'use client';
     
import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation'; 
import Link from 'next/link';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getKSTDateString } from '@/utils/dateUtils'; // 🚀 공통 KST 날짜 유틸 적용
     
export default function AdminSurveyHistoryModule() {
  const pathname = usePathname(); 
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]); // 🚀 부서 계층 연산용 상태 추가
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  
  // 🚀 로컬 시간이 아닌 KST 기준 현재 연도로 안전하게 초기화
  const [selectedYear, setSelectedYear] = useState(getKSTDateString().substring(0, 4));
  
  useEffect(() => { setCurrentPage(1); }, [selectedYear]);
  
  const fetchArchiveData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      // 🚀 데이터 로딩 병렬 처리 및 의존성 분리 (users가 실패해도 responses는 살리도록)
      const [surveyRes, uRes, unitRes, meRes, respRes] = await Promise.all([
        fetch(`/api/survey/general?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/users?t=${ts}`, { cache: 'no-store' }).catch(() => null), 
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/survey/general', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_RESPONSES' }),
          cache: 'no-store'
        }).catch(() => null)
      ]);
     
      if (surveyRes && surveyRes.ok) setSurveys(await surveyRes.json());
      else setSurveys([]);

      if (meRes && meRes.ok) setCurrentUser(await meRes.json());

      let loadedUnits: any[] = [];
      if (unitRes && unitRes.ok) {
        loadedUnits = await unitRes.json();
        setUnitsList(loadedUnits);
      }

      if (uRes && uRes.ok) {
        const uData = await uRes.json();
        const mappedUsers = (uData.users || []).map((u:any) => ({ 
          ...u, 
          dept: loadedUnits.find((un:any) => un.id === u.unit_id)?.unit_name || '소속없음' 
        }));
        setUsers(mappedUsers);
      }
  
      if (respRes && respRes.ok) {
        const dbResponses = await respRes.json();
        const realRes: Record<string, any> = {};
        
        dbResponses.forEach((r: any) => {
          if (r.surveyId && r.userEmail) {
            realRes[`${r.surveyId}_${r.userEmail}`] = {
              isDone: true,
              date: r.submittedAt ? getKSTDateString(r.submittedAt) : '-',
              answers: r.answers || {}
            };
          }
        });
        setResponses(realRes);
      }
    } catch (error) { 
      console.error("아카이브 마스터 인프라 동기화 실패:", error); 
    } finally { 
      setLoading(false); 
    }
  };
     
  useEffect(() => {
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
    const currentYear = getKSTDateString().substring(0, 4);
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
    return uniqueYears.sort((a, b) => b.localeCompare(a)); 
  }, [archivedSurveys]);
  
  const filteredHistory = useMemo(() => archivedSurveys.filter(h => (h.endDate || h.postDate || '').startsWith(selectedYear)), [archivedSurveys, selectedYear]);
  
  // 🚀 [복구 및 개선] 조직 계층(Hierarchy) 포함 대상 검증 로직
  const isOrgAllowed = (targetDepts: string[], userDeptName: string) => {
    if (targetDepts.includes('전사')) return true;
    if (targetDepts.includes(userDeptName)) return true;
     
    let currentId = unitsList.find(u => u.unit_name === userDeptName)?.id;
    while (currentId) {
      const unit = unitsList.find(u => u.id === currentId);
      if (unit && unit.parent_id) {
        const parentUnit = unitsList.find(u => u.id === unit.parent_id);
        if (parentUnit && targetDepts.includes(parentUnit.unit_name)) return true; 
        currentId = unit.parent_id;
      } else break;
    }
    return false;
  };

  // 🚀 대상자 추출 헬퍼 함수 (반복되는 필터링 코드 제거)
  const getTargetUsers = (targetString: string) => {
    const targetDepts = (targetString || '').split(',').map((t: string) => t.trim());
    if (targetDepts.includes('전사')) return users;
    return users.filter(u => isOrgAllowed(targetDepts, u.dept));
  };

  // 🚀 엑셀 및 ZIP 출력 시 [object Object] 방지 및 깔끔한 텍스트화 헬퍼
  const formatAnswerForExport = (a: any) => {
    if (!a) return '(미응답)';
    if (Array.isArray(a)) return a.join(', ');
    if (a.fileName) return `[첨부파일] ${a.fileName}`;
    if (typeof a === 'object' && a.roadAddress !== undefined) {
      return `[${a.zipCode || ''}] ${a.roadAddress} ${a.detailAddress || ''}`.trim();
    }
    return typeof a === 'object' ? JSON.stringify(a) : String(a);
  };
  
  const handleRestore = async (id: string) => {
    if (!confirm('이 설문을 운영 현황판으로 복원하시겠습니까?\n복원 즉시 [게시중단] 상태로 메인 현황판에 인입되며, 관리자가 기간을 수정한 후 다시 게시할 수 있습니다.')) return;
    const surveyToRestore = surveys.find(s => s.id === id);
    if (!surveyToRestore) return;
    const updatedSurvey = { ...surveyToRestore, status: '게시중단' };
     
    try {
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSurvey)
      });
      if (res.ok) {
        alert('🔄 성공적으로 복원되었습니다!\n[게시중단] 상태로 전환되었습니다. 메인 현황판에서 마감 기한을 연장하신 후 [게시] 버튼을 눌러주세요.');
        fetchArchiveData();
      } else {
        alert('복원 처리 중 서버 오류가 발생했습니다.');
      }
    } catch (e) {
      alert('네트워크 오류가 발생했습니다.');
    }
  };
     
  const handlePermanentDelete = async (id: string) => {
    if (!confirm('경고: 이 보관된 설문을 영구적으로 삭제하시겠습니까?\n모든 정보와 이력이 완전히 유실되며 복구할 수 없습니다.')) return;
    try {
      const res = await fetch(`/api/survey/general?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('데이터가 시스템에서 영구 삭제되었습니다.');
        fetchArchiveData();
      } else {
        alert('삭제 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      alert('네트워크 오류가 발생했습니다.');
    }
  };
     
  const handleDownloadSingleExcel = (survey: any) => {
    let parsedQuestions = [];
    try {
      parsedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []);
    } catch (e) {
      console.error("문항 데이터 파싱 실패:", e);
    }
    const questions = parsedQuestions.length > 0 ? parsedQuestions : [{ id: 'q1', title: '1. 의견 및 건의사항' }];
    
    const targetUsers = getTargetUsers(survey.target); // 🚀 헬퍼 적용 (계층 필터 반영)
    const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
    
    if (submittedUsers.length === 0) return alert("본 설문에 접수된 완료 데이터가 없어 엑셀을 도출할 수 없습니다.");
    
    const deptRow = ['제출조직(부서)', ...submittedUsers.map(u => survey.isAnonymous ? '익명조직' : u.dept)];
    const nameRow = ['제출자이름', ...submittedUsers.map((u, i) => survey.isAnonymous ? `익명응답자 ${i + 1}` : u.name)];
    const dateRow = ['제출일자', ...submittedUsers.map(u => responses[`${survey.id}_${u.email}`]?.date || '-')];
        
    const contentRows = questions.map((q: any) => {
      if (q.type === 'SECTION') return [`[🔖 섹션 단락]: ${q.title}`];
      const rowData = [q.title];
      submittedUsers.forEach(u => {
        const ans = responses[`${survey.id}_${u.email}`]?.answers;
        rowData.push(formatAnswerForExport(ans?.[q.id])); // 🚀 안전한 포맷팅 적용
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
    const targetUsers = getTargetUsers(survey.target); // 🚀 헬퍼 적용
    const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
    
    if (submittedUsers.length === 0) return alert("제출된 응답이 없습니다.");
    alert(`${submittedUsers.length}명의 데이터를 압축 파일로 생성합니다. 잠시만 기다려주세요...`);
  
    const safeFolderTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-');
    const folder = zip.folder(safeFolderTitle);
    let storedQuestions = [];
    try {
      storedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []);
    } catch (e) {
      console.error("문항 데이터 파싱 실패:", e);
    }
  
    submittedUsers.forEach((user, idx) => {
      const resp = responses[`${survey.id}_${user.email}`];
      const identifier = survey.isAnonymous ? `익명응답자_${idx + 1}` : `${user.dept}_${user.name}`;
      const fileNameBase = `${identifier}_${safeFolderTitle}`; 
      let content = `■ 설문명: ${survey.title}\n■ 제출자: ${survey.isAnonymous ? '익명' : user.dept + ' ' + user.name}\n■ 제출일: ${resp.date}\n------------------------------------------\n\n`;
      
      let qNum = 1; // 🚀 섹션을 무시하는 실제 문항 번호 카운터 도입
      storedQuestions.forEach((q: any) => {
         if (q.type === 'SECTION') return;
         content += `Q${qNum++}. ${q.title}\n`;
         
         const ansData = resp.answers ? resp.answers[q.id] : null;
         if (ansData && ansData.fileName) {
             content += `A. [첨부파일] ${ansData.fileName} (별도 파일로 추출됨)\n\n`;
             if (ansData.fileData) {
                 const base64Data = ansData.fileData.split(',')[1];
                 folder?.file(`${identifier}_${ansData.fileName}`, base64Data, {base64: true});
             }
         } else {
             content += `A. ${formatAnswerForExport(ansData)}\n\n`; // 🚀 주소 및 일반 답변 포맷팅
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
      const targetUsers = getTargetUsers(h.target); // 🚀 헬퍼 적용
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
  
  if (loading) return <div className="p-10 font-black text-emerald-600 animate-pulse text-center tracking-widest text-xl mt-20">아카이브 데이터를 동기화 중입니다...</div>;
  
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[140px]">
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">
              ARCHIVED SURVEY INVENTORY
            </h3>
            <h1 className="text-2xl font-black tracking-tight text-white leading-none">
              종료 조사 아카이브 (보관함)
            </h1>
            <p className="text-emerald-100/90 text-xs font-semibold mt-4 opacity-90">
              공고 기한이 마감되어 최종 보관 처리된 과거 조사 명세와 누적 응답 데이터 대장입니다.
            </p>
          </div>
        </div>
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
          📦
        </div>
      </div>
     
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-2xl mt-4">
        {[
          { name: '📋 현재 진행중인 조사', path: '/survey/general/admin/active-surveys' },
          { name: '🗂️ 전체 조사 이력 관리', path: '/survey/general/admin/survey-history' },
        ].map((tab) => {
          const isActive = pathname.startsWith(tab.path);
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
     
      <div className="flex justify-end items-center gap-3 w-full pt-2">
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
     
        <button 
          type="button"
          onClick={handleExportListExcel} 
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black shadow-sm transition-all flex items-center gap-1.5 active:scale-98"
        >
          <span>📋</span> 리스트 엑셀 다운로드
        </button>
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
                <th className="py-3 px-2 w-36 text-center">응답 관리</th>
                {isLv1 && <th className="py-3 pr-4 w-20 text-center text-red-500">데이터 삭제</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredHistory.length === 0 ? (
                <tr><td colSpan={isLv1 ? 15 : 14} className="py-20 text-center text-slate-400 font-black text-sm">{selectedYear}년도에 보관된 조사가 없습니다.</td></tr>
              ) : currentHistory.map((s, i) => {
                const targetUsers = getTargetUsers(s.target); // 🚀 헬퍼 함수 적용
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