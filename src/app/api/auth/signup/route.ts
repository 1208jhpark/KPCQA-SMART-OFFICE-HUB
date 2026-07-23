import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { COMPANY_EMAIL_SUFFIX, resolveCompanyEmail } from '@/utils/companyEmail';

export async function POST(req: Request) {
  try {
    const { email, name, name_en, employee_no, password, unit_id, confirmPassword } = await req.json();

    const trimmedName = String(name || '').trim();
    const trimmedNameEn = String(name_en || '').trim();
    const trimmedEmail = resolveCompanyEmail(email);
    const trimmedEmpNo = String(employee_no || '').trim();

    if (!trimmedName || !trimmedNameEn || !trimmedEmail || !trimmedEmpNo || !password) {
      return NextResponse.json(
        { message: `성명, 영문명, 사내메일(${COMPANY_EMAIL_SUFFIX}), 사번, 비밀번호는 필수입니다.` },
        { status: 400 }
      );
    }

    if (confirmPassword != null && password !== confirmPassword) {
      return NextResponse.json({ message: '비밀번호가 일치하지 않습니다.' }, { status: 400 });
    }

    if (String(password).length < 8) {
      return NextResponse.json({ message: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    const existing = await prisma.user.findFirst({
      where: { email: { equals: trimmedEmail, mode: 'insensitive' } },
    });
    if (existing) {
      return NextResponse.json({ message: '이미 등록된 이메일입니다.' }, { status: 409 });
    }

    // 1. 현재 가입된 전체 유저 수 확인 (초기 관리자 배정용)
    const userCount = await prisma.user.count();

    // 2. 권한 및 상태 설정
    let initialRole: string[] = ['LV_3'];
    let initialStatus = 'Pending';

    // 최초 3명은 운영관리자(LV_1) 권한 및 즉시 활성(Active) 상태 부여
    if (userCount < 3) {
      initialRole = ['LV_1'];
      initialStatus = 'Active';
    }

    // 3. 비밀번호 암호화 (Salt 10회)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. 유저 생성
    const user = await prisma.user.create({
      data: {
        email: trimmedEmail,
        name: trimmedName,
        name_en: trimmedNameEn,
        employee_no: trimmedEmpNo,
        password: hashedPassword,
        unit_id: unit_id || null,
        roles: initialRole,
        status: initialStatus,
      },
    });

    return NextResponse.json({
      message: '가입 성공',
      user: {
        email: user.email,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('회원가입 API 에러:', error);
    return NextResponse.json(
      { message: '가입 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
