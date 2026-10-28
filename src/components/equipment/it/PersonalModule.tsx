'use client';
     
import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx'; 
import { getKSTDateString, getKSTDaysUntil } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import {
  buildInfoCorrectionPending,
  getCompletedAuditLabel,
  getDisplayFieldValue,
  hasInfoCorrectionPending,
  parseInfoCorrectionPending,
  type InfoCorrectionField,
} from '@/utils/itInfoCorrection';

function isUserPendingStatus(status: string) {
  return status === '의견전송' || status === '답변 대기중' || status === '답변회신';
}

function isClosedStatus(status: string) {
  return status === '처리완료' || status === '관리자 확인완료' || status === '사용자 확인완료' || status === '사용자 종료처리';
}

function isUserClosedStatus(status: string) {
  return status === '사용자 확인완료' || status === '사용자 종료처리';
}

function isAdminClosedStatus(status: string) {
  return status === '처리완료' || status === '관리자 확인완료';
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
  const t = new Date(r?.createdAt || r?.requestDate || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function getThreadParentId(req: any, allRequests: any[]): string | null {
  if (!req) return null;
  const status = String(req.status || '').trim();
  if (status === '관리자 의견발송' || status === '사용자 확인완료') return null;
  const prior = allRequests
    .filter((r) => sameAssetCode(r, req) && String(r.id) !== String(req.id) && reqTime(r) <= reqTime(req))
    .sort((a, b) => reqTime(b) - reqTime(a))[0];
  if (!prior) return null;
  const isReplyFlag = status === '답변회신' || String(req.adminOpinion || '').includes(':::REPLY:::');
  if ((status === '의견전송' || status === '답변 대기중') && !isReplyFlag && isClosedStatus(prior.status)) return null;
  if ((status === '의견전송' || status === '답변 대기중') && !isReplyFlag) {
    const priorOk =
      prior.status === '관리자 의견발송' ||
      prior.status === '사용자 확인완료' ||
      prior.status === '관리자 답변' ||
      prior.status === '답변회신';
    if (!priorOk) return null;
  }
  if (
    isReplyFlag ||
    status === '관리자 답변' ||
    isClosedStatus(status) ||
    status === '의견전송' ||
    status === '답변 대기중'
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

type AssetThread = { root: any; latest: any; msgs: any[]; closed: boolean };

function collectAssetThreads(assetCode: string, allRequests: any[]): AssetThread[] {
  const pool = allRequests.filter((r) => String(r?.assetCode || '').trim() === String(assetCode || '').trim());
  if (!pool.length) return [];
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
  const groups = new Map<string, any[]>();
  pool.forEach((r) => {
    const rootId = rootOf(String(r.id));
    const list = groups.get(rootId) || [];
    list.push(r);
    groups.set(rootId, list);
  });
  return Array.from(groups.values()).map((msgs) => {
    const sorted = [...msgs].sort((a, b) => reqTime(a) - reqTime(b));
    const latest = sorted[sorted.length - 1];
    return {
      root: sorted[0],
      latest,
      msgs: sorted,
      closed: isClosedStatus(latest?.status),
    };
  });
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
  const userName = String(req?.requester || req?.name || '').trim() || '사용자';
  const turns: { role: 'admin' | 'user'; name: string; text: string; date: string }[] = [];
  if (status === '관리자 의견발송' || status === '사용자 확인완료' || status === '관리자 답변') {
    if (adminText) turns.push({ role: 'admin', name: '관리자', text: adminText, date: reqDate });
  } else if (status === '답변회신' || status === '의견전송' || status === '답변 대기중') {
    if (userOk) turns.push({ role: 'user', name: userName, text: userText, date: reqDate });
  } else if (isClosedStatus(status)) {
    if (userOk) turns.push({ role: 'user', name: userName, text: userText, date: reqDate });
    if (adminText) turns.push({ role: 'admin', name: '관리자', text: adminText, date: doneDate });
  }
  return turns;
}

function TimelineTurns({ turns }: { turns: { role: 'admin' | 'user'; name: string; text: string; date: string }[] }) {
  if (!turns.length) return null;
  return (
    <div className="border-l-2 border-slate-200 ml-2 space-y-4">
      {turns.map((turn, idx) => {
        const isAdmin = turn.role === 'admin';
        const roleTag = isAdmin ? '관리자' : '사용자';
        return (
          <div key={`${turn.role}-${idx}`} className="relative pl-5">
            <span
              className={`absolute -left-[5px] top-2 w-2 h-2 rounded-full ring-2 ring-white ${
                isAdmin ? 'bg-blue-500' : 'bg-slate-400'
              }`}
              aria-hidden
            />
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                  isAdmin ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                [{roleTag}] {turn.name}
              </span>
              {turn.date && (
                <span className="text-[10px] font-medium text-slate-400 tabular-nums shrink-0">
                  {turn.date}
                </span>
              )}
            </div>
            <div
              className={`rounded-md border p-3.5 text-[11px] font-medium whitespace-pre-wrap leading-relaxed ${
                isAdmin
                  ? 'bg-blue-50/40 border-blue-200 text-slate-800'
                  : 'bg-white border-slate-200 text-slate-800'
              }`}
            >
              {turn.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CommModalHeader({
  title,
  subtitle,
  closedCount,
  showClosedHistory,
  onToggle,
}: {
  title: string;
  subtitle: string;
  closedCount: number;
  showClosedHistory: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="text-[14px] font-medium text-slate-900 tracking-tight">{title}</h4>
        <button
          type="button"
          disabled={closedCount === 0}
          onClick={onToggle}
          title={closedCount === 0 ? '완료된 문의 내역이 없습니다' : '같은 자산의 이전 완료 대화를 이어 봅니다'}
          className={`shrink-0 px-2.5 py-1.5 rounded-lg border text-[10px] font-medium leading-tight text-right whitespace-nowrap transition-colors ${
            closedCount === 0
              ? 'border-slate-100 text-slate-300 cursor-not-allowed'
              : showClosedHistory
                ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {showClosedHistory ? '이전 내역 접기' : '완료된 문의 내역 보기'}
        </button>
      </div>
      <p className="text-[10px] font-medium text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
        {subtitle}
      </p>
    </>
  );
}

function ClosedHistoryBlock({ threads }: { threads: AssetThread[] }) {
  if (!threads.length) {
    return (
      <p className="text-[11px] font-medium text-slate-400 px-1">완료된 문의 내역이 없습니다.</p>
    );
  }
  const ordered = [...threads].sort((a, b) => reqTime(a.latest) - reqTime(b.latest));
  return (
    <div className="space-y-5">
      {ordered.map((thread, idx) => {
        const turns = thread.msgs.flatMap(threadTurns);
        if (!turns.length) return null;
        const date =
          getKSTDateString(thread.latest.completedAt || thread.latest.requestDate || thread.latest.createdAt) ||
          '';
        return (
          <div key={String(thread.root?.id || idx)} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-slate-500">완료된 문의 {idx + 1}</span>
              {date && <span className="text-[10px] font-medium text-slate-400 tabular-nums">{date}</span>}
            </div>
            <TimelineTurns turns={turns} />
          </div>
        );
      })}
      <div className="flex items-center gap-2 py-1">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-[10px] font-medium text-slate-400">현재 대화</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
    </div>
  );
}

function TimelineCompose({
  name,
  dateLabel,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  dateLabel: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="border-l-2 border-slate-200 ml-2">
      <div className="relative pl-5">
        <span
          className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-slate-400 ring-2 ring-white"
          aria-hidden
        />
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap bg-slate-100 text-slate-600">
            [사용자] {name}
          </span>
          <span className="text-[10px] font-medium text-slate-400 tabular-nums shrink-0">{dateLabel}</span>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3.5">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full min-h-[8rem] bg-transparent text-[11px] font-medium text-slate-800 outline-none resize-none placeholder:text-slate-400 leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
}

function isAdminOutboundRequest(status: string) {
  return status === '관리자 의견발송' || status === '관리자 답변';
}

function feedbackAckStorageKey(email: string) {
  return `it_feedback_acked_${email}`;
}

export default function PersonalModule() {
  const [currentUser, setCurrentUser] = useState<{name: string, dept: string, email: string} | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]); 
  const [audits, setAudits] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [focusedAuditId, setFocusedAuditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [typeLabel, setTypeLabel] = useState('자산 분류'); 
  // ✨ 자산 분류(it_type) 필터 추가 완료
  const [colFilters, setColFilters] = useState({ category: '', it_type: '', is_rental: '' });
  
  const [showStatusFilter, setShowStatusFilter] = useState<'all' | 'done' | 'pending' | 'nudge' | 'info_correction'>('all');
  /** 의견/요청: 조치완료·관리자답변 중 미확인(확인처리 전)만 */
  const [showFeedbackOnly, setShowFeedbackOnly] = useState(false);
  /** 의견/요청: 사용자→관리자 전송 후 답변 대기 */
  const [showAwaitingOnly, setShowAwaitingOnly] = useState(false);
  const [ackedRequestIds, setAckedRequestIds] = useState<Set<string>>(() => new Set());

  const [unifiedCommModal, setUnifiedCommModal] = useState<any | null>(null);
  const [pendingRequest, setPendingRequest] = useState<any | null>(null);
  const [completedRequest, setCompletedRequest] = useState<any | null>(null);
  const [commEditMode, setCommEditMode] = useState(false);
  const [showClosedHistory, setShowClosedHistory] = useState(false);
  /** 관리자 요청 확인 → 이력 유지한 채 답변 작성 */
  const [requestContent, setRequestContent] = useState('');
  const [confirmAuditModal, setConfirmAuditModal] = useState<any | null>(null);
  const [infoEditDraft, setInfoEditDraft] = useState({ code: '', model: '', sn: '', spec: '' });
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const todayStr = getKSTDateString();

  useEffect(() => { setCurrentPage(1); }, [searchQuery, colFilters, showStatusFilter, showFeedbackOnly, showAwaitingOnly]);

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

  const toggleAwaitingAssetFilter = () => {
    setShowStatusFilter('all');
    setShowFeedbackOnly(false);
    setShowAwaitingOnly((prev) => !prev);
  };
  /** 관리자 의견회신 → 하단 자산표의 조치완료(미확인) 필터 */
  const toggleFeedbackAssetFilter = () => {
    setShowStatusFilter('all');
    setShowAwaitingOnly(false);
    setShowFeedbackOnly((prev) => !prev);
  };
  const toggleInfoCorrectionFilter = () => {
    setShowFeedbackOnly(false);
    setShowAwaitingOnly(false);
    setShowStatusFilter((prev) => (prev === 'info_correction' ? 'all' : 'info_correction'));
  };
  
  const fetchAllData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [configRes, meRes, assetRes, reqRes, auditRes, unitRes] = await Promise.all([
        fetch('/api/admin/config').catch(()=>null),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/equipment/it?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/equipment/it/requests?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/equipment/it/audit?t=${ts}`, { cache: 'no-store' }).catch(()=>null),
        fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(()=>null),
      ]);

      if (configRes && configRes.ok) {
        const configData = await configRes.json();
        if (configData?.it_master_label) setTypeLabel(configData.it_master_label);
      }

      let user: any = null;
      if (meRes && meRes.ok) {
        const userData = await meRes.json();
        user = { name: userData.name || '알수없음', dept: userData.unit?.unit_name || '소속 미정', email: userData.email };
        setCurrentUser(user);
      }

      if (unitRes && unitRes.ok) {
        const unitData = await unitRes.json();
        setUnits(Array.isArray(unitData) ? unitData : []);
      }

      if (auditRes && auditRes.ok) setAudits(await auditRes.json());
      if (reqRes && reqRes.ok) setRequests(await reqRes.json());

      if (assetRes && assetRes.ok) {
        const allAssets = await assetRes.json();
        if (user) setAssets(allAssets.filter((a: any) => a.user === user.name));
        else setAssets([]);
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
          fetch('/api/equipment/it/requests', {
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
    if (!dept || dept === '소속 미정') return false;
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

  useEffect(() => {
    if (isAuditActive) return;
    if (showStatusFilter === 'done' || showStatusFilter === 'pending' || showStatusFilter === 'nudge') {
      setShowStatusFilter('all');
    }
  }, [isAuditActive, showStatusFilter]);

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
    } else if (lastAudit) {
      auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
      auditStatusDate = lastAudit;
      auditStatusColor = a.last_audit_by === 'admin'
        ? 'bg-violet-50 border-violet-200 text-violet-800 cursor-not-allowed'
        : 'bg-slate-100 text-slate-700 border-slate-300 cursor-not-allowed';
      isVerified = true;
    } else {
      auditStatusLabel = '미실사 장비';
      auditStatusColor = 'bg-slate-100 text-slate-600 border-slate-300 cursor-not-allowed border-dashed';
    }
    const auditStatusText = auditStatusDate ? `${auditStatusLabel} (${auditStatusDate})` : auditStatusLabel;
     
    const assetRequests = requests.filter(r => r.assetCode === a.code).sort((r1, r2) => new Date(r2.createdAt).getTime() - new Date(r1.createdAt).getTime());
    const latestReq = assetRequests[0];
     
    let commStatusLabel = '관리자에게 문의하기';
    let commStatusDate: string | null = null;
    let commStatusColor = 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200 shadow-sm';
    let hasUnreadFeedback = false;
    let isAwaitingAdminReply = false;
     
    if (latestReq) {
      const reqDate = getKSTDateString(latestReq.requestDate || latestReq.createdAt) || latestReq.requestDate || null;
      if (isUserPendingStatus(latestReq.status)) {
        commStatusLabel = isUserReplyRow(latestReq) ? '추가 문의 접수 완료' : '문의 접수 완료';
        commStatusDate = reqDate;
        commStatusColor = 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100';
        isAwaitingAdminReply = true;
      } else if (latestReq.status === '관리자 의견발송') {
        commStatusLabel = '관리자 문의/요청';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        hasUnreadFeedback = true;
        commStatusColor = 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100 animate-pulse shadow-sm';
      } else if (latestReq.status === '관리자 답변') {
        commStatusLabel = '관리자 답변 확인';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        hasUnreadFeedback = true;
        commStatusColor = 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100 shadow-sm';
      } else if (isUserClosedStatus(latestReq.status)) {
        commStatusLabel = '사용자 종료 처리';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        commStatusColor = 'bg-slate-100 border-slate-300 text-slate-500 hover:bg-slate-200';
      } else if (isAdminClosedStatus(latestReq.status)) {
        commStatusLabel = '관리자 종료 처리';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        commStatusColor = 'bg-slate-100 border-slate-300 text-slate-500 hover:bg-slate-200';
      }
    }
    const commStatusText = commStatusDate ? `${commStatusLabel} (${commStatusDate})` : commStatusLabel;

    const infoEditDate = hasInfoCorrection
      ? (parseInfoCorrectionPending(a.info_correction_pending)?.requestedAt || null)
      : null;
    const infoEditLabel = hasInfoCorrection ? '수정 대기중' : '정보수정하기';
    const infoEditColor = hasInfoCorrection
      ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 shadow-sm';
    const infoEditText = infoEditDate ? `${infoEditLabel} (${infoEditDate})` : infoEditLabel;
  
    return {
      isVerified, isNudged, hasInfoCorrection,
      auditStatusLabel, auditStatusDate, auditStatusText, auditStatusColor,
      commStatusLabel, commStatusDate, commStatusText, commStatusColor,
      infoEditLabel, infoEditDate, infoEditText, infoEditColor,
      hasUnreadFeedback, isAwaitingAdminReply,
    };
  };
  
  const openInfoCorrectionModal = (asset: any) => {
    setInfoEditDraft({
      code: getDisplayFieldValue(asset, 'code').value,
      model: getDisplayFieldValue(asset, 'model').value,
      sn: getDisplayFieldValue(asset, 'sn').value,
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
      const res = await fetch('/api/equipment/it', {
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
      const res = await fetch('/api/equipment/it', {
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
    const assetId = confirmAuditModal.id;
    
    // VERIFY(인증)인지 CANCEL(취소)인지 판단
    const isCancel = confirmAuditModal.action === 'CANCEL';
    const dateToSave = isCancel ? null : todayStr;
    const isDoneValue = !isCancel;

    try {
      const assetUpdate = await fetch('/api/equipment/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assetId,
          last_audit_date: dateToSave,
          last_audit_by: isCancel ? null : 'user',
          audit_request_date: '',
        })
      });

      const responseAudit = getCoveringAudit(confirmAuditModal) || activeAudit;
      if (responseAudit) {
        await fetch('/api/equipment/it/audit', {
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
    assets.forEach(a => {
      typeCounts[a.it_type] = (typeCounts[a.it_type] || 0) + 1;
      const logic = getAssetLogic(a);
      if (logic.isVerified) verified++;
      if (logic.isNudged) requestCount++;
      if (logic.hasUnreadFeedback) feedbackCount++;
      if (logic.isAwaitingAdminReply) awaitingReplyCount++;

      if (logic.hasInfoCorrection) infoCorrectionCount++;
      if (logic.isVerified) auditDoneCount++;
      else if (logic.isNudged) auditNudgeCount++;
      else auditPendingCount++;
    });
    return {
      verified,
      requestCount,
      feedbackCount,
      awaitingReplyCount,
      typeCounts,
      total: assets.length,
      unverified: assets.length - verified,
      auditDoneCount,
      auditPendingCount,
      auditNudgeCount,
      infoCorrectionCount,
    };
  }, [assets, activeAudit, requests, ackedRequestIds]);

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
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([k]) => k);
    // 보유 목록에 없어도 표준 옵션은 유지
    for (const fallback of ['구매', '렌탈', '구독']) {
      if (!ranked.includes(fallback)) ranked.push(fallback);
    }
    return ranked;
  }, [assets]);
  
  const filteredAssets = useMemo(() => {
    return assets
      .filter((a) => {
        const s = searchQuery.toLowerCase().trim();
        const logic = getAssetLogic(a);
        const matchSearch = !s || [a.code, a.model, a.sn, a.brand, a.spec].some(v => String(v).toLowerCase().includes(s));
        const matchCategory = !colFilters.category || a.category === colFilters.category;
        const matchItType = !colFilters.it_type || a.it_type === colFilters.it_type;
        const matchRental = !colFilters.is_rental || a.is_rental === colFilters.is_rental;

        let matchStatus = true;
        if (showStatusFilter === 'done') matchStatus = logic.isVerified;
        else if (showStatusFilter === 'pending') {
          matchStatus = !logic.isVerified && !logic.isNudged;
        } else if (showStatusFilter === 'nudge') {
          matchStatus = !logic.isVerified && logic.isNudged;
        } else if (showStatusFilter === 'info_correction') {
          matchStatus = logic.hasInfoCorrection;
        }
        const matchFeedback = !showFeedbackOnly || logic.hasUnreadFeedback;
        const matchAwaiting = !showAwaitingOnly || logic.isAwaitingAdminReply;

        return matchSearch && matchCategory && matchItType && matchRental && matchStatus && matchFeedback && matchAwaiting;
      })
      // 최신 등록이 위 · NO는 큰 수가 위
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [assets, searchQuery, colFilters, showStatusFilter, showFeedbackOnly, showAwaitingOnly, ackedRequestIds, activeAudit, requests]);
  
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  
  const handleExcelDownload = () => {
    const targetAssets = selectedIds.size > 0 ? filteredAssets.filter(a => selectedIds.has(a.id)) : filteredAssets;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const excelData = targetAssets.map((a, index) => ({
      'NO': targetAssets.length - index,
      '조직': a.dept || '-',
      '사용자': a.user || '-',
      '범주': a.category,
      '자산 분류': a.it_type,
      '조달유형': a.is_rental || '-',
      '자산번호': a.code,
      '모델명': a.model,
      'S/N': a.sn,
      '제조사': a.brand || '-',
      '기본 사양': a.spec,
      '최근실사일': a.last_audit_date || '-',
      '기타(메모)': a.memo,
    }));
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "My_Assets"); XLSX.writeFile(wb, `나의업무자산현황_${currentUser?.name}.xlsx`);
  };
  
// ✨ 에러 추적 기능이 강화된 전송 함수
const handleSubmitRequest = async () => {
  if (!requestContent.trim()) return alert("요청하실 내용을 입력해 주세요.");
  
  const newReq = {
    requestDate: todayStr,
    requester: currentUser?.name, 
    dept: currentUser?.dept,
    assetInfo: `${unifiedCommModal.code} / ${unifiedCommModal.model}`,
    content: requestContent, 
    status: '의견전송', // 🚀 관리자 대시보드 '사용자 의견수신'과 매칭되는 핵심 키워드
    assetCode: unifiedCommModal.code, 
    assetType: unifiedCommModal.it_type,
  };
  
  try {
    const res = await fetch('/api/equipment/it/requests', { 
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
  setShowClosedHistory(false);
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
      const res = await fetch('/api/equipment/it/requests', {
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
  setShowClosedHistory(false);
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
    requester: currentUser.name,
    dept: currentUser.dept,
    assetInfo: `${unifiedCommModal.code} / ${unifiedCommModal.model}`,
    content: requestContent.trim(),
    status: '답변회신',
    adminOpinion: ':::REPLY:::',
    assetCode: unifiedCommModal.code,
    assetType: unifiedCommModal.it_type,
  };

  try {
    const res = await fetch('/api/equipment/it/requests', {
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
      await fetch('/api/equipment/it/requests', {
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

const handleCompleteThread = async (targetReq: any) => {
  if (!targetReq || !currentUser) return;
  if (!confirm('이 대화를 사용자 종료 처리할까요?')) return;
  const thread = collectThreadMessages(targetReq, requests);
  const latest = thread[thread.length - 1] || targetReq;
  try {
    const res = await fetch('/api/equipment/it/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: String(latest.id),
        status: '사용자 종료처리',
        ackedBy: currentUser.name || '',
        ackedDept: currentUser.dept || '',
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      alert(`❌ 종료 처리 실패: ${errData.error || '서버 오류'}`);
      return;
    }
    const updated = await res.json().catch(() => null);
    setPendingRequest(null);
    setCompletedRequest({ ...(updated || latest), status: '사용자 종료처리' });
    setRequestContent('');
    fetchAllData();
  } catch (e: any) {
    alert(`❌ 서버 통신 실패: ${e.message}`);
  }
};

const handleUpdatePendingRequest = async () => {
  if (!pendingRequest?.id) return;
  if (!requestContent.trim()) return alert('요청 내용을 입력해 주세요.');
  try {
    const res = await fetch('/api/equipment/it/requests', {
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
    const res = await fetch(`/api/equipment/it/requests?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert("✅ 의견 전송이 취소되었습니다.");
      closeCommModal();
      // 💡 컴포넌트 내부 이름인 fetchAllData로 정확하게 연동했습니다.
      fetchAllData(); 
    } else {
      alert("❌ 취소에 실패했습니다.");
    }
  } catch (e) {
    console.error(e);
    alert("❌ 통신 오류가 발생했습니다.");
  }
};

  const closedHistoryThreads = useMemo(() => {
    if (!unifiedCommModal) return [];
    const threads = collectAssetThreads(unifiedCommModal.code, requests);
    const current = pendingRequest || completedRequest;
    if (!current) return threads.filter((t) => t.closed);
    const currentIds = new Set(collectThreadMessages(current, requests).map((m) => String(m.id)));
    return threads.filter((t) => t.closed && !t.msgs.some((m) => currentIds.has(String(m.id))));
  }, [unifiedCommModal, requests, pendingRequest, completedRequest]);

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
  if (!currentUser) return <div className="p-20 text-center font-medium text-red-500">인증 정보가 없습니다. 다시 로그인해주세요.</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">

      {/* marketing/register 배너 공통 규격 */}
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10 min-w-0">
          <h3 className="text-[10px] font-medium text-indigo-400 mb-2.5">
            IT ASSET PERSONAL DESK
          </h3>
          <h1 className="text-2xl font-medium tracking-tight leading-none">
            <span className="text-indigo-400">{currentUser?.name || '임직원'} 님</span>
            <span className="text-white/30 mx-2.5">|</span>
            <span className="text-white">IT·업무자산 운영 현황</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            보유 자산 현황을 확인하고 정기 실사·의견 요청을 처리합니다.
          </p>
        </div>
      </div>

      {/* 요약 위젯 3열 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {/* 카드 1: 나의 보유 자산 요약 */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[14.5rem]">
          <div className="flex items-start justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-slate-500">나의 보유 자산</p>
              <p className="text-[9px] font-medium text-slate-400 mt-0.5">유형별 요약</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-medium text-slate-900 tracking-tighter leading-none tabular-nums">{stats.total}</p>
              <p className="text-[9px] font-medium text-slate-400 mt-1">총 보유</p>
            </div>
          </div>
          <div className="flex-1 min-h-0 mt-3 flex flex-wrap content-start gap-1.5">
            {Object.keys(stats.typeCounts).length === 0 ? (
              <div className="w-full h-full min-h-[64px] flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                <p className="text-[10px] font-medium text-slate-400">등록된 자산 없음</p>
              </div>
            ) : (
              Object.entries(stats.typeCounts).map(([type, count]) => {
                const isSelected = colFilters.it_type === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setColFilters({ ...colFilters, it_type: isSelected ? '' : type });
                    }}
                    className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
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
        </div>

        {/* 카드 2: 실사 운영 상태 */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[14.5rem]">
          <div className="shrink-0 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-slate-500">실사 운영 상태</p>
              <p className="text-[9px] font-medium text-slate-400 mt-0.5">Audit Status</p>
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
                      className={`px-2 py-0.5 rounded-md text-[9px] font-medium border transition-all whitespace-nowrap ${
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
                <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg font-medium text-[11px] animate-pulse">
                  🟢 실사 진행 중{myRunningAudits.length > 1 ? ` · ${myRunningAudits.length}건` : ''}
                </span>
              ) : (
                <span className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-medium text-[11px]">
                  ⚪ 실사 미진행
                </span>
              )}
              {isAuditActive && auditDaysLeft !== null && (
                <div className="text-right">
                  <p className="text-xl font-medium text-indigo-600 tracking-tighter leading-none tabular-nums">
                    {auditDaysLeft >= 0 ? `D-${auditDaysLeft}` : `D+${Math.abs(auditDaysLeft)}`}
                  </p>
                  <p className="text-[9px] font-medium text-slate-400 mt-0.5">남은 기간</p>
                </div>
              )}
            </div>
            {isAuditActive && focusedAudit && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
                <p className="text-[9px] font-medium text-slate-400">
                  현재 실사 운영 기간
                </p>
                <p className="mt-1 text-[13px] font-medium tracking-tight text-indigo-700">
                  {focusedAudit.startDate} ~ {focusedAudit.endDate}
                </p>
                <p className="mt-1 text-[10px] font-medium text-slate-400 tabular-nums">
                  마감 {(focusedAudit.endTime || '23:59').trim() || '23:59'}
                </p>
              </div>
            )}
          </div>
          {isAuditActive && (
          <div className="pt-3 mt-auto border-t border-slate-100 grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setShowFeedbackOnly(false);
                setShowAwaitingOnly(false);
                setShowStatusFilter((prev) => (prev === 'done' ? 'all' : 'done'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                showStatusFilter === 'done'
                  ? 'bg-emerald-600 border-emerald-500 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              <span className="text-[8px] font-medium mb-0.5 leading-tight text-center">실사 완료장비</span>
              <span className="text-sm font-medium tabular-nums">{stats.auditDoneCount}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowFeedbackOnly(false);
                setShowAwaitingOnly(false);
                setShowStatusFilter((prev) => (prev === 'pending' ? 'all' : 'pending'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                showStatusFilter === 'pending'
                  ? 'bg-slate-700 border-slate-600 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="text-[8px] font-medium mb-0.5 leading-tight text-center">미실사 장비</span>
              <span className="text-sm font-medium tabular-nums">{stats.auditPendingCount}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowFeedbackOnly(false);
                setShowAwaitingOnly(false);
                setShowStatusFilter((prev) => (prev === 'nudge' ? 'all' : 'nudge'));
              }}
              className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${
                showStatusFilter === 'nudge'
                  ? 'bg-rose-600 border-rose-500 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'
              }`}
            >
              <span className="text-[8px] font-medium mb-0.5 leading-tight text-center">미실사/마감 임박 장비</span>
              <span className="text-sm font-medium tabular-nums">{stats.auditNudgeCount}</span>
            </button>
          </div>
          )}
        </div>

        {/* 카드 3: 의견/요청 대시보드 */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[14.5rem]">
          <div className="shrink-0">
            <p className="text-[10px] font-medium text-slate-500">기타 의견/요청 대시보드</p>
            <p className="text-[9px] font-medium text-slate-400 mt-0.5">클릭 시 자산 목록 필터</p>
          </div>
          <div className="flex-1 mt-3 flex flex-col gap-1.5 justify-end">
            <button
              type="button"
              onClick={toggleAwaitingAssetFilter}
              className={`w-full px-3 py-1.5 rounded-xl text-[11px] font-medium border transition-all flex items-center justify-between ${
                showAwaitingOnly
                  ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50 hover:border-amber-200'
              }`}
            >
              <span className="text-left leading-snug">나의 전송 내역<br /><span className="text-[10px] font-medium opacity-90">(사용자 → 관리자)</span></span>
              <span className={`text-sm font-medium tabular-nums shrink-0 ml-2 ${showAwaitingOnly ? 'text-white' : 'text-amber-600'}`}>
                {stats.awaitingReplyCount}
              </span>
            </button>
            <button
              type="button"
              onClick={toggleFeedbackAssetFilter}
              className={`w-full px-3 py-1.5 rounded-xl text-[11px] font-medium border transition-all flex items-center justify-between ${
                showFeedbackOnly
                  ? 'bg-rose-600 border-rose-600 text-white shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50 hover:border-rose-200'
              }`}
            >
              <span className="text-left leading-snug">나의 수신 내역<br /><span className="text-[10px] font-medium opacity-90">(관리자 → 사용자)</span></span>
              <span className={`text-sm font-medium tabular-nums ${showFeedbackOnly ? 'text-white' : 'text-rose-600'}`}>
                {stats.feedbackCount}
              </span>
            </button>
            <button
              type="button"
              onClick={toggleInfoCorrectionFilter}
              className={`w-full px-3 py-1.5 rounded-xl text-[11px] font-medium border transition-all flex items-center justify-between ${
                showStatusFilter === 'info_correction'
                  ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50 hover:border-amber-200'
              }`}
            >
              <span className="text-left leading-snug">정보수정 대기 장비<br /><span className="text-[10px] font-medium opacity-90">(관리자 승인 대기)</span></span>
              <span className={`text-sm font-medium tabular-nums shrink-0 ml-2 ${showStatusFilter === 'info_correction' ? 'text-white' : 'text-amber-600'}`}>
                {stats.infoCorrectionCount}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in duration-300 slide-in-from-top-4">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <h2 className="text-sm font-medium text-slate-800 tracking-tight">나의 업무자산 목록</h2>
            <span className="text-[11px] font-medium bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredAssets.length}건</span>
            {showStatusFilter === 'done' && (
              <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">실사 완료만</span>
            )}
            {showStatusFilter === 'pending' && (
              <span className="text-[10px] font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">미실사만</span>
            )}
            {showStatusFilter === 'nudge' && (
              <span className="text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">마감 임박만</span>
            )}
            {showStatusFilter === 'info_correction' && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">정보수정 대기만</span>
            )}
            {showAwaitingOnly && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">문의 접수 대기만</span>
            )}
            {showFeedbackOnly && (
              <span className="text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">관리자 답변·요청(미확인)만</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative group/filter flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-medium text-slate-400">범주</span>
              <select
                value={colFilters.category}
                onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="">전체</option>
                {uniqueCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-medium text-slate-400">{typeLabel}</span>
              <select
                value={colFilters.it_type}
                onChange={(e) => setColFilters({ ...colFilters, it_type: e.target.value })}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent max-w-[120px]"
              >
                <option value="">전체</option>
                {uniqueItTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />

              <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap">조달유형</span>
              <select
                value={colFilters.is_rental}
                onChange={(e) => setColFilters({ ...colFilters, is_rental: e.target.value })}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent"
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
                className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-medium outline-none focus:border-indigo-500 shadow-sm transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={handleExcelDownload}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-medium shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap"
            >
              {selectedIds.size > 0
                ? `선택 EXCEL 다운로드(${selectedIds.size})`
                : '화면 목록 EXCEL 다운로드'}
            </button>
          </div>
        </div>

        <div className="overflow-x-hidden">
          <table className="w-full text-left border-collapse table-fixed">
            <colgroup>
              <col style={{ width: '2.5%' }} />
              <col style={{ width: '3%' }} />
              <col style={{ width: '4.5%' }} />
              <col style={{ width: '7.5%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8.5%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '9.5%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10.5%' }} />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-medium border-b border-slate-200">
              <tr>
                <th className="h-12 pl-2 text-center">
                  <input type="checkbox" checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedIds.has(a.id))} onChange={() => {
                    const currentPageIds = paginatedAssets.map(a => a.id);
                    const allSelected = currentPageIds.every(id => selectedIds.has(id));
                    const next = new Set(selectedIds);
                    if (allSelected) currentPageIds.forEach(id => next.delete(id));
                    else currentPageIds.forEach(id => next.add(id));
                    setSelectedIds(next);
                  }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
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
                <th className="h-12 px-1 text-center border-l border-slate-200 whitespace-nowrap min-w-[6.5rem]">실사 확인</th>
                <th className="h-12 px-1 text-center text-rose-600 whitespace-nowrap min-w-[6.5rem]">의견/요청</th>
                <th className="h-12 px-1 text-center text-amber-700 whitespace-nowrap min-w-[6.5rem]">정보수정</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-medium text-slate-700">
              {paginatedAssets.length === 0 ? (
                <tr><td colSpan={13} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 자산이 없습니다.</td></tr>
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
                      <td className="px-1 text-center text-slate-500 tabular-nums">
                        {rowNo}
                      </td>
                      <td className="px-1 text-center truncate" title={a.category || ''}>
                        {a.category || '-'}
                      </td>
                      <td className="px-1 text-center text-indigo-700 font-medium truncate border-r border-slate-200" title={a.it_type || ''}>
                        {a.it_type || '-'}
                      </td>
                      <td className="px-1 text-center whitespace-nowrap text-slate-800" title={a.is_rental || ''}>
                        {a.is_rental || '-'}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'code').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'code');
                          return <span className={d.isPending ? 'text-red-600 font-medium' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'model').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'model');
                          return <span className={d.isPending ? 'text-red-600 font-medium' : 'text-slate-800'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate tabular-nums" title={getDisplayFieldValue(a, 'sn').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'sn');
                          return <span className={d.isPending ? 'text-red-600 font-medium' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-2 truncate" title={a.brand || ''}>
                        {a.brand || '-'}
                      </td>
                      <td className="px-2 truncate" title={getDisplayFieldValue(a, 'spec').value}>
                        {(() => {
                          const d = getDisplayFieldValue(a, 'spec');
                          return <span className={d.isPending ? 'text-red-600 font-medium' : 'text-slate-900'}>{d.value || '-'}</span>;
                        })()}
                      </td>
                      <td className="px-1 text-center border-l border-slate-200 min-w-[6.5rem]">
                        {isAuditActive ? (
                          <button
                            type="button"
                            title={logic.auditStatusText}
                            onClick={() => {
                              setConfirmAuditModal({ ...a, action: logic.isVerified ? 'CANCEL' : 'VERIFY' });
                            }}
                            className={`w-full h-[2.25rem] px-0.5 rounded text-[10px] font-medium tracking-tight transition-all shadow-sm border leading-tight flex flex-col items-center justify-center ${logic.auditStatusColor}`}
                          >
                            <span className="truncate max-w-full">{logic.auditStatusLabel}</span>
                            {logic.auditStatusDate && (
                              <span className="text-[9px] font-medium tabular-nums mt-0.5 opacity-90">({logic.auditStatusDate})</span>
                            )}
                          </button>
                        ) : (
                          <div title={logic.auditStatusText} className={`w-full h-[2.25rem] px-0.5 rounded text-[10px] font-medium tracking-tight border leading-tight flex flex-col items-center justify-center ${logic.auditStatusColor}`}>
                            <span className="truncate max-w-full">{logic.auditStatusLabel}</span>
                            {logic.auditStatusDate && (
                              <span className="text-[9px] font-medium tabular-nums mt-0.5 opacity-90">({logic.auditStatusDate})</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-1 text-center min-w-[6.5rem]">
                        <button
                          type="button"
                          title={logic.commStatusText}
                          onClick={() => openCommModal(a)}
                          className={`w-full h-[2.25rem] px-0.5 rounded text-[10px] font-medium border transition-all shadow-sm cursor-pointer leading-tight flex flex-col items-center justify-center ${logic.commStatusColor}`}
                        >
                          <span className="truncate max-w-full">{logic.commStatusLabel}</span>
                          {logic.commStatusDate && (
                            <span className="text-[9px] font-medium tabular-nums mt-0.5 opacity-90">({logic.commStatusDate})</span>
                          )}
                        </button>
                      </td>
                      <td className="px-1 text-center min-w-[6.5rem]">
                        <button
                          type="button"
                          title={logic.infoEditText}
                          onClick={() => openInfoCorrectionModal(a)}
                          className={`w-full h-[2.25rem] px-0.5 rounded text-[10px] font-medium border transition-all cursor-pointer leading-tight flex flex-col items-center justify-center ${logic.infoEditColor}`}
                        >
                          <span className="truncate max-w-full">{logic.infoEditLabel}</span>
                          {logic.infoEditDate && (
                            <span className="text-[9px] font-medium tabular-nums mt-0.5 opacity-90">({logic.infoEditDate})</span>
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
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-medium text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </div>
  
      {/* ✨ 신규: 실사 확인 모달 (인증 / 취소 / 정보수정) */}
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
                <h4 className="text-lg font-medium text-rose-600 tracking-tight mb-2 text-center">실사 인증 내역 취소</h4>
                <p className="text-[11px] font-medium text-slate-500 mb-6 leading-relaxed bg-rose-50 p-4 rounded-xl border border-rose-100 text-center">
                  <span className="text-slate-900 font-medium">[{confirmAuditModal.code}]</span> 장비에 대한<br/>
                  실사 인증 내역을 <span className="text-rose-600">미확인 상태</span>로 되돌리시겠습니까?
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmAuditModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-medium text-[11px] hover:bg-slate-200 transition-colors">닫기</button>
                  <button type="button" onClick={executeAuditVerify} className="flex-[2] py-3.5 bg-rose-600 text-white rounded-xl font-medium text-[12px] shadow-md hover:bg-rose-700 active:scale-95 transition-all">실사 취소하기</button>
                </div>
              </>
            ) : confirmAuditModal.action === 'EDIT_INFO_PENDING' ? (
              <>
                <h4 className="text-[14px] font-medium text-slate-900 tracking-tight mb-2">정보수정 요청 내역</h4>
                <p className="text-[10px] font-medium text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
                  관리자 승인 전 · 취소 또는 내용 수정 가능
                </p>

                <div className="overflow-y-auto flex-1 pr-2 space-y-4 scrollbar-hide">
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">대상자산</span>
                      <span className="text-slate-800 text-right">{confirmAuditModal.it_type} | {confirmAuditModal.code} / {confirmAuditModal.model || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">요청일</span>
                      <span className="text-slate-800 tabular-nums">
                        {parseInfoCorrectionPending(confirmAuditModal.info_correction_pending)?.requestedAt || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">상태</span>
                      <span className="text-amber-600">정보수정 승인 대기중</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-[10px] font-medium text-slate-400">수정 요청 내용</p>
                    {([
                      ['code', '자산번호'],
                      ['model', '모델명'],
                      ['sn', 'S/N'],
                      ['spec', '기본 사양'],
                    ] as [InfoCorrectionField, string][]).map(([key, label]) => {
                      const original = String(confirmAuditModal[key] ?? '') || '-';
                      const dirty = String(infoEditDraft[key] ?? '').trim() !== String(confirmAuditModal[key] ?? '').trim();
                      return (
                        <label key={key} className="block">
                          <span className="flex items-center justify-between gap-2 text-[10px] font-medium text-slate-500">
                            <span>{label}</span>
                            {dirty && <span className="text-rose-600 normal-case truncate max-w-[60%]" title={original}>원본: {original}</span>}
                          </span>
                          <input
                            type="text"
                            value={infoEditDraft[key]}
                            onChange={(e) => setInfoEditDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                            className={`mt-1 w-full px-3 py-2.5 rounded-xl border text-[12px] font-medium outline-none transition-colors ${
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

                <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={cancelInfoCorrection}
                    className="flex-1 py-3.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl font-medium text-[11px] hover:bg-rose-100 transition-colors"
                  >
                    요청취소
                  </button>
                  <button
                    type="button"
                    onClick={submitInfoCorrection}
                    className="flex-[1.4] py-3.5 bg-amber-500 text-white rounded-xl font-medium text-[11px] shadow-md hover:bg-amber-600 active:scale-95 transition-all leading-tight px-2"
                  >
                    수정완료<br /><span className="text-[9px] font-medium opacity-90">(관리자 확인요청)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmAuditModal(null)}
                    className="flex-1 py-3.5 bg-slate-900 text-white rounded-xl font-medium text-[11px] hover:bg-black transition-colors"
                  >
                    확인-닫기
                  </button>
                </div>
              </>
            ) : confirmAuditModal.action === 'EDIT_INFO' ? (
              <>
                <h4 className="text-[14px] font-medium text-slate-900 tracking-tight mb-2">정보수정 요청</h4>
                <p className="text-[10px] font-medium text-slate-400 mb-6 border-b-2 border-slate-900 pb-3">
                  등록값 기준으로 표시됩니다. 틀린 칸만 수정한 뒤 관리자 확인을 요청하세요.
                </p>
                <div className="overflow-y-auto flex-1 pr-2 space-y-3 scrollbar-hide mb-2">
                  {([
                    ['code', '자산번호'],
                    ['model', '모델명'],
                    ['sn', 'S/N'],
                    ['spec', '기본 사양'],
                  ] as [InfoCorrectionField, string][]).map(([key, label]) => {
                    const original = String(confirmAuditModal[key] ?? '') || '-';
                    const dirty = String(infoEditDraft[key] ?? '').trim() !== String(confirmAuditModal[key] ?? '').trim();
                    return (
                      <label key={key} className="block">
                        <span className="flex items-center justify-between gap-2 text-[10px] font-medium text-slate-500">
                          <span>{label}</span>
                          {dirty && (
                            <span className="text-rose-600 normal-case truncate max-w-[60%]" title={original}>
                              원본: {original}
                            </span>
                          )}
                        </span>
                        <input
                          type="text"
                          value={infoEditDraft[key]}
                          onChange={(e) => setInfoEditDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                          className={`mt-1 w-full px-3 py-2.5 rounded-xl border text-[12px] font-medium outline-none transition-colors ${
                            dirty
                              ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-500'
                              : 'border-slate-200 bg-slate-50 text-slate-800 focus:border-indigo-500 focus:bg-white'
                          }`}
                        />
                      </label>
                    );
                  })}
                </div>
                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                  <button type="button" onClick={() => setConfirmAuditModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-medium text-[11px] hover:bg-slate-200 transition-colors">취소</button>
                  <button type="button" onClick={submitInfoCorrection} className="flex-[2] py-3.5 bg-amber-500 text-white rounded-xl font-medium text-[12px] shadow-md hover:bg-amber-600 active:scale-95 transition-all">수정완료 (관리자 확인요청)</button>
                </div>
              </>
            ) : (
              <>
                <h4 className="text-[14px] font-medium text-slate-900 tracking-tight mb-2">자산 실사 내역 확인</h4>
                <p className="text-[10px] font-medium text-slate-400 mb-4 border-b-2 border-slate-900 pb-3">
                  등록된 정보를 확인한 뒤 이상이 없으면 실사 확인 완료를 눌러 주세요.
                </p>
                <div className="overflow-y-auto flex-1 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2 mb-4">
                  {([
                    ['범주', confirmAuditModal.category],
                    ['자산 분류', confirmAuditModal.it_type],
                    ['조달유형', confirmAuditModal.is_rental],
                    ['자산번호', confirmAuditModal.code],
                    ['모델명', confirmAuditModal.model],
                    ['S/N', confirmAuditModal.sn],
                    ['제조사', confirmAuditModal.brand],
                    ['기본 사양', confirmAuditModal.spec],
                  ] as [string, unknown][]).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">{label}</span>
                      <span className="text-slate-800 text-right break-all">{String(value ?? '').trim() || '-'}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] font-medium text-slate-400 mb-4">
                  정보가 틀리면 <span className="text-amber-600">정보수정 요청</span>을 눌러 주세요.
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirmAuditModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-medium text-[11px] hover:bg-slate-200 transition-colors">취소</button>
                    <button type="button" onClick={executeAuditVerify} className="flex-[2] py-3.5 bg-emerald-600 text-white rounded-xl font-medium text-[12px] shadow-md hover:bg-emerald-700 active:scale-95 transition-all">✅ 실사 확인 완료</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => openInfoCorrectionModal(confirmAuditModal)}
                    className="w-full py-3.5 bg-white text-amber-700 border border-amber-300 rounded-xl font-medium text-[12px] hover:bg-amber-50 transition-all"
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
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div
            className="bg-white w-[500px] border border-slate-200 shadow-2xl p-8 rounded-3xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {pendingRequest ? (
              (() => {
                const isReply = pendingRequest.status === '답변회신';
                const threadMsgs = collectThreadMessages(pendingRequest, requests);
                const priorTurns = threadMsgs
                  .filter((m) => String(m.id) !== String(pendingRequest.id))
                  .flatMap(threadTurns);
                const allTurns = threadMsgs.flatMap(threadTurns);
                const userName = currentUser?.name || '사용자';
                return (
              <>
                <CommModalHeader
                  title={isReply ? '추가 문의 접수 완료' : '사용자 문의/요청'}
                  subtitle="관리자 답변 전 · 전송 취소 또는 내용 수정 가능"
                  closedCount={closedHistoryThreads.length}
                  showClosedHistory={showClosedHistory}
                  onToggle={() => setShowClosedHistory((v) => !v)}
                />

                <div className="overflow-y-auto flex-1 pr-2 space-y-4 min-h-0">
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">대상자산</span>
                      <span className="text-slate-800 text-right">{unifiedCommModal.it_type} | {unifiedCommModal.code} / {unifiedCommModal.model || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">{isReply ? '회신일' : '요청일'}</span>
                      <span className="text-slate-800 tabular-nums">
                        {getKSTDateString(pendingRequest.requestDate || pendingRequest.createdAt) || pendingRequest.requestDate || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">상태</span>
                      <span className="text-amber-600">대화 진행중</span>
                    </div>
                  </div>

                  {showClosedHistory && <ClosedHistoryBlock threads={closedHistoryThreads} />}

                  {commEditMode ? (
                    <>
                      <TimelineTurns turns={priorTurns} />
                      <TimelineCompose
                        name={userName}
                        dateLabel="수정 중"
                        value={requestContent}
                        onChange={setRequestContent}
                        placeholder={isReply ? '관리자 요청에 대한 답변을 수정하세요.' : '관리자에게 전달할 내용을 수정하세요.'}
                      />
                    </>
                  ) : (
                    <TimelineTurns turns={allTurns} />
                  )}
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
                        className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-medium text-[11px] hover:bg-slate-200 transition-colors"
                      >
                        편집 취소
                      </button>
                      <button
                        type="button"
                        onClick={handleUpdatePendingRequest}
                        className="flex-[2] py-3.5 bg-amber-500 text-white rounded-xl font-medium text-[12px] shadow-md hover:bg-amber-600 active:scale-95 transition-all"
                      >
                        내용 저장
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleCancelRequest(pendingRequest.id)}
                        className="flex-1 py-3.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl font-medium text-[11px] hover:bg-rose-100 transition-colors"
                      >
                        전송 취소
                      </button>
                      <button
                        type="button"
                        onClick={() => setCommEditMode(true)}
                        className="flex-1 py-3.5 bg-white text-slate-700 border border-slate-300 rounded-xl font-medium text-[11px] hover:bg-slate-50 transition-colors"
                      >
                        내용 수정
                      </button>
                      <button
                        type="button"
                        onClick={closeCommModal}
                        className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-medium text-[11px] hover:bg-slate-200 transition-colors"
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
                const userClosed = isUserClosedStatus(latest.status);
                const canUserReply = !threadClosed && isAdminOutboundRequest(latest.status);
                const turns = threadMsgs.flatMap(threadTurns);
                return (
                  <>
                    <CommModalHeader
                      title={
                        threadClosed
                          ? (userClosed ? '사용자 종료 처리' : '관리자 종료 처리')
                          : latest.status === '관리자 답변'
                            ? '관리자 답변 확인'
                            : '관리자 문의/요청'
                      }
                      subtitle={
                        threadClosed
                          ? '주고받은 전체 이력을 확인할 수 있습니다'
                          : '답변을 작성하거나 사용자 종료 처리할 수 있습니다'
                      }
                      closedCount={closedHistoryThreads.length}
                      showClosedHistory={showClosedHistory}
                      onToggle={() => setShowClosedHistory((v) => !v)}
                    />

                    <div className="overflow-y-auto flex-1 pr-2 space-y-4 min-h-0">
                      <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                        <div className="flex justify-between gap-3 text-[11px] font-medium">
                          <span className="text-slate-400 shrink-0">대상자산</span>
                          <span className="text-slate-800 text-right">{unifiedCommModal.it_type} | {unifiedCommModal.code} / {unifiedCommModal.model || '-'}</span>
                        </div>
                        <div className="flex justify-between gap-3 text-[11px] font-medium">
                          <span className="text-slate-400 shrink-0">상태</span>
                          <span className={threadClosed ? 'text-slate-500' : 'text-rose-600'}>
                            {threadClosed
                              ? (userClosed ? '사용자 종료 처리' : '관리자 종료 처리')
                              : '대화 진행중'}
                          </span>
                        </div>
                      </div>

                      {showClosedHistory && <ClosedHistoryBlock threads={closedHistoryThreads} />}

                      <TimelineTurns turns={turns} />

                      {canUserReply && (
                        <TimelineCompose
                          name={currentUser?.name || '사용자'}
                          dateLabel="작성 중"
                          value={requestContent}
                          onChange={setRequestContent}
                          placeholder="관리자 요청에 대한 답변을 작성하세요."
                        />
                      )}
                    </div>

                    <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={closeCompletedWithoutAck}
                        className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-medium text-[11px] hover:bg-slate-200 transition-colors"
                      >
                        닫기
                      </button>
                      {threadClosed ? (
                        <button
                          type="button"
                          onClick={startNewRequestFromHistory}
                          className="flex-[1.4] py-3.5 bg-slate-900 text-white rounded-xl font-medium text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                        >
                          관리자에게 문의하기
                        </button>
                      ) : (
                        <>
                          {canUserReply && (
                            <button
                              type="button"
                              onClick={handleSubmitAdminReply}
                              className="flex-[1.4] py-3.5 bg-slate-900 text-white rounded-xl font-medium text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                            >
                              관리자에게 답변 전송
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleCompleteThread(completedRequest)}
                            className="flex-1 py-3.5 bg-white text-slate-600 border border-slate-300 rounded-xl font-medium text-[11px] hover:bg-slate-50 transition-colors"
                          >
                            사용자 종료 처리
                          </button>
                        </>
                      )}
                    </div>
                  </>
                );
              })()
            ) : (
              <>
                <CommModalHeader
                  title="관리자에게 문의하기"
                  subtitle="관리자에게 전달할 내용을 작성해 주세요"
                  closedCount={closedHistoryThreads.length}
                  showClosedHistory={showClosedHistory}
                  onToggle={() => setShowClosedHistory((v) => !v)}
                />

                <div className="overflow-y-auto flex-1 pr-2 space-y-4 scrollbar-hide">
                  <div className="rounded-md bg-slate-50 border border-slate-200 px-4 py-3 space-y-2">
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">대상자산</span>
                      <span className="text-slate-800 text-right">{unifiedCommModal.it_type} | {unifiedCommModal.code} / {unifiedCommModal.model || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">요청일</span>
                      <span className="text-slate-800 tabular-nums">{todayStr}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] font-medium">
                      <span className="text-slate-400 shrink-0">요청자</span>
                      <span className="text-slate-800 text-right">{currentUser?.name || '-'} ({currentUser?.dept || '-'})</span>
                    </div>
                  </div>

                  {showClosedHistory && <ClosedHistoryBlock threads={closedHistoryThreads} />}

                  <TimelineCompose
                    name={currentUser?.name || '사용자'}
                    dateLabel={todayStr}
                    value={requestContent}
                    onChange={setRequestContent}
                    placeholder="장비 불량, 교체 희망, 소프트웨어 설치 지원 등 관리자에게 전달할 내용을 작성하세요."
                  />
                </div>

                <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={closeCommModal}
                    className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-medium text-[11px] hover:bg-slate-200 transition-colors"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitRequest}
                    className="flex-[2] py-3.5 bg-slate-900 text-white rounded-xl font-medium text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
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