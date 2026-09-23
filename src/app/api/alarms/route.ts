import { NextResponse } from 'next/server';
import { authErrorToResponse, requireSessionUser } from '@/lib/server-auth-guard';
import { ALARM_SNOOZE_DAYS, SNOOZABLE_ALARM_IDS } from '@/lib/alarm-snooze';
import {
  isAlarmDismissed,
  mergeCountMaps,
  mapsDiffer,
  parseAlarmCountMap,
  pruneStampsToActive,
  serializeAlarmCountMap,
  stampOf,
  type AlarmCountStamp,
} from '@/lib/alarm-prefs';
import {
  buildHomeAlarms,
  parseAlarmSnoozes,
} from '@/lib/home-alarms';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function readUserAlarmPrefs(userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ alarm_seen: unknown; alarm_dismisses: unknown; alarm_snoozes: unknown }>
  >`
    SELECT "alarm_seen", "alarm_dismisses", "alarm_snoozes"
    FROM "User" WHERE id = ${userId} LIMIT 1
  `;
  const row = rows[0];
  return {
    seen: parseAlarmCountMap(row?.alarm_seen),
    dismisses: parseAlarmCountMap(row?.alarm_dismisses),
    snoozes: parseAlarmSnoozes(row?.alarm_snoozes),
  };
}

async function writeAlarmSeen(userId: string, next: AlarmCountStamp) {
  const payload = serializeAlarmCountMap(next);
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "alarm_seen" = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
    JSON.stringify(payload),
    userId
  );
  return payload;
}

async function writeAlarmDismisses(userId: string, next: AlarmCountStamp) {
  const payload = serializeAlarmCountMap(next);
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "alarm_dismisses" = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
    JSON.stringify(payload),
    userId
  );
  return payload;
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const [rawItems, prefs] = await Promise.all([
      buildHomeAlarms(user as any),
      readUserAlarmPrefs(user.id),
    ]);

    const activeIds = rawItems.map((item) => item.id);

    // 배송 대기함 구형식(건수만) ✕/확인은 재제출(1→0→1)과 구분 불가 → 한 번 비움
    const seenMigrated = { ...prefs.seen };
    const dismissesMigrated = { ...prefs.dismisses };
    for (const id of [...Object.keys(seenMigrated), ...Object.keys(dismissesMigrated)]) {
      if (!id.startsWith('sv-del-pending')) continue;
      if (seenMigrated[id] && (seenMigrated[id].at || 0) <= 0) delete seenMigrated[id];
      if (dismissesMigrated[id] && (dismissesMigrated[id].at || 0) <= 0) {
        delete dismissesMigrated[id];
      }
    }

    const prunedSeen = pruneStampsToActive(seenMigrated, activeIds);
    const prunedDismisses = pruneStampsToActive(dismissesMigrated, activeIds);

    // 대기 0건이 된 알람의 ✕/확인 스탬프는 DB에서도 제거(재제출 시 다시 뜨게)
    if (
      mapsDiffer(prunedSeen, prefs.seen) ||
      mapsDiffer(prunedDismisses, prefs.dismisses)
    ) {
      void Promise.all([
        writeAlarmSeen(user.id, prunedSeen),
        writeAlarmDismisses(user.id, prunedDismisses),
      ]).catch(() => {});
    }

    // ✕ 삭제분은 서버에서 제외 — 클라이언트가 놓쳐도 재로그인 시 안 보임
    const items = rawItems.filter((item) => !isAlarmDismissed(item, prunedDismisses));
    const total = items.reduce((sum, item) => sum + item.count, 0);

    return NextResponse.json({
      total,
      items,
      /** count>0 인 알람 id — 클라이언트가 로컬 스탬프 stale 제거에 사용 */
      activeIds,
      seen: prunedSeen,
      dismisses: prunedDismisses,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[alarms GET]', error);
    return NextResponse.json({ error: '알람을 불러오지 못했습니다.' }, { status: 500 });
  }
}

/** seen | dismiss | sync | snooze */
export async function POST(req: Request) {
  try {
    const user = await requireSessionUser();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim();
    const id = String(body?.id || '').trim();

    const isSnooze =
      action === 'snooze' || (!action && id && body?.days != null);

    if (action === 'sync') {
      const prefs = await readUserAlarmPrefs(user.id);
      const incomingSeen = parseAlarmCountMap(body?.seen);
      const incomingDismisses = parseAlarmCountMap(body?.dismisses);
      // 클라이언트가 구형식 배송대기 확인/삭제를 다시 올리지 못하게
      for (const id of Object.keys(incomingSeen)) {
        if (!id.startsWith('sv-del-pending')) continue;
        if ((incomingSeen[id]?.at || 0) <= 0) delete incomingSeen[id];
      }
      for (const id of Object.keys(incomingDismisses)) {
        if (!id.startsWith('sv-del-pending')) continue;
        if ((incomingDismisses[id]?.at || 0) <= 0) delete incomingDismisses[id];
      }
      const nextSeen = mergeCountMaps(prefs.seen, incomingSeen);
      const nextDismisses = mergeCountMaps(prefs.dismisses, incomingDismisses);
      // 서버에 남아 있는 구형식도 정리
      for (const id of Object.keys(nextSeen)) {
        if (!id.startsWith('sv-del-pending')) continue;
        if ((nextSeen[id]?.at || 0) <= 0) delete nextSeen[id];
      }
      for (const id of Object.keys(nextDismisses)) {
        if (!id.startsWith('sv-del-pending')) continue;
        if ((nextDismisses[id]?.at || 0) <= 0) delete nextDismisses[id];
      }
      const [seen, dismisses] = await Promise.all([
        writeAlarmSeen(user.id, nextSeen),
        writeAlarmDismisses(user.id, nextDismisses),
      ]);
      return NextResponse.json({ ok: true, action: 'sync', seen, dismisses });
    }

    if (action === 'seen' || action === 'dismiss') {
      if (!id) {
        return NextResponse.json({ error: '알람 id가 필요합니다.' }, { status: 400 });
      }
      const stamp = stampOf({ count: body?.count, at: body?.at });

      const prefs = await readUserAlarmPrefs(user.id);
      if (action === 'seen') {
        const merged = mergeCountMaps(prefs.seen, { [id]: stamp });
        const seen = await writeAlarmSeen(user.id, merged);
        return NextResponse.json({
          ok: true,
          action,
          id,
          count: merged[id]?.count ?? stamp.count,
          at: merged[id]?.at ?? stamp.at,
          seen,
        });
      }

      const merged = mergeCountMaps(prefs.dismisses, { [id]: stamp });
      const dismisses = await writeAlarmDismisses(user.id, merged);
      return NextResponse.json({
        ok: true,
        action,
        id,
        count: merged[id]?.count ?? stamp.count,
        at: merged[id]?.at ?? stamp.at,
        dismisses,
      });
    }

    if (isSnooze) {
      if (!id || !SNOOZABLE_ALARM_IDS.has(id)) {
        return NextResponse.json({ error: '재알림을 지원하지 않는 알람입니다.' }, { status: 400 });
      }

      const daysRaw = Number(body?.days);
      const days =
        Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 90
          ? Math.floor(daysRaw)
          : ALARM_SNOOZE_DAYS;
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const untilIso = until.toISOString();

      const prefs = await readUserAlarmPrefs(user.id);
      const nextMap: Record<string, string> = {};
      const now = Date.now();
      for (const [k, t] of Object.entries(prefs.snoozes)) {
        if (t > now) nextMap[k] = new Date(t).toISOString();
      }
      nextMap[id] = untilIso;

      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "alarm_snoozes" = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
        JSON.stringify(nextMap),
        user.id
      );

      return NextResponse.json({ ok: true, action: 'snooze', id, until: untilIso, days });
    }

    return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[alarms POST]', error);
    return NextResponse.json({ error: '알람 설정을 저장하지 못했습니다.' }, { status: 500 });
  }
}
