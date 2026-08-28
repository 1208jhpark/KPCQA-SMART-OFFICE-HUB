'use client';
     
import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { getKSTDateString, addMonthsToKSTDateOnly, getKSTDaysUntil, parseExcelCellToKSTDateString, toSortableTime } from '@/utils/dateUtils';
import { resolveTopOrgName } from '@/utils/orgUnits';
import ItAssetQrImage from '@/components/asset/it/ItAssetQrImage';
import { generateItAssetQrDataUrls } from '@/utils/equipmentQr';
import LoadingState from '@/components/common/LoadingState';
import ItMasterPageBanner from '@/components/asset/it/ItMasterPageBanner';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import {
  getCompletedAuditLabel,
  getDisplayFieldValue,
  hasInfoCorrectionPending,
  parseInfoCorrectionPending,
  INFO_CORRECTION_FIELDS,
  INFO_CORRECTION_FIELD_LABELS,
  type InfoCorrectionField,
} from '@/utils/itInfoCorrection';
import { applyIdentityToAssetPayload, assetMatchesIdentity, toItIdentity } from '@/utils/itUserIdentity';
import {
  computeItAssetReplaceSchedule,
  computeItAssetTurnDisplay,
} from '@/utils/itAssetSchedule';

const MENU_PATH = '/asset/it/master/dashboard';
const DEPT_FILTER_ALL = '조직 (전체)';
const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70 shadow-none';

function isBoldOrgType(unitType?: string | null) {
  const t = String(unitType || '').trim().toUpperCase();
  return t === 'ORGANIZATION' || t === 'HQ';
}

function flattenUnitsInSortOrder<T extends { id: string; parent_id?: string | null; sort_order?: number | null; unit_name?: string | null }>(units: T[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depthOf = (unit: T) => {
    let depth = 0;
    let current: T | undefined = unit;
    const seen = new Set<string>();
    while (current?.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parent_id);
    }
    return depth;
  };
  return [...units]
    .sort((a, b) => {
      const ao = Number(a.sort_order) || 0;
      const bo = Number(b.sort_order) || 0;
      if (ao !== bo) return ao - bo;
      return String(a.unit_name || '').localeCompare(String(b.unit_name || ''), 'ko');
    })
    .map((unit) => ({ ...unit, depth: depthOf(unit) }));
}

/** 이메일 @ 앞자리 — 동명이인 구분용 */
function emailLocalPart(email: string | null | undefined) {
  const e = String(email || '').trim();
  if (!e) return '';
  const at = e.indexOf('@');
  return (at > 0 ? e.slice(0, at) : e).toLowerCase();
}

function formatUserOptionLabel(u: { name?: string | null; email?: string | null }) {
  const name = String(u.name || '').trim() || '-';
  const local = emailLocalPart(u.email);
  return local ? `${name} (${local})` : name;
}

function isUserPendingStatus(status: string) {
  return status === '의견전송' || status === '답변 대기중' || status === '답변회신' || status === '대기중';
}

function isClosedStatus(status: string) {
  return status === '처리완료' || status === '관리자 확인완료' || status === '사용자 종료처리';
}

function isAdminClosedStatus(status: string) {
  return status === '처리완료' || status === '관리자 확인완료' || status === '사용자 종료처리';
}

/** 마지막 말이 관리자 → 사용자 차례 (관리자는 연속 답변 불가) */
function isWaitingForUser(status: string) {
  return status === '관리자 의견발송' || status === '관리자 답변';
}

/** 동일 스레드: 자산번호 + 자산분류가 같을 때만 */
function sameAssetCode(a: any, b: any) {
  const codeA = String(a?.assetCode || a?.code || '').trim();
  const codeB = String(b?.assetCode || b?.code || '').trim();
  if (!codeA || codeA !== codeB) return false;
  const typeA = String(a?.assetType || a?.category || '').trim() || '일반';
  const typeB = String(b?.assetType || b?.category || '').trim() || '일반';
  return typeA === typeB;
}

function reqTime(r: any) {
  return toSortableTime(r?.createdAt || r?.requestDate || 0);
}

function parseAdminOpinionText(raw: string | null | undefined) {
  const parts = String(raw || '').split(':::');
  const opinionText = parts[0] || '';
  const responderName = (parts[1] || '').trim() || '-';
  const responderDept = (parts[2] || '').trim();
  const responderLabel = [responderDept, responderName].filter((v) => v && v !== '-').join(' / ') || responderName;
  return { opinionText, responderName, responderDept, responderLabel };
}

function opinionDisplay(raw: string | null | undefined) {
  const text = parseAdminOpinionText(raw).opinionText.trim();
  if (!text || text.includes('의견 없이 처리') || text === '종결 처리' || text === '처리 완료' || text.includes(':::REPLY:::')) return '';
  return text;
}

function userContentDisplay(raw: string | null | undefined) {
  const text = String(raw || '').trim();
  if (!text || text === '(관리자 의견)') return '';
  return text;
}

function getImmediatePrior(req: any, allRequests: any[]) {
  const t = reqTime(req);
  return (
    allRequests
      .filter((r) => sameAssetCode(r, req) && String(r.id) !== String(req.id) && reqTime(r) <= t)
      .sort((a, b) => {
        const d = reqTime(b) - reqTime(a);
        if (d !== 0) return d;
        return String(b.id || '').localeCompare(String(a.id || ''));
      })[0] || null
  );
}

function getThreadParentId(req: any, allRequests: any[]): string | null {
  if (!req) return null;
  const status = String(req.status || '').trim();
  if (status === '관리자 의견발송' || status === '사용자 확인완료') return null;
  const prior = getImmediatePrior(req, allRequests);
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

function isIncomingReply(req: any, allRequests: any[] = []) {
  if (!req) return false;
  const status = String(req.status || '').trim();
  if (status === '답변회신') return true;
  if (String(req.adminOpinion || '').includes(':::REPLY:::')) return true;
  if (status !== '의견전송' && status !== '답변 대기중' && status !== '대기중') return false;
  return !!getThreadParentId(req, allRequests);
}

function threadTurns(req: any) {
  const status = String(req?.status || '').trim();
  const userText = userContentDisplay(req?.content);
  const adminText = opinionDisplay(req?.adminOpinion);
  const reqDate = getKSTDateString(req?.requestDate || req?.createdAt) || req?.requestDate || '';
  const doneDate = getKSTDateString(req?.completedAt || req?.updatedAt || req?.createdAt) || reqDate;
  const turns: { role: 'admin' | 'user'; label: string; text: string; date: string }[] = [];
  if (status === '관리자 의견발송' || status === '사용자 확인완료' || status === '관리자 답변') {
    if (adminText) turns.push({ role: 'admin', label: status === '관리자 답변' ? '관리자 답변' : '관리자 요청', text: adminText, date: reqDate });
  } else if (status === '답변회신' || status === '의견전송' || status === '답변 대기중' || status === '대기중') {
    if (userText) turns.push({ role: 'user', label: status === '답변회신' ? '사용자 답변' : '사용자 요청', text: userText, date: reqDate });
  } else if (isClosedStatus(status)) {
    if (userText) turns.push({ role: 'user', label: '사용자 답변', text: userText, date: reqDate });
    if (adminText) turns.push({ role: 'admin', label: '관리자 답변', text: adminText, date: doneDate });
  }
  return turns;
}
     
interface DashboardProps {
  moduleTitle?: string;
  moduleDescription?: string;
}
     
function MasterDashboardContent({ moduleTitle, moduleDescription }: DashboardProps) {
  const [assets, setAssets] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [masterFilters, setMasterFilters] = useState({
    categories: [] as string[],
    types: [] as string[],
    rentals: [] as string[]
  });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [colFilters, setColFilters] = useState({ category: '범주 (전체)', it_type: '자산 분류 (전체)', dept: DEPT_FILTER_ALL, is_rental: '조달유형 (전체)' });
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [showStatusFilter, setShowStatusFilter] = useState<'all' | 'done' | 'pending' | 'nudge' | 'info_correction'>('all'); 
  const [showFeedbackFilter, setShowFeedbackFilter] = useState(false); 
  /** 관리자 요청 전송내역 — 처리 완료 전(요청·답변완료 포함) */
  const [showAdminOutboundFilter, setShowAdminOutboundFilter] = useState(false);
  const [ddayFilter, setDdayFilter] = useState<'all' | 'd-30' | 'd-day' | 'd-plus'>('all'); 
  const [itMasterLabel, setItMasterLabel] = useState('자산 분류');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [bulkPrintAssets, setBulkPrintAssets] = useState<any[]>([]);
  const [bulkQrMap, setBulkQrMap] = useState<Record<string, string>>({});
  const [bulkQrReady, setBulkQrReady] = useState(false);
     
  const [showQrModal, setShowQrModal] = useState<any | null>(null);
     
  const [terminateModal, setTerminateModal] = useState<{
    id: string;
    reason: string;
    actionType: '반납' | '폐기' | '재판매' | null;
    reseller?: string;
    resellPrice?: number;
  } | null>(null);
     
  const [audits, setAudits] = useState<any[]>([]);
  const [focusedAuditId, setFocusedAuditId] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [editingReq, setEditingReq] = useState<any>(null);
  const [editOpinion, setEditOpinion] = useState('');
  const [commEditMode, setCommEditMode] = useState(false);
  /** 관리자 → 사용자 의견요청 작성 모달 (자산) */
  const [adminComposeAsset, setAdminComposeAsset] = useState<any | null>(null);
  const [infoCorrectionModal, setInfoCorrectionModal] = useState<any | null>(null);
  const [infoApproveDraft, setInfoApproveDraft] = useState<Record<InfoCorrectionField, string>>({
    model: '',
    sn: '',
    brand: '',
    spec: '',
  });
     
  const fetchAllDataFromServer = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [assetRes, orgRes, userRes, reqRes, configRes, masterRes, auditRes, meRes, ifRes] = await Promise.all([
        fetch(`/api/asset/it?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/units?active=true').catch(() => null),
        // LV_1 전용 /api/admin/users 대신, 마스터 대시보드 권한으로 조회
        fetch(`/api/asset/it/users?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/asset/it/requests?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/config').catch(() => null),
        fetch('/api/admin/master-data').catch(() => null),
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);
  
      if (assetRes && assetRes.ok) {
        const loadedAssets = await assetRes.json();
        setAssets(loadedAssets);
      }
  
      if (orgRes && orgRes.ok) setOrgs(await orgRes.json());
      if (userRes && userRes.ok) {
        const userPayload = await userRes.json();
        setUsers(Array.isArray(userPayload?.users) ? userPayload.users : []);
      } else {
        setUsers([]);
      }
      if (reqRes && reqRes.ok) setRequests(await reqRes.json());
      if (meRes && meRes.ok) setCurrentUser(await meRes.json());
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/it/master/dashboard'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
  
      let configData: any = {};
      if (configRes && configRes.ok) configData = await configRes.json();
      if (configData?.it_master_label) setItMasterLabel(configData.it_master_label);
      
      if (masterRes && masterRes.ok) {
        const masterData = await masterRes.json();
        const catGroup = masterData.find((g: any) => g.id === configData?.it_category_group);
        const typeGroup = masterData.find((g: any) => g.id === configData?.it_master_group);
        const rentalGroup = masterData.find((g: any) => g.id === configData?.it_rental_group);
        setMasterFilters({
          categories: catGroup?.codes ? catGroup.codes.filter((c: any) => !c.is_archived).map((c: any) => c.label) : [],
          types: typeGroup?.codes ? typeGroup.codes.filter((c: any) => !c.is_archived).map((c: any) => c.label) : [],
          rentals: rentalGroup?.codes ? rentalGroup.codes.filter((c: any) => !c.is_archived).map((c: any) => c.label) : []
        });
      }
     
      if (auditRes && auditRes.ok) {
        const loadedAudits = await auditRes.json();
        setAudits(loadedAudits);
      }
     
    } catch (e) { 
      console.error("데이터 동기화 에러", e); 
    } finally { 
      setLoading(false); 
    }
  };
  
  useEffect(() => { fetchAllDataFromServer(); }, []);
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [searchQuery, userFilter, colFilters, showReplaceableOnly, showDuplicatesOnly, showStatusFilter, showFeedbackFilter, showAdminOutboundFilter, ddayFilter, focusedAuditId]);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
     
  const formatNumber = (val: any) => val?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") || '0';
  
  const usersOfDept = (deptName: string) => {
    const dept = String(deptName || '').trim();
    if (!dept) return [];
    return users
      .filter((u) => {
        const unitName = String(u.unit?.unit_name || u.dept || '').trim();
        return unitName === dept;
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  };

  /** 자산 행에 매칭되는 사용자 select value (user_id 우선) */
  const resolveSelectedUserId = (asset: any, deptName: string) => {
    const list = usersOfDept(deptName);
    const uid = String(asset?.user_id || '').trim();
    if (uid && list.some((u) => u.id === uid)) return uid;
    const email = String(asset?.user_email || '').trim().toLowerCase();
    if (email) {
      const byEmail = list.find(
        (u) => String(u.email || '').trim().toLowerCase() === email
      );
      if (byEmail) return byEmail.id;
    }
    const name = String(asset?.user || '').trim();
    if (name && name !== '-' && name !== '공용') {
      const byName = list.filter((u) => String(u.name || '').trim() === name);
      if (byName.length === 1) return byName[0].id;
    }
    return '';
  };

  const handleUserSelect = (assetId: string, userId: string) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        const updated = { ...a };
        const id = String(userId || '').trim();
        if (!id) {
          updated.user = '';
          updated.user_email = null;
          updated.user_id = null;
          return updated;
        }
        const matched =
          usersOfDept(String(a.dept || '')).find((u) => u.id === id) ||
          users.find((u) => u.id === id);
        applyIdentityToAssetPayload(updated, toItIdentity(matched));
        if (!matched) {
          updated.user = '';
          updated.user_email = null;
          updated.user_id = null;
        }
        return updated;
      })
    );
  };

  /** 등록 당일(KST 00:00~23:59) 행 하이라이트: excel=연두, manual=파랑 */
  const getTodayEntryHighlight = (asset: any): 'excel' | 'manual' | null => {
    const createdDay = getKSTDateString(asset?.createdAt || asset?.reg_date || Date.now());
    if (!createdDay || createdDay !== getKSTDateString()) return null;
    const src = String(asset?.entry_source || '').trim();
    if (src === 'excel') return 'excel';
    if (src === 'manual') return 'manual';
    const id = String(asset?.id || '');
    if (id.includes('AST_TEMP') || (id.startsWith('AST-') && !id.includes('EXCEL') && !id.includes('AST-EX'))) {
      return 'manual';
    }
    if (id.includes('EXCEL') || id.includes('AST-EX')) return 'excel';
    return null;
  };

  const handleFieldChange = (id: string, field: string, value: any) => {
    setAssets(prev => prev.map(a => {
      if (a.id !== id) return a;
      
      const updated = { ...a, [field]: value };

      if (field === 'dept') {
        const inDept = usersOfDept(String(value || ''));
        const stillInDept =
          (updated.user_id && inDept.some((u) => u.id === updated.user_id)) ||
          (!updated.user_id &&
            inDept.some((u) => u.name === updated.user && inDept.filter((x) => x.name === updated.user).length === 1));
        if (!stillInDept) {
          updated.user = '';
          updated.user_email = null;
          updated.user_id = null;
        }
      }

      if (field === 'last_audit_date') {
        updated.last_audit_by = value ? 'admin' : null;
      }
  
      if (field === 'rental_months' || field === 'in_date') {
        const months = field === 'rental_months' ? Number(value) : Number(updated.rental_months);
        const startDate = field === 'in_date' ? value : updated.in_date;
  
        if (months > 0 && startDate) {
          updated.end_date = addMonthsToKSTDateOnly(String(startDate), months) || updated.end_date;
        }
      }
      return updated;
    }));
  };
     
  const handleAdd = async () => {
    if (!canEdit) return alertNoEditPermission();
    const today = getKSTDateString();
    const newId = `AST_TEMP_${Date.now()}`; 
    const newObj = { 
      id: newId, category: masterFilters.categories[0] || 'HW', it_type: masterFilters.types[0] || '기기', dept: topOrgName || sortedOrgs[0]?.unit_name || '', user: '', code: `AST-${Date.now()}`, 
      model: '', sn: '', spec: '', brand: '', is_rental: masterFilters.rentals[0] || '', rental_months: 0, 
      in_date: today, start_date: null, end_date: null, purchase_price: 0, monthly_fee: 0, 
      first_bill: null, cycle: 48, memo: '-', reg_date: today, entry_source: 'manual',
    };
    
    setAssets(prev => [newObj, ...prev]);
    setEditingId(newId);
    setEditSnapshot(null); // 신규 행: 취소 시 제거
    setCurrentPage(1);
  };
  
  const startEdit = (asset: any) => {
    if (!canEdit) return alertNoEditPermission();
    setEditSnapshot(JSON.parse(JSON.stringify(asset)));
    setEditingId(asset.id);
  };

  const handleCancelEdit = (id: string) => {
    const isNew = id.includes('AST_TEMP') || id.startsWith('AST-');
    if (isNew && !editSnapshot) {
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } else if (editSnapshot && editSnapshot.id === id) {
      setAssets((prev) => prev.map((a) => (a.id === id ? editSnapshot : a)));
    } else {
      fetchAllDataFromServer();
    }
    setEditingId(null);
    setEditSnapshot(null);
  };

  const handleSaveEdit = async (id: string) => {
    if (!canEdit) return alertNoEditPermission();
    const targetAsset = assets.find(a => a.id === id);
    if (!targetAsset) return;
    
    const isNew = id.includes('AST_TEMP') || id.includes('AST-');
    const method = isNew ? 'POST' : 'PATCH';
    
    const { id: _id, createdAt, updatedAt, ...submitData } = targetAsset;
    const payload = isNew ? submitData : { id, ...submitData };
    
    try {
      const response = await fetch(`/api/asset/it`, { 
        method: method, 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    
      if (response.ok) {
        setEditingId(null);
        setEditSnapshot(null);
        alert(isNew ? "✅ 신규 자산이 PostgreSQL DB에 등록되었습니다." : "✅ 자산 정보가 성공적으로 수정되었습니다.");
        fetchAllDataFromServer(); 
      } else {
        const err = await response.json();
        alert(`❌ DB 저장 실패: ${err.message || '서버 에러가 발생했습니다.'}`);
      }
    } catch (error) {
      console.error("DB Save Error:", error);
      alert("❌ 서버 통신 중 오류가 발생했습니다.");
    }
  };
     
  const handleSingleDelete = async (id: string) => {
    if (!canEdit) return alertNoEditPermission();
    const targetAsset = assets.find(a => a.id === id);
    if (!targetAsset) return;
    if (!confirm(`⚠️ 자산(${targetAsset.code})을 대장에서 삭제하시겠습니까?\n(허수·오등록 정리용. 종료 이관은 [종료]를 사용하세요.)`)) return;
    
    try {
      const response = await fetch(`/api/asset/it?id=${id}`, { method: 'DELETE' });
      if (response.ok) {
        alert("✅ 자산이 성공적으로 대장에서 제외되었습니다.");
        fetchAllDataFromServer(); 
      } else {
        const err = await response.json().catch(() => ({}));
        alert(`❌ 제외 실패${err.message ? `\n${err.message}` : ''}`);
      }
    } catch (error) {
      console.error("Delete Error:", error);
      alert("❌ 서버 통신 중 오류가 발생했습니다.");
    }
  };
  
  // 🚀 DB 통신 전용: 아카이브 이관(종료 처리) 함수
  const confirmTerminate = async (id: string) => {
    if (!canEdit) return alertNoEditPermission();
    const targetAsset = assets.find(a => a.id === id);
    if (!targetAsset) return;
    if (!confirm(`💼 자산(${targetAsset.code})을 '${terminateModal?.actionType}' 처리하고 아카이브로 이관하시겠습니까?`)) return;
    
    const archiveData = {
      ...targetAsset,
      status: terminateModal?.actionType,
      reason: terminateModal?.reason,
      reseller: terminateModal?.reseller || '-',
      resellPrice: terminateModal?.resellPrice || 0,
      terminated_at: getKSTDateString()
    };
    
    try {
      // 아카이브 저장 + 운영 대장 제거는 서버 트랜잭션으로 처리
      const archiveRes = await fetch(`/api/asset/it/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(archiveData)
      });

      if (archiveRes.ok) {
        alert("✅ 안전하게 아카이브 대장(DB)으로 이관되었습니다.");
        setTerminateModal(null);
        fetchAllDataFromServer(); 
      } else {
        const err = await archiveRes.json().catch(() => ({}));
        alert(`❌ 아카이브 이관 실패${err.message ? `\n${err.message}` : ''}`);
      }
    } catch (error) {
      console.error("Terminate Error:", error);
      alert("❌ 서버 통신 오류가 발생했습니다.");
    }
  };
     
  const parseExcelDate = (val: any) => parseExcelCellToKSTDateString(val);
     
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) {
      e.target.value = '';
      return alertNoEditPermission();
    }
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    
    reader.onload = async (evt) => {
      try {
        const arrayBuffer = evt.target?.result;
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<any>(ws);
        const today = getKSTDateString();
        
        const existingCodes = new Set(assets.map(a => a.code).filter(Boolean));
     
        const validData: any[] = [];
        const skippedData: any[] = [];
     
        data.forEach((row, idx) => {
          const generatedCode = `AST-EX-${Date.now()}-${idx}`;
          const rawCode = String(row['자산번호'] ?? '').trim();
          const rowCode = rawCode || generatedCode;
          const dashIfBlank = (v: any) => {
            const s = String(v ?? '').trim();
            return s ? s : '-';
          };

          const rawDept = String(row['부서'] ?? row['조직'] ?? '').trim();
          const matchedOrg = orgs.find(
            (o) => String(o.unit_name || '').trim() === rawDept
          );
          // 조직 미매칭/공란 → 부서·사용자 모두 '-'
          const resolvedDept = matchedOrg ? String(matchedOrg.unit_name).trim() : '-';

          const rawUser = String(row['사용자'] ?? '').trim();
          const rawUserEmailRaw = String(row['이메일'] ?? row['email'] ?? '').trim().toLowerCase();
          const rawUserEmail =
            !rawUserEmailRaw || rawUserEmailRaw === '-' ? '' : rawUserEmailRaw;
          const rawUserId = String(row['사용자ID'] ?? row['user_id'] ?? '').trim();
          const userIdKey = !rawUserId || rawUserId === '-' ? '' : rawUserId;
          const matchByEmailKey = (list: any[]) => {
            if (!rawUserEmail) return null;
            const fullHits = list.filter(
              (u) => String(u.email || '').trim().toLowerCase() === rawUserEmail
            );
            if (fullHits.length === 1) return fullHits[0];
            if (fullHits.length > 1) return null;
            const localKey = rawUserEmail.includes('@')
              ? emailLocalPart(rawUserEmail)
              : rawUserEmail;
            if (!localKey) return null;
            const localHits = list.filter((u) => emailLocalPart(u.email) === localKey);
            return localHits.length === 1 ? localHits[0] : null;
          };
          let resolvedUser = '-';
          let ownerIdentity: ReturnType<typeof toItIdentity> = null;
          if (resolvedDept !== '-') {
            const deptUsers = users.filter((u) => {
              const unitName = String(u.unit?.unit_name || u.dept || '').trim();
              return unitName === resolvedDept;
            });
            // ID → 이메일(전체/@앞자리) → (유일) 이름 — 동명이인·중복 앞자리는 확정하지 않음
            let matchedUser =
              (userIdKey
                ? deptUsers.find((u) => String(u.id || '').trim() === userIdKey) ||
                  users.find((u) => String(u.id || '').trim() === userIdKey) ||
                  null
                : null) ||
              matchByEmailKey(deptUsers) ||
              matchByEmailKey(users);
            if (!matchedUser && rawUser && rawUser !== '-') {
              const byName = deptUsers.filter(
                (u) => String(u.name || '').trim() === rawUser
              );
              matchedUser = byName.length === 1 ? byName[0] : null;
            }
            resolvedUser = matchedUser ? String(matchedUser.name).trim() : '-';
            ownerIdentity = toItIdentity(matchedUser);
          }
     
          const isCodeDup = existingCodes.has(rowCode);
     
          const newItem = {
            id: `AST-EXCEL-${Date.now()}-${idx}`,
            category: row['범주'] || 'HW',
            it_type: row[itMasterLabel] || row['자산 분류'] || '',
            dept: resolvedDept,
            user: resolvedUser,
            user_email: ownerIdentity?.email || null,
            user_id: ownerIdentity?.id || null,
            code: rowCode,
            model: dashIfBlank(row['모델명']),
            sn: dashIfBlank(row['S/N']),
            brand: dashIfBlank(row['제조사']),
            spec: dashIfBlank(row['기본 사양']),
            is_rental: String(row['조달유형'] ?? '').trim() || masterFilters.rentals[0] || '-',
            rental_months: parseInt(row['렌탈/구독(M)'] ?? row['렌탈/구독기간(M)']) || 0,
            purchase_price: parseInt(row['구매비'] ?? row['초기구매비(원)']) || 0,
            // 월렌탈·구독비는 monthly_fee에 통합 저장
            monthly_fee:
              parseInt(row['월렌탈/구독비'] ?? row['월렌탈료(원)'] ?? row['월구독료(원)']) || 0,
            in_date: parseExcelDate(row['입고일'] ?? row['입고일자']),
            end_date: parseExcelDate(row['계약종료'] ?? row['계약종료일']),
            first_bill: parseExcelDate(row['첫회청구'] ?? row['첫회청구일']),
            cycle: parseInt(row['교체주기(M)']) || 48,
            memo: dashIfBlank(row['메모'] ?? row['비고메모']),
            reg_date: today,
            entry_source: 'excel',
          };
     
          if (isCodeDup) {
            skippedData.push(newItem);
          } else {
            validData.push(newItem);
            existingCodes.add(rowCode);
          }
        });
        
        if (validData.length === 0) {
          alert(`❌ 업로드한 ${data.length}건 모두 이미 등록된 자산번호라 제외되었습니다.`);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
     
        setAssets(prev => [...validData, ...prev]);
        
        if (skippedData.length > 0) {
          alert(`⚠️ 총 ${data.length}건 중 중복된 ${skippedData.length}건을 제외하고, 정상적인 ${validData.length}건의 저장을 시작합니다...`);
        } else {
          alert(`⏳ 총 ${validData.length}건의 데이터를 서버 DB에 저장합니다...`);
        }
     
        const savePromises = validData.map(async (item) => {
          const { id: _id, ...submitData } = item; 
          
          const response = await fetch(`/api/asset/it`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submitData),
          });
     
          if (!response.ok) throw new Error(`DB Save Failed`);
          return response;
        });
     
        await Promise.all(savePromises);
     
        alert(`✅ ${validData.length}건 업로드 완료! (제외됨: ${skippedData.length}건)`);
        fetchAllDataFromServer();
     
      } catch (error) { 
        console.error("Excel Upload Error:", error);
        alert("❌ DB 저장 중 알 수 없는 오류가 발생하여 화면을 새로고침합니다."); 
        fetchAllDataFromServer(); 
      }
    }; 
    
    reader.readAsArrayBuffer(file);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
     
  const topOrgName = useMemo(() => resolveTopOrgName(orgs), [orgs]);

  const sortedOrgs = useMemo(() => flattenUnitsInSortOrder(orgs), [orgs]);
  const selectedOrgUnit = useMemo(
    () =>
      colFilters.dept === DEPT_FILTER_ALL
        ? null
        : sortedOrgs.find((o) => o.unit_name === colFilters.dept) || null,
    [sortedOrgs, colFilters.dept]
  );

  useEffect(() => {
    if (!orgMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setOrgMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOrgMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [orgMenuOpen]);

  const runningAudits = useMemo(
    () =>
      audits
        .filter((a) => a.status === '진행중')
        .sort((a, b) => String(a.endDate || '').localeCompare(String(b.endDate || ''))),
    [audits]
  );

  useEffect(() => {
    if (runningAudits.length === 0) {
      if (focusedAuditId) setFocusedAuditId(null);
      // 실사 대기: 완료/미실사/독촉 필터는 의미 없음 → 해제
      setShowStatusFilter((prev) =>
        prev === 'done' || prev === 'pending' || prev === 'nudge' ? 'all' : prev
      );
      return;
    }
    if (!focusedAuditId || !runningAudits.some((a) => a.id === focusedAuditId)) {
      setFocusedAuditId(runningAudits[0].id);
    }
  }, [runningAudits, focusedAuditId]);

  const focusedAudit = useMemo(
    () => runningAudits.find((a) => a.id === focusedAuditId) || runningAudits[0] || null,
    [runningAudits, focusedAuditId]
  );
  const isAuditActive = runningAudits.length > 0;
  /** 포커스 실사 종료일까지 남은 일수 (KST) */
  const auditDaysLeft = useMemo(() => {
    if (!focusedAudit?.endDate) return null;
    return getKSTDaysUntil(String(focusedAudit.endDate));
  }, [focusedAudit]);

  const unitCovers = (ancestorName: string, descendantName: string) => {
    if (ancestorName === descendantName) return true;
    let current = orgs.find((u) => u.unit_name === descendantName);
    while (current?.parent_id) {
      const parent = orgs.find((u) => u.id === current.parent_id);
      if (!parent) break;
      if (parent.unit_name === ancestorName) return true;
      current = parent;
    }
    return false;
  };

  const assetInAuditTarget = (assetDept: string, target: string) => {
    const dept = String(assetDept || '').trim();
    if (!dept) return false;
    const targets = String(target || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (targets.length === 0) return false;
    if (targets.includes('전사')) return true;
    return targets.some((t) => unitCovers(t, dept));
  };

  const getCoveringAudit = (asset: any) => {
    const covered = runningAudits.filter((a) => assetInAuditTarget(asset?.dept, a.target));
    if (covered.length === 0) return null;
    return covered.find((a) => a.id === focusedAuditId) || covered[0];
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

  const handleAuditBadgeClick = (audit: any) => {
    const targetName = String(audit.target || '')
      .split(',')[0]
      ?.trim() || '';
    const filterDept = targetName && targetName !== '전사' ? targetName : DEPT_FILTER_ALL;
    const alreadyFocused = focusedAuditId === audit.id;
    const alreadyFiltered = colFilters.dept === filterDept;

    setFocusedAuditId(audit.id);
    if (alreadyFocused && alreadyFiltered) {
      setColFilters((prev) => ({ ...prev, dept: DEPT_FILTER_ALL }));
      setUserFilter('');
    } else {
      setColFilters((prev) => ({ ...prev, dept: filterDept }));
      setUserFilter('');
    }
  };

  /** 행 「중복」배지: 동일 값으로 검색 토글 (다시 누르면 해제) */
  const toggleDuplicateSearch = (raw: string) => {
    const value = String(raw || '').trim();
    if (!value) return;
    setShowDuplicatesOnly(false);
    setSearchQuery((prev) => (prev.trim() === value ? '' : value));
  };
  
  /** 공란·`-` 등 미기입은 중복 집계에서 제외 */
  const isMeaningfulFieldValue = (raw: unknown) => {
    const v = String(raw ?? '').trim();
    return !!v && v !== '-';
  };

  const duplicateCodes = useMemo(() => {
    const codeMap: Record<string, number> = {};
    assets.forEach((a) => {
      const code = String(a.code || '').trim();
      if (!isMeaningfulFieldValue(code)) return;
      codeMap[code] = (codeMap[code] || 0) + 1;
    });
    return new Set(Object.keys(codeMap).filter((code) => codeMap[code] > 1));
  }, [assets]);
  
  const duplicateModels = useMemo(() => {
    const modelMap: Record<string, number> = {};
    assets.forEach((a) => {
      const m = String(a.model || '').trim();
      if (!isMeaningfulFieldValue(m)) return;
      modelMap[m] = (modelMap[m] || 0) + 1;
    });
    return new Set(Object.keys(modelMap).filter((model) => modelMap[model] > 1));
  }, [assets]);

  const duplicateSns = useMemo(() => {
    const snMap: Record<string, number> = {};
    assets.forEach((a) => {
      const sn = String(a.sn || '').trim();
      if (!isMeaningfulFieldValue(sn)) return;
      snMap[sn] = (snMap[sn] || 0) + 1;
    });
    return new Set(Object.keys(snMap).filter((sn) => snMap[sn] > 1));
  }, [assets]);
  
  const getAssetLogic = (a: any) => {
    // 마스터: 단일 util로 계산 (편집 중 미리보기 포함)
    const schedule = computeItAssetReplaceSchedule(a);

    let turnDisplay = '-';
    const rentalMonths = parseInt(String(a.rental_months ?? ''), 10) || 0;
    if (rentalMonths > 0 || (a.end_date && a.in_date)) {
      turnDisplay = computeItAssetTurnDisplay(a);
    }

    const repDate = schedule.replace_due_date || '-';
    const dday = schedule.replace_dday;
    let ddayText = '';
    let ddayColor = '';
    let showDdayBadge = false;

    if (dday !== null && dday !== undefined) {
      if (dday > 0) {
        ddayText = `D-${dday}`;
        ddayColor = 'bg-blue-500 text-white';
      } else if (dday === 0) {
        ddayText = 'D-Day';
        ddayColor = 'bg-amber-400 text-amber-900';
      } else {
        ddayText = `D+${Math.abs(dday)}`;
        ddayColor = 'bg-rose-500 text-white';
      }
      if (dday <= 30) showDdayBadge = true;
    }
  
    let isChecked = false;
    let auditStatusLabel = '미확인';
    let auditStatusDate: string | null = null;
    let auditStatusColor = 'bg-slate-100 text-slate-600 border-slate-300 border-dashed';

    const coveringAudit = getCoveringAudit(a);
         
    if (coveringAudit) {
      if (a.last_audit_date && a.last_audit_date >= coveringAudit.startDate) {
        isChecked = true;
        auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
        auditStatusDate = a.last_audit_date;
        auditStatusColor = a.last_audit_by === 'admin'
          ? 'bg-violet-50 border-violet-200 text-violet-800 shadow-sm cursor-pointer'
          : 'bg-slate-100 border-slate-300 text-slate-600 shadow-sm cursor-pointer';
      } else if (hasInfoCorrectionPending(a)) {
        isChecked = false;
        auditStatusLabel = '정보수정 승인대기';
        auditStatusDate = parseInfoCorrectionPending(a.info_correction_pending)?.requestedAt || null;
        auditStatusColor = 'bg-amber-50 border-amber-300 text-amber-800 animate-pulse shadow-sm cursor-pointer';
      } else if (a.audit_request_date) {
        isChecked = false;
        auditStatusLabel = '마감임박 독촉 전송';
        auditStatusDate = a.audit_request_date;
        // 의견요청 · 관리자 문의/요청과 동일 톤
        auditStatusColor = 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100 cursor-pointer';
      } else {
        isChecked = false;
        auditStatusLabel = '미실사 장비';
        auditStatusColor = 'bg-slate-900 text-white border-slate-900 shadow-sm cursor-pointer';
      }
    } else {
      if (hasInfoCorrectionPending(a)) {
        isChecked = false;
        auditStatusLabel = '정보수정 승인대기';
        auditStatusDate = parseInfoCorrectionPending(a.info_correction_pending)?.requestedAt || null;
        auditStatusColor = 'bg-amber-50 border-amber-300 text-amber-800 cursor-pointer';
      } else if (a.last_audit_date) {
        isChecked = true;
        auditStatusLabel = getCompletedAuditLabel(a.last_audit_by);
        auditStatusDate = a.last_audit_date;
        // 실사 대기 중: 관리자확인 보라 강조 없이 이력만 회색 (버튼은 비활성)
        auditStatusColor = 'bg-slate-100 text-slate-600 border-slate-300 shadow-sm';
      } else {
        isChecked = false;
        auditStatusLabel = '미실사 장비';
        // 실사 대기(대상 실사 없음): 회색·클릭 불가 톤
        auditStatusColor = 'bg-slate-100 text-slate-500 border-slate-200 border-dashed shadow-sm cursor-not-allowed';
      }
    }
    const auditStatusText = auditStatusDate ? `${auditStatusLabel} (${auditStatusDate})` : auditStatusLabel;
         
    const assetRequests = requests
      .filter((r) => String(r.assetCode || '').trim() === String(a.code || '').trim())
      .sort((r1, r2) => new Date(r2.createdAt || r2.requestDate || 0).getTime() - new Date(r1.createdAt || r1.requestDate || 0).getTime());
    const latestReq = assetRequests[0];
     
    let commStatusLabel = '신규 요청하기';
    let commStatusDate: string | null = null;
    let commStatusColor = 'bg-slate-100 border-slate-300 border-dashed text-slate-600 hover:bg-slate-200 shadow-sm cursor-pointer';
    let hasUserIncomingRequest = false;
    let hasAdminOutboundRequest = false;
     
    if (latestReq) {
      const reqDate = getKSTDateString(latestReq.requestDate || latestReq.createdAt) || latestReq.requestDate || null;
      if (isIncomingReply(latestReq, requests)) {
        commStatusLabel = '사용자 답변';
        commStatusDate = reqDate;
        commStatusColor = 'bg-amber-50 border-amber-300 text-amber-800 animate-pulse shadow-sm cursor-pointer';
        hasUserIncomingRequest = true;
      } else if (isUserPendingStatus(latestReq.status)) {
        commStatusLabel = '사용자 문의/요청';
        commStatusDate = reqDate;
        commStatusColor = 'bg-amber-50 border-amber-300 text-amber-800 animate-pulse shadow-sm cursor-pointer';
        hasUserIncomingRequest = true;
      } else if (latestReq.status === '관리자 의견발송') {
        commStatusLabel = '관리자 문의/요청';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        commStatusColor = 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100 cursor-pointer';
        hasAdminOutboundRequest = true;
      } else if (latestReq.status === '관리자 답변') {
        commStatusLabel = '관리자 답변';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        commStatusColor = 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100 cursor-pointer';
        hasAdminOutboundRequest = true;
      } else if (isAdminClosedStatus(latestReq.status)) {
        commStatusLabel = '처리 완료(종료)';
        commStatusDate = getKSTDateString(latestReq.completedAt || latestReq.updatedAt || latestReq.createdAt) || reqDate;
        // 실사 완료 · 신규 요청하기와 동일 톤
        commStatusColor = 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200 shadow-sm cursor-pointer';
      }
    }
    const commStatusText = commStatusDate ? `${commStatusLabel} (${commStatusDate})` : commStatusLabel;
         
    return { 
      turnDisplay, repDate, dday, ddayText, ddayColor, showDdayBadge, isTargetCount: dday !== null && dday <= 90, 
      auditStatusColor, auditStatusLabel, auditStatusDate, auditStatusText,
      isChecked, hasUserIncomingRequest, hasAdminOutboundRequest, commStatusLabel, commStatusDate, commStatusText, commStatusColor 
    };
  };
     
  const getDescendantNames = (selectedName: string, surveillanceOrgs: any[]) => {
    if (
      !selectedName ||
      selectedName === DEPT_FILTER_ALL ||
      (topOrgName && selectedName === topOrgName)
    ) {
      return surveillanceOrgs.map((o) => o.unit_name);
    }
    const selectedOrg = surveillanceOrgs.find(o => o.unit_name === selectedName);
    if (!selectedOrg) return [selectedName]; 
    const results = new Set<string>();
    results.add(selectedOrg.unit_name);
    const getChildren = (parentId: string) => {
      surveillanceOrgs.filter(o => o.parent_id === parentId).forEach(c => {
        if (!results.has(c.unit_name)) { results.add(c.unit_name); getChildren(c.id); }
      });
    };
    getChildren(selectedOrg.id);
    return Array.from(results);
  };

  /** 조직 필터에 속한 사용자(하위 조직 포함) — 사용자 드롭다운 (id 기준, 동명이인 유지) */
  const filterUserOptions = useMemo(() => {
    if (colFilters.dept === DEPT_FILTER_ALL) return [];
    const allowed = new Set(getDescendantNames(colFilters.dept, orgs).map((n) => String(n || '').trim()));
    const seen = new Set<string>();
    return users
      .filter((u) => {
        const id = String(u.id || '').trim();
        const name = String(u.name || '').trim();
        const unitName = String(u.unit?.unit_name || u.dept || '').trim();
        if (!id || !name || !allowed.has(unitName) || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  }, [users, colFilters.dept, orgs, topOrgName]);
     
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    let hwCount = 0, swCount = 0, furnitureCount = 0, feedbackIncomingCount = 0, adminOutboundCount = 0;
    let d30Count = 0, dDayCount = 0, dPlusCount = 0;
    let duplicateCount = 0;
    let auditDoneCount = 0, auditPendingCount = 0, auditNudgeCount = 0, infoCorrectionCount = 0;

    /** 실사 카드 집계: 포커스된 진행 실사의 대상범위만 (칩 클릭과 연동) */
    const auditScopeAssets = focusedAudit
      ? assets.filter((a) => assetInAuditTarget(a.dept, focusedAudit.target))
      : assets;
    
    assets.forEach(a => {
      counts[a.it_type] = (counts[a.it_type] || 0) + 1;
      if (a.category === 'HW') hwCount++; 
      else if (a.category === 'SW') swCount++;
      else if (a.category === '비품') furnitureCount++;
      
      const logic = getAssetLogic(a);
      if (logic.hasUserIncomingRequest) feedbackIncomingCount++;
      if (logic.hasAdminOutboundRequest) adminOutboundCount++;
      
      if (logic.dday !== null) {
        if (logic.dday > 0 && logic.dday <= 30) d30Count++;
        else if (logic.dday === 0) dDayCount++;
        else if (logic.dday < 0) dPlusCount++;
      }
     
      const isCodeDup = a.code && duplicateCodes.has(a.code);
      const isModelDup = duplicateModels.has(String(a.model).trim()) && String(a.model).trim() !== '';
      const isSnDup = duplicateSns.has(String(a.sn || '').trim()) && String(a.sn || '').trim() !== '';
      if (isCodeDup || isModelDup || isSnDup) duplicateCount++;
    });

    auditScopeAssets.forEach((a) => {
      // 실사 진행 중에만 완료/미실사/독촉 집계 (대기 중엔 전사 잔여로 부풀지 않음)
      if (!focusedAudit) return;
      if (a.last_audit_date && String(a.last_audit_date) >= String(focusedAudit.startDate || '')) {
        auditDoneCount++;
      } else if (hasInfoCorrectionPending(a)) {
        infoCorrectionCount++;
      } else if (a.audit_request_date) {
        auditNudgeCount++;
      } else {
        auditPendingCount++;
      }
    });

    // 정보수정 승인은 실사 기간 밖에서도 처리 가능 → 대기 중에도 전체에서 집계
    if (!focusedAudit) {
      assets.forEach((a) => {
        if (hasInfoCorrectionPending(a)) infoCorrectionCount++;
      });
    }

    const replaceableCount = assets.filter(a => getAssetLogic(a).isTargetCount).length;
    return {
      counts, replaceableCount, hwCount, swCount, furnitureCount, feedbackIncomingCount, adminOutboundCount, total: assets.length,
      d30Count, dDayCount, dPlusCount, duplicateCount,
      auditDoneCount, auditPendingCount, auditNudgeCount, infoCorrectionCount,
    };
  }, [assets, audits, requests, duplicateCodes, duplicateModels, duplicateSns, isAuditActive, focusedAudit, orgs, focusedAuditId]);
     
  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      const s = searchQuery.toLowerCase().trim();
      const logic = getAssetLogic(a);
      
      const matchSearch = !s || [a.code, a.model, a.sn].some(v => String(v).toLowerCase().includes(s));
      // user_id / user_email 우선, id·email 없는 레거시 행은 이름 폴백
      const matchUser = (() => {
        if (!userFilter) return true;
        const selected = users.find((u) => String(u.id) === userFilter);
        if (selected) return assetMatchesIdentity(a, toItIdentity(selected));
        return (
          String(a.user_id || '').trim() === userFilter ||
          String(a.user || '').trim() === userFilter
        );
      })();
      
      const allowedDepts = getDescendantNames(colFilters.dept, orgs);
      const matchDept = colFilters.dept === DEPT_FILTER_ALL ? true : allowedDepts.includes(a.dept);
      const matchCategory = colFilters.category === '범주 (전체)' ? true : a.category === colFilters.category;
      const matchItType = colFilters.it_type === '자산 분류 (전체)' ? true : a.it_type === colFilters.it_type;
      const matchRental = colFilters.is_rental === '조달유형 (전체)' ? true : a.is_rental === colFilters.is_rental;
      
      let matchStatus = true;
      const inFocusedAuditScope =
        !focusedAudit || assetInAuditTarget(a.dept, focusedAudit.target);
      if (showStatusFilter === 'done') {
        matchStatus = focusedAudit
          ? inFocusedAuditScope &&
            !!a.last_audit_date &&
            String(a.last_audit_date) >= String(focusedAudit.startDate || '')
          : logic.isChecked;
      } else if (showStatusFilter === 'pending') {
        if (focusedAudit) {
          matchStatus =
            inFocusedAuditScope &&
            !(a.last_audit_date && String(a.last_audit_date) >= String(focusedAudit.startDate || '')) &&
            !hasInfoCorrectionPending(a) &&
            !a.audit_request_date;
        } else {
          matchStatus =
            !logic.isChecked &&
            !hasInfoCorrectionPending(a) &&
            !(getCoveringAudit(a) && !!a.audit_request_date);
        }
      } else if (showStatusFilter === 'nudge') {
        matchStatus = focusedAudit
          ? inFocusedAuditScope &&
            !(a.last_audit_date && String(a.last_audit_date) >= String(focusedAudit.startDate || '')) &&
            !!a.audit_request_date &&
            !hasInfoCorrectionPending(a)
          : !!getCoveringAudit(a) &&
            !logic.isChecked &&
            !!a.audit_request_date &&
            !hasInfoCorrectionPending(a);
      } else if (showStatusFilter === 'info_correction') {
        matchStatus = inFocusedAuditScope && hasInfoCorrectionPending(a);
      }
     
      const matchIncomingFeedback = !showFeedbackFilter || logic.hasUserIncomingRequest;
      const matchAdminOutbound = !showAdminOutboundFilter || logic.hasAdminOutboundRequest;
      
      let matchDday = true;
      if (ddayFilter !== 'all') {
        if (logic.dday === null) matchDday = false;
        else if (ddayFilter === 'd-30') matchDday = (logic.dday > 0 && logic.dday <= 30);
        else if (ddayFilter === 'd-day') matchDday = (logic.dday === 0);
        else if (ddayFilter === 'd-plus') matchDday = (logic.dday < 0);
      }
     
      const isDup =
        duplicateCodes.has(a.code) ||
        (duplicateModels.has(String(a.model).trim()) && String(a.model).trim() !== '') ||
        (duplicateSns.has(String(a.sn || '').trim()) && String(a.sn || '').trim() !== '');
     
      return matchSearch && matchUser && matchDept && matchCategory && matchItType && matchRental 
             && (!showReplaceableOnly || logic.isTargetCount) 
             && (!showDuplicatesOnly || isDup) 
             && matchStatus && matchIncomingFeedback && matchAdminOutbound && matchDday;
    });
  }, [assets, searchQuery, userFilter, users, colFilters, showReplaceableOnly, showDuplicatesOnly, showStatusFilter, showFeedbackFilter, showAdminOutboundFilter, ddayFilter, audits, orgs, requests, duplicateCodes, duplicateModels, duplicateSns, isAuditActive, focusedAudit, focusedAuditId]);
     
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  /** 현재 페이지(10건)만 — QR 출력용 */
  const toggleSelectPage = () => {
    const pageIds = paginatedAssets.map((a) => a.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setSelectedIds(next);
  };

  /** 필터된 전체 행 — 독촉·엑셀 등 */
  const toggleSelectAllFiltered = () => {
    const allIds = filteredAssets.map((a) => a.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  };

  const allFilteredSelected =
    filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.has(a.id));
  const pageSelected =
    paginatedAssets.length > 0 && paginatedAssets.every((a) => selectedIds.has(a.id));
  
  const handleExcelDownload = () => {
    const targetAssets = selectedIds.size > 0 ? filteredAssets.filter(a => selectedIds.has(a.id)) : filteredAssets;
    if (targetAssets.length === 0) return alert('엑셀 다운로드할 대상을 선택해 주세요.');
    const excelData = targetAssets.map((a, index) => {
      const logic = getAssetLogic(a);
      return {
        'NO': index + 1,
        '부서': a.dept || '-',
        '사용자': a.user || '-',
        '이메일': emailLocalPart(a.user_email) || '-',
        '범주': a.category || '-',
        [itMasterLabel]: a.it_type || '-',
        '자산번호': a.code || '-',
        '모델명': a.model || '-',
        'S/N': a.sn || '-',
        '제조사': a.brand || '-',
        '기본 사양': a.spec || '-',
        '조달유형': a.is_rental || '-',
        '구매비': (a.purchase_price ?? 0) || '-',
        '월렌탈/구독비': (a.monthly_fee ?? 0) || '-',
        '입고일': a.in_date || '-',
        '계약종료': a.end_date || '-',
        '첫회청구': a.first_bill || '-',
        '렌탈/구독(M)': a.rental_months || '-',
        '납입차': logic.turnDisplay || '-',
        '교체주기(M)': a.cycle || '-',
        '교체예정일': logic.repDate || '-',
        '메모': a.memo || '-',
        '실사': logic.auditStatusText || '-',
        '의견/요청': logic.commStatusText || '-',
      };
    });
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ITAssets"); XLSX.writeFile(wb, `IT_Assets_Master.xlsx`);
  };
  
  const openBulkQRPrint = () => {
    const targets = filteredAssets.filter(a => selectedIds.has(a.id));
    if (targets.length === 0) return alert('출력할 자산을 체크박스로 선택해주세요.');
    setBulkPrintAssets(targets);
  };

  // 일괄 인쇄: QR을 미리 생성해 빈칸 인쇄 방지 (대량 자산 대응)
  useEffect(() => {
    if (bulkPrintAssets.length === 0) {
      setBulkQrMap({});
      setBulkQrReady(false);
      return;
    }
    let cancelled = false;
    setBulkQrReady(false);
    generateItAssetQrDataUrls(
      bulkPrintAssets.map((a) => String(a.code || '')).filter(Boolean),
      150
    )
      .then((map) => {
        if (!cancelled) {
          setBulkQrMap(map);
          setBulkQrReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setBulkQrReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bulkPrintAssets]);
  
  const selectedAssetsForNudge = useMemo(
    () => assets.filter((a) => selectedIds.has(a.id)),
    [assets, selectedIds]
  );
  /** 이번 실사 기간에 이미 실사 완료/관리자 확인된 건 — 독촉 대상에서 제외 */
  const isAuditDoneForNudge = (a: any) => {
    const covering = getCoveringAudit(a) || focusedAudit;
    if (!covering?.startDate) return false;
    return !!(a.last_audit_date && String(a.last_audit_date) >= String(covering.startDate));
  };
  const selectedNudgeCompletedCount = useMemo(
    () => selectedAssetsForNudge.filter((a) => isAuditDoneForNudge(a)).length,
    [selectedAssetsForNudge, focusedAudit, audits, orgs, focusedAuditId]
  );
  const selectedNudgeEligible = useMemo(
    () => selectedAssetsForNudge.filter((a) => !isAuditDoneForNudge(a)),
    [selectedAssetsForNudge, focusedAudit, audits, orgs, focusedAuditId]
  );
  const selectedNudgedCount = useMemo(
    () => selectedNudgeEligible.filter((a) => !!a.audit_request_date).length,
    [selectedNudgeEligible]
  );
  const selectedUnnudgedCount = selectedNudgeEligible.length - selectedNudgedCount;
  const nudgeExcludeNote =
    selectedNudgeCompletedCount > 0 ? ` · (완료 ${selectedNudgeCompletedCount}건 제외)` : '';
  const nudgeButtonMode: 'disabled' | 'send' | 'recall' | 'mixed' | 'all_done' =
    !isAuditActive || selectedAssetsForNudge.length === 0
      ? 'disabled'
      : selectedNudgeEligible.length === 0
        ? 'all_done'
        : selectedNudgedCount === 0
          ? 'send'
          : selectedUnnudgedCount === 0
            ? 'recall'
            : 'mixed';
  const nudgeButtonLabel =
    !isAuditActive
      ? '🔔 실사 진행 중에만 독촉 가능'
      : selectedAssetsForNudge.length === 0
        ? '🔔 선택 후 독촉 전송/회수'
        : nudgeButtonMode === 'all_done'
          ? `🔔 독촉 대상 없음 (완료 ${selectedNudgeCompletedCount}건 제외)`
          : nudgeButtonMode === 'send'
            ? `🔔 선택 마감임박 독촉 전송${nudgeExcludeNote}`
            : nudgeButtonMode === 'recall'
              ? `🔔 선택 독촉 회수${nudgeExcludeNote}`
              : `🔔 독촉 전송 ${selectedUnnudgedCount} · 회수 ${selectedNudgedCount}${nudgeExcludeNote}`;

  const sendAuditRequest = async () => {
    if (!canEdit) return alertNoEditPermission();
    if (!isAuditActive) {
      return alert('실사가 진행 중일 때만 독촉을 전송하거나 회수할 수 있습니다.');
    }
    if (selectedIds.size === 0) {
      return alert('독촉을 전송/회수할 자산을 체크박스로 먼저 선택해 주세요.');
    }

    const eligible = selectedAssetsForNudge.filter((a) => !isAuditDoneForNudge(a));
    const skippedDone = selectedAssetsForNudge.length - eligible.length;
    const toNudge = eligible.filter((a) => !a.audit_request_date);
    const toRecall = eligible.filter((a) => !!a.audit_request_date);
    const today = getKSTDateString();

    if (toNudge.length === 0 && toRecall.length === 0) {
      return alert(
        skippedDone > 0
          ? `선택한 자산은 모두 실사 완료/관리자 확인 상태입니다.\n(완료 ${skippedDone}건 제외 — 독촉 대상 없음)`
          : '독촉 전송/회수할 대상이 없습니다.'
      );
    }

    const parts: string[] = [];
    if (toNudge.length > 0) {
      parts.push(`독촉 전송 ${toNudge.length}건`);
    }
    if (toRecall.length > 0) {
      parts.push(`독촉 회수 ${toRecall.length}건`);
    }
    if (skippedDone > 0) {
      parts.push(`(완료 ${skippedDone}건 제외 — 실사 완료/관리자 확인 유지)`);
    }
    if (!confirm(`선택한 장비에 대해 아래 작업을 진행할까요?\n\n${parts.join('\n')}`)) return;

    try {
      const promises = [
        ...toNudge.map(async (targetAsset) => {
          const res = await fetch(`/api/asset/it`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: targetAsset.id,
              audit_request_date: today,
              last_audit_date: null,
              last_audit_by: null,
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(`[자산: ${targetAsset.code}] 독촉 전송 실패: ${errData.message || '오류'}`);
          }
        }),
        ...toRecall.map(async (targetAsset) => {
          const res = await fetch(`/api/asset/it`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: targetAsset.id,
              audit_request_date: null,
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(`[자산: ${targetAsset.code}] 독촉 회수 실패: ${errData.message || '오류'}`);
          }
        }),
      ];

      await Promise.all(promises);

      const doneMsg = [
        toNudge.length > 0 ? `전송 ${toNudge.length}건` : null,
        toRecall.length > 0 ? `회수 ${toRecall.length}건` : null,
        skippedDone > 0 ? `(완료 ${skippedDone}건 제외)` : null,
      ].filter(Boolean).join(' · ');
      alert(`✅ 독촉 처리 완료: ${doneMsg}`);
      setSelectedIds(new Set());
      fetchAllDataFromServer();
    } catch (e: any) {
      console.error("독촉 처리 실패 상세:", e);
      alert(`❌ 독촉 처리 실패:\n${e.message || "서버 통신 오류가 발생했습니다."}`);
    }
  };

  /** 선택 자산의 실사 확인(사용자·관리자)만 초기화 → 미실사/독촉 상태로 복귀 */
  const resetSelectedAuditConfirm = async () => {
    if (!canEdit) return alertNoEditPermission();
    if (selectedIds.size === 0) {
      return alert('실사 확인을 초기화할 자산을 체크박스로 먼저 선택해 주세요.');
    }
    const targets = selectedAssetsForNudge.filter((a) => !!a.last_audit_date);
    if (targets.length === 0) {
      return alert('선택한 자산 중 실사 확인(실사 완료/관리자 확인)된 항목이 없습니다.');
    }
    if (!confirm(`선택한 자산 ${targets.length}건의 실사 확인을 초기화할까요?\n\n· 실사 완료 / 관리자 확인 → 해제\n· 독촉(마감임박) 상태는 유지됩니다`)) return;

    try {
      await Promise.all(
        targets.map(async (targetAsset) => {
          const res = await fetch('/api/asset/it', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: targetAsset.id,
              last_audit_date: null,
              last_audit_by: null,
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(`[자산: ${targetAsset.code}] 초기화 실패: ${errData.message || '오류'}`);
          }
        })
      );
      alert(`✅ 실사 확인 초기화 완료: ${targets.length}건`);
      setSelectedIds(new Set());
      fetchAllDataFromServer();
    } catch (e: any) {
      console.error('실사 확인 초기화 실패:', e);
      alert(`❌ 실사 확인 초기화 실패:\n${e.message || '서버 통신 오류가 발생했습니다.'}`);
    }
  };

  const openInfoCorrectionReview = (asset: any) => {
    if (!hasInfoCorrectionPending(asset)) return;
    setInfoApproveDraft({
      model: getDisplayFieldValue(asset, 'model').value,
      sn: getDisplayFieldValue(asset, 'sn').value,
      brand: getDisplayFieldValue(asset, 'brand').value,
      spec: getDisplayFieldValue(asset, 'spec').value,
    });
    setInfoCorrectionModal(asset);
  };

  /** 관리자 강제 실사 확인 / 취소 — 실사 진행 중 + 대상범위 자산만 (정보수정 승인은 예외) */
  const handleAdminAuditForce = async (asset: any, logic: { isChecked: boolean }) => {
    if (!canEdit) return alertNoEditPermission();
    if (hasInfoCorrectionPending(asset)) {
      openInfoCorrectionReview(asset);
      return;
    }
    if (!isAuditActive) {
      return alert('실사 진행 중에만 관리자 확인·취소가 가능합니다.');
    }
    if (!getCoveringAudit(asset)) {
      return alert('현재 진행 중인 실사 대상 범위가 아닌 자산입니다.');
    }

    if (logic.isChecked) {
      if (!confirm(`[${asset.code}] 실사 확인을 취소하고 미실사로 되돌릴까요?`)) return;
      try {
        const res = await fetch('/api/asset/it', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: asset.id,
            last_audit_date: null,
            last_audit_by: null,
          }),
        });
        if (!res.ok) throw new Error('취소 실패');
        fetchAllDataFromServer();
      } catch {
        alert('실사 확인 취소에 실패했습니다.');
      }
      return;
    }

    if (!confirm(`[${asset.code}] 사용자가 미확인인 자산입니다.\n관리자 확인으로 강제 처리할까요?`)) return;
    const today = getKSTDateString();
    try {
      const res = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: asset.id,
          last_audit_date: today,
          last_audit_by: 'admin',
          audit_request_date: null,
        }),
      });
      if (!res.ok) throw new Error('처리 실패');
      alert(`✅ [${asset.code}] 관리자 확인으로 처리되었습니다.`);
      fetchAllDataFromServer();
    } catch {
      alert('관리자 확인 처리에 실패했습니다.');
    }
  };

  const approveInfoCorrection = async () => {
    if (!canEdit) return alertNoEditPermission();
    if (!infoCorrectionModal) return;
    const today = getKSTDateString();
    try {
      const res = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: infoCorrectionModal.id,
          model: infoApproveDraft.model.trim(),
          sn: infoApproveDraft.sn.trim(),
          brand: infoApproveDraft.brand.trim(),
          spec: infoApproveDraft.spec.trim(),
          info_correction_pending: null,
          audit_request_date: '',
          // 승인 시 개인 실사 완료와 동일하게 처리
          last_audit_date: today,
          last_audit_by: 'user',
        }),
      });
      if (res.ok) {
        alert('정보수정을 승인하여 원본에 반영하고 실사 완료 처리했습니다.');
        setInfoCorrectionModal(null);
        fetchAllDataFromServer();
      } else {
        alert('승인 처리에 실패했습니다.');
      }
    } catch {
      alert('서버 통신 오류가 발생했습니다.');
    }
  };

  const rejectInfoCorrection = async () => {
    if (!canEdit) return alertNoEditPermission();
    if (!infoCorrectionModal) return;
    if (!confirm('사용자 정보수정 요청을 거절하고 제안값을 폐기할까요? (원본은 유지됩니다)')) return;
    try {
      const res = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: infoCorrectionModal.id,
          info_correction_pending: null,
        }),
      });
      if (res.ok) {
        alert('정보수정 요청을 거절했습니다.');
        setInfoCorrectionModal(null);
        fetchAllDataFromServer();
      } else {
        alert('거절 처리에 실패했습니다.');
      }
    } catch {
      alert('서버 통신 오류가 발생했습니다.');
    }
  };

  const syncOwnerDeptFromUnits = async () => {
    if (!canEdit) return alertNoEditPermission();
    if (
      !confirm(
        '담당자(User)의 현재 소속(admin/units)으로\n활성 자산의 「부서」를 재동기화할까요?\n\n· user_id / user_email이 있는 자산만 대상\n· 공용·담당자 없음·소속 없음은 건너뜀\n· 의도적으로 다른 부서로 둔 자산도 덮어씌워질 수 있습니다.'
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/asset/it/sync-owner-dept', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return alert(`❌ 동기화 실패\n${data.message || data.error || `HTTP ${res.status}`}`);
      }
      const sk = data.skipped || {};
      const sampleLines = Array.isArray(data.samples)
        ? data.samples
            .slice(0, 8)
            .map((s: any) => `· ${s.code}: ${s.from} → ${s.to}`)
            .join('\n')
        : '';
      alert(
        `✅ ${data.message || '완료'}\n\n갱신 ${data.updated ?? 0}건` +
          `\n동일(스킵) ${sk.alreadySame ?? 0}` +
          `\n담당자없음 ${sk.noOwner ?? 0}` +
          `\n소속없음 ${sk.noUnit ?? 0}` +
          `\n공용/미지정 ${sk.sharedOrEmpty ?? 0}` +
          (sampleLines ? `\n\n변경 예시:\n${sampleLines}` : '')
      );
      await fetchAllDataFromServer();
    } catch {
      alert('서버 통신 오류로 동기화에 실패했습니다.');
    }
  };

  const openAdminCompose = (asset: any) => {
    if (!canEdit) return alertNoEditPermission();
    setEditingReq(null);
    setAdminComposeAsset(asset);
    setEditOpinion('');
  };

  const closeAdminCompose = () => {
    setAdminComposeAsset(null);
    setEditOpinion('');
  };

  const submitAdminOpinionRequest = async () => {
    if (!adminComposeAsset) return;
    if (!editOpinion.trim()) return alert('사용자에게 전달할 의견 내용을 입력해 주세요.');

    try {
      const userRes = await fetch('/api/auth/me').catch(() => null);
      const userData = userRes && userRes.ok ? await userRes.json() : null;
      const responder = userData?.name || '-';
      const responderDept = userData?.unit?.unit_name || '';

      const res = await fetch('/api/asset/it/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestDate: getKSTDateString(),
          // 개인 송수신 대장은 email/id 우선 매칭 — 자산 담당자 identity로 기록
          requester: adminComposeAsset.user || '-',
          requester_email: adminComposeAsset.user_email || null,
          requester_id: adminComposeAsset.user_id || null,
          dept: adminComposeAsset.dept || '-',
          assetInfo: `${adminComposeAsset.code} / ${adminComposeAsset.model || '-'}`,
          content: '',
          status: '관리자 의견발송',
          assetCode: adminComposeAsset.code,
          assetType: adminComposeAsset.it_type,
          adminOpinion: editOpinion.trim(),
          responderName: responder,
          responderDept,
        }),
      });

      if (res.ok) {
        alert('✅ 사용자에게 관리자 요청이 전송되었습니다.');
        closeAdminCompose();
        fetchAllDataFromServer();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`❌ 전송 실패: ${errData.error || '서버 오류'}`);
      }
    } catch {
      alert('❌ 서버 통신 오류가 발생했습니다.');
    }
  };

  const submitPendingRequestAction = async (mode: 'reply' | 'close') => {
    if (!editingReq) return;
    if (mode === 'reply' && !editOpinion.trim()) {
      return alert('답변 내용을 입력해 주세요.');
    }
    try {
      const userRes = await fetch('/api/auth/me').catch(() => null);
      const userData = userRes && userRes.ok ? await userRes.json() : null;
      const responder = userData?.name || '-';
      const responderDept = userData?.unit?.unit_name || '';
      const thread = collectThreadMessages(editingReq, requests);
      const latest = thread[thread.length - 1] || editingReq;

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
          fetchAllDataFromServer();
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
        fetchAllDataFromServer();
      } else {
        alert('❌ 처리 완료(종료)에 실패했습니다.');
      }
    } catch {
      alert('❌ 통신 오류');
    }
  };

  const handleCancelAdminSend = async (id: string) => {
    if (!confirm('전송한 의견을 취소하시겠습니까? (취소 후 복구할 수 없습니다)')) return;
    try {
      const target = requests.find((r) => String(r.id) === String(id));
      const res = await fetch(`/api/asset/it/requests?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (target && (target.status === '관리자 답변' || target.status === '관리자 의견발송')) {
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
        fetchAllDataFromServer();
      } else {
        alert('❌ 취소에 실패했습니다.');
      }
    } catch {
      alert('❌ 통신 오류가 발생했습니다.');
    }
  };

  const handleUpdateAdminOutbound = async () => {
    if (!editingReq) return;
    if (!editOpinion.trim()) return alert('내용을 입력해 주세요.');
    try {
      const userRes = await fetch('/api/auth/me').catch(() => null);
      const userData = userRes && userRes.ok ? await userRes.json() : null;
      const responder = userData?.name || '-';
      const responderDept = userData?.unit?.unit_name || '';
      const thread = collectThreadMessages(editingReq, requests);
      const latest = thread[thread.length - 1] || editingReq;
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
        fetchAllDataFromServer();
      } else {
        alert('❌ 내용 저장에 실패했습니다.');
      }
    } catch {
      alert('❌ 통신 오류가 발생했습니다.');
    }
  };
     
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      <ItMasterPageBanner
        label="IT ASSET MASTER CONTROL TOWER"
        title={moduleTitle || '전사 IT·업무자산 마스터 통제실'}
        description={moduleDescription || '전사 IT·업무자산의 보유 현황과 교체·실사·요청을 통합 모니터링하고 관리합니다.'}
        menuPath={MENU_PATH}
        canEdit={canEdit}
      />

      {/* 요약 위젯 3열 — personal 규격 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {/* 카드 1: 전사 보유자산 (+ 통합 관제) */}
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[168px]">
          <div className="flex items-start justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">전사 보유자산</p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">범주별 요약 · 클릭 시 실시간 솔트</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-black text-slate-900 tracking-tighter leading-none tabular-nums">{stats.total}</p>
              <p className="text-[9px] font-bold text-slate-400 mt-1">총 보유</p>
            </div>
          </div>
          <div className="flex-1 min-h-0 mt-3 flex flex-wrap content-start gap-1.5">
            <button
              type="button"
              onClick={() => setColFilters({ ...colFilters, category: colFilters.category === 'HW' ? '범주 (전체)' : 'HW' })}
              className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-black transition-all ${
                colFilters.category === 'HW'
                  ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              H/W <span className={colFilters.category === 'HW' ? 'text-blue-100' : 'text-blue-600'}>{stats.hwCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setColFilters({ ...colFilters, category: colFilters.category === 'SW' ? '범주 (전체)' : 'SW' })}
              className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-black transition-all ${
                colFilters.category === 'SW'
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              S/W <span className={colFilters.category === 'SW' ? 'text-indigo-100' : 'text-indigo-600'}>{stats.swCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setColFilters({ ...colFilters, category: colFilters.category === '비품' ? '범주 (전체)' : '비품' })}
              className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-black transition-all ${
                colFilters.category === '비품'
                  ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              비품 <span className={colFilters.category === '비품' ? 'text-amber-100' : 'text-amber-600'}>{stats.furnitureCount}</span>
            </button>
          </div>
          <div className="pt-3 mt-auto border-t border-slate-100 grid grid-cols-4 gap-1.5">
            <button type="button" onClick={() => setDdayFilter(p => p === 'd-30' ? 'all' : 'd-30')} className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${ddayFilter === 'd-30' ? 'bg-blue-500 border-blue-400 text-white shadow-sm' : 'bg-white border-slate-200 text-blue-600 hover:bg-blue-50'}`}>
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D-30)</span>
              <span className="text-sm font-black tabular-nums">{stats.d30Count}</span>
            </button>
            <button type="button" onClick={() => setDdayFilter(p => p === 'd-day' ? 'all' : 'd-day')} className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${ddayFilter === 'd-day' ? 'bg-amber-500 border-amber-400 text-amber-900 shadow-sm' : 'bg-white border-slate-200 text-amber-600 hover:bg-amber-50'}`}>
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D-Day)</span>
              <span className="text-sm font-black tabular-nums">{stats.dDayCount}</span>
            </button>
            <button type="button" onClick={() => setDdayFilter(p => p === 'd-plus' ? 'all' : 'd-plus')} className={`w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${ddayFilter === 'd-plus' ? 'bg-rose-500 border-rose-400 text-white shadow-sm' : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'}`}>
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">교체(D+)</span>
              <span className="text-sm font-black tabular-nums">{stats.dPlusCount}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDuplicatesOnly((p) => !p);
                // 행 「중복」으로 걸린 검색어가 남아 있으면 카드 토글이 안 풀린 것처럼 보이므로 함께 해제
                setSearchQuery('');
              }}
              title="자산번호 · 모델명 · S/N 값이 동일한 자산이 2건 이상일 때 중복으로 집계합니다. 다시 누르면 해제됩니다."
              className={`relative group/dup w-full py-2 px-1 rounded-xl border flex flex-col items-center transition-all ${showDuplicatesOnly ? 'bg-red-600 border-red-500 text-white shadow-sm' : 'bg-white border-slate-200 text-red-600 hover:bg-red-50'}`}
            >
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">데이터 중복 점검</span>
              <span className="text-sm font-black tabular-nums">{stats.duplicateCount}</span>
              <span className="pointer-events-none absolute left-1/2 bottom-full z-40 mb-1.5 -translate-x-1/2 w-max max-w-[220px] rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover/dup:opacity-100 text-left leading-relaxed">
                자산번호 · 모델명 · S/N<br />동일 값 2건 이상은 중복으로 표시합니다.
                <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
              </span>
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
            {runningAudits.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end max-w-[58%]">
                {runningAudits.map((a) => {
                  const selected = focusedAudit?.id === a.id;
                  const label = formatAuditTargetLabel(a.target);
                  const endTime = (a.endTime || '23:59').trim() || '23:59';
                  return (
                    <button
                      key={a.id}
                      type="button"
                      title={`${a.title || '실사'}\n${a.startDate} ~ ${a.endDate} ${endTime}\n클릭: 해당 소속 자산 필터`}
                      onClick={() => handleAuditBadgeClick(a)}
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
                  🟢 실사 진행 중{runningAudits.length > 1 ? ` · ${runningAudits.length}건` : ''}
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
              <span className="text-[8px] font-black mb-0.5 leading-tight text-center">마감 임박 독촉 장비</span>
              <span className="text-sm font-black tabular-nums">{isAuditActive ? stats.auditNudgeCount : 0}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowStatusFilter((prev) => (prev === 'info_correction' ? 'all' : 'info_correction'))}
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
              onClick={() => {
                setShowFeedbackFilter(false);
                setShowAdminOutboundFilter((prev) => !prev);
              }}
              className={`w-full px-3 py-2.5 rounded-xl text-[11px] font-bold border transition-all flex items-center justify-between ${
                showAdminOutboundFilter
                  ? 'bg-rose-600 border-rose-600 text-white shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50 hover:border-rose-200'
              }`}
            >
              <span className="text-left leading-snug">관리자 전송 내역<br /><span className="text-[10px] font-bold opacity-90">(관리자 → 사용자)</span></span>
              <span className={`text-sm font-black tabular-nums shrink-0 ml-2 ${showAdminOutboundFilter ? 'text-white' : 'text-rose-600'}`}>
                {stats.adminOutboundCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAdminOutboundFilter(false);
                setShowFeedbackFilter((prev) => !prev);
              }}
              className={`w-full px-3 py-2.5 rounded-xl text-[11px] font-bold border transition-all flex items-center justify-between ${
                showFeedbackFilter
                  ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50 hover:border-amber-200'
              }`}
            >
              <span className="text-left leading-snug">관리자 수신 내역<br /><span className="text-[10px] font-bold opacity-90">(사용자 → 관리자)</span></span>
              <span className={`text-sm font-black tabular-nums shrink-0 ml-2 ${showFeedbackFilter ? 'text-white' : 'text-amber-600'}`}>
                {stats.feedbackIncomingCount}
              </span>
            </button>
          </div>
        </div>
      </div>
  
      {/* 전사 IT·업무자산 목록 */}
      <div className={`bg-white border border-slate-200 rounded-[2.5rem] shadow-sm animate-in fade-in slide-in-from-top-4 duration-300 ${orgMenuOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <h2 className="text-sm font-black text-slate-800 tracking-tight">전사 IT·업무자산 목록</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredAssets.length}건</span>
            {showStatusFilter === 'done' && (
              <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">실사 완료만</span>
            )}
            {showStatusFilter === 'pending' && (
              <span className="text-[10px] font-black text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">미실사만</span>
            )}
            {showStatusFilter === 'nudge' && (
              <span className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">독촉만</span>
            )}
            {showStatusFilter === 'info_correction' && (
              <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">정보수정 승인대기만</span>
            )}
            {showAdminOutboundFilter && (
              <span className="text-[10px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">관리자 요청만</span>
            )}
            {showFeedbackFilter && (
              <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">의견수신만</span>
            )}
            {ddayFilter !== 'all' && (
              <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                {ddayFilter === 'd-30' ? '교체(D-30)' : ddayFilter === 'd-day' ? '교체(D-Day)' : '교체(D+)'}만
              </span>
            )}
            {showDuplicatesOnly && (
              <button
                type="button"
                onClick={() => {
                  setShowDuplicatesOnly(false);
                  setSearchQuery('');
                }}
                title="클릭 시 중복 필터 해제"
                className="text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md hover:bg-red-100"
              >
                중복만 ×
              </button>
            )}
            {!!searchQuery.trim() && !showDuplicatesOnly && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="클릭 시 검색 해제"
                className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md hover:bg-indigo-100"
              >
                검색: {searchQuery.trim()} ×
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-nowrap justify-end">
            <button
              type="button"
              onClick={handleExcelDownload}
              className="px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-black rounded-lg hover:bg-emerald-600 hover:text-white transition-all shadow-sm whitespace-nowrap"
            >
              {selectedIds.size > 0
                ? `⬇️ 선택 엑셀(${selectedIds.size})`
                : '⬇️ 엑셀 다운로드'}
            </button>
            <div className="relative group/excel-upload">
              <button
                type="button"
                disabled={!canEdit}
                title={!canEdit ? '편집 권한 필요' : undefined}
                onClick={() => { if (!canEdit) return; fileInputRef.current?.click(); }}
                className={`px-3 py-2 rounded-lg text-[11px] font-black transition-all flex items-center gap-1.5 border whitespace-nowrap ${
                  canEdit
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-600 hover:text-white shadow-sm'
                    : DISABLED_ACTION_BTN
                }`}
              >
                + 엑셀 업로드 추가
              </button>
              {canEdit && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-full mt-2 z-50 hidden group-hover/excel-upload:block w-[320px] rounded-xl bg-slate-900 px-3.5 py-3 text-left shadow-xl"
                >
                  <p className="text-[11px] font-black text-emerald-300 mb-2">엑셀 업로드 안내</p>
                  <ul className="space-y-1.5 text-[10px] font-bold text-white/95 leading-relaxed list-disc pl-3.5">
                    <li>엑셀 다운 후 해당 양식의 ~메모까지 데이터를 작성하세요.</li>
                    <li>사용자 옆 이메일은 @ 앞자리만 넣어도 됩니다. (전체 주소도 가능)</li>
                    <li>NO는 작성과 상관없이 자동으로 재정렬됩니다.</li>
                    <li>정보가 없는 것은 공란 또는 - 처리 바랍니다.</li>
                    <li>자산번호가 중복되면 업로드가 불가능합니다.</li>
                    <li>자산번호가 공란이면 가상의 자산번호가 부여됩니다.</li>
                  </ul>
                </div>
              )}
            </div>
            <input type="file" ref={fileInputRef} onChange={handleExcelUpload} accept=".xlsx, .xls" className="hidden" />
            <button
              type="button"
              disabled={!canEdit}
              title={!canEdit ? '편집 권한 필요' : undefined}
              onClick={handleAdd}
              className={`px-4 py-2 rounded-lg text-[11px] font-black transition-all flex items-center gap-1.5 border whitespace-nowrap ${
                canEdit
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm border-blue-600'
                  : DISABLED_ACTION_BTN
              }`}
            >
              + 신규 자산 추가
            </button>
          </div>
        </div>

        <div className={`px-5 py-3 border-b border-slate-200 flex flex-nowrap items-center gap-2 bg-white relative ${orgMenuOpen ? 'z-[80] overflow-visible' : 'overflow-x-auto'}`}>
            <div className={`flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-sm shrink-0 ${orgMenuOpen ? 'relative z-[90]' : ''}`}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">조직</span>
              <div className="relative" ref={orgMenuRef}>
                <button
                  type="button"
                  onClick={() => setOrgMenuOpen((open) => !open)}
                  className={`max-w-[160px] truncate text-left text-[11px] leading-none p-0 m-0 outline-none cursor-pointer bg-transparent ${
                    selectedOrgUnit && isBoldOrgType(selectedOrgUnit.unit_type)
                      ? 'font-black text-slate-900'
                      : 'font-bold text-slate-800'
                  }`}
                >
                  {selectedOrgUnit ? selectedOrgUnit.unit_name : '전체'}
                </button>
                {orgMenuOpen && (
                  <div className="absolute left-0 top-full mt-1.5 z-[100] min-w-[240px] max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setColFilters({ ...colFilters, dept: DEPT_FILTER_ALL });
                        setUserFilter('');
                        setOrgMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] font-bold ${
                        colFilters.dept === DEPT_FILTER_ALL
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      전체
                    </button>
                    {sortedOrgs.map((o) => {
                      const bold = isBoldOrgType(o.unit_type);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => {
                            setColFilters({ ...colFilters, dept: o.unit_name });
                            setUserFilter('');
                            setOrgMenuOpen(false);
                          }}
                          className={`w-full text-left pr-3 py-1.5 text-[11px] ${
                            bold ? 'font-black text-slate-900' : 'font-medium text-slate-600'
                          } ${colFilters.dept === o.unit_name ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          style={{ paddingLeft: `${12 + o.depth * 12}px` }}
                        >
                          {o.unit_name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">사용자</span>
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                disabled={colFilters.dept === DEPT_FILTER_ALL}
                className={`bg-transparent text-[11px] font-black text-slate-800 outline-none cursor-pointer max-w-[110px] ${
                  colFilters.dept === DEPT_FILTER_ALL ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <option value="">
                  {colFilters.dept === DEPT_FILTER_ALL ? '조직 먼저 선택' : '전체'}
                </option>
                {filterUserOptions.map((u) => (
                  <option key={u.id} value={u.id} title={u.email || u.name}>
                    {formatUserOptionLabel(u)}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative group/filter flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-sm shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase">범주</span>
              <select className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[90px]" value={colFilters.category} onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}>
                <option value="범주 (전체)">전체</option>
                {masterFilters.categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">{itMasterLabel}</span>
              <select className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent max-w-[110px]" value={colFilters.it_type} onChange={(e) => setColFilters({ ...colFilters, it_type: e.target.value })}>
                <option value="자산 분류 (전체)">전체</option>
                {masterFilters.types.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
              <div className="w-px h-3.5 bg-slate-300 mx-0.5" />
              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">조달유형</span>
              <select className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent" value={colFilters.is_rental} onChange={(e) => setColFilters({ ...colFilters, is_rental: e.target.value })}>
                <option value="조달유형 (전체)">전체</option>
                {masterFilters.rentals.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="relative w-[160px] shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input type="text" placeholder="자산번호 · 모델 · S/N" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm" />
            </div>

            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              <button
                type="button"
                onClick={syncOwnerDeptFromUnits}
                disabled={!canEdit}
                title={
                  !canEdit
                    ? '편집 권한 필요'
                    : '담당자 User의 현재 소속(admin/units)으로 자산 부서를 맞춥니다.'
                }
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all shadow-sm border whitespace-nowrap ${
                  !canEdit
                    ? DISABLED_ACTION_BTN
                    : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-600 hover:text-white'
                }`}
              >
                🔄 담당자 소속→부서 동기화
              </button>
              <button
                type="button"
                onClick={sendAuditRequest}
                disabled={!canEdit || nudgeButtonMode === 'disabled'}
                title={
                  !canEdit
                    ? '편집 권한 필요'
                    : !isAuditActive
                      ? '실사 진행 중에만 독촉 전송/회수가 가능합니다.'
                      : undefined
                }
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all shadow-sm border whitespace-nowrap ${
                  !canEdit || nudgeButtonMode === 'disabled'
                    ? DISABLED_ACTION_BTN
                    : nudgeButtonMode === 'recall'
                      ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-600 hover:text-white'
                      : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-500 hover:text-white'
                }`}
              >
                {nudgeButtonLabel}
              </button>
              <button
                type="button"
                onClick={resetSelectedAuditConfirm}
                disabled={!canEdit || selectedIds.size === 0}
                title={
                  !canEdit
                    ? '편집 권한 필요'
                    : selectedIds.size === 0
                      ? '자산을 선택한 뒤 실사 확인을 초기화할 수 있습니다.'
                      : '선택 자산의 실사 완료/관리자 확인을 해제합니다.'
                }
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all shadow-sm border whitespace-nowrap ${
                  !canEdit || selectedIds.size === 0
                    ? DISABLED_ACTION_BTN
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                ↩️ 선택 실사 확인 초기화
              </button>
              <button type="button" onClick={openBulkQRPrint} className="px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-[10px] font-black hover:bg-purple-600 hover:text-white transition-all shadow-sm whitespace-nowrap">🖨️ QR 라벨 인쇄</button>
            </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-50">
          <table className="w-full text-left border-collapse min-w-[2320px] table-fixed">
            <colgroup>
              <col className="w-[36px]" /><col className="w-[40px]" />
              <col className="w-[88px]" /><col className="w-[72px]" /><col className="w-[72px]" />
              <col className="w-[52px]" /><col className="w-[112px]" />
              <col className="w-[120px]" /><col className="w-[132px]" /><col className="w-[108px]" /><col className="w-[80px]" /><col className="w-[156px]" />
              <col className="w-[60px]" /><col className="w-[92px]" /><col className="w-[118px]" />
              <col className="w-[96px]" /><col className="w-[96px]" /><col className="w-[96px]" /><col className="w-[88px]" /><col className="w-[68px]" /><col className="w-[60px]" /><col className="w-[108px]" /><col className="w-[108px]" />
              <col className="w-[120px]" /><col className="w-[120px]" /><col className="w-[56px]" /><col className="w-[148px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[11px] font-black tracking-wide border-b border-slate-200">
              <tr className="text-center text-[10px] tracking-wider">
                <th
                  colSpan={7}
                  className="h-9 sticky left-0 z-40 bg-slate-50 border-r-2 border-slate-200 text-slate-500"
                  style={{ minWidth: 472, maxWidth: 472, width: 472 }}
                >
                  <div className="relative flex items-center justify-center px-2">
                    {currentPage === 1 && (
                      <label
                        className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 cursor-pointer"
                        title={`필터된 전체 ${filteredAssets.length}건 선택/해제`}
                      >
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAllFiltered}
                          className="accent-indigo-600 cursor-pointer w-3.5 h-3.5"
                        />
                        <span className="text-[8px] font-black text-indigo-600 whitespace-nowrap">전체</span>
                      </label>
                    )}
                    <span>기본 자산 정보</span>
                  </div>
                </th>
                <th colSpan={5} className="h-9 bg-slate-50 border-r border-slate-200 text-slate-500/40" />
                <th colSpan={3} className="h-9 bg-emerald-50/50 border-r border-slate-200 text-emerald-700">조달·비용</th>
                <th colSpan={8} className="h-9 bg-blue-50/50 border-r border-slate-200 text-blue-700">일정·생애주기</th>
                <th colSpan={4} className="h-9 bg-slate-100 text-slate-600">제어·상태</th>
              </tr>
              <tr>
                <th className="h-11 sticky left-0 bg-slate-100 z-30 text-center">
                  <input
                    type="checkbox"
                    title="현재 페이지(최대 10건)만 선택 — QR용"
                    checked={pageSelected}
                    onChange={toggleSelectPage}
                    className="accent-slate-800 cursor-pointer w-3.5 h-3.5"
                  />
                </th>
                <th className="h-11 sticky left-[36px] bg-slate-100 z-30 text-center text-slate-700 uppercase tracking-widest text-[10px]">NO</th>
                <th className="h-11 sticky left-[76px] bg-slate-100 z-30 text-center text-slate-700 uppercase tracking-widest text-[10px] px-0.5 whitespace-nowrap">부서</th>
                <th className="h-11 sticky left-[164px] bg-slate-100 z-30 text-center text-slate-700 uppercase tracking-widest text-[10px] px-0.5 whitespace-nowrap">사용자</th>
                <th className="h-11 sticky left-[236px] bg-slate-100 z-30 text-center text-slate-700 uppercase tracking-widest text-[10px] px-0.5 whitespace-nowrap">이메일</th>
                <th className="h-11 sticky left-[308px] bg-slate-100 z-30 text-center text-slate-700 uppercase tracking-widest text-[10px] whitespace-nowrap">범주</th>
                <th className="h-11 sticky left-[360px] bg-indigo-50 z-30 border-r-2 border-slate-200 text-center text-indigo-600 uppercase tracking-widest text-[10px] px-0.5 whitespace-nowrap">{itMasterLabel}</th>
                <th className="h-11 px-1.5">자산번호</th>
                <th className="h-11 px-1.5">모델명</th>
                <th className="h-11 px-1.5">S/N</th>
                <th className="h-11 px-1.5">제조사</th>
                <th className="h-11 px-1.5 text-slate-500 border-r border-slate-200">기본 사양</th>
                <th className="h-11 text-center bg-emerald-50/50 px-0.5 whitespace-nowrap">조달유형</th>
                <th className="h-11 text-right text-emerald-600 bg-emerald-50/50 pr-1.5 whitespace-nowrap">구매비(원)</th>
                <th className="h-11 text-right text-emerald-700 bg-emerald-50/50 pr-1.5 whitespace-nowrap border-r border-slate-200">월렌탈/구독비(원)</th>
                <th className="h-11 text-center text-black bg-blue-50/50 px-0.5">입고일</th>
                <th className="h-11 text-center text-black bg-blue-50/50 px-0.5">계약종료</th>
                <th className="h-11 text-center text-black bg-blue-50/50 px-0.5">첫회청구</th>
                <th className="h-11 text-center text-black bg-blue-50/50 px-0.5 whitespace-nowrap">렌탈/구독(M)</th>
                <th className="h-11 text-center text-black bg-blue-50/50 px-0.5 relative group cursor-help">
                  <span>납입차</span>
                  <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    첫회청구 · 렌탈/구독(M) 연동 자동산정
                    <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
                  </span>
                </th>
                <th className="h-11 text-center text-black bg-blue-50/50 px-0.5 whitespace-nowrap">교체주기(M)</th>
                <th className="h-11 text-center text-black bg-blue-50/50 px-0.5 relative group cursor-help">
                  <span>교체예정일</span>
                  <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    입고일 · 교체주기(M) 연동 자동산정
                    <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
                  </span>
                </th>
                <th className="h-11 px-1.5 text-black border-r border-slate-200 bg-blue-50/50">메모</th>
                <th className="h-11 text-center border-l border-slate-200 px-0.5">실사/정보수정</th>
                <th className="h-11 text-center text-rose-600 px-0.5">의견/요청</th>
                <th className="h-11 text-center text-purple-700 pl-0.5 pr-2">QR</th>
                <th className="h-11 text-center border-l border-slate-200 whitespace-nowrap pl-3 pr-2">관리 액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-800 bg-white">
              {paginatedAssets.map((a, idx) => {
                const isEditing = editingId === a.id;
                const logic = getAssetLogic(a);
                const entryHighlight = getTodayEntryHighlight(a);
                // 조달유형 라벨과 무관하게 비용·일정 칸은 모두 편집 가능 (미해당 값은 0 또는 '-')
                const monthlyFeeValue = Number(a.monthly_fee) || 0;
                
                const baseBg = isEditing
                  ? 'bg-blue-50'
                  : entryHighlight === 'excel'
                    ? 'bg-emerald-50'
                    : entryHighlight === 'manual'
                      ? 'bg-blue-100'
                      : 'bg-white';
                const hoverBg = isEditing
                  ? 'bg-blue-50'
                  : entryHighlight === 'excel'
                    ? 'hover:bg-emerald-100/80'
                    : entryHighlight === 'manual'
                      ? 'hover:bg-blue-50'
                      : 'hover:bg-slate-50';
                const inputClass = "w-full px-1.5 py-1 bg-white border border-blue-400 rounded text-blue-700 font-bold outline-none shadow-sm text-[11px]";
  
                return (
                  <tr key={a.id} className={`transition-colors h-12 ${baseBg} ${hoverBg}`}>
                    <td className={`px-0.5 sticky left-0 z-20 ${baseBg} text-center`}><input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} className="accent-slate-800 cursor-pointer w-3 h-3" /></td>
                    <td className={`px-0.5 sticky left-[36px] z-20 ${baseBg} text-center text-slate-500 font-mono tabular-nums`}>{(currentPage-1)*itemsPerPage + idx + 1}</td>
                    <td className={`px-0.5 sticky left-[76px] z-20 ${baseBg} text-center truncate`} title={a.dept || '-'}>
                      {isEditing ? (
                        <select
                          value={sortedOrgs.some((o) => o.unit_name === a.dept) ? a.dept : ''}
                          onChange={(e) => handleFieldChange(a.id, 'dept', e.target.value)}
                          className={inputClass}
                        >
                          <option value="">부서 선택</option>
                          {sortedOrgs.map((o) => (
                            <option key={o.id} value={o.unit_name}>{o.unit_name}</option>
                          ))}
                          {!!a.dept &&
                            a.dept !== '-' &&
                            !sortedOrgs.some((o) => o.unit_name === a.dept) && (
                            <option value={a.dept}>{a.dept} (목록 외)</option>
                          )}
                        </select>
                      ) : (
                        <span className="text-slate-900">{a.dept || '-'}</span>
                      )}
                    </td>
                    <td className={`px-0.5 sticky left-[164px] z-20 ${baseBg} text-center truncate`} title={a.user || '-'}>
                      {isEditing ? (
                        <select
                          value={resolveSelectedUserId(a, a.dept)}
                          onChange={(e) => handleUserSelect(a.id, e.target.value)}
                          disabled={!a.dept || a.dept === '-'}
                          className={`${inputClass} ${!a.dept || a.dept === '-' ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <option value="">
                            {!a.dept || a.dept === '-' ? '부서 먼저 선택' : '사용자 선택'}
                          </option>
                          {usersOfDept(a.dept).map((u) => (
                            <option key={u.id} value={u.id} title={u.email || u.name}>
                              {formatUserOptionLabel(u)}
                            </option>
                          ))}
                          {!!a.user &&
                            a.user !== '-' &&
                            a.user !== '공용' &&
                            !resolveSelectedUserId(a, a.dept) && (
                            <option value="">
                              {formatUserOptionLabel({ name: a.user, email: a.user_email })} (목록 외)
                            </option>
                          )}
                        </select>
                      ) : (
                        <span className="text-slate-900">
                          {!a.user || a.user === '공용' ? '-' : a.user}
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-0.5 sticky left-[236px] z-20 ${baseBg} text-center truncate text-slate-600`}
                      title={a.user_email || '-'}
                    >
                      {emailLocalPart(a.user_email) || '-'}
                    </td>
                    <td className={`px-0.5 sticky left-[308px] z-20 ${baseBg} text-center text-slate-700 truncate`} title={a.category}>{isEditing ? <select value={a.category} onChange={e => handleFieldChange(a.id, 'category', e.target.value)} className={inputClass}>{masterFilters.categories.map(c=><option key={c} value={c}>{c}</option>)}</select> : a.category}</td>
                    <td className={`px-0.5 sticky left-[360px] z-20 ${baseBg} border-r-2 border-slate-200 text-center text-indigo-700 font-black truncate`} title={a.it_type}>{isEditing ? <select value={a.it_type} onChange={e => handleFieldChange(a.id, 'it_type', e.target.value)} className={inputClass}>{masterFilters.types.map(c=><option key={c} value={c}>{c}</option>)}</select> : a.it_type}</td>
                    
                    <td className="px-1 font-mono font-black text-slate-900 truncate">
                      {isEditing ? <input type="text" value={a.code} onChange={e => handleFieldChange(a.id, 'code', e.target.value)} className={inputClass} /> : 
                      <div className="flex items-center gap-0.5 min-w-0">
                        {(() => {
                          const d = getDisplayFieldValue(a, 'code');
                          return <span className={`truncate ${d.isPending ? 'text-red-600' : ''}`} title={d.value}>{d.value}</span>;
                        })()}
                        {duplicateCodes.has(a.code) && (
                           <button
                             type="button"
                             onClick={() => toggleDuplicateSearch(a.code)}
                             title={searchQuery.trim() === String(a.code || '').trim() ? '다시 클릭하면 필터 해제' : '클릭 시 동일 자산번호만 표시'}
                             className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${
                               searchQuery.trim() === String(a.code || '').trim()
                                 ? 'text-white bg-rose-600 border-rose-600'
                                 : 'text-rose-600 bg-rose-50 border-rose-200 animate-pulse'
                             }`}
                           >
                             중복
                           </button>
                        )}
                      </div>}
                    </td>
                    
                    <td className="px-1 truncate">
                      {isEditing ? <input type="text" value={a.model} onChange={e => handleFieldChange(a.id, 'model', e.target.value)} className={inputClass} /> : 
                      <div className="flex items-center gap-0.5 min-w-0 w-full">
                        {(() => {
                          const d = getDisplayFieldValue(a, 'model');
                          return <span className={`truncate ${d.isPending ? 'text-red-600' : ''}`} title={d.value}>{d.value}</span>;
                        })()}
                        {duplicateModels.has(String(a.model).trim()) && String(a.model).trim() !== '' && (
                           <button
                             type="button"
                             onClick={() => toggleDuplicateSearch(a.model)}
                             title={searchQuery.trim() === String(a.model || '').trim() ? '다시 클릭하면 필터 해제' : '클릭 시 동일 모델명만 표시'}
                             className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${
                               searchQuery.trim() === String(a.model || '').trim()
                                 ? 'text-white bg-rose-600 border-rose-600'
                                 : 'text-rose-600 bg-rose-50 border-rose-200 animate-pulse'
                             }`}
                           >
                             중복
                           </button>
                        )}
                      </div>}
                    </td>
                    
                    <td className="px-1 font-mono text-slate-500 truncate">
                      {isEditing ? (
                        <input type="text" value={a.sn} onChange={e => handleFieldChange(a.id, 'sn', e.target.value)} className={inputClass} />
                      ) : (
                        <div className="flex items-center gap-0.5 min-w-0">
                          {(() => {
                            const d = getDisplayFieldValue(a, 'sn');
                            return <span className={`truncate ${d.isPending ? 'text-red-600 font-black' : ''}`} title={d.value}>{d.value || '-'}</span>;
                          })()}
                          {duplicateSns.has(String(a.sn || '').trim()) && String(a.sn || '').trim() !== '' && (
                            <button
                              type="button"
                              onClick={() => toggleDuplicateSearch(String(a.sn || '').trim())}
                              title={searchQuery.trim() === String(a.sn || '').trim() ? '다시 클릭하면 필터 해제' : '클릭 시 동일 S/N만 표시'}
                              className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${
                                searchQuery.trim() === String(a.sn || '').trim()
                                  ? 'text-white bg-rose-600 border-rose-600'
                                  : 'text-rose-600 bg-rose-50 border-rose-200 animate-pulse'
                              }`}
                            >
                              중복
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-1 truncate" title={getDisplayFieldValue(a, 'brand').value}>{isEditing ? <input type="text" value={a.brand} onChange={e => handleFieldChange(a.id, 'brand', e.target.value)} className={inputClass} /> : (() => {
                      const d = getDisplayFieldValue(a, 'brand');
                      return <span className={d.isPending ? 'text-red-600 font-black' : ''}>{d.value || '-'}</span>;
                    })()}</td>
                    <td className="px-1 text-slate-500 truncate border-r border-slate-100" title={a.spec || ''}>{isEditing ? <input type="text" value={a.spec} onChange={e => handleFieldChange(a.id, 'spec', e.target.value)} className={inputClass} /> : (() => {
                      const d = getDisplayFieldValue(a, 'spec');
                      return <span className={d.isPending ? 'text-red-600 font-black' : ''}>{d.value || '-'}</span>;
                    })()}</td>
                    
                    <td className="px-0.5 text-center bg-emerald-50/10 truncate">{isEditing ? <select value={a.is_rental} onChange={e => handleFieldChange(a.id, 'is_rental', e.target.value)} className={inputClass}>{masterFilters.rentals.map(r=><option key={r} value={r}>{r}</option>)}</select> : a.is_rental}</td>
                    <td className="px-0.5 text-right text-emerald-600 bg-emerald-50/10 tabular-nums">
                      {isEditing ? (
                        <input
                          type="number"
                          min={0}
                          value={!a.purchase_price ? '' : a.purchase_price}
                          onChange={e => handleFieldChange(a.id, 'purchase_price', e.target.value === '' ? 0 : parseInt(e.target.value))}
                          className={inputClass}
                          placeholder="-"
                        />
                      ) : (a.purchase_price ? formatNumber(a.purchase_price) : '-')}
                    </td>
                    <td className="px-0.5 text-right text-emerald-700 bg-emerald-50/10 tabular-nums border-r border-slate-100">
                      {isEditing ? (
                        <input
                          type="number"
                          min={0}
                          value={!monthlyFeeValue ? '' : monthlyFeeValue}
                          onChange={e => handleFieldChange(a.id, 'monthly_fee', e.target.value === '' ? 0 : parseInt(e.target.value))}
                          className={inputClass}
                          placeholder="-"
                        />
                      ) : (monthlyFeeValue ? formatNumber(monthlyFeeValue) : '-')}
                    </td>
                    
                    <td className="px-0.5 text-center font-mono text-black bg-blue-50/10 truncate">{isEditing ? <input type="date" value={a.in_date || ''} onChange={e => handleFieldChange(a.id, 'in_date', e.target.value)} className={inputClass} /> : (a.in_date || '-')}</td>
                    <td className="px-0.5 text-center font-mono text-black bg-blue-50/10 truncate">
                      {isEditing ? (
                        <input
                          type="date"
                          value={a.end_date || ''}
                          onChange={e => handleFieldChange(a.id, 'end_date', e.target.value)}
                          className={inputClass}
                        />
                      ) : (a.end_date || '-')}
                    </td>
                    <td className="px-0.5 text-center font-mono text-black bg-blue-50/10 truncate">
                      {isEditing ? (
                        <input
                          type="date"
                          value={a.first_bill || ''}
                          onChange={e => handleFieldChange(a.id, 'first_bill', e.target.value)}
                          className={inputClass}
                        />
                      ) : (a.first_bill || '-')}
                    </td>
                    <td className="px-0.5 text-center text-black bg-blue-50/10 tabular-nums">
                      {isEditing ? (
                        <input
                          type="number"
                          min={0}
                          value={a.rental_months === 0 || a.rental_months == null ? '' : a.rental_months}
                          onChange={e => handleFieldChange(a.id, 'rental_months', e.target.value === '' ? 0 : parseInt(e.target.value))}
                          className={inputClass}
                          placeholder="-"
                        />
                      ) : (a.rental_months || '-')}
                    </td>
                    <td className="px-0.5 text-center font-bold text-black bg-blue-50/10 truncate">{logic.turnDisplay || '-'}</td>
                    <td className="px-0.5 text-center text-black bg-blue-50/10 tabular-nums">{isEditing ? <input type="number" value={a.cycle === 0 ? '' : a.cycle} onChange={e => handleFieldChange(a.id, 'cycle', e.target.value === '' ? 0 : parseInt(e.target.value))} className={inputClass} placeholder="-" /> : (a.cycle || '-')}</td>
                    
                    <td className="px-0.5 text-center bg-blue-50/10">
                      <div className="flex flex-col items-center justify-center gap-0.5 min-w-0">
                        <span className="font-mono text-black truncate w-full text-center">{logic.repDate}</span>
                        {logic.showDdayBadge && (
                          <span className={`px-1 py-0.5 rounded text-[9px] font-black animate-pulse ${logic.ddayColor}`}>
                            {logic.ddayText}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1 text-black truncate bg-blue-50/10 border-r border-slate-100" title={a.memo || ''}>{isEditing ? <input type="text" value={a.memo} onChange={e => handleFieldChange(a.id, 'memo', e.target.value)} className={inputClass} /> : (a.memo || '-')}</td>
                    
                    <td className="px-0.5 text-center border-l border-slate-100">
                      {isEditing ? (
                        <input 
                          type="date" 
                          value={a.last_audit_date || ''} 
                          onChange={e => handleFieldChange(a.id, 'last_audit_date', e.target.value)} 
                          className="w-full px-1 py-0.5 bg-white border border-blue-400 rounded text-blue-700 font-bold outline-none text-[10px]" 
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={
                            !canEdit ||
                            !(
                              hasInfoCorrectionPending(a) ||
                              (isAuditActive && !!getCoveringAudit(a))
                            )
                          }
                          onClick={() => handleAdminAuditForce(a, logic)}
                          title={
                            !canEdit
                              ? '편집 권한 필요'
                              : hasInfoCorrectionPending(a)
                                ? logic.auditStatusText
                                : !isAuditActive
                                  ? '실사 진행 중에만 관리자 확인 가능'
                                  : !getCoveringAudit(a)
                                    ? '현재 실사 대상 범위 아님'
                                    : logic.auditStatusText
                          }
                          className={`w-full h-[2.25rem] px-0.5 rounded text-[10px] font-black tracking-tight transition-all border leading-tight flex flex-col items-center justify-center ${
                            canEdit &&
                            (hasInfoCorrectionPending(a) || (isAuditActive && !!getCoveringAudit(a)))
                              ? `shadow-sm ${logic.auditStatusColor}`
                              : DISABLED_ACTION_BTN
                          }`}
                        >
                          <span className="truncate max-w-full">{logic.auditStatusLabel}</span>
                          {logic.auditStatusDate && (
                            <span className="text-[9px] font-bold tabular-nums mt-0.5 opacity-90">({logic.auditStatusDate})</span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-0.5 text-center">
                      <button 
                        type="button"
                        disabled={!canEdit}
                        onClick={() => {
                          if (!canEdit) return;
                          const assetReqs = requests
                            .filter((r) => String(r.assetCode || '').trim() === String(a.code || '').trim())
                            .sort((r1, r2) => new Date(r2.createdAt || r2.requestDate || 0).getTime() - new Date(r1.createdAt || r1.requestDate || 0).getTime());
                          const targetReq = assetReqs[0];
                          if (!targetReq) {
                            openAdminCompose(a);
                            return;
                          }
                          setAdminComposeAsset(null);
                          setCommEditMode(false);
                          setEditingReq(targetReq);
                          setEditOpinion(
                            isWaitingForUser(targetReq.status)
                              ? opinionDisplay(targetReq.adminOpinion)
                              : ''
                          );
                        }}
                        className={`w-full h-[2.25rem] px-1 rounded text-[10px] font-black tracking-tight transition-all border leading-tight flex flex-col items-center justify-center ${
                          canEdit ? `shadow-sm cursor-pointer ${logic.commStatusColor}` : DISABLED_ACTION_BTN
                        }`}
                        title={!canEdit ? '편집 권한 필요' : logic.commStatusText}
                      >
                        <span className="truncate max-w-full">{logic.commStatusLabel}</span>
                        {logic.commStatusDate && (
                          <span className="text-[9px] font-bold tabular-nums mt-0.5 opacity-90">({logic.commStatusDate})</span>
                        )}
                      </button>
                    </td>
                    <td className="pl-0.5 pr-2 text-center">
                      <button type="button" onClick={() => setShowQrModal(a)} className="w-full h-[2.25rem] px-0.5 bg-purple-50 text-purple-600 border border-purple-200 rounded text-[10px] font-black hover:bg-purple-600 hover:text-white transition-all shadow-sm flex items-center justify-center">QR</button>
                    </td>
                    <td className="pl-3 pr-2 text-center border-l border-slate-200">
                      {isEditing ? (
                        <div className="inline-flex items-center justify-center gap-1 flex-nowrap">
                          <button type="button" onClick={() => handleSaveEdit(a.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] font-black hover:bg-blue-700 transition-all shadow-sm whitespace-nowrap">저장</button>
                          <button type="button" onClick={() => handleCancelEdit(a.id)} className="px-2 py-1 bg-white border border-slate-300 text-slate-600 rounded text-[10px] font-black hover:bg-slate-100 transition-all whitespace-nowrap">취소</button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-center gap-1 flex-nowrap">
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : '수정'}
                            onClick={() => startEdit(a)}
                            className={`px-2 py-1 rounded text-[10px] font-black transition-all whitespace-nowrap border ${
                              canEdit
                                ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : '종료'}
                            onClick={() => { if (!canEdit) return; setTerminateModal({ id: a.id, reason: '', actionType: null }); }}
                            className={`px-2 py-1 rounded text-[10px] font-black transition-all whitespace-nowrap border ${
                              canEdit
                                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            종료
                          </button>
                          <button
                            type="button"
                            disabled={!canEdit}
                            title={!canEdit ? '편집 권한 필요' : '삭제'}
                            onClick={() => handleSingleDelete(a.id)}
                            className={`px-2 py-1 rounded text-[10px] font-black transition-all whitespace-nowrap border ${
                              canEdit
                                ? 'bg-white border-red-200 text-red-600 hover:bg-red-50'
                                : DISABLED_ACTION_BTN
                            }`}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {filteredAssets.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button type="button" key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </div>
  
      {/* 🚀 모달 1: 자산 종료 관리 모달 */}
      {terminateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] border border-slate-200 shadow-2xl p-8 rounded-[2rem] font-bold animate-in zoom-in-95 duration-150">
            <h4 className="text-sm font-black uppercase border-b-2 border-slate-900 pb-3 mb-5 text-slate-900 tracking-wide">💼 자산 마이그레이션 종료 처리</h4>
            
            <div className="mb-5">
              <label className="text-[11px] font-black text-slate-500 mb-2 block">조치 유형 설정</label>
              <div className="flex gap-2">
                {(['반납', '폐기', '재판매'] as const).map((type) => (
                  <button 
                    key={type} type="button"
                    onClick={() => setTerminateModal({
                      ...terminateModal,
                      actionType: type,
                      reseller: type === '폐기' ? '' : (terminateModal.reseller || ''),
                      resellPrice: type === '재판매' ? (terminateModal.resellPrice || 0) : 0,
                    })}
                    className={`flex-1 py-3 rounded-xl border font-black text-[11px] transition-all ${
                      terminateModal.actionType === type 
                        ? (type === '폐기' ? 'bg-rose-600 text-white border-rose-600 shadow-md' : type === '재판매' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md' : 'bg-amber-500 text-white border-amber-500 shadow-md')
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {type === '반납' ? '📦 계약반납' : type === '폐기' ? '🗑️ 불용폐기' : '💰 기기재판매'}
                  </button>
                ))}
              </div>
            </div>
  
            <div className="mb-5">
               <label className="text-[11px] font-black text-slate-500 mb-2 block">종료 및 조치 사유 기술</label>
               <textarea 
                 value={terminateModal.reason} 
                 onChange={e => setTerminateModal({...terminateModal, reason: e.target.value})} 
                 placeholder="감사 증빙용 사유를 상세히 기록하세요." 
                 className="w-full h-24 bg-slate-50 border border-slate-200 p-3 text-[11px] font-bold rounded-xl outline-none resize-none focus:bg-white focus:border-slate-400 shadow-inner" 
               />
            </div>
  
            {terminateModal.actionType === '반납' && (
              <div className="mb-5 p-4 bg-amber-50/60 border border-amber-200 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <div>
                  <label className="text-[10px] font-black text-amber-800 mb-1 block">반납처 (반납 기관·벤더명)</label>
                  <input
                    type="text"
                    value={terminateModal.reseller || ''}
                    onChange={(e) => setTerminateModal({ ...terminateModal, reseller: e.target.value })}
                    placeholder="예: 렌탈사명, 계약 반납처"
                    className="w-full bg-white border border-amber-200 p-2.5 text-[11px] rounded-xl outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            )}

            {terminateModal.actionType === '재판매' && (
              <div className="mb-5 p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <div>
                  <label className="text-[10px] font-black text-emerald-800 mb-1 block">지정 매입처 (재판매처 기관명)</label>
                  <input type="text" value={terminateModal.reseller || ''} onChange={e => setTerminateModal({...terminateModal, reseller: e.target.value})} className="w-full bg-white border border-emerald-200 p-2.5 text-[11px] rounded-xl outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-emerald-800 mb-1 block">최종 매각 확정 금액 / 비용 (원)</label>
                  <input type="number" value={terminateModal.resellPrice || ''} onChange={e => setTerminateModal({...terminateModal, resellPrice: parseInt(e.target.value) || 0})} className="w-full bg-white border border-emerald-200 p-2.5 text-[11px] rounded-xl outline-none focus:border-emerald-500 font-mono" />
                </div>
              </div>
            )}
  
            <div className="flex gap-2 border-t border-slate-100 pt-5">
              <button onClick={() => setTerminateModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-[11px] font-bold">취소</button>
              <button onClick={() => confirmTerminate(terminateModal!.id)} className="flex-[2] py-3.5 bg-slate-900 text-white rounded-xl shadow-md hover:bg-black text-[11px] font-black tracking-wider">✓ 안전하게 아카이브 대장으로 이관</button>
            </div>
          </div>
        </div>
      )}
  
      {/* 🚀 모달 2: 진보된 단일 QR 코드 모달 (실제 인쇄 라벨과 동일한 미리보기) */}
      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4" onClick={() => setShowQrModal(null)}>
          <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center mb-4">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">IT·업무자산 QR 라벨</h3>
              <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-[10px] font-black">실제 출력 미리보기</span>
            </div>

            {/* 실제 인쇄되는 40mm 정사각 라벨과 동일한 형태 (화면용 확대) */}
            <div
              className="flex flex-col justify-between bg-white border-2 border-dashed border-slate-300 rounded-lg text-center mb-4"
              style={{ width: '260px', height: '260px', padding: '14px 12px 12px 12px', boxSizing: 'border-box' }}
            >
              <div className="w-full space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">자산 분류</p>
                <p className="text-[13px] font-black text-slate-900 truncate tracking-tight">
                  {showQrModal.it_type || showQrModal.category || '-'}
                </p>
              </div>
              <div className="w-full flex justify-center items-center my-1">
                <ItAssetQrImage
                  assetCode={showQrModal.code}
                  size={150}
                  alt="IT·업무자산 QR"
                  className="w-[130px] h-[130px] object-contain"
                />
              </div>
              <div className="w-full">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">자산번호</p>
                <p className="text-[14px] font-black font-mono tracking-tighter text-indigo-700 leading-none">
                  {showQrModal.code}
                </p>
                <p className="text-[10px] font-bold text-slate-400 truncate mt-1">
                  {showQrModal.dept || '-'} · <span className="text-amber-700 font-black">사내 Wi-Fi 스캔</span>
                </p>
              </div>
            </div>

            <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-center">
              <p className="text-[11px] font-black text-amber-800">📡 QR 스캔 안내</p>
              <p className="text-[10px] font-bold text-amber-700 mt-0.5 leading-relaxed">
                스캔 시 <span className="underline decoration-2">등록 정보(분류·번호·모델·S/N·제조사·사양)</span>를 확인합니다.
                <br />
                <span className="font-black">⚠ 반드시 사내 Wi-Fi 연결 후 스캔하세요.</span>
                <br />
                (외부망·LTE에서는 조회되지 않습니다)
              </p>
            </div>

            <div className="flex gap-2 w-full">
              <button type="button" onClick={() => setShowQrModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}
  
      {/* 🖨️ 모달 3: 한국폼텍 28칸 QR 인쇄 모달 */}
      {bulkPrintAssets.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/90 z-[600] flex flex-col p-8 overflow-y-auto print:p-0 print:bg-white" onClick={() => setBulkPrintAssets([])}>
          <div className="max-w-5xl w-full mx-auto bg-white rounded-[2rem] p-8 shadow-2xl print:shadow-none print:rounded-none print:p-0" onClick={e => e.stopPropagation()}>
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-4 print:hidden">
              <div>
                <h2 className="text-xl font-black text-slate-800">🖨️ 한국폼텍 28칸 정사각 QR 라벨 발행 센터</h2>
                <p className="text-slate-500 text-xs font-bold mt-1">드림디포 구매 규격 [QR-3990] 적용 (40mm × 40mm 정사각형) | 총 {bulkPrintAssets.length}개의 라벨</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!bulkQrReady}
                  onClick={() => window.print()}
                  className={`px-6 py-2 font-black rounded-xl shadow-md flex items-center gap-2 text-xs transition-colors ${
                    bulkQrReady
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <span>🖨️</span> {bulkQrReady ? '라벨 인쇄 실행 (Ctrl+P)' : 'QR 생성 중…'}
                </button>
                <button type="button" onClick={() => setBulkPrintAssets([])} className="px-6 py-2 bg-slate-100 text-slate-600 font-black rounded-xl hover:bg-slate-200 text-xs">닫기</button>
              </div>
            </div>
            
            <div className="formtec-page-container bg-white p-0 relative" style={{ width: '210mm', minHeight: '297mm', margin: '0 auto', boxSizing: 'border-box' }}>
              <div className="text-center font-black text-slate-800 text-xs mb-4 print:hidden bg-indigo-50 border border-indigo-100 py-2.5 rounded-xl max-w-[190mm] mx-auto">
                📍 한국폼텍 28칸 기본 (드림디포 QR-3990 전용 4열 × 7행 정사각 매핑 완료) <br/>
                <span className="text-[10px] text-indigo-500 font-medium font-sans mt-0.5 block">※ 화면에 보이는 회색 점선은 인쇄 시 출력되지 않는 안전 가이드 칼선입니다.</span>
              </div>
  
              <div className="max-w-[190mm] mx-auto mb-4 print:hidden bg-blue-50 border-2 border-blue-200 p-4 rounded-2xl text-left">
                <p className="text-center font-black text-slate-800 text-[13px] mb-2">📍 한국폼텍 28칸 정사각 [QR-3990] 전용 출력 가이드</p>
                <div className="grid grid-cols-3 gap-2 text-[10px] font-black text-blue-900 border-t border-blue-200 pt-2 bg-white/60 p-2 rounded-xl">
                  <div className="border-r border-blue-100 pr-2">무조건 <span className="text-red-600 font-bold">"실제 크기 (100%)"</span></div>
                  <div className="border-r border-blue-100 px-2">무조건 <span className="text-red-600 font-bold">"여백 없음 (None)"</span></div>
                  <div className="pl-2"><span className="text-red-600 font-bold">"배경 그래픽"</span> 반드시 체크</div>
                </div>
              </div>
  
              <div 
                className="grid grid-cols-4 print:grid-cols-4" 
                style={{
                  width: '185mm',          
                  margin: '0 auto',
                  paddingTop: '12mm',      
                  paddingLeft: '5mm',      
                  columnGap: '4.5mm',      
                  rowGap: '1.5mm'          
                }}
              >
                {Array.from({ length: Math.max(28, Math.ceil(bulkPrintAssets.length / 4) * 4) }).map((_, idx) => {
                  const a = bulkPrintAssets[idx];
                  if (!a) return <div key={`empty-${idx}`} className="border border-dashed border-slate-200 print:border-none opacity-30 print:opacity-0" style={{ width: '40mm', height: '40mm', boxSizing: 'border-box' }} />;
  
                  return (
                    <div 
                      key={a.id} 
                      className="flex flex-col justify-between bg-white overflow-hidden relative border border-dashed border-slate-200 print:border-none print:break-inside-avoid text-center"
                      style={{ width: '40mm', height: '40mm', padding: '2.5mm 2mm 2mm 2mm', boxSizing: 'border-box' }}
                    >
                      <div className="w-full space-y-0.5">
                        <p className="text-[6px] font-black text-slate-400 uppercase leading-none">자산 분류</p>
                        <p className="text-[8px] font-black text-slate-900 truncate tracking-tight leading-tight">
                          {a.it_type || a.category || '-'}
                        </p>
                      </div>
                      <div className="w-full flex justify-center items-center my-0.5">
                        {bulkQrMap[a.code] ? (
                          <img src={bulkQrMap[a.code]} alt="QR" className="w-[20mm] h-[20mm] object-contain" />
                        ) : (
                          <div className="w-[20mm] h-[20mm] flex items-center justify-center bg-slate-50 text-[6px] font-bold text-slate-400 animate-pulse">
                            생성 중…
                          </div>
                        )}
                      </div>
                      <div className="w-full">
                        <p className="text-[6px] font-black text-slate-400 uppercase leading-none">자산번호</p>
                        <p className="text-[8px] font-black font-mono tracking-tighter text-indigo-700 leading-none truncate">
                          {a.code}
                        </p>
                        <p className="text-[6px] font-bold text-slate-400 truncate mt-0.5 scale-90">
                          <span className="text-amber-700 font-black">사내 Wi-Fi</span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          
          <style jsx global>{`
            @media print {
              body * { visibility: hidden; }
              .formtec-page-container, .formtec-page-container * { visibility: visible; }
              .formtec-page-container { position: absolute; left: 0; top: 0; width: 210mm; height: 297mm; background: white !important; }
              @page { size: A4 portrait; margin: 0; }
            }
          `}</style>
        </div>
      )}
     
 {/* 🚀 관리자 답변 조치 팝업 (대시보드 연동용) */}
      {infoCorrectionModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-[520px] border border-slate-200 shadow-2xl rounded-3xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-rose-600 p-5 flex items-center justify-between">
              <h3 className="font-black text-white text-lg">정보수정 요청 검토</h3>
              <button type="button" onClick={() => setInfoCorrectionModal(null)} className="text-rose-100 hover:text-white font-black">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
                원본은 유지된 상태입니다. 제안값을 확인·수정한 뒤 승인하면 대장에 반영되고 빨간색 표시가 해제됩니다.
              </p>
              <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-3 space-y-2">
                <div className="flex justify-between gap-3 text-[11px] font-bold">
                  <span className="text-slate-400 shrink-0">{itMasterLabel}</span>
                  <span className="text-indigo-700 font-black text-right">{infoCorrectionModal.it_type || '-'}</span>
                </div>
                <div className="flex justify-between gap-3 text-[11px] font-bold">
                  <span className="text-slate-400 shrink-0">자산번호</span>
                  <span className="text-slate-900 font-black text-right font-mono">{infoCorrectionModal.code || '-'}</span>
                </div>
              </div>
              <div className="space-y-3">
                {INFO_CORRECTION_FIELDS.map((key) => {
                  const label = INFO_CORRECTION_FIELD_LABELS[key];
                  const pending = parseInfoCorrectionPending(infoCorrectionModal.info_correction_pending);
                  const isChanged = pending?.changedKeys.includes(key);
                  const original = String(infoCorrectionModal[key] ?? '') || '-';
                  return (
                    <label key={key} className="block">
                      <span className="flex items-center justify-between gap-2 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        <span>{label}</span>
                        {isChanged && <span className="text-rose-600 normal-case">원본: {original}</span>}
                      </span>
                      <input
                        type="text"
                        value={infoApproveDraft[key]}
                        onChange={(e) => setInfoApproveDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        className={`mt-1 w-full px-3 py-2.5 rounded-xl border text-[12px] font-bold outline-none ${
                          isChanged
                            ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-500'
                            : 'border-slate-200 bg-slate-50 text-slate-800'
                        }`}
                      />
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setInfoCorrectionModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black text-xs hover:bg-slate-200">닫기</button>
                <button type="button" onClick={rejectInfoCorrection} className="flex-1 py-3.5 bg-white border border-slate-300 text-slate-600 rounded-xl font-black text-xs hover:bg-slate-50">거절</button>
                <button type="button" onClick={approveInfoCorrection} className="flex-[1.4] py-3.5 bg-emerald-600 text-white rounded-xl font-black text-xs shadow-md hover:bg-emerald-700">승인 반영</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingReq && (() => {
        const threadMsgs = collectThreadMessages(editingReq, requests);
        const latest = threadMsgs[threadMsgs.length - 1] || editingReq;
        const threadClosed = isClosedStatus(latest.status);
        const waitingForUser = !threadClosed && isWaitingForUser(latest.status);
        const canAdminReply = !threadClosed && !waitingForUser;
        const turns = threadMsgs.flatMap(threadTurns);
        const assetModel =
          editingReq.assetInfo
            ? String(editingReq.assetInfo).split('/').slice(1).join('/').trim() || '-'
            : '-';
        const linkedAsset = assets.find((x) => x.code === editingReq.assetCode) || null;

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
                {threadClosed
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
                      {editingReq.assetType || '-'} | {editingReq.assetCode || '-'} / {assetModel}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 text-[11px] font-bold">
                    <span className="text-slate-400 shrink-0">대상 사용자</span>
                    <span className="text-slate-800 text-right">{editingReq.requester || '-'} ({editingReq.dept || '-'})</span>
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
                {waitingForUser && commEditMode && (
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
                {waitingForUser && commEditMode ? (
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
                        onClick={() => handleCancelAdminSend(String(latest.id))}
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
                        onClick={() => submitPendingRequestAction('close')}
                        className="flex-1 py-3.5 bg-white text-slate-600 border border-slate-300 rounded-xl font-black text-[11px] hover:bg-slate-50 transition-colors"
                      >
                        처리 완료(종료)
                      </button>
                    )}
                    {threadClosed && linkedAsset && (
                      <button
                        type="button"
                        onClick={() => openAdminCompose(linkedAsset)}
                        className="flex-[1.4] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                      >
                        신규 요청하기
                      </button>
                    )}
                    {canAdminReply && (
                      <>
                        <button
                          type="button"
                          onClick={() => submitPendingRequestAction('reply')}
                          className="flex-[1.4] py-3.5 bg-slate-900 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-black active:scale-95 transition-all"
                        >
                          사용자에게 답변 전송
                        </button>
                        <button
                          type="button"
                          onClick={() => submitPendingRequestAction('close')}
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

      {adminComposeAsset && (
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
                    {adminComposeAsset.it_type} | {adminComposeAsset.code} / {adminComposeAsset.model || '-'}
                  </span>
                </div>
                <div className="flex justify-between gap-3 text-[11px] font-bold">
                  <span className="text-slate-400 shrink-0">발송일</span>
                  <span className="text-slate-800 tabular-nums">{getKSTDateString()}</span>
                </div>
                <div className="flex justify-between gap-3 text-[11px] font-bold">
                  <span className="text-slate-400 shrink-0">대상 사용자</span>
                  <span className="text-slate-800 text-right">
                    {adminComposeAsset.user || '-'} ({adminComposeAsset.dept || '-'})
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
              <button
                type="button"
                onClick={submitAdminOpinionRequest}
                className="flex-[2] py-3.5 bg-rose-600 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-rose-700 active:scale-95 transition-all"
              >
                사용자에게 의견/요청 전송
              </button>
            </div>
          </div>
        </div>
      )}
     
    </div>
  );
}
  
export default function MasterDashboardModule(props: DashboardProps) {
  return (
    <Suspense fallback={<LoadingState />}>
      <MasterDashboardContent {...props} />
    </Suspense>
  );
}