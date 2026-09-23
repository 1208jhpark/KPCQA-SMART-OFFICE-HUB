/**
 * 마케팅 고객사 주소 표시/정규화 공통
 * - DB: zip_code + address_road + address_detail (+ location 합본 스냅샷)
 * - 제작 실배송지 연동 시: zip→shippingZipCode, road→shippingAddressRoad, detail→shippingAddressDetail
 */

export type MarketingClientAddressParts = {
  zip_code?: string | null;
  address_road?: string | null;
  address_detail?: string | null;
  /** 레거시 단일 소재지 — 분리값이 없을 때 폴백 */
  location?: string | null;
};

function cleanPart(v: unknown): string {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s || s === '-' || s === '—') return '';
  return s;
}

export function normalizeMarketingZip(v: unknown): string | null {
  const s = cleanPart(v).replace(/[^\d]/g, '');
  if (!s) return null;
  // 5자리 우편번호 (앞에 0 유지)
  if (/^\d{5}$/.test(s)) return s;
  if (/^\d{5,6}$/.test(s)) return s.slice(0, 5);
  return s || null;
}

export function normalizeMarketingRoad(v: unknown): string | null {
  const s = cleanPart(v);
  return s || null;
}

export function normalizeMarketingDetail(v: unknown): string | null {
  const s = cleanPart(v);
  return s || null;
}

/** 목록·엑셀·라이트 선택 UI용 합친 소재지 */
export function formatMarketingClientLocation(parts: MarketingClientAddressParts): string {
  const zip = normalizeMarketingZip(parts.zip_code) || '';
  const road = normalizeMarketingRoad(parts.address_road) || '';
  const detail = normalizeMarketingDetail(parts.address_detail) || '';
  const body = [road, detail].filter(Boolean).join(' ');
  if (zip || body) {
    return [zip, body].filter(Boolean).join(' ').trim();
  }
  return cleanPart(parts.location);
}

/** POST/PATCH/시드 공통 — 분리값 + location 스냅샷 */
export function buildMarketingClientAddressData(input: {
  zip_code?: unknown;
  address_road?: unknown;
  address_detail?: unknown;
  /** 레거시: location만 오면 road로 취급 */
  location?: unknown;
}) {
  const zip_code = normalizeMarketingZip(input.zip_code);
  let address_road = normalizeMarketingRoad(input.address_road);
  const address_detail = normalizeMarketingDetail(input.address_detail);
  if (!address_road && !address_detail && !zip_code) {
    address_road = normalizeMarketingRoad(input.location);
  }
  const location =
    formatMarketingClientLocation({ zip_code, address_road, address_detail }) || null;
  return { zip_code, address_road, address_detail, location };
}
