import { redirect } from 'next/navigation';
export default function AdminPage() {
  redirect('/admin/users'); // 01.사용자 관리로 강제 리다이렉트
}