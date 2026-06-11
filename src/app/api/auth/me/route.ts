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
  
    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      roles: Array.isArray(user.roles) ? user.roles : JSON.parse(user.roles as string),
      dept_id: user.unit_id,
      unit: user.unit // Join된 조직 전체 정보를 프론트로 넘김
    });
  } catch (error) {
    console.error("Auth Me Error:", error);
    return NextResponse.json({ message: 'Auth Error' }, { status: 500 });
  }
}