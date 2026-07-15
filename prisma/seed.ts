import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
// 🚀 1분 컷으로 빼둔 메뉴 백업 데이터를 불러옵니다. (같은 prisma 폴더 안에 있어야 합니다)
import menuData from './menu-backup.json';
  
const prisma = new PrismaClient();
  
async function main() {
  console.log('🚀 [KPCQA] 시스템 통합 초기화 및 시딩을 시작합니다...');
  
  // 1. 기존 데이터 초기화 (삭제 순서: 자식 -> 부모)
  await prisma.masterCode.deleteMany({});
  await prisma.masterGroup.deleteMany({});
  
  // 🚨 [변경됨] 이제 JSON으로 완벽하게 복구하므로 메뉴 테이블도 시원하게 초기화합니다!
  await prisma.interfaceConfig.deleteMany({}); 
  
  await prisma.user.deleteMany({});
  await prisma.orgUnit.deleteMany({});
  await prisma.systemConfig.deleteMany({});
  
  const hashedPassword = await bcrypt.hash('password123', 10);
  
  // 2. 시스템 글로벌 설정 (💡 링크 세팅 포함)
  await prisma.systemConfig.create({
    data: { 
      id: 'global', 
      main_headline: "SMART OFFICE HUB", 
      sub_headline: "KPCQA 통합 자산 및 업무 관리 시스템", 
      home_grid_cols: 4,
      linked_sites: [
        { name: "KPCQA 공식 홈페이지", url: "https://www.kpcqa.or.kr", icon: "🏠" },
        { name: "사내 그룹웨어 (메일/결재)", url: "https://gw.kpcqa.or.kr", icon: "🏢" },
        { name: "인사/근태 관리 시스템", url: "https://hr.kpcqa.or.kr", icon: "👥" },
        { name: "법인카드 정산 (비즈플레이)", url: "https://www.bizplay.co.kr", icon: "💳" }
      ]
    }
  });
  
  // 3. 조직 체계 생성 (💡 영문명 포함)
  const createOrg = async (name: string, name_en: string, type: string, parentId: string | null, order: number) => {
    return await prisma.orgUnit.create({
      data: { unit_name: name, unit_name_en: name_en, unit_type: type, parent_id: parentId, sort_order: order, is_active: true }
    });
  };
  
  const rootOrg = await createOrg('KPCQA', 'KPCQA', 'ORGANIZATION', null, 1);
  const hqPlanning = await createOrg('경영기획본부', 'Planning and Management Division', 'HQ', rootOrg.id, 10);
  const centerPlanning = await createOrg('경영기획센터', 'Planning and Management Center', 'CENTER', hqPlanning.id, 11);
  const hqGreen = await createOrg('녹색건축본부', 'Green Building Division', 'HQ', rootOrg.id, 20);
  await createOrg('녹색건축인증센터', 'Green Building Certification Center', 'CENTER', hqGreen.id, 21);
  await createOrg('건축안전인증센터', 'Building Safety Certification Center', 'CENTER', hqGreen.id, 22);
  const hqEnergy = await createOrg('건물에너지본부', 'Building Energy Division', 'HQ', rootOrg.id, 30);
  await createOrg('제로에너지인증센터', 'Zero Energy Certification Center', 'CENTER', hqEnergy.id, 31);
  await createOrg('에너지효율검토센터', 'Energy Efficiency Review Center', 'CENTER', hqEnergy.id, 32);
  const hqStandard = await createOrg('표준인증본부', 'Standard Certification Division', 'HQ', rootOrg.id, 40);
  await createOrg('적합성인증센터', 'Conformity Certification Center', 'CENTER', hqStandard.id, 41);
  await createOrg('지속가능검증센터', 'Sustainability Verification Center', 'CENTER', hqStandard.id, 42);
  await createOrg('ESG인증센터', 'ESG Certification Center', 'CENTER', hqStandard.id, 43);
  const hqFuture = await createOrg('미래성장전략본부', 'Future Growth Strategy Division', 'HQ', rootOrg.id, 50);
  await createOrg('ISMS인증센터', 'ISMS Certification Center', 'CENTER', hqFuture.id, 51);
  await createOrg('AX혁신센터', 'AX Innovation Center', 'CENTER', hqFuture.id, 52);
  
  // 4. 사용자 생성
  await prisma.user.create({
    data: { email: 'admin@kpcqa.or.kr', name: '관리자', password: hashedPassword, roles: ['LV_1'], unit_id: centerPlanning.id, status: 'Active' },
  });
  await prisma.user.create({
    data: { email: 'center@kpcqa.or.kr', name: '센터장', password: hashedPassword, roles: ['LV_2'], unit_id: centerPlanning.id, status: 'Active' },
  });
  await prisma.user.create({
    data: { email: 'user@kpcqa.or.kr', name: '사용자', password: hashedPassword, roles: ['LV_3'], unit_id: centerPlanning.id, status: 'Active' },
  });
  
  // 5. 공통 마스터 데이터 시딩
  console.log('📦 공통 마스터 데이터 엔진 가동 중...');
  const masterGroups = [
    { 
      id: 'GRP_SUPPLY', name: '소모품(경영)', 
      codes: [
        { label: 'A4 용지', value: 'VAL_1' }, { label: 'A3 용지', value: 'VAL_2' }, { label: '상장케이스', value: 'VAL_3' }, 
        { label: '컬러대봉투(양면테잎)(330*245)', value: 'VAL_4' }, { label: '쇼핑백(중)(230*70*320)', value: 'VAL_5' }, 
        { label: '쇼핑백(대)(300*100*450)', value: 'VAL_6' }, { label: '경조사봉투(축의)', value: 'VAL_7' }, { label: '경조사봉투(조의)', value: 'VAL_8' }
      ] 
    },
    { 
      id: 'GRP_IT_TYPE', name: 'IT 자산 분류', 
      codes: [
        { label: '노트북', value: 'VAL_1' }, { label: '데스크탑', value: 'VAL_2' }, { label: '모니터', value: 'VAL_3' }, 
        { label: 'Cursor', value: 'VAL_4' }, { label: 'ZW CAD', value: 'VAL_5' }, { label: 'PDF PRO', value: 'VAL_6' },
        { label: '베리데스크(대형)', value: 'VAL_7' }, { label: '베리데스크(중형)', value: 'VAL_8' }
      ] 
    },
    { 
      id: 'GRP_CLIENT_CATEGORY', name: '고객사 업무범주', 
      codes: [
        { label: '건물 인증 관련', value: 'VAL_1' }, { label: 'ISO 인증 관련', value: 'VAL_2' }, { label: '지속가능 인증 관련', value: 'VAL_3' }, 
        { label: 'ESG 인증 관련', value: 'VAL_4' }, { label: '용역', value: 'VAL_5' }, { label: '행사', value: 'VAL_6' }, { label: '기타', value: 'VAL_7' }
      ] 
    },
    { 
      id: 'GRP_UNIT', name: '단위', 
      codes: [
        { label: '개(EA)', value: 'VAL_1' }, { label: '박스(BOX)', value: 'VAL_2' }, { label: '번들(BDL)', value: 'VAL_3' }, 
        { label: '세트(SET)', value: 'VAL_4' }, { label: '팩(PACK)', value: 'VAL_5' }, { label: '부(Copy)', value: 'VAL_6' },
        { label: '권(Vol)', value: 'VAL_7' }, { label: '장(Sheet)', value: 'VAL_8' }, { label: '면(Page)', value: 'VAL_9' }, 
        { label: '롤(Roll)', value: 'VAL_10' }, { label: '조(Pair)', value: 'VAL_11' }
      ] 
    },
    { 
      id: 'GRP_PROCUREMENT', name: '조달유형', 
      codes: [{ label: '구매', value: 'VAL_1' }, { label: '렌탈', value: 'VAL_2' }, { label: '구독', value: 'VAL_3' }] 
    },
    { 
      id: 'GRP_IT_CATEGORY', name: 'IT·업무자산 범주', 
      codes: [{ label: 'HW', value: 'VAL_1' }, { label: 'SW', value: 'VAL_2' }, { label: '비품', value: 'VAL_3' }, { label: '기타', value: 'VAL_4' }] 
    },
    { 
      id: 'GRP_DUTY', name: '직책', 
      codes: [
        { label: '원장', value: 'CEO' }, { label: '부원장', value: 'Vice President' }, { label: '상무', value: 'Executive Director' },
        { label: '본부장', value: 'Director' }, { label: '센터장', value: 'Manager' }
      ] 
    },
    { 
      id: 'GRP_GRADE', name: '직급', 
      codes: [
        { label: '수석전문위원', value: 'Chief Expert Advisor' }, { label: '책임전문위원', value: 'Chief Technical Expert' },
        { label: '선임전문위원', value: 'Senior Technical Expert' }, { label: '전문위원', value: 'Technical Expert' },
        { label: '연구원', value: 'Researcher' }, { label: '사무원', value: 'Specialist' }, { label: '인턴', value: 'Intern' }
      ] 
    }
  ];
  
  for (const group of masterGroups) {
    const createdGroup = await prisma.masterGroup.create({
      data: { id: group.id, name: group.name, is_active: true }
    });
    for (const [idx, code] of group.codes.entries()) {
      await prisma.masterCode.create({
        data: { 
          group_id: createdGroup.id, label: code.label, value: code.value, 
          sort_order: idx + 1, is_active: true, is_visible: true, is_archived: false, orgs: []            
        }
      });
    }
  }

  // 6. 제작물(Production) 전용 마스터 데이터 시딩
  console.log('🏭 제작물(Production) 전용 마스터 데이터 및 외주업체 연동 중...');
  const vendors = [
    { name: '아트로릭', services: ['인증서용지', '컬러대봉투', '현판'], category: '인쇄' },
    { name: '한생미디어', services: ['제본', '쇼핑백', '상장케이스'], category: '인쇄' },
    { name: '드림디포', services: ['경조사봉투', '사무문구'], category: '문구' },
  ];
  for (const vendor of vendors) {
    const exist = await prisma.vendor.findFirst({ where: { name: vendor.name } });
    if (!exist) await prisma.vendor.create({ data: vendor });
  }

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
    await prisma.productionPlateMaster.upsert({ where: { code: plate.code }, update: {}, create: plate });
  }

  const certs = [
    { certId: 'GSEED', type: 'SIGN', label: '녹색건축인증', format: '(0000. 00. 00. ~ 0000. 00. 00.)', jebonFormat: '', grades: ['최우수 (그린1등급)', '우수 (그린2등급)', '우량 (그린3등급)', '일반 (그린4등급)'] },
    { certId: 'BF', type: 'SIGN', label: 'BF 인증', format: '(0000. 00. 00 ~ 0000. 00. 00)', jebonFormat: '', grades: ['최우수', '우수', '일반'] },
    { certId: 'EDUCATIONAL', type: 'SIGN', label: '교육시설안전인증', format: '0000.00.00.~0000.00.00.', jebonFormat: '', grades: ['최우수', '우수'] },
    { certId: 'ENERGY', type: 'SIGN', label: '건축물에너지효율등급인증', format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00', jebonFormat: '', grades: ['1+++', '1++', '1+', '1등급', '2등급', '3등급', '4등급', '5등급', '6등급', '7등급'] },
    { certId: 'OLD_ZEB', type: 'SIGN', label: '(구) 제로에너지건축물인증', format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00', jebonFormat: '', grades: ['ZEB 5', 'ZEB 4', 'ZEB 3', 'ZEB 2', 'ZEB 1'] },
    { certId: 'INTEGRATED_ZEB', type: 'SIGN', label: '(통합) 제로에너지건축물인증', format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00', jebonFormat: '', grades: ['ZEB 5', 'ZEB 4', 'ZEB 3', 'ZEB 2', 'ZEB 1', 'ZEB +'] },
    { certId: 'ISO', type: 'SIGN', label: 'ISO 인증', format: '', jebonFormat: '', grades: ['ISO 9001', 'ISO 14001', 'ISO 45001', 'IATF16949', 'ISO 22000', 'TL 9000', 'ISO 50001', 'ISO 22301', 'ISO 37001', 'ISO 37301', 'ISO/IEC 27001', 'ISO 21001', 'ISO 10002', 'ISO/IEC 42001'] },
    { certId: 'GSEED_JEBON', type: 'JEBON', label: '녹색건축인증', format: '', jebonFormat: '0000. 0. 0.', grades: ['기본 등급'] },
    { certId: 'CONDENDSATION', type: 'JEBON', label: '결로방지 성능평가', format: '', jebonFormat: '0000. 0. 0.', grades: [] },
    { certId: 'ENERGY_JEBON', type: 'JEBON', label: '건축물에너지효율등급인증', format: '', jebonFormat: '0000. 0. 0', grades: ['기본 등급'] },
    { certId: 'OLD_ZEB_JEBON', type: 'JEBON', label: '(구) 제로에너지건축물인증', format: '', jebonFormat: '0000. 0. 0.', grades: ['기본 등급'] },
    { certId: 'INTEGRATED_ZEB_JEBON', type: 'JEBON', label: '(통합) 제로에너지건축물인증', format: '', jebonFormat: '0000. 0. 0.', grades: ['기본 등급'] },
    { certId: 'NORMAL', type: 'JEBON', label: '일반제본', format: '', jebonFormat: '', grades: [] },
  ];
  for (const cert of certs) {
    await prisma.productionCertMaster.upsert({ where: { certId: cert.certId }, update: {}, create: cert });
  }

// 🚀 7. 인터페이스 메뉴 거버넌스 완벽 복구
console.log('🖥️ 인터페이스 메뉴 풀버전 복구 중...');
  
// 부모 메뉴가 먼저 생겨야 자식 메뉴가 들어갈 수 있으므로 레벨(1->4) 순으로 정렬
const sortedMenus = [...menuData].sort((a: any, b: any) => a.level - b.level);

for (const m of sortedMenus) {
  // DB 충돌을 막기 위해 날짜 데이터는 제외
  const { createdAt, updatedAt, id, ...rawSafeData } = m; 

  // 💡 [에러 원인 해결] null 값 필터링 및 JSON 안전 변환
  const safeData: any = {};
  for (const [key, value] of Object.entries(rawSafeData)) {
    if (value === null) {
      // Prisma에서 에러를 뱉는 JSON 배열 필드들은 null 대신 빈 배열로 처리
      const jsonFields = ['view_scopes', 'org_ids', 'edit_role_ids', 'edit_scopes', 'task_masters', 'view_role_ids', 'task_accesses'];
      if (jsonFields.includes(key)) {
        safeData[key] = []; 
      }
    } else {
      safeData[key] = value;
    }
  }

  await prisma.interfaceConfig.upsert({
    where: { path: m.path }, 
    update: safeData,
    create: {
      id: m.id, // 기존 아이디 유지
      ...safeData
    }
  });
}

console.log('✅ 마스터 데이터 및 메뉴 세팅까지 완벽하게 박제되었습니다!');
}

main()
.catch((e) => { console.error(e); process.exit(1); })
.finally(async () => { await prisma.$disconnect(); });