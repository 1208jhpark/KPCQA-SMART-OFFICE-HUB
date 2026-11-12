'use client';

import { isSystemLv1User } from '@/lib/permission-utils';
     
import React, { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { usePathname, useRouter } from 'next/navigation'; // 🚀 내비게이션 도구 통합
import { getKSTDateString, isPastKSTDeadline } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import DeptAssigneeLine, { useDeptAssignees } from '@/components/common/DeptAssigneeLine';
import {
  useInterfaceStepTabs,
  SURVEY_DELIVERY_ADMIN_TABS,
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
     
export default function AdminDeliveryActiveModule() {
  const pathname = usePathname(); // 🚀 추가
  const router = useRouter();     // 🚀 추가
  const tabs = useInterfaceStepTabs(SURVEY_DELIVERY_ADMIN_TABS, '/survey/delivery/admin');
  const { editorNames } = useDeptAssignees(pathname || '/survey/delivery/admin/active-surveys');
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [deptList, setDeptList] = useState<string[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
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
     
  const [deliveryTab, setDeliveryTab] = useState<'ALL' | 'ALWAYS' | 'PERIOD'>('ALL');
  const [surveyListFilter, setSurveyListFilter] = useState<'ALL' | 'ONGOING' | 'CLOSING_TODAY'>('ALL');
  const [matrixUserFilter, setMatrixUserFilter] = useState<{ surveyId: string, type: 'DONE' | 'NOT_DONE' | 'ALL' }>({ surveyId: '', type: 'ALL' });
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const collapseSeededRef = useRef(false);
     
  const [selectedCellKeys, setSelectedCellKeys] = useState<Set<string>>(new Set());
     
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
  const [nudgeModal, setNudgeModal] = useState<{ surveyId: string, title: string, count: number, targetEmails: string[] } | null>(null);
  const [pendingModalType, setPendingModalType] = useState<'ALWAYS' | 'PERIOD' | null>(null);
  const [timelineModal, setTimelineModal] = useState<{ survey: any; user: any; cellKey: string } | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [detailSnapshot, setDetailSnapshot] = useState<{ title: string; answers: any; survey: any } | null>(null);
  const [actionMenu, setActionMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
     
  const todayStr = getKSTDateString();

  const requireEdit = () => {
    if (canEdit) return true;
    alert('편집·다운로드 권한이 없습니다.\n(interface: Task Editor 또는 Editor Level)');
    return false;
  };
     
  useEffect(() => {
    const fetchOrgData = async () => {
      try {
        const ts = Date.now();
        const [surveyRes, ctxRes, meRes] = await Promise.all([
          fetch(`/api/survey/delivery?t=${ts}`, { cache: 'no-store' }),
          fetch(`/api/survey/delivery?t=${ts}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'GET_ADMIN_CONTEXT', menuPath: pathname }),
            cache: 'no-store',
          }),
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        ]);

        if (surveyRes.ok) {
          setSurveys(await surveyRes.json());
        }

        if (ctxRes.ok) {
          const contextData = await ctxRes.json();
          setUnitsList(contextData.units || []);
          setDeptList(
            Array.isArray(contextData.scopeDepts) && contextData.scopeDepts.length > 0
              ? contextData.scopeDepts
              : (contextData.units || []).map((u: any) => u.unit_name)
          );
          setUsers(contextData.users || []);
          setCanEdit(!!contextData.canEdit);
          setPermissionSummary(contextData.permissionSummary || null);
        } else {
          setCanEdit(false);
          setPermissionSummary(null);
        }
        setCurrentUser(meRes.ok ? await meRes.json() : null);

        const responseRes = await fetch(`/api/survey/delivery?t=${ts}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_RESPONSES' }),
          cache: 'no-store',
        });
        if (responseRes.ok) {
          const dbResponses = await responseRes.json();

          const realRes: Record<string, any> = {};
          dbResponses.forEach((r: any) => {
            realRes[`${r.surveyId}_${r.userEmail}`] = {
              isDone: true,
              date: r.submittedAt ? getKSTDateString(r.submittedAt) : '-',
              fullDate: r.submittedAt,
              result: '제출완료',
              answers: r.answers,
              isApproved: r.isApproved,
              approvedAt: r.approvedAt ? getKSTDateString(r.approvedAt) : null,
              feedbackAt: r.feedbackAt ? getKSTDateString(r.feedbackAt) : null,
              feedbackAtFull: r.feedbackAt || null,
              feedbackMsg: r.feedbackMsg,
              revisionCount: r.revisionCount,
              isRevoked: r.isRevoked
            };
          });
          setResponses(realRes);
        }
      } catch (error) {
        console.error("Infrastructure Sync Error:", error);
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
        const res = await fetch(`/api/survey/delivery?t=${Date.now()}`, { cache: 'no-store' });
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

/** 대기함: 제출됨·미승인 + (이번 제출 이후 보완요청이 아직 없음). 승인/보완 시 제외, 재제출 시 다시 포함 */
const isAwaitingAdminReview = (resp: any) => {
  if (!resp?.isDone || resp.isApproved) return false;
  if (!resp.feedbackAtFull && !resp.feedbackAt) return true;
  const submitMs = new Date(resp.fullDate).getTime();
  const feedbackMs = new Date(resp.feedbackAtFull || resp.feedbackAt).getTime();
  if (Number.isNaN(submitMs) || Number.isNaN(feedbackMs)) return true;
  return feedbackMs < submitMs;
};

const pendingAlwaysApprovals = useMemo(() => {
  const pendings: any[] = [];
  surveys
    .filter(s => s.deliveryType === 'ALWAYS' && s.status !== '보관됨')
    .forEach(survey => {
    const targetDepts = survey.target ? survey.target.split(',').map((t: string) => t.trim()) : ['전사'];
    users.forEach(user => {
      if (isOrgAllowed(targetDepts, user, { targetUnitIds: survey.target_unit_ids })) {
        const resp = responses[`${survey.id}_${user.email}`];
        if (isAwaitingAdminReview(resp)) pendings.push({ survey, user, resp });
      }
    });
  });
  return pendings.sort((a, b) => new Date(b.resp.fullDate).getTime() - new Date(a.resp.fullDate).getTime());
}, [surveys, users, responses, unitsList]);
     
  const pendingPeriodApprovals = useMemo(() => {
    const pendings: any[] = [];
    surveys
      .filter(s => s.deliveryType === 'PERIOD' && s.status !== '보관됨')
      .forEach(survey => {
      const targetDepts = survey.target ? survey.target.split(',').map((t: string) => t.trim()) : ['전사'];
      users.forEach(user => {
        if (isOrgAllowed(targetDepts, user, { targetUnitIds: survey.target_unit_ids })) {
          const resp = responses[`${survey.id}_${user.email}`];
          if (isAwaitingAdminReview(resp)) pendings.push({ survey, user, resp });
        }
      });
    });
    return pendings.sort((a, b) => new Date(b.resp.fullDate).getTime() - new Date(a.resp.fullDate).getTime());
  }, [surveys, users, responses, unitsList]);
   
  const stats = useMemo(() => ({
    activeCount: surveys.filter(s => s.status === '진행중').length,
    closingTodayCount: surveys.filter(s => s.status === '진행중' && s.endDate === todayStr).length,
    pendingAlwaysCount: pendingAlwaysApprovals.length,
    pendingPeriodCount: pendingPeriodApprovals.length 
  }), [surveys, todayStr, pendingAlwaysApprovals, pendingPeriodApprovals]);
     
  /** 식별코드(DEL-YYMMDD-순번) 기준 정렬 — 게시번호 순서 UI는 폐기 */
  const sortedSurveys = useMemo(
    () =>
      [...surveys].sort((a, b) =>
        String(a.code || '').localeCompare(String(b.code || ''), 'ko', { numeric: true })
      ),
    [surveys]
  );
     
  const filteredSurveys = useMemo(() => {
    let list = sortedSurveys.filter(s => s.status !== '보관됨');
    if (surveyListFilter === 'ONGOING') list = list.filter(s => s.status === '진행중');
    else if (surveyListFilter === 'CLOSING_TODAY') list = list.filter(s => s.status === '진행중' && s.endDate === todayStr);
    if (deliveryTab === 'ALWAYS') list = list.filter(s => s.deliveryType === 'ALWAYS');
    if (deliveryTab === 'PERIOD') list = list.filter(s => s.deliveryType === 'PERIOD');
    return list;
  }, [sortedSurveys, surveyListFilter, deliveryTab, todayStr]);
     
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
     
  const toggleDept = (dept: string) => { const next = new Set(collapsedDepts); next.has(dept) ? next.delete(dept) : next.add(dept); setCollapsedDepts(next); };
  const collapseAll = () => setCollapsedDepts(new Set(Object.keys(groupedUsers)));
  const expandAll = () => { setCollapsedDepts(new Set()); setMatrixUserFilter({ surveyId: '', type: 'ALL' }); };

  // 응답 보드 기본: 전체 접기
  useEffect(() => {
    const keys = Object.keys(groupedUsers);
    if (keys.length === 0 || collapseSeededRef.current) return;
    setCollapsedDepts(new Set(keys));
    collapseSeededRef.current = true;
  }, [groupedUsers]);
 
     
  const handleCopyUnsubmittedEmails = (survey: any) => {
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
     
  const handleAddSurvey = () => {
    if (!requireEdit()) return;
    const maxPostNum = surveys.length > 0 ? Math.max(0, ...surveys.map((s: any) => Number(s.postNumber) || 0)) : 100;
    
    const defaultDeliveryType = deliveryTab === 'PERIOD' ? 'PERIOD' : 'ALWAYS';
     
    setMetaModalPhase('create');
    setPreviewModal({
      id: `D_${Date.now()}`,
      code: nextSurveyCode(
        'DEL',
        surveys.map((s: any) => s.code)
      ),
      postNumber: maxPostNum + 1,
      title: '새로운 배달 복지 공고',
      description: '',
      type: '선택형',
      deliveryType: defaultDeliveryType,
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

  const canEditMeta =
    !!previewModal &&
    canEdit &&
    (metaModalPhase === 'create' || previewModal.status !== '진행중');
     
  const handleDeleteSurvey = async (id: string) => {
    if (!requireEdit()) return;
    if (!confirm('이 배달 공고를 삭제하시겠습니까?\n(복구 불가)')) return;
    try {
      const qs = new URLSearchParams({ id, menuPath: pathname || '' });
      const res = await fetch(`/api/survey/delivery?${qs.toString()}`, { method: 'DELETE' });
      if (res.ok) {
        setSurveys(prev => prev.filter(s => s.id !== id));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '삭제 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('네트워크 오류가 발생했습니다.');
    }
  };
     
  const handleStatusChange = async (id: string, action: 'UP' | 'DOWN' | 'ARCHIVE' | 'FORCE_COMPLETE') => {
    // 중단(DOWN)만 Edit 없이 Access로 긴급 허용
    if (action !== 'DOWN' && !requireEdit()) return;
    const survey = surveys.find(s => s.id === id);
    if (!survey) return;

    if (action === 'DOWN') {
      try {
        const res = await fetch('/api/survey/delivery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'PAUSE', id, menuPath: pathname }),
        });
        if (res.ok) {
          const savedSurvey = await res.json();
          setSurveys(prev => prev.map(s => s.id === id ? savedSurvey : s));
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.error || '❌ 중단 처리 중 오류가 발생했습니다.');
        }
      } catch (e) {
        console.error("Status Change Error:", e);
        alert('❌ 네트워크 오류가 발생했습니다.');
      }
      return;
    }
     
    if (action === 'UP') {
      setPublishConfirmModal({
        id: survey.id,
        title: survey.title || '',
        code: survey.code || '',
        startDate: survey.startDate || todayStr,
        endDate: survey.endDate || todayStr,
        endTime: survey.endTime || '23:59',
        fromStatus: survey.status,
      });
      return;
    }

    // 🚀 이 변수 선언이 지워져서 에러가 났던 것입니다! 복구 완료.
    let updatedSurvey = { ...survey };
    
    if (action === 'FORCE_COMPLETE') {
      if (survey.status !== '게시중단' && survey.status !== '기간종료') {
        alert('종료처리는 게시를 내린 후(게시중단/기간종료)에만 가능합니다.');
        return;
      }
      if (!confirm("이 공고를 종료처리(완료) 하시겠습니까?")) return;
      updatedSurvey = { ...updatedSurvey, status: '완료' };
    }
    if (action === 'ARCHIVE') {
      if (!confirm("이 공고를 보관함으로 이동하시겠습니까?")) return; // 🚀 확인창 추가
      updatedSurvey = { ...updatedSurvey, status: '보관됨' };
    }
     
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updatedSurvey, menuPath: pathname })
      });
      
      if (res.ok) {
        const savedSurvey = await res.json();
        setSurveys(prev => prev.map(s => s.id === id ? savedSurvey : s));
        if (action === 'ARCHIVE') alert('✅ 보관함으로 성공적으로 이동되었습니다.'); // 🚀 성공 시 얼럿
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '❌ 서버 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error("Status Change Error:", e);
      alert('❌ 네트워크 오류가 발생했습니다.');
    }
  };

  const handleConfirmPublish = async () => {
    if (!requireEdit() || !publishConfirmModal) return;
    const survey = surveys.find((s) => s.id === publishConfirmModal.id);
    if (!survey) return;
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

    const updatedSurvey = {
      ...survey,
      menuPath: pathname,
      status: '진행중',
      postDate: todayStr,
      startDate: publishConfirmModal.startDate,
      endDate: publishConfirmModal.endDate,
      endTime: publishConfirmModal.endTime,
      hasBeenPublished: true,
    };

    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSurvey),
      });
      if (res.ok) {
        const savedSurvey = await res.json();
        setSurveys((prev) => prev.map((s) => (s.id === publishConfirmModal.id ? savedSurvey : s)));
        setPublishConfirmModal(null);
        alert('✅ 게시가 확정되어 배달 배포·관리 목록에 반영되었습니다.');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '❌ 게시 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error('Publish Confirm Error:', e);
      alert('❌ 네트워크 오류가 발생했습니다.');
    }
  };
  
  const handleNudge = (surveyId: string) => {
    if (!requireEdit()) return;
    const survey = surveys.find(s => s.id === surveyId);
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    const targetUsers = users.filter((u) =>
      isOrgAllowed(targetDepts, u, { targetUnitIds: survey.target_unit_ids })
    );
    const notDoneUsers = targetUsers.filter(u => !responses[`${surveyId}_${u.email}`]?.isDone);
     
    if (notDoneUsers.length === 0) return alert('모든 인원이 배달지 신청을 완료했습니다!');
    
    // 💡 (수정됨) targetEmails 필드를 추가하여 미참여자 이메일 배열을 모달에 넘겨줍니다.
    setNudgeModal({ 
      surveyId, 
      title: survey.title, 
      count: notDoneUsers.length,
      targetEmails: notDoneUsers.map(u => u.email) 
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

    const wasCreate = metaModalPhase === 'create' || String(previewModal.id || '').startsWith('D_');
    const finalPayload = {
      ...previewModal,
      endTime: previewModal.endTime || '23:59',
      menuPath: pathname,
      postDate: previewModal.hasBeenPublished ? previewModal.postDate : '-',
    };

    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
      });
      if (res.ok) {
        const savedSurvey = await res.json();
        setSurveys((prev) => {
          const exists = prev.find((s) => s.id === savedSurvey.id || s.id === previewModal.id);
          if (exists) {
            return prev.map((s) => (s.id === savedSurvey.id || s.id === previewModal.id ? savedSurvey : s));
          }
          return [...prev, savedSurvey];
        });
        setPreviewModal(savedSurvey);
        if (wasCreate) {
          setMetaModalPhase('detail');
        } else {
          alert('✅ 기본 정보가 수정되었습니다.');
        }
      } else {
        alert('서버 저장에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('저장 중 오류가 발생했습니다.');
    }
  };
     
  const handleMatrixFilter = (surveyId: string, type: 'DONE' | 'NOT_DONE') => {
    setMatrixUserFilter({ surveyId, type });
    setCollapsedDepts(new Set());
  };
     
const parseSurveyQuestions = (survey: any) => {
  try {
    return typeof survey?.questions === 'string'
      ? JSON.parse(survey.questions)
      : (survey?.questions || []);
  } catch {
    return [];
  }
};

const formatAnswersLines = (survey: any, rawAnswers: any) => {
  let parsedAnswers = rawAnswers || {};
  if (typeof parsedAnswers === 'string') {
    try { parsedAnswers = JSON.parse(parsedAnswers); } catch { parsedAnswers = {}; }
  }
  const questions = parseSurveyQuestions(survey);
  return questions
    .filter((q: any) => q.type !== 'SECTION')
    .map((q: any) => {
      let aStr = '미입력';
      if (q.type === 'SEARCH_ADDRESS') {
        const zip = parsedAnswers[`${q.id}_zip`] || parsedAnswers[q.id]?.zipCode;
        const road = parsedAnswers[`${q.id}_road`] || parsedAnswers[q.id]?.roadAddress;
        const detail = parsedAnswers[`${q.id}_detail`] || parsedAnswers[q.id]?.detailAddress;
        if (zip || road) aStr = `[${zip || ''}] ${road || ''} ${detail || ''}`;
      } else {
        const a = parsedAnswers[q.id];
        if (a !== undefined && a !== null && a !== '') {
          aStr = Array.isArray(a) ? a.join(', ') : (a.fileName || a);
        }
      }
      return `• ${q.title}\n  ➔ ${aStr}`;
    }).join('\n\n');
};

const userSubmitLabel = (revisionNo?: number | null) => {
  const rev = revisionNo || 1;
  return rev > 1 ? `${rev - 1}차수정` : '최초제출';
};

const adminEventLabel = (type: string) => {
  if (type === 'ADMIN_APPROVE') return '확인처리';
  if (type === 'ADMIN_CANCEL') return '확인취소';
  if (type === 'ADMIN_FEEDBACK') return '보완요청';
  return type;
};

/** 사용자 제출 1건 + 그 뒤 관리자 이벤트들을 한 줄로 묶음 */
const buildTimelineRows = (events: any[]) => {
  const rows: { user: any | null; admins: any[] }[] = [];
  let current: { user: any | null; admins: any[] } | null = null;
  for (const ev of events) {
    if (ev.type === 'USER_SUBMIT') {
      if (current) rows.push(current);
      current = { user: ev, admins: [] };
    } else {
      if (!current) current = { user: null, admins: [] };
      current.admins.push(ev);
    }
  }
  if (current) rows.push(current);
  return rows;
};

const loadTimelineEvents = async (surveyId: string, userEmail: string) => {
  setTimelineLoading(true);
  try {
    const res = await fetch('/api/survey/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'GET_RESPONSE_EVENTS', surveyId, userEmail, menuPath: pathname }),
      cache: 'no-store',
    });
    if (res.ok) {
      setTimelineEvents(await res.json());
    } else {
      setTimelineEvents([]);
      alert('제출 이력을 불러오지 못했습니다.');
    }
  } catch (e) {
    console.error(e);
    setTimelineEvents([]);
  } finally {
    setTimelineLoading(false);
  }
};

const openTimelineModal = async (survey: any, user: any) => {
  if (!canEdit) {
    alert('권한이 없습니다.');
    return;
  }
  const cellKey = `${survey.id}_${user.email}`;
  setTimelineModal({ survey, user, cellKey });
  setDetailSnapshot(null);
  await loadTimelineEvents(survey.id, user.email);
};

const toggleApprove = async (surveyId: string, userEmail: string) => {
  if (!requireEdit()) return;
  const cellKey = `${surveyId}_${userEmail}`;
  const resp = responses[cellKey];
  if (!resp) return;
     
  const today = getKSTDateString();
  const isCurrentlyApproved = resp.isApproved || false;
   
  if (isCurrentlyApproved) {
    const msg = prompt('해당 신청의 확인을 취소하시겠습니까?\n직원에게 전달할 취소 사유를 입력해주세요. (예: 주소지 불명확, 품목 품절 등)');
    if (!msg) return;
   
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CANCEL', surveyId, userEmail, feedbackMsg: msg, menuPath: pathname })
      });
     
      if (res.ok) {
        const feedbackAtFull = new Date().toISOString();
        setResponses(prev => ({
          ...prev,
          [cellKey]: {
            ...prev[cellKey],
            isApproved: false,
            approvedAt: null,
            feedbackMsg: msg,
            feedbackAt: today,
            feedbackAtFull,
            isRevoked: true
          }
        }));
        if (timelineModal?.cellKey === cellKey) await loadTimelineEvents(surveyId, userEmail);
        alert('확인이 취소되었으며, 해당 직원에게 보완 필요(확인취소) 알림이 전송되었습니다.');
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    if (!confirm('해당 직원의 신청을 확인 처리하시겠습니까?\n확인 시 직원은 더 이상 정보를 수정할 수 없습니다.')) return;
   
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPROVE', surveyId, userEmail, menuPath: pathname })
      });
     
      if (res.ok) {
        setResponses(prev => ({
          ...prev,
          [cellKey]: {
            ...prev[cellKey],
            isApproved: true,
            approvedAt: today,
            isRevoked: false
          }
        }));
        if (timelineModal?.cellKey === cellKey) await loadTimelineEvents(surveyId, userEmail);
      }
    } catch (e) {
      console.error(e);
    }
  }
};
     
const handleSendFeedback = async (surveyId: string, userEmail: string) => {
  if (!requireEdit()) return;
  const msg = prompt('신청자에게 보낼 보완 요청 사유를 입력해주세요.\n(예: 상세 주소지 동/호수 누락, 연락처 오기재 등)');
  if (!msg) return;
   
  const today = getKSTDateString();
  const cellKey = `${surveyId}_${userEmail}`;
   
  try {
    const res = await fetch('/api/survey/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'FEEDBACK', surveyId, userEmail, feedbackMsg: msg, menuPath: pathname })
    });
     
    if (res.ok) {
      const feedbackAtFull = new Date().toISOString();
      setResponses(prev => ({
        ...prev,
        [cellKey]: {
          ...prev[cellKey],
          feedbackAt: today,
          feedbackAtFull,
          feedbackMsg: msg,
          isApproved: false,
          approvedAt: null
        }
      }));
      if (timelineModal?.cellKey === cellKey) await loadTimelineEvents(surveyId, userEmail);
      alert('✅ 보완 요청 알림이 직원의 대시보드로 전송되었습니다.');
    }
  } catch (e) {
    console.error(e);
  }
};
     
  const parseDeliveryCellKey = (key: string) => {
    const atIdx = key.indexOf('@');
    const sepIdx = atIdx === -1 ? key.lastIndexOf('_') : key.lastIndexOf('_', atIdx);
    if (sepIdx <= 0) return { surveyId: '', userEmail: '' };
    return { surveyId: key.slice(0, sepIdx), userEmail: key.slice(sepIdx + 1) };
  };

  const getDeliveryAnswerValue = (q: any, answers: any) => {
    if (!answers) return null;
    if (q.type === 'SEARCH_ADDRESS') {
      return (
        answers[q.id] ?? {
          zipCode: answers[`${q.id}_zip`],
          roadAddress: answers[`${q.id}_road`],
          detailAddress: answers[`${q.id}_detail`],
        }
      );
    }
    return answers[q.id];
  };

  const normalizeDeliveryAnswers = (questions: SurveyExcelQuestion[], answers: any) => {
    const out: Record<string, unknown> = {};
    questions.forEach((q) => {
      out[q.id] = getDeliveryAnswerValue(q, answers);
    });
    return out;
  };

  /** 선택 Excel — 명함 발주서 그룹·3톤 (일반 active-surveys와 동일 스타일) */
  const handleExportAnalysisAll = async () => {
    if (!requireEdit()) return;
    if (selectedCellKeys.size === 0) return alert('현황 보드 표 내부에서 내보낼 항목을 체크해주세요.');

    const recordsBySurvey: Record<string, any[]> = {};
    selectedCellKeys.forEach((key) => {
      const { surveyId, userEmail } = parseDeliveryCellKey(key);
      const survey = surveys.find((s) => s.id === surveyId);
      const user = users.find((u) => u.email === userEmail);
      const resp = responses[key];
      if (survey && user && resp) {
        if (!recordsBySurvey[surveyId]) recordsBySurvey[surveyId] = [];
        recordsBySurvey[surveyId].push({ user, resp, survey });
      }
    });

    const sheets: Array<{
      title: string;
      questions: SurveyExcelQuestion[];
      sources: SurveyExcelAnswerSource[];
    }> = [];

    Object.entries(recordsBySurvey).forEach(([, items]) => {
      const survey = items[0].survey;
      let questions: any[] = [];
      try {
        questions =
          typeof survey.questions === 'string'
            ? JSON.parse(survey.questions)
            : survey.questions || [];
      } catch (e) {
        console.error('문항 데이터 파싱 실패:', e);
      }
      const dataQuestions = (
        questions.length > 0 ? questions : [{ id: 'dq1', title: '1. 배송 정보', type: 'TEXT_LONG' }]
      ).filter((q: any) => q && q.type !== 'SECTION') as SurveyExcelQuestion[];

      sheets.push({
        title: String(survey.title || survey.code || '배달'),
        questions: dataQuestions,
        sources: items.map((i) => ({
          dept: i.user.dept || '-',
          name: i.user.name || '-',
          date: i.resp.date || '-',
          approvedAt: i.resp.approvedAt || '미확인',
          answers: normalizeDeliveryAnswers(dataQuestions, i.resp.answers || {}),
        })),
      });
    });

    if (sheets.length === 0) {
      return alert('추출할 데이터가 존재하지 않습니다. 체크박스를 확인해주세요.');
    }
    try {
      const buffer = await writeSurveyResponseExcelBuffer(sheets, { variant: 'delivery' });
      downloadExcelArrayBuffer(buffer, `배달개별응답_${todayStr}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };
     
const handleDownloadZipAll = async () => {
  if (!requireEdit()) return;
  if (selectedCellKeys.size === 0) return alert('현황 보드에서 내보낼 항목을 하나 이상 선택해주세요.');
  const zip = new JSZip();
  let hasData = false;
   
  const currentSurveys = deliveryTab === 'ALWAYS'
    ? surveys.filter(s => s.deliveryType === 'ALWAYS')
    : surveys.filter(s => s.deliveryType === 'PERIOD');
   
  for (const survey of currentSurveys) {
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    
    let storedQuestions = [];
    try {
      storedQuestions = typeof survey.questions === 'string' 
        ? JSON.parse(survey.questions) 
        : (survey.questions || []);
    } catch (e) {
      console.error("문항 데이터 파싱 실패:", e);
    }
   
    const targetUsers = users.filter(user => {
      const isAllowed = isOrgAllowed(targetDepts, user, { targetUnitIds: survey.target_unit_ids });
      const isDone = responses[`${survey.id}_${user.email}`]?.isDone;
      const isSelected = selectedCellKeys.has(`${survey.id}_${user.email}`);
      return isAllowed && isDone && isSelected;
    });
   
    if (targetUsers.length === 0) continue;
   
    const safeFolderTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-');
    const folder = zip.folder(safeFolderTitle);
   
    targetUsers.forEach((user) => {
      const resp = responses[`${survey.id}_${user.email}`];
      hasData = true;
      
      const identifier = `${user.dept}_${user.name}`;
   
      let content = `■ 공고명: ${survey.title}\n■ 신청자: ${user.dept + ' ' + user.name}\n■ 제출일: ${resp.date}\n--------------------------\n\n`;
      
      let qNum = 1;
      storedQuestions.forEach((q: any) => {
        if (q.type === 'SECTION') {
          content += `\n[🔖 섹션 단락]: ${q.title}\n--------------------------\n`;
          return;
        }
        content += `Q${qNum++}. ${q.title}\n`;
        
        if (q.type === 'SEARCH_ADDRESS') {
          const zipCode = resp.answers[`${q.id}_zip`] || resp.answers[q.id]?.zipCode;
          const roadAddress = resp.answers[`${q.id}_road`] || resp.answers[q.id]?.roadAddress;
          const detailAddress = resp.answers[`${q.id}_detail`] || resp.answers[q.id]?.detailAddress;
   
          if (zipCode || roadAddress) {
            content += `A. [${zipCode || ''}] ${roadAddress || ''} ${detailAddress || ''}\n\n`;
          } else {
            content += `A. 미입력\n\n`;
          }
        } else {
          const ans = resp.answers[q.id];
          content += `A. ${ans ? (Array.isArray(ans) ? ans.join(', ') : (ans.fileName || ans)) : '미입력'}\n\n`;
          if (ans && typeof ans === 'object' && ans.fileName && ans.fileData) {
            const base64Data = String(ans.fileData).split(',')[1];
            if (base64Data) folder?.file(`${identifier}_${ans.fileName}`, base64Data, { base64: true });
          }
        }
      });
      folder?.file(`${identifier}_배송스펙.txt`, "\ufeff" + content);
    });
  }
   
  if (!hasData) return alert('다운로드할 명세 데이터가 없습니다.');
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, `[선택배달명세]_${todayStr}.zip`);
};

  /** 결과 분석 — 일반 active-surveys와 동일 (스타일 + 문항 블록 + 그래프) */
  const handleExportResultAnalysis = async () => {
    if (!requireEdit()) return;
    if (selectedCellKeys.size === 0) return alert('분석할 항목을 현황 보드에서 하나 이상 선택해주세요.');

    const bySurvey: Record<string, { survey: any; users: any[]; resps: any[] }> = {};
    selectedCellKeys.forEach((key) => {
      const { surveyId, userEmail } = parseDeliveryCellKey(key);
      const survey = surveys.find((s) => s.id === surveyId);
      const user = users.find((u) => u.email === userEmail);
      const resp = responses[key];
      if (!survey || !user || !resp?.isDone) return;
      if (!bySurvey[surveyId]) bySurvey[surveyId] = { survey, users: [], resps: [] };
      bySurvey[surveyId].users.push(user);
      bySurvey[surveyId].resps.push(resp);
    });

    const surveyIds = Object.keys(bySurvey);
    if (surveyIds.length === 0) return alert('추출할 데이터가 없습니다. 체크박스를 확인해주세요.');

    const GUIDE_MSG = '선택 ZIP 또는 Excel을 다운받아 확인바랍니다.';
    const packs: Array<{
      title: string;
      responseCount: number;
      blocks: SurveyStatBlock[];
      textQuestions: SurveyExcelQuestion[];
      sources: SurveyExcelAnswerSource[];
    }> = [];

    surveyIds.forEach((surveyId) => {
      const { survey, users: selectedUsers, resps } = bySurvey[surveyId];
      let parsedQuestions: any[] = [];
      try {
        parsedQuestions =
          typeof survey.questions === 'string' ? JSON.parse(survey.questions) : survey.questions || [];
      } catch (e) {}
      const exportQuestions = parsedQuestions.filter((q: any) => {
        if (!q || q.type === 'SECTION') return false;
        if (typeof q.allowAnalysis === 'boolean') return q.allowAnalysis;
        return q.type === 'CHOICE_SINGLE' || q.type === 'CHOICE_MULTI' || q.type === 'SCALE';
      });
      if (exportQuestions.length === 0) return;

      const textQuestions = exportQuestions.filter(
        (q: any) => q.type === 'TEXT_SHORT' || q.type === 'TEXT_LONG'
      ) as SurveyExcelQuestion[];
      const dataQuestions = exportQuestions as SurveyExcelQuestion[];

      const sources: SurveyExcelAnswerSource[] = selectedUsers.map((u, i) => ({
        dept: u.dept || '-',
        name: u.name || '-',
        date: resps[i]?.date || '-',
        approvedAt: resps[i]?.approvedAt || '미확인',
        answers: normalizeDeliveryAnswers(dataQuestions, resps[i]?.answers || {}),
      }));

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
          resps.forEach((resp) => {
            const ans = getDeliveryAnswerValue(q, resp.answers);
            if (ans === null || ans === undefined || ans === '') return;
            answered += 1;
            if (q.type === 'CHOICE_MULTI') {
              const list = Array.isArray(ans) ? ans : [ans];
              list.forEach((label) => {
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
          resps.forEach((resp) => {
            const ans = getDeliveryAnswerValue(q, resp.answers);
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
          lines: [{ option: GUIDE_MSG, count: '-', pct: '-', graph: '', kind: 'guide' }],
        });
      });

      packs.push({
        title: String(survey.title || survey.code || '배달'),
        responseCount: selectedUsers.length,
        blocks,
        textQuestions,
        sources,
      });
    });

    if (packs.length === 0) {
      return alert('분석 허용된 문항이 없습니다.\n빌더에서 문항별 「분석 허용」을 켠 뒤 다시 시도해주세요.');
    }
    try {
      const buffer = await writeSurveyResultAnalysisExcelBuffer(packs, { variant: 'delivery' });
      downloadExcelArrayBuffer(buffer, `배달결과분석_${todayStr}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };
     
  const handleToggleColumnAll = (surveyId: string, isChecked: boolean) => {
    const next = new Set(selectedCellKeys);
    const survey = surveys.find(s => s.id === surveyId);
    if (!survey) return;
     
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    users.forEach(user => {
      if (isOrgAllowed(targetDepts, user, { targetUnitIds: survey.target_unit_ids })) {
        const cellKey = `${surveyId}_${user.email}`;
        if (responses[cellKey]?.isDone) {
          if (isChecked) next.add(cellKey);
          else next.delete(cellKey);
        }
      }
    });
    setSelectedCellKeys(next);
  };
     
  if (loading) return <LoadingState />;
     
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 — client-search와 동일 */}
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-emerald-400 mb-2.5">
            DELIVERY SURVEY HUB
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-white font-medium">배송조사 통합 관리 센터</span>
          </h1>
          <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
            상시/기간제 배송 조사 신정 공고 및 부서별 접수 현황을 통합 모니터링합니다.
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

      {/* 탭 네비게이션 — equipment inventory 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg">
          {tabs.map((tab) => {
            const isActive = tab.exact ? pathname === tab.path : pathname.startsWith(tab.path);
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
     
      <div className="flex gap-4 w-full">
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'ONGOING' ? 'ALL' : 'ONGOING')} className={`flex-[1.5] p-5 rounded-[2rem] border transition-all flex items-center justify-between ${surveyListFilter === 'ONGOING' ? 'border-blue-400 bg-blue-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-blue-300'}`}>
          <div className="flex items-center gap-4">
            <span className="text-3xl opacity-80 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">📝</span>
            <div className="text-left">
              <p className="text-[10px] font-medium text-blue-600 uppercase mb-1">진행중인 조사</p>
              <p className="text-2xl font-medium text-slate-800">{stats.activeCount} <span className="text-sm font-medium text-slate-500">건</span></p>
            </div>
          </div>
        </button>
     
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'CLOSING_TODAY' ? 'ALL' : 'CLOSING_TODAY')} className={`flex-[1.5] p-5 rounded-[2rem] border transition-all flex items-center justify-between ${surveyListFilter === 'CLOSING_TODAY' ? 'border-red-400 bg-red-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-red-300'}`}>
          <div className="flex items-center gap-4">
            <span className="text-3xl bg-white p-3 rounded-2xl shadow-sm border border-slate-100">⏰</span>
            <div className="text-left">
              <p className="text-[10px] font-medium text-red-600 uppercase mb-1">오늘 마감 조사</p>
              <p className="text-2xl font-medium text-slate-800">{stats.closingTodayCount} <span className="text-sm font-medium text-slate-500">건</span></p>
            </div>
          </div>
        </button>
     
        <button onClick={() => setPendingModalType('ALWAYS')} className="flex-[1.2] p-5 rounded-[2rem] border border-pink-200 bg-gradient-to-r from-pink-50 to-white shadow-sm hover:border-pink-400 transition-all flex items-center justify-between">
          <div className="text-left">
            <p className="text-[10px] font-medium text-pink-600 uppercase mb-1">상시신청 대기함(꽃배달 서비스 등)</p>
            <p className="text-xl font-medium text-slate-800">{stats.pendingAlwaysCount} <span className="text-sm font-medium text-slate-500">건</span></p>
          </div>
          <span className="text-xl">🌸</span>
        </button>
     
        <button onClick={() => setPendingModalType('PERIOD')} className="flex-[1.2] p-5 rounded-[2rem] border border-amber-200 bg-gradient-to-r from-amber-50 to-white shadow-sm hover:border-amber-400 transition-all flex items-center justify-between">
          <div className="text-left">
            <p className="text-[10px] font-medium text-amber-600 uppercase mb-1">기간신청 대기함</p>
            <p className="text-xl font-medium text-slate-800">{stats.pendingPeriodCount} <span className="text-sm font-medium text-slate-500">건</span></p>
          </div>
          <span className="text-xl">📅</span>
        </button>
      </div>
     
     
      {/* 서류철 탭 — 외주 코너와 동일: 아래 리스트 상단에 붙음 */}
      <div className="w-full">
        <div
          className="flex flex-wrap items-end gap-1 border-b border-slate-300"
          role="tablist"
          aria-label="신청 공지 목록 필터"
        >
          <button
            type="button"
            role="tab"
            aria-selected={deliveryTab === 'ALL'}
            onClick={() => {
              setDeliveryTab('ALL');
              setSelectedCellKeys(new Set());
            }}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${
              deliveryTab === 'ALL'
                ? 'bg-slate-900 text-white border-slate-900 border-b-white z-10 -mb-px'
                : 'bg-slate-100 text-slate-400 border-slate-200 border-b-transparent hover:bg-slate-200/80 hover:text-slate-600'
            }`}
          >
            <span className="text-sm leading-none">🔄</span>
            <span>전체 목록</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={deliveryTab === 'ALWAYS'}
            onClick={() => {
              setDeliveryTab('ALWAYS');
              setSelectedCellKeys(new Set());
            }}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${
              deliveryTab === 'ALWAYS'
                ? 'bg-pink-600 text-white border-pink-500 border-b-white z-10 -mb-px shadow-sm'
                : 'bg-slate-100 text-slate-400 border-slate-200 border-b-transparent hover:bg-slate-200/80 hover:text-slate-600'
            }`}
          >
            <span className="text-sm leading-none">🌸</span>
            <span>상시신청(접수현황)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={deliveryTab === 'PERIOD'}
            onClick={() => {
              setDeliveryTab('PERIOD');
              setSelectedCellKeys(new Set());
            }}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium tracking-tight transition-colors rounded-t-lg border ${
              deliveryTab === 'PERIOD'
                ? 'bg-amber-500 text-white border-amber-400 border-b-white z-10 -mb-px shadow-sm'
                : 'bg-slate-100 text-slate-400 border-slate-200 border-b-transparent hover:bg-slate-200/80 hover:text-slate-600'
            }`}
          >
            <span className="text-sm leading-none">📅</span>
            <span>기간신청(접수현황)</span>
          </button>
        </div>

      <div className="bg-white border border-t-0 border-slate-200 shadow-sm rounded-b-2xl rounded-tr-2xl overflow-hidden">
        <div className="p-4 px-6 bg-gradient-to-r from-blue-700 to-indigo-800 border-b border-blue-800/60 flex justify-between items-center text-white gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h3 className="text-[12px] font-medium flex items-center gap-2">
              <span className="text-sky-300">●</span> 신청 공지 및 관리 리스트
            </h3>
            <DeptAssigneeLine editorNames={editorNames} onColor label="담당자" popupLabel="부서 편집 담당자" />
          </div>
          <button
            type="button"
            onClick={handleAddSurvey}
            disabled={!canEdit}
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
          <table className="w-full text-left font-medium min-w-[1450px]">

          <thead className="bg-slate-50 text-[10px] text-slate-500 font-medium border-b border-slate-200 tracking-tight uppercase">
            <tr>
              <th className="py-3 pl-4 w-10 text-center">NO</th>
              <th className="py-3 px-2 w-28">식별코드</th>
              <th className="py-3 px-2 w-16 text-center text-indigo-500">신청분류</th>
              <th className="py-3 px-2 w-20 text-center">게시일</th>
              <th className="py-3 px-2 w-[200px]">공고명</th>
              <th className="py-3 px-2 w-24 text-center">대상 범위</th>
              <th className="py-3 px-2 w-[140px] text-center">운영 신청 기간</th>
              <th className="py-3 px-2 w-14 text-center border-l bg-slate-100/50 whitespace-nowrap">참여율</th>
              <th className="py-3 px-2 w-[72px] text-center bg-blue-50/50 text-blue-600 whitespace-nowrap">접수완료</th>
              <th className="py-3 px-2 w-[200px] text-center bg-red-50/50 text-red-600 border-r whitespace-nowrap">미접수인원</th>
              <th className="py-3 px-2 w-16 text-center">공고상태</th>
              <th className="py-3 px-2 w-[145px] text-center border-l border-slate-200 bg-slate-100/30 text-teal-600">게시제어(Edit)</th>
              <th className="py-3 pr-4 w-[120px] text-center bg-slate-100/30 text-slate-500">관리액션(Edit)</th>
            </tr>
          </thead>
          
          <tbody className="divide-y divide-slate-100 text-[11px]">
            {filteredSurveys.map((s, idx) => {
              const targetDepts = s.target.split(',').map((t: string) => t.trim());
              const targetUsers = users.filter((u) =>
                isOrgAllowed(targetDepts, u, { targetUnitIds: s.target_unit_ids })
              );
              const done = targetUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
              const total = targetUsers.length;
              const notDone = total - done;
              const rate = total > 0 ? Math.round((done / total) * 100) : 0;
              
              // 한국시간(KST) 기준 마감 비교
              const deadlinePassed = isPastKSTDeadline(s.endDate, s.endTime);
              const isExpiredStatus = s.status === '기간종료';
              const isPausedLike = s.status === '게시중단' || isExpiredStatus;
              const isTimeOver = isExpiredStatus || (s.status === '진행중' && deadlinePassed);
   
              return (
                <tr key={s.id} className={`h-14 transition-colors ${isTimeOver ? 'bg-red-50/20 hover:bg-red-50/40' : 'hover:bg-blue-50/20'}`}>
                  <td className="py-2 pl-4 text-center text-slate-400 font-medium align-middle">{idx + 1}</td>
                  <td className="py-2 px-2 font-mono font-medium text-slate-600 tracking-tighter align-middle whitespace-nowrap">{s.code}</td>
                  <td className="py-2 px-2 text-center align-middle">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${s.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700' : 'bg-amber-100 text-amber-700'}`}>
                      {s.deliveryType === 'ALWAYS' ? '상시' : '기간'}
                    </span>
                  </td>
                  <td className="py-2 px-2 font-mono text-center text-slate-500 tracking-tighter whitespace-nowrap align-middle">{s.postDate === '-' ? '' : s.postDate}</td>
                  
                  <td className="py-2 px-2 align-middle">
                    <button onClick={() => { setMetaModalPhase('detail'); setPreviewModal(s); }} className="font-medium text-slate-800 text-[11px] hover:text-indigo-600 hover:underline text-left line-clamp-1">{s.title}</button>
                    {/* 💡 (선택형 등) 유형 삭제 완료 */}
                  </td>
                  
                  <td className="py-2 px-2 font-medium text-slate-600 text-center align-middle">
                    <div className="text-[10px] leading-tight cursor-help truncate w-20 mx-auto" title={s.target}>
                      {s.target === '전사' ? '전사' : <span className="underline decoration-dashed decoration-slate-300">{s.target.split(',').length}개 부서 지정</span>}
                    </div>
                  </td>
                  
                  <td className="py-2 px-2 text-slate-500 tracking-tighter text-center text-[9px] whitespace-nowrap align-middle">
                    <div>{s.startDate} ~</div>
                    {/* 💡 공고상태에 있던 마감시간을 이곳(운영 신청 기간)으로 이동 완료 */}
                    <div className={isTimeOver ? 'text-red-500 font-medium' : ''}>{s.endDate} <span className="text-[8px]">({s.endTime || '23:59'})</span></div>
                  </td>
                  
                  <td className="py-2 px-2 text-center font-medium text-slate-700 border-l bg-slate-50/30 align-middle whitespace-nowrap">{rate}%</td>
                  <td className="py-2 px-2 text-center bg-blue-50/30 align-middle whitespace-nowrap">
                    <button onClick={() => handleMatrixFilter(s.id, 'DONE')} className="text-blue-600 font-medium hover:underline whitespace-nowrap">{done}명</button>
                  </td>
                  <td className="py-2 px-2 text-center bg-red-50/30 border-r align-middle">
                    <div className="flex items-center justify-center gap-2 w-full flex-nowrap whitespace-nowrap">
                      <button onClick={() => handleMatrixFilter(s.id, 'NOT_DONE')} className="text-red-500 font-medium hover:underline shrink-0 whitespace-nowrap">{notDone}명</button>
                      {s.status === '진행중' && notDone > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
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
                          <button onClick={() => handleCopyUnsubmittedEmails(s)} className="px-1.5 py-0.5 bg-white border border-slate-200 text-slate-600 rounded text-[9px] font-medium hover:bg-slate-50 transition-colors shadow-sm whitespace-nowrap">📧메일추출</button>
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
                    {/* 💡 공고상태 밑에 있던 마감시간 텍스트 삭제 완료 */}
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
                      <button onClick={() => handleStatusChange(s.id, 'ARCHIVE')} disabled={!canEdit || s.status !== '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-medium whitespace-nowrap transition-all shadow-sm border ${canEdit && s.status === '완료' ? 'bg-slate-800 text-white border-slate-800 hover:bg-slate-900' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>보관함이동</button>
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
      </div>
     
      {deliveryTab !== 'ALL' && (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden mt-6 animate-fade-in-up">
          <div className="p-4 px-6 bg-slate-900 flex justify-between items-center text-white">
            <div className="flex items-center gap-3">
              <h3 className="text-[12px] font-medium flex items-center gap-2">
                <span>🗂️</span> 부서 및 직원별 주소지/물품 접수 현황 보드
              </h3>
              {selectedCellKeys.size > 0 && (
                <span className="bg-amber-500 text-slate-900 px-2 py-0.5 rounded text-[9px] font-medium animate-bounce">
                  {selectedCellKeys.size}개 항목 선택됨
                </span>
              )}
            </div>
     
            <div className="flex gap-2 items-center">
              <button onClick={handleDownloadZipAll} disabled={!canEdit} className={`px-4 py-2 rounded-lg text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${canEdit ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-500 cursor-not-allowed opacity-60'}`}>
                <span>📥</span> 선택 ZIP 다운로드(Edit)
              </button>
              <button onClick={handleExportAnalysisAll} disabled={!canEdit} className={`px-4 py-2 rounded-lg text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${canEdit ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-slate-500 cursor-not-allowed opacity-60'}`}>
                <span>📈</span> 선택 Excel 다운로드(Edit)
              </button>
              <div className="w-px h-6 bg-white/20 mx-0.5" />
              <button
                onClick={handleExportResultAnalysis}
                disabled={!canEdit}
                className={`px-4 py-2 rounded-lg text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${canEdit ? 'bg-amber-500 hover:bg-amber-400 text-slate-900' : 'bg-slate-500 cursor-not-allowed opacity-60 text-white'}`}
                title="단일·다중·만족도 통계 + 그 외 유형 안내"
              >
                <span>📊</span> 결과 분석 다운로드(Edit)
              </button>
            </div>
          </div>
     
          <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead className="sticky top-0 z-20 bg-white shadow-sm">
                <tr className="border-b-2 border-slate-300">
                  <th className="py-2 pl-6 w-[280px] min-w-[280px] bg-slate-50 font-medium text-slate-500 text-[9px] align-bottom sticky left-0 z-30">
                    <div className="uppercase mb-1">소속 부서 / 이름</div>
                    <div className="flex gap-2 text-[8px] text-teal-600 font-medium">
                      <button onClick={collapseAll} className="hover:underline">전체 접기</button> <span className="text-slate-300">|</span> <button onClick={expandAll} className="hover:underline">전체 펼치기</button>
                    </div>
                  </th>
                  {filteredSurveys.map(s => {
                    const targetDepts = s.target.split(',').map((t: string) => t.trim());
                    const columnUsers = users.filter(
                      (u) =>
                        isOrgAllowed(targetDepts, u, { targetUnitIds: s.target_unit_ids }) &&
                        responses[`${s.id}_${u.email}`]?.isDone
                    );
                    const isColumnAllChecked = columnUsers.length > 0 && columnUsers.every(u => selectedCellKeys.has(`${s.id}_${u.email}`));
     
                    return (
                      <th key={s.id} className="p-0 border-l border-slate-200 bg-white align-top min-w-[320px]">
                        <div className="p-2 border-b border-slate-100 flex items-center justify-center bg-slate-50/30">
                          <label className="flex items-center gap-1.5 cursor-pointer group">
                            <input type="checkbox" checked={isColumnAllChecked} onChange={(e) => handleToggleColumnAll(s.id, e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer rounded" />
                            <div className="text-center">
                              <span className="font-medium text-slate-800 text-[10px] leading-tight group-hover:text-indigo-600">[{s.code}]</span><br />
                              <span className="line-clamp-1 text-slate-500 text-[9px] group-hover:text-indigo-500 mt-0.5">{s.title}</span>
                            </div>
                          </label>
                        </div>
                        <div className="grid grid-cols-[30px_1fr_1fr_1fr_70px] text-[9px] font-medium text-slate-500 bg-slate-50 border-b border-slate-100">
                          <div className="py-1.5 text-center border-r border-slate-100">선택</div>
                          <div className="py-1.5 text-center border-r border-slate-100 text-indigo-600">제출결과</div>
                          <div className="py-1.5 text-center border-r border-slate-100 text-amber-600">관리자의견전송</div>
                          <div className="py-1.5 text-center border-r border-slate-100 text-emerald-600">관리자확인완료</div>
                          <div className="py-1.5 text-center">관리</div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orderedDeptEntries.map(([dept, deptUsers]) => (
                  <Fragment key={dept}>
                    <tr className="bg-blue-100 cursor-pointer hover:bg-blue-200/80 border-b border-blue-200" onClick={() => toggleDept(dept)}>
                      <td className="py-2 pl-6 w-[280px] min-w-[280px] font-medium text-blue-900 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-blue-100"><span className="text-[8px] opacity-70 text-blue-700 mr-2">{collapsedDepts.has(dept) ? '▶' : '▼'}</span>{dept} <span className="text-[8px] text-blue-600/80 ml-1">{deptUsers.length}명</span></td>
                      {filteredSurveys.map(s => {
                        const targetDepts = s.target.split(',').map((t: string) => t.trim());
                        if (!isOrgAllowed(targetDepts, dept, { targetUnitIds: s.target_unit_ids })) return <td key={`ds-${s.id}`} className="py-2 border-l border-blue-200 text-center bg-blue-50/80 text-[10px] font-medium text-blue-300">-</td>;
                        const dDone = deptUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                        const dTotal = deptUsers.length;
                        return <td key={`ds-${s.id}`} className="py-2 border-l border-blue-200 text-center bg-blue-50/80"><div className="text-[9px] font-medium text-blue-800"><span className="text-blue-700 font-medium">{dDone}명</span> / {dTotal}명</div></td>
                      })}
                    </tr>
                    {!collapsedDepts.has(dept) && deptUsers.map(user => {
                      if (matrixUserFilter.type === 'DONE' && matrixUserFilter.surveyId && !responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
                      if (matrixUserFilter.type === 'NOT_DONE' && matrixUserFilter.surveyId && responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
     
                      return (
                        <tr key={user.id} className="hover:bg-slate-50 transition-colors border-b border-slate-50 h-12">
                          <td className="py-2 pl-10 pr-3 w-[280px] min-w-[280px] font-medium text-slate-700 border-r border-slate-50 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white">
                            <span className="inline-flex items-center gap-2">
                              <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                              <span>{user.name}</span>
                              <span className="text-[8px] text-slate-400 font-mono">{user.email.split('@')[0]}</span>
                            </span>
                          </td>
                          {filteredSurveys.map(s => {
                            const targetDepts = s.target.split(',').map((t: string) => t.trim());
                            if (!isOrgAllowed(targetDepts, user, { targetUnitIds: s.target_unit_ids })) return <td key={`${s.id}-${user.id}`} className="py-2 border-l border-slate-100 text-center text-[10px] font-medium text-slate-300">-</td>;
     
                            const cellKey = `${s.id}_${user.email}`;
                            const resp = responses[cellKey];
                            const hasFile = resp?.answers && Object.values(resp.answers).some((a: any) => a && a.fileName);
     
                            return (
                              <td key={`${s.id}-${user.id}`} className="p-0 border-l border-slate-100 align-middle h-full">
                                {resp?.isDone ? (
                                  <div className="grid grid-cols-[30px_1fr_1fr_1fr_70px] h-full min-h-[44px] items-center text-[10px] font-medium divide-x divide-slate-100 hover:bg-slate-50/50">
                                    <div className="flex items-center justify-center h-full">
                                      <input
                                        type="checkbox"
                                        checked={selectedCellKeys.has(cellKey)}
                                        onChange={(e) => {
                                          const next = new Set(selectedCellKeys);
                                          if (e.target.checked) next.add(cellKey); else next.delete(cellKey);
                                          setSelectedCellKeys(next);
                                        }}
                                        className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer"
                                      />
                                    </div>
                                    <div className="flex flex-col items-center justify-center h-full gap-1 p-1 text-center">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (!canEdit) {
                                            alert('권한이 없습니다.');
                                            return;
                                          }
                                          openTimelineModal(s, user);
                                        }}
                                        className={`text-[9px] font-medium tracking-tight ${
                                          canEdit
                                            ? 'text-indigo-600 hover:underline'
                                            : 'text-slate-300 cursor-not-allowed'
                                        }`}
                                      >
                                        제출결과보기
                                      </button>
                                      {hasFile && (
                                        <button onClick={(e) => {
                                          e.stopPropagation();
                                          const fileAns = Object.values(resp.answers || {}).find((a: any) => a && a.fileName);
                                          if (fileAns && (fileAns as any).fileData) fetch((fileAns as any).fileData).then(r => r.blob()).then(blob => saveAs(blob, (fileAns as any).fileName));
                                        }} className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 shadow-sm">📂 파일받기</button>
                                      )}
                                    </div>
                                    <div
                                      className={`flex items-center justify-center font-mono h-full text-[9px] ${resp.isRevoked ? 'text-red-600 font-medium cursor-pointer hover:underline' : resp.feedbackMsg ? 'text-amber-600 cursor-pointer hover:underline' : 'text-slate-300'}`}
                                      onClick={() => {
                                        if (resp.feedbackMsg) alert(`💡 [관리자 ${resp.isRevoked ? '확인 취소' : '보완 요청'} 사유]\n\n일자: ${resp.feedbackAt}\n사유: ${resp.feedbackMsg}`);
                                      }}
                                    >
                                      {resp.feedbackAt || '-'}
                                    </div>
                                    <div className="flex items-center justify-center font-mono text-emerald-600 h-full text-[9px]">
                                      {resp.isApproved ? resp.approvedAt : <span className="text-slate-300">-</span>}
                                    </div>
                                    <div className="flex flex-col justify-center gap-1 p-1 h-full">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (!canEdit) {
                                            alert('권한이 없습니다.');
                                            return;
                                          }
                                          toggleApprove(s.id, user.email);
                                        }}
                                        className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-all shadow-sm border ${
                                          !canEdit
                                            ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                            : resp.isApproved
                                              ? 'bg-slate-200 text-slate-500 border-slate-300 hover:bg-slate-300'
                                              : 'bg-slate-800 text-white border-slate-800 hover:bg-slate-900'
                                        }`}
                                      >
                                        {resp.isApproved ? '확인 취소' : '확인 처리'}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center h-full min-h-[44px]">
                                    <span className="text-[9px] font-medium text-slate-300">미신청</span>
                                  </div>
                                )}
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
      )}
     
{/* 🚀 상시/기간 결재 대기함 모달 */}
{pendingModalType && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-[900px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className={`p-6 ${pendingModalType === 'ALWAYS' ? 'bg-pink-600' : 'bg-amber-500'} text-white flex justify-between items-center`}>
              <div>
                <h3 className="font-medium text-lg flex items-center gap-2">
                  {pendingModalType === 'ALWAYS' ? '🌸 상시 신청 대기함' : '📅 기간 신청 대기함'}
                </h3>
                <p className={`text-xs ${pendingModalType === 'ALWAYS' ? 'text-pink-200' : 'text-amber-100'} mt-1`}>
                  총 {pendingModalType === 'ALWAYS' ? pendingAlwaysApprovals.length : pendingPeriodApprovals.length}건의 확인 대기 내역이 있습니다.
                </p>
              </div>
              <button onClick={() => setPendingModalType(null)} className="text-2xl opacity-80 hover:opacity-100">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
              {(pendingModalType === 'ALWAYS' ? pendingAlwaysApprovals : pendingPeriodApprovals).length === 0 ? (
                <div className="py-20 text-center text-slate-400 font-medium">대기 중인 결재 내역이 없습니다.</div>
              ) : (
                <div className="space-y-4">
                  {(pendingModalType === 'ALWAYS' ? pendingAlwaysApprovals : pendingPeriodApprovals).map((item, idx) => (
                    <div key={idx} className={`bg-white p-5 border ${pendingModalType === 'ALWAYS' ? 'border-pink-100' : 'border-amber-100'} rounded-2xl shadow-sm flex items-center justify-between`}>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`${pendingModalType === 'ALWAYS' ? 'bg-pink-100 text-pink-600' : 'bg-amber-100 text-amber-700'} px-2 py-0.5 rounded text-[9px] font-medium`}>확인요청</span>
                          <span className="font-medium text-slate-800 text-[13px]">
                            {item.user.name} 
                            <span className="text-[10px] text-slate-400 font-normal">({item.user.dept})</span>
                          </span>
                        </div>
                        <p className="font-medium text-slate-600 text-[11px] mb-1">[{item.survey.code}] {item.survey.title}</p>
                        <p className="text-[10px] font-mono text-slate-400">신청일시: {item.resp.fullDate}</p>
                      </div>
                      <div className="flex gap-2">
                      <button
    type="button"
    onClick={() => {
      if (!canEdit) {
        alert('권한이 없습니다.');
        return;
      }
      let storedQuestions = [];
      try {
        storedQuestions = typeof item.survey.questions === 'string'
          ? JSON.parse(item.survey.questions)
          : (item.survey.questions || []);
      } catch (e) {
        console.error("문항 파싱 오류:", e);
      }

      let parsedAnswers = item.resp.answers || {};
      if (typeof parsedAnswers === 'string') {
        try { parsedAnswers = JSON.parse(parsedAnswers); } catch(e) {}
      }

      const answersContent = storedQuestions
        .filter((q: any) => q.type !== 'SECTION')
        .map((q: any) => {
          let aStr = '미입력';

          if (q.type === 'SEARCH_ADDRESS') {
            const zip = parsedAnswers[`${q.id}_zip`] || parsedAnswers[q.id]?.zipCode;
            const road = parsedAnswers[`${q.id}_road`] || parsedAnswers[q.id]?.roadAddress;
            const detail = parsedAnswers[`${q.id}_detail`] || parsedAnswers[q.id]?.detailAddress;
            if (zip || road) aStr = `[${zip || ''}] ${road || ''} ${detail || ''}`;
          } else {
            const a = parsedAnswers[q.id];
            if (a !== undefined && a !== null && a !== '') {
              aStr = Array.isArray(a) ? a.join(', ') : (a.fileName || a);
            }
          }
          return `• ${q.title}\n  ➔ ${aStr}`;
        }).join('\n\n');

      alert(`📋 [${item.user.name} 직원 신청서]\n신청일시: ${item.resp.fullDate}\n\n${answersContent || '제출된 명세 내용이 없습니다.'}`);
    }}
    className={`px-4 py-2 rounded-xl text-[10px] font-medium shadow-sm border ${
      canEdit
        ? 'bg-white border-teal-200 text-teal-600 hover:bg-teal-50'
        : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
    }`}
  >
    🔍 응답결과 보기
  </button>

  <button
    type="button"
    onClick={() => {
      if (!canEdit) {
        alert('권한이 없습니다.');
        return;
      }
      handleSendFeedback(item.survey.id, item.user.email);
    }}
    className={`px-4 py-2 rounded-xl text-[10px] font-medium shadow-sm border ${
      canEdit
        ? 'bg-white border-amber-200 text-amber-600 hover:bg-amber-50'
        : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
    }`}
  >
    보완 요청
  </button>
  <button
    type="button"
    onClick={() => {
      if (!canEdit) {
        alert('권한이 없습니다.');
        return;
      }
      toggleApprove(item.survey.id, item.user.email);
    }}
    className={`px-4 py-2 rounded-xl text-[10px] font-medium shadow-sm ${
      canEdit
        ? 'bg-slate-800 text-white hover:bg-black'
        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
    }`}
  >
    최종 확인 처리
  </button>
</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
     
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
                <p className="text-[10px] font-medium text-slate-400">대상 공고</p>
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
                확인을 누르면 게시일·운영 기간이 확정되고, 배달 배포 및 관리 리스트에 게시됩니다.
              </p>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setPublishConfirmModal(null)} className="flex-1 py-2.5 bg-white border rounded-xl font-medium text-slate-600 hover:bg-slate-50">취소</button>
                <button type="button" onClick={() => void handleConfirmPublish()} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-medium shadow-md hover:bg-indigo-700">확인 후 게시</button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* 🚀 제출 결과 타임라인 모달 */}
{timelineModal && (
  <div
    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[320] flex items-center justify-center p-4"
    onMouseDown={(e) => {
      (e.currentTarget as HTMLElement).dataset.backdropDown =
        e.target === e.currentTarget ? '1' : '0';
    }}
    onClick={(e) => {
      if (
        e.target === e.currentTarget &&
        (e.currentTarget as HTMLElement).dataset.backdropDown === '1'
      ) {
        setTimelineModal(null);
        setDetailSnapshot(null);
      }
    }}
  >
    <div
      className="bg-white w-[720px] max-w-full rounded-[1.5rem] overflow-hidden shadow-2xl flex flex-col max-h-[88vh]"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-5 bg-slate-800 text-white flex justify-between items-start gap-3 shrink-0">
        <div>
          <h3 className="font-medium text-sm">제출 결과/관리자 의견 이력</h3>
          <p className="text-[11px] text-slate-300 mt-1 font-medium">
            {timelineModal.user.name}
            <span className="text-slate-400 font-normal"> ({timelineModal.user.dept})</span>
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            [{timelineModal.survey.code}] {timelineModal.survey.title}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setTimelineModal(null); setDetailSnapshot(null); }}
          className="text-2xl opacity-80 hover:opacity-100 leading-none"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2 px-2 text-[10px] font-medium text-slate-500 uppercase tracking-wide">
          <div>사용자 신청</div>
          <div className="text-right">관리자 처리</div>
        </div>

        {timelineLoading ? (
          <div className="py-16 text-center text-slate-400 text-xs font-medium">이력을 불러오는 중…</div>
        ) : buildTimelineRows(timelineEvents).length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs font-medium">제출 이력이 없습니다.</div>
        ) : (
          buildTimelineRows(timelineEvents).map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-2 gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm"
            >
              <div className="min-w-0">
                {row.user ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDetailSnapshot({
                        title: `${userSubmitLabel(row.user.revisionNo)} (${getKSTDateString(row.user.createdAt)})`,
                        answers: row.user.answers,
                        survey: timelineModal.survey,
                      })
                    }
                    className="text-left w-full group"
                  >
                    <span className={`text-[11px] font-medium group-hover:underline ${
                      (row.user.revisionNo || 1) > 1 ? 'text-red-600' : 'text-slate-700'
                    }`}>
                      {userSubmitLabel(row.user.revisionNo)}
                    </span>
                    <span className="block text-[10px] font-mono text-slate-400 mt-0.5">
                      {getKSTDateString(row.user.createdAt)}
                    </span>
                    <span className="block text-[9px] text-indigo-500 font-medium mt-1">클릭 → 제출 내용 확인</span>
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-300 font-medium">—</span>
                )}
              </div>
              <div className="min-w-0 text-right space-y-2">
                {row.admins.length === 0 ? (
                  <span className="text-[10px] text-slate-300 font-medium">—</span>
                ) : (
                  row.admins.map((ad: any) => (
                    <button
                      key={ad.id}
                      type="button"
                      onClick={() => {
                        if (ad.message) {
                          alert(
                            `💡 [${adminEventLabel(ad.type)}]\n\n일자: ${getKSTDateString(ad.createdAt)}\n사유: ${ad.message}`
                          );
                        }
                      }}
                      className={`block w-full text-right ${ad.message ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                    >
                      <span className={`text-[11px] font-medium ${
                        ad.type === 'ADMIN_APPROVE'
                          ? 'text-emerald-600'
                          : ad.type === 'ADMIN_CANCEL'
                            ? 'text-red-600'
                            : 'text-amber-600'
                      }`}>
                        {adminEventLabel(ad.type)}
                      </span>
                      <span className="block text-[10px] font-mono text-slate-400 mt-0.5">
                        {getKSTDateString(ad.createdAt)}
                      </span>
                      {ad.message && (
                        <span className="block text-[9px] text-slate-500 mt-0.5 line-clamp-2 text-right">
                          {ad.message}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          ))
        )}

        {detailSnapshot && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-[11px] font-medium text-indigo-800">{detailSnapshot.title} 내용</h4>
              <button
                type="button"
                onClick={() => setDetailSnapshot(null)}
                className="text-[10px] font-medium text-indigo-500 hover:underline"
              >
                닫기
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-[11px] font-medium text-slate-700 leading-relaxed">
              {formatAnswersLines(detailSnapshot.survey, detailSnapshot.answers) || '제출된 명세 내용이 없습니다.'}
            </pre>
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-slate-200 flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => handleSendFeedback(timelineModal.survey.id, timelineModal.user.email)}
          disabled={!!responses[timelineModal.cellKey]?.isApproved}
          className={`flex-1 py-2.5 rounded-xl text-[11px] font-medium border shadow-sm ${
            responses[timelineModal.cellKey]?.isApproved
              ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
              : 'bg-white border-amber-200 text-amber-600 hover:bg-amber-50'
          }`}
        >
          보완 요청
        </button>
        <button
          type="button"
          onClick={() => toggleApprove(timelineModal.survey.id, timelineModal.user.email)}
          className={`flex-1 py-2.5 rounded-xl text-[11px] font-medium border shadow-sm ${
            responses[timelineModal.cellKey]?.isApproved
              ? 'bg-slate-200 text-slate-500 border-slate-300 hover:bg-slate-300'
              : 'bg-slate-800 text-white border-slate-800 hover:bg-slate-900'
          }`}
        >
          {responses[timelineModal.cellKey]?.isApproved ? '확인 취소' : '확인 처리'}
        </button>
      </div>
    </div>
  </div>
)}

{/* 🚀 미참여자 독촉 알림 모달 */}
{nudgeModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4"
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
            className="bg-white w-[400px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col animate-fade-in-up"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 bg-red-50 text-red-600 flex justify-between items-center border-b border-red-100">
              <h3 className="font-medium text-sm flex items-center gap-2">🔔 미참여자 독촉 알림 발송</h3>
              <button onClick={() => setNudgeModal(null)} className="text-xl opacity-70 hover:opacity-100">✕</button>
            </div>
            <div className="p-6 text-center space-y-4 bg-white">
              <div className="text-5xl animate-bounce mt-2">🚨</div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 mb-1 line-clamp-1">[{nudgeModal.title}]</p>
                <p className="text-sm font-medium text-slate-800 leading-snug mt-3">
                  아직 명세를 제출하지 않은 <span className="text-red-600 text-lg">{nudgeModal.count}명</span>에게<br/>
                  제출 독촉(리마인드) 알림을 전송하시겠습니까?
                </p>
                <p className="text-[9px] text-slate-400 mt-2 font-medium">전송 시 해당 임직원의 대시보드와 메일로 알림이 갑니다.</p>
              </div>
              <div className="pt-5 flex gap-2 border-t border-slate-100 mt-4">
              <button 
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/survey/delivery', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          action: 'NUDGE', 
                          surveyId: nudgeModal.surveyId,
                          title: nudgeModal.title,
                          targetEmails: nudgeModal.targetEmails,
                          menuPath: pathname,
                        })
                      });
                      
                      if (res.ok) {
                        const saved = await res.json();
                        const nudgedCount = typeof saved.nudgedCount === 'number' ? saved.nudgedCount : nudgeModal.count;
                        setSurveys(prev => prev.map(s =>
                          s.id === nudgeModal.surveyId
                            ? {
                                ...s,
                                nudgedUsers: Array.isArray(saved.nudgedUsers)
                                  ? saved.nudgedUsers
                                  : Array.from(new Set([...(s.nudgedUsers || []), ...(nudgeModal.targetEmails || [])])),
                              }
                            : s
                        ));
                        alert(`✅ 미참여자 ${nudgedCount}명에게 독촉 알림이 전송되었습니다.`);
                        setNudgeModal(null);
                      } else {
                        alert('❌ 전송 중 서버 오류가 발생했습니다.');
                      }
                    } catch (e) {
                      console.error(e);
                      alert('❌ 네트워크 오류가 발생했습니다.');
                    }
                  }}
                  className="flex-[1.5] py-3 bg-red-500 text-white rounded-xl text-xs font-medium shadow-lg shadow-red-200 hover:bg-red-600 transition-all"
                >
                  🚀 즉시 알림 발송
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
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
            className="bg-white w-[600px] min-w-[600px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col transition-[max-height] duration-300"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 bg-sky-100 border-b border-sky-200 flex justify-between items-center">
              <h3 className="font-medium text-sm text-slate-800">
                {metaModalPhase === 'create' ? '배달 기본 정보 추가' : '게시 상세 설정'}
              </h3>
              <button type="button" onClick={() => setPreviewModal(null)} className="text-xl text-slate-400 hover:text-slate-700 transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-4 bg-slate-50 flex-1 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="text-[10px] font-medium text-slate-500">식별코드{metaModalPhase === 'create' ? ' (자동부여)' : ''}</label>
                <input type="text" value={previewModal.code || ''} readOnly className="w-full p-2 border rounded text-xs font-mono font-medium bg-slate-100 text-slate-500 outline-none cursor-not-allowed" />
              </div>
              <div><label className="text-[10px] font-medium text-slate-500">제목</label><input type="text" value={previewModal.title} readOnly={!canEditMeta} onChange={e => canEditMeta && setPreviewModal({ ...previewModal, title: e.target.value })} className={`w-full p-2 border rounded text-xs font-medium outline-none ${canEditMeta ? 'focus:border-indigo-500' : 'bg-slate-100 text-slate-600 cursor-default'}`} /></div>
              <div><label className="text-[10px] font-medium text-slate-500">설명</label><textarea value={previewModal.description} readOnly={!canEditMeta} onChange={e => canEditMeta && setPreviewModal({ ...previewModal, description: e.target.value })} className={`w-full p-2 border rounded text-xs outline-none min-h-[80px] ${canEditMeta ? 'focus:border-indigo-500' : 'bg-slate-100 text-slate-600 cursor-default'}`} /></div>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-3">
                <div>
                  <label className="text-[9px] font-medium text-indigo-500 mb-1 block">신청분류 (상시/기간)</label>
                  <select
                    value={previewModal.deliveryType || 'ALWAYS'}
                    disabled={!canEditMeta}
                    onChange={(e) => canEditMeta && setPreviewModal({ ...previewModal, deliveryType: e.target.value })}
                    className={`w-full p-2 rounded-lg border text-[11px] font-medium outline-none bg-white focus:border-indigo-500 ${!canEditMeta ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
                  >
                    <option value="ALWAYS">상시 신청</option>
                    <option value="PERIOD">기간 신청</option>
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
                  onClick={() => {
                    if (metaModalPhase !== 'create' && previewModal.status === '진행중') {
                      alert('진행 중에는 기본 정보를 수정할 수 없습니다.\n게시 내리기 후 수정해 주세요.');
                      return;
                    }
                    void handleSavePreview();
                  }}
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
                    <Link href={`/survey/delivery/admin/survey-builder?id=${previewModal.id}`} className="px-5 py-3 bg-indigo-600 text-white rounded-xl text-[11px] font-medium shadow-md hover:bg-indigo-700 block w-fit mx-auto">🛠️ 서식지 빌더(Builder) 열기</Link>
                    <p className="text-[10px] text-indigo-500 font-medium mt-3">Builder에서 구체적인 질문 문항을 구성할 수 있습니다.</p>
                  </div>
         
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <label className="text-[10px] font-medium text-slate-500 block mb-2">🔗 모바일/웹 배포 링크</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${typeof window !== 'undefined' ? window.location.origin : ''}/survey/public/${previewModal.id}?domain=delivery`}
                        className="flex-1 p-2 bg-slate-100 rounded border border-slate-200 text-xs font-mono text-slate-500 outline-none"
                      />
                      <button
                        onClick={() => {
                          const link = `${window.location.origin}/survey/public/${previewModal.id}?domain=delivery`;
                          navigator.clipboard.writeText(link);
                          alert('배달 신청 배포 링크가 클립보드에 복사되었습니다!');
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
                        ? '게시된 공고는 현황판에서 삭제할 수 없습니다. 보관함에서 삭제를 사용하세요.'
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