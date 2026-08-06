/** 폐기 시 etc_memo 에 넣는 래퍼 여부 */
export function isArchiveMemoWrapper(parsed: unknown): parsed is Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const o = parsed as Record<string, unknown>;
  return (
    'archiveReason' in o ||
    'sourceEquipmentId' in o ||
    'sourceAssetNo' in o ||
    ('originalMemo' in o && ('archiveReason' in o || 'sourceEquipmentId' in o))
  );
}

/**
 * 폐기 JSON 래퍼 해제.
 * - 래퍼면 originalMemo 만 반환 (없으면 '')
 * - 일반 텍스트/기타 JSON 이면 그대로
 */
export function unwrapEquipmentEtcMemo(raw: string | null | undefined): string {
  const text = raw == null ? '' : String(raw);
  if (!text.trim()) return '';
  try {
    const parsed = JSON.parse(text);
    if (isArchiveMemoWrapper(parsed)) {
      return parsed.originalMemo != null ? String(parsed.originalMemo) : '';
    }
  } catch {
    /* plain text */
  }
  return text;
}

export function parseEquipmentArchiveMemo(raw: string | null | undefined): {
  originalMemo: string;
  archiveReason: string;
  sourceEquipmentId: string | null;
  sourceAssetNo: string | null;
  isWrapper: boolean;
  /** 화면 표시용: 폐기함=사유, 그 외=원문/원본메모 */
  displayText: string;
} {
  const text = raw == null ? '' : String(raw);
  if (!text.trim()) {
    return {
      originalMemo: '',
      archiveReason: '',
      sourceEquipmentId: null,
      sourceAssetNo: null,
      isWrapper: false,
      displayText: '',
    };
  }
  try {
    const parsed = JSON.parse(text);
    if (isArchiveMemoWrapper(parsed)) {
      const originalMemo = parsed.originalMemo != null ? String(parsed.originalMemo) : '';
      const archiveReason = parsed.archiveReason != null ? String(parsed.archiveReason) : '';
      return {
        originalMemo,
        archiveReason,
        sourceEquipmentId: parsed.sourceEquipmentId
          ? String(parsed.sourceEquipmentId)
          : null,
        sourceAssetNo: parsed.sourceAssetNo ? String(parsed.sourceAssetNo) : null,
        isWrapper: true,
        displayText: archiveReason || originalMemo || '',
      };
    }
  } catch {
    /* plain */
  }
  return {
    originalMemo: text,
    archiveReason: '',
    sourceEquipmentId: null,
    sourceAssetNo: null,
    isWrapper: false,
    displayText: text,
  };
}

export function buildArchiveEtcMemo(params: {
  existingMemo: string | null | undefined;
  reason: string;
  sourceEquipmentId: string;
  sourceAssetNo: string;
}): string {
  return JSON.stringify({
    originalMemo: unwrapEquipmentEtcMemo(params.existingMemo),
    archiveReason: params.reason,
    sourceEquipmentId: params.sourceEquipmentId,
    sourceAssetNo: params.sourceAssetNo,
  });
}
