import { NextResponse } from 'next/server';
import { buildInterfacePermissionSummary } from '@/lib/interface-permission-summary';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

/** GET /api/admin/interface/summary?path=/marketing/... — 메뉴 CRUD 역할 요약 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const path = String(searchParams.get('path') || '').trim();
    if (!path) {
      return NextResponse.json({ error: 'path 파라미터가 필요합니다.' }, { status: 400 });
    }

    await authorizeApi(path);

    const permissionSummary = await buildInterfacePermissionSummary(path);
    if (!permissionSummary) {
      return NextResponse.json({ error: '해당 메뉴 설정을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json(permissionSummary, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (e) {
    return authErrorToResponse(e);
  }
}
