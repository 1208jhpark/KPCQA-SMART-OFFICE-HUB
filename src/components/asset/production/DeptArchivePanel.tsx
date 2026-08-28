'use client';

import React from 'react';
import ProductionDeptShell from '@/components/asset/production/ProductionDeptShell';

export default function DeptArchivePanel() {
  return (
    <ProductionDeptShell pageHint="정산 마감·검수 완료 건을 부서 보관함으로 이관합니다. (추후 구현)">
      <div className="w-full flex flex-col items-center justify-center p-20 bg-white min-h-[320px] rounded-[2.5rem] border border-dashed border-slate-300">
        <span className="text-4xl mb-4">📁</span>
        <h2 className="text-xl font-black text-slate-700 tracking-tight mb-2">정산 보관함</h2>
        <p className="text-sm font-medium text-slate-500 text-center leading-relaxed">
          정산승인(VERIFIED) 및 아카이브 완료 건을 조회하는 화면이 이곳에 구성됩니다.
        </p>
      </div>
    </ProductionDeptShell>
  );
}
