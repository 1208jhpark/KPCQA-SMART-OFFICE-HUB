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
const STORE_FILE = path.join(UPLOAD_DIR, 'statement-publish.json');

const VALID_CATEGORIES = new Set(['SIGN', 'JEBON', 'PRINT', 'OFFICE_SUPPLIES']);

export type StatementPublishRecord = {
  category: string;
  published: boolean;
  updatedAt: string;
  updatedBy: string;
};

type PublishStore = Record<string, StatementPublishRecord>;

async function ensureDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {}
}

async function readStore(): Promise<PublishStore> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PublishStore;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeStore(store: PublishStore) {
  await ensureDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/** [GET] ?category=PRINT → { published } / 생략 시 전체 */
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
      const item = store[category] || null;
      return NextResponse.json({
        published: item?.published === true,
        item,
      });
    }

    return NextResponse.json({ items: store });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[statement-publish GET]', error);
    return NextResponse.json({ message: '명세표 게시 상태 조회 실패' }, { status: 500 });
  }
}

/** [POST] { category, published: boolean } — 마스터 Edit */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MASTER_PATH, { requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const category = String(body.category || '').trim().toUpperCase();
    const published = body.published === true;

    if (!VALID_CATEGORIES.has(category)) {
      return NextResponse.json({ message: '유효하지 않은 분류입니다.' }, { status: 400 });
    }

    const store = await readStore();
    const record: StatementPublishRecord = {
      category,
      published,
      updatedAt: new Date().toISOString(),
      updatedBy: String(auth.user?.name || '').trim() || '관리자',
    };
    store[category] = record;
    await writeStore(store);

    return NextResponse.json({
      message: published
        ? '부서 정산 화면에 명세표를 게시했습니다.'
        : '부서 정산 화면에서 명세표를 숨겼습니다.',
      published,
      item: record,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[statement-publish POST]', error);
    return NextResponse.json({ message: '명세표 게시 상태 변경 실패' }, { status: 500 });
  }
}
