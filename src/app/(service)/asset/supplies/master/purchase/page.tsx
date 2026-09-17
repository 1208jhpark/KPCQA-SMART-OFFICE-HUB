import { redirect } from 'next/navigation';

/** 구 경로 → restock 으로 이전 */
export default function Page() {
  redirect('/asset/supplies/master/restock');
}
