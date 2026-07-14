import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
  
    if (!token) return NextResponse.json({ message: 'No Token' }, { status: 401 });
  
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userEmail = decoded.email; 
  
    // 🎯 [Cursor 규칙 1, 2 적용] include를 사용하여 unit과 parent 정보를 완벽하게 Join
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      include: {
        unit: {
          include: {
            parent: true 
          }
        }
      }
    });
  
    if (!user) return NextResponse.json({ message: 'User Not Found' }, { status: 404 });
  
    // 💡 안전한 JSON 파싱 헬퍼 함수
    const safeParseRoles = (roles: any) => {
      if (Array.isArray(roles)) return roles;
      if (typeof roles === 'string' && roles.trim() !== '') {
        try {
          return JSON.parse(roles);
        } catch (e) {
          return []; // 파싱 에러가 나면 빈 배열 반환
        }
      }
      return []; // null 이거나 빈 문자열이면 빈 배열 반환
    };

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      roles: safeParseRoles(user.roles), // 🚀 에러가 나던 부분을 안전한 함수로 교체 완료
      dept_id: user.unit_id,
      unit: user.unit 
    });
  } catch (error) {
    console.error("Auth Me Error:", error);
    return NextResponse.json({ message: 'Auth Error' }, { status: 500 });
  }
}