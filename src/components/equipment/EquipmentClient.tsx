'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';

export default function EquipmentClient({ categoryId, tabId, currentUser, masterDataList, canEdit }: any) {
  const router = useRouter();

  // Data States
  const [equipments, setEquipments] = useState<any[]>([]);
  const [archives, setArchives] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [historyPage, setHistoryPage] = useState(1);
  const historyItemsPerPage = 5;
  const [archivePage, setArchivePage] = useState(1); 

  // Modals & Forms
  const [selectedEq, setSelectedEq] = useState<any>(null);
  const [activeSubTab, setActiveSubTab] = useState<'CALIB' | 'PRODUCT'>('CALIB');
  const [showQrModal, setShowQrModal] = useState<any>(null);
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});

  // Bulk Print (QR 일괄 출력)
  const [selectedMainIds, setSelectedMainIds] = useState<Set<string>>(new Set());
  const [bulkPrintAssets, setBulkPrintAssets] = useState<any[]>([]);

  // History Modal (신규 이력)
  const [showAddHistoryModal, setShowAddHistoryModal] = useState(false);
  const [historyFormData, setHistoryFormData] = useState<any>({
    calib_request_date: '', calib_date: '', content: '', cost: '', agency: '', result: '진행중', estimate_url: '', cert_file_url: ''
  });
  const [selectedHistories, setSelectedHistories] = useState<Set<string>>(new Set());
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<any>(null);
  const [isEditingHistory, setIsEditingHistory] = useState(false);

  // Archive Modal (폐기함)
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveFormData, setArchiveFormData] = useState({ qty: 1, reason: '', status: '폐기' });
  const [archiveYear, setArchiveYear] = useState('ALL'); 

  useEffect(() => {
    fetchData();
  }, [categoryId, tabId]);

  useEffect(() => {
    setArchivePage(1);
  }, [archiveYear]);

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
      if (unitRes.ok) {
        setUnits(await unitRes.json());
      }
    } catch (error) {
      console.error("Data Fetch Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const displayAssetNo = (no: string) => no?.split('_ARC_')[0] || '-';

  const renderDDay = (targetDate: string | null) => {
    if (!targetDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate); target.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return <span className="text-red-500 font-black px-1.5 py-0.5 rounded bg-red-50 ml-1.5">D-Day</span>;
    if (diffDays > 0) return <span className="text-blue-600 font-black px-1.5 py-0.5 rounded bg-blue-50 ml-1.5">D-{diffDays}</span>;
    return <span className="text-red-600 font-black px-1.5 py-0.5 rounded bg-red-50 ml-1.5">D+{Math.abs(diffDays)}</span>;
  };

  const addMonthsToDateStr = (dateStr: string | null | undefined, months: number | null | undefined) => {
    if (!dateStr || !months) return null;
    const d = new Date(dateStr); d.setMonth(d.getMonth() + Number(months));
    return d.toISOString().split('T')[0];
  };

  const getLatestCalibDate = (histories: any[]) => {
    if (!histories || histories.length === 0) return null;
    return [...histories].sort((a, b) => new Date(b.calib_date).getTime() - new Date(a.calib_date).getTime())[0].calib_date?.split('T')[0] || null;
  };

  const parseFileData = (str: string | null) => { try { return str ? JSON.parse(str) : null; } catch { return null; } };

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

  // 🚀 QR 일괄 출력 (기능 보완)
  const openBulkQRPrint = () => {
    const targetAssets = equipments.filter(a => selectedMainIds.has(a.id));
    if (targetAssets.length === 0) return alert('출력할 자산을 좌측 체크박스로 선택해주세요.');
    setBulkPrintAssets(targetAssets);
  };

  const executePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return alert('팝업 차단이 설정되어 있습니다. 해제해주세요.');
    const labelsHtml = bulkPrintAssets.map(a => `
      <div class="label-item">
        <img class="qr-img" src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`https://kpc-asset.vercel.app/equipment/verify?id=${a.asset_no}`)}" />
        <div class="asset-code">${displayAssetNo(a.asset_no)}</div>
        <div class="asset-type">${a.name}</div>
      </div>
    `).join('');
    printWindow.document.write(`
      <!DOCTYPE html><html lang="ko"><head><title>QR 라벨 일괄 인쇄</title>
      <style>
        @page { size: A4; margin: 10mm 15mm; }
        body { font-family: 'Malgun Gothic', sans-serif; margin: 0; padding: 0; background: white; }
        .label-container { display: grid; grid-template-columns: repeat(5, 1fr); width: 100%; }
        .label-item { width: 36mm; height: 45mm; border: 1px dashed #ccc; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1mm; box-sizing: border-box; }
        .qr-img { width: 23mm; height: 23mm; margin-bottom: 2mm; object-fit: contain; background: white; padding: 1px; }
        .asset-code { font-size: 8.5pt; font-weight: 900; text-align: center; margin: 0; line-height: 1.1; word-break: break-all; }
        .asset-type { font-size: 6pt; font-weight: 600; color: #555; text-align: center; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 90%; }
      </style></head><body><div class="label-container">${labelsHtml}</div>
      <script>window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 500); };</script></body></html>
    `);
    printWindow.document.close();
  };

  const handleOpenDetail = (eq: any) => {
    setSelectedEq(eq);
    setEditFormData({ ...eq });
    setIsEditingDetail(false);
    setActiveSubTab('CALIB');
    setSelectedHistories(new Set());
    setHistoryPage(1);
  };

  // 🚀 활성장비 엑셀 다운로드
  const handleExportExcel = () => {
    const targetAssets = selectedMainIds.size > 0 ? equipments.filter(a => selectedMainIds.has(a.id)) : equipments;
    if (targetAssets.length === 0) return alert('다운로드할 데이터가 없습니다.');
    const exportData = targetAssets.map((a, idx) => {
      const lCalib = getLatestCalibDate(a.histories);
      const nCalib = addMonthsToDateStr(lCalib, a.calib_cycle_mo);
      return {
        'NO': idx + 1, '자산번호': displayAssetNo(a.asset_no), '품목명': a.name, '제조사': a.brand || '-', '모델명/시리얼넘버': a.model_name,
        '보유개수': a.qty, '제품사양': a.spec_summary || '-', '검교정예정일': nCalib ? nCalib : '-', '장비관리소속': a.department || '-'
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "활성장비목록");
    XLSX.writeFile(wb, `장비목록_${categoryId}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // 🚀 폐기함(Archive) 엑셀 다운로드 로직 추가!
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
        '품목명': arc.name,
        '개수': arc.qty,
        '사유': reasonText,
        '관리소속': arc.department || '-',
        '상태': arc.status
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "장비폐기함");
    XLSX.writeFile(wb, `장비폐기함_${categoryId}_${archiveYear}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleAddEq = () => {
    const today = new Date().toISOString().split('T')[0];
    const newEq = {
      id: `NEW-${Date.now()}`, asset_no: '', name: '', brand: '', model_name: '', qty: 1, spec_summary: '', department: currentUser?.unit?.unit_name || '',
      purchase_date: today, replace_cycle_mo: 0, last_replace_date: today, calib_cycle_mo: 12, calib_memo: '', thumbnail_url: '', histories: [], purpose: '', next_calib_date: null
    };
    setSelectedEq(newEq); setEditFormData({ ...newEq }); setIsEditingDetail(true); setActiveSubTab('CALIB');
  };

  const handleSaveEq = async () => {
    try {
      const { histories, next_replace_date, createdAt, updatedAt, ...safeData } = editFormData;
      const isNew = safeData.id.startsWith('NEW-');
      const payload = isNew ? { ...safeData, id: undefined, category: categoryId, status: '정상' } : safeData;

      const res = await fetch('/api/equipment', { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) { 
        alert(isNew ? '등록 완료' : '수정 완료'); 
        setIsEditingDetail(false); 
        const updatedEqRes = await res.json();
        setSelectedEq(updatedEqRes);
        fetchData(); 
      }
      else { alert(`저장 실패`); }
    } catch (e) { alert('네트워크 오류'); }
  };

  const handleOpenArchiveModal = () => {
    setArchiveFormData({ qty: selectedEq.qty, reason: '', status: '폐기' });
    setShowArchiveModal(true);
  };

  const executeArchive = async () => {
    if (!archiveFormData.reason.trim()) return alert('사유를 입력해 주세요.');
    if (archiveFormData.qty <= 0 || archiveFormData.qty > selectedEq.qty) return alert('수량이 올바르지 않습니다.');

    try {
      const remainingQty = selectedEq.qty - archiveFormData.qty;
      const today = new Date().toISOString();
      
      const archiveMemoObj = {
        originalMemo: selectedEq.etc_memo || '',
        archiveReason: archiveFormData.reason
      };

      if (remainingQty === 0) {
        await fetch('/api/equipment', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedEq.id,
            status: archiveFormData.status,
            etc_memo: JSON.stringify(archiveMemoObj),
            last_replace_date: today 
          })
        });
      } else {
        await fetch('/api/equipment', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedEq.id, qty: remainingQty })
        });

        const res = await fetch('/api/equipment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: categoryId, name: selectedEq.name, brand: selectedEq.brand, model_name: selectedEq.model_name,
            asset_no: `${selectedEq.asset_no}_ARC_${Date.now()}`, qty: archiveFormData.qty, department: selectedEq.department,
            spec_summary: selectedEq.spec_summary
          })
        });
        const newEq = await res.json();

        await fetch('/api/equipment', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newEq.id, status: archiveFormData.status, etc_memo: JSON.stringify(archiveMemoObj), last_replace_date: today
          })
        });
      }

      alert('성공적으로 폐기함으로 이동되었습니다.'); 
      setShowArchiveModal(false); 
      setSelectedEq(null); 
      fetchData();
      router.push(`/equipment/main/${categoryId}/archive`);
    } catch (e) { alert('오류 발생'); }
  };

  const handleRestoreArchive = async (arc: any) => {
    if (!confirm('다시 활성 장비 리스트로 복구하시겠습니까?')) return;
    try {
      await fetch('/api/equipment', { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ id: arc.id, status: '정상' }) 
      });
      alert('복구 완료되었습니다.'); fetchData();
    } catch (e) { alert('복구 오류'); }
  };

  const handlePermanentDelete = async (id: string) => {
    if (!confirm('정말 영구 삭제하시겠습니까? 이 작업은 절대 복구할 수 없습니다.')) return;
    try {
      const res = await fetch(`/api/equipment?id=${id}`, { method: 'DELETE' });
      if (res.ok) { alert('영구 삭제되었습니다.'); fetchData(); }
      else { alert('삭제 실패'); }
    } catch(e) { alert('오류 발생'); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: string, isHistory = false) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const fileObj = JSON.stringify({ name: file.name, data: evt.target?.result });
        if (isHistory) {
          setHistoryFormData((prev: any) => ({ ...prev, [field]: fileObj }));
        } else {
          setEditFormData((prev: any) => ({ ...prev, [field]: fileObj }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const openAddHistoryModal = () => {
    setHistoryFormData({ calib_request_date: '', calib_date: '', content: '', cost: '', agency: '', result: '진행중', estimate_url: '', cert_file_url: '' });
    setShowAddHistoryModal(true);
  };

  const handleSaveHistory = async () => {
    if (!historyFormData.calib_date || !historyFormData.agency) return alert('검교정일자와 교정기관은 필수입니다.');
    try {
      const { id, equipment_id, createdAt, updatedAt, ...cleanHistory } = historyFormData;
      const payload = {
        id: selectedEq.id,
        history: { ...cleanHistory, cost: Number(cleanHistory.cost) || 0 }
      };
      
      const res = await fetch('/api/equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert('신규 검교정 이력이 성공적으로 등록되었습니다.');
        setShowAddHistoryModal(false);
        setHistoryFormData({ calib_request_date: '', calib_date: '', content: '', cost: '', agency: '', result: '진행중', estimate_url: '', cert_file_url: '' });
        
        const refreshRes = await fetch(`/api/equipment?categoryCode=${categoryId}`);
        const refreshData = await refreshRes.json();
        const updatedEq = refreshData.find((e: any) => e.id === selectedEq.id);
        
        if (updatedEq) {
          setSelectedEq(updatedEq);
          if (isEditingDetail) setEditFormData(updatedEq);
        }
        fetchData(); 
      } else {
        alert('이력 등록에 실패했습니다.');
      }
    } catch (error) {
      alert('네트워크 오류가 발생했습니다.');
    }
  };

  const handleUpdateHistory = async () => {
    if (!historyFormData.calib_date || !historyFormData.agency) return alert('검교정일자와 교정기관은 필수입니다.');
    try {
      const delRes = await fetch('/api/equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedEq.id, deleteHistoryId: selectedHistoryDetail.id })
      });
      if (!delRes.ok) throw new Error('이력 삭제 중 오류');

      const { id, equipment_id, createdAt, updatedAt, ...cleanHistory } = historyFormData;
      const addRes = await fetch('/api/equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedEq.id, history: { ...cleanHistory, cost: Number(cleanHistory.cost) || 0 } })
      });

      if (addRes.ok) {
        alert('이력이 성공적으로 수정되었습니다.');
        setSelectedHistoryDetail(null);
        setIsEditingHistory(false);
        
        const refreshRes = await fetch(`/api/equipment?categoryCode=${categoryId}`);
        const refreshData = await refreshRes.json();
        const updatedEq = refreshData.find((e: any) => e.id === selectedEq.id);
        
        if (updatedEq) {
          setSelectedEq(updatedEq);
          if (isEditingDetail) setEditFormData(updatedEq);
        }
        fetchData();
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    }
  };

  const handleDeleteHistory = async (historyId: string) => {
    if (!confirm('정말 이 검교정 이력을 삭제하시겠습니까?')) return;
    try {
      const payload = { id: selectedEq.id, deleteHistoryId: historyId };
      const res = await fetch('/api/equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert('이력이 삭제되었습니다.');
        setSelectedHistoryDetail(null);
        
        const refreshRes = await fetch(`/api/equipment?categoryCode=${categoryId}`);
        const refreshData = await refreshRes.json();
        const updatedEq = refreshData.find((e: any) => e.id === selectedEq.id);
        
        if (updatedEq) {
          setSelectedEq(updatedEq);
          if (isEditingDetail) setEditFormData(updatedEq);
        }
        fetchData();
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    }
  };

  const handleOpenHistoryDetail = (history: any) => {
    setSelectedHistoryDetail(history);
    setHistoryFormData({ 
      ...history, 
      calib_request_date: history.calib_request_date?.split('T')[0] || '',
      calib_date: history.calib_date?.split('T')[0] || '' 
    });
    setIsEditingHistory(false);
  };

  const totalPages = Math.max(1, Math.ceil(equipments.length / itemsPerPage));
  const paginatedEquipments = equipments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const availableArchiveYears = useMemo(() => {
    const years = archives.map(h => (h.last_replace_date || h.updatedAt || '').substring(0, 4)).filter(Boolean);
    const unique = Array.from(new Set(years));
    const curYear = new Date().getFullYear().toString();
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
  const nextReplaceDate = addMonthsToDateStr(currentEq?.last_replace_date, currentEq?.replace_cycle_mo);
  const latestCalibDate = getLatestCalibDate(currentEq?.histories);
  const nextCalibDate = addMonthsToDateStr(latestCalibDate, currentEq?.calib_cycle_mo);

  const renderFileSection = (title: string, field: string) => {
    const fileObj = parseFileData(currentEq?.[field]);
    return (
      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 flex flex-col gap-3 shadow-sm relative">
        <div className="flex items-center justify-between">
          <h5 className="font-black text-[11px] text-slate-800 flex items-center gap-1">{title}</h5>
          {isEditingDetail && fileObj?.name && (
            <button type="button" onClick={() => setEditFormData({...editFormData, [field]: ''})} className="text-[10px] text-red-500 hover:text-red-700 hover:bg-red-50 font-black px-2 py-1 rounded transition-colors absolute top-4 right-4">
              ✕ 삭제
            </button>
          )}
        </div>
        {isEditingDetail && (
          <label className="cursor-pointer px-4 py-2 mt-2 border border-dashed border-indigo-300 bg-white text-indigo-600 rounded-lg text-center text-[10px] font-black hover:bg-indigo-50 transition-colors">
            {fileObj?.name ? '다른 파일로 교체하기' : '파일 찾아보기'}
            <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, field)} />
          </label>
        )}
        <div className="mt-auto pt-3 border-t border-slate-200">
          {fileObj?.name ? (
            <span onClick={() => handleDirectDownload(currentEq[field])} className="text-[11px] font-bold text-blue-600 truncate cursor-pointer hover:underline block">📄 {fileObj.name}</span>
          ) : <span className="text-[10px] text-slate-400 block">등록된 파일이 없습니다.</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 font-sans text-slate-900 animate-fade-in relative z-10">
      
      {/* 🚀 상단 컨트롤 헤더 (UI 흔들림 방지 고정 너비) */}
      <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl flex justify-between items-center text-white h-[90px]">
        <div className="w-[340px] shrink-0">
          <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
            <span className="text-2xl">{tabId === 'inventory' ? '🛠️' : '🗑️'}</span> 
            {tabId === 'inventory' ? '통합 장비 현황 (Inventory)' : '장비 폐기함 (Archive)'}
          </h2>
          <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest pl-8">
            Total: {tabId === 'inventory' ? equipments.length : archives.length} Items
          </p>
        </div>

        <div className="flex-1 flex justify-center shrink-0">
          <div className="bg-slate-800 p-1.5 rounded-xl border border-slate-700 flex gap-1 shadow-inner">
            <button 
              onClick={() => router.push(`/equipment/main/${categoryId}/inventory`)} 
              className={`px-6 py-2.5 rounded-lg text-xs font-black transition-all ${tabId === 'inventory' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >활성 장비</button>
            <button 
              onClick={() => router.push(`/equipment/main/${categoryId}/archive`)} 
              className={`px-6 py-2.5 rounded-lg text-xs font-black transition-all ${tabId === 'archive' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >폐기함</button>
          </div>
        </div>

        <div className="w-[340px] shrink-0 flex justify-end gap-2 items-center">
          {tabId === 'inventory' ? (
            <>
              <button onClick={openBulkQRPrint} className="px-4 py-2.5 bg-purple-600/30 border border-purple-500 text-purple-300 rounded-xl text-xs font-black shadow-lg hover:bg-purple-600 hover:text-white transition-all">🖨️ QR 일괄출력</button>
              <button onClick={handleExportExcel} className="px-4 py-2.5 bg-emerald-600/30 border border-emerald-500 text-emerald-300 rounded-xl text-xs font-black shadow-lg hover:bg-emerald-600 hover:text-white transition-all">📊 엑셀</button>
              {canEdit && <button onClick={handleAddEq} className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black shadow-lg hover:bg-blue-500 transition-all">+ 신규 등록</button>}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-xl border border-slate-700 shadow-inner">
                <span className="text-[10px] font-black text-slate-400">🗓️ 연도</span>
                <select value={archiveYear} onChange={(e) => setArchiveYear(e.target.value)} className="bg-transparent text-[11px] font-black text-white outline-none cursor-pointer">
                  <option value="ALL" className="text-slate-900">모두보기 (ALL)</option>
                  {availableArchiveYears.map(year => <option key={year} value={year} className="text-slate-900">{year}년</option>)}
                </select>
              </div>
              {/* 🚀 폐기함 엑셀 다운로드 버튼 복구 */}
              <button onClick={handleExportArchiveExcel} className="px-4 py-2.5 bg-emerald-600/30 border border-emerald-500 text-emerald-300 rounded-xl text-xs font-black shadow-lg hover:bg-emerald-600 hover:text-white transition-all">📊 엑셀</button>
            </>
          )}
        </div>
      </div>

      {/* INVENTORY 뷰 */}
      {tabId === 'inventory' && (
        <div className="bg-white border border-slate-200 shadow-sm rounded-[2rem] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1350px]">
              <thead className="bg-slate-50 text-[10px] text-slate-400 font-black border-b border-slate-200 tracking-tight uppercase">
                <tr>
                  <th className="py-3 px-4 text-center w-12"><input type="checkbox" checked={paginatedEquipments.length > 0 && paginatedEquipments.every(a => selectedMainIds.has(a.id))} onChange={toggleSelectMainAll} className="accent-blue-600 w-3 h-3" /></th>
                  <th className="py-3 px-3 text-center w-12">NO</th>
                  <th className="py-3 px-3 text-center w-16">사진</th>
                  <th className="py-3 px-3 w-28">자산번호</th>
                  <th className="py-3 px-3 w-40">품목명</th>
                  <th className="py-3 px-3 w-28">제조사</th>
                  <th className="py-3 px-3 w-32">모델명/시리얼넘버</th>
                  <th className="py-3 px-3 w-20 text-center">보유개수</th>
                  <th className="py-3 px-3 w-48">제품사양</th>
                  <th className="py-3 px-3 w-28 text-center text-red-500">검교정예정일</th>
                  <th className="py-3 px-3 w-32 text-center text-blue-500">관리소속</th>
                  <th className="py-3 px-3 w-20 text-center">QR</th>
                  <th className="py-3 px-4 w-24 text-center">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedEquipments.length === 0 ? (
                  <tr><td colSpan={13} className="p-10 text-center text-slate-400">등록된 장비 데이터가 없습니다.</td></tr>
                ) : paginatedEquipments.map((eq, idx) => {
                  const lCalib = getLatestCalibDate(eq.histories);
                  const nCalib = addMonthsToDateStr(lCalib, eq.calib_cycle_mo) || eq.next_calib_date?.split('T')[0];

                  return (
                    <tr key={eq.id} className="hover:bg-slate-50 h-12">
                      <td className="text-center"><input type="checkbox" checked={selectedMainIds.has(eq.id)} onChange={(e) => { e.stopPropagation(); const next = new Set(selectedMainIds); next.has(eq.id) ? next.delete(eq.id) : next.add(eq.id); setSelectedMainIds(next); }} className="accent-blue-600 w-3 h-3 cursor-pointer" /></td>
                      <td className="text-center text-slate-400">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                      <td className="text-center">
                        {parseFileData(eq.thumbnail_url)?.data || eq.thumbnail_url ? <img src={parseFileData(eq.thumbnail_url)?.data || eq.thumbnail_url} alt="IMG" className="w-8 h-8 object-cover rounded-md mx-auto border" /> : <div className="w-8 h-8 bg-slate-100 rounded-md mx-auto flex items-center justify-center text-[8px] text-slate-300 border">NO</div>}
                      </td>
                      <td className="px-3 font-black text-slate-900">{displayAssetNo(eq.asset_no)}</td>
                      <td className="px-3 text-blue-700">{eq.name}</td>
                      <td className="px-3">{eq.brand || '-'}</td>
                      <td className="px-3">{eq.model_name}</td>
                      <td className="text-center">{eq.qty} EA</td>
                      <td className="px-3 text-slate-500 truncate max-w-[150px]">{eq.spec_summary || '-'}</td>
                      <td className="text-center font-black">
                        {nCalib ? (
                          <div className="flex items-center justify-center">
                            <span>{nCalib}</span>
                            {renderDDay(nCalib)}
                          </div>
                        ) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="text-center text-slate-600">{eq.department || '-'}</td>
                      <td className="text-center"><button type="button" onClick={(e) => { e.stopPropagation(); setShowQrModal(eq); }} className="px-2 py-1 bg-purple-50 text-purple-600 border border-purple-200 rounded text-[9px] hover:bg-purple-600 hover:text-white transition-colors">QR</button></td>
                      <td className="text-center"><button type="button" onClick={(e) => { e.stopPropagation(); handleOpenDetail(eq); }} className="px-3 py-1.5 bg-slate-800 text-white rounded text-[10px] shadow-sm hover:bg-slate-700 transition-colors">상세보기</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-1.5 p-4 bg-slate-50 border-t border-slate-100">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button type="button" key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-lg text-[11px] font-black border ${currentPage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-500'}`}>{i + 1}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ARCHIVE 뷰 (폐기함) */}
      {tabId === 'archive' && (
        <div className="bg-white border border-slate-200 shadow-sm rounded-[2rem] overflow-hidden animate-in fade-in">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1100px]">
              <thead className="bg-slate-50 text-[10px] text-slate-400 font-black border-b border-slate-200 tracking-tight uppercase">
                <tr>
                  <th className="py-3 px-4 text-center w-12">NO</th>
                  <th className="py-3 px-3 w-28 text-center">처리일자</th>
                  <th className="py-3 px-3 w-28">자산번호</th>
                  <th className="py-3 px-3 w-40">품목명</th>
                  <th className="py-3 px-3 w-20 text-center">개수</th>
                  <th className="py-3 px-3 w-[250px]">사유</th>
                  <th className="py-3 px-3 w-32 text-center text-blue-500">관리소속</th>
                  <th className="py-3 px-3 w-20 text-center">상태</th>
                  <th className="py-3 px-4 w-32 text-center">관리액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
                {paginatedArchives.length === 0 ? (
                  <tr><td colSpan={9} className="p-10 text-center text-slate-400">선택된 기간에 보관/폐기된 장비가 없습니다.</td></tr>
                ) : paginatedArchives.map((arc, idx) => {
                  let reasonText = arc.etc_memo;
                  try {
                    const parsed = JSON.parse(arc.etc_memo);
                    reasonText = parsed.archiveReason || arc.etc_memo;
                  } catch(e) {}

                  return (
                    <tr key={arc.id} className="hover:bg-slate-50 h-12">
                      <td className="text-center text-slate-400">{filteredArchives.length - ((archivePage - 1) * itemsPerPage + idx)}</td>
                      <td className="text-center font-black">{arc.last_replace_date ? arc.last_replace_date.split('T')[0] : arc.updatedAt?.split('T')[0]}</td>
                      <td className="px-3 font-black text-slate-900">{displayAssetNo(arc.asset_no)}</td>
                      <td className="px-3 text-blue-700">{arc.name}</td>
                      <td className="text-center">{arc.qty} EA</td>
                      <td className="px-3 text-slate-500 italic max-w-[250px] truncate" title={reasonText}>"{reasonText}"</td>
                      <td className="text-center text-slate-600">{arc.department || '-'}</td>
                      <td className="text-center"><span className={`px-2 py-0.5 rounded text-[10px] ${arc.status === '폐기' ? 'bg-red-50 text-red-600' : 'bg-slate-200 text-slate-600'}`}>{arc.status}</span></td>
                      <td className="text-center px-4 space-x-1">
                        <button onClick={() => handleRestoreArchive(arc)} className="px-2 py-1 bg-white border border-slate-300 text-slate-700 rounded text-[9px] font-black hover:bg-slate-900 hover:text-white transition-all shadow-sm">🔄 복구</button>
                        <button onClick={() => handlePermanentDelete(arc.id)} className="px-2 py-1 bg-red-50 border border-red-200 text-red-600 rounded text-[9px] font-black hover:bg-red-500 hover:text-white transition-all shadow-sm">✕ 영구삭제</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalArchivePages > 1 && (
            <div className="flex justify-center gap-1.5 p-4 bg-slate-50 border-t border-slate-100">
              {Array.from({ length: totalArchivePages }).map((_, i) => (
                <button type="button" key={i} onClick={() => setArchivePage(i + 1)} className={`w-8 h-8 rounded-lg text-[11px] font-black border ${archivePage === i + 1 ? 'bg-slate-800 text-white' : 'bg-white text-slate-500'}`}>{i + 1}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 🚀 상세보기 및 수정 모달 */}
      {selectedEq && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex items-center justify-center p-6" onClick={() => setSelectedEq(null)}>
          <div className="bg-slate-50 w-full max-w-6xl h-[90vh] rounded-[2rem] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 px-8 bg-slate-900 text-white flex justify-between items-center shrink-0">
               <div>
                 <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest mb-1">Equipment Detail Hub {isEditingDetail && ' [편집 모드]'}</p>
                 <h3 className="font-black text-xl">{currentEq.name || '신규 장비'} <span className="text-sm font-medium text-slate-400 ml-2">[{displayAssetNo(currentEq.asset_no) || '번호생성전'}]</span></h3>
               </div>
               <div className="flex gap-3 items-center">
                 {canEdit && !isEditingDetail && (
                   <>
                     <button onClick={() => setIsEditingDetail(true)} className="px-4 py-2 bg-slate-700 rounded-xl text-[11px] font-black transition-all hover:bg-slate-600 shadow-sm">✏️ 정보 수정</button>
                     <button onClick={handleOpenArchiveModal} className="px-4 py-2 bg-red-600 rounded-xl text-[11px] font-black transition-all hover:bg-red-500 shadow-sm">🗑️ 폐기/보관</button>
                   </>
                 )}
                 {canEdit && isEditingDetail && (
                   <>
                     <button onClick={() => { setIsEditingDetail(false); setEditFormData({...selectedEq}); }} className="px-4 py-2 bg-slate-700 rounded-xl text-[11px] font-black transition-all hover:bg-slate-600">취소</button>
                     <button onClick={handleSaveEq} className="px-6 py-2 bg-indigo-500 rounded-xl text-[11px] font-black transition-all hover:bg-indigo-400 shadow-lg">💾 저장 완료</button>
                   </>
                 )}
                 <div className="w-px h-6 bg-slate-700 mx-2"></div>
                 <button onClick={() => setSelectedEq(null)} className="text-2xl font-light opacity-50 hover:opacity-100 transition-opacity">✕</button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50">
              
              {/* 1. 상단: 사진 및 기본정보 */}
              <div className="flex flex-col lg:flex-row gap-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="w-full lg:w-1/3 shrink-0 flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-slate-100 p-4 min-h-[250px] relative group">
                  {(() => {
                     const thumbObj = parseFileData(currentEq.thumbnail_url);
                     const imgSrc = thumbObj?.data || currentEq.thumbnail_url;
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
                       {currentEq.thumbnail_url && (
                         <button type="button" onClick={() => setEditFormData({...editFormData, thumbnail_url: ''})} className="px-4 py-2 bg-red-500 text-white rounded-lg font-black text-xs shadow-sm hover:bg-red-600">✕ 사진 삭제</button>
                       )}
                    </div>
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

              {/* 2. 중단: 구입교체 이력 / 검교정 상태 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 구입 및 교체 이력 */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
                  <h4 className="font-black text-[13px] text-indigo-600 border-b border-indigo-100 pb-3 flex items-center gap-2"><span>🔄</span> 구입 및 교체 이력</h4>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4 text-[11px]">
                    <div><p className="text-slate-400 font-bold mb-1.5">구입일</p>
                      {isEditingDetail ? <input type="date" max="9999-12-31" value={editFormData.purchase_date?.split('T')[0] || ''} onChange={e=>setEditFormData({...editFormData, purchase_date: e.target.value ? new Date(e.target.value).toISOString() : null})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold bg-white focus:border-indigo-500" /> : <p className="font-black text-sm">{currentEq.purchase_date ? currentEq.purchase_date.split('T')[0] : '-'}</p>}
                    </div>
                    <div><p className="text-slate-400 font-bold mb-1.5">교체주기(M)</p>
                      {isEditingDetail ? <input type="number" value={editFormData.replace_cycle_mo || ''} onChange={e=>setEditFormData({...editFormData, replace_cycle_mo: Number(e.target.value)})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold text-indigo-600 bg-white focus:border-indigo-500" placeholder="개월 단위" /> : <p className="font-black text-sm text-indigo-600">{currentEq.replace_cycle_mo || '-'} 개월</p>}
                    </div>
                    <div><p className="text-slate-400 font-bold mb-1.5">최근교체일</p>
                      {isEditingDetail ? <input type="date" max="9999-12-31" value={editFormData.last_replace_date?.split('T')[0] || ''} onChange={e=>setEditFormData({...editFormData, last_replace_date: e.target.value ? new Date(e.target.value).toISOString() : null})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold bg-white focus:border-indigo-500" /> : <p className="font-black text-sm">{currentEq.last_replace_date ? currentEq.last_replace_date.split('T')[0] : '-'}</p>}
                    </div>
                    <div>
                      <p className="text-slate-400 font-bold mb-1.5">자동산정 교체예정일(D-Day)</p>
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

                {/* 검교정 상태 요약 */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
                  <h4 className="font-black text-[13px] text-emerald-600 border-b border-emerald-100 pb-3 flex items-center gap-2"><span>✅</span> 검교정 상태 요약</h4>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4 text-[11px]">
                    <div className="col-span-1"><p className="text-slate-400 font-bold mb-1.5">차기검교정예정일 <span className="font-normal text-[9px] text-slate-300 ml-1">(성적서/지정)</span></p>
                      {isEditingDetail ? (
                        <input type="date" max="9999-12-31" value={editFormData.next_calib_date?.split('T')[0] || ''} onChange={e=>setEditFormData({...editFormData, next_calib_date: e.target.value ? new Date(e.target.value).toISOString() : null})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold bg-white focus:border-emerald-500 text-emerald-600" />
                      ) : (
                        <div className="flex items-center gap-1.5 font-black text-[13px]">
                          <span>{currentEq.next_calib_date ? currentEq.next_calib_date.split('T')[0] : '-'}</span>
                          {currentEq.next_calib_date ? renderDDay(currentEq.next_calib_date) : null}
                        </div>
                      )}
                    </div>
                    <div><p className="text-slate-400 font-bold mb-1.5">검교정주기(M)</p>
                      {isEditingDetail ? <input type="number" value={editFormData.calib_cycle_mo || ''} onChange={e=>setEditFormData({...editFormData, calib_cycle_mo: Number(e.target.value)})} className="w-full p-2 border border-slate-200 rounded-lg outline-none font-bold text-emerald-600 bg-white focus:border-emerald-500" placeholder="개월 단위" /> : <p className="font-black text-sm text-emerald-600">{currentEq.calib_cycle_mo || '-'} 개월</p>}
                    </div>
                    <div><p className="text-slate-400 font-bold mb-1.5">최근검교정일 <span className="font-normal text-[9px] text-slate-300 ml-1">(이력 자동 연동)</span></p>
                      <p className="font-black text-sm text-slate-700">{latestCalibDate || '-'}</p>
                    </div>
                    <div className="col-span-1">
                      <p className="text-slate-400 font-bold mb-1.5">자동산정 검교정예정일(D-Day)</p>
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

              {/* 3. 하단 상세 탭 영역 */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex border-b-2 border-slate-100 bg-white">
                  <button type="button" onClick={() => { setActiveSubTab('CALIB'); setHistoryPage(1); }} className={`flex-1 py-4 text-xs font-black transition-all ${activeSubTab === 'CALIB' ? 'bg-slate-50 text-indigo-600 border-t-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-50 border-t-2 border-transparent'}`}>검교정 상세관리 (이력 표)</button>
                  <button type="button" onClick={() => setActiveSubTab('PRODUCT')} className={`flex-1 py-4 text-xs font-black transition-all ${activeSubTab === 'PRODUCT' ? 'bg-slate-50 text-indigo-600 border-t-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-50 border-t-2 border-transparent'}`}>제품정보 및 파일 보관함</button>
                </div>

                <div className="p-8 bg-slate-50">
                  {/* CALIB 탭: 검교정 이력 테이블 */}
                  {activeSubTab === 'CALIB' && (() => {
                    const sortedHistories = currentEq.histories?.sort((a:any, b:any) => new Date(b.calib_date).getTime() - new Date(a.calib_date).getTime()) || [];
                    const totalHistoryPages = Math.max(1, Math.ceil(sortedHistories.length / historyItemsPerPage));
                    const paginatedHistories = sortedHistories.slice((historyPage - 1) * historyItemsPerPage, historyPage * historyItemsPerPage);

                    return (
                      <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="flex justify-between items-end mb-4">
                          <p className="text-[11px] font-bold text-slate-500">장비의 전체 검교정 이력 및 관련 증빙을 안전하게 누적 관리합니다.</p>
                          <div className="flex gap-2">
                            {canEdit && !isEditingDetail && !selectedEq?.id?.startsWith('NEW-') && (
                              <button type="button" onClick={openAddHistoryModal} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black hover:bg-slate-800 transition-all shadow-md active:scale-95">
                                + 신규 이력 추가
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-sm bg-white">
                          <table className="w-full text-left text-[11px] font-bold min-w-[950px]">
                            <thead className="bg-white text-slate-400 border-b border-slate-200">
                              <tr>
                                <th className="p-4 text-center w-12">NO</th>
                                <th className="p-4 text-center w-28 text-indigo-600">검교정요청일</th>
                                <th className="p-4 text-center w-28 text-indigo-600">검교정일</th>
                                <th className="p-4 w-40">검교정내용 / 메모</th>
                                <th className="p-4 text-center w-24">결과상태</th>
                                <th className="p-4 text-right w-28 text-emerald-600">최종 견적금액</th>
                                <th className="p-4 text-center w-36">교정기관</th>
                                <th className="p-4 text-center w-24">성적서</th>
                                {canEdit && <th className="p-4 text-center w-28">관리액션</th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {sortedHistories.length === 0 ? (
                                <tr><td colSpan={canEdit ? 9 : 8} className="p-12 text-center text-slate-400 font-bold bg-slate-50/50">등록된 검교정 이력이 없습니다.</td></tr>
                              ) : paginatedHistories.map((h: any, i: number) => {
                                const cert = parseFileData(h.cert_file_url);
                                return (
                                  <tr key={h.id} className="hover:bg-slate-50 transition-colors h-12">
                                    <td className="p-4 text-center text-slate-400">{sortedHistories.length - ((historyPage - 1) * historyItemsPerPage + i)}</td>
                                    <td className="p-4 text-center font-black text-slate-800">{h.calib_request_date ? h.calib_request_date.split('T')[0] : '-'}</td>
                                    <td className="p-4 text-center font-black text-slate-800">{h.calib_date?.split('T')[0]}</td>
                                    <td className="p-4 text-slate-600 truncate max-w-[150px]" title={h.content}>{h.content || h.memo || '-'}</td>
                                    <td className={`p-4 text-center font-black ${h.result === '적합' ? 'text-emerald-600' : h.result === '부적합' ? 'text-red-600' : 'text-indigo-600'}`}>{h.result || '-'}</td>
                                    <td className="p-4 text-right text-emerald-600 font-mono">{h.cost ? h.cost.toLocaleString() + '원' : '-'}</td>
                                    <td className="p-4 text-center text-slate-700">{h.agency}</td>
                                    <td className="p-4 text-center">
                                      {cert?.name ? <span onClick={() => handleDirectDownload(h.cert_file_url)} className="text-indigo-500 cursor-pointer hover:underline truncate block max-w-[80px] mx-auto" title={cert.name}>📄 다운로드</span> : '-'}
                                    </td>
                                    {canEdit && (
                                      <td className="p-4 text-center">
                                        <button type="button" onClick={() => handleOpenHistoryDetail(h)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-900 hover:text-white transition-colors shadow-sm">상세/수정</button>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {totalHistoryPages > 1 && (
                          <div className="flex justify-center gap-1.5 mt-6">
                            {Array.from({ length: totalHistoryPages }).map((_, i) => (
                              <button 
                                type="button" key={i} onClick={() => setHistoryPage(i + 1)} 
                                className={`w-7 h-7 rounded-lg text-[11px] font-black transition-all border ${historyPage === i + 1 ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100 shadow-sm'}`}
                              >
                                {i + 1}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* PRODUCT 탭: 제품정보 및 파일 업로드 */}
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
                          <textarea 
                            value={editFormData.etc_memo || ''}
                            onChange={e => setEditFormData({...editFormData, etc_memo: e.target.value})}
                            placeholder="제품에 관련된 추가 정보나 주의사항을 자유롭게 기재하세요." 
                            className="w-full p-4 border border-slate-200 rounded-xl text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-100 min-h-[120px] shadow-inner bg-slate-50 transition-all" 
                          />
                        ) : (
                          <div className="w-full p-5 bg-slate-50 border border-slate-100 rounded-xl text-[11px] font-bold min-h-[120px] whitespace-pre-wrap leading-relaxed text-slate-600">{currentEq.etc_memo || '기재된 내용이 없습니다.'}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* 🚀 신규 이력 등록 모달 */}
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
                <div className="space-y-1.5"><label className="text-slate-500 uppercase tracking-widest block">검교정일 *</label><input type="date" max="9999-12-31" value={historyFormData.calib_date} onChange={e=>setHistoryFormData({...historyFormData, calib_date: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 bg-white shadow-inner transition-all" /></div>
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
                  <select value={historyFormData.result} onChange={e=>setHistoryFormData({...historyFormData, result: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 bg-white shadow-inner transition-all text-indigo-600 font-black">
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
                  {parseFileData(historyFormData.estimate_url)?.name && <div className="text-[10px] text-blue-500 mt-1 font-black truncate">등록됨: {parseFileData(historyFormData.estimate_url).name}</div>}
                </div>
                <div className="space-y-2">
                  <label className="text-slate-500 uppercase tracking-widest block">결과성적서 파일 업로드</label>
                  <input type="file" onChange={(e) => handleFileUpload(e, 'cert_file_url', true)} className="w-full text-[10px] file:bg-white file:border border-slate-200 file:rounded-lg file:px-3 file:py-1.5 file:font-black file:text-slate-600 cursor-pointer" />
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

      {/* 🚀 장비 폐기 모달 */}
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

      {/* 🚀 이력 상세보기 / 수정 / 삭제 모달 */}
      {selectedHistoryDetail && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in duration-200 border">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center">
              <h3 className="font-black text-sm tracking-widest">📄 검교정 이력 상세 {isEditingHistory && '[수정]'}</h3>
              <div className="flex gap-3 items-center">
                {canEdit && (
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
                  <label className="text-slate-500 uppercase tracking-widest block">검교정일</label>
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
                    <select value={historyFormData.result} onChange={e=>setHistoryFormData({...historyFormData, result: e.target.value})} className="w-full p-3 bg-white border border-indigo-200 rounded-xl text-indigo-600 font-black focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                      <option value="진행중">진행중</option>
                      <option value="적합">적합</option>
                      <option value="부적합">부적합</option>
                    </select>
                  ) : (
                    <div className={`w-full p-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-black ${historyFormData.result === '적합' ? 'text-emerald-600' : historyFormData.result === '부적합' ? 'text-red-600' : 'text-indigo-600'}`}>{historyFormData.result || '-'}</div>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-5 pt-5 border-t border-slate-200 mt-4">
                <div className="space-y-2 bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center">
                  <label className="text-slate-500 uppercase tracking-widest text-[10px] block mb-1">견적서 다운로드</label>
                  <div>
                    {parseFileData(historyFormData.estimate_url)?.name ? (
                      <span onClick={() => handleDirectDownload(historyFormData.estimate_url)} className="text-[12px] font-black text-blue-600 cursor-pointer hover:underline truncate block">📄 {parseFileData(historyFormData.estimate_url).name}</span>
                    ) : <span className="text-[10px] text-slate-400 font-bold">등록된 견적서가 없습니다.</span>}
                  </div>
                </div>
                <div className="space-y-2 bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center">
                  <label className="text-slate-500 uppercase tracking-widest text-[10px] block mb-1">성적서 다운로드</label>
                  <div>
                    {parseFileData(historyFormData.cert_file_url)?.name ? (
                      <span onClick={() => handleDirectDownload(historyFormData.cert_file_url)} className="text-[12px] font-black text-indigo-600 cursor-pointer hover:underline truncate block">📄 {parseFileData(historyFormData.cert_file_url).name}</span>
                    ) : <span className="text-[10px] text-slate-400 font-bold">등록된 성적서가 없습니다.</span>}
                  </div>
                </div>
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

    {/* ========================================================================= */}
      {/* 🚀 1. 일괄 QR 인쇄 모달 (복구 완료) */}
      {/* ========================================================================= */}
      {bulkPrintAssets.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/90 z-[600] flex flex-col items-center justify-start p-10 overflow-y-auto no-print">
          <div className="bg-white rounded-2xl shadow-2xl p-8 relative flex flex-col max-w-5xl w-full">
            <div className="flex justify-between items-center mb-6 border-b-2 pb-4 border-slate-200">
              <div>
                <h3 className="text-xl font-black text-slate-800">🖨️ 자산 QR 라벨 일괄 인쇄 (미리보기)</h3>
                <p className="text-purple-600 font-bold mt-1 text-[11px] uppercase tracking-wider">
                  선택된 자산 {bulkPrintAssets.length}건 | 규격: A4 용지 1장당 30칸 (5x6 배열)
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setBulkPrintAssets([])} className="px-6 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 transition-all">닫기</button>
                <button type="button" onClick={executePrint} className="px-6 py-2.5 bg-purple-600 text-white font-black rounded-lg shadow-lg hover:bg-purple-700 active:scale-95 transition-all">인쇄 실행하기</button>
              </div>
            </div>
    
            <div className="bg-white p-[5mm] flex justify-center w-full">
              <div className="grid grid-cols-5 w-full border-t border-l border-slate-300">
                {bulkPrintAssets.map(a => (
                  <div key={a.id} className="flex flex-col items-center justify-center p-2 border-r border-b border-slate-300" style={{ width: '100%', aspectRatio: '36/45' }}>
                    <img 
                      className="w-[23mm] h-[23mm] object-contain mb-1 bg-white p-0.5" 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`https://kpc-asset.vercel.app/equipment/verify?id=${displayAssetNo(a.asset_no)}`)}`} 
                      alt="QR"
                    />
                    <div className="w-full text-center">
                       <div className="text-[10px] font-black text-black leading-tight tracking-tighter truncate">{displayAssetNo(a.asset_no)}</div>
                       <div className="text-[8px] font-bold text-slate-500 leading-tight truncate">{a.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 🚀 2. 단일 QR 확인 모달 (복구 완료) */}
      {/* ========================================================================= */}
      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4" onClick={() => setShowQrModal(null)}>
          <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center mb-6">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">장비 QR 라벨</h3>
              <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-[10px] font-black">{showQrModal.department || '공용'}</span>
            </div>
            <div className="bg-white p-4 border-2 border-slate-100 rounded-2xl shadow-sm mb-4">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`https://kpc-asset.vercel.app/equipment/verify?id=${displayAssetNo(showQrModal.asset_no)}`)}`} 
                alt="Asset QR Code" 
                className="w-48 h-48 bg-white p-2" 
              />
            </div>
            <p className="text-slate-800 font-black text-xl mb-1">{displayAssetNo(showQrModal.asset_no)}</p>
            <p className="text-slate-400 text-xs font-bold mb-6 truncate max-w-[200px] text-center">{showQrModal.name} / {showQrModal.model_name || '모델명 없음'}</p>
            <div className="flex gap-2 w-full mt-6">
              <button type="button" onClick={() => setShowQrModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}