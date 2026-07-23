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

const EQUIPMENT_UPDATE_WHITELIST = [
  'category',
  'name',
  'model_name',
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
  let auth;
  try {
    auth = await authorizeEquipmentApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

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
        },
      });
      if (!equipment) {
        return NextResponse.json({ error: '장비를 찾을 수 없습니다.' }, { status: 404 });
      }
      return NextResponse.json(full ? equipment : slimEquipmentRow(equipment));
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
  let auth;
  try {
    auth = await authorizeEquipmentApi({ requireEditor: true });
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    const department = body.department || '';
    assertCanEditEquipmentDepartment(auth, department);

    for (const f of EQUIPMENT_FILE_FIELDS) {
      const err = assertFileFieldWithinLimit(f, body[f]);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    const newEq = await prisma.equipment.create({
      data: {
        category: body.category || '기본',
        name: body.name || '',
        brand: body.brand || '',
        model_name: body.model_name || '',
        asset_no: body.asset_no || `TMP-${Date.now()}`,
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
    console.error('장비 등록 실패:', error?.message);
    return NextResponse.json({ error: '장비 등록 실패' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let auth;
  try {
    auth = await authorizeEquipmentApi({ requireEditor: true });
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    const { id, history, deleteHistoryId } = body;

    if (!id) return NextResponse.json({ error: 'ID 필수' }, { status: 400 });

    const existing = await prisma.equipment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '장비를 찾을 수 없습니다.' }, { status: 404 });
    }

    assertCanEditEquipmentDepartment(auth, existing.department);

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
      let originalMemo = existing.etc_memo || '';
      try {
        const parsed = JSON.parse(existing.etc_memo || '');
        if (parsed && typeof parsed === 'object' && parsed.originalMemo != null) {
          originalMemo = String(parsed.originalMemo);
        }
      } catch {
        /* plain memo */
      }
      const archiveMemo = JSON.stringify({
        originalMemo,
        archiveReason: reason,
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
            asset_no: `${existing.asset_no}_ARC_${Date.now()}`,
            qty: archiveQty,
            department: existing.department,
            spec_summary: existing.spec_summary,
            purpose: existing.purpose,
            full_spec: existing.full_spec,
            thumbnail_url: existing.thumbnail_url,
            purchase_date: existing.purchase_date,
            replace_cycle_mo: existing.replace_cycle_mo,
            calib_cycle_mo: existing.calib_cycle_mo,
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
        return archived;
      });

      return NextResponse.json(result);
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

    // 4. 일반 장비 정보 수정
    // creator_* 는 POST 시에만 고정 — 수정/백필로 덮어쓰지 않음 (부서 이동 시 당시 소속 유지)
    const updateData: Record<string, unknown> = {
      ...pickEquipmentUpdate(body),
      ...updaterFields(auth),
    };

    // 복구 시 폐기 감사 필드 초기화
    if (updateData.status === '정상' && existing.status !== '정상') {
      updateData.archived_at = null;
      updateData.archived_by_name = null;
      updateData.archived_by_dept = null;
      updateData.archived_by_email = null;
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
    console.error('[equipment PATCH]', error);
    return NextResponse.json({ error: '업데이트 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let auth;
  try {
    auth = await authorizeEquipmentApi({ requireEditor: true });
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 필요' }, { status: 400 });

    const existing = await prisma.equipment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '장비를 찾을 수 없습니다.' }, { status: 404 });
    }
    assertCanEditEquipmentDepartment(auth, existing.department);

    await prisma.equipment.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error: any) {
    if (error?.message === 'FORBIDDEN_EDIT') return authErrorToResponse(error);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
