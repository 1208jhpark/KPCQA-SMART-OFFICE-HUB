import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MASTER_PATH = '/asset/businesscard/master/order';
const ARCHIVE_PATH = '/asset/businesscard/master/archive';
const REQUESTS_PATH = '/asset/businesscard/master/requests';
const MY_PATH = '/asset/businesscard/my-page';
const MASTER_PROOF_PATHS = [MASTER_PATH, ARCHIVE_PATH, REQUESTS_PATH];

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'businesscard-proof');

const ALLOWED_EXT = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ai',
  '.zip',
]);
const MAX_BYTES = 20 * 1024 * 1024; // 20MB

async function ensureDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {}
}

function sessionEmail(user: { email?: string | null }) {
  return String(user?.email || '').trim().toLowerCase();
}

function proofPublicMeta(row: {
  id: string;
  proofFileName: string | null;
  proofStoredFileName?: string | null;
  proofMimeType: string | null;
  proofFileSize: number | null;
  proofUploadedAt: Date | null;
  proofUploadedBy: string | null;
  proofMailReviewedAt?: Date | null;
  proofMailReviewedBy?: string | null;
  proofConfirmedAt: Date | null;
  proofConfirmedBy: string | null;
}) {
  const hasProof = Boolean(row.proofFileName && row.proofStoredFileName);
  const hasMailReview = Boolean(row.proofMailReviewedAt);
  return {
    id: row.id,
    hasProof,
    hasMailReview,
    proofReady: hasProof || hasMailReview,
    proofFileName: row.proofFileName,
    proofMimeType: row.proofMimeType,
    proofFileSize: row.proofFileSize,
    proofUploadedAt: row.proofUploadedAt,
    proofUploadedBy: row.proofUploadedBy,
    proofMailReviewedAt: row.proofMailReviewedAt ?? null,
    proofMailReviewedBy: row.proofMailReviewedBy ?? null,
    proofConfirmedAt: row.proofConfirmedAt,
    proofConfirmedBy: row.proofConfirmedBy,
    proofConfirmed: Boolean(row.proofConfirmedAt),
  };
}

const PROOF_SELECT = {
  id: true,
  proofFileName: true,
  proofStoredFileName: true,
  proofMimeType: true,
  proofFileSize: true,
  proofUploadedAt: true,
  proofUploadedBy: true,
  proofMailReviewedAt: true,
  proofMailReviewedBy: true,
  proofConfirmedAt: true,
  proofConfirmedBy: true,
} as const;

/**
 * [GET] 시안 메타 또는 다운로드
 * - ?id=&download=1 : 파일 스트림 (본인 또는 마스터)
 * - ?id= : 메타만
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    const isDownload = searchParams.get('download') === '1';
    if (!id) {
      return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });
    }

    const row = await prisma.businessCardRequest.findUnique({
      where: { id },
      select: {
        userEmail: true,
        ...PROOF_SELECT,
      },
    });
    if (!row) {
      return NextResponse.json({ message: '신청 건을 찾을 수 없습니다.' }, { status: 404 });
    }

    let isMaster = false;
    let authUser: { email?: string | null; name?: string | null } | null = null;
    try {
      const masterAuth = await authorizeAnyMenuPaths(MASTER_PROOF_PATHS);
      isMaster = true;
      authUser = masterAuth.user;
    } catch {
      const myAuth = await authorizeApi(MY_PATH);
      authUser = myAuth.user;
      const email = sessionEmail(myAuth.user);
      if (email !== String(row.userEmail || '').trim().toLowerCase()) {
        return NextResponse.json({ message: '본인 신청 건만 조회할 수 있습니다.' }, { status: 403 });
      }
    }

    if (!isDownload) {
      return NextResponse.json({
        ...proofPublicMeta(row),
        viewer: isMaster ? 'master' : 'user',
        viewerEmail: sessionEmail(authUser || {}),
      });
    }

    if (!row.proofStoredFileName || !row.proofFileName) {
      return NextResponse.json({ message: '업로드된 시안이 없습니다.' }, { status: 404 });
    }

    const filePath = path.join(UPLOAD_DIR, row.proofStoredFileName);
    try {
      const fileBuffer = await fs.readFile(filePath);
      const encodedName = encodeURIComponent(row.proofFileName);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': row.proofMimeType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        },
      });
    } catch {
      return NextResponse.json({ message: '시안 파일을 읽을 수 없습니다.' }, { status: 404 });
    }
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[bc-proof GET]', error);
    return NextResponse.json({ message: '시안 조회 실패' }, { status: 500 });
  }
}

/**
 * [POST] 관리자 시안 업로드 (multipart: requestId + file)
 * 재업로드 시 확정 상태 초기화
 */
export async function POST(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(MASTER_PROOF_PATHS, {
      requireEditor: true,
    });
    await ensureDir();

    const formData = await req.formData();
    const requestId = String(formData.get('requestId') || '').trim();
    const file = formData.get('file') as File | null;

    if (!requestId) {
      return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ message: '업로드할 파일이 없습니다.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ message: '파일은 20MB 이하여야 합니다.' }, { status: 400 });
    }

    const ext = path.extname(file.name || '').toLowerCase() || '.pdf';
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { message: '허용 형식: PDF, 이미지(PNG/JPG/GIF/WEBP), AI, ZIP' },
        { status: 400 }
      );
    }

    const existing = await prisma.businessCardRequest.findUnique({
      where: { id: requestId },
      select: { id: true, proofStoredFileName: true, adminStatus: true },
    });
    if (!existing) {
      return NextResponse.json({ message: '신청 건을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (existing.proofStoredFileName) {
      try {
        await fs.unlink(path.join(UPLOAD_DIR, existing.proofStoredFileName));
      } catch {}
    }

    const timestamp = Date.now();
    const storedFileName = `proof_${requestId.slice(0, 8)}_${timestamp}${ext}`;
    const targetPath = path.join(UPLOAD_DIR, storedFileName);
    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(targetPath, Buffer.from(arrayBuffer));

    const updated = await prisma.businessCardRequest.update({
      where: { id: requestId },
      data: {
        proofFileName: file.name,
        proofStoredFileName: storedFileName,
        proofMimeType: file.type || 'application/octet-stream',
        proofFileSize: file.size,
        proofUploadedAt: new Date(),
        proofUploadedBy: auth.user.name || auth.user.email || '관리자',
        // 재업로드 → 다시 확정 필요
        proofConfirmedAt: null,
        proofConfirmedBy: null,
      },
      select: PROOF_SELECT,
    });

    return NextResponse.json({
      success: true,
      message: '시안 파일이 업로드되었습니다.',
      ...proofPublicMeta(updated),
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[bc-proof POST]', error);
    return NextResponse.json(
      { message: error?.message || '시안 업로드 실패' },
      { status: 500 }
    );
  }
}

/**
 * [PATCH] 시안 관련
 * - { id, action: 'mail-review' }: 관리자 — 개별메일 확인 경로 기록 (파일 없이 확정 가능)
 * - { id, action: 'reset' }: 관리자 — 시안 파일·메일확인·확정 전부 초기화
 * - { id }: 시안확정 (파일 업로드 또는 개별메일확인 후)
 *   · 신청자(my-page): 본인 건 + (파일 또는 개별메일확인)
 *   · 관리자: 파일 또는 메일확인 후 대행 확정
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const action = String(body?.action || '').trim();
    if (!id) {
      return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });
    }

    /** 시안 초기화 — 마스터만 */
    if (action === 'reset') {
      const masterAuth = await authorizeAnyMenuPaths(MASTER_PROOF_PATHS, {
        requireEditor: true,
      });
      void masterAuth;
      const row = await prisma.businessCardRequest.findUnique({
        where: { id },
        select: {
          id: true,
          proofStoredFileName: true,
          proofFileName: true,
          proofMailReviewedAt: true,
          proofConfirmedAt: true,
        },
      });
      if (!row) {
        return NextResponse.json({ message: '신청 건을 찾을 수 없습니다.' }, { status: 404 });
      }
      const hasAnything =
        Boolean(row.proofStoredFileName) ||
        Boolean(row.proofFileName) ||
        Boolean(row.proofMailReviewedAt) ||
        Boolean(row.proofConfirmedAt);
      if (!hasAnything) {
        return NextResponse.json(
          { message: '초기화할 시안·메일확인 내역이 없습니다.' },
          { status: 400 }
        );
      }
      if (row.proofStoredFileName) {
        try {
          await fs.unlink(path.join(UPLOAD_DIR, row.proofStoredFileName));
        } catch {}
      }
      const updated = await prisma.businessCardRequest.update({
        where: { id },
        data: {
          proofFileName: null,
          proofStoredFileName: null,
          proofMimeType: null,
          proofFileSize: null,
          proofUploadedAt: null,
          proofUploadedBy: null,
          proofMailReviewedAt: null,
          proofMailReviewedBy: null,
          proofConfirmedAt: null,
          proofConfirmedBy: null,
        },
        select: PROOF_SELECT,
      });
      return NextResponse.json({
        success: true,
        message: '시안·메일확인·확정 상태를 초기화했습니다.',
        ...proofPublicMeta(updated),
      });
    }

    /** 개별메일확인 — 마스터만 */
    if (action === 'mail-review') {
      const masterAuth = await authorizeAnyMenuPaths(MASTER_PROOF_PATHS, {
        requireEditor: true,
      });
      const row = await prisma.businessCardRequest.findUnique({
        where: { id },
        select: {
          id: true,
          proofConfirmedAt: true,
          proofMailReviewedAt: true,
        },
      });
      if (!row) {
        return NextResponse.json({ message: '신청 건을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (row.proofConfirmedAt) {
        return NextResponse.json({ message: '이미 시안이 확정되었습니다.' }, { status: 400 });
      }
      const actorName =
        masterAuth.user.name || masterAuth.user.email || '관리자';
      const updated = await prisma.businessCardRequest.update({
        where: { id },
        data: {
          proofMailReviewedAt: new Date(),
          proofMailReviewedBy: `관리자·${actorName}`,
        },
        select: PROOF_SELECT,
      });
      return NextResponse.json({
        success: true,
        message: '메일확인요청으로 시안 검토 대기 처리했습니다. 확정할 수 있습니다.',
        ...proofPublicMeta(updated),
      });
    }

    let isMaster = false;
    let authUser: { email?: string | null; name?: string | null };
    try {
      const masterAuth = await authorizeAnyMenuPaths(MASTER_PROOF_PATHS, {
        requireEditor: true,
      });
      isMaster = true;
      authUser = masterAuth.user;
    } catch {
      const myAuth = await authorizeApi(MY_PATH, { requireEditor: true });
      authUser = myAuth.user;
    }

    const email = sessionEmail(authUser);
    const row = await prisma.businessCardRequest.findUnique({
      where: { id },
      select: {
        id: true,
        userEmail: true,
        proofFileName: true,
        proofStoredFileName: true,
        proofMailReviewedAt: true,
        proofConfirmedAt: true,
      },
    });
    if (!row) {
      return NextResponse.json({ message: '신청 건을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (!isMaster) {
      if (email !== String(row.userEmail || '').trim().toLowerCase()) {
        return NextResponse.json({ message: '본인 신청 건만 확정할 수 있습니다.' }, { status: 403 });
      }
    }

    const hasFile = Boolean(row.proofFileName && row.proofStoredFileName);
    const hasMail = Boolean(row.proofMailReviewedAt);
    if (!hasFile && !hasMail) {
      return NextResponse.json(
        {
          message: isMaster
            ? '시안 파일을 업로드하거나, 메일확인요청 후 확정해 주세요.'
            : '시안 파일 또는 메일확인요청이 도착한 뒤 확정해 주세요.',
        },
        { status: 400 }
      );
    }
    if (row.proofConfirmedAt) {
      return NextResponse.json({ message: '이미 시안이 확정되었습니다.' }, { status: 400 });
    }

    const actorName = authUser.name || authUser.email || email || '사용자';
    /** 확정 주체만 기록 — 메일/파일 경로는 구분하지 않음 */
    const confirmedBy = isMaster ? `관리자·${actorName}` : actorName;

    const updated = await prisma.businessCardRequest.update({
      where: { id },
      data: {
        proofConfirmedAt: new Date(),
        proofConfirmedBy: confirmedBy,
      },
      select: PROOF_SELECT,
    });

    return NextResponse.json({
      success: true,
      message: isMaster ? '관리자가 시안을 확정했습니다.' : '시안이 확정되었습니다.',
      confirmedByRole: isMaster ? 'admin' : 'user',
      ...proofPublicMeta(updated),
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[bc-proof PATCH]', error);
    return NextResponse.json(
      { message: error?.message || '시안 확정 실패' },
      { status: 500 }
    );
  }
}
