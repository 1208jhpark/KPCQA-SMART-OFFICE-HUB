'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

// 카테고리 마스터 탭 설정
const CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'BANNER', label: '현수막', icon: '📜' },
  { id: 'MEDAL', label: '기타 제작물', icon: '🏆' },
];

export default function ProductionApplyForm() {
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('SIGN'); 

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // 1. 📊 [판 종류 & 단가 & 규격 마스터]
  const [plateMasterList, setPlateMasterList] = useState([
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
  ]);

  // 📊 [외주업체 동적 마스터 상태 리스트]
  const [vendorMasterList, setVendorMasterList] = useState([
    { id: 'VEND_01', label: '아트로릭' },
    { id: 'VEND_02', label: '한생미디어' },
  ]);

  // 팝업 내부 신규 업체 입력 보조 상태
  const [newVendorName, setNewVendorName] = useState('');
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [editingVendorValue, setEditingVendorValue] = useState('');

// 🚀 [명판 전용] 인증 종류 & 유효기간 서식 마스터 (ISO 포함, 결로 제외)
const [signCertMasterList, setSignCertMasterList] = useState<{id: string; label: string; format: string;}[]>([
  { id: 'GSEED', label: '녹색건축인증', format: '(0000. 00. 00. ~ 0000. 00. 00.)' },
  { id: 'BF', label: 'BF 인증', format: '(0000. 00. 00 ~ 0000. 00. 00)' },
  { id: 'EDUCATIONAL', label: '교육시설안전인증', format: '0000.00.00.~0000.00.00.' }, // 👈 필요시 포맷 수정 가능
  { id: 'ENERGY', label: '건축물에너지효율등급인증', format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00' },
  { id: 'OLD_ZEB', label: '(구) 제로에너지건축물인증', format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00' },
  { id: 'INTEGRATED_ZEB', label: '(통합) 제로에너지건축물인증', format: '유효기간: 0000. 00. 00 ~ 0000. 00. 00' },
  { id: 'ISO', label: 'ISO 인증', format: '' },
]);

// 🚀 [제본 전용] 인증 종류 & 완료일자 서식 마스터 (결로 포함, ISO 제외)
const [jebonCertMasterList, setJebonCertMasterList] = useState<{id: string; label: string; jebonFormat: string;}[]>([
  { id: 'GSEED', label: '녹색건축인증', jebonFormat: '0000. 0. 0.' },
  { id: 'CONDENDSATION', label: '결로방지 성능평가', jebonFormat: '0000. 0. 0.' },
  { id: 'ENERGY', label: '건축물에너지효율등급인증', jebonFormat: '0000. 0. 0' },
  { id: 'OLD_ZEB', label: '(구) 제로에너지건축물인증', jebonFormat: '0000. 0. 0.' },
  { id: 'INTEGRATED_ZEB', label: '(통합) 제로에너지건축물인증', jebonFormat: '0000. 0. 0.' },
  { id: 'NORMAL', label: '일반제본', jebonFormat: '' }, // ➕ 일반제본 전용 기본 포맷 추가
]);

// ⚙️ 모달 및 에디터 제어 변수 정의
const [popSubTab, setPopSubTab] = useState<'SIGN_SUB' | 'JEBON_SUB'>('SIGN_SUB');
const [editingCertId, setEditingCertId] = useState<string | null>(null);
const [editingCertForm, setEditingCertForm] = useState({ label: '', format: '', jebonFormat: '' });
const [newCertName, setNewCertName] = useState('');

  // 3. 🎯 [관계형 등급 맵 마스터]
  const [gradeMasterMap, setGradeMasterMap] = useState<Record<string, string[]>>({
    GSEED: ['최우수 (그린1등급)', '우수 (그린2등급)', '우량 (그린3등급)', '일반 (그린4등급)'],
    BF: ['최우수', '우수', '일반'],
    EDUCATIONAL: ['최우수', '우수'],
    OLD_ZEB: ['ZEB 5', 'ZEB 4', 'ZEB 3', 'ZEB 2', 'ZEB 1'],
    INTEGRATED_ZEB: ['ZEB 5', 'ZEB 4', 'ZEB 3', 'ZEB 2', 'ZEB 1', 'ZEB +'],
    ENERGY: ['1+++', '1++', '1+', '1등급', '2등급', '3등급', '4등급', '5등급', '6등급', '7등급'],
    ISO: ['ISO 9001', 'ISO 14001', 'ISO 45001','IATF16949','ISO 22000','TL 9000','ISO 50001','ISO 22301','ISO 37001','ISO 37301','ISO/IEC 27001', 'ISO 21001', 'ISO 10002', 'ISO/IEC 42001'],
  });

  // 🛠️ 모달 제어용 플래그 상태
  const [isPlateModalOpen, setIsPlateModalOpen] = useState(false);
  const [isCertModalOpen, setIsCertModalOpen] = useState(false);
  
  const [selectedMasterCertId, setSelectedMasterCertId] = useState<string>('GSEED');
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  // 📝 실무 신청서 폼 상태 대장
  const [signData, setSignData] = useState({
    applyDate: todayStr,       
    dept: '',                   
    manager: '',              
    vendor: 'VEND_01',          
    plateType: 'CAST_IRON_400',      
    certType: 'GSEED',         
    certLevel: '',          
    productionName: '', 
    projectName: '',           
    certNumber: '',            
    validPeriodRaw: '',        
    receiverName: '',          
    receiverPhone: '',         
    shippingAddress: '',       
    companyName: '',           
    applicantName: '',         
    applicantPhone: '',
    quantity: 1, 

    // 제본(JEBON) 전용 상태
    coverColor: '컬러',     
    innerColor: '흑백',     
    certPhase: '예비인증',    
    coverName: '', 
    compDateRaw: '', 
    coverPageCount: '', 
    innerPageCount: '',

    internalSystemSerial: '', 
  });

  // /api/auth/me 실전 비동기 API 세션 연동
  useEffect(() => {
    async function loadUserSession() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (res.ok) {
          const user = await res.json();
          setSignData(prev => ({
            ...prev,
            dept: user.unit?.unit_name || '소속 조직 없음',
            manager: user.name || '담당자명 없음'
          }));
        } else {
          setSignData(prev => ({ ...prev, dept: '미인증 조직', manager: '익명 사용자' }));
        }
      } catch (error) {
        setSignData(prev => ({ ...prev, dept: '오류 부서', manager: '오류 담당자' }));
      } finally {
        setIsSessionLoading(false);
      }
    }
    loadUserSession();
  }, []); 

  useEffect(() => {
    const availableGrades = gradeMasterMap[signData.certType] || [];
    setSignData(prev => ({ ...prev, certLevel: availableGrades[0] || '' }));
  }, [signData.certType, gradeMasterMap]);

  
// 🚀 [버그 수정 완료] 숫자가 꼬이는 replace 방식 대신 위치 기반 다이렉트 포맷팅
const formattedCompDate = useMemo(() => {
  const raw = signData.compDateRaw.replace(/\D/g, ''); 
  
  // 1. 8자리가 다 안 채워졌으면 공백 탈출 가드
  if (!raw || raw.length !== 8) {
    return '';
  }

  // 2. 연, 월, 일 안전하게 쪼개기
  const y = raw.substring(0, 4);
  const mRaw = raw.substring(4, 6);
  const dRaw = raw.substring(6, 8);

  // 3. 앞자리 0 제거 처리 (예: "07" -> "7", "14" -> "14")
  const m = String(parseInt(mRaw, 10));
  const d = String(parseInt(dRaw, 10));

  // 4. 현재 선택된 마스터의 원본 양식 포맷 확인
  const targetCert = jebonCertMasterList.find(c => c.id === signData.certType);
  const format = targetCert?.jebonFormat || '0000. 0. 0.';

  // 💡 [핵심 버그 해결]: 포맷 모양(00인지 0인지)에 따라 안전하게 강제 조립
  if (format.includes('0000. 00. 00')) {
    // 포맷이 '0000. 00. 00.' 형태일 때 (두 자리 고정)
    return `${y}. ${mRaw}. ${dRaw}.`;
  } else if (format.includes('0000. 0. 0')) {
    // 포맷이 '0000. 0. 0.' 또는 '0000. 0. 0' 형태일 때 (한 자리 허용)
    const hasTrailingDot = format.endsWith('.');
    return `${y}. ${m}. ${d}${hasTrailingDot ? '.' : ''}`;
  }

  // 예외 케이스 처리
  return `${y}. ${m}. ${d}.`;
}, [signData.compDateRaw, signData.certType, jebonCertMasterList]);

// 🚀 [명판 전용 마스터 분리 반영] 명판 날인 유효기간 실시간 출력 포맷팅
const formattedValidPeriod = useMemo(() => {
  const raw = signData.validPeriodRaw.replace(/\D/g, ''); 
  
  // 🔗 [교체 완료]: signCertMasterList에서 명판 유효기간 포맷 서식을 탐색합니다.
  const targetCert = signCertMasterList.find(c => c.id === signData.certType);
  let format = targetCert?.format || '0000.00.00.~0000.00.00.';

  if (raw.length === 0) return format;

  const sY = raw.substring(0, 4);
  const sM = raw.substring(4, 6) ? String(parseInt(raw.substring(4, 6), 10)) : '';
  const sD = raw.substring(6, 8) ? String(parseInt(raw.substring(6, 8), 10)) : '';
  const eY = raw.substring(8, 12);
  const eM = raw.substring(12, 14) ? String(parseInt(raw.substring(12, 14), 10)) : '';
  const eD = raw.substring(14, 16) ? String(parseInt(raw.substring(14, 16), 10)) : '';

  if (sY) format = format.replace('0000', sY);
  if (eY) format = format.replace('0000', eY);

  const sMM = sM.padStart(2, '0');
  const sDD = sD.padStart(2, '0');
  const eMM = eM.padStart(2, '0');
  const eDD = eD.padStart(2, '0');

  while (format.includes('00')) {
    if (format.includes('00')) format = format.replace('00', sMM);
    if (format.includes('00')) format = format.replace('00', sDD);
    if (format.includes('00')) format = format.replace('00', eMM);
    if (format.includes('00')) format = format.replace('00', eDD);
  }

  if (sM) format = format.replace('0', sM);
  if (sD) format = format.replace('0', sD);
  if (eM) format = format.replace('0', eM);
  if (eD) format = format.replace('0', eD);

  return format;
  
// 🔗 [교체 완료]: 의존성 배열의 감지 대상을 signCertMasterList로 업데이트
}, [signData.validPeriodRaw, signData.certType, signCertMasterList]);

  // 마스터 컨트롤 에디터 제어 변수
  const [editingPlateIndex, setEditingPlateIndex] = useState<number | null>(null);
  const [newPlate, setNewPlate] = useState({ label: '', price: 0, size: '' });
  
  const [editingGradeIndex, setEditingGradeIndex] = useState<number | null>(null);
  const [editingGradeValue, setEditingGradeValue] = useState<string>('');
  const [newGradeName, setNewGradeName] = useState('');

  const [customRequests, setCustomRequests] = useState<{ id: number; value: string }[]>([
    { id: Date.now(), value: '' }
  ]);

  const currentSelectedInfo = useMemo(() => {
    const target = plateMasterList.find(p => p.code === signData.plateType);
    return {
      label: target?.label || '미지정 품목',
      size: target?.size || '자율 규격',
      priceStr: target ? `${target.price.toLocaleString()}원` : '0원'
    };
  }, [signData.plateType, plateMasterList]);

  const handleAddPlateMaster = () => {
    if (!newPlate.label.trim()) return alert('판 명칭을 입력하세요.');
    const code = `PLATE_${Date.now()}`;
    setPlateMasterList([...plateMasterList, { code, label: newPlate.label, price: newPlate.price, size: newPlate.size || '자율 규격' }]);
    setNewPlate({ label: '', price: 0, size: '' });
  };

  const handleIdDeletePlate = (code: string) => {
    if (plateMasterList.length <= 1) return alert('최소 한 개 이상의 판 종류가 존재해야 합니다.');
    if (!confirm('해당 판 종류와 연동된 단가/규격 설정을 마스터 삭제하시겠습니까?')) return;
    setPlateMasterList(plateMasterList.filter(p => p.code !== code));
    if (signData.plateType === code) signData.plateType = plateMasterList[0].code;
  };

// 🚀 [이원화 대응] 신규 인증 종류 추가 핸들러 교정
const handleAddCertMaster = () => {
  if (!newCertName.trim()) return alert('인증 명칭을 기재해 주세요.');
  
  const id = `CERT_${Date.now()}`;
  const isSign = popSubTab === 'SIGN_SUB';

  if (isSign) {
    // 1) 명판(SIGN) 탭일 때: signCertMasterList에 추가 (format만 바인딩)
    setSignCertMasterList([
      ...signCertMasterList, 
      { id, label: newCertName.trim(), format: '0000.00.00.~0000.00.00.' }
    ]);
  } else {
    // 2) 제본(JEBON) 탭일 때: jebonCertMasterList에 추가 (jebonFormat만 바인딩)
    setJebonCertMasterList([
      ...jebonCertMasterList, 
      { id, label: newCertName.trim(), jebonFormat: '0000. 0. 0.' }
    ]);
  }

  // 관계형 등급 매핑에 기본 등급 배열 바인딩 처리 (공통)
  setGradeMasterMap(prev => ({ ...prev, [id]: ['기본 등급'] }));
  
  // 새로 생성된 인증 종류를 즉시 포커싱
  setSelectedMasterCertId(id);
  
  // 입력 칸 초기화
  setNewCertName('');
};

// 🚀 [TypeScript 컴파일 가드 완결] 인증 종류 마스터 삭제 핸들러 교정
const handleIdDeleteCert = (id: string) => {
  // 1. [디펜스 가드]: 코드 로직과 1:1 결합된 핵심 기준 데이터 삭제 원천 봉쇄 (공통)
  if (['GSEED', 'BF', 'CONDENDSATION', 'EDUCATIONAL', 'ENERGY', 'OLD_ZEB', 'INTEGRATED_ZEB', 'ISO'].includes(id)) {
    return alert('⚠️ 시스템 핵심 기준 데이터입니다. 삭제할 수 없으며, 필요시 명칭(라벨) 수정만 가능합니다.');
  }

  if (!confirm('이 인증 종류를 리스트에서 마스터 삭제하시겠습니까?')) return;

  // 2. TypeScript 타입 추론을 위해 명판과 제본의 상태 업데이트 분리 실행
  if (popSubTab === 'SIGN_SUB') {
    // 📛 명판(SIGN) 마스터 삭제 프로세스
    if (signCertMasterList.length <= 1) return alert('최소 한 개 이상의 인증 종류가 존재해야 합니다.');
    
    setSignCertMasterList(signCertMasterList.filter(c => c.id !== id));
    
    if (signData.certType === id) {
      const remaining = signCertMasterList.filter(c => c.id !== id);
      setSignData(prev => ({ ...prev, certType: remaining[0]?.id || '' }));
    }
  } else {
    // 📚 제본(JEBON) 마스터 삭제 프로세스
    if (jebonCertMasterList.length <= 1) return alert('최소 한 개 이상의 인증 종류가 존재해야 합니다.');
    
    setJebonCertMasterList(jebonCertMasterList.filter(c => c.id !== id));
    
    if (signData.certType === id) {
      const remaining = jebonCertMasterList.filter(c => c.id !== id);
      setSignData(prev => ({ ...prev, certType: remaining[0]?.id || '' }));
    }
  }
};
  // 🚀 최종 폼 제출 핸들러 (통합 가드 컴파일 완료)
  const handleSubmit = async () => {
    if (!signData.vendor) return alert("외주 발주 처리 업체를 지정해 주세요.");
    if (!signData.receiverName.trim() || !signData.receiverPhone.trim() || !signData.shippingAddress.trim()) {
      return alert("최종 제작물 실배송지 정보를 모두 입력해 주세요.");
    }
    if (!signData.companyName.trim() || !signData.applicantName.trim() || !signData.applicantPhone.trim()) {
      return alert("시스템 내부 보관 보조 서식 정보를 모두 입력해 주세요.");
    }
    if (signData.quantity < 1) return alert("수량은 1개 이상이어야 합니다.");

    if (activeTab === 'SIGN') {
      if (!signData.projectName.trim()) return alert("4. 프로젝트명을 입력해 주세요.");
    } else if (activeTab === 'JEBON') {
      if (!signData.projectName.trim() && !signData.coverName.trim()) {
        return alert("프로젝트명 또는 별도 표지 명칭 중 최소 하나는 반드시 입력하셔야 합니다.");
      }
    }

    const selectedPlate = plateMasterList.find(p => p.code === signData.plateType);
    const estimatedPrice = (selectedPlate?.price || 0) * signData.quantity;

    const selectedVendorInfo = vendorMasterList.find(v => v.id === signData.vendor);
    const currentCertList = activeTab === 'SIGN' ? signCertMasterList : jebonCertMasterList;
    const selectedCertInfo = currentCertList.find(c => c.id === signData.certType);

    const payload = {
      category: activeTab,
      projectName: signData.projectName || signData.coverName,
      quantity: signData.quantity,
      estimatedPrice: estimatedPrice,
      options: {
        ...signData,
        vendor: selectedVendorInfo ? selectedVendorInfo.label : signData.vendor,
        certType: selectedCertInfo ? selectedCertInfo.label : signData.certType,
        formattedValidPeriod: formattedValidPeriod,
        formattedCompDate: formattedCompDate,
        plateMasterInfo: currentSelectedInfo,
        customRequests: customRequests.filter(req => req.value.trim() !== '').map(req => req.value)
      }
    };

    try {
      const res = await fetch('/api/asset/production/apply/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert("성공적으로 제작 신청이 접수되었습니다.");
        router.push('/asset/production/apply/history'); 
      } else {
        const errorData = await res.json();
        alert(`신청 실패: ${errorData.message}`);
      }
    } catch (error) {
      alert("네트워크 오류가 발생했습니다. 관리자에게 문의하세요.");
    }
  };
  
  if (isSessionLoading) {
    return <div className="p-20 font-black text-blue-500 animate-pulse text-center text-xs tracking-widest mt-20">인프라 코어로부터 실시간 유저 세션 인증 연동 중...</div>;
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      {/* 배너 */}
      <div className="w-full bg-slate-50 border-2 border-blue-500 p-6 rounded-[2.5rem] shadow-sm relative overflow-hidden flex flex-col justify-center min-h-[140px]">
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-3">DEPARTMENT PRODUCTION PROCESS CENTER</h3>
            <h1 className="text-2xl font-black tracking-tight text-slate-800 leading-none flex items-center flex-wrap gap-2.5">
              <span>부서 맞춤 제작물 신청 허브</span>
            </h1>
            <p className="text-slate-500 text-xs font-semibold mt-4 opacity-95">친환경 인증 명판, 상패 명세 및 외주 제작 단가 테이블을 연동하여 신청 원장을 구성합니다.</p>
          </div>
        </div>
      </div>

      {/* 동적 탭 네비게이션 */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-2xl mt-4">
        {[{ name: '✍️ 신규 제작물 신청', path: '/asset/production/apply/request' }, { name: '📂 나의 신청 이력 관리', path: '/asset/production/apply/history' }].map((tab) => {
          const isActive = pathname === tab.path || (tab.path === '/asset/production/apply' && pathname === '/asset/production/apply/request');
          return (
            <Link key={tab.path} href={tab.path} className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${isActive ? 'bg-white text-blue-600 shadow-sm border border-blue-200/50 scale-[1.01]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'}`}>
              {tab.name}
            </Link>
          );
        })}
      </div>

      {/* 카테고리 대형 스위치 보드 */}
      <div className="flex flex-wrap gap-3 pt-4 w-full">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveTab(cat.id)}
            className={`flex items-center gap-2.5 px-6 py-4 rounded-2xl font-black text-xs transition-all duration-200 shadow-sm
              ${activeTab === cat.id 
                ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20 scale-[1.02]' 
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
          >
            <span className="text-base">{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* 메인 폼 컨테이너 */}
      <div className="w-full bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200/80 mt-2">
        <div className="flex justify-between items-center border-b border-slate-100 pb-4 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">{CATEGORIES.find(c => c.id === activeTab)?.icon || '✍️'}</span>
            <h2 className="text-lg font-black text-slate-800">
              {CATEGORIES.find(c => c.id === activeTab)?.label || '부서 맞춤'} 제작 발급 신청서 원장
            </h2>
          </div>
          
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIsVendorModalOpen(true)} className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-black text-xs shadow-md hover:from-emerald-700 hover:to-teal-700 active:scale-95 transition-all flex items-center gap-2">
              <span>🏢</span> 외주 발주 업체 기준 지정
            </button>
            <button type="button" onClick={() => setIsPlateModalOpen(true)} className="px-5 py-2.5 bg-gradient-to-r from-slate-700 to-slate-900 text-white rounded-xl font-black text-xs shadow-md hover:from-slate-800 hover:to-black active:scale-95 transition-all flex items-center gap-2">
              <span>📊</span> 명판 품목/규격/단가 기준 지정
            </button>
            <button type="button" onClick={() => setIsCertModalOpen(true)} className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-black text-xs shadow-md hover:from-blue-700 hover:to-indigo-700 active:scale-95 transition-all flex items-center gap-2">
              <span>⚙️</span> 인증 종류/유효기간/등급 기준 지정
            </button>
          </div>
        </div>

        {/* 외주 발주 처리 업체 배정 바 */}
        <div className="p-5 bg-blue-50/40 border border-blue-200/60 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 mt-4">
          <div className="space-y-0.5">
            <label className="block text-[10px] font-black text-blue-600 tracking-widest uppercase">FACTORY & VENDOR ASSIGNMENT *</label>
            <div className="text-xs font-black text-slate-800">제작 외주 처리 업체 배정</div>
            <div className="text-[10px] text-slate-400 font-medium">본 원장 데이터가 전송 및 다운로드될 최종 제작 공장/업체를 선택합니다.</div>
          </div>
          <div className="flex gap-2 items-center shrink-0 min-w-[240px]">
            <select value={signData.vendor} onChange={(e) => setSignData({ ...signData, vendor: e.target.value })} className="w-full bg-white border border-blue-300 rounded-xl px-4 py-3 text-xs font-black text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer">
              {vendorMasterList.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-6 pt-6">
          {/* 상단 공통 영역: 요청자 자동 연동 정보 */}
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200/60 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-[10px] font-black text-slate-400 tracking-widest uppercase mb-1.5">요청일 (자동)</label>
              <input type="text" readOnly value={signData.applyDate} className="w-full bg-slate-200/60 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-500 outline-none select-none cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 tracking-widest uppercase mb-1.5">소속 조직 (자동)</label>
              <input type="text" readOnly value={signData.dept} className="w-full bg-slate-200/60 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-500 outline-none select-none cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 tracking-widest uppercase mb-1.5">담당자 (자동)</label>
              <input type="text" readOnly value={signData.manager} className="w-full bg-slate-200/60 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-500 outline-none select-none cursor-not-allowed" />
            </div>
          </div>

          {/* 🚀 [동적 변환 영역]: 탭에 따라 스위칭되는 중간 섹션 */}
          <div className="bg-yellow-50 border-2 border-yellow-400 p-8 rounded-2xl transition-all shadow-inner space-y-6 relative mt-4">
            <div className="absolute -top-3 left-6 bg-yellow-400 text-yellow-900 px-4 py-1 rounded-full text-[10px] font-black tracking-widest shadow-sm">
              DYNAMIC AREA : {CATEGORIES.find(c => c.id === activeTab)?.label} 전용 입력 폼
            </div>

{/* 🔥 현판(SIGN) 탭일 때만 보이는 영역 */}
{activeTab === 'SIGN' && (
              <div className="space-y-6 animate-fade-in pt-2">

                <div className="p-6 bg-white rounded-2xl border border-yellow-200 space-y-6 shadow-sm">
                  
                  {/* 🚀 1행: 품목 선택 오른쪽에 견적명세 실시간 1:1 표출 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">1. 품목 및 기본 사양 매핑 선택 <span className="text-red-500">*</span></label>
                      <select value={signData.plateType} onChange={(e) => setSignData({ ...signData, plateType: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white">
                        {plateMasterList.map(p => <option key={p.code} value={p.code}>{p.label} ({p.size})</option>)}
                      </select>
                    </div>
                    
                    {/* 우측 바로 이동된 실시간 명세정보 테이블 */}
                    <div className="bg-slate-50/50 rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <table className="w-full text-left border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-slate-100 text-slate-500 font-black border-b border-slate-200 text-[9px]">
                            <th className="p-2 pl-4">선택 품명</th>
                            <th className="p-2 text-center">규격(mm)</th>
                            <th className="p-2 text-right pr-4">단가 (VAT별도)</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="font-bold text-slate-800 bg-white">
                            <td className="p-2.5 pl-4 text-blue-600 text-xs truncate">📦 {currentSelectedInfo.label}</td>
                            <td className="p-2.5 text-center font-mono text-slate-600">{currentSelectedInfo.size}</td>
                            <td className="p-2.5 text-right font-mono text-emerald-600 font-black pr-4">{currentSelectedInfo.priceStr}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 🚀 2행: 인증의 종류 & 인증상세/등급 조건부 가변 나열 행 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start border-t border-slate-100 pt-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">2. 인증의 종류 <span className="text-red-500">*</span></label>
                      <select value={signData.certType} onChange={(e) => setSignData({ ...signData, certType: e.target.value, certLevel: '' })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white">
                        {signCertMasterList.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>

                    {/* 다이나믹 복합 인젝션 디스플레이 칸 */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">3. 인증상세 또는 등급 설정 <span className="text-red-500">*</span></label>
                      
                    
                      {/* 케이스 A: ISO 인증일 때 (마스터 대장 gradeMasterMap['ISO'] 기반 동적 복수 체크박스 구현) */}
                      {signData.certType === 'ISO' ? (
                        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                          {/* 🚀 마스터 데이터에서 ISO 리스트를 동적으로 땡겨와 3열 격자로 깔끔하게 배치 */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                            {(gradeMasterMap['ISO'] || []).map((iso) => {
                              const checked = signData.certLevel.includes(iso);
                              return (
                                <label key={iso} className="flex items-center gap-2 text-[11px] font-bold text-slate-700 cursor-pointer select-none hover:text-blue-600 transition-colors p-1 bg-white border border-slate-100 rounded-lg shadow-sm">
                                  <input 
                                    type="checkbox" 
                                    checked={checked} 
                                    className="w-3.5 h-3.5 accent-blue-600 rounded cursor-pointer"
                                    onChange={() => {
                                      let currentList = signData.certLevel ? signData.certLevel.split(', ') : [];
                                      if (checked) currentList = currentList.filter(x => x !== iso);
                                      else currentList = [...currentList, iso];
                                      setSignData({ ...signData, certLevel: currentList.join(', ') });
                                    }}
                                  />
                                  <span className="truncate">{iso}</span>
                                </label>
                              );
                            })}
                          </div>
                          
                          {/* 우측 실시간 중복 나열 뱃지 존 */}
                          {signData.certLevel && (
                            <div className="flex flex-wrap gap-1 border-t border-slate-200 pt-3 mt-1">
                              {signData.certLevel.split(', ').map(tag => (
                                <span key={tag} className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-black rounded-md shadow-sm animate-fade-in">✓ {tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : signData.certType === 'CONDENDSATION' ? (
                        /* 케이스 B: 결로방지 성능평가일 때 (선택 필재 요소 불필요 방어막) */
                        <div className="w-full bg-slate-100 text-slate-400 font-medium rounded-xl px-4 py-3 text-xs border border-slate-200 select-none">
                          🚫 결로방지 성능평가는 별도의 마스터 등급 표기 사항이 없습니다.
                        </div>
                      ) : (
                        /* 케이스 C: 일반 건물인증군일 때 (기존 단일 셀렉트 드롭다운) */
                        <select value={signData.certLevel} onChange={(e) => setSignData({ ...signData, certLevel: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white">
                          {(gradeMasterMap[signData.certType] || []).map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* 🚀 3행: 인증 종류 맞춤형 완전 가변형 폼 그리드 조립 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-slate-100 pt-4">
                    {signData.certType === 'ISO' ? (
                      <>
                       {/* 🚀 전면 개편된 ISO 전용 특화 필드군 */}
                       <div>
                          <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">4. 기업명 <span className="text-slate-400 font-medium">(선택)</span></label>
                          <input type="text" placeholder="신청서의 기업명을 표기바랍니다." value={signData.companyName || ''} onChange={(e) => setSignData({ ...signData, companyName: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">5. 메인문구(한글)</label>
                          {/* 💡 기존 certNumber 스키마를 활용하되 화면에서는 한글 메인문구로 작동 */}
                          <input type="text" placeholder="예) 품질경영시스템 인증기업" value={signData.certNumber || ''} onChange={(e) => setSignData({ ...signData, certNumber: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">6. 메인문구(영문)</label>
                          {/* 💡 중복 출력을 제거하고 영문 메인문구 기입란(projectName)으로 변경 */}
                          <input type="text" placeholder="예) The Company in Integrated(QMS EMS) Management System Certified By" value={signData.projectName || ''} onChange={(e) => setSignData({ ...signData, projectName: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>

                    
                      </> 
                   ) : (
                    <>
                      {/* 일반 건물인증 특화 필드군 */}
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">4. 프로젝트명/건물명/시설명 <span className="text-red-500">*</span></label>
                        <input type="text" placeholder="프로젝트명 또는 건물명 등 명시" value={signData.projectName} onChange={(e) => setSignData({ ...signData, projectName: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                          {/* 🚀 includes 문법으로 GSEED와 BF 둘 다 안전하게 묶어 처리 */}
                          5. 인증번호 {['GSEED', 'BF'].includes(signData.certType) ? <span className="text-red-500 font-bold">(해당 인증은 입력 불가)</span> : <span className="text-slate-400 font-medium"></span>}
                        </label>
                        <input 
                          type="text" 
                          placeholder={['GSEED', 'BF'].includes(signData.certType) ? "해당 인증은 인증번호를 입력할 수 없습니다." : "필요한 경우 기재 바랍니다."} 
                          value={['GSEED', 'BF'].includes(signData.certType) ? "" : signData.certNumber}
                          onChange={(e) => setSignData({ ...signData, certNumber: e.target.value })} 
                          disabled={['GSEED', 'BF'].includes(signData.certType)}
                          className={`w-full border rounded-xl px-4 py-3 text-xs font-semibold outline-none transition-all
                            ${['GSEED', 'BF'].includes(signData.certType) 
                              ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed select-none' 
                              : 'bg-white border-slate-200 text-slate-800 focus:ring-2 focus:ring-blue-500'}`} 
                        />
                      </div>
                    </>
                  )}
                  </div>

                  {/* 4행: 명판 유효기간 기입 존 (명판 마스터에 없는 결로는 제외하고, ISO일 경우에만 입력란 숨김 처리) */}
                  {signData.certType !== 'ISO' && (
                    <div className="border-t border-slate-100 pt-4 animate-fade-in">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1.5">7. 명판 날인 유효기간 (숫자 연속 입력) <span className="text-slate-400 font-medium">(선택)</span></label>
                      <input type="text" maxLength={16} placeholder="예: 2026071020310709 (미기입 시 날짜 없음으로 처리)" value={signData.validPeriodRaw} onChange={(e) => setSignData({ ...signData, validPeriodRaw: e.target.value.replace(/\D/g, '') })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-black tracking-widest text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
                      
                      {/* 🚀 노란색 안내 박스는 항상 유지하고, 안쪽의 날짜 숫자만 16자리가 찼을 때 띄워줍니다. */}
                      <div className="mt-2 bg-yellow-100/50 p-3.5 rounded-xl font-mono text-sm font-black tracking-wider border border-yellow-200 shadow-inner flex items-center flex-wrap gap-2">
                        <span className="text-yellow-700">🖥️ 실시간 출력 실물 양식 ➡️</span>
                        <span className="text-slate-900 text-base">
                          {signData.validPeriodRaw && signData.validPeriodRaw.length === 16 
                            ? formattedValidPeriod 
                            : <span className="text-yellow-600/60 text-xs font-medium">미입력 (16자리 입력 시 출력됨)</span>}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 🔥 2. 제본(JEBON) 탭 뷰 */}
            {activeTab === 'JEBON' && (
              <div className="space-y-6 animate-fade-in pt-2">
              <div className="p-6 bg-white rounded-2xl border border-yellow-200 space-y-6 shadow-sm">
                
                {/* 🚀 전면 개편: 표지와 본문을 시각적 박스로 분리하여 견적서와 1:1 매칭 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* 📘 표지 (Cover) 설정 그룹 */}
                  <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-200">
                    <h4 className="text-[11px] font-black text-slate-700 tracking-widest mb-4 flex items-center gap-2">
                      <span className="text-blue-500">📘</span> 1. 표지 (Cover) 스펙 <span className="text-red-500">*</span>
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">인쇄 방식</label>
                        <select value={signData.coverColor} onChange={(e) => setSignData({ ...signData, coverColor: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-black text-blue-600 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer">
                          <option value="컬러">컬러 인쇄</option>
                          <option value="흑백">흑백 인쇄</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">면수 (페이지)</label>
                        <input type="number" placeholder="예: 1" value={signData.coverPageCount || ''} onChange={(e) => setSignData({ ...signData, coverPageCount: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none text-right" />
                      </div>
                    </div>
                  </div>

                  {/* 📄 본문 (Inner) 설정 그룹 */}
                  <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-200">
                    <h4 className="text-[11px] font-black text-slate-700 tracking-widest mb-4 flex items-center gap-2">
                      <span className="text-slate-500">📄</span> 2. 본문 (Inner) 스펙 <span className="text-red-500">*</span>
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">인쇄 방식</label>
                        <select value={signData.innerColor} onChange={(e) => setSignData({ ...signData, innerColor: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-black text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer">
                          <option value="흑백">흑백 인쇄</option>
                          <option value="컬러">컬러 인쇄</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">면수 (페이지)</label>
                        <input type="number" placeholder="예: 62" value={signData.innerPageCount || ''} onChange={(e) => setSignData({ ...signData, innerPageCount: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none text-right" />
                      </div>
                    </div>
                  </div>

                </div>

                 {/* 🚀 3, 4번 행: 인증 종류에 따른 단계 동적 반응형 그리드 */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">3. 제본 종류 선택 <span className="text-red-500">*</span></label>
                      <select value={signData.certType} onChange={(e) => setSignData({ ...signData, certType: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white">
                        {jebonCertMasterList.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>

                    {/* 💡 일반제본이 아닐 때만 '인증의 단계' 필수 노출 */}
                    {signData.certType !== 'NORMAL' ? (
                      <div className="animate-fade-in">
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">4. 인증의 단계 <span className="text-red-500">*</span></label>
                        <select value={signData.certPhase} onChange={(e) => setSignData({ ...signData, certPhase: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-indigo-600 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-white">
                          <option value="예비인증">예비인증</option>
                          <option value="본인증">본인증</option>
                        </select>
                      </div>
                    ) : (
                      // 일반제본일 때는 자리가 비어 보이거나 밀리지 않도록 공간 보조 박스로 채우거나 숨깁니다.
                      <div className="hidden md:block" />
                    )}
                  </div>

                  {/* 🚀 5번 행: 일반제본 분기 처리 가변형 서식 필드군 */}
                  {signData.certType === 'NORMAL' ? (
                    // 1) 일반제본일 때는 메인 제목과 서브 부제목 2단 분할 구조로 가시성 극대화
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in">
                      <div>
                        <label className="block text-[10px] font-black text-blue-600 tracking-widest uppercase mb-2">📄 제본 표지 메인 제목 <span className="text-red-500">*</span></label>
                        <input 
                          type="text" 
                          placeholder="예) 2026년도 하반기 업무 보고서" 
                          value={signData.coverName || ''} 
                          onChange={(e) => setSignData({ ...signData, coverName: e.target.value })} 
                          className="w-full bg-white border border-blue-200 focus:ring-2 focus:ring-blue-500 rounded-xl px-4 py-3 text-xs font-semibold outline-none shadow-sm" 
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">📝 표지 서브 부제목 <span className="text-slate-400 font-medium">(선택)</span></label>
                        <input 
                          type="text" 
                          placeholder="예) 경영기획부 제출용 (소제목 및 부제 기입)" 
                          value={signData.projectName || ''} 
                          onChange={(e) => setSignData({ ...signData, projectName: e.target.value })} 
                          className="w-full bg-white border border-slate-200 focus:ring-2 focus:ring-blue-500 rounded-xl px-4 py-3 text-xs font-semibold outline-none" 
                        />
                      </div>
                    </div>
                  ) : (
                    // 2) 일반인증 건물 제본일 때는 기존 2분할 폼 작동
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in">
                      <div>
                        <label className="block text-[10px] font-black text-slate-600 tracking-widest uppercase mb-2">5. 프로젝트명(건물명)</label>
                        <input type="text" placeholder="프로젝트명 또는 건물명을 입력해 주세요" value={signData.projectName || ''} onChange={(e) => setSignData({ ...signData, projectName: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                    </div>
                  )}

                  {/* 🚀 완료 일자 영역 */}
                  <div className="pt-2">
                    <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1.5">완료/지정일자 (숫자만 8자리 연속 입력) <span className="text-slate-400 font-medium">(선택)</span></label>
                    <input type="text" maxLength={8} placeholder="예: 20260713 (8자리 연속 기입)" value={signData.compDateRaw || ''} onChange={(e) => setSignData({ ...signData, compDateRaw: e.target.value.replace(/\D/g, '') })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-black tracking-widest text-indigo-600 outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
                    <div className="mt-2 bg-yellow-100/50 p-3.5 rounded-xl font-mono text-sm font-black tracking-wider border border-yellow-200 shadow-inner flex items-center flex-wrap gap-2">
                      <span className="text-yellow-700">🖥️ 제본 완료/지정일자 실시간 출력 양식 ➡️</span>
                      <span className="text-slate-900 text-base">{formattedCompDate}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 🔥 3. 기타 미오픈 카테고리 디펜스 방어 코드 */}
            {activeTab !== 'SIGN' && activeTab !== 'JEBON' && (
              <div className="p-16 text-center animate-fade-in bg-white rounded-2xl border border-yellow-200 shadow-sm">
                <span className="text-4xl mb-4 block">⚙️</span>
                <h3 className="text-lg font-black text-slate-400">선택하신 카테고리의 폼을 준비 중입니다.</h3>
              </div>
            )}

            {/* 공통 7번: 추가 제작 변수 요청사항 자유기재 (중간 섹션 내부 공통 귀속) */}
            <div className="p-6 bg-white rounded-2xl border border-yellow-200 space-y-3 shadow-sm mt-4">
              <div className="flex justify-between items-center">
                <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                  6. 추가 제작 변수 요청사항 자유기재 <span className="text-slate-400 font-medium">(선택)</span>
                </label>
                <button type="button" onClick={() => setCustomRequests([...customRequests, { id: Date.now(), value: '' }])} className="px-2.5 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 border border-yellow-300 rounded-lg font-black text-[10px] flex items-center gap-1 transition-all shadow-sm">➕ 추가</button>
              </div>
              {customRequests.map((req, index) => (
                <div key={req.id} className="flex items-center gap-2 animate-fade-in">
                  <span className="text-slate-400 font-mono font-bold w-3">{index + 1}.</span>
                  <input type="text" placeholder="요청 사항 혹은 하단 프리뷰 문구 보조 제어 스펙 자유 기재란" value={req.value} onChange={(e) => {
                    const updated = customRequests.map(c => c.id === req.id ? { ...c, value: e.target.value } : c);
                    setCustomRequests(updated);
                  }} className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
                  {customRequests.length > 1 && <button type="button" onClick={() => setCustomRequests(customRequests.filter(c => c.id !== req.id))} className="p-3 text-red-500 hover:bg-red-50 rounded-xl transition-all">🗑️</button>}
                </div>
              ))}
            </div>

          </div>
          {/* 🚀 [동적 변환 영역 종료] */}

          {/* 🚚 최종 제작물 실배송지 섹션 */}
      <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
          🚚 최종 제작물 실배송지 <span className="text-red-500">*</span>
        </h3>
        {/* 🚀 각 칸 위에 명확한 이름표기(레이블) 추가 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
          <div>
            <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">수령인 성명</label>
            <input type="text" placeholder="수령인 성명" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">수령인 연락처</label>
            <input type="text" placeholder="수령인 연락처" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">배송 도로명 주소 기재</label>
            <input type="text" placeholder="배송 도로명 주소 기재" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
        </div>
      </div>

      {/* 🗄️ 시스템 내부 보관 보조 서식 섹션 */}
      <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 border-b border-slate-200/60 pb-3">
          <span className="text-yellow-500">🗂️</span> 시스템 내부 보관 보조 서식 
          <span className="text-slate-400 text-[10px] font-normal ml-1">(외주 발주서 제외 항목)</span>
          <span className="text-slate-500">*</span>
        </h3>
        
        {/* 🚀 각 칸 위에 명확한 이름표기(레이블) 추가 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
          <div>
            <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">신청 회사 법인명</label>
            <input type="text" placeholder="신청 회사 법인명" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">신청인 성명</label>
            <input type="text" placeholder="신청인 성명" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">신청인 연락처</label>
            <input type="text" placeholder="신청인 연락처" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>

          {/* 🚀 현판 탭(SIGN)이면서 ISO 인증일 때만 나타나는 보조 서식 */}
          {activeTab === 'SIGN' && signData.certType === 'ISO' && (
            <div className="md:col-span-3 pt-4 border-t border-slate-200 mt-2 animate-fade-in">
              <label className="block text-[10px] font-black text-blue-600 tracking-widest uppercase mb-2">신청 현판 번호 (ISO 전용 내부 보관)</label>
              <input 
                type="text" 
                placeholder="시스템용 신청 현판 번호 기재" 
                value={signData.internalSystemSerial || ''} 
                onChange={(e) => setSignData({ ...signData, internalSystemSerial: e.target.value })} 
                className="w-full bg-white border border-blue-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" 
              />
            </div>
          )}
        </div>
      </div>
      
          {/* 제출 버튼 영역 */}
          <div className="flex gap-4 pt-6 mt-6 border-t border-slate-100 items-end">
            <div className="w-24 shrink-0">
              <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2 text-center">수량 (EA)</label>
              <input type="number" min={1} value={signData.quantity} onChange={(e) => setSignData({...signData, quantity: Math.max(1, parseInt(e.target.value) || 1)})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-xs font-black text-center outline-none focus:border-blue-500" />
            </div>
            <button type="button" onClick={handleSubmit} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs py-4 rounded-xl transition-all shadow-md active:scale-[0.99]">
              부서 맞춤 제작물 발급 신청서 원장 제출
            </button>
          </div>
        </div>
      </div>

      {/* 🏢 [모달 1] 외주 발주 처리 업체 종합 관리 센터 */}
      {isVendorModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-xs font-black tracking-widest text-blue-400 uppercase">FACTORY & VENDOR MASTER CONTROL</h3>
                <h2 className="text-xl font-black mt-0.5">외주 발주 처리 업체(VENDOR) 종합 관리 센터</h2>
              </div>
              <button type="button" onClick={() => setIsVendorModalOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95">닫기 ✕</button>
            </div>
            <div className="p-8 overflow-y-auto flex-1 bg-slate-50/50 space-y-6">
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h4 className="text-sm font-black text-slate-800">🏢 외주 제작사 등록 원장 관리</h4>
                  <p className="text-xs text-slate-400 mt-1">이곳에서 제어하는 업체 정보는 신청서 본문의 배정 셀렉트 박스에 실시간 1:1 파싱됩니다.</p>
                </div>
                <div className="flex gap-2">
                  <input type="text" placeholder="➕ 신규 외주 제작업체사 명칭 입력" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:bg-white focus:border-blue-500" />
                  <button type="button" onClick={() => {
                    if (!newVendorName.trim()) return;
                    setVendorMasterList([...vendorMasterList, { id: `VEND_${Date.now()}`, label: newVendorName.trim() }]);
                    setNewVendorName('');
                  }} className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs px-5 rounded-xl shadow-sm transition-colors">업체 등록</button>
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {vendorMasterList.map(v => (
                    <div key={v.id} className="flex justify-between items-center bg-slate-50 border border-slate-200/60 p-3 rounded-xl gap-2 hover:bg-slate-100/50 transition-colors">
                      {editingVendorId === v.id ? (
                        <input type="text" value={editingVendorValue} onChange={(e) => setEditingVendorValue(e.target.value)} className="bg-white border border-slate-300 rounded-lg px-3 py-1 text-xs flex-1 outline-none font-bold" />
                      ) : (
                        <span className="text-xs font-black text-slate-700 truncate flex-1">🏢 {v.label}</span>
                      )}
                      <div className="flex gap-1.5 shrink-0">
                        {editingVendorId === v.id ? (
                          <button type="button" onClick={() => {
                            if (!editingVendorValue.trim()) return;
                            setVendorMasterList(vendorMasterList.map(item => item.id === v.id ? { ...item, label: editingVendorValue.trim() } : item));
                            setEditingVendorId(null);
                          }} className="text-[10px] font-black text-emerald-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-sm">저장</button>
                        ) : (
                          <button type="button" onClick={() => { setEditingVendorId(v.id); setEditingVendorValue(v.label); }} className="text-[10px] font-black text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">수정</button>
                        )}
                        <button type="button" onClick={() => {
                          if (vendorMasterList.length <= 1) return alert('최소 한 개 이상의 외주업체가 필요합니다.');
                          if (confirm('이 업체를 마스터 대장에서 삭제하시겠습니까?')) {
                            setVendorMasterList(vendorMasterList.filter(item => item.id !== v.id));
                          }
                        }} className="text-[10px] font-black text-red-500 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">삭제</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📊 [모달 2] 품목/단가/규격 마스터 대장 모달 */}
      {isPlateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-xs font-black tracking-widest text-emerald-400 uppercase">PRICE & SPECIFICATION MASTER CONTROL</h3>
                <h2 className="text-xl font-black mt-0.5">품목별 단가 및 규격 종합 관리 센터</h2>
              </div>
              <button type="button" onClick={() => setIsPlateModalOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95">닫기 ✕</button>
            </div>
            <div className="p-8 overflow-y-auto flex-1 bg-slate-50/50">
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
                <div className="border-b border-slate-100 pb-3">
                  <h4 className="text-sm font-black text-slate-800">📊 단가 & 규격 마스터 원장</h4>
                  <p className="text-xs text-slate-400 mt-1">이곳에서 추가/수정한 품목 사양은 신청서 본문의 콤보박스와 미니 명세서 표에 실시간 연동됩니다.</p>
                </div>
                <div className="flex gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 items-center">
                  <input type="text" placeholder="➕ 신규 품목 명칭" value={newPlate.label} onChange={(e) => setNewPlate({ ...newPlate, label: e.target.value })} className="flex-1 bg-white border border-slate-200 text-slate-800 rounded-xl p-3 text-xs font-bold outline-none focus:border-blue-500" />
                  <input type="number" placeholder="공급가(원)" value={newPlate.price || ''} onChange={(e) => setNewPlate({ ...newPlate, price: Number(e.target.value) })} className="w-32 bg-white border border-slate-200 text-slate-800 rounded-xl p-3 text-xs font-mono outline-none focus:border-blue-500" />
                  <input type="text" placeholder="규격(ex: 400*300)" value={newPlate.size} onChange={(e) => setNewPlate({ ...newPlate, size: e.target.value })} className="flex-1 bg-white border border-slate-200 text-slate-800 rounded-xl p-3 text-xs font-semibold outline-none focus:border-blue-500" />
                  <button type="button" onClick={handleAddPlateMaster} className="bg-blue-600 hover:bg-blue-500 font-black px-5 py-3 text-xs rounded-xl text-white transition-all shadow-sm">등록</button>
                </div>
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                  {plateMasterList.map((p, idx) => (
                    <div key={p.code} className="p-4 rounded-xl border bg-white border-slate-200 hover:border-blue-300 transition-all shadow-sm">
                      <div className="flex justify-between items-center mb-2 gap-4">
                        <span className="font-black text-sm text-slate-800 truncate flex-1">📍 {p.label}</span>
                        <div className="flex gap-2 shrink-0">
                          <button type="button" onClick={() => setEditingPlateIndex(editingPlateIndex === idx ? null : idx)} className="text-[10px] text-slate-500 hover:text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg font-bold border border-slate-200">{editingPlateIndex === idx ? '닫기' : '수정'}</button>
                          <button type="button" onClick={() => handleIdDeletePlate(p.code)} className="text-[10px] text-red-500 hover:text-red-700 bg-slate-100 px-3 py-1.5 rounded-lg font-bold border border-slate-200">삭제</button>
                        </div>
                      </div>
                      {editingPlateIndex === idx ? (
                        <div className="flex gap-3 pt-3 animate-fade-in border-t border-slate-100 mt-2">
                          <div className="flex-1">
                            <label className="text-[10px] font-black text-slate-400 block mb-1">공급가액 (원)</label>
                            <input type="number" value={p.price} onChange={(e) => {
                              const updated = [...plateMasterList]; updated[idx].price = Number(e.target.value); setPlateMasterList(updated);
                            }} className="w-full bg-slate-50 border border-slate-300 text-blue-600 font-mono font-black rounded-lg p-2.5 text-xs outline-none" />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] font-black text-slate-400 block mb-1">규격 수정 (mm)</label>
                            <input type="text" value={p.size} onChange={(e) => {
                              const updated = [...plateMasterList]; updated[idx].size = e.target.value; setPlateMasterList(updated);
                            }} className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-semibold rounded-lg p-2.5 text-xs outline-none" />
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between text-xs text-slate-500 font-mono border-t border-slate-100 pt-2 mt-1">
                          <span className="bg-slate-50 px-2 py-1 rounded font-bold">규격: {p.size}</span>
                          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-black">💵 공급단가: {p.price.toLocaleString()}원</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

{/* 🚀 전면 개편된 팝업 3: 인증종류/유효기간 포맷 지정 분리형 오버레이 모달 */}
{isCertModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-5xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            
            {/* 팝업 헤더 */}
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center px-8 shrink-0">
              <div>
                <h3 className="text-xs font-black tracking-widest text-blue-400 uppercase">INTEGRATED CERTIFICATE MASTER WINDOW</h3>
                <h2 className="text-xl font-black mt-0.5">인증 마스터 기준 종합 관리 센터</h2>
              </div>
              <button type="button" onClick={() => setIsCertModalOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-2 rounded-xl text-xs transition-all active:scale-95">닫기 ✕</button>
            </div>

            {/* 🚀 전면 개편: 가시성을 극대화한 분리형 컬러 미니 탭 셀렉터 스위치 */}
            <div className="flex bg-slate-200/70 p-2 gap-2 shrink-0 px-8 border-b border-slate-200">
              
              {/* 1. 명판(SIGN) 탭 - 활성화 시 선명한 테크니컬 블루 바인딩 */}
              <button 
                type="button" 
                onClick={() => { setPopSubTab('SIGN_SUB'); setSelectedMasterCertId('GSEED'); }} 
                className={`flex-1 py-3 text-center font-black text-xs rounded-xl transition-all shadow-sm tracking-tight
                  ${popSubTab === 'SIGN_SUB' 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 ring-2 ring-blue-400 scale-[1.01]' 
                    : 'bg-white text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-300/60'}`}
              >
                📛 명판(SIGN) 인증 서식 기준 관리
              </button>

              {/* 2. 제본(JEBON) 탭 - 활성화 시 고급스러운 인디고 보라 바인딩 */}
              <button 
                type="button" 
                onClick={() => { setPopSubTab('JEBON_SUB'); setSelectedMasterCertId('GSEED'); }} 
                className={`flex-1 py-3 text-center font-black text-xs rounded-xl transition-all shadow-sm tracking-tight
                  ${popSubTab === 'JEBON_SUB' 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 ring-2 ring-indigo-400 scale-[1.01]' 
                    : 'bg-white text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-300/60'}`}
              >
                📚 제본(JEBON) 서식 기준 관리
              </button>

            </div>

            {/* 팝업 본문 (선택된 미니 탭에 따라 서식 및 데이터가 완벽하게 다르게 파싱됨) */}
            <div className="p-8 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-8 bg-slate-50/50 flex-1">
              
             {/* 왼쪽 분리형 대장 영역 (신규 생성 및 삭제 버튼 완벽 복구 버전) */}
             <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between max-h-[500px]">
                
                <div className="space-y-4 overflow-hidden flex flex-col flex-1">
                  <div className="border-b border-slate-100 pb-3 shrink-0">
                    <h4 className="text-sm font-black text-slate-800">
                      {popSubTab === 'SIGN_SUB' ? '📋 명판 유효기간 포맷 수정 원장' : '📋 제본 완료일자 포맷 수정 원장'}
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-1">이곳에서 수정하는 서식 포맷은 실제 실무 신청서의 출력 결과와 1:1 결합되어 작동합니다.</p>
                  </div>

                  {/* 마스터 카드 스크롤 리스트 존 */}
                  <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                    {popSubTab === 'SIGN_SUB' ? (
                      // 1) 명판 마스터 리스트 렌더링
                      signCertMasterList.map(c => (
                        <div key={c.id} onClick={() => setSelectedMasterCertId(c.id)} className={`p-3.5 rounded-2xl border flex flex-col gap-2 cursor-pointer transition-all relative ${selectedMasterCertId === c.id ? 'bg-blue-50/50 border-blue-500 shadow-sm' : 'bg-slate-50 border-slate-200/60 hover:bg-slate-100'}`}>
                          {/* ✕ 삭제 버튼 복구 */}
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleIdDeleteCert(c.id); }} className="absolute top-3 right-3 text-[10px] font-black text-red-400 hover:text-red-600 bg-white border border-slate-200 hover:border-red-200 w-5 h-5 rounded-md flex items-center justify-center transition-all shadow-sm">✕</button>
                          
                          <span className="font-black text-slate-800 text-xs pr-6">📍 {c.label}</span>
                          <div className="w-full pt-2 border-t border-slate-200/60 mt-1" onClick={e => e.stopPropagation()}>
                            <div className="text-[9px] font-black text-slate-400 mb-1">🖥️ 명판 유효기간 출력 서식</div>
                            {editingCertId === c.id ? (
                              <div className="flex gap-2">
                                <input type="text" value={editingCertForm.format} onChange={e => setEditingCertForm({ ...editingCertForm, format: e.target.value })} className="flex-1 bg-white border border-slate-300 text-[11px] font-mono p-2 rounded-xl outline-none" />
                                <button type="button" onClick={() => {
                                  setSignCertMasterList(signCertMasterList.map(item => item.id === c.id ? { ...item, format: editingCertForm.format } : item));
                                  setEditingCertId(null);
                                }} className="px-3 bg-blue-600 text-white text-[10px] font-black rounded-xl">완료</button>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center bg-slate-100 p-1.5 px-2.5 rounded-lg font-bold text-[11px] font-mono text-blue-600">
                                <span>양식 ➡️ {c.format}</span>
                                <button type="button" onClick={() => { setEditingCertId(c.id); setEditingCertForm({ label: c.label, format: c.format, jebonFormat: '' }); }} className="text-[9px] bg-white border px-1.5 py-0.5 rounded text-slate-500">수정</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      // 2) 제본 마스터 리스트 렌더링
                      jebonCertMasterList.map(c => (
                        <div key={c.id} onClick={() => setSelectedMasterCertId(c.id)} className={`p-3.5 rounded-2xl border flex flex-col gap-2 cursor-pointer transition-all relative ${selectedMasterCertId === c.id ? 'bg-indigo-50/50 border-indigo-500 shadow-sm' : 'bg-slate-50 border-slate-200/60 hover:bg-slate-100'}`}>
                          {/* ✕ 삭제 버튼 복구 */}
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleIdDeleteCert(c.id); }} className="absolute top-3 right-3 text-[10px] font-black text-red-400 hover:text-red-600 bg-white border border-slate-200 hover:border-red-200 w-5 h-5 rounded-md flex items-center justify-center transition-all shadow-sm">✕</button>
                          
                          <span className="font-black text-slate-800 text-xs pr-6">📍 {c.label}</span>
                          <div className="w-full pt-2 border-t border-slate-200/60 mt-1" onClick={e => e.stopPropagation()}>
                            <div className="text-[9px] font-black text-slate-400 mb-1">🖥️ 제본 완료일자 출력 서식</div>
                            {editingCertId === c.id ? (
                              <div className="flex gap-2">
                                <input type="text" value={editingCertForm.jebonFormat} onChange={e => setEditingCertForm({ ...editingCertForm, jebonFormat: e.target.value })} className="flex-1 bg-white border border-slate-300 text-[11px] font-mono p-2 rounded-xl outline-none" />
                                <button type="button" onClick={() => {
                                  setJebonCertMasterList(jebonCertMasterList.map(item => item.id === c.id ? { ...item, jebonFormat: editingCertForm.jebonFormat } : item));
                                  setEditingCertId(null);
                                }} className="px-3 bg-indigo-600 text-white text-[10px] font-black rounded-xl">완료</button>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center bg-slate-100 p-1.5 px-2.5 rounded-lg font-bold text-[11px] font-mono text-indigo-600">
                                <span>양식 ➡️ {c.jebonFormat}</span>
                                <button type="button" onClick={() => { setEditingCertId(c.id); setEditingCertForm({ label: c.label, format: '', jebonFormat: c.jebonFormat }); }} className="text-[9px] bg-white border px-1.5 py-0.5 rounded text-slate-500">수정</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 🚀 [복구 핵심]: 리스트 하단 고정형 신규 생성 인젝션 폼 컴포넌트 */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex gap-2 shrink-0">
                  <input 
                    type="text" 
                    placeholder={popSubTab === 'SIGN_SUB' ? "➕ 새 명판 인증명 입력" : "➕ 새 제본 인증명 입력"} 
                    value={newCertName} 
                    onChange={e => setNewCertName(e.target.value)} 
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold outline-none focus:bg-white focus:border-blue-500 transition-all" 
                  />
                  <button 
                    type="button" 
                    onClick={handleAddCertMaster} 
                    className={`text-white px-4 py-2.5 rounded-xl font-black text-xs transition-all shadow-md active:scale-95
                      ${popSubTab === 'SIGN_SUB' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
                  >
                    등록
                  </button>
                </div>

              </div>

              {/* 오른쪽 세부 등급 설정 패널 (공통 연동 유지) */}
              <div className="bg-slate-900 text-white rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-3">
                    <div className="text-[10px] font-black text-blue-400 uppercase tracking-wider">GRADE INTERACTION PANEL</div>
                    <h4 className="text-sm font-black text-slate-200 mt-0.5">
                      👑 [{(popSubTab === 'SIGN_SUB' ? signCertMasterList : jebonCertMasterList).find(c => c.id === selectedMasterCertId)?.label || '선택 없음'}] 등급 구조화 세부 설정
                    </h4>
                  </div>

                  <div className="flex gap-1.5">
                    <input type="text" placeholder="➕ 새 등급 매핑 기입" value={newGradeName} onChange={e => setNewGradeName(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl p-2.5 text-xs outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => {
                      if (!newGradeName.trim()) return;
                      setGradeMasterMap({ ...gradeMasterMap, [selectedMasterCertId]: [...(gradeMasterMap[selectedMasterCertId] || []), newGradeName.trim()] });
                      setNewGradeName('');
                    }} className="bg-indigo-600 hover:bg-indigo-500 font-black text-xs px-4 rounded-xl text-white transition-all shadow-md">추가</button>
                  </div>

                  <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                    {(gradeMasterMap[selectedMasterCertId] || []).map((grade, gIdx) => (
                      <div key={gIdx} className="flex justify-between items-center bg-slate-800 p-3 rounded-xl border border-slate-700/60 w-full gap-2">
                        {editingGradeIndex === gIdx ? (
                          <input type="text" value={editingGradeValue} onChange={e => setEditingGradeValue(e.target.value)} className="bg-slate-900 border border-slate-600 text-white rounded-lg px-2 py-1 text-xs flex-1 outline-none font-medium" />
                        ) : (
                          <span className="text-xs font-bold text-slate-200 truncate flex-1">🎖️ {grade}</span>
                        )}
                        <div className="flex gap-1.5 shrink-0">
                          {editingGradeIndex === gIdx ? (
                            <button type="button" onClick={() => {
                              if (!editingGradeValue.trim()) return;
                              const updatedGrades = [...(gradeMasterMap[selectedMasterCertId] || [])];
                              updatedGrades[gIdx] = editingGradeValue.trim();
                              setGradeMasterMap({ ...gradeMasterMap, [selectedMasterCertId]: updatedGrades });
                              setEditingGradeIndex(null);
                            }} className="text-[10px] font-black text-emerald-400 bg-slate-900 px-2 py-1 rounded-lg border border-slate-700">저장</button>
                          ) : (
                            <button type="button" onClick={() => { setEditingGradeIndex(gIdx); setEditingGradeValue(grade); }} className="text-[10px] font-black text-blue-300 bg-slate-700 px-2 py-1 rounded-lg">수정</button>
                          )}
                          <button type="button" onClick={() => {
                            const currentGrades = (gradeMasterMap[selectedMasterCertId] || []).filter((_, idx) => idx !== gIdx);
                            setGradeMasterMap({ ...gradeMasterMap, [selectedMasterCertId]: currentGrades });
                          }} className="text-[10px] font-black text-red-400 bg-slate-700 px-2 py-1 rounded-lg">삭제</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800 text-right">
                  <span className="text-[10px] text-slate-500 font-bold">※ 본 상단 미니 탭 변경 시 하단 실무 영역 데이터 구조와 즉각 동기화 연동됩니다.</span>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}