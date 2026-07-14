import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    
    if (!token) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return NextResponse.json({ error: '유효하지 않은 토큰입니다.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: decoded.email },
      include: { unit: true } // User 모델과의 관계 필드명은 그대로 유지
    });

    if (!user || !user.unit) {
      return NextResponse.json({ error: '부서 정보가 등록되지 않은 사용자입니다.' }, { status: 403 });
    }

    // 🚀 방어 코드: 최소한 자기 자신의 부서 이름은 무조건 깔고 갑니다.
    let deptNamesArray = [user.unit.unit_name];

    try {
      // 🎯 [정답 적중] prisma.orgUnit 으로 정확히 호출!
      // 스키마에 있는 is_active, is_deleted 까지 활용해 삭제된 부서는 제외
      const allUnits = await prisma.orgUnit.findMany({
        where: { 
          is_active: true,
          is_deleted: false
        }
      });
      
      const allowedDeptNames = new Set<string>();
      allowedDeptNames.add(user.unit.unit_name);

      // TypeScript 에러 없이 깔끔하게 떨어지는 재귀 로직
      const findChildren = (parentId: string) => {
        allUnits.filter(u => u.parent_id === parentId).forEach(child => {
          allowedDeptNames.add(child.unit_name);
          findChildren(child.id);
        });
      };
      
      findChildren(user.unit.id);
      deptNamesArray = Array.from(allowedDeptNames);
      
    } catch (e) {
      console.error("⚠️ 하위 조직도 로드 실패:", e);
    }

    // [3] 완성된 deptNamesArray 로 데이터베이스에서 싹쓸이
    const myDeptRequests = await prisma.supplyRequest.findMany({
      where: { 
        dept_name: {
          in: deptNamesArray
        }
      },
      include: { 
        item: {
          select: { name: true, image_url: true, description: true }
        } 
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return NextResponse.json(myDeptRequests);

  } catch (error: any) {
    console.error("Dept Requests GET Error:", error);
    return NextResponse.json({ error: '데이터를 불러오는 중 서버 오류가 발생했습니다.' }, { status: 500 });
  }
}