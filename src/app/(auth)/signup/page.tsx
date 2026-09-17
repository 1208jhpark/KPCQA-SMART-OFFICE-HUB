import { redirect } from 'next/navigation';

/** 자체 가입 폐지 — /admin/users 신규 추가만 허용 */
export default function SignupRemovedPage() {
  redirect('/login');
}
