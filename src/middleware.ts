import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;

  // 로그인, 회원가입, API, 정적 파일은 통과
  if (
    pathname.includes('/login') || 
    pathname.includes('/signup') || 
    pathname.startsWith('/api/') || 
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // 토큰 없으면 로그인으로 강제 이동
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};