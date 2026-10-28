import { NextResponse } from 'next/server';
import { listDeptAssignees } from '@/lib/dept-assignees';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

/** GET /api/admin/interface/dept-assignees?path=/equipment/it/dept */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const path = String(searchParams.get('path') || '').trim();
    if (!path) {
      return NextResponse.json({ error: 'path 파라미터가 필요합니다.' }, { status: 400 });
    }

    const auth = await authorizeApi(path);
    const unitId = String(auth.user?.unit?.id || auth.user?.unit_id || '').trim();
    if (!unitId) {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }

    const { editorNames } = await listDeptAssignees({
      menuPath: path,
      unitId,
      allMenus: auth.allMenus || [],
      unitsList: auth.unitsList || [],
    });

    return NextResponse.json(
      { editorNames },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (e) {
    return authErrorToResponse(e);
  }
}
