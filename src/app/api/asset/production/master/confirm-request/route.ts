import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MASTER_PATH = '/asset/production/master/dashboard';
const READ_PATHS = [
  '/asset/production/master/dashboard',
  '/asset/production/dept-master/settlement',
  '/asset/production/dept-master/archive',
  '/asset/production/master/archive',
];

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'production-statement');
const STORE_FILE = path.join(UPLOAD_DIR, 'confirm-requests.json');

const VALID_CATEGORIES = new Set(['SIGN', 'JEBON', 'PRINT', 'OFFICE_SUPPLIES']);

export type ConfirmRequestRecord = {
  category: string;
  /** datetime-local 값 (YYYY-MM-DDTHH:mm) — KST 기준 입력 */
  requestedAt: string;
  memo: string;
  updatedAt: string;
  updatedBy: string;
};

type ConfirmRequestStore = Record<string, ConfirmRequestRecord>;

async function ensureDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {}
}

async function readStore(): Promise<ConfirmRequestStore> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ConfirmRequestStore;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeStore(store: ConfirmRequestStore) {
  await ensureDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/** [GET] ?category=PRINT → 단건 / 생략 시 전체 */
export async function GET(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const { searchParams } = new URL(req.url);
    const category = String(searchParams.get('category') || '').trim().toUpperCase();
    const store = await readStore();

    if (category) {
      if (!VALID_CATEGORIES.has(category)) {
        return NextResponse.json({ message: '유효하지 않은 분류입니다.' }, { status: 400 });
      }
      return NextResponse.json({ item: store[category] || null });
    }

    return NextResponse.json({ items: store });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[confirm-request GET]', error);
    return NextResponse.json({ message: '확인 완료 요청 조회 실패' }, { status: 500 });
  }
}

/** [POST] 확인 완료 요청일·전달사항 등록/수정 (마스터 Edit) */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MASTER_PATH, { requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const category = String(body.category || '').trim().toUpperCase();
    const requestedAt = String(body.requestedAt || '').trim();
    const memo = String(body.memo || '').trim();

    if (!VALID_CATEGORIES.has(category)) {
      return NextResponse.json({ message: '유효하지 않은 분류입니다.' }, { status: 400 });
    }
    if (!requestedAt) {
      return NextResponse.json({ message: '확인 완료 기한(날짜·시간)을 입력해 주세요.' }, { status: 400 });
    }
    // YYYY-MM-DDTHH:mm
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(requestedAt)) {
      return NextResponse.json(
        { message: '기한 일시 형식이 올바르지 않습니다. (날짜·시간)' },
        { status: 400 }
      );
    }

    const store = await readStore();
    const record: ConfirmRequestRecord = {
      category,
      requestedAt,
      memo,
      updatedAt: new Date().toISOString(),
      updatedBy: String(auth.user?.name || '').trim() || '관리자',
    };
    store[category] = record;
    await writeStore(store);

    return NextResponse.json({
      message: '확인 완료 기한이 등록되었습니다.',
      item: record,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[confirm-request POST]', error);
    return NextResponse.json({ message: '확인 완료 요청 등록 실패' }, { status: 500 });
  }
}

/** [DELETE] ?category=PRINT — 해당 코너 요청 삭제 */
export async function DELETE(req: Request) {
  try {
    await authorizeApi(MASTER_PATH, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const category = String(searchParams.get('category') || '').trim().toUpperCase();
    if (!VALID_CATEGORIES.has(category)) {
      return NextResponse.json({ message: '유효하지 않은 분류입니다.' }, { status: 400 });
    }

    const store = await readStore();
    if (!store[category]) {
      return NextResponse.json({ message: '삭제할 요청이 없습니다.' }, { status: 404 });
    }
    delete store[category];
    await writeStore(store);

    return NextResponse.json({ message: '확인 완료 요청이 삭제되었습니다.' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[confirm-request DELETE]', error);
    return NextResponse.json({ message: '확인 완료 요청 삭제 실패' }, { status: 500 });
  }
}
