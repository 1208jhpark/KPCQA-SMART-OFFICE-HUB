'use client';

import { isSystemLv1User } from '@/lib/permission-utils';
     
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation'; 
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getKSTDateString } from '@/utils/dateUtils'; // 🚀 공통 KST 날짜 유틸 적용
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
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
import {
  downloadExcelArrayBuffer,
  makeSurveyPctBar,
  surveyQuestionTypeLabel,
  writeSurveyHistoryListExcelBuffer,
  writeSurveyResponseExcelBuffer,
  writeSurveyResultAnalysisExcelBuffer,
  type SurveyExcelAnswerSource,
  type SurveyExcelQuestion,
  type SurveyHistoryListHeader,
  type SurveyStatBlock,
} from '@/lib/survey-general-active-excel';
     
export default function AdminSurveyHistoryModule() {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(SURVEY_GENERAL_ADMIN_TABS, '/survey/general/admin'); 
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]); // 🚀 부서 계층 연산용 상태 추가
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
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [searchTitleQuery, setSearchTitleQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionMenu, setActionMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const availableMonths = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  
  const fetchArchiveData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      // 🚀 데이터 로딩 병렬 처리 (설문관리 컨텍스트로 LV_2 허용)
      const [surveyRes, ctxRes, meRes, respRes] = await Promise.all([
        fetch(`/api/survey/general?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/survey/general?t=${ts}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_ADMIN_CONTEXT', menuPath: pathname }),
          cache: 'no-store',
        }).catch(() => null),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/survey/general', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_RESPONSES', includeAnonymousAnswers: true }),
          cache: 'no-store'
        }).catch(() => null)
      ]);
     
      if (surveyRes && surveyRes.ok) setSurveys(await surveyRes.json());
      else setSurveys([]);

      if (meRes && meRes.ok) setCurrentUser(await meRes.json());

      if (ctxRes && ctxRes.ok) {
        const ctx = await ctxRes.json();
        setUnitsList(ctx.units || []);
        setUsers(ctx.users || []);
        setCanEdit(!!ctx.canEdit);
        setPermissionSummary(ctx.permissionSummary || null);
      } else {
        setCanEdit(false);
        setPermissionSummary(null);
      }
  
      if (respRes && respRes.ok) {
        const dbPayload = await respRes.json();
        const { responses: dbResponses, anonymousParticipationCounts: anonCounts } =
          normalizeGeneralResponsesPayload(dbPayload);
        setAnonymousParticipationCounts(anonCounts);
        setResponses(buildAdminResponseMap(dbResponses, getKSTDateString));
      }
    } catch (error) { 
      console.error("아카이브 마스터 인프라 동기화 실패:", error); 
    } finally { 
      setLoading(false); 
    }
  };
     
  useEffect(() => {
    fetchArchiveData();
  }, [pathname]);
     
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
  
  const filteredHistory = useMemo(() => {
    const q = searchTitleQuery.trim().toLowerCase();
    const list = archivedSurveys.filter((h) => {
      const dateStr = String(h.endDate || h.postDate || '');
      const [y = '', m = ''] = dateStr.split('-');
      const yearMatch = selectedYear === 'ALL' || y === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || m === selectedMonth;
      const titleMatch = !q || String(h.title || '').toLowerCase().includes(q);
      return yearMatch && monthMatch && titleMatch;
    });
    // 최신 보관/갱신 건이 맨 위 (NO도 큰 수 → 상단)
    return list.sort((a, b) => {
      const at = new Date(a.updatedAt || a.endDate || a.postDate || 0).getTime();
      const bt = new Date(b.updatedAt || b.endDate || b.postDate || 0).getTime();
      if (bt !== at) return bt - at;
      return String(b.code || '').localeCompare(String(a.code || ''), 'ko', { numeric: true });
    });
  }, [archivedSurveys, selectedYear, selectedMonth, searchTitleQuery]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedYear, selectedMonth, searchTitleQuery]);

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
  
  const getTargetUsers = (survey: { target?: string | null; target_unit_ids?: unknown }) => {
    return users.filter((u) =>
      userInSurveyTarget({
        userUnitId: u.unit_id,
        userDeptName: u.dept,
        target: survey?.target,
        targetUnitIds: survey?.target_unit_ids,
        units: unitsList,
      })
    );
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
  
  const requireEdit = () => {
    if (canEdit) return true;
    alert('편집·다운로드 권한이 없습니다.\n(interface: Task Editor 또는 Editor Level)');
    return false;
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
    return getTargetUsers(survey)
      .filter((u) => responses[`${survey.id}_${u.email}`]?.isDone)
      .map((u) => ({
        dept: u.dept || '-',
        name: u.name || '-',
        date: responses[`${survey.id}_${u.email}`]?.date || '-',
        answers: (responses[`${survey.id}_${u.email}`]?.answers || {}) as Record<string, unknown>,
      }));
  };

  /** 단일 설문 결과 분석 — 현황판과 동일 양식 */
  const handleDownloadResultAnalysis = async (survey: any) => {
    if (!requireEdit()) return;

    let parsedQuestions: any[] = [];
    try {
      parsedQuestions =
        typeof survey.questions === 'string' ? JSON.parse(survey.questions) : survey.questions || [];
    } catch {
      parsedQuestions = [];
    }

    const GUIDE_MSG = 'ZIP 또는 Excel을 다운받아 확인바랍니다.';
    const answerSources = collectSurveyAnswerSources(survey);
    if (answerSources.length === 0) {
      return alert('본 설문에 제출된 응답이 없습니다.');
    }

    const exportQuestions = parsedQuestions.filter((q: any) => {
      if (!q || q.type === 'SECTION') return false;
      if (typeof q.allowAnalysis === 'boolean') return q.allowAnalysis;
      return q.type === 'CHOICE_SINGLE' || q.type === 'CHOICE_MULTI' || q.type === 'SCALE';
    });
    if (exportQuestions.length === 0) {
      return alert('분석 허용된 문항이 없습니다.\n빌더에서 문항별 「분석 허용」을 켠 뒤 다시 시도해주세요.');
    }

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

    try {
      const buffer = await writeSurveyResultAnalysisExcelBuffer([
        {
          title: String(survey.title || survey.code || '설문'),
          responseCount: answerSources.length,
          blocks,
          textQuestions: exportQuestions.filter(
            (q: any) => q.type === 'TEXT_SHORT' || q.type === 'TEXT_LONG'
          ) as SurveyExcelQuestion[],
          sources: answerSources,
        },
      ]);
      const safeTitle = String(survey.title || survey.code || '설문')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .substring(0, 30);
      downloadExcelArrayBuffer(buffer, `설문결과분석_${safeTitle}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };

  const handleRestore = async (id: string) => {
    if (!requireEdit()) return;
    if (!confirm('이 설문을 운영 현황판으로 복원하시겠습니까?\n복원 즉시 [게시중단] 상태로 메인 현황판에 인입되며, 관리자가 기간을 수정한 후 다시 게시할 수 있습니다.')) return;
    const surveyToRestore = surveys.find(s => s.id === id);
    if (!surveyToRestore) return;
    const updatedSurvey = { ...surveyToRestore, status: '게시중단', menuPath: pathname };
     
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
     
  const handlePermanentDeleteSelected = async () => {
    if (!isLv1) {
      alert('영구 삭제는 LV_1만 가능합니다.');
      return;
    }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      alert('삭제할 항목을 체크박스로 선택해 주세요.');
      return;
    }
    if (
      !confirm(
        `경고: 선택한 ${ids.length}건의 보관 설문을 영구 삭제하시겠습니까?\n모든 정보와 이력이 완전히 유실되며 복구할 수 없습니다.`
      )
    ) {
      return;
    }
    try {
      let ok = 0;
      let fail = 0;
      for (const id of ids) {
        const res = await fetch(`/api/survey/general?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) ok += 1;
        else fail += 1;
      }
      setSelectedIds(new Set());
      await fetchArchiveData();
      if (fail === 0) {
        alert(`${ok}건이 시스템에서 영구 삭제되었습니다.`);
      } else {
        alert(`삭제 완료 ${ok}건, 실패 ${fail}건이 발생했습니다.`);
      }
    } catch {
      alert('네트워크 오류가 발생했습니다.');
    }
  };
     
  /** 단일 설문 개별응답 — 현황판과 동일 양식 */
  const handleDownloadSingleExcel = async (survey: any) => {
    if (!requireEdit()) return;
    let parsedQuestions: any[] = [];
    try {
      parsedQuestions =
        typeof survey.questions === 'string' ? JSON.parse(survey.questions) : survey.questions || [];
    } catch (e) {
      console.error('문항 데이터 파싱 실패:', e);
    }
    const questions = (
      parsedQuestions.length > 0
        ? parsedQuestions
        : [{ id: 'q1', title: '1. 의견 및 건의사항', type: 'TEXT_LONG' }]
    ).filter((q: any) => q && q.type !== 'SECTION') as SurveyExcelQuestion[];

    const sources = collectSurveyAnswerSources(survey);
    if (sources.length === 0) {
      return alert('본 설문에 접수된 완료 데이터가 없어 엑셀을 도출할 수 없습니다.');
    }

    try {
      const buffer = await writeSurveyResponseExcelBuffer([
        {
          title: String(survey.title || survey.code || '설문'),
          questions,
          sources,
        },
      ]);
      const safeTitle = String(survey.title || survey.code || '설문')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .substring(0, 30);
      downloadExcelArrayBuffer(buffer, `설문개별응답_${safeTitle}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };
  
  const handleDownloadZip = async (survey: any) => {
    if (!requireEdit()) return;
    const zip = new JSZip();

    const safeFolderTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-');
    const folder = zip.folder(safeFolderTitle);
    let storedQuestions = [];
    try {
      storedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []);
    } catch (e) {
      console.error("문항 데이터 파싱 실패:", e);
    }

    const writeOne = (identifier: string, submitterLabel: string, resp: { date?: string; answers?: any }) => {
      const fileNameBase = `${identifier}_${safeFolderTitle}`;
      let content = `■ 설문명: ${survey.title}\n■ 제출자: ${submitterLabel}\n■ 제출일: ${resp.date || '-'}\n------------------------------------------\n\n`;
      let qNum = 1;
      storedQuestions.forEach((q: any) => {
        if (q.type === 'SECTION') return;
        content += `Q${qNum++}. ${q.title}\n`;
        const ansData = resp.answers ? resp.answers[q.id] : null;
        if (ansData && ansData.fileName) {
          content += `A. [첨부파일] ${ansData.fileName} (별도 파일로 추출됨)\n\n`;
          if (ansData.fileData) {
            const base64Data = ansData.fileData.split(',')[1];
            folder?.file(`${identifier}_${ansData.fileName}`, base64Data, { base64: true });
          }
        } else {
          content += `A. ${formatAnswerForExport(ansData)}\n\n`;
        }
      });
      folder?.file(`${fileNameBase}_응답요약.txt`, "\ufeff" + content);
    };

    if (survey.isAnonymous) {
      const anonRows = listAnonymousContentRows(responses, survey.id);
      if (anonRows.length === 0) return alert("제출된 응답이 없습니다.");
      alert(`${anonRows.length}명의 데이터를 압축 파일로 생성합니다. 잠시만 기다려주세요...`);
      anonRows.forEach((resp, idx) => writeOne(`익명응답자_${idx + 1}`, '익명', resp));
    } else {
      const targetUsers = getTargetUsers(survey);
      const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
      if (submittedUsers.length === 0) return alert("제출된 응답이 없습니다.");
      alert(`${submittedUsers.length}명의 데이터를 압축 파일로 생성합니다. 잠시만 기다려주세요...`);
      submittedUsers.forEach((user) => {
        const resp = responses[`${survey.id}_${user.email}`];
        writeOne(`${user.dept}_${user.name}`, `${user.dept} ${user.name}`, resp);
      });
    }
  
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `[응답전체모음]_${safeFolderTitle}.zip`);
  };
  
  const handleExportListExcel = async () => {
    if (!requireEdit()) return;
    const target = selectedIds.size > 0
      ? filteredHistory.filter((h) => selectedIds.has(h.id))
      : filteredHistory;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData: Array<Record<SurveyHistoryListHeader, string | number>> = target.map((h, idx) => {
      const targetUsers = getTargetUsers(h);
      const total = targetUsers.length;
      const done = h.isAnonymous
        ? getAnonymousDoneCount(h.id, anonymousParticipationCounts, responses)
        : targetUsers.filter((u) => responses[`${h.id}_${u.email}`]?.isDone).length;

      return {
        NO: target.length - idx,
        식별코드: h.code || '-',
        게시일: h.postDate || '-',
        게시명: h.title || '-',
        유형: h.type || '-',
        익명여부: h.isAnonymous ? '익명' : '기명',
        대상: h.target || '-',
        시작일: h.startDate || '-',
        종료일: h.endDate || '-',
        참여율: total > 0 ? Math.round((done / total) * 100) + '%' : '0%',
        참여인원: done,
        미참여인원: Math.max(0, total - done),
      };
    });
    try {
      const buffer = await writeSurveyHistoryListExcelBuffer(exportData);
      const yearLabel = selectedYear === 'ALL' ? '전체' : `${selectedYear}년`;
      downloadExcelArrayBuffer(buffer, `설문조사_보관이력_${yearLabel}.xlsx`);
    } catch {
      alert('엑셀 다운로드에 실패했습니다.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const currentHistory = filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleSelectAll = () => {
    const currentPageIds = currentHistory.map((h) => h.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach((id) => next.delete(id));
    else currentPageIds.forEach((id) => next.add(id));
    setSelectedIds(next);
  };

  const colSpan = 13;
  
  if (loading) return <LoadingState />;
  
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 — client-search와 동일 */}
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-emerald-400 mb-2.5">
            ARCHIVED SURVEY INVENTORY
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-white font-medium">종료 조사 아카이브 (보관함)</span>
          </h1>
          <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
            공고 기한이 마감되어 최종 보관 처리된 과거 `조사 명세와 누적 응답 데이터 대장입니다.
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

      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-medium text-slate-800 tracking-tight">종료·보관 조사 명세 대장</h2>
            <span className="text-[11px] font-medium bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredHistory.length}건</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isLv1 && (
              <button
                type="button"
                onClick={() => void handlePermanentDeleteSelected()}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-medium shadow-sm transition-all whitespace-nowrap border ${
                  selectedIds.size > 0
                    ? 'bg-white border-red-200 text-red-600 hover:bg-red-50'
                    : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                }`}
                title="체크한 보관 설문을 영구 삭제합니다. (LV_1)"
              >
                {selectedIds.size > 0 ? `선택 삭제(LV_1) ${selectedIds.size}` : '선택 삭제(LV_1)'}
              </button>
            )}
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-medium text-slate-400 uppercase">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

              <span className="text-[10px] font-medium text-slate-400 uppercase">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{month}월</option>
                ))}
              </select>
            </div>

            <div className="relative w-44">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input
                type="text"
                placeholder="게시명 검색..."
                value={searchTitleQuery}
                onChange={(e) => setSearchTitleQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleExportListExcel()}
              disabled={!canEdit}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-medium shadow-sm transition-all whitespace-nowrap ${canEdit ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
            >
              {selectedIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedIds.size})`
                : '화면 목록 EXCEL 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-medium min-w-[1400px]">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-medium uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="py-3 pl-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={currentHistory.length > 0 && currentHistory.every((h) => selectedIds.has(h.id))}
                    onChange={toggleSelectAll}
                    className="accent-indigo-600 cursor-pointer w-3.5 h-3.5"
                  />
                </th>
                <th className="py-3 px-2 w-10 text-center">NO</th>
                <th className="py-3 px-2 w-28 text-left">식별코드</th>
                <th className="py-3 px-2 w-20 text-center">게시일</th>
                <th className="py-3 px-2 w-[220px] text-left">게시명</th>
                <th className="py-3 px-2 w-14 text-center text-slate-800">익명여부</th>
                <th className="py-3 px-2 w-24 text-center">대상</th>
                <th className="py-3 px-2 w-32 text-center">기간</th>
                <th className="py-3 px-2 w-12 text-center border-l bg-slate-100/50">참여율</th>
                <th className="py-3 px-2 w-12 text-center bg-blue-50/50 text-blue-600">참여</th>
                <th className="py-3 px-2 w-14 text-center bg-red-50/50 text-red-600 border-r">미참여</th>
                <th className="py-3 px-2 w-56 text-center border-l border-slate-200">응답 관리(Edit)</th>
                <th className="py-3 pr-4 w-10 text-center">⋮</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="py-20 text-center text-slate-400 font-medium text-sm">
                    조건에 맞는 보관 조사가 없습니다.
                  </td>
                </tr>
              ) : currentHistory.map((s, i) => {
                const targetUsers = getTargetUsers(s);
                const total = targetUsers.length;
                const done = s.isAnonymous
                  ? getAnonymousDoneCount(s.id, anonymousParticipationCounts, responses)
                  : targetUsers.filter((u) => responses[`${s.id}_${u.email}`]?.isDone).length;
                const notDone = Math.max(0, total - done);
                const rate = total > 0 ? Math.round((done / total) * 100) : 0;

                return (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors h-12 group">
                    <td className="py-2 pl-4 text-center align-middle">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => {
                          const next = new Set(selectedIds);
                          selectedIds.has(s.id) ? next.delete(s.id) : next.add(s.id);
                          setSelectedIds(next);
                        }}
                        className="accent-indigo-600 cursor-pointer w-3.5 h-3.5"
                      />
                    </td>
                    <td className="py-2 text-center text-slate-400 font-medium align-middle tabular-nums">{filteredHistory.length - ((currentPage - 1) * itemsPerPage + i)}</td>
                    <td className="py-2 px-2 text-left font-mono font-medium text-slate-600 tracking-tighter align-middle whitespace-nowrap">{s.code}</td>
                    <td className="py-2 px-2 font-mono text-center text-slate-500 whitespace-nowrap align-middle tabular-nums">{s.postDate || '-'}</td>
                    <td className="py-2 px-2 text-left align-middle">
                      <div className="font-medium text-slate-800 text-[11px] line-clamp-1">{s.title}</div>
                    </td>
                    <td className="py-2 px-2 text-center align-middle">
                      {s.isAnonymous ? (
                        <span className="px-1.5 py-0.5 bg-slate-700 text-white text-[9px] font-medium rounded">익명</span>
                      ) : (
                        <span className="px-1.5 py-0.5 border border-slate-300 text-slate-500 text-[9px] font-medium rounded">기명</span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-medium text-slate-600 align-middle text-center">
                      <div className="text-[10px] leading-tight truncate w-20 mx-auto" title={s.target}>
                        {s.target === '전사' ? '전사' : <span className="underline decoration-dashed decoration-slate-300">{s.target.split(',').length}개 부서 지정</span>}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-slate-500 tracking-tighter text-center text-[9px] whitespace-nowrap align-middle"><div>{s.startDate} ~</div><div>{s.endDate}</div></td>
                    <td className="py-2 px-2 text-center font-medium text-slate-700 border-l bg-slate-50/30 align-middle tabular-nums">{rate}%</td>
                    <td className="py-2 px-2 text-center text-blue-600 font-medium bg-blue-50/30 align-middle tabular-nums">{done}명</td>
                    <td className="py-2 px-2 text-center text-red-500 font-medium bg-red-50/30 border-r align-middle tabular-nums">{notDone}명</td>
                    <td className="py-2 px-2 align-middle border-l border-slate-200">
                      <div className="flex items-center justify-center gap-1 max-w-[220px] mx-auto">
                        <button onClick={() => handleDownloadZip(s)} disabled={!canEdit} className={`flex-1 py-1.5 rounded-lg shadow-sm transition-all font-medium text-[9px] whitespace-nowrap flex items-center justify-center gap-0.5 border ${canEdit ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}>
                          ZIP
                        </button>
                                                <button onClick={() => void handleDownloadSingleExcel(s)} disabled={!canEdit} className={`flex-1 py-1.5 rounded-lg shadow-sm transition-all font-medium text-[9px] whitespace-nowrap flex items-center justify-center gap-0.5 border ${canEdit ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-600 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}>
                          Excel
                        </button>
                        <Link
                          href={`/survey/general/admin/survey-builder?id=${encodeURIComponent(s.id)}&from=history`}
                          title="빌더에서 조사 원문 확인 · 엑셀 다운로드"
                          className="flex-1 py-1.5 rounded-lg shadow-sm transition-all font-medium text-[9px] whitespace-nowrap flex items-center justify-center border bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-500 hover:text-white"
                        >
                          조사원문
                        </Link>
                        <button
                          type="button"
                          onClick={() => void handleDownloadResultAnalysis(s)}
                          disabled={!canEdit}
                          title="선택·만족도 빈도·비율 분석 엑셀"
                          className={`flex-1 py-1.5 rounded-lg shadow-sm transition-all font-medium text-[9px] whitespace-nowrap flex items-center justify-center border ${canEdit ? 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-800 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                        >
                          분석결과
                        </button>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-center align-middle">
                      <button
                        type="button"
                        data-action-kebab
                        title="더보기"
                        onClick={(e) => openActionMenu(e, s.id)}
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredHistory.length > 0 && (
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      {actionMenu &&
        createPortal(
          <div
            ref={actionMenuRef}
            style={{ top: actionMenu.top, left: actionMenu.left }}
            className="fixed z-[500] w-[168px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-left"
          >
            <button
              type="button"
              disabled={!canEdit}
              title={!canEdit ? '복원 권한이 없습니다. (Edit)' : '현황판으로 복원 (게시중단)'}
              className={`w-full px-3 py-2 text-left text-[11px] font-medium ${
                canEdit ? 'text-slate-700 hover:bg-slate-50' : 'text-slate-400 cursor-not-allowed'
              }`}
              onClick={() => {
                if (!canEdit) return;
                const id = actionMenu.id;
                setActionMenu(null);
                void handleRestore(id);
              }}
            >
              복원(Edit)
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}