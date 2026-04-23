// src/app/page.tsx
import { redirect } from 'next/navigation';

export default function RootPage() {
  // 사용자가 메인(/)에 접속하면 즉시 로그인(/login) 페이지로 보냅니다.
  redirect('/login');
}