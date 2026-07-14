import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // 프로젝트 구조에 맞는 prisma 클라이언트 경로로 지정하세요

// 1. 외주사 목록 조회 (GET)
export async function GET() {
  try {
    const vendors = await prisma.outsourcingVendor.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(vendors);
  } catch (error) {
    console.error("외주업체 조회 오류:", error);
    return NextResponse.json([], { status: 500 });
  }
}

// 2. 신규 외주사 등록 (POST)
export async function POST(req: Request) {
  try {
    const { companyName, managerName, email, isActive } = await req.json();
    const newVendor = await prisma.outsourcingVendor.create({
      data: { companyName, managerName, email, isActive }
    });
    return NextResponse.json(newVendor, { status: 201 });
  } catch (error) {
    console.error("외주업체 등록 오류:", error);
    return NextResponse.json({ error: "등록 실패" }, { status: 500 });
  }
}

// 3. 외주사 활성/비활성 제어 (PUT)
export async function PUT(req: Request) {
    try {
      const { id, companyName, managerName, email, isActive } = await req.json();
      
      const updatedVendor = await prisma.outsourcingVendor.update({
        where: { id },
        data: { 
          companyName, 
          managerName, 
          email, 
          isActive 
        }
      });
      return NextResponse.json(updatedVendor);
    } catch (error) {
      console.error("외주업체 수정 오류:", error);
      return NextResponse.json({ error: "수정 실패" }, { status: 500 });
    }
  }