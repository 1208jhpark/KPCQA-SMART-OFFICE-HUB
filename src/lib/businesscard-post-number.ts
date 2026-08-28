import prisma from '@/lib/prisma';
import { getKSTNowYearMonth } from '@/utils/dateUtils';

/** 이메일 @ 앞부분 — 관리번호 접미사용 */
export function emailLocalPart(email: string | null | undefined): string {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw || raw.startsWith('__unregistered')) return 'unregistered';
  const local = raw.split('@')[0] || '';
  const cleaned = local.replace(/[^a-z0-9._+-]/gi, '').slice(0, 64);
  return cleaned || 'unknown';
}

/** BC-YYYY-NNNN 또는 BC-YYYY-NNNN-local 에서 일련번호 추출 */
export function parseBcSerial(postNumber: string | null | undefined): number {
  const parts = String(postNumber || '').split('-');
  if (parts.length < 3 || parts[0] !== 'BC') return 0;
  const n = parseInt(parts[2], 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 예: BC-2026-0015-hong
 * 동일 시리얼이어도 신청자 메일 local이 다르면 번호가 구분됩니다.
 */
export async function nextBusinessCardPostNumber(applicantEmail: string | null | undefined) {
  const currentYear = String(getKSTNowYearMonth().year);
  const prefix = `BC-${currentYear}-`;
  const rows = await prisma.businessCardRequest.findMany({
    where: { postNumber: { startsWith: prefix } },
    select: { postNumber: true },
  });
  let maxSerial = 0;
  for (const row of rows) {
    const serial = parseBcSerial(row.postNumber);
    if (serial > maxSerial) maxSerial = serial;
  }
  const serial = String(maxSerial + 1).padStart(4, '0');
  return `${prefix}${serial}-${emailLocalPart(applicantEmail)}`;
}
