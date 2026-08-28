import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/businesscard/master/order';
const READ_PATHS = [
  '/asset/businesscard/master/order',
  '/asset/businesscard/master/requests',
  '/asset/businesscard/master/archive',
];

export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const vendors = await prisma.outsourcingVendor.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(vendors);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('외주업체 조회 오류:', error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const { companyName, managerName, email, memo } = await req.json();
    const newVendor = await prisma.outsourcingVendor.create({
      data: {
        companyName: String(companyName || '').trim(),
        managerName: String(managerName || '').trim(),
        email: String(email || '').trim(),
        memo: String(memo || '').trim(),
        isActive: true,
      },
    });
    return NextResponse.json(newVendor, { status: 201 });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('외주업체 등록 오류:', error);
    return NextResponse.json({ error: '등록 실패' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const { id, companyName, managerName, email, memo } = await req.json();
    if (!id) return NextResponse.json({ error: '업체 ID가 없습니다.' }, { status: 400 });
    const updatedVendor = await prisma.outsourcingVendor.update({
      where: { id },
      data: {
        companyName: String(companyName || '').trim(),
        managerName: String(managerName || '').trim(),
        email: String(email || '').trim(),
        memo: String(memo || '').trim(),
      },
    });
    return NextResponse.json(updatedVendor);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('외주업체 수정 오류:', error);
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: '업체 ID가 없습니다.' }, { status: 400 });
    await prisma.outsourcingVendor.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('외주업체 삭제 오류:', error);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
