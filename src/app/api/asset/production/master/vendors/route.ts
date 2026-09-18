import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import {
  isSeedVendor,
  SEED_VENDOR_DEFAULTS,
} from '@/lib/production-seed-vendors';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/production/apply/request',
  '/asset/production/apply/history',
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/settlement',
  '/asset/production/dept-master/archive',
];

const VALID_PRIORITY_CATEGORIES = new Set([
  '',
  'SIGN',
  'JEBON',
  'PRINT',
  'OFFICE_SUPPLIES',
]);

function parsePriorityCategory(raw: unknown): string {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!VALID_PRIORITY_CATEGORIES.has(value)) {
    throw new Error('우선 연결 품목이 올바르지 않습니다.');
  }
  return value;
}

async function assignExclusivePriorityCategory(vendorId: string, priorityCategory: string) {
  if (!priorityCategory) return;
  await prisma.productionVendorMaster.updateMany({
    where: {
      priorityCategory,
      id: { not: vendorId },
      isActive: true,
    },
    data: { priorityCategory: '' },
  });
}

export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const vendors = await prisma.productionVendorMaster.findMany({
      where: { isActive: true },
    });
    // 가나다순 — 시드·신규 등록 모두 동일 규칙
    vendors.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    return NextResponse.json(vendors);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 외주업체 조회 오류:', error);
    return NextResponse.json({ message: '외주업체 조회 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // 시드 누락분 복구: 없으면 추가, 비활성만 재활성 (명칭·연락처·품목·우선연결 보존)
    if (body?.action === 'restore-seeds') {
      await authorizeAnyMenuPaths(READ_PATHS, { requireEditor: true });

      let created = 0;
      let reactivated = 0;

      for (const seed of SEED_VENDOR_DEFAULTS) {
        let existing = await prisma.productionVendorMaster.findUnique({
          where: { id: seed.id },
        });
        if (!existing) {
          existing = await prisma.productionVendorMaster.findFirst({
            where: { label: seed.label },
          });
        }

        if (!existing) {
          await prisma.productionVendorMaster.create({
            data: {
              id: seed.id,
              label: seed.label,
              managerName: seed.managerName,
              contact: seed.contact,
              email: seed.email,
              items: seed.items,
              priorityCategory: seed.priorityCategory,
              isActive: true,
            },
          });
          await assignExclusivePriorityCategory(seed.id, seed.priorityCategory);
          created += 1;
          continue;
        }

        if (!existing.isActive) {
          await prisma.productionVendorMaster.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
          reactivated += 1;
        }
      }

      return NextResponse.json({
        message:
          created + reactivated === 0
            ? '복구할 시드 업체가 없습니다. (이미 모두 활성)'
            : `시드 업체 복구 완료 (신규 ${created}건, 재활성 ${reactivated}건)`,
        created,
        reactivated,
      });
    }

    await authorizeAnyMenuPaths(READ_PATHS); // 신규 등록: Access
    const label = String(body.label || '').trim();
    if (!label) return NextResponse.json({ message: '업체명은 필수입니다.' }, { status: 400 });
    const priorityCategory = parsePriorityCategory(body.priorityCategory);

    const vendor = await prisma.productionVendorMaster.create({
      data: {
        label,
        managerName: String(body.managerName || '').trim(),
        contact: String(body.contact || '').trim(),
        email: String(body.email || '').trim(),
        items: String(body.items || '').trim(),
        priorityCategory,
        isActive: true,
      },
    });
    await assignExclusivePriorityCategory(vendor.id, priorityCategory);
    return NextResponse.json({ message: '저장 완료', data: vendor }, { status: 201 });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 외주업체 등록 오류:', error);
    if (error instanceof Error && error.message.includes('우선 연결')) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS, { requireEditor: true });
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ message: '업체 ID가 필요합니다.' }, { status: 400 });
    const label = String(body.label || '').trim();
    if (!label) return NextResponse.json({ message: '업체명은 필수입니다.' }, { status: 400 });
    const priorityCategory =
      body.priorityCategory !== undefined
        ? parsePriorityCategory(body.priorityCategory)
        : undefined;

    const vendor = await prisma.productionVendorMaster.update({
      where: { id },
      data: {
        label,
        managerName: String(body.managerName || '').trim(),
        contact: String(body.contact || '').trim(),
        email: String(body.email || '').trim(),
        items: String(body.items || '').trim(),
        ...(priorityCategory !== undefined ? { priorityCategory } : {}),
      },
    });
    if (priorityCategory) {
      await assignExclusivePriorityCategory(vendor.id, priorityCategory);
    }
    return NextResponse.json({ message: '저장 완료', data: vendor });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 외주업체 수정 오류:', error);
    if (error instanceof Error && error.message.includes('우선 연결')) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ message: '업체 ID가 필요합니다.' }, { status: 400 });

    const row = await prisma.productionVendorMaster.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ message: '업체를 찾을 수 없습니다.' }, { status: 404 });

    if (isSeedVendor(row)) {
      if (auth.permission.myRole !== 'LV_1') {
        return NextResponse.json(
          { message: '시드 업체 삭제는 LV_1만 가능합니다.' },
          { status: 403 }
        );
      }
    } else if (!auth.permission.isEditor) {
      return NextResponse.json({ message: '편집 권한이 없습니다.' }, { status: 403 });
    }

    const activeCount = await prisma.productionVendorMaster.count({ where: { isActive: true } });
    if (activeCount <= 1) {
      return NextResponse.json({ message: '최소 한 개 이상의 외주업체가 필요합니다.' }, { status: 400 });
    }

    await prisma.productionVendorMaster.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ message: '삭제(비활성화) 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('제작 외주업체 삭제 오류:', error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}
