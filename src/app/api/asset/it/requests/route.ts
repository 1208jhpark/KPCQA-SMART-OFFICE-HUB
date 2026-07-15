import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getKSTDateString } from '@/utils/dateUtils'
     
export const dynamic = 'force-dynamic';
     
// 🚀 어떤 대소문자로 매핑되었든 무조건 찾아내는 헬퍼 함수
const getRequestModel = () => {
  const p = prisma as any;
  // 스펠링의 모든 경우의 수를 확인합니다.
  const model = p.iTRequest || p.itRequest || p.ITRequest || p.itrequest;
  
  if (!model) {
    throw new Error("DB 연결은 성공했으나 ITRequest 테이블을 찾을 수 없습니다. (캐시가 갱신되지 않았습니다.)");
  }
  return model;
};
     
// 1. 모든 요구사항 목록 조회 (GET)
export async function GET() {
  try {
    const model = getRequestModel(); // 🚀 무적 헬퍼 사용
    const requests = await model.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(requests);
  } catch (error: any) {
    console.error("IT 요청목록 조회 실패:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
     
// 2. 사용자가 의견 및 요구사항 작성 후 전송 (POST)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { assetCode, assetType, content, requester, dept, status, requestDate, assetInfo } = body;
     
    const model = getRequestModel(); // 🚀 무적 헬퍼 사용
    
    const newRequest = await model.create({
      data: {
        assetCode,
        assetType,
        content,
        requester,
        dept,
        status: status || '의견전송',
        requestDate: requestDate || getKSTDateString(),
        assetInfo: assetInfo || `${assetCode} / 정보 미상`,
      },
    });
     
    return NextResponse.json(newRequest, { status: 201 });
  } catch (error: any) {
    console.error("IT 요청사항 저장 실패:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
     
// 🚀 3. 관리자 조치 및 답변 등록 & 실사 관제 센터 독촉 처리 (PATCH)
export async function PATCH(request: Request) {
    try {
      const body = await request.json();
      const { id, adminOpinion, responderName, status, action, emails, date } = body;
      
      // -----------------------------------------------------------------
      // 🔔 [신규 예외 처리 가드]: 실사 관제 센터 독촉(NUDGE) 인터랙션 동기화
      // -----------------------------------------------------------------
// 🚀 src/app/api/asset/it/requests/route.ts 내 PATCH 함수의 NUDGE 블록 교체
if (action === 'NUDGE' || id === 'NUDGE_ACTION') {
  if ((!emails || emails.length === 0) && (!body.names || body.names.length === 0)) {
    return NextResponse.json({ message: '독촉 대상자 정보가 누락되었습니다.' }, { status: 400 });
  }

  const p = prisma as any;
  const assetModel = p.iTAsset || p.itAsset || p.ITAsset || p.itasset;

  if (!assetModel) {
    throw new Error("IT 자산 마스터 원장 테이블(ITAsset)을 찾을 수 없습니다.");
  }

  // 이메일과 이름 배열을 모두 활용하여 DB 구조에 대응하는 OR 안전 매핑
  const targetEmails = emails || [];
  const targetNames = body.names || [];

  await assetModel.updateMany({
    where: {
      OR: [
        { user: { in: targetNames } },
        { user: { in: targetEmails } }
      ]
    },
    data: {
      // 오늘 날짜로 독촉/확인요청일 기록
      audit_request_date: date || getKSTDateString(), 
      // 독촉 상태 진입을 위해 최근 실사일 데이터를 초기화하여 배지 트리거 활성화
      last_audit_date: null 
    }
  });

  return NextResponse.json({ success: true, message: '독촉 기록 및 상태 변환 완료' });
}
      // -----------------------------------------------------------------
      // 👇 기존 순정 4레벨 일반 IT 조치 상태 변경 로직 (온전하게 보존)
      // -----------------------------------------------------------------
      // 기존 requests 비즈니스 로직용 id 검증 가드 추가
      if (!id) {
        return NextResponse.json({ error: "Argument 'where' needs at least one of id arguments." }, { status: 400 });
      }
  
      const model = getRequestModel();
      
      // DB 스키마 수정 없이 "의견:::답변자이름" 형태로 합성해서 저장합니다.
      const finalOpinion = responderName ? `${adminOpinion}:::${responderName}` : adminOpinion;
  
      const updated = await model.update({
        where: { id },
        data: {
          adminOpinion: finalOpinion,
          status: status || '관리자 확인완료',
          completedAt: status === '관리자 확인완료' ? getKSTDateString() : null,
        },
      });
  
      return NextResponse.json(updated);
    } catch (error: any) {
      console.error("IT 요청사항 수정 실패:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  
  // 🚀 4. 관리자 내역 영구 삭제 (DELETE)
  export async function DELETE(request: Request) {
    try {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) throw new Error("ID 누락");
  
      const model = getRequestModel();
      await model.delete({ where: { id } });
  
      return NextResponse.json({ success: true });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }