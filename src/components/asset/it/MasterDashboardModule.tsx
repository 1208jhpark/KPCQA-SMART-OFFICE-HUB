'use client';

import { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import * as XLSX from 'xlsx';

interface DashboardProps {
  moduleTitle?: string;
  moduleDescription?: string;
}

function MasterDashboardContent({ moduleTitle, moduleDescription }: DashboardProps) {
  const [assets, setAssets] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  
  const [allMasterGroups, setAllMasterGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [currentItTypeCodes, setCurrentItTypeCodes] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [searchQuery, setSearchQuery] = useState('');
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [showStatusFilter, setShowStatusFilter] = useState<'all' | 'green' | 'grey' | 'red'>('all'); 
  
  const [auditBaseline, setAuditBaseline] = useState('');
  const [itMasterLabel, setItMasterLabel] = useState('자산 분류');
  
  const [colFilters, setColFilters] = useState({ category: '범주', dept: '조직', it_type: '자산 분류', is_rental: '조달유형' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showReasonModal, setShowReasonModal] = useState<{ id: string, type: string } | null>(null);
  const [reason, setReason] = useState('');
  
  const [showQrModal, setShowQrModal] = useState<any | null>(null);
  const [bulkPrintAssets, setBulkPrintAssets] = useState<any[]>([]); 
  
  const [isTableOpen, setIsTableOpen] = useState(true);
  
  const currentGroupName = useMemo(() => {
    const group = allMasterGroups.find(g => g.id === selectedGroupId);
    return group ? group.name : itMasterLabel;
  }, [selectedGroupId, allMasterGroups, itMasterLabel]);
  
  useEffect(() => { setCurrentPage(1); }, [searchQuery, colFilters, showReplaceableOnly, showDuplicatesOnly, showStatusFilter]);
  
  useEffect(() => {
    const init = async () => {
      try {
        const [uRes, nRes, gRes, cRes] = await Promise.all([
          fetch('/api/admin/units?active=true').catch(() => ({ json: () => [] })),
          fetch('/api/admin/users').catch(() => ({ json: () => ({ users: [] }) })),
          fetch('/api/admin/master-data').catch(() => ({ json: () => [] })),
          fetch('/api/admin/config').catch(() => ({ json: () => ({}) })) 
        ]);
        setOrgs(await uRes.json());
        setUsers((await nRes.json()).users || []);
        const masterData = await gRes.json();
        setAllMasterGroups(masterData);
        
        const configData = await cRes.json() as any; 
        if (configData?.audit_baseline) {
          setAuditBaseline(configData.audit_baseline);
        }
        
        if (configData?.it_master_label) {
          setItMasterLabel(configData.it_master_label);
        }
  
        let targetGroupId = configData?.it_category_group;
  
        if (!targetGroupId) {
          const savedGroupId = localStorage.getItem('selected_it_group_id');
          if (savedGroupId && masterData.some((g: any) => g.id === savedGroupId)) {
            targetGroupId = savedGroupId;
          } else {
            const targetGroup = masterData.find((g: any) => g.id === 'GRP_IT_TYPE' || g.name.includes('IT'));
            if (targetGroup) targetGroupId = targetGroup.id;
          }
        }
  
        if (targetGroupId) {
          setSelectedGroupId(targetGroupId);
        }
  
        const savedAssets = localStorage.getItem('it_assets_db');
        if (savedAssets && savedAssets !== '[]') {
          setAssets(JSON.parse(savedAssets));
        } else {
          setAssets([{ id: 'asset-1', no: 1, category: 'HW', it_type: '노트북', dept: '경영기획센터', user: '홍길동', code: 'ASSET-001', model: 'LG gram 16', sn: 'SN12345678', spec: 'i7/16GB/512GB', brand: 'LG', is_rental: '렌탈', rental_months: 24, in_date: '2024-01-10', start_date: '2024-01-10', end_date: '2026-01-10', purchase_price: 1500000, monthly_fee: 55000, monthly_sub_fee: 0, first_bill: '2024-02-01', cycle: 24, memo: '-', reg_date: '2024-01-10', last_audit_date: '', audit_request_date: '' }]);
        }
      } catch (e) { console.error("Sync Failed", e); }
      finally { setLoading(false); }
    };
    init();

    // 🚀 [추가] 실시간 동기화 리스너: 공지사항 페이지에서 날짜가 바뀌면 여기도 즉시 반영
    const syncAuditBaseline = () => {
      fetch('/api/admin/config?t=' + Date.now()).then(res => res.json()).then(data => {
        if (data.audit_baseline) setAuditBaseline(data.audit_baseline);
      });
    };
    window.addEventListener('storage', syncAuditBaseline);
    return () => window.removeEventListener('storage', syncAuditBaseline);

  }, []);
  
  useEffect(() => {
    if (!loading) {
      localStorage.setItem('it_assets_db', JSON.stringify(assets));
      if (selectedGroupId) localStorage.setItem('selected_it_group_id', selectedGroupId); 
      window.dispatchEvent(new Event('storage'));
    }
  }, [assets, selectedGroupId, loading]);
  
  useEffect(() => {
    if (!selectedGroupId) return;
    const group = allMasterGroups.find(g => g.id === selectedGroupId);
    if (group) setCurrentItTypeCodes(group.codes);
  }, [selectedGroupId, allMasterGroups]);
  
  // 🚀 [수정] 양방향 동기화 업데이트 함수
  const updateAuditBaseline = async (newDate: string) => {
    setAuditBaseline(newDate); 
    try {
      // 1. 글로벌 설정 테이블 업데이트 (Personal/Dept 모듈용)
      await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit_baseline: newDate })
      });

      // 2. 공지사항 설정 객체 내의 실사기준일(targetDate)도 자동 업데이트
      const noticeRes = await fetch('/api/asset/it/notices');
      if (noticeRes.ok) {
        const noticeData = await noticeRes.json();
        if (noticeData.current) {
          noticeData.current.targetDate = newDate; // 날짜 필드 동기화
          await fetch('/api/asset/it/notices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(noticeData)
          });
        }
      }
      // 로컬 화면간 즉시 반영을 위해 스토리지 이벤트 발생
      window.dispatchEvent(new Event('storage'));
    } catch (error) { console.error("기준일 DB 저장 및 동기화 실패", error); }
  };
  
  const getAssetLogic = (a: any) => {
    let turnDisplay = '-';
    if (a.is_rental === '렌탈' || a.is_rental === '구독') {
      const first = a.first_bill ? new Date(a.first_bill) : null;
      const start = a.start_date ? new Date(a.start_date) : null;
      const end = a.end_date ? new Date(a.end_date) : null;
      const now = new Date();
      if (start && end) {
        const total = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        let paid = '-';
        if (first) {
          const p = (now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth()) + 1;
          paid = p > 0 ? String(p) : '1';
        }
        turnDisplay = `${paid} / ${total > 0 ? total : 0}`;
      }
    }
    const baseDateString = ((a.is_rental === '렌탈' || a.is_rental === '구독') && a.start_date) ? a.start_date : (a.in_date || new Date().toISOString().split('T')[0]);
    const d = new Date(baseDateString);
    d.setMonth(d.getMonth() + (parseInt(a.cycle) || 0));
    const repDate = d.toISOString().split('T')[0];
    const dday = Math.ceil((new Date(repDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    
    const lastAudit = a.last_audit_date || '';
    let auditStatus = 'red'; 
    if (lastAudit) {
      auditStatus = lastAudit >= auditBaseline ? 'green' : 'grey';
    }
    
    return { turnDisplay, repDate, dday, isTargetCount: dday <= 90, auditStatus, lastAudit };
  };
  
  const stats = useMemo(() => {
    const counts: any = {};
    let hwCount = 0, swCount = 0, furnitureCount = 0;
    assets.forEach(a => {
      counts[a.it_type] = (counts[a.it_type] || 0) + 1;
      if (a.category === 'HW') hwCount++; 
      else if (a.category === 'SW') swCount++;
      else if (a.category === '비품') furnitureCount++;
    });
    const replaceableCount = assets.filter(a => getAssetLogic(a).isTargetCount).length;
    return { counts, replaceableCount, hwCount, swCount, furnitureCount, total: assets.length };
  }, [assets, auditBaseline]);
  
  const duplicateCodes = useMemo(() => {
    const codeMap: Record<string, number> = {};
    assets.forEach(a => { if (a.code) codeMap[a.code] = (codeMap[a.code] || 0) + 1; });
    return new Set(Object.keys(codeMap).filter(code => codeMap[code] > 1));
  }, [assets]);
  
  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      const s = searchQuery.toLowerCase().trim();
      const logic = getAssetLogic(a);
      const matchSearch = !s || [a.code, a.model, a.user, a.sn, a.dept, a.spec].some(v => String(v).toLowerCase().includes(s));
      let matchDept = (colFilters.dept === '조직' || a.dept === colFilters.dept);
      const matchCategory = colFilters.category === '범주' || a.category === colFilters.category;
      const matchType = colFilters.it_type === '자산 분류' || a.it_type === colFilters.it_type;
      const matchRental = colFilters.is_rental === '조달유형' || a.is_rental === colFilters.is_rental;
      
      const matchStatus = showStatusFilter === 'all' || logic.auditStatus === showStatusFilter;
  
      return matchSearch && matchDept && matchCategory && matchType && matchRental 
             && (!showReplaceableOnly || logic.isTargetCount) 
             && (!showDuplicatesOnly || duplicateCodes.has(a.code))
             && matchStatus;
    });
  }, [assets, searchQuery, colFilters, showReplaceableOnly, showDuplicatesOnly, showStatusFilter, duplicateCodes, auditBaseline]);
  
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  const handleFieldChange = (id: string, field: string, value: any) => {
    setAssets(prev => prev.map(a => {
      if (a.id !== id) return a;
      let updated = { ...a, [field]: value };
  
      if (field === 'user') {
        if (value === '' || value === '공용') {
          // 공용일 때는 부서를 비우지 않고 유지
        } else {
          const foundUser = users.find(u => u.name === value);
          if (foundUser && foundUser.unit?.unit_name) {
            updated.dept = foundUser.unit.unit_name;
          }
        }
      }
  
      if (field === 'is_rental' && value === '구매') {
        updated.rental_months = 0; updated.start_date = ''; updated.end_date = ''; updated.monthly_fee = 0; updated.monthly_sub_fee = 0; updated.first_bill = '';
      } 
      if ((field === 'start_date' || field === 'rental_months') && (updated.is_rental === '렌탈' || updated.is_rental === '구독') && updated.start_date && updated.rental_months) {
        const d = new Date(updated.start_date);
        d.setMonth(d.getMonth() + (parseInt(updated.rental_months) || 0));
        updated.end_date = d.toISOString().split('T')[0];
      }
      return updated;
    }));
  };
  
  const markAsAudited = (id: string) => {
    const targetAsset = assets.find(a => a.id === id);
    const nextDate = targetAsset?.last_audit_date ? '' : new Date().toISOString().split('T')[0];
    setAssets(prev => prev.map(a => 
      a.id === id ? { ...a, last_audit_date: nextDate, audit_request_date: nextDate ? '' : a.audit_request_date } : a
    ));
    if (!nextDate) alert('실사 확인이 취소되었습니다.');
    else alert('실사 확인이 완료되었습니다.');
  };
  
  const toggleSelectAll = () => {
    const currentPageIds = paginatedAssets.map(a => a.id);
    const allSelected = currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
  
  const parseExcelDate = (val: any) => {
    if (!val) return '';
    if (typeof val === 'number') {
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      return date.toISOString().split('T')[0];
    }
    let strVal = String(val).trim();
    strVal = strVal.replace(/[\.\/]/g, '-');
    if (/^\d{8}$/.test(strVal)) return `${strVal.substring(0,4)}-${strVal.substring(4,6)}-${strVal.substring(6,8)}`;
    return strVal;
  };
  
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<any>(ws);
        const today = new Date().toISOString().split('T')[0];
        const nowTime = Date.now();
        
        const newData = data.map(row => ({
          id: `ASSET-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          category: row['범주'] || 'HW',
          it_type: row['자산 분류'] || '',
          dept: row['조직'] || '',
          user: row['사용자'] || '',
          code: row['자산번호'] || '',
          model: row['모델명'] || '',
          sn: row['S/N'] || '',
          brand: row['제조사'] || '',
          spec: row['기본 사양'] || '',
          is_rental: row['조달유형'] || '구매',
          rental_months: parseInt(row['렌탈/구독기간(M)']) || 0,
          purchase_price: parseInt(row['초기구매비(원)']) || 0,
          monthly_fee: parseInt(row['월렌탈료(원)']) || 0,
          monthly_sub_fee: parseInt(row['월구독료(원)']) || 0,
          in_date: parseExcelDate(row['입고일']),
          start_date: parseExcelDate(row['계약시작일']),
          end_date: parseExcelDate(row['계약종료일']),
          first_bill: parseExcelDate(row['첫회청구일']),
          cycle: parseInt(row['교체주기(M)']) || 48,
          memo: row['기타'] || '-',
          reg_date: today,
          upload_timestamp: nowTime,
          last_audit_date: '',
          audit_request_date: '' 
        }));
        setAssets(prev => [...newData, ...prev]); 
        alert(`✅ 엑셀 업로드 완료! (${newData.length}건 추가)`);
      } catch (error) { alert("엑셀 파싱 오류!"); }
    };
    reader.readAsBinaryString(file);
  };
  
  const handleExcelDownload = () => {
    const targetAssets = filteredAssets.filter(a => selectedIds.has(a.id));
    if (targetAssets.length === 0) return alert('항목을 선택해주세요.');
    const excelData = targetAssets.map((a, index) => {
      const logic = getAssetLogic(a);
      return {
        'NO': index + 1, '범주': a.category, '자산 분류': a.it_type, '조직': a.dept, '사용자': a.user || '공용', '자산번호': a.code, '모델명': a.model, 'S/N': a.sn, '제조사': a.brand, '기본 사양': a.spec, 
        '조달유형': a.is_rental, '렌탈/구독기간(M)': a.rental_months, '초기구매비(원)': a.purchase_price, '월렌탈료(원)': a.monthly_fee, '월구독료(원)': a.monthly_sub_fee || 0,
        '입고일': a.in_date, '계약시작일': a.start_date, '계약종료일': a.end_date, '첫회청구일': a.first_bill, '납입/총회': logic.turnDisplay, '교체주기(M)': a.cycle, '교체가능일(자동)': logic.repDate, '기타': a.memo, '등록일자': a.reg_date, '최근실사일': a.last_audit_date || '-', '확인요청일': a.audit_request_date || '-'
      };
    });
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ITAssets"); XLSX.writeFile(wb, `IT_Assets.xlsx`);
  };
  
  const handleDeleteSelected = () => {
    if (selectedIds.size === 0 || !confirm(`정말 삭제하시겠습니까?`)) return;
    setAssets(prev => prev.filter(a => !selectedIds.has(a.id))); setSelectedIds(new Set());
  };
  
  const confirmTerminate = () => {
    const target = assets.find(a => a.id === showReasonModal?.id);
    if (target) {
      const currentHistory = JSON.parse(localStorage.getItem('it_assets_history_db') || '[]');
      const newHistoryEntry = { 
        ...JSON.parse(JSON.stringify(target)),
        status: showReasonModal?.type, 
        reason: reason || '사유 미기재', 
        terminated_at: new Date().toLocaleDateString() 
      };
      const updatedHistory = [newHistoryEntry, ...currentHistory];
      localStorage.setItem('it_assets_history_db', JSON.stringify(updatedHistory));
      setAssets(assets.filter(a => a.id !== target.id)); 
      setShowReasonModal(null); 
      setReason('');
      alert(`${showReasonModal?.type} 처리되어 아카이브로 이동되었습니다.`);
    }
  };
  
  const handleAdd = () => {
    const newId = `ASSET-${Date.now()}`; const today = new Date().toISOString().split('T')[0];
    const newObj = { id: newId, category: 'HW', it_type: currentItTypeCodes[0]?.label || '', dept: 'KPCQA', user: '', code: '', model: '', sn: '', spec: '', brand: '', is_rental: '구매', rental_months: 0, in_date: today, start_date: '', end_date: '', purchase_price: 0, monthly_fee: 0, monthly_sub_fee: 0, first_bill: '', cycle: 48, memo: '-', reg_date: today, upload_timestamp: Date.now(), last_audit_date: '', audit_request_date: '' };
    setAssets(prev => [newObj, ...prev]); 
    setEditingId(newId); setCurrentPage(1);
  };
  
  const openBulkQRPrint = () => {
    const targetAssets = filteredAssets.filter(a => selectedIds.has(a.id));
    if (targetAssets.length === 0) return alert('출력할 자산을 체크박스로 선택해주세요.');
    setBulkPrintAssets(targetAssets);
  };
  
  const sendAuditRequest = () => {
    if (selectedIds.size === 0) return alert('확인 요청을 보낼 대상을 체크박스로 선택해주세요.');
    if (!confirm(`선택한 ${selectedIds.size}개 자산의 담당자에게 실사 확인 요청을 보내시겠습니까?`)) return;
    const today = new Date().toISOString().split('T')[0];
    setAssets(prev => prev.map(a => {
      if (selectedIds.has(a.id)) return { ...a, audit_request_date: today }; 
      return a;
    }));
    setSelectedIds(new Set()); 
    alert('✅ 실사 확인 요청이 성공적으로 전송되었습니다.');
  };
  
  const revokeAuditRequest = (id: string) => {
    if (!confirm("해당 자산의 확인요청을 철회(완료 처리)하시겠습니까?")) return;
    setAssets(prev => prev.map(a => a.id === id ? { ...a, audit_request_date: '' } : a));
  };
  
  const executePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      return alert('팝업 차단이 설정되어 있습니다. 브라우저 설정에서 팝업 차단을 해제해주세요.');
    }
    const labelsHtml = bulkPrintAssets.map(a => `
      <div class="label-item">
        <img class="qr-img" src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`https://kpc-asset.vercel.app/m/verify?id=${a.code}`)}" />
        <div class="asset-code">${a.code}</div>
        <div class="asset-type">${a.it_type}</div>
      </div>
    `).join('');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <title>QR 라벨 인쇄</title>
        <style>
          @page { size: A4; margin: 10mm 15mm; }
          body { font-family: 'Malgun Gothic', sans-serif; margin: 0; padding: 0; background: white; }
          .label-container { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; width: 100%; }
          .label-item { width: 36mm; height: 45mm; box-sizing: border-box; border: 1px dashed #ccc; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1mm; overflow: hidden; page-break-inside: avoid; }
          .qr-img { width: 23mm; height: 23mm; margin-bottom: 2mm; object-fit: contain; }
          .asset-code { font-size: 8.5pt; font-weight: 900; color: #000; text-align: center; margin: 0; line-height: 1.1; word-break: break-all; letter-spacing: -0.5px; }
          .asset-type { font-size: 6pt; font-weight: 600; color: #555; text-align: center; margin-top: 1px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 90%; }
          * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
          @media print { .label-item { border: 1px dashed #efefef; } }
        </style>
      </head>
      <body>
        <div class="label-container">${labelsHtml}</div>
        <script>
          window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 500); };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };
  
  const formatNumber = (val: any) => val?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") || '0';
  
  return (
    <div className="space-y-4 font-sans text-slate-900 text-[11px] p-4">
      <div className="bg-slate-900 h-20 rounded-[2rem] shadow-lg relative flex items-center px-8 mb-6">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4">
            <span className="text-2xl text-white">📊</span>
            <div className="flex flex-col justify-center">
              <h2 className="font-black tracking-tight uppercase text-white text-lg">
                {moduleTitle || 'IT Asset Master Workspace'}
              </h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                {moduleDescription || '실시간 IT 자산 마스터 제어 및 운영 시스템'}
              </p>
            </div>
          </div>
          <button 
            onClick={() => setIsTableOpen(!isTableOpen)} 
            className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-xl text-[10px] font-black text-white transition-colors uppercase whitespace-nowrap"
          >
            {isTableOpen ? '리스트 닫기 ▲' : '리스트 열기 ▼'}
          </button>
        </div>
      </div>
  
      {isTableOpen && (
        <div className="animate-in fade-in duration-300 slide-in-from-top-4 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px]">
            <div className="bg-white border border-slate-200 p-5 shadow-sm rounded-xl flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">전체 IT 자산 수량</p>
                <p className="text-3xl font-bold text-slate-900 leading-none">{stats.total} <span className="text-xs text-slate-400 font-medium ml-1">Items</span></p>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-50">
                <div className="text-center border-r border-slate-100"><p className="text-[9px] text-slate-400 font-bold mb-1">H/W</p><p className="text-sm font-bold text-blue-600">{stats.hwCount}</p></div>
                <div className="text-center border-r border-slate-100"><p className="text-[9px] text-slate-400 font-bold mb-1">S/W</p><p className="text-sm font-bold text-indigo-600">{stats.swCount}</p></div>
                <div className="text-center"><p className="text-[9px] text-slate-400 font-bold mb-1">비품</p><p className="text-sm font-bold text-amber-600">{stats.furnitureCount}</p></div>
              </div>
            </div>
            
            <div className="bg-slate-900 p-5 shadow-md rounded-xl col-span-2 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                 <div>
                   <h2 className="text-white text-lg font-bold">전사 자산 운영 및 실사 현황</h2>
                   <div className="flex items-center gap-2 mt-2 bg-slate-800 p-1.5 rounded-lg border border-slate-700">
                     <span className="text-slate-400 text-[10px] font-bold ml-1">실사 기준일:</span>
                     <input type="date" value={auditBaseline} onChange={e => updateAuditBaseline(e.target.value)} className="bg-transparent text-emerald-400 font-black text-[11px] outline-none cursor-pointer" />
                   </div>
                 </div>
                 <div className="flex flex-wrap gap-2 justify-end max-w-[50%]">
                   <button onClick={() => setShowStatusFilter(prev => prev === 'green' ? 'all' : 'green')} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1 ${showStatusFilter === 'green' ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-emerald-900/30 border-emerald-800 text-emerald-400 hover:bg-emerald-800/50'}`}>
                     <span>확인</span><span>{assets.filter(a => getAssetLogic(a).auditStatus === 'green').length}</span>
                   </button>
                   <button onClick={() => setShowStatusFilter(prev => prev === 'grey' ? 'all' : 'grey')} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1 ${showStatusFilter === 'grey' ? 'bg-slate-600 border-slate-600 text-white shadow-md' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700/50'}`}>
                     <span>재확인</span><span>{assets.filter(a => getAssetLogic(a).auditStatus === 'grey').length}</span>
                   </button>
                   <button onClick={() => setShowStatusFilter(prev => prev === 'red' ? 'all' : 'red')} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1 ${showStatusFilter === 'red' ? 'bg-red-600 border-red-600 text-white shadow-md' : 'bg-red-900/30 border-red-800 text-red-400 hover:bg-red-800/50'}`}>
                     <span>미확인</span><span>{assets.filter(a => getAssetLogic(a).auditStatus === 'red').length}</span>
                   </button>
                   <button onClick={() => setShowReplaceableOnly(!showReplaceableOnly)} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${showReplaceableOnly ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>교체대상 {stats.replaceableCount}</button>
                   <button onClick={() => setShowDuplicatesOnly(!showDuplicatesOnly)} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${showDuplicatesOnly ? 'bg-red-600 border-red-600 text-white' : 'bg-slate-800 border-slate-700 text-red-400 hover:text-white'}`}>🚨 중복 {duplicateCodes.size}</button>
                 </div>
              </div>
              <div className="flex gap-3 overflow-x-auto mt-4 pb-1 scrollbar-hide">
                 {Object.entries(stats.counts).map(([type, count]: any) => (
                   <div key={type} className="bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 shrink-0 font-bold"><span className="text-[10px] text-slate-500 mr-2 uppercase">{type}</span><span className="text-white">{count}</span></div>
                 ))}
              </div>
            </div>
          </div>
  
          <div className="bg-white border border-slate-200 px-5 h-14 shadow-sm rounded-xl flex gap-3 items-center">
            <input 
              type="text" 
              placeholder="[통합검색] 사용자명, 자산번호, 모델명, S/N" 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              className="flex-1 bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-bold outline-none focus:border-blue-500" 
            />
            <div className="flex gap-2 items-center">
              <select 
                className="p-2 border border-slate-200 font-black text-[10px] rounded-lg outline-none bg-white shadow-sm"
                value={colFilters.category}
                onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}
              >
                <option value="">범주 (전체)</option>
                <option value="HW">HW</option>
                <option value="SW">SW</option>
                <option value="비품">비품</option>
              </select>
              <select 
                className="p-2 border border-slate-200 font-black text-[10px] rounded-lg outline-none bg-white text-blue-600 shadow-sm"
                value={colFilters.it_type}
                onChange={(e) => setColFilters({ ...colFilters, it_type: e.target.value })}
              >
                <option value="">{itMasterLabel} (전체)</option>
                {(currentItTypeCodes || []).map(c => <option key={c?.id} value={c?.label}>{c?.label}</option>)} 
                
              </select>
              <select 
                className="p-2 border border-slate-200 font-black text-[10px] rounded-lg outline-none bg-white shadow-sm"
                value={colFilters.dept}
                onChange={(e) => setColFilters({ ...colFilters, dept: e.target.value })}
              >
                <option value="">조직 (전체)</option>
                {orgs.map(o => <option key={o.id} value={o.unit_name}>{o.unit_name}</option>)}
              </select>
              <select 
                className="p-2 border border-slate-200 font-black text-[10px] rounded-lg outline-none bg-white shadow-sm"
                value={colFilters.is_rental}
                onChange={(e) => setColFilters({ ...colFilters, is_rental: e.target.value })}
              >
                <option value="">조달유형 (전체)</option>
                <option value="구매">구매</option>
                <option value="렌탈">렌탈</option>
                <option value="구독">구독</option>
              </select>
              
              <div className="w-px h-6 bg-slate-300 mx-1"></div>
  
              <button onClick={sendAuditRequest} className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-black hover:bg-amber-500 hover:text-white transition-all shadow-sm">🔔 확인요청송부</button>
              <button onClick={openBulkQRPrint} className="px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded font-black hover:bg-purple-600 hover:text-white transition-all shadow-sm">🖨️ 선택 QR 인쇄</button>
              <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-600 hover:text-white transition-all">⬆️ 엑셀 업로드</button>
              <input type="file" ref={fileInputRef} onChange={handleExcelUpload} accept=".xlsx, .xls" className="hidden" />
              <button onClick={handleExcelDownload} className="px-3 py-1.5 bg-slate-100 text-slate-700 border rounded hover:bg-slate-200 transition-all">⬇️ 다운로드</button>
              <button onClick={handleDeleteSelected} className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-600 hover:text-white transition-all">🗑️ 선택 삭제</button>
              <button onClick={handleAdd} className="px-3 py-1.5 bg-blue-600 text-white rounded shadow-md hover:bg-blue-700 transition-all">+ 신규 자산</button>
            </div>
          </div>
  
          <div className="bg-white border border-slate-200 shadow-md rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[4180px] table-fixed">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 uppercase font-bold border-b border-slate-800 h-10">
                    <th className="p-3 w-[40px] sticky left-0 bg-slate-900 z-30 text-center"><input type="checkbox" checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedIds.has(a.id))} onChange={toggleSelectAll} /></th>
                    <th className="p-3 w-[50px] sticky left-[40px] bg-slate-900 z-30 text-center">NO</th>
                    <th className="p-3 w-[50px] sticky left-[90px] bg-slate-900 z-30 text-center text-blue-400">수정</th>
                    <th className="p-3 w-[60px] sticky left-[140px] bg-slate-900 z-30 text-center">범주</th>
                    
                    <th className="p-3 w-[120px] sticky left-[200px] bg-slate-900 z-30 text-blue-400">
                      {itMasterLabel}
                    </th>
  
                    <th className="p-3 w-[150px] sticky left-[320px] bg-slate-900 z-30">조직</th>
                    <th className="p-3 w-[100px] sticky left-[470px] bg-slate-900 z-30 border-r-2 border-slate-500 text-blue-400">사용자</th>
                    <th className="p-3 w-[220px]">자산번호</th>
                    <th className="p-3 w-[250px]">모델명</th>
                    <th className="p-3 w-[180px]">S/N</th>
                    <th className="p-3 w-[160px]">제조사</th>
                    <th className="p-3 w-[300px]">기본 사양</th>
                    <th className="p-3 w-[100px] text-center">조달유형</th>
                    <th className="p-3 w-[130px] text-center">렌탈/구독기간(M)</th>
                    <th className="p-3 w-[130px] text-right text-emerald-400">초기구매비(원)</th>
                    <th className="p-3 w-[130px] text-right text-emerald-400">월렌탈료(원)</th>
                    <th className="p-3 w-[130px] text-right text-indigo-400">월구독료(원)</th>
                    <th className="p-3 w-[120px] text-center">입고일</th>
                    <th className="p-3 w-[120px] text-center">계약시작일</th>
                    <th className="p-3 w-[120px] text-center">계약종료일</th>
                    <th className="p-3 w-[120px] text-center text-blue-300">첫회청구일</th>
                    <th className="p-3 w-[100px] text-center">납입/총회</th>
                    <th className="p-3 w-[120px] text-center">교체주기(M)</th>
                    <th className="p-3 w-[180px] bg-slate-800 text-white text-center font-black">교체예정일(자동)</th>
                    <th className="p-3 w-[130px] text-center">종료처리</th>
                    <th className="p-3 w-[250px]">기타</th>
                    <th className="p-3 w-[120px] text-center">등록일자</th>
                    <th className="p-3 w-[120px] text-center text-emerald-400">실사 확인 상태</th>
                    <th className="p-3 w-[100px] text-center text-amber-500">확인요청</th>
                    <th className="p-3 w-[80px] text-center">수동 확인</th>
                    <th className="p-3 w-[80px] text-center text-purple-400">QR코드</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold">
                  {paginatedAssets.map((a, idx) => {
                    const { turnDisplay, repDate, dday, auditStatus, lastAudit } = getAssetLogic(a);
                    const isEditing = editingId === a.id;
                    const isP = a.is_rental === '구매';
                    const isS = a.is_rental === '구독';
                    const isR = a.is_rental === '렌탈';
      
                    const isNew = a.upload_timestamp && (Date.now() - a.upload_timestamp < 3600000);
                    const rowBg = isEditing ? 'bg-blue-50/50' : (isNew ? 'bg-emerald-50' : (duplicateCodes.has(a.code) ? 'bg-red-50/30' : 'bg-white'));
                    const stickyBg = isEditing ? 'bg-blue-50/95' : (isNew ? 'bg-emerald-50/95' : (duplicateCodes.has(a.code) ? 'bg-red-50/95' : 'bg-white'));
                    
                    const inputClass = "w-full px-2 py-1 bg-white border border-blue-300 rounded text-blue-700 font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm";
                    
                    const isPublic = !a.user || a.user === '' || a.user === '공용';
  
                    return (
                      <tr key={a.id} className={`hover:bg-slate-50 transition-all h-10 ${rowBg}`}>
                        <td className={`p-2 sticky left-0 z-20 ${stickyBg} text-center`}><input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} /></td>
                        <td className={`p-2 sticky left-[40px] z-20 ${stickyBg} text-center text-slate-400`}>{(currentPage-1)*itemsPerPage + idx + 1}</td>
                        <td className={`p-2 sticky left-[90px] z-20 ${stickyBg} text-center`}><button onClick={() => setEditingId(isEditing ? null : a.id)} className="text-blue-600 font-bold">{isEditing ? '💾' : '✏️'}</button></td>
                        <td className={`p-2 sticky left-[140px] z-20 ${stickyBg} text-center`}>{isEditing ? <select value={a.category} onChange={e => handleFieldChange(a.id, 'category', e.target.value)} className={inputClass}><option>HW</option><option>SW</option><option>비품</option></select> : a.category}</td>
                        <td className={`p-2 sticky left-[200px] z-20 ${stickyBg} text-blue-600`}>{isEditing ? <select value={a.it_type} onChange={e => handleFieldChange(a.id, 'it_type', e.target.value)} className={inputClass}>{currentItTypeCodes.map(c => <option key={c.id}>{c.label}</option>)}</select> : a.it_type}</td>
                        
                        <td className={`p-2 sticky left-[320px] z-20 ${stickyBg}`}>
                          {isEditing ? (
                            <select 
                              disabled={!isPublic} 
                              value={a.dept} 
                              onChange={e => handleFieldChange(a.id, 'dept', e.target.value)} 
                              className={`${inputClass} ${!isPublic ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : ''}`}
                            >
                              <option value="">소속 없음</option>
                              {orgs.map(o => <option key={o.id} value={o.unit_name}>{o.unit_name}</option>)}
                            </select>
                          ) : a.dept}
                        </td>
  
                        <td className={`p-2 sticky left-[470px] z-20 border-r-2 border-slate-300 ${stickyBg} text-blue-600`}>
                          {isEditing ? (
                            <select value={a.user || ''} onChange={e => handleFieldChange(a.id, 'user', e.target.value)} className={inputClass}>
                              <option value="공용">공용</option>
                              {users.map((u, i) => (
                                <option key={u.email || i} value={u.name}>
                                  {u.name} {u.email ? `(${u.email.split('@')[0]})` : ''}
                                </option>
                              ))}
                              {a.user && a.user !== '공용' && !users.some(u => u.name === a.user) && <option value={a.user}>{a.user}</option>}
                            </select>
                          ) : (a.user || '공용')}
                        </td>
                        <td className="p-2">{isEditing ? <input type="text" value={a.code} onChange={e => handleFieldChange(a.id, 'code', e.target.value)} className={inputClass} /> : (
                          <div className="flex items-center gap-1"><span>{a.code}</span>{duplicateCodes.has(a.code) && <span className="text-red-600 text-[9px] animate-pulse">(중복!)</span>}</div>
                        )}</td>
                        <td className="p-2 truncate">{isEditing ? <input type="text" value={a.model} onChange={e => handleFieldChange(a.id, 'model', e.target.value)} className={inputClass} /> : <span className="truncate block max-w-[230px]">{a.model}</span>}</td>
                        <td className="p-2 text-slate-500">{isEditing ? <input type="text" value={a.sn} onChange={e => handleFieldChange(a.id, 'sn', e.target.value)} className={inputClass} /> : a.sn}</td>
                        <td className="p-2">{isEditing ? <input type="text" value={a.brand} onChange={e => handleFieldChange(a.id, 'brand', e.target.value)} className={inputClass} /> : a.brand}</td>
                        <td className="p-2 text-slate-400">{isEditing ? <input type="text" value={a.spec} onChange={e => handleFieldChange(a.id, 'spec', e.target.value)} className={inputClass} /> : <span className="truncate block max-w-[280px]">{a.spec}</span>}</td>
                        <td className="p-2 text-center">{isEditing ? <select value={a.is_rental} onChange={e => handleFieldChange(a.id, 'is_rental', e.target.value)} className={inputClass}><option>구매</option><option>렌탈</option><option>구독</option></select> : <span className={`px-2 py-0.5 rounded ${isP ? 'bg-slate-100' : 'bg-indigo-50 text-indigo-600'}`}>{a.is_rental}</span>}</td>
                        <td className="p-2 text-center">{isEditing && !isP ? <input type="number" value={a.rental_months} onChange={e => handleFieldChange(a.id, 'rental_months', e.target.value)} className={inputClass} /> : (isP ? '-' : a.rental_months)}</td>
                        <td className="p-2 text-right text-emerald-700">{isEditing ? <input type="number" value={a.purchase_price} onChange={e => handleFieldChange(a.id, 'purchase_price', e.target.value)} className={inputClass} /> : formatNumber(a.purchase_price)}</td>
                        <td className="p-2 text-right text-emerald-700">{isEditing && isR ? <input type="number" value={a.monthly_fee} onChange={e => handleFieldChange(a.id, 'monthly_fee', e.target.value)} className={inputClass} /> : (isR ? formatNumber(a.monthly_fee) : '-')}</td>
                        <td className="p-2 text-right text-indigo-700">{isEditing && isS ? <input type="number" value={a.monthly_sub_fee} onChange={e => handleFieldChange(a.id, 'monthly_sub_fee', e.target.value)} className={inputClass} /> : (isS ? formatNumber(a.monthly_sub_fee) : '-')}</td>
                        <td className="p-2 text-center">{isEditing ? <input type="date" value={a.in_date} onChange={e => handleFieldChange(a.id, 'in_date', e.target.value)} className={inputClass} /> : a.in_date}</td>
                        <td className="p-2 text-center">{isEditing && !isP ? <input type="date" value={a.start_date} onChange={e => handleFieldChange(a.id, 'start_date', e.target.value)} className={inputClass} /> : (isP ? '-' : a.start_date)}</td>
                        <td className="p-2 text-center">{isEditing && !isP ? <input type="date" value={a.end_date} onChange={e => handleFieldChange(a.id, 'end_date', e.target.value)} className={inputClass} /> : (isP ? '-' : a.end_date)}</td>
                        <td className="p-2 text-center text-blue-600">{isEditing && !isP ? <input type="date" value={a.first_bill} onChange={e => handleFieldChange(a.id, 'first_bill', e.target.value)} className={inputClass} /> : (isP ? '-' : a.first_bill)}</td>
                        <td className="p-2 text-center font-bold">{isP ? '-' : turnDisplay}</td>
                        <td className="p-2 text-center font-bold">{isEditing ? <input type="number" value={a.cycle} onChange={e => handleFieldChange(a.id, 'cycle', e.target.value)} className={inputClass} /> : a.cycle}</td>
                        <td className="p-2 bg-slate-50/50 text-center font-bold">
                          <div>{repDate}</div>
                          {dday !== null && dday <= 90 && !isEditing && <span className={`text-[9px] px-1 rounded ${dday <= 0 ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-600 text-white'}`}>{dday <= 0 ? `D+${Math.abs(dday)}` : `D-${dday}`}</span>}
                        </td>
                        <td className="p-2 text-center space-x-1">
                          <button onClick={() => setShowReasonModal({id: a.id, type: '반납'})} className="px-2 py-0.5 bg-amber-500 text-white rounded text-[9px] font-bold">반납</button>
                          <button onClick={() => setShowReasonModal({id: a.id, type: '폐기'})} className="px-2 py-1 bg-red-600 text-white rounded text-[9px] font-bold">폐기</button>
                        </td>
                        <td className="p-2 text-slate-400">{isEditing ? <input type="text" value={a.memo} onChange={e => handleFieldChange(a.id, 'memo', e.target.value)} className={inputClass} /> : <span className="truncate block max-w-[230px]">{a.memo}</span>}</td>
                        <td className="p-2 text-center text-slate-400">{a.reg_date}</td>
                        <td className="p-2 text-center">
                          <div className={`px-2 py-1 rounded-full text-center text-[10px] tracking-tight ${auditStatus === 'green' ? 'bg-emerald-50 text-emerald-600' : (auditStatus === 'red' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-400')}`}>
                            {lastAudit ? `${lastAudit} 확인` : '미확인 장비'}
                          </div>
                        </td>
                        <td className="p-2 text-center font-black">
                          {a.audit_request_date ? (
                            <button onClick={() => revokeAuditRequest(a.id)} className="text-amber-600 bg-amber-50 px-2 py-1 rounded hover:bg-amber-100 hover:line-through transition-all cursor-pointer" title="클릭 시 확인요청 철회">
                              {a.audit_request_date}
                            </button>
                          ) : '-'}
                        </td>
                        <td className="p-2 text-center"><button onClick={() => markAsAudited(a.id)} className="bg-slate-800 text-white px-2 py-1 rounded text-[9px] hover:bg-slate-700 transition-colors">수동확인</button></td>
                        <td className="p-2 text-center">
                          <button onClick={() => setShowQrModal(a)} disabled={!a.code} className={`px-2 py-1 rounded text-[10px] font-black transition-all ${a.code ? 'bg-purple-100 text-purple-700 hover:bg-purple-600 hover:text-white border border-purple-200' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
                            📱 QR
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 p-4 bg-slate-50 border-t border-slate-100">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} onClick={() => setCurrentPage(i + 1)} className={`px-3 py-1 border rounded font-bold text-[11px] shadow-sm transition-all ${currentPage === i + 1 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>{i + 1}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
  
      {/* 모달 영역 */}
      {showReasonModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-[450px] border border-slate-300 shadow-2xl p-8 rounded-xl font-bold">
            <h4 className="text-sm font-bold uppercase border-b pb-2 mb-6 tracking-widest">Asset {showReasonModal.type} Reason</h4>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="사유를 입력하세요." className="w-full h-40 bg-slate-50 border p-4 text-[11px] font-bold outline-none rounded shadow-inner" />
            <div className="flex gap-2 mt-8">
              <button onClick={() => { setShowReasonModal(null); setReason(''); }} className="flex-1 py-3 bg-slate-100 rounded">취소</button>
              <button onClick={confirmTerminate} className="flex-1 py-3 bg-slate-900 text-white rounded shadow-md hover:bg-red-600 transition-all text-[11px] uppercase">Save & Archive</button>
            </div>
          </div>
        </div>
      )}
  
      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4" onClick={() => setShowQrModal(null)}>
          <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center mb-6">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">자산 QR 라벨</h3>
              <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-[10px] font-black">{showQrModal.it_type}</span>
            </div>
            <div className="bg-white p-4 border-2 border-slate-100 rounded-2xl shadow-sm mb-4">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`https://kpc-asset.vercel.app/m/verify?id=${showQrModal.code}`)}`} alt="Asset QR Code" className="w-48 h-48" />
            </div>
            <p className="text-slate-800 font-black text-xl mb-1">{showQrModal.code}</p>
            <p className="text-slate-400 text-xs font-bold mb-6">{showQrModal.model}</p>
            <div className="flex gap-2 w-full mt-6">
              <button onClick={() => setShowQrModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">닫기</button>
            </div>
          </div>
        </div>
      )}
  
      {bulkPrintAssets.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/90 z-[600] flex flex-col items-center justify-start p-10 overflow-y-auto no-print">
          <div className="bg-white rounded-2xl shadow-2xl p-8 relative flex flex-col max-w-5xl w-full">
            <div className="flex justify-between items-center mb-6 border-b-2 pb-4 border-slate-200">
              <div>
                <h3 className="text-xl font-black text-slate-800">🖨️ 자산 QR 라벨 인쇄 미리보기 (30칸)</h3>
                <p className="text-purple-600 font-bold mt-1 text-[11px] uppercase tracking-wider">
                  규격: A4 용지 1장에 30칸 (5x6 배열) | 권장 라벨지: Formtec 3105 (약 36mm x 45mm 규격)
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setBulkPrintAssets([])} className="px-6 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 transition-all">닫기</button>
                <button onClick={executePrint} className="px-6 py-2.5 bg-purple-600 text-white font-black rounded-lg shadow-lg hover:bg-purple-700 active:scale-95 transition-all">인쇄 실행하기</button>
              </div>
            </div>
            <div className="bg-white p-[5mm] flex justify-center w-full">
              <div className="grid grid-cols-5 w-full border-t border-l border-slate-300">
                {bulkPrintAssets.map(a => (
                  <div key={a.id} className="flex flex-col items-center justify-center p-2 border-r border-b border-slate-300" style={{ width: '100%', aspectRatio: '36/45' }}>
                    <img 
                      className="w-[23mm] h-[23mm] object-contain mb-1" 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`https://kpc-asset.vercel.app/m/verify?id=${a.code}`)}`} 
                      alt="QR"
                    />
                    <div className="w-full text-center">
                       <div className="text-[10px] font-black text-black leading-tight tracking-tighter truncate">{a.code}</div>
                       <div className="text-[8px] font-bold text-slate-500 leading-tight truncate">{a.it_type}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MasterDashboardModule(props: DashboardProps) {
  return (
    <Suspense fallback={<div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest">LOADING MASTER WORKSPACE...</div>}>
      <MasterDashboardModuleContent {...props} />
    </Suspense>
  );
}

function MasterDashboardModuleContent(props: DashboardProps) {
    return <MasterDashboardContent {...props} />
}