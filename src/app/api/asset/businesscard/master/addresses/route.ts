import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAnyMenuPaths, authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';
import { SEED_COMPANY_ADDRESSES } from '@/lib/businesscard-seed-addresses';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/businesscard/my-page',
  '/asset/businesscard/master/requests',
  '/asset/businesscard/master/order',
  '/asset/businesscard/master/archive',
  '/asset/production/apply/request',
  '/asset/production/apply/history',
];
const WRITE_PATH = '/asset/businesscard/master/requests';

/** 주소 마스터 조회 — my-page·master Access */
export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const addresses = await prisma.companyAddress.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(addresses, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json({ message: '주소 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body?.action === 'restore-seeds') {
      await authorizeApi(WRITE_PATH, { requireEditor: true });
      let created = 0;
      let reactivated = 0;

      for (const seed of SEED_COMPANY_ADDRESSES) {
        const existing = await prisma.companyAddress.findFirst({
          where: { label: seed.label },
        });
        if (!existing) {
          await prisma.companyAddress.create({
            data: { ...seed, isActive: true },
          });
          created += 1;
          continue;
        }
        if (!existing.isActive) {
          await prisma.companyAddress.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
          reactivated += 1;
        }
      }

      return NextResponse.json({
        message:
          created + reactivated === 0
            ? '복구할 시드 주소가 없습니다. (이미 모두 활성)'
            : `시드 주소 복구 완료 (신규 ${created}건, 재활성 ${reactivated}건)`,
        created,
        reactivated,
      });
    }

    await authorizeApi(WRITE_PATH, { requireEditor: true });
    const newAddress = await prisma.companyAddress.create({ data: body });
    return NextResponse.json(newAddress);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json({ message: '주소 생성 실패' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await authorizeApi(WRITE_PATH, { requireEditor: true });
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ message: 'ID가 누락되었습니다.' }, { status: 400 });
    const updated = await prisma.companyAddress.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json({ message: '주소 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await authorizeApi(WRITE_PATH, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ message: 'ID가 누락되었습니다.' }, { status: 400 });

    await prisma.companyAddress.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json({ message: '주소 삭제 실패' }, { status: 500 });
  }
}
