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
  matcher: [
    /*
     * 아래로 시작하는 경로를 제외한 모든 요청에 미들웨어 적용
     * - api (API 라우트)
     * - _next/static (정적 파일)
     * - _next/image (이미지 최적화 파일)
     * - favicon.ico (파비콘 파일)
     * - survey/public (💥 공개 배포 설문 폼 - 추가)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|survey/public).*)',
  ],
};