import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isPastKSTDeadline } from '@/utils/dateUtils';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
  tryGetSessionUser,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const IT_AUDIT_READ_PATHS = [
  '/asset/it/personal',
  '/asset/it/dept',
  '/asset/it/master/dashboard',
  '/asset/it/master/audit',
] as const;

const IT_AUDIT_WRITE_PATH = '/asset/it/master/audit';

async function autoCloseExpiredAudits() {
  const active = await prisma.iTAudit.findMany({
    where: { status: '진행중' },
    select: { id: true, endDate: true, endTime: true },
  });
  const expiredIds = active
    .filter((a) => isPastKSTDeadline(a.endDate, a.endTime || '23:59'))
    .map((a) => a.id);
  if (expiredIds.length === 0) return 0;

  await prisma.$transaction([
    prisma.iTAudit.updateMany({
      where: { id: { in: expiredIds }, status: '진행중' },
      data: { status: '마감' },
    }),
    prisma.iTAsset.updateMany({
      where: { audit_request_date: { not: null } },
      data: { audit_request_date: null },
    }),
  ]);
  return expiredIds.length;
}

// 1. 실사 내역 로드 (+ 종료시각 경과 시 자동 마감)
export async function GET(req: Request) {
  try {
    await autoCloseExpiredAudits();
    const { searchParams } = new URL(req.url);
    const publicId = String(searchParams.get('id') || '').trim();
    const session = await tryGetSessionUser();

    // 공개 QR: 단건만
    if (!session && publicId) {
      const audit = await prisma.iTAudit.findUnique({
        where: { id: publicId },
        include: { responses: true },
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

    const session = await tryGetSessionUser();
    const publicEmail = String(body.publicAuditEmail || '').trim();
    const responsesPayload = data.responses;

    // 공개 QR: 응답 upsert만 허용
    if (!session && publicEmail && responsesPayload?.upsert) {
      const upsert = responsesPayload.upsert;
      const userEmail = String(upsert?.create?.userEmail || upsert?.update?.userEmail || publicEmail).trim();
      if (userEmail.toLowerCase() !== publicEmail.toLowerCase()) {
        return NextResponse.json({ error: '이메일 불일치' }, { status: 403 });
      }
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

    // 로그인 사용자: 본인 실사 응답 upsert (마스터 Edit 불필요)
    if (session && responsesPayload?.upsert) {
      await authorizeAnyMenuPaths([...IT_AUDIT_READ_PATHS]);
      const upsert = responsesPayload.upsert;
      const userEmail = String(
        upsert?.create?.userEmail || upsert?.update?.userEmail || session.email || ''
      ).trim();
      const sessionEmail = String(session.email || '').trim().toLowerCase();
      if (!userEmail || userEmail.toLowerCase() !== sessionEmail) {
        return NextResponse.json({ error: '본인 실사 응답만 기록할 수 있습니다.' }, { status: 403 });
      }
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
    const audit = await prisma.iTAudit.update({
      where: { id },
      data: patchData,
    });

    if (patchData.status === '마감') {
      await prisma.iTAsset.updateMany({
        where: { audit_request_date: { not: null } },
        data: { audit_request_date: null },
      });
    }

    return NextResponse.json(audit);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Audit PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update audit' }, { status: 500 });
  }
}

// 4. 실사 영구 삭제 — LV_1
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

    await prisma.iTAudit.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Audit DELETE Error:', error);
    return NextResponse.json({ error: 'Failed to delete audit' }, { status: 500 });
  }
}
