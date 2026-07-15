'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { useRouter } from 'next/navigation';
import Link from 'next/link'; // 🚀 이 줄을 추가합니다!
import { getKSTDateString } from '@/utils/dateUtils';

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
  adminStatus: string; // 🚀 5단계 확장을 위해 string으로 유연성 확보
  isModifiedByAdmin?: boolean; 
  adminMemo?: string | null;   
  quantity: number;
  isArchived?: boolean; // 🚀 [추가] 보관함 이동 여부 판별기
}

interface AddressMaster {
  id: string;
  label: string;
  zipCode: string;
  addressKo: string;
  addressEn: string;
  fax: string;
  faxEn: string;
  isActive: boolean;
}

const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);

export default function BusinessCardRequestPanel() {
  const router = useRouter(); 
  const [requests, setRequests] = useState<RequestHistory[]>([]);
  const [loading, setLoading] = useState(true);

  // 🚀 [수정] 5분할 공정 파이프라인 뷰 모드
  const [viewMode, setViewMode] = useState<'ALL' | 'PENDING' | 'ACCEPTED' | 'ORDERED' | 'DISTRIBUTED'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailTarget, setDetailTarget] = useState<RequestHistory | null>(null);

  const [isRequestEditing, setIsRequestEditing] = useState(false);
  const [requestEditForm, setRequestEditForm] = useState<RequestHistory | null>(null);
  const [adminMemoInput, setAdminMemoInput] = useState('');

  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [addresses, setAddresses] = useState<AddressMaster[]>([]); 
  const [newAddress, setNewAddress] = useState<Partial<AddressMaster>>({});
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [editAddressForm, setEditAddressForm] = useState<Partial<AddressMaster>>({});

  const [isQualModalOpen, setIsQualModalOpen] = useState(false);
  const [qualifications, setQualifications] = useState<any[]>([]);
  const [newQual, setNewQual] = useState({ nameKo: '', nameEn: '' });
  const [editingQualId, setEditingQualId] = useState<string | null>(null);
  const [editQualForm, setEditQualForm] = useState({ nameKo: '', nameEn: '' });

  const fetchAddresses = async () => {
    const res = await fetch(`/api/asset/businesscard/master/addresses?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) setAddresses(await res.json());
  };

  const fetchQualifications = async () => {
    const res = await fetch(`/api/asset/businesscard/master/qualifications?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) setQualifications(await res.json());
  };

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/asset/businesscard/master/requests?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      }
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    fetchAddresses(); 
    fetchQualifications(); 
  }, []);

  // 🚀 [핵심] 보관함으로 간 데이터(isArchived)는 메인 리스트에서 원천 차단!
  const activeRequests = requests.filter(r => !r.isArchived);

  // 🚀 5분할 통계 카운터 세분화
  const counts = {
    all: activeRequests.length,
    pending: activeRequests.filter(r => r.adminStatus === '대기중').length,
    accepted: activeRequests.filter(r => r.adminStatus === '접수완료').length,
    ordered: activeRequests.filter(r => r.adminStatus === '발주완료').length,
    distributed: activeRequests.filter(r => r.adminStatus === '지급완료').length,
  };

  // 현재 선택된 뷰 모드에 따른 리스트 필터링
  const filteredRequests = activeRequests.filter(r => {
    if (viewMode === 'ALL') return true;
    if (viewMode === 'PENDING') return r.adminStatus === '대기중';
    if (viewMode === 'ACCEPTED') return r.adminStatus === '접수완료';
    if (viewMode === 'ORDERED') return r.adminStatus === '발주완료';
    if (viewMode === 'DISTRIBUTED') return r.adminStatus === '지급완료';
    return true;
  });
  
  const totalPages = Math.ceil(filteredRequests.length / itemsPerPage) || 1;
  const paginatedRequests = filteredRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allPageIds = paginatedRequests.map(r => r.id);
      setSelectedIds(new Set([...selectedIds, ...allPageIds]));
    } else {
      const nextSet = new Set(selectedIds);
      paginatedRequests.forEach(r => nextSet.delete(r.id));
      setSelectedIds(nextSet);
    }
  };

  const handleSelectRow = (id: string) => {
    const nextSet = new Set(selectedIds);
    if (nextSet.has(id)) nextSet.delete(id);
    else nextSet.add(id);
    setSelectedIds(nextSet);
  };

  const handleExcelDownload = () => {
    const targets = requests.filter(r => selectedIds.has(r.id));
    if (targets.length === 0) return alert('⚠️ 다운로드할 행을 체크박스로 선택해 주세요.');

    const excelData = targets.map((r) => ({
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
    XLSX.utils.book_append_sheet(wb, ws, "명함신청데이터");
    XLSX.writeFile(wb, `명함발주데이터_${getKSTDateString()}.xlsx`);
  };

  const handleApprove = async (id: string, postNumber: string) => {
    if (!confirm(`[${postNumber}] 접수 완료 처리하시겠습니까?`)) return;
    const todayStr = getKSTDateString();
    try {
      const res = await fetch(`/api/asset/businesscard/master/requests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, adminStatus: '접수완료', processDate: todayStr })
      });
      if (res.ok) {
        alert("✅ 조판 대기 대장으로 성공적으로 이관되었습니다.");
        fetchRequests();
      }
    } catch (err) {
      alert("서버 연결 실패");
    }
  };

  const handleSaveRequestPayload = async () => {
    if (!requestEditForm) return;
    if (!adminMemoInput.trim()) return alert('⚠️ 변경 이력 관리를 위해 하단에 [수정 사유]를 반드시 입력해 주세요.');

    try {
      const res = await fetch('/api/asset/businesscard/master/requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestEditForm,
          isModifiedByAdmin: true,
          adminMemo: adminMemoInput,
          adminModifierName: "관리자",
          adminModifiedAt: new Date().toISOString(),
          isFormPayload: true
        })
      });

      if (res.ok) {
        alert("💾 원문 정보가 수정되었으며 변경 이력이 등록되었습니다.");
        setIsRequestEditing(false);
        setDetailTarget(null);
        setAdminMemoInput(''); 
        fetchRequests(); 
      } else {
        const errorText = await res.text();
        alert(`❌ 서버 처리 실패: ${errorText}`);
      }
    } catch (err) {
      alert("📡 수정 데이터 전송 중 네트워크 오류가 발생했습니다.");
    }
  };

  const toggleAddressActive = async (id: string) => {
    const target = addresses.find(a => a.id === id);
    if (!target) return;
    await fetch('/api/asset/businesscard/master/addresses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !target.isActive })
    });
    fetchAddresses(); 
  };

  const saveNewAddress = async () => {
    if (!newAddress.label || !newAddress.addressKo) return alert('필수 정보(선택지명, 주소)를 입력하세요.');
    await fetch('/api/asset/businesscard/master/addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newAddress, isActive: true })
    });
    setNewAddress({});
    fetchAddresses(); 
    alert("✅ 공통 주소지가 등록되었습니다.");
  };

  const executeUpdateAddress = async () => {
    if (!editAddressForm.label || !editAddressForm.addressKo) return alert('필수 입력 누락');
    const res = await fetch('/api/asset/businesscard/master/addresses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editAddressForm)
    });
    if (res.ok) {
      setEditingAddressId(null);
      fetchAddresses();
    }
  };

  const executeDeleteAddress = async (id: string, label: string) => {
    if (!confirm(`⚠️ [${label}] 주소 설정을 영구 삭제하시겠습니까?`)) return;
    const res = await fetch(`/api/asset/businesscard/master/addresses?id=${id}`, { method: 'DELETE' });
    if (res.ok) fetchAddresses();
  };

  const toggleQualActive = async (id: string) => {
    const target = qualifications.find(q => q.id === id);
    if (!target) return;
    await fetch('/api/asset/businesscard/master/qualifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !target.isActive })
    });
    fetchQualifications();
  };

  const saveNewQual = async () => {
    if (!newQual.nameKo || !newQual.nameEn) return alert('국문과 영문 명칭을 모두 입력하세요.');
    await fetch('/api/asset/businesscard/master/qualifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nameKo: newQual.nameKo, nameEn: newQual.nameEn, isActive: true })
    });
    setNewQual({ nameKo: '', nameEn: '' });
    fetchQualifications();
    alert("✅ 신규 자격사항이 등록되었습니다.");
  };

  const executeUpdateQual = async (id: string) => {
    if (!editQualForm.nameKo || !editQualForm.nameEn) return alert('필수 명칭 누락');
    const res = await fetch('/api/asset/businesscard/master/qualifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...editQualForm })
    });
    if (res.ok) {
      setEditingQualId(null);
      fetchQualifications();
    }
  };

  const executeDeleteQual = async (id: string, nameKo: string) => {
    if (!confirm(`⚠️ [${nameKo}] 자격 단어를 영구 삭제하시겠습니까?`)) return;
    const res = await fetch(`/api/asset/businesscard/master/qualifications?id=${id}`, { method: 'DELETE' });
    if (res.ok) fetchQualifications();
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* 🚀 전사 명함 발주 접수 통제 대장 (최상위 관리자 모드 - 딥 그린 테마 & 140px 표준 규격) */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[140px]">
  
  <div className="relative z-10 flex justify-between items-end w-full">
    <div>
      {/* 1. 상단 라벨 (mb-3 간격 및 딥 그린에 어울리는 에메랄드 포인트 라벨) */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">
        BUSINESS CARD TOTAL GOVERNANCE
      </h3>
      
      {/* 2. 메인 타이틀 (2xl 규격 통일 및 선명한 가독성 확보) */}
      <h1 className="text-2xl font-black tracking-tight text-white leading-none">
        전사 임직원 명함 발주 접수 통제 대장
      </h1>
      
      {/* 3. 하단 설명 (mt-4 간격 표준화 및 소프트 텍스트 처리) */}
      <p className="text-emerald-100/90 text-xs font-semibold mt-4 opacity-90">
        임직원이 신청한 명함의 국/영문 원본 조판 텍스트 데이터를 검수하고 외주 조판 공정으로 이관 제어하는 마스터 컨트롤 허브입니다.
      </p>
    </div>
  </div>

  {/* 우측 은은한 엠블럼 효과 (통제 타워 느낌 연출) */}
  <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
    📟
  </div>
</div>

{/* 🚀 URL 기반 동적 활성화 탭 네비게이션 */}
<div className="bg-slate-100 p-2 rounded-3xl flex gap-2 max-w-max border border-slate-200/50 shadow-inner">
  <button 
    type="button" 
    onClick={() => router.push('/asset/businesscard/master/requests')}
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/requests')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📋 사용자 신청현황 관리
  </button>
  
  <button 
    type="button" 
    onClick={() => router.push('/asset/businesscard/master/order')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/order')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📦 외주 발주 관리/견적 비교
  </button>
  
  <button 
    type="button" 
    onClick={() => router.push('/asset/businesscard/master/archive')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/archive')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📁 정산 완료 보관함
  </button>
</div>

     {/* 🚀 5분할 공정 파이프라인 네비게이션 대시보드 */}
     <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* 1. 전체건 */}
        <div onClick={() => { setViewMode('ALL'); setCurrentPage(1); setSelectedIds(new Set()); }}
          className={`p-5 rounded-[2rem] cursor-pointer transition-all border border-slate-200 flex flex-col justify-center ${viewMode === 'ALL' ? 'bg-slate-900 text-white shadow-md scale-[1.02]' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          <span className="text-[9px] font-black tracking-widest uppercase opacity-60">TOTAL ACTIVE</span>
          <div className="flex justify-between items-baseline mt-1">
            <span className="text-xl font-black">{counts.all}</span><span className="text-[11px] font-bold">전체건</span>
          </div>
        </div>

        {/* 2. 대기중 */}
        <div onClick={() => { setViewMode('PENDING'); setCurrentPage(1); setSelectedIds(new Set()); }}
          className={`p-5 rounded-[2rem] cursor-pointer transition-all border border-slate-200 flex flex-col justify-center ${viewMode === 'PENDING' ? 'bg-blue-600 text-white shadow-md scale-[1.02]' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          <span className="text-[9px] font-black tracking-widest uppercase opacity-60">PENDING</span>
          <div className="flex justify-between items-baseline mt-1">
            <span className={`text-xl font-black ${viewMode === 'PENDING' ? 'text-white' : 'text-blue-500'}`}>{counts.pending}</span><span className="text-[11px] font-bold">대기중</span>
          </div>
        </div>

        {/* 3. 접수완료 */}
        <div onClick={() => { setViewMode('ACCEPTED'); setCurrentPage(1); setSelectedIds(new Set()); }}
          className={`p-5 rounded-[2rem] cursor-pointer transition-all border border-slate-200 flex flex-col justify-center ${viewMode === 'ACCEPTED' ? 'bg-indigo-600 text-white shadow-md scale-[1.02]' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          <span className="text-[9px] font-black tracking-widest uppercase opacity-60">ACCEPTED</span>
          <div className="flex justify-between items-baseline mt-1">
            <span className={`text-xl font-black ${viewMode === 'ACCEPTED' ? 'text-white' : 'text-indigo-500'}`}>{counts.accepted}</span><span className="text-[11px] font-bold">접수완료</span>
          </div>
        </div>

        {/* 4. 발주완료 */}
        <div onClick={() => { setViewMode('ORDERED'); setCurrentPage(1); setSelectedIds(new Set()); }}
          className={`p-5 rounded-[2rem] cursor-pointer transition-all border border-slate-200 flex flex-col justify-center ${viewMode === 'ORDERED' ? 'bg-emerald-600 text-white shadow-md scale-[1.02]' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          <span className="text-[9px] font-black tracking-widest uppercase opacity-60">ORDERED</span>
          <div className="flex justify-between items-baseline mt-1">
            <span className={`text-xl font-black ${viewMode === 'ORDERED' ? 'text-white' : 'text-emerald-500'}`}>{counts.ordered}</span><span className="text-[11px] font-bold">발주완료</span>
          </div>
        </div>

        {/* 5. 지급완료 */}
        <div onClick={() => { setViewMode('DISTRIBUTED'); setCurrentPage(1); setSelectedIds(new Set()); }}
          className={`p-5 rounded-[2rem] cursor-pointer transition-all border border-slate-200 flex flex-col justify-center ${viewMode === 'DISTRIBUTED' ? 'bg-purple-600 text-white shadow-md scale-[1.02]' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          <span className="text-[9px] font-black tracking-widest uppercase opacity-60">DISTRIBUTED</span>
          <div className="flex justify-between items-baseline mt-1">
            <span className={`text-xl font-black ${viewMode === 'DISTRIBUTED' ? 'text-white' : 'text-purple-500'}`}>{counts.distributed}</span><span className="text-[11px] font-bold">지급완료</span>
          </div>
        </div>
      </div>
    

     <div className="flex justify-end gap-2 mb-2">
        <button onClick={() => setIsQualModalOpen(true)} className="px-5 py-2.5 bg-indigo-700 text-white font-black text-xs rounded-xl hover:bg-indigo-800 transition-colors shadow-sm flex items-center gap-2">
          🎓 자격사항 표준단어 (국/영문) 관리
        </button>
        <button onClick={() => setIsAddressModalOpen(true)} className="px-5 py-2.5 bg-slate-800 text-white font-black text-xs rounded-xl hover:bg-slate-700 transition-colors shadow-sm flex items-center gap-2">
          ⚙️ 시스템 공통선택지 (주소/팩스) 관리
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <HeaderLight 
          title={
            viewMode === 'PENDING' ? '신규 명함 신청 검수 대기열' : 
            viewMode === 'ACCEPTED' ? '조판 데이터 확인 완료 목록 (접수완료)' :
            viewMode === 'ORDERED' ? '외주 인쇄소 발주 진행중 목록' :
            viewMode === 'DISTRIBUTED' ? '현물 지급 완료 목록 (보관함 이동 대기중)' :
            '전체 진행중 내역 대장 (보관함 제외)'
          } 
          count={filteredRequests.length}
        >
          <button onClick={handleExcelDownload} className="text-[10px] font-black bg-blue-600 text-white border border-blue-600 rounded-lg px-4 py-1.5 hover:bg-blue-700 transition-colors shadow-sm">
            선택 데이터 엑셀 다운로드
          </button>
        </HeaderLight>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-6 w-[50px]">
                  <input type="checkbox" onChange={handleSelectAll} checked={paginatedRequests.length > 0 && paginatedRequests.every(r => selectedIds.has(r.id))} className="rounded text-blue-600 focus:ring-blue-500" />
                </th>
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
              {paginatedRequests.map((row, index) => {
                const globalIndex = (currentPage - 1) * itemsPerPage + index + 1;
                const isPending = row.adminStatus === '대기중';
                
                const statusClass = 
                  row.adminStatus === '지급완료' ? 'bg-purple-100 text-purple-800' :
                  row.adminStatus === '발주완료' ? 'bg-emerald-100 text-emerald-800' :
                  row.adminStatus === '접수완료' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800';

                return (
                  <tr key={row.id} className="h-16 hover:bg-slate-50/50 transition-colors">
                    <td className="pl-6">
                      <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => handleSelectRow(row.id)} className="rounded text-blue-600 focus:ring-blue-500" />
                    </td>
                    <td className="px-3 font-mono text-slate-400">{globalIndex}</td>
                    <td className="px-3 font-mono text-indigo-600">{row.postNumber}</td>
                    <td className="px-3 text-slate-400 font-mono">{row.applyDate}</td>
                    <td className="px-4"><span className="font-black text-slate-900">{row.deptHead}</span>{row.deptName && <span className="text-slate-400 font-normal ml-1">({row.deptName})</span>}</td>
                    <td className="px-4 font-black text-slate-900">{row.userName}</td>
                    <td className="px-4 font-medium text-slate-500">{row.title}</td>
                    <td className="px-4 text-center">
                      <button type="button" onClick={() => setDetailTarget(row)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-black rounded-lg transition-colors border border-slate-200">
                        신청원문검수 🔎
                      </button>
                    </td>
                    <td className="px-2 text-center text-rose-600 font-black">{row.quantity || 1}</td>
                    <td className="px-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full font-black text-[10px] ${statusClass}`}>{row.adminStatus}</span>
                    </td>
                    <td className="pr-6 text-center">
                      {isPending ? (
                        <button type="button" onClick={() => handleApprove(row.id, row.postNumber)} className="px-3 py-1.5 bg-slate-900 text-white text-[11px] font-black rounded-lg hover:bg-black transition-colors">
                          접수 완료
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-normal italic">이관/완료됨 🔒</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredRequests.length === 0 && (
                <tr className="h-16">
                  <td colSpan={11} className="text-center font-black text-slate-400 text-xs py-10 bg-slate-50/50">
                    표시할 명함 데이터가 존재하지 않습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
          </div>
        )}
      </div>

{/* 🚀 상세 뷰 모달 (관리자 직접 인라인 수정 및 이력 컴포넌트 탑재) */}
{detailTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            
            {/* 헤더 구역 */}
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black text-blue-600 font-mono tracking-widest">
                  {isRequestEditing ? '⚡ 원문 편집 모드 활성화' : '🔎 원문 검수 모드'}
                </span>
                <h2 className="text-base font-black text-slate-900 mt-1">
                  명함 신청 데이터 세부 검수창 ({detailTarget.userName} 님)
                </h2>
              </div>
              <button onClick={() => { setDetailTarget(null); setIsRequestEditing(false); }} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black text-sm transition-colors">✕</button>
            </div>

            {/* 경고 배너 */}
            {detailTarget.isModifiedByAdmin && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-bold">
                ⚠️ 주의: 이 신청서는 관리자에 의해 이미 한 번 수정된 이력이 있습니다. (사유: {detailTarget.adminMemo})
              </div>
            )}

            {/* 1. 국/영문 조판 데이터 2단 그리드 구역 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              
              {/* 국문 영역 (좌측) */}
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

              {/* 영문 영역 (우측) */}
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

            {/* 2. 발주 수량 컨트롤러 구역 */}
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

            {/* 정보 수정 모드 관리자 메모 */}
            {isRequestEditing && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <label className="block text-xs font-black text-amber-900 mb-2">📝 수정 사유 (임직원 마이페이지에 표시됩니다) *</label>
                <input type="text" value={adminMemoInput} onChange={(e) => setAdminMemoInput(e.target.value)} placeholder="예: 직급 오기재 수정, 영문 성명 스펠링 수정 등" className="w-full p-2.5 text-xs font-bold text-slate-800 border border-amber-300 rounded-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200" />
              </div>
            )}

            {/* 하단 버튼 구역 */}
            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100 mt-2">
              {isRequestEditing ? (
                <>
                  <button onClick={() => { setIsRequestEditing(false); setAdminMemoInput(''); }} className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-xl font-black text-xs hover:bg-slate-300 transition-colors">수정 취소</button>
                  <button onClick={handleSaveRequestPayload} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-black text-xs hover:bg-blue-700 transition-colors shadow-md">변경사항 DB 저장</button>
                </>
              ) : (
                <>
                  <button onClick={() => setDetailTarget(null)} className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-black text-xs hover:bg-slate-200 transition-colors">닫기</button>
                  {detailTarget.adminStatus === '대기중' && (
                    <>
                      <button onClick={() => { setIsRequestEditing(true); setRequestEditForm(detailTarget); setAdminMemoInput(''); }} className="px-5 py-2.5 bg-amber-500 text-white rounded-xl font-black text-xs hover:bg-amber-600 transition-colors shadow-sm">✏️ 정보 직접 수정하기</button>
                      <button onClick={() => { handleApprove(detailTarget.id, detailTarget.postNumber); setDetailTarget(null); }} className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-black transition-colors shadow-md">데이터 검수 승인 (접수 완료)</button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🚀 자격사항 및 주소 마스터 모달 (기존 동일 유지) */}
      {isQualModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-base font-black text-slate-900">🎓 명함 전용 자격사항 (국/영문) 단어장 관리</h2>
              <button onClick={() => setIsQualModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 font-black text-sm">✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div>
                <h3 className="text-xs font-black text-slate-800 mb-3 tracking-widest uppercase">등록된 자격사항 매핑 목록</h3>
                <div className="space-y-2">
                  {qualifications.map(q => (
                    <div key={q.id} className={`p-3 border rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-2 transition-colors ${q.isActive ? 'border-indigo-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                      {editingQualId === q.id ? (
                        <div className="flex flex-1 gap-2 w-full">
                          <input type="text" value={editQualForm.nameKo} onChange={e => setEditQualForm({...editQualForm, nameKo: e.target.value})} className="border p-1 text-xs rounded font-bold w-1/2" placeholder="국문명" />
                          <input type="text" value={editQualForm.nameEn} onChange={e => setEditQualForm({...editQualForm, nameEn: e.target.value})} className="border p-1 text-xs rounded font-bold w-1/2" placeholder="영문명" />
                        </div>
                      ) : (
                        <div className="flex gap-4 items-center flex-1">
                          <span className={`text-xs font-black w-32 ${q.isActive ? 'text-indigo-700' : 'text-slate-400'}`}>{q.nameKo}</span>
                          <span className="text-slate-300 font-light">|</span>
                          <span className={`text-[11px] font-bold ${q.isActive ? 'text-slate-700' : 'text-slate-400'}`}>{q.nameEn}</span>
                          {!q.isActive && <span className="ml-2 text-[9px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded">미사용</span>}
                        </div>
                      )}
                      <div className="flex items-center gap-1 w-full md:w-auto justify-end">
                        {editingQualId === q.id ? (
                          <>
                            <button onClick={() => executeUpdateQual(q.id)} className="px-2 py-1 bg-emerald-600 text-white font-black text-[10px] rounded hover:bg-emerald-700">저장</button>
                            <button onClick={() => setEditingQualId(null)} className="px-2 py-1 bg-slate-200 text-slate-600 font-black text-[10px] rounded hover:bg-slate-300">취소</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingQualId(q.id); setEditQualForm({ nameKo: q.nameKo, nameEn: q.nameEn }); }} className="px-2 py-1 bg-white border border-slate-300 text-slate-700 font-black text-[10px] rounded hover:bg-slate-50">수정</button>
                            <button onClick={() => toggleQualActive(q.id)} className={`px-2 py-1 border text-[10px] font-black rounded ${q.isActive ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50' : 'bg-slate-800 border-slate-800 text-white hover:bg-slate-700'}`}>{q.isActive ? '중단' : '사용'}</button>
                            <button onClick={() => executeDeleteQual(q.id, q.nameKo)} className="px-2 py-1 bg-rose-50 border border-rose-200 text-rose-600 font-black text-[10px] rounded hover:bg-rose-100">삭제</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {qualifications.length === 0 && <p className="text-xs text-slate-400 text-center py-4">등록된 자격사항 단어가 없습니다.</p>}
                </div>
              </div>

              <div className="p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-4">
                <h3 className="text-xs font-black text-indigo-900 tracking-widest uppercase">➕ 신규 자격사항(국/영문 대칭) 등록</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">국문 자격명</label>
                    <input type="text" value={newQual.nameKo} onChange={e => setNewQual({...newQual, nameKo: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">영문 자격명</label>
                    <input type="text" value={newQual.nameEn} onChange={e => setNewQual({...newQual, nameEn: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                </div>
                <button onClick={saveNewQual} className="w-full py-3 bg-indigo-600 text-white font-black text-xs rounded-xl shadow-sm hover:bg-indigo-700 transition-colors">위 설정으로 단어장에 등록하기</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddressModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-base font-black text-slate-900">⚙️ 전사 공통 주소지 및 팩스번호 설정</h2>
              <button onClick={() => setIsAddressModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 font-black text-sm">✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div>
                <h3 className="text-xs font-black text-slate-800 mb-3 tracking-widest uppercase">등록된 공통 선택지 목록</h3>
                <div className="space-y-3">
                  {addresses.map(a => (
                    <div key={a.id} className={`p-4 border rounded-2xl flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 transition-colors ${a.isActive ? 'border-slate-300 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                      {editingAddressId === a.id ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1">
                          <input type="text" value={editAddressForm.label || ''} onChange={e => setEditAddressForm({...editAddressForm, label: e.target.value})} className="border p-1 text-xs rounded font-bold" placeholder="선택지명" />
                          <input type="text" value={editAddressForm.zipCode || ''} onChange={e => setEditAddressForm({...editAddressForm, zipCode: e.target.value})} className="border p-1 text-xs rounded font-mono" placeholder="우편번호" />
                          <input type="text" value={editAddressForm.addressKo || ''} onChange={e => setEditAddressForm({...editAddressForm, addressKo: e.target.value})} className="border p-1 text-xs rounded md:col-span-2" placeholder="국문 주소" />
                          <input type="text" value={editAddressForm.addressEn || ''} onChange={e => setEditAddressForm({...editAddressForm, addressEn: e.target.value})} className="border p-1 text-xs rounded md:col-span-2" placeholder="영문 주소" />
                          <input type="text" value={editAddressForm.fax || ''} onChange={e => setEditAddressForm({...editAddressForm, fax: e.target.value})} className="border p-1 text-xs rounded font-mono" placeholder="국문 팩스" />
                          <input type="text" value={editAddressForm.faxEn || ''} onChange={e => setEditAddressForm({...editAddressForm, faxEn: e.target.value})} className="border p-1 text-xs rounded font-mono" placeholder="영문 팩스" />
                        </div>
                      ) : (
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-black ${a.isActive ? 'text-blue-700' : 'text-slate-400'}`}>{a.label}</span>
                            {!a.isActive && <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded">미사용</span>}
                          </div>
                          <p className="text-[11px] text-slate-600 font-bold">[{a.zipCode}] {a.addressKo}</p>
                          <p className="text-[11px] text-slate-400 leading-normal">{a.addressEn}</p>
                          <p className="text-[11px] font-mono text-slate-500">Fax: {a.fax} / En Fax: {a.faxEn}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-1 md:flex-col justify-end min-w-[80px]">
                        {editingAddressId === a.id ? (
                          <>
                            <button onClick={executeUpdateAddress} className="w-full py-1 bg-emerald-600 text-white font-black text-[10px] rounded hover:bg-emerald-700">저장</button>
                            <button onClick={() => setEditingAddressId(null)} className="w-full py-1 bg-slate-200 text-slate-600 font-black text-[10px] rounded hover:bg-slate-300">취소</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingAddressId(a.id); setEditAddressForm(a); }} className="w-full py-1 bg-white border border-slate-300 text-slate-700 font-black text-[10px] rounded hover:bg-slate-50">수정</button>
                            <button onClick={() => toggleAddressActive(a.id)} className={`w-full py-1 border text-[10px] font-black rounded ${a.isActive ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50' : 'bg-slate-800 border-slate-800 text-white hover:bg-slate-700'}`}>{a.isActive ? '중단' : '사용'}</button>
                            <button onClick={() => executeDeleteAddress(a.id, a.label)} className="w-full py-1 bg-rose-50 border border-rose-200 text-rose-600 font-black text-[10px] rounded hover:bg-rose-100">삭제</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                <h3 className="text-xs font-black text-slate-800 tracking-widest uppercase">➕ 신규 선택지(주소/팩스) 등록</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">선택지명 (예: 부산지사)</label>
                    <input type="text" value={newAddress.label || ''} onChange={e => setNewAddress({...newAddress, label: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">우편번호</label>
                    <input type="text" value={newAddress.zipCode || ''} onChange={e => setNewAddress({...newAddress, zipCode: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs font-mono" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">국문 상세 주소</label>
                    <input type="text" value={newAddress.addressKo || ''} onChange={e => setNewAddress({...newAddress, addressKo: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">영문 상세 주소</label>
                    <input type="text" value={newAddress.addressEn || ''} onChange={e => setNewAddress({...newAddress, addressEn: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">팩스 번호 (국문)</label>
                    <input type="text" value={newAddress.fax || ''} onChange={e => setNewAddress({...newAddress, fax: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs font-mono" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">팩스 번호 (영문)</label>
                    <input type="text" value={newAddress.faxEn || ''} onChange={e => setNewAddress({...newAddress, faxEn: e.target.value})} className="w-full p-2 border border-slate-200 rounded text-xs font-mono" />
                  </div>
                </div>
                <button onClick={saveNewAddress} className="w-full mt-2 py-3 bg-blue-600 text-white font-black text-xs rounded-xl shadow-sm hover:bg-blue-700 transition-colors">위 설정으로 공통 주소지 등록하기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}