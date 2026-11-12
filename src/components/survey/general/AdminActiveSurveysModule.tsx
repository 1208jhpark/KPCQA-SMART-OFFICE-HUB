'use client';

import { isSystemLv1User } from '@/lib/permission-utils';
     
import React, { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation'; // 🚀 안 쓰는 useRouter 제거
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getKSTDateString, isPastKSTDeadline } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import DeptAssigneeLine, { useDeptAssignees } from '@/components/common/DeptAssigneeLine';
import {
  normalizeGeneralResponsesPayload,
  buildAdminResponseMap,
  listAnonymousContentRows,
  getAnonymousDoneCount,
} from '@/utils/surveyGeneralResponses';
import {
  useInterfaceStepTabs,
  SURVEY_GENERAL_ADMIN_TABS,
} from '@/lib/interface-step-tabs';
import { userInSurveyTarget } from '@/lib/survey-target-match';
import { nextSurveyCode } from '@/lib/survey-code';
import {
  downloadExcelArrayBuffer,
  makeSurveyPctBar,
  surveyQuestionTypeLabel,
  writeSurveyResponseExcelBuffer,
  writeSurveyResultAnalysisExcelBuffer,
  type SurveyExcelAnswerSource,
  type SurveyExcelQuestion,
  type SurveyStatBlock,
} from '@/lib/survey-general-active-excel';
     
export default function ActiveSurveysAdminPage() {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(SURVEY_GENERAL_ADMIN_TABS, '/survey/general/admin');
  const { editorNames } = useDeptAssignees(pathname || '/survey/general/admin/active-surveys');
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [deptList, setDeptList] = useState<string[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [anonymousParticipationCounts, setAnonymousParticipationCounts] = useState<Record<string, number>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
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
  const collapseSeededRef = useRef(false);
  const [selectedSurveyIds, setSelectedSurveyIds] = useState<Set<string>>(new Set());
  
  const [previewModal, setPreviewModal] = useState<any | null>(null);
  /** create → detail 은 같은 팝업에서 높이만 확장 */
  const [metaModalPhase, setMetaModalPhase] = useState<'create' | 'detail'>('detail');
  const [publishConfirmModal, setPublishConfirmModal] = useState<{
    id: string;
    title: string;
    code: string;
    startDate: string;
    endDate: string;
    endTime: string;
    fromStatus?: string;
  } | null>(null);
  const [nudgeModal, setNudgeModal] = useState<{
    surveyId: string;
    title: string;
    count: number;
    targetEmails: string[];
    resolveOnServer?: boolean;
  } | null>(null);
  const [actionMenu, setActionMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
     
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
        try {
          const meRes = await fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' });
          setCurrentUser(meRes.ok ? await meRes.json() : null);
        } catch {
          setCurrentUser(null);
        }

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

  // 기간종료된 진행중 → 서버 자동 내리기 반영 (현황판 열린 동안)
  useEffect(() => {
    const syncExpired = async () => {
      const hasExpired = surveys.some(
        (s) => s.status === '진행중' && isPastKSTDeadline(s.endDate, s.endTime)
      );
      if (!hasExpired) return;
      try {
        const res = await fetch(`/api/survey/general?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setSurveys(data);
        }
      } catch {
        /* ignore */
      }
    };
    void syncExpired();
    const timer = window.setInterval(() => void syncExpired(), 30000);
    return () => window.clearInterval(timer);
  }, [surveys]);

  useEffect(() => {
    if (!actionMenu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (actionMenuRef.current?.contains(t)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-action-kebab]')) return;
      setActionMenu(null);
    };
    const onWin = () => setActionMenu(null);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onWin, true);
    window.addEventListener('resize', onWin);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onWin, true);
      window.removeEventListener('resize', onWin);
    };
  }, [actionMenu]);

  const openActionMenu = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    const width = 168;
    const r = e.currentTarget.getBoundingClientRect();
    setActionMenu((prev) =>
      prev?.id === id
        ? null
        : {
            id,
            top: r.bottom + 4,
            left: Math.min(Math.max(12, r.right - width), window.innerWidth - width - 12),
          }
    );
  };
     
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
     
  /** 식별코드(SRV-YYMMDD-순번) 기준 정렬 — 게시번호 순서 UI는 폐기 */
  const sortedSurveys = useMemo(
    () =>
      [...surveys].sort((a, b) =>
        String(a.code || '').localeCompare(String(b.code || ''), 'ko', { numeric: true })
      ),
    [surveys]
  );
  
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

  /** admin/units 와 동일 — unitsList(sort_order asc) 순으로 부서 나열 */
  const orderedDeptEntries = useMemo(() => {
    const orderIndex = new Map<string, number>();
    unitsList.forEach((u: any, idx: number) => {
      const name = String(u.unit_name || '').trim();
      if (name && !orderIndex.has(name)) orderIndex.set(name, idx);
    });
    return Object.entries(groupedUsers).sort(([a], [b]) => {
      const ai = orderIndex.has(a) ? orderIndex.get(a)! : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b) ? orderIndex.get(b)! : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b, 'ko');
    });
  }, [groupedUsers, unitsList]);
     
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

  // 응답 보드 기본: 전체 접기
  useEffect(() => {
    const keys = Object.keys(groupedUsers);
    if (keys.length === 0 || collapseSeededRef.current) return;
    setCollapsedDepts(new Set(keys));
    collapseSeededRef.current = true;
  }, [groupedUsers]);
     
  const isOrgAllowed = (
    targetDepts: string[],
    userOrDept: string | { dept?: string; unit_id?: string | null },
    opts?: { targetUnitIds?: unknown }
  ) => {
    const userDeptName =
      typeof userOrDept === 'string' ? userOrDept : String(userOrDept?.dept || '');
    const userUnitId =
      typeof userOrDept === 'string'
        ? String(unitsList.find((u: any) => u.unit_name === userOrDept)?.id || '').trim() || null
        : userOrDept?.unit_id;
    return userInSurveyTarget({
      userUnitId,
      userDeptName,
      target: targetDepts.join(', '),
      targetUnitIds: opts?.targetUnitIds,
      units: unitsList,
    });
  };
  
  const handleCopyUnsubmittedEmails = (survey: any) => {
    if (survey.isAnonymous) {
      return alert("❌ 익명 게시의 경우 메일 추출이 불가하며, 독촉 알림만 발송 가능합니다.");
    }
    
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    const targetUsers = users.filter((u) =>
      isOrgAllowed(targetDepts, u, { targetUnitIds: survey.target_unit_ids })
    );
    const unsubmitted = targetUsers.filter(u => !responses[`${survey.id}_${u.email}`]?.isDone);
    
    if (unsubmitted.length === 0) return alert('현재 미참여자가 없습니다.');
    const emails = unsubmitted.map(u => u.email).join(', ');
    navigator.clipboard.writeText(emails);
    alert(`미참여자 ${unsubmitted.length}명의 이메일이 클립보드에 복사되었습니다.\n(메일 클라이언트의 '받는 사람' 란에 바로 붙여넣기 하세요.)`);
  };
     
  const applyTargetToggle = (current: any, dept: string) => {
    const currentTargets = String(current?.target || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    let nextTargets = new Set(currentTargets);
    if (dept === '전사') nextTargets = new Set(['전사']);
    else {
      nextTargets.delete('전사');
      nextTargets.has(dept) ? nextTargets.delete(dept) : nextTargets.add(dept);
      if (nextTargets.size === 0) nextTargets.add('전사');
    }
    const nextArr = Array.from(nextTargets);
    const target_unit_ids = nextArr.includes('전사')
      ? []
      : nextArr
          .map((n) => String(unitsList.find((u: any) => u.unit_name === n)?.id || '').trim())
          .filter(Boolean);
    return {
      ...current,
      target: nextArr.join(', '),
      target_unit_ids,
    };
  };

  const togglePreviewTarget = (dept: string) => {
    if (!previewModal || !canEdit) return;
    if (metaModalPhase !== 'create' && previewModal.status === '진행중') return;
    setPreviewModal(applyTargetToggle(previewModal, dept));
  };

  const handleSavePreviewGuarded = async () => {
    if (metaModalPhase !== 'create' && previewModal?.status === '진행중') {
      alert('진행 중에는 기본 정보를 수정할 수 없습니다.\n게시 내리기 후 수정해 주세요.');
      return;
    }
    await handleSavePreview();
  };
     
  const handleAddSurvey = () => {
    if (!requireEdit()) return;
    const nextPostNumber = surveys.length > 0 ? Math.max(...surveys.map(s => s.postNumber)) + 1 : 101;
    setMetaModalPhase('create');
    setPreviewModal({ 
      id: `S_${Date.now()}`, 
      code: nextSurveyCode(
        'SRV',
        surveys.map((s) => s.code)
      ), 
      postNumber: nextPostNumber, 
      title: '새로운 설문', 
      description: '', 
      type: '선택형', 
      isAnonymous: false,
      target: '전사',
      target_unit_ids: [],
      postDate: '-', // 게시 확정 시에만 기록
      startDate: todayStr, 
      endDate: todayStr,
      endTime: '23:59',
      status: '게시전',
      hasBeenPublished: false
    });
  };
     
  const handleDeleteSurvey = async (id: string) => {
    if (!requireEdit()) return;
    if (!confirm('이 설문을 삭제하시겠습니까?\n(복구 불가)')) return;
    try {
      const qs = new URLSearchParams({ id, menuPath: pathname || '' });
      const res = await fetch(`/api/survey/general?${qs.toString()}`, { method: 'DELETE' });
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
    // 중단(DOWN)만 Edit 없이 Access로 긴급 허용
    if (action !== 'DOWN' && !requireEdit()) return;
    const currentSurvey = surveys.find(s => s.id === id);
    if (!currentSurvey) return;

    if (action === 'DOWN') {
      try {
        const res = await fetch('/api/survey/general', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'PAUSE', id, menuPath: pathname }),
        });
        if (res.ok) {
          const savedNode = await res.json();
          setSurveys(prev => prev.map(s => s.id === id ? savedNode : s));
        } else {
          const errData = await res.json().catch(() => ({}));
          alert(`❌ 중단 실패: ${errData.error || '알 수 없는 오류'}`);
        }
      } catch {
        alert('상태 변경 동기화에 실패했습니다 (네트워크 오류).');
      }
      return;
    }
     
    if (action === 'UP') {
      setPublishConfirmModal({
        id: currentSurvey.id,
        title: currentSurvey.title || '',
        code: currentSurvey.code || '',
        startDate: currentSurvey.startDate || todayStr,
        endDate: currentSurvey.endDate || todayStr,
        endTime: currentSurvey.endTime || '23:59',
        fromStatus: currentSurvey.status,
      });
      return;
    }

    let finalPayload: any = { ...currentSurvey, menuPath: pathname };
    if (action === 'FORCE_COMPLETE') {
      if (currentSurvey.status !== '게시중단' && currentSurvey.status !== '기간종료') {
        alert('종료처리는 게시를 내린 후(게시중단/기간종료)에만 가능합니다.');
        return;
      }
      if(!confirm("이 설문을 종료처리(완료) 하시겠습니까?")) return;
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

  const handleConfirmPublish = async () => {
    if (!requireEdit() || !publishConfirmModal) return;
    const currentSurvey = surveys.find((s) => s.id === publishConfirmModal.id);
    if (!currentSurvey) return;
    if (!publishConfirmModal.startDate || !publishConfirmModal.endDate || !publishConfirmModal.endTime) {
      alert('운영 기간과 마감 시간을 모두 입력해 주세요.');
      return;
    }
    if (publishConfirmModal.endDate < publishConfirmModal.startDate) {
      alert('운영 종료일은 시작일 이후여야 합니다.');
      return;
    }
    if (isPastKSTDeadline(publishConfirmModal.endDate, publishConfirmModal.endTime)) {
      alert(
        '운영 종료 시각이 이미 지났습니다.\n운영 종료일·마감 시간을 다시 설정한 뒤 게시해 주세요.'
      );
      return;
    }

    const finalPayload = {
      ...currentSurvey,
      menuPath: pathname,
      status: '진행중',
      postDate: todayStr,
      startDate: publishConfirmModal.startDate,
      endDate: publishConfirmModal.endDate,
      endTime: publishConfirmModal.endTime,
      hasBeenPublished: true,
    };

    try {
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
      });
      if (res.ok) {
        const savedNode = await res.json();
        setSurveys((prev) => prev.map((s) => (s.id === publishConfirmModal.id ? savedNode : s)));
        setPublishConfirmModal(null);
        alert('✅ 게시가 확정되어 설문 배포·관리 목록에 반영되었습니다.');
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`❌ 게시 실패: ${errData.error || '알 수 없는 오류'}`);
      }
    } catch {
      alert('상태 변경 동기화에 실패했습니다 (네트워크 오류).');
    }
  };
     
  const handleNudge = (surveyId: string) => {
    if (!requireEdit()) return;
    const survey = surveys.find(s => s.id === surveyId);
    if (!survey) return;
    const targetDepts = survey.target.split(',').map((t:string) => t.trim());
    const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u, { targetUnitIds: survey.target_unit_ids }));
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
    if (!requireEdit() || !previewModal) return;
    if (metaModalPhase !== 'create' && previewModal.status === '진행중') {
      alert('진행 중에는 기본 정보를 수정할 수 없습니다.\n게시 내리기 후 수정해 주세요.');
      return;
    }
    if (!String(previewModal.title || '').trim() || !String(previewModal.description || '').trim()) {
      alert('제목과 설명을 입력해 주세요.');
      return;
    }
    if (!previewModal.startDate || !previewModal.endDate || !previewModal.endTime) {
      alert('운영 기간과 마감 시간을 모두 입력해 주세요.');
      return;
    }

    const wasCreate = metaModalPhase === 'create' || String(previewModal.id || '').startsWith('S_');
    const finalPayload = {
      ...previewModal,
      menuPath: pathname,
      postDate: previewModal.hasBeenPublished ? previewModal.postDate : '-',
      endTime: previewModal.endTime || '23:59',
    };

    try {
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
      });
      if (res.ok) {
        const savedData = await res.json();
        setSurveys((prev) => {
          const exists = prev.find((s) => s.id === savedData.id || s.id === previewModal.id);
          if (exists) {
            return prev.map((s) => (s.id === savedData.id || s.id === previewModal.id ? savedData : s));
          }
          return [...prev, savedData];
        });
        // 같은 팝업 유지 · create면 detail로 확장
        setPreviewModal(savedData);
        if (wasCreate) {
          setMetaModalPhase('detail');
        } else {
          alert('✅ 기본 정보가 수정되었습니다.');
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`❌ 저장 실패: ${errData.error || '알 수 없는 오류'}`);
      }
    } catch {
      alert('네트워크 인터페이스 오류입니다.');
    }
  };
     
  const handleMatrixFilter = (surveyId: string, type: 'DONE' | 'NOT_DONE') => {
    setMatrixUserFilter({ surveyId, type });
    setCollapsedDepts(new Set()); 
  };
     
  const collectSurveyAnswerSources = (survey: any): SurveyExcelAnswerSource[] => {
    if (survey.isAnonymous) {
      return listAnonymousContentRows(responses, survey.id).map((r, i) => ({
        dept: '익명조직',
        name: `익명응답자 ${i + 1}`,
        date: r.date || '-',
        answers: (r.answers || {}) as Record<string, unknown>,
      }));
    }
    const targetDepts = String(survey.target || '')
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean);
    const targetUsers = users.filter((u) =>
      isOrgAllowed(targetDepts, u, { targetUnitIds: survey.target_unit_ids })
    );
    return targetUsers
      .filter((u) => responses[`${survey.id}_${u.email}`]?.isDone)
      .map((u) => ({
        dept: u.dept || '-',
        name: u.name || '-',
        date: responses[`${survey.id}_${u.email}`]?.date || '-',
        answers: (responses[`${survey.id}_${u.email}`]?.answers || {}) as Record<string, unknown>,
      }));
  };

  /** 선택 Excel — 명함 발주서와 같은 그룹행·3톤 스타일 */
  const handleExportAnalysisAll = async () => {
    if (!requireEdit()) return;
    if (selectedSurveyIds.size === 0) return alert('분석할 설문을 하나 이상 선택해주세요.');
    const selectedSurveys = surveys.filter((s) => selectedSurveyIds.has(s.id));
    const sheets: Array<{
      title: string;
      questions: SurveyExcelQuestion[];
      sources: SurveyExcelAnswerSource[];
    }> = [];

    selectedSurveys.forEach((survey) => {
      let parsedQuestions: any[] = [];
      try {
        parsedQuestions =
          typeof survey.questions === 'string' ? JSON.parse(survey.questions) : survey.questions || [];
      } catch (e) {}
      const questions = (
        parsedQuestions.length > 0
          ? parsedQuestions
          : [{ id: 'q1', title: '1. 의견 및 건의사항', type: 'TEXT_LONG' }]
      ).filter((q: any) => q && q.type !== 'SECTION') as SurveyExcelQuestion[];
      const sources = collectSurveyAnswerSources(survey);
      if (sources.length === 0) return;
      sheets.push({
        title: String(survey.title || survey.code || '설문'),
        questions,
        sources,
      });
    });

    if (sheets.length === 0) return alert('선택한 설문에 제출된 응답이 없습니다.');
    try {
      const buffer = await writeSurveyResponseExcelBuffer(sheets);
      downloadExcelArrayBuffer(buffer, `설문개별응답_${getKSTDateString()}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };

  /** 결과 분석 — 명함 스타일 + 문항 블록(NO/문항 1회) + 그래프 + 응답수 행 강조 */
  const handleExportResultAnalysis = async () => {
    if (!requireEdit()) return;
    if (selectedSurveyIds.size === 0) return alert('분석할 설문을 하나 이상 선택해주세요.');
    const selectedSurveys = surveys.filter((s) => selectedSurveyIds.has(s.id));
    const GUIDE_MSG = '선택 ZIP 또는 Excel을 다운받아 확인바랍니다.';
    let hasResponse = false;
    const packs: Array<{
      title: string;
      responseCount: number;
      blocks: SurveyStatBlock[];
      textQuestions: SurveyExcelQuestion[];
      sources: SurveyExcelAnswerSource[];
    }> = [];

    selectedSurveys.forEach((survey) => {
      let parsedQuestions: any[] = [];
      try {
        parsedQuestions =
          typeof survey.questions === 'string' ? JSON.parse(survey.questions) : survey.questions || [];
      } catch (e) {}

      const answerSources = collectSurveyAnswerSources(survey);
      if (answerSources.length === 0) return;
      hasResponse = true;

      const exportQuestions = parsedQuestions.filter((q: any) => {
        if (!q || q.type === 'SECTION') return false;
        if (typeof q.allowAnalysis === 'boolean') return q.allowAnalysis;
        return q.type === 'CHOICE_SINGLE' || q.type === 'CHOICE_MULTI' || q.type === 'SCALE';
      });
      if (exportQuestions.length === 0) return;

      const blocks: SurveyStatBlock[] = [];
      exportQuestions.forEach((q: any, qIdx: number) => {
        const typeLabel = surveyQuestionTypeLabel(q.type);
        const qTitle = String(q.title || '').trim() || '(제목 없음)';
        const questionNo = qIdx + 1;

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
          const labels =
            Object.keys(counts).length > 0
              ? Object.keys(counts)
              : (q.options || []).map((o: any) => String(o.label));
          const lines = labels.map((label: string) => {
            const count = counts[label] || 0;
            const pct = Math.round((count / denom) * 1000) / 10;
            return {
              option: label,
              count,
              pct,
              graph: makeSurveyPctBar(pct),
              kind: 'option' as const,
            };
          });
          lines.push({
            option: '(응답자 수)',
            count: answered,
            pct: '-',
            graph: '',
            kind: 'summary',
          });
          blocks.push({ questionNo, question: qTitle, typeLabel, lines });
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
          const lines: SurveyStatBlock['lines'] = [];
          for (let n = 1; n <= max; n++) {
            const count = counts[n] || 0;
            const pct = answered ? Math.round((count / answered) * 1000) / 10 : 0;
            lines.push({
              option: `${n}점`,
              count,
              pct,
              graph: makeSurveyPctBar(pct),
              kind: 'option',
            });
          }
          lines.push({
            option: '평균',
            count: answered ? Math.round((sum / answered) * 100) / 100 : '-',
            pct: '-',
            graph: '',
            kind: 'average',
          });
          lines.push({
            option: '(응답자 수)',
            count: answered,
            pct: '-',
            graph: '',
            kind: 'summary',
          });
          blocks.push({ questionNo, question: qTitle, typeLabel, lines });
          return;
        }

        blocks.push({
          questionNo,
          question: qTitle,
          typeLabel,
          lines: [
            {
              option: GUIDE_MSG,
              count: '-',
              pct: '-',
              graph: '',
              kind: 'guide',
            },
          ],
        });
      });

      packs.push({
        title: String(survey.title || survey.code || '설문'),
        responseCount: answerSources.length,
        blocks,
        textQuestions: exportQuestions.filter(
          (q: any) => q.type === 'TEXT_SHORT' || q.type === 'TEXT_LONG'
        ) as SurveyExcelQuestion[],
        sources: answerSources,
      });
    });

    if (!hasResponse) return alert('선택한 설문에 제출된 응답이 없습니다.');
    if (packs.length === 0) {
      return alert('분석 허용된 문항이 없습니다.\n빌더에서 문항별 「분석 허용」을 켠 뒤 다시 시도해주세요.');
    }
    try {
      const buffer = await writeSurveyResultAnalysisExcelBuffer(packs);
      downloadExcelArrayBuffer(buffer, `설문결과분석_${getKSTDateString()}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
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
      const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u, { targetUnitIds: survey.target_unit_ids }));
      
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
      case '기간종료': return 'bg-red-100 text-red-700';
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
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-emerald-400 mb-2.5">
            GENERAL SURVEY MANAGEMENT HUB
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-white font-medium">일반조사/익명조사 통합 관리 센터</span>
          </h1>
          <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
            일반조사/익명조사 신청 공고 및 부서별 접수 현황을 통합 모니터링합니다.
          </p>
          {permissionSummary && isSystemLv1User(currentUser) && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
                <span>👑 Master 책임자:</span>
                <span>{permissionSummary.masterName}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
                <span>👁️ Access:</span>
                <span>{permissionSummary.accessDesignate}</span>
                <span className="opacity-50">|</span>
                <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.accessLevel}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
                <span>✍️ Edit:</span>
                <span>{permissionSummary.editDesignate}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.editLevel}</span>
              </div>
            </div>
          )}
        </div>
      </div>
     
      {/* 탭 네비게이션 — equipment inventory / delivery admin 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            return (
              <Link
                key={tab.id}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${
                  isActive ? tab.activeClass : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-medium px-3 hidden sm:block">
          ※ 탭을 클릭하여 진행 현황과 보관 이력을 전환합니다.
        </p>
      </div>
     
      <div className="flex gap-6 w-full">
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'ONGOING' ? 'ALL' : 'ONGOING')} className={`flex-1 p-5 rounded-3xl border transition-all flex items-center justify-between ${surveyListFilter === 'ONGOING' ? 'border-blue-400 bg-blue-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-blue-300'}`}>
          <div className="flex items-center gap-5">
            <span className="text-3xl opacity-80 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">📝</span>
            <div className="text-left">
              <p className="text-[11px] font-medium text-blue-600 uppercase mb-1">진행 중인 조사</p>
              <p className="text-2xl font-medium text-slate-800">{stats.activeCount} <span className="text-sm font-medium text-slate-500">건</span></p>
            </div>
          </div>
        </button>
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'CLOSING_TODAY' ? 'ALL' : 'CLOSING_TODAY')} className={`flex-1 p-5 rounded-3xl border transition-all flex items-center justify-between ${surveyListFilter === 'CLOSING_TODAY' ? 'border-red-400 bg-red-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-red-300'}`}>
          <div className="flex items-center gap-5">
            <span className="text-3xl opacity-80 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">⏰</span>
            <div className="text-left">
              <p className="text-[11px] font-medium text-red-600 uppercase mb-1">오늘 마감 조사</p>
              <p className="text-2xl font-medium text-slate-800">{stats.closingTodayCount} <span className="text-sm font-medium text-slate-500">건</span></p>
            </div>
          </div>
        </button>
      </div>
      
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden mt-8">
        <div className="p-4 px-6 bg-gradient-to-r from-blue-700 to-indigo-800 border-b border-blue-800/60 flex justify-between items-center text-white gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h3 className="text-[12px] font-medium flex items-center gap-2">
              <span className="text-sky-300">●</span> 설문 배포 및 관리 리스트
            </h3>
            <DeptAssigneeLine editorNames={editorNames} onColor label="담당자" popupLabel="부서 편집 담당자" />
          </div>
          <button
            type="button"
            onClick={handleAddSurvey}
            className={`px-4 py-2 rounded-xl font-medium text-[10px] shadow-sm transition-all shrink-0 ${
              canEdit
                ? 'bg-white/15 text-white border border-white/25 hover:bg-white/25'
                : 'bg-slate-300 text-slate-500 cursor-not-allowed'
            }`}
          >
            + 새로운 조사 목록 생성(Edit)
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-medium min-w-[1400px]">
            <thead className="bg-slate-50 text-[10px] text-slate-500 font-medium border-b border-slate-200 tracking-tight uppercase">
              <tr>
                <th className="py-3 pl-4 w-10 text-center">NO</th>
                <th className="py-3 px-2 w-28">식별코드</th>
                <th className="py-3 px-2 w-20 text-center">게시일</th>
                <th className="py-3 px-2 w-[160px]">게시 상세</th>
                <th className="py-3 px-2 w-14 text-center text-indigo-500">익명여부</th>
                <th className="py-3 px-2 w-24 text-center">대상</th>
                <th className="py-3 px-2 w-24 text-center">기간</th>
                <th className="py-3 px-2 w-14 text-center border-l bg-slate-100/50 whitespace-nowrap">참여율</th>
                <th className="py-3 px-2 w-[72px] text-center bg-blue-50/50 text-blue-600 whitespace-nowrap">참여</th>
                <th className="py-3 px-2 w-[180px] text-center bg-red-50/50 text-red-600 border-r whitespace-nowrap">미참여인원</th>
                <th className="py-3 px-2 w-16 text-center">상태</th>
                <th className="py-3 px-2 w-[140px] text-center border-l border-slate-200 bg-slate-100/30 text-indigo-600">게시제어(Edit)</th>
                <th className="py-3 pr-4 w-[120px] text-center bg-slate-100/30 text-slate-600">관리액션(Edit)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredSurveys.map((s, idx) => {
                const targetDepts = s.target.split(',').map((t:string) => t.trim());
                const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u, { targetUnitIds: s.target_unit_ids }));
                const total = targetUsers.length;
                const done = s.isAnonymous
                  ? getAnonymousDoneCount(s.id, anonymousParticipationCounts, responses)
                  : targetUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                const notDone = Math.max(0, total - done);
                const rate = total > 0 ? Math.round((done/total)*100) : 0;
                
                const deadlinePassed = isPastKSTDeadline(s.endDate, s.endTime);
                const isExpiredStatus = s.status === '기간종료';
                const isPausedLike = s.status === '게시중단' || isExpiredStatus;
                const isTimeOver = isExpiredStatus || (s.status === '진행중' && deadlinePassed);
      
                return (
                  <tr key={s.id} className={`transition-all h-14 ${isTimeOver ? 'bg-red-50/20 hover:bg-red-50/40' : 'hover:bg-blue-50/20'}`}>
                    <td className="py-2 pl-4 text-center text-slate-400 font-medium align-middle">{idx + 1}</td>
                    <td className="py-2 px-2 font-mono font-medium text-slate-600 tracking-tighter align-middle whitespace-nowrap">{s.code}</td>
                    <td className="py-2 px-2 font-mono text-center text-slate-500 whitespace-nowrap align-middle">{s.postDate === '-' ? '' : s.postDate}</td>
                    
                    <td className="py-2 px-2 align-middle">
                      <button onClick={() => { setMetaModalPhase('detail'); setPreviewModal(s); }} className="font-medium text-slate-800 text-[11px] hover:text-blue-600 hover:underline text-left line-clamp-1">{s.title}</button>
                    </td>
                    
                    <td className="py-2 px-2 text-center align-middle">
                      {s.isAnonymous ? (
                        <span className="px-1.5 py-0.5 bg-slate-700 text-white text-[9px] font-medium rounded">익명</span>
                      ) : (
                        <span className="px-1.5 py-0.5 border border-slate-300 text-slate-500 text-[9px] font-medium rounded">기명</span>
                      )}
                    </td>
                    
                    <td className="py-2 px-2 font-medium text-slate-600 text-center align-middle">
                      <div className="text-[10px] leading-tight cursor-help truncate w-20 mx-auto" title={s.target}>
                        {s.target === '전사' ? '전사' : <span className="underline decoration-dashed decoration-slate-300">{s.target.split(',').length}개 부서 지정</span>}
                      </div>
                    </td>
                    
                    <td className="py-2 px-2 text-slate-500 tracking-tighter text-center text-[9px] whitespace-nowrap align-middle">
                      <div>{s.startDate} ~</div>
                      <div className={isTimeOver ? 'text-red-500 font-medium' : ''}>
                        {s.endDate} <span className="text-[8px]">({s.endTime || '23:59'})</span>
                      </div>
                    </td>
                    
                    <td className="py-2 px-2 text-center font-medium text-slate-700 border-l bg-slate-50/30 align-middle whitespace-nowrap">{rate}%</td>
                    
                    <td className="py-2 px-2 text-center bg-blue-50/30 align-middle whitespace-nowrap">
                      {s.isAnonymous ? (
                        <span className="text-slate-400 font-medium cursor-not-allowed">{done}명 <span className="text-[8px]">🔒</span></span>
                      ) : (
                        <button onClick={() => handleMatrixFilter(s.id, 'DONE')} className="text-blue-600 font-medium hover:underline relative z-10 whitespace-nowrap">{done}명</button>
                      )}
                    </td>
                    
                    <td className="py-2 px-2 text-center bg-red-50/30 border-r align-middle">
                      <div className="flex items-center justify-center gap-1 w-full flex-nowrap whitespace-nowrap">
                        {s.isAnonymous ? (
                          <span className="text-slate-400 font-medium cursor-not-allowed shrink-0">{notDone}명 <span className="text-[8px]">🔒</span></span>
                        ) : (
                          <button onClick={() => handleMatrixFilter(s.id, 'NOT_DONE')} className="text-red-500 font-medium hover:underline shrink-0 whitespace-nowrap">{notDone}명</button>
                        )}
                        
                        {s.status === '진행중' && notDone > 0 && (
                          <div className="flex gap-0.5 ml-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleNudge(s.id)}
                              disabled={!canEdit}
                              className={`px-1.5 py-0.5 border rounded text-[9px] font-medium transition-colors shadow-sm whitespace-nowrap ${
                                canEdit
                                  ? 'bg-white border-red-200 text-red-600 hover:bg-red-50'
                                  : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                              }`}
                            >
                              🔔독촉
                            </button>
                            <button onClick={() => handleCopyUnsubmittedEmails(s)} className={`px-1.5 py-0.5 border rounded text-[9px] font-medium transition-colors shadow-sm whitespace-nowrap ${s.isAnonymous ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>📧메일추출</button>
                          </div>
                        )}
                      </div>
                    </td>
     
                    <td className="py-2 px-2 text-center align-middle">
                      <span
                        className={`px-2 py-1 rounded font-medium text-[9px] whitespace-nowrap ${getStatusBadge(s.status)}`}
                        title={
                          s.status === '게시중단'
                            ? '관리자가 수동으로 내린 상태'
                            : s.status === '기간종료'
                              ? '운영 기간이 끝나 자동으로 내린 상태'
                              : undefined
                        }
                      >
                        {s.status}
                      </span>
                    </td>
                    
                    <td className="py-2 px-2 align-middle border-l border-slate-200 bg-slate-50/50">
                      <div className="flex items-center justify-center gap-1 w-full">
                        <button onClick={() => handleStatusChange(s.id, 'UP')} disabled={!canEdit || s.status === '진행중' || s.status === '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-medium whitespace-nowrap transition-all shadow-sm border ${canEdit && (s.status === '게시전' || isPausedLike) ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>올리기</button>
                        <button onClick={() => handleStatusChange(s.id, 'DOWN')} disabled={s.status !== '진행중'} className={`flex-1 py-1.5 rounded text-[9px] font-medium whitespace-nowrap transition-all shadow-sm border ${s.status === '진행중' ? 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>내리기</button>
                        <button onClick={() => handleStatusChange(s.id, 'FORCE_COMPLETE')} disabled={!canEdit || !isPausedLike} title={s.status === '진행중' ? '게시를 내린 후 종료처리할 수 있습니다.' : undefined} className={`flex-1 py-1.5 rounded text-[9px] font-medium whitespace-nowrap transition-all shadow-sm border ${canEdit && isPausedLike ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>종료처리</button>
                      </div>
                    </td>
     
                    <td className="py-2 pr-4 align-middle bg-slate-50/50">
                      <div className="flex items-center justify-center gap-1 w-full">
                        <button onClick={() => handleStatusChange(s.id, 'ARCHIVE')} disabled={!canEdit || s.status !== '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-medium whitespace-nowrap transition-all ${canEdit && s.status === '완료' ? 'bg-slate-800 text-white shadow-sm hover:bg-slate-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-transparent'}`}>보관함이동</button>
                        <button
                          type="button"
                          data-action-kebab
                          title="더보기"
                          onClick={(e) => openActionMenu(e, s.id)}
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors shrink-0 ${
                            actionMenu?.id === s.id
                              ? 'bg-slate-200 text-slate-800'
                              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                          }`}
                        >
                          <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor" aria-hidden>
                            <circle cx="10" cy="4.5" r="1.6" />
                            <circle cx="10" cy="10" r="1.6" />
                            <circle cx="10" cy="15.5" r="1.6" />
                          </svg>
                        </button>
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
          <h3 className="text-[12px] font-medium flex items-center gap-2"><span>🗂️</span> 부서 및 직원별 설문 제출 결과 현황 보드</h3>
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={handleDownloadZipAll}
              className={`px-4 py-2 rounded-lg text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                canEdit ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-500 cursor-not-allowed opacity-60'
              }`}
            >
              <span>📥</span> 선택 ZIP 다운로드(Edit)
            </button>
            <button
              type="button"
              onClick={handleExportAnalysisAll}
              className={`px-4 py-2 rounded-lg text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                canEdit ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-slate-500 cursor-not-allowed opacity-60'
              }`}
            >
              <span>📈</span> 선택 Excel 다운로드(Edit)
            </button>
            <div className="w-px h-6 bg-white/20 mx-0.5" />
            <button
              type="button"
              onClick={handleExportResultAnalysis}
              className={`px-4 py-2 rounded-lg text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                canEdit ? 'bg-amber-500 hover:bg-amber-400 text-slate-900' : 'bg-slate-500 cursor-not-allowed opacity-60 text-white'
              }`}
              title="단일·다중·만족도 통계 + 단답·장문 응답 원문"
            >
              <span>📊</span> 결과 분석 다운로드(Edit)
            </button>
          </div>
        </div>
      
        <div className="overflow-x-auto max-h-[500px] scrollbar-thin">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead className="sticky top-0 z-20 bg-white shadow-sm">
              <tr className="border-b-2 border-slate-300">
                <th className="py-2 pl-6 w-[280px] min-w-[280px] bg-slate-50 font-medium text-slate-500 tracking-widest text-[9px] align-bottom sticky left-0 z-30">
                  <div className="uppercase mb-1">소속 부서 / 이름</div>
                  <div className="flex gap-2 text-[8px] text-blue-500 font-medium">
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
                          <span className="font-medium text-slate-800 text-[10px] leading-tight group-hover:text-indigo-600 transition-colors">[{s.code}] {s.isAnonymous && <span className="text-red-500 ml-1">🔒</span>}</span>
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
              {orderedDeptEntries.map(([dept, deptUsers]) => (
                <Fragment key={dept}>
                  <tr className="bg-blue-100 cursor-pointer hover:bg-blue-200/80 border-b border-blue-200" onClick={() => toggleDept(dept)}>
                    <td className="py-2 pl-6 w-[280px] min-w-[280px] font-medium text-blue-900 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-blue-100"><span className="text-[8px] opacity-70 text-blue-700 mr-2">{collapsedDepts.has(dept) ? '▶' : '▼'}</span>{dept} <span className="text-[8px] text-blue-600/80 ml-1">{deptUsers.length}명</span></td>
                    {sortedSurveys.filter(s => s.status !== '보관됨').map(s => {
                       const targetDepts = s.target.split(',').map((t:string) => t.trim());
                       if (!isOrgAllowed(targetDepts, dept, { targetUnitIds: s.target_unit_ids })) return <td key={`ds-${s.id}`} className="py-2 border-l border-blue-200 text-center bg-blue-50/80 text-[10px] font-medium text-blue-300">-</td>;
                       if (s.isAnonymous) return <td key={`ds-${s.id}`} className="py-2 border-l border-blue-200 text-center bg-blue-50/80 text-[10px] font-medium text-blue-300">-</td>;
                       
                       const dDone = deptUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                       const dTotal = deptUsers.length;
                       return <td key={`ds-${s.id}`} className="py-2 border-l border-blue-200 text-center bg-blue-50/80"><div className="text-[9px] font-medium text-blue-800"><span className="text-blue-700 font-medium">{dDone}명</span> / {dTotal}명 <span className="ml-1 text-[8px] text-blue-500">({dTotal > 0 ? Math.round((dDone/dTotal)*100) : 0}%)</span></div></td>
                    })}
                  </tr>
                  {!collapsedDepts.has(dept) && deptUsers.map(user => {
                    if (matrixUserFilter.type === 'DONE' && matrixUserFilter.surveyId && !responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
                    if (matrixUserFilter.type === 'NOT_DONE' && matrixUserFilter.surveyId && responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
      
                    return (
                      <tr key={user.id} className="hover:bg-indigo-50/30 h-8">
                        <td className="py-1.5 pl-10 pr-3 w-[280px] min-w-[280px] font-medium text-slate-700 border-r border-slate-50 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                            <span>{user.name}</span>
                            <span className="text-[8px] text-slate-400 font-mono">{user.email.split('@')[0]}</span>
                          </span>
                        </td>
                        {sortedSurveys.filter(s => s.status !== '보관됨').map(s => {
                          const targetDepts = s.target.split(',').map((t:string) => t.trim());
                          if (!isOrgAllowed(targetDepts, user, { targetUnitIds: s.target_unit_ids })) return <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center text-[10px] font-medium text-slate-300">-</td>;
                          if (s.isAnonymous) return <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center text-[10px] font-medium text-slate-300">-</td>;
                          
                          const resp = responses[`${s.id}_${user.email}`];
                          const hasFile = resp?.answers && Object.values(resp.answers).some((a: any) => a && a.fileName);
                          
                          return (
                            <td key={`${s.id}-${user.id}`} className="py-1.5 border-l border-slate-100 text-center">
                              {resp?.isDone ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openNamedSubmissionView(s, user, resp)}
                                    className={`text-[8px] font-medium px-1.5 py-0.5 rounded tracking-tight ${
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
                                      className={`text-[8px] font-medium px-1.5 py-0.5 rounded shadow-sm border ${
                                        canEdit
                                          ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                                          : 'bg-slate-200 text-slate-400 border-slate-200 cursor-not-allowed'
                                      }`}
                                    >
                                      📂 파일
                                    </button>
                                  )}
                                </div>
                              ) : <span className="text-[8px] font-medium text-slate-300">미진행</span>}
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
      
      {previewModal && (() => {
        const canEditMeta =
          canEdit &&
          (metaModalPhase === 'create' || previewModal.status !== '진행중');
        return (
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
            className="bg-white w-[600px] min-w-[600px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col transition-[max-height] duration-300"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 bg-sky-100 border-b border-sky-200 flex justify-between items-center">
              <h3 className="font-medium text-sm text-slate-800">
                {metaModalPhase === 'create' ? '설문 기본 정보 추가' : '게시 상세 설정'}
              </h3>
              <button type="button" onClick={() => setPreviewModal(null)} className="text-xl text-slate-400 hover:text-slate-700 transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-4 bg-slate-50 flex-1 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="text-[10px] font-medium text-slate-500">식별코드{metaModalPhase === 'create' ? ' (자동부여)' : ''}</label>
                <input type="text" value={previewModal.code || ''} readOnly className="w-full p-2 border rounded text-xs font-mono font-medium bg-slate-100 text-slate-500 outline-none cursor-not-allowed" />
              </div>
              <div><label className="text-[10px] font-medium text-slate-500">제목</label><input type="text" value={previewModal.title} readOnly={!canEditMeta} onChange={e => canEditMeta && setPreviewModal({...previewModal, title: e.target.value})} className={`w-full p-2 border rounded text-xs font-medium outline-none ${canEditMeta ? 'focus:border-indigo-500' : 'bg-slate-100 text-slate-600 cursor-default'}`} /></div>
              <div><label className="text-[10px] font-medium text-slate-500">설명</label><textarea value={previewModal.description} readOnly={!canEditMeta} onChange={e => canEditMeta && setPreviewModal({...previewModal, description: e.target.value})} className={`w-full p-2 border rounded text-xs outline-none min-h-[80px] ${canEditMeta ? 'focus:border-indigo-500' : 'bg-slate-100 text-slate-600 cursor-default'}`} /></div>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-3">
                <div>
                  <label className="text-[9px] font-medium text-indigo-500 mb-1 block">설문 익명 여부</label>
                  <select
                    value={previewModal.isAnonymous ? 'true' : 'false'}
                    disabled={!canEditMeta}
                    onChange={(e) => canEditMeta && setPreviewModal({ ...previewModal, isAnonymous: e.target.value === 'true' })}
                    className={`w-full p-2 rounded-lg border text-[11px] font-medium outline-none bg-white focus:border-indigo-500 ${!canEditMeta ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
                  >
                    <option value="false">기명 설문 (참여자 식별)</option>
                    <option value="true">익명 설문 (참여자 블라인드)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-medium text-slate-500 mb-1 block">대상 범위 부서 지정</label>
                  <select
                    value={previewModal.target === '전사' ? '전사' : '특정'}
                    disabled={!canEditMeta}
                    onChange={(e) => {
                      if (!canEditMeta) return;
                      if (e.target.value === '전사') {
                        setPreviewModal({ ...previewModal, target: '전사', target_unit_ids: [] });
                      } else {
                        const first = deptList.filter((d) => d !== 'kpcqa')[0] || deptList[0] || '';
                        const id = String(unitsList.find((u: any) => u.unit_name === first)?.id || '').trim();
                        setPreviewModal({
                          ...previewModal,
                          target: first,
                          target_unit_ids: id ? [id] : [],
                        });
                      }
                    }}
                    className={`w-full p-2 rounded-lg border text-[11px] font-medium outline-none focus:border-indigo-500 bg-white ${!canEditMeta ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
                  >
                    <option value="전사">전사 임직원</option>
                    <option value="특정">특정 부서 한정</option>
                  </select>
                  {previewModal.target !== '전사' && (
                    <div className="border bg-white rounded-lg p-2 max-h-24 overflow-y-auto mt-2">
                      {deptList.filter((d) => d !== 'kpcqa').map((d) => (
                        <label key={d} className={`flex items-center gap-2 p-1 ${canEditMeta ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default opacity-70'}`}>
                          <input type="checkbox" checked={String(previewModal.target || '').includes(d)} disabled={!canEditMeta} onChange={() => togglePreviewTarget(d)} className="accent-indigo-600" />
                          <span className="text-[10px] font-medium">{d}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-medium text-slate-500">운영 기간 · 1차 설정 (게시 시 최종 확정)</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[9px] font-medium text-slate-500 mb-1 block">운영 시작일</label>
                    <input type="date" value={previewModal.startDate || ''} readOnly={!canEditMeta} onChange={(e) => canEditMeta && setPreviewModal({ ...previewModal, startDate: e.target.value })} className={`w-full p-2 rounded-lg border text-[11px] font-medium outline-none ${canEditMeta ? 'focus:border-indigo-500' : 'bg-slate-100 cursor-not-allowed'}`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-medium text-red-500 mb-1 block">운영 종료일</label>
                    <input type="date" value={previewModal.endDate || ''} readOnly={!canEditMeta} onChange={(e) => canEditMeta && setPreviewModal({ ...previewModal, endDate: e.target.value })} className={`w-full p-2 rounded-lg border text-[11px] font-medium outline-none ${canEditMeta ? 'focus:border-red-500' : 'bg-slate-100 cursor-not-allowed'}`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-medium text-red-500 mb-1 block">마감 시간</label>
                    <input type="time" value={previewModal.endTime || '23:59'} readOnly={!canEditMeta} onChange={(e) => canEditMeta && setPreviewModal({ ...previewModal, endTime: e.target.value })} className={`w-full p-2 rounded-lg border text-[11px] font-medium outline-none ${canEditMeta ? 'focus:border-red-500' : 'bg-slate-100 cursor-not-allowed'}`} />
                  </div>
                </div>
              </div>
              
              {canEditMeta ? (
                <button
                  type="button"
                  onClick={() => void handleSavePreviewGuarded()}
                  className={`w-full py-3 rounded-xl text-xs font-medium transition-all ${
                    metaModalPhase === 'create'
                      ? 'bg-indigo-600 text-white shadow-md hover:bg-indigo-700'
                      : 'bg-slate-200 text-slate-700 border border-slate-300 shadow-sm hover:bg-slate-300'
                  }`}
                >
                  {metaModalPhase === 'create' ? '리스트 생성하기' : '기본 정보 수정(edit)'}
                </button>
              ) : (
                <div className="w-full">
                  <button
                    type="button"
                    disabled
                    title={previewModal.status === '진행중' ? '게시 내리기 후 수정 가능' : undefined}
                    className="w-full py-3 bg-slate-100 text-slate-400 rounded-xl text-xs font-medium border border-slate-200 cursor-not-allowed"
                  >
                    {previewModal.status === '진행중' ? '게시중(수정 불가)' : '기본 정보 수정(edit)'}
                  </button>
                  {previewModal.status === '진행중' && (
                    <p className="mt-1.5 text-center text-[10px] text-slate-400 font-medium">게시 내리기 후 수정 가능</p>
                  )}
                </div>
              )}

              {metaModalPhase === 'detail' && (
                <>
                  <div className="text-center p-5 border-2 border-dashed border-indigo-200 bg-indigo-50 rounded-xl">
                    <Link href={`/survey/general/admin/survey-builder?id=${previewModal.id}`} className="px-5 py-3 bg-indigo-600 text-white rounded-xl text-[11px] font-medium shadow-md hover:bg-indigo-700 block w-fit mx-auto">🛠️ 서식지 빌더(Builder) 열기</Link>
                    <p className="text-[10px] text-indigo-500 font-medium mt-3">Builder에서 구체적인 질문 문항을 구성할 수 있습니다.</p>
                  </div>
         
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <label className="text-[10px] font-medium text-slate-500 block mb-2">🔗 모바일/웹 배포 링크</label>
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
                          alert('배포 링크가 클립보드에 복사되었습니다!\n게시판이나 메신저에 붙여넣기 하세요.');
                        }}
                        className="px-4 py-2 bg-slate-800 text-white rounded text-[11px] font-medium hover:bg-black transition-colors shrink-0"
                      >
                        링크 복사
                      </button>
                    </div>
                    <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3 text-center">
                      <p className="text-[11px] font-medium text-amber-800">📡 배포 링크 안내</p>
                      <p className="text-[10px] font-medium text-amber-700 mt-0.5 leading-relaxed">
                        참여 시 <span className="underline decoration-2">이메일 + Hub 비밀번호 또는 사번</span>으로
                        본인 인증합니다.
                      </p>
                    </div>
                  </div>
                </>
              )}
     
            </div>
            <div className="p-4 bg-white flex gap-2">
              <button onClick={() => setPreviewModal(null)} className="w-full py-2.5 border rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-50">
                {metaModalPhase === 'create' ? '취소' : '닫기'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
      
      {publishConfirmModal && (
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
              setPublishConfirmModal(null);
            }
          }}
        >
          <div
            className="bg-white w-[440px] rounded-[1.5rem] overflow-hidden shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 bg-white border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-medium text-sm text-slate-800">게시 확정</h3>
              <button type="button" onClick={() => setPublishConfirmModal(null)} className="text-lg text-slate-400 hover:text-slate-700 transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-4 bg-slate-50">
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
                <p className="text-[10px] font-medium text-slate-400">대상 설문</p>
                <p className="text-xs font-medium text-slate-800 line-clamp-2">{publishConfirmModal.title}</p>
                <p className="text-[10px] font-mono text-slate-500">{publishConfirmModal.code}</p>
              </div>
              <div>
                <label className="text-[9px] font-medium text-indigo-600 mb-1 block">게시일 (확정)</label>
                <input
                  type="text"
                  readOnly
                  value={`${todayStr} (오늘 · 게시 확정 시 기록)`}
                  className="w-full p-2 rounded-lg border border-indigo-100 bg-indigo-50 text-[11px] font-medium text-indigo-700 outline-none cursor-not-allowed"
                />
              </div>
              {publishConfirmModal.fromStatus === '기간종료' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-medium text-amber-800 leading-relaxed">
                    기간이 종료되어 내려간 게시입니다. 운영 종료일·마감 시간을 연장한 뒤 다시 올려 주세요.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-[10px] font-medium text-slate-500">운영 기간 · 최종 확인</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[9px] font-medium text-slate-500 mb-1 block">운영 시작일</label>
                    <input
                      type="date"
                      required
                      value={publishConfirmModal.startDate}
                      onChange={(e) => setPublishConfirmModal((prev) => prev ? { ...prev, startDate: e.target.value } : prev)}
                      className="w-full p-2 rounded-lg border text-[11px] font-medium outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-medium text-red-500 mb-1 block">운영 종료일</label>
                    <input
                      type="date"
                      required
                      value={publishConfirmModal.endDate}
                      onChange={(e) => setPublishConfirmModal((prev) => prev ? { ...prev, endDate: e.target.value } : prev)}
                      className="w-full p-2 rounded-lg border text-[11px] font-medium outline-none focus:border-red-500"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-medium text-red-500 mb-1 block">마감 시간</label>
                    <input
                      type="time"
                      required
                      value={publishConfirmModal.endTime}
                      onChange={(e) => setPublishConfirmModal((prev) => prev ? { ...prev, endTime: e.target.value } : prev)}
                      className="w-full p-2 rounded-lg border text-[11px] font-medium outline-none focus:border-red-500"
                    />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                확인을 누르면 게시일·운영 기간이 확정되고, 설문 배포 및 관리 리스트에 게시됩니다.
              </p>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setPublishConfirmModal(null)} className="flex-1 py-2.5 bg-white border rounded-xl font-medium text-slate-600 hover:bg-slate-50">취소</button>
                <button type="button" onClick={() => void handleConfirmPublish()} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-medium shadow-md hover:bg-indigo-700">확인 후 게시</button>
              </div>
            </div>
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
            <h3 className="font-medium text-lg text-slate-800 mb-2">미참여 인원 독촉 알림</h3>
            <p className="text-xs text-slate-500 font-medium mb-6 leading-relaxed">
              <span className="text-indigo-600 font-medium">[{nudgeModal.title}]</span> 설문에<br/>
              참여하지 않은 <span className="text-red-500 font-medium">{nudgeModal.count}명</span>의 사용자에게<br/>
              나의 제출(My Dashboard) 알람 팝업을 띄우시겠습니까?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setNudgeModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium text-xs hover:bg-slate-200 transition-colors">취소</button>
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
                className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-medium text-xs shadow-md hover:bg-indigo-700 transition-colors"
              >
                🚀 독촉 팝업 발송하기
              </button>
            </div>
          </div>
        </div>
      )}

      {actionMenu &&
        createPortal(
          <div
            ref={actionMenuRef}
            style={{ top: actionMenu.top, left: actionMenu.left }}
            className="fixed z-[500] w-[168px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-left"
          >
            {(() => {
              const row = surveys.find((s) => s.id === actionMenu.id);
              if (!row) return null;
              const canDelete = canEdit && !row.hasBeenPublished;
              return (
                <button
                  type="button"
                  disabled={!canDelete}
                  title={
                    !canEdit
                      ? '삭제 권한이 없습니다. (Edit)'
                      : row.hasBeenPublished
                        ? '게시된 설문은 현황판에서 삭제할 수 없습니다. 보관함에서 삭제를 사용하세요.'
                        : '영구 삭제 (Edit)'
                  }
                  className={`w-full px-3 py-2 text-left text-[11px] font-medium ${
                    canDelete
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-slate-400 cursor-not-allowed'
                  }`}
                  onClick={() => {
                    if (!canDelete) return;
                    setActionMenu(null);
                    void handleDeleteSurvey(row.id);
                  }}
                >
                  삭제(Edit)
                </button>
              );
            })()}
          </div>,
          document.body
        )}
    </div>
  );
}