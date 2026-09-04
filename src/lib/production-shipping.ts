export type BatchShippingApplyScope = 'all' | 'deferred';

/** 신청 시 실배송지 모드 */
export type ProductionDeliveryMode = 'CUSTOMER_DIRECT' | 'HQ_RECEIVE';

export type BatchShippingInput = {
  receiverName: string;
  receiverPhone: string;
  shippingZipCode: string;
  shippingAddressRoad: string;
  shippingAddressDetail?: string;
  companyAddressLabel?: string;
};

export function buildProductionShippingAddress(data: {
  shippingZipCode?: string;
  shippingAddressRoad?: string;
  shippingAddressDetail?: string;
  shippingAddress?: string;
}) {
  const zip = String(data.shippingZipCode || '').trim();
  const road = String(data.shippingAddressRoad || '').trim();
  const detail = String(data.shippingAddressDetail || '').trim();
  if (zip && road) {
    return `[${zip}] ${road}${detail ? ` ${detail}` : ''}`;
  }
  return String(data.shippingAddress || '').trim();
}

export function hasProductionShippingAddress(
  opts: Record<string, unknown> | null | undefined
): boolean {
  if (!opts) return false;
  const receiver = String(opts.receiverName || '').trim();
  const phone = String(opts.receiverPhone || '').trim();
  const addr = buildProductionShippingAddress({
    shippingZipCode: String(opts.shippingZipCode || ''),
    shippingAddressRoad: String(opts.shippingAddressRoad || ''),
    shippingAddressDetail: String(opts.shippingAddressDetail || ''),
    shippingAddress: String(opts.shippingAddress || ''),
  });
  return Boolean(receiver && phone && addr);
}

export function resolveDeliveryMode(
  item: { category?: string; options?: Record<string, unknown> | null }
): ProductionDeliveryMode {
  const opts = (item.options || {}) as Record<string, unknown>;
  const raw = String(opts.deliveryMode || '').trim().toUpperCase();
  if (raw === 'CUSTOMER_DIRECT' || raw === 'HQ_RECEIVE') {
    return raw as ProductionDeliveryMode;
  }
  // 레거시: 제본 묶음발주 체크 / 현판·기타 기본 직발송 / 사무문구·제본 기본 인증원 수령
  if (opts.jebonBatchShipping === true) return 'HQ_RECEIVE';
  if (
    item.category === 'JEBON' ||
    item.category === 'OFFICE_SUPPLIES' ||
    item.category === 'PRINT'
  ) {
    return 'HQ_RECEIVE';
  }
  if (item.category === 'SIGN') return 'CUSTOMER_DIRECT';
  return 'CUSTOMER_DIRECT';
}

export function isCustomerDirectShip(item: {
  category?: string;
  options?: Record<string, unknown> | null;
}): boolean {
  return resolveDeliveryMode(item) === 'CUSTOMER_DIRECT';
}

export function isHqReceiveShip(item: {
  category?: string;
  options?: Record<string, unknown> | null;
}): boolean {
  return resolveDeliveryMode(item) === 'HQ_RECEIVE';
}

/** 부서 대장에서 배송지 입력하도록 미룬 건(인증원 수령 + 주소 미입력) */
export function itemDeferredBatchShipping(item: {
  category?: string;
  options?: Record<string, unknown> | null;
}): boolean {
  return isHqReceiveShip(item) && !hasProductionShippingAddress(item.options);
}

/** @deprecated use itemDeferredBatchShipping */
export function jebonItemDeferredBatchShipping(item: {
  category?: string;
  options?: Record<string, unknown> | null;
}): boolean {
  if (item.category !== 'JEBON') return false;
  return itemDeferredBatchShipping(item);
}

/** 묶음 발주 시 배송지 일괄 입력 대상 — 인증원 수령/묶음 발주 건은 발주 시 주소 입력 */
export function itemNeedsBatchShipping(item: {
  category?: string;
  options?: Record<string, unknown> | null;
}): boolean {
  if (isHqReceiveShip(item)) return true;
  return !hasProductionShippingAddress(item.options);
}

/** @deprecated use itemNeedsBatchShipping */
export function jebonItemNeedsBatchShipping(item: {
  category?: string;
  options?: Record<string, unknown> | null;
}): boolean {
  if (item.category !== 'JEBON') return false;
  return itemNeedsBatchShipping(item);
}

export function shouldApplyBatchShippingToItem(
  item: { category?: string; options?: Record<string, unknown> | null },
  scope: BatchShippingApplyScope
): boolean {
  if (scope === 'all') return true;
  return itemDeferredBatchShipping(item);
}

/** @deprecated use shouldApplyBatchShippingToItem */
export function shouldApplyBatchShippingToJebon(
  item: { category?: string; options?: Record<string, unknown> | null },
  scope: BatchShippingApplyScope
): boolean {
  if (item.category !== 'JEBON') return false;
  return shouldApplyBatchShippingToItem(item, scope);
}

export function mergeBatchShippingIntoOptions(
  prev: Record<string, unknown>,
  shipping: BatchShippingInput
): Record<string, unknown> {
  const shippingAddress = buildProductionShippingAddress({
    shippingZipCode: shipping.shippingZipCode,
    shippingAddressRoad: shipping.shippingAddressRoad,
    shippingAddressDetail: shipping.shippingAddressDetail,
  });
  return {
    ...prev,
    receiverName: shipping.receiverName.trim(),
    receiverPhone: shipping.receiverPhone.trim(),
    shippingZipCode: shipping.shippingZipCode.trim(),
    shippingAddressRoad: shipping.shippingAddressRoad.trim(),
    shippingAddressDetail: String(shipping.shippingAddressDetail || '').trim(),
    shippingAddress,
    companyAddressLabel: shipping.companyAddressLabel || '',
    jebonBatchShipping: false,
    deliveryMode: 'HQ_RECEIVE',
  };
}

export function validateBatchShippingInput(shipping: BatchShippingInput): string | null {
  if (!shipping.receiverName.trim()) return '수령인 성명을 입력해 주세요.';
  if (!shipping.receiverPhone.trim()) return '수령인 연락처를 입력해 주세요.';
  if (!shipping.shippingZipCode.trim() || !shipping.shippingAddressRoad.trim()) {
    return '우편번호 검색 또는 전사 공통 주소로 배송지를 입력해 주세요.';
  }
  return null;
}

export function isVendorDispatched(
  opts: Record<string, unknown> | null | undefined
): boolean {
  if (!opts) return false;
  return opts.vendorDispatched === true;
}

export function withVendorDispatched(
  prev: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...prev,
    vendorDispatched: true,
    vendorDispatchedAt: new Date().toISOString(),
  };
}
