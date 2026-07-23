import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { requireSessionUser, authErrorToResponse } from '@/lib/server-auth-guard';

const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: Request) {
  try {
    const user = await requireSessionUser();
    const { currentPassword, newPassword, confirmPassword } = await req.json();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json({ message: '모든 항목을 입력해 주세요.' }, { status: 400 });
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ message: '새 비밀번호가 일치하지 않습니다.' }, { status: 400 });
    }

    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { message: `새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.' },
        { status: 400 }
      );
    }

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      return NextResponse.json({ message: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    const ok = await bcrypt.compare(String(currentPassword), dbUser.password);
    if (!ok) {
      return NextResponse.json({ message: '현재 비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    const hashed = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        must_reset_password: false,
        password_reset_requested: false,
        password_reset_requested_at: null,
      },
    });

    return NextResponse.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (error) {
    if (error instanceof Error && ['UNAUTHORIZED', 'UNAUTHORIZED_EXPIRED', 'USER_NOT_FOUND'].includes(error.message)) {
      return authErrorToResponse(error);
    }
    console.error('[change-password]', error);
    return NextResponse.json({ message: '비밀번호 변경 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
