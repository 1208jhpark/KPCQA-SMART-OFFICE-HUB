import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import prisma from "@/lib/prisma";
import EquipmentClient from "@/components/equipment/EquipmentClient";
// 🚀 1. 통합 메뉴 권한 엔진 로드
import { checkMenuPermission } from "@/lib/permission-utils"; 

import { JWT_SECRET } from '@/lib/jwt';

export default async function EquipmentDynamicRoutePage({
  params,
}: {
  params: Promise<{ categoryId: string; tabId: string }>;
}) {
  const resolvedParams = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  
  if (!token) redirect("/login");
  
  let userEmail = "";
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    userEmail = decoded.email;
  } catch (error) {
    redirect("/login");
  }
  
  const userData = await prisma.user.findUnique({
    where: { email: userEmail },
    include: { unit: { include: { parent: true, children: { where: { is_active: true } } } } }
  });
  
  if (!userData) redirect("/login");
  
// 🚀 tabId를 빼고, 상위 카테고리(예: /equipment/main/performance)의 권한 설정을 가져오도록 수정
const currentPath = `/equipment/main/${resolvedParams.categoryId}`;
const interfaceConfig = await prisma.interfaceConfig.findUnique({ where: { path: currentPath } });
  
  // 🚀 2. 하드코딩 삭제하고 엔진 가동!
  const allMenus = await prisma.interfaceConfig.findMany();
  const unitsList = await prisma.orgUnit.findMany({ where: { is_active: true } });
  
  const permission = checkMenuPermission(
    { id: userData.id, email: userData.email, roles: userData.roles, dept_id: userData.unit_id, unit: userData.unit },
    interfaceConfig,
    allMenus,
    unitsList
  );

  // 🚀 3. 엔진이 거부하면 접근 차단
  if (!permission.hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] m-6 border-2 border-dashed border-red-200 rounded-[2rem] bg-red-50">
        <h2 className="text-3xl font-black text-red-500 mb-2 uppercase tracking-tighter">Access Denied</h2>
        <p className="text-slate-600 font-bold">해당 장비 메뉴에 대한 접근 권한이 부족합니다.</p>
      </div>
    );
  }
  
  const masterDataList = await prisma.masterGroup.findMany({
    where: { is_active: true },
    include: { codes: { where: { is_active: true, is_visible: true }, orderBy: { sort_order: 'asc' } } },
    orderBy: { sort_order: 'asc' }
  });
  
  return (
    <EquipmentClient 
      categoryId={resolvedParams.categoryId} 
      tabId={resolvedParams.tabId} 
      currentUser={userData} 
      masterDataList={masterDataList} 
      // 🚀 4. canEdit 대신 권한 객체 통째로 전달
      permission={permission} 
    />
  );
}