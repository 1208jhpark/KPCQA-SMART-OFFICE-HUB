import { PrismaClient } from '@prisma/client';
import { SEED_BUSINESS_CARD_QUALIFICATIONS } from '../src/lib/businesscard-seed-qualifications';
import { SEED_COMPANY_ADDRESSES } from '../src/lib/businesscard-seed-addresses';

/**
 * 명함(BusinessCard) 마스터만 채우기/동기화.
 * - deleteMany 없음 — 사용자·메뉴·신청 이력 등은 건드리지 않습니다.
 * - mode 'fill'  : 없는 행만 생성 (기존 행 덮어쓰지 않음)
 * - mode 'sync'  : 시드 기준값으로 upsert (개발 중 시드 파일 변경 반영용)
 */
export async function seedBusinessCardMasters(
  prisma: PrismaClient,
  mode: 'fill' | 'sync' = 'fill'
) {
  console.log(`💳 [BusinessCard Masters] ${mode === 'fill' ? '채우기' : '동기화'} 시작...`);

  const qualifications = SEED_BUSINESS_CARD_QUALIFICATIONS.map((q) => ({
    nameKo: q.nameKo,
    nameEn: q.nameEn,
  }));

  for (const q of qualifications) {
    const exist = await prisma.businessCardQualification.findFirst({
      where: { nameKo: q.nameKo },
    });
    if (!exist) {
      await prisma.businessCardQualification.create({
        data: { ...q, isActive: true },
      });
      continue;
    }
    if (mode === 'sync') {
      await prisma.businessCardQualification.update({
        where: { id: exist.id },
        data: { nameEn: q.nameEn, isActive: true },
      });
    }
  }

  console.log(`✅ [BusinessCard Masters] 자격사항 ${qualifications.length}건 처리 완료`);

  const companyAddresses = SEED_COMPANY_ADDRESSES.map((addr) => ({
    label: addr.label,
    zipCode: addr.zipCode,
    addressKo: addr.addressKo,
    addressEn: addr.addressEn,
    fax: addr.fax,
    faxEn: addr.faxEn,
  }));

  for (const addr of companyAddresses) {
    const exist = await prisma.companyAddress.findFirst({
      where: { label: addr.label },
    });
    if (!exist) {
      await prisma.companyAddress.create({
        data: { ...addr, isActive: true },
      });
      continue;
    }
    if (mode === 'sync') {
      await prisma.companyAddress.update({
        where: { id: exist.id },
        data: { ...addr, isActive: true },
      });
    }
  }

  console.log(`✅ [BusinessCard Masters] 전사 공통 주소 ${companyAddresses.length}건 처리 완료`);
}
