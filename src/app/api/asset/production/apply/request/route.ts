import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { getKSTDateString } from '@/utils/dateUtils'

const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

export async function POST(req: Request) {
  try {
    // 1. 서버 사이드 권한/세션 검증 (데이터 위조 방지)
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return NextResponse.json({ message: '인증되지 않은 접근입니다.' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    
    // DB에서 정확한 최신 소속 정보 가져오기
    const user = await prisma.user.findUnique({
      where: { email: decoded.email },
      include: { unit: { include: { parent: true } } }
    });

    if (!user) return NextResponse.json({ message: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    // 2. 클라이언트 페이로드 수신 및 필수값 검증
    const body = await req.json();
    const { category, projectName, quantity, options, estimatedPrice } = body;

    if (!category || !projectName || !quantity) {
      return NextResponse.json({ message: '필수 입력값이 누락되었습니다. (품목 분류, 프로젝트명, 수량)' }, { status: 400 });
    }

    // 3. 고유 관리 번호(PostNumber) 생성 로직 (예: PROD-20260713-001)
    const today = new Date();
    const dateStr = getKSTDateString().replace(/-/g, '');
    
    // 오늘 생성된 신청서 개수 카운트하여 순번 매기기
    const todayCount = await prisma.productionRequest.count({
      where: {
        postNumber: { startsWith: `PROD-${dateStr}` }
      }
    });
    const sequence = String(todayCount + 1).padStart(3, '0');
    const newPostNumber = `PROD-${dateStr}-${sequence}`;

    // 4. Prisma DB 인서트 (상태는 PENDING 강제)
    const newRequest = await prisma.productionRequest.create({
      data: {
        postNumber: newPostNumber,
        category: category,             // 'SIGN', 'JEBON' 등 탭 값
        userEmail: user.email,
        userName: user.name,
        deptHead: user.unit?.parent?.unit_name || '본부 미지정',
        deptName: user.unit?.unit_name || '조직 미지정',
        title: projectName,
        quantity: Number(quantity) || 1,
        estimatedPrice: Number(estimatedPrice) || 0,
        status: 'PENDING',              // 🚀 발주 대기 상태 강제 고정
        options: options || {},         // JSON 구조 (plateType, certType 등 세부 정보)
      }
    });

    return NextResponse.json({ message: '성공적으로 신청되었습니다.', data: newRequest }, { status: 201 });

  } catch (error) {
    console.error("Production Request Error:", error);
    return NextResponse.json({ message: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}