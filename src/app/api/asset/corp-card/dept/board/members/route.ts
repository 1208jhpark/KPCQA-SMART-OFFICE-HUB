import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/corp-card/dept/board';
const AUTH_ERRORS = new Set([
  'UNAUTHORIZED',
  'UNAUTHORIZED_EXPIRED',
  'USER_NOT_FOUND',
  'FORBIDDEN',
  'FORBIDDEN_EDIT',
  'FORBIDDEN_ADMIN',
  'MENU_NOT_CONFIGURED',
]);

export async function GET() {
  try {
    const auth = await authorizeApi(MENU_PATH);
    const myUnit = auth.user?.unit as { id?: string; unit_name?: string } | null | undefined;
    const myUnitId = String(myUnit?.id || auth.user?.unit_id || '').trim();
    const viewerId = String(auth.user?.id || '').trim();
    if (!myUnitId) {
      return NextResponse.json({ members: [] });
    }

    const users = await prisma.user.findMany({
      where: {
        status: 'Active',
        unit_id: myUnitId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        unit: { select: { unit_name: true } },
      },
      orderBy: [{ name: 'asc' }],
    });

    return NextResponse.json(
      {
        members: users
          .filter((u) => u.id !== viewerId)
          .map((u) => ({
            id: u.id,
            name: String(u.name || '').trim(),
            email: String(u.email || '').trim(),
            unitName: String(u.unit?.unit_name || '').trim(),
          }))
          .filter((u) => u.name),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (AUTH_ERRORS.has(msg)) return authErrorToResponse(error);
    console.error('[corp-card board members]', error);
    return NextResponse.json({ error: '부서원 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
