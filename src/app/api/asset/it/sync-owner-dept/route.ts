import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';
import { isPlaceholderUserLabel, normalizeEmail } from '@/utils/itUserIdentity';

export const dynamic = 'force-dynamic';

const IT_MASTER_WRITE_PATH = '/asset/it/master/dashboard';

/**
 * POST: 담당자(User)의 현재 소속(unit)으로 활성 자산 dept를 재동기화
 * - user_id / user_email로 User를 찾고 unit.unit_name이 있으면 dept 갱신
 * - 공용·담당자 없음·소속 없음·이미 동일 → skip
 */
export async function POST() {
  try {
    await authorizeAnyMenuPaths([IT_MASTER_WRITE_PATH], { requireEditor: true });

    const [assets, users] = await Promise.all([
      prisma.iTAsset.findMany({
        where: {
          is_active: true,
          OR: [{ user_id: { not: null } }, { user_email: { not: null } }],
        },
        select: {
          id: true,
          code: true,
          dept: true,
          user: true,
          user_id: true,
          user_email: true,
        },
      }),
      prisma.user.findMany({
        where: { status: 'Active' },
        select: {
          id: true,
          email: true,
          unit: { select: { unit_name: true } },
        },
      }),
    ]);

    const byId = new Map(users.map((u) => [u.id, u]));
    const byEmail = new Map(
      users
        .filter((u) => normalizeEmail(u.email))
        .map((u) => [normalizeEmail(u.email), u])
    );

    let updated = 0;
    let skippedNoOwner = 0;
    let skippedNoUnit = 0;
    let skippedSame = 0;
    let skippedShared = 0;
    const samples: Array<{ code: string; from: string; to: string }> = [];

    for (const asset of assets) {
      if (isPlaceholderUserLabel(asset.user) && !asset.user_id && !asset.user_email) {
        skippedShared += 1;
        continue;
      }
      if (isPlaceholderUserLabel(asset.user) && !String(asset.user_id || '').trim() && !normalizeEmail(asset.user_email)) {
        skippedShared += 1;
        continue;
      }

      const uid = String(asset.user_id || '').trim();
      const email = normalizeEmail(asset.user_email);
      const owner = (uid && byId.get(uid)) || (email ? byEmail.get(email) : undefined);
      if (!owner) {
        skippedNoOwner += 1;
        continue;
      }

      const nextDept = String(owner.unit?.unit_name || '').trim();
      if (!nextDept) {
        skippedNoUnit += 1;
        continue;
      }

      const prevDept = String(asset.dept || '').trim();
      if (prevDept === nextDept) {
        skippedSame += 1;
        continue;
      }

      await prisma.iTAsset.update({
        where: { id: asset.id },
        data: { dept: nextDept },
      });
      updated += 1;
      if (samples.length < 20) {
        samples.push({
          code: String(asset.code || asset.id),
          from: prevDept || '(빈값)',
          to: nextDept,
        });
      }
    }

    return NextResponse.json({
      updated,
      skipped: {
        sharedOrEmpty: skippedShared,
        noOwner: skippedNoOwner,
        noUnit: skippedNoUnit,
        alreadySame: skippedSame,
      },
      samples,
      message:
        updated > 0
          ? `담당자 소속 기준으로 자산 부서 ${updated}건을 갱신했습니다.`
          : '갱신할 자산이 없습니다. (이미 일치하거나 담당자/소속 없음)',
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/sync-owner-dept POST]', error);
    return NextResponse.json({ message: '부서 동기화에 실패했습니다.' }, { status: 500 });
  }
}
