'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { StatementFileRecord } from '@/app/api/asset/production/master/statement-file/route';
import * as XLSX from 'xlsx';
import {
  getDefaultRulesForCategory,
  migrateLegacyZebCertKeywords,
  syncAliasMapToMasterLabels,
  type ProductionStatementRules,
  type StatementColumnHeaderKeywords,
  type CertTypeAliasMap,
  type PlateItemAliasMap,
  type ProductionDbItem,
  type ItemMatchResult,
  type GroupMatchSummary,
  type ParsedStatementRow,
  extractProductionExcelRows,
  runProductionStatementMatch,
  resolveJebonProjectName,
  formatStatementRowLabel,
  isExcludedStatementItem,
  getStatementSettledPrice,
  getItemBatchAmount,
} from '@/lib/production-statement-match';
import {
  analyzeOfficeSuppliesExcelWorkbook,
  runOfficeSuppliesStatementMatch,
  aggregateOfficeLineMatchesForSave,
  parseOfficeQuoteLineId,
  getOfficeQuoteLinesFromOptions,
  serializeOfficeQuoteLinesToRawText,
  parseOfficeSuppliesQuoteText,
  buildOfficeKeywordMasterLabels,
  sanitizeOfficeProductAliases,
  type OfficeDbItemSource,
} from '@/lib/production-office-statement-match';

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
  inspectedAt?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  selectedBatches: CompareModalBatch[];
  canEdit: boolean;
  /** 명세표 매칭 규칙 설정 — 마스터만 (부서는 숨김) */
  canEditRules?: boolean;
  apiPath: string;
  categoryKey?: string;
  categoryStatementFiles?: StatementFileRecord[];
  categoryName?: string;
  onSaved: () => void;
};

type CertMasterOption = {
  id: string;
  certId: string;
  label: string;
};

type PlateMasterOption = {
  id: string;
  code: string;
  label: string;
  size: string;
  price: number;
};

type RulesDraftForm = {
  columnHeaders: Record<keyof StatementColumnHeaderKeywords, string>;
  certTypeKeywords: Record<string, string>;
  plateItemKeywords: Record<string, string>;
};

function rulesToDraftForm(r: ProductionStatementRules): RulesDraftForm {
  const colHeaders: Record<keyof StatementColumnHeaderKeywords, string> = {
    certType: (r.columnHeaders?.certType || []).join(', '),
    plateItem: (r.columnHeaders?.plateItem || []).join(', '),
    spec: (r.columnHeaders?.spec || []).join(', '),
    projectName: (r.columnHeaders?.projectName || []).join(', '),
    quantity: (r.columnHeaders?.quantity || []).join(', '),
    dept: (r.columnHeaders?.dept || []).join(', '),
    unitPrice: (r.columnHeaders?.unitPrice || []).join(', '),
    supplyPrice: (r.columnHeaders?.supplyPrice || []).join(', '),
  };

  const certMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.certTypeKeywords || {})) {
    certMap[k] = (v || []).join(', ');
  }

  const plateMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.plateItemKeywords || {})) {
    plateMap[k] = (v || []).join(', ');
  }

  return {
    columnHeaders: colHeaders,
    certTypeKeywords: certMap,
    plateItemKeywords: plateMap,
  };
}

function parseCommaSeparated(val: string): string[] {
  return String(val || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function draftFormToRules(f: RulesDraftForm): ProductionStatementRules {
  const colHeaders: StatementColumnHeaderKeywords = {
    certType: parseCommaSeparated(f.columnHeaders.certType),
    plateItem: parseCommaSeparated(f.columnHeaders.plateItem),
    spec: parseCommaSeparated(f.columnHeaders.spec),
    projectName: parseCommaSeparated(f.columnHeaders.projectName),
    quantity: parseCommaSeparated(f.columnHeaders.quantity),
    dept: parseCommaSeparated(f.columnHeaders.dept),
    unitPrice: parseCommaSeparated(f.columnHeaders.unitPrice),
    supplyPrice: parseCommaSeparated(f.columnHeaders.supplyPrice),
  };

  const certMap: CertTypeAliasMap = {};
  for (const [k, v] of Object.entries(f.certTypeKeywords || {})) {
    certMap[k] = parseCommaSeparated(v);
  }

  const plateMap: PlateItemAliasMap = {};
  for (const [k, v] of Object.entries(f.plateItemKeywords || {})) {
    plateMap[k] = parseCommaSeparated(v);
  }

  return {
    columnHeaders: colHeaders,
    certTypeKeywords: certMap,
    plateItemKeywords: plateMap,
  };
}

export default function ProductionStatementCompareModal({
  open,
  onClose,
  selectedBatches,
  canEdit,
  canEditRules = false,
  apiPath,
  categoryKey = 'SIGN',
  categoryStatementFiles = [],
  categoryName,
  onSaved,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingMasterFile, setLoadingMasterFile] = useState(false);

  // 통합 명세표 매칭 규칙 (서버 파일 저장 — localStorage 금지)
  const [rules, setRules] = useState<ProductionStatementRules>(() =>
    getDefaultRulesForCategory(categoryKey || 'SIGN')
  );

  // 카테고리 변경 시 기본값으로 리셋 후 fetchRulesAndMasters가 서버 규칙 로드
  useEffect(() => {
    setRules(getDefaultRulesForCategory(categoryKey || 'SIGN'));
  }, [categoryKey]);

  // 규칙 설정 모달 상태
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [rulesActiveTab, setRulesActiveTab] = useState<'headers' | 'certs' | 'plates'>('headers');
  const [rulesDraft, setRulesDraft] = useState<RulesDraftForm>(() => rulesToDraftForm(rules));
  const [savingRules, setSavingRules] = useState(false);

  // 마스터 드롭다운 옵션 (1. 인증의 종류, 3. 현판/제본/제작물 품목)
  const [certMasterList, setCertMasterList] = useState<CertMasterOption[]>([]);
  const [plateMasterList, setPlateMasterList] = useState<PlateMasterOption[]>([]);

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
  const [approveDialog, setApproveDialog] = useState<{
    itemId: string;
    priceDraft: string;
  } | null>(null);
  /** 명세표 불일치·확인불가 목록 펼침 (기본 접힘) */
  const [statementIssuesExpanded, setStatementIssuesExpanded] = useState(false);

  const isJebonCategory = String(categoryKey || '').toUpperCase() === 'JEBON';
  const isOfficeCategory =
    String(categoryKey || '').toUpperCase() === 'OFFICE_SUPPLIES';
  const isPrintLikeCategory =
    String(categoryKey || '').toUpperCase() === 'PRINT' || isOfficeCategory;
  const priceColumnLabel = isJebonCategory || isPrintLikeCategory ? '최종금액' : '확정단가';
  const priceInputLabel = isJebonCategory ? '최종 금액(원)' : '확정 단가(개당, 원)';

  const sumMatchedBatchPrice = useCallback(
    (rows: ItemMatchResult[]) =>
      rows.reduce((s, m) => s + getItemBatchAmount(m, categoryKey || m.category), 0),
    [categoryKey]
  );

  // DB 아이템 변환 (현판, 제본, 기타제작물, 사무문구류 전 분야 지원)
  const dbItems: ProductionDbItem[] = useMemo(() => {
    return selectedBatches
      .flatMap((b) => b.items || [])
      .map((item) => {
        const opts = (item.options || {}) as Record<string, unknown>;
        const itemCategory = String(item.category || categoryKey || 'SIGN').toUpperCase();
        const isJebon = itemCategory === 'JEBON';
        const isPrintLike = itemCategory === 'PRINT' || itemCategory === 'OFFICE_SUPPLIES';
        const certType = isPrintLike
          ? ''
          : String(
              opts.certType ||
                (itemCategory === 'SIGN' || isJebon ? item.title : '') ||
                ''
            ).trim();
        const plateInfo = opts.plateMasterInfo as { label?: string; size?: string } | undefined;
        const printItemInfo = opts.printItemMasterInfo as { name?: string; size?: string } | undefined;

        // 현판: 품목/재질 · 제본: 판형 · 기타제작물: printItemMasterInfo 우선 (현판 plate 잔존값 무시)
        const plateLabel = String(
          isJebon
            ? opts.jebonSizeType || opts.jebonSize || ''
            : isPrintLike
              ? printItemInfo?.name ||
                opts.printItemName ||
                item.title ||
                ''
              : plateInfo?.label || opts.plateType || ''
        ).trim();

        const plateSize = String(
          isJebon
            ? opts.jebonSize || opts.jebonSizeType || ''
            : isPrintLike
              ? printItemInfo?.size || opts.spec || opts.size || ''
              : plateInfo?.size || opts.spec || opts.size || ''
        ).trim();

        const projectName = isJebon
          ? resolveJebonProjectName(opts, String(item.title || ''))
          : isPrintLike
            ? String(item.title || printItemInfo?.name || '').trim()
            : String(opts.projectName || opts.isoCompanyName || item.title || '').trim();
        const isJumul = isJebon || isPrintLike
          ? false
          : plateLabel.includes('주물') || String(opts.plateType || '').includes('CAST_IRON');

        return {
          id: item.id,
          postNumber: item.postNumber || '-',
          category: item.category || categoryKey || 'SIGN',
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
  }, [selectedBatches, categoryKey]);

  /** 사무문구: 견적 붙여넣기 텍스트를 매칭 엔진에 전달 */
  const officeDbItems: OfficeDbItemSource[] = useMemo(() => {
    if (!isOfficeCategory) return [];
    const byId = new Map(
      selectedBatches.flatMap((b) => b.items || []).map((item) => [item.id, item])
    );
    return dbItems.map((di) => {
      const raw = byId.get(di.id);
      const opts = (raw?.options || {}) as Record<string, unknown>;
      const lines = getOfficeQuoteLinesFromOptions(opts);
      const quoteRawText =
        lines.length > 0
          ? serializeOfficeQuoteLinesToRawText(lines)
          : String(opts.suppliesQuoteRawText || '').trim();
      return {
        ...di,
        quoteRawText,
      };
    });
  }, [dbItems, isOfficeCategory, selectedBatches]);

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

  // 서버의 매칭 규칙 및 마스터 드롭다운 목록 가져오기 (카테고리별 분기)
  const fetchRulesAndMasters = useCallback(async () => {
    try {
      const ts = Date.now();
      const currentCat = categoryKey || 'SIGN';
      const categoryDefaults = getDefaultRulesForCategory(currentCat);
      const isOffice = currentCat === 'OFFICE_SUPPLIES';

      const calls: Promise<Response | null>[] = [
        fetch(`/api/asset/production/master/statement-rules?category=${currentCat}&t=${ts}`, { cache: 'no-store' }),
        isOffice
          ? Promise.resolve(null)
          : fetch(`/api/asset/production/master/certs?t=${ts}`, { cache: 'no-store' }),
      ];

      if (currentCat === 'JEBON') {
        calls.push(fetch(`/api/asset/production/master/jebon-sizes?t=${ts}`, { cache: 'no-store' }));
      } else if (currentCat === 'PRINT') {
        calls.push(fetch(`/api/asset/production/master/print-items?t=${ts}`, { cache: 'no-store' }));
      } else if (isOffice) {
        calls.push(Promise.resolve(null));
      } else {
        calls.push(fetch(`/api/asset/production/master/plates?t=${ts}`, { cache: 'no-store' }));
      }

      const [rulesRes, certsRes, itemsRes] = await Promise.all(calls);

      let nextRules: ProductionStatementRules = categoryDefaults;
      if (rulesRes?.ok) {
        const rData = await rulesRes.json();
        if (rData.rules) {
          nextRules = migrateLegacyZebCertKeywords(rData.rules, currentCat);
        }
      }
      if (isOffice) {
        nextRules = {
          ...nextRules,
          plateItemKeywords: sanitizeOfficeProductAliases(nextRules.plateItemKeywords),
          certTypeKeywords: {},
        };
      }

      let certList: CertMasterOption[] = [];
      if (certsRes?.ok) {
        const cData = await certsRes.json();
        if (Array.isArray(cData)) {
          const targetType = currentCat === 'JEBON' ? 'JEBON' : 'SIGN';
          // API createdAt 등록 순서 유지 (apply/request 서식과 동일)
          certList = cData
            .filter((c: any) => c.type === targetType || (!c.type && currentCat === 'SIGN'))
            .map((c: any) => ({
              id: c.id,
              certId: c.certId,
              label: c.label,
            }));
          setCertMasterList(certList);
        }
      } else if (isOffice) {
        setCertMasterList([]);
      }

      let itemList: PlateMasterOption[] = [];
      if (isOffice) {
        const quoteNames = officeDbItems.flatMap((di) => {
          const lines = parseOfficeSuppliesQuoteText(String(di.quoteRawText || ''));
          return lines.map((l) => l.productName);
        });
        const labels = buildOfficeKeywordMasterLabels(
          quoteNames,
          nextRules.plateItemKeywords
        );
        itemList = labels.map((label) => ({
          id: label,
          code: '',
          label,
          size: '',
          price: 0,
        }));
        setPlateMasterList(itemList);
      } else if (itemsRes?.ok) {
        const iData = await itemsRes.json();
        if (Array.isArray(iData)) {
          if (currentCat === 'JEBON') {
            itemList = iData.map((s: any) => ({
              id: s.id || s.code,
              code: s.code,
              label: s.label || s.code,
              size: s.size || '',
              price: 0,
            }));
          } else if (currentCat === 'PRINT') {
            itemList = iData.map((item: any) => ({
              id: item.id,
              code: item.id,
              label: item.name,
              size: item.size || '',
              price: 0,
            }));
          } else {
            itemList = iData.map((p: any) => ({
              id: p.id,
              code: p.code,
              label: p.label,
              size: p.size,
              price: Number(p.price) || 0,
            }));
          }
          setPlateMasterList(itemList);
        }
      }

      // 신청 마스터 목록·순서에 맞춰 매칭 키워드 자동 동기화
      const certLabels = certList.map((c) => c.label);
      const itemLabels: string[] = [];
      const seenItem = new Set<string>();
      for (const p of itemList) {
        const label = String(p.label || '').trim();
        if (!label || seenItem.has(label)) continue;
        seenItem.add(label);
        itemLabels.push(label);
      }

      if (currentCat === 'SIGN' || currentCat === 'JEBON') {
        nextRules = {
          ...nextRules,
          certTypeKeywords: syncAliasMapToMasterLabels(
            certLabels,
            nextRules.certTypeKeywords,
            categoryDefaults.certTypeKeywords
          ),
        };
      }

      if (itemLabels.length > 0) {
        nextRules = {
          ...nextRules,
          plateItemKeywords: syncAliasMapToMasterLabels(
            itemLabels,
            nextRules.plateItemKeywords,
            categoryDefaults.plateItemKeywords
          ),
        };
      }

      setRules(nextRules);
    } catch (e) {
      console.error('Failed to fetch rules and masters:', e);
    }
  }, [categoryKey, officeDbItems]);

  const inspectSnapshotKey = useMemo(
    () =>
      selectedBatches
        .map(
          (b) =>
            `${b.id}:${b.inspectStatus}:${b.inspectedAt || ''}:${b.inspectResult?.matchCount ?? ''}:${b.inspectResult?.mismatchCount ?? ''}:${Array.isArray(b.inspectResult?.statementRows) ? b.inspectResult.statementRows.length : 0}`
        )
        .join('|'),
    [selectedBatches]
  );
  const prevModalOpenRef = useRef(false);
  const lastRestoredSnapshotRef = useRef<string>('');

  useEffect(() => {
    if (!open) {
      prevModalOpenRef.current = false;
      lastRestoredSnapshotRef.current = '';
      return;
    }

    fetchRulesAndMasters();
    if (activeStatementFiles.length === 0) {
      fetchCategoryFiles();
    }

    const justOpened = !prevModalOpenRef.current;
    prevModalOpenRef.current = true;

    const inspectedBatches = selectedBatches.filter(
      (b) => b.inspectStatus && b.inspectStatus !== 'idle' && b.inspectResult
    );

    if (inspectedBatches.length === 0) {
      // 모달을 처음 열 때만 초기화 (작업 중 부모 리프레시로 날리지 않음)
      if (justOpened) {
        setStatementRows([]);
        setGroupSummaries([]);
        setItemMatches([]);
        setManualOverrides({});
        setLogs([]);
        setAnalyzingFileName('');
    setAllMatched(false);
      setMatchedBatchDocPrice(0);
      setTotalDocPrice(0);
      setStatementIssuesExpanded(false);
      }
      return;
    }

    // 동일 스냅샷 중복 복원 방지 (입력 중인 승인/단가 보호)
    if (!justOpened && lastRestoredSnapshotRef.current === inspectSnapshotKey) {
      return;
    }
    lastRestoredSnapshotRef.current = inspectSnapshotKey;

    const primary = inspectedBatches[0].inspectResult || {};
    const mergedDetails: ItemMatchResult[] = [];
    const seenIds = new Set<string>();
    for (const b of inspectedBatches) {
      const details = Array.isArray(b.inspectResult?.details) ? b.inspectResult.details : [];
      for (const d of details) {
        if (!d?.id || seenIds.has(d.id)) continue;
        seenIds.add(d.id);
        mergedDetails.push(d as ItemMatchResult);
      }
    }

    const restoredRows: ParsedStatementRow[] = Array.isArray(primary.statementRows)
      ? primary.statementRows
      : [];
    const restoredOverrides =
      primary.manualOverrides && typeof primary.manualOverrides === 'object'
        ? primary.manualOverrides
        : {};

    setAnalyzingFileName(primary.fileName || '');
    setStatementRows(restoredRows);
    setGroupSummaries(Array.isArray(primary.groupSummaries) ? primary.groupSummaries : []);
    setItemMatches(mergedDetails);
    setManualOverrides(restoredOverrides);
    setTotalDocPrice(Number(primary.docTotalPrice) || 0);
    setMatchedBatchDocPrice(
      mergedDetails.reduce(
        (s, m) => s + getItemBatchAmount(m, categoryKey || m.category),
        0
      )
    );
    setAllMatched(
      Boolean(primary.matched) ||
        (mergedDetails.length > 0 &&
          mergedDetails.every((m) => m.matchStatus === 'match' || m.adminOverride))
    );
    const mc = mergedDetails.filter((m) => m.matchStatus === 'match' || m.adminOverride).length;
    const mmc = mergedDetails.length - mc;
    setLogs(
      Array.isArray(primary.logs) && primary.logs.length > 0
        ? primary.logs
        : [
            '저장된 검수 결과를 불러왔습니다.',
            mmc > 0
              ? `중간 저장 상태: 일치 ${mc}건 / 불일치 ${mmc}건`
              : `검수 완료: 일치 ${mc}건`,
          ]
    );
  }, [
    open,
    inspectSnapshotKey,
    selectedBatches,
    activeStatementFiles.length,
    fetchCategoryFiles,
    fetchRulesAndMasters,
    categoryKey,
  ]);

  // 분석 수행 함수
  const analyzeStatementFile = async (file: File, currentRules: ProductionStatementRules = rules) => {
    setAnalyzing(true);
    setAnalyzingFileName(file.name);
    setAnalyzedFileRaw(file);
    setStatementIssuesExpanded(false);
    setLogs([`📄 [파일 분석 시작] ${file.name} (${(file.size / 1024).toFixed(1)} KB)`]);

    try {
      const lower = file.name.toLowerCase();

      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        // 엑셀 파싱
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });

        if (isOfficeCategory) {
          const matchResult = analyzeOfficeSuppliesExcelWorkbook(
            workbook,
            (sheet) => XLSX.utils.sheet_to_json(sheet as XLSX.WorkSheet, { header: 1 }) as unknown[][],
            officeDbItems,
            currentRules,
            manualOverrides
          );
          if (matchResult.statementRows.length === 0) {
            throw new Error(
              '사무문구 거래명세서에서 부서 탭 품목(품명·수량·금액)을 찾지 못했습니다. 합계 탭이 아닌 부서별 시트가 있는지 확인해 주세요.'
            );
          }
          setStatementRows(matchResult.statementRows);
          setGroupSummaries(matchResult.groupSummaries);
          setItemMatches(matchResult.itemMatches);
          setTotalDocPrice(matchResult.totalDocPrice);
          setMatchedBatchDocPrice(matchResult.matchedBatchDocPrice);
          setAllMatched(matchResult.allMatched);
          setLogs((prev) => [
            ...prev,
            ...matchResult.logs,
            `✅ 멀티시트 파싱 완료: ${workbook.SheetNames.length}탭 · 품목 ${matchResult.statementRows.length}행`,
            `🎯 신청 ${officeDbItems.length}건 중 ${matchResult.itemMatches.filter((m) => m.matchStatus === 'match').length}건 일치`,
          ]);
        } else {
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          const parsedRows = extractProductionExcelRows(json, currentRules.columnHeaders);

          if (parsedRows.length === 0) {
            throw new Error(
              '엑셀 시트에서 품목·수량(또는 청구금액) 제목열을 감지하지 못했습니다. [명세표 매칭 규칙 설정]의 제목행 키워드(예: 원고명, 부수, 청구금액)를 확인해 주세요.'
            );
          }

          const matchResult = runProductionStatementMatch(
            dbItems,
            parsedRows,
            currentRules,
            manualOverrides
          );
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
        }
      } else if (lower.endsWith('.pdf')) {
        // 서버 PDF OCR 파싱
        const formData = new FormData();
        formData.append('file', file);
        formData.append('dbItems', JSON.stringify(dbItems));
        formData.append('rules', JSON.stringify(currentRules));

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
              (s: number, m: any) => s + getItemBatchAmount(m, categoryKey || m.category),
              0
            )
        );
        setAllMatched(data.allMatched || false);
        setLogs(data.logs || []);
        if (!Array.isArray(data.statementRows) || data.statementRows.length === 0) {
          throw new Error(
            'PDF에서 품목 행을 인식하지 못했습니다. 규격(A4 등)·수량·단가·공급가액이 표로 추출되는지, 또는 [명세표 매칭 규칙] 키워드를 확인해 주세요.'
          );
        }
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
  const applyRematch = useCallback(
    (nextOverrides: Record<string, { rowIndex: number; unitPrice?: number }>) => {
      if (isOfficeCategory) {
        const reMatched = runOfficeSuppliesStatementMatch(
          officeDbItems,
          statementRows,
          nextOverrides
        );
        setGroupSummaries(reMatched.groupSummaries);
        setItemMatches(reMatched.itemMatches);
        setTotalDocPrice(reMatched.totalDocPrice);
        setMatchedBatchDocPrice(reMatched.matchedBatchDocPrice);
        setAllMatched(reMatched.allMatched);
        return;
      }
      const reMatched = runProductionStatementMatch(
        dbItems,
        statementRows,
        rules,
        nextOverrides
      );
      setGroupSummaries(reMatched.groupSummaries);
      setItemMatches(reMatched.itemMatches);
      setTotalDocPrice(reMatched.totalDocPrice);
      setMatchedBatchDocPrice(reMatched.matchedBatchDocPrice);
      setAllMatched(reMatched.allMatched);
    },
    [dbItems, isOfficeCategory, officeDbItems, rules, statementRows]
  );

  const handleAssignRowToItem = (itemId: string, rowIndex: number) => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    const targetRow = statementRows.find((r) => r.rawIndex === rowIndex);
    const settled = getStatementSettledPrice(targetRow, categoryKey || 'SIGN');
    const nextOverrides = {
      ...manualOverrides,
      [itemId]: { rowIndex, unitPrice: settled },
    };
    setManualOverrides(nextOverrides);
    applyRematch(nextOverrides);
  };

  const openAdminApproveDialog = (item: ItemMatchResult) => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    const suggested =
      item.docUnitPrice ||
      getStatementSettledPrice(
        statementRows.find((r) => r.rawIndex === item.matchedRowIndex),
        categoryKey || item.category
      ) ||
      0;
    setApproveDialog({
      itemId: item.id,
      priceDraft: suggested ? String(suggested) : '',
    });
  };

  const confirmAdminApproveMatch = () => {
    if (!approveDialog) return;
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    const priceNum = parseInt(String(approveDialog.priceDraft).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return alert(`올바른 ${priceInputLabel}을(를) 입력해 주세요.`);
    }

    const updated = itemMatches.map((m) => {
      if (m.id !== approveDialog.itemId) return m;
      return {
        ...m,
        docUnitPrice: priceNum,
        matchStatus: 'match' as const,
        adminOverride: true,
        adminPriceSet: true,
        resultNote: `관리자 일치 승인 (${priceColumnLabel} ₩${priceNum.toLocaleString()})`,
      };
    });
    setItemMatches(updated);
    setMatchedBatchDocPrice(sumMatchedBatchPrice(updated));
    setAllMatched(updated.every((m) => m.matchStatus === 'match' || m.adminOverride));
    setApproveDialog(null);
  };

  const handleAdminCancelMatch = (itemId: string) => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    if (!confirm('관리자 승인을 취소하고 자동 대조 결과로 되돌리시겠습니까?')) return;

    const nextOverrides = { ...manualOverrides };
    delete nextOverrides[itemId];
    setManualOverrides(nextOverrides);
    applyRematch(nextOverrides);
  };

  // 단가 직접 수정 저장
  const handleSaveItemPrice = (itemId: string) => {
    const priceNum = parseInt(priceInputDraft.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return alert(`올바른 ${priceInputLabel}을(를) 입력해 주세요.`);
    }
    const updated = itemMatches.map((m) => {
      if (m.id === itemId) {
        return {
          ...m,
          docUnitPrice: priceNum,
          adminOverride: true,
          adminPriceSet: true,
          matchStatus: 'match' as const,
          resultNote: `관리자 ${priceColumnLabel} 직접 입력 (₩${priceNum.toLocaleString()})`,
        };
      }
      return m;
    });
    setItemMatches(updated);
    setMatchedBatchDocPrice(sumMatchedBatchPrice(updated));
    setEditingPriceItemId(null);
    setPriceInputDraft('');
  };

  // 검수 결과 저장 및 정산 확정 (부분 일치도 중간 저장)
  const handleSaveInspectResult = async () => {
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    if (itemMatches.length === 0) return alert('저장할 검수 결과가 없습니다.');

    const payload = selectedBatches.map((batch) => {
      const ids = new Set((batch.items || []).map((i) => i.id));
      const batchDetails = isOfficeCategory
        ? itemMatches.filter((m) => {
            const parsed = parseOfficeQuoteLineId(m.id);
            return ids.has(parsed?.requestId || m.id);
          })
        : itemMatches.filter((m) => ids.has(m.id));

      let itemStatus: Record<string, string> = {};
      let itemPrice: Record<string, number> = {};

      if (isOfficeCategory) {
        const agg = aggregateOfficeLineMatchesForSave(batchDetails);
        itemStatus = agg.itemStatus;
        itemPrice = agg.itemPrice;
      } else {
        batchDetails.forEach((m) => {
          itemStatus[m.id] = m.matchStatus === 'match' || m.adminOverride ? 'match' : 'mismatch';
          itemPrice[m.id] = m.docUnitPrice || 0;
        });
      }

      const batchMatchCount = isOfficeCategory
        ? Object.values(itemStatus).filter((s) => s === 'match').length
        : batchDetails.filter((m) => m.matchStatus === 'match' || m.adminOverride).length;
      const batchMismatchCount = isOfficeCategory
        ? Object.values(itemStatus).filter((s) => s !== 'match').length
        : batchDetails.length - batchMatchCount;
      const isBatchAllMatched =
        (isOfficeCategory ? Object.keys(itemStatus).length : batchDetails.length) > 0 &&
        batchMismatchCount === 0;

      return {
        batchId: batch.id,
        inspectStatus: isBatchAllMatched ? 'match' : 'mismatch',
        inspectFileName: analyzingFileName || null,
        inspectResult: {
          fileName: analyzingFileName,
          matched: isBatchAllMatched,
          matchCount: isOfficeCategory
            ? batchDetails.filter((m) => m.matchStatus === 'match' || m.adminOverride).length
            : batchMatchCount,
          mismatchCount: isOfficeCategory
            ? batchDetails.filter((m) => m.matchStatus !== 'match' && !m.adminOverride).length
            : batchMismatchCount,
          docTotalPrice: totalDocPrice,
          matchedBatchPrice: matchedBatchDocPrice,
          logs,
          details: batchDetails,
          statementRows,
          groupSummaries,
          manualOverrides,
          itemStatus,
          itemPrice,
          officeLineMode: isOfficeCategory,
        },
      };
    });

    const matchCount = isOfficeCategory
      ? itemMatches.filter((m) => m.matchStatus === 'match' || m.adminOverride).length
      : itemMatches.filter((m) => m.matchStatus === 'match' || m.adminOverride).length;
    const mismatchCount = itemMatches.length - matchCount;

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

      onSaved();

      if (mismatchCount > 0) {
        alert(
          `검수 결과가 중간 저장되었습니다.\n일치 ${matchCount}건 / 불일치 ${mismatchCount}건\n불일치 항목을 이어서 처리할 수 있습니다.`
        );
        // 부분 저장: 모달 유지 (결과·승인 상태 보존)
      } else {
        alert('명세서 검수 결과와 확정 단가가 성공적으로 저장되었습니다!');
        onClose();
      }
    } catch (err: any) {
      alert(`저장 중 오류: ${err.message}`);
    }
  };

  // 규칙 모달 열기 — 마스터 목록·순서로 키워드 동기화 후 표시
  const handleOpenRulesModal = () => {
    if (!canEditRules) return alert('매칭 규칙은 마스터(관리자)만 수정할 수 있습니다.');
    const currentCat = categoryKey || 'SIGN';
    const defaults = getDefaultRulesForCategory(currentCat);
    let next = migrateLegacyZebCertKeywords(rules, currentCat);
    const isOffice = currentCat === 'OFFICE_SUPPLIES';

    if (isOffice) {
      next = {
        ...next,
        plateItemKeywords: sanitizeOfficeProductAliases(next.plateItemKeywords),
        certTypeKeywords: {},
      };
    }

    const certLabels = certMasterList.map((c) => c.label);
    let itemLabels: string[] = [];
    if (isOffice) {
      const quoteNames = officeDbItems.flatMap((di) =>
        parseOfficeSuppliesQuoteText(String(di.quoteRawText || '')).map((l) => l.productName)
      );
      itemLabels = buildOfficeKeywordMasterLabels(quoteNames, next.plateItemKeywords);
      setPlateMasterList(
        itemLabels.map((label) => ({
          id: label,
          code: '',
          label,
          size: '',
          price: 0,
        }))
      );
    } else {
      const seenItem = new Set<string>();
      for (const p of plateMasterList) {
        const label = String(p.label || '').trim();
        if (!label || seenItem.has(label)) continue;
        seenItem.add(label);
        itemLabels.push(label);
      }
    }

    if (currentCat === 'SIGN' || currentCat === 'JEBON') {
      next = {
        ...next,
        certTypeKeywords: syncAliasMapToMasterLabels(
          certLabels,
          next.certTypeKeywords,
          defaults.certTypeKeywords
        ),
      };
    }
    if (itemLabels.length > 0) {
      next = {
        ...next,
        plateItemKeywords: syncAliasMapToMasterLabels(
          itemLabels,
          next.plateItemKeywords,
          defaults.plateItemKeywords
        ),
      };
    }

    setRules(next);
    setRulesDraft(rulesToDraftForm(next));
    if ((categoryKey === 'PRINT' || categoryKey === 'OFFICE_SUPPLIES') && rulesActiveTab === 'certs') {
      setRulesActiveTab('plates');
    }
    setIsRulesModalOpen(true);
  };

  // 규칙 모달 저장 (서버 반영 및 클라이언트 재적용)
  const handleSaveRulesSubmit = async () => {
    if (!canEditRules) return alert('매칭 규칙은 마스터(관리자)만 수정할 수 있습니다.');
    if (!canEdit) return alert('편집 권한이 필요합니다.');
    setSavingRules(true);
    const currentCat = categoryKey || 'SIGN';
    const parsedRules = migrateLegacyZebCertKeywords(draftFormToRules(rulesDraft), currentCat);
    try {
      const res = await fetch('/api/asset/production/master/statement-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: currentCat, ...parsedRules }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '규칙 저장 실패');
      }

      const data = await res.json();
      const savedRules = migrateLegacyZebCertKeywords(data.rules || parsedRules, currentCat);
      setRules(savedRules);

      setIsRulesModalOpen(false);
      alert(`[${categoryName || currentCat}] 명세표 매칭 규칙 및 키워드가 성공적으로 저장되었습니다.`);

      // 이미 분석된 파일이 있으면 새 규칙으로 즉시 재분석
      if (analyzedFileRaw) {
        analyzeStatementFile(analyzedFileRaw, savedRules);
      }
    } catch (err: any) {
      alert(`저장 중 오류: ${err.message}`);
    } finally {
      setSavingRules(false);
    }
  };

  if (!open) return null;

  const categoryDefaults = getDefaultRulesForCategory(categoryKey || 'SIGN');
  const defaultHeaderHint = (key: keyof typeof categoryDefaults.columnHeaders) =>
    (categoryDefaults.columnHeaders[key] || []).join(', ') || '(없음)';

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[130] p-4 animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl max-w-7xl w-full p-7 space-y-5 max-h-[94vh] flex flex-col">
        {/* 헤더 */}
        <div className="border-b border-slate-100 pb-4 flex justify-between items-start shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-900">
                외주사 거래명세표 교차 검증
              </h2>
              {categoryName && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-indigo-100 text-indigo-700">
                  {categoryName}
                </span>
              )}
              {canEditRules && (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  if (!canEdit) return alert('편집 권한이 필요합니다.');
                  handleOpenRulesModal();
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black transition-all shadow-xs ${
                  canEdit
                    ? 'border-indigo-200 bg-indigo-50/90 hover:bg-indigo-100 text-indigo-700'
                    : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
                title={!canEdit ? '편집 권한 필요' : '칼럼 검색 키워드 및 매칭 문구 설정'}
              >
                <span>⚙ 명세표 매칭 규칙 설정(Edit)</span>
              </button>
              )}
            </div>
            <p className="text-xs text-slate-500 font-bold mt-1">
              선택한 <strong className="text-indigo-600">{selectedBatches.length}개</strong> 묶음 (총{' '}
              <strong className="text-indigo-600">{dbItems.length}건</strong>)의 {categoryName ? `[${categoryName}]` : '외주제작'} 건과 외주 거래명세표를 자동 대조합니다.
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
                <span>
                  ⚡ 🏢 {sf.vendorName}{' '}
                  <span className="opacity-80 font-normal text-[11px]">
                    ({sf.fileName.length > 18 ? sf.fileName.slice(0, 18) + '…' : sf.fileName})
                  </span>
                </span>
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
            {/* 요약 바 — 신청 리스트 기준 */}
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
                    ? '✅ 신청된 품목·프로젝트·수량이 대조 명세서와 일치합니다'
                    : '⚠️ 교차 검증 확인 필요 항목이 있습니다 (수기 매칭 가능)'}
                </h3>
                <p
                  className={`text-xs font-bold mt-1 ${
                    allMatched ? 'text-emerald-700/80' : 'text-amber-800/80'
                  }`}
                >
                  신청 {dbItems.length}건 기준 · 명세표 {groupSummaries.length}개 품목 그룹과 대조한 결과입니다.
                  {allMatched
                    ? ''
                    : ' 오타나 누락된 건은 우측 작업 열에서 수기 연결 또는 일치 승인이 가능합니다.'}
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

            {/* 명세표 기준 집계 — 일치 생략, 불일치·확인불가는 접힘 후 펼쳐 보기 */}
            {(() => {
              const matchedGroups = groupSummaries.filter(
                (g) => g.matchedDbCount > 0 && g.isAllItemMatched && g.isQtyMatched
              );
              const mismatchGroups = groupSummaries.filter(
                (g) => g.matchedDbCount > 0 && !(g.isAllItemMatched && g.isQtyMatched)
              );
              const unverifiableGroups = groupSummaries.filter((g) => g.matchedDbCount <= 0);
              const issueGroups = [...mismatchGroups, ...unverifiableGroups].sort(
                (a, b) => b.matchedDbCount - a.matchedDbCount
              );
              const issueCount = issueGroups.length;

              return (
            <div className="space-y-2">
              <h4 className="text-xs font-black text-slate-700 flex items-center justify-between gap-2">
                <span>
                  📊 명세표 품목 그룹별 청구 집계
                  {` (일치 ${matchedGroups.length}건 / 불일치 ${mismatchGroups.length}건 / 확인불가 ${unverifiableGroups.length}건)`}
                </span>
                <span className="text-[10px] text-indigo-600 font-bold shrink-0">
                  * 명세서 기준 · 일치 항목은 생략
                </span>
              </h4>

              {issueCount === 0 ? (
                <div className="py-4 text-center text-xs font-bold text-emerald-700 bg-emerald-50/60 border border-emerald-100 rounded-2xl">
                  명세표 기준 일치 {matchedGroups.length}건 · 불일치 0건 · 확인불가 0건.
                  목록을 생략했습니다.
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                  <button
                    type="button"
                    onClick={() => setStatementIssuesExpanded((v) => !v)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-black text-slate-800">
                        불일치·확인불가 건 확인하기
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 shrink-0">
                        {mismatchGroups.length > 0 && `불일치 ${mismatchGroups.length}`}
                        {mismatchGroups.length > 0 && unverifiableGroups.length > 0 && ' · '}
                        {unverifiableGroups.length > 0 && `확인불가 ${unverifiableGroups.length}`}
                      </span>
                    </div>
                    <span
                      className={`text-slate-500 text-sm font-black shrink-0 transition-transform ${
                        statementIssuesExpanded ? 'rotate-180' : ''
                      }`}
                      aria-hidden
                    >
                      ▼
                    </span>
                  </button>

                  {statementIssuesExpanded && (
                    <div className="border-t border-slate-100 p-3 max-h-56 overflow-y-auto bg-slate-50/40">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {issueGroups.map((g) => {
                          const srcRow = statementRows.find((r) => r.rawIndex === g.rowIndex);
                          const projectHint =
                            (srcRow?.extractedProjects && srcRow.extractedProjects[0]) || '';
                          const cardTitle = srcRow
                            ? formatStatementRowLabel(srcRow, rules.certTypeKeywords, {
                                preferMasterCert: categoryKey === 'JEBON' || categoryKey === 'SIGN',
                                category: categoryKey,
                              }).replace(/\s*\(₩[^)]+\)\s*$/, '')
                            : g.categoryTitle;
                          const isUnverifiable = g.matchedDbCount <= 0;
                          return (
                            <div
                              key={g.rowIndex}
                              className={`p-2.5 rounded-xl border text-xs font-bold ${
                                isUnverifiable
                                  ? 'bg-white border-slate-200'
                                  : 'bg-amber-50/70 border-amber-300'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <span className="font-black text-slate-900 truncate" title={cardTitle}>
                                  {cardTitle}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-black shrink-0 ${
                                    isUnverifiable
                                      ? 'bg-slate-200 text-slate-700'
                                      : 'bg-rose-100 text-rose-700'
                                  }`}
                                >
                                  {isUnverifiable
                                    ? '확인불가'
                                    : !g.isQtyMatched
                                      ? '수량 불일치'
                                      : '불일치'}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-600 space-y-0.5 font-bold">
                                {projectHint && (
                                  <p className="truncate text-slate-500" title={projectHint}>
                                    프로젝트: {projectHint}
                                  </p>
                                )}
                                <p className="font-mono">
                                  명세 {g.docQty}
                                  {isJebonCategory ? '부' : '개'}
                                  {' / '}
                                  신청매칭{' '}
                                  <span className={g.isQtyMatched ? 'text-emerald-600' : 'text-rose-600'}>
                                    {g.matchedDbQty}
                                    {isJebonCategory ? '부' : '개'}
                                  </span>
                                  <span className="text-slate-400"> · </span>
                                  ₩{g.docSupplyPrice.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
              );
            })()}

            {/* 건별 상세 매칭 테이블 — DB신청 / 명세서 / 검수결과 */}
            <div>
              <h4 className="text-xs font-black text-slate-700 mb-2 flex items-center justify-between">
                <span>📋 신청 건별 교차 대조 상세 ({itemMatches.length}건)</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  * 검수 완료 저장 시, 각 건의 확정 단가로 시스템에 자동 반영됩니다.
                </span>
              </h4>

              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-inner max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-10 text-[10px]">
                    <tr className="bg-slate-200/90 text-slate-700 font-black">
                      <th colSpan={7} className="p-1.5 pl-3 text-center border-b border-r border-slate-300">
                        DB 신청정보
                      </th>
                      <th colSpan={2} className="p-1.5 text-center border-b border-r border-slate-300">
                        명세서정보
                      </th>
                      <th colSpan={2} className="p-1.5 text-center border-b border-slate-300">
                        검수결과
                      </th>
                    </tr>
                    <tr className="bg-slate-100 text-slate-600 font-black">
                      <th className="p-2.5 pl-3 w-10 text-center">NO</th>
                      <th className="p-2.5 w-24">관리번호</th>
                      <th className="p-2.5 w-16">대상자</th>
                      <th className="p-2.5 w-24">
                        {categoryKey === 'OFFICE_SUPPLIES'
                          ? '부서'
                          : categoryKey === 'PRINT'
                            ? '제작품목'
                            : '인증종류'}
                      </th>
                      <th className="p-2.5 min-w-[180px]">
                        {categoryKey === 'OFFICE_SUPPLIES'
                          ? '제품명(견적)'
                          : categoryKey === 'PRINT'
                            ? '관리용 제목'
                            : '프로젝트명'}
                      </th>
                      <th className="p-2.5 w-20 text-center">
                        {categoryKey === 'JEBON'
                          ? '품목/판형'
                          : categoryKey === 'OFFICE_SUPPLIES'
                            ? '코드'
                            : categoryKey === 'PRINT'
                              ? '규격'
                              : '품목/재질'}
                      </th>
                      <th className="p-2.5 w-14 text-center border-r border-slate-200">수량</th>
                      <th className="p-2.5 min-w-[140px]">명세표 매칭 품목</th>
                      <th className="p-2.5 w-28 text-right border-r border-slate-200">{priceColumnLabel}</th>
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
                          <td className="p-2.5 text-slate-700 truncate max-w-[110px]" title={isOfficeCategory ? item.deptName : item.certType || item.plateLabel}>
                            {isOfficeCategory
                              ? item.deptName || '-'
                              : isPrintLikeCategory
                                ? item.plateLabel || '-'
                                : item.certType || '-'}
                          </td>
                          <td className="p-2.5">
                            {isOfficeCategory ? (
                              <>
                                <span
                                  className="text-slate-900 font-black text-[11px] line-clamp-2"
                                  title={item.plateLabel}
                                >
                                  {item.plateLabel || '-'}
                                </span>
                                {item.docProjectName && (
                                  <p className="text-[10px] text-indigo-600 font-normal">
                                    명세탭: {item.docProjectName}
                                  </p>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-slate-900 font-black">{item.projectName}</span>
                                {item.docProjectName && item.docProjectName !== item.projectName && (
                                  <p className="text-[10px] text-indigo-600 font-normal">
                                    명세서: {item.docProjectName}
                                  </p>
                                )}
                              </>
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              {isOfficeCategory ? (
                                <span
                                  className="text-[10px] font-mono text-slate-600 truncate max-w-[88px]"
                                  title={item.certType || item.plateSize || ''}
                                >
                                  {item.certType || item.plateSize || '-'}
                                </span>
                              ) : (
                                <>
                                  {categoryKey === 'SIGN' && (
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                        item.isJumul
                                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                          : 'bg-slate-100 text-slate-600'
                                      }`}
                                    >
                                      {item.isJumul ? '주물' : '일반'}
                                    </span>
                                  )}
                                  {categoryKey === 'JEBON' && item.plateLabel && (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-200"
                                      title="신청서 판형"
                                    >
                                      {item.plateLabel}
                                    </span>
                                  )}
                                  {categoryKey === 'SIGN' && item.plateLabel && (
                                    <span className="text-[9px] text-slate-600 font-bold truncate max-w-[80px]" title={`신청 품목: ${item.plateLabel}`}>
                                      {item.plateLabel}
                                    </span>
                                  )}
                                  {(categoryKey === 'JEBON' || categoryKey === 'PRINT') &&
                                    item.plateSize &&
                                    item.plateSize !== item.plateLabel && (
                                    <span className="text-[9px] text-slate-500 font-bold truncate max-w-[80px]" title={`신청 규격: ${item.plateSize}`}>
                                      {item.plateSize}
                                    </span>
                                  )}
                                  {categoryKey === 'PRINT' && !item.plateSize && (
                                    <span className="text-[9px] text-slate-400 font-bold">-</span>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="p-2.5 text-center font-mono text-slate-700 border-r border-slate-100">
                            {item.quantity || 1}
                            {isJebonCategory ? '부' : '개'}
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
                              {statementRows
                                .filter(
                                  (r) =>
                                    !isExcludedStatementItem(
                                      r.categoryTitle,
                                      categoryKey || 'SIGN'
                                    )
                                )
                                .map((r) => (
                                <option key={r.rawIndex} value={r.rawIndex}>
                                  {formatStatementRowLabel(r, rules.certTypeKeywords, {
                                    preferMasterCert: categoryKey === 'JEBON' || categoryKey === 'SIGN',
                                    category: categoryKey,
                                  })}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2.5 text-right font-mono font-black border-r border-slate-100">
                            {editingPriceItemId === item.id ? (
                              <div className="flex items-center gap-1 justify-end">
                                <input
                                  type="text"
                                  value={priceInputDraft}
                                  onChange={(e) => setPriceInputDraft(e.target.value)}
                                  className="w-20 border rounded px-1 py-0.5 text-right font-mono text-[10px]"
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
                                className={`hover:underline font-mono ${
                                  item.adminPriceSet
                                    ? 'text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200'
                                    : 'text-slate-900'
                                }`}
                                title={
                                  item.adminPriceSet
                                    ? `관리자 수기 ${priceColumnLabel}`
                                    : `클릭하여 ${priceColumnLabel} 직접 수정`
                                }
                              >
                                {item.docUnitPrice ? `₩${item.docUnitPrice.toLocaleString()}` : '-'}
                                {item.adminPriceSet && (
                                  <span className="ml-1 text-[9px] font-black text-violet-500">관리</span>
                                )}
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
                              {item.adminOverride && (
                                <span className="text-[9px] text-violet-600 font-bold leading-tight">관리자 승인</span>
                              )}
                              {!isMatched && (
                                <span className="text-[9px] text-rose-500 font-normal leading-tight" title={item.resultNote}>
                                  {!item.nameMatch
                                    ? '프로젝트명 상이'
                                    : !item.certMatch
                                      ? '인증 상이'
                                      : !item.materialMatch
                                        ? categoryKey === 'JEBON'
                                          ? '판형 상이'
                                          : '재질 상이'
                                        : '확인 필요'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2.5 text-center whitespace-nowrap">
                            {item.adminOverride ? (
                              <button
                                type="button"
                                onClick={() => handleAdminCancelMatch(item.id)}
                                className="px-2 py-0.5 bg-slate-50 text-slate-600 border border-slate-300 hover:bg-slate-100 rounded text-[10px] font-black shadow-sm"
                              >
                                관리자 승인 취소
                              </button>
                            ) : !isMatched ? (
                              <button
                                type="button"
                                onClick={() => openAdminApproveDialog(item)}
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
            검수 완료 시 각 건의 {isJebonCategory ? '최종금액' : '확정 단가'}(`finalPrice`)가 저장되고 정산 상태가 완료로 갱신됩니다.
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
                {itemMatches.some((m) => !(m.matchStatus === 'match' || m.adminOverride))
                  ? '검수 중간 저장 (불일치 유지)'
                  : '검수 결과 저장 및 정산 확정'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 관리자 일치 승인 확인 */}
      {approveDialog && (
        <div className="fixed inset-0 z-[145] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-black text-slate-900">관리자 일치 승인</h3>
            <p className="text-sm font-bold text-slate-700 leading-relaxed">
              관리자 권한으로 일치 승인 처리하시겠습니까?
            </p>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-slate-500">{priceInputLabel}</label>
              <input
                type="text"
                inputMode="numeric"
                value={approveDialog.priceDraft}
                onChange={(e) =>
                  setApproveDialog((prev) =>
                    prev ? { ...prev, priceDraft: e.target.value } : prev
                  )
                }
                className="w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 text-sm font-black text-violet-900 font-mono outline-none focus:border-violet-500"
                placeholder="0"
                autoFocus
              />
              <p className="text-[10px] text-slate-400 font-bold">
                {isJebonCategory
                  ? '제본은 부수가 반영된 최종 청구금액을 입력합니다.'
                  : '현판/명판은 개당 확정 단가를 입력합니다.'}
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setApproveDialog(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmAdminApproveMatch}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 shadow-sm"
              >
                승인 확정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚙ 명세표 매칭 규칙 및 키워드 설정 모달 (3개 탭 구성) */}
      {isRulesModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-4xl rounded-3xl bg-white p-7 shadow-2xl border border-slate-200 space-y-5 max-h-[90vh] flex flex-col">
            {/* 팝업 헤더 */}
            <div className="border-b border-slate-100 pb-3 flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <span>⚙ 명세표 매칭 규칙 및 키워드 설정</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-100 text-indigo-700">
                    {categoryName || '현판/명판/상패'}
                  </span>
                </h3>
                <p className="mt-1 text-xs text-slate-500 font-bold leading-relaxed">
                  [{categoryName || '현판/명판/상패'}] 거래명세표(PDF/Excel)의 칼럼 제목행 인식 키워드와 인증/현판별 매칭 문구를 정밀하게 설정합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRulesModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-black flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {/* 3개 탭 전환 버튼 */}
            <div className="flex border-b border-slate-200 gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setRulesActiveTab('headers')}
                className={`px-4 py-2.5 text-xs font-black border-b-2 transition-all flex items-center gap-1.5 ${
                  rulesActiveTab === 'headers'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>📋 제목행(칼럼) 검색 키워드</span>
              </button>
              {(categoryKey === 'SIGN' || categoryKey === 'JEBON') && (
                <button
                  type="button"
                  onClick={() => setRulesActiveTab('certs')}
                  className={`px-4 py-2.5 text-xs font-black border-b-2 transition-all flex items-center gap-1.5 ${
                    rulesActiveTab === 'certs'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>🏷️ "인증종류" 매칭 문구 설정</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-indigo-50 text-[10px] text-indigo-700 font-mono">
                    {Object.keys(rulesDraft.certTypeKeywords || {}).length}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setRulesActiveTab('plates')}
                className={`px-4 py-2.5 text-xs font-black border-b-2 transition-all flex items-center gap-1.5 ${
                  rulesActiveTab === 'plates'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>
                  {categoryKey === 'JEBON'
                    ? '📚 "제본 규격/판형" 매칭 문구 설정'
                    : categoryKey === 'PRINT'
                    ? '📜 "제작 품목" 매칭 문구 설정'
                    : categoryKey === 'OFFICE_SUPPLIES'
                    ? '📎 "문구 품목" 매칭 문구 설정'
                    : '📊 "현판품목" 매칭 문구 설정'}
                </span>
                <span className="px-1.5 py-0.2 rounded-full bg-indigo-50 text-[10px] text-indigo-700 font-mono">
                  {Object.keys(rulesDraft.plateItemKeywords || {}).length}
                </span>
              </button>
            </div>

            {/* 탭 내용 영역 */}
            <div className="overflow-y-auto flex-1 pr-1.5 space-y-4">
              {/* [탭 1] 제목행(칼럼) 검색 키워드 */}
              {rulesActiveTab === 'headers' && (
                <div className="space-y-3.5">
                  <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs font-bold text-indigo-900 leading-relaxed">
                    💡 외주 거래명세표 문서의 테이블 제목행(헤더)을 인식할 때 사용하는 키워드입니다. 쉼표(,)로 구분하여 등록하세요.
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {/* 1. 인증종류 제목행 키워드 */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black text-slate-800">
                          1) {categoryKey === 'SIGN' || categoryKey === 'JEBON' ? '"인증종류"' : '"품목/분류"'} 제목행 칼럼명칭 키워드
                        </label>
                        <span className="text-[10px] text-indigo-600 font-bold">인증/분류 열 감지</span>
                      </div>
                      <input
                        type="text"
                        value={rulesDraft.columnHeaders.certType}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRulesDraft((p) => ({
                            ...p,
                            columnHeaders: { ...p.columnHeaders, certType: val },
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                        placeholder={`예: ${defaultHeaderHint('certType')}`}
                      />
                      <p className="text-[10px] text-slate-400">기본값: {defaultHeaderHint('certType')}</p>
                    </div>

                    {/* 2. 품목/판형 제목행 키워드 */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black text-slate-800">
                          2) {categoryKey === 'JEBON' ? '"제본판형/품목"' : categoryKey === 'PRINT' ? '"제작품목"' : categoryKey === 'OFFICE_SUPPLIES' ? '"문구품목"' : '"현판품목"'} 제목행 칼럼명칭 키워드
                        </label>
                        <span className="text-[10px] text-indigo-600 font-bold">품목/규격 열 감지</span>
                      </div>
                      <input
                        type="text"
                        value={rulesDraft.columnHeaders.plateItem}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRulesDraft((p) => ({
                            ...p,
                            columnHeaders: { ...p.columnHeaders, plateItem: val },
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                        placeholder={`예: ${defaultHeaderHint('plateItem')}`}
                      />
                      <p className="text-[10px] text-slate-400">기본값: {defaultHeaderHint('plateItem')}</p>
                    </div>

                    {/* 3. 규격 제목행 키워드 */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black text-slate-800">
                          3) "규격" 제목행 칼럼명칭 키워드
                        </label>
                        <span className="text-[10px] text-indigo-600 font-bold">사이즈 열 감지</span>
                      </div>
                      <input
                        type="text"
                        value={rulesDraft.columnHeaders.spec}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRulesDraft((p) => ({
                            ...p,
                            columnHeaders: { ...p.columnHeaders, spec: val },
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                        placeholder={`예: ${defaultHeaderHint('spec')}`}
                      />
                      <p className="text-[10px] text-slate-400">기본값: {defaultHeaderHint('spec')}</p>
                    </div>

                    {/* 4. 프로젝트명 제목행 키워드 */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black text-slate-800">
                          4) "프로젝트명" 제목행 칼럼명칭 키워드
                        </label>
                        <span className="text-[10px] text-indigo-600 font-bold">건물/내역 열 감지</span>
                      </div>
                      <input
                        type="text"
                        value={rulesDraft.columnHeaders.projectName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRulesDraft((p) => ({
                            ...p,
                            columnHeaders: { ...p.columnHeaders, projectName: val },
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                        placeholder={`예: ${defaultHeaderHint('projectName')}`}
                      />
                      <p className="text-[10px] text-slate-400">기본값: {defaultHeaderHint('projectName')}</p>
                    </div>

                    {/* 5. 수량 제목행 키워드 */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black text-slate-800">
                          5) "수량" 제목행 칼럼명칭 키워드
                        </label>
                        <span className="text-[10px] text-indigo-600 font-bold">수량 열 감지</span>
                      </div>
                      <input
                        type="text"
                        value={rulesDraft.columnHeaders.quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRulesDraft((p) => ({
                            ...p,
                            columnHeaders: { ...p.columnHeaders, quantity: val },
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                        placeholder={`예: ${defaultHeaderHint('quantity')}`}
                      />
                      <p className="text-[10px] text-slate-400">기본값: {defaultHeaderHint('quantity')}</p>
                    </div>

                    {/* 6. 조직(소속) 제목행 키워드 */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black text-slate-800">
                          6) "조직(소속)" 제목행 칼럼명칭 키워드
                        </label>
                        <span className="text-[10px] text-indigo-600 font-bold">소속/센터/비고 열 감지</span>
                      </div>
                      <input
                        type="text"
                        value={rulesDraft.columnHeaders.dept}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRulesDraft((p) => ({
                            ...p,
                            columnHeaders: { ...p.columnHeaders, dept: val },
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                        placeholder={`예: ${defaultHeaderHint('dept')}`}
                      />
                      <p className="text-[10px] text-slate-400">기본값: {defaultHeaderHint('dept')}</p>
                    </div>

                    {/* 7. 단가 제목행 키워드 */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black text-slate-800">
                          7) "단가" 제목행 칼럼명칭 키워드
                        </label>
                        <span className="text-[10px] text-indigo-600 font-bold">단가 열 감지</span>
                      </div>
                      <input
                        type="text"
                        value={rulesDraft.columnHeaders.unitPrice}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRulesDraft((p) => ({
                            ...p,
                            columnHeaders: { ...p.columnHeaders, unitPrice: val },
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                        placeholder={`예: ${defaultHeaderHint('unitPrice')}`}
                      />
                      <p className="text-[10px] text-slate-400">기본값: {defaultHeaderHint('unitPrice')}</p>
                    </div>

                    {/* 8. 공급가액 제목행 키워드 */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black text-slate-800">
                          8) "공급가액" 제목행 칼럼명칭 키워드
                        </label>
                        <span className="text-[10px] text-indigo-600 font-bold">금액 열 감지</span>
                      </div>
                      <input
                        type="text"
                        value={rulesDraft.columnHeaders.supplyPrice}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRulesDraft((p) => ({
                            ...p,
                            columnHeaders: { ...p.columnHeaders, supplyPrice: val },
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white"
                        placeholder={`예: ${defaultHeaderHint('supplyPrice')}`}
                      />
                      <p className="text-[10px] text-slate-400">기본값: {defaultHeaderHint('supplyPrice')}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* [탭 2] "인증종류" 매칭 문구 설정 */}
              {rulesActiveTab === 'certs' && (
                <div className="space-y-4">
                  <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs font-bold text-indigo-900 leading-relaxed">
                    💡 신청서(apply/request)의{' '}
                    {categoryKey === 'JEBON' ? '인증별 제본 서식 기준 설정' : '인증별 현판 서식 기준 설정'}에
                    등록된 인증 목록·순서를 자동으로 따라옵니다. 신규 등록 시 아래에 자동 추가됩니다.
                  </div>

                  {/* 등록된 인증종류별 키워드 리스트 (마스터 순서) */}
                  <div className="space-y-2.5">
                    {Object.keys(rulesDraft.certTypeKeywords || {}).map((certKey) => (
                      <div
                        key={certKey}
                        className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-indigo-200 transition-colors space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                            {certKey}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setRulesDraft((p) => ({
                                ...p,
                                certTypeKeywords: {
                                  ...p.certTypeKeywords,
                                  [certKey]: '',
                                },
                              }));
                            }}
                            className="text-[11px] font-bold text-slate-400 hover:text-slate-600 px-2 py-0.5"
                            title="매칭 문구만 비웁니다 (목록은 마스터에 남아 유지)"
                          >
                            문구 비우기
                          </button>
                        </div>
                        <input
                          type="text"
                          value={rulesDraft.certTypeKeywords[certKey] ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRulesDraft((p) => ({
                              ...p,
                              certTypeKeywords: {
                                ...p.certTypeKeywords,
                                [certKey]: val,
                              },
                            }));
                          }}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-slate-50/50"
                          placeholder="명세서에서 인식할 축약어 키워드를 콤마로 입력 (예: 녹색건축, 녹색)"
                        />
                      </div>
                    ))}
                    {Object.keys(rulesDraft.certTypeKeywords || {}).length === 0 && (
                      <p className="text-xs text-slate-400 font-bold text-center py-6">
                        신청 서식에 등록된 인증이 없습니다.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* [탭 3] 품목/판형 매칭 문구 설정 */}
              {rulesActiveTab === 'plates' && (
                <div className="space-y-4">
                  <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs font-bold text-indigo-900 leading-relaxed">
                    💡{' '}
                    {categoryKey === 'JEBON'
                      ? '신청서(apply/request) 인증별 제본 서식의 제본 판형 마스터 등록 목록·순서를 자동으로 따라옵니다. 신규 등록 시 아래에 자동 추가됩니다.'
                      : categoryKey === 'PRINT'
                      ? '신청서 기타 제작물 품목 마스터 등록 목록·순서를 자동으로 따라옵니다. 신규 등록 시 아래에 자동 추가됩니다.'
                      : categoryKey === 'OFFICE_SUPPLIES'
                      ? '드림디포형 축약 품명 기본값 + 선택 묶음의 견적 품명이 목록에 잡힙니다. 자주 쓰는 축약어를 콤마로 보강하면 매칭이 더 잘 됩니다. (규칙만 보지 않고 부분 단어·단가도 함께 대조합니다)'
                      : '신청서(apply/request) 현판 품목 마스터 등록 목록·순서를 자동으로 따라옵니다. 신규 등록 시 아래에 자동 추가됩니다.'}
                  </div>

                  {/* 등록된 품목/판형별 키워드 리스트 (마스터 순서) */}
                  <div className="space-y-2.5">
                    {Object.keys(rulesDraft.plateItemKeywords || {}).map((plateKey) => {
                      const masterInfo = plateMasterList.find((p) => p.label === plateKey);
                      return (
                        <div
                          key={plateKey}
                          className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-indigo-200 transition-colors space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                                {plateKey}
                              </span>
                              {masterInfo && (
                                <span className="text-[10px] text-slate-400 font-bold">
                                  ({masterInfo.size || '규격 없음'}
                                  {masterInfo.price > 0
                                    ? ` · ₩${masterInfo.price.toLocaleString()}원`
                                    : ''}
                                  )
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setRulesDraft((p) => ({
                                  ...p,
                                  plateItemKeywords: {
                                    ...p.plateItemKeywords,
                                    [plateKey]: '',
                                  },
                                }));
                              }}
                              className="text-[11px] font-bold text-slate-400 hover:text-slate-600 px-2 py-0.5"
                              title="매칭 문구만 비웁니다 (목록은 마스터에 남아 유지)"
                            >
                              문구 비우기
                            </button>
                          </div>
                          <input
                            type="text"
                            value={rulesDraft.plateItemKeywords[plateKey] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRulesDraft((p) => ({
                                ...p,
                                plateItemKeywords: {
                                  ...p.plateItemKeywords,
                                  [plateKey]: val,
                                },
                              }));
                            }}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 bg-slate-50/50"
                            placeholder={
                              categoryKey === 'JEBON'
                                ? '명세서에서 인식할 판형/규격 키워드를 콤마로 입력 (예: A4, 국배판)'
                                : categoryKey === 'PRINT'
                                ? '명세서에서 인식할 제작 품목 키워드를 콤마로 입력 (예: 현수막, 배너)'
                                : categoryKey === 'OFFICE_SUPPLIES'
                                ? '명세서에서 인식할 문구 품목 키워드를 콤마로 입력 (예: 복사용지, 펜)'
                                : '명세서에서 인식할 품목/재질 키워드를 콤마로 입력 (예: 주물현판, 주물, 동주물)'
                            }
                          />
                        </div>
                      );
                    })}
                    {Object.keys(rulesDraft.plateItemKeywords || {}).length === 0 && (
                      <p className="text-xs text-slate-400 font-bold text-center py-6">
                        신청 서식에 등록된 품목/판형이 없습니다.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 팝업 하단 버튼 바 */}
            <div className="flex justify-between items-center pt-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (!canEdit) return alert('편집 권한이 필요합니다.');
                  if (confirm('모든 설정값을 시스템 기본값으로 되돌리시겠습니까?')) {
                    const currentCat = categoryKey || 'SIGN';
                    const defaults = getDefaultRulesForCategory(currentCat);
                    const isOffice = currentCat === 'OFFICE_SUPPLIES';
                    const certLabels = certMasterList.map((c) => c.label);
                    let itemLabels: string[] = [];
                    if (isOffice) {
                      const quoteNames = officeDbItems.flatMap((di) =>
                        parseOfficeSuppliesQuoteText(String(di.quoteRawText || '')).map(
                          (l) => l.productName
                        )
                      );
                      itemLabels = buildOfficeKeywordMasterLabels(
                        quoteNames,
                        defaults.plateItemKeywords
                      );
                      setPlateMasterList(
                        itemLabels.map((label) => ({
                          id: label,
                          code: '',
                          label,
                          size: '',
                          price: 0,
                        }))
                      );
                    } else {
                      const seenItem = new Set<string>();
                      for (const p of plateMasterList) {
                        const label = String(p.label || '').trim();
                        if (!label || seenItem.has(label)) continue;
                        seenItem.add(label);
                        itemLabels.push(label);
                      }
                    }
                    let reset = defaults;
                    if (currentCat === 'SIGN' || currentCat === 'JEBON') {
                      reset = {
                        ...reset,
                        certTypeKeywords: syncAliasMapToMasterLabels(
                          certLabels,
                          defaults.certTypeKeywords,
                          defaults.certTypeKeywords
                        ),
                      };
                    }
                    if (itemLabels.length > 0) {
                      reset = {
                        ...reset,
                        plateItemKeywords: syncAliasMapToMasterLabels(
                          itemLabels,
                          defaults.plateItemKeywords,
                          defaults.plateItemKeywords
                        ),
                      };
                    }
                    setRulesDraft(rulesToDraftForm(reset));
                  }
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-black text-slate-600 hover:bg-slate-100 transition-colors"
              >
                🔄 기본값으로 초기화(Edit)
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingRules}
                  onClick={() => setIsRulesModalOpen(false)}
                  className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={savingRules || !canEdit}
                  onClick={handleSaveRulesSubmit}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white hover:bg-indigo-700 shadow-md transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingRules ? '저장 중...' : '💾 설정 저장(Edit)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
