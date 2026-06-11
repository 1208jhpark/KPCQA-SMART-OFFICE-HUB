import { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import jwt from "jsonwebtoken";
import Link from "next/link";
import prisma from "@/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // 1. 쿠키에서 토큰 가져오기 (Next.js 15 규격)
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  
  if (!token) redirect("/login");

  // 2. JWT 토큰 검증
  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    redirect("/login");
  }

  // 3. 사용자 정보 조회
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId || decoded.id },
  });
  
  if (!user) redirect("/login");

  // 🚀 4. 관리자 권한 확인 (LV_1만 허용, 파싱 버그 수정)
  let rolesArray: string[] = [];
  try {
    // DB의 JSON 데이터를 안전하게 배열로 변환합니다.
    rolesArray = Array.isArray(user.roles) 
      ? (user.roles as string[]) 
      : JSON.parse(user.roles as string);
  } catch (e) {
    rolesArray = ["LV_3"]; // 파싱 실패 시 기본값
  }

  const primaryRole = rolesArray[0] || "LV_3";

  // 🚀 [권한 강화] LV_1이 아니면 무조건 차단 (LV_2 접근 불가)
  if (primaryRole !== "LV_1") { 
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-slate-50">
        <div className="text-6xl mb-4">🚫</div>
        <h1 className="text-2xl font-black text-slate-800 mb-2">최고 관리자 전용 영역</h1>
        <p className="text-sm font-bold text-red-500 bg-red-50 px-6 py-3 rounded-2xl border border-red-100 shadow-sm">
          이 페이지는 LV_1(운영관리자) 권한 소유자만 접근할 수 있습니다.<br/>
          <span className="text-[11px] opacity-70">(현재 접속 계정 권한: {primaryRole})</span>
        </p>
        <Link href="/home" className="mt-8 px-8 py-3 bg-slate-900 text-white font-black rounded-2xl text-xs hover:bg-blue-600 transition-all shadow-xl active:scale-95">
          서비스 홈으로 돌아가기
        </Link>
      </div>
    );
  }

  // 5. 관리자 전용 레이아웃 (사이드바 + 메인 콘텐츠)
  return (
    <div className="flex min-h-screen bg-[#F8FAFC] font-sans">
      {/* 🛠️ 관리자 왼쪽 사이드바 */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col shrink-0 z-10 shadow-sm">
        <div className="p-8 border-b border-slate-100">
           <Link href="/home" className="text-xl font-black italic tracking-tighter text-blue-600 uppercase hover:opacity-80 transition-opacity">
             Smart OFFICE Hub<span className="text-slate-900 not-italic"></span>
           </Link>
           <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2">Admin Control Tower</p>
        </div>
        
        <nav className="flex-1 p-5 space-y-2 overflow-y-auto">
          <p className="text-[10px] font-black text-slate-300 uppercase px-2 mb-4 tracking-widest">Settings Menu</p>
          <Link href="/admin/users" className="block px-4 py-3 text-xs font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all">
            01. 사용자 및 권한 관리
          </Link>
          <Link href="/admin/units" className="block px-4 py-3 text-xs font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all">
            02. 전사 조직 관리
          </Link>
          <Link href="/admin/interface" className="block px-4 py-3 text-xs font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all">
            03. 서비스 인터페이스 제어
          </Link>
          <Link href="/admin/master-data" className="block px-4 py-3 text-xs font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all">
            04. 마스터 데이터(드롭다운) 관리
          </Link>
          <Link href="/admin/settings" className="block px-4 py-3 text-xs font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all">
            05. 시스템 환경 설정
          </Link>
        </nav>

        {/* 하단 최고 관리자 프로필 */}
        <div className="p-6 border-t border-slate-100 bg-slate-50/50 mt-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-sm shadow-lg">
              {user.name.charAt(0)}
            </div>
            <div>
              <p className="text-xs font-black text-slate-900">{user.name} <span className="text-blue-500 font-medium ml-1">TOP ADMIN</span></p>
              <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">LV_1 권한 활성화</p>
            </div>
          </div>
        </div>
      </aside>
      
      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}