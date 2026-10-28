'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BatchShippingApplyScope,
  BatchShippingInput,
  buildProductionShippingAddress,
  validateBatchShippingInput,
} from '@/lib/production-shipping';
import { formatKrPhoneInput } from '@/lib/format-kr-phone';

type CompanyAddressRow = {
  id: string;
  label: string;
  zipCode: string;
  addressKo: string;
  addressDetailKo?: string;
  isActive?: boolean;
};

export type BatchShippingSubmitPayload = {
  shipping: BatchShippingInput;
  scope: BatchShippingApplyScope;
};

type Props = {
  open: boolean;
  title?: string;
  description?: string;
  /** 적용 범위 선택 UI (발주·검수 묶음 배송지) */
  showApplyScope?: boolean;
  totalCount?: number;
  unenteredCount?: number;
  enteredCount?: number;
  /** @deprecated 호환용 */
  totalJebonCount?: number;
  /** @deprecated 호환용 */
  deferredCount?: number;
  saving?: boolean;
  submitLabel?: string;
  /**
   * 최근 입력정보 저장 키 분류
   * — 현판 / 제본 / 기타제작 / 사무문구 각각 분리
   */
  categoryScope?: string;
  onClose: () => void;
  onSubmit: (payload: BatchShippingSubmitPayload) => void | Promise<void>;
};

const RECENT_SHIPPING_KEY_PREFIX = 'production-batch-shipping-recent';

const RECENT_SCOPE_LABEL: Record<string, string> = {
  SIGN: '현판',
  JEBON: '제본',
  PRINT: '기타제작',
  OFFICE_SUPPLIES: '사무문구',
  OTHER: '기타',
};

function normalizeRecentScope(categoryId?: string): string {
  const key = String(categoryId || '').trim().toUpperCase();
  if (key === 'SIGN' || key === 'JEBON' || key === 'PRINT' || key === 'OFFICE_SUPPLIES') {
    return key;
  }
  return 'OTHER';
}

function recentShippingStorageKey(categoryId?: string): string {
  return `${RECENT_SHIPPING_KEY_PREFIX}:${normalizeRecentScope(categoryId)}`;
}

const emptyForm = (): BatchShippingInput => ({
  receiverName: '',
  receiverPhone: '',
  shippingZipCode: '',
  shippingAddressRoad: '',
  shippingAddressDetail: '',
  companyAddressLabel: '',
});

function parseRecentShippingRaw(raw: string | null): BatchShippingInput | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BatchShippingInput>;
    const next: BatchShippingInput = {
      receiverName: String(parsed.receiverName || '').trim(),
      receiverPhone: String(parsed.receiverPhone || '').trim(),
      shippingZipCode: String(parsed.shippingZipCode || '').trim(),
      shippingAddressRoad: String(parsed.shippingAddressRoad || '').trim(),
      shippingAddressDetail: String(parsed.shippingAddressDetail || '').trim(),
      companyAddressLabel: String(parsed.companyAddressLabel || '').trim(),
    };
    if (
      !next.receiverName &&
      !next.receiverPhone &&
      !next.shippingZipCode &&
      !next.shippingAddressRoad
    ) {
      return null;
    }
    return next;
  } catch {
    return null;
  }
}

function readRecentShipping(categoryId?: string): BatchShippingInput | null {
  if (typeof window === 'undefined') return null;
  return parseRecentShippingRaw(localStorage.getItem(recentShippingStorageKey(categoryId)));
}

function saveRecentShipping(shipping: BatchShippingInput, categoryId?: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      recentShippingStorageKey(categoryId),
      JSON.stringify({
        receiverName: shipping.receiverName,
        receiverPhone: shipping.receiverPhone,
        shippingZipCode: shipping.shippingZipCode,
        shippingAddressRoad: shipping.shippingAddressRoad,
        shippingAddressDetail: shipping.shippingAddressDetail || '',
        companyAddressLabel: shipping.companyAddressLabel || '',
      })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export default function ProductionBatchShippingModal({
  open,
  title = '묶음 배송지 일괄 설정',
  description = '선택한 건에 동일한 실배송지를 적용합니다.',
  showApplyScope = false,
  totalCount,
  unenteredCount,
  enteredCount,
  totalJebonCount = 0,
  deferredCount = 0,
  saving = false,
  submitLabel = '배송지 적용',
  categoryScope,
  onClose,
  onSubmit,
}: Props) {
  const total = totalCount ?? totalJebonCount ?? 0;
  const unentered = unenteredCount ?? deferredCount ?? 0;
  const entered = enteredCount ?? Math.max(0, total - unentered);
  const recentScope = normalizeRecentScope(categoryScope);
  const recentScopeLabel = RECENT_SCOPE_LABEL[recentScope] || '기타';

  const [form, setForm] = useState<BatchShippingInput>(emptyForm());
  const [companyAddresses, setCompanyAddresses] = useState<CompanyAddressRow[]>([]);
  const [selectedCompanyAddressId, setSelectedCompanyAddressId] = useState('');
  const [selectedSourceLabel, setSelectedSourceLabel] = useState('');
  const [applyScope, setApplyScope] = useState<BatchShippingApplyScope>('deferred');
  const [showCompanyAddrPicker, setShowCompanyAddrPicker] = useState(false);
  const [showMarketingClientPicker, setShowMarketingClientPicker] = useState(false);
  const [marketingClients, setMarketingClients] = useState<any[]>([]);
  const [marketingClientSearch, setMarketingClientSearch] = useState('');
  const [marketingClientsLoading, setMarketingClientsLoading] = useState(false);
  const [hasRecentShipping, setHasRecentShipping] = useState(false);

  const filteredMarketingClients = useMemo(() => {
    const q = marketingClientSearch.trim().toLowerCase();
    if (!q) return marketingClients;
    return marketingClients.filter((c) =>
      String(c?.name || '')
        .toLowerCase()
        .includes(q)
    );
  }, [marketingClients, marketingClientSearch]);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm());
    setSelectedCompanyAddressId('');
    setSelectedSourceLabel('');
    setApplyScope(unentered > 0 ? 'deferred' : 'all');
    setShowCompanyAddrPicker(false);
    setShowMarketingClientPicker(false);
    setHasRecentShipping(Boolean(readRecentShipping(recentScope)));
    fetch(`/api/asset/businesscard/master/addresses?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => setCompanyAddresses(Array.isArray(rows) ? rows : []))
      .catch(() => setCompanyAddresses([]));
  }, [open, unentered, recentScope]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const scriptId = 'kakao-postcode-script-production-batch';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  if (!open) return null;

  const openPostcode = () => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          setSelectedCompanyAddressId('');
          setSelectedSourceLabel('신규 검색');
          setForm((prev) => ({
            ...prev,
            shippingZipCode: data.zonecode,
            shippingAddressRoad: data.roadAddress || data.address,
            shippingAddressDetail: '',
            companyAddressLabel: '',
          }));
        },
      }).open();
    } else {
      alert('주소 검색 엔진을 로드 중입니다. 잠시 후 다시 클릭해 주세요.');
    }
  };

  const applyCompanyAddress = (addrId: string) => {
    setSelectedCompanyAddressId(addrId);
    if (!addrId) return;
    const target = companyAddresses.find((a) => a.id === addrId);
    if (!target) return;
    setSelectedSourceLabel(target.label);
    setForm((prev) => ({
      ...prev,
      shippingZipCode: target.zipCode || '',
      shippingAddressRoad: target.addressKo || '',
      shippingAddressDetail: String(target.addressDetailKo || '').trim(),
      companyAddressLabel: target.label,
    }));
    setShowCompanyAddrPicker(false);
  };

  const openCompanyAddrPicker = () => {
    const active = companyAddresses.filter((a) => a.isActive !== false);
    if (active.length === 0) {
      return alert('명함에 등록된 전사 공통 주소가 없습니다.');
    }
    if (active.length === 1) {
      applyCompanyAddress(active[0].id);
      return;
    }
    setShowCompanyAddrPicker(true);
  };

  const openMarketingClientPicker = async () => {
    setShowMarketingClientPicker(true);
    setMarketingClientSearch('');
    setMarketingClientsLoading(true);
    try {
      const res = await fetch(
        `/api/marketing/clients?lite=1&includeArchived=1&t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        setMarketingClients([]);
        alert(
          '고객사 주소관리 목록을 불러오지 못했습니다. 「제작물 > 고객사 주소관리」 메뉴 권한을 확인해 주세요.'
        );
        return;
      }
      setMarketingClients(await res.json());
    } catch {
      setMarketingClients([]);
      alert('고객사 주소관리 목록을 불러오지 못했습니다.');
    } finally {
      setMarketingClientsLoading(false);
    }
  };

  const applyMarketingClientAddress = (client: any) => {
    const zip = String(client?.zip_code || '').trim();
    const road = String(client?.address_road || '').trim();
    const detail = String(client?.address_detail || '').trim();
    const legacy = String(client?.location || '').trim();
    if (!zip && !road && !detail && !legacy) {
      return alert('선택한 고객사에 등록된 주소가 없습니다.');
    }
    const label = String(client?.name || '').trim();
    setSelectedCompanyAddressId('');
    setSelectedSourceLabel(label || '고객사 주소');
    setForm((prev) => ({
      ...prev,
      shippingZipCode: zip,
      shippingAddressRoad: road || (!zip && !detail ? legacy : road),
      shippingAddressDetail: detail,
      companyAddressLabel: label,
    }));
    setShowMarketingClientPicker(false);
  };

  const loadRecentShipping = () => {
    const recent = readRecentShipping(recentScope);
    if (!recent) {
      return alert(`${recentScopeLabel} 분류로 최근에 입력한 배송지 정보가 없습니다.`);
    }
    setSelectedCompanyAddressId('');
    setSelectedSourceLabel(`최근 입력정보(${recentScopeLabel})`);
    setForm(recent);
    setHasRecentShipping(true);
  };

  const handleSubmit = async () => {
    const err = validateBatchShippingInput(form);
    if (err) return alert(err);
    if (showApplyScope) {
      const targetCount = applyScope === 'all' ? total : unentered;
      if (targetCount <= 0) {
        return alert('선택한 적용 범위에 해당하는 건이 없습니다.');
      }
    }
    saveRecentShipping(form, recentScope);
    setHasRecentShipping(true);
    await onSubmit({ shipping: form, scope: applyScope });
  };

  const preview = buildProductionShippingAddress(form);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto border border-slate-200">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-base font-black text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-1.5 font-semibold leading-relaxed">{description}</p>
          {showApplyScope && (
            <div className="mt-4 space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex flex-wrap items-center gap-2 pb-2.5 border-b border-slate-200 text-xs">
                <span className="font-black text-slate-700">주소상태:</span>
                <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                  실배송지 미입력건 <strong className="font-black">({unentered}건)</strong>
                </span>
                <span className="text-slate-300">/</span>
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  실배송지 입력건 <strong className="font-black">({entered}건)</strong>
                </span>
              </div>

              <div className="space-y-2 pt-0.5">
                <label
                  className={`flex items-start gap-2.5 cursor-pointer select-none p-2 rounded-lg transition-colors ${
                    applyScope === 'deferred'
                      ? 'bg-white border border-indigo-300 shadow-sm'
                      : 'hover:bg-slate-100/80 border border-transparent'
                  } ${unentered <= 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={applyScope === 'deferred'}
                    disabled={unentered <= 0}
                    onChange={() => unentered > 0 && setApplyScope('deferred')}
                    className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span className="text-[11px] font-bold text-slate-800 leading-snug">
                    실배송지 미입력건({unentered}건)에 대해서만 실배송지 일괄 변경
                    <span className="block text-[10px] font-medium text-slate-500 mt-0.5">
                      기존에 입력된 실배송지는 유지하고, 미입력된 건만 지금 입력한 주소로 변경합니다.
                    </span>
                  </span>
                </label>

                <label
                  className={`flex items-start gap-2.5 cursor-pointer select-none p-2 rounded-lg transition-colors ${
                    applyScope === 'all'
                      ? 'bg-white border border-indigo-300 shadow-sm'
                      : 'hover:bg-slate-100/80 border border-transparent'
                  } ${total <= 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={applyScope === 'all'}
                    disabled={total <= 0}
                    onChange={() => total > 0 && setApplyScope('all')}
                    className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span className="text-[11px] font-bold text-slate-800 leading-snug">
                    전체 건({total}건) 실배송지 일괄 변경(기존 입력건을 무시)
                    <span className="block text-[10px] font-medium text-slate-500 mt-0.5">
                      신청자가 개별 입력한 주소도 무시하고 모두 동일 주소로 변경합니다.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium text-slate-500 tracking-widest shrink-0">
              배송지 주소 불러오기
            </span>
            <button
              type="button"
              onClick={openCompanyAddrPicker}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50 transition-colors shadow-sm"
              title="명함 등록 주소"
            >
              전사 공통주소
            </button>
            <button
              type="button"
              onClick={() => void openMarketingClientPicker()}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-medium text-slate-700 hover:border-sky-400 hover:bg-sky-50 transition-colors shadow-sm"
              title="제작물 · 고객사 주소관리 *실배송지 확인 필수"
            >
              고객사 주소관리
            </button>
            <button
              type="button"
              onClick={openPostcode}
              className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-medium hover:bg-slate-800 transition-colors shadow-sm"
              title="우편번호 검색"
            >
              신규 검색
            </button>
            {selectedSourceLabel ? (
              <span className="text-[9px] text-blue-600 font-medium">선택됨: {selectedSourceLabel}</span>
            ) : null}
            <button
              type="button"
              onClick={loadRecentShipping}
              disabled={!hasRecentShipping}
              className="ml-auto px-3 py-1.5 bg-amber-400 border border-amber-500 rounded-lg text-[10px] font-medium text-amber-950 hover:bg-amber-300 hover:border-amber-600 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title={`${recentScopeLabel} 분류에서 직전에 입력·적용한 수령인~상세주소`}
            >
              최근 입력정보 불러오기({recentScopeLabel})
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
            <div className="flex flex-wrap xl:flex-nowrap items-stretch gap-2">
              <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto sm:min-w-[7.5rem] bg-white border border-slate-200 rounded-xl px-2.5 h-10">
                <span className="text-[9px] font-medium text-slate-400 shrink-0">
                  수령인 <span className="text-red-500">*</span>
                </span>
                <input
                  type="text"
                  placeholder="성명"
                  value={form.receiverName}
                  onChange={(e) => setForm({ ...form, receiverName: e.target.value })}
                  className="min-w-0 w-20 sm:w-24 text-xs font-medium outline-none bg-transparent"
                />
              </div>
              <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto sm:min-w-[9.5rem] bg-white border border-slate-200 rounded-xl px-2.5 h-10">
                <span className="text-[9px] font-medium text-slate-400 shrink-0">
                  연락처 <span className="text-red-500">*</span>
                </span>
                <input
                  type="text"
                  placeholder="연락처"
                  value={form.receiverPhone}
                  onChange={(e) =>
                    setForm({ ...form, receiverPhone: formatKrPhoneInput(e.target.value) })
                  }
                  inputMode="numeric"
                  maxLength={13}
                  className="min-w-0 w-28 text-xs font-medium outline-none bg-transparent"
                />
              </div>
              <div className="flex items-center gap-1.5 shrink-0 bg-white border border-slate-200 rounded-xl px-2.5 h-10">
                <span className="text-[9px] font-medium text-slate-400">
                  우편 <span className="text-red-500">*</span>
                </span>
                <input
                  type="text"
                  readOnly
                  value={form.shippingZipCode}
                  placeholder="자동"
                  className="w-14 font-mono text-center text-xs font-medium text-blue-600 bg-transparent outline-none"
                />
              </div>
              <div className="flex-[2] min-w-[10rem] h-10 px-3 border border-slate-200 rounded-xl bg-white flex items-center gap-1.5">
                <span className="text-[9px] font-medium text-slate-400 shrink-0 whitespace-nowrap">
                  도로명 <span className="text-red-500">*</span>
                </span>
                <input
                  type="text"
                  value={form.shippingAddressRoad}
                  onChange={(e) => {
                    setForm({
                      ...form,
                      shippingAddressRoad: e.target.value,
                      companyAddressLabel: '',
                    });
                    if (selectedCompanyAddressId) setSelectedCompanyAddressId('');
                    if (selectedSourceLabel) setSelectedSourceLabel('');
                  }}
                  placeholder="불러오기·검색 후 수정 가능"
                  className="min-w-0 flex-1 text-slate-700 text-xs font-medium outline-none bg-transparent"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-1 min-w-[8rem] max-w-[18rem] bg-white border border-slate-200 rounded-xl px-2.5 h-10">
                <span className="text-[9px] font-medium text-blue-600 shrink-0">
                  상세 <span className="text-red-500">*</span>
                </span>
                <input
                  type="text"
                  value={form.shippingAddressDetail || ''}
                  onChange={(e) => {
                    setForm({ ...form, shippingAddressDetail: e.target.value });
                    if (selectedCompanyAddressId) setSelectedCompanyAddressId('');
                  }}
                  placeholder="동·호수 등"
                  className="min-w-0 flex-1 text-xs font-medium text-slate-800 outline-none bg-transparent"
                />
              </div>
            </div>
            {preview ? (
              <p className="text-[10px] text-slate-500 font-medium px-0.5">미리보기: {preview}</p>
            ) : null}
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl text-[11px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? '저장 중…' : submitLabel}
          </button>
        </div>
      </div>

      {showCompanyAddrPicker && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex items-center justify-center p-4"
          onClick={() => setShowCompanyAddrPicker(false)}
        >
          <div
            className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-800">전사 공통주소 선택</h3>
              <button
                type="button"
                onClick={() => setShowCompanyAddrPicker(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-medium text-sm hover:bg-slate-200"
              >
                ✕
              </button>
            </div>
            <p className="text-[10px] text-slate-400 font-medium mb-3">(명함 등록 주소)</p>
            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              {companyAddresses
                .filter((a) => a.isActive !== false)
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => applyCompanyAddress(a.id)}
                    className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  >
                    <div className="text-[12px] font-medium text-slate-800">🏢 {a.label}</div>
                    <div className="text-[10px] font-medium text-slate-500 mt-0.5">
                      [{a.zipCode}] {[a.addressKo, a.addressDetailKo].filter(Boolean).join(' ')}
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {showMarketingClientPicker && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex items-center justify-center p-4"
          onClick={() => setShowMarketingClientPicker(false)}
        >
          <div
            className="bg-white w-full max-w-xl rounded-2xl border border-slate-200 shadow-2xl p-5 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="text-sm font-medium text-slate-800">고객사 주소관리 불러오기</h3>
              <button
                type="button"
                onClick={() => setShowMarketingClientPicker(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-medium text-sm hover:bg-slate-200"
              >
                ✕
              </button>
            </div>
            <p className="text-[10px] text-slate-400 font-medium mb-2 shrink-0">
              (제작물 · 고객사 주소관리){' '}
              <span className="text-amber-600">*실배송지 확인 필수</span>
            </p>
            <input
              type="text"
              value={marketingClientSearch}
              onChange={(e) => setMarketingClientSearch(e.target.value)}
              placeholder="회사명 검색..."
              className="w-full mb-3 px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-medium outline-none focus:border-sky-400 shrink-0"
            />
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
              {marketingClientsLoading ? (
                <div className="py-10 text-center text-[11px] font-medium text-slate-400 animate-pulse">
                  고객사 불러오는 중...
                </div>
              ) : filteredMarketingClients.length === 0 ? (
                <div className="py-10 text-center text-[11px] font-medium text-slate-300">
                  {marketingClientSearch.trim()
                    ? '검색 결과가 없습니다.'
                    : '회사명 키워드를 입력하면 관련 고객사만 표시됩니다.'}
                </div>
              ) : (
                filteredMarketingClients.map((c) => {
                  const zip = c.zip_code || '';
                  const road = c.address_road || '';
                  const detail = c.address_detail || '';
                  const loc =
                    [zip && `[${zip}]`, road, detail].filter(Boolean).join(' ') ||
                    c.location ||
                    '주소 없음';
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => applyMarketingClientAddress(c)}
                      className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 hover:border-sky-400 hover:bg-sky-50 transition-colors"
                    >
                      <div className="text-[12px] font-medium text-slate-800 truncate">{c.name}</div>
                      <div
                        className="text-[10px] font-medium text-slate-500 mt-0.5 truncate"
                        title={loc}
                      >
                        {loc}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
