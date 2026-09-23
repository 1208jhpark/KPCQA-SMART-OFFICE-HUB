'use client';

import { isSystemLv1User } from '@/lib/permission-utils';
     
import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation'; 
import Link from 'next/link';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getKSTDateString } from '@/utils/dateUtils'; // 🚀 공통 KST 날짜 유틸 적용
import LoadingState from '@/components/common/LoadingState';
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
      return (Number(b.postNumber) || 0) - (Number(a.postNumber) || 0);
    });
  }, [archivedSurveys, selectedYear, selectedMonth, searchTitleQuery]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedYear, selectedMonth, searchTitleQuery]);
  
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
  
  const requireEdit = () => {
    if (canEdit) return true;
    alert('편집·다운로드 권한이 없습니다.\n(interface: Task Editor 또는 Editor Level)');
    return false;
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
    return type || '-';
  };

  /** 조사원문 — 원문텍스트 시트만 (빌더 질문·옵션) */
  const handleDownloadQuestionnaireOriginal = async (survey: any) => {
    if (!requireEdit()) return;

    let fresh = survey;
    try {
      const res = await fetch(`/api/survey/general?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const all = await res.json();
        const found = Array.isArray(all) ? all.find((s: any) => s.id === survey.id) : null;
        if (found) fresh = found;
      }
    } catch {
      /* 목록 객체로 폴백 */
    }

    let questions: any[] = [];
    try {
      const raw = fresh.questions;
      if (typeof raw === 'string') questions = JSON.parse(raw || '[]');
      else if (Array.isArray(raw)) questions = raw;
      else if (raw && typeof raw === 'object') questions = [raw];
    } catch {
      questions = [];
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      return alert('빌더에 저장된 조사 문항이 없습니다.\n현황판 → 빌더에서 문항을 저장한 뒤 다시 시도해주세요.');
    }

    const hasImage = (v: unknown) => {
      const s = String(v || '').trim();
      return !!s && (s.startsWith('data:image') || s.startsWith('http') || s.startsWith('/') || s.startsWith('blob:'));
    };

    const qCount = questions.filter((q) => q.type !== 'SECTION').length;
    const textLines: string[] = [
      `■ 게시명: ${fresh.title || ''}`,
      `■ 식별코드: ${fresh.code || ''}`,
      `■ 게시번호: ${fresh.postNumber ?? ''}`,
      `■ 익명여부: ${fresh.isAnonymous ? '익명' : '기명'}`,
      `■ 대상: ${fresh.target || ''}`,
      `■ 기간: ${`${fresh.startDate || ''} ~ ${fresh.endDate || ''} ${fresh.endTime || ''}`.trim()}`,
      `■ 문항수: ${qCount}`,
      '',
      '========== 조사 원문 (빌더 문항) ==========',
      '',
    ];

    let qNo = 0;
    questions.forEach((q: any) => {
      const isSection = q.type === 'SECTION';
      if (!isSection) qNo += 1;
      const required = q.isRequired === true || q.required === true;
      const title = String(q.title || '').trim() || '(제목 없음)';
      const desc = String(q.description || '').trim();
      const typeLabel = questionTypeLabel(q.type);
      const opts = Array.isArray(q.options) ? q.options : [];

      if (isSection) {
        textLines.push(`[섹션] ${title}`);
        if (desc) textLines.push(`  설명: ${desc}`);
        if (hasImage(q.questionImageUrl) || hasImage(q.imageUrl)) textLines.push('  (이미지첨부됨)');
        textLines.push('');
        return;
      }

      textLines.push(`Q${qNo}. [${typeLabel}] ${required ? '(필수) ' : ''}${title}`);
      if (desc) textLines.push(`  설명: ${desc}`);
      if (hasImage(q.questionImageUrl) || hasImage(q.imageUrl) || hasImage(q.templateFileData)) {
        textLines.push('  (이미지첨부됨)');
      }
      if (q.type === 'FILE' && q.templateFileName) {
        textLines.push(`  서식파일: ${q.templateFileName}`);
      }
      if (q.type === 'SCALE') {
        textLines.push(`  척도: 1 ~ ${q.scaleMax || 5}`);
      } else if (opts.length === 0) {
        if (q.type === 'CHOICE_SINGLE' || q.type === 'CHOICE_MULTI') {
          textLines.push('  (선택지 없음)');
        }
      } else {
        opts.forEach((o: any, oi: number) => {
          const label = String(o?.label ?? o ?? '').trim() || `(옵션 ${oi + 1})`;
          const stock = o?.stockLimit != null && String(o.stockLimit).trim() !== '' ? String(o.stockLimit) : '';
          const link = o?.referenceLink ? String(o.referenceLink) : '';
          const imgNote = hasImage(o?.imageUrl) ? ' (이미지첨부됨)' : '';
          textLines.push(
            `  ${oi + 1}) ${label}${stock ? ` [재고:${stock}]` : ''}${link ? ` [링크:${link}]` : ''}${imgNote}`
          );
        });
      }
      textLines.push('');
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(textLines.map((line) => [line])),
      '원문텍스트'
    );
    const safeTitle = String(fresh.title || 'survey').replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
    XLSX.writeFile(wb, `[조사원문]_${safeTitle}.xlsx`);
  };

  const makePctBar = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    const filled = Math.round(clamped / 5);
    return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}`;
  };

  /** 단일 설문 결과 분석(빈도·비율) — active-surveys 결과 분석과 동일 포맷 */
  const handleDownloadResultAnalysis = (survey: any) => {
    if (!requireEdit()) return;

    let parsedQuestions: any[] = [];
    try {
      parsedQuestions =
        typeof survey.questions === 'string' ? JSON.parse(survey.questions) : survey.questions || [];
    } catch {
      parsedQuestions = [];
    }

    const GUIDE_MSG = 'ZIP 또는 Excel을 다운받아 확인바랍니다.';
    const targetUsers = getTargetUsers(survey.target || '');
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

    if (answerSources.length === 0) {
      return alert('본 설문에 제출된 응답이 없습니다.');
    }

    const exportQuestions = parsedQuestions.filter((q: any) => {
      if (!q || q.type === 'SECTION') return false;
      if (typeof q.allowAnalysis === 'boolean') return q.allowAnalysis;
      // 구 데이터: 선택·만족도만 분석 (주소·이름 등 개인정보 제외)
      return q.type === 'CHOICE_SINGLE' || q.type === 'CHOICE_MULTI' || q.type === 'SCALE';
    });
    if (exportQuestions.length === 0) {
      return alert('분석 허용된 문항이 없습니다.\n빌더에서 문항별 「분석 허용」을 켠 뒤 다시 시도해주세요.');
    }

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
        const labels =
          Object.keys(counts).length > 0
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

      rows.push([q.title, typeLabel, GUIDE_MSG, '', '', '']);
      rows.push([]);
    });

    const wb = XLSX.utils.book_new();
    const safeTitle = String(survey.title || survey.code || '설문').replace(/[/\\?%*:|"<>]/g, '-');
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 36 },
      { wch: 10 },
      { wch: 42 },
      { wch: 10 },
      { wch: 10 },
      { wch: 22 },
    ];
    const sheetBase = `통계_${safeTitle}`.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetBase);

    const textQuestions = exportQuestions.filter(
      (q: any) => q.type === 'TEXT_SHORT' || q.type === 'TEXT_LONG'
    );
    if (textQuestions.length > 0) {
      const header = [
        '제출조직',
        '제출자',
        '제출일',
        ...textQuestions.map((q: any) => `[${questionTypeLabel(q.type)}] ${q.title}`),
      ];
      const body = answerSources.map((src, i) => [
        survey.isAnonymous ? '익명조직' : src.dept,
        survey.isAnonymous ? `익명응답자 ${i + 1}` : src.name,
        src.date || '-',
        ...textQuestions.map((q: any) => formatAnswerForExport(src.answers?.[q.id])),
      ]);
      const textWs = XLSX.utils.aoa_to_sheet([header, ...body]);
      const textSheet = `서술_${safeTitle}`.substring(0, 31);
      XLSX.utils.book_append_sheet(wb, textWs, textSheet === sheetBase ? '서술응답' : textSheet);
    }

    XLSX.writeFile(wb, `[분석결과]_${safeTitle.substring(0, 30)}.xlsx`);
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
    if (!requireEdit()) return;
    let parsedQuestions = [];
    try {
      parsedQuestions = typeof survey.questions === 'string' ? JSON.parse(survey.questions) : (survey.questions || []);
    } catch (e) {
      console.error("문항 데이터 파싱 실패:", e);
    }
    const questions = parsedQuestions.length > 0 ? parsedQuestions : [{ id: 'q1', title: '1. 의견 및 건의사항' }];

    if (survey.isAnonymous) {
      const anonRows = listAnonymousContentRows(responses, survey.id);
      if (anonRows.length === 0) return alert("본 설문에 접수된 완료 데이터가 없어 엑셀을 도출할 수 없습니다.");
      const deptRow = ['제출조직(부서)', ...anonRows.map(() => '익명조직')];
      const nameRow = ['제출자이름', ...anonRows.map((_, i) => `익명응답자 ${i + 1}`)];
      const dateRow = ['제출일자', ...anonRows.map((r) => r.date || '-')];
      const contentRows = questions.map((q: any) => {
        if (q.type === 'SECTION') return [`[🔖 섹션 단락]: ${q.title}`];
        const rowData = [q.title];
        anonRows.forEach((r) => rowData.push(formatAnswerForExport(r.answers?.[q.id])));
        return rowData;
      });
      const ws = XLSX.utils.aoa_to_sheet([deptRow, nameRow, dateRow, ...contentRows]);
      const wb = XLSX.utils.book_new();
      const safeTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
      XLSX.utils.book_append_sheet(wb, ws, safeTitle);
      XLSX.writeFile(wb, `[개별응답분석]_${safeTitle}.xlsx`);
      return;
    }
    
    const targetUsers = getTargetUsers(survey.target); // 🚀 헬퍼 적용 (계층 필터 반영)
    const submittedUsers = targetUsers.filter(u => responses[`${survey.id}_${u.email}`]?.isDone);
    
    if (submittedUsers.length === 0) return alert("본 설문에 접수된 완료 데이터가 없어 엑셀을 도출할 수 없습니다.");
    
    const deptRow = ['제출조직(부서)', ...submittedUsers.map(u => u.dept)];
    const nameRow = ['제출자이름', ...submittedUsers.map((u) => u.name)];
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
      const targetUsers = getTargetUsers(survey.target);
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
  
  const handleExportListExcel = () => {
    if (!requireEdit()) return;
    const target = selectedIds.size > 0
      ? filteredHistory.filter((h) => selectedIds.has(h.id))
      : filteredHistory;
    if (target.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = target.map((h, idx) => {
      const targetUsers = getTargetUsers(h.target);
      const total = targetUsers.length;
      const done = h.isAnonymous
        ? getAnonymousDoneCount(h.id, anonymousParticipationCounts, responses)
        : targetUsers.filter((u) => responses[`${h.id}_${u.email}`]?.isDone).length;

      return {
        NO: target.length - idx,
        식별코드: h.code,
        게시번호: h.postNumber,
        게시일: h.postDate,
        게시명: h.title,
        유형: h.type,
        익명여부: h.isAnonymous ? '익명' : '기명',
        대상: h.target,
        시작일: h.startDate,
        종료일: h.endDate,
        참여율: total > 0 ? Math.round((done / total) * 100) + '%' : '0%',
        참여인원: done,
        미참여인원: total - done,
        '보관 상태': h.status,
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '설문이력대장');
    const yearLabel = selectedYear === 'ALL' ? '전체' : `${selectedYear}년`;
    XLSX.writeFile(wb, `설문조사_보관이력_${yearLabel}.xlsx`);
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

  const colSpan = isLv1 ? 16 : 15;
  
  if (loading) return <LoadingState />;
  
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 — client-search와 동일 */}
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
            ARCHIVED SURVEY INVENTORY
          </h3>
          <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
            종료 조사 아카이브 (보관함)
          </h1>
          <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
            공고 기한이 마감되어 최종 보관 처리된 과거 `조사 명세와 누적 응답 데이터 대장입니다.
          </p>
          {permissionSummary && isSystemLv1User(currentUser) && (
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
                className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                  isActive ? tab.activeClass : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
          ※ 탭을 클릭하여 진행 현황과 보관 이력을 전환합니다.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">종료·보관 조사 명세 대장</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredHistory.length}건</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

              <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
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
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={handleExportListExcel}
              disabled={!canEdit}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm transition-all whitespace-nowrap ${canEdit ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
            >
              {selectedIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedIds.size})`
                : '화면 목록 EXCEL 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-medium min-w-[1400px]">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
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
                <th className="py-3 px-2 w-20 text-left">식별코드</th>
                <th className="py-3 px-2 w-16 text-center text-slate-800">게시번호</th>
                <th className="py-3 px-2 w-20 text-center">게시일</th>
                <th className="py-3 px-2 w-[220px] text-left">게시명</th>
                <th className="py-3 px-2 w-14 text-center text-slate-800">익명여부</th>
                <th className="py-3 px-2 w-24 text-center">대상</th>
                <th className="py-3 px-2 w-32 text-center">기간</th>
                <th className="py-3 px-2 w-12 text-center border-l bg-slate-100/50">참여율</th>
                <th className="py-3 px-2 w-12 text-center bg-blue-50/50 text-blue-600">참여</th>
                <th className="py-3 px-2 w-14 text-center bg-red-50/50 text-red-600 border-r">미참여</th>
                <th className="py-3 px-2 w-16 text-center">상태</th>
                <th className="py-3 px-2 w-20 text-center border-l border-slate-200 whitespace-nowrap">복원(Edit)</th>
                <th className="py-3 px-2 w-56 text-center">응답 관리(Edit)</th>
                {isLv1 && <th className="py-3 pr-4 w-24 text-center text-red-500">삭제(LV_1)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="py-20 text-center text-slate-400 font-black text-sm">
                    조건에 맞는 보관 조사가 없습니다.
                  </td>
                </tr>
              ) : currentHistory.map((s, i) => {
                const targetUsers = getTargetUsers(s.target);
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
                    <td className="py-2 text-center text-slate-400 font-bold align-middle tabular-nums">{filteredHistory.length - ((currentPage - 1) * itemsPerPage + i)}</td>
                    <td className="py-2 px-2 text-left font-mono font-black text-slate-600 tracking-tighter align-middle">{s.code}</td>
                    <td className="py-2 px-2 font-black text-center text-slate-800 text-[12px] align-middle tabular-nums">{s.postNumber}</td>
                    <td className="py-2 px-2 font-mono text-center text-slate-500 whitespace-nowrap align-middle tabular-nums">{s.postDate || '-'}</td>
                    <td className="py-2 px-2 text-left align-middle">
                      <div className="font-black text-slate-800 text-[11px] line-clamp-1">{s.title}</div>
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
                    <td className="py-2 px-2 text-center font-black text-slate-700 border-l bg-slate-50/30 align-middle tabular-nums">{rate}%</td>
                    <td className="py-2 px-2 text-center text-blue-600 font-black bg-blue-50/30 align-middle tabular-nums">{done}명</td>
                    <td className="py-2 px-2 text-center text-red-500 font-black bg-red-50/30 border-r align-middle tabular-nums">{notDone}명</td>
                    <td className="py-2 px-2 text-center align-middle"><span className="px-2 py-0.5 rounded font-black text-[9px] bg-slate-200 text-slate-600">{s.status}</span></td>

                    <td className="py-2 px-2 text-center align-middle border-l border-slate-200">
                      <button onClick={() => handleRestore(s.id)} disabled={!canEdit} className={`w-full py-1.5 border rounded transition-all font-black text-[9px] whitespace-nowrap shadow-sm ${canEdit ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-900 hover:text-white' : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'}`}>🔄 복원</button>
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <div className="flex items-center justify-center gap-1 max-w-[220px] mx-auto">
                        <button onClick={() => handleDownloadZip(s)} disabled={!canEdit} className={`flex-1 py-1.5 rounded-lg shadow-sm transition-all font-black text-[9px] whitespace-nowrap flex items-center justify-center gap-0.5 border ${canEdit ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}>
                          ZIP
                        </button>
                        <button onClick={() => handleDownloadSingleExcel(s)} disabled={!canEdit} className={`flex-1 py-1.5 rounded-lg shadow-sm transition-all font-black text-[9px] whitespace-nowrap flex items-center justify-center gap-0.5 border ${canEdit ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-600 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}>
                          Excel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadQuestionnaireOriginal(s)}
                          disabled={!canEdit}
                          title="질문·선택지·유형 등 조사지 원문"
                          className={`flex-1 py-1.5 rounded-lg shadow-sm transition-all font-black text-[9px] whitespace-nowrap flex items-center justify-center border ${canEdit ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-500 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                        >
                          조사원문
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadResultAnalysis(s)}
                          disabled={!canEdit}
                          title="선택·만족도 빈도·비율 분석 엑셀"
                          className={`flex-1 py-1.5 rounded-lg shadow-sm transition-all font-black text-[9px] whitespace-nowrap flex items-center justify-center border ${canEdit ? 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-800 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                        >
                          분석결과
                        </button>
                      </div>
                    </td>

                    {isLv1 && (
                      <td className="py-2 pr-4 text-center align-middle">
                        <button onClick={() => handlePermanentDelete(s.id)} className="w-full py-1.5 bg-white border border-red-200 text-red-500 rounded hover:bg-red-50 transition-all font-black text-[9px] whitespace-nowrap shadow-sm">
                          🗑️ 삭제(LV_1)
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredHistory.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i + 1)}
                className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                {i + 1}
              </button>
            ))}
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
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