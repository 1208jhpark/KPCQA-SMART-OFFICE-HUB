'use client';
     
import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { useRouter } from 'next/navigation'; // 🚀 Next.js App Router 필수 임포트
import { getKSTDateString } from '@/utils/dateUtils';
import LocalQrImage from '@/components/common/LocalQrImage';
import { getItAssetVerifyUrl } from '@/utils/equipmentQr';
     
interface DashboardProps {
  moduleTitle?: string;
  moduleDescription?: string;
}
     
function MasterDashboardContent({ moduleTitle, moduleDescription }: DashboardProps) {
  const router = useRouter(); // 🚀 이 선언문이 있어야 router.push를 사용할 수 있습니다!
  const [assets, setAssets] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [masterFilters, setMasterFilters] = useState({
    categories: [] as string[],
    types: [] as string[],
    rentals: [] as string[]
  });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchUserQuery, setSearchUserQuery] = useState(''); 
  const [colFilters, setColFilters] = useState({ category: '범주 (전체)', it_type: '자산 분류 (전체)', dept: '조직 (전체)', is_rental: '조달유형 (전체)' });
  
  const [showReplaceableOnly, setShowReplaceableOnly] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [showStatusFilter, setShowStatusFilter] = useState<'all' | 'green' | 'red'>('all'); 
  const [showFeedbackFilter, setShowFeedbackFilter] = useState(false); 
  const [ddayFilter, setDdayFilter] = useState<'all' | 'd-30' | 'd-day' | 'd-plus'>('all'); 
  const [itMasterLabel, setItMasterLabel] = useState('자산 분류');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkPrintAssets, setBulkPrintAssets] = useState<any[]>([]); 
     
  const [showQrModal, setShowQrModal] = useState<any | null>(null);
  const [unifiedCommModal, setUnifiedCommModal] = useState<any | null>(null); 
  
  const [terminateModal, setTerminateModal] = useState<{
    id: string;
    reason: string;
    actionType: '반납' | '폐기' | '재판매' | null;
    reseller?: string;
    resellPrice?: number;
  } | null>(null);
     
  const [audits, setAudits] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [editingReq, setEditingReq] = useState<any>(null);
  const [editOpinion, setEditOpinion] = useState('');
     
  const fetchAllDataFromServer = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [assetRes, orgRes, userRes, reqRes, configRes, masterRes, auditRes] = await Promise.all([
        fetch(`/api/asset/it?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/units?active=true').catch(() => null),
        fetch('/api/admin/users').catch(() => null),
        fetch('/api/asset/it/requests').catch(() => null),
        fetch('/api/admin/config').catch(() => null),
        fetch('/api/admin/master-data').catch(() => null),
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }).catch(() => null)
      ]);
  
      if (assetRes && assetRes.ok) {
        const loadedAssets = await assetRes.json();
        setAssets(loadedAssets);
      }
  
      if (orgRes && orgRes.ok) setOrgs(await orgRes.json());
      if (userRes && userRes.ok) setUsers((await userRes.json()).users || []);
      if (reqRes && reqRes.ok) setRequests(await reqRes.json());
  
      let configData: any = {};
      if (configRes && configRes.ok) configData = await configRes.json();
      if (configData?.it_master_label) setItMasterLabel(configData.it_master_label);
      
      if (masterRes && masterRes.ok) {
        const masterData = await masterRes.json();
        const catGroup = masterData.find((g: any) => g.id === configData?.it_category_group);
        const typeGroup = masterData.find((g: any) => g.id === configData?.it_master_group);
        const rentalGroup = masterData.find((g: any) => g.id === configData?.it_rental_group);
        setMasterFilters({
          categories: catGroup?.codes ? catGroup.codes.filter((c: any) => !c.is_archived).map((c: any) => c.label) : [],
          types: typeGroup?.codes ? typeGroup.codes.filter((c: any) => !c.is_archived).map((c: any) => c.label) : [],
          rentals: rentalGroup?.codes ? rentalGroup.codes.filter((c: any) => !c.is_archived).map((c: any) => c.label) : []
        });
      }
     
      if (auditRes && auditRes.ok) {
        const loadedAudits = await auditRes.json();
        setAudits(loadedAudits);
      }
     
    } catch (e) { 
      console.error("데이터 동기화 에러", e); 
    } finally { 
      setLoading(false); 
    }
  };
  
  useEffect(() => { fetchAllDataFromServer(); }, []);
  useEffect(() => { setCurrentPage(1); }, [searchQuery, searchUserQuery, colFilters, showReplaceableOnly, showDuplicatesOnly, showStatusFilter, showFeedbackFilter, ddayFilter]);
     
  const formatNumber = (val: any) => val?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") || '0';
     
  const toggleSelectAll = () => {
    const currentPageIds = paginatedAssets.map(a => a.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
  
  const handleFieldChange = (id: string, field: string, value: any) => {
    setAssets(prev => prev.map(a => {
      if (a.id !== id) return a;
      
      const updated = { ...a, [field]: value };
  
      if (field === 'rental_months' || field === 'in_date') {
        const months = field === 'rental_months' ? Number(value) : Number(updated.rental_months);
        const startDate = field === 'in_date' ? value : updated.in_date;
  
        if (months > 0 && startDate) {
          const d = new Date(startDate);
          d.setMonth(d.getMonth() + months);
          updated.end_date = getKSTDateString(d);
        }
      }
      return updated;
    }));
  };
     
  const handleAdd = async () => {
    const today = getKSTDateString();
    const newId = `AST_TEMP_${Date.now()}`; 
    const newObj = { 
      id: newId, category: masterFilters.categories[0] || 'HW', it_type: masterFilters.types[0] || '기기', dept: 'KPCQA', user: '공용', code: `AST-${Date.now()}`, 
      model: '', sn: '', spec: '', brand: '', is_rental: masterFilters.rentals[0] || '구매', rental_months: 0, 
      in_date: today, start_date: null, end_date: null, purchase_price: 0, monthly_fee: 0, 
      monthly_sub_fee: 0, first_bill: null, cycle: 48, memo: '-', reg_date: today 
    };
    
    setAssets(prev => [newObj, ...prev]);
    setEditingId(newId);
    setCurrentPage(1);
  };
  
  const handleSaveEdit = async (id: string) => {
    const targetAsset = assets.find(a => a.id === id);
    if (!targetAsset) return;
    
    const isNew = id.includes('AST_TEMP') || id.includes('AST-');
    const method = isNew ? 'POST' : 'PATCH';
    
    const { id: _id, createdAt, updatedAt, ...submitData } = targetAsset;
    const payload = isNew ? submitData : { id, ...submitData };
    
    try {
      const response = await fetch(`/api/asset/it`, { 
        method: method, 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    
      if (response.ok) {
        setEditingId(null);
        alert(isNew ? "✅ 신규 자산이 PostgreSQL DB에 등록되었습니다." : "✅ 자산 정보가 성공적으로 수정되었습니다.");
        fetchAllDataFromServer(); 
      } else {
        const err = await response.json();
        alert(`❌ DB 저장 실패: ${err.message || '서버 에러가 발생했습니다.'}`);
      }
    } catch (error) {
      console.error("DB Save Error:", error);
      alert("❌ 서버 통신 중 오류가 발생했습니다.");
    }
  };
     
  const handleSingleDelete = async (id: string) => {
    const targetAsset = assets.find(a => a.id === id);
    if (!targetAsset) return;
    if (!confirm(`⚠️ [안내] 자산(${targetAsset.code})을 대장에서 제외하시겠습니까?\n이 작업은 사내 DB 관리 정책을 따릅니다.`)) return;
    
    try {
      const response = await fetch(`/api/asset/it?id=${id}`, { method: 'DELETE' });
      if (response.ok) {
        alert("✅ 자산이 성공적으로 대장에서 제외되었습니다.");
        fetchAllDataFromServer(); 
      } else {
        alert("❌ 제외 실패");
      }
    } catch (error) {
      console.error("Delete Error:", error);
      alert("❌ 서버 통신 중 오류가 발생했습니다.");
    }
  };
  
  // 🚀 DB 통신 전용: 아카이브 이관(종료 처리) 함수
  const confirmTerminate = async (id: string) => {
    const targetAsset = assets.find(a => a.id === id);
    if (!targetAsset) return;
    if (!confirm(`💼 자산(${targetAsset.code})을 '${terminateModal?.actionType}' 처리하고 아카이브로 이관하시겠습니까?`)) return;
    
    const archiveData = {
      ...targetAsset,
      status: terminateModal?.actionType,
      reason: terminateModal?.reason,
      reseller: terminateModal?.reseller || '-',
      resellPrice: terminateModal?.resellPrice || 0,
      terminated_at: getKSTDateString()
    };
    
    try {
      // 1. 아카이브 DB에 전송 (로컬스토리지 완전 제거됨)
      const archiveRes = await fetch(`/api/asset/it/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(archiveData)
      });

      if (!archiveRes.ok) throw new Error("Archive DB Save Failed");
      
      // 2. 운영 대장 DB에서 삭제 처리
      const response = await fetch(`/api/asset/it?id=${id}`, { method: 'DELETE' });
      
      if (response.ok) {
        alert("✅ 안전하게 아카이브 대장(DB)으로 이관되었습니다.");
        setTerminateModal(null);
        fetchAllDataFromServer(); 
      } else {
        alert("❌ 마스터 대장 삭제(이관) 실패");
      }
    } catch (error) {
      console.error("Terminate Error:", error);
      alert("❌ 서버 통신 오류가 발생했습니다.");
    }
  };
     
  const parseExcelDate = (val: any) => {
    if (!val) return '';
    if (typeof val === 'number') {
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      return getKSTDateString(date);
    }
    let strVal = String(val).trim().replace(/[\.\/]/g, '-');
    if (/^\d{8}$/.test(strVal)) return `${strVal.substring(0,4)}-${strVal.substring(4,6)}-${strVal.substring(6,8)}`;
    return strVal;
  };
     
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    
    reader.onload = async (evt) => {
      try {
        const arrayBuffer = evt.target?.result;
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<any>(ws);
        const today = getKSTDateString();
        
        const existingCodes = new Set(assets.map(a => a.code).filter(Boolean));
        const existingModels = new Set(assets.map(a => String(a.model || '').trim()).filter(Boolean));
     
        const validData: any[] = [];
        const skippedData: any[] = [];
     
        data.forEach((row, idx) => {
          const generatedCode = `AST-EX-${Date.now()}-${idx}`;
          const rowCode = row['자산번호'] || generatedCode;
          const rowModel = String(row['모델명'] || '').trim();
     
          const isCodeDup = existingCodes.has(rowCode);
          const isModelDup = rowModel !== '' && existingModels.has(rowModel);
     
          const newItem = {
            id: `AST-EXCEL-${Date.now()}-${idx}`,
            category: row['범주'] || 'HW',
            it_type: row['자산 분류'] || '',
            dept: row['조직'] || '',
            user: row['사용자'] || '공용',
            code: rowCode,
            model: row['모델명'] || '',
            sn: row['S/N'] || '',
            brand: row['제조사'] || '',
            spec: row['기본 사양'] || '',
            is_rental: row['조달유형'] || '구매',
            rental_months: parseInt(row['렌탈/구독(M)']) || 0,
            purchase_price: parseInt(row['초기구매비(원)']) || 0,
            monthly_fee: parseInt(row['월렌탈료(원)']) || 0,
            monthly_sub_fee: parseInt(row['월구독료(원)']) || 0,
            in_date: parseExcelDate(row['입고일자']),
            end_date: parseExcelDate(row['계약종료일']),
            first_bill: parseExcelDate(row['첫회청구일']),
            cycle: parseInt(row['교체주기(M)']) || 48,
            memo: row['비고메모'] || '-',
            reg_date: today
          };
     
          if (isCodeDup || isModelDup) {
            skippedData.push(newItem);
          } else {
            validData.push(newItem);
            existingCodes.add(rowCode);
            if (rowModel) existingModels.add(rowModel);
          }
        });
        
        if (validData.length === 0) {
          alert(`❌ 업로드한 ${data.length}건 모두 이미 등록된 자산번호/모델명이라 제외되었습니다.`);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
     
        setAssets(prev => [...validData, ...prev]);
        
        if (skippedData.length > 0) {
          alert(`⚠️ 총 ${data.length}건 중 중복된 ${skippedData.length}건을 제외하고, 정상적인 ${validData.length}건의 저장을 시작합니다...`);
        } else {
          alert(`⏳ 총 ${validData.length}건의 데이터를 서버 DB에 저장합니다...`);
        }
     
        const savePromises = validData.map(async (item) => {
          const { id: _id, ...submitData } = item; 
          
          const response = await fetch(`/api/asset/it`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submitData),
          });
     
          if (!response.ok) throw new Error(`DB Save Failed`);
          return response;
        });
     
        await Promise.all(savePromises);
     
        alert(`✅ ${validData.length}건 업로드 완료! (제외됨: ${skippedData.length}건)`);
        fetchAllDataFromServer();
     
      } catch (error) { 
        console.error("Excel Upload Error:", error);
        alert("❌ DB 저장 중 알 수 없는 오류가 발생하여 화면을 새로고침합니다."); 
        fetchAllDataFromServer(); 
      }
    }; 
    
    reader.readAsArrayBuffer(file);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
     
  const activeAudit = useMemo(() => audits.find(a => a.status === '진행중'), [audits]);
  const lastArchivedAudit = useMemo(() => audits.filter(a => a.status === '보관됨' || a.status === '마감').sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0], [audits]);
  const isAuditActive = !!activeAudit;
  
  const duplicateCodes = useMemo(() => {
    const codeMap: Record<string, number> = {};
    assets.forEach(a => { if (a.code) codeMap[a.code] = (codeMap[a.code] || 0) + 1; });
    return new Set(Object.keys(codeMap).filter(code => codeMap[code] > 1));
  }, [assets]);
  
  const duplicateModels = useMemo(() => {
    const modelMap: Record<string, number> = {};
    assets.forEach(a => { 
      const m = String(a.model || '').trim();
      if (m) modelMap[m] = (modelMap[m] || 0) + 1; 
    });
    return new Set(Object.keys(modelMap).filter(model => modelMap[model] > 1));
  }, [assets]);
  
  const getAssetLogic = (a: any) => {
    let turnDisplay = '-';
    if (a.is_rental === '렌탈' || a.is_rental === '구독') {
      const first = a.first_bill ? new Date(a.first_bill) : null;
      const start = a.in_date ? new Date(a.in_date) : null;
      const end = a.end_date ? new Date(a.end_date) : null;
      const now = new Date();
      if (start && end) {
        const total = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        let paid = first ? String((now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth()) + 1) : '1';
        turnDisplay = `${paid} / ${total > 0 ? total : 0}`;
      }
    }
  
    const cycleNum = parseInt(a.cycle);
    let repDate = '-';
    let dday = null;
    let ddayText = '';
    let ddayColor = ''; 
    let showDdayBadge = false;
  
    if (cycleNum > 0 && a.in_date) {
      const d = new Date(a.in_date);
      d.setMonth(d.getMonth() + cycleNum);
      repDate = getKSTDateString(d);
  
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const repD = new Date(repDate);
      repD.setHours(0, 0, 0, 0);
  
      dday = Math.ceil((repD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
      if (isNaN(dday)) { dday = 0; }
  
      if (dday > 0) {
        ddayText = `D-${dday}`;
        ddayColor = 'bg-blue-500 text-white'; 
      } else if (dday === 0) {
        ddayText = 'D-Day';
        ddayColor = 'bg-amber-400 text-amber-900'; 
      } else {
        ddayText = `D+${Math.abs(dday)}`;
        ddayColor = 'bg-rose-500 text-white'; 
      }
  
      if (dday <= 30) {
        showDdayBadge = true;
      }
    }
  
    let isChecked = false;
    let auditStatusText = '미확인';
    let auditStatusColor = 'bg-slate-100 text-slate-400 border border-slate-200';
         
    if (isAuditActive) {
      if (a.last_audit_date && a.last_audit_date >= activeAudit?.startDate) {
        isChecked = true;
        auditStatusText = `최근실사\n${a.last_audit_date}`;
        auditStatusColor = 'bg-emerald-50 text-emerald-600 border border-emerald-200';
      } else if (a.audit_request_date) {
        // 💡 [추가된 로직] 독촉이나 실사요청을 발송한 자산은 확연히 다르게 주황색 배지로 표기
        isChecked = false;
        auditStatusText = `관리자실사요청\n(${a.audit_request_date})`;
        auditStatusColor = 'bg-amber-100 text-amber-700 border border-amber-300 animate-pulse shadow-sm';
      } else {
        // 아직 아무 요청도 안 보낸 쌩 미확인 상태
        isChecked = false;
        auditStatusText = '실사미확인';
        auditStatusColor = 'bg-red-50 text-red-500 border border-red-200';
      }
    } else {
      // 실사 기간이 아닐 때의 표시 로직
      if (a.last_audit_date) {
        isChecked = true;
        auditStatusText = `최근실사\n${a.last_audit_date}`;
        auditStatusColor = 'bg-emerald-50 text-emerald-600 border border-emerald-200';
      } else if (a.audit_request_date) {
        isChecked = false;
        auditStatusText = `관리자실사요청\n(${a.audit_request_date})`;
        auditStatusColor = 'bg-amber-50 text-amber-600 border border-amber-200';
      } else {
        isChecked = false;
        auditStatusText = '미확인';
        auditStatusColor = 'bg-slate-100 text-slate-400 border border-slate-200 border-dashed';
      }
    }
         
    const assetRequests = requests.filter(r => r.assetCode === a.code).sort((r1, r2) => r2.createdAt - r1.createdAt);
    const latestReq = assetRequests[0];
     
    let commStatusLabel = '의견없음';
    let commStatusColor = 'bg-slate-100 text-slate-500';
    let hasUserIncomingRequest = false;
     
    if (latestReq) {
      if (latestReq.status === '의견전송' || latestReq.status === '답변 대기중') {
        commStatusLabel = '의견수신';
        commStatusColor = 'bg-pink-600 text-white animate-pulse shadow-md';
        hasUserIncomingRequest = true;
      } else if (latestReq.status === '관리자 의견발송') {
        commStatusLabel = '의견전송완료'; 
        commStatusColor = 'bg-indigo-50 text-indigo-700';
      } else if (latestReq.status === '처리완료' || latestReq.status === '관리자 확인완료') {
        commStatusLabel = '처리완료';
        commStatusColor = 'bg-emerald-50 text-emerald-700';
      }
    }
         
    return { 
      turnDisplay, repDate, dday, ddayText, ddayColor, showDdayBadge, isTargetCount: dday !== null && dday <= 90, 
      auditStatusColor, auditStatusText,
      isChecked, hasUserIncomingRequest, commStatusLabel, commStatusColor 
    };
  };
     
  const getDescendantNames = (selectedName: string, surveillanceOrgs: any[]) => {
    if (!selectedName || selectedName === '조직 (전체)' || selectedName === 'KPCQA') return surveillanceOrgs.map(o => o.unit_name); 
    const selectedOrg = surveillanceOrgs.find(o => o.unit_name === selectedName);
    if (!selectedOrg) return [selectedName]; 
    const results = new Set<string>();
    results.add(selectedOrg.unit_name);
    const getChildren = (parentId: string) => {
      surveillanceOrgs.filter(o => o.parent_id === parentId).forEach(c => {
        if (!results.has(c.unit_name)) { results.add(c.unit_name); getChildren(c.id); }
      });
    };
    getChildren(selectedOrg.id);
    return Array.from(results);
  };
     
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    let hwCount = 0, swCount = 0, furnitureCount = 0, feedbackIncomingCount = 0;
    let d30Count = 0, dDayCount = 0, dPlusCount = 0;
    let duplicateCount = 0;
    
    assets.forEach(a => {
      counts[a.it_type] = (counts[a.it_type] || 0) + 1;
      if (a.category === 'HW') hwCount++; 
      else if (a.category === 'SW') swCount++;
      else if (a.category === '비품') furnitureCount++;
      
      const logic = getAssetLogic(a);
      if (logic.hasUserIncomingRequest) feedbackIncomingCount++;
      
      if (logic.dday !== null) {
        if (logic.dday > 0 && logic.dday <= 30) d30Count++;
        else if (logic.dday === 0) dDayCount++;
        else if (logic.dday < 0) dPlusCount++;
      }
     
      const isCodeDup = a.code && duplicateCodes.has(a.code);
      const isModelDup = duplicateModels.has(String(a.model).trim()) && String(a.model).trim() !== '';
      if (isCodeDup || isModelDup) duplicateCount++;
    });
    const replaceableCount = assets.filter(a => getAssetLogic(a).isTargetCount).length;
    return { counts, replaceableCount, hwCount, swCount, furnitureCount, feedbackIncomingCount, total: assets.length, d30Count, dDayCount, dPlusCount, duplicateCount };
  }, [assets, audits, requests, duplicateCodes, duplicateModels]);
     
  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      const s = searchQuery.toLowerCase().trim();
      const sUser = searchUserQuery.toLowerCase().trim();
      const logic = getAssetLogic(a);
      
      const matchSearch = !s || [a.code, a.model, a.sn].some(v => String(v).toLowerCase().includes(s));
      const matchUser = !sUser || String(a.user).toLowerCase().includes(sUser);
      
      const allowedDepts = getDescendantNames(colFilters.dept, orgs);
      const matchDept = colFilters.dept === '조직 (전체)' ? true : allowedDepts.includes(a.dept);
      const matchCategory = colFilters.category === '범주 (전체)' ? true : a.category === colFilters.category;
      const matchItType = colFilters.it_type === '자산 분류 (전체)' ? true : a.it_type === colFilters.it_type;
      const matchRental = colFilters.is_rental === '조달유형 (전체)' ? true : a.is_rental === colFilters.is_rental;
      
      let matchStatus = true;
      if (showStatusFilter === 'green') matchStatus = logic.isChecked;
      else if (showStatusFilter === 'red') matchStatus = !logic.isChecked;
     
      const matchIncomingFeedback = !showFeedbackFilter || logic.hasUserIncomingRequest;
      
      let matchDday = true;
      if (ddayFilter !== 'all') {
        if (logic.dday === null) matchDday = false;
        else if (ddayFilter === 'd-30') matchDday = (logic.dday > 0 && logic.dday <= 30);
        else if (ddayFilter === 'd-day') matchDday = (logic.dday === 0);
        else if (ddayFilter === 'd-plus') matchDday = (logic.dday < 0);
      }
     
      const isDup = duplicateCodes.has(a.code) || (duplicateModels.has(String(a.model).trim()) && String(a.model).trim() !== '');
     
      return matchSearch && matchUser && matchDept && matchCategory && matchItType && matchRental 
             && (!showReplaceableOnly || logic.isTargetCount) 
             && (!showDuplicatesOnly || isDup) 
             && matchStatus && matchIncomingFeedback && matchDday;
    });
  }, [assets, searchQuery, searchUserQuery, colFilters, showReplaceableOnly, showDuplicatesOnly, showStatusFilter, showFeedbackFilter, ddayFilter, audits, orgs, requests, duplicateCodes, duplicateModels]);
     
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  const paginatedAssets = filteredAssets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  const handleExcelDownload = () => {
    const targetAssets = selectedIds.size > 0 ? filteredAssets.filter(a => selectedIds.has(a.id)) : filteredAssets;
    if (targetAssets.length === 0) return alert('엑셀 다운로드할 대상을 선택해 주세요.');
    const excelData = targetAssets.map((a, index) => {
      const logic = getAssetLogic(a);
      return {
        'NO': index + 1, '범주': a.category, '자산 분류': a.it_type, '조직': a.dept, '사용자': a.user || '공용', '자산번호': a.code, '모델명': a.model, 'S/N': a.sn, '제조사': a.brand, '기본 사양': a.spec, 
        '조달유형': a.is_rental, '렌탈/구독기간(M)': a.rental_months, '초기구매비(원)': a.purchase_price, '월렌탈료(원)': a.monthly_fee, '월구독료(원)': a.monthly_sub_fee || 0,
        '입고일자': a.in_date, '계약종료일': a.end_date, '첫회청구일': a.first_bill, '납입/총회': logic.turnDisplay, '교체주기(M)': a.cycle, '교체가능일(자동)': logic.repDate, '비고메모': a.memo, '최근실사일': a.last_audit_date || '-', '실사확인요청일': a.audit_request_date || '-'
      };
    });
    const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ITAssets"); XLSX.writeFile(wb, `IT_Assets_Master.xlsx`);
  };
  
  const openBulkQRPrint = () => {
    const targets = filteredAssets.filter(a => selectedIds.has(a.id));
    if (targets.length === 0) return alert('출력할 자산을 체크박스로 선택해주세요.');
    setBulkPrintAssets(targets);
  };
  
  const sendAuditRequest = async () => {
    if (selectedIds.size === 0) return alert('독촉 알림을 보낼 자산을 체크박스로 먼저 선택해주세요.');
    if (!confirm(`선택한 ${selectedIds.size}개의 장비 사용자에게 실사 확인 독촉 알림을 띄우시겠습니까?\n(기존 인증 내역이 있다면 초기화됩니다)`)) return;
       
    const today = getKSTDateString();
       
    try {
      const promises = Array.from(selectedIds).map(async (id) => {
        const targetAsset = assets.find(a => a.id === id);
        if (!targetAsset) return;
       
        const { createdAt, updatedAt, ...submitData } = targetAsset;
        
        const res = await fetch(`/api/asset/it`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            ...submitData,
            id, 
            audit_request_date: today,
            last_audit_date: null 
          })
        });
       
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(`[자산: ${targetAsset.code}] 저장 거부 이유: ${errData.message || '오류'}`);
        }
      });
       
      await Promise.all(promises);
       
      alert('✅ 선택한 사용자들의 화면에 [🚨 관리자 확인요청] 빨간 버튼이 표시되며, 기존 인증 내역은 초기화되었습니다!');
      setSelectedIds(new Set());
      fetchAllDataFromServer(); 
    } catch (e: any) {
      console.error("독촉 요청 실패 상세:", e);
      alert(`❌ 독촉 전송 실패:\n${e.message || "서버 통신 오류가 발생했습니다."}`);
    }
  };
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 bg-slate-50 min-h-screen pb-24 animate-fade-in">
      
{/* 🚀 URL 기반 4버튼 동적 탭 네비게이션 (마스터 표준 규격 완벽 통일) */}
<div className="bg-slate-100 p-2 rounded-3xl flex flex-wrap gap-2 max-w-max border border-slate-200/50 shadow-inner mb-6">
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/dashboard')}
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname === '/asset/it/master/dashboard'
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📊 IT 마스터 대시보드
  </button>
  
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/audit')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/audit')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    🔍 정기 자산 실사 관리
  </button>
  
  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/requests')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/requests')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📋 서비스 요청/조치 대장
  </button>

  <button 
    type="button" 
    onClick={() => router.push('/asset/it/master/archive')} 
    className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center ${
      typeof window !== 'undefined' && window.location.pathname.includes('/master/archive')
        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40' 
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    📁 불용자산 아카이브
  </button>
</div>
  
      <div className="flex flex-col lg:flex-row gap-6 items-stretch min-h-[160px]">
        {/* 좌측 배너 */}
        <div className="flex-[3] bg-slate-900 p-8 rounded-[2rem] text-white shadow-lg relative overflow-hidden">
          <div className="absolute right-0 top-0 w-64 h-full bg-gradient-to-l from-slate-800/80 to-transparent pointer-events-none" />
          
          <div className="z-10 flex justify-between items-center h-full relative">
            <div className="flex flex-col justify-between h-full">
              <div>
                <h1 className="text-2xl font-black tracking-tight leading-tight mb-4">{moduleTitle || 'IT Asset Master Control Tower'}</h1>
                <div className="flex items-end gap-10">
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">전체 IT 자산 수량</p>
                    <p className="text-5xl font-black text-white tracking-tighter leading-none">{stats.total} <span className="text-sm text-slate-500 font-black">EA</span></p>
                  </div>
                  <div className="flex gap-4 border-l border-slate-700 pl-6">
                    <div className="text-center"><p className="text-[10px] text-slate-400 font-bold mb-0.5">H/W</p><p className="text-xl font-black text-blue-400">{stats.hwCount}</p></div>
                    <div className="text-center"><p className="text-[10px] text-slate-400 font-bold mb-0.5">S/W</p><p className="text-xl font-black text-indigo-400">{stats.swCount}</p></div>
                    <div className="text-center"><p className="text-[10px] text-slate-400 font-bold mb-0.5">비품</p><p className="text-xl font-black text-amber-400">{stats.furnitureCount}</p></div>
                  </div>
                </div>
              </div>
            </div>
     
            {/* 통합 관제 패널 */}
            <div className="bg-slate-800/60 p-4 rounded-2xl border border-slate-700 flex flex-col gap-2 backdrop-blur-md shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <span>📊</span> 통합 관제 패널 (클릭 시 실시간 솔트)
              </span>
              <div className="flex gap-1.5">
                 <button onClick={() => setDdayFilter(p => p === 'd-30' ? 'all' : 'd-30')} className={`w-[78px] py-2 rounded-xl border flex flex-col items-center transition-all ${ddayFilter === 'd-30' ? 'bg-blue-500 border-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.6)]' : 'bg-slate-900 border-slate-700 text-blue-400 hover:bg-slate-800'}`}>
                   <span className="text-[9px] font-black mb-0.5">D-30 이내</span>
                   <span className="text-lg font-black">{stats.d30Count}</span>
                 </button>
                 <button onClick={() => setDdayFilter(p => p === 'd-day' ? 'all' : 'd-day')} className={`w-[78px] py-2 rounded-xl border flex flex-col items-center transition-all ${ddayFilter === 'd-day' ? 'bg-amber-500 border-amber-400 text-amber-900 shadow-[0_0_15px_rgba(245,158,11,0.6)]' : 'bg-slate-900 border-slate-700 text-amber-400 hover:bg-slate-800'}`}>
                   <span className="text-[9px] font-black mb-0.5">D-Day</span>
                   <span className="text-lg font-black">{stats.dDayCount}</span>
                 </button>
                 <button onClick={() => setDdayFilter(p => p === 'd-plus' ? 'all' : 'd-plus')} className={`w-[78px] py-2 rounded-xl border flex flex-col items-center transition-all ${ddayFilter === 'd-plus' ? 'bg-rose-500 border-rose-400 text-white shadow-[0_0_15px_rgba(244,63,94,0.6)]' : 'bg-slate-900 border-slate-700 text-rose-400 hover:bg-slate-800'}`}>
                   <span className="text-[9px] font-black mb-0.5">D+ (지연)</span>
                   <span className="text-lg font-black">{stats.dPlusCount}</span>
                 </button>
                 <button onClick={() => setShowDuplicatesOnly(p => !p)} className={`w-[78px] py-2 rounded-xl border flex flex-col items-center transition-all ${showDuplicatesOnly ? 'bg-red-600 border-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.6)]' : 'bg-slate-900 border-slate-700 text-red-500 hover:bg-slate-800'}`}>
                   <span className="text-[9px] font-black mb-0.5">중복 데이터</span>
                   <span className="text-lg font-black">{stats.duplicateCount}</span>
                 </button>
              </div>
            </div>
          </div>
        </div>
      
        {/* 우측 실사 패널 */}
        <div className="flex-[2] bg-white border border-slate-200 rounded-[2rem] p-6 flex flex-col justify-between shadow-sm">
          <div> 
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
              <span className="flex items-center gap-1"><span>🔍</span> 실사 운영 및 의견 관리</span>
            </span>
            <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-100 mt-3 mb-4">
              <div className="text-[11px] font-black text-slate-700 flex items-center gap-2">
                <span>실사 상태:</span>
                {isAuditActive ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-indigo-600 animate-pulse">🟢 진행 중</span>
                    <span className="bg-indigo-100 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded text-[10px] tracking-tighter shadow-sm">
                      {activeAudit.startDate} ~ {activeAudit.endDate}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-400">⚪ 대기 중</span>
                )}
              </div>
              <div className="text-[10px] font-black text-slate-500">
                최근 실사: {isAuditActive ? activeAudit.endDate : (lastArchivedAudit?.endDate || '이력 없음')}
              </div>
            </div>
          </div> 
      
          <div className="flex gap-2 w-full">
            <button onClick={() => setShowStatusFilter(prev => prev === 'green' ? 'all' : 'green')} className={`flex-1 py-3 rounded-xl text-[10px] font-black border transition-all flex flex-col items-center justify-center gap-1 ${showStatusFilter === 'green' ? 'bg-emerald-600 text-white' : 'bg-white text-emerald-600 border-emerald-200'}`}>
              <span>실사확인완료</span><span className="text-sm">{assets.filter(a => getAssetLogic(a).isChecked).length}</span>
            </button>
            <button onClick={() => setShowStatusFilter(prev => prev === 'red' ? 'all' : 'red')} className={`flex-1 py-3 rounded-xl text-[10px] font-black border transition-all flex flex-col items-center justify-center gap-1 ${showStatusFilter === 'red' ? 'bg-red-600 text-white' : 'bg-white text-red-500 border-red-200'}`}>
              <span>실사미확인(요청)</span><span className="text-sm">{assets.filter(a => !getAssetLogic(a).isChecked).length}</span>
            </button>
            <button onClick={() => setShowFeedbackFilter(!showFeedbackFilter)} className={`flex-1 py-3 rounded-xl text-[10px] font-black border transition-all flex flex-col items-center justify-center gap-1 ${showFeedbackFilter ? 'bg-pink-600 text-white' : 'bg-white text-pink-600 border-pink-200'}`}>
              <span>사용자 의견수신</span><span className="text-sm">{stats.feedbackIncomingCount}</span>
            </button>
          </div>
        </div>
      </div>
  
      {/* 컨트롤바 */}
      <div className="bg-white border border-slate-200 px-6 py-5 shadow-sm rounded-[2rem] flex flex-col gap-4">
        <div className="flex gap-3 items-center w-full">
          <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-xl px-2.5 py-1 shadow-sm shrink-0">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">조직 필터</span>
            <select value={colFilters.dept} onChange={e => setColFilters({...colFilters, dept: e.target.value})} className="bg-transparent text-[11px] font-black text-slate-800 outline-none py-1.5 pr-2 cursor-pointer">
              <option>조직 (전체)</option>
              <option value="KPCQA">KPCQA (전사 본부)</option>
              {orgs.filter(o => o.unit_name !== 'KPCQA').map(o => <option key={o.id} value={o.unit_name}>{o.unit_name}</option>)}
            </select>
          </div>
  
          <div className="relative w-48 shrink-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">👤</span>
            <input type="text" placeholder="사용자 직접 검색" value={searchUserQuery} onChange={e => setSearchUserQuery(e.target.value)} className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm" />
          </div>
  
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">📦</span>
            <input type="text" placeholder="[통합 검색] 자산번호, 모델명, S/N..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm" />
          </div>
        </div>
  
        <div className="flex gap-3 items-center justify-between w-full border-t border-slate-100 pt-3">
          <div className="flex gap-2">
            <select className="p-2 border border-slate-200 font-black text-[10px] rounded-xl outline-none bg-white shadow-sm text-slate-700" value={colFilters.category} onChange={(e) => setColFilters({ ...colFilters, category: e.target.value })}>
              <option value="범주 (전체)">범주 (전체)</option>
              {masterFilters.categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select className="p-2 border border-blue-200 font-black text-[10px] rounded-xl outline-none bg-blue-50 shadow-sm text-blue-700" value={colFilters.it_type} onChange={(e) => setColFilters({ ...colFilters, it_type: e.target.value })}>
              <option value="자산 분류 (전체)">자산 분류 (전체)</option>
              {masterFilters.types.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <select className="p-2 border border-slate-200 font-black text-[10px] rounded-xl outline-none bg-white shadow-sm text-indigo-700" value={colFilters.is_rental} onChange={(e) => setColFilters({ ...colFilters, is_rental: e.target.value })}>
              <option value="조달유형 (전체)">조달유형 (전체)</option>
              {masterFilters.rentals.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
  
          <div className="flex gap-1.5 items-center">
            <button onClick={sendAuditRequest} className="px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-[11px] font-black hover:bg-amber-500 hover:text-white transition-all shadow-sm">
              🔔 선택 실사확인요청
            </button>
            <button onClick={openBulkQRPrint} className="px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-xl text-[11px] font-black hover:bg-purple-600 hover:text-white transition-all shadow-sm">🖨️ 선택 QR 라벨 인쇄</button>
            <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold rounded-xl hover:bg-emerald-600 hover:text-white transition-all shadow-sm">⬆️ 엑셀 업로드</button>
            <input type="file" ref={fileInputRef} onChange={handleExcelUpload} accept=".xlsx, .xls" className="hidden" />
            <button onClick={handleExcelDownload} className="px-4 py-2 bg-slate-100 text-slate-700 border text-[11px] font-bold rounded-xl hover:bg-slate-200 transition-all shadow-sm">⬇️ 마스터 대장 다운로드</button>
            <button onClick={handleAdd} className="px-5 py-2 bg-blue-600 text-white rounded-xl text-[11px] font-black shadow-md hover:bg-blue-700 transition-all">+ 신규 자산 추가</button>
          </div>
        </div>
      </div>
  
      {/* 🚀 테이블 대장 영역 */}
      <div className="bg-white border border-slate-200 shadow-md rounded-[2.5rem] overflow-hidden">
        <div className="flex text-center text-[10px] font-black text-slate-500 tracking-widest border-b border-slate-200">
           <div className="flex-1 min-w-[1530px] bg-slate-50 py-2 border-r border-slate-200">기본 자산 정보</div>
           <div className="w-[620px] shrink-0 bg-emerald-50/50 py-2 border-r border-slate-200 text-emerald-700">조달 및 비용 정보</div>
           <div className="w-[790px] shrink-0 bg-blue-50/50 py-2 border-r border-slate-200 text-blue-700">일정 및 생애주기 관리</div>
           <div className="w-[490px] shrink-0 bg-slate-100 py-2 text-slate-600">제어 및 상태 관리</div>
        </div>
  
        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-50">
          <table className="w-full text-left border-collapse min-w-[3430px] table-fixed">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-[11px] font-black uppercase border-b border-slate-200 h-12 tracking-wider">
                <th className="p-3 w-[40px] sticky left-0 bg-slate-50 z-30 text-center border-r border-slate-200"><input type="checkbox" checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedIds.has(a.id))} onChange={toggleSelectAll} className="accent-slate-800 cursor-pointer w-3.5 h-3.5" /></th>
                <th className="p-3 w-[50px] sticky left-[40px] bg-slate-50 z-30 text-center border-r border-slate-200">NO</th>
                <th className="p-3 w-[70px] sticky left-[90px] bg-white z-30 text-center text-purple-700 border-r border-slate-200 shadow-[4px_0_10px_-3px_rgba(0,0,0,0.1)]">QR</th>
                
                <th className="p-3 w-[60px] text-center border-r border-slate-100 bg-slate-50">범주</th>
                <th className="p-3 w-[130px] text-blue-600 text-center border-r border-slate-100 bg-slate-50">{itMasterLabel}</th>
                <th className="p-3 w-[150px] border-r border-slate-100 pl-4 bg-slate-50">조직부서</th>
                <th className="p-3 w-[110px] border-r-2 border-slate-200 text-blue-600 text-center bg-slate-50">사용자</th>
                <th className="p-3 w-[220px] pl-6 bg-slate-50">자산번호</th>
                <th className="p-3 w-[250px] px-4 bg-slate-50">모델명</th>
                <th className="p-3 w-[180px] px-4 bg-slate-50">S/N 시리얼</th>
                <th className="p-3 w-[160px] px-4 bg-slate-50">제조사</th>
                <th className="p-3 w-[350px] px-4 text-slate-400 border-r border-slate-200 bg-slate-50">기본 장비 제원 사양</th>
                
                <th className="p-3 w-[100px] text-center bg-emerald-50/50">조달유형</th>
                <th className="p-3 w-[130px] text-right text-emerald-600 bg-emerald-50/50">초기구매비(원)</th>
                <th className="p-3 w-[130px] text-right text-emerald-700 bg-emerald-50/50">월렌탈료(원)</th>
                <th className="p-3 w-[130px] text-right text-indigo-600 bg-emerald-50/50">월구독료(원)</th>
                <th className="p-3 w-[130px] text-center border-r border-slate-200 bg-emerald-50/50">렌탈/구독(M)</th>
                
                <th className="p-3 w-[125px] text-center bg-blue-50/50">입고일자</th>
                <th className="p-3 w-[125px] text-center bg-blue-50/50">계약종료일</th>
                <th className="p-3 w-[120px] text-center text-blue-500 bg-blue-50/50">첫회청구일</th>
                <th className="p-3 w-[100px] text-center bg-blue-50/50">납입/총회</th>
                <th className="p-3 w-[120px] text-center text-slate-500 bg-blue-50/50">교체주기(M)</th>
                <th className="p-3 w-[180px] text-center font-black text-slate-800 bg-blue-50/50">교체예정일(자동)</th>
                <th className="p-3 w-[250px] px-4 text-slate-500 border-r border-slate-200 bg-blue-50/50">비고메모</th>
                
                <th className="p-3 w-[130px] text-center border-l border-slate-200 bg-slate-100">실사 확인 상태</th>
                <th className="p-3 w-[130px] text-center text-pink-600 bg-slate-100">의견/요청 상태</th>
                <th className="p-3 w-[110px] text-center text-rose-700 border-l border-slate-200 bg-slate-100">종료 조치</th>
                <th className="p-3 w-[130px] text-center text-slate-800 border-l border-slate-200 bg-slate-100">데이터 제어</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-bold text-slate-800 bg-white">
              {paginatedAssets.map((a, idx) => {
                const isEditing = editingId === a.id;
                const logic = getAssetLogic(a);
                const isP = a.is_rental === '구매'; const isS = a.is_rental === '구독'; const isR = a.is_rental === '렌탈';
                
                const baseBg = isEditing ? 'bg-blue-50' : 'bg-white';
                const hoverBg = isEditing ? 'bg-blue-50' : 'hover:bg-slate-50';
                const inputClass = "w-full px-2 py-1 bg-white border border-blue-400 rounded text-blue-700 font-bold outline-none shadow-sm";
  
                return (
                  <tr key={a.id} className={`transition-colors h-15 ${baseBg} ${hoverBg}`}>
                    <td className={`p-2 sticky left-0 z-20 ${baseBg} border-r border-slate-100 text-center`}><input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => { const next = new Set(selectedIds); next.has(a.id) ? next.delete(a.id) : next.add(a.id); setSelectedIds(next); }} className="accent-slate-800 cursor-pointer w-3.5 h-3.5" /></td>
                    <td className={`p-2 sticky left-[40px] z-20 ${baseBg} border-r border-slate-100 text-center text-slate-400 font-mono`}>{(currentPage-1)*itemsPerPage + idx + 1}</td>
                    <td className="p-2 sticky left-[90px] z-20 bg-white border-r border-slate-200 text-center shadow-[4px_0_10px_-3px_rgba(0,0,0,0.1)]">
                      <button onClick={() => setShowQrModal(a)} className="px-2.5 py-1 bg-purple-50 text-purple-600 border border-purple-200 rounded font-black hover:bg-purple-600 hover:text-white transition-all shadow-sm">📱 QR</button>
                    </td>
                    
                    <td className="p-2 text-center text-slate-500">{isEditing ? <select value={a.category} onChange={e => handleFieldChange(a.id, 'category', e.target.value)} className={inputClass}>{masterFilters.categories.map(c=><option key={c} value={c}>{c}</option>)}</select> : a.category}</td>
                    <td className="p-2 text-center text-blue-600 font-black">{isEditing ? <select value={a.it_type} onChange={e => handleFieldChange(a.id, 'it_type', e.target.value)} className={inputClass}>{masterFilters.types.map(c=><option key={c} value={c}>{c}</option>)}</select> : a.it_type}</td>
                    <td className="p-2 pl-4">{isEditing ? <select value={a.dept} onChange={e => handleFieldChange(a.id, 'dept', e.target.value)} className={inputClass}>{orgs.map(o => <option key={o.id} value={o.unit_name}>{o.unit_name}</option>)}</select> : a.dept}</td>
                    <td className="p-2 border-r-2 border-slate-200 text-blue-600 text-center">{isEditing ? <select value={a.user} onChange={e => handleFieldChange(a.id, 'user', e.target.value)} className={inputClass}><option value="공용">공용</option>{users.map(u=><option key={u.id} value={u.name}>{u.name}</option>)}</select> : (a.user || '공용')}</td>
                    
                    <td className="p-2 pl-6 font-mono font-black text-slate-900">
                      {isEditing ? <input type="text" value={a.code} onChange={e => handleFieldChange(a.id, 'code', e.target.value)} className={inputClass} /> : 
                      <div className="flex items-center gap-1.5">
                        <span>{a.code}</span>
                        {duplicateCodes.has(a.code) && (
                           <button onClick={() => setSearchQuery(a.code)} title="클릭 시 필터링" className="text-rose-600 text-[9px] px-1.5 py-0.5 rounded-md bg-rose-50 border border-rose-200 animate-pulse shadow-sm hover:bg-rose-500 hover:text-white transition-colors cursor-pointer shrink-0">중복!</button>
                        )}
                      </div>}
                    </td>
                    
                    <td className="p-2 px-4">
                      {isEditing ? <input type="text" value={a.model} onChange={e => handleFieldChange(a.id, 'model', e.target.value)} className={inputClass} /> : 
                      <div className="flex items-center justify-between gap-1.5 w-full">
                        <span className="truncate">{a.model}</span>
                        {duplicateModels.has(String(a.model).trim()) && String(a.model).trim() !== '' && (
                           <button onClick={() => setSearchQuery(a.model)} title="클릭 시 필터링" className="text-rose-600 text-[9px] px-1.5 py-0.5 rounded-md bg-rose-50 border border-rose-200 animate-pulse shadow-sm hover:bg-rose-500 hover:text-white transition-colors cursor-pointer shrink-0">중복!</button>
                        )}
                      </div>}
                    </td>
                    
                    <td className="p-2 px-4 font-mono text-slate-500">{isEditing ? <input type="text" value={a.sn} onChange={e => handleFieldChange(a.id, 'sn', e.target.value)} className={inputClass} /> : a.sn}</td>
                    <td className="p-2 px-4">{isEditing ? <input type="text" value={a.brand} onChange={e => handleFieldChange(a.id, 'brand', e.target.value)} className={inputClass} /> : a.brand}</td>
                    <td className="p-2 px-4 text-slate-500 truncate border-r border-slate-100">{isEditing ? <input type="text" value={a.spec} onChange={e => handleFieldChange(a.id, 'spec', e.target.value)} className={inputClass} /> : a.spec}</td>
                    
                    <td className="p-2 text-center bg-emerald-50/10">{isEditing ? <select value={a.is_rental} onChange={e => handleFieldChange(a.id, 'is_rental', e.target.value)} className={inputClass}>{masterFilters.rentals.map(r=><option key={r} value={r}>{r}</option>)}</select> : a.is_rental}</td>
                    <td className="p-2 text-right text-emerald-600 bg-emerald-50/10">{isEditing ? <input type="number" value={a.purchase_price} onChange={e => handleFieldChange(a.id, 'purchase_price', parseInt(e.target.value))} className={inputClass} /> : formatNumber(a.purchase_price)}</td>
                    <td className="p-2 text-right text-emerald-700 bg-emerald-50/10">{isEditing ? <input type="number" value={a.monthly_fee} onChange={e => handleFieldChange(a.id, 'monthly_fee', parseInt(e.target.value))} className={inputClass} /> : (isR ? formatNumber(a.monthly_fee) : '-')}</td>
                    <td className="p-2 text-right text-indigo-600 bg-emerald-50/10">{isEditing ? <input type="number" value={a.monthly_sub_fee} onChange={e => handleFieldChange(a.id, 'monthly_sub_fee', parseInt(e.target.value))} className={inputClass} /> : (isS ? formatNumber(a.monthly_sub_fee) : '-')}</td>
                    <td className="p-2 text-center border-r border-slate-100 bg-emerald-50/10">{isEditing ? <input type="number" value={a.rental_months} onChange={e => handleFieldChange(a.id, 'rental_months', parseInt(e.target.value))} className={inputClass} /> : (isP ? '-' : a.rental_months)}</td>
                    
                    <td className="p-2 text-center font-mono text-slate-500 bg-blue-50/10">{isEditing ? <input type="date" value={a.in_date || ''} onChange={e => handleFieldChange(a.id, 'in_date', e.target.value)} className={inputClass} /> : a.in_date}</td>
                    <td className="p-2 text-center font-mono text-slate-500 bg-blue-50/10">{isEditing ? <input type="date" value={a.end_date || ''} onChange={e => handleFieldChange(a.id, 'end_date', e.target.value)} className={inputClass} /> : (isP ? '-' : a.end_date)}</td>
                    <td className="p-2 text-center font-mono text-blue-600 bg-blue-50/10">{isEditing ? <input type="date" value={a.first_bill || ''} onChange={e => handleFieldChange(a.id, 'first_bill', e.target.value)} className={inputClass} /> : (isP ? '-' : a.first_bill)}</td>
                    <td className="p-2 text-center font-bold text-slate-700 bg-blue-50/10">{isP ? '-' : logic.turnDisplay}</td>
                    <td className="p-2 text-center text-slate-400 bg-blue-50/10">{isEditing ? <input type="number" value={a.cycle === 0 ? '' : a.cycle} onChange={e => handleFieldChange(a.id, 'cycle', e.target.value === '' ? 0 : parseInt(e.target.value))} className={inputClass} placeholder="입력" /> : (a.cycle || '-')}</td>
                    
                    <td className="p-2 text-center bg-blue-50/10">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span className="font-mono font-black text-slate-700">{logic.repDate}</span>
                        {logic.showDdayBadge && (
                          <span className={`px-2 py-0.5 rounded-md text-[9px] font-black animate-pulse shadow-sm ${logic.ddayColor}`}>
                            {logic.ddayText}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2 px-4 text-slate-500 truncate bg-blue-50/10 border-r border-slate-100">{isEditing ? <input type="text" value={a.memo} onChange={e => handleFieldChange(a.id, 'memo', e.target.value)} className={inputClass} /> : a.memo}</td>
                    
                    {/* ✨ 관리자 수동 실사 확인 기능 (수정 모드일 때 활성화) */}
                    <td className="p-2 text-center border-l border-slate-100 bg-slate-50/50">
                      {isEditing ? (
                        <div className="flex flex-col gap-1.5">
                          <input 
                            type="date" 
                            value={a.last_audit_date || ''} 
                            onChange={e => handleFieldChange(a.id, 'last_audit_date', e.target.value)} 
                            className="w-full px-1 py-1 bg-white border border-blue-400 rounded text-blue-700 font-bold outline-none shadow-sm text-[9px]" 
                          />
                          <button 
                            onClick={() => handleFieldChange(a.id, 'last_audit_date', null)} 
                            className="text-[9px] bg-slate-200 hover:bg-slate-300 text-slate-700 rounded py-1 font-black transition-colors"
                          >
                            ❌ 미확인 전환
                          </button>
                        </div>
                      ) : (
                        <div className={`px-2 py-1.5 rounded-md text-[10px] font-black shadow-sm whitespace-pre-line leading-tight ${logic.auditStatusColor}`}>
                          {logic.auditStatusText}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-center bg-slate-50/50">
                      <button 
                        onClick={() => {
                          const targetReq = requests.find(r => r.assetCode === a.code && (r.status === '답변 대기중' || r.status === '의견전송'));
                          if (targetReq) {
                            setEditingReq(targetReq);
                            const opinionText = targetReq.adminOpinion?.split(':::')[0] || '';
                            setEditOpinion(opinionText);
                          } else {
                            alert("현재 이 자산과 연결된 처리 대기 중인 의견이 없습니다.");
                          }
                        }}
                        className={`px-2.5 py-1.5 rounded-md text-[10px] font-black transition-all ${logic.commStatusColor}`}
                      >
                        {logic.commStatusLabel}
                      </button>
                    </td>
                    <td className="p-2 text-center border-l border-slate-100 bg-rose-50/20 px-3">
                      <button onClick={() => setTerminateModal({ id: a.id, reason: '', actionType: null })} className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] rounded-lg w-full transition-all shadow-sm">종료 처리</button>
                    </td>
                    <td className="p-2 text-center border-l border-slate-100 px-3 bg-slate-50/50">
                      {isEditing ? (
                        <button onClick={() => handleSaveEdit(a.id)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black w-full shadow-sm">💾 저장 완료</button>
                      ) : (
                        <div className="flex gap-1.5 justify-center">
                          <button onClick={() => setEditingId(a.id)} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded-lg text-[10px] hover:bg-slate-100 font-bold shadow-sm">수정</button>
                          <button onClick={() => handleSingleDelete(a.id)} className="px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg text-[10px] hover:bg-red-50 font-bold shadow-sm">삭제</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 p-4 bg-white border-t border-slate-100">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-[11px] bg-white border border-slate-200 rounded-lg font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-lg font-black text-[11px] transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-[11px] bg-white border border-slate-200 rounded-lg font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </div>
  
      {/* 🚀 모달 1: 자산 종료 관리 모달 */}
      {terminateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-[500px] border border-slate-200 shadow-2xl p-8 rounded-[2rem] font-bold animate-in zoom-in-95 duration-150">
            <h4 className="text-sm font-black uppercase border-b-2 border-slate-900 pb-3 mb-5 text-slate-900 tracking-wide">💼 자산 마이그레이션 종료 처리</h4>
            
            <div className="mb-5">
              <label className="text-[11px] font-black text-slate-500 mb-2 block">조치 유형 설정</label>
              <div className="flex gap-2">
                {(['반납', '폐기', '재판매'] as const).map((type) => (
                  <button 
                    key={type} type="button"
                    onClick={() => setTerminateModal({...terminateModal, actionType: type})}
                    className={`flex-1 py-3 rounded-xl border font-black text-[11px] transition-all ${
                      terminateModal.actionType === type 
                        ? (type === '폐기' ? 'bg-rose-600 text-white border-rose-600 shadow-md' : type === '재판매' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md' : 'bg-amber-500 text-white border-amber-500 shadow-md')
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {type === '반납' ? '📦 계약반납' : type === '폐기' ? '🗑️ 불용폐기' : '💰 기기재판매'}
                  </button>
                ))}
              </div>
            </div>
  
            <div className="mb-5">
               <label className="text-[11px] font-black text-slate-500 mb-2 block">종료 및 조치 사유 기술</label>
               <textarea 
                 value={terminateModal.reason} 
                 onChange={e => setTerminateModal({...terminateModal, reason: e.target.value})} 
                 placeholder="감사 증빙용 사유를 상세히 기록하세요." 
                 className="w-full h-24 bg-slate-50 border border-slate-200 p-3 text-[11px] font-bold rounded-xl outline-none resize-none focus:bg-white focus:border-slate-400 shadow-inner" 
               />
            </div>
  
            {terminateModal.actionType === '재판매' && (
              <div className="mb-5 p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <div>
                  <label className="text-[10px] font-black text-emerald-800 mb-1 block">지정 매입처 (재판매처 기관명)</label>
                  <input type="text" value={terminateModal.reseller || ''} onChange={e => setTerminateModal({...terminateModal, reseller: e.target.value})} className="w-full bg-white border border-emerald-200 p-2.5 text-[11px] rounded-xl outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-emerald-800 mb-1 block">최종 매각 확정 금액 / 비용 (원)</label>
                  <input type="number" value={terminateModal.resellPrice || ''} onChange={e => setTerminateModal({...terminateModal, resellPrice: parseInt(e.target.value) || 0})} className="w-full bg-white border border-emerald-200 p-2.5 text-[11px] rounded-xl outline-none focus:border-emerald-500 font-mono" />
                </div>
              </div>
            )}
  
            <div className="flex gap-2 border-t border-slate-100 pt-5">
              <button onClick={() => setTerminateModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-[11px] font-bold">취소</button>
              <button onClick={() => confirmTerminate(terminateModal!.id)} className="flex-[2] py-3.5 bg-slate-900 text-white rounded-xl shadow-md hover:bg-black text-[11px] font-black tracking-wider">✓ 안전하게 아카이브 대장으로 이관</button>
            </div>
          </div>
        </div>
      )}
  
      {/* 🚀 모달 2: 진보된 단일 QR 코드 모달 (실제 인쇄 라벨과 동일한 미리보기) */}
      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4" onClick={() => setShowQrModal(null)}>
          <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center mb-4">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">IT 자산 QR 라벨</h3>
              <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-[10px] font-black">실제 출력 미리보기</span>
            </div>

            {/* 실제 인쇄되는 40mm 정사각 라벨과 동일한 형태 (화면용 확대) */}
            <div
              className="flex flex-col justify-between bg-white border-2 border-dashed border-slate-300 rounded-lg text-center mb-4"
              style={{ width: '260px', height: '260px', padding: '14px 12px 12px 12px', boxSizing: 'border-box' }}
            >
              <div className="w-full space-y-1">
                <div className="flex justify-center items-center gap-1.5">
                  <span className="text-[11px] font-black bg-slate-900 text-white px-2 py-0.5 rounded-full leading-none">{showQrModal.category}</span>
                  <span className="text-[12px] font-black text-slate-700 truncate max-w-[170px]">{showQrModal.it_type}</span>
                </div>
                <p className="text-[13px] font-black text-slate-900 truncate tracking-tight">{showQrModal.model || '모델명 미상'}</p>
              </div>
              <div className="w-full flex justify-center items-center my-1">
                <LocalQrImage
                  payload={getItAssetVerifyUrl(showQrModal.code)}
                  size={150}
                  alt="QR"
                  className="w-[130px] h-[130px] object-contain"
                />
              </div>
              <div className="w-full">
                <p className="text-[15px] font-black font-mono tracking-tighter text-indigo-700 leading-none">{showQrModal.code}</p>
                <p className="text-[10px] font-bold text-slate-400 truncate mt-1">{showQrModal.dept || '공용'} · <span className="text-amber-700 font-black">사내 Wi-Fi 스캔</span></p>
              </div>
            </div>

            <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-center">
              <p className="text-[11px] font-black text-amber-800">📡 QR 스캔 안내</p>
              <p className="text-[10px] font-bold text-amber-700 mt-0.5 leading-relaxed">
                스캔 시 <span className="underline decoration-2">로그인(이메일·비밀번호)</span> 후 자산 실사·인증이 가능합니다.
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
  
      {/* 🖨️ 모달 3: 한국폼텍 28칸 QR 인쇄 모달 */}
      {bulkPrintAssets.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/90 z-[600] flex flex-col p-8 overflow-y-auto print:p-0 print:bg-white" onClick={() => setBulkPrintAssets([])}>
          <div className="max-w-5xl w-full mx-auto bg-white rounded-[2rem] p-8 shadow-2xl print:shadow-none print:rounded-none print:p-0" onClick={e => e.stopPropagation()}>
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-4 print:hidden">
              <div>
                <h2 className="text-xl font-black text-slate-800">🖨️ 한국폼텍 28칸 정사각 QR 라벨 발행 센터</h2>
                <p className="text-slate-500 text-xs font-bold mt-1">드림디포 구매 규격 [QR-3990] 적용 (40mm × 40mm 정사각형) | 총 {bulkPrintAssets.length}개의 라벨</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="px-6 py-2 bg-purple-600 text-white font-black rounded-xl shadow-md hover:bg-purple-700 flex items-center gap-2 text-xs"><span>🖨️</span> 라벨 인쇄 실행 (Ctrl+P)</button>
                <button onClick={() => setBulkPrintAssets([])} className="px-6 py-2 bg-slate-100 text-slate-600 font-black rounded-xl hover:bg-slate-200 text-xs">닫기</button>
              </div>
            </div>
            
            <div className="formtec-page-container bg-white p-0 relative" style={{ width: '210mm', minHeight: '297mm', margin: '0 auto', boxSizing: 'border-box' }}>
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
                          <span className="text-[7px] font-black bg-slate-900 text-white px-1.5 py-0.5 rounded-full leading-none">{a.category}</span>
                          <span className="text-[7px] font-black text-slate-700 truncate max-w-[26mm]">{a.it_type}</span>
                        </div>
                        <p className="text-[8px] font-black text-slate-900 truncate tracking-tight">{a.model || '모델명 미상'}</p>
                      </div>
                      <div className="w-full flex justify-center items-center my-0.5">
                        <LocalQrImage
                          payload={getItAssetVerifyUrl(a.code)}
                          size={100}
                          alt="QR"
                          className="w-[20mm] h-[20mm] object-contain"
                        />
                      </div>
                      <div className="w-full">
                        <p className="text-[9px] font-black font-mono tracking-tighter text-indigo-700 leading-none">{a.code}</p>
                        <p className="text-[6.5px] font-bold text-slate-400 truncate mt-0.5 scale-90">{a.dept} · <span className="text-amber-700 font-black">사내 Wi-Fi 스캔</span></p>
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
              .formtec-page-container, .formtec-page-container * { visibility: visible; }
              .formtec-page-container { position: absolute; left: 0; top: 0; width: 210mm; height: 297mm; background: white !important; }
              @page { size: A4 portrait; margin: 0; }
            }
          `}</style>
        </div>
      )}
     
 {/* 🚀 관리자 답변 조치 팝업 (대시보드 연동용) */}
 {editingReq && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[700] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 p-5 flex items-center justify-between">
              <h3 className="font-black text-white text-lg">사용자 요구사항 조치 및 답변</h3>
              <button onClick={() => setEditingReq(null)} className="text-slate-400 hover:text-white font-black">✕</button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-600 font-bold space-y-1.5">
                <p><span className="text-slate-400">요청자:</span> {editingReq.requester} ({editingReq.dept})</p>
                <p><span className="text-slate-400">대상 자산:</span> {editingReq.assetCode}</p>
                <p><span className="text-slate-400">요청 내용:</span> <span className="text-indigo-600">{editingReq.content}</span></p>
              </div>
     
              <div>
                <label className="block text-xs font-black text-slate-700 mb-2">관리자 검토 의견 (선택)</label>
                <textarea 
                  value={editOpinion} 
                  onChange={(e) => setEditOpinion(e.target.value)}
                  className="w-full h-32 p-4 bg-white rounded-xl border border-slate-300 text-sm font-bold text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none transition-all"
                  placeholder="답변을 작성하지 않고 '완료 처리'만 누르셔도 무방합니다."
                />
              </div>
     
              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditingReq(null)} className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black text-xs transition-colors">
                  닫기
                </button>
                <button 
                  onClick={async () => {
                    try {
                      // 💡 대시보드는 현재 user 정보 state가 없으므로 전송 직전에 내 정보 휙 당겨오기
                      const userRes = await fetch('/api/auth/me').catch(() => null);
                      const userData = userRes && userRes.ok ? await userRes.json() : null;
                      const responder = userData?.name || '시스템 관리자';
     
                      const res = await fetch('/api/asset/it/requests', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: editingReq.id,
                          adminOpinion: editOpinion,
                          responderName: responder,
                          status: '관리자 확인완료'
                        })
                      });
                      
                      if (res.ok) {
                        alert("✅ 조치가 성공적으로 완료되었습니다.");
                        setEditingReq(null);
                        fetchAllDataFromServer(); // 대시보드 리스트 즉시 갱신
                      } else {
                        alert("❌ 서버 오류로 조치에 실패했습니다.");
                      }
                    } catch (e) { alert("❌ 통신 오류"); }
                  }} 
                  className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-xs shadow-md transition-colors"
                >
                  답변 저장 및 완료 처리하기
                </button>
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
      <MasterDashboardContent {...props} />
    </Suspense>
  );
}