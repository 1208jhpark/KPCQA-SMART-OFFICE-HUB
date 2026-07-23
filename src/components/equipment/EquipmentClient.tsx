'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; // 🚀 중복 임포트 원천 제거 완료
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import { getKSTDateString, getKSTDaysUntil, getKSTNowYearMonth, parseKSTDateOnly } from '@/utils/dateUtils';
import { buildEquipmentImagePayload } from '@/utils/equipmentImage';
import {
  addMonthsToCalibYmd,
  pickLatestCalibHistory,
  resolveCalibSchedule,
  toCalibYmd,
} from '@/utils/equipmentCalib';
import EquipmentQrImage from '@/components/equipment/EquipmentQrImage';
import { generateEquipmentQrDataUrls } from '@/utils/equipmentQr';

/** 검교정 결과상태 — 레거시 합격/불합격 → 적합/부적합 */
const CALIB_RESULT_LABEL: Record<string, string> = {
  진행중: '진행중',
  적합: '적합',
  부적합: '부적합',
  합격: '적합',
  불합격: '부적합',
};
function normalizeCalibResult(raw: string | null | undefined) {
  if (!raw) return '진행중';
  return CALIB_RESULT_LABEL[raw] || raw;
}

// 🚀 전사 표준: 공통 Header 컴포넌트
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    <div className="flex items-center gap-2">
      {children}
    </div>
  </div>
);

export default function EquipmentClient({ categoryId, tabId, currentUser, masterDataList, permission }: any) {
  const router = useRouter();
  const searchParams = useSearchParams(); // 🚀 대시보드 꼬리표 링크 캐치 훅
  
  // =========================================================================
  // 💡 Data States & Logic
  // =========================================================================
  const [equipments, setEquipments] = useState<any[]>([]);
  const [archives, setArchives] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [historyPage, setHistoryPage] = useState(1);
  const historyItemsPerPage = 5;
  const [archivePage, setArchivePage] = useState(1); 
  
  const [selectedEq, setSelectedEq] = useState<any>(null);
  const [activeSubTab, setActiveSubTab] = useState<'CALIB' | 'PRODUCT'>('CALIB');
  const [showQrModal, setShowQrModal] = useState<any>(null);
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  
  const [selectedMainIds, setSelectedMainIds] = useState<Set<string>>(new Set());
  const [bulkPrintAssets, setBulkPrintAssets] = useState<any[]>([]);
  const [bulkQrMap, setBulkQrMap] = useState<Record<string, string>>({});
  const [bulkQrReady, setBulkQrReady] = useState(false);
  
  const [showAddHistoryModal, setShowAddHistoryModal] = useState(false);
  const [historyFormData, setHistoryFormData] = useState<any>({
    calib_request_date: '', calib_date: '', content: '', cost: '', agency: '', result: '진행중', estimate_url: '', cert_file_url: ''
  });
  const [selectedHistories, setSelectedHistories] = useState<Set<string>>(new Set());
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<any>(null);
  const [isEditingHistory, setIsEditingHistory] = useState(false);
  
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveFormData, setArchiveFormData] = useState({ qty: 1, reason: '', status: '폐기' });
  const [archiveYear, setArchiveYear] = useState('ALL'); 

  // 🚀 어드민 거버넌스 룰에 맞춘 아이템 레벨 정밀 편집 권한 체커
  const checkItemCanEdit = (eq: any) => {
    if (!permission?.isEditor) return false; // 기본 에디터 권한 없으면 즉시 차단
    if (eq?.id?.startsWith('NEW-')) return true; // 신규 등록 폼 작성 중일 때는 허용
    if (permission.isMaster || permission.editScope === 'TOTAL') return true; // 마스터 권한이거나 전사 스콥이면 패스
    
    // [Scope: 부서] 세팅일 경우, 자산에 기재된 부서와 내 실시간 부서명이 일치할 때만 에디터 활성화
    if (permission.editScope === 'DEPT') {
      return eq?.department === currentUser?.unit?.unit_name;
    }
    return false;
  };

  const canEditGeneral = permission?.isEditor; // 상단 '+ 신규 등록' 단추 통제용
  const canEditCurrent = selectedEq ? checkItemCanEdit(selectedEq) : false; // 팝업 내부의 모든 CRUD 기능 통제용
  
  useEffect(() => { fetchData(); }, [categoryId, tabId]);
  useEffect(() => { setArchivePage(1); }, [archiveYear]);

  // 🚀 대시보드(관제탑)에서 바로가기로 유입 시 상세 팝업을 원스텝으로 개방하는 가드
  useEffect(() => {
    const detailId = searchParams.get('detailId');
    if (detailId && equipments.length > 0 && !selectedEq) {
      const targetEq = equipments.find(e => e.id === detailId);
      if (targetEq) {
        handleOpenDetail(targetEq);
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl); // 주소창 파라미터 세척
      }
    }
  }, [searchParams, equipments]);
  
  const fetchData = async () => {
    setLoading(true);
    try {
      const [eqRes, unitRes] = await Promise.all([
        fetch(`/api/equipment?categoryCode=${categoryId}`),
        fetch('/api/admin/units?active=true') 
      ]);
  
      if (eqRes.ok) {
        const data = await eqRes.json();
        setEquipments(data.filter((e: any) => e.status === '정상').sort((a:any, b:any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        setArchives(data.filter((e: any) => e.status !== '정상').sort((a:any, b:any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      }
      if (unitRes.ok) setUnits(await unitRes.json());
    } catch (error) {
      console.error("Data Fetch Error:", error);
    } finally {
      setLoading(false);
    }
  };
  
  const refreshSelectedEq = async () => {
    try {
      const res = await fetch(`/api/equipment?categoryCode=${categoryId}`);
      if (res.ok) {
        const data = await res.json();
        setEquipments(data.filter((e: any) => e.status === '정상').sort((a:any, b:any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        setArchives(data.filter((e: any) => e.status !== '정상').sort((a:any, b:any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
        if (selectedEq) {
          const fullRes = await fetch(`/api/equipment?id=${selectedEq.id}&full=1`);
          if (fullRes.ok) {
            const updated = await fullRes.json();
            setSelectedEq(updated);
            setEditFormData((prev: any) => (isEditingDetail ? prev : { ...updated }));
          }
        }
      }
    } catch(e) { console.error(e) }
  };
  
  const displayAssetNo = (no: string) => no?.split('_ARC_')[0] || '-';
  
  const renderDDay = (targetDate: string | null) => {
    if (!targetDate) return null;
    const ymd = toCalibYmd(targetDate);
    if (!ymd) return null;
    const diffDays = getKSTDaysUntil(ymd);
    if (diffDays === 0) return <span className="text-red-500 font-black px-1.5 py-0.5 rounded bg-red-50 ml-1.5">D-Day</span>;
    if (diffDays > 0) return <span className="text-blue-600 font-black px-1.5 py-0.5 rounded bg-blue-50 ml-1.5">D-{diffDays}</span>;
    return <span className="text-red-600 font-black px-1.5 py-0.5 rounded bg-red-50 ml-1.5">D+{Math.abs(diffDays)}</span>;
  };
  
  const addMonthsToDateStr = (dateStr: string | null | undefined, months: number | null | undefined) =>
    addMonthsToCalibYmd(dateStr, months);
  
  const parseFileData = (str: string | null) => { try { return str ? JSON.parse(str) : null; } catch { return null; } };

  /** 목록/상세 공통: 유효한 이미지 src만 반환 (JSON 문자열을 src로 쓰는 실수 방지) */
  const resolveImageSrc = (raw: string | null | undefined) => {
    if (!raw) return null;
    const parsed = parseFileData(raw);
    const candidate = parsed?.data || (typeof raw === 'string' && !raw.trim().startsWith('{') ? raw : null);
    if (typeof candidate === 'string' && (candidate.startsWith('data:') || candidate.startsWith('http'))) {
      return candidate;
    }
    return null;
  };
  
  const handleDirectDownload = (str: string | null) => {
    const fileObj = parseFileData(str);
    if (!fileObj || !fileObj.data) return alert('다운로드할 파일이 없습니다.');
    fetch(fileObj.data).then(r => r.blob()).then(blob => saveAs(blob, fileObj.name));
  };
  
  const toggleSelectMainAll = () => {
    const currentPageIds = paginatedEquipments.map(a => a.id);
    const allSelected = currentPageIds.every(id => selectedMainIds.has(id));
    const next = new Set(selectedMainIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedMainIds(next);
  };
  
  const openBulkQRPrint = () => {
    const targetAssets = equipments.filter(a => selectedMainIds.has(a.id));
    if (targetAssets.length === 0) return alert('출력할 자산을 좌측 체크박스로 선택해주세요.');
    setBulkPrintAssets(targetAssets);
  };

  // 🖨️ 인쇄 전 QR 이미지를 전부 미리 생성 (생성 완료 전 인쇄 시 빈칸 방지)
  useEffect(() => {
    if (bulkPrintAssets.length === 0) {
      setBulkQrMap({});
      setBulkQrReady(false);
      return;
    }
    let cancelled = false;
    setBulkQrReady(false);
    generateEquipmentQrDataUrls(bulkPrintAssets.map((a) => a.id), 150)
      .then((map) => {
        if (!cancelled) {
          setBulkQrMap(map);
          setBulkQrReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setBulkQrReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bulkPrintAssets]);
  
  
  const handleOpenDetail = async (eq: any) => {
    setSelectedEq(eq);
    setEditFormData({ ...eq });
    setIsEditingDetail(false);
    setActiveSubTab('CALIB');
    setSelectedHistories(new Set());
    setHistoryPage(1);
    if (eq?.id && !String(eq.id).startsWith('NEW-')) {
      try {
        const res = await fetch(`/api/equipment?id=${eq.id}&full=1`);
        if (res.ok) {
          const full = await res.json();
          setSelectedEq(full);
          setEditFormData({ ...full });
        }
      } catch (e) {
        console.error(e);
      }
    }
  };
  
  const handleExportExcel = () => {
    const targetAssets = selectedMainIds.size > 0 ? equipments.filter(a => selectedMainIds.has(a.id)) : equipments;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = targetAssets.map((a, idx) => {
      const { nCalib } = resolveCalibSchedule(a);
      return {
        'NO': idx + 1, 
        '자산번호': displayAssetNo(a.asset_no), 
        '품목명': a.name, 
        '제조사': a.brand || '-', 
        '모델명/시리얼넘버': a.model_name,
        '보유개수': a.qty, 
        '제품사양': a.spec_summary || '-', 
        '최근 장비 구매/교체일': a.purchase_date ? a.purchase_date.split('T')[0] : '-', // 🚀 구입일 항목 추가
        '검교정예정일': nCalib ? nCalib : '-', 
        '장비관리소속': a.department || '-'
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "활성장비목록");
    XLSX.writeFile(wb, `장비목록_${categoryId}_${getKSTDateString()}.xlsx`);
  };
  
  const handleExportArchiveExcel = () => {
    if (filteredArchives.length === 0) return alert('다운로드할 폐기함 데이터가 없습니다.');
    const exportData = filteredArchives.map((arc, idx) => {
      let reasonText = arc.etc_memo;
      try {
        const parsed = JSON.parse(arc.etc_memo);
        reasonText = parsed.archiveReason || arc.etc_memo;
      } catch(e) {}
      return {
        'NO': filteredArchives.length - idx,
        '처리일자': arc.last_replace_date ? arc.last_replace_date.split('T')[0] : arc.updatedAt?.split('T')[0],
        '자산번호': displayAssetNo(arc.asset_no),
        '품목명': arc.name, '개수': arc.qty, '사유': reasonText, '관리소속': arc.department || '-', '상태': arc.status
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "장비폐기함");
    XLSX.writeFile(wb, `장비폐기함_${categoryId}_${archiveYear}_${getKSTDateString()}.xlsx`);
  };
  
  const handleAddEq = () => {
    const today = getKSTDateString();
    const newEq = {
      id: `NEW-${Date.now()}`, asset_no: '', name: '', brand: '', model_name: '', qty: 1, spec_summary: '', department: currentUser?.unit?.unit_name || '',
      purchase_date: today, replace_cycle_mo: 0, last_replace_date: today, calib_cycle_mo: 12, calib_memo: '', thumbnail_url: '', histories: [], purpose: '', next_calib_date: null
    };
    setSelectedEq(newEq); setEditFormData({ ...newEq }); setIsEditingDetail(true); setActiveSubTab('CALIB');
  };
  
  const handleSaveEq = async () => {
    try {
      const {
        histories,
        next_replace_date,
        createdAt,
        updatedAt,
        creator_name,
        creator_dept,
        creator_email,
        updated_by_name,
        updated_by_dept,
        updated_by_email,
        archived_at,
        archived_by_name,
        archived_by_dept,
        archived_by_email,
        ...safeData
      } = editFormData;
      const isNew = String(safeData.id || '').startsWith('NEW-');
      const payload = isNew
        ? { ...safeData, id: undefined, category: categoryId, status: '정상' }
        : safeData;
      const res = await fetch('/api/equipment', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = '저장 실패';
        try {
          const b = await res.json();
          if (b?.error) msg = b.error;
        } catch {}
        alert(msg);
        return;
      }

      const saved = await res.json();
      alert(isNew ? '등록 완료' : '수정 완료');
      setIsEditingDetail(false);

      // 서버가 채운 감사 필드 포함해 상세 갱신 (NEW- id로 재조회하면 실패함)
      const targetId = saved?.id || selectedEq?.id;
      if (targetId && !String(targetId).startsWith('NEW-')) {
        const fullRes = await fetch(`/api/equipment?id=${targetId}&full=1`);
        const full = fullRes.ok ? await fullRes.json() : saved;
        setSelectedEq(full);
        setEditFormData({ ...full });
      } else {
        setSelectedEq(saved);
        setEditFormData({ ...saved });
      }
      await fetchData();
    } catch (e) {
      alert('네트워크 오류');
    }
  };
  
  const handleOpenArchiveModal = () => {
    setArchiveFormData({ qty: selectedEq.qty, reason: '', status: '폐기' });
    setShowArchiveModal(true);
  };
  
  const executeArchive = async () => {
    if (!archiveFormData.reason.trim()) return alert('사유를 입력해 주세요.');
    if (archiveFormData.qty <= 0 || archiveFormData.qty > selectedEq.qty) return alert('수량이 올바르지 않습니다.');
    try {
      const today = parseKSTDateOnly(getKSTDateString()).toISOString();
      const res = await fetch('/api/equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedEq.id,
          action: 'archive',
          qty: archiveFormData.qty,
          reason: archiveFormData.reason,
          status: archiveFormData.status,
          last_replace_date: today,
        }),
      });
      if (!res.ok) {
        let msg = '폐기 처리에 실패했습니다.';
        try {
          const b = await res.json();
          if (b?.error) msg = b.error;
        } catch {}
        alert(msg);
        return;
      }
      alert('성공적으로 폐기함으로 이동되었습니다.');
      setShowArchiveModal(false);
      setSelectedEq(null);
      fetchData();
      router.push(`/equipment/main/${categoryId}/archive`);
    } catch (e) {
      alert('오류 발생');
    }
  };
  
  const handleRestoreArchive = async (arc: any) => {
    if (!confirm('다시 활성 장비 리스트로 복구하시겠습니까?')) return;
    try {
      await fetch('/api/equipment', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: arc.id, status: '정상' }) });
      alert('복구 완료되었습니다.'); fetchData();
    } catch (e) { alert('복구 오류'); }
  };
  
  const handlePermanentDelete = async (id: string) => {
    if (!confirm('정말 영구 삭제하시겠습니까? 이 작업은 절대 복구할 수 없습니다.')) return;
    try {
      const res = await fetch(`/api/equipment?id=${id}`, { method: 'DELETE' });
      if (res.ok) { alert('영구 삭제되었습니다.'); fetchData(); } else { alert('삭제 실패'); }
    } catch(e) { alert('오류 발생'); }
  };
  
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB — API와 동일
  const MAX_UPLOAD_LABEL = '5MB';

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: string, isHistory = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      alert(`파일 용량이 초과되었습니다.\n최대 ${MAX_UPLOAD_LABEL}까지 업로드할 수 있습니다.\n(현재 ${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
      e.target.value = '';
      return;
    }

    const applyPayload = (fileObj: string) => {
      if (isHistory) setHistoryFormData((prev: any) => ({ ...prev, [field]: fileObj }));
      else setEditFormData((prev: any) => ({ ...prev, [field]: fileObj }));
    };

    // 장비 사진: 상세용(원본 축소) + 목록용 thumb 동시 생성
    if (field === 'thumbnail_url' && file.type.startsWith('image/')) {
      buildEquipmentImagePayload(file)
        .then(applyPayload)
        .catch(() => {
          alert('이미지 처리에 실패했습니다. 다른 파일을 시도해 주세요.');
          e.target.value = '';
        });
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      applyPayload(JSON.stringify({ name: file.name, data: evt.target?.result }));
    };
    reader.readAsDataURL(file);
  };
  
  const openAddHistoryModal = () => {
    setHistoryFormData({ calib_request_date: '', calib_date: '', content: '', cost: '', agency: '', result: '진행중', estimate_url: '', cert_file_url: '' });
    setShowAddHistoryModal(true);
  };
  
  const handleSaveHistory = async () => {
    if (!historyFormData.calib_date || !historyFormData.agency) return alert('검교정일자와 교정기관은 필수입니다.');
    try {
      const {
        id,
        equipment_id,
        createdAt,
        updatedAt,
        creator_name,
        creator_dept,
        creator_email,
        ...cleanHistory
      } = historyFormData;
      const payload = { id: selectedEq.id, history: { ...cleanHistory, cost: Number(cleanHistory.cost) || 0 } };
      const res = await fetch('/api/equipment', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        alert('신규 검교정 이력이 성공적으로 등록되었습니다.');
        setShowAddHistoryModal(false);
        setHistoryFormData({ calib_request_date: '', calib_date: '', content: '', cost: '', agency: '', result: '진행중', estimate_url: '', cert_file_url: '' });
        await refreshSelectedEq();
      } else { alert('이력 등록에 실패했습니다.'); }
    } catch (error) { alert('네트워크 오류가 발생했습니다.'); }
  };
  
  const handleUpdateHistory = async () => {
    if (!historyFormData.calib_date || !historyFormData.agency) return alert('검교정일자와 교정기관은 필수입니다.');
    if (!selectedHistoryDetail?.id) return alert('수정할 이력을 찾을 수 없습니다.');
    try {
      const {
        id,
        equipment_id,
        createdAt,
        updatedAt,
        creator_name,
        creator_dept,
        creator_email,
        ...cleanHistory
      } = historyFormData;
      const res = await fetch('/api/equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedEq.id,
          updateHistoryId: selectedHistoryDetail.id,
          history: { ...cleanHistory, cost: Number(cleanHistory.cost) || 0 },
        }),
      });
      if (res.ok) {
        alert('이력이 성공적으로 수정되었습니다.');
        setSelectedHistoryDetail(null);
        setIsEditingHistory(false);
        await refreshSelectedEq();
      } else {
        let msg = '이력 수정에 실패했습니다.';
        try {
          const b = await res.json();
          if (b?.error) msg = b.error;
        } catch {}
        alert(msg);
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    }
  };
  
  const handleDeleteHistory = async (historyId: string) => {
    if (!confirm('정말 이 검교정 이력을 삭제하시겠습니까?')) return;
    try {
      const payload = { id: selectedEq.id, deleteHistoryId: historyId };
      const res = await fetch('/api/equipment', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) { 
        alert('이력이 삭제되었습니다.'); 
        setSelectedHistoryDetail(null); 
        await refreshSelectedEq();
      }
    } catch (e) { alert('오류가 발생했습니다.'); }
  };
  
  const handleOpenHistoryDetail = (history: any) => {
    setSelectedHistoryDetail(history);
    setHistoryFormData({
      ...history,
      result: normalizeCalibResult(history.result),
      calib_request_date: history.calib_request_date?.split('T')[0] || '',
      calib_date: history.calib_date?.split('T')[0] || '',
    });
    setIsEditingHistory(false);
  };
  
  const totalPages = Math.max(1, Math.ceil(equipments.length / itemsPerPage));
  const paginatedEquipments = equipments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  const availableArchiveYears = useMemo(() => {
    const years = archives.map(h => (h.last_replace_date || h.updatedAt || '').substring(0, 4)).filter(Boolean);
    const unique = Array.from(new Set(years));
    const curYear = String(getKSTNowYearMonth().year);
    if (!unique.includes(curYear)) unique.push(curYear);
    return unique.sort((a, b) => b.localeCompare(a));
  }, [archives]);
  
  const filteredArchives = useMemo(() => {
    if (archiveYear === 'ALL') return archives;
    return archives.filter(h => {
      const d = h.last_replace_date ? h.last_replace_date : h.updatedAt;
      return d?.startsWith(archiveYear);
    });
  }, [archives, archiveYear]);
  
  const totalArchivePages = Math.max(1, Math.ceil(filteredArchives.length / itemsPerPage));
  const paginatedArchives = filteredArchives.slice((archivePage - 1) * itemsPerPage, archivePage * itemsPerPage);
  
  if (loading) return <div className="p-10 font-bold text-slate-400 animate-pulse text-center">장비 인벤토리 동기화 중...</div>;
  
  const currentEq = isEditingDetail ? editFormData : selectedEq;
// 🚀 장비 구매/교체일(purchase_date) 기준으로 교체예정일 산정
const baseReplaceDate = currentEq?.purchase_date;
const nextReplaceDate = addMonthsToDateStr(baseReplaceDate, currentEq?.replace_cycle_mo);

// 🚀 확정일/요청일 요약 + 공통 예정일 산정 (대시보드와 동일)
const latestHistory = pickLatestCalibHistory(currentEq?.histories);
const latestCalibReqDate = toCalibYmd(latestHistory?.calib_request_date as string | Date | null | undefined);
const latestCalibDate = toCalibYmd(latestHistory?.calib_date as string | Date | null | undefined);
const { nCalib: nextCalibDate } = resolveCalibSchedule(currentEq || {});
  
  const renderFileSection = (title: string, field: string) => {
    const fileObj = parseFileData(currentEq?.[field]);
    return (
      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 flex flex-col gap-3 shadow-sm relative">
        <div className="flex items-center justify-between">
          <h5 className="font-black text-[11px] text-slate-800 flex items-center gap-1">{title}</h5>
          {isEditingDetail && fileObj?.name && (
            <button type="button" onClick={() => setEditFormData({...editFormData, [field]: ''})} className="text-[10px] text-red-500 hover:text-red-700 hover:bg-red-50 font-black px-2 py-1 rounded transition-colors absolute top-4 right-4">✕ 삭제</button>
          )}
        </div>
        {isEditingDetail && (
          <label className="cursor-pointer px-4 py-2 mt-2 border border-dashed border-indigo-300 bg-white text-indigo-600 rounded-lg text-center text-[10px] font-black hover:bg-indigo-50 transition-colors">
            {fileObj?.name ? '다른 파일로 교체하기' : '파일 찾아보기'}
            <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, field)} />
          </label>
        )}
        {isEditingDetail && (
          <p className="text-[9px] text-slate-400 font-bold -mt-1">※ 최대 {MAX_UPLOAD_LABEL} (이미지·PDF 권장)</p>
        )}
        <div className="mt-auto pt-3 border-t border-slate-200">
          {fileObj?.name ? (
            <span onClick={() => handleDirectDownload(currentEq[field])} className="text-[11px] font-bold text-blue-600 truncate cursor-pointer hover:underline block">📄 {fileObj.name}</span>
          ) : <span className="text-[10px] text-slate-400 block">등록된 파일이 없습니다.</span>}
        </div>
      </div>
    );
  };
  
  // =========================================================================
  // 🚀 Render UI
  // =========================================================================
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in relative z-10">
      
{/* 💎 [Soft Gradient Modern Banner] 메인(다크)과 완벽히 구분되면서도 결코 밋밋하지 않은 은은한 라이트 그라데이션 */}
<div className="w-full bg-gradient-to-r from-slate-50 via-indigo-50/50 to-blue-50/50 p-6 rounded-xl border border-indigo-200 shadow-sm relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        {/* 부드러운 배경 텍스처(입체감 부여) */}
        <div className="absolute right-0 top-0 w-64 h-full bg-gradient-to-l from-indigo-100/60 to-transparent pointer-events-none"></div>
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.4)]"></div>

        <div className="pl-3 relative z-10">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700 bg-white border border-indigo-200 px-2 py-0.5 rounded font-mono shadow-sm">
              ASSET MANAGEMENT / {categoryId.toUpperCase()}
            </span>
          </div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            개별 장비 자산 인벤토리
          </h1>
          <p className="text-slate-500 text-xs font-medium mt-1">
            카테고리별 장비 수량, 보유 현황, 상세 규격문서 및 검교정 이력을 체계적으로 관리합니다.
          </p>
        </div>

        {/* 우측 수치 위젯 (입체감 있는 화이트 글래스 느낌) */}
        <div className="flex items-center gap-2.5 bg-white/80 border border-indigo-100 px-4 py-2.5 rounded-xl shrink-0 shadow-[0_4px_15px_rgba(79,70,229,0.05)] backdrop-blur-sm relative z-10">
          <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
          <span className="text-xs font-bold text-slate-500">카테고리 총 등록 자산:</span>
          <span className="text-lg font-black font-mono text-indigo-600 leading-none">{equipments.length}</span>
          <span className="text-[10px] font-bold text-slate-400">EA</span>
        </div>
      </div>

      {/* 🔄 [컨텐츠 하단 서브 탭 스위처] 활성 장비 vs 폐기함 토글 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => router.push(`/equipment/main/${categoryId}/inventory`)}
            className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
              tabId === 'inventory'
                ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📦 활성 장비 목록</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              tabId === 'inventory' ? 'bg-indigo-50 text-indigo-600 font-bold' : 'bg-slate-200 text-slate-600'
            }`}>
              {equipments.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push(`/equipment/main/${categoryId}/archive`)}
            className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
              tabId === 'archive'
                ? 'bg-white text-red-600 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>🗑️ 장비 폐기 및 보관함</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              tabId === 'archive' ? 'bg-red-50 text-red-600 font-bold' : 'bg-slate-200 text-slate-600'
            }`}>
              {archives.length}
            </span>
          </button>
        </div>

        <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
          ※ 탭을 클릭하여 활성 장비와 폐기/반납 장비 내역을 전환합니다.
        </p>
      </div>

      {/* INVENTORY VIEW */}
      {tabId === 'inventory' && (
        <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
          <HeaderLight title="활성 장비 목록" count={equipments.length}>
             <button onClick={openBulkQRPrint} className="text-[10px] bg-white border border-slate-300 text-slate-700 font-bold px-3 py-1.5 rounded-lg outline-none hover:bg-slate-50 transition-colors">🖨️ QR 일괄출력</button>
             <button onClick={handleExportExcel} className="text-[10px] bg-white border border-slate-300 text-slate-700 font-bold px-3 py-1.5 rounded-lg outline-none hover:bg-slate-50 transition-colors">📊 선택 엑셀 다운로드</button>
             {/* 🚀canEdit ➡️ canEditGeneral 교체 (신규 생성을 통제) */}
             {canEditGeneral && (
               <button onClick={handleAddEq} className="text-[10px] bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg outline-none transition-colors">+ 신규 등록</button>
             )}
          </HeaderLight>
  
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1350px]">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                <th className="h-12 pl-6 w-12 text-center">
  <input 
    type="checkbox" 
    checked={paginatedEquipments.length > 0 && paginatedEquipments.every(a => selectedMainIds.has(a.id))} 
    onChange={toggleSelectMainAll} 
    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3 h-3 cursor-pointer" 
  />
</th>
                  <th className="h-12 px-3 text-center w-12">NO</th>
                  <th className="h-12 px-3 text-center w-16">사진</th>
                  <th className="h-12 px-3 w-28">자산번호</th>
                  <th className="h-12 px-3 w-40">품목명</th>
                  <th className="h-12 px-3 w-28">제조사</th>
                  <th className="h-12 px-3 w-32">모델명/S.N</th>
                  <th className="h-12 px-3 w-20 text-center">보유개수</th>
                  <th className="h-12 px-3 w-48">제품사양</th>
                  <th className="h-12 px-3 w-28 text-center text-slate-700">최근 장비 구매/교체일</th>
                  <th className="h-12 px-3 w-28 text-center text-red-500">검교정예정일</th>
                  <th className="h-12 px-3 w-32 text-center">관리소속</th>
                  <th className="h-12 px-3 w-20 text-center">QR</th>
                  <th className="h-12 pr-6 w-24 text-center">액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedEquipments.length === 0 ? (
                  <tr><td colSpan={14} className="p-12 text-center text-slate-400">등록된 장비 데이터가 없습니다.</td></tr>
) : paginatedEquipments.map((eq, idx) => {
                  const { nCalib, isDue } = resolveCalibSchedule(eq);
  
                  return (
                    <tr key={eq.id} className={`h-16 hover:bg-slate-50/50 transition-colors ${isDue ? 'bg-red-50/30' : ''}`}>
                      <td className="pl-6 text-center">
                        <input type="checkbox" checked={selectedMainIds.has(eq.id)} onChange={(e) => { e.stopPropagation(); const next = new Set(selectedMainIds); next.has(eq.id) ? next.delete(eq.id) : next.add(eq.id); setSelectedMainIds(next); }} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer" />
                      </td>
                      <td className="text-center text-slate-400 font-mono">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                      <td className="text-center">
                        {resolveImageSrc(eq.thumbnail_url) ? (
                          <img src={resolveImageSrc(eq.thumbnail_url)!} alt="" className="w-10 h-10 object-cover rounded-md mx-auto border" />
                        ) : (
                          <div className="w-10 h-10 bg-slate-100 rounded-md mx-auto flex items-center justify-center text-[8px] text-slate-300 border">NO</div>
                        )}
                      </td>
                      <td className="px-3 font-mono font-black text-slate-900">{displayAssetNo(eq.asset_no)}</td>
                      <td className="px-3 text-blue-700">{eq.name}</td>
                      <td className="px-3">{eq.brand || '-'}</td>
                      <td className="px-3 text-[10px] text-slate-500">{eq.model_name}</td>
                      <td className="text-center">{eq.qty} EA</td>
                      <td className="px-3 text-slate-500 truncate max-w-[150px] font-medium">{eq.spec_summary || '-'}</td>

{/* 🚀 추가된 구입일 컬럼 */}
<td className="text-center font-bold text-slate-700">
  {eq.purchase_date ? eq.purchase_date.split('T')[0] : '-'}
</td>

<td className="text-center font-black">
  {nCalib ? (
    <div className="flex flex-col items-center justify-center">
      <span className="text-slate-900">{nCalib}</span>
      {renderDDay(nCalib)}
    </div>
  ) : <span className="text-slate-300">-</span>}
</td>
                      <td className="text-center text-slate-600">{eq.department || '-'}</td>
                      <td className="text-center">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setShowQrModal(eq); }} className="px-2 py-1 bg-white border border-purple-200 text-purple-600 rounded text-[10px] hover:bg-purple-50 transition-colors shadow-sm">QR보기</button>
                      </td>
                      <td className="pr-6 text-center">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleOpenDetail(eq); }}
                          className={`px-3 py-1.5 border rounded-lg text-[10px] font-black transition-colors shadow-sm w-full ${
                            isDue
                              ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-600 hover:text-white'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          상세 이동
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
  
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors">이전</button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors">다음</button>
            </div>
          )}
        </div>
      )}
  
      {/* ARCHIVE VIEW */}
      {tabId === 'archive' && (
        <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in">
          <HeaderLight title="장비 폐기 및 보관함" count={filteredArchives.length}>
             <select value={archiveYear} onChange={(e) => setArchiveYear(e.target.value)} className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer">
               <option value="ALL">전체 연도 내역 보기</option>
               {availableArchiveYears.map(year => <option key={year} value={year}>{year}년도</option>)}
             </select>
             <button onClick={handleExportArchiveExcel} className="text-[10px] bg-white border border-slate-300 text-emerald-700 font-bold px-3 py-1.5 rounded-lg outline-none hover:bg-slate-50 transition-colors ml-2">📊 선택 엑셀 다운로드</button>
          </HeaderLight>
  
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-6 text-center w-16">NO</th>
                  <th className="h-12 px-3 w-28 text-center">처리일자</th>
                  <th className="h-12 px-3 w-32">자산번호</th>
                  <th className="h-12 px-3 w-40">품목명</th>
                  <th className="h-12 px-3 w-20 text-center">개수</th>
                  <th className="h-12 px-3 w-[250px]">처리 사유</th>
                  <th className="h-12 px-3 w-32 text-center">관리소속</th>
                  <th className="h-12 px-3 w-20 text-center">상태</th>
                  <th className="h-12 pr-6 w-36 text-center">관리액션</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedArchives.length === 0 ? (
                  <tr><td colSpan={9} className="p-12 text-center text-slate-400">선택된 기간에 처리된장비 내역이 없습니다.</td></tr>
                ) : paginatedArchives.map((arc, idx) => {
                  let reasonText = arc.etc_memo;
                  try {
                    const parsed = JSON.parse(arc.etc_memo);
                    reasonText = parsed.archiveReason || arc.etc_memo;
                  } catch(e) {}
  
                  return (
                    <tr key={arc.id} className="h-16 hover:bg-slate-50/50 transition-colors">
                      <td className="pl-6 text-center text-slate-400 font-mono">{filteredArchives.length - ((archivePage - 1) * itemsPerPage + idx)}</td>
                      <td className="text-center font-black">{arc.last_replace_date ? arc.last_replace_date.split('T')[0] : arc.updatedAt?.split('T')[0]}</td>
                      <td className="px-3 font-mono font-black text-slate-900">{displayAssetNo(arc.asset_no)}</td>
                      <td className="px-3 text-blue-700">{arc.name}</td>
                      <td className="text-center">{arc.qty} EA</td>
                      <td className="px-3 text-slate-500 font-medium truncate max-w-[250px]" title={reasonText}>"{reasonText}"</td>
                      <td className="text-center text-slate-600">{arc.department || '-'}</td>
                      <td className="text-center">
                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-black ${arc.status === '폐기' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-slate-200 text-slate-600'}`}>{arc.status}</span>
                      </td>
                      <td className="pr-6 text-center flex items-center justify-center gap-1 h-16">
                        <button onClick={() => handleRestoreArchive(arc)} className="px-2 py-1 bg-white border border-slate-300 text-slate-700 rounded-lg text-[10px] shadow-sm hover:bg-slate-50">복구</button>
                        <button onClick={() => handlePermanentDelete(arc.id)} className="px-2 py-1 bg-white border border-red-200 text-red-600 rounded-lg text-[10px] shadow-sm hover:bg-red-50">삭제</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
  
          {totalArchivePages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
              <button disabled={archivePage === 1} onClick={() => setArchivePage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors">이전</button>
              {Array.from({ length: totalArchivePages }).map((_, i) => (
                <button key={i} onClick={() => setArchivePage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${archivePage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={archivePage === totalArchivePages} onClick={() => setArchivePage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors">다음</button>
            </div>
          )}
        </div>
      )}
  
      {/* 장비 상세보기 팝업 */}
      {selectedEq && (
  <div className="fixed inset-0 z-[100] bg-slate-900/70 flex items-center justify-center pt-16 pb-8 px-6 backdrop-blur-sm" onClick={() => setSelectedEq(null)}>
    <div className="bg-slate-50 w-full max-w-6xl max-h-[85vh] h-full rounded-[2rem] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 shadow-[0_0_40px_rgba(0,0,0,0.3)] border border-slate-200" onClick={e => e.stopPropagation()}>

    <div className="p-5 px-8 bg-slate-800 border-b border-slate-900 flex justify-between items-center shrink-0">
  <div>
    <p className="text-[10px] font-black uppercase tracking-widest mb-1.5 flex items-center gap-2">
      <span className="bg-emerald-500 text-white px-2.5 py-0.5 rounded-md shadow-sm">장비스팩 상세보기</span>
      {isEditingDetail && <span className="text-amber-500 bg-amber-900/30 border border-amber-700/50 px-2 py-0.5 rounded-md">[편집 모드]</span>}
    </p>
    {/* 🚀 글자색을 text-white로 변경 */}
    <h3 className="font-black text-xl text-white">{currentEq.name || '신규 장비'} <span className="text-sm font-medium text-slate-400 ml-2">[{displayAssetNo(currentEq.asset_no) || '번호생성전'}]</span></h3>
  </div>
  <div className="flex gap-3 items-center">
    {canEditCurrent && !isEditingDetail && (
      <>
        <button onClick={() => setIsEditingDetail(true)} className="px-4 py-2 bg-slate-700 text-white rounded-xl text-[11px] font-black transition-all hover:bg-slate-600 shadow-sm border border-slate-600">✏️ 정보 수정</button>
        <button onClick={handleOpenArchiveModal} className="px-4 py-2 bg-red-900/50 text-red-400 rounded-xl text-[11px] font-black transition-all hover:bg-red-900/80 shadow-sm border border-red-800/50">🗑️ 폐기/보관</button>
      </>
    )}
    {canEditCurrent && isEditingDetail && (
      <>
        <button onClick={() => { setIsEditingDetail(false); setEditFormData({...selectedEq}); }} className="px-4 py-2 bg-slate-700 text-white rounded-xl text-[11px] font-black transition-all hover:bg-slate-600">취소</button>
        <button onClick={handleSaveEq} className="px-6 py-2 bg-indigo-500 text-white rounded-xl text-[11px] font-black transition-all hover:bg-indigo-400 shadow-md">💾 저장 완료</button>
      </>
    )}
    <div className="w-px h-8 bg-slate-600 mx-2"></div>
    {/* 🚀 닫기 버튼 글자색 조정 */}
    <button onClick={() => setSelectedEq(null)} className="text-2xl font-light text-slate-400 hover:text-white transition-colors">✕</button>
  </div>
</div>
  
            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50">
              <div className="flex flex-col lg:flex-row gap-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="w-full lg:w-1/3 shrink-0 flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-slate-100 p-4 min-h-[250px] relative group">
                  {(() => {
                     const imgSrc = resolveImageSrc(currentEq.thumbnail_url);
                     return imgSrc ? (
                        <img src={imgSrc} alt="장비사진" className="max-w-full max-h-[250px] object-contain rounded-lg shadow-sm" />
                     ) : <span className="text-slate-300 font-black text-2xl">NO IMAGE</span>
                  })()}
                  
                  {isEditingDetail && (
                    <div className="absolute inset-0 bg-slate-900/50 flex flex-col items-center justify-center rounded-xl opacity-0 group-hover:opacity-100 transition-opacity gap-2 backdrop-blur-sm">
                       <label className="cursor-pointer px-4 py-2 bg-white text-slate-800 rounded-lg font-black text-xs shadow-sm hover:bg-slate-100">
                         📸 사진 등록/변경
                         <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'thumbnail_url')} />
                       </label>
                       <p className="text-[9px] font-bold text-white/90 bg-slate-900/40 px-2 py-0.5 rounded">최대 {MAX_UPLOAD_LABEL} · 목록용 축소본 자동생성</p>
                       {currentEq.thumbnail_url && (
                         <button type="button" onClick={() => setEditFormData({...editFormData, thumbnail_url: ''})} className="px-4 py-2 bg-red-500 text-white rounded-lg font-black text-xs shadow-sm hover:bg-red-600">✕ 사진 삭제</button>
                       )}
                    </div>
                  )}
                  {isEditingDetail && (
                    <p className="absolute bottom-2 left-0 right-0 text-center text-[9px] font-bold text-slate-400 group-hover:opacity-0 transition-opacity">
                      사진 최대 {MAX_UPLOAD_LABEL} (목록은 축소 표출)
                    </p>
                  )}
                </div>
  
                <div className="flex-1 grid grid-cols-2 gap-4 text-[11px]">
                  <div className="space-y-1"><p className="font-black text-slate-400 uppercase">자산번호</p>
                    {isEditingDetail ? <input value={editFormData.asset_no} onChange={e=>setEditFormData({...editFormData, asset_no: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 font-bold bg-white focus:bg-indigo-50/30 transition-all" placeholder="자산번호" /> : <p className="font-black text-slate-900 text-sm py-1.5">{displayAssetNo(currentEq.asset_no)}</p>}
                  </div>
                  
                  <div className="space-y-1"><p className="font-black text-slate-400 uppercase">장비관리소속</p>
                    {isEditingDetail ? (
                      <select value={editFormData.department || ''} onChange={e=>setEditFormData({...editFormData, department: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg font-bold bg-white outline-none focus:border-indigo-500 focus:bg-indigo-50/30 transition-all">
                        <option value="">소속 선택 (공용)</option>
                        {units.map((u:any) => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
                      </select>
                    ) : <p className="font-black text-blue-600 text-sm py-1.5">{currentEq.department || '공용 (미지정)'}</p>}
                  </div>
  
                  <div className="space-y-1"><p className="font-black text-slate-400 uppercase">품목명</p>
                    {isEditingDetail ? <input type="text" value={editFormData.name || ''} onChange={e=>setEditFormData({...editFormData, name: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 font-bold bg-white focus:bg-indigo-50/30 transition-all" placeholder="품목명 직접 입력" /> : <p className="font-bold text-slate-800 text-sm py-1.5">{currentEq.name || '-'}</p>}
                  </div>
                  
                  <div className="space-y-1"><p className="font-black text-slate-400 uppercase">보유개수</p>
                    {isEditingDetail ? <input type="number" value={editFormData.qty} onChange={e=>setEditFormData({...editFormData, qty: Number(e.target.value)})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 font-bold bg-white focus:bg-indigo-50/30 transition-all" /> : <p className="font-bold text-slate-800 text-sm py-1.5">{currentEq.qty} EA</p>}
                  </div>
                  <div className="space-y-1"><p className="font-black text-slate-400 uppercase">제조사</p>
                    {isEditingDetail ? <input value={editFormData.brand || ''} onChange={e=>setEditFormData({...editFormData, brand: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 font-bold bg-white focus:bg-indigo-50/30 transition-all" placeholder="제조사 명" /> : <p className="font-bold text-slate-800 text-sm py-1.5">{currentEq.brand || '-'}</p>}
                  </div>
                  <div className="space-y-1"><p className="font-black text-slate-400 uppercase">모델명/시리얼넘버</p>
                    {isEditingDetail ? <input value={editFormData.model_name || ''} onChange={e=>setEditFormData({...editFormData, model_name: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 font-bold bg-white focus:bg-indigo-50/30 transition-all" placeholder="모델명/시리얼넘버" /> : <p className="font-bold text-slate-800 text-sm py-1.5">{currentEq.model_name || '-'}</p>}
                  </div>
                  <div className="col-span-2 space-y-1"><p className="font-black text-slate-400 uppercase">제품사양 요약</p>
                    {isEditingDetail ? <textarea value={editFormData.spec_summary || ''} onChange={e=>setEditFormData({...editFormData, spec_summary: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-bold bg-white focus:bg-indigo-50/30 min-h-[60px] transition-all resize-none" placeholder="주요 사양 기재" /> : <p className="font-bold text-slate-700 p-4 bg-slate-50 rounded-xl border border-slate-100">{currentEq.spec_summary || '사양 정보 없음'}</p>}
                  </div>
                </div>
              </div>
  
             {/* 🚀 상/하 2단 행 배치 (각 카드는 가로 4열 구조) */}
             <div className="space-y-6">
                
                {/* 1행: 구입 및 교체 이력 (흐름 순서로 변경 완료) */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <h4 className="font-black text-[13px] text-indigo-600 border-b border-indigo-100 pb-3 flex items-center gap-2">
                    <span>🔄</span> 구입 및 교체 이력
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px]">
                    {/* 1. 구입일 */}
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">최근 장비 구매/교체일</p>
                      {isEditingDetail ? (
                        <input type="date" max="9999-12-31" value={editFormData.purchase_date?.split('T')[0] || ''} onChange={e=>setEditFormData({...editFormData, purchase_date: e.target.value ? parseKSTDateOnly(e.target.value).toISOString() : null})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold bg-white focus:border-indigo-500" />
                      ) : (
                        <p className="font-black text-sm">{currentEq.purchase_date ? currentEq.purchase_date.split('T')[0] : '-'}</p>
                      )}
                    </div>

                    {/* 2. 최근 교체일 (위치 이동) */}
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">최근 소모품 교체일</p>
                      {isEditingDetail ? (
                        <input type="date" max="9999-12-31" value={editFormData.last_replace_date?.split('T')[0] || ''} onChange={e=>setEditFormData({...editFormData, last_replace_date: e.target.value ? parseKSTDateOnly(e.target.value).toISOString() : null})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold bg-white focus:border-indigo-500" />
                      ) : (
                        <p className="font-black text-sm">{currentEq.last_replace_date ? currentEq.last_replace_date.split('T')[0] : '-'}</p>
                      )}
                    </div>

                    {/* 3. 교체주기 (위치 이동) */}
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">교체주기(M)</p>
                      {isEditingDetail ? (
                        <input type="number" value={editFormData.replace_cycle_mo || ''} onChange={e=>setEditFormData({...editFormData, replace_cycle_mo: Number(e.target.value)})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold text-indigo-600 bg-white focus:border-indigo-500" placeholder="개월 단위" />
                      ) : (
<p className="font-black text-sm text-slate-800">{currentEq.replace_cycle_mo ? `${currentEq.replace_cycle_mo} 개월` : '-'}</p>
)}
                    </div>

                    {/* 4. 자동산정 교체예정일 */}
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">
                        자동산정 교체예정일(D-Day)
                        <span className="text-[9px] font-normal text-slate-300 ml-1">
                          (장비 구매 기준)
                        </span>
                      </p>
                      <div className="flex items-center h-[28px] font-black text-slate-800 text-[13px]">
                        {nextReplaceDate ? (
                          <div className="flex items-center gap-1.5">
                            <span>{nextReplaceDate}</span>
                            {renderDDay(nextReplaceDate)}
                          </div>
                        ) : <span className="text-slate-300">-</span>}
                      </div>
                    </div>
                  </div>
                </div>

{/* 2행: 검교정 상태 요약 (흐름 순서 및 스마트 산정 적용) */}
<div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <h4 className="font-black text-[13px] text-emerald-600 border-b border-emerald-100 pb-3 flex items-center gap-2">
                    <span>✅</span> 검교정 상태 요약
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px]">
                    {/* 1. 최근 검교정요청일 */}
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">
                        최근 검교정요청일 
                        <span className="font-normal text-[9px] text-slate-300 ml-0.5">(이력 연동)</span>
                      </p>
                      <p className="font-black text-sm text-slate-700">{latestCalibReqDate || '-'}</p>
                    </div>

                    {/* 2. 최근 검교정확정일 */}
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">
                        최근 검교정확정일 
                        <span className="font-normal text-[9px] text-slate-300 ml-0.5">(이력 연동)</span>
                      </p>
                      <p className="font-black text-sm text-slate-700">{latestCalibDate || '-'}</p>
                    </div>

                    {/* 3. 검교정주기 */}
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">검교정주기(M)</p>
                      {isEditingDetail ? (
                        <input type="number" value={editFormData.calib_cycle_mo || ''} onChange={e=>setEditFormData({...editFormData, calib_cycle_mo: Number(e.target.value)})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold text-emerald-600 bg-white focus:border-emerald-500" placeholder="개월 단위" />
                      ) : (
<p className="font-black text-sm text-slate-800">{currentEq.calib_cycle_mo ? `${currentEq.calib_cycle_mo} 개월` : '-'}</p>
)}
                    </div>

                    {/* 4. 자동산정 검교정예정일 */}
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">
                        자동산정 검교정예정일(D-Day)
                        <span className="text-[9px] font-normal text-slate-300 ml-1">
                          ({latestCalibDate ? '확정일' : latestCalibReqDate ? '요청일' : '등록일'} 기준)
                        </span>
                      </p>
                      <div className="flex items-center h-[28px] font-black text-slate-800 text-[13px]">
                        {nextCalibDate ? (
                          <div className="flex items-center gap-1.5">
                            <span>{nextCalibDate}</span>
                            {renderDDay(nextCalibDate)}
                          </div>
                        ) : <span className="text-slate-300">-</span>}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
  
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex border-b-2 border-slate-100 bg-white">
                  <button type="button" onClick={() => { setActiveSubTab('CALIB'); setHistoryPage(1); }} className={`flex-1 py-4 text-xs font-black transition-all ${activeSubTab === 'CALIB' ? 'bg-slate-50 text-indigo-600 border-t-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-50 border-t-2 border-transparent'}`}>검교정 상세관리 (이력 표)</button>
                  <button type="button" onClick={() => setActiveSubTab('PRODUCT')} className={`flex-1 py-4 text-xs font-black transition-all ${activeSubTab === 'PRODUCT' ? 'bg-slate-50 text-indigo-600 border-t-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-50 border-t-2 border-transparent'}`}>제품정보 및 파일 보관함</button>
                </div>
  
                <div className="p-8 bg-slate-50">
                  {activeSubTab === 'CALIB' && (() => {
                    const sortedHistories = currentEq.histories?.sort((a:any, b:any) => new Date(b.calib_date).getTime() - new Date(a.calib_date).getTime()) || [];
                    const totalHistoryPages = Math.max(1, Math.ceil(sortedHistories.length / historyItemsPerPage));
                    const paginatedHistories = sortedHistories.slice((historyPage - 1) * historyItemsPerPage, historyPage * historyItemsPerPage);
  
                    return (
                      <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="flex justify-between items-end mb-4">
                          <p className="text-[11px] font-bold text-slate-500">장비의 전체 검교정 이력 및 관련 증빙을 안전하게 누적 관리합니다.</p>
                          <div className="flex gap-2">
                            {/* 🚀 canEditCurrent 단추 통제교체 */}
                            {canEditCurrent && !isEditingDetail && !selectedEq?.id?.startsWith('NEW-') && (
                              <button type="button" onClick={openAddHistoryModal} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black hover:bg-slate-800 transition-all shadow-md active:scale-95">
                                + 신규 이력 추가
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-sm bg-white">
                          <table className="w-full text-left text-[11px] font-bold table-fixed min-w-[920px]">
                            <colgroup>
                              <col className="w-[48px]" />
                              <col className="w-[108px]" />
                              <col className="w-[108px]" />
                              <col />
                              <col className="w-[72px]" />
                              <col className="w-[120px]" />
                              <col className="w-[140px]" />
                              <col className="w-[100px]" />
                              {canEditCurrent && <col className="w-[96px]" />}
                            </colgroup>
                            <thead className="bg-white text-slate-400 border-b border-slate-200">
                              <tr>
                                <th className="px-2 py-3 text-center whitespace-nowrap">NO</th>
                                <th className="px-2 py-3 text-center whitespace-nowrap">검교정요청일</th>
                                <th className="px-2 py-3 text-center whitespace-nowrap">검교정확정일</th>
                                <th className="px-2 py-3 whitespace-nowrap">검교정내용</th>
                                <th className="px-2 py-3 text-center whitespace-nowrap">결과상태</th>
                                <th className="px-2 py-3 text-center whitespace-nowrap">교정기관</th>
                                <th className="px-2 py-3 text-center whitespace-nowrap">등록자(소속)</th>
                                <th className="px-2 py-3 text-center whitespace-nowrap">등록일</th>
                                {canEditCurrent && <th className="px-2 py-3 text-center whitespace-nowrap">관리</th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {sortedHistories.length === 0 ? (
                                <tr><td colSpan={canEditCurrent ? 9 : 8} className="p-12 text-center text-slate-400 font-bold bg-slate-50/50">등록된 검교정 이력이 없습니다.</td></tr>
                              ) : paginatedHistories.map((h: any, i: number) => (
                                  <tr key={h.id} className="hover:bg-slate-50 transition-colors h-12">
                                    <td className="px-2 py-3 text-center text-slate-400">{sortedHistories.length - ((historyPage - 1) * historyItemsPerPage + i)}</td>
                                    <td className="px-2 py-3 text-center font-black text-slate-800 whitespace-nowrap">{h.calib_request_date ? h.calib_request_date.split('T')[0] : '-'}</td>
                                    <td className="px-2 py-3 text-center font-black text-blue-600 whitespace-nowrap">{h.calib_date?.split('T')[0] || '-'}</td>
                                    <td className="px-2 py-3 text-slate-600 truncate" title={h.content || h.memo || ''}>{h.content || h.memo || '-'}</td>
                                    <td className="px-2 py-3 text-center font-black text-blue-600 whitespace-nowrap">{normalizeCalibResult(h.result)}</td>
                                    <td className="px-2 py-3 text-center text-slate-700 truncate" title={h.agency || ''}>{h.agency || '-'}</td>
                                    <td className="px-2 py-3 text-center text-slate-600 whitespace-nowrap truncate" title={`${h.creator_name || '-'} (${h.creator_dept || '-'})`}>
                                      {h.creator_name || '-'}
                                      <span className="text-[9px] text-slate-400 font-bold"> ({h.creator_dept || '-'})</span>
                                    </td>
                                    <td className="px-2 py-3 text-center font-mono text-slate-500 whitespace-nowrap">
                                      {h.createdAt ? getKSTDateString(h.createdAt) : '-'}
                                    </td>
                                    {canEditCurrent && (
                                      <td className="px-2 py-3 text-center">
                                        <button type="button" onClick={() => handleOpenHistoryDetail(h)} className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-900 hover:text-white transition-colors shadow-sm whitespace-nowrap">상세/수정</button>
                                      </td>
                                    )}
                                  </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {totalHistoryPages > 1 && (
                          <div className="flex justify-center gap-1.5 mt-6">
                            {Array.from({ length: totalHistoryPages }).map((_, i) => (
                              <button type="button" key={i} onClick={() => setHistoryPage(i + 1)} className={`w-7 h-7 rounded-lg text-[11px] font-black transition-all border ${historyPage === i + 1 ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100 shadow-sm'}`}>{i + 1}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
  
                  {activeSubTab === 'PRODUCT' && (
                    <div className="space-y-6 animate-in fade-in duration-300">
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-[11px] font-bold text-slate-500">장비 운영을 위한 메뉴얼 및 규격/인증 문서를 통합 보관합니다.</p>
                      </div>
  
                      <div className="space-y-2 mb-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                         <label className="font-black text-[11px] text-slate-800 block mb-2">📍 제품 보관위치</label>
                         {isEditingDetail ? (
                           <input type="text" value={editFormData.purpose || ''} onChange={e => setEditFormData({...editFormData, purpose: e.target.value})} placeholder="예: 3층 창고 A구역" className="w-full p-4 border border-slate-200 rounded-xl text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-100 shadow-inner bg-slate-50 transition-all" />
                         ) : (
                           <div className="w-full p-5 bg-slate-50 border border-slate-100 rounded-xl text-[11px] font-bold text-slate-600">{currentEq.purpose || '지정된 보관 위치가 없습니다.'}</div>
                         )}
                      </div>
  
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {renderFileSection('📖 메뉴얼 업로드', 'manual_url')}
                        {renderFileSection('📄 시험성적서 업로드', 'cert_url')}
                        {renderFileSection('📎 기타 부속 파일', 'etc_url')}
                      </div>
  
                      <div className="space-y-2 mt-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                        <label className="font-black text-[11px] text-slate-800 block mb-2">📝 추가 정보 (특이사항 / 주의사항)</label>
                        {isEditingDetail ? (
                          <textarea value={editFormData.etc_memo || ''} onChange={e => setEditFormData({...editFormData, etc_memo: e.target.value})} placeholder="제품에 관련된 추가 정보나 주의사항을 자유롭게 기재하세요." className="w-full p-4 border border-slate-200 rounded-xl text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-100 min-h-[120px] shadow-inner bg-slate-50 transition-all resize-none" />
                        ) : (
                          <div className="w-full p-5 bg-slate-50 border border-slate-100 rounded-xl text-[11px] font-bold min-h-[120px] whitespace-pre-wrap leading-relaxed text-slate-600">{currentEq.etc_memo || '기재된 내용이 없습니다.'}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 감사 정보 — 목록/썸네일 미표시, 상세 팝업 하단만. selectedEq 기준(수정 폼에 끌려가지 않음) */}
              {!String(selectedEq?.id || '').startsWith('NEW-') && (
                <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 text-[10px] font-bold text-slate-500 flex flex-wrap gap-x-6 gap-y-2">
                  <span>
                    최초등록{' '}
                    <strong className="text-slate-800">
                      {selectedEq.creator_name || '-'}
                      {selectedEq.creator_dept ? ` (${selectedEq.creator_dept})` : ''}
                    </strong>
                    {' · '}
                    {selectedEq.createdAt ? getKSTDateString(selectedEq.createdAt) : '-'}
                  </span>
                  {(selectedEq.updated_by_name || selectedEq.updatedAt) && (
                    <span>
                      최종변경{' '}
                      <strong className="text-slate-800">
                        {selectedEq.updated_by_name || '-'}
                        {selectedEq.updated_by_dept ? ` (${selectedEq.updated_by_dept})` : ''}
                      </strong>
                      {' · '}
                      {selectedEq.updatedAt ? getKSTDateString(selectedEq.updatedAt) : '-'}
                    </span>
                  )}
                  {(selectedEq.archived_by_name || selectedEq.archived_at) && selectedEq.status !== '정상' && (
                    <span>
                      폐기처리{' '}
                      <strong className="text-red-700">
                        {selectedEq.archived_by_name || '-'}
                        {selectedEq.archived_by_dept ? ` (${selectedEq.archived_by_dept})` : ''}
                      </strong>
                      {' · '}
                      {selectedEq.archived_at
                        ? getKSTDateString(selectedEq.archived_at)
                        : selectedEq.last_replace_date
                          ? getKSTDateString(selectedEq.last_replace_date)
                          : '-'}
                    </span>
                  )}
                </div>
              )}
  
            </div>
          </div>
        </div>
      )}
  
      {/* 신규 이력 등록 모달 */}
      {showAddHistoryModal && (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center">
              <h3 className="font-black text-sm tracking-widest flex items-center gap-2"><span>➕</span> 신규 검교정 이력 등록</h3>
              <button type="button" onClick={() => setShowAddHistoryModal(false)} className="text-xl opacity-70 hover:opacity-100 transition-opacity">✕</button>
            </div>
            <div className="p-8 space-y-5 text-[11px] font-bold text-slate-700 bg-slate-50">
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-1.5"><label className="text-slate-500 uppercase tracking-widest block">검교정요청일</label><input type="date" max="9999-12-31" value={historyFormData.calib_request_date} onChange={e=>setHistoryFormData({...historyFormData, calib_request_date: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 bg-white shadow-inner transition-all" /></div>
                <div className="space-y-1.5"><label className="text-slate-500 uppercase tracking-widest block">검교정확정일</label><input type="date" max="9999-12-31" value={historyFormData.calib_date} onChange={e=>setHistoryFormData({...historyFormData, calib_date: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 bg-white shadow-inner transition-all" /></div>
              </div>
              <div className="space-y-1.5"><label className="text-slate-500 uppercase tracking-widest block">교정기관 *</label><input type="text" value={historyFormData.agency} onChange={e=>setHistoryFormData({...historyFormData, agency: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 bg-white shadow-inner transition-all" placeholder="교정기관명 입력" /></div>
              <div className="space-y-1.5">
                <label className="text-slate-500 uppercase tracking-widest block">검교정 상세 내용 및 메모</label>
                <textarea value={historyFormData.content} onChange={e=>setHistoryFormData({...historyFormData, content: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 min-h-[100px] bg-white shadow-inner transition-all resize-none" placeholder="상세 내용 기재" />
              </div>
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-1.5"><label className="text-slate-500 uppercase tracking-widest block">최종 견적금액</label><input type="number" value={historyFormData.cost} onChange={e=>setHistoryFormData({...historyFormData, cost: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 bg-white shadow-inner transition-all text-emerald-600 font-mono" placeholder="숫자만 입력" /></div>
                <div className="space-y-1.5">
                  <label className="text-slate-500 uppercase tracking-widest block">결과 상태</label>
                  <select value={normalizeCalibResult(historyFormData.result)} onChange={e=>setHistoryFormData({...historyFormData, result: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 bg-white shadow-inner transition-all text-indigo-600 font-black">
                    <option value="진행중">진행중</option>
                    <option value="적합">적합</option>
                    <option value="부적합">부적합</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-5 pt-3 border-t border-slate-200 mt-2">
                <div className="space-y-2">
                  <label className="text-slate-500 uppercase tracking-widest block">견적서 파일 업로드</label>
                  <input type="file" onChange={(e) => handleFileUpload(e, 'estimate_url', true)} className="w-full text-[10px] file:bg-white file:border border-slate-200 file:rounded-lg file:px-3 file:py-1.5 file:font-black file:text-slate-600 cursor-pointer" />
                  <p className="text-[9px] text-slate-400 font-bold">※ 최대 {MAX_UPLOAD_LABEL}</p>
                  {parseFileData(historyFormData.estimate_url)?.name && <div className="text-[10px] text-blue-500 mt-1 font-black truncate">등록됨: {parseFileData(historyFormData.estimate_url).name}</div>}
                </div>
                <div className="space-y-2">
                  <label className="text-slate-500 uppercase tracking-widest block">결과성적서 파일 업로드</label>
                  <input type="file" onChange={(e) => handleFileUpload(e, 'cert_file_url', true)} className="w-full text-[10px] file:bg-white file:border border-slate-200 file:rounded-lg file:px-3 file:py-1.5 file:font-black file:text-slate-600 cursor-pointer" />
                  <p className="text-[9px] text-slate-400 font-bold">※ 최대 {MAX_UPLOAD_LABEL}</p>
                  {parseFileData(historyFormData.cert_file_url)?.name && <div className="text-[10px] text-indigo-500 mt-1 font-black truncate">등록됨: {parseFileData(historyFormData.cert_file_url).name}</div>}
                </div>
              </div>
            </div>
            <div className="p-5 bg-white border-t border-slate-100 flex gap-3">
              <button type="button" onClick={() => setShowAddHistoryModal(false)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-black hover:bg-slate-200 transition-colors uppercase tracking-widest text-[11px]">취소</button>
              <button type="button" onClick={handleSaveHistory} className="flex-[2] py-3.5 bg-indigo-600 text-white rounded-xl font-black shadow-lg hover:bg-indigo-700 active:scale-95 transition-all uppercase tracking-widest text-[11px]">등록 완료하기</button>
            </div>
          </div>
        </div>
      )}
  
      {/* 장비 폐기 모달 */}
      {showArchiveModal && (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white w-[500px] border shadow-2xl p-8 rounded-[2rem] font-bold animate-in zoom-in duration-200">
            <h4 className="text-sm font-black uppercase border-b pb-3 mb-6 tracking-widest text-red-600 flex items-center gap-2"><span>🚨</span> 장비 폐기 및 폐기함 이동</h4>
            <div className="space-y-5">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                 <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest">대상 장비</p>
                 <p className="text-sm font-black text-slate-800">{selectedEq?.name} <span className="text-blue-600 ml-1">[{displayAssetNo(selectedEq?.asset_no)}]</span></p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-widest">폐기 수량 (최대: {selectedEq?.qty})</label><input type="number" value={archiveFormData.qty} onChange={e => setArchiveFormData({...archiveFormData, qty: Number(e.target.value)})} max={selectedEq?.qty} min={1} className="w-full p-3 bg-white border rounded-xl outline-none focus:border-red-500 font-black shadow-inner" /></div>
                <div><label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-widest">최종 상태</label><select value={archiveFormData.status} onChange={e => setArchiveFormData({...archiveFormData, status: e.target.value})} className="w-full p-3 bg-white border rounded-xl outline-none focus:border-red-500 font-black shadow-inner"><option value="폐기">폐기</option><option value="반납">반납</option><option value="기타">기타</option></select></div>
              </div>
              <div><label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-widest">폐기 사유 *</label><textarea value={archiveFormData.reason} onChange={e => setArchiveFormData({...archiveFormData, reason: e.target.value})} placeholder="사유를 명확히 기재하세요." className="w-full h-28 bg-white border border-slate-200 p-4 text-[11px] rounded-xl font-bold shadow-inner outline-none focus:border-red-500 resize-none" /></div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={() => setShowArchiveModal(false)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl text-[11px] uppercase tracking-widest hover:bg-slate-200 transition-colors font-black">취소</button>
              <button type="button" onClick={executeArchive} className="flex-[2] py-3.5 bg-red-600 text-white rounded-xl shadow-md hover:bg-red-700 transition-all text-[11px] uppercase tracking-widest font-black active:scale-95">폐기함으로 이동</button>
            </div>
          </div>
        </div>
      )}
  
      {/* 이력 상세보기 / 수정 / 삭제 모달 */}
      {selectedHistoryDetail && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in duration-200 border">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center">
              <h3 className="font-black text-sm tracking-widest">📄 검교정 이력 상세 {isEditingHistory && '[수정]'}</h3>
              <div className="flex gap-3 items-center">
                {/* 🚀 canEditCurrent 버튼 그룹 통제교체 */}
                {canEditCurrent && (
                  !isEditingHistory ? (
                    <>
                      <button type="button" onClick={() => setIsEditingHistory(true)} className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-[10px] font-black transition-colors shadow-sm">✏️ 수정</button>
                      <button type="button" onClick={() => handleDeleteHistory(selectedHistoryDetail.id)} className="px-3 py-1.5 bg-red-500/90 hover:bg-red-500 rounded-lg text-[10px] font-black transition-colors shadow-sm">🗑️ 삭제</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setIsEditingHistory(false); setHistoryFormData({ ...selectedHistoryDetail, calib_date: selectedHistoryDetail.calib_date?.split('T')[0] || '' }); }} className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-[10px] font-black transition-colors">취소</button>
                      <button type="button" onClick={handleUpdateHistory} className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 rounded-lg text-[10px] font-black transition-colors shadow-sm text-white">💾 저장</button>
                    </>
                  )
                )}
                <div className="w-px h-6 bg-white/30 mx-1"></div>
                <button type="button" onClick={() => setSelectedHistoryDetail(null)} className="text-xl opacity-70 hover:opacity-100 transition-opacity">✕</button>
              </div>
            </div>
            <div className="p-8 space-y-5 text-[11px] font-bold text-slate-700 bg-slate-50">
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-slate-500 uppercase tracking-widest block">검교정요청일</label>
                  {isEditingHistory ? (
                    <input type="date" max="9999-12-31" value={historyFormData.calib_request_date || ''} onChange={e=>setHistoryFormData({...historyFormData, calib_request_date: e.target.value})} className="w-full p-3 bg-white border border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-100 outline-none transition-all" />
                  ) : (
                    <div className="w-full p-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-black text-slate-800">{historyFormData.calib_request_date ? historyFormData.calib_request_date.split('T')[0] : '-'}</div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-slate-500 uppercase tracking-widest block">검교정일확정일</label>
                  {isEditingHistory ? (
                    <input type="date" max="9999-12-31" value={historyFormData.calib_date} onChange={e=>setHistoryFormData({...historyFormData, calib_date: e.target.value})} className="w-full p-3 bg-white border border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-100 outline-none transition-all" />
                  ) : (
                    <div className="w-full p-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-black text-slate-800">{historyFormData.calib_date}</div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-slate-500 uppercase tracking-widest block">교정기관</label>
                {isEditingHistory ? (
                  <input type="text" value={historyFormData.agency} onChange={e=>setHistoryFormData({...historyFormData, agency: e.target.value})} className="w-full p-3 bg-white border border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="교정기관명" />
                ) : (
                  <div className="w-full p-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-black text-slate-800">{historyFormData.agency}</div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-slate-500 uppercase tracking-widest block">검교정 상세 내용 및 메모</label>
                {isEditingHistory ? (
                  <textarea value={historyFormData.content || ''} onChange={e=>setHistoryFormData({...historyFormData, content: e.target.value})} className="w-full p-3 bg-white border border-indigo-200 rounded-xl min-h-[100px] focus:ring-2 focus:ring-indigo-100 outline-none transition-all resize-none" placeholder="상세 내용" />
                ) : (
                  <div className="w-full p-4 bg-white border border-slate-200 rounded-xl shadow-sm min-h-[100px] whitespace-pre-wrap leading-relaxed">{historyFormData.content || '-'}</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-slate-500 uppercase tracking-widest block">최종 견적금액</label>
                  {isEditingHistory ? (
                    <input type="number" value={historyFormData.cost || ''} onChange={e=>setHistoryFormData({...historyFormData, cost: e.target.value})} className="w-full p-3 bg-white border border-indigo-200 rounded-xl text-emerald-600 font-mono focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="숫자만 입력" />
                  ) : (
                    <div className="w-full p-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-black text-emerald-600 font-mono">{historyFormData.cost ? Number(historyFormData.cost).toLocaleString() + '원' : '-'}</div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-slate-500 uppercase tracking-widest block">결과 상태</label>
                  {isEditingHistory ? (
                    <select value={normalizeCalibResult(historyFormData.result)} onChange={e=>setHistoryFormData({...historyFormData, result: e.target.value})} className="w-full p-3 bg-white border border-indigo-200 rounded-xl text-indigo-600 font-black focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                      <option value="진행중">진행중</option>
                      <option value="적합">적합</option>
                      <option value="부적합">부적합</option>
                    </select>
                  ) : (
                    <div className={`w-full p-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-black ${normalizeCalibResult(historyFormData.result) === '적합' ? 'text-emerald-600' : normalizeCalibResult(historyFormData.result) === '부적합' ? 'text-red-600' : 'text-indigo-600'}`}>{normalizeCalibResult(historyFormData.result)}</div>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-5 pt-5 border-t border-slate-200 mt-4">
                <div className="space-y-2 bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col">
                  <label className="text-slate-500 uppercase tracking-widest text-[10px] block mb-1">
                    {isEditingHistory ? '견적서 파일 업로드' : '견적서 다운로드'}
                  </label>
                  {isEditingHistory ? (
                    <>
                      <input
                        type="file"
                        onChange={(e) => handleFileUpload(e, 'estimate_url', true)}
                        className="w-full text-[10px] file:bg-white file:border border-slate-200 file:rounded-lg file:px-3 file:py-1.5 file:font-black file:text-slate-600 cursor-pointer"
                      />
                      <p className="text-[9px] text-slate-400 font-bold">※ 최대 {MAX_UPLOAD_LABEL}</p>
                      {parseFileData(historyFormData.estimate_url)?.name ? (
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="text-[10px] text-blue-500 font-black truncate">
                            등록됨: {parseFileData(historyFormData.estimate_url).name}
                          </span>
                          <button
                            type="button"
                            onClick={() => setHistoryFormData({ ...historyFormData, estimate_url: '' })}
                            className="shrink-0 text-[9px] text-red-500 font-black hover:underline"
                          >
                            삭제
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-bold">등록된 견적서가 없습니다.</span>
                      )}
                    </>
                  ) : (
                    <div>
                      {parseFileData(historyFormData.estimate_url)?.name ? (
                        <span onClick={() => handleDirectDownload(historyFormData.estimate_url)} className="text-[12px] font-black text-blue-600 cursor-pointer hover:underline truncate block">📄 {parseFileData(historyFormData.estimate_url).name}</span>
                      ) : <span className="text-[10px] text-slate-400 font-bold">등록된 견적서가 없습니다.</span>}
                    </div>
                  )}
                </div>
                <div className="space-y-2 bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col">
                  <label className="text-slate-500 uppercase tracking-widest text-[10px] block mb-1">
                    {isEditingHistory ? '결과성적서 파일 업로드' : '성적서 다운로드'}
                  </label>
                  {isEditingHistory ? (
                    <>
                      <input
                        type="file"
                        onChange={(e) => handleFileUpload(e, 'cert_file_url', true)}
                        className="w-full text-[10px] file:bg-white file:border border-slate-200 file:rounded-lg file:px-3 file:py-1.5 file:font-black file:text-slate-600 cursor-pointer"
                      />
                      <p className="text-[9px] text-slate-400 font-bold">※ 최대 {MAX_UPLOAD_LABEL}</p>
                      {parseFileData(historyFormData.cert_file_url)?.name ? (
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="text-[10px] text-indigo-500 font-black truncate">
                            등록됨: {parseFileData(historyFormData.cert_file_url).name}
                          </span>
                          <button
                            type="button"
                            onClick={() => setHistoryFormData({ ...historyFormData, cert_file_url: '' })}
                            className="shrink-0 text-[9px] text-red-500 font-black hover:underline"
                          >
                            삭제
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-bold">등록된 성적서가 없습니다.</span>
                      )}
                    </>
                  ) : (
                    <div>
                      {parseFileData(historyFormData.cert_file_url)?.name ? (
                        <span onClick={() => handleDirectDownload(historyFormData.cert_file_url)} className="text-[12px] font-black text-indigo-600 cursor-pointer hover:underline truncate block">📄 {parseFileData(historyFormData.cert_file_url).name}</span>
                      ) : <span className="text-[10px] text-slate-400 font-bold">등록된 성적서가 없습니다.</span>}
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-[10px] font-bold text-slate-500">
                등록자{' '}
                <strong className="text-slate-800">
                  {selectedHistoryDetail?.creator_name || '-'}
                  {selectedHistoryDetail?.creator_dept
                    ? ` (${selectedHistoryDetail.creator_dept})`
                    : ''}
                </strong>
                {' · '}
                등록일{' '}
                <strong className="text-slate-800">
                  {selectedHistoryDetail?.createdAt
                    ? getKSTDateString(selectedHistoryDetail.createdAt)
                    : '-'}
                </strong>
              </div>
            </div>
            {!isEditingHistory && (
              <div className="p-4 bg-white border-t border-slate-100">
                 <button type="button" onClick={() => setSelectedHistoryDetail(null)} className="w-full py-3.5 bg-slate-900 text-white font-black text-[11px] rounded-xl hover:bg-black transition-colors uppercase tracking-widest shadow-md">닫기</button>
              </div>
            )}
          </div>
        </div>
      )}
  
   {/* 일괄 QR 인쇄 모달 */}
   {bulkPrintAssets.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/90 z-[600] flex flex-col p-8 overflow-y-auto print:p-0 print:bg-white" onClick={() => setBulkPrintAssets([])}>
          <div className="max-w-5xl w-full mx-auto bg-white rounded-[2rem] p-8 shadow-2xl print:shadow-none print:rounded-none print:p-0" onClick={e => e.stopPropagation()}>

            <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-4 print:hidden">
              <div>
                <h2 className="text-xl font-black text-slate-800">🖨️ 한국폼텍 28칸 정사각 QR 라벨 발행 센터</h2>
                <p className="text-slate-500 text-xs font-bold mt-1">드림디포 구매 규격 [QR-3990] 적용 (40mm × 40mm 정사각형) | 총 {bulkPrintAssets.length}개의 라벨</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={!bulkQrReady} onClick={() => window.print()} className={`px-6 py-2 font-black rounded-xl shadow-md flex items-center gap-2 text-xs transition-colors ${bulkQrReady ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}><span>🖨️</span> {bulkQrReady ? '라벨 인쇄 실행 (Ctrl+P)' : 'QR 생성 중…'}</button>
                <button type="button" onClick={() => setBulkPrintAssets([])} className="px-6 py-2 bg-slate-100 text-slate-600 font-black rounded-xl hover:bg-slate-200 text-xs">닫기</button>
              </div>
            </div>

            <div className="equipment-formtec-page bg-white p-0 relative" style={{ width: '210mm', minHeight: '297mm', margin: '0 auto', boxSizing: 'border-box' }}>
              <div className="text-center font-black text-slate-800 text-xs mb-4 print:hidden bg-indigo-50 border border-indigo-100 py-2.5 rounded-xl max-w-[190mm] mx-auto">
                📍 한국폼텍 28칸 기본 (드림디포 QR-3990 전용 4열 × 7행 정사각 매핑 완료) <br/>
                <span className="text-[10px] text-indigo-500 font-medium font-sans mt-0.5 block">※ 화면에 보이는 회색 점선은 인쇄 시 출력되지 않는 안전 가이드 칼선입니다.</span>
              </div>

              <div className="max-w-[190mm] mx-auto mb-4 print:hidden bg-blue-50 border-2 border-blue-200 p-4 rounded-2xl text-left">
                <p className="text-center font-black text-slate-800 text-[13px] mb-2">📍 한국폼텍 28칸 정사각 [QR-3990] 전용 출력 가이드</p>
                <div className="grid grid-cols-3 gap-2 text-[10px] font-black text-blue-900 border-t border-blue-200 pt-2 bg-white/60 p-2 rounded-xl">
                  <div className="border-r border-blue-100 pr-2">무조건 <span className="text-red-600 font-bold">"실제 크기 (100%)"</span></div>
                  <div className="border-r border-blue-100 px-2">무조건 <span className="text-red-600 font-bold">"여백 없음 (None)"</span></div>
                  <div className="pl-2"><span className="text-red-600 font-bold">"배경 그래픽"</span> 반드시 체크</div>
                </div>
              </div>

              <div
                className="grid grid-cols-4 print:grid-cols-4"
                style={{
                  width: '185mm',
                  margin: '0 auto',
                  paddingTop: '12mm',
                  paddingLeft: '5mm',
                  columnGap: '4.5mm',
                  rowGap: '1.5mm'
                }}
              >
                {Array.from({ length: Math.max(28, Math.ceil(bulkPrintAssets.length / 4) * 4) }).map((_, idx) => {
                  const a = bulkPrintAssets[idx];
                  if (!a) return <div key={`empty-${idx}`} className="border border-dashed border-slate-200 print:border-none opacity-30 print:opacity-0" style={{ width: '40mm', height: '40mm', boxSizing: 'border-box' }} />;

                  return (
                    <div
                      key={a.id}
                      className="flex flex-col justify-between bg-white overflow-hidden relative border border-dashed border-slate-200 print:border-none print:break-inside-avoid text-center"
                      style={{ width: '40mm', height: '40mm', padding: '2.5mm 2mm 2mm 2mm', boxSizing: 'border-box' }}
                    >
                      <div className="w-full space-y-0.5">
                        <div className="flex justify-center items-center gap-1">
                          <span className="text-[7px] font-black bg-slate-900 text-white px-1.5 py-0.5 rounded-full leading-none">장비</span>
                          <span className="text-[7px] font-black text-slate-700 truncate max-w-[26mm]">{a.name}</span>
                        </div>
                        <p className="text-[8px] font-black text-slate-900 truncate tracking-tight">{a.model_name || '모델명 미상'}</p>
                      </div>
                      <div className="w-full flex justify-center items-center my-0.5">
                        {bulkQrMap[a.id] ? (
                          <img src={bulkQrMap[a.id]} alt="QR" className="w-[20mm] h-[20mm] object-contain" />
                        ) : (
                          <div className="w-[20mm] h-[20mm] flex items-center justify-center bg-slate-50 text-[6px] font-bold text-slate-400 animate-pulse">생성 중…</div>
                        )}
                      </div>
                      <div className="w-full">
                        <p className="text-[9px] font-black font-mono tracking-tighter text-indigo-700 leading-none">{displayAssetNo(a.asset_no)}</p>
                        <p className="text-[6.5px] font-bold text-slate-400 truncate mt-0.5 scale-90">{a.department || '공용'} · <span className="text-amber-700 font-black">사내 Wi-Fi 스캔</span></p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <style jsx global>{`
            @media print {
              body * { visibility: hidden; }
              .equipment-formtec-page, .equipment-formtec-page * { visibility: visible; }
              .equipment-formtec-page { position: absolute; left: 0; top: 0; width: 210mm; height: 297mm; background: white !important; }
              @page { size: A4 portrait; margin: 0; }
            }
          `}</style>
        </div>
      )}
  
      {/* 장비 개별 QR 보기 팝업 */}
      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4" onClick={() => setShowQrModal(null)}>
          <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center mb-4">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">장비 QR 라벨</h3>
              <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-[10px] font-black">실제 출력 미리보기</span>
            </div>

            {/* 실제 인쇄되는 40mm 정사각 라벨과 동일한 형태 (화면용 확대) */}
            <div
              className="flex flex-col justify-between bg-white border-2 border-dashed border-slate-300 rounded-lg text-center mb-4"
              style={{ width: '260px', height: '260px', padding: '14px 12px 12px 12px', boxSizing: 'border-box' }}
            >
              <div className="w-full space-y-1">
                <div className="flex justify-center items-center gap-1.5">
                  <span className="text-[11px] font-black bg-slate-900 text-white px-2 py-0.5 rounded-full leading-none">장비</span>
                  <span className="text-[12px] font-black text-slate-700 truncate max-w-[170px]">{showQrModal.name}</span>
                </div>
                <p className="text-[13px] font-black text-slate-900 truncate tracking-tight">{showQrModal.model_name || '모델명 미상'}</p>
              </div>
              <div className="w-full flex justify-center items-center my-1">
                <EquipmentQrImage
                  equipmentId={showQrModal.id}
                  size={150}
                  alt="Asset QR Code"
                  className="w-[130px] h-[130px] object-contain"
                />
              </div>
              <div className="w-full">
                <p className="text-[15px] font-black font-mono tracking-tighter text-indigo-700 leading-none">{displayAssetNo(showQrModal.asset_no)}</p>
                <p className="text-[10px] font-bold text-slate-400 truncate mt-1">{showQrModal.department || '공용'} · <span className="text-amber-700 font-black">사내 Wi-Fi 스캔</span></p>
              </div>
            </div>

            <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-center">
              <p className="text-[11px] font-black text-amber-800">📡 QR 스캔 안내</p>
              <p className="text-[10px] font-bold text-amber-700 mt-0.5 leading-relaxed">
                스캔 시 <span className="underline decoration-2">로그인 없이</span> 공개 요약 카드가 열립니다.
                <br />
                <span className="font-black">⚠ 반드시 사내 Wi-Fi 연결 후 스캔하세요.</span>
                <br />
                (외부망·LTE에서는 조회되지 않습니다)
              </p>
            </div>
            
            <div className="flex gap-2 w-full">
              <button type="button" onClick={() => setShowQrModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}