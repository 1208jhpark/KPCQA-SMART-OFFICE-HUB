import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const IT_ARCHIVE_READ = [
  '/asset/it/master/archive',
  '/asset/it/master/dashboard',
] as const;

const IT_ARCHIVE_WRITE = [
  '/asset/it/master/archive',
  '/asset/it/master/dashboard',
] as const;

function isLv1(user: any) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.some((r: any) => String(r).includes('LV_1')) || user?.permissionLevel === 'LV_1';
}

/** 1. 대시보드 [종료 처리] → 아카이브 저장 + 운영 대장에서 제거 (Edit)
 *  운영 자산 레코드를 DB에서 읽어 스냅샷 이관 (복구 시 필드 누락 방지)
 */
export async function POST(req: Request) {
  try {
    await authorizeAnyMenuPaths([...IT_ARCHIVE_WRITE], { requireEditor: true });
    const body = await req.json();
    const assetId = String(body.id || '').trim();
    if (!assetId) {
      return NextResponse.json({ message: 'ID 누락' }, { status: 400 });
    }

    const archive = await prisma.$transaction(async (tx) => {
      const existing = await tx.iTAsset.findUnique({ where: { id: assetId } });
      if (!existing) {
        throw new Error('ASSET_NOT_FOUND');
      }

      const created = await tx.iTAssetArchive.create({
        data: {
          id: existing.id,
          category: existing.category,
          it_type: existing.it_type,
          dept: existing.dept,
          user: existing.user,
          user_email: existing.user_email,
          user_id: existing.user_id,
          code: existing.code,
          model: existing.model,
          sn: existing.sn,
          brand: existing.brand,
          spec: existing.spec,
          is_rental: existing.is_rental,
          rental_months: existing.rental_months ?? 0,
          purchase_price: existing.purchase_price ?? 0,
          monthly_fee: existing.monthly_fee ?? 0,
          in_date: existing.in_date,
          start_date: existing.start_date,
          end_date: existing.end_date,
          first_bill: existing.first_bill,
          cycle: existing.cycle ?? 48,
          memo: existing.memo,
          reg_date: existing.reg_date,
          entry_source: existing.entry_source,
          last_audit_date: existing.last_audit_date,
          last_audit_by: existing.last_audit_by,
          audit_request_date: existing.audit_request_date,
          // 종료 처리 입력값
          status: body.status || '기타',
          reason: body.reason ?? null,
          reseller: body.reseller ?? null,
          resellPrice: body.resellPrice ?? 0,
          terminated_at: body.terminated_at || null,
        },
      });
      await tx.iTAsset.delete({ where: { id: assetId } });
      return created;
    });

    return NextResponse.json(archive);
  } catch (error) {
    if (error instanceof Error && error.message === 'ASSET_NOT_FOUND') {
      return NextResponse.json({ message: '자산을 찾을 수 없습니다.' }, { status: 404 });
    }
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Archive POST Error:', error);
    return NextResponse.json({ message: 'Archive Save Failed' }, { status: 500 });
  }
}

/** 2. 아카이브 목록 */
export async function GET() {
  try {
    await authorizeAnyMenuPaths([...IT_ARCHIVE_READ]);
    const archives = await prisma.iTAssetArchive.findMany({
      orderBy: { terminated_at: 'desc' },
    });
    return NextResponse.json(archives);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json({ message: 'Fetch Failed' }, { status: 500 });
  }
}

/** 3. 아카이브 영구 삭제 — LV_1 전용 */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths([...IT_ARCHIVE_WRITE], { requireEditor: true });
    if (!isLv1(auth.user)) {
      return NextResponse.json(
        { message: '아카이브 영구 삭제는 LV_1만 가능합니다.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const ids = [
      ...searchParams.getAll('id'),
      ...(searchParams.get('ids') || '').split(','),
    ]
      .map((v) => String(v || '').trim())
      .filter(Boolean);
    if (ids.length === 0) return NextResponse.json({ message: 'ID required' }, { status: 400 });

    if (ids.length === 1) {
      await prisma.iTAssetArchive.delete({ where: { id: ids[0] } });
    } else {
      await prisma.iTAssetArchive.deleteMany({ where: { id: { in: ids } } });
    }
    return NextResponse.json({ success: true, count: ids.length });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json({ message: 'Delete Failed' }, { status: 500 });
  }
}
