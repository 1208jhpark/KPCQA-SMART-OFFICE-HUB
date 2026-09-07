'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { StatementFileRecord } from '@/app/api/asset/production/master/statement-file/route';
import * as XLSX from 'xlsx';
import {
  DEFAULT_CERT_TYPE_ALIASES,
  CertTypeAliasMap,
  ProductionDbItem,
  ItemMatchResult,
  GroupMatchSummary,
  ParsedStatementRow,
  extractProductionExcelRows,
  runProductionStatementMatch,
} from '@/lib/production-statement-match';

const DISABLED_ACTION_BTN =
  'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70 shadow-none';

export type CompareModalBatch = {
  id: string;
  status: string;
  items: Array<{
    id: string;
    postNumber?: string;
    category?: string;
    title?: string;
    quantity?: number;
    userName?: string;
    deptName?: string;
    deptHead?: string;
    finalPrice?: number | null;
    options?: Record<string, unknown>;
  }>;
  inspectStatus?: 'idle' | 'match' | 'mismatch';
  inspectFileName?: string | null;
  inspectResult?: any;
};

type Props = {
  open: boolean;
  onClose: () => void;
  selectedBatches: CompareModalBatch[];
  canEdit: boolean;
  apiPath: string;
  categoryStatementFiles?: StatementFileRecord[];
  categoryName?: string;
  onSaved: () => void;
};

export default function ProductionStatementCompareModal({
  open,
  onClose,
  selectedBatches,
  canEdit,
  apiPath,
  categoryStatementFiles = [],
  categoryName,
  onSaved,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingMasterFile, setLoadingMasterFile] = useState(false);

  // 인증 약어 사전 설정
  const [aliasMap, setAliasMap] = useState<CertTypeAliasMap>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('prod_cert_aliases');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return DEFAULT_CERT_TYPE_ALIASES;
  });
  const [isAliasModalOpen, setIsAliasModalOpen] = useState(false);
  const [aliasDraft, setAliasDraft] = useState<CertTypeAliasMap>(aliasMap);

  // 분석 상태
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingFileName, setAnalyzingFileName] = useState('');
  const [analyzedFileRaw, setAnalyzedFileRaw] = useState<File | null>(null);
  const [statementRows, setStatementRows] = useState<ParsedStatementRow[]>([]);
  const [groupSummaries, setGroupSummaries] = useState<GroupMatchSummary[]>([]);
  const [itemMatches, setItemMatches] = useState<ItemMatchResult[]>([]);
  const [totalDocPrice, setTotalDocPrice] = useState(0);
  const [matchedBatchDocPrice, setMatchedBatchDocPrice] = useState(0);
  const [allMatched, setAllMatched] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [manualOverrides, setManualOverrides] = useState<
    Record<string, { rowIndex: number; unitPrice?: number }>
  >({});
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [priceInputDraft, setPriceInputDraft] = useState<string>('');

  // DB 아이템 변환
  const dbItems: ProductionDbItem[] = useMemo(() => {
    return selectedBatches
      .flatMap((b) => b.items || [])
      .map((item) => {
        const opts = (item.options || {}) as Record<string, unknown>;
        const certType = String(opts.certType || item.title || '').trim();
        const plateInfo = opts.plateMasterInfo as { label?: string; size?: string } | undefined;
        const plateLabel = String(plateInfo?.label || opts.plateType || '').trim();
        const plateSize = String(plateInfo?.size || '').trim();
        const projectName =
          String(opts.projectName || opts.isoCompanyName || item.title || '').trim();
        const isJumul =
          plateLabel.includes('주물') ||
          String(opts.plateType || '').includes('CAST_IRON');

        return {
          id: item.id,
          postNumber: item.postNumber || '-',
          category: item.category || 'SIGN',
          userName: item.userName || '-',
          deptName: item.deptName || item.deptHead || '-',
          deptHead: item.deptHead,
          title: item.title || '-',
          quantity: item.quantity || 1,
          certType,
          plateLabel,
          plateSize,
          projectName,
          isJumul,
        };
      });
  }, [selectedBatches]);

  const [activeStatementFiles, setActiveStatementFiles] = useState<StatementFileRecord[]>(categoryStatementFiles);

  useEffect(() => {
    setActiveStatementFiles(categoryStatementFiles);
  }, [categoryStatementFiles]);

  // 마스터에 등록된 파일 정보 조회 (fallback)
  const fetchCategoryFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/asset/production/master/statement-file');
      if (res.ok) {
        const data = await res.json();
        const files: StatementFileRecord[] = Array.isArray(data.files) ? data.files : [];
        if (files.length > 0 && activeStatementFiles.length === 0) {
          setActiveStatementFiles(files);
        }
      }
    } catch {}
  }, [activeStatementFiles.length]);

  useEffect(() => {
    if (open) {
      if (activeStatementFiles.length === 0) {
        fetchCategoryFiles();
      }
      // 기존 저장된 검수 결과 확인
      const firstInspected = selectedBatches.find(
        (b) => b.inspectStatus && b.inspectStatus !== 'idle' && b.inspectResult
      );
      if (firstInspected?.inspectResult) {
        const r = firstInspected.inspectResult;
        setAnalyzingFileName(r.fileName || '');
        setStatementRows(r.statementRows || []);
        setGroupSummaries(r.groupSummaries || []);
        setItemMatches(r.details || []);
        setTotalDocPrice(r.docTotalPrice || 0);
        setAllMatched(r.matched || false);
        setLogs(r.logs || ['저장된 검수 결과를 성공적으로 불러왔습니다.']);
      } else {
        setStatementRows([]);
        setGroupSummaries([]);
        setItemMatches([]);
        setLogs([]);
        setAnalyzingFileName('');
      }
    }
  }, [open, selectedBatches, activeStatementFiles.length, fetchCategoryFiles]);

  // 분석 수행 함수
  const analyzeStatementFile = async (file: File) => {
    setAnalyzing(true);
    setAnalyzingFileName(file.name);
    setAnalyzedFileRaw(file);
    setLogs([`📄 [파일 분석 시작] ${file.name} (${(file.size / 1024).toFixed(1)} KB)`]);

    try {
      const lower = file.name.toLowerCase();

      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        // 엑셀 파싱
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const parsedRows = extractProductionExcelRows(json);

        if (parsedRows.length === 0) {
          throw new Error('엑셀 시트에서 품목/수량/단가 제목열을 감지하지 못했습니다.');
        }

        const matchResult = runProductionStatementMatch(dbItems, parsedRows, aliasMap, manualOverrides);
        setStatementRows(parsedRows);
        setGroupSummaries(matchResult.groupSummaries);
        setItemMatches(matchResult.itemMatches);
        setTotalDocPrice(matchResult.totalDocPrice);
        setMatchedBatchDocPrice(matchResult.matchedBatchDocPrice);
        setAllMatched(matchResult.allMatched);
        setLogs((prev) => [
          ...prev,
          `✅ 엑셀 시트 파싱 완료: 총 ${parsedRows.length}개 품목 그룹 인식`,
          `🎯 DB 신청 ${dbItems.length}건 중 ${matchResult.itemMatches.filter((m) => m.matchStatus === 'match').length}건 일치`,
        ]);
      } else if (lower.endsWith('.pdf')) {
        // 서버 PDF OCR 파싱
        const formData = new FormData();
        formData.append('file', file);
        formData.append('dbItems', JSON.stringify(dbItems));
        formData.append('aliasMap', JSON.stringify(aliasMap));

        const res = await fetch('/api/asset/production/master/compare-ocr', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'PDF 판독 서버 응답 실패');
        }

        const data = await res.json();
        setStatementRows(data.statementRows || []);
        setGroupSummaries(data.groupSummaries || []);
        setItemMatches(data.itemMatches || []);
        setTotalDocPrice(data.totalDocPrice || 0);
        setMatchedBatchDocPrice(
          data.matchedBatchDocPrice ||
            (data.itemMatches || []).reduce(
              (s: number, m: any) => s + (m.docUnitPrice || 0) * (m.quantity || 1),
              0
            )
        );
        setAllMatched(data.allMatched || false);
        setLogs(data.logs || []);
      } else {
        throw new Error('지원하지 않는 파일 형식입니다. PDF 또는 Excel(.xlsx)을 업로드하세요.');
      }
    } catch (error: any) {
      alert(`문서 분석 중 오류가 발생했습니다: ${error.message}`);
      setLogs((prev) => [...prev, `❌ 오류: ${error.message}`]);
    } finally {
      setAnalyzing(false);
    }
  };

  // 마스터 등록 외주업체 명세표 파일 원클릭 로드 및 분석
  const handleLoadStatementFileAndAnalyze = async (stmtFile: StatementFileRecord) => {
    setLoadingMasterFile(true);
    try {
      const res = await fetch(`/api/asset/production/master/statement-file?download=1&id=${stmtFile.id}`);
      if (!res.ok) throw new Error('외주 거래명세표 파일을 내려받지 못했습니다.');
      const blob = await res.blob();
      const file = new File([blob], stmtFile.fileName, { type: stmtFile.mimeType || blob.type });
      await analyzeStatementFile(file);
    } catch (err: any) {
      alert(`명세표 파일 로드 실패: ${err.message}`);
    } finally {
      setLoadingMasterFile(false);
    }
  };

  // 수기 강제 매칭 처리 (명세표 행 드롭다운 선택)
  const handleAssignRowToItem = (itemId: string, rowIndex: number) => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    const targetRow = statementRows.find((r) => r.rawIndex === rowIndex);
    const unitPrice = targetRow?.unitPrice || 0;
    const nextOverrides = {
      ...manualOverrides,
      [itemId]: { rowIndex, unitPrice },
    };
    setManualOverrides(nextOverrides);

    const reMatched = runProductionStatementMatch(dbItems, statementRows, aliasMap, nextOverrides);
    setGroupSummaries(reMatched.groupSummaries);
    setItemMatches(reMatched.itemMatches);
    setTotalDocPrice(reMatched.totalDocPrice);
    setMatchedBatchDocPrice(reMatched.matchedBatchDocPrice);
    setAllMatched(reMatched.allMatched);
  };

  // 원클릭 일치 승인 (adminOverride)
  const handleAdminAcceptMatch = (itemId: string) => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    const updated = itemMatches.map((m) => {
      if (m.id === itemId) {
        return {
          ...m,
          matchStatus: 'match' as const,
          adminOverride: true,
          resultNote: '관리자 수동 일치 승인',
        };
      }
      return m;
    });
    setItemMatches(updated);
    const isAll = updated.every((m) => m.matchStatus === 'match' || m.adminOverride);
    setAllMatched(isAll);
  };

  // 단가 직접 수정 저장
  const handleSaveItemPrice = (itemId: string) => {
    const priceNum = parseInt(priceInputDraft.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return alert('올바른 단가를 입력해 주세요.');
    }
    const updated = itemMatches.map((m) => {
      if (m.id === itemId) {
        return {
          ...m,
          docUnitPrice: priceNum,
          adminOverride: true,
          matchStatus: 'match' as const,
          resultNote: `관리자 단가 직접 입력 (₩${priceNum.toLocaleString()})`,
        };
      }
      return m;
    });
    setItemMatches(updated);
    setMatchedBatchDocPrice(
      updated.reduce((s, m) => s + (m.docUnitPrice || 0) * (m.quantity || 1), 0)
    );
    setEditingPriceItemId(null);
    setPriceInputDraft('');
  };

  // 검수 결과 저장 및 정산 확정
  const handleSaveInspectResult = async () => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    if (itemMatches.length === 0) return alert('저장할 검수 결과가 없습니다.');

    const payload = selectedBatches.map((batch) => {
      const ids = new Set((batch.items || []).map((i) => i.id));
      const batchDetails = itemMatches.filter((m) => ids.has(m.id));
      const itemStatus: Record<string, string> = {};
      const itemPrice: Record<string, number> = {};

      batchDetails.forEach((m) => {
        itemStatus[m.id] = m.matchStatus === 'match' || m.adminOverride ? 'match' : 'mismatch';
        itemPrice[m.id] = m.docUnitPrice || 0;
      });

      const isBatchAllMatched =
        batchDetails.length > 0 &&
        batchDetails.every((m) => m.matchStatus === 'match' || m.adminOverride);

      return {
        batchId: batch.id,
        inspectStatus: isBatchAllMatched ? 'match' : 'mismatch',
        inspectFileName: analyzingFileName || null,
        inspectResult: {
          fileName: analyzingFileName,
          matched: isBatchAllMatched,
          docTotalPrice: totalDocPrice,
          logs,
          details: batchDetails,
          groupSummaries,
          itemStatus,
          itemPrice,
        },
      };
    });

    try {
      const res = await fetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batches: payload }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || '저장 실패');
      }

      alert('명세서 검수 결과와 확정 단가가 성공적으로 저장되었습니다!');
      onSaved();
      onClose();
    } catch (err: any) {
      alert(`저장 중 오류: ${err.message}`);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[130] p-4 animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-7xl w-full p-7 space-y-5 max-h-[94vh] flex flex-col">
        {/* 헤더 */}
        <div className="border-b border-slate-100 pb-4 flex justify-between items-start shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-900">
                외주사 거래명세표 교차 검증 (현판/명판/제작물)
              </h2>
              <button
                type="button"
                onClick={() => {
                  setAliasDraft(aliasMap);
                  setIsAliasModalOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 px-2.5 py-1 text-[11px] font-black text-indigo-700 transition-colors"
                title="인증종류 줄임말 약어 설정"
              >
                <span>⚙ 인증종류 약어 사전</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 font-bold mt-1">
              선택한 <strong className="text-indigo-600">{selectedBatches.length}개</strong> 묶음 (총{' '}
              <strong className="text-indigo-600">{dbItems.length}건</strong>)의 현판 제작건과 외주 거래명세표를 자동 대조합니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black transition-colors flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* 1. 상단 파일 공급 바 (마스터 등록 외주사별 파일 원클릭 로드 or 직접 업로드) */}
        <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3">
            <span className="text-2xl mt-0.5">📂</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-600 text-white">
                  {categoryName ? `${categoryName} 외주 명세표` : '외주 거래명세표'}
                </span>
                <span className="text-xs font-black text-slate-800">
                  {activeStatementFiles.length > 0
                    ? `등록된 외주사 ${activeStatementFiles.length}건`
                    : '등록된 외주사 명세표 없음'}
                </span>
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                {activeStatementFiles.length > 0
                  ? '마스터가 등록한 외주업체별 명세표 버튼을 클릭하면 즉시 해당 업체의 명세표로 대조를 시작합니다.'
                  : '등록된 명세표가 없습니다. 우측 [📄 다른 파일 직접 선택]으로 PDF/Excel을 직접 올려 대조하세요.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeStatementFiles.map((sf) => (
              <button
                key={sf.id}
                type="button"
                disabled={loadingMasterFile || analyzing}
                onClick={() => handleLoadStatementFileAndAnalyze(sf)}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black rounded-xl shadow-md transition-all flex items-center gap-1.5"
                title={`${sf.fileName} (${(sf.fileSize / 1024).toFixed(1)} KB) - ${sf.uploadedBy}`}
              >
                <span>⚡ 🏢 {sf.vendorName} 명세표로 검증</span>
              </button>
            ))}

            <button
              type="button"
              disabled={analyzing}
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-black rounded-xl shadow-sm transition-colors"
            >
              📄 다른 파일 직접 선택
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) analyzeStatementFile(f);
              }}
            />
          </div>
        </div>

        {/* 2. 분석 중 상태 */}
        {analyzing && (
          <div className="flex flex-col items-center justify-center h-56 space-y-4 bg-slate-50/80 rounded-2xl border border-slate-200">
            <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            <p className="text-sm font-black text-indigo-800 animate-pulse">
              [{analyzingFileName}] 명세표의 품목·괄호 프로젝트명·수량·단가를 분석하고 있습니다...
            </p>
          </div>
        )}

        {/* 3. 분석 결과 화면 */}
        {!analyzing && statementRows.length > 0 && (
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
            {/* 요약 바 */}
            <div
              className={`p-5 rounded-3xl border-2 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                allMatched ? 'bg-emerald-50/80 border-emerald-200' : 'bg-amber-50/80 border-amber-200'
              }`}
            >
              <div className="flex-1">
                <h3
                  className={`text-base font-black flex items-center gap-2 ${
                    allMatched ? 'text-emerald-700' : 'text-amber-800'
                  }`}
                >
                  {allMatched
                    ? '✅ 모든 품목·프로젝트·수량이 완벽하게 일치합니다'
                    : '⚠️ 교차 검증 확인 필요 항목이 있습니다 (수기 매칭 가능)'}
                </h3>
                <p
                  className={`text-xs font-bold mt-1 ${
                    allMatched ? 'text-emerald-700/80' : 'text-amber-800/80'
                  }`}
                >
                  명세표 {groupSummaries.length}개 품목 그룹 ↔ 선택된 DB {dbItems.length}건 정밀 대조 결과입니다.
                  오타나 누락된 건은 우측 작업 열에서 수기 연결 또는 일치 승인이 가능합니다.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm text-right">
                  <p className="text-[10px] text-slate-400 font-bold">선택 묶음({dbItems.length}건) 확정 공급가액</p>
                  <p className="text-lg font-black text-indigo-600 font-mono">
                    ₩{matchedBatchDocPrice.toLocaleString()}
                  </p>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm text-right">
                  <p className="text-[10px] text-slate-400 font-bold">외주 명세표 전체 공급가액</p>
                  <p className="text-lg font-black text-slate-900 font-mono">
                    ₩{totalDocPrice.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* 품목 그룹 집계 카드 */}
            <div>
              <h4 className="text-xs font-black text-slate-700 mb-2 flex items-center justify-between">
                <span>📊 명세표 품목 그룹별 청구 집계 ({groupSummaries.length}개 그룹)</span>
                <span className="text-[10px] text-indigo-600 font-bold">
                  * 선택된 발주 묶음과 매칭된 품목 그룹이 우선 표시됩니다.
                </span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {[...groupSummaries]
                  .sort((a, b) => b.matchedDbCount - a.matchedDbCount)
                  .map((g) => (
                    <div
                      key={g.rowIndex}
                      className={`p-3.5 rounded-xl border text-xs font-bold transition-all ${
                        g.matchedDbCount > 0
                          ? g.isQtyMatched
                            ? 'bg-indigo-50/40 border-indigo-200 ring-1 ring-indigo-200 shadow-sm'
                            : 'bg-amber-50/50 border-amber-300 shadow-sm'
                          : 'bg-slate-50/60 border-slate-200 opacity-75'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="font-black text-slate-900 truncate" title={g.categoryTitle}>
                          {g.categoryTitle}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {g.matchedDbCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-indigo-600 text-white">
                              매칭 {g.matchedDbCount}건
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                              g.isQtyMatched
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {g.isQtyMatched ? '수량 일치' : '수량 불일치'}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1 text-[11px] text-slate-600">
                        <div className="flex justify-between">
                          <span className="text-slate-400">규격/소속:</span>
                          <span className="truncate max-w-[170px]" title={`${g.spec || '-'} · ${g.dept || '-'}`}>
                            {g.spec || '-'} · {g.dept || '-'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">청구 수량:</span>
                          <span className="font-mono">
                            명세서 <strong className="text-indigo-600">{g.docQty}</strong>개 / DB 매칭{' '}
                            <strong className={g.isQtyMatched ? 'text-emerald-600' : 'text-rose-600'}>
                              {g.matchedDbQty}
                            </strong>
                            개
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">단가 / 금액:</span>
                          <span className="font-mono font-black text-slate-900">
                            ₩{g.docUnitPrice.toLocaleString()} / ₩{g.docSupplyPrice.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* 건별 상세 매칭 테이블 */}
            <div>
              <h4 className="text-xs font-black text-slate-700 mb-2 flex items-center justify-between">
                <span>📋 신청 건별 교차 대조 상세 ({itemMatches.length}건)</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  * 검수 완료 저장 시, 각 건의 확정 단가로 시스템에 자동 반영됩니다.
                </span>
              </h4>

              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-inner max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-600 font-black sticky top-0 z-10 text-[10px]">
                    <tr>
                      <th className="p-2.5 pl-3 w-10 text-center">NO</th>
                      <th className="p-2.5 w-24">관리번호</th>
                      <th className="p-2.5 w-16">대상자</th>
                      <th className="p-2.5 w-28">인증종류</th>
                      <th className="p-2.5 min-w-[160px]">신청 프로젝트명(건물명)</th>
                      <th className="p-2.5 w-20 text-center">품목/재질</th>
                      <th className="p-2.5 min-w-[140px]">명세표 매칭 품목</th>
                      <th className="p-2.5 w-24 text-right">확정단가</th>
                      <th className="p-2.5 w-20 text-center">판별</th>
                      <th className="p-2.5 text-center w-28">관리자 작업</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-[11px]">
                    {itemMatches.map((item, idx) => {
                      const isMatched = item.matchStatus === 'match' || item.adminOverride;
                      return (
                        <tr
                          key={item.id}
                          className={isMatched ? 'bg-white hover:bg-slate-50/50' : 'bg-rose-50/40 hover:bg-rose-50/70'}
                        >
                          <td className="p-2.5 text-center font-mono text-slate-400">{idx + 1}</td>
                          <td className="p-2.5 font-mono text-slate-800 text-[10px]">{item.postNumber}</td>
                          <td className="p-2.5 text-slate-800">{item.userName}</td>
                          <td className="p-2.5 text-slate-700 truncate max-w-[110px]" title={item.certType}>
                            {item.certType}
                          </td>
                          <td className="p-2.5">
                            <span className="text-slate-900 font-black">{item.projectName}</span>
                            {item.docProjectName && item.docProjectName !== item.projectName && (
                              <p className="text-[10px] text-indigo-600 font-normal">
                                명세서: {item.docProjectName}
                              </p>
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                  item.isJumul
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {item.isJumul ? '주물' : '일반'}
                              </span>
                              {item.plateLabel && (
                                <span className="text-[9px] text-slate-400 truncate max-w-[70px]" title={item.plateLabel}>
                                  {item.plateLabel}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2.5 truncate max-w-[140px]" title={item.matchedRowTitle}>
                            <select
                              value={item.matchedRowIndex ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val !== '') handleAssignRowToItem(item.id, parseInt(val, 10));
                              }}
                              className="text-[10px] font-bold border border-slate-200 rounded px-1.5 py-1 outline-none bg-white max-w-full truncate"
                            >
                              <option value="">(품목 수기 선택)</option>
                              {statementRows.map((r) => (
                                <option key={r.rawIndex} value={r.rawIndex}>
                                  {r.categoryTitle} (₩{r.unitPrice.toLocaleString()})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2.5 text-right font-mono font-black text-slate-900">
                            {editingPriceItemId === item.id ? (
                              <div className="flex items-center gap-1 justify-end">
                                <input
                                  type="text"
                                  value={priceInputDraft}
                                  onChange={(e) => setPriceInputDraft(e.target.value)}
                                  className="w-16 border rounded px-1 py-0.5 text-right font-mono text-[10px]"
                                  placeholder="0"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveItemPrice(item.id)}
                                  className="text-[10px] bg-indigo-600 text-white px-1 py-0.5 rounded"
                                >
                                  OK
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPriceItemId(item.id);
                                  setPriceInputDraft(String(item.docUnitPrice || ''));
                                }}
                                className="hover:underline font-mono"
                                title="클릭하여 단가 직접 수정"
                              >
                                {item.docUnitPrice ? `₩${item.docUnitPrice.toLocaleString()}` : '-'}
                              </button>
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            <div className="flex flex-col items-center">
                              <span
                                className={`text-xs font-black ${
                                  isMatched ? 'text-emerald-600' : 'text-rose-600'
                                }`}
                                title={item.resultNote}
                              >
                                {isMatched ? 'O' : 'X'}
                              </span>
                              {!isMatched && (
                                <span className="text-[9px] text-rose-500 font-normal leading-tight" title={item.resultNote}>
                                  {!item.materialMatch ? '재질 상이' : !item.certMatch ? '인증 상이' : '확인 필요'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2.5 text-center whitespace-nowrap">
                            {!isMatched ? (
                              <button
                                type="button"
                                onClick={() => handleAdminAcceptMatch(item.id)}
                                className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 rounded text-[10px] font-black shadow-sm"
                              >
                                일치 승인
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-300 font-normal">완료</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 4. 초기 상태 안내 */}
        {!analyzing && statementRows.length === 0 && (
          <div className="p-12 flex flex-col items-center justify-center border-2 border-dashed border-indigo-200 rounded-3xl bg-indigo-50/20 text-center space-y-2">
            <span className="text-4xl">📑</span>
            <p className="text-sm font-black text-indigo-900">
              상단의 [마스터 명세표로 즉시 검증] 또는 [다른 파일 직접 선택]을 클릭해 주세요.
            </p>
            <p className="text-xs text-slate-400 font-bold">
              외주사에서 발행한 거래명세표(PDF/Excel)를 올리면 품목별 괄호 안의 프로젝트명과 수량, 단가를 자동으로 대조합니다.
            </p>
          </div>
        )}

        {/* 하단 버튼 바 */}
        <div className="border-t border-slate-100 pt-4 flex justify-between items-center shrink-0">
          <p className="text-[11px] text-slate-400 font-bold">
            검수 완료 시 각 건의 확정 단가(`finalPrice`)가 저장되고 정산 상태가 완료로 갱신됩니다.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl transition-colors"
            >
              닫기
            </button>
            {statementRows.length > 0 && (
              <button
                type="button"
                onClick={handleSaveInspectResult}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-md transition-colors"
              >
                검수 결과 저장 및 정산 확정
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ⚙ 인증종류 약어 사전 설정 모달 */}
      {isAliasModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[85vh] flex flex-col">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <span>⚙ 인증종류 줄임말(약어) 사전 설정</span>
              </h3>
              <p className="mt-1 text-xs text-slate-500 font-bold leading-relaxed">
                외주사 거래명세표에 축약되어 표기되는 인증종류 줄임말을 등록하세요. (쉼표로 구분)
              </p>
            </div>

            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {Object.keys(aliasDraft).map((certKey) => (
                <div key={certKey} className="space-y-1">
                  <label className="text-[11px] font-black text-slate-700">{certKey}</label>
                  <input
                    type="text"
                    value={aliasDraft[certKey]?.join(', ') || ''}
                    onChange={(e) => {
                      const parts = e.target.value
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setAliasDraft((prev) => ({ ...prev, [certKey]: parts }));
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
                    placeholder="예: 녹색건축, 녹색"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAliasModalOpen(false)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-200"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setAliasMap(aliasDraft);
                  try {
                    localStorage.setItem('prod_cert_aliases', JSON.stringify(aliasDraft));
                  } catch {}
                  setIsAliasModalOpen(false);
                  alert('약어 사전이 저장되었습니다. 분석 시 즉시 반영됩니다.');
                  if (analyzedFileRaw) analyzeStatementFile(analyzedFileRaw);
                }}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 shadow-sm"
              >
                설정 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
