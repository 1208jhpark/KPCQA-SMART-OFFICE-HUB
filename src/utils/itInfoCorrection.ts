export const INFO_CORRECTION_FIELDS = ['model', 'sn', 'brand', 'spec'] as const;
export type InfoCorrectionField = (typeof INFO_CORRECTION_FIELDS)[number];

export const INFO_CORRECTION_FIELD_LABELS: Record<InfoCorrectionField, string> = {
  model: '모델명',
  sn: 'S/N',
  brand: '제조사',
  spec: '기본 사양',
};

export type InfoCorrectionPending = {
  proposed: Partial<Record<InfoCorrectionField, string>>;
  changedKeys: InfoCorrectionField[];
  requestedAt: string;
  requestedBy?: string;
};

export function parseInfoCorrectionPending(raw: unknown): InfoCorrectionPending | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const proposedRaw = (obj.proposed && typeof obj.proposed === 'object' ? obj.proposed : obj) as Record<string, unknown>;
  const proposed: Partial<Record<InfoCorrectionField, string>> = {};
  INFO_CORRECTION_FIELDS.forEach((key) => {
    if (proposedRaw[key] !== undefined && proposedRaw[key] !== null) {
      proposed[key] = String(proposedRaw[key]);
    }
  });
  const changedKeys = (Array.isArray(obj.changedKeys) ? obj.changedKeys : Object.keys(proposed))
    .map(String)
    .filter((k): k is InfoCorrectionField => (INFO_CORRECTION_FIELDS as readonly string[]).includes(k));
  if (changedKeys.length === 0) return null;
  return {
    proposed,
    changedKeys,
    requestedAt: String(obj.requestedAt || ''),
    requestedBy: obj.requestedBy ? String(obj.requestedBy) : undefined,
  };
}

export function hasInfoCorrectionPending(asset: { info_correction_pending?: unknown } | null | undefined) {
  return !!parseInfoCorrectionPending(asset?.info_correction_pending);
}

/** 실사 완료 주체 라벨 — user/QR → 실사 완료, admin → 관리자 확인 (레거시 null은 사용자로 간주) */
export function getCompletedAuditLabel(lastAuditBy?: string | null): '실사 완료' | '관리자 확인' {
  return lastAuditBy === 'admin' ? '관리자 확인' : '실사 완료';
}

/** 표시용: 승인 대기 중이면 제안값(빨강), 아니면 원본 */
export function getDisplayFieldValue(
  asset: Record<string, any>,
  field: string
): { value: string; isPending: boolean } {
  if ((INFO_CORRECTION_FIELDS as readonly string[]).includes(field)) {
    const pending = parseInfoCorrectionPending(asset?.info_correction_pending);
    const key = field as InfoCorrectionField;
    if (pending?.changedKeys.includes(key) && pending.proposed[key] !== undefined) {
      return { value: pending.proposed[key] ?? '', isPending: true };
    }
  }
  const raw = asset?.[field];
  return { value: raw == null || raw === '' ? '' : String(raw), isPending: false };
}

export function buildInfoCorrectionPending(params: {
  original: Record<string, any>;
  draft: Record<InfoCorrectionField, string>;
  requestedAt: string;
  requestedBy?: string;
}): InfoCorrectionPending | null {
  const changedKeys = INFO_CORRECTION_FIELDS.filter((key) => {
    const before = String(params.original[key] ?? '').trim();
    const after = String(params.draft[key] ?? '').trim();
    return before !== after;
  });
  if (changedKeys.length === 0) return null;
  const proposed: Partial<Record<InfoCorrectionField, string>> = {};
  changedKeys.forEach((key) => {
    proposed[key] = String(params.draft[key] ?? '').trim();
  });
  return {
    proposed,
    changedKeys,
    requestedAt: params.requestedAt,
    requestedBy: params.requestedBy,
  };
}
