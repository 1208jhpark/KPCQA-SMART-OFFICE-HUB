import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { parseKSTDateOnly } from '@/utils/dateUtils';
import {
  addMonthsToCalibYmd,
  getLatestCalibBaseYmd,
  pickLatestCalibHistory,
} from '@/utils/equipmentCalib';
import {
  authorizeEquipmentApi,
  assertCanEditEquipmentDepartment,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import {
  buildArchiveEtcMemo,
  parseEquipmentArchiveMemo,
  unwrapEquipmentEtcMemo,
} from '@/utils/equipmentMemo';

export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB (사진·PDF 실용 한도, DB base64 고려)
const MAX_FILE_DATA_URL_CHARS = Math.ceil(MAX_FILE_BYTES * (4 / 3)) + 128;
const MAX_FILE_LABEL = '5MB';

const EQUIPMENT_FILE_FIELDS = [
  'thumbnail_url',
  'manual_url',
  'cert_url',
  'etc_url',
] as const;

const HISTORY_FILE_FIELDS = [
  'estimate_url',
  'cert_file_url',
  'receipt_url',
] as const;

const MAINTENANCE_FILE_FIELDS = ['receipt_url'] as const;

const EQUIPMENT_UPDATE_WHITELIST = [
  'category',
  'name',
  'model_name',
  'serial_no',
  'brand',
  'asset_no',
  'purpose',
  'spec_summary',
  'full_spec',
  'thumbnail_url',
  'gallery_urls',
  'department',
  'qty',
  'purchase_date',
  'replace_cycle_mo',
  'last_replace_date',
  'next_replace_date',
  'calib_cycle_mo',
  'next_calib_date',
  'calib_memo',
  'status',
  'manual_url',
  'cert_url',
  'etc_url',
  'etc_memo',
] as const;

function parseOptionalDate(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw === 'string') {
    const ymd = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (ymd) {
      const d = parseKSTDateOnly(ymd[1]);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  const d = new Date(raw as string | number | Date);
  return Number.isNaN(d.getTime()) ? null : d;
}

function assertFileFieldWithinLimit(field: string, value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value);
  if (s.length <= MAX_FILE_DATA_URL_CHARS) return null;
  return `${field} 파일이 너무 큽니다. (최대 ${MAX_FILE_LABEL})`;
}

/** Prisma/런타임 오류 → 사용자용 한글 메시지 */
function equipmentErrorMessage(error: any, fallback: string): string {
  const code = String(error?.code || '');
  const meta = error?.meta || {};
  const target = meta.target ?? meta.constraint ?? meta.field_name;
  const haystack = [
    ...(Array.isArray(target) ? target.map(String) : target != null ? [String(target)] : []),
    String(meta.modelName || ''),
    String(error?.message || ''),
  ]
    .join(' ')
    .toLowerCase();

  if (code === 'P2002') {
    // Equipment unique 비즈니스 키는 asset_no만 (id cuid 제외).
    // 드라이버에 따라 meta.target이 비거나 제약명(Equipment_asset_no_key)만 올 수 있음.
    if (
      !haystack.trim() ||
      haystack.includes('asset_no') ||
      haystack.includes('equipment')
    ) {
      return '이미 등록된 자산번호입니다. 다른 자산번호를 입력해 주세요.';
    }
    return '이미 등록된 데이터와 중복됩니다.';
  }
  if (code === 'P2025') {
    return '대상 장비를 찾을 수 없습니다.';
  }
  if (code === 'P2003') {
    return '연결된 데이터가 없어 처리할 수 없습니다.';
  }

  const raw = String(error?.message || '').trim();
  // Prisma validation / 날짜 등
  if (/Invalid.*(Date|value|argument)/i.test(raw)) {
    return '입력값이 올바르지 않습니다. 날짜·숫자 형식을 확인해 주세요.';
  }
  if (raw && raw.length < 200 && !raw.includes('\n') && !/prisma|invocation|database/i.test(raw)) {
    return raw;
  }
  return fallback;
}

async function findDuplicateAssetNo(assetNo: string, excludeId?: string) {
  const no = String(assetNo || '').trim();
  if (!no) return null;
  const existing = await prisma.equipment.findUnique({
    where: { asset_no: no },
    select: { id: true, asset_no: true, name: true, status: true, category: true },
  });
  if (!existing) return null;
  if (excludeId && existing.id === excludeId) return null;
  return existing;
}

function stripFilePayload(raw: string | null | undefined) {
  if (!raw) return raw ?? null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return JSON.stringify({
        name: parsed.name || '',
        hasData: !!parsed.data,
      });
    }
  } catch {
    /* plain URL or legacy string — leave as-is if short */
    if (raw.length > 500) return null;
  }
  return raw;
}

/** 목록용: 원본(data) 제거, thumb만 data로 노출 (FE 기존 파서 호환) */
function slimThumbnail(raw: string | null | undefined) {
  if (!raw) return raw ?? null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.thumb) {
        return JSON.stringify({
          name: parsed.name || '',
          data: parsed.thumb,
          hasFull: !!parsed.data,
        });
      }
      // 레거시(축소본 없음): 목록에서도 보이도록 data 유지 — 재업로드 시 thumb로 전환
      if (parsed.data && typeof parsed.data === 'string') {
        return JSON.stringify({
          name: parsed.name || '',
          data: parsed.data,
          legacy: true,
        });
      }
    }
  } catch {
    // plain data URL / http
    if (typeof raw === 'string' && (raw.startsWith('data:') || raw.startsWith('http'))) {
      return raw;
    }
    if (raw.length > 500) return null;
  }
  return null;
}

function slimEquipmentRow(eq: any) {
  const row = { ...eq };
  row.thumbnail_url = slimThumbnail(row.thumbnail_url);
  for (const f of ['manual_url', 'cert_url', 'etc_url'] as const) {
    row[f] = stripFilePayload(row[f]);
  }
  // 목록은 검교정 기준일이 가장 최근인 이력 1건만 (null calib_date가 DESC 맨 앞에 오는 문제 방지)
  if (Array.isArray(row.histories) && row.histories.length > 0) {
    const picked = pickLatestCalibHistory(row.histories);
    if (picked) {
      const latest = { ...picked };
      for (const f of HISTORY_FILE_FIELDS) {
        (latest as any)[f] = stripFilePayload((latest as any)[f]);
      }
      row.histories = [latest];
    } else {
      row.histories = [];
    }
  }
  // 목록에서는 유지보수 이력 제외 (상세 ?id=&full=1 만)
  if ('maintenance_histories' in row) {
    delete row.maintenance_histories;
  }
  return row;
}

function pickEquipmentUpdate(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of EQUIPMENT_UPDATE_WHITELIST) {
    if (!(key in body)) continue;
    const val = body[key];
    if (
      key === 'purchase_date' ||
      key === 'last_replace_date' ||
      key === 'next_replace_date' ||
      key === 'next_calib_date'
    ) {
      const parsed = parseOptionalDate(val);
      if (parsed !== undefined) data[key] = parsed;
      continue;
    }
    if (key === 'qty' || key === 'replace_cycle_mo' || key === 'calib_cycle_mo') {
      data[key] = val == null || val === '' ? null : Number(val);
      continue;
    }
    data[key] = val;
  }
  return data;
}

function pickHistoryCreate(history: Record<string, unknown>, equipmentId: string) {
  const calibDate = parseOptionalDate(history.calib_date);
  if (!calibDate) throw new Error('INVALID_CALIB_DATE');

  const rawResult = String(history.result || '진행중');
  const result =
    rawResult === '합격' ? '적합' : rawResult === '불합격' ? '부적합' : rawResult;

  return {
    equipment_id: equipmentId,
    calib_request_date:
      history.calib_request_date != null ? String(history.calib_request_date) : null,
    calib_date: calibDate,
    agency: String(history.agency || ''),
    content: history.content != null ? String(history.content) : null,
    result,
    cost: history.cost != null ? Number(history.cost) || 0 : 0,
    estimate_url: history.estimate_url != null ? String(history.estimate_url) : null,
    cert_file_url: history.cert_file_url != null ? String(history.cert_file_url) : null,
    receipt_url: history.receipt_url != null ? String(history.receipt_url) : null,
    next_calib_date: parseOptionalDate(history.next_calib_date) ?? null,
    memo: history.memo != null ? String(history.memo) : null,
  };
}

function pickHistoryUpdate(history: Record<string, unknown>) {
  const { equipment_id: _eq, ...rest } = pickHistoryCreate(history, 'unused');
  return rest;
}

function pickMaintenanceCreate(row: Record<string, unknown>, equipmentId: string) {
  const date = parseOptionalDate(row.date);
  if (!date) throw new Error('INVALID_MAINTENANCE_DATE');
  const type = String(row.type || '').trim();
  if (!type) throw new Error('INVALID_MAINTENANCE_TYPE');

  return {
    equipment_id: equipmentId,
    type,
    date,
    vendor: row.vendor != null ? String(row.vendor) : null,
    content: row.content != null ? String(row.content) : null,
    cost: row.cost != null ? Number(row.cost) || 0 : 0,
    receipt_url: row.receipt_url != null ? String(row.receipt_url) : null,
    memo: row.memo != null ? String(row.memo) : null,
  };
}

function pickMaintenanceUpdate(row: Record<string, unknown>) {
  const { equipment_id: _eq, ...rest } = pickMaintenanceCreate(row, 'unused');
  return rest;
}

function actorFromAuth(auth: Awaited<ReturnType<typeof authorizeEquipmentApi>>) {
  return {
    name: auth.user.name || null,
    dept: auth.user.unit?.unit_name || null,
    email: auth.user.email || null,
  };
}

/** 이력 변경 후 장비 next_calib_date 를 (최신이력+주기)로 동기화 */
async function syncEquipmentNextCalibDate(equipmentId: string) {
  const eq = await prisma.equipment.findUnique({
    where: { id: equipmentId },
    include: { histories: true },
  });
  if (!eq) return;
  const ymd = addMonthsToCalibYmd(getLatestCalibBaseYmd(eq.histories), eq.calib_cycle_mo);
  const next = ymd ? parseKSTDateOnly(ymd) : null;
  await prisma.equipment.update({
    where: { id: equipmentId },
    data: {
      next_calib_date: next && !Number.isNaN(next.getTime()) ? next : null,
    },
  });
}

/** 구분이 '구매'인 유지보수 이력 최신 처리일 → Equipment.purchase_date 동기화 */
async function syncEquipmentPurchaseDate(equipmentId: string) {
  const latest = await prisma.maintenanceHistory.findFirst({
    where: { equipment_id: equipmentId, type: '구매' },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  await prisma.equipment.update({
    where: { id: equipmentId },
    data: { purchase_date: latest?.date ?? null },
  });
}

/** 구분 '소모품교체'|'수리' 최신 처리일 → Equipment.last_replace_date 동기화 */
async function syncEquipmentLastReplaceDate(equipmentId: string) {
  const latest = await prisma.maintenanceHistory.findFirst({
    where: {
      equipment_id: equipmentId,
      type: { in: ['소모품교체', '수리'] },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  await prisma.equipment.update({
    where: { id: equipmentId },
    data: { last_replace_date: latest?.date ?? null },
  });
}

async function syncEquipmentFromMaintenance(equipmentId: string) {
  await syncEquipmentPurchaseDate(equipmentId);
  await syncEquipmentLastReplaceDate(equipmentId);
}

function creatorFields(auth: Awaited<ReturnType<typeof authorizeEquipmentApi>>) {
  const a = actorFromAuth(auth);
  return {
    creator_name: a.name,
    creator_dept: a.dept,
    creator_email: a.email,
  };
}

function updaterFields(auth: Awaited<ReturnType<typeof authorizeEquipmentApi>>) {
  const a = actorFromAuth(auth);
  return {
    updated_by_name: a.name,
    updated_by_dept: a.dept,
    updated_by_email: a.email,
  };
}

function archiverFields(auth: Awaited<ReturnType<typeof authorizeEquipmentApi>>, at: Date) {
  const a = actorFromAuth(auth);
  return {
    archived_at: at,
    archived_by_name: a.name,
    archived_by_dept: a.dept,
    archived_by_email: a.email,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const categoryCode = searchParams.get('categoryCode');
  const id = searchParams.get('id');
  const full = searchParams.get('full') === '1';

  try {
    if (id) {
      const equipment = await prisma.equipment.findUnique({
        where: { id },
        include: {
          histories: { orderBy: { calib_date: 'desc' } },
          maintenance_histories: { orderBy: { date: 'desc' } },
        },
      });
      if (!equipment) {
        return NextResponse.json({ error: '장비를 찾을 수 없습니다.' }, { status: 404 });
      }
      try {
        await authorizeEquipmentApi({ categoryCode: equipment.category });
      } catch (e) {
        return authErrorToResponse(e);
      }
      return NextResponse.json(full ? equipment : slimEquipmentRow(equipment));
    }

    try {
      await authorizeEquipmentApi(categoryCode ? { categoryCode } : undefined);
    } catch (e) {
      return authErrorToResponse(e);
    }

    const where: Record<string, unknown> = {};
    if (categoryCode) where.category = categoryCode;

    const equipments = await prisma.equipment.findMany({
      where,
      include: {
        histories: {
          orderBy: { calib_date: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 목록은 파일 payload 제거 (상세는 ?id=&full=1)
    return NextResponse.json(equipments.map(slimEquipmentRow));
  } catch (error) {
    console.error('[equipment GET]', error);
    return NextResponse.json({ error: '데이터 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const category = String(body.category || '기본').trim() || '기본';
    const menuCategory = String(body.menuCategory || '').trim();

    let auth;
    try {
      auth = await authorizeEquipmentApi({ requireEditor: true, categoryCode: category });
    } catch (first) {
      // 현재 화면 범주에서 다른(조회 불가) 범주로 등록하는 이관 허용
      if (menuCategory && menuCategory !== category) {
        try {
          auth = await authorizeEquipmentApi({
            requireEditor: true,
            categoryCode: menuCategory,
          });
        } catch (e) {
          return authErrorToResponse(e);
        }
      } else {
        return authErrorToResponse(first);
      }
    }

    const department = body.department || '';
    assertCanEditEquipmentDepartment(auth, department);

    for (const f of EQUIPMENT_FILE_FIELDS) {
      const err = assertFileFieldWithinLimit(f, body[f]);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    const assetNo = String(body.asset_no || '').trim() || `TMP-${Date.now()}`;
    const dup = await findDuplicateAssetNo(assetNo);
    if (dup) {
      const where =
        dup.status === '정상'
          ? `활성 목록(범주: ${dup.category || '-'})`
          : `폐기/보관함(상태: ${dup.status})`;
      return NextResponse.json(
        {
          error: `이미 등록된 자산번호입니다. (${dup.asset_no} · ${where}) 다른 자산번호를 입력해 주세요.`,
        },
        { status: 409 }
      );
    }

    const newEq = await prisma.equipment.create({
      data: {
        category,
        name: body.name || '',
        brand: body.brand || '',
        model_name: body.model_name || '',
        serial_no: body.serial_no ? String(body.serial_no) : null,
        asset_no: assetNo,
        qty: Number(body.qty) || 1,
        spec_summary: body.spec_summary || '',
        purpose: body.purpose || null,
        full_spec: body.full_spec || null,
        department,
        purchase_date: parseOptionalDate(body.purchase_date) ?? null,
        replace_cycle_mo:
          body.replace_cycle_mo != null && body.replace_cycle_mo !== ''
            ? Number(body.replace_cycle_mo)
            : null,
        last_replace_date: parseOptionalDate(body.last_replace_date) ?? null,
        next_replace_date: parseOptionalDate(body.next_replace_date) ?? null,
        calib_cycle_mo: Number(body.calib_cycle_mo) || 12,
        next_calib_date: parseOptionalDate(body.next_calib_date) ?? null,
        calib_memo: body.calib_memo || '',
        thumbnail_url: body.thumbnail_url || '',
        manual_url: body.manual_url || null,
        cert_url: body.cert_url || null,
        etc_url: body.etc_url || null,
        etc_memo: body.etc_memo || null,
        status: '정상',
        ...creatorFields(auth),
      },
    });
    return NextResponse.json(newEq);
  } catch (error: any) {
    if (error?.message === 'FORBIDDEN_EDIT') return authErrorToResponse(error);
    console.error('장비 등록 실패:', error?.message, error?.code, error?.meta);
    const msg = equipmentErrorMessage(error, '장비 등록 실패');
    const status = error?.code === 'P2002' ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, history, deleteHistoryId } = body;

    if (!id) return NextResponse.json({ error: 'ID 필수' }, { status: 400 });

    const existing = await prisma.equipment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '장비를 찾을 수 없습니다.' }, { status: 404 });
    }

    let auth;
    try {
      auth = await authorizeEquipmentApi({
        requireEditor: true,
        categoryCode: existing.category,
      });
    } catch (e) {
      return authErrorToResponse(e);
    }

    assertCanEditEquipmentDepartment(auth, existing.department);

    // 범주·관리소속 이관은 원본 편집 권한으로 허용. 목적지 권한은 FE 확인 안내.

    // 0. 폐기 처리 (단일 트랜잭션)
    if (body.action === 'archive') {
      const archiveQty = Number(body.qty);
      const reason = String(body.reason || '').trim();
      const archiveStatus = String(body.status || '폐기');
      if (!reason) {
        return NextResponse.json({ error: '폐기 사유는 필수입니다.' }, { status: 400 });
      }
      if (!Number.isFinite(archiveQty) || archiveQty <= 0 || archiveQty > existing.qty) {
        return NextResponse.json({ error: '폐기 수량이 올바르지 않습니다.' }, { status: 400 });
      }
      if (existing.status !== '정상') {
        return NextResponse.json({ error: '이미 폐기/보관된 장비입니다.' }, { status: 400 });
      }

      const remainingQty = existing.qty - archiveQty;
      const today = parseOptionalDate(body.last_replace_date) ?? new Date();
      const archiveMemo = buildArchiveEtcMemo({
        existingMemo: existing.etc_memo,
        reason,
        sourceEquipmentId: existing.id,
        sourceAssetNo: existing.asset_no,
      });

      const archiveActor = archiverFields(auth, today instanceof Date ? today : new Date());

      const result = await prisma.$transaction(async (tx) => {
        if (remainingQty === 0) {
          return tx.equipment.update({
            where: { id },
            data: {
              status: archiveStatus,
              etc_memo: archiveMemo,
              last_replace_date: today,
              ...archiveActor,
            },
          });
        }

        await tx.equipment.update({
          where: { id },
          data: { qty: remainingQty },
        });

        const archived = await tx.equipment.create({
          data: {
            category: existing.category,
            name: existing.name,
            brand: existing.brand,
            model_name: existing.model_name,
            serial_no: existing.serial_no,
            asset_no: `${existing.asset_no}_ARC_${Date.now()}`,
            qty: archiveQty,
            department: existing.department,
            spec_summary: existing.spec_summary,
            purpose: existing.purpose,
            full_spec: existing.full_spec,
            thumbnail_url: existing.thumbnail_url,
            manual_url: existing.manual_url,
            cert_url: existing.cert_url,
            etc_url: existing.etc_url,
            purchase_date: existing.purchase_date,
            replace_cycle_mo: existing.replace_cycle_mo,
            calib_cycle_mo: existing.calib_cycle_mo,
            next_calib_date: existing.next_calib_date,
            calib_memo: existing.calib_memo,
            status: archiveStatus,
            etc_memo: archiveMemo,
            last_replace_date: today,
            creator_name: existing.creator_name,
            creator_dept: existing.creator_dept,
            creator_email: existing.creator_email,
            ...archiveActor,
          },
        });

        // 검교정 이력 스냅샷 복사 (원본 이력은 유지, 조각도 조회 자립)
        const sourceHistories = await tx.calibrationHistory.findMany({
          where: { equipment_id: id },
          orderBy: { calib_date: 'desc' },
        });
        if (sourceHistories.length > 0) {
          await tx.calibrationHistory.createMany({
            data: sourceHistories.map((h) => ({
              equipment_id: archived.id,
              calib_request_date: h.calib_request_date,
              calib_date: h.calib_date,
              agency: h.agency,
              content: h.content,
              result: h.result,
              cost: h.cost,
              estimate_url: h.estimate_url,
              cert_file_url: h.cert_file_url,
              receipt_url: h.receipt_url,
              next_calib_date: h.next_calib_date,
              memo: h.memo,
              creator_name: h.creator_name,
              creator_dept: h.creator_dept,
              creator_email: h.creator_email,
            })),
          });
        }

        const sourceMaint = await tx.maintenanceHistory.findMany({
          where: { equipment_id: id },
          orderBy: { date: 'desc' },
        });
        if (sourceMaint.length > 0) {
          await tx.maintenanceHistory.createMany({
            data: sourceMaint.map((h) => ({
              equipment_id: archived.id,
              type: h.type,
              date: h.date,
              vendor: h.vendor,
              content: h.content,
              cost: h.cost,
              receipt_url: h.receipt_url,
              memo: h.memo,
              creator_name: h.creator_name,
              creator_dept: h.creator_dept,
              creator_email: h.creator_email,
            })),
          });
        }

        return tx.equipment.findUnique({
          where: { id: archived.id },
          include: {
            histories: { orderBy: { calib_date: 'desc' } },
            maintenance_histories: { orderBy: { date: 'desc' } },
          },
        });
      });

      return NextResponse.json(result);
    }

    // 복구: 부분폐기(_ARC_)는 원본 자산번호로 수량 병합 후 조각 삭제 / 전량폐기는 행 복원
    if (
      body.status === '정상' &&
      existing.status !== '정상' &&
      !body.history &&
      !body.maintenance &&
      !body.updateHistoryId &&
      !body.updateMaintenanceId &&
      !body.deleteHistoryId &&
      !body.deleteMaintenanceId &&
      body.action !== 'archive'
    ) {
      const restoreQty = Number(existing.qty) || 0;
      const memoMeta = parseEquipmentArchiveMemo(existing.etc_memo);
      const originalMemo = unwrapEquipmentEtcMemo(existing.etc_memo);
      const sourceEquipmentId = memoMeta.sourceEquipmentId;
      const sourceAssetNo = memoMeta.sourceAssetNo;

      const isPartialFragment = String(existing.asset_no || '').includes('_ARC_');
      const baseAssetNo =
        sourceAssetNo ||
        String(existing.asset_no || '').split('_ARC_')[0] ||
        '';

      if (isPartialFragment && baseAssetNo) {
        const merged = await prisma.$transaction(async (tx) => {
          let original =
            (sourceEquipmentId
              ? await tx.equipment.findUnique({ where: { id: sourceEquipmentId } })
              : null) ||
            (await tx.equipment.findFirst({
              where: {
                asset_no: baseAssetNo,
                status: '정상',
                id: { not: id },
              },
            })) ||
            (await tx.equipment.findFirst({
              where: {
                asset_no: baseAssetNo,
                id: { not: id },
              },
            }));

          // 원본 id로 찾았는데 자산번호가 바뀐 경우 — baseAssetNo 활성 행 재탐색
          if (original && original.id === id) original = null;

          if (original) {
            assertCanEditEquipmentDepartment(auth, original.department);
            const updated = await tx.equipment.update({
              where: { id: original.id },
              data: {
                qty: (Number(original.qty) || 0) + restoreQty,
                status: '정상',
                ...updaterFields(auth),
                ...(original.status !== '정상'
                  ? {
                      etc_memo: unwrapEquipmentEtcMemo(original.etc_memo),
                      archived_at: null,
                      archived_by_name: null,
                      archived_by_dept: null,
                      archived_by_email: null,
                    }
                  : {}),
              },
              include: { histories: { orderBy: { calib_date: 'desc' } } },
            });
            await tx.equipment.delete({ where: { id } });
            return { mode: 'merged' as const, equipment: updated };
          }

          // 원본 없음 → 조각 행을 원본 자산번호로 승격
          const promoted = await tx.equipment.update({
            where: { id },
            data: {
              asset_no: baseAssetNo,
              status: '정상',
              etc_memo: originalMemo,
              archived_at: null,
              archived_by_name: null,
              archived_by_dept: null,
              archived_by_email: null,
              ...updaterFields(auth),
            },
            include: { histories: { orderBy: { calib_date: 'desc' } } },
          });
          return { mode: 'promoted' as const, equipment: promoted };
        });

        return NextResponse.json({
          ...merged.equipment,
          _restoreMode: merged.mode,
          message:
            merged.mode === 'merged'
              ? `원본(${baseAssetNo})에 수량 ${restoreQty}이(가) 복원되었고 폐기 조각은 제거되었습니다.`
              : `원본이 없어 폐기 조각을 자산번호 ${baseAssetNo}로 복원했습니다.`,
        });
      }

      // 전량 폐기 행 복원
      const restored = await prisma.equipment.update({
        where: { id },
        data: {
          status: '정상',
          etc_memo: originalMemo,
          archived_at: null,
          archived_by_name: null,
          archived_by_dept: null,
          archived_by_email: null,
          ...updaterFields(auth),
        },
        include: { histories: { orderBy: { calib_date: 'desc' } } },
      });
      return NextResponse.json({
        ...restored,
        _restoreMode: 'full',
        message: '활성 목록으로 복구되었습니다.',
      });
    }

    // 1. 이력 수정 (동일 id in-place update — 삭제+재생성 대신)
    if (history && body.updateHistoryId) {
      const historyId = String(body.updateHistoryId);
      const hist = await prisma.calibrationHistory.findUnique({ where: { id: historyId } });
      if (!hist || hist.equipment_id !== id) {
        return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
      }
      for (const f of HISTORY_FILE_FIELDS) {
        const err = assertFileFieldWithinLimit(f, history[f]);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
      try {
        const data = pickHistoryUpdate(history);
        if (!data.agency) {
          return NextResponse.json({ error: '교정기관은 필수입니다.' }, { status: 400 });
        }
        const updated = await prisma.calibrationHistory.update({
          where: { id: historyId },
          data,
        });
        await syncEquipmentNextCalibDate(id);
        return NextResponse.json(updated);
      } catch (e: any) {
        if (e?.message === 'INVALID_CALIB_DATE') {
          return NextResponse.json({ error: '검교정일자가 올바르지 않습니다.' }, { status: 400 });
        }
        throw e;
      }
    }

    // 2. 신규 이력 추가
    if (history) {
      for (const f of HISTORY_FILE_FIELDS) {
        const err = assertFileFieldWithinLimit(f, history[f]);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
      try {
        const data = {
          ...pickHistoryCreate(history, id),
          ...creatorFields(auth),
        };
        if (!data.agency) {
          return NextResponse.json({ error: '교정기관은 필수입니다.' }, { status: 400 });
        }
        const newHistory = await prisma.calibrationHistory.create({ data });
        await syncEquipmentNextCalibDate(id);
        return NextResponse.json(newHistory);
      } catch (e: any) {
        if (e?.message === 'INVALID_CALIB_DATE') {
          return NextResponse.json({ error: '검교정일자가 올바르지 않습니다.' }, { status: 400 });
        }
        throw e;
      }
    }

    // 3. 이력 삭제
    if (deleteHistoryId) {
      const hist = await prisma.calibrationHistory.findUnique({
        where: { id: deleteHistoryId },
      });
      if (!hist || hist.equipment_id !== id) {
        return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
      }
      await prisma.calibrationHistory.delete({ where: { id: deleteHistoryId } });
      await syncEquipmentNextCalibDate(id);
      return NextResponse.json({ message: '이력 삭제 완료' });
    }

    const { maintenance, deleteMaintenanceId } = body;

    // 3b. 유지보수 이력 수정
    if (maintenance && body.updateMaintenanceId) {
      const maintenanceId = String(body.updateMaintenanceId);
      const row = await prisma.maintenanceHistory.findUnique({ where: { id: maintenanceId } });
      if (!row || row.equipment_id !== id) {
        return NextResponse.json({ error: '유지보수 이력을 찾을 수 없습니다.' }, { status: 404 });
      }
      for (const f of MAINTENANCE_FILE_FIELDS) {
        const err = assertFileFieldWithinLimit(f, maintenance[f]);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
      try {
        const data = pickMaintenanceUpdate(maintenance);
        const updated = await prisma.maintenanceHistory.update({
          where: { id: maintenanceId },
          data,
        });
        await syncEquipmentFromMaintenance(id);
        return NextResponse.json(updated);
      } catch (e: any) {
        if (e?.message === 'INVALID_MAINTENANCE_DATE') {
          return NextResponse.json({ error: '처리일자가 올바르지 않습니다.' }, { status: 400 });
        }
        if (e?.message === 'INVALID_MAINTENANCE_TYPE') {
          return NextResponse.json({ error: '구분은 필수입니다.' }, { status: 400 });
        }
        throw e;
      }
    }

    // 3c. 유지보수 이력 추가
    if (maintenance) {
      for (const f of MAINTENANCE_FILE_FIELDS) {
        const err = assertFileFieldWithinLimit(f, maintenance[f]);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
      try {
        const data = {
          ...pickMaintenanceCreate(maintenance, id),
          ...creatorFields(auth),
        };
        const created = await prisma.maintenanceHistory.create({ data });
        await syncEquipmentFromMaintenance(id);
        return NextResponse.json(created);
      } catch (e: any) {
        if (e?.message === 'INVALID_MAINTENANCE_DATE') {
          return NextResponse.json({ error: '처리일자가 올바르지 않습니다.' }, { status: 400 });
        }
        if (e?.message === 'INVALID_MAINTENANCE_TYPE') {
          return NextResponse.json({ error: '구분은 필수입니다.' }, { status: 400 });
        }
        throw e;
      }
    }

    // 3d. 유지보수 이력 삭제
    if (deleteMaintenanceId) {
      const row = await prisma.maintenanceHistory.findUnique({
        where: { id: String(deleteMaintenanceId) },
      });
      if (!row || row.equipment_id !== id) {
        return NextResponse.json({ error: '유지보수 이력을 찾을 수 없습니다.' }, { status: 404 });
      }
      await prisma.maintenanceHistory.delete({ where: { id: String(deleteMaintenanceId) } });
      await syncEquipmentFromMaintenance(id);
      return NextResponse.json({ message: '유지보수 이력 삭제 완료' });
    }

    // 4. 일반 장비 정보 수정
    // creator_* 는 POST 시에만 고정 — 수정/백필로 덮어쓰지 않음 (부서 이동 시 당시 소속 유지)
    const updateData: Record<string, unknown> = {
      ...pickEquipmentUpdate(body),
      ...updaterFields(auth),
    };

    // 복구 시 폐기 감사 필드 초기화 + 폐기 JSON 래퍼 제거
    if (updateData.status === '정상' && existing.status !== '정상') {
      updateData.archived_at = null;
      updateData.archived_by_name = null;
      updateData.archived_by_dept = null;
      updateData.archived_by_email = null;
      if (!('etc_memo' in updateData)) {
        updateData.etc_memo = unwrapEquipmentEtcMemo(existing.etc_memo);
      } else {
        updateData.etc_memo = unwrapEquipmentEtcMemo(
          updateData.etc_memo as string | null | undefined
        );
      }
    }

    // DEPT 스코프에서 부서 변경 시도 차단 (TOTAL만 가능 — assert on new dept)
    if ('department' in updateData) {
      assertCanEditEquipmentDepartment(auth, updateData.department as string | null);
    }

    for (const f of EQUIPMENT_FILE_FIELDS) {
      if (f in updateData) {
        const err = assertFileFieldWithinLimit(f, updateData[f]);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
    }

    if ('asset_no' in updateData) {
      const nextNo = String(updateData.asset_no || '').trim();
      if (!nextNo) {
        return NextResponse.json({ error: '자산번호는 비울 수 없습니다.' }, { status: 400 });
      }
      updateData.asset_no = nextNo;
      const dup = await findDuplicateAssetNo(nextNo, id);
      if (dup) {
        const where =
          dup.status === '정상'
            ? `활성 목록(범주: ${dup.category || '-'})`
            : `폐기/보관함(상태: ${dup.status})`;
        return NextResponse.json(
          {
            error: `이미 등록된 자산번호입니다. (${dup.asset_no} · ${where}) 다른 자산번호를 입력해 주세요.`,
          },
          { status: 409 }
        );
      }
    }

    const updatedEq = await prisma.equipment.update({
      where: { id },
      data: updateData,
      include: {
        histories: { orderBy: { calib_date: 'desc' } },
      },
    });

    // 주기 변경 시에도 예정일 재동기화
    if ('calib_cycle_mo' in updateData) {
      await syncEquipmentNextCalibDate(id);
      const refreshed = await prisma.equipment.findUnique({
        where: { id },
        include: { histories: { orderBy: { calib_date: 'desc' } } },
      });
      return NextResponse.json(refreshed ?? updatedEq);
    }

    return NextResponse.json(updatedEq);
  } catch (error: any) {
    if (error?.message === 'FORBIDDEN_EDIT') return authErrorToResponse(error);
    console.error('[equipment PATCH]', error?.message, error?.code, error?.meta);
    const msg = equipmentErrorMessage(error, '업데이트 실패');
    const status = error?.code === 'P2002' ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 필요' }, { status: 400 });

    const existing = await prisma.equipment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '장비를 찾을 수 없습니다.' }, { status: 404 });
    }

    let auth;
    try {
      auth = await authorizeEquipmentApi({
        requireEditor: true,
        categoryCode: existing.category,
      });
    } catch (e) {
      return authErrorToResponse(e);
    }

    if (auth.permission.myRole !== 'LV_1') {
      return NextResponse.json(
        { error: '영구 삭제는 LV_1만 가능합니다.' },
        { status: 403 }
      );
    }

    await prisma.equipment.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error: any) {
    if (error?.message === 'FORBIDDEN_EDIT') return authErrorToResponse(error);
    console.error('[equipment DELETE]', error?.message, error?.code);
    return NextResponse.json(
      { error: equipmentErrorMessage(error, '삭제 실패') },
      { status: 500 }
    );
  }
}
