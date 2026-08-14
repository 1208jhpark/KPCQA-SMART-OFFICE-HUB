import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // ✅ 기존에 만들어둔 공용 인스턴스 사용
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '@/lib/jwt';
import { resolveCompanyEmail } from '@/utils/companyEmail';
import { hubTokenCookieOptions } from '@/lib/auth-cookie';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const normalizedEmail = resolveCompanyEmail(email);

    if (!normalizedEmail || !password) {
      return NextResponse.json({ message: "정보가 일치하지 않습니다." }, { status: 401 });
    }

    // 1. 사용자 찾기 (사내 도메인 정규화)
    const user = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });

    // 2. 사용자 존재 여부 및 비밀번호 검증 (여기서 null 체크가 끝납니다)
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return NextResponse.json({ message: "정보가 일치하지 않습니다." }, { status: 401 });
    }

    // 3. 상태 확인
    if (user.status !== 'Active') {
      return NextResponse.json({ message: "승인 대기 중인 계정입니다." }, { status: 403 });
    }

    // 4. JWT 토큰 생성
    const token = jwt.sign(
      { userId: user.id, email: user.email, roles: user.roles },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // 5. 응답 생성 (user가 확실히 존재함을 TypeScript에게 알려줍니다)
    const mustReset = !!user.must_reset_password;
    const response = NextResponse.json({ 
      message: "성공",
      user: { name: user.name, email: user.email },
      roles: user.roles,
      mustReset,
    });
    
    // 쿠키를 더 단순하고 확실하게 설정 (HTTP 사내망이면 secure=false)
    response.cookies.set('token', token, hubTokenCookieOptions());
    return response;
  } catch (error) {
    console.error("로그인 API 에러:", error);
    return NextResponse.json({ message: "로그인 중 에러 발생" }, { status: 500 });
  }
}