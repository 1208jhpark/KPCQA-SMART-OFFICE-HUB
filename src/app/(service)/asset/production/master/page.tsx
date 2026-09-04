import { redirect } from 'next/navigation';

export default function ProductionMasterRootPage() {
  redirect('/asset/production/master/dashboard');
}