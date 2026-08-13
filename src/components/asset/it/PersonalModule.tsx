'use client';
     
import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx'; 
import { getKSTDateString, getKSTDaysUntil, getKSTNowYearMonth, getKSTYearMonth, toSortableTime } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import {
  buildInfoCorrectionPending,
  getCompletedAuditLabel,
  getDisplayFieldValue,
  hasInfoCorrectionPending,
  parseInfoCorrectionPending,
  INFO_CORRECTION_FIELDS,
  INFO_CORRECTION_FIELD_LABELS,
  type InfoCorrectionField,
} from '@/utils/itInfoCorrection';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import {
  applyIdentityToRequestPayload,
  assetMatchesIdentity,
  requestMatchesIdentity,
  toItIdentity,
} from '@/utils/itUserIdentity';

const MENU_PATH = '/asset/it/personal';

/** KST 연·월 문자열 (year: '2026', month: '07') */
function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const raw = String(dateInput).trim();
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
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
  if (!hasUserContent && adminText) return true;
  return false;
}

function historyStatusLabel(status: string, req?: any, opts?: { isThreadRoot?: boolean }) {
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

function isUserPendingStatus(status: string) {
  return status === '의견전송' || status === '답변 대기중' || status === '답변회신';
}

function isClosedStatus(status: string) {
  return status === '처리완료' || status === '관리자 확인완료' || status === '사용자 종료처리';
}

function isAdminClosedStatus(status: string) {
  return status === '처리완료' || status === '관리자 확인완료' || status === '사용자 종료처리';
}

function isUserReplyRow(req: any) {
  if (!req) return false;
  const s = String(req.status || '').trim();
  return s === '답변회신' || String(req.adminOpinion || '').includes(':::REPLY:::');
}

function sameAssetCode(a: any, b: any) {
  return String(a?.assetCode || '').trim() === String(b?.assetCode || '').trim();
}

function reqTime(r: any) {
  return toSortableTime(r?.createdAt || r?.requestDate || 0);
}

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

  // 종결 후에도 스레드 소속 유지 — 루트가 이전 자산 이력에 잘못 붙지 않게
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
  const parts = String(raw || '').split(':::');
  const text = (parts[0] || '').trim();
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

function ThreadTurnList({ turns }: { turns: { role: 'admin' | 'user'; label: string; text: string; date: string }[] }) {
  return (
    <>
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
    </>
  );
}

/** 하단 표 '관리자 답변' / '관리자 문의/요청'과 동일 계열 (미확인) */
function isAdminFeedbackStatus(status: string) {
  return status === '관리자 의견발송' || status === '관리자 답변';
}

function isAdminOutboundRequest(status: string) {
  return status === '관리자 의견발송' || status === '관리자 답변';
}

function feedbackAckStorageKey(email: string) {
  return `it_feedback_acked_${email}`;
}

function userRequestContent(raw: string | null | undefined) {
  const text = String(raw || '').trim();
  if (!text || text === '(관리자 의견)') return '-';
  return `"${text}"`;
}

function parseHistoryModel(req: any, assets: any[]) {
  const info = String(req?.assetInfo || '');
  const slash = info.indexOf('/');
  if (slash >= 0) {
    const model = info.slice(slash + 1).trim();
    if (model) return model;
  }
  const hit = assets.find((a) => a.code === req?.assetCode);
  return hit?.model || '-';
}

/** adminOpinion 저장 포맷: 의견:::처리자이름:::처리자부서[:::USERACK:::확인자이름:::확인자부서] */
function isMetaResponderName(name: string) {
  const n = String(name || '').trim().toUpperCase();
  return !n || n === '-' || n === 'REPLY' || n === 'USERACK';
}

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
     
export default function PersonalModule() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]); 
  const [audits, setAudits] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [focusedAuditId, setFocusedAuditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [typeLabel, setTypeLabel] = useState('자산 분류'); 
  /** 관리자 settings → it_rental_group 라벨 (필터 옵션) */
  const [rentalMasterLabels, setRentalMasterLabels] = useState<string[]>([]);
  // ✨ 자산 분류(it_type) 필터 추가 완료
  const [colFilters, setColFilters] = useState({ category: '', it_type: '', is_rental: '' });
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [ddayFilter, setDdayFilter] = useState<'all' | 'd-30' | 'd-day' | 'd-plus'>('all');
  const [showStatusFilter, setShowStatusFilter] = useState<'all' | 'done' | 'pending' | 'nudge' | 'info_correction'>('all');
  /** 의견/요청: 조치완료·관리자답변 중 미확인(확인처리 전)만 */
  const [showFeedbackOnly, setShowFeedbackOnly] = useState(false);
  /** 나의 전송 내역(사용자→관리자) — 업무자산 목록 의견/요청 필터 */
  const [showSentOnly, setShowSentOnly] = useState(false);
  const [ackedRequestIds, setAckedRequestIds] = useState<Set<string>>(() => new Set());

  /** assets | history — personal 워크스페이스 탭 */
  const [mainTab, setMainTab] = useState<'assets' | 'history'>('assets');
  /** 송수신 대장 상태 필터 (의견/요청 대시보드 딥링크) */
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'ALL' | 'PENDING' | 'FEEDBACK'>('ALL');
  
  const [unifiedCommModal, setUnifiedCommModal] = useState<any | null>(null);
  const [pendingRequest, setPendingRequest] = useState<any | null>(null);
  const [completedRequest, setCompletedRequest] = useState<any | null>(null);
  const [commEditMode, setCommEditMode] = useState(false);
  /** 관리자 요청 확인 → 이력 유지한 채 답변 작성 */
  const [requestContent, setRequestContent] = useState('');
  const [confirmAuditModal, setConfirmAuditModal] = useState<any | null>(null);
  const [infoEditDraft, setInfoEditDraft] = useState<Record<InfoCorrectionField, string>>({
    model: '',
    sn: '',
    brand: '',
    spec: '',
  });
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const [historyTypeFilter, setHistoryTypeFilter] = useState('ALL');
  const [historyYear, setHistoryYear] = useState(() => String(getKSTNowYearMonth().year));
  const [historyMonth, setHistoryMonth] = useState('ALL');
  const [historyCodeQuery, setHistoryCodeQuery] = useState('');
  const [historyModelQuery, setHistoryModelQuery] = useState('');
  const [historyExpandedIds, setHistoryExpandedIds] = useState<Set<string>>(new Set());
  
  const todayStr = getKSTDateString();
  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [searchQuery, colFilters, showReplaceableOnly, showStatusFilter, showFeedbackOnly, showSentOnly, ddayFilter, focusedAuditId]);

  useEffect(() => {
    if (!currentUser?.email) return;
    try {
      const raw = localStorage.getItem(feedbackAckStorageKey(currentUser.email));
      if (!raw) {
        setAckedRequestIds(new Set());
        return;
      }
      const ids = JSON.parse(raw);
      setAckedRequestIds(new Set(Array.isArray(ids) ? ids.map(String) : []));
    } catch {
      setAckedRequestIds(new Set());
    }
  }, [currentUser?.email]);

  const persistAckedRequestIds = (next: Set<string>) => {
    setAckedRequestIds(next);
    if (!currentUser?.email) return;
    try {
      localStorage.setItem(feedbackAckStorageKey(currentUser.email), JSON.stringify([...next]));
    } catch {
      /* ignore quota / private mode */
    }
  };

  const ackFeedbackRequest = (id: string) => {
    if (!id) return;
    const next = new Set(ackedRequestIds);
    next.add(String(id));
    persistAckedRequestIds(next);
  };

  const goAssetsTab = () => setMainTab('assets');
  const goHistoryTab = (status: 'ALL' | 'PENDING' | 'FEEDBACK' = 'ALL') => {
    setMainTab('history');
    setHistoryStatusFilter(status);
    setShowFeedbackOnly(false);
    setShowSentOnly(false);
  };
  /** 나의 전송 내역 → 업무자산 목록에서 사용자→관리자 대기 행만 */
  const toggleSentAssetFilter = () => {
    setMainTab('assets');
    setHistoryStatusFilter('ALL');
    setShowReplaceableOnly(false);
    setDdayFilter('all');
    setShowStatusFilter('all');
    setShowFeedbackOnly(false);
    setShowSentOnly((prev) => !prev);
  };
  /** 나의 수신 내역 → 업무자산 목록에서 관리자→사용자 행만 */
  const toggleFeedbackAssetFilter = () => {
    setMainTab('assets');
    setHistoryStatusFilter('ALL');
    setShowReplaceableOnly(false);
    setDdayFilter('all');
    setShowStatusFilter('all');
    setShowSentOnly(false);
    setShowFeedbackOnly((prev) => !prev);
  };
  
  const fetchAllData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [configRes, meRes, assetRes, reqRes, auditRes, unitRes, summaryRes, ifRes, masterRes] = await Promise.all([
        fetch('/api/admin/config').catch(()=>null),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/asset/it?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/asset/it/requests?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);

      if (configRes && configRes.ok) {
        const configData = await configRes.json();
        if (configData?.it_master_label) setTypeLabel(configData.it_master_label);
        if (masterRes && masterRes.ok) {
          const masterData = await masterRes.json();
          const rentalGroup = Array.isArray(masterData)
            ? masterData.find((g: any) => g.id === configData?.it_rental_group)
            : null;
          setRentalMasterLabels(
            rentalGroup?.codes
              ? rentalGroup.codes.filter((c: any) => !c.is_archived).map((c: any) => c.label)
              : []
          );
        } else {
          setRentalMasterLabels([]);
        }
      }

      let user: any = null;
      if (meRes && meRes.ok) {
        const userData = await meRes.json();
        user = {
          ...userData,
          id: userData.id,
          name: String(userData.name || '').trim(),
          dept: String(userData.unit?.unit_name || userData.dept || '').trim(),
          email: userData.email || '',
        };
        setCurrentUser(user);
      }

      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);

      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/it/personal'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }

      if (unitRes && unitRes.ok) {
        const unitData = await unitRes.json();
        setUnits(Array.isArray(unitData) ? unitData : []);
      }

      if (auditRes && auditRes.ok) setAudits(await auditRes.json());
      if (reqRes && reqRes.ok) setRequests(await reqRes.json());

      if (assetRes && assetRes.ok) {
        const allAssets = await assetRes.json();
        // 서버 스코프 + 클라이언트 방어: email/userId 우선 (동명이인 혼입 방지)
        if (user) {
          const identity = toItIdentity(user);
          setAssets(
            (Array.isArray(allAssets) ? allAssets : []).filter((a: any) =>
              assetMatchesIdentity(a, identity)
            )
          );
        } else setAssets([]);
      } else if (assetRes && (assetRes.status === 401 || assetRes.status === 403)) {
        setAssets([]);
      }
    } catch (e) { console.error("Data Sync Failed", e); } 
    finally { setLoading(false); }
  };

  /** 예전에 로컬만 확인처리된 관리자 요청을 서버에 맞춰 관리자 대시보드 카운트도 제외 */
  const outboundAckSyncRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const targets = requests.filter((r) => {
      const id = String(r.id || '');
      if (!id || !ackedRequestIds.has(id)) return false;
      if (r.status === '관리자 의견발송') return true;
      if (r.status === '사용자 확인완료' && !String(r.adminOpinion || '').includes(':::USERACK:::')) return true;
      return false;
    });
    const toSync = targets.filter((r) => r.id && !outboundAckSyncRef.current.has(String(r.id)));
    if (toSync.length === 0) return;

    toSync.forEach((r) => outboundAckSyncRef.current.add(String(r.id)));

    (async () => {
      const results = await Promise.all(
        toSync.map((r) =>
          fetch('/api/asset/it/requests', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: r.id,
              action: 'USER_ACK',
              ackedBy: currentUser?.name || '',
              ackedDept: currentUser?.dept || '',
            }),
          }).catch(() => null)
        )
      );
      if (results.some((res) => res && res.ok)) {
        fetchAllData();
      }
    })();
  }, [requests, ackedRequestIds]);

  useEffect(() => { fetchAllData(); }, []);

  const unitCovers = (ancestorName: string, descendantName: string) => {
    if (ancestorName === descendantName) return true;
    let current = units.find((u) => u.unit_name === descendantName);
    while (current?.parent_id) {
      const parent = units.find((u) => u.id === current.parent_id);
      if (!parent) break;
      if (parent.unit_name === ancestorName) return true;
      current = parent;
    }
    return false;
  };

  /** 로그인 사용자 소속(unit)이 실사 대상범위에 포함되는지 */
  const userInAuditTarget = (target: string) => {
    const dept = String(currentUser?.dept || '').trim();
    if (!dept) return false;
    const targets = String(target || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (targets.length === 0) return false;
    if (targets.includes('전사')) return true;
    return targets.some((t) => unitCovers(t, dept));
  };

  const formatAuditTargetLabel = (target: string) => {
    const parts = String(target || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length === 0) return '대상미정';
    if (parts.length === 1) return parts[0];
    return `${parts[0]} 외`;
  };

  /** 본인 소속에 해당하는 진행 중 실사만 */
  const myRunningAudits = useMemo(
    () =>
      audits
        .filter((a) => a.status === '진행중' && userInAuditTarget(a.target))
        .sort((a, b) => String(a.endDate || '').localeCompare(String(b.endDate || ''))),
    [audits, currentUser, units]
  );

  useEffect(() => {
    if (myRunningAudits.length === 0) {
      if (focusedAuditId) setFocusedAuditId(null);
      setShowStatusFilter((prev) =>
        prev === 'done' || prev === 'pending' || prev === 'nudge' ? 'all' : prev
      );
      return;
    }
    if (!focusedAuditId || !myRunningAudits.some((a) => a.id === focusedAuditId)) {
      setFocusedAuditId(myRunningAudits[0].id);
    }
  }, [myRunningAudits, focusedAuditId]);

  const focusedAudit = useMemo(
    () => myRunningAudits.find((a) => a.id === focusedAuditId) || myRunningAudits[0] || null,
    [myRunningAudits, focusedAuditId]
  );

  const isAuditActive = myRunningAudits.length > 0;
  const activeAudit = focusedAudit;

  const getCoveringAudit = (asset: any) => {
    const dept = String(asset?.dept || currentUser?.dept || '').trim();
    const covered = myRunningAudits.filter((a) => {
      const targets = String(a.target || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (targets.includes('전사')) return true;
      if (!dept) return userInAuditTarget(a.target);
      return targets.some((t) => unitCovers(t, dept));
    });
    if (covered.length === 0) return null;
    return covered.find((a) => a.id === focusedAuditId) || covered[0];
  };
  
  const getAssetLogic = (a: any) => {
    // 교체예정·D-day: API(마스터 규칙)가 부착한 값만 사용
    const repDate = a.replace_due_date || '-';
    const dday =
      typeof a.replace_dday === 'number'
        ? a.replace_dday
        : a.replace_dday === 0
          ? 0
          : null;
    const isTargetCount = dday !== null && dday <= 30;
    
    const lastAudit = a.last_audit_date || '';
    let auditStatusLabel = '미확인';
    let auditStatusDate: string | null = null;
    let auditStatusColor = 'bg-slate-100 text-slate-600 border-slate-300 cursor-not-allowed border-dashed';
    let isVerified = false;
    const coveringAudit = getCoveringAudit(a);
    let isNudged = !!coveringAudit && !!a.audit_request_date;
    const hasInfoCorrection = hasInfoCorrectionPending(a);

    if (coveringAudit) {
      if (lastAudit && lastAudit >= coveringAudit.startDate) {
        isVerified = true;
        auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
        auditStatusDate = lastAudit;
        auditStatusColor = a.last_audit_by === 'admin'
          ? 'bg-violet-50 border-violet-200 text-violet-800 hover:bg-violet-100 shadow-sm cursor-pointer'
          : 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200 shadow-sm cursor-pointer';
      } else if (hasInfoCorrection) {
        auditStatusLabel = '수정 대기중';
        auditStatusDate = parseInfoCorrectionPending(a.info_correction_pending)?.requestedAt || null;
        auditStatusColor = 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 cursor-pointer';
      } else if (isNudged) {
        auditStatusLabel = '마감 임박';
        auditStatusDate = a.audit_request_date || null;
        auditStatusColor = 'bg-rose-100 text-rose-800 border-rose-300 shadow-sm cursor-pointer';
      } else {
        auditStatusLabel = '실사 진행하기';
        auditStatusColor = 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 border-indigo-700 cursor-pointer';
      }
    } else if (isAuditActive) {
      // 본인 소속 실사는 있으나 이 자산 부서가 해당 범위 밖
      if (lastAudit) {
        isVerified = true;
        auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
        auditStatusDate = lastAudit;
        auditStatusColor = 'bg-slate-100 text-slate-700 border-slate-300 cursor-not-allowed';
      } else {
        auditStatusLabel = '대상 외';
        auditStatusColor = 'bg-slate-100 text-slate-500 border-slate-200 border-dashed cursor-not-allowed';
      }
    } else {
      if (hasInfoCorrection) {
        auditStatusLabel = '수정 대기중';
        auditStatusDate = parseInfoCorrectionPending(a.info_correction_pending)?.requestedAt || null;
        auditStatusColor = 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 cursor-pointer';
      } else if (lastAudit) {
        auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
        auditStatusDate = lastAudit;
        // 실사 대기 중: 관리자확인도 회색 (클릭 시 정보수정만)
        auditStatusColor = 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200 cursor-pointer';
        isVerified = true;
      } else {
        // 실사 대기: 실사 확인은 불가, 정보수정 요청만 가능
        auditStatusLabel = '정보수정';
        auditStatusColor = 'bg-slate-100 text-slate-600 border-slate-300 border-dashed hover:bg-amber-50 hover:border-amber-200 hover:text-amber-800 cursor-pointer';
      }
    }
    const auditStatusText = auditStatusDate ? `${auditStatusLabel} (${auditStatusDate})` : auditStatusLabel;
     
    const assetRequests = requests.filter(r => r.assetCode === a.code).sort((r1, r2) => new Date(r2.createdAt).getTime() - new Date(r1.createdAt).getTime());
    const latestReq = assetRequests[0];
     
    let commStatusLabel = '신규 요청하기';
    let commStatusDate: string | null = null;
    let commStatusColor = 'bg-slate-100 border-slate-300 border-dashed text-slate-600 hover:bg-slate-200 shadow-sm';
    let hasUnreadFeedback = false;
    let isAwaitingAdminReply = false;
     
    if (latestReq) {
      const reqDate = getKSTDateString(latestReq.requestDate || latestReq.createdAt) || latestReq.requestDate || null;
      if (isUserPendingStatus(latestReq.status)) {
        commStatusLabel = isUserReplyRow(latestReq) ? '사용자 답변' : '사용자 문의/요청';
        commStatusDate = reqDate;
        commStatusColor = 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100';
        isAwaitingAdminReply = true;
      } else if (latestReq.status === '관리자 의견발송') {
        commStatusLabel = '관리자 문의/요청';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        hasUnreadFeedback = true;
        commStatusColor = 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100 animate-pulse shadow-sm';
      } else if (latestReq.status === '관리자 답변') {
        commStatusLabel = '관리자 답변';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        hasUnreadFeedback = true;
        commStatusColor = 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100 shadow-sm';
      } else if (isAdminClosedStatus(latestReq.status)) {
        commStatusLabel = '처리 완료(종료)';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        // 실사 완료 · 신규 요청하기와 동일 톤
        commStatusColor = 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200 shadow-sm';
      }
    }
    const commStatusText = commStatusDate ? `${commStatusLabel} (${commStatusDate})` : commStatusLabel;
  
    return {
      repDate, dday, isTargetCount, isVerified, isNudged, hasInfoCorrection,
      isInAuditScope: !!coveringAudit,
      auditStatusLabel, auditStatusDate, auditStatusText, auditStatusColor,
      commStatusLabel, commStatusDate, commStatusText, commStatusColor,
      hasUnreadFeedback, isAwaitingAdminReply,
    };
  };
  
  const openInfoCorrectionModal = (asset: any) => {
    setInfoEditDraft({
      model: getDisplayFieldValue(asset, 'model').value,
      sn: getDisplayFieldValue(asset, 'sn').value,
      brand: getDisplayFieldValue(asset, 'brand').value,
      spec: getDisplayFieldValue(asset, 'spec').value,
    });
    setConfirmAuditModal({
      ...asset,
      action: hasInfoCorrectionPending(asset) ? 'EDIT_INFO_PENDING' : 'EDIT_INFO',
    });
  };

  const cancelInfoCorrection = async () => {
    if (!confirmAuditModal) return;
    if (!confirm('정보수정 요청을 취소하고 실사 대기 상태(미실사/실사 진행)로 되돌릴까요?')) return;
    try {
      const res = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: confirmAuditModal.id,
          info_correction_pending: null,
        }),
      });
      if (res.ok) {
        alert('정보수정 요청이 취소되었습니다.');
        setConfirmAuditModal(null);
        fetchAllData();
      } else {
        alert('요청 취소에 실패했습니다.');
      }
    } catch {
      alert('서버 통신 오류가 발생했습니다.');
    }
  };

  const submitInfoCorrection = async () => {
    if (!confirmAuditModal || !currentUser) return;
    const pending = buildInfoCorrectionPending({
      original: confirmAuditModal,
      draft: infoEditDraft,
      requestedAt: todayStr,
      requestedBy: currentUser.email,
    });
    if (!pending) {
      alert('변경된 항목이 없습니다. 수정이 필요한 칸만 고쳐 주세요.');
      return;
    }
    try {
      const res = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: confirmAuditModal.id,
          info_correction_pending: pending,
        }),
      });
      if (res.ok) {
        alert('정보수정 요청이 접수되었습니다. 관리자 승인 후 반영됩니다.');
        setConfirmAuditModal(null);
        fetchAllData();
      } else {
        alert('정보수정 요청 저장에 실패했습니다.');
      }
    } catch {
      alert('서버 통신 오류가 발생했습니다.');
    }
  };

  // ✨ 실사 확인 및 취소(서버 API 연동)
  const executeAuditVerify = async () => {
    if (!confirmAuditModal || !currentUser) return;
    if (!isAuditActive) {
      return alert('실사 진행 중에만 실사 확인·취소가 가능합니다.\n정보수정은 실사 칸에서 요청해 주세요.');
    }
    const coveringAudit = getCoveringAudit(confirmAuditModal);
    if (!coveringAudit) {
      return alert('이번 실사 대상 범위가 아닌 자산입니다.');
    }
    const assetId = confirmAuditModal.id;
    
    // VERIFY(인증)인지 CANCEL(취소)인지 판단
    const isCancel = confirmAuditModal.action === 'CANCEL';
    const dateToSave = isCancel ? null : todayStr;
    const isDoneValue = !isCancel;

    try {
      const assetUpdate = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assetId,
          last_audit_date: dateToSave,
          last_audit_by: isCancel ? null : 'user',
          audit_request_date: '',
        })
      });

      const responseAudit = coveringAudit;
      if (responseAudit) {
        await fetch('/api/asset/it/audit', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: responseAudit.id,
            responses: {
              upsert: {
                where: { auditId_userEmail: { auditId: responseAudit.id, userEmail: currentUser.email } },
                update: { isDone: isDoneValue, date: dateToSave },
                create: { userEmail: currentUser.email, isDone: isDoneValue, date: dateToSave }
              }
            }
          })
        }).catch(() => null);
      }

      if (assetUpdate.ok) {
        alert(isCancel ? `❌ [${confirmAuditModal.code}] 실사 인증이 취소되었습니다.` : `✅ [${confirmAuditModal.code}] 실사 내역이 기록되었습니다.`);
        setConfirmAuditModal(null);
        fetchAllData(); 
      }
    } catch (error) {
      alert("서버 통신 오류가 발생했습니다.");
    }
  };
  
  const stats = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    let verified = 0, requestCount = 0, feedbackCount = 0, awaitingReplyCount = 0;
    let auditDoneCount = 0, auditPendingCount = 0, auditNudgeCount = 0, infoCorrectionCount = 0;
    let d30Count = 0, dDayCount = 0, dPlusCount = 0;
    assets.forEach(a => {
      typeCounts[a.it_type] = (typeCounts[a.it_type] || 0) + 1;
      const logic = getAssetLogic(a);
      if (logic.isVerified) verified++;
      if (logic.isNudged) requestCount++;
      if (logic.hasUnreadFeedback) feedbackCount++;
      if (logic.isAwaitingAdminReply) awaitingReplyCount++;

      if (logic.hasInfoCorrection) infoCorrectionCount++;
      // 완료/미실사/독촉은 실사 진행 중에만 집계
      if (isAuditActive) {
        if (logic.isVerified) auditDoneCount++;
        else if (logic.hasInfoCorrection) {
          /* already counted */
        } else if (logic.isNudged) auditNudgeCount++;
        else auditPendingCount++;
      }

      if (logic.dday !== null) {
        if (logic.dday > 0 && logic.dday <= 30) d30Count++;
        else if (logic.dday === 0) dDayCount++;
        else if (logic.dday < 0) dPlusCount++;
      }
    });
    return {
      verified,
      requestCount,
      feedbackCount,
      awaitingReplyCount,
      typeCounts,
      total: assets.length,
      replaceable: assets.filter(a => getAssetLogic(a).isTargetCount).length,
      d30Count,
      dDayCount,
      dPlusCount,
      unverified: assets.length - verified,
      auditDoneCount,
      auditPendingCount,
      auditNudgeCount,
      infoCorrectionCount,
    };
  }, [assets, activeAudit, isAuditActive, requests, ackedRequestIds]);

  /** 실사 종료일까지 남은 일수 (KST 일자 기준, 진행 중이 아니면 null) */
  const auditDaysLeft = useMemo(() => {
    if (!activeAudit?.endDate) return null;
    return getKSTDaysUntil(String(activeAudit.endDate));
  }, [activeAudit]);
  
  /** 나의 보유 자산 기준 — 건수 많은 순(랭크) */
  const uniqueCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    assets.forEach((a) => {
      const key = String(a.category || '').trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
  }, [assets]);

  const uniqueItTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    assets.forEach((a) => {
      const key = String(a.it_type || '').trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
  }, [assets]);

  const uniqueProcurementTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    assets.forEach((a) => {
      const key = String(a.is_rental || '').trim();
      if (!key || key === '-') return;
      counts[key] = (counts[key] || 0) + 1;
    });
    const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
    // 관리자 it_rental_group에 있는 유형만 보강 (하드코딩 금지)
    for (const label of rentalMasterLabels) {
      const key = String(label || '').trim();
      if (key && !ranked.includes(key)) ranked.push(key);
    }
    return ranked;
  }, [assets, rentalMasterLabels]);
  
  const filteredAssets = useMemo(() => {
    return assets
      .filter((a) => {
        const s = searchQuery.toLowerCase().trim();
        const logic = getAssetLogic(a);
        const matchSearch = !s || [a.code, a.model, a.sn, a.brand, a.spec].some(v => String(v).toLowerCase().includes(s));
        const matchCategory = !colFilters.category || a.category === colFilters.category;
        const matchItType = !colFilters.it_type || a.it_type === colFilters.it_type;
        const matchRental = !colFilters.is_rental || a.is_rental === colFilters.is_rental;

        const matchReplace = !showReplaceableOnly || logic.isTargetCount;
        let matchDday = true;
        if (ddayFilter !== 'all' && logic.dday !== null) {
          if (ddayFilter === 'd-30') matchDday = logic.dday > 0 && logic.dday <= 30;
          else if (ddayFilter === 'd-day') matchDday = logic.dday === 0;
          else if (ddayFilter === 'd-plus') matchDday = logic.dday < 0;
        } else if (ddayFilter !== 'all') {
          matchDday = false;
        }
        let matchStatus = true;
        if (showStatusFilter === 'done') matchStatus = logic.isVerified;
        else if (showStatusFilter === 'pending') {
          matchStatus = !logic.isVerified && !logic.hasInfoCorrection && !logic.isNudged;
        } else if (showStatusFilter === 'nudge') {
          matchStatus = !logic.isVerified && logic.isNudged && !logic.hasInfoCorrection;
        } else if (showStatusFilter === 'info_correction') {
          matchStatus = logic.hasInfoCorrection;
        }
        const matchFeedback = !showFeedbackOnly || logic.hasUnreadFeedback;
        const matchSent = !showSentOnly || logic.isAwaitingAdminReply;

        return matchSearch && matchCategory && matchItType && matchRental && matchReplace && matchDday && matchStatus && matchFeedback && matchSent;
      })
      .sort((a, b) => {
        if (showSentOnly || showFeedbackOnly) {
          const latestTime = (asset: any) => {
            const reqs = requests.filter((r) => r.assetCode === asset.code);
            let max = 0;
            reqs.forEach((r) => {
              const t = new Date(r.createdAt || r.requestDate || 0).getTime();
              if (t > max) max = t;
            });
            return max;
          };
          const tb = latestTime(b);
          const ta = latestTime(a);
          if (tb !== ta) return tb - ta;
        }
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [assets, searchQuery, colFilters, showReplaceableOnly, ddayFilter, showStatusFilter, showFeedbackOnly, showSentOnly, ackedRequestIds, activeAudit, requests]);
  
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));

  const toggleSelectAllFiltered = () => {
    const allIds = filteredAssets.map((a) => a.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  };

  const allFilteredSelected =
    filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.has(a.id));
  
  const myBaseHistoryReqs = useMemo(() => {
    if (!currentUser) return [];
    const identity = toItIdentity(currentUser);
    return requests
      .filter((r) => requestMatchesIdentity(r, identity))
      .sort((a, b) => {
        const ta = new Date(a.createdAt || a.requestDate || 0).getTime();
        const tb = new Date(b.createdAt || b.requestDate || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [requests, currentUser]);

  const historyUniqueTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    myBaseHistoryReqs.forEach((r) => {
      const key = String(r.assetType || '').trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
  }, [myBaseHistoryReqs]);

  const historyAvailableYears = useMemo(() => {
    const years = myBaseHistoryReqs
      .map((r) => getKSTYearMonthParts(r.requestDate || r.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique.sort((a, b) => b.localeCompare(a));
  }, [myBaseHistoryReqs]);

  const historyAvailableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];

  const myHistoryThreads = useMemo(() => {
    const codeQ = historyCodeQuery.toLowerCase().trim();
    const modelQ = historyModelQuery.toLowerCase().trim();
    const parentOf = new Map<string, string>();
    myBaseHistoryReqs.forEach((r) => {
      const pid = getThreadParentId(r, myBaseHistoryReqs);
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
    myBaseHistoryReqs.forEach((r) => {
      const rootId = rootOf(String(r.id));
      if (rootId === String(r.id)) return;
      if (!myBaseHistoryReqs.some((x) => String(x.id) === rootId)) return;
      const list = childrenOf.get(rootId) || [];
      list.push(r);
      childrenOf.set(rootId, list);
    });
    childrenOf.forEach((list) => list.sort((a, b) => reqTime(a) - reqTime(b)));

    const matchesMeta = (r: any) => {
      const ym = getKSTYearMonthParts(r.requestDate || r.createdAt);
      const yearMatch = historyYear === 'ALL' || ym?.year === historyYear;
      const monthMatch = historyMonth === 'ALL' || ym?.month === historyMonth;
      const typeMatch = historyTypeFilter === 'ALL' || r.assetType === historyTypeFilter;
      const model = parseHistoryModel(r, assets);
      const codeMatch = !codeQ || String(r.assetCode || '').toLowerCase().includes(codeQ);
      const modelMatch = !modelQ || String(model).toLowerCase().includes(modelQ);
      return yearMatch && monthMatch && typeMatch && codeMatch && modelMatch;
    };
    const matchesStatus = (r: any) => {
      const isPending = isUserPendingStatus(r.status);
      const isFeedback = isAdminFeedbackStatus(r.status) && !ackedRequestIds.has(String(r.id || ''));
      return (
        historyStatusFilter === 'ALL' ||
        (historyStatusFilter === 'PENDING' && isPending) ||
        (historyStatusFilter === 'FEEDBACK' && isFeedback)
      );
    };

    const roots = myBaseHistoryReqs.filter((r) => {
      const pid = parentOf.get(String(r.id));
      return !pid || !myBaseHistoryReqs.some((x) => String(x.id) === pid);
    });

    return roots
      .map((root) => ({
        root,
        children: childrenOf.get(String(root.id)) || [],
      }))
      .filter((t) => {
        const members = [t.root, ...t.children];
        if (!members.some(matchesMeta)) return false;
        return members.some(matchesStatus);
      })
      .sort((a, b) => {
        const ta = Math.max(reqTime(a.root), ...a.children.map(reqTime));
        const tb = Math.max(reqTime(b.root), ...b.children.map(reqTime));
        return tb - ta;
      });
  }, [myBaseHistoryReqs, historyYear, historyMonth, historyTypeFilter, historyCodeQuery, historyModelQuery, historyStatusFilter, assets, ackedRequestIds]);

  const toggleHistoryExpand = (id: string) => {
    setHistoryExpandedIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  
  const handleExcelDownload = () => {
    const targetAssets = selectedIds.size > 0 ? filteredAssets.filter(a => selectedIds.has(a.id)) : filteredAssets;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const excelData = targetAssets.map((a, index) => {
      const logic = getAssetLogic(a);
      return { 'NO': targetAssets.length - index, '조직': a.dept || '-', '사용자': a.user || '-', '범주': a.category, '자산 분류': a.it_type, '조달유형': a.is_rental || '-', '자산번호': a.code, '모델명': a.model, 'S/N': a.sn, '제조사': a.brand || '-', '기본 사양': a.spec, '입고일': a.in_date || '-', '교체주기(M)': a.cycle, '교체예정일': logic.repDate, '최근실사일': a.last_audit_date || '-', '기타(메모)': a.memo };
    });
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "My_Assets"); XLSX.writeFile(wb, `나의업무자산현황_${currentUser?.name}.xlsx`);
  };
  
// ✨ 에러 추적 기능이 강화된 전송 함수
const handleSubmitRequest = async () => {
  if (!requestContent.trim()) return alert("요청하실 내용을 입력해 주세요.");
  
  const newReq = {
    requestDate: todayStr,
    ...applyIdentityToRequestPayload(
      {
        dept: currentUser?.dept,
        assetInfo: `${unifiedCommModal.code} / ${unifiedCommModal.model}`,
        content: requestContent,
        status: '의견전송',
        assetCode: unifiedCommModal.code,
        assetType: unifiedCommModal.it_type,
      },
      toItIdentity(currentUser)
    ),
  };
  
  try {
    const res = await fetch('/api/asset/it/requests', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(newReq) 
    });

    if (res.ok) {
      alert("✅ 담당 부서(관리자)에게 성공적으로 요구사항이 전송되었습니다.");
      closeCommModal();
      fetchAllData(); // 🚀 전송 후 즉시 서버 최신화 동기화
    } else {
      const errData = await res.json().catch(() => ({}));
      // 백엔드 DB 저장 실패 시 원인을 팝업으로 표출
      alert(`❌ 서버 저장 실패: ${errData.error || 'Prisma 스키마 필드 매칭 오류 가능성'}`);
    }
  } catch(e: any) { 
    console.error("의견 전송 통신 오류:", e);
    alert(`❌ 서버 통신 실패: ${e.message}`); 
  }
};

const closeCommModal = () => {
  setUnifiedCommModal(null);
  setPendingRequest(null);
  setCompletedRequest(null);
  setCommEditMode(false);
  setRequestContent('');
};

/** 조치완료 모달에서 확인처리 → 개인·관리자 대시보드 카운트에서 제외 */
const acknowledgeCompletedAndClose = async () => {
  if (!completedRequest?.id) {
    closeCommModal();
    return;
  }
  const id = String(completedRequest.id);
  if (isAdminOutboundRequest(completedRequest.status) && completedRequest.status !== '사용자 확인완료') {
    try {
      const res = await fetch('/api/asset/it/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              action: 'USER_ACK',
              ackedBy: currentUser?.name || '',
              ackedDept: currentUser?.dept || '',
            }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`확인처리에 실패했습니다.${err.error ? `\n${err.error}` : ''}`);
        return;
      }
    } catch {
      alert('확인처리에 실패했습니다.');
      return;
    }
  }
  ackFeedbackRequest(id);
  closeCommModal();
  fetchAllData();
};

/** 닫기만 — 카운트 유지 */
const closeCompletedWithoutAck = () => {
  closeCommModal();
};

const assetFromRequest = (req: any) => {
  if (!req) return null;
  const hit = assets.find((a) => String(a.code || '').trim() === String(req.assetCode || '').trim());
  if (hit) return hit;
  return {
    code: req.assetCode || '',
    it_type: req.assetType || '일반',
    model: parseHistoryModel(req, assets),
    user: req.requester || currentUser?.name || '',
    dept: req.dept || currentUser?.dept || '',
  };
};

const openCommModalFromRequest = (req: any) => {
  const asset = assetFromRequest(req);
  if (!asset?.code) return;
  openCommModal(asset);
};

const openCommModal = (asset: any) => {
  const assetReqs = requests
    .filter((r) => r.assetCode === asset.code)
    .sort((r1, r2) => new Date(r2.createdAt || r2.requestDate || 0).getTime() - new Date(r1.createdAt || r1.requestDate || 0).getTime());
  const latestReq = assetReqs[0];
  const isPending = latestReq && isUserPendingStatus(latestReq.status);
  const isCompleted = latestReq && (
    latestReq.status === '처리완료' ||
    latestReq.status === '관리자 확인완료' ||
    latestReq.status === '관리자 의견발송' ||
    latestReq.status === '사용자 확인완료' ||
    latestReq.status === '사용자 종료처리' ||
    latestReq.status === '관리자 답변'
  );

  setUnifiedCommModal(asset);
  setCommEditMode(false);
  if (isPending) {
    setPendingRequest(latestReq);
    setCompletedRequest(null);
    setRequestContent(latestReq.content || '');
  } else if (isCompleted) {
    setPendingRequest(null);
    setCompletedRequest(latestReq);
    setRequestContent('');
  } else {
    setPendingRequest(null);
    setCompletedRequest(null);
    setRequestContent('');
  }
};

const startNewRequestFromHistory = () => {
  setPendingRequest(null);
  setCompletedRequest(null);
  setCommEditMode(false);
  setRequestContent('');
};

const handleSubmitAdminReply = async () => {
  if (!requestContent.trim()) return alert('답변 내용을 입력해 주세요.');
  if (!unifiedCommModal || !currentUser) return;

  const newReq = {
    requestDate: todayStr,
    ...applyIdentityToRequestPayload(
      {
        dept: currentUser.dept,
        assetInfo: `${unifiedCommModal.code} / ${unifiedCommModal.model}`,
        content: requestContent.trim(),
        status: '답변회신',
        adminOpinion: ':::REPLY:::',
        assetCode: unifiedCommModal.code,
        assetType: unifiedCommModal.it_type,
      },
      toItIdentity(currentUser)
    ),
  };

  try {
    const res = await fetch('/api/asset/it/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newReq),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      alert(`❌ 답변 전송 실패: ${errData.error || '서버 오류'}`);
      return;
    }

    if (completedRequest?.id && isAdminOutboundRequest(completedRequest.status) && completedRequest.status !== '사용자 확인완료') {
      await fetch('/api/asset/it/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: String(completedRequest.id),
          action: 'USER_ACK',
          ackedBy: currentUser.name || '',
          ackedDept: currentUser.dept || '',
        }),
      }).catch(() => null);
      ackFeedbackRequest(String(completedRequest.id));
    }

    alert('✅ 답변이 전송되었습니다.');
    closeCommModal();
    fetchAllData();
  } catch (e: any) {
    alert(`❌ 서버 통신 실패: ${e.message}`);
  }
};

const handleUpdatePendingRequest = async () => {
  if (!pendingRequest?.id) return;
  if (!requestContent.trim()) return alert('요청 내용을 입력해 주세요.');
  try {
    const res = await fetch('/api/asset/it/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pendingRequest.id, content: requestContent.trim(), action: 'USER_UPDATE_CONTENT' }),
    });
    if (res.ok) {
      const updated = await res.json();
      alert('✅ 요청 내용이 수정되었습니다.');
      setPendingRequest(updated);
      setCommEditMode(false);
      fetchAllData();
    } else {
      const errData = await res.json().catch(() => ({}));
      alert(`❌ 수정 실패: ${errData.error || '알 수 없는 오류'}`);
    }
  } catch (e: any) {
    alert(`❌ 서버 통신 실패: ${e.message}`);
  }
};
 
// 🚀 전송한 의견 취소 로직 (fetchAllData로 오류 해결된 최종본)
const handleCancelRequest = async (id: string) => {
  if (!confirm("전송한 의견을 취소하시겠습니까? (취소 후 복구할 수 없습니다)")) return;

  try {
    const target = requests.find((r) => String(r.id) === String(id));
    const res = await fetch(`/api/asset/it/requests?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      // 답변 취소 시 종결로 남기지 않고 직전 관리자 요청 단계로 복원
      if (target && (isUserReplyRow(target) || isUserPendingStatus(target.status))) {
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
      alert("✅ 의견 전송이 취소되었습니다.");
      closeCommModal();
      fetchAllData();
    } else {
      alert("❌ 취소에 실패했습니다.");
    }
  } catch (e) {
    console.error(e);
    alert("❌ 통신 오류가 발생했습니다.");
  }
};

  const latestAdminOpinion = useMemo(() => {
    if (!unifiedCommModal) return '수신된 관리자 의견이 없습니다.';
    const assetReqs = requests.filter(r => r.assetCode === unifiedCommModal.code).sort((r1, r2) => new Date(r2.createdAt).getTime() - new Date(r1.createdAt).getTime());
    const latestReq = assetReqs[0];
    const opinion = latestReq?.adminOpinion;
     
    if (latestReq && (latestReq.status === '처리완료' || latestReq.status === '관리자 확인완료') && (!opinion || opinion.includes('의견 없이 처리'))) {
       return '관리자에 의해 정상적으로 처리되었습니다.';
    }
    return opinion || '아직 수신된 관리자 의견/답변이 없습니다.';
  }, [unifiedCommModal, requests]);
     
  if (loading) return <LoadingState />;
  if (!currentUser) return <div className="p-20 text-center font-black text-red-500">인증 정보가 없습니다. 다시 로그인해주세요.</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">

      {/* marketing/register 배너 공통 규격 */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10 min-w-0">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2.5">
            IT ASSET PERSONAL DESK
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-indigo-400 font-normal">{currentUser?.name || '-'} 님</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-extrabold">IT·업무자산 운영 현황</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            보유 자산 현황을 확인하고 정기 실사·의견 요청을 처리합니다.
          </p>
          {permissionSummary && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-slate-50 shadow-sm">
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
                  편집 권한 없음 — 조회만 가능
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 요약 위젯 3열 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {/* 카드 1: 나의 보유 자산 요약 */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[168px]">
          <div className="flex items-start justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">나의 보유 자산</p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">유형별 요약</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-black text-slate-900 tracking-tighter leading-none tabular-nums">{stats.total}</p>
              <p className="text-[9px] font-bold text-slate-400 mt-1">총 보유</p>
            </div>
          </div>
          <div className="flex-1 min-h-0 mt-3 flex flex-wrap content-start gap-1.5">
            {Object.keys(stats.typeCounts).length === 0 ? (
              <div className="w-full h-full min-h-[64px] flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                <p className="text-[10px] font-bold text-slate-400">등록된 자산 없음</p>
              </div>
            ) : (
              Object.entries(stats.typeCounts).map(([type, count]) => {
                const isSelected = colFilters.it_type === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      goAssetsTab();
                      setColFilters({ ...colFilters, it_type: isSelected ? '' : type });
                    }}
                    className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-black transition-all ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {type} <span className={isSelected ? 'text-indigo-100' : 'text-indigo-600'}>{count}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="pt-3 mt-auto border-t border-slate-100 grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => {
                goAssetsTab();
                setShowFeedbackOnly(false);
                setShowReplaceableOnly(false);
                setDdayFilter((p) => (p === 'd-30' ? 'all' : 'd-30'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                ddayFilter === 'd-30'
                  ? 'bg-blue-500 border-blue-400 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-blue-600 hover:bg-blue-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D-30)</span>
              <span className="text-sm font-black tabular-nums">{stats.d30Count}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                goAssetsTab();
                setShowFeedbackOnly(false);
                setShowReplaceableOnly(false);
                setDdayFilter((p) => (p === 'd-day' ? 'all' : 'd-day'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                ddayFilter === 'd-day'
                  ? 'bg-amber-500 border-amber-400 text-amber-900 shadow-sm'
                  : 'bg-white border-slate-200 text-amber-600 hover:bg-amber-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D-Day)</span>
              <span className="text-sm font-black tabular-nums">{stats.dDayCount}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                goAssetsTab();
                setShowFeedbackOnly(false);
                setShowReplaceableOnly(false);
                setDdayFilter((p) => (p === 'd-plus' ? 'all' : 'd-plus'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                ddayFilter === 'd-plus'
                  ? 'bg-rose-500 border-rose-400 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D+)</span>
              <span className="text-sm font-black tabular-nums">{stats.dPlusCount}</span>
            </button>
          </div>
        </div>

        {/* 카드 2: 실사 운영 상태 */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[168px]">
          <div className="shrink-0 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">실사 운영 상태</p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">Audit Status</p>
            </div>
            {myRunningAudits.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end max-w-[58%]">
                {myRunningAudits.map((a) => {
                  const selected = focusedAudit?.id === a.id;
                  const label = formatAuditTargetLabel(a.target);
                  const endTime = (a.endTime || '23:59').trim() || '23:59';
                  return (
                    <button
                      key={a.id}
                      type="button"
                      title={`${a.title || '실사'}\n${a.startDate} ~ ${a.endDate} ${endTime}\n내 소속: ${currentUser?.dept || '-'}`}
                      onClick={() => setFocusedAuditId(a.id)}
                      className={`px-2 py-0.5 rounded-md text-[9px] font-black border transition-all whitespace-nowrap ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex-1 mt-3 flex flex-col justify-center gap-3">
            <div className="flex items-center justify-between gap-2">
              {isAuditActive ? (
                <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg font-black text-[11px] animate-pulse">
                  🟢 실사 진행 중{myRunningAudits.length > 1 ? ` · ${myRunningAudits.length}건` : ''}
                </span>
              ) : (
                <span className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-black text-[11px]">
                  ⚪ 실사 대기 중
                </span>
              )}
              {isAuditActive && auditDaysLeft !== null && (
                <div className="text-right">
                  <p className="text-xl font-black text-indigo-600 tracking-tighter leading-none tabular-nums">
                    {auditDaysLeft >= 0 ? `D-${auditDaysLeft}` : `D+${Math.abs(auditDaysLeft)}`}
                  </p>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5">남은 기간</p>
                </div>
              )}
            </div>
            {isAuditActive && focusedAudit && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  현재 실사 운영 기간
                </p>
                <p className="mt-1 text-[13px] font-black tracking-tight text-indigo-700">
                  {focusedAudit.startDate} ~ {focusedAudit.endDate}
                </p>
                <p className="mt-1 text-[10px] font-bold text-slate-400 font-mono">
                  마감 {(focusedAudit.endTime || '23:59').trim() || '23:59'}
                </p>
              </div>
            )}
          </div>
          <div className="pt-3 mt-auto border-t border-slate-100 grid grid-cols-4 gap-1.5">
            <button
              type="button"
              disabled={!isAuditActive}
              title={!isAuditActive ? '실사 진행 중에만 집계·필터됩니다.' : undefined}
              onClick={() => {
                if (!isAuditActive) return;
                goAssetsTab();
                setShowFeedbackOnly(false);
                setShowStatusFilter((prev) => (prev === 'done' ? 'all' : 'done'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                !isAuditActive
                  ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                  : showStatusFilter === 'done'
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">실사 완료장비</span>
              <span className="text-sm font-black tabular-nums">{isAuditActive ? stats.auditDoneCount : 0}</span>
            </button>
            <button
              type="button"
              disabled={!isAuditActive}
              title={!isAuditActive ? '실사 진행 중에만 집계·필터됩니다.' : undefined}
              onClick={() => {
                if (!isAuditActive) return;
                goAssetsTab();
                setShowFeedbackOnly(false);
                setShowStatusFilter((prev) => (prev === 'pending' ? 'all' : 'pending'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                !isAuditActive
                  ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                  : showStatusFilter === 'pending'
                    ? 'bg-slate-700 border-slate-600 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">미실사 장비</span>
              <span className="text-sm font-black tabular-nums">{isAuditActive ? stats.auditPendingCount : 0}</span>
            </button>
            <button
              type="button"
              disabled={!isAuditActive}
              title={!isAuditActive ? '실사 진행 중에만 집계·필터됩니다.' : undefined}
              onClick={() => {
                if (!isAuditActive) return;
                goAssetsTab();
                setShowFeedbackOnly(false);
                setShowStatusFilter((prev) => (prev === 'nudge' ? 'all' : 'nudge'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                !isAuditActive
                  ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                  : showStatusFilter === 'nudge'
                    ? 'bg-rose-600 border-rose-500 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">미실사/마감 임박 장비</span>
              <span className="text-sm font-black tabular-nums">{isAuditActive ? stats.auditNudgeCount : 0}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                goAssetsTab();
                setShowFeedbackOnly(false);
                setShowStatusFilter((prev) => (prev === 'info_correction' ? 'all' : 'info_correction'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                showStatusFilter === 'info_correction'
                  ? 'bg-amber-500 border-amber-400 text-amber-900 shadow-sm'
                  : 'bg-white border-slate-200 text-amber-600 hover:bg-amber-50'
              }`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">정보수정 승인대기</span>
              <span className="text-sm font-black tabular-nums">{stats.infoCorrectionCount}</span>
            </button>
          </div>
        </div>

        {/* 카드 3: 의견/요청 대시보드 */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[168px]">
          <div className="shrink-0">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">기타 의견/요청 대시보드</p>
            <p className="text-[9px] font-bold text-slate-400 mt-0.5">클릭 시 목록 필터</p>
          </div>
          <div className="flex-1 mt-3 flex flex-col gap-2 justify-end">
            <button
              type="button"
              onClick={toggleSentAssetFilter}
              className={`w-full px-3 py-2.5 rounded-xl text-[11px] font-bold border transition-all flex items-center justify-between ${
                mainTab === 'assets' && showSentOnly
                  ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50 hover:border-amber-200'
              }`}
            >
              <span className="text-left leading-snug">나의 전송 내역<br /><span className="text-[10px] font-bold opacity-90">(사용자 → 관리자)</span></span>
              <span className={`text-sm font-black tabular-nums shrink-0 ml-2 ${mainTab === 'assets' && showSentOnly ? 'text-white' : 'text-amber-600'}`}>
                {stats.awaitingReplyCount}
              </span>
            </button>
            <button
              type="button"
              onClick={toggleFeedbackAssetFilter}
              className={`w-full px-3 py-2.5 rounded-xl text-[11px] font-bold border transition-all flex items-center justify-between ${
                mainTab === 'assets' && showFeedbackOnly
                  ? 'bg-rose-600 border-rose-600 text-white shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50 hover:border-rose-200'
              }`}
            >
              <span className="text-left leading-snug">나의 수신 내역<br /><span className="text-[10px] font-bold opacity-90">(관리자 → 사용자)</span></span>
              <span className={`text-sm font-black tabular-nums ${mainTab === 'assets' && showFeedbackOnly ? 'text-white' : 'text-rose-600'}`}>
                {stats.feedbackCount}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 업무자산 목록 ↔ 송수신 대장 탭 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          <button
            type="button"
            onClick={() => goAssetsTab()}
            className={`px-5 py-2 rounded-md text-xs font-black transition-all ${
              mainTab === 'assets'
                ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            🗂️ 업무자산 목록
            <span className="ml-1.5 text-[10px] opacity-70">{filteredAssets.length}</span>
          </button>
          <button
            type="button"
            onClick={() => goHistoryTab(historyStatusFilter === 'ALL' ? 'ALL' : historyStatusFilter)}
            className={`px-5 py-2 rounded-md text-xs font-black transition-all ${
              mainTab === 'history'
                ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            💬 기타 의견/요청 송수신 대장
            <span className="ml-1.5 text-[10px] opacity-70">{myBaseHistoryReqs.length}</span>
          </button>
        </div>
      </div>

      {mainTab === 'assets' && (
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">나의 업무자산 목록</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredAssets.length}건</span>
            {showReplaceableOnly && (
              <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">교체대상만</span>
            )}
            {ddayFilter !== 'all' && (
              <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                {ddayFilter === 'd-30' ? '교체(D-30)' : ddayFilter === 'd-day' ? '교체(D-Day)' : '교체(D+)'}만
              </span>
            )}
            {showStatusFilter === 'done' && (
              <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">실사 완료만</span>
            )}
            {showStatusFilter === 'pending' && (
              <span className="text-[10px] font-black text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">미실사만</span>
            )}
            {showStatusFilter === 'nudge' && (
              <span className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">마감 임박만</span>
            )}
            {showStatusFilter === 'info_correction' && (
              <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">정보수정 승인대기만</span>
            )}
            {showSentOnly && (
              <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">나의 전송(대기)만</span>
            )}
            {showFeedbackOnly && (
              <span className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">나의 수신(관리자 요청·답변)만</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase">범주</span>
              <select
                value={colFilters.category}
                onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="">전체</option>
                {uniqueCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase">{typeLabel}</span>
              <select
                value={colFilters.it_type}
                onChange={(e) => setColFilters({ ...colFilters, it_type: e.target.value })}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="">전체</option>
                {uniqueItTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">조달유형</span>
              <select
                value={colFilters.is_rental}
                onChange={(e) => setColFilters({ ...colFilters, is_rental: e.target.value })}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="">전체</option>
                {uniqueProcurementTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="relative w-48">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input
                type="text"
                placeholder="모델명, S/N, 사양 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={handleExcelDownload}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
            >
              {selectedIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedIds.size})`
                : '화면 목록 EXCEL 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1360px]">
            <colgroup>
              <col className="w-[40px]" />
              <col className="w-[48px]" />
              <col className="w-[72px]" />
              <col className="w-[88px]" />
              <col className="w-[72px]" />
              <col className="w-[130px]" />
              <col className="w-[140px]" />
              <col className="w-[110px]" />
              <col className="w-[96px]" />
              <col className="w-[160px]" />
              <col className="w-[96px]" />
              <col className="w-[64px]" />
              <col className="w-[110px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-2 text-center">
                  <input
                    type="checkbox"
                    title={`필터된 전체 ${filteredAssets.length}건 선택/해제`}
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    className="w-3.5 h-3.5 cursor-pointer appearance-none rounded-[3px] border-2 border-indigo-600 bg-white checked:bg-indigo-600 checked:border-indigo-600 relative
                      after:content-[''] after:absolute after:hidden checked:after:block
                      after:left-[3px] after:top-[0px] after:w-[4px] after:h-[8px]
                      after:border-white after:border-r-2 after:border-b-2 after:rotate-45"
                  />
                </th>
                <th className="h-12 px-1 text-center">NO</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">범주</th>
                <th className="h-12 px-1 text-center bg-indigo-50 text-indigo-600 border-r border-slate-200 whitespace-nowrap">{typeLabel}</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">조달유형</th>
                <th className="h-12 px-2">자산번호</th>
                <th className="h-12 px-2">모델명</th>
                <th className="h-12 px-2 text-slate-900">S/N</th>
                <th className="h-12 px-2 text-slate-900 whitespace-nowrap">제조사</th>
                <th className="h-12 px-2 text-slate-900">기본 사양</th>
                <th className="h-12 px-1 text-center text-slate-900 whitespace-nowrap">입고일</th>
                <th className="h-12 px-1 text-center text-slate-900 whitespace-nowrap">교체주기(M)</th>
                <th className="h-12 px-1 text-center whitespace-nowrap">교체예정일</th>
                <th className="h-12 px-1 text-center border-l border-slate-200 whitespace-nowrap">실사/정보수정</th>
                <th className="h-12 px-1 text-center text-rose-600 whitespace-nowrap">의견/요청</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedAssets.length === 0 ? (
                <tr><td colSpan={15} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 자산이 없습니다.</td></tr>
              ) : (
                paginatedAssets.map((a, idx) => {
                  const logic = getAssetLogic(a);
                  const isSelected = selectedIds.has(a.id);
                  const rowNo = filteredAssets.length - ((currentPage - 1) * itemsPerPage + idx);

                  return (
                    <tr key={a.id} className={`h-12 hover:bg-slate-50/50 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                      <td className="pl-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                      </td>
                      <td className="px-1 text-center font-mono text-slate-500 tabular-nums">
                        {rowNo}
                      </td>
                      <td className="px-1 text-center truncate" title={a.category || ''}>
                        {a.category || '-'}
                      </td>
                      <td className="px-1 text-center text-indigo-700 font-black truncate border-r border-slate-200" title={a.it_type || ''}>
                        {a.it_type || '-'}
                      </td>
                      <td className="px-1 text-center whitespace-nowrap text-slate-800" title={a.is_rental || ''}>
                        {a.is_rental || '-'}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'code').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'code');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'model').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'model');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-800'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 font-mono truncate" title={getDisplayFieldValue(a, 'sn').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'sn');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'brand').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'brand');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'spec').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'spec');
                          return <span className={d.isPending ? 'text-red-600 font-black' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-1 text-center text-slate-900 font-mono tabular-nums whitespace-nowrap" title={a.in_date || ''}>
                        {a.in_date || '-'}
                      </td>
                      <td className="px-1 text-center text-slate-900 tabular-nums">{a.cycle ?? '-'}</td>
                      <td className="px-1 text-center whitespace-nowrap" title={logic.repDate}>
                        <span className="text-slate-800 tabular-nums">{logic.repDate}</span>
                        {logic.dday !== null && logic.dday <= 30 && (
                          <span
                            className={`ml-1 px-2 py-0.5 rounded-md text-[9px] font-black animate-pulse shadow-sm ${
                              logic.dday > 0
                                ? 'bg-blue-500 text-white'
                                : logic.dday === 0
                                  ? 'bg-amber-400 text-amber-900'
                                  : 'bg-rose-500 text-white'
                            }`}
                          >
                            {logic.dday > 0 ? `D-${logic.dday}` : logic.dday === 0 ? 'D-Day' : `D+${Math.abs(logic.dday)}`}
                          </span>
                        )}
                      </td>
                      <td className="px-1 text-center border-l border-slate-200">
                        <button
                          type="button"
                          title={
                            logic.hasInfoCorrection
                              ? logic.auditStatusText
                              : isAuditActive
                                ? logic.auditStatusText
                                : '실사 대기 중 — 클릭 시 정보수정 요청만 가능'
                          }
                          onClick={() => {
                            if (logic.hasInfoCorrection) {
                              openInfoCorrectionModal(a);
                              return;
                            }
                            // 실사 진행 중 + 이번 실사 범위 안: 확인/취소 · 대기 중: 정보수정만
                            // 대상 외(범위 밖)는 클릭 불가
                            if (isAuditActive) {
                              if (!logic.isInAuditScope) return;
                              setConfirmAuditModal({ ...a, action: logic.isVerified ? 'CANCEL' : 'VERIFY' });
                              return;
                            }
                            openInfoCorrectionModal(a);
                          }}
                          disabled={isAuditActive && !logic.isInAuditScope && !logic.hasInfoCorrection}
                          className={`w-full h-[2.25rem] px-0.5 rounded text-[10px] font-black tracking-tight transition-all shadow-sm border leading-tight flex flex-col items-center justify-center ${logic.auditStatusColor}`}
                        >
                          <span className="truncate max-w-full">{logic.auditStatusLabel}</span>
                          {logic.auditStatusDate && (
                            <span className="text-[9px] font-bold tabular-nums mt-0.5 opacity-90">({logic.auditStatusDate})</span>
                          )}
                        </button>
                      </td>
                      <td className="px-1 text-center">
                        <button
                          type="button"
                          title={logic.commStatusText}
                          onClick={() => openCommModal(a)}
                          className={`w-full h-[2.25rem] px-0.5 rounded text-[10px] font-black border transition-all shadow-sm cursor-pointer leading-tight flex flex-col items-center justify-center ${logic.commStatusColor}`}
                        >
                          <span className="truncate max-w-full">{logic.commStatusLabel}</span>
                          {logic.commStatusDate && (
                            <span className="text-[9px] font-bold tabular-nums mt-0.5 opacity-90">({logic.commStatusDate})</span>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredAssets.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </div>
      )}

      {mainTab === 'history' && (
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">나의 의견 및 요구사항 송수신 대장</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{myHistoryThreads.length}건</span>
            {historyStatusFilter === 'PENDING' && (
              <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">답변대기만</span>
            )}
            {historyStatusFilter === 'FEEDBACK' && (
              <span className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">관리자 답변·요청(미확인)만</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">{typeLabel}</span>
              <select
                value={historyTypeFilter}
                onChange={(e) => setHistoryTypeFilter(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="ALL">전체</option>
                {historyUniqueTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
              <select
                value={historyYear}
                onChange={(e) => {
                  setHistoryYear(e.target.value);
                  setHistoryMonth('ALL');
                }}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {historyAvailableYears.map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
              <select
                value={historyMonth}
                onChange={(e) => setHistoryMonth(e.target.value)}
                className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent"
              >
                <option value="ALL">전체</option>
                {historyAvailableMonths.map((month) => (
                  <option key={month} value={month}>{month}월</option>
                ))}
              </select>
            </div>

            <div className="relative w-32">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔢</span>
              <input
                type="text"
                placeholder="자산번호 검색..."
                value={historyCodeQuery}
                onChange={(e) => setHistoryCodeQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
            <div className="relative w-36">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">💻</span>
              <input
                type="text"
                placeholder="모델명 검색..."
                value={historyModelQuery}
                onChange={(e) => setHistoryModelQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1420px]">
            <colgroup>
              <col className="w-[48px]" />
              <col className="w-[120px]" />
              <col className="w-[96px]" />
              <col className="w-[110px]" />
              <col className="w-[130px]" />
              <col className="w-[180px]" />
              <col className="w-[180px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[140px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black tracking-widest border-b border-slate-200">
              <tr>
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
              {myHistoryThreads.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 송수신 내역이 없습니다.</td>
                </tr>
              ) : (
                myHistoryThreads.map((thread, idx) => {
                  const expanded = historyExpandedIds.has(String(thread.root.id));
                  const rowNo = myHistoryThreads.length - idx;
                  const userLabel = threadUserLabel(thread.root);
                  const adminLabel = pickThreadAdminLabel([thread.root, ...thread.children]);
                  const renderHistoryRow = (req: any, depth: number, no: number | string) => {
                    const threadLatestId = String((thread.children[thread.children.length - 1] || thread.root).id);
                    const isLatestInThread = String(req.id) === threadLatestId;
                    const waitingReply = isUserPendingStatus(req.status) && isLatestInThread;
                    const isPastStep = depth > 0 && !isLatestInThread;
                    // 각 행은 자기 내용에 맞는 상태만 표기 (첫 행도 최종상태 아님)
                    const statusLabel = historyStatusLabel(req.status, req, { isThreadRoot: depth === 0 });
                    const rowIsAdminStart = statusLabel === '관리자 문의/요청';
                    const rowIsAdminReply = statusLabel === '관리자 답변';
                    const rowIsUserStart = statusLabel === '사용자 문의/요청';
                    const rowIsUserReply = statusLabel === '사용자 답변';
                    const { opinionText } = parseAdminOpinion(req.adminOpinion);
                    const modelName = parseHistoryModel(req, assets);
                    const rowDate =
                      getKSTDateString(req.completedAt || req.requestDate || req.createdAt) ||
                      req.completedAt ||
                      req.requestDate ||
                      '-';
                    const isRoot = depth === 0;
                    const thisUserLabel = threadUserLabel(req);
                    const thisAdminLabel = rowAdminLabel(req);
                    const isAdminMsg = isAdminSideStatus(req.status);
                    const isUserMsg = isUserPendingStatus(req.status) || String(req.adminOpinion || '').includes(':::REPLY:::');
                    let rowUserLabel = '';
                    let rowAdminName = '';
                    if (isRoot) {
                      rowUserLabel = userLabel;
                      rowAdminName = adminLabel;
                    } else {
                      if (isUserMsg && thisUserLabel && !samePersonLabel(thisUserLabel, userLabel)) rowUserLabel = thisUserLabel;
                      if (isAdminMsg && thisAdminLabel && !samePersonLabel(thisAdminLabel, adminLabel)) rowAdminName = thisAdminLabel;
                      if (isClosedStatus(req.status)) {
                        if (thisUserLabel && !samePersonLabel(thisUserLabel, userLabel)) rowUserLabel = thisUserLabel;
                        if (thisAdminLabel && !samePersonLabel(thisAdminLabel, adminLabel)) rowAdminName = thisAdminLabel;
                      }
                    }
                    const childCount = depth === 0 ? thread.children.length : 0;
                    const hasChildren = childCount > 0;
                    const threadLatest = thread.children[thread.children.length - 1] || thread.root;
                    const threadClosed = isClosedStatus(threadLatest.status);

                    return (
                      <tr
                        key={req.id || `${depth}-${no}`}
                        className={`h-12 transition-colors ${
                          depth > 0 ? 'bg-slate-50/70 hover:bg-slate-50' : 'hover:bg-slate-50/50'
                        }`}
                      >
                        <td className="px-2 text-center font-mono text-slate-500 tabular-nums">
                          {depth > 0 ? <span className="text-slate-400">└</span> : no}
                        </td>
                        <td className="px-2 text-center">
                          {rowUserLabel ? (
                            <span className="text-slate-800 truncate block" title={rowUserLabel}>{rowUserLabel}</span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-2 text-center">
                          {isRoot ? (
                            <span className="text-[9px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md whitespace-nowrap">
                              {req.assetType || '일반'}
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-2 text-slate-900 truncate" title={isRoot ? (req.assetCode || '') : ''}>
                          {isRoot ? (req.assetCode || '-') : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 text-slate-800 truncate" title={isRoot ? modelName : ''}>
                          {isRoot ? modelName : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 text-slate-700 truncate" title={userRequestContent(req.content)}>
                          {userRequestContent(req.content)}
                        </td>
                        <td className="px-2 border-l border-slate-200">
                          {waitingReply ? (
                            <span className="text-slate-400 italic font-bold">아직 답변이 없습니다.</span>
                          ) : (
                            <span className="text-slate-700 truncate block w-full" title={opinionText}>
                              {opinionText ? `" ${opinionText} "` : '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 text-center">
                          {rowAdminName ? (
                            <span className="text-slate-800 truncate block" title={rowAdminName}>{rowAdminName}</span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800 border-l border-slate-200">{rowDate}</td>
                        <td className="px-2 text-center overflow-hidden border-l border-slate-200">
                          <button
                            type="button"
                            title="클릭하여 대화 내역 확인"
                            onClick={() => openCommModalFromRequest(req)}
                            className={`inline-block max-w-full border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap cursor-pointer hover:scale-105 transition-transform ${
                              statusLabel === '처리 완료(종료)'
                                ? 'bg-slate-100 text-slate-600 border-slate-200'
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
                            {statusLabel}
                          </button>
                        </td>
                        <td className="px-2 text-center border-l border-slate-200 overflow-hidden">
                          <div className="inline-flex items-center justify-center gap-1.5 flex-nowrap">
                            {hasChildren && (
                              <button
                                type="button"
                                title={expanded ? '연관 회신 접기' : threadClosed ? '종료 내역 상세보기' : '연관 회신 상세보기'}
                                onClick={() => toggleHistoryExpand(req.id)}
                                className="inline-flex items-center gap-0.5 px-1.5 py-1 bg-white text-slate-600 border border-slate-200 rounded-md text-[10px] font-black hover:bg-slate-50 whitespace-nowrap"
                              >
                                {threadClosed ? '종료/상세보기' : '상세보기'}
                                <span className="text-[11px] leading-none">{expanded ? '▲' : '▼'}</span>
                              </button>
                            )}
                            {waitingReply ? (
                              <button
                                type="button"
                                onClick={() => handleCancelRequest(req.id)}
                                className="px-1.5 py-1 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap"
                                title="답변이 오기 전에만 전송을 취소할 수 있습니다."
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

                  return (
                    <React.Fragment key={thread.root.id}>
                      {renderHistoryRow(thread.root, 0, rowNo)}
                      {expanded && thread.children.map((child) => renderHistoryRow(child, 1, ''))}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
  
      {/* ✨ 실사 확인 모달 (인증 / 취소 / 정보수정) */}
      {confirmAuditModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className={`bg-white border border-slate-200 shadow-2xl p-8 rounded-3xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh] ${
            confirmAuditModal.action === 'CANCEL'
              ? 'w-[400px] text-center'
              : 'w-[500px] text-left'
          }`}>
            {confirmAuditModal.action === 'CANCEL' ? (
              <>
                <div className="text-5xl mb-4 text-center">↩️</div>
                <h4 className="text-lg font-black text-rose-600 tracking-tight mb-2 text-center">실사 인증 내역 취소</h4>
                <p className="text-[11px] font-bold text-slate-500 mb-6 leading-relaxed bg-rose-50 p-4 rounded-xl border border-rose-100 text-center">
                  <span className="text-slate-900 font-black">[{confirmAuditModal.code}]</span> 장비에 대한<br/>
                  실사 인증 내역을 <span className="text-rose-600">미확인 상태</span>로 되돌리시겠습니까?
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmAuditModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-colors">닫기</button>
                  <button type="button" onClick={executeAuditVerify} className="flex-[2] py-3.5 bg-rose-600 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-rose-700 active:scale-95 transition-all">실사 취소하기</button>
                </div>
              </>
            ) : confirmAuditModal.action === 'EDIT_INFO_PENDING' || confirmAuditModal.action === 'EDIT_INFO' ? (
              <>
                <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">
                  {confirmAuditModal.action === 'EDIT_INFO_PENDING' ? '정보수정 요청 내역' : '정보수정 요청'}
                </h4>
                <p className="text-[10px] font-bold text-slate-400 mb-4 border-b-2 border-slate-900 pb-3">
                  {confirmAuditModal.action === 'EDIT_INFO_PENDING'
                    ? '관리자 승인 전 · 취소 또는 내용 수정 가능'
                    : '틀린 칸만 수정한 뒤 관리자 확인을 요청하세요.'}
                </p>

                <div className="overflow-y-auto flex-1 pr-2 space-y-4 scrollbar-hide">
                  <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-3 space-y-2">
                    <div className="flex justify-between gap-3 text-[11px] font-bold">
                      <span className="text-slate-400 shrink-0">{typeLabel}</span>
                      <span className="text-indigo-700 font-black text-right">{confirmAuditModal.it_type || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-bold">
                      <span className="text-slate-400 shrink-0">자산번호</span>
                      <span className="text-slate-900 font-black text-right font-mono">{confirmAuditModal.code || '-'}</span>
                    </div>
                    {confirmAuditModal.action === 'EDIT_INFO_PENDING' && (
                      <>
                        <div className="flex justify-between gap-3 text-[11px] font-bold">
                          <span className="text-slate-400 shrink-0">요청일</span>
                          <span className="text-slate-800 tabular-nums">
                            {parseInfoCorrectionPending(confirmAuditModal.info_correction_pending)?.requestedAt || '-'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3 text-[11px] font-bold">
                          <span className="text-slate-400 shrink-0">상태</span>
                          <span className="text-amber-600">정보수정 승인 대기중</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">확인·수정 항목</p>
                    {INFO_CORRECTION_FIELDS.map((key) => {
                      const label = INFO_CORRECTION_FIELD_LABELS[key];
                      const original = String(confirmAuditModal[key] ?? '') || '-';
                      const dirty = String(infoEditDraft[key] ?? '').trim() !== String(confirmAuditModal[key] ?? '').trim();
                      return (
                        <label key={key} className="block">
                          <span className="flex items-center justify-between gap-2 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                            <span>{label}</span>
                            {dirty && <span className="text-rose-600 normal-case truncate max-w-[60%]" title={original}>원본: {original}</span>}
                          </span>
                          <input
                            type="text"
                            value={infoEditDraft[key]}
                            onChange={(e) => setInfoEditDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                            className={`mt-1 w-full px-3 py-2.5 rounded-xl border text-[12px] font-bold outline-none transition-colors ${
                              dirty
                                ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-500'
                                : 'border-slate-200 bg-slate-50 text-slate-800 focus:border-indigo-500 focus:bg-white'
                            }`}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                {confirmAuditModal.action === 'EDIT_INFO_PENDING' ? (
                  <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={cancelInfoCorrection}
                      className="flex-1 py-3.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl font-black text-[11px] hover:bg-rose-100 transition-colors"
                    >
                      요청취소
                    </button>
                    <button
                      type="button"
                      onClick={submitInfoCorrection}
                      className="flex-[1.4] py-3.5 bg-amber-500 text-white rounded-xl font-black text-[11px] shadow-md hover:bg-amber-600 active:scale-95 transition-all leading-tight px-2"
                    >
                      수정완료<br /><span className="text-[9px] font-bold opacity-90">(관리자 확인요청)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAuditModal(null)}
                      className="flex-1 py-3.5 bg-slate-900 text-white rounded-xl font-black text-[11px] hover:bg-black transition-colors"
                    >
                      확인-닫기
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
                    <button type="button" onClick={() => setConfirmAuditModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-colors">취소</button>
                    <button type="button" onClick={submitInfoCorrection} className="flex-[2] py-3.5 bg-amber-500 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-amber-600 active:scale-95 transition-all">수정완료 (관리자 확인요청)</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">자산 실사 내역 확인</h4>
                <p className="text-[10px] font-bold text-slate-400 mb-4 border-b-2 border-slate-900 pb-3">
                  아래 정보가 맞는지 확인한 뒤 실사를 완료해 주세요.
                </p>

                <div className="overflow-y-auto flex-1 pr-2 space-y-4 scrollbar-hide mb-2">
                  <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{typeLabel}</p>
                    <p className="mt-1 text-[15px] font-black text-indigo-700 tracking-tight">
                      {confirmAuditModal.it_type || '-'}
                    </p>
                    <p className="mt-1.5 text-[11px] font-bold text-slate-500 font-mono">
                      자산번호 {confirmAuditModal.code || '-'}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2.5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 text-right">등록 정보 확인</p>
                    {([
                      ['model', '모델명'],
                      ['sn', 'S/N'],
                      ['brand', '제조사'],
                      ['spec', '기본 사양'],
                    ] as const).map(([key, label]) => (
                      <div key={key} className="flex justify-between gap-3 text-[11px] font-bold border-t border-slate-100/80 pt-2 first:border-0 first:pt-0">
                        <span className="text-slate-400 shrink-0">{label}</span>
                        <span className="text-slate-800 text-right break-all min-w-0 flex-1">
                          {String(confirmAuditModal[key] ?? '').trim() || '-'}
                        </span>
                      </div>
                    ))}
                  </div>

                  <p className="text-[11px] font-bold text-slate-500 leading-relaxed px-1">
                    이상이 없다면 <span className="text-emerald-600 font-black">실사 확인 완료</span>를,<br />
                    정보가 틀리다면 <span className="text-amber-600 font-black">정보수정 요청</span>을 눌러 주세요.
                  </p>
                </div>

                <div className="flex flex-col gap-2 mt-2 pt-4 border-t border-slate-100">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirmAuditModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-colors">취소</button>
                    <button type="button" onClick={executeAuditVerify} className="flex-[2] py-3.5 bg-emerald-600 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-emerald-700 active:scale-95 transition-all">✅ 실사 확인 완료</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => openInfoCorrectionModal(confirmAuditModal)}
                    className="w-full py-3.5 bg-white text-amber-700 border border-amber-300 rounded-xl font-black text-[12px] hover:bg-amber-50 transition-all"
                  >
                    정보수정 요청하기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 의견/요청 전송·조회 모달 */}
      {unifiedCommModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] border border-slate-200 shadow-2xl p-8 rounded-3xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            {pendingRequest ? (
              (() => {
                const isReply = pendingRequest.status === '답변회신';
                const threadMsgs = collectThreadMessages(pendingRequest, requests);
                const priorTurns = threadMsgs
                  .filter((m) => String(m.id) !== String(pendingRequest.id))
                  .flatMap(threadTurns);
                return (
              <>
                <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">
                  {isReply ? '사용자 답변' : '사용자 문의/요청'}
                </h4>
                <p className="text-[10px] font-bold text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
                  관리자 답변 전 · 전송 취소 또는 내용 수정 가능
                </p>

                <div className="overflow-y-auto flex-1 pr-2 space-y-4 min-h-0">
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                    <div className="flex justify-between gap-3 text-[11px] font-bold">
                      <span className="text-slate-400 shrink-0">대상자산</span>
                      <span className="text-slate-800 text-right">{unifiedCommModal.it_type} | {unifiedCommModal.code} / {unifiedCommModal.model || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-bold">
                      <span className="text-slate-400 shrink-0">{isReply ? '회신일' : '요청일'}</span>
                      <span className="text-slate-800 tabular-nums">
                        {getKSTDateString(pendingRequest.requestDate || pendingRequest.createdAt) || pendingRequest.requestDate || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-bold">
                      <span className="text-slate-400 shrink-0">상태</span>
                      <span className="text-amber-600">대화 진행중</span>
                    </div>
                  </div>

                  <ThreadTurnList turns={priorTurns} />

                  <div>
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-wider mb-2">
                      {isReply ? '답변 내용' : '요청 내용'}
                    </p>
                    {commEditMode ? (
                      <textarea
                        value={requestContent}
                        onChange={(e) => setRequestContent(e.target.value)}
                        className="w-full h-32 bg-white border border-amber-300 p-4 text-[11px] font-bold rounded-xl outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-300 transition-all resize-none shadow-inner"
                      />
                    ) : (
                      <div className="w-full min-h-[8rem] bg-slate-50 border border-slate-200 p-4 text-[11px] font-bold text-slate-800 rounded-xl whitespace-pre-wrap leading-relaxed">
                        {pendingRequest.content || '-'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 mt-6 pt-4 border-t border-slate-100">
                  {commEditMode ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCommEditMode(false);
                          setRequestContent(pendingRequest.content || '');
                        }}
                        className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-colors"
                      >
                        편집 취소
                      </button>
                      <button
                        type="button"
                        onClick={handleUpdatePendingRequest}
                        className="flex-[2] py-3.5 bg-amber-500 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-amber-600 active:scale-95 transition-all"
                      >
                        내용 저장
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleCancelRequest(pendingRequest.id)}
                        className="flex-1 py-3.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl font-black text-[11px] hover:bg-rose-100 transition-colors"
                      >
                        전송 취소
                      </button>
                      <button
                        type="button"
                        onClick={() => setCommEditMode(true)}
                        className="flex-1 py-3.5 bg-white text-slate-700 border border-slate-300 rounded-xl font-black text-[11px] hover:bg-slate-50 transition-colors"
                      >
                        내용 수정
                      </button>
                      <button
                        type="button"
                        onClick={closeCommModal}
                        className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[11px] hover:bg-slate-200 transition-colors"
                      >
                        닫기
                      </button>
                    </div>
                  )}
                </div>
              </>
                );
              })()
            ) : completedRequest ? (
              (() => {
                const threadMsgs = collectThreadMessages(completedRequest, requests);
                const latest = threadMsgs[threadMsgs.length - 1] || completedRequest;
                const threadClosed = isClosedStatus(latest.status);
                const canUserReply = !threadClosed && isAdminOutboundRequest(latest.status);
                const turns = threadMsgs.flatMap(threadTurns);
                return (
                  <>
                    <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">
                      {threadClosed
                        ? '처리 완료(종료)'
                        : latest.status === '관리자 답변'
                          ? '관리자 답변'
                          : '관리자 문의/요청'}
                    </h4>
                    <p className="text-[10px] font-bold text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
                      {threadClosed
                        ? '주고받은 전체 이력을 확인할 수 있습니다'
                        : '답변을 작성해 관리자에게 회신할 수 있습니다'}
                    </p>

                    <div className="overflow-y-auto flex-1 pr-2 space-y-4 min-h-0">
                      <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                        <div className="flex justify-between gap-3 text-[11px] font-bold">
                          <span className="text-slate-400 shrink-0">대상자산</span>
                          <span className="text-slate-800 text-right">{unifiedCommModal.it_type} | {unifiedCommModal.code} / {unifiedCommModal.model || '-'}</span>
                        </div>
                        <div className="flex justify-between gap-3 text-[11px] font-bold">
                          <span className="text-slate-400 shrink-0">상태</span>
                          <span className={threadClosed ? 'text-slate-500' : 'text-rose-600'}>
                            {threadClosed ? '처리 완료(종료)' : '대화 진행중'}
                          </span>
                        </div>
                      </div>

                      <ThreadTurnList turns={turns} />

                      {canUserReply && (
                        <div>
                          <p className="text-[10px] font-black text-amber-600 uppercase tracking-wider mb-2">답변 내용</p>
                          <textarea
                            value={requestContent}
                            onChange={(e) => setRequestContent(e.target.value)}
                            placeholder="관리자 요청에 대한 답변을 작성하세요."
                            className="w-full min-h-[8rem] bg-white border border-amber-200 p-4 text-[11px] font-bold text-slate-800 rounded-xl outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-300 transition-all resize-none shadow-inner"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={closeCompletedWithoutAck}
                        className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[11px] hover:bg-slate-200 transition-colors"
                      >
                        닫기
                      </button>
                      {threadClosed ? (
                        <button
                          type="button"
                          onClick={startNewRequestFromHistory}
                          className="flex-[1.4] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                        >
                          신규 요청하기
                        </button>
                      ) : (
                        canUserReply && (
                          <button
                            type="button"
                            onClick={handleSubmitAdminReply}
                            className="flex-[1.4] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                          >
                            관리자에게 답변 전송
                          </button>
                        )
                      )}
                    </div>
                  </>
                );
              })()
            ) : (
              <>
                <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-2">신규 요청하기</h4>
                <p className="text-[10px] font-bold text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
                  관리자에게 전달할 내용을 작성해 주세요
                </p>

                <div className="overflow-y-auto flex-1 pr-2 space-y-4 scrollbar-hide">
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                    <div className="flex justify-between gap-3 text-[11px] font-bold">
                      <span className="text-slate-400 shrink-0">대상자산</span>
                      <span className="text-slate-800 text-right">{unifiedCommModal.it_type} | {unifiedCommModal.code} / {unifiedCommModal.model || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-bold">
                      <span className="text-slate-400 shrink-0">요청일</span>
                      <span className="text-slate-800 tabular-nums">{todayStr}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-bold">
                      <span className="text-slate-400 shrink-0">요청자</span>
                      <span className="text-slate-800 text-right">{currentUser?.name || '-'} ({currentUser?.dept || '-'})</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-wider mb-2">요청 내용</p>
                    <textarea
                      value={requestContent}
                      onChange={(e) => setRequestContent(e.target.value)}
                      placeholder="장비 불량, 교체 희망, 소프트웨어 설치 지원 등 관리자에게 전달할 내용을 작성하세요."
                      className="w-full min-h-[8rem] bg-white border border-amber-200 p-4 text-[11px] font-bold text-slate-800 rounded-xl outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-300 transition-all resize-none shadow-inner"
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={closeCommModal}
                    className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[11px] hover:bg-slate-200 transition-colors"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitRequest}
                    className="flex-[2] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                  >
                    관리자에게 의견/요청 전송
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}