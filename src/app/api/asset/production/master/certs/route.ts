import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/apply/request';
const READ_PATHS = [
  '/asset/production/apply/request',
  '/asset/production/apply/history',
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/archive',
];

/** 시드 인증 — 삭제 시 LV_1/메뉴 Master 필요 */
const SEED_CERT_IDS = new Set([
  'GSEED',
  'BF',
  'CONDENDSATION',
  'EDUCATIONAL',
  'ENERGY',
  'OLD_ZEB',
  'INTEGRATED_ZEB',
  'ISO',
  'NORMAL',
  'GSEED_JEBON',
  'ENERGY_JEBON',
  'OLD_ZEB_JEBON',
  'INTEGRATED_ZEB_JEBON',
]);

type MultiGradeRow = { certId: string; useMultiGradeSelect: boolean };
type LinkedPlatesRow = { certId: string; linkedPlateCodes: unknown };

type JebonFormRow = {
  certId: string;
  jebonDefaultSizeType: string;
  jebonDefaultQuantity: number;
  useJebonCover: boolean;
  useJebonCoverDate: boolean;
  jebonCoverColor: string;
  jebonCoverPageCount: string;
  jebonInnerColor: string;
};

async function loadMultiGradeMap() {
  const rows = await prisma.$queryRaw<MultiGradeRow[]>`
    SELECT "certId", "useMultiGradeSelect"
    FROM "ProductionCertMaster"
    WHERE "isActive" = true
  `;
  return new Map(rows.map((row) => [row.certId, row.useMultiGradeSelect]));
}

async function loadMultiGradeFlag(certId: string) {
  const rows = await prisma.$queryRaw<{ useMultiGradeSelect: boolean }[]>`
    SELECT "useMultiGradeSelect"
    FROM "ProductionCertMaster"
    WHERE "certId" = ${certId}
    LIMIT 1
  `;
  return rows[0]?.useMultiGradeSelect ?? false;
}

async function saveMultiGradeFlag(certId: string, useMultiGradeSelect: boolean) {
  await prisma.$executeRaw`
    UPDATE "ProductionCertMaster"
    SET "useMultiGradeSelect" = ${useMultiGradeSelect}
    WHERE "certId" = ${certId}
  `;
}

function normalizeLinkedPlateCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const code = String(item || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

async function loadLinkedPlatesMap() {
  try {
    const rows = await prisma.$queryRaw<LinkedPlatesRow[]>`
      SELECT "certId", "linkedPlateCodes"
      FROM "ProductionCertMaster"
      WHERE "isActive" = true
    `;
    return new Map(
      rows.map((row) => [row.certId, normalizeLinkedPlateCodes(row.linkedPlateCodes)])
    );
  } catch {
    return new Map<string, string[]>();
  }
}

async function loadLinkedPlateCodes(certId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<LinkedPlatesRow[]>`
      SELECT "certId", "linkedPlateCodes"
      FROM "ProductionCertMaster"
      WHERE "certId" = ${certId}
      LIMIT 1
    `;
    return normalizeLinkedPlateCodes(rows[0]?.linkedPlateCodes);
  } catch {
    return [];
  }
}

async function saveLinkedPlateCodes(certId: string, codes: string[]) {
  const payload = JSON.stringify(normalizeLinkedPlateCodes(codes));
  await prisma.$executeRawUnsafe(
    `UPDATE "ProductionCertMaster" SET "linkedPlateCodes" = $1::jsonb WHERE "certId" = $2`,
    payload,
    certId
  );
}

async function loadJebonFormMap() {
  try {
    const rows = await prisma.$queryRaw<JebonFormRow[]>`
      SELECT
        "certId",
        "jebonDefaultSizeType",
        "jebonDefaultQuantity",
        "useJebonCover",
        "useJebonCoverDate",
        "jebonCoverColor",
        "jebonCoverPageCount",
        "jebonInnerColor"
      FROM "ProductionCertMaster"
      WHERE "isActive" = true
    `;
    return new Map(rows.map((row) => [row.certId, row]));
  } catch {
    const rows = await prisma.$queryRaw<
      Omit<JebonFormRow, 'useJebonCoverDate'>[]
    >`
      SELECT
        "certId",
        "jebonDefaultSizeType",
        "jebonDefaultQuantity",
        "useJebonCover",
        "jebonCoverColor",
        "jebonCoverPageCount",
        "jebonInnerColor"
      FROM "ProductionCertMaster"
      WHERE "isActive" = true
    `;
    return new Map(
      rows.map((row) => [row.certId, { ...row, useJebonCoverDate: true }])
    );
  }
}

async function loadJebonFormFlags(certId: string): Promise<JebonFormRow> {
  try {
    const rows = await prisma.$queryRaw<JebonFormRow[]>`
      SELECT
        "certId",
        "jebonDefaultSizeType",
        "jebonDefaultQuantity",
        "useJebonCover",
        "useJebonCoverDate",
        "jebonCoverColor",
        "jebonCoverPageCount",
        "jebonInnerColor"
      FROM "ProductionCertMaster"
      WHERE "certId" = ${certId}
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  } catch {
    const rows = await prisma.$queryRaw<
      Omit<JebonFormRow, 'useJebonCoverDate'>[]
    >`
      SELECT
        "certId",
        "jebonDefaultSizeType",
        "jebonDefaultQuantity",
        "useJebonCover",
        "jebonCoverColor",
        "jebonCoverPageCount",
        "jebonInnerColor"
      FROM "ProductionCertMaster"
      WHERE "certId" = ${certId}
      LIMIT 1
    `;
    if (rows[0]) return { ...rows[0], useJebonCoverDate: true };
  }
  return {
    certId,
    jebonDefaultSizeType: 'A4',
    jebonDefaultQuantity: 1,
    useJebonCover: true,
    useJebonCoverDate: true,
    jebonCoverColor: '컬러',
    jebonCoverPageCount: '1',
    jebonInnerColor: '흑백',
  };
}

async function saveJebonFormFlags(
  certId: string,
  flags: Omit<JebonFormRow, 'certId'>
) {
  await prisma.$executeRaw`
    UPDATE "ProductionCertMaster"
    SET
      "jebonDefaultSizeType" = ${flags.jebonDefaultSizeType},
      "jebonDefaultQuantity" = ${flags.jebonDefaultQuantity},
      "useJebonCover" = ${flags.useJebonCover},
      "useJebonCoverDate" = ${flags.useJebonCoverDate},
      "jebonCoverColor" = ${flags.jebonCoverColor},
      "jebonCoverPageCount" = ${flags.jebonCoverPageCount},
      "jebonInnerColor" = ${flags.jebonInnerColor}
    WHERE "certId" = ${certId}
  `;
}

export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const certs = await prisma.productionCertMaster.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    const multiMap = await loadMultiGradeMap();
    const jebonMap = await loadJebonFormMap();
    const plateMap = await loadLinkedPlatesMap();
    return NextResponse.json(
      certs.map((cert) => {
        const jebon = jebonMap.get(cert.certId);
        return {
          ...cert,
          useMultiGradeSelect: multiMap.get(cert.certId) ?? false,
          linkedPlateCodes: plateMap.get(cert.certId) ?? [],
          jebonDefaultSizeType: jebon?.jebonDefaultSizeType ?? 'A4',
          jebonDefaultQuantity: Number(jebon?.jebonDefaultQuantity) || 1,
          useJebonCover: jebon?.useJebonCover ?? true,
          useJebonCoverDate: jebon?.useJebonCoverDate ?? true,
          jebonCoverColor: jebon?.jebonCoverColor ?? '컬러',
          jebonCoverPageCount: jebon?.jebonCoverPageCount ?? '1',
          jebonInnerColor: jebon?.jebonInnerColor ?? '흑백',
        };
      })
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 인증 마스터 조회 오류:', error);
    return NextResponse.json({ message: '인증 규격 조회 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const certId = String(body.certId || '').trim();
    const type = String(body.type || '').trim().toUpperCase();
    const label = String(body.label || '').trim();
    if (!certId || !label) {
      return NextResponse.json({ message: '인증 ID와 명칭은 필수입니다.' }, { status: 400 });
    }
    if (type !== 'SIGN' && type !== 'JEBON') {
      return NextResponse.json({ message: 'type은 SIGN 또는 JEBON 이어야 합니다.' }, { status: 400 });
    }

    // 신규 등록·수정 모두 Edit 권한 필요
    const existing = await prisma.productionCertMaster.findUnique({ where: { certId } });
    await authorizeApi(MENU_PATH, { requireEditor: true });

    const grades = Array.isArray(body.grades)
      ? body.grades.map((g: unknown) => String(g))
      : existing
        ? Array.isArray(existing.grades)
          ? (existing.grades as unknown[]).map(String)
          : []
        : [];
    const useCertNumber =
      body.useCertNumber !== undefined
        ? Boolean(body.useCertNumber)
        : existing
          ? existing.useCertNumber
          : true;
    const useValidPeriod =
      body.useValidPeriod !== undefined
        ? Boolean(body.useValidPeriod)
        : existing
          ? existing.useValidPeriod
          : true;
    const existingMultiGrade = existing ? await loadMultiGradeFlag(certId) : false;
    const useMultiGradeSelect =
      body.useMultiGradeSelect !== undefined
        ? Boolean(body.useMultiGradeSelect)
        : existingMultiGrade;
    const existingLinkedPlates = existing ? await loadLinkedPlateCodes(certId) : [];
    const linkedPlateCodes =
      body.linkedPlateCodes !== undefined
        ? normalizeLinkedPlateCodes(body.linkedPlateCodes)
        : existingLinkedPlates;
    const format =
      body.format !== undefined ? String(body.format) : existing?.format ?? '';
    const jebonFormat =
      body.jebonFormat !== undefined
        ? String(body.jebonFormat)
        : existing?.jebonFormat ?? '';

    const existingJebon = existing
      ? await loadJebonFormFlags(certId)
      : {
          certId,
          jebonDefaultSizeType: 'A4',
          jebonDefaultQuantity: 1,
          useJebonCover: true,
          useJebonCoverDate: true,
          jebonCoverColor: '컬러',
          jebonCoverPageCount: '1',
          jebonInnerColor: '흑백',
        };
    const jebonFlags = {
      jebonDefaultSizeType:
        body.jebonDefaultSizeType !== undefined
          ? String(body.jebonDefaultSizeType)
          : existingJebon.jebonDefaultSizeType,
      jebonDefaultQuantity:
        body.jebonDefaultQuantity !== undefined
          ? Math.max(1, Number(body.jebonDefaultQuantity) || 1)
          : Number(existingJebon.jebonDefaultQuantity) || 1,
      useJebonCover:
        body.useJebonCover !== undefined
          ? Boolean(body.useJebonCover)
          : existingJebon.useJebonCover,
      useJebonCoverDate:
        body.useJebonCoverDate !== undefined
          ? Boolean(body.useJebonCoverDate)
          : existingJebon.useJebonCoverDate,
      jebonCoverColor:
        body.jebonCoverColor !== undefined
          ? String(body.jebonCoverColor)
          : existingJebon.jebonCoverColor,
      jebonCoverPageCount:
        body.jebonCoverPageCount !== undefined
          ? String(body.jebonCoverPageCount)
          : existingJebon.jebonCoverPageCount,
      jebonInnerColor:
        body.jebonInnerColor !== undefined
          ? String(body.jebonInnerColor)
          : existingJebon.jebonInnerColor,
    };

    // 신규 필드(판형/표지/본문)는 Prisma client stale 대비 raw SQL로 분리 저장
    const cert = await prisma.productionCertMaster.upsert({
      where: { certId },
      update: {
        type,
        label,
        format,
        jebonFormat,
        grades,
        useCertNumber,
        useValidPeriod,
        isActive: true,
      },
      create: {
        certId,
        type,
        label,
        format,
        jebonFormat,
        grades,
        useCertNumber,
        useValidPeriod,
        isActive: true,
      },
    });

    await saveMultiGradeFlag(certId, useMultiGradeSelect);
    await saveLinkedPlateCodes(certId, linkedPlateCodes);
    await saveJebonFormFlags(certId, jebonFlags);

    return NextResponse.json({
      message: '저장 완료',
      data: { ...cert, useMultiGradeSelect, linkedPlateCodes, ...jebonFlags },
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 인증 마스터 저장 오류:', error);
    const message =
      error instanceof Error && error.message ? error.message : '저장 실패';
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const certId = searchParams.get('certId');
    if (!certId) return NextResponse.json({ message: 'ID가 필요합니다.' }, { status: 400 });

    if (SEED_CERT_IDS.has(certId)) {
      const isLv1OrMaster =
        auth.permission.isMaster || auth.permission.myRole === 'LV_1';
      if (!isLv1OrMaster) {
        return NextResponse.json(
          { message: '시드 인증 삭제는 LV_1(마스터) 권한이 필요합니다.' },
          { status: 403 }
        );
      }
    }

    const row = await prisma.productionCertMaster.findUnique({ where: { certId } });
    if (!row) return NextResponse.json({ message: '대상을 찾을 수 없습니다.' }, { status: 404 });

    const activeCount = await prisma.productionCertMaster.count({
      where: { isActive: true, type: row.type },
    });
    if (activeCount <= 1) {
      return NextResponse.json(
        { message: '해당 분류에 최소 한 개 이상의 인증 종류가 존재해야 합니다.' },
        { status: 400 }
      );
    }

    await prisma.productionCertMaster.update({
      where: { certId },
      data: { isActive: false },
    });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 인증 마스터 삭제 오류:', error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}
