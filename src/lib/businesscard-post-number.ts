import prisma from '@/lib/prisma';
import { getKSTDateString } from '@/utils/dateUtils';

/** 이메일 @ 앞부분 (표시·레거시용) */
export function emailLocalPart(email: string | null | undefined): string {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw || raw.startsWith('__unregistered')) return 'unregistered';
  const local = raw.split('@')[0] || '';
  const cleaned = local.replace(/[^a-z0-9._+-]/gi, '').slice(0, 64);
  return cleaned || 'unknown';
}

/**
 * 신청 관리번호 일련 추출
 * - 신규: BC-YYYYMMDD-NN (발주 PO-BC-YYYYMMDD-NN 와 동일, PO- 제외)
 * - 레거시: BC-YYYY-NNNN / BC-YYYY-NNNN-local
 */
export function parseBcSerial(postNumber: string | null | undefined): number {
  const s = String(postNumber || '').trim();
  if (!s.startsWith('BC-')) return 0;

  // 신규: BC-20261007-01
  const dayMatch = s.match(/^BC-(\d{8})-(\d+)$/);
  if (dayMatch) {
    const n = parseInt(dayMatch[2], 10);
    return Number.isFinite(n) ? n : 0;
  }

  // 레거시: BC-2026-0012[-local]
  const parts = s.split('-');
  if (parts.length < 3) return 0;
  const n = parseInt(parts[2], 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 예: BC-20261007-01
 * 발주 묶음 `PO-BC-20261007-01` 과 날짜·순서 규칙 동일 (PO- 접두만 없음).
 * 기존 `BC-YYYY-NNNN-local` 번호는 그대로 두고, 신규 건만 이 형식.
 */
export async function nextBusinessCardPostNumber(
  _applicantEmail?: string | null | undefined
) {
  const dayKey = getKSTDateString().replace(/-/g, '');
  const prefix = `BC-${dayKey}-`;
  const rows = await prisma.businessCardRequest.findMany({
    where: { postNumber: { startsWith: prefix } },
    select: { postNumber: true },
  });
  let maxSerial = 0;
  for (const row of rows) {
    const serial = parseBcSerial(row.postNumber);
    if (serial > maxSerial) maxSerial = serial;
  }
  const serial = String(maxSerial + 1).padStart(2, '0');
  return `${prefix}${serial}`;
}
