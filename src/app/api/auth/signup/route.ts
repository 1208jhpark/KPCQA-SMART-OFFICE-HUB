import { NextResponse } from 'next/server';

/** 자체 가입 폐지 — 계정은 /admin/users 에서만 생성 */
export async function POST() {
  return NextResponse.json(
    {
      message:
        '자체 회원가입은 제공하지 않습니다. 관리자에게 계정 발급을 요청해 주세요. (/admin/users)',
    },
    { status: 403 }
  );
}
