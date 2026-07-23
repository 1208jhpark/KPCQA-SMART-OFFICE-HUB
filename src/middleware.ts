import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. [가장 중요] 로그인 페이지, API 요청, 정적 파일(이미지, CSS 등)은 미들웨어 검사에서 제외합니다.
  // 이 예외 처리가 없으면 로그인 페이지 자체도 무한 리다이렉트에 빠집니다.
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/equipment/verify') ||
    pathname.includes('.') ||
    pathname.startsWith('/_next')
  ) {
    return NextResponse.next();
  }

  // 2. 쿠키에서 인증 토큰 확인 (토큰 이름이 다르면 'token' 부분을 실제 쓰는 이름으로 바꾸세요)
  const token = request.cookies.get('token')?.value;

  // 3. 토큰이 없는데 서비스 권한이 필요한 페이지에 접근하려고 하면 로그인 페이지로 튕겨냅니다.
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

// 미들웨어가 작동할 경로 지정
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};