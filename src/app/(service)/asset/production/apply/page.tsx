import { redirect } from 'next/navigation';

export default function ApplyRootPage() {
  // apply 폴더로 접근 시 request 화면으로 즉시 토스
  redirect('/asset/production/apply');
}