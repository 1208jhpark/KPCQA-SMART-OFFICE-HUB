import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedBusinessCardMasters } from './seed-businesscard-masters';
import { seedProductionMasters } from './seed-production-masters';
// 🚀 1분 컷으로 빼둔 메뉴 백업 데이터를 불러옵니다. (같은 prisma 폴더 안에 있어야 합니다)
import menuData from './menu-backup.json';
  
const prisma = new PrismaClient();
  
async function main() {
  // ⚠️ 전체 시드: 사용자·메뉴·조직 등을 deleteMany 후 재생성합니다.
  //    개발 중 제작물 마스터만 채울 때는 `npm run db:seed:production` 을 사용하세요.
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
  
  // ─────────────────────────────────────────────────────────────
  // 2. SystemConfig (id: 'global') — 한 행에 성격이 다른 설정이 공존
  // ─────────────────────────────────────────────────────────────
  await prisma.systemConfig.create({
    data: {
      id: 'global',

      // ── [A] /admin/interface 최상위 설정 탭 ─────────────────────
      //     홈 메인 문구 · 그리드 · 연동 사이트
      main_headline: 'SMART OFFICE HUB',
      sub_headline: 'KPCQA 통합 자산 및 업무 관리 시스템',
      home_grid_cols: 4,
      linked_sites: [
        { name: 'KPCQA Main Home', url: 'https://www.kpcqa.or.kr/' },
        { name: 'KPCQA Groupware', url: 'https://ep.kpcqa.or.kr/' },
        { name: 'News Clipping', url: 'http://ax.kpcqa.or.kr:9043/' },
        { name: 'ProdAI', url: 'https://ax.kpcqa.or.kr:8000/' },
        { name: '다과신청', url: 'https://qa.kpcqa.or.kr:8500/' },
        { name: '법정의무교육', url: 'https://onkpc.or.kr/prohrd' },
        { name: 'KPI SYSTEM - coming soon', url: '-' },
      ],

      // 공통 운영 부서명 (마케팅 등 global_mgmt_dept 참조)
      global_mgmt_dept: '경영기획본부',

      // ── [B] /admin/settings 마스터 그룹 연동 ────────────────────
      //     MasterGroup.id 와 연결 (아래 §5에서 동일 ID로 생성)
      //     → /admin/master-data 의 그룹을 각 기능 드롭다운에 바인딩
      // 인사 (직책·직급 → 명함/유저관리)
      job_duty_group: 'GRP_DUTY',
      job_grade_group: 'GRP_GRADE',
      // 일반 (고객사 / 소모품 / 단위)
      client_category_group: 'GRP_CLIENT_CATEGORY',
      supply_category_group: 'GRP_SUPPLY',
      unit_category_group: 'GRP_UNIT',
      // IT·업무자산 (대범주 / 품목 / 조달유형)
      it_category_group: 'GRP_IT_CATEGORY',
      it_master_group: 'GRP_IT_TYPE',
      it_rental_group: 'GRP_PROCUREMENT',
      // 외주 업무 서비스 (업체 / 품목 / 상세1 / 상세2)
      outsourcing_vendor_group: 'GRP_OUT_VENDOR',
      outsourcing_item_group: 'GRP_OUT_ITEM',
      outsourcing_detail1_group: 'GRP_OUT_DETAIL1',
      outsourcing_detail2_group: 'GRP_OUT_DETAIL2',
    },
  });
  
  // 3. 조직 체계 생성 (💡 영문명 · unit_code 포함)
  const createOrg = async (
    name: string,
    name_en: string,
    type: string,
    parentId: string | null,
    order: number,
    unit_code: string
  ) => {
    return await prisma.orgUnit.create({
      data: {
        unit_name: name,
        unit_name_en: name_en,
        unit_type: type,
        parent_id: parentId,
        sort_order: order,
        unit_code,
        is_active: true,
      },
    });
  };

  const rootOrg = await createOrg('KPCQA', 'KPCQA', 'ORGANIZATION', null, 1, 'ORG');
  await createOrg('KPCQA[원장]', '', 'HQ', rootOrg.id, 5, 'EX01');
  await createOrg('KPCQA[부원장]', '', 'HQ', rootOrg.id, 6, 'EX02');
  await createOrg('KPCQA[상무]', '', 'HQ', rootOrg.id, 7, 'EX03');
  const hqPlanning = await createOrg('경영기획본부', 'Planning and Management Division', 'HQ', rootOrg.id, 10, 'PMD');
  const centerPlanning = await createOrg('경영기획센터', 'Planning and Management Center', 'CENTER', hqPlanning.id, 11, 'PMC');
  const hqGreen = await createOrg('녹색건축본부', 'Green Building Division', 'HQ', rootOrg.id, 20, 'GBD');
  await createOrg('녹색건축인증센터', 'Green Building Certification Center', 'CENTER', hqGreen.id, 21, 'GBC');
  await createOrg('건축안전인증센터', 'Building Safety Certification Center', 'CENTER', hqGreen.id, 22, 'BSC');
  const hqEnergy = await createOrg('건물에너지본부', 'Building Energy Division', 'HQ', rootOrg.id, 30, 'BED');
  await createOrg('제로에너지인증센터', 'Zero Energy Certification Center', 'CENTER', hqEnergy.id, 31, 'ZEC');
  await createOrg('에너지효율검토센터', 'Energy Efficiency Review Center', 'CENTER', hqEnergy.id, 32, 'EERC');
  const hqStandard = await createOrg('표준인증본부', 'Standard Certification Division', 'HQ', rootOrg.id, 40, 'SCD');
  await createOrg('적합성인증센터', 'Conformity Certification Center', 'CENTER', hqStandard.id, 41, 'CCC');
  await createOrg('지속가능검증센터', 'Sustainability Verification Center', 'CENTER', hqStandard.id, 42, 'SVC');
  await createOrg('ESG인증센터', 'ESG Certification Center', 'CENTER', hqStandard.id, 43, 'ESGC');
  const hqFuture = await createOrg('미래성장전략본부', 'Future Growth Strategy Division', 'HQ', rootOrg.id, 50, 'FGSD');
  await createOrg('ISMS인증센터', 'ISMS Certification Center', 'CENTER', hqFuture.id, 51, 'ISMSC');
  await createOrg('AX혁신센터', 'AX Innovation Center', 'CENTER', hqFuture.id, 52, 'AXIC');
  
  // 4. 사용자 생성 (가입 체계: 성명/영문명/사번/소속 필수 · 직책·직급은 관리자 배정)
  await prisma.user.create({
    data: {
      email: 'admin@kpcqa.or.kr',
      name: '관리자',
      name_en: 'Admin User',
      employee_no: '100001',
      password: hashedPassword,
      roles: ['LV_1'],
      unit_id: centerPlanning.id,
      status: 'Active',
      duty: '',
      duty_en: '',
      grade: '수석전문위원',
      grade_en: 'Chief Expert Advisor',
      must_reset_password: false,
    },
  });
  await prisma.user.create({
    data: {
      email: 'center@kpcqa.or.kr',
      name: '센터장',
      name_en: 'Center Manager',
      employee_no: '100002',
      password: hashedPassword,
      roles: ['LV_2'],
      unit_id: centerPlanning.id,
      status: 'Active',
      duty: '센터장',
      duty_en: 'Manager',
      grade: '책임전문위원',
      grade_en: 'Chief Technical Expert',
      must_reset_password: false,
    },
  });
  await prisma.user.create({
    data: {
      email: 'user@kpcqa.or.kr',
      name: '사용자',
      name_en: 'Normal User',
      employee_no: '100003',
      password: hashedPassword,
      roles: ['LV_3'],
      unit_id: centerPlanning.id,
      status: 'Active',
      duty: '',
      duty_en: '',
      grade: '전문위원',
      grade_en: 'Technical Expert',
      must_reset_password: false,
    },
  });
  await prisma.user.create({
    data: {
      email: 'jhpark1@kpcqa.or.kr',
      name: '박지혜',
      name_en: 'Ji-Hye Park',
      employee_no: '2014101302',
      password: hashedPassword,
      roles: ['LV_1'],
      unit_id: centerPlanning.id,
      status: 'Active',
      duty: '',
      duty_en: '',
      grade: '전문위원',
      grade_en: 'Technical Expert',
      must_reset_password: false,
    },
  });
  
  // 5. 공통 마스터 데이터 시딩 (/admin/master-data + SystemConfig 매핑 대상)
  console.log('📦 공통 마스터 데이터 엔진 가동 중...');
  const masterGroups = [
    { 
      id: 'GRP_SUPPLY', name: '소모품(경영)', sort_order: 10,
      codes: [
        { label: 'A4 용지', value: 'VAL_1' }, { label: 'A3 용지', value: 'VAL_2' }, { label: '상장케이스', value: 'VAL_3' }, 
        { label: '컬러대봉투(양면테잎)(330*245)', value: 'VAL_4' }, { label: '쇼핑백(중)(230*70*320)', value: 'VAL_5' }, 
        { label: '쇼핑백(대)(300*100*450)', value: 'VAL_6' }, { label: '경조사봉투(축의)', value: 'VAL_7' }, { label: '경조사봉투(조의)', value: 'VAL_8' }
      ] 
    },
    { 
      id: 'GRP_UNIT', name: '단위', sort_order: 20,
      codes: [
        { label: '개(EA)', value: 'VAL_1' }, { label: '박스(BOX)', value: 'VAL_2' }, { label: '번들(BDL)', value: 'VAL_3' }, 
        { label: '세트(SET)', value: 'VAL_4' }, { label: '팩(PACK)', value: 'VAL_5' }, { label: '부(Copy)', value: 'VAL_6' },
        { label: '권(Vol)', value: 'VAL_7' }, { label: '장(Sheet)', value: 'VAL_8' }, { label: '면(Page)', value: 'VAL_9' }, 
        { label: '롤(Roll)', value: 'VAL_10' }, { label: '조(Pair)', value: 'VAL_11' }
      ] 
    },
    { 
      id: 'GRP_CLIENT_CATEGORY', name: '고객사 업무범주', sort_order: 30,
      codes: [
        { label: '건물 인증 관련', value: 'VAL_1' }, { label: 'ISO 인증 관련', value: 'VAL_2' }, { label: '지속가능 인증 관련', value: 'VAL_3' }, 
        { label: 'ESG 인증 관련', value: 'VAL_4' }, { label: '용역', value: 'VAL_5' }, { label: '행사', value: 'VAL_6' }, { label: '기타', value: 'VAL_7' }
      ] 
    },
    { 
      id: 'GRP_IT_CATEGORY', name: 'IT·업무자산 대범주', sort_order: 40,
      codes: [{ label: 'HW', value: 'VAL_1' }, { label: 'SW', value: 'VAL_2' }, { label: '비품', value: 'VAL_3' }, { label: '기타', value: 'VAL_4' }] 
    },
    { 
      id: 'GRP_IT_TYPE', name: 'IT·업무자산 품목', sort_order: 50,
      codes: [
        { label: '노트북', value: 'VAL_1' }, { label: '데스크탑', value: 'VAL_2' }, { label: '모니터', value: 'VAL_3' }, 
        { label: 'Cursor', value: 'VAL_4' }, { label: 'ZW CAD', value: 'VAL_5' }, { label: 'PDF PRO', value: 'VAL_6' },
        { label: '베리데스크(대형)', value: 'VAL_7' }, { label: '베리데스크(중형)', value: 'VAL_8' }
      ] 
    },
    { 
      id: 'GRP_PROCUREMENT', name: '조달유형', sort_order: 60,
      codes: [{ label: '구매', value: 'VAL_1' }, { label: '렌탈', value: 'VAL_2' }, { label: '구독', value: 'VAL_3' }] 
    },
    { 
      id: 'GRP_DUTY', name: '직책', sort_order: 70,
      codes: [
        { label: '원장', value: 'CEO' }, { label: '부원장', value: 'Vice President' }, { label: '상무', value: 'Executive Director' },
        { label: '본부장', value: 'Director' }, { label: '센터장', value: 'Manager' }
      ] 
    },
    { 
      id: 'GRP_GRADE', name: '직급', sort_order: 80,
      codes: [
        { label: '수석전문위원', value: 'Chief Expert Advisor' }, { label: '책임전문위원', value: 'Chief Technical Expert' },
        { label: '선임전문위원', value: 'Senior Technical Expert' }, { label: '전문위원', value: 'Technical Expert' },
        { label: '연구원', value: 'Researcher' }, { label: '사무원', value: 'Specialist' }, { label: '인턴', value: 'Intern' }
      ] 
    },
    {
      id: 'GRP_OUT_VENDOR',
      name: '외주 업체 마스터',
      sort_order: 90,
      codes: [
        { label: '아트로릭', value: 'VENDOR_ARTROLIC' },
        { label: '한생미디어', value: 'VENDOR_HANSAENG' },
        { label: '드림디포', value: 'VENDOR_DREAMDEPO' },
      ],
    },
    {
      id: 'GRP_OUT_ITEM',
      name: '외주 품목 리스트',
      sort_order: 91,
      codes: [
        { label: '현판/명판/상패', value: 'ITEM_SIGN' },
        { label: '제본', value: 'ITEM_JEBON' },
        { label: '기타 제작물', value: 'ITEM_PRINT' },
        { label: '사무문구류', value: 'ITEM_SUPPLIES' },
      ],
    },
    {
      id: 'GRP_OUT_DETAIL1',
      name: '외주 품목 상세1',
      sort_order: 92,
      codes: [
        { label: '표준', value: 'D1_STANDARD' },
        { label: '긴급', value: 'D1_URGENT' },
        { label: '재제작', value: 'D1_REMAKE' },
      ],
    },
    {
      id: 'GRP_OUT_DETAIL2',
      name: '외주 품목 상세2',
      sort_order: 93,
      codes: [
        { label: '컬러', value: 'D2_COLOR' },
        { label: '흑백', value: 'D2_BW' },
        { label: '혼합', value: 'D2_MIX' },
      ],
    },
  ];
  
  for (const group of masterGroups) {
    const createdGroup = await prisma.masterGroup.create({
      data: {
        id: group.id,
        name: group.name,
        sort_order: group.sort_order,
        is_active: true,
      }
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

  // 5.5 (구) ASSET 공통 외주업체 — 사무용품·마케팅 구매(SupplyPurchase) 연동용
  // ※ 제작 신청서 「외주 업체 관리 설정」은 ProductionVendorMaster(§6) 를 사용합니다.
  console.log('📦 (구) ASSET 공통 Vendor 마스터 시딩 중...');
  const legacyVendors = [
    { name: '아트로릭', services: ['인증서용지', '컬러대봉투', '현판'], category: '인쇄' },
    { name: '한생미디어', services: ['제본', '쇼핑백', '상장케이스'], category: '인쇄' },
    { name: '드림디포', services: ['경조사봉투', '사무문구'], category: '문구' },
  ];
  for (const vendor of legacyVendors) {
    const exist = await prisma.vendor.findFirst({ where: { name: vendor.name } });
    if (!exist) await prisma.vendor.create({ data: vendor });
  }

  // 6. 제작물(Production) 전용 마스터 — 현판 품목 · 외주업체 · 인증 서식
  await seedProductionMasters(prisma, 'sync');

  // 6.5 명함 전용 마스터 — 자격사항 표준단어 (국/영문)
  await seedBusinessCardMasters(prisma, 'sync');

// 🚀 7. 인터페이스 메뉴 거버넌스 복구
// menu-backup.json 은 구 스키마 필드가 섞일 수 있음 → 현재 InterfaceConfig 컬럼만 반영
console.log('🖥️ 인터페이스 메뉴 풀버전 복구 중...');

const INTERFACE_ALLOWED_KEYS = new Set([
  'path',
  'level',
  'name',
  'description',
  'icon',
  'sort_order',
  'is_active',
  'is_visible',
  'parent_id',
  'view_scopes',
  'org_ids',
  'edit_role_ids',
  'edit_scopes',
  'task_masters',
  'view_role_ids',
  'task_accesses',
  'is_master',
  'master_editor_id',
  'entry_sidebar',
  'entry_index_view',
  'entry_l4_direct',
  'l2_entry_mode',
  'show_header',
  'page_title',
  'show_page_title',
  'page_description',
  'show_page_desc',
]);
const INTERFACE_JSON_FIELDS = [
  'view_scopes',
  'org_ids',
  'edit_role_ids',
  'edit_scopes',
  'task_masters',
  'view_role_ids',
  'task_accesses',
];

// Access org 기본값: 시드에서 만든 최상위 ORGANIZATION (KPCQA)
// 백업 JSON의 옛 org_ids 는 Prisma 오류가 아니라 링크 깨짐만 유발 → 여기서 현재 rootOrg.id 로 덮어씀
const defaultAccessOrgIds = [rootOrg.id];

const sortedMenus = [...menuData].sort((a: any, b: any) => a.level - b.level);

for (const m of sortedMenus) {
  const { createdAt, updatedAt, id, ...rawSafeData } = m;

  const safeData: any = {};
  for (const [key, value] of Object.entries(rawSafeData)) {
    if (!INTERFACE_ALLOWED_KEYS.has(key)) continue; // access_scope_coded 등 구버전 키 무시
    if (value === null) {
      if (INTERFACE_JSON_FIELDS.includes(key)) safeData[key] = [];
    } else {
      safeData[key] = value;
    }
  }

  // Access 조직 = ORGANIZATION (LV_1이 이후 admin/interface에서 수정)
  safeData.org_ids = defaultAccessOrgIds;

  await prisma.interfaceConfig.upsert({
    where: { path: m.path },
    update: safeData,
    create: {
      id: m.id,
      ...safeData,
    },
  });
}

console.log(
  `✅ 마스터/메뉴 시드 완료 (Access org → ORGANIZATION id=${rootOrg.id})`
);
}

main()
.catch((e) => { console.error(e); process.exit(1); })
.finally(async () => { await prisma.$disconnect(); });