import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// 1. 본인 명함 신청 이력 데이터 조회
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ message: '인증 정보가 누락되었습니다.' }, { status: 400 });
    }

    const myRequests = await prisma.businessCardRequest.findMany({
      where: { userEmail: email },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(myRequests, {
      headers: { 'Cache-Control': 'no-store, max-age=0' }
    });
  } catch (error) {
    return NextResponse.json({ message: '데이터 로드 실패' }, { status: 500 });
  }
}

// 2. 신규 신청(POST) 및 정보 변경 수정(PUT) 통합 처리기
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, userEmail, ...data } = body;

    // 🚀 [수정 모드] 프론트엔드에서 id를 넘겨줬을 경우 기존 레코드 업데이트(PUT 대용)
    if (id) {
      const updatedRequest = await prisma.businessCardRequest.update({
        where: { id },
        data: {
          ...data,
          // 수정 시에는 대기중 상태로 안전 변경 가드
          adminStatus: '대기중' 
        }
      });
      return NextResponse.json(updatedRequest);
    }

    // 🚀 [신규 신청 모드] 가장 높은 번호를 찾아 +1 하는 안전한 일련번호 생성 (Max + 1)
    const currentYear = new Date().getFullYear();
    
    // 1. 올해 생성된 명함 중 'postNumber'가 가장 높은(큰) 데이터 딱 1건만 조회
    const latestRequest = await prisma.businessCardRequest.findFirst({
      where: {
        postNumber: {
          startsWith: `BC-${currentYear}-`
        }
      },
      orderBy: {
        postNumber: 'desc' // 번호 역순 정렬 (가장 큰 번호가 1등으로 옴)
      }
    });

    let nextNumber = 1;

    if (latestRequest && latestRequest.postNumber) {
      // 기존 최고 번호가 있다면 (예: BC-2026-0004) 뒤의 '0004'만 추출하여 숫자로 변환
      const latestSerial = latestRequest.postNumber.split('-')[2]; 
      nextNumber = parseInt(latestSerial, 10) + 1;
    }

    // 최종 번호 조합 (예: BC-2026-0005)
    const postNumberStr = `BC-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    const todayStr = new Date().toISOString().slice(0, 10);

    const newRequest = await prisma.businessCardRequest.create({
      data: {
        ...data,
        postNumber: postNumberStr,
        applyDate: todayStr,
        userEmail: userEmail,
        userStatus: '신청완료',
        adminStatus: '대기중'
      }
    });

    return NextResponse.json(newRequest);
  } catch (error: any) {
    return NextResponse.json({ message: '트랜잭션 실패', error: error.message }, { status: 500 });
  }
}

// 3. 대기중 상태일 때 신청 취소(삭제) 처리
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ message: '필수 식별자 누락' }, { status: 400 });
    }

    await prisma.businessCardRequest.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ message: '삭제 쿼리 실행 실패' }, { status: 500 });
  }
}

// 🚀 [추가] 프론트엔드의 수정(PUT) 요청을 완벽하게 받아내는 전용 라우터
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, userEmail, processDate, ...data } = body;

    if (!id) {
      return NextResponse.json({ message: '수정할 데이터의 식별자가 없습니다.' }, { status: 400 });
    }

    const updatedRequest = await prisma.businessCardRequest.update({
      where: { id },
      data: {
        ...data,
        processDate: processDate || null,
        // 수정 사항이 생겼으므로, 관리자 검수를 위해 무조건 '대기중'으로 상태 락인
        adminStatus: '대기중' 
      }
    });

    return NextResponse.json(updatedRequest);
  } catch (error: any) {
    console.error("API PUT 에러:", error);
    return NextResponse.json({ message: '데이터베이스 업데이트 실패', error: error.message }, { status: 500 });
  }
}