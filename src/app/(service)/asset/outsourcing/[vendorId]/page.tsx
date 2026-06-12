export default function VendorDetailPage({ params }: { params: { vendorId: string } }) {
    const { vendorId } = params;
  
    return (
      <div className="flex h-full">
        {/* 좌측 사이드바: 5개 업체 리스트 (컴포넌트로 분리 추천) */}
        <aside className="w-64 border-r border-slate-200">
          {/* VendorSideMenu 컴포넌트 */}
        </aside>
        
        {/* 우측 콘텐츠: 상세 탭 (제본/비품/정산) */}
        <main className="flex-1 p-6">
          <h2 className="text-xl font-black">{vendorId} 상세 페이지</h2>
          {/* VendorDetailTabs 컴포넌트 */}
        </main>
      </div>
    );
  }