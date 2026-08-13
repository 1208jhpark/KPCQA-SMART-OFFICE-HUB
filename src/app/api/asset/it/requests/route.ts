import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getKSTDateString } from '@/utils/dateUtils';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
  tryGetSessionUser,
} from '@/lib/server-auth-guard';
import { checkMenuPermission } from '@/lib/permission-utils';
import {
  normalizeEmail,
  prismaAssetOwnerWhere,
  prismaRequesterWhere,
  requestMatchesIdentity,
  toItIdentity,
} from '@/utils/itUserIdentity';

export const dynamic = 'force-dynamic';

const IT_REQ_READ_PATHS = [
  '/asset/it/personal',
  '/asset/it/dept',
  '/asset/it/master/dashboard',
  '/asset/it/master/archive',
  '/asset/it/master/audit',
  '/asset/it/master/requests',
] as const;

const IT_MASTER_REQ_PATHS = [
  '/asset/it/master/requests',
  '/asset/it/master/dashboard',
] as const;

const getRequestModel = () => {
  const p = prisma as any;
  const model = p.iTRequest || p.itRequest || p.ITRequest || p.itrequest;
  if (!model) {
    throw new Error('DB 연결은 성공했으나 ITRequest 테이블을 찾을 수 없습니다.');
  }
  return model;
};

function isLv1(user: any) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.some((r: any) => String(r).includes('LV_1'));
}

function hasMenuAccess(auth: any, path: string) {
  const clean = String(path || '').toLowerCase();
  const menu = (auth.allMenus || []).find(
    (m: any) => String(m.path || '').toLowerCase() === clean
  );
  if (!menu) return false;
  const userForPerm = {
    id: auth.user.id,
    email: auth.user.email,
    roles: auth.user.roles,
    dept_id: auth.user.unit_id,
    unit: auth.user.unit,
  };
  return checkMenuPermission(userForPerm, menu, auth.allMenus || [], auth.unitsList || []).hasAccess;
}

async function findUserByEmail(email: string) {
  const raw = String(email || '').trim();
  if (!raw) return null;
  const normalized = normalizeEmail(raw);
  return (
    (await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, name: true, email: true, unit: { select: { unit_name: true } } },
    })) ||
    (await prisma.user.findFirst({
      where: { email: { equals: raw, mode: 'insensitive' } },
      select: { id: true, name: true, email: true, unit: { select: { unit_name: true } } },
    }))
  );
}

async function requestsVisibleToUser(userLike: { id?: string; name?: string; email?: string }) {
  const model = getRequestModel();
  const identity = toItIdentity(userLike);
  if (!identity) return [];

  const assetCodes = (
    await prisma.iTAsset.findMany({
      where: { is_active: true, ...prismaAssetOwnerWhere(identity) },
      select: { code: true },
    })
  )
    .map((a) => a.code)
    .filter(Boolean);

  return model.findMany({
    where: {
      OR: [
        ...((prismaRequesterWhere(identity) as any).OR || []),
        ...(assetCodes.length ? [{ assetCode: { in: assetCodes } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const publicEmail = String(searchParams.get('email') || '').trim();
    const session = await tryGetSessionUser();

    if (!session && publicEmail) {
      const u = await findUserByEmail(publicEmail);
      if (!u) return NextResponse.json({ error: '가입된 정보가 없습니다.' }, { status: 403 });
      const list = await requestsVisibleToUser(u);
      return NextResponse.json(list);
    }

    const auth = await authorizeAnyMenuPaths([...IT_REQ_READ_PATHS]);
    const masterVisible =
      IT_MASTER_REQ_PATHS.some((p) => hasMenuAccess(auth, p)) ||
      hasMenuAccess(auth, '/asset/it/master/audit') ||
      isLv1(auth.user);

    const model = getRequestModel();
    if (masterVisible) {
      const requests = await model.findMany({ orderBy: { createdAt: 'desc' } });
      return NextResponse.json(requests);
    }

    const list = await requestsVisibleToUser(auth.user);
    return NextResponse.json(list);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('IT 요청목록 조회 실패:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      assetCode,
      assetType,
      content,
      requester,
      dept,
      status,
      requestDate,
      assetInfo,
      adminOpinion,
      responderName,
      responderDept,
      publicAuditEmail,
    } = body;

    const finalStatus = status || '의견전송';
    const isAdminOutbound =
      finalStatus === '관리자 의견발송' ||
      finalStatus === '관리자 답변' ||
      finalStatus === '관리자 확인완료' ||
      finalStatus === '처리완료';

    const session = await tryGetSessionUser();
    const publicEmail = String(publicAuditEmail || '').trim();
    let requesterIdentity = toItIdentity(session);

    if (isAdminOutbound) {
      await authorizeAnyMenuPaths([...IT_MASTER_REQ_PATHS], { requireEditor: true });
      // 관리자 발송: body에 명시된 수신자 identity 우선
      requesterIdentity =
        toItIdentity({
          name: requester,
          email: body.requester_email || body.user_email,
          id: body.requester_id || body.user_id,
        }) || requesterIdentity;
    } else if (!session && publicEmail) {
      const u = await findUserByEmail(publicEmail);
      if (!u) return NextResponse.json({ error: '가입된 정보가 없습니다.' }, { status: 403 });
      requesterIdentity = toItIdentity(u);
      body.requester = u.name;
      body.dept = u.unit?.unit_name || dept;
    } else {
      await authorizeAnyMenuPaths(['/asset/it/personal', ...IT_MASTER_REQ_PATHS]);
    }

    const model = getRequestModel();
    let finalOpinion = adminOpinion || null;
    if (finalOpinion && responderName) {
      finalOpinion = responderDept
        ? `${adminOpinion}:::${responderName}:::${responderDept}`
        : `${adminOpinion}:::${responderName}`;
    }

    const resolvedRequester =
      !isAdminOutbound && session
        ? session.name || requester
        : requesterIdentity?.name || requester;
    const resolvedDept =
      !isAdminOutbound && session
        ? session.unit?.unit_name || dept
        : dept;

    const newRequest = await model.create({
      data: {
        assetCode,
        assetType,
        content: content || '',
        requester: resolvedRequester,
        requester_email: requesterIdentity?.email || normalizeEmail(body.requester_email) || null,
        requester_id: requesterIdentity?.id || String(body.requester_id || '').trim() || null,
        dept: resolvedDept,
        status: finalStatus,
        requestDate: requestDate || getKSTDateString(),
        assetInfo: assetInfo || `${assetCode} / 정보 미상`,
        ...(finalOpinion ? { adminOpinion: finalOpinion } : {}),
        ...(isAdminOutbound ? { completedAt: getKSTDateString() } : {}),
      },
    });

    return NextResponse.json(newRequest, { status: 201 });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('IT 요청사항 저장 실패:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const {
      id,
      adminOpinion,
      responderName,
      responderDept,
      status,
      action,
      emails,
      date,
      content,
      ackedBy,
      ackedDept,
    } = body;

    if (action === 'NUDGE' || id === 'NUDGE_ACTION') {
      await authorizeAnyMenuPaths(['/asset/it/master/dashboard'], { requireEditor: true });
      if ((!emails || emails.length === 0) && (!body.names || body.names.length === 0)) {
        return NextResponse.json({ message: '독촉 대상자 정보가 누락되었습니다.' }, { status: 400 });
      }

      const p = prisma as any;
      const assetModel = p.iTAsset || p.itAsset || p.ITAsset || p.itasset;
      if (!assetModel) throw new Error('IT 자산 마스터 원장 테이블(ITAsset)을 찾을 수 없습니다.');

      const targetEmails = emails || [];
      const targetNames = body.names || [];

      await assetModel.updateMany({
        where: {
          OR: [
            ...(targetEmails.length
              ? [{ user_email: { in: targetEmails.map((e: string) => normalizeEmail(e)) } }]
              : []),
            ...(targetNames.length ? [{ user: { in: targetNames } }] : []),
            ...(targetEmails.length ? [{ user: { in: targetEmails } }] : []),
          ],
        },
        data: {
          audit_request_date: date || getKSTDateString(),
          last_audit_date: null,
          last_audit_by: null,
        },
      });

      return NextResponse.json({ success: true, message: '독촉 기록 및 상태 변환 완료' });
    }

    if (!id) {
      return NextResponse.json(
        { error: "Argument 'where' needs at least one of id arguments." },
        { status: 400 }
      );
    }

    const model = getRequestModel();

    if (action === 'USER_UPDATE_CONTENT' || action === 'USER_ACK') {
      await authorizeAnyMenuPaths(['/asset/it/personal', ...IT_MASTER_REQ_PATHS]);
    } else {
      await authorizeAnyMenuPaths([...IT_MASTER_REQ_PATHS], { requireEditor: true });
    }

    if (action === 'USER_UPDATE_CONTENT') {
      const existing = await model.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: '요청 내역을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (
        existing.status !== '의견전송' &&
        existing.status !== '답변 대기중' &&
        existing.status !== '답변회신'
      ) {
        return NextResponse.json(
          { error: '관리자 답변 이후에는 내용을 수정할 수 없습니다.' },
          { status: 400 }
        );
      }
      if (!content || !String(content).trim()) {
        return NextResponse.json({ error: '요청 내용이 비어 있습니다.' }, { status: 400 });
      }
      const updatedContent = await model.update({
        where: { id },
        data: { content: String(content).trim() },
      });
      return NextResponse.json(updatedContent);
    }

    if (action === 'USER_ACK') {
      const existing = await model.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: '요청 내역을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (
        existing.status !== '관리자 의견발송' &&
        existing.status !== '사용자 확인완료' &&
        existing.status !== '관리자 답변'
      ) {
        return NextResponse.json(
          { error: '확인처리할 수 있는 관리자 요청이 아닙니다.' },
          { status: 400 }
        );
      }
      const ackName = String(ackedBy || '').trim();
      const ackDept = String(ackedDept || '').trim();
      const prevOpinion = String(existing.adminOpinion || '');
      const hasAckMeta = prevOpinion.includes(':::USERACK:::');
      const nextOpinion =
        hasAckMeta || !ackName
          ? prevOpinion
          : `${prevOpinion}:::USERACK:::${ackName}:::${ackDept}`;
      const nextAckStatus = existing.status === '관리자 답변' ? '관리자 답변' : '사용자 확인완료';
      const acked = await model.update({
        where: { id },
        data: {
          status: nextAckStatus,
          ...(nextAckStatus === '사용자 확인완료' ? { completedAt: getKSTDateString() } : {}),
          ...(nextOpinion !== prevOpinion ? { adminOpinion: nextOpinion } : {}),
        },
      });
      return NextResponse.json(acked);
    }

    let finalOpinion = adminOpinion;
    if (responderName) {
      finalOpinion = responderDept
        ? `${adminOpinion}:::${responderName}:::${responderDept}`
        : `${adminOpinion}:::${responderName}`;
    }

    const nextStatus = status || '관리자 확인완료';
    const shouldStampCompleted =
      nextStatus === '관리자 확인완료' ||
      nextStatus === '관리자 의견발송' ||
      nextStatus === '관리자 답변' ||
      nextStatus === '처리완료' ||
      nextStatus === '사용자 확인완료' ||
      nextStatus === '사용자 종료처리';

    const updated = await model.update({
      where: { id },
      data: {
        ...(adminOpinion !== undefined || responderName ? { adminOpinion: finalOpinion } : {}),
        status: nextStatus,
        completedAt: shouldStampCompleted ? getKSTDateString() : null,
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('IT 요청사항 수정 실패:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const idsFromQuery = [
      ...url.searchParams.getAll('id'),
      ...(url.searchParams.get('ids') || '').split(','),
    ]
      .map((v) => String(v || '').trim())
      .filter(Boolean);
    if (idsFromQuery.length === 0) throw new Error('ID 누락');

    const model = getRequestModel();
    const isAdminCancelable = (status: string) =>
      status === '관리자 의견발송' || status === '관리자 답변';

    // 마스터 Edit: LV_1 영구삭제 / 일반 Edit는 관리자 전송 취소만
    try {
      const auth = await authorizeAnyMenuPaths([...IT_MASTER_REQ_PATHS], {
        requireEditor: true,
      });

      if (isLv1(auth.user)) {
        if (idsFromQuery.length === 1) {
          await model.delete({ where: { id: idsFromQuery[0] } });
        } else {
          await model.deleteMany({ where: { id: { in: idsFromQuery } } });
        }
        return NextResponse.json({ success: true, count: idsFromQuery.length });
      }

      // Edit 권한자: 관리자 발송/답변 단건 전송 취소
      if (idsFromQuery.length !== 1) {
        return NextResponse.json(
          { error: '영구 삭제는 LV_1만 가능합니다. 전송 취소는 단건만 가능합니다.' },
          { status: 403 }
        );
      }
      const existing = await model.findUnique({ where: { id: idsFromQuery[0] } });
      if (!existing) return NextResponse.json({ error: '요청 없음' }, { status: 404 });
      if (!isAdminCancelable(String(existing.status || ''))) {
        return NextResponse.json(
          { error: '관리자 문의/답변 전송 건만 취소할 수 있습니다. 영구 삭제는 LV_1만 가능합니다.' },
          { status: 403 }
        );
      }
      await model.delete({ where: { id: idsFromQuery[0] } });
      return NextResponse.json({ success: true, count: 1 });
    } catch {
      /* fall through to personal cancel */
    }

    // 개인: 본인 대기 건 단건 전송 취소만
    const personalAuth = await authorizeAnyMenuPaths(['/asset/it/personal']);
    if (idsFromQuery.length !== 1) {
      return NextResponse.json({ error: '본인 요청 취소는 단건만 가능합니다.' }, { status: 400 });
    }
    const existing = await model.findUnique({ where: { id: idsFromQuery[0] } });
    if (!existing) return NextResponse.json({ error: '요청 없음' }, { status: 404 });
    const identity = toItIdentity(personalAuth.user);
    const okOwner = requestMatchesIdentity(existing, identity);
    const userOwnedPending =
      okOwner &&
      (existing.status === '의견전송' ||
        existing.status === '답변 대기중' ||
        existing.status === '답변회신');
    if (!userOwnedPending) {
      return NextResponse.json({ error: '본인 대기 요청만 취소할 수 있습니다.' }, { status: 403 });
    }
    await model.delete({ where: { id: idsFromQuery[0] } });
    return NextResponse.json({ success: true, count: 1 });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
