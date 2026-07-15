'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString } from '@/utils/dateUtils';

// 카테고리 마스터 탭 설정
const CATEGORIES = [
  { id: 'SIGN', label: '현판/명판/상패', icon: '📛' },
  { id: 'JEBON', label: '제본', icon: '📚' },
  { id: 'PRINT', label: '기타 제작물', icon: '📜' },
  { id: 'OFFICE_SUPPLIES', label: '사무문구류', icon: '📎' },
  
];

export default function ProductionApplyForm() {
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('SIGN'); 
  const todayStr = getKSTDateString();
 

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
  const [vendorMasterList, setVendorMasterList] = useState<{
    id: string;
    label: string;
    managerName?: string;
    contact?: string;
    email?: string;
    items?: string;
    }[]>([
    { id: 'VEND_01', label: '아트로릭' },
    { id: 'VEND_02', label: '한생미디어' },
    { id: 'VEND_03', label: '드림디포' },
  ]);

  // 팝업 내부 신규 업체 입력 보조 상태
  const [newVendorName, setNewVendorName] = useState('');
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [editingVendorData, setEditingVendorData] = useState({
    label: '',
    managerName: '',
    contact: '',
    email: '',
    items: ''
  });

  // 🚀 [명판 전용] 인증 종류 & 유효기간 서식 마스터 (ISO 포함, 결로 제외)
  const [signCertMasterList, setSignCertMasterList] = useState<{id: string; label: string; format: string;}[]>([
    { id: 'GSEED', label: '녹색건축인증', format: '(0000. 00. 00. ~ 0000. 00. 00.)' },
    { id: 'BF', label: 'BF 인증', format: '(0000. 00. 00 ~ 0000. 00. 00)' },
    { id: 'EDUCATIONAL', label: '교육시설안전인증', format: '0000.00.00.~0000.00.00.' },
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
    { id: 'NORMAL', label: '일반제본', jebonFormat: '' },
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
// 🚀 [추가] 중복 제출 방지용 상태 락(Lock)
const [isSubmitting, setIsSubmitting] = useState(false);


// 📝 실무 신청서 폼 상태 대장
const [signData, setSignData] = useState({
  applyDate: todayStr,       
  dept: '',                   
  manager: '',              
  vendor: 'VEND_01',          
  plateType: 'CAST_IRON_300',  
  certType: 'GSEED',         
  certLevel: '',          
  productionName: '', 
  
  // 🔒 [기존 코드 유지] 실제 현판/명판에 인쇄될 핵심 데이터 필드
  projectName: '', 
  // 🚀 [신설] 탭별 인쇄용 세부 문구 완전 독립!
  isoEngPhrase: '',       // 현판(SIGN) ISO 전용 영문 메인문구
  jebonBuildingName: '',  // 제본(JEBON) 일반제본 전용 건물명
  jebonSubtitle: '',      // 📚 제본(JEBON) 일반제본(NORMAL) 전용 표지 서브 부제목 (신설!)

  // 🚀 [신설 및 중복 제거 완료] 각 탭별 '관리용 제목' 전용 청정 독립 그릇들
  signFormTitle: '',       // 📛 현판 관리용 제목
  jebonFormTitle: '',      // 📚 제본 관리용 제목
  printFormTitle: '',      // 📜 기성품 관리용 제목
  suppliesProjectName: '', // 📎 사무문구 관리용 제목
  
  certNumber: '',            
  validPeriodRaw: '',        
  receiverName: '',          
  receiverPhone: '',         
  shippingAddress: '',       
  companyName: '',           
  applicantName: '',         
  applicantPhone: '',
  quantity: 1,
  isoCompanyName: '', // 👈 신설: ISO 탭 전용 기업명 보관 그릇 추가!
  // 제본(JEBON) 전용 상태
  coverColor: '컬러',     
  innerColor: '흑백',     
  certPhase: '예비인증',    
  coverName: '', 
  compDateRaw: '', 
  coverPageCount: '', 
  innerPageCount: '',
  jebonSizeType: 'A4', 
  jebonSize: 'A4', 
  internalSystemSerial: '', 

  // 기성 서식/소모품 전용 상태
  printItemType: '인증서용지', 
  printItemDetails: '', // 🔒 3-1 내부 정산용 관리 비고 칸 전용
  printCustomName: '',
  printDeliveryDetails: '', 
  
  // 사무문구류 텍스트 보관 그릇
  suppliesQuoteRawText: '', 
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

// 🚀 인증 종류(certType) 변경에 따른 등급 안전 리셋 및 React 의존성 경고 해결
useEffect(() => {
  setSignData(prev => {
    // 1. ISO 탭일 경우 다중 선택(배열)이므로 강제 리셋을 무시합니다.
    if (prev.certType === 'ISO') return prev;

    const availableGrades = gradeMasterMap[prev.certType] || [];
    // 2. 현재 선택된 등급이 바뀐 인증의 등급 목록에 없으면 안전하게 첫 번째 값으로 초기화
    if (!availableGrades.includes(prev.certLevel)) {
      return { ...prev, certLevel: availableGrades[0] || '' };
    }
    return prev; // 문제없으면 냅둠
  });
}, [signData.certType, gradeMasterMap]); 
// 💡 prev 상태를 직접 꺼내어 쓰기 때문에 배열에 signData.certLevel이 없어도 경고가 뜨지 않습니다!

// 🚀 탭 간 이동 시 존재하지 않는 인증 종류(certType) 잔재 청소
useEffect(() => {
  if (activeTab === 'SIGN') {
    if (!signCertMasterList.find(c => c.id === signData.certType)) {
      setSignData(prev => ({ ...prev, certType: signCertMasterList[0]?.id || 'GSEED' }));
    }
  } else if (activeTab === 'JEBON') {
    if (!jebonCertMasterList.find(c => c.id === signData.certType)) {
      setSignData(prev => ({ ...prev, certType: jebonCertMasterList[0]?.id || 'GSEED' }));
    }
  }
}, [activeTab, signCertMasterList, jebonCertMasterList]);

// 🚀 달력 팝업(type="date") 방식에 맞춘 제본 완료일자 포맷팅
const formattedCompDate = useMemo(() => {
  // 값이 없으면 빈 칸 반환
  if (!signData.compDateRaw) return '';

  // "YYYY-MM-DD" 형태를 쪼개서 가져오기
  const [y, mRaw, dRaw] = signData.compDateRaw.split('-');
  if (!y || !mRaw || !dRaw) return '';

  // 앞자리 0 제거 (예: "07" -> "7")
  const m = String(parseInt(mRaw, 10));
  const d = String(parseInt(dRaw, 10));

  const targetCert = jebonCertMasterList.find(c => c.id === signData.certType);
  const format = targetCert?.jebonFormat || '0000. 0. 0.';

  if (format.includes('0000. 00. 00')) {
    return `${y}. ${mRaw}. ${dRaw}.`;
  } else if (format.includes('0000. 0. 0')) {
    const hasTrailingDot = format.endsWith('.');
    return `${y}. ${m}. ${d}${hasTrailingDot ? '.' : ''}`;
  }
  return `${y}. ${m}. ${d}.`;
}, [signData.compDateRaw, signData.certType, jebonCertMasterList]);

// 🚀 명판 날인 유효기간 실시간 출력 포맷팅 (무한 루프 버그 완벽 해결)
const formattedValidPeriod = useMemo(() => {
  const raw = signData.validPeriodRaw.replace(/\D/g, ''); 
  const targetCert = signCertMasterList.find(c => c.id === signData.certType);
  let format = targetCert?.format || '0000.00.00.~0000.00.00.';

  // 입력값이 없으면 원본 포맷 그대로 반환
  if (raw.length === 0) return format;

  let result = '';
  let rawIndex = 0;

  // 💡 서식 문자열을 한 글자씩 돌면서 '0'을 만나면 입력한 숫자로 1:1 교체
  for (let i = 0; i < format.length; i++) {
    if (format[i] === '0') {
      if (rawIndex < raw.length) {
        result += raw[rawIndex]; // 입력한 숫자가 있으면 채워넣기
        rawIndex++;
      } else {
        result += '0'; // 더 이상 입력한 숫자가 없으면 빈자리 '0' 유지
      }
    } else {
      result += format[i]; // 점(.), 물결(~), 공백 등은 그대로 출력
    }
  }

  return result;
}, [signData.validPeriodRaw, signData.certType, signCertMasterList]);

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
  };

  const handleAddCertMaster = () => {
    if (!newCertName.trim()) return alert('인증 명칭을 기재해 주세요.');
    const id = `CERT_${Date.now()}`;
    if (popSubTab === 'SIGN_SUB') {
      setSignCertMasterList([...signCertMasterList, { id, label: newCertName.trim(), format: '0000.00.00.~0000.00.00.' }]);
    } else {
      setJebonCertMasterList([...jebonCertMasterList, { id, label: newCertName.trim(), jebonFormat: '0000. 0. 0.' }]);
    }
    setGradeMasterMap(prev => ({ ...prev, [id]: ['기본 등급'] }));
    setSelectedMasterCertId(id);
    setNewCertName('');
  };

  const handleIdDeleteCert = (id: string) => {
    if (['GSEED', 'BF', 'CONDENDSATION', 'EDUCATIONAL', 'ENERGY', 'OLD_ZEB', 'INTEGRATED_ZEB', 'ISO', 'NORMAL'].includes(id)) {
      return alert('⚠️ 시스템 핵심 기준 데이터입니다. 삭제할 수 없으며, 필요시 명칭(라벨) 수정만 가능합니다.');
    }
    if (!confirm('이 인증 종류를 리스트에서 마스터 삭제하시겠습니까?')) return;

    if (popSubTab === 'SIGN_SUB') {
      if (signCertMasterList.length <= 1) return alert('최소 한 개 이상의 인증 종류가 존재해야 합니다.');
      setSignCertMasterList(signCertMasterList.filter(c => c.id !== id));
    } else {
      if (jebonCertMasterList.length <= 1) return alert('최소 한 개 이상의 인증 종류가 존재해야 합니다.');
      setJebonCertMasterList(jebonCertMasterList.filter(c => c.id !== id));
    }
  };

// 🚀 최종 폼 제출 핸들러 (중복 제출 방지 및 4개 탭 완벽 격리 버전)
const handleSubmit = async () => {
  // 1. 이미 제출 중이면 함수를 바로 종료 (중복 클릭 연타 방지 락!)
  if (isSubmitting) return;

  if (!signData.vendor) return alert("외주 발주 처리 업체를 지정해 주세요.");

// [가드 2] 각 탭별 전용 필수 사양 검사
if (activeTab === 'SIGN') {
  if (!signData.signFormTitle.trim()) return alert("관리용 제목을 입력해 주세요.");
  // 👈 교체: ISO가 아닐 때만 일반 프로젝트명 필수로 검사!
  if (signData.certType !== 'ISO' && !signData.projectName.trim()) {
    return alert("4. 프로젝트명(인쇄용)을 입력해 주세요."); 
  }
} else if (activeTab === 'JEBON') {
    // 📚 jebonProjectName 대신 신설된 jebonFormTitle로 필수값 체크!
    if (!signData.jebonFormTitle.trim() && !signData.coverName.trim()) {
      return alert("관리용 제목 또는 별도 표지 명칭 중 최소 하나는 반드시 입력하셔야 합니다.");
    }
  } else if (activeTab === 'PRINT') {
    // 📜 printProjectName 대신 신설된 printFormTitle로 필수값 체크!
    if (!signData.printFormTitle.trim()) return alert("관리용 제목을 입력해 주세요.");
    if (!signData.printItemType) return alert("주문하실 소모품 종류를 선택해 주세요.");
  } else if (activeTab === 'OFFICE_SUPPLIES') {
    // 📎 사무문구는 기존에 정리된 suppliesProjectName을 그대로 검사합니다.
    if (!signData.suppliesProjectName.trim()) return alert("관리용 제목을 입력해 주세요.");
    if (!signData.suppliesQuoteRawText.trim()) return alert("견적서 텍스트 내용을 붙여넣어 주세요.");
  }

// [가드 3] 실배송지 및 수량 필수 검사 (사무문구류 제외)
if (activeTab !== 'OFFICE_SUPPLIES') {
  if (!signData.receiverName.trim() || !signData.receiverPhone.trim() || !signData.shippingAddress.trim()) {
    return alert("최종 제작물 실배송지 정보를 모두 입력해 주세요.");
  }
  if (signData.quantity < 1) return alert("수량은 1개 이상이어야 합니다.");
}

// 🚀 [가드 4 - 신설] 시스템 내부 보관 보조 서식 필수 검사 (현판 탭에서만 필수!)
if (activeTab === 'SIGN') {
  if (!signData.companyName.trim() || !signData.applicantName.trim() || !signData.applicantPhone.trim()) {
    return alert("시스템 내부 보관 보조 서식 정보를 모두 입력해 주세요.");
  }
}
  const selectedPlate = plateMasterList.find(p => p.code === signData.plateType);
  // 🚀 현판(SIGN) 탭일 때만 단가를 계산하고, 다른 탭은 0원 처리!
  const estimatedPrice = activeTab === 'SIGN' ? (selectedPlate?.price || 0) * signData.quantity : 0;
  const selectedVendorInfo = vendorMasterList.find(v => v.id === signData.vendor);
  const currentCertList = activeTab === 'SIGN' ? signCertMasterList : jebonCertMasterList;
  const selectedCertInfo = currentCertList.find(c => c.id === signData.certType);

  // 🚀 백엔드로 전송할 대표 제목(projectName) 4분할 맵핑 핵심 구간
  const payload = {
    category: activeTab,
    projectName: 
      activeTab === 'SIGN'            ? signData.signFormTitle :
      activeTab === 'JEBON'           ? (signData.jebonFormTitle || signData.coverName) : // 👈 교체 (둘 중 있는 값 전송!)
      activeTab === 'PRINT'           ? signData.printFormTitle : 
                                        signData.suppliesProjectName,
    quantity: activeTab === 'OFFICE_SUPPLIES' ? 1 : signData.quantity,
    estimatedPrice: activeTab === 'OFFICE_SUPPLIES' ? 0 : estimatedPrice,
    options: {
      ...signData,
      isoCompanyName: signData.isoCompanyName, // 👈 백엔드로 데이터 무사히 넘기기 위해 추가
      vendor: selectedVendorInfo ? selectedVendorInfo.label : signData.vendor,
      certType: selectedCertInfo ? selectedCertInfo.label : signData.certType,
      formattedValidPeriod: formattedValidPeriod,
      formattedCompDate: formattedCompDate,
      plateMasterInfo: currentSelectedInfo,
      customRequests: customRequests.filter(req => req.value.trim() !== '').map(req => req.value)
    }
  };

  // 🚀 모든 검사가 통과되었으므로 여기서부터 자물쇠를 잠급니다!
  setIsSubmitting(true);

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
  } finally {
    // 🚀 성공하든 실패하든, 통신이 끝나면 무조건 자물쇠를 다시 풀어줍니다!
    setIsSubmitting(false);
  }
};

// 🚀 안전한 위치로 정착된 세션 로딩 가드
if (typeof isSessionLoading !== 'undefined' && isSessionLoading) {
  return (
    <div className="p-20 font-black text-blue-500 animate-pulse text-center text-xs tracking-widest mt-20">
      인프라 코어로부터 실시간 유저 세션 인증 연동 중...
    </div>
  );
}

// 🚀 메인 UI 렌더링 리턴 시작
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

{/* ⚡ 현판 탭용 관리용 제목 코너 */}
<div>
  <div className="flex items-center gap-2 mb-2">
    <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
      관리용 제목 설정 <span className="text-red-500">*</span>
    </label>
    <button 
      type="button"
      onClick={() => {
        setSignData({ 
          ...signData, 
          // 🚀 신설 그릇인 signFormTitle에 자동 생성 문구를 담습니다.
          signFormTitle: `${signData.dept || '해당부서'}_${signData.applyDate || '오늘날짜'}_현판 제작건` 
        });
      }}
      className="text-[9px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 transition-colors shrink-0 cursor-pointer"
    >
      ⚡ 제목 자동 생성
    </button>
  </div>
  <input 
    type="text" 
    placeholder="신청 이력에서 식별하기 좋은 제목을 입력해 주세요." 
    // 🚀 value와 onChange 모두 signFormTitle로 격리!
    value={signData.signFormTitle || ''} 
    onChange={(e) => setSignData({ ...signData, signFormTitle: e.target.value })} 
    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:bg-white focus:border-blue-500 transition-colors"
  />
</div>

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
      {/* 👈 value와 onChange를 신설된 isoCompanyName으로 교체! */}
      <input type="text" placeholder="신청서의 기업명을 표기바랍니다." value={signData.isoCompanyName || ''} onChange={(e) => setSignData({ ...signData, isoCompanyName: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
    </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">5. 메인문구(한글)</label>
                          {/* 💡 기존 certNumber 스키마를 활용하되 화면에서는 한글 메인문구로 작동 */}
                          <input type="text" placeholder="예) 품질경영시스템 인증기업" value={signData.certNumber || ''} onChange={(e) => setSignData({ ...signData, certNumber: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div>
      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">6. 메인문구(영문)</label>
      <input 
        type="text" 
        placeholder="예) The Company in Integrated..." 
        // 🚀 isoEngPhrase로 격리!
        value={signData.isoEngPhrase || ''} 
        onChange={(e) => setSignData({ ...signData, isoEngPhrase: e.target.value })} 
        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
      />
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
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1.5">6. 명판 유효기간 (숫자 연속 입력) <span className="text-slate-400 font-medium">(선택)</span></label>
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

{/* ⚡ 제본 탭용 관리용 제목 코너 */}
<div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                        관리용 제목 설정 <span className="text-red-500">*</span>
                      </label>
                      <button 
                        type="button"
                        onClick={() => {
                          setSignData({ 
                            ...signData, 
                            // 🚀 신설된 제본 전용 그릇(jebonFormTitle)에 저장!
                            jebonFormTitle: `${signData.dept || '해당부서'}_${signData.applyDate || '오늘날짜'}_제본건` 
                          });
                        }}
                        className="text-[9px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 transition-colors shrink-0 cursor-pointer"
                      >
                        ⚡ 제목 자동 생성
                      </button>
                    </div>
                    <input 
                      type="text" 
                      placeholder="신청 이력에서 식별하기 좋은 제목을 입력해 주세요." 
                      // 🚀 jebonFormTitle로 완벽 격리!
                      value={signData.jebonFormTitle || ''} 
                      onChange={(e) => setSignData({ ...signData, jebonFormTitle: e.target.value })} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:bg-white focus:border-blue-500 transition-colors"
                    />
                  </div>

                {/* 🚀 [신규 추가] 제본 규격(판형) 지정 영역 (2분할 스마트 폼) */}
                <div className="bg-blue-50/50 p-5 rounded-2xl border border-blue-100 shadow-sm">
                    <label className="block text-[11px] font-black text-blue-800 tracking-widest uppercase mb-3 flex items-center gap-2">
                      <span>📏</span> 0. 제본 판형 지정 <span className="text-red-500">*</span>
                    </label>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* ⬅️ 왼쪽: 상세 스펙 설명이 포함된 선택 셀렉트 */}
                      <div>
                        <select 
                          value={signData.jebonSizeType || 'A4'} 
                          onChange={(e) => {
                            const selectedType = e.target.value;
                            setSignData({ 
                              ...signData, 
                              jebonSizeType: selectedType, 
                              // 💡 비규격을 고르면 실제 값 칸을 비워주고, 규격을 고르면 그 이름을 그대로 덮어씌움
                              jebonSize: selectedType === '비규격' ? '' : selectedType 
                            });
                          }} 
                          className="w-full bg-white border border-blue-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:border-blue-300 transition-colors shadow-sm"
                        >
                          <option value="A4">A4 (210 × 297mm) - 표준 기본</option>
                          <option value="B5">B5 (182 × 257mm)</option>
                          <option value="A5">A5 (148 × 210mm)</option>
                          <option value="B6">B6  (128 × 182mm)</option>
                          <option value="16절">16절 (197 × 272mm)</option>
                          <option value="비규격">기타 비규격 (우측 직접 입력)</option>
                        </select>
                      </div>

                      {/* ➡️ 오른쪽: 최종적으로 확정되어 견적서에 들어갈 실제 사이즈 (비규격 시 활성화) */}
                      <div>
                        {signData.jebonSizeType === '비규격' ? (
                          <div className="animate-fade-in relative">
                            <input 
                              type="text" 
                              placeholder="예: A3 (297 x 420mm) (직접 기재)" 
                              value={signData.jebonSize || ''} 
                              onChange={(e) => setSignData({ ...signData, jebonSize: e.target.value })} 
                              className="w-full bg-white border-2 border-blue-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none shadow-sm text-blue-900"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-blue-500 bg-blue-50 px-2 py-0.5 rounded-md">입력모드</span>
                          </div>
                        ) : (
                          <div className="w-full bg-slate-100/80 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-500 flex items-center justify-between shadow-inner">
                            <span className="text-slate-700">{signData.jebonSize || 'A4'}</span>
                            <span className="text-[10px] text-slate-400 font-bold tracking-wider">✔️ 자동 고정</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                 
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
                        <label className="block text-[10px] font-black text-blue-600 tracking-widest uppercase mb-2">4. 📄 제본 표지 메인 제목 <span className="text-red-500">*</span></label>
                        <input 
                          type="text" 
                          placeholder="예) 2026년도 하반기 업무 보고서" 
                          value={signData.coverName || ''} 
                          onChange={(e) => setSignData({ ...signData, coverName: e.target.value })} 
                          className="w-full bg-white border border-blue-200 focus:ring-2 focus:ring-blue-500 rounded-xl px-4 py-3 text-xs font-semibold outline-none shadow-sm" 
                        />
                      </div>
                      <div>
      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
        5. 📝 표지 서브 부제목 <span className="text-slate-400 font-medium">(선택)</span>
      </label>
      <input 
        type="text" 
        placeholder="예) 경영기획부 제출용 (소제목 및 부제 기입)" 
        // 🚀 기존 projectName ➡️ 신설된 jebonSubtitle로 완벽 격리!
        value={signData.jebonSubtitle || ''} 
        onChange={(e) => setSignData({ ...signData, jebonSubtitle: e.target.value })} 
        className="w-full bg-white border border-slate-200 focus:ring-2 focus:ring-blue-500 rounded-xl px-4 py-3 text-xs font-semibold outline-none" 
      />
    </div>
                    </div>
                  ) : (
                    // 2) 일반인증 건물 제본일 때는 기존 2분할 폼 작동
                    <div>
      <label className="block text-[10px] font-black text-slate-600 tracking-widest uppercase mb-2">5. 프로젝트명(건물명)</label>
      <input 
        type="text" 
        placeholder="프로젝트명 또는 건물명을 입력해 주세요" 
        // 🚀 jebonBuildingName으로 격리!
        value={signData.jebonBuildingName || ''} 
        onChange={(e) => setSignData({ ...signData, jebonBuildingName: e.target.value })} 
        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
      />
    </div>
                  )}

                  {/* 🚀 완료 일자 영역 (달력 팝업 적용) */}
                  <div className="pt-2">
                    <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-1.5">
                      6. 완료/지정일자 달력 선택 <span className="text-slate-400 font-medium">(선택)</span>
                    </label>
                    
                    {/* 💡 type="date"로 변경하여 네이티브 달력 팝업을 호출합니다 */}
                    <input 
                      type="date" 
                      value={signData.compDateRaw || ''} 
                      onChange={(e) => setSignData({ ...signData, compDateRaw: e.target.value })} 
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-black tracking-widest text-indigo-600 outline-none focus:ring-2 focus:ring-blue-500 font-mono cursor-pointer" 
                    />
                    
                    <div className="mt-2 bg-yellow-100/50 p-3.5 rounded-xl font-mono text-sm font-black tracking-wider border border-yellow-200 shadow-inner flex items-center flex-wrap gap-2">
                      <span className="text-yellow-700">🖥️ 제본 완료/지정일자 실시간 출력 양식 ➡️</span>
                      <span className="text-slate-900 text-base">
                        {formattedCompDate || <span className="text-yellow-600/60 text-xs font-medium">달력에서 날짜를 선택해주세요</span>}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

 {/* 🔥 3. 기성 서식 / 소모품 제작 통합 탭 뷰 */}
 {activeTab === 'PRINT' && (
              <div className="space-y-6 animate-fade-in pt-2">
                <div className="p-6 bg-white rounded-2xl border border-purple-200 space-y-6 shadow-sm">
                  
                  {/* 헤더 타이틀 */}
                  <div className="border-b border-purple-100 pb-4">
                    <h4 className="text-sm font-black text-purple-800 flex items-center gap-2">
                      <span>📁</span> 기성 서식 및 제작성 소모품 일괄 신청 코너
                    </h4>
                    <p className="text-xs text-slate-500 mt-1.5 font-medium">
                      외주사에서 청구되는 물품을 선택하여 신청합니다.
                    </p>
                  </div>

                  {/* 🚀 1. 물품 선택을 가장 먼저 하도록 상단으로 이동! */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* 1. 통합 품목 셀렉트박스 */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        1. 주문 물품 선택 <span className="text-red-500">*</span>
                      </label>
                      <select 
                        value={signData.printItemType} 
                        onChange={(e) => {
                          const selectedValue = e.target.value;
                          setSignData({ 
                            ...signData, 
                            printItemType: selectedValue,
                            printCustomName: selectedValue === '기타소모품' ? '' : selectedValue 
                          });
                        }} 
                        className="w-full bg-purple-50/50 border border-purple-200 rounded-xl px-4 py-3 text-xs font-black text-purple-700 focus:ring-2 focus:ring-purple-500 outline-none cursor-pointer hover:bg-white transition-colors"
                      >
                        <option value="인증서용지">인증서 용지  (공급처: 아트로릭)</option>
                        <option value="(중)쇼핑백 230*70*320">(중)쇼핑백 230*70*320  (공급처: 한생미디어/2000)</option>
                        <option value="(대)쇼핑백 300*100*450">(대)쇼핑백 300*100*450  (공급처: 한생미디어/2000)</option>
                        <option value="상장케이스">상장케이스  (공급처: 한생미디어/600)</option>
                        <option value="컬러대봉투(양면테잎) 330*245">컬러대봉투(양면테잎) 330*245 (공급처: 아트로릭/3000)</option>
                        <option value="경조사봉투">경조사봉투 (공급처: 드림디포/200)</option>
                        <option value="기타소모품">기타소모품 (우측에 직접 입력)</option>
                      </select>
                    </div>

                    {/* 2. 규격 매핑 및 동적 직접 입력 전환창 */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        {signData.printItemType === '기타소모품' ? (
                          <span className="text-purple-700 font-black animate-pulse">2. 기타소모품 명칭/규격 직접 기재 *</span>
                        ) : (
                          "2. 선택 물품 정보"
                        )}
                      </label>

                      {signData.printItemType === '기타소모품' ? (
                        <div className="relative animate-fade-in">
                          <input 
                            type="text" 
                            placeholder="직접 기재" 
                            value={signData.printCustomName || ''} 
                            onChange={(e) => setSignData({ ...signData, printCustomName: e.target.value })} 
                            className="w-full bg-white border-2 border-purple-400 focus:border-purple-600 focus:ring-2 focus:ring-purple-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none shadow-sm text-purple-900"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-purple-500 bg-purple-50 px-2 py-0.5 rounded-md">입력모드</span>
                        </div>
                      ) : (
                        <div className="w-full bg-slate-100/80 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-500 flex items-center justify-between shadow-inner">
                          <span className="text-slate-700">
                            {signData.printItemType === '인증서용지' && '인증서용지'}
                            {signData.printItemType === '(중)쇼핑백 230*70*320' && '(중)쇼핑백 230*70*320'}
                            {signData.printItemType === '(대)쇼핑백 300*100*450' && '(대)쇼핑백 300*100*450'}
                            {signData.printItemType === '상장케이스' && '상장케이스'}
                            {signData.printItemType === '컬러대봉투(양면테잎) 330*245' && '컬러대봉투(양면테잎) 330*245'}
                            {signData.printItemType === '경조사봉투' && '경조사봉투'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold tracking-wider">✔️ 선택사항 확인</span>
                        </div>
                      )}
                    </div>
                  </div> 

                  {/* ⚡ 3. 기성 소모품 탭용 관리용 제목 코너 (물품 선택을 마친 후 아래에서 제목 생성) */}
                  <div className="w-full border-t border-purple-50 pt-6 mt-2">
                    <div className="flex items-center gap-2 mb-2">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                        3. 관리용 제목 설정 <span className="text-red-500">*</span>
                      </label>
                      <button 
                        type="button"
                        onClick={() => {
                          const itemName = signData.printItemType || '소모품';
                          setSignData({ 
                            ...signData, 
                            printFormTitle: `${signData.dept || '해당부서'}_${signData.applyDate || '오늘날짜'}_${itemName} 청구건` 
                          });
                        }}
                        className="text-[9px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 transition-colors shrink-0 cursor-pointer"
                      >
                        ⚡ 제목 자동 생성
                      </button>
                    </div>
                    <input 
                      type="text" 
                      placeholder="신청 이력에 표시될 관리용 제목을 입력해 주세요." 
                      value={signData.printFormTitle || ''} 
                      onChange={(e) => setSignData({ ...signData, printFormTitle: e.target.value })} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:bg-white focus:border-blue-500 transition-colors"
                    />
                  </div> 

                  {/* 🚀 4, 5. 상세 내용 및 비고 (실무/정산용 2분할 구조화) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-purple-50 pt-6 mt-2">
                    {/* 2-1. 정산 및 내부 관리용 비고 */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        4. 인쇄 제작 문구1 <span className="text-slate-400 font-medium">(선택)</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="예: 앞면 비고 또는 뒷면 비고 등" 
                        value={signData.printItemDetails || ''} 
                        onChange={(e) => setSignData({ ...signData, printItemDetails: e.target.value })} 
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-medium outline-none focus:ring-2 focus:ring-purple-500 shadow-sm"
                      />
                    </div>

                    {/* 2-2. 인쇄사/배송 실무 요청사항 (신설) */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2">
                        5. 인쇄 제작 문구2 <span className="text-slate-400 font-medium">(선택)</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder={
                          signData.printItemType === '기타소모품' 
                            ? "예: 앞면 비고 또는 뒷면 비고 등" 
                            : "예: 앞면 비고 또는 뒷면 비고 등" 
                        }
                        value={signData.printDeliveryDetails || ''} 
                        onChange={(e) => setSignData({ ...signData, printDeliveryDetails: e.target.value })} 
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-medium outline-none focus:ring-2 focus:ring-purple-500 shadow-sm"
                      />
                    </div>
                  </div>

                  {/* 실무 주의사항 배너 */}
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-[10px] text-amber-800 font-medium leading-relaxed">
                    📌 **실무 프로세스 안내:** 이 탭에서 작성된 물품은 발주 및 비용 정산(계산서 대사) 프로세스를 전담합니다. 
                    <br /><br />
                    주문 완료 후 실제 물품이 입고되어 **사무실 내부 재고 관리가 수반되어야 하는 품목(쇼핑백, 상장케이스 등)**은 물품 수령 시 반드시 **[일반소모품 입고 대장 시스템]**에도 수량을 등록하여 입고 처리를 진행해 주시기 바랍니다.
                  </div>

                </div>
              </div>
            )}

{/* 🔥 4. 사무문구류 견적 키핑 탭 뷰 */}
{activeTab === 'OFFICE_SUPPLIES' && (
              <div className="space-y-6 animate-fade-in pt-2">
                <div className="p-6 bg-white rounded-2xl border border-blue-200 space-y-6 shadow-sm">
                  
                  {/* 헤더 */}
                  <div className="border-b border-blue-100 pb-4">
                    <h4 className="text-sm font-black text-blue-800 flex items-center gap-2">
                      <span>📎</span> 사무문구류 견적서 등록 내역
                    </h4>
                    <p className="text-xs text-slate-500 mt-1.5 font-medium">
                      외부 문구사에서 출력한 견적서 PDF의 내부 텍스트를 전체 복사(Ctrl + C)하여 전체 붙여넣기(Ctrl + V)하면 월말 정산 데이터로 키핑됩니다.
                    </p>
                  </div>

                 {/* 구분 타이틀 (라벨 바로 옆으로 버튼 이동 및 정렬 보정) */}
                 <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                        1. 관리용 제목 설정 <span className="text-red-500">*</span>
                      </label>
                      <button 
                        type="button"
                        onClick={() => {
                          setSignData({ 
                            ...signData, 
                            suppliesProjectName: `${signData.dept || '해당부서'}_${signData.applyDate || '오늘날짜'}_사무문구류 견적서 내역` 
                          });
                        }}
                        className="text-[9px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 transition-colors shrink-0 cursor-pointer"
                      >
                        ⚡ 제목 자동 생성
                      </button>
                    </div>
                    <input 
                      type="text" 
                      placeholder="좌측 '제목 자동 생성' 버튼을 누르거나 직접 제목을 기재해 주세요." 
                      value={signData.suppliesProjectName || ''} 
                      onChange={(e) => setSignData({ ...signData, suppliesProjectName: e.target.value })} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:bg-white focus:border-blue-500 transition-colors"
                    />
                  </div>

                  {/* 텍스트 긁어붙이기 윈도우 */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase">
                        2. 견적 내용 전체 복사 붙여넣기 (Ctrl + V) <span className="text-red-500">*</span>
                      </label>
                      <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded">텍스트 전용</span>
                    </div>
                    <textarea 
                      placeholder="견적서 PDF 파일의 텍스트 내용을 마우스로 긁어 그대로 붙여넣어 주세요. (품명, 규격, 수량, 단가 등이 포함되도록)" 
                      value={signData.suppliesQuoteRawText || ''} 
                      onChange={(e) => setSignData({ ...signData, suppliesQuoteRawText: e.target.value })} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-mono font-medium outline-none focus:bg-white focus:border-blue-500 min-h-[180px] resize-y"
                    />
                  </div>

                  {/* 실시간 텍스트 유무 가이드 데스크 */}
                  <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-700">📋 입력된 문자열 상태 분석</span>
                    <span className="text-[10px] font-mono font-black text-blue-800">
                      {signData.suppliesQuoteRawText ? `${signData.suppliesQuoteRawText.length} 자 감지됨 (저장 대기)` : '대기 중'}
                    </span>
                  </div>

                  {/* 안내말 */}
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-[10px] text-amber-800 font-medium leading-relaxed">
                    💡 **정산 프로세스 가이드:** 등록된 견적 텍스트는 내부 DB에 안전하게 키핑되며, 월말 정산 화면에서 통합 거래명세서 엑셀(Excel)을 파싱할 때 품명/수량을 1:1로 추출해 크로스매칭하여 빨간색 경고 등으로 불일치를 잡아내게 됩니다.
                  </div>

                </div>
              </div>
            )}

            {/* 🚀 공통 7번: 추가 제작 변수 요청사항 자유기재 (사무문구류 정산 탭일 때는 숨김) */}
            {activeTab !== 'OFFICE_SUPPLIES' && (
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
            )}

          </div>
          {/* 🚀 [동적 변환 영역 종료] */}

  {/* 🚚 최종 제작물 실배송지 섹션 (사무문구류 정산 탭일 때는 숨김) */}
  {activeTab !== 'OFFICE_SUPPLIES' && (
        <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
            <span>🚚 최종 제작물 실배송지</span>
            <span className="text-[11px] font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-lg border border-red-200">
              ⚠️ 현판: 고객사/현장 직발송 여부 확인 | 그 외: 인증원 수령시에도 주소 기재
            </span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">수령인 성명</label>
              <input 
                type="text" 
                placeholder="수령인 성명" 
                value={signData.receiverName} 
                onChange={(e) => setSignData({...signData, receiverName: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">수령인 연락처</label>
              <input 
                type="text" 
                placeholder="수령인 연락처" 
                value={signData.receiverPhone} 
                onChange={(e) => setSignData({...signData, receiverPhone: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">배송 도로명 주소 기재</label>
              <input 
                type="text" 
                placeholder="배송 도로명 주소 기재" 
                value={signData.shippingAddress} 
                onChange={(e) => setSignData({...signData, shippingAddress: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
          </div>
        </div>
      )}

{/* 🗂️ 시스템 내부 보관 보조 서식 섹션 (현판, 제본 탭에서만 노출) */}
{['SIGN', 'JEBON'].includes(activeTab) && (
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 border-b border-slate-200/60 pb-3">
            <span className="text-yellow-500">🗂️</span> 시스템 내부 보관 보조 서식 
            <span className="text-slate-400 text-[10px] font-normal ml-1">(외주 발주서 제외 항목)</span>
            {/* 🚀 현판 탭일 때만 필수 별표 표시 */}
            {activeTab === 'SIGN' && <span className="text-red-500 ml-1">*</span>}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">신청 회사 법인명</label>
              <input 
                type="text" 
                placeholder="신청 회사 법인명" 
                value={signData.companyName} 
                onChange={(e) => setSignData({...signData, companyName: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">신청인 성명</label>
              <input 
                type="text" 
                placeholder="신청인 성명" 
                value={signData.applicantName} 
                onChange={(e) => setSignData({...signData, applicantName: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 tracking-widest mb-2">신청인 연락처</label>
              <input 
                type="text" 
                placeholder="신청인 연락처" 
                value={signData.applicantPhone} 
                onChange={(e) => setSignData({...signData, applicantPhone: e.target.value})} 
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            {activeTab === 'SIGN' && signData.certType === 'ISO' && (
              <div className="md:col-span-3 pt-4 border-t border-slate-200 mt-2 animate-fade-in">
                <label className="block text-[10px] font-black text-blue-600 tracking-widest uppercase mb-2">신청 현판 번호 (ISO 전용 내부 보관)</label>
                <input type="text" placeholder="시스템용 신청 현판 번호 기재" value={signData.internalSystemSerial || ''} onChange={(e) => setSignData({ ...signData, internalSystemSerial: e.target.value })} className="w-full bg-white border border-blue-200 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" />
              </div>
            )}
          </div>
        </div>
      )}

          {/* 제출 버튼 영역 */}
          <div className="flex gap-4 pt-6 mt-6 border-t border-slate-100 items-end">
            {activeTab !== 'OFFICE_SUPPLIES' && (
              <div className="w-24 shrink-0">
                <label className="block text-[10px] font-black text-slate-500 tracking-widest uppercase mb-2 text-center">수량 (EA)</label>
                <input type="number" min={1} value={signData.quantity} onChange={(e) => setSignData({...signData, quantity: Math.max(1, parseInt(e.target.value) || 1)})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-xs font-black text-center outline-none focus:border-blue-500" />
              </div>
            )}
            
            {/* 🚀 중복 클릭 방지 락이 적용된 스마트 제출 버튼 */}
            <button 
              type="button" 
              onClick={handleSubmit} 
              disabled={isSubmitting}
              className={`flex-1 font-black text-xs py-4 rounded-xl transition-all shadow-md text-white
                ${isSubmitting 
                  ? 'bg-slate-400 cursor-wait active:scale-100' // 잠겼을 때 (회색 & 커서 로딩)
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99]' // 평소 상태
                }`}
            >
              {isSubmitting ? (
                 <span className="flex items-center justify-center gap-2">
                   <span className="animate-spin text-lg">⏳</span> 데이터 전송 및 처리 중...
                 </span>
              ) : (
                activeTab === 'OFFICE_SUPPLIES' 
                  ? '사무문구류 정산 견적 원장 등록' 
                  : '부서 맞춤 제작물 발급 신청서 원장 제출'
              )}
            </button>
          </div>
        </div>
      </div>

{/* 🏢 [모달 1] 외주 발주 처리 업체 종합 관리 센터 (상세 명함 카드 뷰 적용) */}
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
                
                <div className="border-b border-slate-100 pb-3 flex justify-between items-end">
                  <div>
                    <h4 className="text-sm font-black text-slate-800">🏢 외주 제작사 등록 원장 관리</h4>
                    <p className="text-xs text-slate-400 mt-1">이곳에서 제어하는 업체 정보는 신청서 본문의 배정 셀렉트 박스에 실시간 1:1 파싱됩니다.</p>
                  </div>
                </div>

                {/* 🚀 신규 등록 (이름만 먼저 퀵하게 등록하고, 나중에 수정 버튼 눌러서 상세 내용 채우는 동선) */}
                <div className="flex gap-2">
                  <input type="text" placeholder="➕ 신규 외주 제작업체사 명칭 입력 (우선 등록 후 상세정보 수정)" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:bg-white focus:border-blue-500" />
                  <button type="button" onClick={() => {
                    if (!newVendorName.trim()) return;
                    setVendorMasterList([...vendorMasterList, { 
                      id: `VEND_${Date.now()}`, 
                      label: newVendorName.trim(),
                      managerName: '', contact: '', email: '', items: '' 
                    }]);
                    setNewVendorName('');
                  }} className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs px-5 rounded-xl shadow-sm transition-colors">업체 등록</button>
                </div>

                {/* 🚀 마스터 리스트 (명함 카드형 UI) */}
                <div className="grid grid-cols-1 gap-3 max-h-[500px] overflow-y-auto pr-2 mt-4">
                  {vendorMasterList.map(v => (
                    <div key={v.id} className="bg-white border border-slate-200 p-4 rounded-2xl hover:border-blue-300 transition-all shadow-sm">
                      
                      {/* ==== ✏️ [수정 모드] ==== */}
                      {editingVendorId === v.id ? (
                        <div className="space-y-3 animate-fade-in">
                          <input type="text" placeholder="업체명 (필수)" value={editingVendorData.label} onChange={(e) => setEditingVendorData({...editingVendorData, label: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-blue-500 text-slate-800" />
                          
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">👤 담당자 성명</label>
                              <input type="text" placeholder="예: 홍길동 대리" value={editingVendorData.managerName || ''} onChange={(e) => setEditingVendorData({...editingVendorData, managerName: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">📞 연락처 (Phone)</label>
                              <input type="text" placeholder="예: 010-0000-0000" value={editingVendorData.contact || ''} onChange={(e) => setEditingVendorData({...editingVendorData, contact: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-[9px] font-bold text-slate-400 mb-1">📧 이메일 (발주처)</label>
                              <input type="text" placeholder="예: order@vendor.com" value={editingVendorData.email || ''} onChange={(e) => setEditingVendorData({...editingVendorData, email: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                            </div>
                          </div>
                          
                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 mb-1">📦 주요 제작 품목 및 비고 메모</label>
                            <input type="text" placeholder="예: A4 무선제본, 아크릴 현판, 실사출력 등 주로 맡기는 품목 기재" value={editingVendorData.items || ''} onChange={(e) => setEditingVendorData({...editingVendorData, items: e.target.value})} className="w-full bg-yellow-50/50 border border-yellow-200/60 rounded-lg px-3 py-2 text-xs outline-none focus:border-yellow-400" />
                          </div>

                          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button type="button" onClick={() => setEditingVendorId(null)} className="text-[10px] font-black text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">취소</button>
                            <button type="button" onClick={() => {
                              if (!editingVendorData.label.trim()) return alert('업체명은 필수입니다.');
                              setVendorMasterList(vendorMasterList.map(item => item.id === v.id ? { ...item, ...editingVendorData } : item));
                              setEditingVendorId(null);
                            }} className="text-[10px] font-black text-white bg-emerald-600 px-4 py-1.5 rounded-lg shadow-sm hover:bg-emerald-500 transition-colors">저장 완료</button>
                          </div>
                        </div>

                      ) : (
                        
                        /* ==== 👀 [보기 모드] ==== */
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-start">
                            <span className="text-sm font-black text-slate-800">🏢 {v.label}</span>
                            <div className="flex gap-1.5 shrink-0">
                              <button type="button" onClick={() => { 
                                setEditingVendorId(v.id); 
                                setEditingVendorData({
                                  label: v.label,
                                  managerName: v.managerName || '',
                                  contact: v.contact || '',
                                  email: v.email || '',
                                  items: v.items || ''
                                }); 
                              }} className="text-[10px] font-black text-slate-500 hover:text-blue-600 bg-white border border-slate-200 hover:border-blue-200 px-2.5 py-1 rounded-lg transition-colors">수정</button>
                              <button type="button" onClick={() => {
                                if (vendorMasterList.length <= 1) return alert('최소 한 개 이상의 외주업체가 필요합니다.');
                                if (confirm(`[${v.label}] 업체를 마스터 대장에서 완전히 삭제하시겠습니까?`)) {
                                  setVendorMasterList(vendorMasterList.filter(item => item.id !== v.id));
                                }
                              }} className="text-[10px] font-black text-red-400 hover:text-red-600 bg-white border border-slate-200 hover:border-red-200 px-2.5 py-1 rounded-lg transition-colors">삭제</button>
                            </div>
                          </div>

                          {/* 상세 정보 노출 구역 (데이터가 있을 때만 노출) */}
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1">
                            {v.managerName && <span className="text-[11px] font-medium text-slate-600">👤 <span className="font-bold text-slate-700">{v.managerName}</span></span>}
                            {v.contact && <span className="text-[11px] font-medium text-slate-600">📞 <span className="font-bold text-slate-700">{v.contact}</span></span>}
                            {v.email && <span className="text-[11px] font-medium text-slate-600">📧 <span className="font-bold text-slate-700">{v.email}</span></span>}
                          </div>
                          
                          {v.items && (
                            <div className="mt-1.5 bg-slate-50 border border-slate-100 rounded-lg p-2 text-[11px] text-slate-600 font-medium flex gap-2 items-start">
                              <span className="shrink-0">📦</span>
                              <span className="break-all">{v.items}</span>
                            </div>
                          )}
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