import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. 로그인·회원가입·API·정적 자원은 인증 검사 제외
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/equipment/verify') ||
    pathname.startsWith('/m/verify') ||
    pathname.startsWith('/survey/public') ||
    pathname.startsWith('/audit/public') ||
    pathname.includes('.') ||
    pathname.startsWith('/_next')
  ) {
    return NextResponse.next();
  }

  // 2. 쿠키에서 인증 토큰 확인
  const token = request.cookies.get('token')?.value;

  // 3. 미로그인 → Hub 로그인으로 보내고, 원래 경로를 next로 보존
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    const nextPath = `${pathname}${request.nextUrl.search || ''}`;
    if (nextPath && nextPath !== '/') {
      loginUrl.searchParams.set('next', nextPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
