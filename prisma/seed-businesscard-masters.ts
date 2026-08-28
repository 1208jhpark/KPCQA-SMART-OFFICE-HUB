import { PrismaClient } from '@prisma/client';

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

  const qualifications: { nameKo: string; nameEn: string }[] = [
    { nameKo: '공학박사', nameEn: 'Ph.D.' },
    { nameKo: '건축사', nameEn: 'Architect' },
    { nameKo: '건축물에너지평가사', nameEn: 'Building Energy Assessor' },
    {
      nameKo: '건축물에너지효율등급 심사위원',
      nameEn: 'Building Energy Efficiency Rating Auditor',
    },
    { nameKo: '건축기계설비기술사', nameEn: 'Professional Engineer' },
    { nameKo: '에너지진단사', nameEn: 'Energy Management Engineer' },
    { nameKo: '건축시공기술사', nameEn: 'P.E.' },
    { nameKo: '벤처공학박사', nameEn: 'Doctor of Venture Engineering' },
    { nameKo: '재난관리지도사', nameEn: 'Business Continuity Master' },
    { nameKo: '인증심사원', nameEn: 'Auditor' },
    { nameKo: '품질경영기술사', nameEn: 'Quality Management System P.E.' },
    { nameKo: '기술지도사', nameEn: 'Technology Expert Advisor' },
    { nameKo: '환경관리기술사', nameEn: 'Environment Engineer' },
    { nameKo: '이학박사', nameEn: 'Ph.D.' },
    {
      nameKo: '국제통용발자국검증심사원',
      nameEn: 'Cerified Carbon Footprints of Product Verification Professional',
    },
    {
      nameKo: '공조냉동기계기술사',
      nameEn: 'Professional Engineer Air-conditioning Refrigerating Machinery',
    },
    { nameKo: 'AA1000 ACSAP 검증심사원', nameEn: 'AA1000 ACSAP Auditor' },
  ];

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

  const companyAddresses: {
    label: string;
    zipCode: string;
    addressKo: string;
    addressEn: string;
    fax: string;
    faxEn: string;
  }[] = [
    {
      label: '12F(경영)',
      zipCode: '04513',
      addressKo: '서울특별시 중구 세종대로 39 대한상공회의소빌딩 12층',
      addressEn: '12F, KCCI Buiding, Sejong-daero 39, Seoul, 04513 Korea',
      fax: '02-6973-9099',
      faxEn: '+82-2-6973-9099',
    },
    {
      label: '11F',
      zipCode: '04513',
      addressKo: '서울특별시 중구 세종대로 39 대한상공회의소빌딩 11층',
      addressEn: '11F, KCCI Buiding, Sejong-daero 39, Seoul, 04513 Korea',
      fax: '02-6973-9098',
      faxEn: '+82-2-6973-9098',
    },
    {
      label: '12F',
      zipCode: '04513',
      addressKo: '서울특별시 중구 세종대로 39 대한상공회의소빌딩 12층',
      addressEn: '12F, KCCI Buiding, Sejong-daero 39, Seoul, 04513 Korea',
      fax: '02-6973-9097',
      faxEn: '+82-2-6973-9097',
    },
  ];

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
