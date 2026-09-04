'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getKSTDateString } from '@/utils/dateUtils';
import { displaySignValidPeriod, formatPrintItemInfoSpec } from '@/lib/production-sign-excel';
import { isHqReceiveShip, resolveDeliveryMode } from '@/lib/production-shipping';

const HISTORY_CATEGORIES = [
  { id: 'ALL', label: '전체 내역', icon: '📋' },
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
];

/** 신청 수량 단위: 제본=부, 기타제작=마스터 단위, 사무문구=건, 그 외=EA */
function formatQuantityUnit(item: {
  category?: string;
  options?: { printItemMasterInfo?: { unitLabel?: string; unitValue?: string } };
}) {
  if (item.category === 'JEBON') return '부';
  if (item.category === 'OFFICE_SUPPLIES') return '건';
  if (item.category === 'PRINT') {
    const label = item.options?.printItemMasterInfo?.unitLabel;
    if (label) return String(label);
  }
  return 'EA';
}

type CustomRequestRow = { id: number; value: string };

function normalizeCustomRequests(raw: unknown): CustomRequestRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((req: any, i: number) => {
    if (typeof req === 'string') {
      return { id: Date.now() + i, value: req };
    }
    const value = String(req?.value || '');
    return {
      id: typeof req?.id === 'number' ? req.id : Date.now() + i,
      value,
    };
  });
}

function isJebonNormalCert(certType: string | undefined | null) {
  if (!certType) return false;
  const t = String(certType);
  return t === 'NORMAL' || t.includes('일반');
}

/** 제본 판형 — 종류(jebonSizeType) · 치수(jebonSize) 분리 표시 */
function resolveJebonSizeDisplay(options: Record<string, unknown> | undefined | null) {
  const typeCode = String(options?.jebonSizeType || '').trim();
  const sizeSpec = String(options?.jebonSize || '').trim();

  if (!typeCode && !sizeSpec) {
    return { kind: null as string | null, spec: null as string | null };
  }

  if (!typeCode) {
    if (/×|mm|절|\d/.test(sizeSpec) && sizeSpec.length > 3) {
      return { kind: null, spec: sizeSpec };
    }
    return { kind: sizeSpec, spec: null };
  }

  const isCustom = typeCode === '비규격' || typeCode === 'CUSTOM';
  if (isCustom) {
    return { kind: typeCode, spec: sizeSpec || null };
  }

  const spec = sizeSpec && sizeSpec !== typeCode ? sizeSpec : null;
  return { kind: typeCode, spec };
}

/** 신청 탭(ProductionApplyForm) jebonFormSteps와 동일 번호 체계 */
function getJebonFormSteps() {
  return {
    certType: 1,
    certPhase: 2,
    size: 3,
    cover: 4,
    inner: 5,
    building: 6,
    coverDate: 7,
    customRequest: 8,
  };
}

function getCategoryLabel(catId: string) {
  const found = HISTORY_CATEGORIES.find((c) => c.id === catId);
  return found ? found.label : catId;
}

const DetailSectionTitle = ({ title }: { title: string }) => (
  <h4 className="font-black text-slate-800 text-sm border-b pb-2 mb-3 mt-2 tracking-tight flex items-center gap-1.5">
    <span className="w-1.5 h-3.5 bg-blue-600 rounded-sm"></span>
    {title}
  </h4>
);

const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
  /** @deprecated 내용값은 일괄 검정(slate-800) — 호환용으로만 유지 */
  highlight?: boolean;
}) => (
  <div className="flex flex-col gap-1 border-b border-slate-100 pb-2.5">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight">{label}</span>
    <span className="text-xs font-bold text-slate-800">
      {value || <span className="text-slate-300 font-medium">해당없음 / 미기입</span>}
    </span>
  </div>
);

type Props = {
  item: any;
  onClose: () => void;
  /** when true and status is in editableStatuses, show 수정/저장 */
  allowEdit?: boolean;
  /** statuses that allow inline edit (default: PENDING only — personal history) */
  editableStatuses?: string[];
  /** PATCH endpoint for save (default: personal apply/history) */
  editApiPath?: string;
  /** called after successful save so parent can refresh list */
  onSaved?: (updated: any) => void;
};

export default function ProductionRequestDetailModal({
  item,
  onClose,
  allowEdit = false,
  editableStatuses = ['PENDING'],
  editApiPath = '/api/asset/production/apply/history',
  onSaved,
}: Props) {
  const [detailItem, setDetailItem] = useState(item);
  const [detailEditing, setDetailEditing] = useState(false);
  const [detailDraft, setDetailDraft] = useState<any>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [companyAddresses, setCompanyAddresses] = useState<
    { id: string; label: string; zipCode: string; addressKo: string; isActive?: boolean }[]
  >([]);
  const [vendorOptions, setVendorOptions] = useState<{ id: string; label: string }[]>([]);
  const [plateOptions, setPlateOptions] = useState<
    { code: string; label: string; size: string; price: number }[]
  >([]);
  const [certOptions, setCertOptions] = useState<
    { certId: string; label: string; type: string; grades: string[] }[]
  >([]);
  const [printItemOptions, setPrintItemOptions] = useState<
    {
      id: string;
      name: string;
      size: string;
      supplier: string;
      orderQty: number;
      unitValue?: string;
      isCustom: boolean;
    }[]
  >([]);

  useEffect(() => {
    setDetailItem(item);
    setDetailEditing(false);
    setDetailDraft(null);
  }, [item]);

  const canShowEdit =
    allowEdit && Boolean(detailItem?.status) && editableStatuses.includes(detailItem.status);

  const jebonDetailCertType =
    detailItem?.category === 'JEBON'
      ? detailEditing
        ? detailDraft?.options?.certType
        : detailItem?.options?.certType
      : null;
  const jebonFormSteps = useMemo(
    () => getJebonFormSteps(),
    [jebonDetailCertType]
  );
  const jebonIsNormal = isJebonNormalCert(jebonDetailCertType);
  const jebonSizeDisplay = useMemo(
    () =>
      detailItem?.category === 'JEBON'
        ? resolveJebonSizeDisplay(detailItem?.options)
        : { kind: null, spec: null },
    [detailItem?.category, detailItem?.options]
  );
  const selectedDraftPrintItem = useMemo(() => {
    if (detailItem?.category !== 'PRINT') return null;
    const draftId = detailDraft?.options?.printItemId;
    if (draftId) return printItemOptions.find((row) => row.id === draftId) || null;
    const draftName = detailDraft?.options?.printItemType;
    if (!draftName) return null;
    return printItemOptions.find((row) => row.name === draftName) || null;
  }, [detailDraft?.options?.printItemId, detailDraft?.options?.printItemType, detailItem?.category, printItemOptions]);
  const isDraftPrintCustomItem = selectedDraftPrintItem?.isCustom === true;

  const printItemReferenceText = (printItem: {
    size: string;
    supplier: string;
    orderQty: number;
    unitValue?: string;
  }) => {
    const unitValue = printItem.unitValue || 'VAL_1';
    const unitLabel =
      unitValue === 'VAL_BOX'
        ? 'BOX'
        : unitValue === 'VAL_SET'
          ? 'SET'
          : unitValue === 'VAL_PACK'
            ? 'PACK'
            : unitValue === 'VAL_BOOK'
              ? '권'
              : unitValue === 'VAL_SHEET'
                ? '장'
                : unitValue === 'VAL_COPY'
                  ? '부'
                  : '개';
    const parts = [
      printItem.size?.trim(),
      printItem.supplier?.trim(),
      printItem.orderQty > 0 ? `${printItem.orderQty}${unitLabel}` : '',
    ].filter(Boolean);
    return parts.length ? `(${parts.join('/')})` : '';
  };

  const patchDraftOptions = (patch: Record<string, unknown>) => {
    setDetailDraft((prev: any) => {
      if (!prev) return prev;
      return { ...prev, options: { ...prev.options, ...patch } };
    });
  };

  const applyDraftPrintItemSelection = (itemId: string) => {
    const row = printItemOptions.find((r) => r.id === itemId);
    if (!row) {
      patchDraftOptions({
        printItemId: '',
        printItemType: '',
        printCustomName: '',
        printItemMasterInfo: null,
      });
      return;
    }
    patchDraftOptions({
      printItemId: row.id,
      printItemType: row.name,
      printCustomName: row.isCustom ? '' : row.name,
      printItemMasterInfo: {
        id: row.id,
        name: row.name,
        size: row.size,
        supplier: row.supplier,
        orderQty: row.orderQty,
        unitValue: row.unitValue || 'VAL_1',
        unitLabel: row.unitValue || 'VAL_1',
        isCustom: row.isCustom,
      },
    });
    setDetailDraft((prev: any) =>
      prev
        ? {
            ...prev,
            quantity: Math.max(1, Number(row.orderQty) || 1),
          }
        : prev
    );
  };

  const startDetailEdit = async () => {
    if (!canShowEdit || !detailItem) return;
    setDetailDraft({
      title: detailItem.title || '',
      quantity: detailItem.quantity || 1,
      options: {
        ...(detailItem.options || {}),
        formattedValidPeriod: displaySignValidPeriod(
          detailItem.options?.formattedValidPeriod
        ),
        customRequests: normalizeCustomRequests(detailItem.options?.customRequests),
      },
    });
    setDetailEditing(true);
    const ts = Date.now();
    try {
      const [addrRes, vendRes, plateRes, certRes, printRes] = await Promise.all([
        fetch(`/api/asset/businesscard/master/addresses?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/production/master/vendors?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/production/master/plates?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/production/master/certs?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/production/master/print-items?t=${ts}`, { cache: 'no-store' }),
      ]);
      if (addrRes.ok) {
        const rows = await addrRes.json();
        setCompanyAddresses(Array.isArray(rows) ? rows : []);
      }
      if (vendRes.ok) {
        const rows = await vendRes.json();
        setVendorOptions(
          Array.isArray(rows)
            ? rows.map((v: any) => ({ id: v.id, label: v.label }))
            : []
        );
      }
      if (plateRes.ok) {
        const rows = await plateRes.json();
        setPlateOptions(
          Array.isArray(rows)
            ? rows.map((p: any) => ({
                code: p.code,
                label: p.label,
                size: p.size || '',
                price: Number(p.price) || 0,
              }))
            : []
        );
      }
      if (certRes.ok) {
        const rows = await certRes.json();
        setCertOptions(
          Array.isArray(rows)
            ? rows.map((c: any) => ({
                certId: c.certId || c.id,
                label: c.label,
                type: c.type,
                grades: Array.isArray(c.grades) ? c.grades.map(String) : [],
              }))
            : []
        );
      }
      if (printRes.ok) {
        const rows = await printRes.json();
        setPrintItemOptions(
          Array.isArray(rows)
            ? rows.map((printRow: any) => ({
                id: String(printRow.id || ''),
                name: String(printRow.name || ''),
                size: String(printRow.size || ''),
                supplier: String(printRow.supplier || ''),
                orderQty: Math.max(1, Number(printRow.orderQty) || 1),
                unitValue: String(printRow.unitValue || 'VAL_1'),
                isCustom: printRow.isCustom === true,
              }))
            : []
        );
      }
    } catch {
      /* ignore */
    }
  };

  const cancelDetailEdit = () => {
    setDetailEditing(false);
    setDetailDraft(null);
  };

  const applyCompanyAddressToDraft = (addressId: string) => {
    const target = companyAddresses.find((a) => a.id === addressId);
    setDetailDraft((prev: any) => {
      if (!prev) return prev;
      if (!target) {
        return {
          ...prev,
          options: {
            ...prev.options,
            companyAddressLabel: '',
            selectedCompanyAddressId: '',
          },
        };
      }
      return {
        ...prev,
        options: {
          ...prev.options,
          selectedCompanyAddressId: addressId,
          companyAddressLabel: target.label,
          shippingZipCode: target.zipCode || '',
          shippingAddressRoad: target.addressKo || '',
          shippingAddressDetail: '',
          shippingAddress: [target.zipCode && `[${target.zipCode}]`, target.addressKo]
            .filter(Boolean)
            .join(' '),
        },
      };
    });
  };

  const saveDetailEdit = async () => {
    if (!detailItem || !detailDraft) return;
    const title = String(detailDraft.title || '').trim();
    if (!title) return alert('관리용 제목을 입력해 주세요.');
    const opts = detailDraft.options || {};
    const isBatch = isHqReceiveShip({
      category: detailItem.category,
      options: opts,
    });
    if (!isBatch) {
      if (!String(opts.receiverName || '').trim() || !String(opts.receiverPhone || '').trim()) {
        return alert('수령인 성명과 연락처를 입력해 주세요.');
      }
      if (!String(opts.shippingZipCode || '').trim() || !String(opts.shippingAddressRoad || '').trim()) {
        return alert('배송지 우편번호·도로명을 확인해 주세요.');
      }
      if (!String(opts.shippingAddressDetail || '').trim()) {
        return alert('배송지 상세주소를 입력해 주세요.');
      }
    }
    if (detailItem.category === 'SIGN') {
      if (!String(opts.companyName || '').trim()) {
        return alert('현판 신청 회사를 입력해 주세요.');
      }
      const projectOrOrg = String(opts.certType || '').includes('ISO')
        ? String(opts.isoCompanyName || '').trim()
        : String(opts.projectName || '').trim();
      if (!projectOrOrg) {
        return alert('프로젝트명/건물명/경영시스템 조직명을 입력해 주세요.');
      }
    }
    if (detailItem.category === 'PRINT') {
      if (!String(opts.printItemId || '').trim() && !String(opts.printItemType || '').trim()) {
        return alert('주문하실 소모품 종류를 선택해 주세요.');
      }
      if ((opts.printItemMasterInfo?.isCustom || opts.printCustomName) && !String(opts.printCustomName || '').trim()) {
        return alert('기타소모품 명칭/규격을 입력해 주세요.');
      }
    }
    if (!String(opts.vendor || '').trim()) {
      return alert('외주업체를 선택해 주세요.');
    }
    const shippingAddress = [
      opts.shippingZipCode && `[${opts.shippingZipCode}]`,
      opts.shippingAddressRoad,
      opts.shippingAddressDetail,
    ]
      .filter(Boolean)
      .join(' ');

    const customRequests = normalizeCustomRequests(opts.customRequests)
      .filter((r) => r.value.trim() !== '')
      .map(({ value }) => ({ value: value.trim() }));

    const formattedValidPeriod =
      detailItem.category === 'SIGN'
        ? displaySignValidPeriod(opts.formattedValidPeriod)
        : opts.formattedValidPeriod;

    setDetailSaving(true);
    try {
      const res = await fetch(editApiPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: detailItem.id,
          action: 'update',
          title,
          quantity: Math.max(1, Number(detailDraft.quantity) || 1),
          options: {
            ...opts,
            shippingAddress,
            customRequests,
            ...(detailItem.category === 'SIGN' ? { formattedValidPeriod } : {}),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '수정 저장에 실패했습니다.');
        return;
      }
      const updated = data.data || {
        ...detailItem,
        title,
        quantity: Math.max(1, Number(detailDraft.quantity) || 1),
        options: {
          ...opts,
          shippingAddress,
          customRequests,
          ...(detailItem.category === 'SIGN' ? { formattedValidPeriod } : {}),
        },
      };
      const merged = { ...detailItem, ...updated };
      setDetailItem(merged);
      setDetailEditing(false);
      setDetailDraft(null);
      onSaved?.(merged);
      alert('수정이 저장되었습니다.');
    } catch {
      alert('수정 저장 중 오류가 발생했습니다.');
    } finally {
      setDetailSaving(false);
    }
  };

  const handleClose = () => {
    cancelDetailEdit();
    onClose();
  };

  if (!detailItem) return null;

  return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-[10px] font-black tracking-widest text-blue-400 uppercase">
                  DEPARTMENTAL PRODUCTION SPECIFICATION
                </h3>
                <h2 className="text-xl font-black mt-0.5">
                  제작 신청서 상세 내역 ({detailItem.postNumber})
                </h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95"
              >
                닫기 ✕
              </button>
            </div>

            <div className="p-8 overflow-y-auto bg-slate-50 space-y-6 flex-1">
              
              {/* 블록 1. 기본 정보 */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <DetailSectionTitle title="기본 정보 및 계정 연동 상태" />
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight">
                    관리용 제목
                  </span>
                  {detailEditing ? (
                    <input
                      type="text"
                      value={detailDraft?.title || ''}
                      onChange={(e) =>
                        setDetailDraft((prev: any) => ({ ...prev, title: e.target.value }))
                      }
                      className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-blue-500"
                    />
                  ) : (
                    <div className="mt-1 text-sm font-black text-slate-800">
                      {detailItem.title || (
                        <span className="text-slate-300 font-medium">해당없음 / 미기입</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <DetailRow label="관리번호" value={detailItem.postNumber} highlight={false} />
                  <DetailRow
                    label="신청일"
                    highlight={false}
                    value={getKSTDateString(detailItem.createdAt)}
                  />
                  <DetailRow label="소속 부서" value={detailItem.deptName} highlight={false} />
                  <DetailRow label="신청자" value={detailItem.userName} highlight={false} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-1 border-t border-slate-100">
                  <DetailRow
                    label="외주업체"
                    highlight
                    value={
                      detailEditing ? (
                        <select
                          value={
                            vendorOptions.find((v) => v.label === detailDraft?.options?.vendor)?.id ||
                            ''
                          }
                          onChange={(e) => {
                            const v = vendorOptions.find((x) => x.id === e.target.value);
                            patchDraftOptions({ vendor: v?.label || '' });
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-800 outline-none cursor-pointer"
                        >
                          <option value="">외주업체 선택</option>
                          {vendorOptions.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        detailItem.options?.vendor
                      )
                    }
                  />
                  <DetailRow
                    label="업무 분류"
                    highlight={false}
                    value={getCategoryLabel(detailItem.category)}
                  />
                  <DetailRow
                    label={detailItem.category === 'OFFICE_SUPPLIES' ? '건' : '신청 총 수량'}
                    highlight
                    value={
                      detailEditing && detailItem.category !== 'OFFICE_SUPPLIES' ? (
                        <input
                          type="number"
                          min={1}
                          value={detailDraft?.quantity || 1}
                          onChange={(e) =>
                            setDetailDraft((prev: any) => ({
                              ...prev,
                              quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                            }))
                          }
                          className="w-24 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-black text-slate-800 outline-none"
                        />
                      ) : (
                        `${detailItem.quantity} ${formatQuantityUnit(detailItem)}`
                      )
                    }
                  />
                  {/* 윗줄 4열(신청자)과 세로 맞춤 — 빈 칸 */}
                  <div className="hidden lg:block" aria-hidden />
                </div>
              </div>

              {/* 블록 2. 💥 카테고리별 다이나믹 전용 스펙 분기 렌더링 구역 */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                
                {/* CASE A: 현판 / 명판 / 상패 (SIGN) */}
                {detailItem.category === 'SIGN' && (
                  <div className="animate-fade-in space-y-4">
                    <DetailSectionTitle title="📛 현판 / 명판 / 상패 제작 및 인증 세부 명세" />
                    {detailEditing ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            1. 인증의 종류
                          </label>
                          <select
                            value={detailDraft?.options?.certType || ''}
                            onChange={(e) => {
                              const cert = certOptions.find(
                                (c) => c.type === 'SIGN' && c.label === e.target.value
                              );
                              const grades = cert?.grades || [];
                              patchDraftOptions({
                                certType: e.target.value,
                                certLevel: grades[0] || '',
                              });
                            }}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer"
                          >
                            <option value="">인증 선택</option>
                            {certOptions
                              .filter((c) => c.type === 'SIGN')
                              .map((c) => (
                                <option key={c.certId} value={c.label}>
                                  {c.label}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            2. 인증 등급/종류 설정
                          </label>
                          {(() => {
                            const grades =
                              certOptions.find(
                                (c) =>
                                  c.type === 'SIGN' &&
                                  c.label === detailDraft?.options?.certType
                              )?.grades || [];
                            if (grades.length > 0) {
                              return (
                                <select
                                  value={detailDraft?.options?.certLevel || ''}
                                  onChange={(e) =>
                                    patchDraftOptions({ certLevel: e.target.value })
                                  }
                                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer"
                                >
                                  {grades.map((g) => (
                                    <option key={g} value={g}>
                                      {g}
                                    </option>
                                  ))}
                                </select>
                              );
                            }
                            return (
                              <input
                                type="text"
                                value={detailDraft?.options?.certLevel || ''}
                                onChange={(e) =>
                                  patchDraftOptions({ certLevel: e.target.value })
                                }
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                              />
                            );
                          })()}
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            3. 현판 품목 설정
                          </label>
                          <select
                            value={detailDraft?.options?.plateMasterInfo?.code || ''}
                            onChange={(e) => {
                              const p = plateOptions.find((x) => x.code === e.target.value);
                              patchDraftOptions({
                                plateType: p?.code || '',
                                plateMasterInfo: p
                                  ? {
                                      code: p.code,
                                      label: p.label,
                                      size: p.size,
                                      price: p.price,
                                    }
                                  : null,
                              });
                            }}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer"
                          >
                            <option value="">품목 선택</option>
                            {plateOptions.map((p) => (
                              <option key={p.code} value={p.code}>
                                {p.label} ({p.size})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            4. 프로젝트명/건물명/경영시스템 조직명{' '}
                            <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={
                              String(detailDraft?.options?.certType || '').includes('ISO')
                                ? detailDraft?.options?.isoCompanyName || ''
                                : detailDraft?.options?.projectName || ''
                            }
                            onChange={(e) =>
                              patchDraftOptions(
                                String(detailDraft?.options?.certType || '').includes('ISO')
                                  ? { isoCompanyName: e.target.value }
                                  : { projectName: e.target.value }
                              )
                            }
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            5. 인증번호
                          </label>
                          <input
                            type="text"
                            value={detailDraft?.options?.certNumber || ''}
                            onChange={(e) =>
                              patchDraftOptions({ certNumber: e.target.value })
                            }
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            6. 현판 유효기간
                          </label>
                          <input
                            type="text"
                            value={detailDraft?.options?.formattedValidPeriod || ''}
                            onChange={(e) =>
                              patchDraftOptions({ formattedValidPeriod: e.target.value })
                            }
                            placeholder="출력 양식 문자열"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <DetailRow
                          label="1. 인증의 종류"
                          value={detailItem.options?.certType}
                        />
                        <DetailRow
                          label="2. 인증 등급/종류 설정"
                          value={detailItem.options?.certLevel}
                        />
                        <DetailRow
                          label="3. 현판 품목 설정"
                          value={
                            detailItem.options?.plateMasterInfo
                              ? `${detailItem.options.plateMasterInfo.label} (${detailItem.options.plateMasterInfo.size})`
                              : null
                          }
                        />
                        <DetailRow
                          label="4. 프로젝트명/건물명/경영시스템 조직명"
                          value={
                            String(detailItem.options?.certType || '').includes('ISO')
                              ? detailItem.options?.isoCompanyName
                              : detailItem.options?.projectName
                          }
                        />
                        <DetailRow
                          label="5. 인증번호"
                          value={detailItem.options?.certNumber}
                        />
                        <DetailRow
                          label="6. 현판 유효기간"
                          value={displaySignValidPeriod(
                            detailItem.options?.formattedValidPeriod
                          ) || null}
                          highlight
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* CASE B: 제본 (JEBON) — 신청 탭과 동일 순서·번호 */}
                {detailItem.category === 'JEBON' && (
                  <div className="animate-fade-in space-y-6">
                    <DetailSectionTitle title="📚 제본 인쇄 도서 제작 명세" />
                    {detailEditing ? (
                      <div className="space-y-6">
                        {/* 1. 제본 종류 · 2. 인증의 단계 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-black text-slate-400 mb-1">
                              {jebonFormSteps.certType}. 제본 종류 선택
                            </label>
                            <select
                              value={detailDraft?.options?.certType || ''}
                              onChange={(e) => {
                                const nextLabel = e.target.value;
                                const nextIsNormal = isJebonNormalCert(nextLabel);
                                patchDraftOptions({
                                  certType: nextLabel,
                                  certPhase: nextIsNormal
                                    ? '해당없음'
                                    : detailDraft?.options?.certPhase === '해당없음'
                                      ? '예비인증'
                                      : detailDraft?.options?.certPhase || '예비인증',
                                });
                              }}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer"
                            >
                              <option value="">제본 종류 선택</option>
                              {certOptions
                                .filter((c) => c.type === 'JEBON')
                                .map((c) => (
                                  <option key={c.certId} value={c.label}>
                                    {c.label}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 mb-1">
                                {jebonFormSteps.certPhase}. 인증의 단계
                              </label>
                              <select
                                value={
                                  detailDraft?.options?.certPhase ||
                                  (jebonIsNormal ? '해당없음' : '예비인증')
                                }
                                onChange={(e) =>
                                  patchDraftOptions({ certPhase: e.target.value })
                                }
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer"
                              >
                                <option value="해당없음">해당없음</option>
                                <option value="예비인증">예비인증</option>
                                <option value="본인증">본인증</option>
                              </select>
                            </div>
                        </div>

                        {/* 판형 · 표지 · 본문 — 3열 */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                          <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 space-y-2">
                            <div className="text-[10px] font-black text-slate-500 tracking-widest uppercase">
                              📏 {jebonFormSteps.size}. 제본 판형 지정
                            </div>
                            <label className="block text-[10px] font-black text-slate-400 mb-1">
                              종류
                            </label>
                            <input
                              type="text"
                              value={detailDraft?.options?.jebonSizeType || ''}
                              onChange={(e) =>
                                patchDraftOptions({ jebonSizeType: e.target.value })
                              }
                              placeholder="예: A4, B5, 비규격"
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none"
                            />
                            <label className="block text-[10px] font-black text-slate-400 mb-1">
                              치수
                            </label>
                            <input
                              type="text"
                              value={detailDraft?.options?.jebonSize || ''}
                              onChange={(e) =>
                                patchDraftOptions({ jebonSize: e.target.value })
                              }
                              placeholder="예: 210 × 297mm"
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none"
                            />
                          </div>
                          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                            <div className="text-[10px] font-black text-slate-500 tracking-widest uppercase">
                              📘 {jebonFormSteps.cover}. 표지 (Cover) 스펙
                            </div>
                            <label className="block text-[10px] font-black text-slate-400 mb-1">
                              인쇄 방식
                            </label>
                            <select
                              value={detailDraft?.options?.coverColor || '컬러'}
                              onChange={(e) =>
                                patchDraftOptions({ coverColor: e.target.value })
                              }
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none"
                            >
                              <option value="컬러">컬러 인쇄</option>
                              <option value="흑백">흑백 인쇄</option>
                            </select>
                            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                              <input
                                type="checkbox"
                                checked={!!detailDraft?.options?.coverPageFromAttachment}
                                onChange={(e) =>
                                  patchDraftOptions({
                                    coverPageFromAttachment: e.target.checked,
                                    coverPageCount: e.target.checked
                                      ? ''
                                      : detailDraft?.options?.coverPageCount || '',
                                  })
                                }
                              />
                              면수는 첨부파일에 따름
                            </label>
                            {!detailDraft?.options?.coverPageFromAttachment && (
                              <input
                                type="number"
                                value={detailDraft?.options?.coverPageCount || ''}
                                onChange={(e) =>
                                  patchDraftOptions({ coverPageCount: e.target.value })
                                }
                                placeholder="면수 (ex. PDF 페이지 쪽수)"
                                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                              />
                            )}
                          </div>
                          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                            <div className="text-[10px] font-black text-slate-500 tracking-widest uppercase">
                              📄 {jebonFormSteps.inner}. 본문 (Inner) 스펙
                            </div>
                            <label className="block text-[10px] font-black text-slate-400 mb-1">
                              인쇄 방식
                            </label>
                            <select
                              value={detailDraft?.options?.innerColor || '흑백'}
                              onChange={(e) =>
                                patchDraftOptions({ innerColor: e.target.value })
                              }
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none"
                            >
                              <option value="컬러">컬러 인쇄</option>
                              <option value="흑백">흑백 인쇄</option>
                            </select>
                            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                              <input
                                type="checkbox"
                                checked={!!detailDraft?.options?.innerPageFromAttachment}
                                onChange={(e) =>
                                  patchDraftOptions({
                                    innerPageFromAttachment: e.target.checked,
                                    innerPageCount: e.target.checked
                                      ? ''
                                      : detailDraft?.options?.innerPageCount || '',
                                  })
                                }
                              />
                              면수는 첨부파일에 따름
                            </label>
                            {!detailDraft?.options?.innerPageFromAttachment && (
                              <input
                                type="number"
                                value={detailDraft?.options?.innerPageCount || ''}
                                onChange={(e) =>
                                  patchDraftOptions({ innerPageCount: e.target.value })
                                }
                                placeholder="면수 (ex. PDF 페이지 쪽수)"
                                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                              />
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            {jebonFormSteps.building}. 프로젝트명/건물명/표지제목
                          </label>
                          <input
                            type="text"
                            value={
                              detailDraft?.options?.jebonBuildingName ||
                              detailDraft?.options?.coverName ||
                              ''
                            }
                            onChange={(e) =>
                              patchDraftOptions({
                                jebonBuildingName: e.target.value,
                                coverName: e.target.value,
                              })
                            }
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            {jebonFormSteps.coverDate}. 표지 일자(인증 완료일 등){' '}
                            <span className="text-slate-300 font-medium">(선택)</span>
                          </label>
                          <input
                            type="text"
                            value={detailDraft?.options?.formattedCompDate || ''}
                            onChange={(e) =>
                              patchDraftOptions({ formattedCompDate: e.target.value })
                            }
                            className="w-full border rounded-xl px-3 py-2 text-xs font-semibold outline-none bg-white border-slate-200"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {/* 1. 제본 종류 · 2. 인증의 단계 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <DetailRow
                            label={`${jebonFormSteps.certType}. 제본 종류 선택`}
                            value={detailItem.options?.certType}
                          />
                          <DetailRow
                            label={`${jebonFormSteps.certPhase}. 인증의 단계`}
                            value={
                              detailItem.options?.certPhase ||
                              (jebonIsNormal ? '해당없음' : undefined)
                            }
                          />
                        </div>

                        {/* 판형 · 표지 · 본문 — 3열 */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm space-y-2">
                            <div className="text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1">
                              📏 {jebonFormSteps.size}. 제본 판형 지정
                            </div>
                            <DetailRow label="종류" value={jebonSizeDisplay.kind} />
                            <DetailRow label="치수" value={jebonSizeDisplay.spec} />
                          </div>
                          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm space-y-2">
                            <div className="text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1">
                              📘 {jebonFormSteps.cover}. 표지 (Cover) 스펙
                            </div>
                            <DetailRow label="인쇄 방식" value={detailItem.options?.coverColor} />
                            <DetailRow
                              label="면수 (ex. PDF 페이지 쪽수)"
                              value={
                                detailItem.options?.coverPageFromAttachment
                                  ? '면수는 첨부파일에 따름'
                                  : detailItem.options?.coverPageCount
                                    ? `${detailItem.options.coverPageCount} 면`
                                    : null
                              }
                            />
                          </div>
                          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm space-y-2">
                            <div className="text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1">
                              📄 {jebonFormSteps.inner}. 본문 (Inner) 스펙
                            </div>
                            <DetailRow label="인쇄 방식" value={detailItem.options?.innerColor} />
                            <DetailRow
                              label="면수 (ex. PDF 페이지 쪽수)"
                              value={
                                detailItem.options?.innerPageFromAttachment
                                  ? '면수는 첨부파일에 따름'
                                  : detailItem.options?.innerPageCount
                                    ? `${detailItem.options.innerPageCount} 면`
                                    : null
                              }
                            />
                          </div>
                        </div>

                        <DetailRow
                          label={`${jebonFormSteps.building}. 프로젝트명/건물명/표지제목`}
                          value={
                            detailItem.options?.jebonBuildingName ||
                            detailItem.options?.coverName
                          }
                        />

                        <DetailRow
                          label={`${jebonFormSteps.coverDate}. 표지 일자(인증 완료일 등)`}
                          value={detailItem.options?.formattedCompDate}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* CASE C: 기성품 / 기타 제작물 (PRINT) 전용 화면 */}
                {detailItem.category === 'PRINT' && (
                  <div className="animate-fade-in space-y-4">
                    <DetailSectionTitle title="📜 기성서식 및 제작성 소모품 청구 명세" />
                    {detailEditing ? (
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <label className="block text-[10px] font-black text-slate-400 mb-2">
                              1. 주문 물품 선택
                            </label>
                            <select
                              value={selectedDraftPrintItem?.id || ''}
                              onChange={(e) => applyDraftPrintItemSelection(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold outline-none cursor-pointer"
                            >
                              <option value="">주문 물품을 선택해 주세요</option>
                              {printItemOptions.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                  {printItemReferenceText(item) ? ` ${printItemReferenceText(item)}` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-black text-slate-400 mb-2">
                              {isDraftPrintCustomItem
                                ? '1. 기타소모품 명칭/규격 직접 기재'
                                : '선택 물품 정보/규격'}
                            </label>
                            {isDraftPrintCustomItem ? (
                              <div className="relative animate-fade-in">
                                <input
                                  type="text"
                                  placeholder="직접 기재"
                                  value={detailDraft?.options?.printCustomName || ''}
                                  onChange={(e) =>
                                    patchDraftOptions({ printCustomName: e.target.value })
                                  }
                                  className="w-full bg-white border-2 border-purple-400 focus:border-purple-600 focus:ring-2 focus:ring-purple-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none shadow-sm text-purple-900"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-purple-500 bg-purple-50 px-2 py-0.5 rounded-md">
                                  입력모드
                                </span>
                              </div>
                            ) : (
                              <div className="w-full bg-slate-100/80 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-500 flex items-center justify-between gap-2 shadow-inner">
                                <span className="text-slate-700">
                                  {selectedDraftPrintItem
                                    ? [selectedDraftPrintItem.name, selectedDraftPrintItem.size]
                                        .filter(Boolean)
                                        .join(' ')
                                    : detailDraft?.options?.printItemType || '—'}
                                </span>
                                <span className="text-[10px] text-slate-400 font-bold tracking-wider shrink-0">
                                  ✔️ 선택사항 확인
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-black text-slate-400 mb-2">
                              2. 인쇄 제작 문구1
                            </label>
                            <input
                              type="text"
                              placeholder="예: 앞면 비고 또는 뒷면 비고 등"
                              value={detailDraft?.options?.printItemDetails || ''}
                              onChange={(e) =>
                                patchDraftOptions({ printItemDetails: e.target.value })
                              }
                              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-medium outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-black text-slate-400 mb-2">
                              3. 인쇄 제작 문구2
                            </label>
                            <input
                              type="text"
                              placeholder="예: 앞면 비고 또는 뒷면 비고 등"
                              value={detailDraft?.options?.printDeliveryDetails || ''}
                              onChange={(e) =>
                                patchDraftOptions({ printDeliveryDetails: e.target.value })
                              }
                              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-medium outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <DetailRow
                          label="선택 물품 정보/규격"
                          value={formatPrintItemInfoSpec(
                            (detailItem.options || {}) as Record<string, unknown>
                          )}
                          highlight
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <DetailRow label="2. 인쇄 제작 문구1" value={detailItem.options?.printItemDetails} />
                          <DetailRow label="3. 인쇄 제작 문구2" value={detailItem.options?.printDeliveryDetails} />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* CASE D: 사무문구류 정산 (OFFICE_SUPPLIES) 전용 화면 */}
                {detailItem.category === 'OFFICE_SUPPLIES' && (
                  <div className="animate-fade-in space-y-4">
                    <DetailSectionTitle title="📎 외부 문구사 견적 파일 텍스트 캡처 본문" />
                    <div className="bg-slate-900 text-emerald-400 p-4 rounded-xl font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto shadow-inner border border-slate-800">
                      {detailItem.options?.suppliesQuoteRawText || '저장된 텍스트 데이터가 비어 있습니다.'}
                    </div>
                  </div>
                )}

              </div>

              {/* 블록 3. 추가 제작 변수 (배송지보다 위) */}
              {detailItem.category !== 'OFFICE_SUPPLIES' &&
                (detailEditing ||
                  (Array.isArray(detailItem.options?.customRequests) &&
                    detailItem.options.customRequests.length > 0)) && (
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                  <div className="flex justify-between items-center gap-2">
                    <h4 className="font-black text-slate-800 text-sm tracking-tight flex items-center gap-1.5">
                      <span className="w-1.5 h-3.5 bg-blue-600 rounded-sm" />
                      {detailItem.category === 'JEBON'
                        ? `${jebonFormSteps.customRequest}. `
                        : detailItem.category === 'PRINT'
                          ? '4. '
                          : detailItem.category === 'SIGN'
                            ? '7. '
                            : ''}
                      ➕ 추가 제작 변수
                    </h4>
                    {detailEditing && (
                      <button
                        type="button"
                        onClick={() =>
                          patchDraftOptions({
                            customRequests: [
                              ...normalizeCustomRequests(detailDraft?.options?.customRequests),
                              { id: Date.now(), value: '' },
                            ],
                          })
                        }
                        className="px-2 py-0.5 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 border border-yellow-300 rounded-md font-black text-[10px] flex items-center gap-1 transition-all shrink-0"
                      >
                        ➕ 추가
                      </button>
                    )}
                  </div>
                  <div className="border-b border-slate-100" />
                  {detailEditing ? (
                    <div className="space-y-2">
                      <p className="text-[9px] text-slate-400 font-bold leading-snug">
                        「➕ 추가」로 행을 만든 뒤, 내용을 입력한 항목만 저장됩니다. 신청 시 누락했거나 잘못 입력한 항목도 여기서 수정할 수 있습니다.
                      </p>
                      {normalizeCustomRequests(detailDraft?.options?.customRequests).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-2.5 text-center text-[10px] font-bold text-slate-400">
                          추가할 요청사항이 있으면 우측 「➕ 추가」를 눌러주세요.
                        </div>
                      ) : (
                        normalizeCustomRequests(detailDraft?.options?.customRequests).map(
                          (req, index) => (
                            <div key={req.id} className="flex items-center gap-2">
                              <span className="text-slate-400 font-mono font-bold w-3.5 shrink-0 text-right text-[10px]">
                                {index + 1}.
                              </span>
                              <input
                                type="text"
                                placeholder="요청 사항 혹은 프리뷰 문구 보조 제어 스펙 등 자유롭게 기재"
                                value={req.value}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  const next = normalizeCustomRequests(
                                    detailDraft?.options?.customRequests
                                  ).map((c) => (c.id === req.id ? { ...c, value } : c));
                                  patchDraftOptions({ customRequests: next });
                                }}
                                className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-semibold text-slate-800 outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = normalizeCustomRequests(
                                    detailDraft?.options?.customRequests
                                  ).filter((c) => c.id !== req.id);
                                  patchDraftOptions({ customRequests: next });
                                }}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0 text-sm"
                                title="이 행 삭제"
                              >
                                🗑️
                              </button>
                            </div>
                          )
                        )
                      )}
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5 font-bold">
                      {normalizeCustomRequests(detailItem.options?.customRequests).map(
                        (req, i) => (
                          <div key={req.id} className="flex gap-2 text-xs">
                            <span className="text-slate-400 font-mono">{i + 1}.</span>
                            <span className="text-slate-800">{req.value}</span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 블록 4. 배송지 */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                  <DetailSectionTitle title="🚚 최종 제작 사양 배송 주소지" />
                  {isHqReceiveShip({
                    category: detailItem.category,
                    options: detailEditing ? detailDraft?.options : detailItem.options,
                  }) ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700 space-y-1">
                      <p>
                        {resolveDeliveryMode({
                          category: detailItem.category,
                          options: detailEditing ? detailDraft?.options : detailItem.options,
                        }) === 'HQ_RECEIVE'
                          ? '☑ 인증원 수령/묶음 발주'
                          : '배송지 부서 대장 입력'}
                      </p>
                      <p className="text-slate-500 font-medium">
                        신청 시 개별 배송지 미기재 — 부서 발주 시 입력
                      </p>
                    </div>
                  ) : detailEditing ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">수령인 성명</label>
                          <input
                            type="text"
                            value={detailDraft?.options?.receiverName || ''}
                            onChange={(e) =>
                              setDetailDraft((prev: any) => ({
                                ...prev,
                                options: { ...prev.options, receiverName: e.target.value },
                              }))
                            }
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">수령인 연락처</label>
                          <input
                            type="text"
                            value={detailDraft?.options?.receiverPhone || ''}
                            onChange={(e) =>
                              setDetailDraft((prev: any) => ({
                                ...prev,
                                options: { ...prev.options, receiverPhone: e.target.value },
                              }))
                            }
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1">
                            전사 공통 주소
                          </label>
                          <select
                            value={
                              companyAddresses.find(
                                (a) => a.label === detailDraft?.options?.companyAddressLabel
                              )?.id ||
                              detailDraft?.options?.selectedCompanyAddressId ||
                              ''
                            }
                            onChange={(e) => applyCompanyAddressToDraft(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none cursor-pointer"
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
                      </div>
                      <div className="flex flex-wrap gap-2 items-stretch">
                        <div className="flex items-center gap-1.5 shrink-0 bg-slate-50 border border-slate-200 rounded-xl px-2.5 h-10">
                          <span className="text-[9px] font-black text-slate-400">우편</span>
                          <input
                            type="text"
                            value={detailDraft?.options?.shippingZipCode || ''}
                            onChange={(e) =>
                              setDetailDraft((prev: any) => ({
                                ...prev,
                                options: {
                                  ...prev.options,
                                  shippingZipCode: e.target.value,
                                  companyAddressLabel: '',
                                  selectedCompanyAddressId: '',
                                },
                              }))
                            }
                            className="w-14 font-mono text-center text-xs font-black text-slate-800 bg-transparent outline-none"
                          />
                        </div>
                        <input
                          type="text"
                          value={detailDraft?.options?.shippingAddressRoad || ''}
                          onChange={(e) =>
                            setDetailDraft((prev: any) => ({
                              ...prev,
                              options: {
                                ...prev.options,
                                shippingAddressRoad: e.target.value,
                                companyAddressLabel: '',
                                selectedCompanyAddressId: '',
                              },
                            }))
                          }
                          placeholder="도로명 주소"
                          className="flex-[2] min-w-[12rem] h-10 px-3 border border-slate-200 rounded-xl bg-slate-50 text-xs font-bold text-slate-800 outline-none"
                        />
                        <div className="flex items-center gap-1.5 flex-[1.2] min-w-[12rem] max-w-[22rem] bg-slate-50 border border-slate-200 rounded-xl px-2.5 h-10">
                          <span className="text-[9px] font-black text-slate-500 shrink-0">상세</span>
                          <input
                            type="text"
                            value={detailDraft?.options?.shippingAddressDetail || ''}
                            onChange={(e) =>
                              setDetailDraft((prev: any) => ({
                                ...prev,
                                options: {
                                  ...prev.options,
                                  shippingAddressDetail: e.target.value,
                                },
                              }))
                            }
                            placeholder="동·호수 등"
                            className="min-w-0 flex-1 text-xs font-semibold text-slate-800 outline-none bg-transparent"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <DetailRow
                        label="수령인 성명"
                        value={detailItem.options?.receiverName}
                        highlight={false}
                      />
                      <DetailRow
                        label="수령인 연락처"
                        value={detailItem.options?.receiverPhone}
                        highlight={false}
                      />
                      <DetailRow
                        label="전사 공통 주소"
                        value={
                          detailItem.options?.companyAddressLabel ||
                          '직접 입력 / 주소 검색'
                        }
                        highlight={false}
                      />
                      <div className="col-span-1 md:col-span-3">
                        <DetailRow
                          label="배송지 (우편번호·도로명·상세)"
                          value={
                            detailItem.options?.shippingAddress ||
                            [
                              detailItem.options?.shippingZipCode &&
                                `[${detailItem.options.shippingZipCode}]`,
                              detailItem.options?.shippingAddressRoad,
                              detailItem.options?.shippingAddressDetail,
                            ]
                              .filter(Boolean)
                              .join(' ')
                          }
                          highlight={false}
                        />
                      </div>
                    </div>
                  )}
                </div>

              {/* 시스템 내부 보조 서식 — 현판(SIGN)만 */}
              {detailItem.category === 'SIGN' && (
                <div className="bg-slate-200/50 p-6 rounded-2xl border border-slate-300 shadow-inner space-y-3">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    INTERNAL SYSTEM ONLY
                  </div>
                  <div className="text-xs font-black text-slate-700">
                    🔒 시스템 내부 보관 보조 서식 (외주 발주서 제외 항목)
                  </div>
                  {detailEditing ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 mb-1">
                          현판 신청 회사 *
                        </label>
                        <input
                          type="text"
                          value={detailDraft?.options?.companyName || ''}
                          onChange={(e) =>
                            patchDraftOptions({ companyName: e.target.value })
                          }
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 mb-1">
                          신청인 정보
                        </label>
                        <input
                          type="text"
                          value={detailDraft?.options?.applicantName || ''}
                          onChange={(e) =>
                            patchDraftOptions({ applicantName: e.target.value })
                          }
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 mb-1">
                          기타
                        </label>
                        <input
                          type="text"
                          value={detailDraft?.options?.applicantPhone || ''}
                          onChange={(e) =>
                            patchDraftOptions({ applicantPhone: e.target.value })
                          }
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                      <DetailRow
                        label="현판 신청 회사"
                        value={detailItem.options?.companyName}
                        highlight={false}
                      />
                      <DetailRow
                        label="신청인 정보"
                        value={detailItem.options?.applicantName}
                        highlight={false}
                      />
                      <DetailRow
                        label="기타"
                        value={detailItem.options?.applicantPhone}
                        highlight={false}
                      />
                    </div>
                  )}
                </div>
              )}

            </div>
            
            <div className="p-5 bg-white border-t border-slate-200 mt-auto shrink-0 flex flex-wrap justify-end gap-2">
              {canShowEdit && !detailEditing && (
                <button
                  type="button"
                  onClick={startDetailEdit}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs transition-colors shadow-md"
                >
                  수정
                </button>
              )}
              {canShowEdit && detailEditing && (
                <>
                  <button
                    type="button"
                    onClick={cancelDetailEdit}
                    disabled={detailSaving}
                    className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black text-xs transition-colors"
                  >
                    수정 취소
                  </button>
                  <button
                    type="button"
                    onClick={saveDetailEdit}
                    disabled={detailSaving}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs transition-colors shadow-md disabled:opacity-50"
                  >
                    {detailSaving ? '저장 중…' : '수정 확인'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-xs transition-colors shadow-md"
              >
                확인 완료
              </button>
            </div>
          </div>
        </div>
  );
}
