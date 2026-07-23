import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveCompanyEmail } from '@/utils/companyEmail';

/**
 * 비밀번호 초기화 요청 (비로그인)
 * - 이메일 존재 여부와 무관하게 동일 메시지 반환 (계정 열거 방지)
 * - raw SQL로 갱신: Prisma Client 재생성 잠금이 있어도 DB 컬럼만 있으면 동작
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const normalized = resolveCompanyEmail(body?.email);

    if (!normalized) {
      return NextResponse.json({ message: '사내 메일 아이디를 입력해 주세요.' }, { status: 400 });
    }

    // DB에 해당 이메일이 있으면 요청 플래그 설정 (대소문자 무시)
    await prisma.$executeRaw`
      UPDATE "User"
      SET
        "password_reset_requested" = true,
        "password_reset_requested_at" = NOW(),
        "updatedAt" = NOW()
      WHERE LOWER("email") = ${normalized}
    `;

    return NextResponse.json({
      message:
        '초기화 요청이 접수되었습니다. 시스템 관리자가 확인 후 임시 비밀번호를 안내해 드립니다.',
    });
  } catch (error: any) {
    console.error('[request-password-reset]', error?.message || error);
    return NextResponse.json(
      {
        message: '요청 처리 중 오류가 발생했습니다.',
        detail: process.env.NODE_ENV !== 'production' ? String(error?.message || error) : undefined,
      },
      { status: 500 }
    );
  }
}
