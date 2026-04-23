import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    // 1. 사용자 찾기
    const user = await prisma.user.findUnique({ where: { email } });

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
    const response = NextResponse.json({ 
      message: "성공",
      user: { name: user.name, email: user.email },
      roles: user.roles 
    });
    
    // 쿠키를 더 단순하고 확실하게 설정
response.cookies.set('token', token, {
  httpOnly: true,
  secure: false, // 로컬 개발 환경에서는 false가 더 안정적입니다.
  sameSite: 'lax',
  path: '/', 
  maxAge: 60 * 60 * 24
});
    return response;
  } catch (error) {
    console.error("로그인 API 에러:", error);
    return NextResponse.json({ message: "로그인 중 에러 발생" }, { status: 500 });
  }
}