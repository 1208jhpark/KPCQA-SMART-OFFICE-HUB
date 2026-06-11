import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
  
const prisma = new PrismaClient();
  
async function main() {
  console.log('🚀 [KPCQA] 시스템 통합 초기화 및 시딩을 시작합니다...');
  
  // 1. 기존 데이터 초기화 (삭제 순서: 자식 -> 부모)
  await prisma.masterCode.deleteMany({});
  await prisma.masterGroup.deleteMany({});
  
  // 🚨 [안전장치 1] 기존 메뉴 데이터가 날아가지 않도록 삭제 명령 봉인!
  // await prisma.interfaceConfig.deleteMany({}); 
  
  await prisma.user.deleteMany({});
  await prisma.orgUnit.deleteMany({});
  await prisma.systemConfig.deleteMany({});
  
  const hashedPassword = await bcrypt.hash('password123', 10);
  
  // 2. 시스템 글로벌 설정
  await prisma.systemConfig.create({
    data: { 
      id: 'global', 
      main_headline: "SMART OFFICE HUB", 
      sub_headline: "KPCQA 통합 자산 및 업무 관리 시스템", 
      home_grid_cols: 4 
    }
  });
  
  // 3. 조직 체계 생성 함수
  const createOrg = async (name: string, type: string, parentId: string | null, order: number) => {
    return await prisma.orgUnit.create({
      data: { unit_name: name, unit_type: type, parent_id: parentId, sort_order: order, is_active: true }
    });
  };
  
  const rootOrg = await createOrg('KPCQA', 'ORGANIZATION', null, 1);
  const hqPlanning = await createOrg('경영기획본부', 'HQ', rootOrg.id, 10);
  const centerPlanning = await createOrg('경영기획센터', 'CENTER', hqPlanning.id, 11);
  const hqGreen = await createOrg('녹색건축본부', 'HQ', rootOrg.id, 20);
  await createOrg('녹색건축인증센터', 'CENTER', hqGreen.id, 21);
  await createOrg('건축안전인증센터', 'CENTER', hqGreen.id, 22);
  const hqEnergy = await createOrg('건물에너지본부', 'HQ', rootOrg.id, 30);
  await createOrg('제로에너지인증센터', 'CENTER', hqEnergy.id, 31);
  await createOrg('에너지효율검토센터', 'CENTER', hqEnergy.id, 32);
  const hqStandard = await createOrg('표준인증본부', 'HQ', rootOrg.id, 40);
  await createOrg('적합성인증센터', 'CENTER', hqStandard.id, 41);
  await createOrg('지속가능검증센터', 'CENTER', hqStandard.id, 42);
  await createOrg('ESG인증센터', 'CENTER', hqStandard.id, 43);
  const hqFuture = await createOrg('미래성장전략본부', 'HQ', rootOrg.id, 50);
  await createOrg('ISMS인증센터', 'CENTER', hqFuture.id, 51);
  await createOrg('AX혁신센터', 'CENTER', hqFuture.id, 52);
  
  // 4. 사용자 생성
  const adminUser = await prisma.user.create({
    data: { email: 'admin@kpcqa.or.kr', name: '관리자', password: hashedPassword, roles: ['LV_1'], unit_id: centerPlanning.id, status: 'Active' },
  });
  await prisma.user.create({
    data: { email: 'center@kpcqa.or.kr', name: '센터장', password: hashedPassword, roles: ['LV_2'], unit_id: centerPlanning.id, status: 'Active' },
  });
  await prisma.user.create({
    data: { email: 'user@kpcqa.or.kr', name: '사용자', password: hashedPassword, roles: ['LV_3'], unit_id: centerPlanning.id, status: 'Active' },
  });
  
  // 🚀 5. 마스터 데이터 (Select Group) 전량 시딩 - UI 노출 필드 강제 적용
  console.log('📦 마스터 데이터 엔진 가동 중...');
  const masterGroups = [
    { id: 'GRP_SUPPLY', name: '소모품(경영)', codes: ['컬러대봉투(양면테잎)(330*245)', 'A4', 'A3', '경조사봉투', '쇼핑백(중)(230*70*320)', '쇼핑백(대)(300*100*450)', '상장케이스', '명함(90*55)'] },
    { id: 'GRP_MARKETING', name: '마케팅물품(경영)', codes: ['선풍기', '커피'] },
    { id: 'GRP_UNIT', name: '단위', codes: ['개(EA)', '박스(BOX)', '번들(BDL)', '세트(SET)', '팩(PACK)', '부(Copy)', '권(Vol)', '장(Sheet)', '면(Page)', '롤(Roll)', '조(Pair)'] },
    { id: 'GRP_CERT_STEP', name: '인증단계', codes: ['예비', '본'] },
    { id: 'GRP_VENDOR', name: '외주업체', codes: ['한생미디어', '아트로릭', '드림디포', '로젠택배', '좋은퀵'] },
    { id: 'GRP_OUT_ITEM', name: '외주품목', codes: ['제본', '현판', '인증서용지(제로)', '인증서용지(녹색)', '현수막', '메탈상패', '목판상패', '은쟁반패', '문구', '택배배송', '퀵배송', '컬러대봉투', '쇼핑백(중)(230*70*320)', '쇼핑백(대)(300*100*450)', '상장케이스'] },
    { id: 'GRP_DETAIL_1', name: '품목상세1', codes: ['현판-스테인레스', '현판-텅스텐', '현판-신주', '현판주물', '무선제본/표지', '스트링제본/표지'] },
    { id: 'GRP_DETAIL_2', name: '품목상세2', codes: ['A4컬러인쇄(내지)', 'A4흑백인쇄(내지)'] },
    { id: 'GRP_IT_TYPE', name: 'IT 자산 분류', codes: ['노트북', '데스크탑', '모니터', '태블릿', '프린터', '소프트웨어', '기타기기'] }
  ];
  
  for (const group of masterGroups) {
    const createdGroup = await prisma.masterGroup.create({
      data: { id: group.id, name: group.name, is_active: true }
    });
    for (const [idx, label] of group.codes.entries()) {
      await prisma.masterCode.create({
        data: { 
          group_id: createdGroup.id, 
          label, 
          value: `VAL_${idx + 1}`, 
          sort_order: idx + 1,
          is_active: true,    
          is_visible: true,   
          is_archived: false, 
          orgs: []            
        }
      });
    }
  }
  
  // =========================================================================
  // 🚨 [안전장치 2] 아래 6번 '인터페이스 메뉴' 시딩 부분은 전체 주석 처리합니다!
  // 어드민 화면에서 직접 설정한 (ON/OFF, 페이지 문구 등) 데이터가 날아가는 것을 방지합니다.
  // 향후 모든 메뉴 추가/수정은 어드민 UI(/admin/interface)에서 진행해야 합니다.
  // =========================================================================
  /*
  // 6. 인터페이스 메뉴 거버넌스 (L1 ~ L4)
  console.log('🖥️ 인터페이스 풀버전 구성 중...');
  const alpha = 'abcdefghijklmnopqrstuvw'.split('');
  const assetL1 = await prisma.interfaceConfig.create({ data: { level: 1, name: '경영자산관리', path: '/asset', icon: '🏢', sort_order: 1 } });
  const assetL2s = [
    { n: '대쉬보드', p: '/asset/dashboard', i: '📊' },
    { n: '일반소모품', p: '/asset/supplies', i: '📦' },
    { n: '마케팅물품', p: '/asset/marketing', i: '🎁' },
    { n: '외주업무서비스', p: '/asset/outsourcing', i: '🤝' },
    { n: 'IT·업무자산', p: '/asset/it', i: '💻' },
  ];
  
  for (const [idx, l2] of assetL2s.entries()) {
    const parent = await prisma.interfaceConfig.create({ data: { level: 2, name: l2.n, path: l2.p, icon: l2.i, parent_id: assetL1.id, sort_order: idx + 1, entry_sidebar: true } });
    if (l2.n === '일반소모품') {
      for (const [i, s] of ['재고현황', '신청현황', '구매현황'].entries()) {
        await prisma.interfaceConfig.create({ data: { level: 3, name: `일반소모품 ${s}`, path: `${l2.p}/${['inventory', 'request', 'purchase'][i]}`, parent_id: parent.id, sort_order: i + 1, entry_sidebar: true } });
      }
    }
    if (l2.n === '마케팅물품') {
      for (const [i, s] of ['재고현황', '지급현황', '구매현황'].entries()) {
        await prisma.interfaceConfig.create({ data: { level: 3, name: `마케팅물품 ${s}`, path: `${l2.p}/${['inventory', 'distribution', 'purchase'][i]}`, parent_id: parent.id, sort_order: i + 1, entry_sidebar: true } });
      }
    }
    if (l2.n === '외주업무서비스') {
      const subs = [{n:'제본(한생미디어)', p:'a'}, {n:'현판(아트로릭)', p:'b'}, {n:'문구(드림디포)', p:'c'}, {n:'택배(로젠택배)', p:'d'}, {n:'퀵(좋은퀵)', p:'e'}];
      for (const [i, s] of subs.entries()) {
        await prisma.interfaceConfig.create({ data: { level: 3, name: s.n, path: `${l2.p}/${s.p}`, parent_id: parent.id, sort_order: i + 1, entry_sidebar: true } });
      }
    }
    if (l2.n === 'IT·업무자산') { 
      const itSubs = [{n:'나의 IT·업무자산', p:'personal', i:'📱'}, {n:'부서 IT·업무자산', p:'dept', i:'👥'}, {n:'관리자페이지', p:'master', i:'🛠️', m:true}];
      for (const [i, s] of itSubs.entries()) {
        const l3 = await prisma.interfaceConfig.create({ 
          data: { 
            level: 3, name: s.n, path: `${l2.p}/${s.p}`, icon: s.i, parent_id: parent.id, 
            sort_order: i + 1, entry_sidebar: true, is_master: s.m || false, entry_index_view: s.m || false, master_editor_id: s.m ? adminUser.id : null 
          } 
        });
        if (s.m) {
          const l4Cards = [{ n: '전사 IT·업무자산 운영 현황 및 리스트', p: '/asset/it/master/dashboard', i: '📊' }, { n: '사용자 요구사항 처리이력', p: '/asset/it/master/requests', i: '📩' }, { n: '반납/폐기자산 아카이브', p: '/asset/it/master/archive', i: '📦' }];
          for (const [j, card] of l4Cards.entries()) {
            await prisma.interfaceConfig.create({ data: { level: 4, name: card.n, path: card.p, icon: card.i, parent_id: l3.id, sort_order: j + 1, description: `${card.n} 모듈` } });
          }
        }
      }
    }
  }
  
  // --- [L1-2] 센터자산관리 ---
  const centerL1 = await prisma.interfaceConfig.create({ data: { level: 1, name: '센터자산관리', path: '/center', icon: '⚙️', sort_order: 2 } });
  await prisma.interfaceConfig.create({ data: { level: 2, name: '대쉬보드', path: '/center/dashboard', icon: '📊', parent_id: centerL1.id, sort_order: 1, entry_sidebar: true } });
  const centerMkt = await prisma.interfaceConfig.create({ data: { level: 2, name: '마케팅물품', path: '/center/marketing', icon: '🎁', parent_id: centerL1.id, sort_order: 2, entry_sidebar: true } });
  for (const [i, s] of ['재고현황', '지급현황', '구매현황'].entries()) {
    await prisma.interfaceConfig.create({ data: { level: 3, name: `마케팅물품 ${s}`, path: `${centerMkt.path}/${['inventory', 'distribution', 'purchase'][i]}`, parent_id: centerMkt.id, sort_order: i + 1, entry_sidebar: true } });
  }
  
  // --- [L1-3] 장비관리 (21종) ---
  const equipL1 = await prisma.interfaceConfig.create({ data: { level: 1, name: '장비관리', path: '/equipment', icon: '🛠️', sort_order: 3 } });
  const eqA = await prisma.interfaceConfig.create({ data: { level: 2, name: '안전장비', path: '/equipment/a', parent_id: equipL1.id, sort_order: 1, entry_sidebar: true } });
  for (const [i, n] of ['전체식 안전벨트', '안전화', '절단방지 편직 장갑', '안전모'].entries()) {
    await prisma.interfaceConfig.create({ data: { level: 3, name: n, path: `/equipment/a/${alpha[i]}`, parent_id: eqA.id, sort_order: i + 1, entry_sidebar: true } });
  }
  const eqB = await prisma.interfaceConfig.create({ data: { level: 2, name: '기계설비성능점검장비', path: '/equipment/b', parent_id: equipL1.id, sort_order: 2, entry_sidebar: true } });
  const eqBSubs = ['적외선 열화상 카메라', '초음파 유량계', '디지털 압력계', '데이터 기록계', '연소가스분석기', '건습구온도계', '표준 온도계', '적외선온도계', '디지털 풍속계', '디지털 풍압계', '교류전력측정계', '조도계', '회전계', '초음파 두께 측정기', '버어니어 캘리퍼스', 'CO2 측정기', 'CO 측정기', '미세먼지 측정기', '누수 탐지기', '배관 내시경 카메라', '수질 분석기'];
  for (const [i, n] of eqBSubs.entries()) {
    await prisma.interfaceConfig.create({ data: { level: 3, name: n, path: `/equipment/b/${alpha[i]}`, parent_id: eqB.id, sort_order: i + 1, entry_sidebar: true } });
  }
  const eqC = await prisma.interfaceConfig.create({ data: { level: 2, name: '기밀성능측정장비', path: '/equipment/c', parent_id: equipL1.id, sort_order: 3, entry_sidebar: true } });
  for (const [i, n] of ['디지털 차압계(DG-700)', '소형팬', '대형팬', '디지털 온ㆍ습도계(TESTO 625)', '열선형 유속계(TESTO 425)'].entries()) {
    await prisma.interfaceConfig.create({ data: { level: 3, name: n, path: `/equipment/c/${alpha[i]}`, parent_id: eqC.id, sort_order: i + 1, entry_sidebar: true } });
  }
  const eqD = await prisma.interfaceConfig.create({ data: { level: 2, name: '창호성능측정장비', path: '/equipment/d', parent_id: equipL1.id, sort_order: 4, entry_sidebar: true } });
  await prisma.interfaceConfig.create({ data: { level: 3, name: '글라스체크기(GC3000)', path: '/equipment/d/a', parent_id: eqD.id, sort_order: 1, entry_sidebar: true } });
  
  // --- [L1-4] 설문 및 조사 ---
  const surveyL1 = await prisma.interfaceConfig.create({ data: { level: 1, name: '설문 및 조사', path: '/survey', icon: '📝', sort_order: 4 } });
  const surveyL2s = [{n:'설문조사', p:'/survey/general'}, {n:'수요조사', p:'/survey/demand'}, {n:'배송조사', p:'/survey/delivery'}];
  for (const [idx, l2] of surveyL2s.entries()) {
    const parent = await prisma.interfaceConfig.create({ data: { level: 2, name: l2.n, path: l2.p, parent_id: surveyL1.id, sort_order: idx + 1, entry_sidebar: true } });
    for (const i of [0, 1, 2]) {
      await prisma.interfaceConfig.create({ data: { level: 3, name: `${l2.n}${i + 1}`, path: `${l2.p}/${alpha[i]}`, parent_id: parent.id, sort_order: i + 1, entry_sidebar: true } });
    }
  }
  */
  
  console.log('✅ 마스터 데이터 및 기초 설정이 시딩되었습니다.');
  console.log('⚠️ [참고] 메뉴 데이터(InterfaceConfig)는 기존 데이터 보존을 위해 시딩에서 제외되었습니다.');
}
  
main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });