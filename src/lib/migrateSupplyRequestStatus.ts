import prisma from '@/lib/prisma';

/** 구 한글 SupplyRequest.status → 영어 (idempotent) */
export async function migrateLegacySupplyRequestStatus() {
  await Promise.all([
    prisma.supplyRequest.updateMany({ where: { status: '대기중' }, data: { status: 'PENDING' } }),
    prisma.supplyRequest.updateMany({ where: { status: '대기' }, data: { status: 'PENDING' } }),
    prisma.supplyRequest.updateMany({ where: { status: '지급완료' }, data: { status: 'COMPLETED' } }),
    prisma.supplyRequest.updateMany({ where: { status: '반려' }, data: { status: 'REJECTED' } }),
  ]);

  // 이미 처리된 건인데 processedAt이 비어 있으면 updatedAt으로 백필
  await prisma.$executeRaw`
    UPDATE "SupplyRequest"
    SET "processedAt" = "updatedAt"
    WHERE "processedAt" IS NULL
      AND "status" IN ('COMPLETED', 'REJECTED')
  `;
}
