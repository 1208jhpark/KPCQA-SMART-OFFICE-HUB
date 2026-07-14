import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
     
// ====================================================================
// 🟢 [GET] 배달 지원 공고 목록 전체 조회 (순정 로직)
// ====================================================================
export async function GET() {
  try {
    const surveys = await prisma.deliverySurvey.findMany({
      orderBy: { postNumber: 'asc' },
    });
    return NextResponse.json(surveys, {
      headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }
    });
  } catch (error) {
    console.error("Delivery Survey GET Error:", error);
    return NextResponse.json({ error: '데이터를 불러오는데 실패했습니다.' }, { status: 500 });
  }
}
     
// ====================================================================
// 🔵 [POST] 공고 제어 및 유저 응답/결재 통합 처리 엔진 (스코프 완전 격리)
// ====================================================================
export async function POST(req: NextRequest) {
  try {
    // 🚀 [보안 가드]: Body가 비어있어도 터지지 않도록 text로 먼저 받고 검증
    const text = await req.text();
    if (!text) {
      return NextResponse.json({ error: "Empty Request Body" }, { status: 400 });
    }
    
    const data = JSON.parse(text);
    const { action, id, ...rest } = data;
     
    // 🚀 [기능 1]: 임직원 신청 응답 대장 수거 (관리자 현황판용)
    if (action === 'GET_RESPONSES') {
      const responses = await prisma.deliveryResponse.findMany({
        orderBy: { submittedAt: 'desc' }
      });
      return NextResponse.json(responses);
    }
     
    // 🚀 [기능 2]: 관리자 최종 승인 또는 승인 취소 제어
    if (action === 'APPROVE' || action === 'CANCEL') {
      const isApproveAction = action === 'APPROVE';
      const updatedApprove = await prisma.deliveryResponse.update({
        where: {
          surveyId_userEmail: {
            surveyId: rest.surveyId,
            userEmail: rest.userEmail
          }
        },
        data: {
          isApproved: isApproveAction,
          approvedAt: isApproveAction ? new Date() : null,
          isRevoked: action === 'CANCEL',
          feedbackMsg: rest.feedbackMsg || null,
          feedbackAt: action === 'CANCEL' ? new Date() : null
        }
      });
      return NextResponse.json(updatedApprove);
    }
     
    // 🚀 [기능 3]: 관리자 보완 요청 처리
    if (action === 'FEEDBACK') {
      const updatedFeedback = await prisma.deliveryResponse.update({
        where: {
          surveyId_userEmail: {
            surveyId: rest.surveyId,
            userEmail: rest.userEmail
          }
        },
        data: {
          isApproved: false,
          approvedAt: null,
          feedbackMsg: rest.feedbackMsg,
          feedbackAt: new Date()
        }
      });
      return NextResponse.json(updatedFeedback);
    }
     
    // 🚀 [기능 4]: 직원 배달 설문 제출 처리 
    if (action === 'SUBMIT_RESPONSE') {
      const { surveyId, userEmail, answers } = rest;
      
      const newResponse = await prisma.deliveryResponse.upsert({
        where: {
          surveyId_userEmail: { surveyId, userEmail }
        },
        update: {
          answers: answers || {},
          submittedAt: new Date(),
          revisionCount: { increment: 1 } 
        },
        create: {
          surveyId,
          userEmail,
          answers: answers || {},
          submittedAt: new Date(),
          revisionCount: 0,
          isApproved: false,
          isRevoked: false
        }
      });
      return NextResponse.json(newResponse);
    }

    // 🚀 [기능 5]: 관리자 독촉(NUDGE) 대상 이메일 DB 저장 (NEW)
    if (action === 'NUDGE') {
      const { surveyId, targetEmails } = rest;
      const updatedSurvey = await prisma.deliverySurvey.update({
        where: { id: surveyId },
        data: {
          nudgedUsers: targetEmails || [] // 프론트에서 받은 미참여자 이메일 배열 덮어쓰기
        }
      });
      return NextResponse.json(updatedSurvey);
    }
     
// ====================================================================
    // ⚙️ [인프라 보완]: action이 없을 때 실행되는 순정 공고 등록/수정 로직 (안정화)
    // ====================================================================
    const isNew = typeof id === 'string' && id.startsWith('D_');
  
    // Prisma Json 규격 정합성을 위한 프리패스 가드 처리
    const sanitizedQuestions = rest.questions 
      ? (typeof rest.questions === 'string' ? JSON.parse(rest.questions) : rest.questions) 
      : [];
  
    let survey;
    if (isNew) {
      survey = await prisma.deliverySurvey.create({
        data: {
          code: rest.code,
          postNumber: Number(rest.postNumber) || 0,
          title: rest.title,
          description: rest.description || '',
          type: rest.type,
          deliveryType: rest.deliveryType,
          target: rest.target,
          postDate: rest.postDate,
          startDate: rest.startDate,
          endDate: rest.endDate,
          endTime: rest.endTime || '23:59', // 💡 [해결] 신규 생성 시 마감 시간 저장!
          status: rest.status,
          hasBeenPublished: Boolean(rest.hasBeenPublished),
          questions: sanitizedQuestions 
        }
      });
    } else {
      const existingSurvey = await prisma.deliverySurvey.findUnique({ where: { id } });
      const finalQuestions = rest.questions ? sanitizedQuestions : (existingSurvey?.questions || []);
  
      survey = await prisma.deliverySurvey.update({
        where: { id: id },
        data: {
          code: rest.code ?? existingSurvey?.code,
          postNumber: rest.postNumber !== undefined ? Number(rest.postNumber) : existingSurvey?.postNumber,
          title: rest.title ?? existingSurvey?.title,
          description: rest.description ?? existingSurvey?.description,
          type: rest.type ?? existingSurvey?.type,
          deliveryType: rest.deliveryType ?? existingSurvey?.deliveryType,
          target: rest.target ?? existingSurvey?.target,
          postDate: rest.postDate ?? existingSurvey?.postDate,
          startDate: rest.startDate ?? existingSurvey?.startDate,
          endDate: rest.endDate ?? existingSurvey?.endDate,
          endTime: rest.endTime ?? existingSurvey?.endTime, // 💡 [해결] 업데이트 시 마감 시간 덮어쓰기!
          status: rest.status ?? existingSurvey?.status,
          hasBeenPublished: rest.hasBeenPublished !== undefined ? Boolean(rest.hasBeenPublished) : existingSurvey?.hasBeenPublished,
          questions: finalQuestions
        }
      });
    }
    
    // 💡 [핵심 복구] 여기서부터 누락되었던 뚜껑 닫기 부분입니다!
    return NextResponse.json(survey);
  } catch (error) {
    console.error("Delivery Survey POST Master Error:", error);
    return NextResponse.json({ error: '데이터 인프라 저장 처리에 실패했습니다.' }, { status: 500 });
  }
}

// ====================================================================
// 🔴 [DELETE] 배달 공고 데이터 레코드 영구 삭제 (순정 로직)
// ====================================================================
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
     
    if (!id) {
      return NextResponse.json({ error: '삭제할 ID가 없습니다.' }, { status: 400 });
    }
     
    await prisma.deliverySurvey.delete({
      where: { id: id }
    });
     
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delivery Survey DELETE Error:", error);
    return NextResponse.json({ error: '데이터 삭제에 실패했습니다.' }, { status: 500 });
  }
}