import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import * as XLSX from 'xlsx';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import {
  applyOfficeQuoteLinesToOptions,
  parseOfficeQuoteFromWorkbook,
} from '@/lib/production-office-statement-match';
import { assertProductionRowInDeptScope } from '@/lib/production-dept-scope';
import { canEditProductionApplicantSource } from '@/lib/production-status';

export const dynamic = 'force-dynamic';

const APPLICANT_PATHS = [
  '/production/custom/my-orders/request',
  '/production/custom/my-orders/history',
];
const DEPT_ORDER_PATH = '/production/custom/dept-master/order';
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
    if (row.category !== 'OFFICE_SUPPLIES') {
      return NextResponse.json({ message: '사무문구류 신청에만 견적서 첨부가 가능합니다.' }, { status: 400 });
    }
    if (!canEditProductionApplicantSource(row.status, asOptionsRecord(row.options))) {
      return NextResponse.json(
        { message: '신청대기·묶음발주대기·반려 상태인 건만 견적서를 바꿀 수 있습니다.' },
        { status: 400 }
      );
    }

    let allowed = false;
    try {
      const applicantAuth = await authorizeAnyMenuPaths(APPLICANT_PATHS);
      if (
        String(row.userEmail || '').toLowerCase() ===
        String(applicantAuth.user.email || '').toLowerCase()
      ) {
        allowed = true;
      }
    } catch {
      /* 신청자 메뉴가 없으면 부서 원문검수로 */
    }
    if (!allowed) {
      const deptAuth = await authorizeApi(DEPT_ORDER_PATH);
      const myUnit = deptAuth.user.unit;
      const allUnits = (deptAuth.unitsList || []).map((u: any) => ({
        id: String(u.id || ''),
        unit_name: String(u.unit_name || ''),
        parent_id: (u.parent_id ?? null) as string | null,
      }));
      const myUnitId = String(myUnit?.id || '');
      const myUnitName = String(myUnit?.unit_name || '');
      const elevated =
        deptAuth.permission.isMaster ||
        deptAuth.permission.myRole === 'LV_1' ||
        String(deptAuth.permission.editScope || deptAuth.permission.viewScope || '').toUpperCase() ===
          'TOTAL';
      const scopeUnits = [{ id: myUnitId, unit_name: myUnitName }].filter((u) => u.id);
      if (!elevated) {
        allUnits
          .filter((u) => u.parent_id === myUnitId)
          .forEach((c) => scopeUnits.push({ id: c.id, unit_name: c.unit_name }));
      } else if (myUnitId) {
        const walk = (parentId: string) => {
          allUnits
            .filter((u) => u.parent_id === parentId)
            .forEach((c) => {
              scopeUnits.push({ id: c.id, unit_name: c.unit_name });
              walk(c.id);
            });
        };
        walk(myUnitId);
      }
      const inScope = assertProductionRowInDeptScope(
        {
          myUnit: { id: myUnitId, unit_name: myUnitName },
          scopeUnits,
          scopeNames: scopeUnits.map((u) => u.unit_name),
          viewScope: elevated ? 'TOTAL' : 'DEPT',
        },
        row
      );
      if (!inScope) {
        return NextResponse.json(
          { message: '담당 부서 범위 밖의 신청 건입니다.' },
          { status: 403 }
        );
      }
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const ext = path.extname(file.name) || '';
    const storedFileName = `quote_${requestId}_${Date.now()}${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(UPLOAD_DIR, storedFileName), bytes);

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
    const isExcel = /\.(xls|xlsx)$/i.test(file.name);
    let nextOptions: Record<string, unknown> = {
      ...prev,
      suppliesQuoteAttachment: attachment,
      suppliesQuoteKind: isExcel ? 'excel' : /\.pdf$/i.test(file.name) ? 'pdf' : prev.suppliesQuoteKind,
    };

    if (isExcel) {
      try {
        const wb = XLSX.read(bytes, { type: 'buffer', cellDates: true });
        const lines = parseOfficeQuoteFromWorkbook(wb, (sheet) =>
          XLSX.utils.sheet_to_json(sheet as XLSX.WorkSheet, {
            header: 1,
            raw: true,
            defval: '',
          }) as unknown[][]
        );
        if (lines.length > 0) {
          nextOptions = applyOfficeQuoteLinesToOptions(nextOptions, lines);
        }
      } catch (parseErr) {
        console.error('[my-orders/quote-attachment] excel parse', parseErr);
      }
    }

    await prisma.productionRequest.update({
      where: { id: requestId },
      data: {
        options: nextOptions as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      success: true,
      message: '견적서 첨부가 저장되었습니다.',
      attachment,
      options: nextOptions,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[my-orders/quote-attachment POST]', error);
    return NextResponse.json({ message: '견적서 첨부 저장에 실패했습니다.' }, { status: 500 });
  }
}
