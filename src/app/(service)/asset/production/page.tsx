import { redirect } from 'next/navigation';

export default function ProductionRootPage() {
  // 상위 루트 주소로 접근 시, 가장 기본이 되는 첫 번째 하위 메뉴로 즉시 리다이렉트
  redirect('/asset/production/apply');
}