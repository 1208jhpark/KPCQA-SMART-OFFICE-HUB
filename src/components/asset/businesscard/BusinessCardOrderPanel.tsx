'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { getKSTDateString } from '@/utils/dateUtils';
import { resolveInterfaceEditState } from '@/lib/permission-utils';

const MENU_PATH = '/asset/businesscard/master/order';

const MASTER_TABS = [
  { id: 'requests', path: '/asset/businesscard/master/requests', name: '📋 사용자 신청현황 관리', activeColor: 'text-indigo-600' },
  { id: 'order', path: '/asset/businesscard/master/order', name: '📦 외주 발주 관리/견적 비교', activeColor: 'text-emerald-600' },
  { id: 'archive', path: '/asset/businesscard/master/archive', name: '📁 정산 완료 보관함', activeColor: 'text-slate-800' },
] as const;

interface RequestHistory {
  id: string;
  postNumber: string;
  applyDate: string;
  processDate: string | null;
  userName: string;
  userNameEn: string;
  deptHead: string;
  deptHeadEn: string;
  deptName: string;
  deptNameEn: string;
  title: string;
  titleEn: string;
  mobile: string;
  mobileEn: string;
  phone: string;
  phoneEn: string;
  fax: string;
  faxEn: string;
  email: string;
  emailEn: string;
  additionalKo: string | null;
  additionalEn: string | null;
  zipCode: string;
  addressKo: string;
  addressEn: string;
  adminStatus: string;
  batchId?: string | null;
  quantity: number;
  isModifiedByAdmin?: boolean;
  adminMemo?: string | null;
  adminModifierName?: string | null;
  adminModifiedAt?: string | null;
}

interface OrderBatch {
  id: string;
  orderDate: string;
  totalCount: number;
  deptHeadGroup: string;
  status: '발주완료' | '견적비교완료' | '지급완료';
  items: RequestHistory[];
}

// 🚀 [신설] 외주업체 마스터 데이터 타입
interface Vendor {
  id: string;
  companyName: string;
  managerName: string;
  email: string;
  isActive: boolean;
}

const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);

export default function BusinessCardOrderPanel() {
  const pathname = usePathname();
  const [requests, setRequests] = useState<RequestHistory[]>([]);
  const [batches, setBatches] = useState<OrderBatch[]>([]);
  const [units, setUnits] = useState<{ id: string, name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  
  const [detailTarget, setDetailTarget] = useState<RequestHistory | null>(null);
  const [isRequestEditing, setIsRequestEditing] = useState(false);
  const [requestEditForm, setRequestEditForm] = useState<RequestHistory | null>(null);
  const [adminMemoInput, setAdminMemoInput] = useState('');
  
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );
// 🚀 [수정] 견적 대조 상태 변수 (id 추가)
const [compareResult, setCompareResult] = useState<{
  status: 'idle' | 'analyzing' | 'success' | 'error';
  dbTotalQty: number;
  docTotalQty: number;
  docTotalPrice: number;
  matched: boolean;
  fileName: string;
  logs: string[];
  details: { id: string; name: string; dept: string; dbQty: number; docQty: number; matchStatus: 'match' | 'mismatch' | 'missing' }[];
}>({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] });

// 🚀 [신설] 개별 명함 행(Row)에 O, X, - 를 표시하기 위한 상태 저장소
const [itemMatchStatus, setItemMatchStatus] = useState<Record<string, 'match' | 'mismatch' | 'missing' | 'idle'>>({});
 

  const [currentBatch, setCurrentBatch] = useState<OrderBatch | null>(null);

  // 🚀 외주업체 마스터 데이터 상태 및 모달 제어
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState<Partial<Vendor>>({ companyName: '', managerName: '', email: '', isActive: true });
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');

  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 1. 상단 대기열 데이터 로드 (아직 묶이지 않은 접수완료 건만)
      const reqRes = await fetch(`/api/asset/businesscard/master/requests?t=${Date.now()}`, { cache: 'no-store' });
      if (reqRes.ok) {
        const data = await reqRes.json();
        const orderWaitData = data
          .filter((r: any) => r.adminStatus === '접수완료' && !r.orderGroupId)
          .map((r: any) => ({ ...r, quantity: r.quantity || 1 }));
        setRequests(orderWaitData);
      }
      
      // 🚀 2. 하단 관리대장(발주 묶음) 데이터 로드 (증발 해결의 핵심!)
      const batchRes = await fetch(`/api/asset/businesscard/master/order?t=${Date.now()}`, { cache: 'no-store' });
      if (batchRes.ok) {
        const batchData = await batchRes.json();
        // 백엔드 GET에서 include: { items: true }로 쏴주기 때문에 프론트엔드 조립이 필요 없습니다!
        setBatches(batchData); 
      }
      
      // 3. 부서 필터 마스터 로드
      const unitRes = await fetch(`/api/admin/units?t=${Date.now()}`, { cache: 'no-store' });
      if (unitRes.ok) {
        setUnits(await unitRes.json());
      } else {
        setUnits([{id: '1', name: '미래성장전략본부'}, {id: '2', name: '경영기획센터'}]);
      }

      // 4. 외주업체 마스터 로드
      const vendorRes = await fetch(`/api/asset/businesscard/master/vendors?t=${Date.now()}`, { cache: 'no-store' });
      if (vendorRes.ok) {
        const vData = await vendorRes.json();
        setVendors(vData);
        if (vData.length > 0) setSelectedVendorId(vData[0].id);
      } else {
        setVendors([]);
      }

      // 5. 권한 배너용 인터페이스 요약
      const ts = Date.now();
      const [meRes, ifRes, summaryRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
      ]);
      if (meRes && meRes.ok) setCurrentUser(await meRes.json());
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find(
              (m: any) =>
                m.path === MENU_PATH || m.path?.includes('/businesscard/master/order')
            )
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedIds(new Set(requests.map(r => r.id)));
    else setSelectedIds(new Set());
  };
  const handleSelectRow = (id: string) => {
    const nextSet = new Set(selectedIds);
    if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
    setSelectedIds(nextSet);
  };

  const handleSelectAllBatches = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedBatchIds(new Set(filteredBatches.map(b => b.id)));
    else setSelectedBatchIds(new Set());
  };
  const handleSelectBatchRow = (id: string) => {
    const nextSet = new Set(selectedBatchIds);
    if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
    setSelectedBatchIds(nextSet);
  };

// 🚀 이름/소속 기반 1:1 파일 분석 엔진 (조건부 3+1 핀셋 매칭 알고리즘 탑재)
const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (selectedBatchIds.size === 0) return alert("비교할 발주 묶음을 먼저 체크박스로 선택해 주세요.");

  const dbItems = batches.filter(b => selectedBatchIds.has(b.id)).flatMap(b => b.items || []);
  const dbTotal = dbItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
  
  // 💡 동명이인 정밀 판별을 위해 장부에 본부(deptHead)와 센터/부서명(deptName)을 확실히 분리 기록
  let details = dbItems.map(item => ({
    id: item.id,
    name: item.userName,
    dept: item.deptName || item.deptHead,
    deptHead: item.deptHead,
    deptName: item.deptName,
    dbQty: item.quantity || 1,
    docQty: 0,
    matchStatus: 'missing' as 'match' | 'mismatch' | 'missing'
  }));

  setCompareResult(prev => ({ ...prev, status: 'analyzing', fileName: file.name, dbTotalQty: dbTotal, logs: ['파일 분석 및 3+1 조건부 매칭을 시작합니다...'], details: [] }));

  try {
    let docTotalQty = 0;
    let docTotalPrice = 0;
    let logs = [`✅ DB 기준 대상자: 총 ${details.length}명 (${dbTotal}통)`];

    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
      
      logs.push('✅ 엑셀 파싱 완료. 명함 품목 및 소속 교차 검증 중...');
      
      jsonData.forEach((row, rowIndex) => {
        const rowStr = row.join(' ').replace(/\s/g, ''); 
        
        // 1단계 [필수1]: 해당 행에 반드시 '명함'이라는 단어가 명시되어야 함
        if (rowStr.includes('명함')) {
          // 2단계 [필수2]: 해당 행에 이름이 포함된 DB 발주자 후보군 전체 추출
          const nameCandidates = details.filter(d => rowStr.includes(d.name));
          
          if (nameCandidates.length > 0) {
            // 3단계 [조건부 옵션]: 동명이인 방지를 위한 소속(본부 또는 센터/부서) 핀셋 검색
            let bestMatch = nameCandidates.find(d => 
              rowStr.includes(d.deptHead.replace(/\s/g, '')) || 
              (d.deptName && rowStr.includes(d.deptName.replace(/\s/g, '')))
            );
            
            // 만약 문서상 소속 일치 항목이 없더라도, 이 묶음에 해당 이름을 가진 사람이 '단 1명'뿐이라면 유연하게 통과 (대표님 기획 반영)
            if (!bestMatch && nameCandidates.length === 1) {
              bestMatch = nameCandidates[0];
            }
            
            if (bestMatch) {
              // 4단계 [필수3]: 수량 및 금액 확정
              const numbers = row.filter(cell => typeof cell === 'number');
              const qty = numbers.length > 0 ? numbers[0] : 1;
              const price = numbers.length > 1 ? numbers[numbers.length - 1] : 0;

              const targetIndex = details.findIndex(d => d.id === bestMatch.id);
              if (targetIndex !== -1) {
                details[targetIndex].docQty += qty;
                docTotalQty += qty;
                docTotalPrice += price;
                logs.push(`🔍 [매칭 성공] ${bestMatch.name} (${bestMatch.dept}) - 수량: ${qty}통 확인`);
              }
            } else {
              // 이름은 같으나 이번 묶음 대장의 타인 부서명만 발견되었거나 꼬인 경우 불일치 처리
              logs.push(`❌ [완전 불일치] '명함'과 이름은 매칭되나, 소속 정보가 달라 검증 제외 (행: ${rowIndex + 1})`);
            }
          }
        }
      });
    } else if (file.name.endsWith('.pdf')) {
      logs.push('⏳ PDF 파일 감지됨. 최신 v2 엔진으로 텍스트 분석을 요청합니다...');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('batchDetails', JSON.stringify(details));

      const ocrRes = await fetch('/api/asset/businesscard/master/compare-ocr', {
        method: 'POST',
        body: formData
      });

      if (!ocrRes.ok) throw new Error('백엔드 파싱 서버 응답 실패');

      const ocrData = await ocrRes.json();
      details = ocrData.details;
      docTotalQty = ocrData.docTotalQty;
      docTotalPrice = ocrData.docTotalPrice;
      logs.push(...ocrData.logs);
    }

    let isAllMatched = true;
    const newMatchStatus = { ...itemMatchStatus };

    details.forEach(d => {
      if (d.docQty === d.dbQty) {
        d.matchStatus = 'match';
      } else if (d.docQty > 0) {
        d.matchStatus = 'mismatch';
        isAllMatched = false;
      } else {
        d.matchStatus = 'missing';
        isAllMatched = false;
      }
      newMatchStatus[d.id] = d.matchStatus;
    });

    if (isAllMatched) logs.push(`🎉 완벽 검증: 조건부 3+1 매칭 기준 전 건 일치합니다!`);
    else logs.push(`❌ 검증 실패: 일부 항목에 수량 불일치 또는 누락이 존재합니다.`);

    setCompareResult(prev => ({
      ...prev, status: 'success', docTotalQty, docTotalPrice, matched: isAllMatched, logs, details
    }));
    setItemMatchStatus(newMatchStatus);

  } catch (error: any) {
    console.error(error);
    setCompareResult(prev => ({ ...prev, status: 'error', logs: [...prev.logs, `❌ 오류 발생: ${error.message}`], details: [] }));
  }
};

// 🚀 새로운 /order API를 사용하는 발주 묶음 생성 함수
const handleCreateBatch = async () => {
  if (selectedIds.size === 0) return alert('⚠️ 발주 처리할 명함을 선택해 주세요.');
  const targets = requests.filter(r => selectedIds.has(r.id));
  const batchId = `BATCH-${getKSTDateString().replace(/-/g,'')}-${String(batches.length + 1).padStart(2, '0')}`;
  const distinctDepts = Array.from(new Set(targets.map(t => t.deptHead))).join(', ');
  
  try {
    const payload = {
      id: batchId,
      orderDate: getKSTDateString(),
      totalCount: targets.length,
      deptHeadGroup: distinctDepts || '전사종합',
      status: '발주완료',
      itemIds: targets.map(t => t.id)
    };

    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'DB 묶음 생성 실패');
    }

    const newBatch: OrderBatch = {
      id: batchId, 
      orderDate: payload.orderDate,
      totalCount: payload.totalCount, 
      deptHeadGroup: payload.deptHeadGroup,
      status: '발주완료', 
      items: targets.map(t => ({ ...t, adminStatus: '발주완료', batchId }))
    };
    
    setBatches([newBatch, ...batches]);
    setRequests(requests.filter(r => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    alert("🚀 발주 묶음이 성공적으로 생성되어 DB에 완벽히 반영되었습니다.");
  } catch (error: any) {
    console.error(error);
    alert(`❌ 발주 처리 실패: ${error.message}`);
  }
};

const handleExecuteUpdate = async () => {
  if (!requestEditForm) return;
  if (!adminMemoInput.trim()) return alert('⚠️ 변경 이력 관리를 위해 하단에 [수정 사유]를 반드시 입력해 주세요.');

  try {
    const payload = {
      ...requestEditForm,
      isModifiedByAdmin: true,
      adminMemo: adminMemoInput,
      adminModifierName: "관리자",
      adminModifiedAt: new Date().toISOString()
    };

    const res = await fetch('/api/asset/businesscard/master/requests', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      alert("💾 원문 정보가 DB에 완벽히 동기화 되었습니다.");
      setRequests(requests.map(r => r.id === payload.id ? payload : r));
      setBatches(batches.map(b => ({ 
        ...b, items: b.items.map(item => item.id === payload.id ? payload : item) 
      })));
      setIsRequestEditing(false);
      setDetailTarget(null);
      setAdminMemoInput('');
    } else {
      alert("❌ 서버 업데이트 실패");
    }
  } catch (e) { alert("네트워크 오류"); }
};

const handleBatchExcelDownload = (batch: OrderBatch) => {
  const excelData = batch.items.map(r => ({
    '관리번호': r.postNumber,
    '수량(통)': r.quantity || 1,
    '성명': r.userName,
    '신청일자': r.applyDate,
    '본부': r.deptHead,
    '소속': r.deptName || '',
    '직책/직급': r.title,
    '추가사항': r.additionalKo || '',
    '우편번호': r.zipCode,
    '주소': r.addressKo,
    '휴대전화': r.mobile,
    '전화번호': r.phone || '',
    '팩스': r.fax || '',
    '이메일': r.email,
    '영문이름': r.userNameEn || '',
    '영문본부': r.deptHeadEn || '',
    '영문소속': r.deptNameEn || '',
    '영문직책': r.titleEn || '',
    '영문추가': r.additionalEn || '',
    '영문주소': r.addressEn || '',
    '영문 휴대전화': r.mobileEn || '',
    '영문전화': r.phoneEn || '',
    '영문팩스': r.faxEn || '',
    '이메일(영문)': r.emailEn || r.email
  }));
  const ws = XLSX.utils.json_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "명함발주데이터");
  XLSX.writeFile(wb, `명함발주서_${batch.id}.xlsx`);
};

const openEmailModal = (batch: OrderBatch) => {
  setCurrentBatch(batch);
  setIsEmailModalOpen(true);
};

const activeVendor = vendors.find(v => v.id === selectedVendorId) || vendors.filter(v => v.isActive)[0];
const getPreviewSubject = () => currentBatch ? `[명함발주] KPCQA 명함 제작 요청 (${currentBatch.id})` : '';
const getPreviewBody = () => {
  if (!currentBatch) return '';
  if (!activeVendor) return '등록된 외주 업체가 없습니다. [업체 관리]에서 협력사를 먼저 등록해 주세요.';
  return `안녕하세요, ${activeVendor.companyName} ${activeVendor.managerName}님.\nKPCQA 명함 통합 관리자입니다.\n\n금일 발주 확정된 명함 리스트 총 ${currentBatch.totalCount}건 송부해 드립니다.\n첨부된 엑셀 데이터로 명함 제작 부탁드립니다.\n\n- 발주 번호: ${currentBatch.id}\n- 총 수량: ${currentBatch.totalCount}건\n\n감사합니다.`;
};

const handleCopyToClipboard = async () => {
  try {
    const copyText = `제목: ${getPreviewSubject()}\n\n${getPreviewBody()}`;
    await navigator.clipboard.writeText(copyText);
    alert('✅ 클립보드에 복사되었습니다.\n사내 그룹웨어 메일 창에 붙여넣기(Ctrl+V) 해주세요.');
  } catch (err) { alert('복사에 실패했습니다. 내용을 직접 드래그해서 복사해 주세요.'); }
};

// 🚀 개별 묶음 현물 지급 완료 처리 함수 (DB 연동 완료)
const handleMarkAsDistributed = async (batchId: string, e: React.MouseEvent) => {
  e.stopPropagation(); // 행 클릭(아코디언 펼침) 방지
  
  if (!confirm(`이 묶음의 명함 현물이 도착하여 임직원에게 지급을 완료하셨습니까?\n(확인 시 사용자 화면에서도 '지급완료'로 변경됩니다.)`)) return;

  try {
    // 💡 백엔드 DB 업데이트 요청 (주석 해제 및 활성화)
    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId })
    });
    
    if (!res.ok) throw new Error('DB 업데이트 실패');

    // 화면(UI) 즉각 업데이트
    setBatches(batches.map(b => 
      b.id === batchId 
        ? { 
            ...b, 
            status: '지급완료', 
            items: b.items.map(item => ({ ...item, adminStatus: '지급완료' })) 
          } 
        : b
    ));
    
    alert('🎁 지급 완료 처리가 DB에 정상적으로 저장되었습니다.');
  } catch (error) {
    alert('❌ 처리 중 오류가 발생했습니다.');
  }
};

const handleMoveToArchive = async () => {
  if (selectedBatchIds.size === 0) return alert('⚠️ 보관함으로 이관할 발주 묶음을 선택해 주세요.');
  if (!confirm(`선택한 ${selectedBatchIds.size}개의 묶음을 지급 완료(보관함) 상태로 이관하시겠습니까?`)) return;

  try {
    const res = await fetch('/api/asset/businesscard/master/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchIds: Array.from(selectedBatchIds) })
    });

    if (!res.ok) throw new Error('이관 처리 실패');
    setBatches(batches.filter(b => !selectedBatchIds.has(b.id)));
    setSelectedBatchIds(new Set());
    alert("📁 성공적으로 완료 보관함으로 이관되었습니다.");
  } catch (error) {
    console.error(error);
    alert("❌ 보관함 이관 중 서버 오류가 발생했습니다.");
  }
};

// 🚀 생성된 발주 데이터(batches)를 기준으로 실제로 존재하는 년/월/조직만 추출 (중복 제거 및 정렬)
const availableYears = Array.from(new Set(batches.map(b => b.orderDate.substring(0, 4)))).sort((a, b) => b.localeCompare(a));
const availableMonths = Array.from(new Set(batches.map(b => b.orderDate.substring(5, 7)))).sort();
const availableDepts = Array.from(new Set(
  batches.flatMap(b => b.deptHeadGroup.split(',').map(d => d.trim()))
)).filter(Boolean).sort();

// 🚀 필터링 로직에 yearFilter === 'ALL' 조건 추가
const filteredBatches = batches.filter(b => {
  const matchYear = yearFilter === 'ALL' ? true : b.orderDate.startsWith(yearFilter);
  const matchMonth = monthFilter === 'ALL' ? true : b.orderDate.split('-')[1] === monthFilter;
  const matchDept = deptFilter === 'ALL' ? true : b.deptHeadGroup.includes(deptFilter);
  return matchYear && matchMonth && matchDept;
});

return (
  <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
    
{/* client-search 배너 규격: emerald→teal · orbs · permission chips */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
  <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
  <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
  <div className="relative z-10">
    <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
      BUSINESS CARD TOTAL GOVERNANCE
    </h3>
    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
      전사 임직원 명함 발주 접수 통제 대장
    </h1>
    <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
      임직원이 신청한 명함의 국/영문 원본 조판 텍스트 데이터를 검수하고 외주 조판 공정으로 이관 제어하는 마스터 컨트롤 허브입니다.
    </p>
    {permissionSummary && (
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
          <span>👑 Master 책임자:</span>
          <span>{permissionSummary.masterName}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
          <span>👁️ Access:</span>
          <span>{permissionSummary.accessDesignate}</span>
          <span className="opacity-50">|</span>
          <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
          <span className="opacity-50">|</span>
          <span>Level: {permissionSummary.accessLevel}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
          <span>✍️ Edit:</span>
          <span>{permissionSummary.editDesignate}</span>
          <span className="opacity-50">|</span>
          <span>Level: {permissionSummary.editLevel}</span>
        </div>
        {!canEditMaster && (
          <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
            편집 권한 없음 — 조회만 가능
          </span>
        )}
      </div>
    )}
  </div>
</div>

{/* 탭 네비게이션 — client-search / distribution 스위처 규격 */}
<div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
  <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
    {MASTER_TABS.map((tab) => {
      const isActive = pathname.startsWith(tab.path);
      return (
        <Link
          key={tab.id}
          href={tab.path}
          className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
            isActive
              ? `bg-white ${tab.activeColor} shadow-sm border border-slate-200/80`
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>{tab.name}</span>
        </Link>
      );
    })}
  </div>
  <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
    ※ 탭을 클릭하여 신청현황·외주발주·보관함을 전환합니다.
  </p>
</div>

    {/* 상단 대기열 */}
    <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
      <div className="p-5 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
        <h2 className="text-sm font-black text-slate-800 flex items-center gap-2">
          🔵 외주 조판 묶음 발주 대기열 <span className="bg-slate-200 text-slate-700 text-[11px] px-2 py-0.5 rounded-full font-bold">{requests.length}건</span>
        </h2>
        <button onClick={handleCreateBatch} disabled={selectedIds.size === 0} className="text-[10px] font-black bg-indigo-600 text-white border border-indigo-600 rounded-lg px-4 py-1.5 hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50">선택된 {selectedIds.size}건 묶음 발주 생성 🚀</button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
            <tr>
              <th className="h-12 pl-6 w-[50px]"><input type="checkbox" onChange={handleSelectAll} checked={requests.length > 0 && selectedIds.size === requests.length} className="rounded text-indigo-600 focus:ring-indigo-500" /></th>
              <th className="h-12 px-3 w-[60px]">NO</th>
              <th className="h-12 px-3 w-[120px]">관리번호</th>
              <th className="h-12 px-3 w-[120px]">신청일자</th>
              <th className="h-12 px-4 w-[240px]">신청 조직 (본부 / 부서)</th>
              <th className="h-12 px-4 w-[110px]">이름</th>
              <th className="h-12 px-4 w-[180px]">직책 / 직급</th>
              <th className="h-12 px-4 text-center w-[150px]">신청내역 상세보기</th>
              <th className="h-12 px-2 text-center w-[80px]">수량(통)</th>
              <th className="h-12 px-3 text-center w-[110px]">공정상태</th>
              <th className="h-12 pr-6 text-center w-[120px]">상태변경</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
            {requests.map((row, idx) => (
              <tr key={row.id} className="h-16 hover:bg-slate-50/50">
                <td className="pl-6"><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => handleSelectRow(row.id)} className="rounded text-indigo-600" /></td>
                <td className="px-3 font-mono text-slate-400">{idx + 1}</td>
                <td className="px-3 font-mono text-indigo-600">{row.postNumber}</td>
                <td className="px-3 text-slate-400 font-mono">{row.applyDate}</td>
                <td className="px-4"><span className="font-black">{row.deptHead}</span> {row.deptName && <span className="text-slate-400 ml-1">({row.deptName})</span>}</td>
                <td className="px-4 font-black">{row.userName}</td>
                <td className="px-4 font-medium text-slate-500">{row.title}</td>
                <td className="px-4 text-center">
                  <button onClick={() => setDetailTarget(row)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-black rounded-lg border">신청원문검수 🔎</button>
                </td>
                <td className="px-2 text-center text-rose-600 font-black">{row.quantity || 1}</td>
                <td className="px-3 text-center">
                  <span className="px-2.5 py-1 rounded-full font-black text-[10px] bg-blue-100 text-blue-800">{row.adminStatus}</span>
                </td>
                <td className="pr-6 text-center text-[11px] text-slate-400 font-normal italic">이관완료 🔒</td>
              </tr>
            ))}
            {requests.length === 0 && <tr className="h-16"><td colSpan={11} className="text-center text-slate-400 py-10 bg-slate-50/50">대기열이 비어있습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    {/* 하단 발주 묶음 대장 */}
    <div className="bg-slate-900 text-white rounded-[2.5rem] shadow-xl overflow-hidden p-6 mt-8 space-y-4">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-black flex items-center gap-2">📦 외주 발주 완료 및 묶음(Batch) 관리 대장</h2>
          <p className="text-[11px] text-slate-400 mt-1">체크박스를 통해 다중 묶음을 일괄 견적대조 및 이관 처리합니다.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2 bg-slate-800 p-1.5 rounded-2xl border border-slate-700">
            <button onClick={() => setIsCompareModalOpen(true)} disabled={selectedBatchIds.size === 0} className="p-2 px-4 bg-amber-500 hover:bg-amber-600 text-white font-black text-[11px] rounded-xl shadow-md disabled:opacity-40">
              ⚖️ 업체 엑셀 견적 대조 ({selectedBatchIds.size}건)
            </button>
            <button onClick={handleMoveToArchive} disabled={selectedBatchIds.size === 0} className="p-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] rounded-xl shadow-md disabled:opacity-40">
              📁 선택 묶음 보관함으로 이관
            </button>
          </div>

          {/* 🚀 동적 데이터 기반 스마트 필터 UI */}
          <div className="flex gap-1.5 bg-slate-800 p-1.5 rounded-xl border border-slate-700">
              <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="bg-slate-900 text-white text-[11px] font-black p-1 rounded-lg border-slate-700 outline-none cursor-pointer">
                <option value="ALL">전체 년도</option>
                {availableYears.map(year => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
              <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="bg-slate-900 text-white text-[11px] font-black p-1 rounded-lg border-slate-700 outline-none cursor-pointer">
                <option value="ALL">전체 월</option>
                {availableMonths.map(month => (
                  <option key={month} value={month}>{parseInt(month)}월</option>
                ))}
              </select>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="bg-slate-900 text-white text-[11px] font-black p-1 rounded-lg border-slate-700 outline-none cursor-pointer max-w-[150px]">
                <option value="ALL">전체 조직(Unit)</option>
                {availableDepts.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-800 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-700">
            <tr>
              <th className="h-12 px-4 w-[50px]"><input type="checkbox" onChange={handleSelectAllBatches} checked={filteredBatches.length > 0 && selectedBatchIds.size === filteredBatches.length} className="rounded text-emerald-500 bg-slate-950 border-slate-700" /></th>
              <th className="h-12 px-2 w-[160px]">묶음 번호</th>
              <th className="h-12 px-4 w-[120px]">발주 일자</th>
              <th className="h-12 px-4 min-w-[280px]">기준 소속</th>
              <th className="h-12 px-4 text-center w-[80px]">총 수량</th>
              <th className="h-12 px-4 text-center w-[100px]">상태</th>
              <th className="h-12 px-2 text-center w-[120px]">엑셀 다운로드</th>
              <th className="h-12 px-2 text-center w-[120px]">업체 메일 발송</th>
              <th className="h-12 px-2 text-center w-[100px]">명함지급</th>
            </tr>
          </thead>
          <tbody className="text-xs font-bold divide-y divide-slate-800">
            {filteredBatches.map((batch) => (
              <React.Fragment key={batch.id}>
                <tr className="h-16 hover:bg-slate-800/40 cursor-pointer" onClick={() => setExpandedBatchId(expandedBatchId === batch.id ? null : batch.id)}>
                  <td className="px-4" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedBatchIds.has(batch.id)} onChange={() => handleSelectBatchRow(batch.id)} className="rounded text-emerald-500 bg-slate-950 border-slate-700" /></td>
                  <td className="px-2 font-mono text-emerald-400">{expandedBatchId === batch.id ? '👇' : '👉'} {batch.id}</td>
                  <td className="px-4 text-slate-400 font-mono">{batch.orderDate}</td>
                  <td className="px-4 text-slate-200">{batch.deptHeadGroup}</td>
                  <td className="px-4 text-center text-amber-400 font-black">{batch.items?.length || 0} 건</td>
                  <td className="px-4 text-center"><span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px]">{batch.status}</span></td>
                  <td className="px-2 text-center" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleBatchExcelDownload(batch)} className="p-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-black text-[10px] rounded-lg border border-slate-700 w-full">📊 엑셀 저장</button>
                  </td>
                  <td className="px-2 text-center" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEmailModal(batch)} className="p-1.5 px-3 bg-indigo-900 hover:bg-indigo-800 text-indigo-300 font-black text-[10px] rounded-lg border border-indigo-800 w-full transition-colors">📋 미리보기</button>
                  </td>

                  {/* 🚀 신설: 지급 완료 처리 버튼 */}
                  <td className="px-2 text-center" onClick={e => e.stopPropagation()}>
                      {batch.status === '발주완료' ? (
                        <button 
                          onClick={(e) => handleMarkAsDistributed(batch.id, e)} 
                          className="p-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-[10px] rounded-lg shadow-sm w-full transition-colors"
                        >
                          🎁 지급완료
                        </button>
                      ) : (
                        <span className="text-[10px] font-black text-slate-500 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 w-full block">
                          지급됨 ✔️
                        </span>
                      )}
                    </td>

                </tr>
                
                {expandedBatchId === batch.id && (
                  <tr>
                    <td colSpan={8} className="bg-slate-100 p-6 border-l-4 border-emerald-500 shadow-inner">
                      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-600 font-black tracking-widest border-b border-slate-200 text-[10px]">
                            <tr>
                              <th className="h-10 px-4 w-[60px]">NO</th>
                              <th className="h-10 px-4 w-[120px]">관리번호</th>
                              <th className="h-10 px-4 w-[200px]">신청 조직 (본부 / 부서)</th>
                              <th className="h-10 px-4 w-[100px]">이름</th>
                              <th className="h-10 px-4 w-[150px]">직책 / 직급</th>
                              <th className="h-10 px-4 text-center w-[80px]">수량(통)</th>
                              <th className="h-10 px-4 text-center w-[120px]">상세보기/수정</th>
                              <th className="h-10 px-4 text-center w-[80px]">견적대조</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                            {batch.items?.map((item, idx) => {
                              const mStatus = itemMatchStatus[item.id] || 'idle';
                              return (
                              <tr key={item.id} className={`h-12 hover:bg-slate-50/50 ${mStatus === 'mismatch' || mStatus === 'missing' ? 'bg-rose-50/40' : ''}`}>
                                <td className="px-4 font-mono text-slate-400">{idx + 1}</td>
                                <td className="px-4 font-mono text-indigo-600">{item.postNumber}</td>
                                <td className="px-4">
                                  <span className="font-black text-slate-900">{item.deptHead}</span> 
                                  {item.deptName && <span className="text-slate-400 ml-1">({item.deptName})</span>}
                                </td>
                                <td className="px-4 font-black text-slate-900">{item.userName}</td>
                                <td className="px-4 font-medium text-slate-500">{item.title}</td>
                                <td className="px-4 text-center text-rose-600 font-black">{item.quantity || 1}</td>
                                <td className="px-4 text-center">
                                  <button onClick={() => setDetailTarget(item)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-black rounded-lg border border-slate-200 transition-colors">신청원문검수 🔎</button>
                                </td>
                                <td className="px-4 text-center text-base font-black">
                                  {mStatus === 'idle' && <span className="text-slate-300">-</span>}
                                  {mStatus === 'match' && <span className="text-emerald-500">O</span>}
                                  {(mStatus === 'mismatch' || mStatus === 'missing') && <span className="text-rose-500">X</span>}
                                </td>
                              </tr>
                            )})}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* 상세 뷰 모달 */}
    {detailTarget && (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-black text-blue-600 font-mono tracking-widest">{isRequestEditing ? '⚡ 원문 편집 모드 활성화 (발주 전 최종)' : '🔎 발주 원문 검수 모드'}</span>
              <h2 className="text-base font-black text-slate-900 mt-1">명함 신청 데이터 세부 검수창 ({detailTarget.userName} 님)</h2>
            </div>
            <button onClick={() => { setDetailTarget(null); setIsRequestEditing(false); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black text-sm transition-colors">✕</button>
          </div>

          {detailTarget.isModifiedByAdmin && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-bold">⚠️ 주의: 이 신청서는 관리자에 의해 이미 한 번 수정된 이력이 있습니다. (사유: {detailTarget.adminMemo})</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-100">
            <div className="space-y-2 border-r border-slate-200 pr-5 flex flex-col">
              <h3 className="text-xs font-black text-slate-800 border-b pb-1.5">1. 국문 조판 데이터</h3>
              <div className="space-y-1.5 text-xs font-bold text-slate-600 flex-1">
                <label className="block text-[10px] text-slate-400 mt-1">성명</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.userName || ''} onChange={e => setRequestEditForm({...requestEditForm!, userName: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-xs font-black" /> : <p className="text-slate-900 font-black">{detailTarget.userName}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">직책/직급</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.title || ''} onChange={e => setRequestEditForm({...requestEditForm!, title: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black" /> : <p className="text-slate-900 font-black">{detailTarget.title}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">자격사항</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.additionalKo || ''} onChange={e => setRequestEditForm({...requestEditForm!, additionalKo: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-slate-900 text-xs font-black" /> : <p className="text-slate-900 font-black">{detailTarget.additionalKo || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">휴대전화</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.mobile || ''} onChange={e => setRequestEditForm({...requestEditForm!, mobile: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono font-black">{detailTarget.mobile}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">내선전화</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.phone || ''} onChange={e => setRequestEditForm({...requestEditForm!, phone: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono">{detailTarget.phone || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">이메일</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.email || ''} onChange={e => setRequestEditForm({...requestEditForm!, email: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-slate-900 font-mono">{detailTarget.email}</p>}
              </div>
              <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200">
                <p className="text-[11px] font-bold text-slate-600 mb-1">팩스: <span className="font-mono text-slate-900">{detailTarget.fax || '-'}</span></p>
                <p className="text-[11px] font-bold text-slate-600 leading-relaxed">주소: <span className="text-slate-900">[{detailTarget.zipCode}] {detailTarget.addressKo}</span></p>
              </div>
            </div>

            <div className="space-y-2 pl-1 flex flex-col">
              <h3 className="text-xs font-black text-indigo-800 border-b border-indigo-100 pb-1.5">2. 영문 조판 데이터</h3>
              <div className="space-y-1.5 text-xs font-bold text-slate-600 flex-1">
                <label className="block text-[10px] text-slate-400 mt-1">영문 성명</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.userNameEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, userNameEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-black" /> : <p className="text-indigo-900 font-black">{detailTarget.userNameEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 직책/직급</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.titleEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, titleEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-black" /> : <p className="text-indigo-900 font-black">{detailTarget.titleEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 자격사항</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.additionalEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, additionalEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white text-indigo-950 text-xs font-black" /> : <p className="text-indigo-900 font-black">{detailTarget.additionalEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 휴대전화</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.mobileEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, mobileEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-indigo-900 font-mono font-black">{detailTarget.mobileEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 내선전화</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.phoneEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, phoneEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-indigo-900 font-mono">{detailTarget.phoneEn || '-'}</p>}
                <label className="block text-[10px] text-slate-400 mt-1">영문 이메일</label>
                {isRequestEditing ? <input type="text" value={requestEditForm?.emailEn || ''} onChange={e => setRequestEditForm({...requestEditForm!, emailEn: e.target.value})} className="w-full p-1.5 border border-blue-300 rounded bg-white font-mono text-xs font-black" /> : <p className="text-indigo-900 font-mono">{detailTarget.emailEn || '-'}</p>}
              </div>
              <div className="mt-4 p-3 bg-white rounded-xl border border-indigo-100">
                <p className="text-[11px] font-bold text-slate-600 mb-1">영문 팩스: <span className="font-mono text-indigo-900">{detailTarget.faxEn || '-'}</span></p>
                <p className="text-[11px] font-bold text-slate-600 leading-relaxed">영문 주소: <span className="text-indigo-900">{detailTarget.addressEn || '-'}</span></p>
              </div>
            </div>
          </div> 

          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between shadow-inner">
            <div>
              <label className="block text-sm font-black text-rose-900 mb-0.5">📦 명함 발주 최종 수량 (통)</label>
              <p className="text-[10px] text-rose-700 font-bold">인쇄소에 전달될 최종 제작 수량입니다. 수정이 필요할 경우 우측 폼에서 조정하세요.</p>
            </div>
            <div className="w-32">
              {isRequestEditing ? (
                <input type="number" min="1" value={requestEditForm?.quantity || 1} onChange={e => setRequestEditForm({...requestEditForm!, quantity: parseInt(e.target.value)})} className="w-full p-2.5 border-2 border-rose-400 rounded-xl bg-white text-rose-700 font-black text-base text-center outline-none focus:border-rose-600" />
              ) : (
                <div className="w-full p-2.5 bg-white border-2 border-rose-200 rounded-xl text-rose-600 font-black text-base text-center shadow-sm">{detailTarget.quantity || 1} 통</div>
              )}
            </div>
          </div>

          {isRequestEditing && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <label className="block text-xs font-black text-amber-900 mb-2">📝 발주 전 최종 수정 사유 (임직원 마이페이지에 표시됩니다) *</label>
              <input type="text" value={adminMemoInput} onChange={(e) => setAdminMemoInput(e.target.value)} placeholder="예: 직급 오기재 수정, 영문 성명 스펠링 최종 수정 등" className="w-full p-2.5 text-xs font-bold text-slate-800 border border-amber-300 rounded-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200" />
            </div>
          )}

          <div className="flex gap-2 justify-end pt-3 border-t border-slate-100 mt-2">
            {isRequestEditing ? (
              <>
                <button onClick={() => { setIsRequestEditing(false); setAdminMemoInput(''); }} className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-xl font-black text-xs hover:bg-slate-300 transition-colors">수정 취소</button>
                <button onClick={handleExecuteUpdate} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-black text-xs hover:bg-blue-700 transition-colors shadow-md">변경사항 DB 저장</button>
              </>
            ) : (
              <>
                <button onClick={() => setDetailTarget(null)} className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-black text-xs hover:bg-slate-200 transition-colors">닫기</button>
                <button onClick={() => { setIsRequestEditing(true); setRequestEditForm(detailTarget); setAdminMemoInput(detailTarget.adminMemo || ''); }} className="px-5 py-2.5 bg-amber-500 text-white rounded-xl font-black text-xs hover:bg-amber-600 transition-colors shadow-sm">✏️ 발주 전 직접 수정하기</button>
              </>
            )}
          </div>
        </div>
      </div>
    )}

    {/* 🚀 그룹웨어 발송용 메일 양식 미리보기 모달 */}
    {isEmailModalOpen && (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-2xl w-full p-8 space-y-6">
          <div className="border-b border-slate-100 pb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex-1">
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">📋 그룹웨어 발송용 메일 양식 미리보기</h2>
              <p className="text-xs text-slate-500 font-bold mt-2 leading-relaxed">수신 업체를 선택하면 본문이 자동으로 변경됩니다.<br/>복사 후 그룹웨어에 붙여넣으세요.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)} className="bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-black py-2.5 px-3 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 w-48 cursor-pointer">
                {vendors.filter(v => v.isActive).map(vendor => (
                  <option key={vendor.id} value={vendor.id}>{vendor.companyName} ({vendor.managerName})</option>
                ))}
                {vendors.filter(v => v.isActive).length === 0 && <option value="">등록된 업체 없음</option>}
              </select>
              <button onClick={() => setIsVendorModalOpen(true)} className="px-4 py-2.5 bg-slate-800 text-white font-black text-xs rounded-xl hover:bg-slate-900 transition-colors whitespace-nowrap shadow-sm">⚙️ 업체 관리</button>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5 ml-1">메일 제목 (클릭 시 자동 선택)</label>
              <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-800 select-all cursor-text">{getPreviewSubject()}</div>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5 ml-1">메일 본문 (클릭 시 자동 선택)</label>
              <textarea readOnly rows={8} value={getPreviewBody()} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 whitespace-pre-wrap resize-none focus:outline-none select-all cursor-text" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
            <button onClick={() => setIsEmailModalOpen(false)} className="px-5 py-2.5 bg-slate-100 font-black text-xs rounded-xl hover:bg-slate-200 text-slate-700 transition-colors">닫기</button>
            <button onClick={handleCopyToClipboard} className="px-6 py-2.5 bg-indigo-600 text-white font-black text-xs rounded-xl hover:bg-indigo-700 shadow-md transition-colors">📝 제목 및 본문 전체 복사하기</button>
          </div>
        </div>
      </div>
    )}

    {/* 🚀 외주업체 마스터 관리 모달 */}
    {isVendorModalOpen && (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-3xl w-full p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">⚙️ 외주업체 마스터 데이터 관리</h2>
              <p className="text-xs text-slate-500 font-bold mt-1">명함 조판 협력사 정보를 관리합니다. 과거 발주 이력 보존을 위해 삭제 대신 '비활성화'를 권장합니다.</p>
            </div>
            {vendorForm.id && <span className="bg-amber-100 text-amber-800 text-[11px] font-black px-3 py-1 rounded-lg animate-pulse">✏️ 현재 업체 정보 수정 중</span>}
          </div>

          <div className={`flex gap-2 items-end p-4 rounded-2xl border transition-all ${vendorForm.id ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex-1">
              <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">업체명</label>
              <input type="text" value={vendorForm.companyName || ''} onChange={e => setVendorForm({...vendorForm, companyName: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white" placeholder="예: 한생미디어" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">담당자명/직급</label>
              <input type="text" value={vendorForm.managerName || ''} onChange={e => setVendorForm({...vendorForm, managerName: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white" placeholder="예: 김태형 팀장" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-black text-slate-500 mb-1 ml-1">이메일</label>
              <input type="email" value={vendorForm.email || ''} onChange={e => setVendorForm({...vendorForm, email: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs font-bold outline-none bg-white" placeholder="print@..." />
            </div>
            <div className="flex gap-1">
              {vendorForm.id ? (
                <>
                  <button onClick={() => setVendorForm({ companyName: '', managerName: '', email: '', isActive: true })} className="px-3 py-2 h-[34px] bg-slate-200 text-slate-700 font-black text-xs rounded-lg hover:bg-slate-300">취소</button>
                  <button onClick={async () => {
                    if(!vendorForm.companyName) return alert('업체명을 입력하세요.');
                    try {
                      const res = await fetch('/api/asset/businesscard/master/vendors', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(vendorForm)
                      });
                      if (res.ok) {
                        const updated = await res.json();
                        setVendors(vendors.map(v => v.id === updated.id ? updated : v));
                        setVendorForm({ companyName: '', managerName: '', email: '', isActive: true });
                        alert("✅ 업체 정보가 성공적으로 수정되었습니다.");
                      }
                    } catch (e) { alert("수정 실패"); }
                  }} className="px-4 py-2 h-[34px] bg-amber-500 text-white font-black text-xs rounded-lg hover:bg-amber-600 shadow-sm">수정 완료</button>
                </>
              ) : (
                <button onClick={async () => {
                  if(!vendorForm.companyName) return alert('업체명을 입력하세요.');
                  try {
                    const res = await fetch('/api/asset/businesscard/master/vendors', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(vendorForm)
                    });
                    if (res.ok) {
                      const savedVendor = await res.json();
                      setVendors([savedVendor, ...vendors]);
                      setVendorForm({ companyName: '', managerName: '', email: '', isActive: true });
                    }
                  } catch (e) { alert("등록 실패"); }
                }} className="px-5 py-2 h-[34px] bg-indigo-600 text-white font-black text-xs rounded-lg hover:bg-indigo-700 shadow-sm">신규 등록</button>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-black tracking-widest sticky top-0">
                <tr>
                  <th className="p-3 pl-4">업체명</th>
                  <th className="p-3">담당자</th>
                  <th className="p-3">이메일</th>
                  <th className="p-3 text-center">상태</th>
                  <th className="p-3 text-center pr-4">제어 기능</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                {vendors.map(v => (
                  <tr key={v.id} className={`hover:bg-slate-50 ${!v.isActive ? 'opacity-50' : ''} ${vendorForm.id === v.id ? 'bg-amber-50/40' : ''}`}>
                    <td className="p-3 pl-4 font-black text-slate-900">{v.companyName}</td>
                    <td className="p-3">{v.managerName}</td>
                    <td className="p-3 font-mono text-slate-500">{v.email}</td>
                    <td className="p-3 text-center"><span className={`px-2 py-0.5 rounded text-[10px] ${v.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{v.isActive ? '사용중' : '미사용'}</span></td>
                    <td className="p-3 pr-4 text-center flex justify-center gap-1">
                      <button onClick={() => setVendorForm(v)} className="px-2.5 py-1 rounded-md text-[10px] border border-slate-300 bg-white text-slate-700 hover:bg-slate-100">✏️ 수정</button>
                      <button onClick={async () => {
                        const nextStatus = !v.isActive;
                        try {
                          const res = await fetch('/api/asset/businesscard/master/vendors', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...v, isActive: nextStatus })
                          });
                          if (res.ok) setVendors(vendors.map(item => item.id === v.id ? { ...item, isActive: nextStatus } : item));
                        } catch (e) { alert("상태 변경 실패"); }
                      }} className={`px-2.5 py-1 rounded-md text-[10px] border ${v.isActive ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>{v.isActive ? '비활성화' : '활성화'}</button>
                    </td>
                  </tr>
                ))}
                {vendors.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">등록된 업체가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button onClick={() => { setIsVendorModalOpen(false); setVendorForm({ companyName: '', managerName: '', email: '', isActive: true }); }} className="px-6 py-2.5 bg-slate-900 text-white font-black text-xs rounded-xl hover:bg-black transition-colors">닫기 및 적용</button>
          </div>
        </div>
      </div>
    )}

    {/* 🚀 견적 대조 업로드 및 분석 모달 */}
    {isCompareModalOpen && (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-3xl w-full p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">⚖️ 외주사 견적서(거래명세표) 교차 검증</h2>
              <p className="text-xs text-slate-500 font-bold mt-1">선택한 <strong className="text-indigo-600">{selectedBatchIds.size}개</strong>의 묶음(DB 데이터)과 업체의 문서(PDF/Excel)를 대조합니다.</p>
            </div>
            <button onClick={() => { setIsCompareModalOpen(false); setCompareResult({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] }); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black transition-colors">✕</button>
          </div>

          {/* 1. 업로드 대기 화면 */}
          {compareResult.status === 'idle' && (
            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50 rounded-2xl cursor-pointer transition-colors group relative overflow-hidden">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📄</span>
                <p className="mb-2 text-sm font-black text-indigo-700">여기를 클릭하여 엑셀(거래명세서) 업로드</p>
                <p className="text-xs text-indigo-400 font-bold">지원 양식: .xlsx, .xls (PDF는 현재 서버 작업 중)</p>
              </div>
              <input type="file" className="hidden" accept=".pdf, .xlsx, .xls" onChange={handleFileUpload} />
            </label>
          )}

          {/* 2. 분석 중 화면 */}
          {compareResult.status === 'analyzing' && (
            <div className="flex flex-col items-center justify-center h-48 space-y-4">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
              <p className="text-sm font-black text-indigo-800 animate-pulse">{compareResult.fileName} 문서를 해독하고 있습니다...</p>
            </div>
          )}

          {/* 3. 에러 화면 */}
          {compareResult.status === 'error' && (
            <div className="flex flex-col items-center justify-center h-48 space-y-4 bg-rose-50 rounded-2xl border border-rose-200">
              <span className="text-4xl">❌</span>
              <p className="text-sm font-black text-rose-800">문서 분석에 실패했습니다.</p>
              <div className="text-[10px] text-rose-500 font-mono text-center px-4">{compareResult.logs[compareResult.logs.length - 1]}</div>
            </div>
          )}

          {/* 🚀 4. 분석 완료 결과 화면 (4대 카테고리 검증 및 요약 설명판) */}
          {compareResult.status === 'success' && (
            <div className="space-y-4 animate-fade-in">
              {/* 상단 요약 바 */}
              <div className={`p-6 rounded-3xl border-2 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${compareResult.matched ? 'bg-emerald-50/80 border-emerald-200' : 'bg-rose-50/80 border-rose-200'}`}>
                <div className="flex-1">
                  <h3 className={`text-lg font-black flex items-center gap-2 ${compareResult.matched ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {compareResult.matched ? '✅ 3+1 조건부 교차 검증 완벽 일치' : '⚠️ 교차 검증 불일치 항목 감지'}
                  </h3>
                  
                  <div className="mt-2.5 space-y-3">
                    <p className={`text-xs font-bold leading-relaxed ${compareResult.matched ? 'text-emerald-700/80' : 'text-rose-700/80'}`}>
                      {compareResult.matched 
                        ? '문서 내에서 필수 3항목이 모두 확인되었으며, 동명이인 방지용 소속 검증까지 무사히 통과하여 최종 O(일치) 처리되었습니다.' 
                        : '문서에서 필수 항목을 찾을 수 없거나 수량이 다른 데이터가 발견되었습니다. 하단 표에서 상세 X 사유를 확인하세요.'}
                    </p>
                    
                    {/* 4가지 매칭 카테고리 시각화 뱃지 */}
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-tight ${compareResult.matched ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
                        {compareResult.matched ? '✔️ 품목명(명함)' : '❌ 품목 누락의심'}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-tight ${compareResult.matched ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
                        {compareResult.matched ? '✔️ 발주 성명 일치' : '❌ 성명 불일치'}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-tight ${compareResult.matched ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-white border-rose-200 text-rose-500'}`}>
                        {compareResult.matched ? '✔️ 최종 수량 일치' : '❌ 수량 오차발생'}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-tight ${compareResult.matched ? 'bg-white border-emerald-300 text-emerald-600 shadow-sm' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                        ✔️ 소속 (동명이인 식별용)
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="text-right md:ml-4 shrink-0 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-[10px] text-slate-500 font-bold mb-1">인식된 총 청구 금액</p>
                  <p className="text-2xl font-black text-slate-900 font-mono">₩{compareResult.docTotalPrice.toLocaleString()}</p>
                </div>
              </div>

              {/* 상세 매칭 결과 리스트 */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-56 overflow-y-auto shadow-inner">
                <table className="w-full text-left text-xs sticky top-0">
                  <thead className="bg-slate-100 text-slate-600 font-black">
                    <tr>
                      <th className="p-3.5 pl-5">임직원명 (소속)</th>
                      <th className="p-3.5 text-center w-24">DB 수량</th>
                      <th className="p-3.5 text-center w-28">문서 인식 수량</th>
                      <th className="p-3.5 text-center w-56">판별 결과 상세</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold">
                    {compareResult.details.map((detail, idx) => (
                      <tr key={idx} className={detail.matchStatus === 'match' ? 'bg-white' : 'bg-rose-50/60'}>
                        <td className="p-3.5 pl-5 text-slate-800">
                          {detail.name} <span className="text-[10px] text-slate-400 font-normal">({detail.dept})</span>
                        </td>
                        <td className="p-3.5 text-center text-indigo-600 font-mono">{detail.dbQty}</td>
                        <td className="p-3.5 text-center text-slate-600 font-mono">{detail.docQty}</td>
                        <td className="p-3.5 text-center text-[11px]">
                          {detail.matchStatus === 'match' && <span className="text-emerald-600">✅ 통과 (필수 3항목 완벽 일치)</span>}
                          {detail.matchStatus === 'mismatch' && <span className="text-amber-600">⚠️ 수량 다름 (이름은 발견됨)</span>}
                          {detail.matchStatus === 'missing' && <span className="text-rose-600">❌ 누락 (이름/품목 또는 소속 다름)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 로그 창 */}
              <div className="bg-slate-900 rounded-xl p-4 font-mono text-[10px] text-emerald-400 h-28 overflow-y-auto space-y-1.5 shadow-inner">
                {compareResult.logs.map((log, i) => <p key={i}>$ {log}</p>)}
              </div>
            </div>
          )}
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button onClick={() => { setIsCompareModalOpen(false); setCompareResult({ status: 'idle', dbTotalQty: 0, docTotalQty: 0, docTotalPrice: 0, matched: false, fileName: '', logs: [], details: [] }); }} className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl transition-colors">닫기</button>
          </div>
        </div>
      </div>
    )}
  </div>
);
}