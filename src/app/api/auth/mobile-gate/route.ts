import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '@/lib/prisma';
import { JWT_SECRET } from '@/lib/jwt';
import { resolveCompanyEmail } from '@/utils/companyEmail';
import { hubTokenCookieOptions } from '@/lib/auth-cookie';

export const dynamic = 'force-dynamic';

/**
 * 모바일 배포 링크용 본인 인증 (설문·실사 공통)
 * - 이메일: 로컬파트 또는 전체 → @kpcqa.or.kr 정규화
 * - method: password | employee_no
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const method = String(body.method || '').trim();
    const credential = String(body.credential || '').trim();
    const normalizedEmail = resolveCompanyEmail(body.email);

    if (!normalizedEmail || !credential) {
      return NextResponse.json({ message: '정보가 일치하지 않습니다.' }, { status: 401 });
    }
    if (method !== 'password' && method !== 'employee_no') {
      return NextResponse.json({ message: '인증 방식을 선택해 주세요.' }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });

    if (!user || user.status !== 'Active') {
      return NextResponse.json({ message: '정보가 일치하지 않습니다.' }, { status: 401 });
    }

    let ok = false;
    if (method === 'password') {
      ok = await bcrypt.compare(credential, user.password);
    } else {
      ok = String(user.employee_no || '').trim() === credential;
    }

    if (!ok) {
      return NextResponse.json({ message: '정보가 일치하지 않습니다.' }, { status: 401 });
    }

    const roles = Array.isArray(user.roles) ? user.roles : [];
    const token = jwt.sign(
      { userId: user.id, email: user.email, roles, role: roles[0] || 'LV_3' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    const response = NextResponse.json({
      success: true,
      user: { name: user.name, email: user.email },
      /** 모바일 HTTP에서 쿠키 미저장 시 클라이언트 sessionStorage 폴백 */
      accessToken: token,
    });
    response.cookies.set('token', token, hubTokenCookieOptions());
    return response;
  } catch (error) {
    console.error('[mobile-gate]', error);
    return NextResponse.json({ message: '인증 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
