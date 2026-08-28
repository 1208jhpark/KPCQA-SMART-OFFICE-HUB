import { PrismaClient } from '@prisma/client';

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

  const plates = [
    { code: 'CAST_IRON_300', label: '주물현판', price: 230000, size: '300*400' },
    { code: 'TUNGSTEN_300', label: '텅스텐현판', price: 135000, size: '300*400' },
    { code: 'BRASS_300', label: '신주현판', price: 160000, size: '300*400' },
    { code: 'STAINLESS_300', label: '스텐현판', price: 120000, size: '300*400' },
    { code: 'STAINLESS_90', label: '스텐현판', price: 120000, size: '90*55' },
    { code: 'STAINLESS_450_A', label: 'ISO 실외 스텐현판_기업명표기', price: 120000, size: '450*300' },
    { code: 'STAINLESS_450_B', label: 'ISO 실외 스텐현판_기업명 미표기', price: 120000, size: '450*300' },
    { code: 'WOOD_240', label: 'ISO 실내 메탈목재상패(세로형)', price: 160000, size: '240*300' },
    { code: 'WOOD_300', label: 'ISO 실내 메탈목재상패(가로형)', price: 160000, size: '300*240' },
    { code: 'SILVER_220', label: 'ISO 실내 원형 은쟁반패', price: 160000, size: '220*220' },
    { code: 'SILVER_260', label: 'ISO 실내 팔각형 은쟁반패', price: 160000, size: '260*260' },
  ];

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

  const productionVendors = [
    {
      label: '아트로릭',
      managerName: '',
      contact: '',
      email: '',
      items: '인증서용지, 컬러대봉투, 현판',
      priorityCategory: 'SIGN',
    },
    {
      label: '한생미디어',
      managerName: '',
      contact: '',
      email: '',
      items: '제본, 쇼핑백, 상장케이스',
      priorityCategory: 'JEBON',
    },
    {
      label: '드림디포',
      managerName: '',
      contact: '',
      email: '',
      items: '경조사봉투, 사무문구',
      priorityCategory: 'OFFICE_SUPPLIES',
    },
  ];

  for (const v of productionVendors) {
    const exist = await prisma.productionVendorMaster.findFirst({ where: { label: v.label } });
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

  const signCerts = [
    {
      certId: 'GSEED',
      type: 'SIGN',
      label: '녹색건축인증',
      format: '(0000. 00. 00. ~ 0000. 00. 00.)',
      jebonFormat: '',
      grades: ['최우수 (그린1등급)', '우수 (그린2등급)', '우량 (그린3등급)', '일반 (그린4등급)'],
      useCertNumber: false,
      useValidPeriod: true,
      useMultiGradeSelect: false,
    },
    {
      certId: 'BF',
      type: 'SIGN',
      label: 'BF 인증',
      format: '(0000. 00. 00 ~ 0000. 00. 00)',
      jebonFormat: '',
      grades: ['최우수', '우수', '일반'],
      useCertNumber: false,
      useValidPeriod: true,
      useMultiGradeSelect: false,
    },
    {
      certId: 'EDUCATIONAL',
      type: 'SIGN',
      label: '교육시설안전인증',
      format: '0000.00.00.~0000.00.00.',
      jebonFormat: '',
      grades: ['최우수', '우수'],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
    },
    {
      certId: 'ENERGY',
      type: 'SIGN',
      label: '건축물에너지효율등급인증',
      format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00',
      jebonFormat: '',
      grades: ['1+++', '1++', '1+', '1등급', '2등급', '3등급', '4등급', '5등급', '6등급', '7등급'],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
    },
    {
      certId: 'OLD_ZEB',
      type: 'SIGN',
      label: '(구) 제로에너지건축물인증',
      format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00',
      jebonFormat: '',
      grades: ['ZEB 5', 'ZEB 4', 'ZEB 3', 'ZEB 2', 'ZEB 1'],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
    },
    {
      certId: 'INTEGRATED_ZEB',
      type: 'SIGN',
      label: '(통합) 제로에너지건축물인증',
      format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00',
      jebonFormat: '',
      grades: ['ZEB 5', 'ZEB 4', 'ZEB 3', 'ZEB 2', 'ZEB 1', 'ZEB +'],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
    },
    {
      certId: 'ISO',
      type: 'SIGN',
      label: 'ISO 인증',
      format: '',
      jebonFormat: '',
      grades: [
        'ISO 9001',
        'ISO 14001',
        'ISO 45001',
        'IATF16949',
        'ISO 22000',
        'TL 9000',
        'ISO 50001',
        'ISO 22301',
        'ISO 37001',
        'ISO 37301',
        'ISO/IEC 27001',
        'ISO 21001',
        'ISO 10002',
        'ISO/IEC 42001',
      ],
      useCertNumber: true,
      useValidPeriod: false,
      useMultiGradeSelect: true,
    },
  ];

  const jebonFormDefaults = {
    jebonDefaultSizeType: 'A4',
    jebonDefaultQuantity: 1,
    useJebonCover: true,
    jebonCoverColor: '컬러',
    jebonCoverPageCount: '1',
    jebonInnerColor: '흑백',
  };

  const jebonCerts = [
    {
      certId: 'NORMAL',
      type: 'JEBON',
      label: '일반제본',
      format: '',
      jebonFormat: '',
      grades: [],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
      ...jebonFormDefaults,
    },
    {
      certId: 'GSEED_JEBON',
      type: 'JEBON',
      label: '녹색건축인증 평가서',
      format: '',
      jebonFormat: '0000. 0. 0.',
      grades: ['기본 등급'],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
      ...jebonFormDefaults,
    },
    {
      certId: 'CONDENDSATION',
      type: 'JEBON',
      label: '결로방지 성능평가 결과 보고서',
      format: '',
      jebonFormat: '0000. 0. 0.',
      grades: [],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
      ...jebonFormDefaults,
    },
    {
      certId: 'ENERGY_JEBON',
      type: 'JEBON',
      label: '건축물에너지효율등급인증 평가서',
      format: '',
      jebonFormat: '0000. 0. 0',
      grades: ['기본 등급'],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
      ...jebonFormDefaults,
    },
    {
      certId: 'OLD_ZEB_JEBON',
      type: 'JEBON',
      label: '(구)제로에너지건축물인증 평가서',
      format: '',
      jebonFormat: '0000. 0. 0.',
      grades: ['기본 등급'],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
      ...jebonFormDefaults,
    },
    {
      certId: 'INTEGRATED_ZEB_JEBON',
      type: 'JEBON',
      label: '(통합)제로에너지건축물인증 평가서',
      format: '',
      jebonFormat: '0000. 0. 0.',
      grades: ['기본 등급'],
      useCertNumber: true,
      useValidPeriod: true,
      useMultiGradeSelect: false,
      ...jebonFormDefaults,
    },
  ];

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
        jebonCoverColor: cert.jebonCoverColor,
        jebonCoverPageCount: cert.jebonCoverPageCount,
        jebonInnerColor: cert.jebonInnerColor,
        isActive: true,
      },
      create: cert,
    });
  }

  const printItems = [
    {
      id: 'PRINT_CERT_PAPER',
      name: '인증서 용지(A4)',
      size: 'A4',
      supplier: '아트로릭',
      orderQty: 1,
      unitValue: 'VAL_1',
      isCustom: false,
      sortOrder: 10,
    },
    {
      id: 'PRINT_BAG_M',
      name: '(중)쇼핑백',
      size: '230*70*320',
      supplier: '한생미디어',
      orderQty: 2000,
      unitValue: 'VAL_1',
      isCustom: false,
      sortOrder: 20,
    },
    {
      id: 'PRINT_BAG_L',
      name: '(대)쇼핑백',
      size: '300*100*450',
      supplier: '한생미디어',
      orderQty: 2000,
      unitValue: 'VAL_1',
      isCustom: false,
      sortOrder: 30,
    },
    {
      id: 'PRINT_AWARD_CASE',
      name: '상장케이스',
      size: '',
      supplier: '한생미디어',
      orderQty: 600,
      unitValue: 'VAL_1',
      isCustom: false,
      sortOrder: 40,
    },
    {
      id: 'PRINT_COLOR_ENVELOPE',
      name: '컬러대봉투(양면테잎)',
      size: '330*245',
      supplier: '아트로릭',
      orderQty: 3000,
      unitValue: 'VAL_1',
      isCustom: false,
      sortOrder: 50,
    },
    {
      id: 'PRINT_CONDOLENCE_ENVELOPE',
      name: '경조사봉투',
      size: '',
      supplier: '드림디포',
      orderQty: 200,
      unitValue: 'VAL_1',
      isCustom: false,
      sortOrder: 60,
    },
    {
      id: 'PRINT_OTHER',
      name: '기타소모품',
      size: '',
      supplier: '',
      orderQty: 1,
      unitValue: 'VAL_1',
      isCustom: true,
      sortOrder: 999,
    },
  ];

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

  console.log('✅ [Production Masters] 완료');
}
