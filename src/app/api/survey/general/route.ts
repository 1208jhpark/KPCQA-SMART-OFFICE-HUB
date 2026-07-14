import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
     
// 🟢 [GET] 일반 설문 목록 조회 (정렬 및 실시간 반영)
export async function GET() {
  try {
    const surveys = await prisma.generalSurvey.findMany({
      orderBy: {
        postNumber: 'asc', 
      },
    });
    
    return NextResponse.json(surveys, {
      headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }
    });
  } catch (error) {
    console.error("❌ General Survey GET Line Error:", error);
    return NextResponse.json({ error: '데이터베이스 조회에 실패했습니다.' }, { status: 500 });
  }
}
     
// 🔵 [POST] 통합 제어 엔진 (공고 관리 & 사용자 응답/조회)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, id, ...rest } = body;
     
    // 🚀 [파이프라인 1]: 현황판 및 내 제출함용 응답 대장 일괄 수거 로직
    if (action === 'GET_RESPONSES') {
      const responses = await prisma.generalResponse.findMany({
        orderBy: { submittedAt: 'desc' }
      });
      return NextResponse.json(responses);
    }
  
    // 🚀 [파이프라인 2]: 임직원 설문 응답 제출 (Upsert 처리)
    if (action === 'SUBMIT_RESPONSE') {
      const { surveyId, userEmail, answers } = rest;
      const newResponse = await prisma.generalResponse.upsert({
        where: {
          surveyId_userEmail: { surveyId, userEmail }
        },
        update: {
          answers: answers || {},
          submittedAt: new Date()
        },
        create: {
          surveyId,
          userEmail,
          answers: answers || {},
          submittedAt: new Date()
        }
      });
      return NextResponse.json(newResponse);
    }
    
  // 🚀 [기능]: 관리자 독촉(NUDGE) 대상 이메일 DB 저장
  if (action === 'NUDGE') {
    const { surveyId, targetEmails } = rest;
    
    const updatedSurvey = await prisma.generalSurvey.update({
      where: { id: surveyId },
      data: {
        nudgedUsers: targetEmails || [] 
      }
    });
    return NextResponse.json(updatedSurvey);
  }

  // ====================================================================
    // ⚙️ [파이프라인 3]: 관리자 설문 공고(메타+문항) 생성 및 수정 로직
    // ====================================================================
    const isNew = typeof id === 'string' && id.startsWith('S_');
     
    // 💡 [핵심 가드] Builder에서 넘어온 JSON 문항 데이터를 안전하게 파싱
    const sanitizedQuestions = rest.questions 
      ? (typeof rest.questions === 'string' ? JSON.parse(rest.questions) : rest.questions) 
      : undefined; 
  
    let resultSurvey;
     
    if (isNew) {
      resultSurvey = await prisma.generalSurvey.create({
        data: {
          code: rest.code,
          postNumber: Number(rest.postNumber) || 0,
          title: rest.title,
          description: rest.description || '',
          type: rest.type,
          isAnonymous: Boolean(rest.isAnonymous),
          target: rest.target,
          postDate: rest.postDate,
          startDate: rest.startDate,
          endDate: rest.endDate,
          endTime: rest.endTime || '23:59', // 💡 [핵심 추가] 신규 생성 시 마감 시간 DB에 저장!
          status: rest.status,
          hasBeenPublished: Boolean(rest.hasBeenPublished),
          questions: sanitizedQuestions || [] // 신규 공고는 빈 배열이라도 주입
        },
      });
    } else {
      // 💡 [Lost Update 가드] undefined인 필드는 Prisma가 무시하므로 기존 데이터가 보호됨
      const updateData: any = {
        code: rest.code,
        postNumber: rest.postNumber !== undefined ? Number(rest.postNumber) : undefined,
        title: rest.title,
        description: rest.description,
        type: rest.type,
        isAnonymous: rest.isAnonymous !== undefined ? Boolean(rest.isAnonymous) : undefined,
        target: rest.target,
        postDate: rest.postDate,
        startDate: rest.startDate,
        endDate: rest.endDate,
        endTime: rest.endTime, // 💡 [핵심 추가] 기존 공고 수정 시 마감 시간 DB 업데이트!
        status: rest.status,
        hasBeenPublished: rest.hasBeenPublished !== undefined ? Boolean(rest.hasBeenPublished) : undefined,
      };
  
      // 문항 데이터(questions)가 프론트에서 명시적으로 넘어왔을 때만 업데이트 수행
      if (sanitizedQuestions !== undefined) {
        updateData.questions = sanitizedQuestions;
      }
  
      resultSurvey = await prisma.generalSurvey.update({
        where: { id: id },
        data: updateData,
      });
    }
     
    return NextResponse.json(resultSurvey);
  } catch (error) {
    console.error("❌ General Survey POST Line Error:", error);
    return NextResponse.json({ error: '데이터베이스 저장 및 반영에 실패했습니다.' }, { status: 500 });
  }
}
     
// 🔴 [DELETE] 설문 영구 소멸 제어
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
     
    if (!id) {
      return NextResponse.json({ error: '식별 가능한 ID 파라미터가 유실되었습니다.' }, { status: 400 });
    }
     
    await prisma.generalSurvey.delete({
      where: { id: id },
    });
     
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ General Survey DELETE Line Error:", error);
    return NextResponse.json({ error: '데이터베이스 레코드 영구 삭제에 실패했습니다.' }, { status: 500 });
  }
}