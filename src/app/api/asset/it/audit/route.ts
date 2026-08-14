import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getKSTDateString, isPastKSTDeadline } from '@/utils/dateUtils';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
  tryGetSessionUser,
} from '@/lib/server-auth-guard';
import { assetInAnyAuditTarget, auditTargetsOverlap } from '@/utils/itAuditTarget';

export const dynamic = 'force-dynamic';

const IT_AUDIT_READ_PATHS = [
  '/asset/it/personal',
  '/asset/it/dept',
  '/asset/it/master/dashboard',
  '/asset/it/master/audit',
] as const;

const IT_AUDIT_WRITE_PATH = '/asset/it/master/audit';

/** 마감·중단된 실사(들)의 대상범위에 해당하는 자산만 독촉(audit_request_date) 해제 */
async function clearNudgeDatesForAuditTargets(targets: string[]) {
  const scoped = targets.map((t) => String(t || '').trim()).filter(Boolean);
  if (scoped.length === 0) return;

  const [units, nudged] = await Promise.all([
    prisma.orgUnit.findMany({
      where: { is_deleted: false },
      select: { id: true, unit_name: true, parent_id: true },
    }),
    prisma.iTAsset.findMany({
      where: { is_active: true, audit_request_date: { not: null } },
      select: { id: true, dept: true },
    }),
  ]);

  const ids = nudged
    .filter((a) => assetInAnyAuditTarget(a.dept, scoped, units))
    .map((a) => a.id);
  if (ids.length === 0) return;

  await prisma.iTAsset.updateMany({
    where: { id: { in: ids } },
    data: { audit_request_date: null },
  });
}

/** 진행중 실사와 대상범위가 겹치면 에러 메시지 반환, 없으면 null */
async function overlappingRunningMessage(target: string, excludeId?: string) {
  const units = await prisma.orgUnit.findMany({
    where: { is_deleted: false },
    select: { id: true, unit_name: true, parent_id: true },
  });
  const running = await prisma.iTAudit.findMany({
    where: {
      status: '진행중',
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, title: true, target: true },
  });
  const conflicts = running.filter((a) => auditTargetsOverlap(a.target, target, units));
  if (conflicts.length === 0) return null;
  const names = conflicts.map((a) => `· ${a.title} (${a.target})`).join('\n');
  return `대상범위가 겹치는 진행 중 실사가 있습니다.\n\n${names}`;
}

async function autoCloseExpiredAudits() {
  const active = await prisma.iTAudit.findMany({
    where: { status: '진행중' },
    select: { id: true, endDate: true, endTime: true, target: true },
  });
  const expired = active.filter((a) => isPastKSTDeadline(a.endDate, a.endTime || '23:59'));
  if (expired.length === 0) return 0;

  await prisma.iTAudit.updateMany({
    where: { id: { in: expired.map((a) => a.id) }, status: '진행중' },
    data: { status: '마감' },
  });
  await clearNudgeDatesForAuditTargets(expired.map((a) => a.target));
  return expired.length;
}

function bearerFromRequest(req: Request, bodyAccessToken?: string) {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7).trim();
  return String(bodyAccessToken || '').trim() || undefined;
}

// 1. 실사 내역 로드 (+ 종료시각 경과 시 자동 마감)
export async function GET(req: Request) {
  try {
    await autoCloseExpiredAudits();
    const { searchParams } = new URL(req.url);
    const publicId = String(searchParams.get('id') || '').trim();

    // 공개 배포 링크: id가 있으면 세션 유무와 무관하게 단건만 (응답 이메일 제외)
    if (publicId) {
      const audit = await prisma.iTAudit.findUnique({
        where: { id: publicId },
        select: {
          id: true,
          title: true,
          description: true,
          target: true,
          startDate: true,
          endDate: true,
          endTime: true,
          status: true,
          postDate: true,
        },
      });
      if (!audit) return NextResponse.json({ error: '실사를 찾을 수 없습니다.' }, { status: 404 });
      return NextResponse.json([audit]);
    }

    await authorizeAnyMenuPaths([...IT_AUDIT_READ_PATHS]);
    const audits = await prisma.iTAudit.findMany({
      include: { responses: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(audits);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Audit GET Error:', error);
    return NextResponse.json({ error: 'Failed to load audits' }, { status: 500 });
  }
}

// 2. 신규 실사 생성
export async function POST(req: Request) {
  try {
    await authorizeAnyMenuPaths([IT_AUDIT_WRITE_PATH], { requireEditor: true });
    const data = await req.json();
    const payload = {
      ...data,
      endTime: (data.endTime || '23:59').trim() || '23:59',
    };
    delete payload.responses;
    delete payload.id;
    delete payload.createdAt;
    delete payload.updatedAt;

    const startDate = String(payload.startDate || '').trim();
    const endDate = String(payload.endDate || '').trim();
    const endTime = String(payload.endTime || '23:59').trim() || '23:59';
    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json({ error: '시작일이 종료일보다 늦을 수 없습니다.' }, { status: 400 });
    }

    const status = String(payload.status || '작성중');
    if (
      (status === '작성중' || status === '게시중단') &&
      endDate &&
      isPastKSTDeadline(endDate, endTime)
    ) {
      return NextResponse.json(
        {
          error:
            '종료 시각이 이미 지났습니다. 종료일·마감 시각을 수정한 뒤 저장해 주세요.',
        },
        { status: 400 }
      );
    }

    if (status === '진행중') {
      if (endDate && isPastKSTDeadline(endDate, endTime)) {
        payload.endDate = getKSTDateString();
        payload.endTime = '23:59';
      }
      const overlapMsg = await overlappingRunningMessage(String(payload.target || ''));
      if (overlapMsg) return NextResponse.json({ error: overlapMsg }, { status: 409 });
    }

    const audit = await prisma.iTAudit.create({ data: payload });
    return NextResponse.json(audit);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Audit POST Error:', error);
    return NextResponse.json({ error: 'Failed to create audit' }, { status: 500 });
  }
}

// 3. 실사 상태 업데이트 (배포, 마감, 보관 등) + 공개 응답 기록
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const session = await tryGetSessionUser(bearerFromRequest(req, body.accessToken));
    const publicEmail = String(body.publicAuditEmail || '').trim();
    const responsesPayload = data.responses;

    // 공개/본인 실사 응답: 세션 필수 (mobile-gate 또는 Hub 로그인)
    if (responsesPayload?.upsert) {
      if (!session?.email) {
        return NextResponse.json(
          { error: '본인 인증(세션)이 필요합니다. 배포 링크에서 다시 인증해 주세요.' },
          { status: 401 }
        );
      }
      const sessionEmail = String(session.email).trim();
      if (publicEmail && publicEmail.toLowerCase() !== sessionEmail.toLowerCase()) {
        return NextResponse.json({ error: '인증된 계정과 요청 이메일이 일치하지 않습니다.' }, { status: 403 });
      }
      const upsert = responsesPayload.upsert;
      const claimed = String(
        upsert?.create?.userEmail || upsert?.update?.userEmail || publicEmail || sessionEmail
      ).trim();
      if (claimed.toLowerCase() !== sessionEmail.toLowerCase()) {
        return NextResponse.json({ error: '본인 실사 응답만 기록할 수 있습니다.' }, { status: 403 });
      }
      const userEmail = sessionEmail;
      const audit = await prisma.iTAudit.findUnique({ where: { id } });
      if (!audit || audit.status !== '진행중') {
        return NextResponse.json({ error: '진행 중 실사만 응답할 수 있습니다.' }, { status: 403 });
      }
      await prisma.iTAuditResponse.upsert({
        where: { auditId_userEmail: { auditId: id, userEmail } },
        update: {
          isDone: !!upsert?.update?.isDone,
          date: upsert?.update?.date || upsert?.create?.date || null,
        },
        create: {
          auditId: id,
          userEmail,
          isDone: !!upsert?.create?.isDone,
          date: upsert?.create?.date || null,
        },
      });
      const refreshed = await prisma.iTAudit.findUnique({
        where: { id },
        include: { responses: true },
      });
      return NextResponse.json(refreshed);
    }

    await authorizeAnyMenuPaths([IT_AUDIT_WRITE_PATH], { requireEditor: true });
    if (data.endTime !== undefined) {
      data.endTime = String(data.endTime || '23:59').trim() || '23:59';
    }
    const { responses: _responses, createdAt: _c, updatedAt: _u, publicAuditEmail: _e, ...patchData } =
      data;

    const current = await prisma.iTAudit.findUnique({
      where: { id },
      select: { endDate: true, endTime: true, status: true, target: true, startDate: true },
    });
    if (!current) {
      return NextResponse.json({ error: '실사를 찾을 수 없습니다.' }, { status: 404 });
    }

    const nextStart = String(patchData.startDate ?? current.startDate ?? '').trim();
    const nextEnd = String(patchData.endDate ?? current.endDate ?? '').trim();
    const nextEndTime = String(
      patchData.endTime ?? current.endTime ?? '23:59'
    ).trim() || '23:59';
    if (nextStart && nextEnd && nextStart > nextEnd) {
      return NextResponse.json({ error: '시작일이 종료일보다 늦을 수 없습니다.' }, { status: 400 });
    }

    const nextStatus = String(patchData.status ?? current.status ?? '작성중');
    if (
      (nextStatus === '작성중' || nextStatus === '게시중단') &&
      nextEnd &&
      isPastKSTDeadline(nextEnd, nextEndTime)
    ) {
      return NextResponse.json(
        {
          error:
            '종료 시각이 이미 지났습니다. 종료일·마감 시각을 수정한 뒤 저장해 주세요.',
        },
        { status: 400 }
      );
    }

    // 진행중(배포·마감취소·수정): 종료시각이 이미 지났으면 당일 23:59로 연장
    let deadlineExtended = false;
    const becomingRunning = patchData.status === '진행중';
    const stayingRunning =
      current.status === '진행중' &&
      (patchData.status === undefined || patchData.status === '진행중');
    if (becomingRunning || stayingRunning) {
      const endDateCheck = String(patchData.endDate || current.endDate || '').trim();
      const endTimeCheck =
        String(patchData.endTime || current.endTime || '23:59').trim() || '23:59';
      if (endDateCheck && isPastKSTDeadline(endDateCheck, endTimeCheck)) {
        patchData.endDate = getKSTDateString();
        patchData.endTime = '23:59';
        deadlineExtended = true;
      }
      const nextTarget = String(patchData.target ?? current.target ?? '');
      const overlapMsg = await overlappingRunningMessage(nextTarget, id);
      if (overlapMsg) return NextResponse.json({ error: overlapMsg }, { status: 409 });
    }

    const audit = await prisma.iTAudit.update({
      where: { id },
      data: patchData,
    });

    if (patchData.status === '마감' || patchData.status === '게시중단') {
      await clearNudgeDatesForAuditTargets([
        String(audit.target || current.target || patchData.target || ''),
      ]);
    }

    return NextResponse.json({ ...audit, deadlineExtended });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Audit PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update audit' }, { status: 500 });
  }
}

// 4. 실사 영구 삭제 — LV_1 · 보관됨만
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths([IT_AUDIT_WRITE_PATH], { requireEditor: true });
    const roles = Array.isArray(auth.user?.roles) ? auth.user.roles : [];
    const lv1 = roles.some((r: any) => String(r).includes('LV_1'));
    if (!lv1) {
      return NextResponse.json({ error: '영구 삭제는 LV_1 권한이 필요합니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const existing = await prisma.iTAudit.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: '실사를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (existing.status !== '보관됨') {
      return NextResponse.json(
        { error: '보관함의 이력만 영구 삭제할 수 있습니다. 먼저 보관함으로 이동하세요.' },
        { status: 403 }
      );
    }

    await prisma.iTAudit.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Audit DELETE Error:', error);
    return NextResponse.json({ error: 'Failed to delete audit' }, { status: 500 });
  }
}
