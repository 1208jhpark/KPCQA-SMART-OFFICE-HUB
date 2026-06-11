import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

// 유저 인증 유틸리티 (중복 방지)
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

// 🚀 1. IT 자산 목록 조회 (GET)
export async function GET() {
  try {
    // 💡 폐기된 자산은 제외하고 활성 자산만 최신순으로 조회
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

    // 💡 등록한 관리자 정보를 데이터에 포함 (스키마에 해당 필드가 있을 경우)
    const asset = await prisma.iTAsset.create({ 
      data: {
        ...body,
        is_active: true,
        // 필요 시 추가: creator_name: user.name, creator_dept: user.unit?.unit_name
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

    const { id, ...data } = await req.json();

    // 💡 폐기 처리 로직 대응 (is_active: false로 올 경우)
    const updated = await prisma.iTAsset.update({ 
      where: { id }, 
      data: {
        ...data,
        // 필요 시 수정자 정보 업데이트
      } 
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

    // 💡 실제 삭제보다는 is_active: false (PATCH)를 권장하지만, 
    // 정말 삭제가 필요한 경우를 위해 DELETE 구현
    await prisma.iTAsset.delete({ where: { id } });
    
    return NextResponse.json({ message: "삭제 완료" });
  } catch (error) {
    console.error("IT Asset DELETE Error:", error);
    return NextResponse.json({ message: "삭제 실패 (연관 데이터 확인 필요)" }, { status: 500 });
  }
}