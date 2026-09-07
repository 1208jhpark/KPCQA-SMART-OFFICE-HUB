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
  '/asset/production/dept-master/archive',
  '/asset/production/master/archive',
];

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'production-statement');
const META_FILE = path.join(UPLOAD_DIR, 'meta.json');

export type StatementFileRecord = {
  id: string;
  category: string; // 'SIGN' | 'JEBON' | 'PRINT' | 'OFFICE_SUPPLIES'
  vendorName: string;
  fileName: string;
  storedFileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string;
  url: string;
};

async function ensureDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {}
}

async function getStatementMetaList(): Promise<StatementFileRecord[]> {
  try {
    const raw = await fs.readFile(META_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.files)) {
      return parsed.files;
    }
    // 레거시 단일 객체 호환
    if (parsed && parsed.storedFileName) {
      return [
        {
          id: 'legacy-1',
          category: parsed.category || 'SIGN',
          vendorName: parsed.vendorName || '외주사',
          fileName: parsed.fileName || '거래명세표',
          storedFileName: parsed.storedFileName,
          fileSize: parsed.fileSize || 0,
          mimeType: parsed.mimeType || 'application/octet-stream',
          uploadedAt: parsed.uploadedAt || new Date().toISOString(),
          uploadedBy: parsed.uploadedBy || '관리자',
          url: parsed.url || `/uploads/production-statement/${parsed.storedFileName}`,
        },
      ];
    }
    return [];
  } catch {
    return [];
  }
}

async function saveStatementMetaList(list: StatementFileRecord[]) {
  await ensureDir();
  await fs.writeFile(META_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

/**
 * [GET] 현재 등록된 외주 거래명세표 목록 조회 또는 파일 다운로드
 * - ?id=...&download=1 : 해당 파일 다운로드 스트림 반환
 * - ?category=... : 특정 카테고리 목록만 필터링 (생략 시 전체 반환)
 */
export async function GET(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const isDownload = searchParams.get('download') === '1';
    const categoryFilter = searchParams.get('category');

    const list = await getStatementMetaList();

    if (isDownload) {
      const target = id ? list.find((item) => item.id === id) : list[0];
      if (!target) {
        return NextResponse.json({ error: '다운로드할 명세표 파일을 찾을 수 없습니다.' }, { status: 404 });
      }

      const filePath = path.join(UPLOAD_DIR, target.storedFileName);
      try {
        const fileBuffer = await fs.readFile(filePath);
        const encodedName = encodeURIComponent(target.fileName);
        return new NextResponse(fileBuffer, {
          headers: {
            'Content-Type': target.mimeType || 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
          },
        });
      } catch {
        return NextResponse.json({ error: '파일을 읽을 수 없습니다.' }, { status: 404 });
      }
    }

    const filtered = categoryFilter
      ? list.filter((item) => item.category === categoryFilter)
      : list;

    return NextResponse.json({ files: filtered, total: list.length });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[statement-file GET Error]:', error);
    return NextResponse.json({ error: '명세표 정보 조회 실패' }, { status: 500 });
  }
}

/**
 * [POST] 외주 거래명세표 파일 업로드 (마스터 전용)
 * - 코너(category) 및 외주업체(vendorName)별로 등록
 * - 같은 코너 + 동일 외주업체의 기존 파일이 있으면 디스크에서 정리하고 덮어씀 (용량 최적화)
 */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MASTER_PATH, { requireEditor: true });
    await ensureDir();

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const category = String(formData.get('category') || 'SIGN').trim().toUpperCase();
    const vendorName = String(formData.get('vendorName') || '').trim() || '기본 외주사';

    if (!file) {
      return NextResponse.json({ error: '업로드할 파일이 없습니다.' }, { status: 400 });
    }

    const currentList = await getStatementMetaList();

    // 동일 코너 + 동일 외주업체 기존 등록 파일 검색
    const existingIndex = currentList.findIndex(
      (item) => item.category === category && item.vendorName.toLowerCase() === vendorName.toLowerCase()
    );

    if (existingIndex >= 0) {
      const prevFile = currentList[existingIndex];
      try {
        await fs.unlink(path.join(UPLOAD_DIR, prevFile.storedFileName));
      } catch {}
    }

    const ext = path.extname(file.name) || '.pdf';
    const timestamp = Date.now();
    const safeVendor = vendorName.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    const storedFileName = `statement_${category}_${safeVendor}_${timestamp}${ext}`;
    const targetPath = path.join(UPLOAD_DIR, storedFileName);

    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(targetPath, Buffer.from(arrayBuffer));

    const newRecord: StatementFileRecord = {
      id: `stmt-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
      category,
      vendorName,
      fileName: file.name,
      storedFileName,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      uploadedAt: new Date().toISOString(),
      uploadedBy: auth.user.name || '마스터 관리자',
      url: `/uploads/production-statement/${storedFileName}`,
    };

    let nextList: StatementFileRecord[];
    if (existingIndex >= 0) {
      nextList = [...currentList];
      nextList[existingIndex] = newRecord;
    } else {
      nextList = [newRecord, ...currentList];
    }

    await saveStatementMetaList(nextList);

    return NextResponse.json({
      success: true,
      message: `[${vendorName}] 거래명세표가 성공적으로 등록되었습니다.`,
      file: newRecord,
      files: nextList,
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[statement-file POST Error]:', error);
    return NextResponse.json(
      { error: error.message || '파일 업로드 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/**
 * [DELETE] 특정 외주 거래명세표 파일 삭제 (마스터 전용)
 * - ?id=... 또는 JSON { id: ... }
 */
export async function DELETE(req: Request) {
  try {
    await authorizeApi(MASTER_PATH, { requireEditor: true });
    await ensureDir();

    let targetId: string | null = null;
    const { searchParams } = new URL(req.url);
    targetId = searchParams.get('id');

    if (!targetId) {
      try {
        const body = await req.json();
        targetId = body.id || null;
      } catch {}
    }

    if (!targetId) {
      return NextResponse.json({ error: '삭제할 명세표 ID가 지정되지 않았습니다.' }, { status: 400 });
    }

    const currentList = await getStatementMetaList();
    const targetItem = currentList.find((item) => item.id === targetId);

    if (targetItem) {
      try {
        await fs.unlink(path.join(UPLOAD_DIR, targetItem.storedFileName));
      } catch {}
    }

    const nextList = currentList.filter((item) => item.id !== targetId);
    await saveStatementMetaList(nextList);

    return NextResponse.json({
      success: true,
      message: '해당 외주 거래명세표 파일이 성공적으로 삭제되었습니다.',
      files: nextList,
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[statement-file DELETE Error]:', error);
    return NextResponse.json(
      { error: error.message || '파일 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
