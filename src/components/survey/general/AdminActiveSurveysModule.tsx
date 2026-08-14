'use client';
     
import React, { useState, useMemo, useEffect, Fragment } from 'react';
import { usePathname } from 'next/navigation'; // 🚀 안 쓰는 useRouter 제거
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx'; 
import { getKSTDateString, isPastKSTDeadline } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import {
  normalizeGeneralResponsesPayload,
  buildAdminResponseMap,
  listAnonymousContentRows,
  getAnonymousDoneCount,
} from '@/utils/surveyGeneralResponses';
     
export default function ActiveSurveysAdminPage() {
  const pathname = usePathname();
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [deptList, setDeptList] = useState<string[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [anonymousParticipationCounts, setAnonymousParticipationCounts] = useState<Record<string, number>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [surveyListFilter, setSurveyListFilter] = useState<'ALL' | 'ONGOING' | 'CLOSING_TODAY'>('ALL');
  const [matrixUserFilter, setMatrixUserFilter] = useState<{surveyId: string, type: 'DONE' | 'NOT_DONE' | 'ALL'}>({surveyId: '', type: 'ALL'});
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [selectedSurveyIds, setSelectedSurveyIds] = useState<Set<string>>(new Set());
  
  const [editModal, setEditModal] = useState<any | null>(null);
  const [previewModal, setPreviewModal] = useState<any | null>(null);
  const [nudgeModal, setNudgeModal] = useState<{
    surveyId: string;
    title: string;
    count: number;
    targetEmails: string[];
    resolveOnServer?: boolean;
  } | null>(null);
     
  // 🚀 [신규 추가]: 엑셀/ZIP 내보내기 시 객체(주소, 파일 등) 깨짐 방지 헬퍼
// 🚀 [보완]: 우편번호가 없더라도 주소 필드가 있다면 깨짐 없이 문자열로 파싱하도록 예외 처리 강화
const formatAnswerForExport = (ans: any) => {
  if (ans === null || ans === undefined) return '(미응답)';
  if (typeof ans === 'object') {
    if (ans.fileName) return `[첨부파일] ${ans.fileName}`;
    if (ans.zipCode || ans.roadAddress || ans.detailAddress) {
      const zip = ans.zipCode ? `[우편번호: ${ans.zipCode}] ` : '';
      const road = ans.roadAddress || '';
      const detail = ans.detailAddress ? ` ${ans.detailAddress}` : '';
      return `${zip}${road}${detail}`.trim() || '(미응답)';
    }
  }
  if (Array.isArray(ans)) return ans.join(', ');
  return String(ans);
};

  useEffect(() => {
    const fetchOrgData = async () => {
      try {
        const ts = Date.now();
        // 🚀 1. 설문 공고 로드 (캐시 우회)
        const surveyRes = await fetch(`/api/survey/general?t=${ts}`, { cache: 'no-store' });
        if (!surveyRes.ok) throw new Error('설문 공고 데이터를 불러오지 못했습니다.');
        const dbSurveys = await surveyRes.json();
        setSurveys(dbSurveys);

        // 🚀 2. 설문관리 컨텍스트 (LV_1·LV_2 메뉴권한) — /api/admin/users(LV_1전용) 대체
        const contextRes = await fetch(`/api/survey/general?t=${ts}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_ADMIN_CONTEXT', menuPath: pathname }),
          cache: 'no-store',
        });
        if (!contextRes.ok) {
          if (contextRes.status === 401 || contextRes.status === 403) {
            throw new Error('설문 관리 화면 권한이 없습니다. 허용된 부서/메뉴 권한을 확인해 주세요.');
          }
          throw new Error('사용자 및 조직도 데이터를 불러오지 못했습니다.');
        }
        const contextData = await contextRes.json();
        setUnitsList(contextData.units || []);
        setDeptList(
          Array.isArray(contextData.scopeDepts) && contextData.scopeDepts.length > 0
            ? contextData.scopeDepts
            : (contextData.units || []).map((u: any) => u.unit_name)
        );
        setUsers(contextData.users || []);
        setCanEdit(!!contextData.canEdit);
        setPermissionSummary(contextData.permissionSummary || null);

        // 🚀 3. 응답 원장 수거
        const responseRes = await fetch(`/api/survey/general?t=${ts}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_RESPONSES', includeAnonymousAnswers: true })
        });

        if (!responseRes.ok) {
          if (responseRes.status === 401 || responseRes.status === 403) {
             throw new Error('전체 응답을 조회할 관리자 권한이 없습니다.');
          }
          throw new Error('설문 응답 데이터를 가져오는데 실패했습니다.');
        }

        const dbPayload = await responseRes.json();
        const { responses: dbResponses, anonymousParticipationCounts: anonCounts } =
          normalizeGeneralResponsesPayload(dbPayload);
        setAnonymousParticipationCounts(anonCounts);
        setResponses(buildAdminResponseMap(dbResponses, getKSTDateString));
        
      } catch (error: any) { 
        console.error("Admin Survey 관제 데이터 로드 실패:", error); 
        alert(`인프라 초기화 실패: ${error.message}`);
        setSurveys([]); // 🚀 [추가]: 부분 로드 실패 시 잘못된 0% 통계를 막기 위해 화면 목록 초기화
      } finally { 
        setLoading(false); 
      }
    };
    fetchOrgData();
  }, [pathname]);
     
  const todayStr = getKSTDateString();

  const requireEdit = () => {
    if (canEdit) return true;
    alert('권한이 없습니다.');
    return false;
  };

  const openNamedSubmissionView = (survey: any, user: any, resp: any) => {
    if (!canEdit) {
      alert('권한이 없습니다.');
      return;
    }
    if (survey?.isAnonymous) {
      alert('🔒 익명 설문은 개별 제출자 명세를 열람할 수 없습니다. 다운로드에서 익명으로 취합하세요.');
      return;
    }
    let questions: any[] = [];
    try {
      questions = typeof survey.questions === 'string'
        ? JSON.parse(survey.questions)
        : (survey.questions || []);
    } catch {
      questions = [];
    }
    let answers = resp?.answers || {};
    if (typeof answers === 'string') {
      try { answers = JSON.parse(answers); } catch { answers = {}; }
    }
    const content = questions
      .filter((q: any) => q.type !== 'SECTION')
      .map((q: any) => {
        let aStr = '미입력';
        if (q.type === 'SEARCH_ADDRESS') {
          const zip = answers[`${q.id}_zip`] || answers[q.id]?.zipCode;
          const road = answers[`${q.id}_road`] || answers[q.id]?.roadAddress;
          const detail = answers[`${q.id}_detail`] || answers[q.id]?.detailAddress;
          if (zip || road) aStr = `[${zip || ''}] ${road || ''} ${detail || ''}`;
        } else {
          const a = answers[q.id];
          if (a !== undefined && a !== null && a !== '') {
            aStr = Array.isArray(a) ? a.join(', ') : (a.fileName || String(a));
          }
        }
        return `• ${q.title}\n  ➔ ${aStr}`;
      })
      .join('\n\n');
    alert(`📋 [${user.name}] ${survey.title}\n제출일: ${resp.date || '-'}\n\n${content || '제출된 내용이 없습니다.'}`);
  };

  const stats = useMemo(() => ({
    activeCount: surveys.filter(s => s.status === '진행중').length,
    closingTodayCount: surveys.filter(s => s.status === '진행중' && s.endDate === todayStr).length,
  }), [surveys, todayStr]);
     
  const sortedSurveys = useMemo(() => [...surveys].sort((a, b) => a.postNumber - b.postNumber), [surveys]);
  
  const filteredSurveys = useMemo(() => {
    let list = sortedSurveys;
    if (surveyListFilter === 'ONGOING') list = list.filter(s => s.status === '진행중');
    else if (surveyListFilter === 'CLOSING_TODAY') list = list.filter(s => s.status === '진행중' && s.endDate === todayStr);
    else list = list.filter(s => s.status !== '보관됨');
    return list;
  }, [sortedSurveys, surveyListFilter, todayStr]);
     
  const groupedUsers = useMemo(() => {
    const groups: Record<string, any[]> = {};
    users.forEach(u => {
      if (!groups[u.dept]) groups[u.dept] = [];
      groups[u.dept].push(u);
    });
    return groups;
  }, [users]);
     
  const toggleDept = (dept: string) => {
    const next = new Set(collapsedDepts);
    next.has(dept) ? next.delete(dept) : next.add(dept);
    setCollapsedDepts(next);
  };
  
  const collapseAll = () => setCollapsedDepts(new Set(Object.keys(groupedUsers)));
  const expandAll = () => {
    setCollapsedDepts(new Set());
    setMatrixUserFilter({ surveyId: '', type: 'ALL' }); 
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
  
  const handleCopyUnsubmittedEmails = (survey: any) => {
    if (survey.isAnonymous) {
      return alert("❌ 익명 게시의 경우 메일 추출이 불가하며, 독촉 알림만 발송 가능합니다.");
    }
    
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
    const unsubmitted = targetUsers.filter(u => !responses[`${survey.id}_${u.email}`]?.isDone);
    
    if (unsubmitted.length === 0) return alert('현재 미참여자가 없습니다.');
    const emails = unsubmitted.map(u => u.email).join(', ');
    navigator.clipboard.writeText(emails);
    alert(`미참여자 ${unsubmitted.length}명의 이메일이 클립보드에 복사되었습니다.\n(메일 클라이언트의 '받는 사람' 란에 바로 붙여넣기 하세요.)`);
  };
     
  const toggleTarget = (dept: string) => {
    const currentTargets = editModal.target.split(',').map((s:string) => s.trim()).filter(Boolean);
    let nextTargets = new Set(currentTargets);
    if (dept === '전사') nextTargets = new Set(['전사']);
    else {
      nextTargets.delete('전사');
      nextTargets.has(dept) ? nextTargets.delete(dept) : nextTargets.add(dept);
      if (nextTargets.size === 0) nextTargets.add('전사'); 
    }
    setEditModal({...editModal, target: Array.from(nextTargets).join(', ')});
  };
     
  const handleAddSurvey = () => {
    if (!requireEdit()) return;
    const nextPostNumber = surveys.length > 0 ? Math.max(...surveys.map(s => s.postNumber)) + 1 : 101;
    setEditModal({ 
      id: `S_${Date.now()}`, 
      code: `SRV-NEW-${Date.now().toString().slice(-4)}`, 
      postNumber: nextPostNumber, 
      title: '새로운 설문', 
      description: '', 
      type: '선택형', 
      isAnonymous: false,
      target: '전사', 
      postDate: todayStr, 
      startDate: todayStr, 
      endDate: todayStr, 
      status: '게시전',
      hasBeenPublished: false
    });
  };
     
  const handleDeleteSurvey = async (id: string) => {
    if (!requireEdit()) return;
    if (!confirm('이 설문을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/survey/general?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSurveys(prev => prev.filter(s => s.id !== id));
      } else {
        const errData = await res.json();
        alert(`❌ 삭제 실패: ${errData.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('네트워크 지연 오류가 발생했습니다.');
    }
  };
     
  const handleStatusChange = async (id: string, action: 'UP' | 'DOWN' | 'ARCHIVE' | 'FORCE_COMPLETE') => {
    if (!requireEdit()) return;
    const currentSurvey = surveys.find(s => s.id === id);
    if (!currentSurvey) return;
     
    let finalPayload: any = { ...currentSurvey, menuPath: pathname };
    if (action === 'UP') finalPayload = { ...finalPayload, status: '진행중', postDate: todayStr, hasBeenPublished: true };
    if (action === 'DOWN') finalPayload = { ...finalPayload, status: '게시중단' };
    if (action === 'FORCE_COMPLETE') {
      if(!confirm("이 설문을 즉시 강제 종료(완료) 처리하시겠습니까?")) return;
      finalPayload = { ...finalPayload, status: '완료' };
    }
    if (action === 'ARCHIVE') { 
      if(!confirm("이 설문을 보관함으로 영구 이동하시겠습니까?")) return;
      finalPayload = { ...finalPayload, status: '보관됨' }; 
    }
     
    try {
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload)
      });
      if (res.ok) {
        const savedNode = await res.json();
        setSurveys(prev => prev.map(s => s.id === id ? savedNode : s));
        // 🚀 [위치 교정]: 통신 성공 후에만 알림 표시
        if (action === 'ARCHIVE') alert('✅ 보관함으로 성공적으로 이동되었습니다.');
      } else {
        const errData = await res.json();
        alert(`❌ 상태 변경 실패: ${errData.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('상태 변경 동기화에 실패했습니다 (네트워크 오류).');
    }
  };
     
  const handleNudge = (surveyId: string) => {
    if (!requireEdit()) return;
    const survey = surveys.find(s => s.id === surveyId);
    if (!survey) return;
    const targetDepts = survey.target.split(',').map((t:string) => t.trim());
    const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
    const total = targetUsers.length;

    if (survey.isAnonymous) {
      const done = getAnonymousDoneCount(surveyId, anonymousParticipationCounts, responses);
      const notDone = Math.max(0, total - done);
      if (notDone === 0) return alert('모든 인원이 참여를 완료했습니다!');
      setNudgeModal({
        surveyId,
        title: survey.title,
        count: notDone,
        targetEmails: [],
        resolveOnServer: true,
      });
      return;
    }

    const notDoneUsers = targetUsers.filter(u => !responses[`${surveyId}_${u.email}`]?.isDone);
    if (notDoneUsers.length === 0) return alert('모든 인원이 참여를 완료했습니다!');
    
    setNudgeModal({ 
      surveyId, 
      title: survey.title, 
      count: notDoneUsers.length,
      targetEmails: notDoneUsers.map(u => u.email),
      resolveOnServer: false,
    });
  };
     
  const handleSavePreview = async () => {
    if (!requireEdit()) return;
    try {
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewModal ? { ...previewModal, menuPath: pathname } : previewModal)
      });
      if (res.ok) {
        const savedData = await res.json();
        setSurveys(prev => prev.map(s => s.id === previewModal.id ? savedData : s));
        alert('✅ 기본 정보가 수정되었습니다.');
        setPreviewModal(null);
      } else {
        const errData = await res.json();
        alert(`❌ 갱신 실패: ${errData.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('네트워크 인터페이스 오류입니다.');
    }
  };
     
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireEdit()) return;
    // 🚀 [찌꺼기 제거]: DB에 없는 allowedDepts 파생 로직 삭제. target 필드만 사용.
    const finalEditData = { ...editModal, menuPath: pathname };
     
    try {
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalEditData)
      });
     
      if (res.ok) {
        const savedRecord = await res.json();
        setSurveys(prev => {
          const exists = prev.find(s => s.id === savedRecord.id || s.id === editModal.id);
          if (exists) {
            return prev.map(s => (s.id === savedRecord.id || s.id === editModal.id) ? savedRecord : s);
          } else {
            return [...prev, savedRecord];
          }
        });
        alert('✅ 설문 메타 서식이 성공적으로 저장되었습니다.');
        setEditModal(null);
      } else {
        const errData = await res.json();
        alert(`❌ 저장 실패: ${errData.error || '알 수 없는 오류'}`);
      }
    } catch (err) {
      alert('네트워크 인터페이스 에러가 검출되었습니다.');
    }
  };
     
  const handleMatrixFilter = (surveyId: string, type: 'DONE' | 'NOT_DONE') => {
    setMatrixUserFilter({ surveyId, type });
    setCollapsedDepts(new Set()); 
  };
     
  const handleExportAnalysisAll = () => {
    if (!requireEdit()) return;
    if (selectedSurveyIds.size === 0) return alert('분석할 설문을 하나 이상 선택해주세요.');
    const selectedSurveys = surveys.filter(s => selectedSurveyIds.has(s.id));
    const wb = XLSX.utils.book_new();
    let hasData = false;
      
    selectedSurveys.forEach(survey => {
      let parsedQuestions = [];
      try { 
        parsedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []); 
      } catch(e) {}
      const questions = parsedQuestions.length > 0 ? parsedQuestions : [{ id: 'q1', title: '1. 의견 및 건의사항' }];

      if (survey.isAnonymous) {
        const anonRows = listAnonymousContentRows(responses, survey.id);
        if (anonRows.length === 0) return;
        hasData = true;
        const deptRow = ['제출조직(부서)', ...anonRows.map(() => '익명조직')];
        const nameRow = ['제출자이름', ...anonRows.map((_, i) => `익명응답자 ${i + 1}`)];
        const dateRow = ['제출일자', ...anonRows.map((r) => r.date || '-')];
        const contentRows = questions.map((q: any) => {
          if (q.type === 'SECTION') return [`[🔖 섹션 단락]: ${q.title}`];
          const rowData = [q.title];
          anonRows.forEach((r) => {
            rowData.push(formatAnswerForExport(r.answers?.[q.id]));
          });
          return rowData;
        });
        const ws = XLSX.utils.aoa_to_sheet([deptRow, nameRow, dateRow, ...contentRows]);
        const safeTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
        XLSX.utils.book_append_sheet(wb, ws, safeTitle);
        return;
      }
      
      const targetDepts = survey.target.split(',').map((t:string) => t.trim());
      const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
      const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
      
      if (submittedUsers.length > 0) {
        hasData = true;
        
        const deptRow = ['제출조직(부서)', ...submittedUsers.map((u) => u.dept)];
        const nameRow = ['제출자이름', ...submittedUsers.map((u) => u.name)];
        const dateRow = ['제출일자', ...submittedUsers.map(u => responses[`${survey.id}_${u.email}`]?.date || '-')];
        
        const contentRows = questions.map((q: any) => {
          if (q.type === 'SECTION') return [`[🔖 섹션 단락]: ${q.title}`];
       
          const rowData = [q.title];
          submittedUsers.forEach(u => {
            const ans = responses[`${survey.id}_${u.email}`]?.answers;
            // 🚀 [엑셀 해결]: formatAnswerForExport 헬퍼 적용
            rowData.push(ans ? formatAnswerForExport(ans[q.id]) : '(미응답)');
          });
          return rowData;
        });
      
        const ws = XLSX.utils.aoa_to_sheet([deptRow, nameRow, dateRow, ...contentRows]);
        const safeTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
        XLSX.utils.book_append_sheet(wb, ws, safeTitle);
      }
    });
      
    if (!hasData) return alert('선택한 설문에 제출된 응답이 없습니다.');
    XLSX.writeFile(wb, `[조직별_상세분석Excel]_${getKSTDateString()}.xlsx`);
  };

  const makePctBar = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    const filled = Math.round(clamped / 5);
    return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}`;
  };

  const questionTypeLabel = (type: string) => {
    if (type === 'CHOICE_SINGLE') return '단일선택';
    if (type === 'CHOICE_MULTI') return '다중선택';
    if (type === 'SCALE') return '만족도';
    if (type === 'TEXT_SHORT') return '단답형';
    if (type === 'TEXT_LONG') return '장문형';
    if (type === 'FILE') return '파일첨부';
    if (type === 'SEARCH_ADDRESS') return '주소검색';
    if (type === 'CALENDAR') return '캘린더';
    if (type === 'SECTION') return '섹션';
    return type;
  };

  /** 단일/다중/만족도 → 빈도·비율 통계 / 그 외 유형 → 안내 문구만 표기 */
  const handleExportResultAnalysis = () => {
    if (!requireEdit()) return;
    if (selectedSurveyIds.size === 0) return alert('분석할 설문을 하나 이상 선택해주세요.');
    const selectedSurveys = surveys.filter((s) => selectedSurveyIds.has(s.id));
    const wb = XLSX.utils.book_new();
    let hasData = false;
    const usedSheetNames = new Set<string>();
    const GUIDE_MSG = '선택 ZIP 또는 Excel을 다운받아 확인바랍니다.';

    const uniqueSheetName = (base: string) => {
      let name = base.replace(/[/\\?*[\]:]/g, '-').substring(0, 31);
      if (!name) name = 'Sheet';
      let candidate = name;
      let i = 2;
      while (usedSheetNames.has(candidate)) {
        const suffix = `_${i++}`;
        candidate = `${name.substring(0, 31 - suffix.length)}${suffix}`;
      }
      usedSheetNames.add(candidate);
      return candidate;
    };

    /** 문항·유형은 블록 첫 행만 표기 */
    const pushStatRows = (
      rows: (string | number)[][],
      title: string,
      typeLabel: string,
      detailRows: (string | number)[][]
    ) => {
      detailRows.forEach((cols, i) => {
        rows.push([
          i === 0 ? title : '',
          i === 0 ? typeLabel : '',
          cols[0] ?? '',
          cols[1] ?? '',
          cols[2] ?? '',
          cols[3] ?? '',
        ]);
      });
      rows.push([]);
    };

    selectedSurveys.forEach((survey) => {
      let parsedQuestions: any[] = [];
      try {
        parsedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []);
      } catch (e) {}

      const targetDepts = survey.target.split(',').map((t: string) => t.trim());
      const targetUsers = users.filter((u) => isOrgAllowed(targetDepts, u.dept));
      const submittedUsers = targetUsers.filter((u) => responses[`${survey.id}_${u.email}`]?.isDone);

      const answerSources = survey.isAnonymous
        ? listAnonymousContentRows(responses, survey.id).map((r) => ({
            date: r.date,
            answers: r.answers,
            dept: '익명조직',
            name: '',
          }))
        : submittedUsers.map((u) => ({
            date: responses[`${survey.id}_${u.email}`]?.date || '-',
            answers: responses[`${survey.id}_${u.email}`]?.answers || {},
            dept: u.dept,
            name: u.name,
          }));

      if (answerSources.length === 0) return;
      hasData = true;

      const safeTitle = String(survey.title || survey.code || '설문').replace(/[/\\?%*:|"<>]/g, '-');
      const exportQuestions = parsedQuestions.filter((q: any) => q.type !== 'SECTION');
      if (exportQuestions.length === 0) return;

      const rows: (string | number)[][] = [
        ['설문명', survey.title],
        ['응답 인원', answerSources.length],
        [],
        ['문항', '유형', '보기/점수', '응답수', '비율(%)', '그래프'],
      ];

      exportQuestions.forEach((q: any) => {
        const typeLabel = questionTypeLabel(q.type);

        if (q.type === 'CHOICE_SINGLE' || q.type === 'CHOICE_MULTI') {
          const counts: Record<string, number> = {};
          (q.options || []).forEach((opt: any) => {
            counts[String(opt.label)] = 0;
          });
          let answered = 0;
          answerSources.forEach((src) => {
            const ans = src.answers?.[q.id];
            if (ans === null || ans === undefined || ans === '') return;
            answered += 1;
            if (q.type === 'CHOICE_MULTI') {
              const list = Array.isArray(ans) ? ans : [ans];
              list.forEach((label: unknown) => {
                const key = String(label);
                counts[key] = (counts[key] || 0) + 1;
              });
            } else {
              const key = String(ans);
              counts[key] = (counts[key] || 0) + 1;
            }
          });
          const denom = answered || 1;
          const labels = Object.keys(counts).length > 0
            ? Object.keys(counts)
            : (q.options || []).map((o: any) => String(o.label));
          const detailRows: (string | number)[][] = labels.map((label: string) => {
            const count = counts[label] || 0;
            const pct = Math.round((count / denom) * 1000) / 10;
            return [label, count, pct, makePctBar(pct)];
          });
          detailRows.push(['(응답자 수)', answered, '', '']);
          pushStatRows(rows, q.title, typeLabel, detailRows);
          return;
        }

        if (q.type === 'SCALE') {
          const max = Number(q.scaleMax) || 5;
          const counts: Record<number, number> = {};
          for (let n = 1; n <= max; n++) counts[n] = 0;
          let sum = 0;
          let answered = 0;
          answerSources.forEach((src) => {
            const ans = src.answers?.[q.id];
            if (ans === null || ans === undefined || ans === '') return;
            const n = Number(ans);
            if (!Number.isFinite(n)) return;
            answered += 1;
            sum += n;
            counts[n] = (counts[n] || 0) + 1;
          });
          const detailRows: (string | number)[][] = [];
          for (let n = 1; n <= max; n++) {
            const count = counts[n] || 0;
            const pct = answered ? Math.round((count / answered) * 1000) / 10 : 0;
            detailRows.push([`${n}점`, count, pct, makePctBar(pct)]);
          }
          detailRows.push(['평균', answered ? Math.round((sum / answered) * 100) / 100 : '-', '', '']);
          detailRows.push(['(응답자 수)', answered, '', '']);
          pushStatRows(rows, q.title, typeLabel, detailRows);
          return;
        }

        // 통계 불가 유형(단답/장문/파일/주소/캘린더 등): 존재만 표기 + 원문 확인 안내
        rows.push([q.title, typeLabel, GUIDE_MSG, '', '', '']);
        rows.push([]);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 36 }, { wch: 10 }, { wch: 42 }, { wch: 10 }, { wch: 10 }, { wch: 22 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(`통계_${safeTitle}`));

      // 단답·장문은 별도 서술 시트에도 원문 제공 (선택 ZIP/Excel과 병행)
      const textQuestions = exportQuestions.filter(
        (q: any) => q.type === 'TEXT_SHORT' || q.type === 'TEXT_LONG'
      );
      if (textQuestions.length > 0) {
        const header = ['제출조직', '제출자', '제출일', ...textQuestions.map((q: any) => `[${questionTypeLabel(q.type)}] ${q.title}`)];
        const body = answerSources.map((src, i) => [
          survey.isAnonymous ? '익명조직' : src.dept,
          survey.isAnonymous ? `익명응답자 ${i + 1}` : src.name,
          src.date || '-',
          ...textQuestions.map((q: any) => formatAnswerForExport(src.answers?.[q.id])),
        ]);
        const textWs = XLSX.utils.aoa_to_sheet([header, ...body]);
        XLSX.utils.book_append_sheet(wb, textWs, uniqueSheetName(`서술_${safeTitle}`));
      }
    });

    if (!hasData) return alert('선택한 설문에 제출된 응답이 없습니다.');
    if (wb.SheetNames.length === 0) return alert('분석할 문항이 없습니다.');
    XLSX.writeFile(wb, `[결과분석]_${getKSTDateString()}.xlsx`);
  };
     
  const handleDownloadZipAll = async () => {
    if (!requireEdit()) return;
    if (selectedSurveyIds.size === 0) return alert('다운로드할 설문을 하나 이상 선택해주세요.');
    const zip = new JSZip();
    const selectedSurveys = surveys.filter(s => selectedSurveyIds.has(s.id));
    let hasData = false;
      
    selectedSurveys.forEach(survey => {
      const safeFolderTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-');
      const folder = zip.folder(safeFolderTitle); 
      
      let storedQuestions = [];
      try { 
        storedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []); 
      } catch(e) {}

      const writeOne = (identifier: string, submitterLabel: string, resp: { date?: string; answers?: any }) => {
        hasData = true;
        const fileNameBase = `${identifier}_${safeFolderTitle}`;
        let content = `■ 설문명: ${survey.title}\n■ 제출자: ${submitterLabel}\n■ 제출일: ${resp.date || '-'}\n------------------------------------------\n\n`;
        let qNum = 1;
        storedQuestions.forEach((q: any) => {
          if (q.type === 'SECTION') {
            content += `\n[🔖 섹션 단락]: ${q.title}\n------------------------------------------\n`;
          } else {
            content += `Q${qNum++}. ${q.title}\n`;
            const rawAns = resp.answers ? resp.answers[q.id] : null;
            content += `A. ${formatAnswerForExport(rawAns)}\n\n`;
            if (rawAns && typeof rawAns === 'object' && rawAns.fileName && rawAns.fileData) {
              const base64Data = rawAns.fileData.split(',')[1];
              if (base64Data) {
                folder?.file(`${identifier}_${rawAns.fileName}`, base64Data, { base64: true });
              }
            }
          }
        });
        folder?.file(`${fileNameBase}_응답요약.txt`, "\ufeff" + content);
      };

      if (survey.isAnonymous) {
        listAnonymousContentRows(responses, survey.id).forEach((resp, idx) => {
          writeOne(`익명응답자_${idx + 1}`, '익명', resp);
        });
        return;
      }

      const targetDepts = survey.target.split(',').map((t:string) => t.trim());
      const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
      
      targetUsers.forEach((user) => {
        const resp = responses[`${survey.id}_${user.email}`];
        if (resp?.isDone) {
          writeOne(`${user.dept}_${user.name}`, `${user.dept} ${user.name}`, resp);
        }
      });
    });
      
    if (!hasData) return alert('선택한 설문에 제출된 응답이 없습니다.');
    alert('데이터를 추출하고 압축 중입니다. 잠시만 기다려주세요...');
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `[통합응답결과]_${getKSTDateString()}.zip`);
  };
     
  const getStatusBadge = (status: string) => {
    switch (status) {
      case '게시전': return 'bg-slate-100 text-slate-500 border border-slate-200';
      case '게시중단': return 'bg-amber-100 text-amber-700';
      case '진행중': return 'bg-blue-100 text-blue-700';
      case '완료': return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-slate-100 text-slate-500';
    }
  };
     
  if (loading) return <LoadingState />;
     
  
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 — client-search와 동일 */}
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
            GENERAL SURVEY MANAGEMENT HUB
          </h3>
          <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
            일반조사/익명조사 통합 관리 센터
          </h1>
          <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
            일반조사/익명조사 신청 공고 및 부서별 접수 현황을 통합 모니터링합니다.
          </p>
          {permissionSummary && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
                <span>👑 Master 책임자:</span>
                <span>{permissionSummary.masterName}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
                <span>👁️ Access:</span>
                <span>{permissionSummary.accessDesignate}</span>
                <span className="opacity-50">|</span>
                <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.accessLevel}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
                <span>✍️ Edit:</span>
                <span>{permissionSummary.editDesignate}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.editLevel}</span>
              </div>
              {!canEdit && (
                <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
                  현재 계정: 조회만 가능 (편집 권한 없음)
                </span>
              )}
            </div>
          )}
        </div>
      </div>
     
      {/* 탭 네비게이션 — equipment inventory / delivery admin 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg">
          {[
            { name: '📋 현재 진행중인 조사', path: '/survey/general/admin/active-surveys', activeClass: 'bg-white text-emerald-700 shadow-sm border border-slate-200/80' },
            { name: '🗂️ 전체 조사 이력 관리', path: '/survey/general/admin/survey-history', activeClass: 'bg-white text-slate-800 shadow-sm border border-slate-200/80' },
          ].map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            return (
              <Link
                key={tab.path}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                  isActive ? tab.activeClass : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{tab.name}</span>
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
          ※ 탭을 클릭하여 진행 현황과 보관 이력을 전환합니다.
        </p>
      </div>
     
      <div className="flex gap-6 w-full">
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'ONGOING' ? 'ALL' : 'ONGOING')} className={`flex-1 p-5 rounded-3xl border transition-all flex items-center justify-between ${surveyListFilter === 'ONGOING' ? 'border-blue-400 bg-blue-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-blue-300'}`}>
          <div className="flex items-center gap-5">
            <span className="text-3xl opacity-80 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">📝</span>
            <div className="text-left">
              <p className="text-[11px] font-black text-blue-600 uppercase mb-1">진행 중인 조사</p>
              <p className="text-2xl font-black text-slate-800">{stats.activeCount} <span className="text-sm font-bold text-slate-500">건</span></p>
            </div>
          </div>
        </button>
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'CLOSING_TODAY' ? 'ALL' : 'CLOSING_TODAY')} className={`flex-1 p-5 rounded-3xl border transition-all flex items-center justify-between ${surveyListFilter === 'CLOSING_TODAY' ? 'border-red-400 bg-red-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-red-300'}`}>
          <div className="flex items-center gap-5">
            <span className="text-3xl opacity-80 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">⏰</span>
            <div className="text-left">
              <p className="text-[11px] font-black text-red-600 uppercase mb-1">오늘 마감 조사</p>
              <p className="text-2xl font-black text-slate-800">{stats.closingTodayCount} <span className="text-sm font-bold text-slate-500">건</span></p>
            </div>
          </div>
        </button>
      </div>
      
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden mt-8">
        <div className="p-4 px-6 bg-slate-900 flex justify-between items-center text-white">
          <h3 className="text-[12px] font-black flex items-center gap-2"><span>📢</span> 설문 배포 및 관리 리스트</h3>
          <button
            type="button"
            onClick={handleAddSurvey}
            className={`px-4 py-2 rounded-xl font-black text-[10px] shadow-sm transition-all ${
              canEdit ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-slate-300 text-slate-500 cursor-not-allowed'
            }`}
          >
            + 새로운 설문 작성
          </button>
        </div>
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
                <th className="py-3 px-2 w-24 text-center">기간</th>
                <th className="py-3 px-2 w-12 text-center border-l bg-slate-100/50">참여율</th>
                <th className="py-3 px-2 w-12 text-center bg-blue-50/50 text-blue-600">참여</th>
                <th className="py-3 px-2 w-[110px] text-center bg-red-50/50 text-red-600 border-r">미참여인원</th>
                <th className="py-3 px-2 w-16 text-center">상태</th>
                <th className="py-3 px-2 w-[140px] text-center border-l border-slate-200 bg-slate-100/30 text-indigo-600">게시 제어</th>
                <th className="py-3 pr-4 w-[140px] text-center bg-slate-100/30 text-slate-600">명세 관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredSurveys.map((s, idx) => {
                const targetDepts = s.target.split(',').map((t:string) => t.trim());
                const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
                const total = targetUsers.length;
                const done = s.isAnonymous
                  ? getAnonymousDoneCount(s.id, anonymousParticipationCounts, responses)
                  : targetUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                const notDone = Math.max(0, total - done);
                const rate = total > 0 ? Math.round((done/total)*100) : 0;
                
                const isTimeOver = s.status === '진행중' && isPastKSTDeadline(s.endDate, s.endTime);
                const displayStatus = isTimeOver ? '기간종료' : s.status;
      
                return (
                  <tr key={s.id} className={`transition-all h-14 ${isTimeOver ? 'bg-red-50/20 hover:bg-red-50/40' : 'hover:bg-blue-50/20'}`}>
                    <td className="py-2 pl-4 text-center text-slate-400 font-bold align-middle">{idx + 1}</td>
                    <td className="py-2 px-2 font-mono font-black text-slate-600 tracking-tighter align-middle">{s.code}</td>
                    <td className="py-2 px-2 font-black text-center text-indigo-600 text-[12px] align-middle">{s.postNumber}</td>
                    <td className="py-2 px-2 font-mono text-center text-slate-500 whitespace-nowrap align-middle">{s.postDate === '-' ? '' : s.postDate}</td>
                    
                    <td className="py-2 px-2 align-middle">
                      <button onClick={() => setPreviewModal(s)} className="font-black text-slate-800 text-[11px] hover:text-blue-600 hover:underline text-left line-clamp-1">{s.title}</button>
                    </td>
                    
                    <td className="py-2 px-2 text-center align-middle">
                      {s.isAnonymous ? (
                        <span className="px-1.5 py-0.5 bg-slate-700 text-white text-[9px] font-black rounded">익명</span>
                      ) : (
                        <span className="px-1.5 py-0.5 border border-slate-300 text-slate-500 text-[9px] font-bold rounded">기명</span>
                      )}
                    </td>
                    
                    <td className="py-2 px-2 font-bold text-slate-600 text-center align-middle">
                      <div className="text-[10px] leading-tight cursor-help truncate w-20 mx-auto" title={s.target}>
                        {s.target === '전사' ? '전사' : <span className="underline decoration-dashed decoration-slate-300">{s.target.split(',').length}개 부서 지정</span>}
                      </div>
                    </td>
                    
                    <td className="py-2 px-2 text-slate-500 tracking-tighter text-center text-[9px] whitespace-nowrap align-middle">
                      <div>{s.startDate} ~</div>
                      <div className={isTimeOver ? 'text-red-500 font-black' : ''}>
                        {s.endDate} <span className="text-[8px]">({s.endTime || '23:59'})</span>
                      </div>
                    </td>
                    
                    <td className="py-2 px-2 text-center font-black text-slate-700 border-l bg-slate-50/30 align-middle">{rate}%</td>
                    
                    <td className="py-2 px-2 text-center bg-blue-50/30 align-middle">
                      {s.isAnonymous ? (
                        <span className="text-slate-400 font-black cursor-not-allowed">{done}명 <span className="text-[8px]">🔒</span></span>
                      ) : (
                        <button onClick={() => handleMatrixFilter(s.id, 'DONE')} className="text-blue-600 font-black hover:underline relative z-10">{done}명</button>
                      )}
                    </td>
                    
                    <td className="py-2 px-2 text-center bg-red-50/30 border-r align-middle">
                      <div className="flex items-center justify-center gap-1 w-full">
                        {s.isAnonymous ? (
                          <span className="text-slate-400 font-black cursor-not-allowed">{notDone}명 <span className="text-[8px]">🔒</span></span>
                        ) : (
                          <button onClick={() => handleMatrixFilter(s.id, 'NOT_DONE')} className="text-red-500 font-black hover:underline">{notDone}명</button>
                        )}
                        
                        {s.status === '진행중' && notDone > 0 && (
                          <div className="flex gap-0.5 ml-1">
                            <button onClick={() => handleNudge(s.id)} className="px-1.5 py-0.5 bg-white border border-red-200 text-red-600 rounded text-[9px] font-black hover:bg-red-50 transition-colors shadow-sm whitespace-nowrap">🔔독촉</button>
                            <button onClick={() => handleCopyUnsubmittedEmails(s)} className={`px-1.5 py-0.5 border rounded text-[9px] font-black transition-colors shadow-sm whitespace-nowrap ${s.isAnonymous ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>📧메일추출</button>
                          </div>
                        )}
                      </div>
                    </td>
     
                    <td className="py-2 px-2 text-center align-middle">
                      <span className={`px-2 py-1 rounded font-black text-[9px] whitespace-nowrap ${isTimeOver ? 'bg-red-100 text-red-700 animate-pulse' : getStatusBadge(displayStatus)}`}>
                        {displayStatus}
                      </span>
                    </td>
                    
                    <td className="py-2 px-2 align-middle border-l border-slate-200 bg-slate-50/50">
                      <div className="flex items-center justify-center gap-1 w-full">
                        <button onClick={() => handleStatusChange(s.id, 'UP')} disabled={!canEdit || s.status === '진행중' || s.status === '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${canEdit && (s.status === '게시전' || s.status === '게시중단') ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>게시</button>
                        <button onClick={() => handleStatusChange(s.id, 'DOWN')} disabled={!canEdit || s.status !== '진행중'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${canEdit && s.status === '진행중' ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>중단</button>
                        <button onClick={() => handleStatusChange(s.id, 'FORCE_COMPLETE')} disabled={!canEdit || s.status !== '진행중'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${canEdit && s.status === '진행중' ? (isTimeOver ? 'bg-red-600 text-white border-red-600 hover:bg-red-700 animate-bounce' : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700') : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>마감</button>
                      </div>
                    </td>
     
                    <td className="py-2 pr-4 align-middle bg-slate-50/50">
                      <div className="flex items-center justify-center gap-1 w-full">
                        <button onClick={() => setEditModal(s)} disabled={s.status === '진행중' || s.status === '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all ${s.status === '게시전' || s.status === '게시중단' ? 'bg-white border border-slate-300 text-slate-700 shadow-sm hover:bg-slate-100' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-transparent'}`}>수정</button>
                        <button onClick={() => handleDeleteSurvey(s.id)} disabled={s.hasBeenPublished} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all ${!s.hasBeenPublished ? 'bg-white border border-red-200 text-red-500 shadow-sm hover:bg-red-50' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-transparent'}`}>삭제</button>
                        <button onClick={() => handleStatusChange(s.id, 'ARCHIVE')} disabled={!canEdit || s.status !== '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all ${canEdit && s.status === '완료' ? 'bg-slate-800 text-white shadow-sm hover:bg-slate-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-transparent'}`}>보관함이동</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden mt-6">
        <div className="p-4 px-6 bg-slate-900 flex justify-between items-center text-white">
          <h3 className="text-[12px] font-black flex items-center gap-2"><span>🗂️</span> 부서 및 직원별 설문 제출 결과 현황 보드</h3>
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={handleDownloadZipAll}
              className={`px-4 py-2 rounded-lg text-[10px] font-black shadow-sm transition-all flex items-center gap-1.5 ${
                canEdit ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-500 cursor-not-allowed opacity-60'
              }`}
            >
              <span>📥</span> 선택 ZIP 다운로드
            </button>
            <button
              type="button"
              onClick={handleExportAnalysisAll}
              className={`px-4 py-2 rounded-lg text-[10px] font-black shadow-sm transition-all flex items-center gap-1.5 ${
                canEdit ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-slate-500 cursor-not-allowed opacity-60'
              }`}
            >
              <span>📈</span> 선택 Excel 다운로드
            </button>
            <div className="w-px h-6 bg-white/20 mx-0.5" />
            <button
              type="button"
              onClick={handleExportResultAnalysis}
              className={`px-4 py-2 rounded-lg text-[10px] font-black shadow-sm transition-all flex items-center gap-1.5 ${
                canEdit ? 'bg-amber-500 hover:bg-amber-400 text-slate-900' : 'bg-slate-500 cursor-not-allowed opacity-60 text-white'
              }`}
              title="단일·다중·만족도 통계 + 단답·장문 응답 원문"
            >
              <span>📊</span> 결과 분석 다운로드
            </button>
          </div>
        </div>
      
        <div className="overflow-x-auto max-h-[500px] scrollbar-thin">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead className="sticky top-0 z-20 bg-white shadow-sm">
              <tr className="border-b-2 border-slate-300">
                <th className="py-2 pl-6 w-48 bg-slate-50 font-black text-slate-500 tracking-widest text-[9px] align-bottom">
                  <div className="uppercase mb-1">소속 부서 / 이름</div>
                  <div className="flex gap-2 text-[8px] text-blue-500 font-bold">
                    <button onClick={collapseAll} className="hover:underline">전체 접기</button> <span className="text-slate-300">|</span> <button onClick={expandAll} className="hover:underline">전체 펼치기</button>
                  </div>
                </th>
                {sortedSurveys.filter(s => s.status !== '보관됨').map(s => (
                  <th key={s.id} className="p-2 border-l border-slate-100 text-center min-w-[180px] bg-white align-bottom">
                    <div className="flex flex-col items-center gap-1.5">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input type="checkbox" checked={selectedSurveyIds.has(s.id)} onChange={(e) => {
                          const next = new Set(selectedSurveyIds); e.target.checked ? next.add(s.id) : next.delete(s.id); setSelectedSurveyIds(next);
                        }} className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer" />
                        <div className="text-left">
                          <span className="font-black text-slate-800 text-[10px] leading-tight group-hover:text-indigo-600 transition-colors">[{s.code}] {s.isAnonymous && <span className="text-red-500 ml-1">🔒</span>}</span>
                          <br/>
                          <span className="line-clamp-1 text-slate-500 text-[9px] group-hover:text-indigo-500 transition-colors">{s.title}</span>
                        </div>
                      </label>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(groupedUsers).map(([dept, deptUsers]) => (
                <Fragment key={dept}>
                  <tr className="bg-slate-50/80 cursor-pointer hover:bg-slate-100 border-b border-white" onClick={() => toggleDept(dept)}>
                    <td className="py-2 pl-6 font-black text-indigo-700 flex items-center gap-2 text-[11px]"><span className="text-[8px] opacity-60">{collapsedDepts.has(dept) ? '▶' : '▼'}</span>{dept} <span className="text-[9px] text-slate-400 ml-1">{deptUsers.length}명</span></td>
                    {sortedSurveys.filter(s => s.status !== '보관됨').map(s => {
                       const targetDepts = s.target.split(',').map((t:string) => t.trim());
                       if (!isOrgAllowed(targetDepts, dept)) return <td key={`ds-${s.id}`} className="py-2 border-l border-slate-200 text-center bg-slate-100/30 text-[10px] font-black text-slate-300">-</td>;
                       if (s.isAnonymous) return <td key={`ds-${s.id}`} className="py-2 border-l border-slate-200 text-center bg-slate-100/30"><span className="text-[9px] font-black text-slate-400">🔒 블랭크</span></td>;
                       
                       const dDone = deptUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                       const dTotal = deptUsers.length;
                       return <td key={`ds-${s.id}`} className="py-2 border-l border-slate-200 text-center bg-slate-100/30"><div className="text-[9px] font-bold text-slate-600"><span className="text-indigo-600 font-black">{dDone}명</span> / {dTotal}명 <span className="ml-1 text-[8px] text-slate-400">({dTotal > 0 ? Math.round((dDone/dTotal)*100) : 0}%)</span></div></td>
                    })}
                  </tr>
                  {!collapsedDepts.has(dept) && deptUsers.map(user => {
                    if (matrixUserFilter.type === 'DONE' && matrixUserFilter.surveyId && !responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
                    if (matrixUserFilter.type === 'NOT_DONE' && matrixUserFilter.surveyId && responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
      
                    return (
                      <tr key={user.id} className="hover:bg-indigo-50/30 h-8">
                        <td className="py-1.5 pl-12 font-bold text-slate-700 flex items-center gap-2 border-r border-slate-50 text-[10px]"><div className="w-1 h-1 rounded-full bg-slate-300"></div>{user.name} <span className="text-[8px] text-slate-400 font-mono">{user.email.split('@')[0]}</span></td>
                        {sortedSurveys.filter(s => s.status !== '보관됨').map(s => {
                          const targetDepts = s.target.split(',').map((t:string) => t.trim());
                          if (!isOrgAllowed(targetDepts, user.dept)) return <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center text-[10px] font-black text-slate-300">-</td>;
                          if (s.isAnonymous) return <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center bg-slate-50/50"><span className="text-[8px] font-black text-slate-300">🔒 블랭크</span></td>;
                          
                          const resp = responses[`${s.id}_${user.email}`];
                          const hasFile = resp?.answers && Object.values(resp.answers).some((a: any) => a && a.fileName);
                          
                          return (
                            <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center">
                              {resp?.isDone ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openNamedSubmissionView(s, user, resp)}
                                    className={`text-[8px] font-black px-1.5 py-0.5 rounded tracking-tight ${
                                      canEdit
                                        ? 'text-emerald-600 bg-emerald-50 hover:underline cursor-pointer'
                                        : 'text-slate-300 bg-slate-100 cursor-not-allowed'
                                    }`}
                                  >
                                    제출 <span className="opacity-60 font-mono">{resp.date}</span>
                                  </button>
                                  {hasFile && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!requireEdit()) return;
                                        const fileAns = Object.values(resp.answers || {}).find((a: any) => a && a.fileName);
                                        if (fileAns && (fileAns as any).fileData) {
                                          fetch((fileAns as any).fileData).then(r => r.blob()).then(blob => saveAs(blob, (fileAns as any).fileName));
                                        }
                                      }}
                                      className={`text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm border ${
                                        canEdit
                                          ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                                          : 'bg-slate-200 text-slate-400 border-slate-200 cursor-not-allowed'
                                      }`}
                                    >
                                      📂 파일
                                    </button>
                                  )}
                                </div>
                              ) : <span className="text-[8px] font-black text-slate-300">미진행</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {previewModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
          onMouseDown={(e) => {
            (e.currentTarget as HTMLElement).dataset.backdropDown =
              e.target === e.currentTarget ? '1' : '0';
          }}
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              (e.currentTarget as HTMLElement).dataset.backdropDown === '1'
            ) {
              setPreviewModal(null);
            }
          }}
        >
          <div
            className="bg-white w-[600px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 bg-slate-800 text-white flex justify-between"><h3 className="font-black text-sm">설문 상세 편집 및 배포</h3><button onClick={() => setPreviewModal(null)} className="text-xl">✕</button></div>
            <div className="p-6 space-y-5 bg-slate-50 flex-1">
              <div><label className="text-[10px] font-black text-slate-500">설문 제목</label><input type="text" value={previewModal.title} onChange={e => setPreviewModal({...previewModal, title: e.target.value})} className="w-full p-2 border rounded text-xs font-black outline-none focus:border-indigo-500" /></div>
              <div><label className="text-[10px] font-black text-slate-500">인사말 및 설명</label><textarea value={previewModal.description} onChange={e => setPreviewModal({...previewModal, description: e.target.value})} className="w-full p-2 border rounded text-xs outline-none focus:border-indigo-500 min-h-[80px]" /></div>
              
              <button onClick={handleSavePreview} className="w-full py-3 bg-slate-900 text-white rounded-xl text-xs font-black shadow-md hover:bg-black transition-all">💾 기본 정보 저장하기</button>
     
              <div className="text-center p-5 border-2 border-dashed border-indigo-200 bg-indigo-50 rounded-xl">
                <Link href={`/survey/general/admin/survey-builder?id=${previewModal.id}`} className="px-5 py-3 bg-indigo-600 text-white rounded-xl text-[11px] font-black shadow-md hover:bg-indigo-700 block w-fit mx-auto">🛠️ 설문지 생성기(Builder) 열기</Link>
                <p className="text-[10px] text-indigo-500 font-bold mt-3">Builder에서 구체적인 질문 문항을 구성할 수 있습니다.</p>
              </div>
     
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <label className="text-[10px] font-black text-slate-500 block mb-2">🔗 모바일/웹 배포 링크 (사내망)</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="text" 
                    readOnly 
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/survey/public/${previewModal.id}?domain=general`} 
                    className="flex-1 p-2 bg-slate-100 rounded border border-slate-200 text-xs font-mono text-slate-500 outline-none"
                  />
                  <button 
                    onClick={() => {
                      const link = `${window.location.origin}/survey/public/${previewModal.id}?domain=general`;
                      navigator.clipboard.writeText(link);
                      alert('배포 링크가 클립보드에 복사되었습니다!\n게시판이나 메신저에 붙여넣기 하세요.\n\n⚠ 사내 LAN 및 Wi-Fi에서만 접속 가능합니다. (외부망·LTE 불가)');
                    }}
                    className="px-4 py-2 bg-slate-800 text-white rounded text-[11px] font-black hover:bg-black transition-colors shrink-0"
                  >
                    링크 복사
                  </button>
                </div>
                <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3 text-center">
                  <p className="text-[11px] font-black text-amber-800">📡 배포 링크 안내</p>
                  <p className="text-[10px] font-bold text-amber-700 mt-0.5 leading-relaxed">
                    참여 시 <span className="underline decoration-2">이메일 + Hub 비밀번호 또는 사번</span>으로
                    본인 인증합니다.
                    <br />
                    <span className="font-black">⚠ 반드시 사내 LAN 및 Wi-Fi 연결 후 접속하세요.</span>
                    <br />
                    (외부망·LTE에서는 접속되지 않습니다)
                  </p>
                </div>
              </div>
     
            </div>
            <div className="p-4 bg-white flex gap-2"><button onClick={() => setPreviewModal(null)} className="w-full py-2.5 border rounded-xl text-xs font-black text-slate-500">닫기</button></div>
          </div>
        </div>
      )}
      
      {editModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
          onMouseDown={(e) => {
            (e.currentTarget as HTMLElement).dataset.backdropDown =
              e.target === e.currentTarget ? '1' : '0';
          }}
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              (e.currentTarget as HTMLElement).dataset.backdropDown === '1'
            ) {
              setEditModal(null);
            }
          }}
        >
          <div
            className="bg-white w-[500px] rounded-[2rem] overflow-hidden shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 bg-slate-900 text-white flex justify-between items-center"><h3 className="font-black text-sm">설문 기본 정보 {editModal.id.startsWith('S_') ? '추가' : '수정'}</h3><button onClick={() => setEditModal(null)} className="text-lg">✕</button></div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 bg-slate-50 max-h-[85vh] overflow-y-auto">
              
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">식별코드</label>
                  <input type="text" value={editModal.code} onChange={e => setEditModal({...editModal, code: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-indigo-500 mb-1 block">게시번호 (순서)</label>
                  <input type="number" value={editModal.postNumber} onChange={e => setEditModal({...editModal, postNumber: Number(e.target.value)})} className="w-full p-2 rounded-lg border text-[11px] font-black outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">게시일</label>
                  <input type="date" value={editModal.postDate === '-' ? todayStr : editModal.postDate} onChange={e => setEditModal({...editModal, postDate: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500" />
                </div>
              </div>
              
              <div>
                <label className="text-[9px] font-black text-slate-500 mb-1 block">게시명 (설문 제목)</label>
                <input type="text" required value={editModal.title} onChange={e => setEditModal({...editModal, title: e.target.value})} className="w-full p-2.5 rounded-lg border text-xs font-black outline-none focus:border-indigo-500" />
              </div>
  
              <div>
                <label className="text-[9px] font-black text-slate-500 mb-1 block">상세 설명 (Description)</label>
                <textarea required value={editModal.description || ''} onChange={e => setEditModal({...editModal, description: e.target.value})} className="w-full p-2 rounded-lg border text-xs font-medium outline-none focus:border-indigo-500 min-h-[60px]" placeholder="설문 목적, 주의사항 등을 기재해주세요." />
              </div>
              
              <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-3 mt-1">
                <div>
                  <label className="text-[9px] font-black text-indigo-500 mb-1 block">설문 익명 여부</label>
                  <select 
                    value={editModal.isAnonymous ? 'true' : 'false'} 
                    onChange={e => setEditModal({...editModal, isAnonymous: e.target.value === 'true'})} 
                    className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="false">기명 설문 (참여자 식별)</option>
                    <option value="true">익명 설문 (참여자 블라인드)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">대상 범위 부서 지정</label>
                  <select 
                    value={editModal.target === '전사' ? '전사' : '특정'} 
                    onChange={(e) => { 
                      if(e.target.value === '전사') setEditModal({...editModal, target: '전사'}); 
                      else setEditModal({...editModal, target: deptList.filter(d => d !== 'kpcqa')[0] || deptList[0] || ''}); 
                    }} 
                    className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500 bg-white"
                  >
                    <option value="전사">전사 임직원</option>
                    <option value="특정">특정 부서 한정</option>
                  </select>
                  
                  {editModal.target !== '전사' && (
                    <div className="border bg-white rounded-lg p-2 max-h-24 overflow-y-auto mt-2">
                      {deptList.filter(d => d !== 'kpcqa').map(d => (
                        <label key={d} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-50">
                          <input type="checkbox" checked={editModal.target.includes(d)} onChange={() => toggleTarget(d)} className="accent-indigo-600"/>
                          <span className="text-[10px] font-bold">{d}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
      
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">운영 시작일</label>
                  <input type="date" required value={editModal.startDate} onChange={e => setEditModal({...editModal, startDate: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-red-500 mb-1 block">운영 종료일</label>
                  <input type="date" required value={editModal.endDate} onChange={e => setEditModal({...editModal, endDate: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-red-500" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-red-500 mb-1 block">마감 시간</label>
                  <input type="time" required value={editModal.endTime || '23:59'} onChange={e => setEditModal({...editModal, endTime: e.target.value})} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-red-500" />
                </div>
              </div>
              
              <div className="pt-4 flex gap-2 mt-2 border-t border-slate-200">
                <button type="button" onClick={() => setEditModal(null)} className="flex-1 py-2.5 bg-white border rounded-xl font-black text-slate-600 hover:bg-slate-50">취소</button>
                <button type="submit" className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-black shadow-md hover:bg-indigo-700">정보 저장하기</button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {nudgeModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4"
          onMouseDown={(e) => {
            (e.currentTarget as HTMLElement).dataset.backdropDown =
              e.target === e.currentTarget ? '1' : '0';
          }}
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              (e.currentTarget as HTMLElement).dataset.backdropDown === '1'
            ) {
              setNudgeModal(null);
            }
          }}
        >
          <div
            className="bg-white w-[400px] rounded-[2rem] overflow-hidden shadow-2xl p-8 border text-center"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center items-center mb-4 text-4xl">🔔</div>
            <h3 className="font-black text-lg text-slate-800 mb-2">미참여 인원 독촉 알림</h3>
            <p className="text-xs text-slate-500 font-bold mb-6 leading-relaxed">
              <span className="text-indigo-600 font-black">[{nudgeModal.title}]</span> 설문에<br/>
              참여하지 않은 <span className="text-red-500 font-black">{nudgeModal.count}명</span>의 사용자에게<br/>
              나의 제출(My Dashboard) 알람 팝업을 띄우시겠습니까?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setNudgeModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-xs hover:bg-slate-200 transition-colors">취소</button>
              <button 
                onClick={async () => {
                  try {
                    const res = await fetch('/api/survey/general', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        action: 'NUDGE', 
                        surveyId: nudgeModal.surveyId,
                        // 익명: 서버가 미참여자 산출 (클라이언트에 실이메일 미전달)
                        ...(nudgeModal.resolveOnServer
                          ? { resolveUnsubmittedOnServer: true }
                          : { targetEmails: nudgeModal.targetEmails }),
                        menuPath: pathname,
                      })
                    });
                    if (res.ok) {
                      const saved = await res.json();
                      const nudgedCount = typeof saved.nudgedCount === 'number' ? saved.nudgedCount : nudgeModal.count;
                      alert(`✅ ${nudgedCount}명의 미참여자 화면에 독촉 알람이 성공적으로 발송(서버 기록)되었습니다.`);
                      
                      setSurveys(prev => prev.map(s => s.id === nudgeModal.surveyId ? { 
                        ...s, 
                        nudgedUsers: Array.isArray(saved.nudgedUsers)
                          ? saved.nudgedUsers
                          : Array.from(new Set([...(s.nudgedUsers || []), ...(nudgeModal.targetEmails || [])]))
                      } : s));
                      
                      setNudgeModal(null);
                    } else {
                      const errData = await res.json();
                      alert(`❌ 독촉 실패: ${errData.error || '알 수 없는 오류'}`);
                    }
                  } catch (e) {
                    alert('네트워크 오류가 발생했습니다.');
                  }
                }} 
                className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-black text-xs shadow-md hover:bg-indigo-700 transition-colors"
              >
                🚀 독촉 팝업 발송하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}