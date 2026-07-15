import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import prisma from '@/lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

// 🚀 [보안 가드] 토큰 기반 신원/권한 확인
async function getAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return { isAuth: false, isAdmin: false, email: null };
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const roles = decoded.roles || [];
    const isAdmin = decoded.role === 'LV_1' || roles.includes('LV_1');
    return { isAuth: true, isAdmin, email: decoded.email };
  } catch {
    return { isAuth: false, isAdmin: false, email: null };
  }
}

// 🟢 [GET] 배달/조사 설문 목록 조회
export async function GET() {
  try {
    const surveys = await prisma.deliverySurvey.findMany({
      orderBy: { postNumber: 'asc' },
    });
    return NextResponse.json(surveys, {
      headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }
    });
  } catch (error) {
    console.error("❌ Delivery Survey GET Error:", error);
    return NextResponse.json({ error: '데이터베이스 조회에 실패했습니다.' }, { status: 500 });
  }
}

// 🔵 [POST] 통합 제어 엔진
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuth();
    
    const text = await req.text();
    if (!text) return NextResponse.json({ error: "Empty Request Body" }, { status: 400 });
    const data = JSON.parse(text);
    const { action, id, ...rest } = data;

    // 1. 배포 페이지 인증
    if (action === 'VERIFY_PASSWORD') {
      const { userEmail, password } = rest;
      const user = await prisma.user.findUnique({ where: { email: userEmail } });
      
      if (!user || user.status !== 'Active') {
        return NextResponse.json({ error: '존재하지 않거나 비활성화된 계정입니다.' }, { status: 401 });
      }
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return NextResponse.json({ error: '이메일 또는 비밀번호가 일치하지 않습니다.' }, { status: 401 });
      }
      
      const userRoles = Array.isArray(user.roles) ? user.roles : [];
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: userRoles[0] || 'LV_3', roles: userRoles },
        JWT_SECRET,
        { expiresIn: '1d' }
      );
      
      const response = NextResponse.json({ success: true, user: { name: user.name, email: user.email } });
      response.cookies.set('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24
      });
      return response;
    }

    // 2. 🚀 [GET_RESPONSES] 응답 데이터 격리 조회 (본인 것만)
    if (action === 'GET_RESPONSES') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });
      
      const responses = await prisma.deliveryResponse.findMany({
        where: auth.isAdmin ? undefined : { userEmail: auth.email! },
        orderBy: { submittedAt: 'desc' }
      });
      return NextResponse.json(responses);
    }

    // 3. 🚀 [GET_STATS] 전사 통계 조회 (이메일 비노출, 카운트 + 재고 집계)
    if (action === 'GET_STATS') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });

      const allResponses = await prisma.deliveryResponse.findMany({
        select: { surveyId: true, answers: true }
      });

      const stockUsage: Record<string, Record<string, number>> = {};
      const participation: Record<string, number> = {};

      allResponses.forEach((r: any) => {
        // 이메일 대신 해당 설문 제출 수(done)만 +1 누적
        participation[r.surveyId] = (participation[r.surveyId] || 0) + 1;

        if (r.answers) {
          if (!stockUsage[r.surveyId]) stockUsage[r.surveyId] = {};
          const ansObj = r.answers as Record<string, any>;
          Object.entries(ansObj).forEach(([qId, val]) => {
            if (typeof val === 'string') {
              const key = `${qId}_${val}`;
              stockUsage[r.surveyId][key] = (stockUsage[r.surveyId][key] || 0) + 1;
            } else if (Array.isArray(val)) {
              val.forEach((item: string) => {
                const key = `${qId}_${item}`;
                stockUsage[r.surveyId][key] = (stockUsage[r.surveyId][key] || 0) + 1;
              });
            }
          });
        }
      });

      return NextResponse.json({ stockUsage, participation });
    }

// 4. 배송 신청 응답 제출 (마감시간 서버 검증 및 수정 횟수 누적 반영)
if (action === 'SUBMIT_RESPONSE') {
  if (!auth.isAuth || !auth.email) {
    return NextResponse.json({ error: '로그인 또는 본인 인증이 필요합니다.' }, { status: 401 });
  }
  
  const { surveyId, answers } = rest;
  const secureEmail = auth.email; 
  
  const survey = await prisma.deliverySurvey.findUnique({ where: { id: surveyId } });
  if (!survey) return NextResponse.json({ error: '존재하지 않는 설문입니다.' }, { status: 404 });
  if (survey.status === '완료') return NextResponse.json({ error: '이미 마감 처리된 설문입니다.' }, { status: 403 });
  
  const now = new Date();
  const deadline = new Date(`${survey.endDate}T${survey.endTime || '23:59'}:00`);
  if (now > deadline) return NextResponse.json({ error: '제출 기한이 만료되었습니다.' }, { status: 403 });

  const newResponse = await prisma.deliveryResponse.upsert({
    where: { surveyId_userEmail: { surveyId, userEmail: secureEmail } },
    update: { 
      answers: answers || {}, 
      submittedAt: new Date(),
      revisionCount: { increment: 1 } // 🚀 수정 제출 시 기존 카운트에서 +1 누적
    },
    create: { 
      surveyId, 
      userEmail: secureEmail, 
      answers: answers || {}, 
      submittedAt: new Date(),
      revisionCount: 1 // 🚀 최초 제출 시 1로 시작
    }
  });
  return NextResponse.json(newResponse);
}

// --- 아래부터는 관리자 전용 액션 (LV_1) ---
if (!auth.isAdmin) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

// 5. 🚀 [복구 및 스키마 싱크 패치]: 관리자 결재 및 상태 제어 (Prisma 스키마 완벽 연동)
if (['APPROVE', 'CANCEL', 'FEEDBACK'].includes(action)) {
  const { surveyId, userEmail, feedbackMsg } = rest; // 💡 feedbackMsg로 변경하여 프론트 통신 규격 일치
  
  const updateData: any = {};
  
  if (action === 'APPROVE') {
    updateData.isApproved = true;
    updateData.approvedAt = new Date();
    updateData.isRevoked = false;
  } else if (action === 'CANCEL') {
    updateData.isApproved = false;
    updateData.approvedAt = null;
    updateData.isRevoked = true;
    if (feedbackMsg !== undefined) {
      updateData.feedbackMsg = feedbackMsg;
      updateData.feedbackAt = new Date();
    }
  } else if (action === 'FEEDBACK') {
    if (feedbackMsg !== undefined) {
      updateData.feedbackMsg = feedbackMsg;
      updateData.feedbackAt = new Date();
    }
  }

  const updatedResponse = await prisma.deliveryResponse.update({
    where: { surveyId_userEmail: { surveyId, userEmail } },
    data: updateData
  });
  return NextResponse.json(updatedResponse);
}

// 6. 관리자 독촉(NUDGE)
if (action === 'NUDGE') {
  const { surveyId, targetEmails } = rest;
  const updatedSurvey = await prisma.deliverySurvey.update({
    where: { id: surveyId },
    data: { nudgedUsers: targetEmails || [] }
  });
  return NextResponse.json(updatedSurvey);
}

// 7. 관리자 배송 공고 생성 및 수정 (🚀 ID 규칙을 D_ 로 복구)
const isNew = typeof id === 'string' && id.startsWith('D_');
const sanitizedQuestions = rest.questions 
  ? (typeof rest.questions === 'string' ? JSON.parse(rest.questions) : rest.questions) 
  : undefined; 
  
const updateData: any = { ...rest };
if (sanitizedQuestions !== undefined) updateData.questions = sanitizedQuestions;
if (updateData.postNumber !== undefined) updateData.postNumber = Number(updateData.postNumber) || 0;

let resultSurvey;
if (isNew) {
  resultSurvey = await prisma.deliverySurvey.create({ data: updateData });
} else {
  resultSurvey = await prisma.deliverySurvey.update({ where: { id: id }, data: updateData });
}
return NextResponse.json(resultSurvey);

} catch (error) {
    console.error("❌ Delivery Survey POST Error:", error);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 🔴 [DELETE] 배달 공고 영구 삭제 (최고 관리자 전용)
export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuth();
    if (!auth.isAdmin) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 파라미터 누락' }, { status: 400 });
      
    await prisma.deliverySurvey.delete({ where: { id: id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ Delivery Survey DELETE Error:", error);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}