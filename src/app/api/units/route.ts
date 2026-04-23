import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

// Prisma 클라이언트 재사용 설정 (Hot Reload 오류 방지)
const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function GET() {
  try {
    // [Admin-02] 조직 목록을 가져올 때 '입력 순서(id)' 기준으로 정렬합니다.
    const units = await prisma.orgUnit.findMany({
      where: { 
        is_active: true,
        is_deleted: false 
      },
      orderBy: { 
        sort_order: 'asc' // unit_name 대신 id를 사용하여 입력한 순서를 유지합니다.
      }
    });
    return NextResponse.json(units);
  } catch (error) {
    console.error('부서 목록 호출 중 에러:', error);
    return NextResponse.json({ message: '부서 목록 호출 실패' }, { status: 500 });
  }
}