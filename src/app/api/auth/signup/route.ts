import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // ✅ 싱글톤 인스턴스 사용
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  try {
    const { email, name, password, unit_id } = await req.json();

    // 1. 현재 가입된 전체 유저 수 확인 (초기 관리자 배정용)
    const userCount = await prisma.user.count();

    // 2. 권한 및 상태 설정 
    // [중요] 따옴표로 감싼 문자열이 아닌, 실제 배열 객체로 정의합니다.
    let initialRole: string[] = ["LV_3"]; 
    let initialStatus = "Pending";

    // 최초 3명은 운영관리자(LV_1) 권한 및 즉시 활성(Active) 상태 부여
    if (userCount < 3) {
      initialRole = ["LV_1"];
      initialStatus = "Active";
    }

    // 3. 비밀번호 암호화 (Salt 10회)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. 유저 생성
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        unit_id: unit_id || null, // 부서 미선택 시 null 처리
        roles: initialRole,       // Prisma가 JSON 배열로 자동 변환하여 저장
        status: initialStatus,
      },
    });

    return NextResponse.json({ 
      message: "가입 성공", 
  user: { 
    email: user.email, 
    status: user.status // 🚀 이 정보를 넘겨줘야 프론트에서 분기 가능
  } 
});

  } catch (error) {
    console.error("회원가입 API 에러:", error);
    return NextResponse.json(
      { message: "가입 처리 중 오류가 발생했습니다." }, 
      { status: 500 }
    );
  }
}