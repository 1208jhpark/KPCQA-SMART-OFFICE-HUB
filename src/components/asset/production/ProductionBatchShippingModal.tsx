'use client';

import React, { useEffect, useState } from 'react';
import {
  BatchShippingApplyScope,
  BatchShippingInput,
  buildProductionShippingAddress,
  validateBatchShippingInput,
} from '@/lib/production-shipping';

type CompanyAddressRow = {
  id: string;
  label: string;
  zipCode: string;
  addressKo: string;
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
  totalJebonCount?: number;
  deferredCount?: number;
  saving?: boolean;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (payload: BatchShippingSubmitPayload) => void | Promise<void>;
};

const emptyForm = (): BatchShippingInput => ({
  receiverName: '',
  receiverPhone: '',
  shippingZipCode: '',
  shippingAddressRoad: '',
  shippingAddressDetail: '',
  companyAddressLabel: '',
});

export default function ProductionBatchShippingModal({
  open,
  title = '묶음 배송지 일괄 설정',
  description = '선택한 건에 동일한 실배송지를 적용합니다.',
  showApplyScope = false,
  totalJebonCount = 0,
  deferredCount = 0,
  saving = false,
  submitLabel = '배송지 적용',
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<BatchShippingInput>(emptyForm());
  const [companyAddresses, setCompanyAddresses] = useState<CompanyAddressRow[]>([]);
  const [selectedCompanyAddressId, setSelectedCompanyAddressId] = useState('');
  const [applyScope, setApplyScope] = useState<BatchShippingApplyScope>('deferred');

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm());
    setSelectedCompanyAddressId('');
    setApplyScope(deferredCount > 0 ? 'deferred' : 'all');
    fetch(`/api/asset/businesscard/master/addresses?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => setCompanyAddresses(Array.isArray(rows) ? rows : []))
      .catch(() => setCompanyAddresses([]));
  }, [open, deferredCount]);

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
          setForm((prev) => ({
            ...prev,
            shippingZipCode: data.zonecode,
            shippingAddressRoad: data.roadAddress || data.address,
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
    setForm((prev) => ({
      ...prev,
      shippingZipCode: target.zipCode,
      shippingAddressRoad: target.addressKo,
      shippingAddressDetail: '',
      companyAddressLabel: target.label,
    }));
  };

  const handleSubmit = async () => {
    const err = validateBatchShippingInput(form);
    if (err) return alert(err);
    if (showApplyScope) {
      const targetCount = applyScope === 'all' ? totalJebonCount : deferredCount;
      if (targetCount <= 0) {
        return alert('선택한 적용 범위에 해당하는 건이 없습니다.');
      }
    }
    await onSubmit({ shipping: form, scope: applyScope });
  };

  const preview = buildProductionShippingAddress(form);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-slate-200">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-base font-black text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-1.5 font-semibold leading-relaxed">{description}</p>
          {showApplyScope && (
            <div className="mt-4 space-y-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <label
                className={`flex items-start gap-2.5 cursor-pointer select-none ${
                  totalJebonCount <= 0 ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={applyScope === 'all'}
                  disabled={totalJebonCount <= 0}
                  onChange={() => totalJebonCount > 0 && setApplyScope('all')}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="text-[11px] font-bold text-slate-700 leading-snug">
                  묶음 배송 전체 항목 일괄 실배송지 변경
                  <span className="text-indigo-600 font-black"> ({totalJebonCount}건)</span>
                  <span className="block text-[10px] font-semibold text-slate-400 mt-0.5">
                    신청자가 개별 입력한 주소도 무시하고 모두 동일 주소로 변경합니다.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-2.5 cursor-pointer select-none ${
                  deferredCount <= 0 ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={applyScope === 'deferred'}
                  disabled={deferredCount <= 0}
                  onChange={() => deferredCount > 0 && setApplyScope('deferred')}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="text-[11px] font-bold text-slate-700 leading-snug">
                  신청 시 「묶음 발주시」로 미입력된 건 실배송지 변경
                  <span className="text-indigo-600 font-black"> ({deferredCount}건)</span>
                  <span className="block text-[10px] font-semibold text-slate-400 mt-0.5">
                    묶음 발주 시 입력하기로 한 건만 적용합니다. 개별 입력 건은 유지됩니다.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">수령인 성명</label>
              <input
                type="text"
                value={form.receiverName}
                onChange={(e) => setForm({ ...form, receiverName: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-1">수령인 연락처</label>
              <input
                type="text"
                value={form.receiverPhone}
                onChange={(e) => setForm({ ...form, receiverPhone: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 mb-1">전사 공통 주소 불러오기</label>
            <select
              value={selectedCompanyAddressId}
              onChange={(e) => applyCompanyAddress(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer"
            >
              <option value="">직접 입력 / 주소 검색</option>
              {companyAddresses
                .filter((a) => a.isActive !== false)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    🏢 {a.label} — {a.addressKo}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2 items-stretch">
            <button
              type="button"
              onClick={openPostcode}
              className="shrink-0 px-3 h-10 bg-slate-900 text-white rounded-xl text-[11px] font-black"
            >
              우편번호 검색
            </button>
            <input
              type="text"
              readOnly
              value={form.shippingZipCode}
              placeholder="우편번호"
              className="w-24 bg-slate-100 border border-slate-200 rounded-xl px-2 text-xs font-mono"
            />
            <input
              type="text"
              value={form.shippingAddressRoad}
              onChange={(e) =>
                setForm({
                  ...form,
                  shippingAddressRoad: e.target.value,
                  companyAddressLabel: '',
                })
              }
              placeholder="도로명 주소"
              className="flex-1 min-w-[160px] bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-semibold outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 mb-1">상세주소</label>
            <input
              type="text"
              value={form.shippingAddressDetail || ''}
              onChange={(e) => setForm({ ...form, shippingAddressDetail: e.target.value })}
              placeholder="동·호수 등"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
            />
          </div>

          {preview ? (
            <p className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              미리보기: {preview}
            </p>
          ) : null}
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
    </div>
  );
}
