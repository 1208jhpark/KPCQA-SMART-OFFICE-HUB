import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getKSTDateString } from '@/utils/dateUtils';
import { nextBusinessCardPostNumber } from '@/lib/businesscard-post-number';
import { authorizeApi, authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/businesscard/master/requests';
const READ_PATHS = [
  '/asset/businesscard/master/requests',
  '/asset/businesscard/master/order',
  '/asset/businesscard/master/archive',
];
const WRITE_PATHS = [
  '/asset/businesscard/master/requests',
  '/asset/businesscard/master/order',
];
const UNREGISTERED_EMAIL = '__unregistered__';

/** 원문(명함 필드) 수정 허용 키 */
const FORM_FIELDS = [
  'userName',
  'userNameEn',
  'deptName',
  'deptNameEn',
  'deptHead',
  'deptHeadEn',
  'title',
  'titleEn',
  'additionalKo',
  'additionalEn',
  'mobile',
  'mobileEn',
  'phone',
  'phoneEn',
  'fax',
  'faxEn',
  'addressId',
  'zipCode',
  'addressKo',
  'addressEn',
  'email',
  'emailEn',
  'quantity',
] as const;

/** 상태·메모 등 프로세스 필드 */
const STATUS_FIELDS = [
  'adminStatus',
  'processDate',
  'userStatus',
  'adminFeedback',
  'isModifiedByAdmin',
  'adminMemo',
  'adminModifiedAt',
  'isArchived',
  'processedBy',
  'processedAt',
] as const;

function actorDisplayName(user: { name?: string | null; email?: string | null } | null | undefined) {
  const name = String(user?.name || '').trim();
  if (name) return name;
  const email = String(user?.email || '').trim();
  return email || null;
}

function pickFormFields(body: Record<string, unknown>) {
  const data: Record<string, string | number | null> = {};
  for (const key of FORM_FIELDS) {
    if (body[key] === undefined) continue;
    if (key === 'quantity') {
      const q = Number(body[key]);
      data.quantity = Number.isFinite(q) && q > 0 ? Math.min(99, Math.round(q)) : 1;
      continue;
    }
    const v = body[key];
    data[key] = v == null ? null : String(v);
  }
  return data;
}

function pickStatusFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of STATUS_FIELDS) {
    if (body[key] === undefined) continue;
    if (key === 'isModifiedByAdmin' || key === 'isArchived') {
      data[key] = Boolean(body[key]);
      continue;
    }
    if (key === 'adminModifiedAt' || key === 'processedAt') {
      const v = body[key];
      if (v == null || v === '') {
        data[key] = null;
      } else {
        const d = new Date(String(v));
        data[key] = Number.isNaN(d.getTime()) ? null : d;
      }
      continue;
    }
    const v = body[key];
    data[key] = v == null ? null : v;
  }
  return data;
}

/** [GET] 전체 신청 내역 — requests/order/archive Access */
export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const allRequests = await prisma.businessCardRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const merged = allRequests.map((r) => ({
      ...r,
      applicantType: r.applicantType || '본인',
      applicantName: r.applicantName || null,
      applicantEmail: r.applicantEmail || null,
    }));

    return NextResponse.json(merged, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('마스터 신청내역 로드 에러:', error);
    return NextResponse.json({ message: '데이터 로드 실패' }, { status: 500 });
  }
}

/** 관리자 대행 신규 신청 */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();
    const targetEmail = String(body.userEmail || '').trim();
    const userEmail =
      targetEmail && !targetEmail.startsWith('__unregistered__')
        ? targetEmail
        : UNREGISTERED_EMAIL;
    const actorName = actorDisplayName(auth.user);
    if (!actorName) {
      return NextResponse.json({ message: '로그인 사용자 정보가 없습니다.' }, { status: 400 });
    }

    const newRequest = await prisma.businessCardRequest.create({
      data: {
        userName: String(body.userName || '').trim(),
        userNameEn: String(body.userNameEn || '').trim(),
        deptHead: String(body.deptHead || '').trim(),
        deptHeadEn: String(body.deptHeadEn || '').trim(),
        deptName: String(body.deptName || '').trim(),
        deptNameEn: String(body.deptNameEn || '').trim(),
        title: String(body.title || '').trim(),
        titleEn: String(body.titleEn || '').trim(),
        additionalKo: body.additionalKo || null,
        additionalEn: body.additionalEn || null,
        mobile: String(body.mobile || '').trim(),
        mobileEn: String(body.mobileEn || '').trim(),
        phone: String(body.phone || '').trim(),
        phoneEn: String(body.phoneEn || '').trim(),
        fax: String(body.fax || '').trim(),
        faxEn: String(body.faxEn || '').trim(),
        email: String(body.email || '').trim(),
        emailEn: String(body.emailEn || '').trim(),
        addressId: body.addressId || null,
        zipCode: String(body.zipCode || '').trim(),
        addressKo: String(body.addressKo || '').trim(),
        addressEn: String(body.addressEn || '').trim(),
        quantity: Math.max(1, Number(body.quantity) || 1),
        userEmail,
        postNumber: await nextBusinessCardPostNumber(userEmail),
        applyDate: getKSTDateString(),
        userStatus: '신청완료',
        adminStatus: '대기중',
        applicantType: '관리자대행',
        applicantName: actorName,
        applicantEmail: auth.user?.email || null,
      },
    });

    return NextResponse.json(newRequest);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/master/requests POST]', error);
    return NextResponse.json({ message: '대행 신청 저장 실패', error: error.message }, { status: 500 });
  }
}

/** [PUT] 관리자 발주 승인·정보 수정 — requests/order Edit */
export async function PUT(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(WRITE_PATHS, { requireEditor: true });
    const payload = (await req.json()) as Record<string, unknown>;
    const id = String(payload.id || '').trim();
    if (!id) {
      return NextResponse.json({ message: 'ID가 누락되었습니다.' }, { status: 400 });
    }

    const hasBatchId = Object.prototype.hasOwnProperty.call(payload, 'batchId');
    const formData = pickFormFields(payload);
    const statusData = pickStatusFields(payload);
    const updateData: Record<string, unknown> = {
      ...formData,
      ...statusData,
      ...(hasBatchId ? { orderGroupId: payload.batchId ? String(payload.batchId) : null } : {}),
    };

    const touchesAdminAudit =
      Boolean(payload.isModifiedByAdmin) ||
      payload.adminMemo !== undefined ||
      payload.adminModifierName !== undefined ||
      payload.adminModifiedAt !== undefined;

    if (touchesAdminAudit) {
      const actorName = actorDisplayName(auth.user);
      if (!actorName) {
        return NextResponse.json({ message: '로그인 사용자 정보가 없습니다.' }, { status: 400 });
      }
      updateData.adminModifierName = actorName;
      if (updateData.adminModifiedAt === undefined) {
        updateData.adminModifiedAt = new Date();
      }
    }

    const updated = await prisma.businessCardRequest.update({
      where: { id },
      data: updateData as any,
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('마스터 상태 업데이트 에러:', error);
    return NextResponse.json({ message: '상태 변경 실패', error: error.message }, { status: 500 });
  }
}

/** 관리자 대행 신청 취소(삭제) */
export async function DELETE(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ message: 'ID가 누락되었습니다.' }, { status: 400 });
    }
    await prisma.businessCardRequest.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/master/requests DELETE]', error);
    return NextResponse.json({ message: '취소 처리 실패', error: error.message }, { status: 500 });
  }
}
