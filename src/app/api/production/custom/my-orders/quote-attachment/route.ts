import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/production/custom/my-orders/request';
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'production-office-quote');
const MAX_BYTES = 20 * 1024 * 1024;

function asOptionsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** [POST] 사무문구 드림디포 견적서 첨부 (신청 직후) */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH);
    const form = await req.formData();
    const requestId = String(form.get('requestId') || '').trim();
    const file = form.get('file');

    if (!requestId) {
      return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });
    }
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ message: '첨부할 견적서 파일이 필요합니다.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ message: '첨부 파일은 20MB 이하여야 합니다.' }, { status: 400 });
    }

    const row = await prisma.productionRequest.findUnique({ where: { id: requestId } });
    if (!row) {
      return NextResponse.json({ message: '신청 건을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (row.userEmail !== auth.user.email) {
      return NextResponse.json({ message: '본인 신청 건에만 첨부할 수 있습니다.' }, { status: 403 });
    }
    if (row.category !== 'OFFICE_SUPPLIES') {
      return NextResponse.json({ message: '사무문구류 신청에만 견적서 첨부가 가능합니다.' }, { status: 400 });
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const ext = path.extname(file.name) || '';
    const storedFileName = `quote_${requestId}_${Date.now()}${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, storedFileName), Buffer.from(await file.arrayBuffer()));

    const url = `/uploads/production-office-quote/${storedFileName}`;
    const attachment = {
      fileName: file.name,
      storedFileName,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      url,
      uploadedAt: new Date().toISOString(),
    };

    const prev = asOptionsRecord(row.options);
    await prisma.productionRequest.update({
      where: { id: requestId },
      data: {
        options: {
          ...prev,
          suppliesQuoteAttachment: attachment,
        } as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      success: true,
      message: '견적서 첨부가 저장되었습니다.',
      attachment,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[my-orders/quote-attachment POST]', error);
    return NextResponse.json({ message: '견적서 첨부 저장에 실패했습니다.' }, { status: 500 });
  }
}
