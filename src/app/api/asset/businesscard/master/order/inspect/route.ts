import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/businesscard/master/order';

type InspectPayload = {
  batchId: string;
  inspectStatus: 'idle' | 'match' | 'mismatch';
  inspectFileName?: string | null;
  inspectResult?: unknown;
};

function normalizeStatus(raw: unknown): 'idle' | 'match' | 'mismatch' {
  if (raw === 'match' || raw === 'mismatch' || raw === 'idle') return raw;
  return 'idle';
}

export async function PUT(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();
    const rows: InspectPayload[] = Array.isArray(body?.batches) ? body.batches : [];
    if (rows.length === 0) {
      return NextResponse.json({ message: '저장할 검수 묶음이 없습니다.' }, { status: 400 });
    }

    let count = 0;
    for (const row of rows) {
      const batchId = String(row?.batchId || '').trim();
      if (!batchId) continue;
      const inspectStatus = normalizeStatus(row.inspectStatus);
      const inspectFileName = row.inspectFileName ? String(row.inspectFileName).slice(0, 255) : null;

      await prisma.businessCardOrderBatch.update({
        where: { id: batchId },
        data: {
          inspectStatus,
          inspectFileName,
          inspectResult:
            row.inspectResult === undefined
              ? Prisma.JsonNull
              : (row.inspectResult as Prisma.InputJsonValue),
          inspectedAt: inspectStatus === 'idle' ? null : new Date(),
        },
      });
      count += 1;
    }

    return NextResponse.json({ success: true, count });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Inspect PUT Error:', error);
    return NextResponse.json({ message: '검수 결과 저장 실패', error: error.message }, { status: 500 });
  }
}
