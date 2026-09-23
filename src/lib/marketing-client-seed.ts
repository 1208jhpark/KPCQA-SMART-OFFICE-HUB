/**
 * 마케팅 고객사 마스터 시드 — 컨설팅사 정리.xlsx (Sheet1)
 * - zip_code / address_road / address_detail / location(합본)
 * - 엑셀 행 순서 유지
 */
export type SeedMarketingClient = {
  name: string;
  zip_code: string | null;
  address_road: string | null;
  address_detail: string | null;
  location: string | null;
  category: string;
  departments: { name: string; is_hidden: boolean }[];
};

export const SEED_MARKETING_CLIENTS: readonly SeedMarketingClient[] = [
  {
    "name": "ANE 녹색건축연구소",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "atech",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)씨엔아이엔지니어링(CNI)",
    "zip_code": "06097",
    "address_road": "서울특별시 강남구 선릉로 614-1",
    "address_detail": "나라빌딩 2층",
    "location": "06097 서울특별시 강남구 선릉로 614-1 나라빌딩 2층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)드림엔지니어링(DE)",
    "zip_code": "08593",
    "address_road": "서울시 금천구 가산디지털2로 15",
    "address_detail": "드림타워e1",
    "location": "08593 서울시 금천구 가산디지털2로 15 드림타워e1",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)이에이엔테크놀로지(EAN)",
    "zip_code": "06159",
    "address_road": "서울 강남구 테헤란로77길 11-19",
    "address_detail": "EAN빌딩",
    "location": "06159 서울 강남구 테헤란로77길 11-19 EAN빌딩",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)친환경건축 이에이그룹(EA)",
    "zip_code": "05854",
    "address_road": "서울시 송파구 법원로 114",
    "address_detail": "B동 701호",
    "location": "05854 서울시 송파구 법원로 114 B동 701호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "EIN 컨설팅",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)ENH",
    "zip_code": "10401",
    "address_road": "경기도 고양시 일산동구 무궁화로 20-18",
    "address_detail": "하임빌로데오빌딩 502호",
    "location": "10401 경기도 고양시 일산동구 무궁화로 20-18 하임빌로데오빌딩 502호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)지에이에스디(GASD)",
    "zip_code": "10403",
    "address_road": "경기도 고양시 일산동구 정발산로 42번길 38",
    "address_detail": "라이저오피스텔 202~203호",
    "location": "10403 경기도 고양시 일산동구 정발산로 42번길 38 라이저오피스텔 202~203호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "한국GB파트너스",
    "zip_code": "07557",
    "address_road": "서울특별시 강서구 양천로 738",
    "address_detail": "한강G트리타워 605호",
    "location": "07557 서울특별시 강서구 양천로 738 한강G트리타워 605호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "지와이컨설팅(GY)",
    "zip_code": "08382",
    "address_road": "서울특별시 구로구 디지털로 243",
    "address_detail": "1611호",
    "location": "08382 서울특별시 구로구 디지털로 243 1611호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "HnC건설연구소",
    "zip_code": "04779",
    "address_road": "서울시 성동구 성수일로 55",
    "address_detail": "SK테크노빌딩 901호",
    "location": "04779 서울시 성동구 성수일로 55 SK테크노빌딩 901호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)엘씨씨코리아그룹(LCC)",
    "zip_code": "06527",
    "address_road": "서울시 서초구 강남대로 99길 49",
    "address_detail": "삼양빌딩 4층",
    "location": "06527 서울시 서초구 강남대로 99길 49 삼양빌딩 4층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "네드(NED)",
    "zip_code": "06783",
    "address_road": "서울 서초구 동산로 84",
    "address_detail": "3층",
    "location": "06783 서울 서초구 동산로 84 3층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)PEAS건축물에너지평가사사무소",
    "zip_code": "28576",
    "address_road": "충북 청주시 흥덕구 공단로 134",
    "address_detail": "세중테크노밸리 906호·907호",
    "location": "28576 충북 청주시 흥덕구 공단로 134 세중테크노밸리 906호·907호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "㈜에스비환경디자인(SB)",
    "zip_code": "06292",
    "address_road": "서울시 강남구 언주로 30길 13",
    "address_detail": "대림아크로텔 3011",
    "location": "06292 서울시 강남구 언주로 30길 13 대림아크로텔 3011",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "건축환경디자인연구소 SDA",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "세리위드 주식회사(SeriWith)",
    "zip_code": "06249",
    "address_road": "서울특별시 강남구 논현로71길 26",
    "address_detail": "보원빌딩 2층",
    "location": "06249 서울특별시 강남구 논현로71길 26 보원빌딩 2층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)에스지파트너스 건축사사무소(SG)",
    "zip_code": "57932",
    "address_road": "전라남도 순천시 왕지2길6",
    "address_detail": "대선빌딩 4층",
    "location": "57932 전라남도 순천시 왕지2길6 대선빌딩 4층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "한국에스지에스(SGS Korea)",
    "zip_code": "04322",
    "address_road": "서울시 용산구 한강대로 257",
    "address_detail": "청룡빌딩 11층, 12층",
    "location": "04322 서울시 용산구 한강대로 257 청룡빌딩 11층, 12층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)건축사사무소 건원엔지니어링",
    "zip_code": "05855",
    "address_road": "서울 특별시 송파구 송파대로 167",
    "address_detail": null,
    "location": "05855 서울 특별시 송파구 송파대로 167",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "건축물에너지평가사 협동조합",
    "zip_code": "04607",
    "address_road": "서울시 중구 동호로 224",
    "address_detail": "환경포럼빌딩 2층",
    "location": "04607 서울시 중구 동호로 224 환경포럼빌딩 2층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)건축환경그룹 다올",
    "zip_code": "04784",
    "address_road": "서울특별시 성동구 성수이로 10길 14",
    "address_detail": "에이스 하이엔드 성수타워 1302호, 1303호",
    "location": "04784 서울특별시 성동구 성수이로 10길 14 에이스 하이엔드 성수타워 1302호, 1303호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)건축환경에너지평가원 화인",
    "zip_code": "07331",
    "address_road": "서울특별시 영등포구 국제금융로 8길 34",
    "address_detail": "오륜빌딩 1201호",
    "location": "07331 서울특별시 영등포구 국제금융로 8길 34 오륜빌딩 1201호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "고려건설경제연구원㈜",
    "zip_code": "05836",
    "address_road": "서울 송파구 법원로11길 11",
    "address_detail": "문정현대지식산업센터 A동 705호",
    "location": "05836 서울 송파구 법원로11길 11 문정현대지식산업센터 A동 705호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "그린코드건축사사무소",
    "zip_code": "05392",
    "address_road": "서울 강동구 성내로 19",
    "address_detail": "서경빌딩 5층",
    "location": "05392 서울 강동구 성내로 19 서경빌딩 5층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)금성종합건축사사무소",
    "zip_code": "06554",
    "address_road": "서초구 동광로 11길 115",
    "address_detail": "금성빌딩",
    "location": "06554 서초구 동광로 11길 115 금성빌딩",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)나비환경설비컨설턴트",
    "zip_code": "06226",
    "address_road": "서울특별시 강남구 역삼로 234",
    "address_detail": "뉴튼프라자 3층",
    "location": "06226 서울특별시 강남구 역삼로 234 뉴튼프라자 3층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "녹색건축인증연구소",
    "zip_code": "06245",
    "address_road": "서울 강남구 논현로79길 59",
    "address_detail": null,
    "location": "06245 서울 강남구 논현로79길 59",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)한국녹색건축연구소",
    "zip_code": "16942",
    "address_road": "경기도 용인시 수지구 광교중앙로 338",
    "address_detail": "광교우미뉴브 C동 603호",
    "location": "16942 경기도 용인시 수지구 광교중앙로 338 광교우미뉴브 C동 603호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "느낌과 끌림(주)",
    "zip_code": "10390",
    "address_road": "경기도 고양시 일산서구 킨텍스로 255",
    "address_detail": "오피스동 1806, 1807호",
    "location": "10390 경기도 고양시 일산서구 킨텍스로 255 오피스동 1806, 1807호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)대광엔지니어링",
    "zip_code": "07217",
    "address_road": "서울특별시 영등포구 당산로41길 11",
    "address_detail": "SK V1 Center 320호",
    "location": "07217 서울특별시 영등포구 당산로41길 11 SK V1 Center 320호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "대명기술단",
    "zip_code": "16489",
    "address_road": "경기도 수원시 팔달구 인계로 140",
    "address_detail": "시안프라자 6층",
    "location": "16489 경기도 수원시 팔달구 인계로 140 시안프라자 6층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "대일이엔씨기술(주)",
    "zip_code": "08380",
    "address_road": "서울시 구로구 디지털로 33길 11",
    "address_detail": "에이스테크노타워 8차 602호",
    "location": "08380 서울시 구로구 디지털로 33길 11 에이스테크노타워 8차 602호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)도시미래종합기술공사",
    "zip_code": "02812",
    "address_road": "서울특별시 성북구 정릉로10다길 28",
    "address_detail": null,
    "location": "02812 서울특별시 성북구 정릉로10다길 28",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "돋움건축사사무소",
    "zip_code": "41958",
    "address_road": "대구시 중구 명륜로 115",
    "address_detail": "우리빌딩 4층",
    "location": "41958 대구시 중구 명륜로 115 우리빌딩 4층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "동명기술공단",
    "zip_code": "05203",
    "address_road": "서울특별시 강동구 고덕비즈밸리로4길 35",
    "address_detail": "디엠스퀘어",
    "location": "05203 서울특별시 강동구 고덕비즈밸리로4길 35 디엠스퀘어",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)동원건축사사무소",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)디디알플러스(DDR)",
    "zip_code": "08501",
    "address_road": "서울특별시 금천구 가마산로 96",
    "address_detail": "대륭테크노타운 8차 1214호",
    "location": "08501 서울특별시 금천구 가마산로 96 대륭테크노타운 8차 1214호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)디이테크설비컨설턴트(DE-TECH)",
    "zip_code": "06667",
    "address_road": "서울특별시 서초구 효령로 175",
    "address_detail": "2층",
    "location": "06667 서울특별시 서초구 효령로 175 2층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)디자인그룹오즈 건축사사무소(OZ)",
    "zip_code": "06056",
    "address_road": "서울특별시 강남구 선릉로145길 5-13",
    "address_detail": "모아빌딩 2층",
    "location": "06056 서울특별시 강남구 선릉로145길 5-13 모아빌딩 2층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "랜드엔지니어링㈜",
    "zip_code": "05719",
    "address_road": "서울시 송파구 중대로 105",
    "address_detail": "가락아이디타워 1302호",
    "location": "05719 서울시 송파구 중대로 105 가락아이디타워 1302호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "마인엔지니어링건축사사무소(주)",
    "zip_code": "58217",
    "address_road": "전남광주통합특별시 나주시 빛가람로 685",
    "address_detail": "6층 612호",
    "location": "58217 전남광주통합특별시 나주시 빛가람로 685 6층 612호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "메트로 / 보임플래닝 / 에코빌",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "미래건축전략연구소",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "미래환경정책연구원(주)",
    "zip_code": "61244",
    "address_road": "광주광역시 북구 태봉로 41",
    "address_detail": "202호",
    "location": "61244 광주광역시 북구 태봉로 41 202호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "에너지엑스㈜",
    "zip_code": "10546",
    "address_road": "경기도 고양시 덕양구 향기로 152",
    "address_detail": null,
    "location": "10546 경기도 고양시 덕양구 향기로 152",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "비이엘테크놀로지(BEL)",
    "zip_code": "05854",
    "address_road": "서울특별시 송파구 송파대로 201",
    "address_detail": "송파테라타워2 B동 12층 B-1212호",
    "location": "05854 서울특별시 송파구 송파대로 201 송파테라타워2 B동 12층 B-1212호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "삼신설계주식회사",
    "zip_code": "05837",
    "address_road": "서울특별시 송파구 송파대로 111",
    "address_detail": "파크하비오 205동 511호",
    "location": "05837 서울특별시 송파구 송파대로 111 파크하비오 205동 511호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)종합건축사사무소 선기획",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)세익컨설턴트",
    "zip_code": "05855",
    "address_road": "서울 송파구 송파대로 167",
    "address_detail": "테라타워 1차 에이동 711호, 712호",
    "location": "05855 서울 송파구 송파대로 167 테라타워 1차 에이동 711호, 712호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)센솔루션",
    "zip_code": "12248",
    "address_road": "경기 남양주시 다산순환로 20",
    "address_detail": "현대프리미어캠퍼스 D동 809호",
    "location": "12248 경기 남양주시 다산순환로 20 현대프리미어캠퍼스 D동 809호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)시선컨설팅(SEE SUN)",
    "zip_code": "5755",
    "address_road": "서울 송파구 거마로 74 601호",
    "address_detail": null,
    "location": "5755 서울 송파구 거마로 74 601호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)썬앤라이트",
    "zip_code": "06648",
    "address_road": "서울시 서초구 서초대로 42길 41",
    "address_detail": "안화빌딩 5층",
    "location": "06648 서울시 서초구 서초대로 42길 41 안화빌딩 5층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)아이엔지건축사사무소",
    "zip_code": "48002",
    "address_road": "부산광역시 해운대구 반송로525번길 25",
    "address_detail": "302호",
    "location": "48002 부산광역시 해운대구 반송로525번길 25 302호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "친환경건축설계그룹에이앤지(A&G)",
    "zip_code": "05818",
    "address_road": "서울 송파구 오금로 332",
    "address_detail": "다윤빌딩 비동 7층",
    "location": "05818 서울 송파구 오금로 332 다윤빌딩 비동 7층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)아이포디엄",
    "zip_code": "05836",
    "address_road": "서울시 송파구 법원로 127",
    "address_detail": "문정대명벨리온 903호",
    "location": "05836 서울시 송파구 법원로 127 문정대명벨리온 903호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)안파트너스",
    "zip_code": "06229",
    "address_road": "서울 강남구 도곡로37길 20",
    "address_detail": "남훈빌딩 3층",
    "location": "06229 서울 강남구 도곡로37길 20 남훈빌딩 3층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "에코넥스이엔씨 건축사사무소",
    "zip_code": "13636",
    "address_road": "경기도 성남시 분당구 성남대로 69",
    "address_detail": "로드랜드 이지타워 611호",
    "location": "13636 경기도 성남시 분당구 성남대로 69 로드랜드 이지타워 611호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "에코다(ECODA)",
    "zip_code": "04783",
    "address_road": "서울 성동구 아차산로 144",
    "address_detail": "601호",
    "location": "04783 서울 성동구 아차산로 144 601호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "에코리드(주)",
    "zip_code": "04322",
    "address_road": "서울시 용산구 한강대로 257",
    "address_detail": "청룡빌딩 3층",
    "location": "04322 서울시 용산구 한강대로 257 청룡빌딩 3층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "에코시안(Ecosian)",
    "zip_code": "08511",
    "address_road": "서울시 금천구 디지털로9길 65",
    "address_detail": "백상스타타워 1차 8층",
    "location": "08511 서울시 금천구 디지털로9길 65 백상스타타워 1차 8층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "에코엔지니어링 건축사사무소",
    "zip_code": "06099",
    "address_road": "서울시 강남구 선릉로129길 9-7",
    "address_detail": "미림빌딩 4층",
    "location": "06099 서울시 강남구 선릉로129길 9-7 미림빌딩 4층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "한국에코엔지니어링",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "에코지음",
    "zip_code": "03927",
    "address_road": "서울 마포구 월드컵북로50길 14-6",
    "address_detail": "태광빌딩 302호",
    "location": "03927 서울 마포구 월드컵북로50길 14-6 태광빌딩 302호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "한솔에코플랜(주)",
    "zip_code": "06266",
    "address_road": "강남구 남부순환로 351길 24",
    "address_detail": "구정빌딩 3층",
    "location": "06266 강남구 남부순환로 351길 24 구정빌딩 3층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)에코플랜건축사사무소",
    "zip_code": "05542",
    "address_road": "서울시 송파구 올림픽로 336",
    "address_detail": "대우유토피아오피스텔 B/D 6층 605호",
    "location": "05542 서울시 송파구 올림픽로 336 대우유토피아오피스텔 B/D 6층 605호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "연건축사사무소",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)연암ENC",
    "zip_code": "05556",
    "address_road": "서울 송파구 백제고분로7길 7-5",
    "address_detail": "4층",
    "location": "05556 서울 송파구 백제고분로7길 7-5 4층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "온고당 건축사사무소",
    "zip_code": "06049",
    "address_road": "서울특별시 강남구 언주로147길 43",
    "address_detail": "호성빌딩 3층",
    "location": "06049 서울특별시 강남구 언주로147길 43 호성빌딩 3층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)우원엠앤이",
    "zip_code": "08768",
    "address_road": "서울시 관악구 조원중앙로1길 13",
    "address_detail": null,
    "location": "08768 서울시 관악구 조원중앙로1길 13",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "위드너스",
    "zip_code": "07276",
    "address_road": "서울 영등포구 영등포로3길 3",
    "address_detail": "C타워 801호",
    "location": "07276 서울 영등포구 영등포로3길 3 C타워 801호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "이앤에스솔루션",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "이지컨설턴트",
    "zip_code": "16954",
    "address_road": "경기도 용인시 기흥구 흥덕1호 13",
    "address_detail": "타워동 1203호",
    "location": "16954 경기도 용인시 기흥구 흥덕1호 13 타워동 1203호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)자림이앤씨건축사사무소(자림ENC)",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)자림건축사사무소",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)에이비랩 건축사사사무소(ABLAB)",
    "zip_code": "04782",
    "address_road": "서울시 성동구 연무장5가길 22-1",
    "address_detail": null,
    "location": "04782 서울시 성동구 연무장5가길 22-1",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)정도",
    "zip_code": "05574",
    "address_road": "서울시 송파구 도곡로 454",
    "address_detail": "정도빌딩",
    "location": "05574 서울시 송파구 도곡로 454 정도빌딩",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "정림건축종합건축사사무소",
    "zip_code": "03122",
    "address_road": null,
    "address_detail": null,
    "location": "03122",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)제드건축사사무소",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "제이씨 코퍼레이션",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "중원건축사사무소",
    "zip_code": "06763",
    "address_road": "서울시 서초구 바우뫼로14",
    "address_detail": "중원빌딩",
    "location": "06763 서울시 서초구 바우뫼로14 중원빌딩",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)중원도시종합건축사사무소",
    "zip_code": "06734",
    "address_road": "서울시 서초구 서운로 22",
    "address_detail": "제이에스빌딩 9층",
    "location": "06734 서울시 서초구 서운로 22 제이에스빌딩 9층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "지유도시건축연구소",
    "zip_code": "07807",
    "address_road": "서울 강서구 마곡중앙1로 20",
    "address_detail": "마곡M시 그니처 8층 813,814호",
    "location": "07807 서울 강서구 마곡중앙1로 20 마곡M시 그니처 8층 813,814호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)집현이앤씨(집현ENC)",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)천일엠이씨",
    "zip_code": "08505",
    "address_road": "서울시 금천구 가산디지털2로 101",
    "address_detail": "한라원앤원타워 B동 608~9호",
    "location": "08505 서울시 금천구 가산디지털2로 101 한라원앤원타워 B동 608~9호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)청마",
    "zip_code": "08513",
    "address_road": "서울시 금천구 디지털로 179",
    "address_detail": "가산퍼블릭 A동 1017~1022호",
    "location": "08513 서울시 금천구 디지털로 179 가산퍼블릭 A동 1017~1022호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)친환경계획그룹 청연",
    "zip_code": "06248",
    "address_road": "서울특별시 강남구 논현로 71길 6",
    "address_detail": "청연빌딩",
    "location": "06248 서울특별시 강남구 논현로 71길 6 청연빌딩",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)친환경건축컨설팅전문기업 그린툴",
    "zip_code": "06691",
    "address_road": "서울시 서초구 방배천로 4안길 45",
    "address_detail": "201호",
    "location": "06691 서울시 서초구 방배천로 4안길 45 201호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)코담기술단",
    "zip_code": "05550",
    "address_road": "서울시 송파구 오금로 17길 8",
    "address_detail": "중앙빌딩 3층",
    "location": "05550 서울시 송파구 오금로 17길 8 중앙빌딩 3층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "테스(주)",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)플러스에이컨설팅",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)피앤디엔지니어링",
    "zip_code": null,
    "address_road": null,
    "address_detail": null,
    "location": null,
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)하임파트너스",
    "zip_code": null,
    "address_road": "서울 노원구 상계로5길 12",
    "address_detail": null,
    "location": "서울 노원구 상계로5길 12",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)한국건설환경",
    "zip_code": "07251",
    "address_road": "서울특별시 영등포구 영신로166",
    "address_detail": "반도아이비밸리 11층",
    "location": "07251 서울특별시 영등포구 영신로166 반도아이비밸리 11층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "KITC한국산업기술인증원",
    "zip_code": "10403",
    "address_road": "경기도 고양시 일산동구 백마로 195",
    "address_detail": "SK엠시티오피스 11층",
    "location": "10403 경기도 고양시 일산동구 백마로 195 SK엠시티오피스 11층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "(주)한국친환경기술연구소",
    "zip_code": "14051",
    "address_road": "경기도 안양시 동안구 부림로169번길 41",
    "address_detail": null,
    "location": "14051 경기도 안양시 동안구 부림로169번길 41",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "한국환경설계",
    "zip_code": null,
    "address_road": "서울특별시 송파구 삼전동 22-1 미성빌딩 401호 4층",
    "address_detail": null,
    "location": "서울특별시 송파구 삼전동 22-1 미성빌딩 401호 4층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "한미글로벌",
    "zip_code": "06164",
    "address_road": "서울특별시 강남구 삼성동 159-9 도심공항타워빌딩 9층",
    "address_detail": null,
    "location": "06164 서울특별시 강남구 삼성동 159-9 도심공항타워빌딩 9층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "하이멕(HIMEC)/한일엠이씨",
    "zip_code": "07271",
    "address_road": "서울시 영등포구 양산로 53",
    "address_detail": "월드메르디앙 비즈센터 8층",
    "location": "07271 서울시 영등포구 양산로 53 월드메르디앙 비즈센터 8층",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "해안건축",
    "zip_code": "06135",
    "address_road": "서울시 강남구 봉은사로 208",
    "address_detail": "해안빌딩",
    "location": "06135 서울시 강남구 봉은사로 208 해안빌딩",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  },
  {
    "name": "베르데코(Verdeco)/혜림에코자인",
    "zip_code": "03929",
    "address_road": "서울시 마포구 성암로 189",
    "address_detail": "1605호",
    "location": "03929 서울시 마포구 성암로 189 1605호",
    "category": "건물 인증 관련",
    "departments": [
      {
        "name": "전사",
        "is_hidden": false
      }
    ]
  }
] as const;
