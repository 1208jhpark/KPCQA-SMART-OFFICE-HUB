'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { getKSTDateString, isPastKSTDeadline } from '@/utils/dateUtils';
import MobileHubAuthCard from '@/components/common/MobileHubAuthCard';
import { mobileAuthHeaders, readMobileAccessToken } from '@/lib/auth-cookie';
import {
  buildInfoCorrectionPending,
  getDisplayFieldValue,
  hasInfoCorrectionPending,
  parseInfoCorrectionPending,
  INFO_CORRECTION_FIELDS,
  INFO_CORRECTION_FIELD_LABELS,
  type InfoCorrectionField,
} from '@/utils/itInfoCorrection';

type ListFilter = 'pending' | 'done' | 'all';

function isDoneInThisAudit(asset: any, auditStartDate: string | undefined) {
  if (!auditStartDate || !asset) return false;
  return (
    !!asset.last_audit_date &&
    asset.last_audit_date >= auditStartDate &&
    !hasInfoCorrectionPending(asset)
  );
}

export default function MobilePublicAuditPage() {
  const params = useParams();
  const id = params?.id as string;
  const [audit, setAudit] = useState<any>(null);
  const [myAssets, setMyAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [isIntroConfirmed, setIsIntroConfirmed] = useState(false);

  const [currentAssetIndex, setCurrentAssetIndex] = useState(0);
  const [listFilter, setListFilter] = useState<ListFilter>('pending');
  const [qrHint, setQrHint] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [manualQrCode, setManualQrCode] = useState('');
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [isActivePeriod, setIsActivePeriod] = useState(true);
  const [infoEditMode, setInfoEditMode] = useState(false);
  const [infoEditDraft, setInfoEditDraft] = useState<Record<InfoCorrectionField, string>>({
    model: '',
    sn: '',
    brand: '',
    spec: '',
  });

  const todayStr = getKSTDateString();
  const myAssetsRef = useRef(myAssets);
  const auditRef = useRef(audit);
  myAssetsRef.current = myAssets;
  auditRef.current = audit;

  const fetchInitialData = async () => {
    try {
      const ts = Date.now();
      const auditRes = await fetch(`/api/asset/it/audit?id=${encodeURIComponent(id)}&t=${ts}`, {
        cache: 'no-store',
      });

      if (auditRes.ok) {
        const audits = await auditRes.json();
        const found = Array.isArray(audits)
          ? audits.find((a: any) => a.id === id) || audits[0]
          : audits;

        if (found) {
          setAudit(found);
          const isStatusActive = found.status === '진행중';
          const notStarted = todayStr < found.startDate;
          const pastEnd = isPastKSTDeadline(found.endDate, found.endTime || '23:59');

          if (!isStatusActive || notStarted || pastEnd) {
            setIsActivePeriod(false);
          }
        }
      }
    } catch (e) {
      console.error('공공 보안 채널 동기화 에러', e);
    } finally {
      setLoading(false);
    }
  };

  const refreshMyAssets = async (userEmail: string) => {
    const ts = Date.now();
    const assetRes = await fetch(
      `/api/asset/it?email=${encodeURIComponent(userEmail)}&auditId=${encodeURIComponent(id)}&t=${ts}`,
      {
        cache: 'no-store',
        credentials: 'include',
        headers: mobileAuthHeaders(),
      }
    );
    if (!assetRes.ok) {
      const err = await assetRes.json().catch(() => ({}));
      throw new Error(err.message || '자산 마스터 정보를 불러오지 못했습니다.');
    }
    const filtered = await assetRes.json();
    setMyAssets(Array.isArray(filtered) ? filtered : []);
    setCurrentAssetIndex(0);
    setListFilter('pending');
  };

  useEffect(() => {
    fetchInitialData();
  }, [id]);

  // 관리자 마감·자동마감 반영: 인증 후 주기적으로 실사 상태 재확인
  useEffect(() => {
    if (!isVerified || !id) return;
    const refreshStatus = async () => {
      try {
        const res = await fetch(`/api/asset/it/audit?id=${encodeURIComponent(id)}&t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const audits = await res.json();
        const found = Array.isArray(audits)
          ? audits.find((a: any) => a.id === id) || audits[0]
          : audits;
        if (!found) return;
        setAudit(found);
        const active =
          found.status === '진행중' &&
          todayStr >= found.startDate &&
          !isPastKSTDeadline(found.endDate, found.endTime || '23:59');
        setIsActivePeriod(active);
      } catch {
        /* ignore */
      }
    };
    const timer = setInterval(refreshStatus, 60_000);
    return () => clearInterval(timer);
  }, [isVerified, id, todayStr]);

  const handleAuthSuccess = async (user: { email: string; name: string }) => {
    try {
      await refreshMyAssets(user.email);
      setEmail(user.email);
      setDisplayName(user.name || user.email);
      setIsVerified(true);
    } catch (err: any) {
      alert(err?.message || '자산 마스터 정보를 불러오지 못했습니다.');
    }
  };

  const pendingAssets = useMemo(
    () => myAssets.filter((a) => !isDoneInThisAudit(a, audit?.startDate)),
    [myAssets, audit?.startDate]
  );
  const doneAssets = useMemo(
    () => myAssets.filter((a) => isDoneInThisAudit(a, audit?.startDate)),
    [myAssets, audit?.startDate]
  );
  const displayAssets = useMemo(() => {
    if (listFilter === 'pending') return pendingAssets;
    if (listFilter === 'done') return doneAssets;
    return [...pendingAssets, ...doneAssets];
  }, [listFilter, pendingAssets, doneAssets]);

  useEffect(() => {
    if (displayAssets.length === 0) {
      setCurrentAssetIndex(0);
      return;
    }
    if (currentAssetIndex > displayAssets.length - 1) {
      setCurrentAssetIndex(displayAssets.length - 1);
    }
  }, [displayAssets, currentAssetIndex]);

  const jumpToAssetById = useCallback(
    (assetId: string, preferFilter?: ListFilter) => {
      const start = auditRef.current?.startDate;
      const asset = myAssetsRef.current.find((a) => a.id === assetId);
      if (!asset) return;
      const done = isDoneInThisAudit(asset, start);
      const nextFilter: ListFilter =
        preferFilter || (done ? 'done' : 'pending');
      setListFilter(nextFilter);
      setInfoEditMode(false);

      const pending = myAssetsRef.current.filter((a) => !isDoneInThisAudit(a, start));
      const doneList = myAssetsRef.current.filter((a) => isDoneInThisAudit(a, start));
      const list =
        nextFilter === 'pending'
          ? pending
          : nextFilter === 'done'
            ? doneList
            : [...pending, ...doneList];
      const idx = list.findIndex((a) => a.id === assetId);
      setCurrentAssetIndex(idx >= 0 ? idx : 0);
    },
    []
  );

  const handleQrDecoded = useCallback(
    async (decodedText: string) => {
      let scannedCode = String(decodedText || '').trim();
      try {
        const url = new URL(decodedText);
        scannedCode = url.searchParams.get('id') || url.searchParams.get('code') || scannedCode;
      } catch {
        /* plain code */
      }
      scannedCode = scannedCode.trim();
      if (!scannedCode) {
        alert('스캔된 자산번호를 읽을 수 없습니다.');
        return;
      }

      // QR에는 자산번호만 있음 → 매번 DB 최신 등록정보 조회
      let latest: any = null;
      try {
        const res = await fetch(
          `/api/asset/it?code=${encodeURIComponent(scannedCode)}&t=${Date.now()}`,
          { cache: 'no-store' }
        );
        if (res.ok) latest = await res.json();
      } catch {
        /* keep local */
      }

      const codeKey = String(latest?.code || scannedCode).trim();
      const mine = myAssetsRef.current.find(
        (a) => String(a.code || '').trim().toLowerCase() === codeKey.toLowerCase()
      );
      if (!mine) {
        alert(
          `❌ 내 실사 대상이 아닙니다.\n스캔: ${codeKey}\n\n본인에게 배정된 자산 라벨만 스캔해 주세요.`
        );
        return;
      }

      if (latest) {
        setMyAssets((prev) =>
          prev.map((a) =>
            a.id === mine.id
              ? {
                  ...a,
                  code: latest.code ?? a.code,
                  it_type: latest.it_type ?? a.it_type,
                  category: latest.category ?? a.category,
                  model: latest.model ?? a.model,
                  sn: latest.sn ?? a.sn,
                  brand: latest.brand ?? a.brand,
                  spec: latest.spec ?? a.spec,
                  dept: latest.dept ?? a.dept,
                  user: latest.user ?? a.user,
                }
              : a
          )
        );
      }

      jumpToAssetById(mine.id);
      setQrHint(
        'QR로 자산을 불러왔습니다. 아래 등록 정보(최신 DB)를 확인한 뒤 실사 확인 완료를 눌러 주세요.'
      );
    },
    [jumpToAssetById]
  );

  const openInfoEdit = (asset: any) => {
    setInfoEditDraft({
      model: getDisplayFieldValue(asset, 'model').value,
      sn: getDisplayFieldValue(asset, 'sn').value,
      brand: getDisplayFieldValue(asset, 'brand').value,
      spec: getDisplayFieldValue(asset, 'spec').value,
    });
    setInfoEditMode(true);
  };

  const submitInfoCorrection = async (asset: any) => {
    if (!asset) return;
    const pending = buildInfoCorrectionPending({
      original: asset,
      draft: infoEditDraft,
      requestedAt: todayStr,
      requestedBy: email,
    });
    if (!pending) {
      alert('변경된 항목이 없습니다. 수정이 필요한 칸만 고쳐 주세요.');
      return;
    }
    try {
      const accessToken = readMobileAccessToken();
      const res = await fetch('/api/asset/it', {
        method: 'PATCH',
        credentials: 'include',
        headers: mobileAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: asset.id,
          info_correction_pending: pending,
          publicAuditEmail: email,
          auditId: id,
          ...(accessToken ? { accessToken } : {}),
        }),
      });
      if (res.ok) {
        const updated = await res.json().catch(() => null);
        setMyAssets((prev) =>
          prev.map((a) =>
            a.id === asset.id
              ? updated || { ...a, info_correction_pending: pending }
              : a
          )
        );
        setInfoEditMode(false);
        alert('정보수정 요청이 접수되었습니다.\n관리자 승인 후 실사 완료로 반영됩니다.');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(
          `정보수정 요청 저장에 실패했습니다.\n${err.message || err.error || `HTTP ${res.status}`}`
        );
      }
    } catch {
      alert('서버 통신 오류가 발생했습니다.');
    }
  };

  const cancelInfoCorrection = async (asset: any) => {
    if (!asset) return;
    if (!confirm('정보수정 요청을 취소하고 실사 대기 상태로 되돌릴까요?')) return;
    try {
      const accessToken = readMobileAccessToken();
      const res = await fetch('/api/asset/it', {
        method: 'PATCH',
        credentials: 'include',
        headers: mobileAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: asset.id,
          info_correction_pending: null,
          publicAuditEmail: email,
          auditId: id,
          ...(accessToken ? { accessToken } : {}),
        }),
      });
      if (res.ok) {
        setMyAssets((prev) =>
          prev.map((a) =>
            a.id === asset.id ? { ...a, info_correction_pending: null } : a
          )
        );
        setInfoEditMode(false);
        alert('정보수정 요청이 취소되었습니다.');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`요청 취소에 실패했습니다.\n${err.message || err.error || `HTTP ${res.status}`}`);
      }
    } catch {
      alert('서버 통신 오류가 발생했습니다.');
    }
  };

  const handleVerifySingleAsset = async (assetId: string) => {
    const currentAsset = myAssets.find((ma) => ma.id === assetId);
    if (!currentAsset) return;
    if (hasInfoCorrectionPending(currentAsset)) {
      return alert('정보수정 승인 대기 중입니다.\n관리자 승인 후 실사 완료로 처리됩니다.');
    }

    try {
      const accessToken = readMobileAccessToken();
      const assetUpdate = await fetch('/api/asset/it', {
        method: 'PATCH',
        credentials: 'include',
        headers: mobileAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: assetId,
          last_audit_date: todayStr,
          last_audit_by: 'user',
          audit_request_date: null,
          publicAuditEmail: email,
          auditId: id,
          ...(accessToken ? { accessToken } : {}),
        }),
      });

      if (!assetUpdate.ok) {
        const err = await assetUpdate.json().catch(() => ({}));
        return alert(
          `❌ 실사 확인에 실패했습니다.\n${err.message || err.error || `HTTP ${assetUpdate.status}`}\n\n인증이 만료됐다면 배포 링크를 다시 열어 본인 인증을 해 주세요.`
        );
      }

      const auditRes = await fetch('/api/asset/it/audit', {
        method: 'PATCH',
        credentials: 'include',
        headers: mobileAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: audit.id,
          publicAuditEmail: email,
          ...(accessToken ? { accessToken } : {}),
          responses: {
            upsert: {
              where: { auditId_userEmail: { auditId: audit.id, userEmail: email } },
              update: { isDone: true, date: todayStr },
              create: { userEmail: email, isDone: true, date: todayStr },
            },
          },
        }),
      }).catch(() => null);

      if (auditRes && !auditRes.ok) {
        const err = await auditRes.json().catch(() => ({}));
        console.warn('실사 응답 기록 실패', err);
      }

      setMyAssets((prev) =>
        prev.map((a) =>
          a.id === assetId
            ? {
                ...a,
                last_audit_date: todayStr,
                last_audit_by: 'user',
                audit_request_date: null,
                info_correction_pending: null,
              }
            : a
        )
      );
      setQrHint('');
      setInfoEditMode(false);
      // 완료된 자산을 바로 보여 버튼이 초록(완료)으로 바뀐 것을 확인
      setListFilter('done');
      setTimeout(() => jumpToAssetById(assetId, 'done'), 0);
      alert(`자산 [${currentAsset.code}] 실사 인증이 완료되었습니다.`);
    } catch {
      alert('서버 통신 오류로 인해 실사 확인에 실패했습니다.');
    }
  };

  const handleCancelAuditVerify = async (assetId: string) => {
    const currentAsset = myAssets.find((ma) => ma.id === assetId);
    if (!currentAsset) return;
    if (
      !confirm(
        `[${currentAsset.code}] 실사 확인을 취소하시겠습니까?\n미확인 상태로 되돌립니다.`
      )
    ) {
      return;
    }

    try {
      const accessToken = readMobileAccessToken();
      const assetUpdate = await fetch('/api/asset/it', {
        method: 'PATCH',
        credentials: 'include',
        headers: mobileAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: assetId,
          last_audit_date: null,
          last_audit_by: null,
          audit_request_date: null,
          publicAuditEmail: email,
          auditId: id,
          ...(accessToken ? { accessToken } : {}),
        }),
      });

      if (!assetUpdate.ok) {
        const err = await assetUpdate.json().catch(() => ({}));
        return alert(
          `❌ 실사 취소에 실패했습니다.\n${err.message || err.error || `HTTP ${assetUpdate.status}`}`
        );
      }

      await fetch('/api/asset/it/audit', {
        method: 'PATCH',
        credentials: 'include',
        headers: mobileAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: audit.id,
          publicAuditEmail: email,
          ...(accessToken ? { accessToken } : {}),
          responses: {
            upsert: {
              where: { auditId_userEmail: { auditId: audit.id, userEmail: email } },
              update: { isDone: false, date: null },
              create: { userEmail: email, isDone: false, date: null },
            },
          },
        }),
      }).catch(() => null);

      setMyAssets((prev) =>
        prev.map((a) =>
          a.id === assetId
            ? {
                ...a,
                last_audit_date: null,
                last_audit_by: null,
                audit_request_date: null,
              }
            : a
        )
      );
      setQrHint('');
      setListFilter('pending');
      setTimeout(() => jumpToAssetById(assetId, 'pending'), 0);
      alert(`자산 [${currentAsset.code}] 실사 인증이 취소되었습니다.`);
    } catch {
      alert('서버 통신 오류로 인해 실사 취소에 실패했습니다.');
    }
  };

  const tryCloseTab = () => {
    if (typeof window === 'undefined') return;
    window.close();
    // 주소창·QR·메신저로 연 탭은 브라우저가 close를 막음 → 직접 닫기 안내
    window.setTimeout(() => {
      alert('브라우저 정책상 이 창을 자동으로 닫을 수 없습니다.\n상단의 탭(창)을 직접 닫아 주세요.');
    }, 200);
  };

  const handleCloseWindow = () => {
    if (confirm('실사 인증을 종료하고 창을 닫으시겠습니까?')) {
      tryCloseTab();
    }
  };

  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;
    if (isScanning) {
      const insecure =
        typeof window !== 'undefined' &&
        !window.isSecureContext &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1';
      setCameraBlocked(insecure);

      scanner = new Html5QrcodeScanner(
        'reader',
        { qrbox: { width: 250, height: 250 }, fps: 10 },
        false
      );
      scanner.render((decodedText) => {
        scanner?.clear().catch(() => {});
        setIsScanning(false);
        void handleQrDecoded(decodedText);
      }, () => {});
    }
    return () => {
      if (scanner) scanner.clear().catch(console.error);
    };
  }, [isScanning, handleQrDecoded]);

  const verifiedCount = doneAssets.length;

  if (loading) {
    return (
      <div className="text-center p-20 font-black text-slate-500 animate-pulse text-xs">
        모바일 보안 채널 구동 중...
      </div>
    );
  }
  if (!audit) {
    return (
      <div className="text-center p-20 text-red-500 font-black text-xs">
        존재하지 않는 실사 링크입니다.
      </div>
    );
  }

  if (!isActivePeriod) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans w-full max-w-md mx-auto shadow-2xl border-x text-center">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl w-full">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-base font-black text-slate-800 tracking-tight">정기 실사 기간 종료 안내</h1>
          <p className="text-[11px] text-slate-400 font-bold mt-3 mb-6 leading-relaxed">
            본 실사 링크는 운영 기간이 마감되었거나
            <br />
            관리자에 의해 정지되었습니다.
            <br />
            <span className="text-indigo-600 font-black">
              (실사 운영 기간: {audit.startDate} ~ {audit.endDate})
            </span>
          </p>
          <button
            type="button"
            onClick={tryCloseTab}
            className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-black text-xs transition-all active:scale-95"
          >
            확인 (탭 닫기)
          </button>
        </div>
      </div>
    );
  }

  const deployNotice = (
    <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
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
  );

  if (isVerified) {
    if (!isIntroConfirmed) {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans w-full max-w-md mx-auto shadow-2xl border-x">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl w-full border border-slate-200">
            <h2 className="text-indigo-600 font-black text-[11px] uppercase tracking-widest mb-2">실사 안내문</h2>
            <h1 className="text-xl font-black text-slate-900 tracking-tight mb-6 leading-snug">{audit.title}</h1>

            <div className="space-y-4 mb-8">
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <span className="text-[9px] font-black text-slate-400 uppercase">참여 계정</span>
                <p className="text-xs font-black text-indigo-800 mt-1.5">
                  {displayName || email}
                  <span className="block text-[10px] font-bold text-slate-500 mt-0.5">{email}</span>
                </p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <span className="text-[9px] font-black text-slate-400 uppercase">상세 설명</span>
                <p className="text-xs font-bold text-slate-700 mt-1.5 leading-relaxed whitespace-pre-wrap">
                  {audit.description || '등록된 상세 설명이 없습니다.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase">대상 범위</span>
                  <p className="text-xs font-black text-slate-800 mt-1 truncate">{audit.target || '전사'}</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase">실사 기간</span>
                  <p className="text-[10px] font-black text-slate-800 mt-1 leading-tight">
                    {audit.startDate}
                    <br />~ {audit.endDate}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsIntroConfirmed(true)}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-xs shadow-lg shadow-indigo-200 transition-colors"
            >
              내 자산 실사 시작하기 →
            </button>
          </div>
        </div>
      );
    }

    const currentAsset = displayAssets[currentAssetIndex];
    const pendingCorrection = hasInfoCorrectionPending(currentAsset);
    const isAssetVerified = isDoneInThisAudit(currentAsset, audit.startDate);
    const allDone = myAssets.length > 0 && pendingAssets.length === 0;

    return (
      <>
        <div className="min-h-[100dvh] bg-slate-100 flex flex-col justify-between font-sans w-full max-w-md mx-auto shadow-2xl relative border-x border-slate-200">
          <div className="bg-slate-900 text-white p-5 pt-6 rounded-b-[2rem] shadow-md sticky top-0 z-40">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
                KPCQA IT ASSET AUDIT
              </span>
              <span className="bg-indigo-600 text-white font-mono font-black text-[10px] px-2.5 py-0.5 rounded-full">
                {displayAssets.length > 0 ? currentAssetIndex + 1 : 0} / {displayAssets.length}
                {listFilter === 'pending' ? ' 미완료' : listFilter === 'done' ? ' 완료' : ' 전체'}
              </span>
            </div>
            <h1 className="text-lg font-black tracking-tight truncate">{audit.title}</h1>
            <div className="mt-4 bg-white/10 p-3 rounded-xl border border-white/10 flex justify-between items-center text-xs">
              <span className="font-bold text-slate-300">내 장비 실사 현황</span>
              <span className="font-black text-white text-sm">
                인증완료 <span className="text-emerald-400">{verifiedCount}건</span> / {myAssets.length}건
              </span>
            </div>
            <div className="mt-3 flex gap-1 bg-black/20 p-1 rounded-xl">
              {(
                [
                  ['pending', `미완료 ${pendingAssets.length}`],
                  ['done', `완료 ${doneAssets.length}`],
                  ['all', `전체 ${myAssets.length}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setListFilter(key);
                    setCurrentAssetIndex(0);
                    setInfoEditMode(false);
                    setQrHint('');
                  }}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-black transition-all ${
                    listFilter === key
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 p-5 flex flex-col justify-start space-y-4 overflow-y-auto pb-10 relative">
            {isScanning && (
              <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
                <h3 className="text-white font-black text-lg mb-2 text-center leading-snug">
                  장비 라벨 QR 스캔
                </h3>
                <p className="text-[11px] font-bold text-indigo-200 mb-3 text-center leading-relaxed">
                  순서와 관계없이 눈앞 장비부터 스캔하면
                  <br />
                  해당 자산 등록정보(최신)를 불러옵니다.
                </p>
                {cameraBlocked && (
                  <div className="w-full max-w-sm mb-3 rounded-xl bg-amber-500/20 border border-amber-300/40 px-3 py-2.5 text-center">
                    <p className="text-[11px] font-black text-amber-100 leading-relaxed">
                      로컬 HTTP(Wi-Fi IP)에서는 브라우저가 카메라를 막습니다.
                      <br />
                      아래 <span className="underline">Scan an Image File</span>로
                      QR 사진을 고르거나,
                      <br />
                      자산번호를 직접 입력해 테스트하세요.
                      <br />
                      <span className="text-amber-50/80 font-bold">
                        (배포 HTTPS에서는 카메라가 정상 동작합니다)
                      </span>
                    </p>
                  </div>
                )}
                <div id="reader" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white" />
                <div className="w-full max-w-sm mt-4 space-y-2">
                  <p className="text-[10px] font-black text-slate-300 text-center uppercase tracking-wider">
                    또는 자산번호 직접 입력
                  </p>
                  <input
                    type="text"
                    value={manualQrCode}
                    onChange={(e) => setManualQrCode(e.target.value)}
                    placeholder="예: 11EQ-BD-PUR-0001"
                    className="w-full p-3.5 rounded-xl text-xs font-black text-center outline-none bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const code = manualQrCode.trim();
                      if (!code) {
                        alert('자산번호를 입력해 주세요.');
                        return;
                      }
                      setIsScanning(false);
                      void handleQrDecoded(code);
                      setManualQrCode('');
                    }}
                    className="w-full py-3.5 bg-indigo-500 text-white rounded-xl font-black text-xs"
                  >
                    이 자산번호로 불러오기
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setIsScanning(false)}
                  className="mt-6 px-8 py-4 bg-white/20 text-white border border-white/30 rounded-full font-black text-sm"
                >
                  스캔 취소하기
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsScanning(true)}
              disabled={myAssets.length === 0}
              className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white py-4 rounded-2xl font-black text-xs shadow-md flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <span className="text-base">📷</span>
              <span className="tracking-wide">자산 라벨 QR 스캔 (아무 장비부터)</span>
            </button>

            {qrHint && (
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2.5 text-[10px] font-bold text-indigo-800 leading-relaxed">
                {qrHint}
              </div>
            )}

            {currentAsset ? (
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 space-y-4">
                <div className="border-b pb-3 flex justify-between items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    자산 실사 내역 확인
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-black whitespace-nowrap ${
                      isAssetVerified
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                        : pendingCorrection
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}
                  >
                    {isAssetVerified
                      ? '실사확인 완료'
                      : pendingCorrection
                        ? '실사확인 대기중'
                        : '확인 필요'}
                  </span>
                </div>

                <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">자산 분류</p>
                  <p className="mt-1 text-[15px] font-black text-indigo-700 tracking-tight">
                    {currentAsset.it_type || '-'}
                  </p>
                  <p className="mt-1.5 text-[11px] font-bold text-slate-500 font-mono">
                    자산번호 {currentAsset.code || '-'}
                  </p>
                  {pendingCorrection && (
                    <p className="mt-2 text-[10px] font-bold text-amber-700">
                      요청일{' '}
                      {parseInfoCorrectionPending(currentAsset.info_correction_pending)?.requestedAt ||
                        '-'}{' '}
                      · 관리자 승인 대기
                    </p>
                  )}
                </div>

                {infoEditMode ? (
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      확인·수정 항목
                    </p>
                    {INFO_CORRECTION_FIELDS.map((key) => {
                      const label = INFO_CORRECTION_FIELD_LABELS[key];
                      const original = String(currentAsset[key] ?? '') || '-';
                      const dirty =
                        String(infoEditDraft[key] ?? '').trim() !==
                        String(currentAsset[key] ?? '').trim();
                      return (
                        <label key={key} className="block">
                          <span className="flex items-center justify-between gap-2 text-[10px] font-black text-slate-500 uppercase tracking-wider">
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
                            onChange={(e) =>
                              setInfoEditDraft((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            className={`mt-1 w-full px-3 py-2.5 rounded-xl border text-[12px] font-bold outline-none transition-colors ${
                              dirty
                                ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-500'
                                : 'border-slate-200 bg-slate-50 text-slate-800 focus:border-indigo-500 focus:bg-white'
                            }`}
                          />
                        </label>
                      );
                    })}
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setInfoEditMode(false)}
                        className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-[11px]"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => submitInfoCorrection(currentAsset)}
                        className="flex-[2] py-3 bg-amber-500 text-white rounded-xl font-black text-[11px] shadow-md"
                      >
                        수정완료 (관리자 확인요청)
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2.5">
                      {(
                        [
                          ['model', '모델명'],
                          ['sn', 'S/N'],
                          ['brand', '제조사'],
                          ['spec', '기본 사양'],
                        ] as const
                      ).map(([key, label]) => {
                        const display = getDisplayFieldValue(currentAsset, key);
                        return (
                          <div
                            key={key}
                            className="flex justify-between gap-3 text-[11px] font-bold border-t border-slate-100/80 pt-2 first:border-0 first:pt-0"
                          >
                            <span className="text-slate-400 shrink-0">{label}</span>
                            <span
                              className={`text-right break-all min-w-0 flex-1 ${
                                display.isPending ? 'text-rose-600' : 'text-slate-800'
                              }`}
                            >
                              {display.value.trim() || '-'}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {!isAssetVerified && !pendingCorrection && (
                      <p className="text-[11px] font-bold text-slate-500 leading-relaxed px-1">
                        이상이 없다면 <span className="text-emerald-600 font-black">실사 확인 완료</span>
                        를,
                        <br />
                        정보가 틀리다면 <span className="text-amber-600 font-black">정보수정 요청</span>
                        을 눌러 주세요.
                      </p>
                    )}

                    <div className="pt-1 space-y-2">
                      {pendingCorrection ? (
                        <>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => openInfoEdit(currentAsset)}
                              className="flex-1 py-3.5 bg-white text-amber-700 border border-amber-300 rounded-xl font-black text-[11px] leading-snug hover:bg-amber-50"
                            >
                              정보 재수정
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelInfoCorrection(currentAsset)}
                              className="flex-1 py-3.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl font-black text-[11px] leading-snug"
                            >
                              정보수정 요청 취소
                            </button>
                          </div>
                          <div className="w-full py-3.5 px-2 rounded-xl font-black text-[11px] leading-snug bg-amber-50 text-amber-700 border border-amber-200 text-center">
                            실사확인 대기중(관리자 승인 후 실사 완료)
                          </div>
                        </>
                      ) : (
                        <>
                          {!isAssetVerified && (
                            <button
                              type="button"
                              onClick={() => openInfoEdit(currentAsset)}
                              className="w-full py-3.5 bg-white text-amber-700 border border-amber-300 rounded-xl font-black text-[12px] hover:bg-amber-50"
                            >
                              정보수정 요청하기
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              isAssetVerified
                                ? handleCancelAuditVerify(currentAsset.id)
                                : handleVerifySingleAsset(currentAsset.id)
                            }
                            className={`w-full py-4 rounded-xl font-black text-xs shadow-md transition-all ${
                              isAssetVerified
                                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                                : 'bg-slate-900 text-white hover:bg-black'
                            }`}
                          >
                            {isAssetVerified
                              ? '✓ 이 장비의 실사확인 완료하였습니다'
                              : '✓ 실사 확인 완료'}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-8 text-center text-slate-400 font-bold text-xs border border-dashed space-y-2">
                {listFilter === 'pending' && myAssets.length > 0 ? (
                  <>
                    <p className="text-emerald-600 font-black">미완료 자산이 없습니다.</p>
                    <p>모두 실사 확인되었거나, 완료 탭에서 확인할 수 있습니다.</p>
                  </>
                ) : (
                  <p>실사 조치 대상 장비가 없습니다.</p>
                )}
              </div>
            )}

            {allDone && (
              <div className="pt-2 pb-6">
                <button
                  type="button"
                  onClick={handleCloseWindow}
                  className="w-full bg-slate-200 text-slate-600 py-4 rounded-2xl font-black text-xs shadow-sm"
                >
                  실사 종료하기 (확인 완료)
                </button>
              </div>
            )}
          </div>

          <div className="bg-white border-t border-slate-200 p-4 flex justify-between items-center rounded-t-[1.5rem] sticky bottom-0 z-40">
            <button
              type="button"
              disabled={currentAssetIndex === 0 || displayAssets.length === 0}
              onClick={() => {
                setInfoEditMode(false);
                setQrHint('');
                setCurrentAssetIndex((prev) => prev - 1);
              }}
              className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-xs disabled:opacity-30 border"
            >
              ◀ 이전
            </button>
            <span className="text-[11px] font-black text-slate-400 font-mono">
              {displayAssets.length > 0 ? currentAssetIndex + 1 : 0} / {displayAssets.length}
            </span>
            <button
              type="button"
              disabled={
                displayAssets.length === 0 || currentAssetIndex >= displayAssets.length - 1
              }
              onClick={() => {
                setInfoEditMode(false);
                setQrHint('');
                setCurrentAssetIndex((prev) => prev + 1);
              }}
              className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-xs disabled:opacity-30 border"
            >
              다음 ▶
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans w-full max-w-md mx-auto shadow-2xl border-x">
      <div className="w-full space-y-3">
        {audit?.title && (
          <div className="bg-white/80 rounded-2xl border border-slate-200 px-4 py-3 text-center">
            <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
              IT·업무자산 실사
            </p>
            <p className="text-sm font-black text-slate-800 mt-1 tracking-tight">{audit.title}</p>
          </div>
        )}
        <MobileHubAuthCard
          title="스마트 자산 실사 인증"
          subtitle="이메일 앞자리와 Hub 비밀번호 또는 사번으로 본인 소유 기기를 조회합니다."
          submitLabel="본인 자산 리스트 확인하기"
          accent="emerald"
          onSuccess={handleAuthSuccess}
          footer={deployNotice}
        />
      </div>
    </div>
  );
}
