import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import prisma from "@/lib/prisma";
import EquipmentClient from "@/components/equipment/EquipmentClient";

const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

export default async function EquipmentDynamicRoutePage({
  params,
}: {
  params: Promise<{ categoryId: string; tabId: string }>; // 🚨 Next.js 15: Promise 타입 적용
}) {
  // 🚨 params를 비동기로 언래핑합니다.
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
    include: {
      unit: {
        include: {
          parent: true,
          children: {
            where: { is_active: true }
          }
        }
      }
    }
  });

  if (!userData) redirect("/login");

  // 🚨 언래핑된 params 사용
  const currentPath = `/equipment/main/${resolvedParams.categoryId}/${resolvedParams.tabId}`;
  
  const interfaceConfig = await prisma.interfaceConfig.findUnique({
    where: { path: currentPath },
  });

  const requiredLvl = interfaceConfig?.level ?? 4; 
  
  let userLvl = 4;
  if (userData.roles) {
    try {
      const rolesArray = Array.isArray(userData.roles) ? userData.roles : JSON.parse(userData.roles as string);
      if (rolesArray.length > 0) {
        const match = rolesArray[0].match(/LV_(\d+)/);
        if (match) userLvl = parseInt(match[1], 10);
      }
    } catch (e) {
      console.error("Roles 파싱 오류", e);
    }
  }

  if (userLvl > requiredLvl) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] m-6 border-2 border-dashed border-red-200 rounded-[2rem] bg-red-50">
        <h2 className="text-3xl font-black text-red-500 mb-2 uppercase tracking-tighter">Access Denied</h2>
        <p className="text-slate-600 font-bold">해당 장비 메뉴에 대한 접근 권한(요구: Lv.{requiredLvl})이 부족합니다.</p>
      </div>
    );
  }

  const masterDataList = await prisma.masterGroup.findMany({
    where: { is_active: true },
    include: {
      codes: {
        where: { is_active: true, is_visible: true },
        orderBy: { sort_order: 'asc' }
      }
    },
    orderBy: { sort_order: 'asc' }
  });

  const canEdit = userLvl <= 2;

  return (
    <EquipmentClient 
      categoryId={resolvedParams.categoryId} 
      tabId={resolvedParams.tabId} 
      currentUser={userData} 
      masterDataList={masterDataList} 
      canEdit={canEdit} 
    />
  );
}