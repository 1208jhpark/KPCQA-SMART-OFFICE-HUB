import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAdminApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

/** GET — 설정 조회 (서비스에서도 사용 가능, LV_1 잠금 금지) */
export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    return NextResponse.json(config || {});
  } catch (error) {
    return NextResponse.json({ error: '설정 로드 실패' }, { status: 500 });
  }
}

/** POST — 설정 저장, LV_1만 */
export async function POST(req: Request) {
  try {
    await authorizeAdminApi();
    const body = await req.json();
    
    // global ID로 설정을 생성하거나 업데이트 (upsert)
    const config = await prisma.systemConfig.upsert({
      where: { id: 'global' },
      update: { unit_category_group: body.unit_category_group },
      create: { id: 'global', unit_category_group: body.unit_category_group }
    });
    
    return NextResponse.json(config);
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    return NextResponse.json({ error: '설정 저장 실패' }, { status: 500 });
  }
}
