import QRCode from 'qrcode';

function appOrigin(): string {
  const raw =
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BASE_URL) ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  let base = String(raw || '').trim().replace(/\/$/, '');
  if (!base) return '';
  // 폰 카메라가 URL로 인식하려면 http(s):// 필수 (없으면 메모장/텍스트로만 열림)
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
}

/** 임의 문자열로 QR PNG data URL 생성 (외부 API 미사용) */
export async function generateQrDataUrl(payload: string, size = 250): Promise<string> {
  return QRCode.toDataURL(payload, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
}

export async function generateQrDataUrlMap(
  items: { key: string; payload: string }[],
  size = 150
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    items.map(async ({ key, payload }) => [key, await generateQrDataUrl(payload, size)] as const)
  );
  return Object.fromEntries(entries);
}

/** 장비 공개 검증 URL */
export function getEquipmentVerifyUrl(equipmentId: string): string {
  return `${appOrigin()}/equipment/verify?id=${encodeURIComponent(equipmentId)}`;
}

export async function generateEquipmentQrDataUrl(equipmentId: string, size = 250): Promise<string> {
  return generateQrDataUrl(getEquipmentVerifyUrl(equipmentId), size);
}

export async function generateEquipmentQrDataUrls(
  equipmentIds: string[],
  size = 150
): Promise<Record<string, string>> {
  return generateQrDataUrlMap(
    equipmentIds.map((id) => ({ key: id, payload: getEquipmentVerifyUrl(id) })),
    size
  );
}

/** IT 자산 모바일 검증 URL */
export function getItAssetVerifyUrl(assetCode: string): string {
  return `${appOrigin()}/m/verify?id=${encodeURIComponent(assetCode)}`;
}

export async function generateItAssetQrDataUrl(assetCode: string, size = 250): Promise<string> {
  return generateQrDataUrl(getItAssetVerifyUrl(assetCode), size);
}
