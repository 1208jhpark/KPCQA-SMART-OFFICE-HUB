import { PrismaClient } from '@prisma/client';
import { SEED_PLATE_DEFAULTS } from '../src/lib/production-seed-plates';
import {
  SEED_JEBON_CERT_DEFAULTS,
  SEED_SIGN_CERT_DEFAULTS,
} from '../src/lib/production-seed-certs';
import { SEED_JEBON_SIZE_DEFAULTS } from '../src/lib/production-seed-jebon-sizes';
import { SEED_PRINT_ITEM_DEFAULTS } from '../src/lib/production-seed-print-items';

/**
 * 제작물(Production) 마스터만 채우기/동기화.
 * - deleteMany 없음 — 사용자·메뉴·신청 이력 등은 건드리지 않습니다.
 * - mode 'fill'  : 없는 행만 생성 (외주업체는 기존 행 덮어쓰지 않음)
 * - mode 'sync'  : 시드 기준값으로 upsert (개발 중 시드 파일 변경 반영용)
 */
export async function seedProductionMasters(
  prisma: PrismaClient,
  mode: 'fill' | 'sync' = 'fill'
) {
  console.log(`🏭 [Production Masters] ${mode === 'fill' ? '채우기' : '동기화'} 시작...`);

  const plates = SEED_PLATE_DEFAULTS.map((p) => ({
    code: p.code,
    label: p.label,
    price: p.price,
    size: p.size,
  }));

  for (const plate of plates) {
    if (mode === 'fill') {
      const exist = await prisma.productionPlateMaster.findUnique({ where: { code: plate.code } });
      if (!exist) {
        await prisma.productionPlateMaster.create({ data: plate });
      }
    } else {
      await prisma.productionPlateMaster.upsert({
        where: { code: plate.code },
        update: {
          label: plate.label,
          price: plate.price,
          size: plate.size,
          isActive: true,
        },
        create: plate,
      });
    }
  }

  const jebonSizes = SEED_JEBON_SIZE_DEFAULTS.map((r) => ({
    code: r.code,
    label: r.label,
    size: r.size,
    description: r.description,
  }));

  for (const row of jebonSizes) {
    if (mode === 'fill') {
      const exist = await prisma.productionJebonSizeMaster.findUnique({
        where: { code: row.code },
      });
      if (!exist) {
        await prisma.productionJebonSizeMaster.create({ data: row });
      }
      continue;
    }
    await prisma.productionJebonSizeMaster.upsert({
      where: { code: row.code },
      update: {
        label: row.label,
        size: row.size,
        description: row.description,
        isActive: true,
      },
      create: row,
    });
  }

  if (mode !== 'fill') {
    const base = new Date('2020-03-01T00:00:00.000Z').getTime();
    for (let i = 0; i < jebonSizes.length; i++) {
      await prisma.productionJebonSizeMaster.update({
        where: { code: jebonSizes[i].code },
        data: { createdAt: new Date(base + i * 1000) },
      });
    }
  }

  const productionVendors = [
    {
      id: 'seed_vend_artrolic',
      label: '아트로릭',
      managerName: '',
      contact: '',
      email: '',
      items: '인증서용지, 컬러대봉투, 현판',
      priorityCategory: 'SIGN',
    },
    {
      id: 'seed_vend_hanseng',
      label: '한생미디어',
      managerName: '',
      contact: '',
      email: '',
      items: '제본, 쇼핑백, 상장케이스',
      priorityCategory: 'JEBON',
    },
    {
      id: 'seed_vend_dreamdepot',
      label: '드림디포',
      managerName: '',
      contact: '',
      email: '',
      items: '경조사봉투, 사무문구',
      priorityCategory: 'OFFICE_SUPPLIES',
    },
  ];

  for (const v of productionVendors) {
    const exist =
      (await prisma.productionVendorMaster.findUnique({ where: { id: v.id } })) ||
      (await prisma.productionVendorMaster.findFirst({ where: { label: v.label } }));
    if (!exist) {
      await prisma.productionVendorMaster.create({ data: { ...v, isActive: true } });
      continue;
    }
    if (mode === 'sync') {
      await prisma.productionVendorMaster.update({
        where: { id: exist.id },
        data: {
          managerName: v.managerName,
          contact: v.contact,
          email: v.email,
          items: v.items,
          priorityCategory: v.priorityCategory || '',
          isActive: true,
        },
      });
    }
  }

  const signCerts = SEED_SIGN_CERT_DEFAULTS.map((c) => ({
    certId: c.certId,
    type: c.type,
    label: c.label,
    format: c.format,
    jebonFormat: c.jebonFormat,
    grades: [...c.grades],
    useCertNumber: c.useCertNumber,
    useValidPeriod: c.useValidPeriod,
    useMultiGradeSelect: c.useMultiGradeSelect,
  }));

  const jebonCerts = SEED_JEBON_CERT_DEFAULTS.map((c) => ({
    certId: c.certId,
    type: c.type,
    label: c.label,
    format: c.format,
    jebonFormat: c.jebonFormat,
    grades: [...c.grades],
    useCertNumber: c.useCertNumber,
    useValidPeriod: c.useValidPeriod,
    useMultiGradeSelect: c.useMultiGradeSelect,
    jebonDefaultSizeType: c.jebonDefaultSizeType,
    jebonDefaultQuantity: c.jebonDefaultQuantity,
    useJebonCover: c.useJebonCover,
    useJebonCoverDate: c.useJebonCoverDate,
    jebonCoverColor: c.jebonCoverColor,
    jebonCoverPageCount: c.jebonCoverPageCount,
    jebonInnerColor: c.jebonInnerColor,
  }));

  for (const cert of signCerts) {
    if (mode === 'fill') {
      const exist = await prisma.productionCertMaster.findUnique({ where: { certId: cert.certId } });
      if (!exist) {
        await prisma.productionCertMaster.create({ data: cert });
      }
      continue;
    }
    await prisma.productionCertMaster.upsert({
      where: { certId: cert.certId },
      update: {
        type: cert.type,
        label: cert.label,
        format: cert.format,
        jebonFormat: cert.jebonFormat,
        grades: cert.grades,
        useCertNumber: cert.useCertNumber,
        useValidPeriod: cert.useValidPeriod,
        useMultiGradeSelect: cert.useMultiGradeSelect,
        isActive: true,
      },
      create: cert,
    });
  }

  // 현판 ZEB: (구)/(통합) → 단일 '제로에너지건축물인증'(ZEB)로 통합
  if (mode !== 'fill') {
    const legacySignZeb = await prisma.productionCertMaster.findMany({
      where: { certId: { in: ['OLD_ZEB', 'INTEGRATED_ZEB'] } },
      select: { linkedPlateCodes: true },
    });
    const mergedPlates = Array.from(
      new Set(
        legacySignZeb.flatMap((row) =>
          Array.isArray(row.linkedPlateCodes) ? row.linkedPlateCodes.map(String) : []
        )
      )
    );
    if (mergedPlates.length > 0) {
      const zeb = await prisma.productionCertMaster.findUnique({ where: { certId: 'ZEB' } });
      const existing = Array.isArray(zeb?.linkedPlateCodes)
        ? (zeb!.linkedPlateCodes as unknown[]).map(String)
        : [];
      await prisma.productionCertMaster.update({
        where: { certId: 'ZEB' },
        data: {
          linkedPlateCodes: Array.from(new Set([...existing, ...mergedPlates])),
        },
      });
    }
    await prisma.productionCertMaster.updateMany({
      where: { certId: { in: ['OLD_ZEB', 'INTEGRATED_ZEB'] } },
      data: { isActive: false },
    });
  }

  // 시드 배열 순서를 createdAt에 반영 → API/UI는 createdAt만으로 동일 순서 유지 (하드코딩 정렬 불필요)
  if (mode !== 'fill') {
    const base = new Date('2020-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < signCerts.length; i++) {
      await prisma.productionCertMaster.update({
        where: { certId: signCerts[i].certId },
        data: { createdAt: new Date(base + i * 1000) },
      });
    }
  }

  for (const cert of jebonCerts) {
    if (mode === 'fill') {
      const exist = await prisma.productionCertMaster.findUnique({ where: { certId: cert.certId } });
      if (!exist) {
        await prisma.productionCertMaster.create({ data: cert });
      }
      continue;
    }
    await prisma.productionCertMaster.upsert({
      where: { certId: cert.certId },
      update: {
        label: cert.label,
        jebonFormat: cert.jebonFormat,
        useCertNumber: cert.useCertNumber,
        useValidPeriod: cert.useValidPeriod,
        useMultiGradeSelect: cert.useMultiGradeSelect,
        jebonDefaultSizeType: cert.jebonDefaultSizeType,
        jebonDefaultQuantity: cert.jebonDefaultQuantity,
        useJebonCover: cert.useJebonCover,
        useJebonCoverDate: cert.useJebonCoverDate,
        jebonCoverColor: cert.jebonCoverColor,
        jebonCoverPageCount: cert.jebonCoverPageCount,
        jebonInnerColor: cert.jebonInnerColor,
        isActive: true,
      },
      create: cert,
    });
  }

  // 제본 ZEB: (구)/(통합) → 단일 '제로에너지건축물인증 평가서'(ZEB_JEBON)로 통합, 구 시드 비활성화
  if (mode !== 'fill') {
    await prisma.productionCertMaster.updateMany({
      where: { certId: { in: ['OLD_ZEB_JEBON', 'INTEGRATED_ZEB_JEBON'] } },
      data: { isActive: false },
    });
    const base = new Date('2020-02-01T00:00:00.000Z').getTime();
    for (let i = 0; i < jebonCerts.length; i++) {
      await prisma.productionCertMaster.update({
        where: { certId: jebonCerts[i].certId },
        data: { createdAt: new Date(base + i * 1000) },
      });
    }
  }

  const printItems = SEED_PRINT_ITEM_DEFAULTS.map((item) => ({
    id: item.id,
    name: item.name,
    size: item.size,
    supplier: item.supplier,
    orderQty: item.orderQty,
    unitValue: item.unitValue,
    isCustom: item.isCustom,
    sortOrder: item.sortOrder,
  }));

  for (const item of printItems) {
    if (mode === 'fill') {
      const exist = await prisma.productionPrintItemMaster.findUnique({ where: { id: item.id } }).catch(() => null);
      if (!exist) {
        try {
          await prisma.productionPrintItemMaster.create({
            data: { ...item, isActive: true },
          });
        } catch {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "ProductionPrintItemMaster"
              (id, name, size, supplier, "orderQty", "unitValue", "isCustom", "sortOrder", "isActive", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            item.id,
            item.name,
            item.size,
            item.supplier,
            item.orderQty,
            item.unitValue,
            item.isCustom,
            item.sortOrder
          );
        }
      }
      continue;
    }
    try {
      await prisma.productionPrintItemMaster.upsert({
        where: { id: item.id },
        update: {
          name: item.name,
          size: item.size,
          supplier: item.supplier,
          orderQty: item.orderQty,
          unitValue: item.unitValue,
          isCustom: item.isCustom,
          sortOrder: item.sortOrder,
          isActive: true,
        },
        create: { ...item, isActive: true },
      });
    } catch {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProductionPrintItemMaster"
          (id, name, size, supplier, "orderQty", "unitValue", "isCustom", "sortOrder", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           size = EXCLUDED.size,
           supplier = EXCLUDED.supplier,
           "orderQty" = EXCLUDED."orderQty",
           "unitValue" = EXCLUDED."unitValue",
           "isCustom" = EXCLUDED."isCustom",
           "sortOrder" = EXCLUDED."sortOrder",
           "isActive" = true,
           "updatedAt" = NOW()`,
        item.id,
        item.name,
        item.size,
        item.supplier,
        item.orderQty,
        item.unitValue,
        item.isCustom,
        item.sortOrder
      );
    }
  }

  try {
    await prisma.productionPrintItemMaster.updateMany({
      where: { id: 'PRINT_CONDOLENCE_ENVELOPE' },
      data: { isActive: false },
    });
  } catch {
    /* 구 단일 경조사봉투 행 비활성화 — 미존재 시 무시 */
  }

  console.log('✅ [Production Masters] 완료');
}
