import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';
import { getKSTDateString } from '@/utils/dateUtils';
import { nextBusinessCardPostNumber } from '@/lib/businesscard-post-number';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/businesscard/my-page';

const WRITABLE_FIELDS = [
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

function pickWritable(body: Record<string, unknown>) {
  const data: Record<string, string | number | null> = {};
  for (const key of WRITABLE_FIELDS) {
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

function sessionEmail(user: { email?: string | null }) {
  return String(user?.email || '').trim().toLowerCase();
}

function canSelfCancel(status: string | null | undefined) {
  const s = String(status || '').trim();
  return s === '대기중' || s === '반려';
}

/** 본인 명함 신청 이력 — Access */
export async function GET() {
  try {
    const auth = await authorizeApi(MENU_PATH);
    const emailRaw = String(auth.user.email || '').trim();
    if (!emailRaw) {
      return NextResponse.json({ message: '인증 정보가 누락되었습니다.' }, { status: 400 });
    }

    const myRequests = await prisma.businessCardRequest.findMany({
      where: { userEmail: { equals: emailRaw, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        postNumber: true,
        userEmail: true,
        createdAt: true,
        isArchived: true,
        userName: true,
        applyDate: true,
        processDate: true,
        addressId: true,
        deptHead: true,
        deptName: true,
        title: true,
        additionalKo: true,
        quantity: true,
        mobile: true,
        phone: true,
        email: true,
        zipCode: true,
        addressKo: true,
        fax: true,
        userNameEn: true,
        deptHeadEn: true,
        deptNameEn: true,
        titleEn: true,
        additionalEn: true,
        addressEn: true,
        mobileEn: true,
        phoneEn: true,
        faxEn: true,
        emailEn: true,
        userStatus: true,
        adminStatus: true,
        adminFeedback: true,
        orderGroupId: true,
        updatedAt: true,
        processedBy: true,
        processedAt: true,
        isModifiedByAdmin: true,
        adminMemo: true,
        adminModifierName: true,
        adminModifiedAt: true,
        applicantType: true,
        applicantName: true,
        applicantEmail: true,
      },
    });

    return NextResponse.json(
      myRequests.map((r) => ({
        ...r,
        applicantType: r.applicantType || '본인',
        applicantName: r.applicantName || null,
      })),
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/my-page GET]', error);
    return NextResponse.json({ message: '데이터 로드 실패' }, { status: 500 });
  }
}

/** 신규 신청 / id 있으면 본인 레코드 수정 — Edit */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const emailRaw = String(auth.user.email || '').trim();
    const emailKey = sessionEmail(auth.user);
    if (!emailRaw || !emailKey) {
      return NextResponse.json({ message: '인증 정보가 누락되었습니다.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : '';
    const writable = pickWritable(body as Record<string, unknown>);

    if (id) {
      const existing = await prisma.businessCardRequest.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ message: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (sessionEmail({ email: existing.userEmail }) !== emailKey) {
        return NextResponse.json({ message: '본인 신청만 수정할 수 있습니다.' }, { status: 403 });
      }
      if (!canSelfCancel(existing.adminStatus)) {
        return NextResponse.json({ message: '대기중·반려 상태에서만 수정할 수 있습니다.' }, { status: 400 });
      }

      const updatedRequest = await prisma.businessCardRequest.update({
        where: { id },
        data: {
          ...writable,
          adminStatus: '대기중',
        },
      });
      return NextResponse.json(updatedRequest);
    }

    const todayStr = getKSTDateString();
    const displayName = String(writable.userName || auth.user.name || '').trim() || null;
    const postNumberStr = await nextBusinessCardPostNumber(emailRaw);

    const newRequest = await prisma.businessCardRequest.create({
      data: {
        ...writable,
        postNumber: postNumberStr,
        applyDate: todayStr,
        userEmail: emailRaw,
        userStatus: '신청완료',
        adminStatus: '대기중',
        applicantType: '본인',
        applicantName: displayName,
        applicantEmail: emailRaw,
      } as any,
    });

    return NextResponse.json(newRequest);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/my-page POST]', error);
    return NextResponse.json({ message: '트랜잭션 실패', error: error.message }, { status: 500 });
  }
}

/** 대기중·반려 본인 신청 취소 */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const emailKey = sessionEmail(auth.user);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ message: '필수 식별자 누락' }, { status: 400 });
    }

    const existing = await prisma.businessCardRequest.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (sessionEmail({ email: existing.userEmail }) !== emailKey) {
      return NextResponse.json({ message: '본인 신청만 취소할 수 있습니다.' }, { status: 403 });
    }
    if (!canSelfCancel(existing.adminStatus)) {
      return NextResponse.json({ message: '대기중·반려 상태에서만 취소할 수 있습니다.' }, { status: 400 });
    }

    await prisma.businessCardRequest.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/my-page DELETE]', error);
    return NextResponse.json({ message: '삭제 쿼리 실행 실패' }, { status: 500 });
  }
}

/** 본인 신청 수정 — Edit */
export async function PUT(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const emailKey = sessionEmail(auth.user);
    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : '';

    if (!id) {
      return NextResponse.json({ message: '수정할 데이터의 식별자가 없습니다.' }, { status: 400 });
    }

    const existing = await prisma.businessCardRequest.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (sessionEmail({ email: existing.userEmail }) !== emailKey) {
      return NextResponse.json({ message: '본인 신청만 수정할 수 있습니다.' }, { status: 403 });
    }
    if (!canSelfCancel(existing.adminStatus)) {
      return NextResponse.json({ message: '대기중·반려 상태에서만 수정할 수 있습니다.' }, { status: 400 });
    }

    const writable = pickWritable(body as Record<string, unknown>);
    const updatedRequest = await prisma.businessCardRequest.update({
      where: { id },
      data: {
        ...writable,
        adminStatus: '대기중',
      },
    });

    return NextResponse.json(updatedRequest);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/my-page PUT]', error);
    return NextResponse.json({ message: '데이터베이스 업데이트 실패', error: error.message }, { status: 500 });
  }
}
