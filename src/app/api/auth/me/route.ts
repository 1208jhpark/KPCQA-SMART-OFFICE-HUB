import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;

    if (!token) {
      console.log("❌ [AUTH/ME] 쿠키에 토큰이 없습니다.");
      return NextResponse.json({ message: 'No Token' }, { status: 401 });
    }

    // 1. 토큰 복호화 및 로그 확인
    const decoded: any = jwt.verify(token, JWT_SECRET);
    console.log("🔍 [AUTH/ME] 토큰 복호화 결과:", decoded);

    // 2. userId 혹은 id 둘 다 대응 가능하도록 처리 (로그인 로직에 따라 다를 수 있음)
    const targetId = decoded.userId || decoded.id;

    if (!targetId) {
      console.log("❌ [AUTH/ME] 토큰에 ID 정보가 누락되었습니다.");
      return NextResponse.json({ message: 'Invalid Token Payload' }, { status: 401 });
    }

    // 3. DB 조회 (email 필드 반드시 포함)
    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: { 
        name: true, 
        email: true, 
        roles: true 
      }
    });

    if (!user) {
      console.log(`❌ [AUTH/ME] ID(${targetId})에 해당하는 유저를 DB에서 찾을 수 없습니다.`);
      return NextResponse.json({ message: 'User Not Found' }, { status: 404 });
    }

    console.log("✅ [AUTH/ME] 유저 정보 조회 성공:", user.email);

    // 4. 프론트로 확실하게 반환
    return NextResponse.json({
      name: user.name,
      email: user.email,
      roles: user.roles
    });

  } catch (error: any) {
    console.error("🔥 [AUTH/ME] 에러 발생:", error.message);
    return NextResponse.json({ message: 'Auth Error', error: error.message }, { status: 500 });
  }
}