'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';

export default function ITAssetMasterPage() {
  const [assets, setAssets] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  
  // 🚀 사용자 요구사항 관련 상태
  const [userRequests, setUserRequests] = useState<any[]>([]); 
  const [requestHistory, setRequestHistory] = useState<any[]>([]); 
  const [showUserRequestModal, setShowUserRequestModal] = useState(false);
  const [selectedRequestDetail, setSelectedRequestDetail] = useState<any>(null); 
  const [isReqHistoryOpen, setIsReqHistoryOpen] = useState(false); 
  const [showOpinionModal, setShowOpinionModal] = useState<string | null>(null); 
  const [adminOpinion, setAdminOpinion] = useState('');
  
  // 🚀 삭제/백업 체크박스 관련 상태
  const [selectedReqHistoryIds, setSelectedReqHistoryIds] = useState<Set<string>>(new Set());
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<Set<string>>(new Set());
  
  // 🚀 UI 제어 상태
  const [isAssetListOpen, setIsAssetListOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [allMasterGroups, setAllMasterGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [currentItTypeCodes, setCurrentItTypeCodes] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState<{ id: string, type: string } | null>(null);
  const [reason, setReason] = useState('');
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  
  const [colFilters, setColFilters] = useState({ category: '범주', dept: '조직', it_type: '자산 분류', is_rental: '조달유형' });
  
  const [currentPage, setCurrentPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [reqHistoryPage, setReqHistoryPage] = useState(1);
  const itemsPerPage = 10;
  
  // 🚀 로그인된 실제 이름 연동을 위한 상태
  const [loggedInName, setLoggedInName] = useState(''); 
  
  const currentGroupName = useMemo(() => {
    const group = allMasterGroups.find(g => g.id === selectedGroupId);
    return group ? group.name : '자산 분류';
  }, [selectedGroupId, allMasterGroups]);
  
  useEffect(() => { setCurrentPage(1); }, [searchQuery, colFilters, showReplaceableOnly, showDuplicatesOnly]);
  useEffect(() => { setHistoryPage(1); }, [historySearchQuery]);
  useEffect(() => { setReqHistoryPage(1); }, [isReqHistoryOpen]);
  
  useEffect(() => {
    const init = async () => {
      try {
        const [uRes, nRes, gRes] = await Promise.all([
          fetch('/api/admin/units?active=true').catch(() => ({ json: () => [] })),
          fetch('/api/admin/users').catch(() => ({ json: () => ({ users: [] }) })),
          fetch('/api/admin/master-data').catch(() => ({ json: () => [] }))
        ]);
        setOrgs(await uRes.json());
        
        const usersData = (await nRes.json()).users || [];
        setUsers(usersData);
        
        // 🚀 실제 로그인 사용자 매핑 (이미지 기반 admin 계정 우선순위)
        const currentUser = usersData.find((u: any) => u.email === 'admin@kpcqa.or.kr' || u.name === '관리자') || { name: '관리자' };
        setLoggedInName(currentUser.name);

        const masterData = await gRes.json();
        setAllMasterGroups(masterData);
  
        // 🚀 헤더의 조직 드롭다운 선택값 스토리지 저장 연동 유지
        const savedGroupId = localStorage.getItem('selected_it_group_id');
        if (savedGroupId && masterData.some((g: any) => g.id === savedGroupId)) {
          setSelectedGroupId(savedGroupId);
        } else {
          const targetGroup = masterData.find((g: any) => g.id === 'GRP_IT_TYPE' || g.name.includes('IT'));
          if (targetGroup) setSelectedGroupId(targetGroup.id);
        }
  
        const savedAssets = localStorage.getItem('it_assets_db');
        const savedHistory = localStorage.getItem('it_assets_history_db');
        if (savedAssets && savedAssets !== '[]') {
          setAssets(JSON.parse(savedAssets));
        } else {
          setAssets([{ id: 'asset-1', no: 1, category: 'HW', it_type: '노트북', dept: '경영기획센터', user: '홍길동', code: 'KPCQA-2026-001', model: 'LG gram 16', sn: 'SN12345678', spec: 'i7/16GB/512GB', brand: 'LG', is_rental: '렌탈', rental_months: 24, in_date: '2024-01-10', start_date: '2024-01-10', end_date: '2026-01-10', purchase_price: 1500000, monthly_fee: 55000, monthly_sub_fee: 0, first_bill: '2024-02-01', cycle: 24, memo: '-', reg_date: '2024-01-10' }]);
        }
        if (savedHistory) setHistory(JSON.parse(savedHistory));
  
        const savedReqs = localStorage.getItem('it_requests_db');
        if (savedReqs) {
          const allReqs = JSON.parse(savedReqs);
          setUserRequests(allReqs.filter((r: any) => r.status !== '완료'));
          setRequestHistory(allReqs.filter((r: any) => r.status === '완료'));
        }
      } catch (e) { console.error("Sync Failed", e); }
      finally { setLoading(false); }
    };
    init();
  }, []);
  
  useEffect(() => {
    if (!loading) {
      localStorage.setItem('it_assets_db', JSON.stringify(assets));
      localStorage.setItem('it_assets_history_db', JSON.stringify(history));
      if (selectedGroupId) localStorage.setItem('selected_it_group_id', selectedGroupId); 
    }
  }, [assets, history, selectedGroupId, loading]);
  
  const confirmCompleteRequest = () => {
    if (!adminOpinion.trim()) return alert("처리의견을 입력해주세요.");
    const rawReqs = JSON.parse(localStorage.getItem('it_requests_db') || '[]');
    const updated = rawReqs.map((req: any) => {
      if (req.id === showOpinionModal) {
        return { ...req, status: '완료', adminOpinion, adminName: loggedInName, completedAt: new Date().toLocaleDateString() };
      }
      return req;
    });
    localStorage.setItem('it_requests_db', JSON.stringify(updated));
    setUserRequests(updated.filter((r: any) => r.status !== '완료'));
    setRequestHistory(updated.filter((r: any) => r.status === '완료'));
    setShowOpinionModal(null); setAdminOpinion('');
    alert("처리가 완료되어 하단 이력 탭으로 이동되었습니다.");
  };
  
  useEffect(() => {
    if (!selectedGroupId) return;
    const group = allMasterGroups.find(g => g.id === selectedGroupId);
    if (group) setCurrentItTypeCodes(group.codes);
  }, [selectedGroupId, allMasterGroups]);
  
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
    return { turnDisplay, repDate, dday, isTargetCount: dday <= 90 };
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
  }, [assets]);
  
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
      return matchSearch && matchDept && matchCategory && matchType && matchRental && (!showReplaceableOnly || logic.isTargetCount) && (!showDuplicatesOnly || duplicateCodes.has(a.code));
    });
  }, [assets, searchQuery, colFilters, showReplaceableOnly, showDuplicatesOnly, duplicateCodes]);
  
  const filteredHistory = useMemo(() => {
    const s = historySearchQuery.toLowerCase().trim();
    return history.filter((h: any) => !s || Object.values(h).some(v => String(v).toLowerCase().includes(s)));
  }, [history, historySearchQuery]);
  
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const paginatedHistory = filteredHistory.slice((historyPage - 1) * itemsPerPage, historyPage * itemsPerPage);
  
  const reqHistoryTotalPages = Math.max(1, Math.ceil(requestHistory.length / itemsPerPage));
  const paginatedReqHistory = requestHistory.slice((reqHistoryPage - 1) * itemsPerPage, reqHistoryPage * itemsPerPage);
  
  const handleFieldChange = (id: string, field: string, value: any) => {
    setAssets(prev => prev.map(a => {
      if (a.id !== id) return a;
      let updated = { ...a, [field]: value };
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
          upload_timestamp: nowTime
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
        '입고일': a.in_date, '계약시작일': a.start_date, '계약종료일': a.end_date, '첫회청구일': a.first_bill, '납입/총회': logic.turnDisplay, '교체주기(M)': a.cycle, '교체가능일(자동)': logic.repDate, '기타': a.memo, '등록일자': a.reg_date
      };
    });
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ITAssets"); XLSX.writeFile(wb, `IT_Assets.xlsx`);
  };
  
  const handleBackupAndDelete = (type: 'reqHistory' | 'archive', isBackup: boolean) => {
    const targetIds = type === 'reqHistory' ? selectedReqHistoryIds : selectedArchiveIds;
    const dataSource = type === 'reqHistory' ? requestHistory : history;
    
    if (targetIds.size === 0) return alert('처리할 항목을 선택해주세요.');
  
    const selectedData = dataSource.filter(d => targetIds.has(d.id));
  
    if (isBackup) {
      let exportData = [];
      if (type === 'reqHistory') {
        exportData = selectedData.map((h, idx) => ({
          'NO': idx + 1,
          '신청일': h.requestDate || '-',
          '신청자': `${h.requester} (${h.dept})`,
          '대상 자산': `${h.assetType || '-'} | ${h.assetCode || '-'} | ${h.assetModel || h.assetInfo || '-'}`,
          '내용': h.content,
          '관리자 처리의견': h.adminOpinion,
          '관리자': h.adminName || loggedInName,
          '완료일': h.completedAt || '-'
        }));
      } else {
        exportData = selectedData.map((h, idx) => ({
          'NO': idx + 1,
          '종료일': h.terminated_at,
          '분류': h.it_type,
          '상태': h.status,
          '자산번호': h.code,
          '모델명': h.model,
          '사유': h.reason
        }));
      }
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Backup_Data");
      XLSX.writeFile(wb, `${type}_backup_${Date.now()}.xlsx`);
    }
  
    if (confirm(isBackup ? '백업 다운로드가 시작되었습니다. 이어서 리스트에서 영구 삭제하시겠습니까?' : '백업 없이 영구 삭제하시겠습니까? 복구할 수 없습니다.')) {
      if (type === 'reqHistory') {
        const updated = requestHistory.filter(h => !targetIds.has(h.id));
        setRequestHistory(updated);
        const rawReqs = JSON.parse(localStorage.getItem('it_requests_db') || '[]');
        localStorage.setItem('it_requests_db', JSON.stringify(rawReqs.filter((r:any) => !(r.status === '완료' && targetIds.has(r.id)))));
        setSelectedReqHistoryIds(new Set());
      } else {
        setHistory(history.filter(h => !targetIds.has(h.id)));
        setSelectedArchiveIds(new Set());
      }
    }
  };
  
  const handleDeleteSelected = () => {
    if (selectedIds.size === 0 || !confirm(`정말 삭제하시겠습니까?`)) return;
    setAssets(prev => prev.filter(a => !selectedIds.has(a.id))); setSelectedIds(new Set());
  };
  
  const handleRestore = (id: string) => {
    const target = history.find(h => h.id === id);
    if (target) { setAssets([{ ...target, status: 'Active' }, ...assets]); setHistory(history.filter(h => h.id !== id)); }
  };
  
  const confirmTerminate = () => {
    const target = assets.find(a => a.id === showReasonModal?.id);
    if (target) {
      setHistory([{ ...target, status: showReasonModal?.type, reason, terminated_at: new Date().toLocaleDateString() }, ...history]);
      setAssets(assets.filter(a => a.id !== target.id)); setShowReasonModal(null); setReason('');
    }
  };
  
  const handleAdd = () => {
    const newId = `ASSET-${Date.now()}`; const today = new Date().toISOString().split('T')[0];
    const newObj = { id: newId, category: 'HW', it_type: currentItTypeCodes[0]?.label || '', dept: 'KPCQA', user: '', code: '', model: '', sn: '', spec: '', brand: '', is_rental: '구매', rental_months: 0, in_date: today, start_date: '', end_date: '', purchase_price: 0, monthly_fee: 0, monthly_sub_fee: 0, first_bill: '', cycle: 48, memo: '-', reg_date: today, upload_timestamp: Date.now() };
    setAssets(prev => [newObj, ...prev]); 
    setEditingId(newId); setCurrentPage(1);
  };
  
  const formatNumber = (val: any) => val?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") || '0';
  
  if (loading) return <div className="p-10 font-bold text-slate-300 animate-pulse text-center">Syncing Master Hub & DB...</div>;
  
  return (
    <div className="p-4 space-y-4 bg-[#F8FAFC] min-h-screen font-sans text-slate-900 text-[11px]">
  
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 p-5 shadow-sm rounded-xl flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-[-10px] right-[-10px] w-20 h-20 bg-blue-50 rounded-full opacity-50"></div>
          <div className="relative z-10">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">전사 IT·업무자산</p>
            <p className="text-3xl font-bold text-slate-900 leading-none">{stats.total} <span className="text-xs text-slate-400 font-medium ml-1">Items</span></p>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-50 relative z-10">
            <div className="text-center border-r border-slate-100"><p className="text-[9px] text-slate-400 font-bold mb-1">H/W</p><p className="text-sm font-bold text-blue-600">{stats.hwCount}</p></div>
            <div className="text-center border-r border-slate-100"><p className="text-[9px] text-slate-400 font-bold mb-1">S/W</p><p className="text-sm font-bold text-indigo-600">{stats.swCount}</p></div>
            <div className="text-center"><p className="text-[9px] text-slate-400 font-bold mb-1">비품</p><p className="text-sm font-bold text-amber-600">{stats.furnitureCount}</p></div>
          </div>
        </div>
        
        <div className="bg-slate-900 p-5 shadow-md rounded-xl flex flex-col justify-between col-span-2">
          <div className="flex justify-between items-start">
             <div><h2 className="text-white text-xl font-bold tracking-tight">전사 IT·업무자산 운영 현황</h2></div>
             <div className="flex gap-2">
               <button onClick={() => setShowReplaceableOnly(!showReplaceableOnly)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${showReplaceableOnly ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>교체대상 {stats.replaceableCount}</button>
               <button onClick={() => setShowDuplicatesOnly(!showDuplicatesOnly)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${showDuplicatesOnly ? 'bg-red-600 border-red-600 text-white' : 'bg-slate-800 border-slate-700 text-red-400 hover:text-white'}`}>🚨 중복관리 {duplicateCodes.size}</button>
               <button onClick={() => setShowUserRequestModal(true)} className="relative px-3 py-1.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 shadow-lg border border-indigo-500">
                 📩 사용자 요구사항 확인
                 {userRequests.length > 0 && <span className="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-[9px] border-2 border-slate-900 animate-bounce">{userRequests.length}</span>}
               </button>
             </div>
          </div>
          <div className="flex gap-3 overflow-x-auto mt-4 pb-1 scrollbar-hide">
             {Object.entries(stats.counts).map(([type, count]: any) => (
               <div key={type} className="bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 shrink-0 font-bold"><span className="text-[10px] text-slate-500 mr-2 uppercase">{type}</span><span className="text-white">{count}</span></div>
             ))}
          </div>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 shadow-md rounded-xl overflow-hidden">
        
        <div onClick={() => setIsAssetListOpen(!isAssetListOpen)} className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-4 cursor-pointer">
          <h3 className="text-xs font-bold text-slate-900 uppercase">IT·업무자산 리스트</h3>
          <span className="text-[10px] text-slate-400">{isAssetListOpen ? '닫기 ▲' : '열기 ▼'}</span>
        </div>
        
        {isAssetListOpen && (
          <>
            <div className="p-3 bg-white border-b border-slate-100 flex flex-wrap gap-3 items-center font-bold">
              <div className="flex-1 min-w-[300px]">
                <input type="text" placeholder="사용자, 자산번호, 모델명, S/N 통합검색" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded-lg outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <select className="p-1.5 border border-slate-200 rounded" value={colFilters.category} onChange={e => setColFilters({ ...colFilters, category: e.target.value })}><option>범주</option><option>HW</option><option>SW</option><option>비품</option></select>
                <select className="p-1.5 border border-slate-200 rounded" value={colFilters.it_type} onChange={e => setColFilters({ ...colFilters, it_type: e.target.value })}>
                  <option value="자산 분류">{currentGroupName}</option>
                  {currentItTypeCodes.map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
                </select>
                <select className="p-1.5 border border-slate-200 rounded" value={colFilters.dept} onChange={e => setColFilters({ ...colFilters, dept: e.target.value })}><option>조직</option>{orgs.map(o => <option key={o.id} value={o.unit_name}>{o.unit_name}</option>)}</select>
                <select className="p-1.5 border border-slate-200 rounded" value={colFilters.is_rental} onChange={e => setColFilters({ ...colFilters, is_rental: e.target.value })}><option>조달유형</option><option>구매</option><option>렌탈</option><option>구독</option></select>
                
                <div className="w-px h-6 bg-slate-300 mx-1"></div>
                <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-600 hover:text-white transition-all">⬆️ 엑셀 업로드</button>
                <input type="file" ref={fileInputRef} onChange={handleExcelUpload} accept=".xlsx, .xls" className="hidden" />
                <button onClick={handleExcelDownload} className="px-3 py-1.5 bg-slate-100 text-slate-700 border rounded hover:bg-slate-200 transition-all">⬇️ 엑셀 다운로드</button>
                <button onClick={handleDeleteSelected} className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-600 hover:text-white transition-all">🗑️ 선택 삭제</button>
                <button onClick={handleAdd} className="px-3 py-1.5 bg-blue-600 text-white rounded shadow-md hover:bg-blue-700 transition-all">+ 신규 자산</button>
              </div>
            </div>
  
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[3800px] table-fixed">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 uppercase font-bold border-b border-slate-800">
                    <th className="p-3 w-[40px] min-w-[40px] text-center sticky left-0 bg-slate-900 z-30"><input type="checkbox" checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedIds.has(a.id))} onChange={toggleSelectAll} /></th>
                    <th className="p-3 w-[50px] min-w-[50px] text-center sticky left-[40px] bg-slate-900 z-30">NO</th>
                    <th className="p-3 w-[50px] min-w-[50px] text-center sticky left-[90px] bg-slate-900 z-30 text-blue-400">수정</th>
                    <th className="p-3 w-[60px] min-w-[60px] text-center sticky left-[140px] bg-slate-900 z-30">범주</th>
                    <th className="p-3 w-[120px] min-w-[120px] sticky left-[200px] bg-slate-900 z-30 text-blue-400">
                       <div className="flex flex-col gap-1">
                        <span className="uppercase">admin04</span>
                        <select value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)} className="bg-slate-800 text-[10px] font-bold border-none text-blue-300 outline-none rounded p-0.5"><option value="">그룹선택</option>{allMasterGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                      </div>
                    </th>
                    <th className="p-3 w-[150px] min-w-[150px] sticky left-[320px] bg-slate-900 z-30">조직</th>
                    <th className="p-3 w-[100px] min-w-[100px] sticky left-[470px] bg-slate-900 z-30 border-r-2 border-slate-500 text-blue-400">사용자</th>
                    <th className="p-3 w-[220px] min-w-[220px]">자산번호</th>
                    <th className="p-3 w-[250px] min-w-[250px]">모델명</th>
                    <th className="p-3 w-[180px] min-w-[180px]">S/N</th>
                    <th className="p-3 w-[160px] min-w-[160px]">제조사</th>
                    <th className="p-3 w-[300px] min-w-[300px]">기본 사양</th>
                    <th className="p-3 w-[100px] min-w-[100px] text-center">조달유형</th>
                    <th className="p-3 w-[130px] min-w-[130px] text-center">렌탈/구독기간(M)</th>
                    <th className="p-3 w-[130px] min-w-[130px] text-right text-emerald-400">초기구매비(원)</th>
                    <th className="p-3 w-[130px] min-w-[130px] text-right text-emerald-400">월렌탈료(원)</th>
                    <th className="p-3 w-[130px] min-w-[130px] text-right text-indigo-400">월구독료(원)</th>
                    <th className="p-3 w-[120px] min-w-[120px] text-center">입고일</th>
                    <th className="p-3 w-[120px] min-w-[120px] text-center">계약시작일</th>
                    <th className="p-3 w-[120px] min-w-[120px] text-center">계약종료일</th>
                    <th className="p-3 w-[120px] min-w-[120px] text-center text-blue-300">첫회청구일</th>
                    <th className="p-3 w-[100px] min-w-[100px] text-center">납입/총회</th>
                    <th className="p-3 w-[120px] min-w-[120px] text-center">교체주기(M)</th>
                    <th className="p-3 w-[180px] min-w-[180px] bg-slate-800 text-white text-center">교체예정일(자동)</th>
                    <th className="p-3 w-[130px] min-w-[130px] text-center">종료(반납/폐기)</th>
                    <th className="p-3 w-[250px] min-w-[250px]">기타</th>
                    <th className="p-3 w-[120px] min-w-[120px] text-center">등록일자</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold">
                  {paginatedAssets.map((a, idx) => {
                    const { turnDisplay, repDate, dday } = getAssetLogic(a);
                    const isEditing = editingId === a.id;
                    const isP = a.is_rental === '구매';
                    const isS = a.is_rental === '구독';
                    const isR = a.is_rental === '렌탈';
    
                    const isNew = a.upload_timestamp && (Date.now() - a.upload_timestamp < 3600000);
                    const rowBg = isEditing ? 'bg-blue-50/50' : (isNew ? 'bg-emerald-50' : (duplicateCodes.has(a.code) ? 'bg-red-50/30' : 'bg-white'));
                    const stickyBg = isEditing ? 'bg-blue-50/95' : (isNew ? 'bg-emerald-50/95' : (duplicateCodes.has(a.code) ? 'bg-red-50/95' : 'bg-white'));
                    
                    const inputClass = "w-full px-2 py-1 bg-white border border-blue-300 rounded text-blue-700 font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm";
                    
                    return (
                      <tr key={a.id} className={`hover:bg-slate-50 transition-all h-10 ${rowBg}`}>
                        <td className={`p-2 w-[40px] min-w-[40px] text-center sticky left-0 z-20 ${stickyBg}`}><input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} /></td>
                        <td className={`p-2 w-[50px] min-w-[50px] text-center text-slate-400 sticky left-[40px] z-20 ${stickyBg}`}>{(currentPage-1)*itemsPerPage + idx + 1}</td>
                        <td className={`p-2 w-[50px] min-w-[50px] text-center sticky left-[90px] z-20 ${stickyBg}`}><button onClick={() => setEditingId(isEditing ? null : a.id)} className="text-blue-600 font-bold">{isEditing ? '💾' : '✏️'}</button></td>
                        
                        <td className={`p-2 w-[60px] min-w-[60px] text-center font-bold sticky left-[140px] z-20 ${stickyBg}`}>
                          {isEditing ? <select value={a.category} onChange={e => handleFieldChange(a.id, 'category', e.target.value)} className={inputClass}><option>HW</option><option>SW</option><option>비품</option></select> : a.category}
                        </td>
                        <td className={`p-2 w-[120px] min-w-[120px] text-blue-600 font-bold sticky left-[200px] z-20 ${stickyBg}`}>
                          {isEditing ? <select value={a.it_type} onChange={e => handleFieldChange(a.id, 'it_type', e.target.value)} className={inputClass}>{currentItTypeCodes.map(c => <option key={c.id}>{c.label}</option>)}</select> : a.it_type}
                        </td>
                        <td className={`p-2 w-[150px] min-w-[150px] font-bold sticky left-[320px] z-20 ${stickyBg}`}>
                          {isEditing ? <select value={a.dept} onChange={e => handleFieldChange(a.id, 'dept', e.target.value)} className={inputClass}>{orgs.map(o => <option key={o.id}>{o.unit_name}</option>)}</select> : a.dept}
                        </td>
                        
                        {/* 🚀 [수정] 사용자 텍스트 인풋을 select 드롭다운으로 변경 & 이메일 병기(동명이인 방지) 처리 완료 */}
                        <td className={`p-2 w-[100px] min-w-[100px] text-blue-600 font-bold sticky left-[470px] z-20 border-r-2 border-slate-300 ${stickyBg}`}>
                          {isEditing ? (
                            <select value={a.user || ''} onChange={e => handleFieldChange(a.id, 'user', e.target.value)} className={inputClass}>
                              <option value="">공용</option>
                              {users.map((u, i) => (
                                <option key={u.email || i} value={u.name}>
                                  {u.name} {u.email ? `(${u.email.split('@')[0]})` : ''}
                                </option>
                              ))}
                              {/* 엑셀 등으로 들어온 기존 데이터(리스트에 없는 경우) 호환 보장 */}
                              {a.user && !users.some(u => u.name === a.user) && <option value={a.user}>{a.user}</option>}
                            </select>
                          ) : (a.user || '공용')}
                        </td>

                        <td className="p-2 w-[220px] min-w-[220px] font-bold">
                          {isEditing ? <input type="text" value={a.code} onChange={e => handleFieldChange(a.id, 'code', e.target.value)} className={inputClass} /> : (
                            <div className="flex items-center gap-1"><span>{a.code}</span>{duplicateCodes.has(a.code) && <span className="text-red-600 text-[9px] animate-pulse">(중복!)</span>}</div>
                          )}
                        </td>
                        <td className="p-2 w-[250px] min-w-[250px]">
                          {isEditing ? <input type="text" value={a.model} onChange={e => handleFieldChange(a.id, 'model', e.target.value)} className={inputClass} /> : <span className="truncate block">{a.model}</span>}
                        </td>
                        <td className="p-2 w-[180px] min-w-[180px] text-slate-500">
                          {isEditing ? <input type="text" value={a.sn} onChange={e => handleFieldChange(a.id, 'sn', e.target.value)} className={inputClass} /> : a.sn}
                        </td>
                        <td className="p-2 w-[160px] min-w-[160px] font-bold">
                          {isEditing ? <input type="text" value={a.brand} onChange={e => handleFieldChange(a.id, 'brand', e.target.value)} className={inputClass} /> : a.brand}
                        </td>
                        <td className="p-2 w-[300px] min-w-[300px] text-slate-400">
                          {isEditing ? <input type="text" value={a.spec} onChange={e => handleFieldChange(a.id, 'spec', e.target.value)} className={inputClass} /> : <span className="truncate block">{a.spec}</span>}
                        </td>
                        <td className="p-2 w-[100px] min-w-[100px] text-center">
                          {isEditing ? <select value={a.is_rental} onChange={e => handleFieldChange(a.id, 'is_rental', e.target.value)} className={inputClass}><option>구매</option><option>렌탈</option><option>구독</option></select> : <span className={`px-2 py-0.5 rounded ${isP ? 'bg-slate-100' : 'bg-indigo-50 text-indigo-600'}`}>{a.is_rental}</span>}
                        </td>
                        <td className="p-2 w-[130px] min-w-[130px] text-center">
                          {isEditing && !isP ? <input type="number" value={a.rental_months} onChange={e => handleFieldChange(a.id, 'rental_months', e.target.value)} className={inputClass} /> : (isP ? '-' : a.rental_months)}
                        </td>
                        <td className="p-2 w-[130px] min-w-[130px] text-right text-emerald-700">
                          {isEditing ? <input type="number" value={a.purchase_price} onChange={e => handleFieldChange(a.id, 'purchase_price', e.target.value)} className={inputClass} /> : formatNumber(a.purchase_price)}
                        </td>
                        <td className="p-2 w-[130px] min-w-[130px] text-right text-emerald-700">
                          {isEditing && isR ? <input type="number" value={a.monthly_fee} onChange={e => handleFieldChange(a.id, 'monthly_fee', e.target.value)} className={inputClass} /> : (isR ? formatNumber(a.monthly_fee) : '-')}
                        </td>
                        <td className="p-2 w-[130px] min-w-[130px] text-right text-indigo-700">
                          {isEditing && isS ? <input type="number" value={a.monthly_sub_fee} onChange={e => handleFieldChange(a.id, 'monthly_sub_fee', e.target.value)} className={inputClass} /> : (isS ? formatNumber(a.monthly_sub_fee) : '-')}
                        </td>
                        <td className="p-2 w-[120px] min-w-[120px] text-center">
                          {isEditing ? <input type="date" value={a.in_date} onChange={e => handleFieldChange(a.id, 'in_date', e.target.value)} className={inputClass} /> : a.in_date}
                        </td>
                        <td className="p-2 w-[120px] min-w-[120px] text-center">
                          {isEditing && !isP ? <input type="date" value={a.start_date} onChange={e => handleFieldChange(a.id, 'start_date', e.target.value)} className={inputClass} /> : (isP ? '-' : a.start_date)}
                        </td>
                        <td className="p-2 w-[120px] min-w-[120px] text-center">
                          {isEditing && !isP ? <input type="date" value={a.end_date} onChange={e => handleFieldChange(a.id, 'end_date', e.target.value)} className={inputClass} /> : (isP ? '-' : a.end_date)}
                        </td>
                        <td className="p-2 w-[120px] min-w-[120px] text-center text-blue-600">
                          {isEditing && !isP ? <input type="date" value={a.first_bill} onChange={e => handleFieldChange(a.id, 'first_bill', e.target.value)} className={inputClass} /> : (isP ? '-' : a.first_bill)}
                        </td>
                        <td className="p-2 w-[100px] min-w-[100px] text-center font-bold">{isP ? '-' : turnDisplay}</td>
                        <td className="p-2 w-[120px] min-w-[120px] text-center font-bold">
                          {isEditing ? <input type="number" value={a.cycle} onChange={e => handleFieldChange(a.id, 'cycle', e.target.value)} className={inputClass} /> : a.cycle}
                        </td>
                        <td className="p-2 w-[180px] min-w-[180px] bg-slate-50/50 text-center font-bold">
                          <div>{repDate}</div>
                          {dday !== null && dday <= 90 && !isEditing && <span className={`text-[9px] px-1 rounded ${dday <= 0 ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-600 text-white'}`}>{dday <= 0 ? `D+${Math.abs(dday)}` : `D-${dday}`}</span>}
                        </td>
                        <td className="p-2 w-[130px] min-w-[130px] text-center space-x-1">
                          <button onClick={() => setShowReasonModal({id: a.id, type: '반납'})} className="px-2 py-0.5 bg-amber-500 text-white rounded text-[9px] font-bold">반납</button>
                          <button onClick={() => setShowReasonModal({id: a.id, type: '폐기'})} className="px-2 py-1 bg-red-600 text-white rounded text-[9px] font-bold">폐기</button>
                        </td>
                        <td className="p-2 w-[250px] min-w-[250px] text-slate-400">
                          {isEditing ? <input type="text" value={a.memo} onChange={e => handleFieldChange(a.id, 'memo', e.target.value)} className={inputClass} /> : <span className="truncate block">{a.memo}</span>}
                        </td>
                        <td className="p-2 w-[120px] min-w-[120px] text-center text-slate-400">{a.reg_date}</td>
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
          </>
        )}
      </div>
  
      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">
        <div onClick={() => setIsReqHistoryOpen(!isReqHistoryOpen)} className="p-4 bg-indigo-900 text-white flex justify-between items-center cursor-pointer">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-bold uppercase tracking-tight">📋 사용자 요구사항 처리 이력</h3>
            {isReqHistoryOpen && selectedReqHistoryIds.size > 0 && (
              <div className="flex items-center gap-2 ml-4" onClick={e => e.stopPropagation()}>
                <span className="text-[10px] text-indigo-200">[{selectedReqHistoryIds.size}건 선택됨]</span>
                <button onClick={() => handleBackupAndDelete('reqHistory', true)} className="px-2 py-1 bg-indigo-700 text-white border border-indigo-500 rounded text-[9px] hover:bg-indigo-600">엑셀저장 후 삭제</button>
                <button onClick={() => handleBackupAndDelete('reqHistory', false)} className="px-2 py-1 bg-red-600 text-white rounded text-[9px] hover:bg-red-500">영구삭제</button>
              </div>
            )}
          </div>
          <span>{isReqHistoryOpen ? '닫기 ▲' : '열기 ▼'}</span>
        </div>
        {isReqHistoryOpen && (
          <div className="overflow-x-auto font-bold text-slate-600">
            <table className="w-full text-left text-[11px] border-collapse min-w-[1400px] table-fixed">
              <thead>
                <tr className="bg-slate-50 border-b uppercase text-slate-500">
                  <th className="p-3 w-[40px] text-center">
                    <input type="checkbox" checked={paginatedReqHistory.length > 0 && paginatedReqHistory.every(h => selectedReqHistoryIds.has(h.id))} onChange={() => { const next = new Set(selectedReqHistoryIds); const allSel = paginatedReqHistory.every(h => selectedReqHistoryIds.has(h.id)); paginatedReqHistory.forEach(h => allSel ? next.delete(h.id) : next.add(h.id)); setSelectedReqHistoryIds(next); }} />
                  </th>
                  <th className="p-3 w-[50px] text-center">NO</th>
                  <th className="p-3 w-[100px] text-center">신청일</th>
                  <th className="p-3 w-[150px]">신청자</th>
                  <th className="p-3 w-[250px]">대상 자산</th>
                  <th className="p-3 w-[300px]">내용</th>
                  <th className="p-3 w-[300px] text-indigo-600">관리자 처리의견</th>
                  <th className="p-3 w-[100px] text-center text-indigo-600">관리자</th>
                  <th className="p-3 w-[100px] text-center">완료일</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paginatedReqHistory.map((h, idx) => (
                <tr key={h.id} className="hover:bg-slate-50">
                  <td className="p-2 text-center"><input type="checkbox" checked={selectedReqHistoryIds.has(h.id)} onChange={() => { const next = new Set(selectedReqHistoryIds); next.has(h.id) ? next.delete(h.id) : next.add(h.id); setSelectedReqHistoryIds(next); }} /></td>
                  <td className="p-2 text-center text-slate-400">{(reqHistoryPage - 1) * itemsPerPage + idx + 1}</td>
                  <td className="p-2 text-center text-slate-500">{h.requestDate || '-'}</td>
                  <td className="p-2">{h.requester} ({h.dept})</td>
                  <td className="p-2 truncate text-[10px]">{h.assetType || '-'} | {h.assetCode || '-'} | {h.assetModel || h.assetInfo || '-'}</td>
                  <td className="p-2 italic truncate cursor-pointer" onClick={() => setSelectedRequestDetail(h)}>"{h.content}"</td>
                  <td className="p-2 text-indigo-700 bg-indigo-50/30 truncate" title={h.adminOpinion}>{h.adminOpinion}</td>
                  <td className="p-2 text-center text-indigo-700">{h.adminName || loggedInName}</td>
                  <td className="p-2 text-center text-indigo-600">{h.completedAt || '-'}</td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        )}
        {isReqHistoryOpen && reqHistoryTotalPages > 1 && (
          <div className="flex justify-center gap-2 p-4 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: reqHistoryTotalPages }).map((_, i) => (
              <button key={i} onClick={() => setReqHistoryPage(i + 1)} className={`px-3 py-1 border rounded font-bold text-[11px] shadow-sm transition-all ${reqHistoryPage === i + 1 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>
  
      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">
        <div onClick={() => setIsArchiveOpen(!isArchiveOpen)} className="p-4 flex justify-between items-center cursor-pointer bg-slate-800 text-white hover:bg-slate-700 transition-all">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-bold uppercase tracking-tighter">📦 반납/폐기 자산 아카이브</h3>
            {isArchiveOpen && selectedArchiveIds.size > 0 && (
              <div className="flex items-center gap-2 ml-4" onClick={e => e.stopPropagation()}>
                <span className="text-[10px] text-slate-400">[{selectedArchiveIds.size}건 선택됨]</span>
                <button onClick={() => handleBackupAndDelete('archive', true)} className="px-2 py-1 bg-slate-600 text-white border border-slate-500 rounded text-[9px] hover:bg-slate-500">엑셀저장 후 삭제</button>
                <button onClick={() => handleBackupAndDelete('archive', false)} className="px-2 py-1 bg-red-600 text-white rounded text-[9px] hover:bg-red-500">영구삭제</button>
              </div>
            )}
          </div>
          <span>{isArchiveOpen ? '접기 ▲' : '열기 ▼'}</span>
        </div>
        {isArchiveOpen && (
          <div className="p-5 font-bold text-slate-600 overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse min-w-[1400px]">
              <thead>
                <tr className="bg-slate-100 text-slate-500 border-b uppercase">
                  <th className="p-3 w-[40px] text-center">
                    <input type="checkbox" checked={paginatedHistory.length > 0 && paginatedHistory.every((h:any) => selectedArchiveIds.has(h.id))} onChange={() => { const next = new Set(selectedArchiveIds); const allSel = paginatedHistory.every((h:any) => selectedArchiveIds.has(h.id)); paginatedHistory.forEach((h:any) => allSel ? next.delete(h.id) : next.add(h.id)); setSelectedArchiveIds(next); }} />
                  </th>
                  <th className="p-3 w-[60px] text-center">NO</th><th className="p-3 w-[120px] text-center">종료일</th><th className="p-3 w-[80px] text-center">분류</th><th className="p-3 w-[80px] text-center">상태</th><th className="p-3 w-[180px]">자산번호</th><th className="p-3 w-[250px]">모델명</th><th className="p-3 w-auto">사유</th><th className="p-3 w-[100px] text-center">복구</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedHistory.map((h: any, i: number) => (
                  <tr key={h.id} className="hover:bg-slate-50 h-10 transition-colors">
                    <td className="p-2 text-center"><input type="checkbox" checked={selectedArchiveIds.has(h.id)} onChange={() => { const next = new Set(selectedArchiveIds); next.has(h.id) ? next.delete(h.id) : next.add(h.id); setSelectedArchiveIds(next); }} /></td>
                    <td className="p-2 text-center text-slate-400">{(historyPage - 1) * itemsPerPage + i + 1}</td><td className="p-2 text-center text-red-500">{h.terminated_at}</td><td className="p-2 text-center">{h.it_type}</td><td className="p-2 text-center"><span className={`px-2 py-0.5 rounded text-[9px] ${h.status === '폐기' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>{h.status}</span></td><td className="p-2">{h.code}</td><td className="p-2 truncate">{h.model}</td><td className="p-2 italic truncate text-slate-700">"{h.reason}"</td><td className="p-2 text-center"><button onClick={() => handleRestore(h.id)} className="px-3 py-1 bg-slate-900 text-white rounded text-[10px] hover:bg-blue-600">복구</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isArchiveOpen && historyTotalPages > 1 && (
          <div className="flex justify-center gap-2 p-4 bg-slate-50 border-t border-slate-100">
            {Array.from({ length: historyTotalPages }).map((_, i) => (
              <button key={i} onClick={() => setHistoryPage(i + 1)} className={`px-3 py-1 border rounded font-bold text-[11px] shadow-sm transition-all ${historyPage === i + 1 ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>
  
      {showUserRequestModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
          <div className="bg-white w-[1000px] max-h-[80vh] flex flex-col shadow-2xl rounded-2xl overflow-hidden border">
            <div className="p-5 bg-indigo-700 text-white flex justify-between font-bold items-center">
              <span>📩 사용자 신규 요구사항 접수 현황</span><button onClick={() => setShowUserRequestModal(false)} className="text-2xl hover:rotate-90 transition-all">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 font-bold">
              <table className="w-full text-left border-collapse bg-white rounded shadow-sm">
                <thead><tr className="bg-slate-200 text-[10px] uppercase font-bold"><th className="p-3 w-[100px] text-center">요청일</th><th className="p-3 w-[120px]">신청자</th><th className="p-3 w-[250px]">대상 자산</th><th className="p-3 w-auto text-center">내용</th><th className="p-3 w-[120px] text-center">액션</th></tr></thead>
                <tbody className="text-[11px] divide-y">
                  {userRequests.map(req => (
                    <tr key={req.id} className="hover:bg-indigo-50/50">
                      <td className="p-3 text-center">{req.requestDate}</td><td className="p-3">{req.requester} ({req.dept || '소속 미정'})</td><td className="p-3 text-indigo-600">{req.assetType} | {req.assetCode} | {req.assetModel || req.assetInfo}</td><td className="p-3"><div onClick={() => setSelectedRequestDetail(req)} className="bg-slate-50 p-2 rounded italic cursor-pointer line-clamp-1 hover:bg-white shadow-inner">"{req.content}"</div></td><td className="p-3 text-center"><button onClick={() => { setShowOpinionModal(req.id); setAdminOpinion(''); }} className="bg-indigo-600 text-white px-3 py-1.5 rounded font-bold shadow-md hover:bg-indigo-700 transition-all">처리완료 승인</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
  
      {showOpinionModal && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-[400px] rounded-2xl shadow-2xl p-8 border">
            <h4 className="font-bold border-b pb-3 mb-5 uppercase text-[10px]">Processing Opinion</h4>
            <textarea value={adminOpinion} onChange={e => setAdminOpinion(e.target.value)} placeholder="조치 결과 의견을 입력하세요." className="w-full h-32 bg-slate-50 border p-4 text-[11px] font-bold outline-none rounded-lg focus:border-indigo-500 shadow-inner resize-none" />
            <div className="flex gap-2 mt-6 font-bold text-[11px]">
              <button onClick={() => setShowOpinionModal(null)} className="flex-1 py-3 bg-slate-100 rounded-xl">취소</button>
              <button onClick={confirmCompleteRequest} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl shadow-lg hover:bg-indigo-700">승인 및 이력저장</button>
            </div>
          </div>
        </div>
      )}
  
      {selectedRequestDetail && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-[450px] rounded-2xl shadow-2xl p-8 border">
            <h4 className="font-bold border-b pb-3 mb-5 flex justify-between items-center text-[10px]"><span>📋 Requirement View</span><span className="text-slate-400">{selectedRequestDetail.requestDate}</span></h4>
            <div className="space-y-4 font-bold">
              <div className="bg-indigo-50 p-3 rounded-lg border text-[11px] text-indigo-700">{selectedRequestDetail.assetType} | {selectedRequestDetail.assetCode} <br/> {selectedRequestDetail.assetModel || selectedRequestDetail.assetInfo}</div>
              <div className="bg-slate-50 p-4 rounded-lg border text-[12px] italic max-h-60 overflow-y-auto font-medium">"{selectedRequestDetail.content}"</div>
              {selectedRequestDetail.adminOpinion && (
                <div className="pt-4 border-t"><p className="text-emerald-500 text-[9px] uppercase mb-1">Admin Feedback</p><div className="bg-emerald-50 p-3 rounded text-[11px] text-emerald-800 italic">"{selectedRequestDetail.adminOpinion}"</div></div>
              )}
            </div>
            <button onClick={() => setSelectedRequestDetail(null)} className="w-full mt-8 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-slate-800 transition-all">닫기</button>
          </div>
        </div>
      )}
  
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
    </div>
  );
}