import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// [GET] 전체 신청 내역 불러오기 (마스터 권한)
export async function GET() {
  try {
    const allRequests = await prisma.businessCardRequest.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(allRequests, {
      headers: { 'Cache-Control': 'no-store, max-age=0' }
    });
  } catch (error) {
    console.error("마스터 신청내역 로드 에러:", error);
    return NextResponse.json({ message: '데이터 로드 실패' }, { status: 500 });
  }
}

// [PUT] 관리자 발주 승인, 정보 수정 및 발주 묶음(Batch) 생성 동기화
export async function PUT(req: Request) {
  try {
    const payload = await req.json();
    
    // 🚀 payload 분리
    const { 
      id, 
      adminStatus, 
      processDate, 
      isModifiedByAdmin, 
      adminMemo, 
      adminModifierName, 
      adminModifiedAt, 
      batchId,        // 프론트엔드가 보낸 묶음 번호
      orderGroupId,   // 기존 payload에 들어있을 수 있는 값 배제 (충돌 방지)
      isFormPayload,  
      createdAt,      
      updatedAt,      
      ...data         
    } = payload;
  
    if (!id) {
      return NextResponse.json({ message: 'ID가 누락되었습니다.' }, { status: 400 });
    }
  
    const updated = await prisma.businessCardRequest.update({
      where: { id: id },
      data: {
        adminStatus,
        processDate,
        isModifiedByAdmin,
        adminMemo,
        adminModifierName,
        adminModifiedAt,
        orderGroupId: batchId || null, // 🚀 핵심 수정: 프론트의 batchId를 DB의 orderGroupId로 매핑
        ...data
      }
    });
  
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("마스터 상태 업데이트 에러:", error);
    return NextResponse.json({ message: '상태 변경 실패', error: error.message }, { status: 500 });
  }
}