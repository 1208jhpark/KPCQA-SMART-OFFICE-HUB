import { redirect } from 'next/navigation';

export default function ProductionRootPage() {
  redirect('/asset/production/apply/request');
}
