import { redirect } from 'next/navigation';

export default function DeptMasterRootPage() {
  // dept-master 폴더로 접근 시 order(발주) 화면으로 즉시 토스
  redirect('/asset/production/dept-master');
}