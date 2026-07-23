import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
  
export const dynamic = 'force-dynamic';
import { JWT_SECRET } from '@/lib/jwt';
  
// 유저 인증 유틸리티
async function getAuthUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    return await prisma.user.findUnique({
      where: { email: decoded.email },
      include: { unit: true }
    });
  } catch (e) {
    return null;
  }
}
  
// 🎯 프론트엔드 데이터를 PostgreSQL/Prisma 규격에 맞게 변환하는 정제기
function sanitizeAndParsePayload(rawData: any) {
  const sanitized: any = {};
    
  // 1. 문자열 필드 정제
  const stringFields = [
    'category', 'it_type', 'dept', 'user', 'code', 'model', 
    'sn', 'brand', 'spec', 'is_rental', 'in_date', 
    'start_date', 'end_date', 'first_bill', 'memo', 'reg_date', 
    'last_audit_date', 
    'audit_request_date' // 🚀 [핵심 수정] 여기에 독촉 날짜 필드를 추가하여 필터링을 방지합니다!
  ];
  stringFields.forEach(field => {
    if (rawData[field] !== undefined) {
      sanitized[field] = rawData[field] === null ? null : String(rawData[field]).trim();
    }
  });
    
  // 2. 정수형(Int) 필드 안전 변환
  const intFields = ['rental_months', 'cycle'];
  intFields.forEach(field => {
    if (rawData[field] !== undefined) {
      const parsed = parseInt(rawData[field], 10);
      sanitized[field] = isNaN(parsed) ? 0 : parsed;
    }
  });
    
  // 3. 실수형(Float) 필드 안전 변환
  const floatFields = ['purchase_price', 'monthly_fee', 'monthly_sub_fee'];
  floatFields.forEach(field => {
    if (rawData[field] !== undefined) {
      const parsed = parseFloat(rawData[field]);
      sanitized[field] = isNaN(parsed) ? 0 : parsed;
    }
  });
    
  // 4. 활성화 여부 제어
  if (rawData.is_active !== undefined) {
    sanitized.is_active = Boolean(rawData.is_active);
  }
    
  return sanitized;
}
  
// 🚀 1. IT 자산 목록 조회 (GET)
export async function GET() {
  try {
    const assets = await prisma.iTAsset.findMany({
      where: { is_active: true }, 
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(assets);
  } catch (error) {
    console.error("IT Asset GET Error:", error);
    return NextResponse.json({ message: "데이터 로드 실패" }, { status: 500 });
  }
}
  
// 🚀 2. IT 자산 신규 등록 (POST)
export async function POST(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ message: "인증 필요" }, { status: 401 });
    
    const body = await req.json();
    const cleanData = sanitizeAndParsePayload(body);
    
    const asset = await prisma.iTAsset.create({ 
      data: {
        ...cleanData,
        is_active: true
      } 
    });
    return NextResponse.json(asset);
  } catch (error) {
    console.error("IT Asset POST Error:", error);
    return NextResponse.json({ message: "자산 등록 실패" }, { status: 500 });
  }
}
  
// 🚀 3. IT 자산 수정 및 폐기 (PATCH)
export async function PATCH(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ message: "인증 필요" }, { status: 401 });
    
    const body = await req.json();
    const { id } = body;
    
    if (!id) return NextResponse.json({ message: "ID 누락" }, { status: 400 });
    
    const cleanData = sanitizeAndParsePayload(body);
    
    const updated = await prisma.iTAsset.update({ 
      where: { id }, 
      data: cleanData
    });
    
    return NextResponse.json(updated);
  } catch (error) {
    console.error("IT Asset PATCH Error:", error);
    return NextResponse.json({ message: "자산 수정 실패" }, { status: 500 });
  }
}
  
// 🚀 4. IT 자산 완전 삭제 (DELETE)
export async function DELETE(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ message: "인증 필요" }, { status: 401 });
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    
    if (!id) return NextResponse.json({ message: "ID 누락" }, { status: 400 });
    
    await prisma.iTAsset.delete({ where: { id } });
    
    return NextResponse.json({ message: "삭제 완료" });
  } catch (error) {
    console.error("IT Asset DELETE Error:", error);
    return NextResponse.json({ message: "삭제 실패" }, { status: 500 });
  }
}