import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken'; 
import prisma from '@/lib/prisma';
  
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
     
const safeArray = (val: any) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return val.split(',').map((s: string) => s.trim().replace(/['"\[\]]/g, ''));
    }
  }
  return [val];
};
  
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const currentPath = searchParams.get('currentPath') || '/survey/general/my-submissions';
  
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
     
    if (!token) {
      return NextResponse.json({ hasAccess: false, error: '인증 세션 쿠키가 유실되었습니다.' }, { status: 401 });
    }
     
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ hasAccess: false, error: '만료되거나 유효하지 않은 세션입니다.' }, { status: 401 });
    }
     
    const email = decoded.email; 
    
    const userWithDept = await prisma.user.findUnique({
      where: { email: email },
      include: {
        unit: true 
      },
    });
  
    if (!userWithDept) {
      return NextResponse.json({ hasAccess: false, error: '시스템에 등록되지 않은 사용자입니다.' }, { status: 404 });
    }
  
    const unitsList = await prisma.orgUnit.findMany({ 
      where: { is_deleted: false, is_active: true } 
    });
  
    const getChildDepartmentIds = (parentId: string): string[] => {
      let results: string[] = [parentId];
      const children = unitsList.filter((u: any) => u.parent_id === parentId);
      for (const child of children) {
        results = results.concat(getChildDepartmentIds(child.id));
      }
      return results;
    };
  
    const myBelongingDeptIds = userWithDept.unit_id ? getChildDepartmentIds(userWithDept.unit_id) : [];
  
    let hasAccess = true;
    let errorDetail = '';
    const allInterfaces = await prisma.interfaceConfig.findMany(); 
    const normalize = (p: string) => String(p || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
         
    let currentNode: any = allInterfaces.find((i: any) => normalize(i.path) === normalize(currentPath)) ||
                           allInterfaces.find((i: any) => normalize(currentPath).startsWith(normalize(i.path)));
         
    if (!currentNode && currentPath.includes('/survey/')) {
        // 임시 방편으로 생성하는 가상 노드 (접근 허용 기본값 3 부여)
        currentNode = { required_level: 3, parent_id: null, name: '설문조사' };
    }
         
    const targetConfig = currentNode; 
    const rolesArr = safeArray(userWithDept.roles);
    const myRoleRaw = String(rolesArr[0] || 'LV_3').toUpperCase();
    const isTopAdmin = myRoleRaw === 'LV_1' || myRoleRaw === 'ADMIN';
    const userLvl = parseInt(myRoleRaw.replace(/[^0-9]/g, ''), 10) || 3; 
         
// 🚀 [보안 가드 엔진]: 사용자님의 view_role_ids 배열 구조에 맞게 완벽 교체
if (!isTopAdmin && currentNode) {
  let allowedRoles = ['LV_1', 'LV_2', 'LV_3']; // 기본값
  let tempNode = currentNode;
  
  // 부모 노드를 거슬러 올라가며 가장 빡빡하게 설정된 view_role_ids를 찾습니다.
  while(tempNode) {
      if (tempNode.view_role_ids && tempNode.view_role_ids.length > 0) {
          // 부모의 허용 목록과 현재 교집합을 찾음 (더 엄격한 권한 상속)
          allowedRoles = allowedRoles.filter(role => tempNode.view_role_ids.includes(role));
      }
      tempNode = allInterfaces.find((i: any) => i.id === tempNode.parent_id);
  }
   
  // 내 권한(myRoleRaw)이 최종 허용 목록에 없으면 차단
  if (!allowedRoles.includes(myRoleRaw)) {
      hasAccess = false;
      errorDetail = `[권한 차단] 허용 등급(${allowedRoles.join(', ')}) / 현재 등급(${myRoleRaw})`;
  }
}

    return NextResponse.json({
      user: {
        id: userWithDept.id,
        name: userWithDept.name,
        email: userWithDept.email,
        roles: rolesArr,
        unit_id: userWithDept.unit_id,
        unit: userWithDept.unit
      },
      belongingDeptIds: myBelongingDeptIds,
      hasAccess,
      errorDetail, 
      config: targetConfig
    }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  
  } catch (error: any) {
    console.error("User Context Core System Error:", error);
    return NextResponse.json({ hasAccess: false, error: error.message }, { status: 500 });
  }
}