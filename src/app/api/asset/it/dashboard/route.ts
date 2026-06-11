import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const items = await prisma.iTAsset.findMany({ where: { is_active: true } });
    
    // 🚀 시스템 설정(기준일) 가져오기
    const config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    const audit_baseline = config?.audit_baseline || "";

    const stats = {
      total: items.length,
      hw: items.filter((i: any) => String(i.category).includes('HW') || String(i.category).includes('하드웨어')).length,
      sw: items.filter((i: any) => String(i.category).includes('SW') || String(i.category).includes('소프트웨어')).length,
      etc: items.filter((i: any) => !String(i.category).includes('HW') && !String(i.category).includes('SW')).length,
    };

    const types = items.reduce((acc: any, cur: any) => {
      const t = cur.it_type || '미분류';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});

    // 🚀 저장된 기준일(audit_baseline)을 바탕으로 실사 진행도 계산
    const auditedCount = items.filter((i: any) => 
      i.last_audit_date && i.last_audit_date >= audit_baseline
    ).length;
    const auditProgress = stats.total > 0 ? Math.round((auditedCount / stats.total) * 100) : 0;

    const sitesData: any = config?.linked_sites || {};
    const notice = sitesData.it_notice?.current || null;

    return NextResponse.json({ 
      items, 
      stats, 
      types, 
      auditProgress, 
      notice, 
      audit_baseline // 🚀 마스터 대시보드가 이 값을 받아서 화면에 표시하게 됩니다.
    });
  } catch (error) {
    console.error('IT Dashboard API Error:', error);
    return NextResponse.json({ error: 'Data fetch failed' }, { status: 500 });
  }
}