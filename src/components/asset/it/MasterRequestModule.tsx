'use client';

import { useState, useEffect, useMemo, Suspense, Fragment } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth, toSortableTime } from '@/utils/dateUtils';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import LoadingState from '@/components/common/LoadingState';
import ItMasterPageChrome from '@/components/asset/it/ItMasterPageChrome';

const MENU_PATH = '/asset/it/master/requests';

/** KST 연·월 문자열 (year: '2026', month: '07') */
function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const raw = String(dateInput).trim();
  const ymd = raw.match(/^(\d{4})-(\d{2})/);
  if (ymd) return { year: ymd[1], month: ymd[2] };
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return {
    year: String(ym.year),
    month: String(ym.month).padStart(2, '0'),
  };
}

/** 관리자가 먼저 건 문의인지 (확인·종결로 status가 바뀌어도 동일) */
function isAdminInquiryRow(req: any) {
  if (!req) return false;
  const s = String(req.status || '').trim();
  if (s === '관리자 의견발송' || s === '사용자 확인완료') return true;
  if (s === '관리자 답변') return false;
  if (s === '답변회신' || String(req.adminOpinion || '').includes(':::REPLY:::')) return false;
  if (s === '의견전송' || s === '답변 대기중' || s === '대기중') return false;
  const content = String(req.content || '').trim();
  const hasUserContent = !!content && content !== '(관리자 의견)';
  const adminText = String(req.adminOpinion || '').split(':::')[0].trim();
  // 처리완료로만 바뀐 관리자 선제 요청
  if (!hasUserContent && adminText) return true;
  return false;
}

function historyStatusLabel(status: string, req?: any, opts?: { isThreadRoot?: boolean }) {
  // 스레드 첫 행: 항상 최초 질의 유형만 표기 (종결 후에도 유지)
  if (opts?.isThreadRoot) {
    return isAdminInquiryRow(req) ? '관리자 문의/요청' : '사용자 문의/요청';
  }
  const s = String(status || '').trim();
  if (s === '처리완료' || s === '관리자 확인완료' || s === '사용자 종료처리') return '처리 완료(종료)';
  if (s === '사용자 확인완료' || isAdminInquiryRow(req)) return '관리자 문의/요청';
  if (s === '관리자 답변') return '관리자 답변';
  if (s === '관리자 의견발송') return '관리자 문의/요청';
  if (s === '답변회신' || (req && String(req.adminOpinion || '').includes(':::REPLY:::'))) return '사용자 답변';
  if (s === '의견전송' || s === '답변 대기중' || s === '대기중') return '사용자 문의/요청';
  return s || '-';
}

/** 관리자가 종료 버튼을 눌렀을 때만 종결 */
function isClosedStatus(status: string) {
  return status === '처리완료' || status === '관리자 확인완료' || status === '사용자 종료처리';
}

/** 스레드(대표+하위) 중 종결 건이 있으면 관리액션「종료」— 필터와 UI 공통 */
function isThreadClosed(root: any, children: any[] = []) {
  const members = [root, ...(children || [])].filter(Boolean);
  return members.some((r) => isClosedStatus(String(r?.status || '')));
}

function isWaitingForUser(status: string) {
  return status === '관리자 의견발송' || status === '관리자 답변';
}

function isUserPendingStatus(status: string) {
  return status === '답변 대기중' || status === '의견전송' || status === '답변회신' || status === '대기중';
}

function sameAssetCode(a: any, b: any) {
  return String(a?.assetCode || '').trim() === String(b?.assetCode || '').trim();
}

function isIncomingReply(req: any, allRequests: any[] = []) {
  if (!req) return false;
  const status = String(req.status || '').trim();
  if (status === '답변회신') return true;
  if (String(req.adminOpinion || '').includes(':::REPLY:::')) return true;
  if (status !== '의견전송' && status !== '답변 대기중' && status !== '대기중') return false;
  return !!findParentAdminRequest(req, allRequests);
}

function parseAdminOpinionText(raw: string | null | undefined) {
  const parts = String(raw || '').split(':::');
  const opinionText = parts[0] || '';
  const responderName = (parts[1] || '').trim() || '-';
  const responderDept = (parts[2] || '').trim();
  const responderLabel = [responderDept, responderName].filter((v) => v && v !== '-').join(' / ') || responderName;
  return { opinionText, responderName, responderDept, responderLabel };
}

function reqTime(r: any) {
  return toSortableTime(r?.createdAt || r?.requestDate || 0);
}

function findParentAdminRequest(replyReq: any, allRequests: any[]) {
  if (!replyReq) return null;
  const t = reqTime(replyReq);
  return allRequests
    .filter((r) => sameAssetCode(r, replyReq) && String(r.id) !== String(replyReq.id))
    .filter((r) => r.status === '관리자 의견발송' || r.status === '사용자 확인완료')
    .filter((r) => reqTime(r) <= t)
    .sort((a, b) => reqTime(b) - reqTime(a))[0] || null;
}

/** 최초 질문(관리자 요청/사용자 선제요청) 아래 묶일 회신 */
function getThreadParentId(req: any, allRequests: any[]): string | null {
  if (!req) return null;
  const status = String(req.status || '').trim();
  if (status === '관리자 의견발송' || status === '사용자 확인완료') return null;
  const prior = allRequests
    .filter((r) => sameAssetCode(r, req) && String(r.id) !== String(req.id) && reqTime(r) <= reqTime(req))
    .sort((a, b) => {
      const d = reqTime(b) - reqTime(a);
      if (d !== 0) return d;
      return String(b.id || '').localeCompare(String(a.id || ''));
    })[0];
  if (!prior) return null;

  const isReplyFlag = status === '답변회신' || String(req.adminOpinion || '').includes(':::REPLY:::');
  const userText = String(req.content || '').trim();
  const hasUserContent = !!userText && userText !== '(관리자 의견)';
  const adminText = String(req.adminOpinion || '').split(':::')[0].trim();
  const adminOnly = !hasUserContent && !!adminText;

  // 종결(처리완료 등) 후에도 스레드 소속 유지 — 루트가 이전 자산 이력에 잘못 붙지 않게 원래 유형으로 재판정
  let linkStatus = status;
  if (isClosedStatus(status)) {
    if (isReplyFlag) {
      linkStatus = '답변회신';
    } else if (adminOnly) {
      const priorOpenUser =
        prior.status === '의견전송' ||
        prior.status === '답변 대기중' ||
        prior.status === '답변회신' ||
        prior.status === '사용자 확인완료';
      linkStatus = priorOpenUser ? '관리자 답변' : '관리자 의견발송';
    } else if (hasUserContent) {
      linkStatus = '의견전송';
    } else {
      return null;
    }
  }
  if (linkStatus === '관리자 의견발송') return null;

  if ((linkStatus === '의견전송' || linkStatus === '답변 대기중') && !isReplyFlag && isClosedStatus(prior.status)) {
    return null;
  }
  if ((linkStatus === '의견전송' || linkStatus === '답변 대기중') && !isReplyFlag) {
    const priorOk =
      prior.status === '관리자 의견발송' ||
      prior.status === '사용자 확인완료' ||
      prior.status === '관리자 답변' ||
      prior.status === '답변회신';
    if (!priorOk) return null;
  }
  if (
    isReplyFlag ||
    linkStatus === '답변회신' ||
    linkStatus === '관리자 답변' ||
    linkStatus === '의견전송' ||
    linkStatus === '답변 대기중'
  ) {
    return String(prior.id);
  }
  return null;
}

function collectThreadMessages(req: any, allRequests: any[]) {
  if (!req) return [];
  const pool = allRequests.filter((r) => sameAssetCode(r, req));
  const parentOf = new Map<string, string>();
  pool.forEach((r) => {
    const pid = getThreadParentId(r, pool);
    if (pid) parentOf.set(String(r.id), pid);
  });
  const rootOf = (id: string) => {
    let cur = String(id);
    const seen = new Set<string>();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur) as string;
    }
    return cur;
  };
  const rootId = rootOf(String(req.id));
  return pool.filter((r) => rootOf(String(r.id)) === rootId).sort((a, b) => reqTime(a) - reqTime(b));
}

function opinionDisplay(raw: string | null | undefined) {
  const text = parseAdminOpinionText(raw).opinionText.trim();
  if (!text || text.includes('의견 없이 처리') || text === '종결 처리' || text === '처리 완료' || text.includes(':::REPLY:::')) return '';
  return text;
}

function threadTurns(req: any) {
  const status = String(req?.status || '').trim();
  const userText = String(req?.content || '').trim();
  const userOk = userText && userText !== '(관리자 의견)';
  const adminText = opinionDisplay(req?.adminOpinion);
  const reqDate = getKSTDateString(req?.requestDate || req?.createdAt) || req?.requestDate || '';
  const doneDate = getKSTDateString(req?.completedAt || req?.updatedAt || req?.createdAt) || reqDate;
  const turns: { role: 'admin' | 'user'; label: string; text: string; date: string }[] = [];
  if (status === '관리자 의견발송' || status === '사용자 확인완료' || status === '관리자 답변') {
    if (adminText) turns.push({ role: 'admin', label: status === '관리자 답변' ? '관리자 답변' : '관리자 문의/요청', text: adminText, date: reqDate });
  } else if (status === '답변회신' || status === '의견전송' || status === '답변 대기중') {
    if (userOk) turns.push({ role: 'user', label: status === '답변회신' ? '사용자 답변' : '사용자 문의/요청', text: userText, date: reqDate });
  } else if (isClosedStatus(status)) {
    if (userOk) turns.push({ role: 'user', label: '사용자 답변', text: userText, date: reqDate });
    if (adminText) turns.push({ role: 'admin', label: '관리자 답변', text: adminText, date: doneDate });
  }
  return turns;
}

function userRequestContent(raw: string | null | undefined) {
  const text = String(raw || '').trim();
  if (!text || text === '(관리자 의견)') return '-';
  return `"${text}"`;
}

function parseHistoryModel(req: any) {
  const info = String(req?.assetInfo || '');
  const slash = info.indexOf('/');
  if (slash >= 0) {
    const model = info.slice(slash + 1).trim();
    if (model) return model;
  }
  return req?.modelName || req?.model || '-';
}

function isMetaResponderName(name: string) {
  const n = String(name || '').trim().toUpperCase();
  return !n || n === '-' || n === 'REPLY' || n === 'USERACK';
}

/** adminOpinion 저장 포맷: 의견:::처리자이름:::처리자부서[:::USERACK:::확인자이름:::확인자부서] */
function parseAdminOpinion(raw: string | null | undefined) {
  const parts = String(raw || '').split(':::');
  const opinionText = parts[0] || '';
  const rawName = (parts[1] || '').trim();
  const responderName = isMetaResponderName(rawName) ? '' : rawName;
  const responderDept = isMetaResponderName(parts[2] || '') ? '' : (parts[2] || '').trim();
  const responderLabel = [responderDept, responderName].filter(Boolean).join(' / ');
  const ackIdx = parts.indexOf('USERACK');
  const ackedName = ackIdx >= 0 ? (parts[ackIdx + 1] || '').trim() : '';
  const ackedDept = ackIdx >= 0 ? (parts[ackIdx + 2] || '').trim() : '';
  const ackedLabel = [ackedDept, ackedName].filter(Boolean).join(' / ');
  return { opinionText, responderName, responderDept, responderLabel, ackedName, ackedDept, ackedLabel };
}

function pickThreadAdminLabel(members: any[]) {
  for (const m of members) {
    const parsed = parseAdminOpinion(m?.adminOpinion);
    if (parsed.responderLabel) return parsed.responderLabel;
    if (m?.responderLabel && !isMetaResponderName(m.responderName)) return m.responderLabel;
  }
  return '';
}

function threadUserLabel(root: any) {
  return [root?.dept || root?.department, root?.requester || root?.name].filter(Boolean).join(' / ');
}

function samePersonLabel(a: string, b: string) {
  return String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '');
}

function isAdminSideStatus(status: string) {
  return status === '관리자 의견발송' || status === '관리자 답변' || status === '사용자 확인완료';
}

function rowAdminLabel(req: any) {
  return pickThreadAdminLabel([req]);
}

const HISTORY_MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function ITMasterRequestContent() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [editingReq, setEditingReq] = useState<any>(null);
  const [editOpinion, setEditOpinion] = useState('');
  const [commEditMode, setCommEditMode] = useState(false);
  const [adminComposeReq, setAdminComposeReq] = useState<any>(null);

  const [filterDept, setFilterDept] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'DONE'>('ALL');
  const [selectedYear, setSelectedYear] = useState(() => String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [codeQuery, setCodeQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [filterDept, filterType, filterStatus, selectedYear, selectedMonth, codeQuery, modelQuery, userQuery]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);

    try {
      const ts = Date.now();
      const [userRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (userRes.ok) {
        const userData = await userRes.json();
        const roles = Array.isArray(userData.roles)
          ? userData.roles
          : (() => {
              try {
                return JSON.parse(userData.roles || '[]');
              } catch {
                return [];
              }
            })();
        setCurrentUser({
          ...userData,
          name: String(userData.name || '').trim(),
          dept: String(userData.unit?.unit_name || userData.dept || '').trim(),
          roles,
        });
      }
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/it/master/requests'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
    } catch (e) {
      console.error('User fetch error', e);
    }

    try {
      const reqRes = await fetch(`/api/asset/it/requests?t=${Date.now()}`, { cache: 'no-store' });
      if (reqRes.ok) {
        let allReqs = await reqRes.json();
        allReqs = allReqs.map((r: any) => {
          let unifiedStatus = r.status;
          if (unifiedStatus === '의견전송' || unifiedStatus === '대기중') unifiedStatus = '답변 대기중';
          if (unifiedStatus === '완료') unifiedStatus = '관리자 확인완료';
          const parsed = parseAdminOpinion(r.adminOpinion);
          return {
            ...r,
            status: unifiedStatus,
            adminOpinionText: parsed.opinionText,
            responderName: parsed.responderName,
            responderDept: parsed.responderDept,
            responderLabel: parsed.responderLabel,
            ackedLabel: parsed.ackedLabel,
          };
        });
        allReqs.sort((a: any, b: any) => {
          const ta = new Date(a.createdAt || a.requestDate || 0).getTime();
          const tb = new Date(b.createdAt || b.requestDate || 0).getTime();
          if (tb !== ta) return tb - ta;
          return String(b.id || '').localeCompare(String(a.id || ''));
        });
        setRequests(allReqs);
      }
    } catch (e) {
      console.error('Data fetch error', e);
    }

    setLoading(false);
  };

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const submitThreadAction = async (mode: 'reply' | 'close') => {
    if (!editingReq) return;
    if (!canEdit) return alert('편집 권한이 없습니다.');
    if (mode === 'reply' && !editOpinion.trim()) {
      return alert('답변 내용을 입력해 주세요.');
    }
    const responder = currentUser?.name || '-';
    const responderDept = currentUser?.dept || '';
    const thread = collectThreadMessages(editingReq, requests);
    const latest = thread[thread.length - 1] || editingReq;

    try {
      if (mode === 'reply') {
        if (isWaitingForUser(latest.status)) {
          return alert('사용자 답변을 기다린 뒤에 다시 답변할 수 있습니다.');
        }
        const res = await fetch('/api/asset/it/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestDate: getKSTDateString(),
            requester: editingReq.requester || '-',
            requester_email: editingReq.requester_email || null,
            requester_id: editingReq.requester_id || null,
            dept: editingReq.dept || '-',
            assetInfo: editingReq.assetInfo || `${editingReq.assetCode} / -`,
            content: '',
            status: '관리자 답변',
            assetCode: editingReq.assetCode,
            assetType: editingReq.assetType,
            adminOpinion: editOpinion.trim(),
            responderName: responder,
            responderDept,
          }),
        });
        if (res.ok) {
          const created = await res.json().catch(() => null);
          setCommEditMode(false);
          setEditOpinion('');
          setEditingReq(created || { ...editingReq, status: '관리자 답변' });
          fetchData();
        } else {
          alert('❌ 서버 오류로 답변 전송에 실패했습니다.');
        }
        return;
      }

      const res = await fetch('/api/asset/it/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: latest.id,
          adminOpinion: editOpinion.trim() || opinionDisplay(latest.adminOpinion) || '처리 완료',
          responderName: responder,
          responderDept,
          status: '처리완료',
        }),
      });
      if (res.ok) {
        const updated = await res.json().catch(() => null);
        setCommEditMode(false);
        setEditOpinion('');
        setEditingReq({ ...(updated || latest), status: '처리완료' });
        fetchData();
      } else {
        alert('❌ 처리 완료(종료)에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('❌ 통신 오류가 발생했습니다.');
    }
  };

  const handleCancelSend = async (id: string) => {
    if (!canEdit) return alert('편집 권한이 없습니다.');
    if (!confirm('전송한 의견을 취소하시겠습니까? (취소 후 복구할 수 없습니다)')) return;
    try {
      const target = requests.find((r) => String(r.id) === String(id));
      const res = await fetch(`/api/asset/it/requests?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        // 답변 취소 시 종결 처리하지 않고, 직전 관리자 요청이 ACK로 바뀌었다면 복원
        if (target && (target.status === '관리자 답변' || isUserPendingStatus(target.status) || String(target.adminOpinion || '').includes(':::REPLY:::'))) {
          const prior = requests
            .filter((r) => sameAssetCode(r, target) && String(r.id) !== String(id) && reqTime(r) <= reqTime(target))
            .sort((a, b) => reqTime(b) - reqTime(a))[0];
          if (prior?.status === '사용자 확인완료') {
            await fetch('/api/asset/it/requests', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: prior.id, status: '관리자 의견발송' }),
            });
          }
        }
        setEditingReq(null);
        setEditOpinion('');
        setCommEditMode(false);
        fetchData();
      } else {
        alert('❌ 취소에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('❌ 통신 오류가 발생했습니다.');
    }
  };

  const handleUpdateAdminOutbound = async () => {
    if (!editingReq) return;
    if (!canEdit) return alert('편집 권한이 없습니다.');
    if (!editOpinion.trim()) return alert('내용을 입력해 주세요.');
    const responder = currentUser?.name || '-';
    const responderDept = currentUser?.dept || '';
    const thread = collectThreadMessages(editingReq, requests);
    const latest = thread[thread.length - 1] || editingReq;
    try {
      const res = await fetch('/api/asset/it/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: latest.id,
          adminOpinion: editOpinion.trim(),
          responderName: responder,
          responderDept,
          status: latest.status,
        }),
      });
      if (res.ok) {
        const updated = await res.json().catch(() => null);
        setCommEditMode(false);
        setEditingReq(updated || { ...latest, adminOpinion: editOpinion.trim() });
        fetchData();
      } else {
        alert('❌ 내용 저장에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('❌ 통신 오류가 발생했습니다.');
    }
  };

  const openAdminCompose = (req: any) => {
    if (!canEdit) return alert('편집 권한이 없습니다.');
    setEditingReq(null);
    setCommEditMode(false);
    setAdminComposeReq(req);
    setEditOpinion('');
  };

  const closeAdminCompose = () => {
    setAdminComposeReq(null);
    setEditOpinion('');
  };

  const submitAdminOpinionRequest = async () => {
    if (!adminComposeReq) return;
    if (!canEdit) return alert('편집 권한이 없습니다.');
    if (!editOpinion.trim()) return alert('사용자에게 전달할 의견 내용을 입력해 주세요.');
    const responder = currentUser?.name || '-';
    const responderDept = currentUser?.dept || '';
    try {
      const res = await fetch('/api/asset/it/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestDate: getKSTDateString(),
          requester: adminComposeReq.requester || '-',
          requester_email: adminComposeReq.requester_email || null,
          requester_id: adminComposeReq.requester_id || null,
          dept: adminComposeReq.dept || '-',
          assetInfo: adminComposeReq.assetInfo || `${adminComposeReq.assetCode} / -`,
          content: '',
          status: '관리자 의견발송',
          assetCode: adminComposeReq.assetCode,
          assetType: adminComposeReq.assetType,
          adminOpinion: editOpinion.trim(),
          responderName: responder,
          responderDept,
        }),
      });
      if (res.ok) {
        alert('✅ 사용자에게 관리자 요청이 전송되었습니다.');
        closeAdminCompose();
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`❌ 전송 실패: ${errData.error || '서버 오류'}`);
      }
    } catch (e) {
      console.error(e);
      alert('❌ 서버 통신 오류가 발생했습니다.');
    }
  };

  const isLV1 = useMemo(() => !!currentUser?.roles?.includes('LV_1'), [currentUser]);

  const handleDeleteSelected = async () => {
    if (!isLV1) {
      return alert('❌ 삭제 권한이 거부되었습니다. (LV_1 전용)');
    }
    if (selectedIds.size === 0) {
      return alert('삭제할 항목을 체크박스로 선택해 주세요.');
    }
    if (!confirm(`선택한 송수신 이력 ${selectedIds.size}건을 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
      const ids = Array.from(selectedIds);
      const res = await fetch(`/api/asset/it/requests?ids=${ids.map(encodeURIComponent).join(',')}`, { method: 'DELETE' });
      if (res.ok) {
        alert(`✅ ${ids.length}건이 정상적으로 삭제되었습니다.`);
        setSelectedIds(new Set());
        fetchData();
      } else {
        alert('❌ 서버 삭제 처리에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('❌ 서버 통신 오류가 발생했습니다.');
    }
  };

  const availableYears = useMemo(() => {
    const years = requests
      .map((r) => getKSTYearMonthParts(r.requestDate || r.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique.sort((a, b) => b.localeCompare(a));
  }, [requests]);

  const uniqueDepts = useMemo(
    () =>
      Array.from(new Set(requests.map((r) => String(r.dept || r.department || '').trim() || '-')))
        .sort((a, b) => String(a).localeCompare(String(b), 'ko')),
    [requests]
  );

  const uniqueTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    requests.forEach((r) => {
      const key = String(r.assetType || r.category || '').trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
  }, [requests]);

  const threadIndex = useMemo(() => {
    const parentOf = new Map<string, string>();
    requests.forEach((r) => {
      const pid = getThreadParentId(r, requests);
      if (pid) parentOf.set(String(r.id), pid);
    });
    const childrenOf = new Map<string, any[]>();
    const rootOf = (id: string) => {
      let cur = String(id);
      const seen = new Set<string>();
      while (parentOf.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = parentOf.get(cur) as string;
      }
      return cur;
    };
    requests.forEach((r) => {
      const rootId = rootOf(String(r.id));
      if (rootId === String(r.id)) return;
      if (!requests.some((x) => String(x.id) === rootId)) return;
      const list = childrenOf.get(rootId) || [];
      list.push(r);
      childrenOf.set(rootId, list);
    });
    childrenOf.forEach((list) => list.sort((a, b) => reqTime(a) - reqTime(b)));
    return { parentOf, childrenOf };
  }, [requests]);

  const filteredThreads = useMemo(() => {
    const codeQ = codeQuery.toLowerCase().trim();
    const modelQ = modelQuery.toLowerCase().trim();
    const matchesMeta = (r: any) => {
      const ym = getKSTYearMonthParts(r.requestDate || r.createdAt);
      const matchYear = selectedYear === 'ALL' || ym?.year === selectedYear;
      const matchMonth = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      const rDept = String(r.dept || r.department || '').trim() || '-';
      const matchDept = filterDept === 'ALL' || rDept === filterDept;
      const rType = r.assetType || r.category || '일반';
      const matchType = filterType === 'ALL' || rType === filterType;
      const model = parseHistoryModel(r);
      const matchCode = !codeQ || String(r.assetCode || r.code || '').toLowerCase().includes(codeQ);
      const matchModel = !modelQ || String(model).toLowerCase().includes(modelQ);
      const userQ = userQuery.toLowerCase().trim();
      const email = String(r.requester_email || r.user_email || '').trim().toLowerCase();
      const emailLocal = email.includes('@') ? email.slice(0, email.indexOf('@')) : email;
      const matchUser =
        !userQ ||
        String(r.requester || r.name || '').toLowerCase().includes(userQ) ||
        email.includes(userQ) ||
        emailLocal.includes(userQ);
      return matchYear && matchMonth && matchDept && matchType && matchCode && matchModel && matchUser;
    };

    const roots = requests.filter((r) => {
      const pid = threadIndex.parentOf.get(String(r.id));
      return !pid || !requests.some((x) => String(x.id) === pid);
    });

    return roots
      .map((root) => ({
        root,
        children: threadIndex.childrenOf.get(String(root.id)) || [],
      }))
      .filter((t) => {
        // 연계필터는 대표(root) 줄 기준 — 하위 회신은 스레드에 자동 포함
        if (!matchesMeta(t.root)) return false;
        // 관리액션「종료」와 동일: 스레드 어디에든 종결 상태가 있으면 처리 완료
        const threadClosed = isThreadClosed(t.root, t.children);
        if (filterStatus === 'PENDING') return !threadClosed; // 문의/답변 진행
        if (filterStatus === 'DONE') return threadClosed; // 처리 완료(종료)
        return true;
      })
      .sort((a, b) => {
        // 처리 완료: 대표줄 기준 랭크 / 그 외: 스레드 최신 활동순
        if (filterStatus === 'DONE') {
          const closedAt = (r: any) =>
            isClosedStatus(String(r?.status || ''))
              ? toSortableTime(r.completedAt || r.updatedAt || r.requestDate || r.createdAt || 0)
              : 0;
          const ta = Math.max(closedAt(a.root), ...a.children.map(closedAt), reqTime(a.root));
          const tb = Math.max(closedAt(b.root), ...b.children.map(closedAt), reqTime(b.root));
          if (tb !== ta) return tb - ta;
          return String(b.root.id || '').localeCompare(String(a.root.id || ''));
        }
        const ta = Math.max(reqTime(a.root), ...a.children.map(reqTime));
        const tb = Math.max(reqTime(b.root), ...b.children.map(reqTime));
        return tb - ta;
      });
  }, [requests, threadIndex, selectedYear, selectedMonth, filterStatus, filterDept, filterType, codeQuery, modelQuery, userQuery]);

  const filteredRequests = useMemo(
    () => filteredThreads.flatMap((t) => [t.root, ...t.children]),
    [filteredThreads]
  );

  const totalPages = Math.max(1, Math.ceil(filteredThreads.length / itemsPerPage));
  const currentThreads = filteredThreads.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const allIds = filteredRequests.map((r) => r.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  };

  const allFilteredSelected =
    filteredRequests.length > 0 && filteredRequests.every((r) => selectedIds.has(r.id));

  const handleExportExcel = () => {
    const targets = selectedIds.size > 0 ? filteredRequests.filter((r) => selectedIds.has(r.id)) : filteredRequests;
    if (targets.length === 0) return alert('다운로드할 데이터가 없습니다.');

    const exportData = targets.map((req, idx) => ({
      NO: targets.length - idx,
      '부서 / 사용자': [req.dept || req.department, req.requester || req.name].filter(Boolean).join(' / ') || '-',
      '자산 분류': req.assetType || req.category || '일반',
      자산번호: req.assetCode || req.code || '-',
      모델명: parseHistoryModel(req),
      '사용자 요청/답변': req.content,
      '관리자 요청/답변': req.adminOpinionText || '-',
      '부서 / 관리자': req.responderLabel || req.responderName || '-',
      상태: historyStatusLabel(req.status),
      '요청/처리일자': req.completedAt || req.requestDate || req.createdAt || '-',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Requests_Log');
    XLSX.writeFile(wb, `IT_의견요청_송수신대장_${selectedYear === 'ALL' ? '전체' : selectedYear}.xlsx`);
  };

  const handleExportZip = async () => {
    const targets = selectedIds.size > 0 ? filteredRequests.filter((r) => selectedIds.has(r.id)) : filteredRequests;
    if (targets.length === 0) return alert('추출할 데이터가 없습니다.');

    const zip = new JSZip();
    targets.forEach((req, idx) => {
      const content = `■ 요청/처리일자: ${req.completedAt || req.requestDate || req.createdAt || '-'}\n■ 사용자: ${req.requester} (${req.dept})\n■ 대상자산: ${req.assetType} | ${req.assetCode} | ${parseHistoryModel(req)}\n\n[사용자 요청/답변]\n${req.content}\n\n=================================\n\n■ 상태: ${historyStatusLabel(req.status)}\n■ 부서 / 관리자: ${req.responderLabel || req.responderName || '-'}\n\n[관리자 요청/답변]\n${req.adminOpinionText || '내역 없음'}`;
      zip.file(`${idx + 1}_${req.requester}_${req.assetCode}.txt`, '\ufeff' + content);
    });

    const contentBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(contentBlob, `IT_의견요청_증빙자료_${getKSTDateString()}.zip`);
  };

  const openReqModal = (req: any) => {
    setAdminComposeReq(null);
    setCommEditMode(false);
    setEditingReq(req);
    setEditOpinion(
      isWaitingForUser(req.status) ? opinionDisplay(req.adminOpinion) : ''
    );
  };

  const renderLedgerRow = (
    req: any,
    opts: {
      rowNo: number | string;
      depth: number;
      childCount?: number;
      expanded?: boolean;
      children?: any[];
      latestId?: string;
      userLabel?: string;
      adminLabel?: string;
    }
  ) => {
    const isRoot = opts.depth === 0;
    const relatedChildren = isRoot ? (opts.children || []) : [];
    const threadMembers = isRoot ? [req, ...relatedChildren] : [req];
    const latestRelated =
      [...threadMembers].sort((a, b) => reqTime(b) - reqTime(a))[0] || req;
    const displayPending =
      !isClosedStatus(String(latestRelated?.status || '')) &&
      isUserPendingStatus(latestRelated?.status || req.status);
    const threadLatestId = opts.latestId || String(latestRelated?.id || req.id);
    const isLatestInThread = String(req.id) === threadLatestId;
    const isPastStep = opts.depth > 0 && !isLatestInThread;
    const childCount = opts.childCount || 0;
    const hasChildren = childCount > 0;
    const threadClosed = isRoot
      ? isThreadClosed(req, relatedChildren)
      : isClosedStatus(String(req.status || ''));
    // 대표 줄 + 종결: 상태칸에 종료 표기 / 그 외는 최초 질의 유형 유지
    const rowStatusLabel =
      isRoot && threadClosed
        ? '처리 완료(종료)'
        : historyStatusLabel(req.status, req, { isThreadRoot: isRoot });
    const rowIsAdminStart = rowStatusLabel === '관리자 문의/요청';
    const rowIsAdminReply = rowStatusLabel === '관리자 답변';
    const rowIsUserStart = rowStatusLabel === '사용자 문의/요청';
    const rowIsUserReply = rowStatusLabel === '사용자 답변';
    const canCancelAdminSend =
      (req.status === '관리자 의견발송' || req.status === '관리자 답변') &&
      isLatestInThread &&
      !threadClosed;
    const modelName = parseHistoryModel(req);
    // 대표 줄: 스레드 최신 관리자 의견 반영 (하위 회신이 있어도 '-'로 보이지 않게)
    const threadAdminText = (() => {
      if (!isRoot) return String(req.adminOpinionText || '').trim();
      const members = [req, ...relatedChildren].sort((a, b) => reqTime(b) - reqTime(a));
      for (const m of members) {
        const t = String(
          m.adminOpinionText || parseAdminOpinion(m.adminOpinion).opinionText || ''
        ).trim();
        if (t) return t;
      }
      return '';
    })();
    const threadWaitingAdmin =
      isRoot &&
      !threadClosed &&
      isUserPendingStatus(String(latestRelated?.status || req.status || ''));
    const rowDate =
      getKSTDateString(
        isRoot
          ? latestRelated?.completedAt ||
              latestRelated?.requestDate ||
              latestRelated?.createdAt ||
              req.completedAt ||
              req.requestDate ||
              req.createdAt
          : req.completedAt || req.requestDate || req.createdAt
      ) ||
      (isRoot ? latestRelated?.requestDate : null) ||
      req.completedAt ||
      req.requestDate ||
      '-';
    const rootUserLabel = opts.userLabel || threadUserLabel(req);
    const rootAdminLabel = opts.adminLabel || pickThreadAdminLabel([req, ...relatedChildren]);
    const thisUserLabel = threadUserLabel(req);
    const thisAdminLabel = rowAdminLabel(req);
    const isAdminMsg = isAdminSideStatus(req.status);
    const isUserMsg = isUserPendingStatus(req.status) || String(req.adminOpinion || '').includes(':::REPLY:::');
    let userLabel = '';
    let adminLabel = '';
    if (isRoot) {
      userLabel = rootUserLabel;
      adminLabel = rootAdminLabel;
    } else {
      if (isUserMsg && thisUserLabel && !samePersonLabel(thisUserLabel, rootUserLabel)) userLabel = thisUserLabel;
      if (isAdminMsg && thisAdminLabel && !samePersonLabel(thisAdminLabel, rootAdminLabel)) adminLabel = thisAdminLabel;
      if (isClosedStatus(req.status)) {
        if (thisUserLabel && !samePersonLabel(thisUserLabel, rootUserLabel)) userLabel = thisUserLabel;
        if (thisAdminLabel && !samePersonLabel(thisAdminLabel, rootAdminLabel)) adminLabel = thisAdminLabel;
      }
    }

    return (
      <tr
        key={req.id}
        className={`h-12 transition-colors ${
          opts.depth > 0
            ? 'bg-slate-50/70 hover:bg-slate-50'
            : selectedIds.has(req.id)
              ? 'bg-slate-50'
              : 'hover:bg-slate-50/50'
        }`}
      >
        <td className="px-2 text-center">
          <input
            type="checkbox"
            checked={selectedIds.has(req.id)}
            onChange={() => {
              const next = new Set(selectedIds);
              next.has(req.id) ? next.delete(req.id) : next.add(req.id);
              setSelectedIds(next);
            }}
            className="accent-slate-800"
          />
        </td>
        <td className="px-2 text-center font-mono text-slate-500 tabular-nums">
          {opts.depth > 0 ? <span className="text-slate-400">└</span> : opts.rowNo}
        </td>
        <td className="px-2 text-center">
          {userLabel ? (
            <span className="text-slate-800 truncate block" title={userLabel}>{userLabel}</span>
          ) : (
            <span className="text-slate-300">-</span>
          )}
        </td>
        <td className="px-2 text-center">
          {isRoot ? (
            <span className="text-[9px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md whitespace-nowrap">
              {req.assetType || req.category || '일반'}
            </span>
          ) : (
            <span className="text-slate-300">-</span>
          )}
        </td>
        <td className="px-2 text-slate-900 truncate" title={isRoot ? (req.assetCode || '') : ''}>
          {isRoot ? (req.assetCode || req.code || '-') : <span className="text-slate-300">-</span>}
        </td>
        <td className="px-2 text-slate-800 truncate" title={isRoot ? modelName : ''}>
          {isRoot ? modelName : <span className="text-slate-300">-</span>}
        </td>
        <td className="px-2 text-slate-700 truncate" title={userRequestContent(req.content)}>
          {userRequestContent(req.content)}
        </td>
        <td className="px-2 border-l border-slate-200">
          {isRoot && threadWaitingAdmin ? (
            <span className="text-slate-400 italic font-bold">아직 답변이 없습니다.</span>
          ) : isRoot ? (
            <span className="text-slate-700 truncate block w-full" title={threadAdminText || ''}>
              {threadAdminText ? `" ${threadAdminText} "` : '-'}
            </span>
          ) : isUserPendingStatus(req.status) && isLatestInThread && !req.adminOpinionText ? (
            <span className="text-slate-400 italic font-bold">아직 답변이 없습니다.</span>
          ) : (
            <span className="text-slate-700 truncate block w-full" title={req.adminOpinionText || ''}>
              {req.adminOpinionText ? `" ${req.adminOpinionText} "` : '-'}
            </span>
          )}
        </td>
        <td className="px-2 text-center">
          {adminLabel ? (
            <span className="text-slate-800 truncate block" title={adminLabel}>{adminLabel}</span>
          ) : (
            <span className="text-slate-300">-</span>
          )}
        </td>
        <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800 border-l border-slate-200">{rowDate}</td>
        <td className="px-2 text-center overflow-hidden border-l border-slate-200">
          <button
            type="button"
            title={displayPending ? '클릭하여 답변/조치' : '클릭하여 내역 확인'}
            onClick={() => {
              openReqModal(latestRelated || req);
            }}
            className={`inline-block max-w-full border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
              threadClosed || rowStatusLabel === '처리 완료(종료)'
                ? 'bg-slate-100 text-slate-500 border-slate-200'
                : isPastStep
                  ? 'bg-slate-50 text-slate-500 border-slate-200'
                  : rowIsUserReply
                    ? 'bg-amber-50/80 text-amber-800 border-amber-200/80'
                    : rowIsUserStart
                      ? 'bg-amber-50/80 text-amber-800 border-amber-200/80'
                      : rowIsAdminReply || rowIsAdminStart
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-slate-100 text-slate-500 border-slate-300'
            }`}
          >
            {rowStatusLabel}
          </button>
        </td>
        <td className="px-2 text-center border-l border-slate-200 overflow-hidden">
          <div className="inline-flex items-center justify-center gap-1.5 flex-nowrap">
            {hasChildren && (
              <button
                type="button"
                title={opts.expanded ? '연관 회신 접기' : threadClosed ? '종료 내역 상세보기' : '연관 회신 상세보기'}
                onClick={() => toggleExpand(req.id)}
                className="inline-flex items-center gap-0.5 px-1.5 py-1 bg-white text-slate-600 border border-slate-200 rounded-md text-[10px] font-black hover:bg-slate-50 whitespace-nowrap"
              >
                {threadClosed ? '종료/상세보기' : '상세보기'}
                <span className="text-[11px] leading-none">{opts.expanded ? '▲' : '▼'}</span>
              </button>
            )}
            {canCancelAdminSend ? (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => handleCancelSend(req.id)}
                title={!canEdit ? '편집 권한 필요' : '상대 답변이 오기 전에만 전송을 취소할 수 있습니다.'}
                className={`px-1.5 py-1 border rounded-md text-[10px] font-black whitespace-nowrap ${
                  canEdit
                    ? 'bg-slate-100 text-slate-500 border-slate-200 hover:text-red-500 hover:bg-red-50'
                    : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
                }`}
              >
                전송 취소
              </button>
            ) : !hasChildren ? (
              <span className="text-slate-300">-</span>
            ) : null}
          </div>
        </td>
      </tr>
    );
  };

  if (loading) return <LoadingState />;

  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      <ItMasterPageChrome
        label="IT Asset Service Requests & History Log"
        title="전사 IT·업무자산 의견/요청 송수신 이력 아카이브"
        description="최초 요청만 목록에 올리고, 연관 회신은 상태 클릭 시 하위로 펼칩니다."
        menuPath="/asset/it/master/requests"
        canEdit={canEdit}
      />

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        <div className="p-3 px-4 bg-slate-200/70 border-b border-slate-300 flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight whitespace-nowrap">의견/요청 송수신 대장</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-1.5 py-0.5 rounded-md whitespace-nowrap">
              {filteredThreads.length}건
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto min-w-0 ml-auto scrollbar-hide">
            <div className="flex items-center gap-0.5 bg-white p-0.5 rounded-lg border border-slate-200 shadow-sm shrink-0">
              <button
                type="button"
                onClick={() => setFilterStatus('ALL')}
                className={`px-2 py-1 rounded-md text-[10px] font-black transition-all whitespace-nowrap ${
                  filterStatus === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                전체
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('PENDING')}
                className={`px-2 py-1 rounded-md text-[10px] font-black transition-all whitespace-nowrap ${
                  filterStatus === 'PENDING' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                문의/답변 진행
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('DONE')}
                className={`px-2 py-1 rounded-md text-[10px] font-black transition-all whitespace-nowrap ${
                  filterStatus === 'DONE' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                처리 완료(종료)
              </button>
            </div>

            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">사용자조직</span>
              <select
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[88px]"
              >
                <option value="ALL">전체</option>
                {uniqueDepts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300" />

              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">분류</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[88px]"
              >
                <option value="ALL">전체</option>
                {uniqueTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300" />

              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth('ALL');
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300" />

              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">월</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {HISTORY_MONTHS.map((month) => (
                  <option key={month} value={month}>{month}월</option>
                ))}
              </select>
            </div>

            <div className="relative w-28 shrink-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔢</span>
              <input
                type="text"
                placeholder="자산번호"
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                className="w-full pl-6 pr-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
            <div className="relative w-28 shrink-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">💻</span>
              <input
                type="text"
                placeholder="모델명"
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                className="w-full pl-6 pr-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
            <div className="relative w-28 shrink-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">👤</span>
              <input
                type="text"
                placeholder="사용자"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                className="w-full pl-6 pr-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={handleExportZip}
              className="px-2 py-1 bg-slate-800 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-black transition-all whitespace-nowrap shrink-0"
            >
              {selectedIds.size > 0 ? `ZIP(${selectedIds.size})` : 'ZIP'}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-2 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap shrink-0"
            >
              {selectedIds.size > 0 ? `EXCEL(${selectedIds.size})` : 'EXCEL'}
            </button>
            {isLV1 && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="px-2 py-1 bg-white text-rose-600 border border-rose-200 rounded-lg text-[10px] font-black shadow-sm hover:bg-rose-50 transition-all whitespace-nowrap shrink-0"
              >
                {selectedIds.size > 0 ? `삭제(LV_1)(${selectedIds.size})` : '삭제(LV_1)'}
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1480px]">
            <colgroup>
              <col className="w-[44px]" />
              <col className="w-[48px]" />
              <col className="w-[120px]" />
              <col className="w-[100px]" />
              <col className="w-[110px]" />
              <col className="w-[130px]" />
              <col className="w-[180px]" />
              <col className="w-[180px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[108px]" />
              <col className="w-[148px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black tracking-widest border-b border-slate-200">
              <tr>
                <th rowSpan={2} className="h-10 px-2 text-center align-middle">
                  <input
                    type="checkbox"
                    title={`필터된 전체 ${filteredRequests.length}건 선택/해제`}
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    className="w-3.5 h-3.5 cursor-pointer appearance-none rounded-[3px] border-2 border-indigo-600 bg-white checked:bg-indigo-600 checked:border-indigo-600 relative
                      after:content-[''] after:absolute after:hidden checked:after:block
                      after:left-[3px] after:top-[0px] after:w-[4px] after:h-[8px]
                      after:border-white after:border-r-2 after:border-b-2 after:rotate-45"
                  />
                </th>
                <th rowSpan={2} className="h-10 px-2 text-center align-middle">NO</th>
                <th colSpan={5} className="h-8 px-2 text-center bg-slate-50 text-slate-600 border-b border-slate-100">
                  사용자 영역
                </th>
                <th colSpan={2} className="h-8 px-2 text-center bg-rose-50/70 text-rose-700 border-b border-rose-100 border-l border-slate-200">
                  관리자 영역
                </th>
                <th rowSpan={2} className="h-10 px-2 text-center align-middle whitespace-nowrap border-l border-slate-200">요청/처리일자</th>
                <th rowSpan={2} className="h-10 px-2 text-center align-middle border-l border-slate-200">상태</th>
                <th rowSpan={2} className="h-10 px-2 text-center align-middle whitespace-nowrap border-l border-slate-200">관리 액션</th>
              </tr>
              <tr>
                <th className="h-10 px-2 text-center whitespace-nowrap">부서 / 사용자</th>
                <th className="h-10 px-2 text-center whitespace-nowrap">자산 분류</th>
                <th className="h-10 px-2">자산번호</th>
                <th className="h-10 px-2">모델명</th>
                <th className="h-10 px-2">사용자 요청/답변</th>
                <th className="h-10 px-2 border-l border-slate-200">관리자 요청/답변</th>
                <th className="h-10 px-2 text-center whitespace-nowrap">부서 / 관리자</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {currentThreads.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-16 text-center text-slate-400 text-xs">
                    조건에 맞는 송수신 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                currentThreads.map((thread, i) => {
                  const rowNo = filteredThreads.length - ((currentPage - 1) * itemsPerPage + i);
                  const expanded = expandedIds.has(String(thread.root.id));
                  const latestId = String(
                    [...thread.children, thread.root].sort((a, b) => {
                      const d = reqTime(b) - reqTime(a);
                      if (d !== 0) return d;
                      return String(b.id || '').localeCompare(String(a.id || ''));
                    })[0]?.id || thread.root.id
                  );
                  const userLabel = threadUserLabel(thread.root);
                  const adminLabel = pickThreadAdminLabel([thread.root, ...thread.children]);
                  return (
                    <Fragment key={thread.root.id}>
                      {renderLedgerRow(thread.root, {
                        rowNo,
                        depth: 0,
                        childCount: thread.children.length,
                        expanded,
                        children: thread.children,
                        latestId,
                        userLabel,
                        adminLabel,
                      })}
                      {expanded &&
                        thread.children.map((child) =>
                          renderLedgerRow(child, {
                            rowNo: '',
                            depth: 1,
                            latestId,
                            userLabel,
                            adminLabel,
                          })
                        )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredThreads.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setCurrentPage(i + 1)}
                className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
                  currentPage === i + 1
                    ? 'bg-slate-800 text-white shadow-sm scale-105'
                    : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>

      {editingReq && (() => {
        const threadMsgs = collectThreadMessages(editingReq, requests);
        const latest = threadMsgs[threadMsgs.length - 1] || editingReq;
        const threadClosed = isThreadClosed(
          threadMsgs[0] || editingReq,
          threadMsgs.slice(1)
        );
        const waitingForUser = !threadClosed && isWaitingForUser(latest.status);
        const canAdminReply = canEdit && !threadClosed && !waitingForUser;
        const turns = threadMsgs.flatMap(threadTurns);
        const assetModel = parseHistoryModel(editingReq);

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[700] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
              className="bg-white w-[500px] border border-slate-200 shadow-2xl p-8 rounded-3xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">
                {threadClosed
                  ? '처리 완료(종료)'
                  : waitingForUser
                    ? (latest.status === '관리자 답변' ? '관리자 답변' : '관리자 문의/요청')
                    : isIncomingReply(latest, requests)
                      ? '사용자 답변'
                      : '사용자 문의/요청'}
              </h4>
              <p className="text-[10px] font-bold text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
                {!canEdit
                  ? '주고받은 전체 이력을 확인할 수 있습니다 (조회 전용)'
                  : threadClosed
                    ? '주고받은 전체 이력을 확인할 수 있습니다'
                    : waitingForUser
                      ? '사용자 답변 전 · 전송 취소 또는 내용 수정 가능'
                      : '답변을 작성하거나 처리 완료(종료)할 수 있습니다'}
              </p>

              <div className="overflow-y-auto flex-1 pr-2 space-y-4 min-h-0">
                <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                  <div className="flex justify-between gap-3 text-[11px] font-bold">
                    <span className="text-slate-400 shrink-0">대상자산</span>
                    <span className="text-slate-800 text-right">
                      {editingReq.assetType || editingReq.category || '-'} | {editingReq.assetCode || '-'} / {assetModel}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 text-[11px] font-bold">
                    <span className="text-slate-400 shrink-0">대상 사용자</span>
                    <span className="text-slate-800 text-right">
                      {editingReq.requester || '-'} ({editingReq.dept || '-'})
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 text-[11px] font-bold">
                    <span className="text-slate-400 shrink-0">상태</span>
                    <span className={threadClosed ? 'text-slate-500' : waitingForUser ? 'text-rose-600' : 'text-amber-600'}>
                      {threadClosed
                        ? '처리 완료(종료)'
                        : waitingForUser
                          ? '사용자 답변 대기중'
                          : '대화 진행중'}
                    </span>
                  </div>
                </div>

                {turns.map((turn, idx) => (
                  <div key={`${turn.role}-${idx}`}>
                    <p className={`text-[10px] font-black uppercase tracking-wider mb-2 ${turn.role === 'admin' ? 'text-rose-600' : 'text-amber-600'}`}>
                      {turn.label}
                    </p>
                    <div className={`w-full min-h-[4rem] p-4 text-[11px] font-bold rounded-xl whitespace-pre-wrap leading-relaxed ${
                      turn.role === 'admin'
                        ? 'bg-rose-50 border border-rose-100 text-rose-900'
                        : 'bg-amber-50 border border-amber-100 text-amber-900'
                    }`}>
                      {turn.text}
                    </div>
                    {turn.date && (
                      <p className="mt-1.5 text-[10px] font-bold text-slate-400 text-right tabular-nums">{turn.date}</p>
                    )}
                  </div>
                ))}

                {canAdminReply && (
                  <div>
                    <p className="text-[10px] font-black text-rose-600 uppercase tracking-wider mb-2">답변 내용</p>
                    <textarea
                      value={editOpinion}
                      onChange={(e) => setEditOpinion(e.target.value)}
                      placeholder="사용자에게 전달할 답변·조치 내용을 작성하세요."
                      className="w-full min-h-[8rem] bg-white border border-rose-200 p-4 text-[11px] font-bold text-slate-800 rounded-xl outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-300 transition-all resize-none shadow-inner"
                    />
                  </div>
                )}
                {canEdit && waitingForUser && commEditMode && (
                  <div>
                    <p className="text-[10px] font-black text-rose-600 uppercase tracking-wider mb-2">내용 수정</p>
                    <textarea
                      value={editOpinion}
                      onChange={(e) => setEditOpinion(e.target.value)}
                      placeholder="사용자에게 전달할 내용을 수정하세요."
                      className="w-full min-h-[8rem] bg-white border border-amber-300 p-4 text-[11px] font-bold text-slate-800 rounded-xl outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-300 transition-all resize-none shadow-inner"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
                {!canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingReq(null);
                      setEditOpinion('');
                      setCommEditMode(false);
                    }}
                    className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[11px] hover:bg-slate-200 transition-colors"
                  >
                    닫기
                  </button>
                ) : waitingForUser && commEditMode ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setCommEditMode(false);
                        setEditOpinion(opinionDisplay(latest.adminOpinion));
                      }}
                      className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-colors"
                    >
                      편집 취소
                    </button>
                    <button
                      type="button"
                      onClick={handleUpdateAdminOutbound}
                      className="flex-[2] py-3.5 bg-amber-500 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-amber-600 active:scale-95 transition-all"
                    >
                      내용 저장
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingReq(null);
                        setEditOpinion('');
                        setCommEditMode(false);
                      }}
                      className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[11px] hover:bg-slate-200 transition-colors"
                    >
                      닫기
                    </button>
                    {waitingForUser && (
                      <button
                        type="button"
                        onClick={() => handleCancelSend(String(latest.id))}
                        className="flex-1 py-3.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl font-black text-[11px] hover:bg-rose-100 transition-colors"
                      >
                        전송 취소
                      </button>
                    )}
                    {waitingForUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditOpinion(opinionDisplay(latest.adminOpinion));
                          setCommEditMode(true);
                        }}
                        className="flex-1 py-3.5 bg-white text-slate-700 border border-slate-300 rounded-xl font-black text-[11px] hover:bg-slate-50 transition-colors"
                      >
                        내용 수정
                      </button>
                    )}
                    {waitingForUser && (
                      <button
                        type="button"
                        onClick={() => submitThreadAction('close')}
                        className="flex-1 py-3.5 bg-white text-slate-600 border border-slate-300 rounded-xl font-black text-[11px] hover:bg-slate-50 transition-colors"
                      >
                        처리 완료(종료)
                      </button>
                    )}
                    {threadClosed && (
                      <button
                        type="button"
                        onClick={() => openAdminCompose(editingReq)}
                        className="flex-[1.4] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                      >
                        신규 요청하기
                      </button>
                    )}
                    {canAdminReply && (
                      <>
                        <button
                          type="button"
                          onClick={() => submitThreadAction('reply')}
                          className="flex-[1.4] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                        >
                          사용자에게 답변 전송
                        </button>
                        <button
                          type="button"
                          onClick={() => submitThreadAction('close')}
                          className="flex-1 py-3.5 bg-white text-slate-600 border border-slate-300 rounded-xl font-black text-[11px] hover:bg-slate-50 transition-colors"
                        >
                          처리 완료(종료)
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {adminComposeReq && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[710] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div
            className="bg-white w-[500px] border border-slate-200 shadow-2xl p-8 rounded-3xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">신규 요청하기</h4>
            <p className="text-[10px] font-bold text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
              자산 사용자에게 전달할 요청·의견을 작성해 주세요
            </p>

            <div className="overflow-y-auto flex-1 pr-2 space-y-4 scrollbar-hide">
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                <div className="flex justify-between gap-3 text-[11px] font-bold">
                  <span className="text-slate-400 shrink-0">대상자산</span>
                  <span className="text-slate-800 text-right">
                    {adminComposeReq.assetType || adminComposeReq.category || '-'} | {adminComposeReq.assetCode || '-'} / {parseHistoryModel(adminComposeReq)}
                  </span>
                </div>
                <div className="flex justify-between gap-3 text-[11px] font-bold">
                  <span className="text-slate-400 shrink-0">발송일</span>
                  <span className="text-slate-800 tabular-nums">{getKSTDateString()}</span>
                </div>
                <div className="flex justify-between gap-3 text-[11px] font-bold">
                  <span className="text-slate-400 shrink-0">대상 사용자</span>
                  <span className="text-slate-800 text-right">
                    {adminComposeReq.requester || '-'} ({adminComposeReq.dept || '-'})
                  </span>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-black text-rose-600 uppercase tracking-wider mb-2">의견 내용</p>
                <textarea
                  value={editOpinion}
                  onChange={(e) => setEditOpinion(e.target.value)}
                  placeholder="실사 안내, 자산 확인 요청, 교체 일정 협의 등 사용자에게 전달할 내용을 작성하세요."
                  className="w-full min-h-[8rem] bg-white border border-rose-200 p-4 text-[11px] font-bold text-slate-800 rounded-xl outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-300 transition-all resize-none shadow-inner"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={closeAdminCompose}
                className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[11px] hover:bg-slate-200 transition-colors"
              >
                닫기
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={submitAdminOpinionRequest}
                  className="flex-[2] py-3.5 bg-rose-600 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-rose-700 active:scale-95 transition-all"
                >
                  사용자에게 의견/요청 전송
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MasterRequestModule() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ITMasterRequestContent />
    </Suspense>
  );
}
