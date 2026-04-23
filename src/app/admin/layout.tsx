'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 상단 관리 메뉴 정의 (01~04)
  const adminMenus = [
    { name: '01. 사용자 관리', path: '/admin/users' },
    { name: '02. 전사 조직 관리', path: '/admin/units' },
    { name: '03. 서비스 인터페이스', path: '/admin/interface' },
    { name: '04. 기초 데이터 마스터', path: '/admin/master-data' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-slate-800">
      {/* 글로벌 상단 내비게이션 (GNB) */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-[100] shadow-sm">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-10">
            
            {/* 🚨 수정: 클릭 시 로그인 화면이 아닌 "/home" 대시보드로 이동 */}
            <Link href="/home" className="group">
              <h1 className="text-blue-600 font-black italic text-xl tracking-tighter cursor-pointer group-hover:text-blue-700 transition-colors flex items-center gap-2">
                <span className="bg-blue-600 text-white w-7 h-7 flex items-center justify-center rounded-lg not-italic text-sm shadow-indigo-200 shadow-lg">H</span>
                HUB Admin
              </h1>
            </Link>
            
            <nav className="flex gap-1">
              {adminMenus.map((menu) => {
                const isActive = pathname.startsWith(menu.path);
                return (
                  <Link 
                    key={menu.path} 
                    href={menu.path}
                    className={`px-5 py-2 rounded-xl text-[13px] font-black transition-all ${
                      isActive 
                        ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600 rounded-b-none' 
                        : 'text-slate-400 hover:text-slate-600 hover:bg-gray-50'
                    }`}
                  >
                    {menu.name}
                  </Link>
                );
              })}
            </nav>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end mr-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">System Status</span>
              <span className="text-[11px] font-bold text-green-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                Operational
              </span>
            </div>
            <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">MASTER ADMIN</span>
          </div>
        </div>
      </header>

      {/* 컨텐츠 영역 */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}