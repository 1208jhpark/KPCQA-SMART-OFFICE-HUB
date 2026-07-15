import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import prisma from '@/lib/prisma';

// 💡 JWT_SECRET 통일
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
     
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuth();
    
    const text = await req.text();
    if (!text) return NextResponse.json({ error: "Empty Request Body" }, { status: 400 });
    const data = JSON.parse(text);
    const { action, id, ...rest } = data;

    // 🚀 외부 배포 페이지 교차 인증 엔진 (bcrypt 적용)
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
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24
      });
      return response;
    }
     
    // 🚀 [기능 1]: 응답 조회 (권한 격리 적용)
    if (action === 'GET_RESPONSES') {
      // 🚀 [기능 1.5]: 프론트엔드 UI용 통계 데이터 안전 제공 (민감 정보 제외)
    if (action === 'GET_STATS') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });

      const allResponses = await prisma.deliveryResponse.findMany({
        select: { surveyId: true, userEmail: true, answers: true }
      });

      const stockUsage: Record<string, Record<string, number>> = {};
      const participation: Record<string, boolean> = {};

      allResponses.forEach(r => {
        participation[`${r.surveyId}_${r.userEmail}`] = true;

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
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });
      const responses = await prisma.deliveryResponse.findMany({
        where: auth.isAdmin ? undefined : { userEmail: auth.email! },
        orderBy: { submittedAt: 'desc' }
      });
      return NextResponse.json(responses);
    }
     
    // 🚀 [기능 2 & 3]: 관리자 결재 제어 (최고 관리자 전용)
    if (['APPROVE', 'CANCEL', 'FEEDBACK'].includes(action)) {
      if (!auth.isAdmin) return NextResponse.json({ error: '결재 권한이 없습니다.' }, { status: 403 });

      const isApprove = action === 'APPROVE';
      const isCancel = action === 'CANCEL';

      const updatedResponse = await prisma.deliveryResponse.update({
        where: { surveyId_userEmail: { surveyId: rest.surveyId, userEmail: rest.userEmail } },
        data: {
          isApproved: isApprove, approvedAt: isApprove ? new Date() : null,
          isRevoked: isCancel, feedbackMsg: rest.feedbackMsg || null,
          feedbackAt: (isCancel || action === 'FEEDBACK') ? new Date() : null
        }
      });
      return NextResponse.json(updatedResponse);
    }
     
    // 🚀 [기능 4]: 직원 제출 처리 (서버 사이드 마감 검증)
    if (action === 'SUBMIT_RESPONSE') {
      if (!auth.isAuth || !auth.email) {
        return NextResponse.json({ error: '로그인 또는 본인 인증이 필요합니다.' }, { status: 401 });
      }
      const { surveyId, answers } = rest;
      const secureEmail = auth.email;

      // 💡 서버 사이드 비즈니스 로직 가드
      const survey = await prisma.deliverySurvey.findUnique({ where: { id: surveyId } });
      if (!survey) return NextResponse.json({ error: '존재하지 않는 설문입니다.' }, { status: 404 });
      if (survey.status === '완료') return NextResponse.json({ error: '이미 마감 처리된 설문입니다.' }, { status: 403 });
      
      const now = new Date();
      const deadline = new Date(`${survey.endDate}T${survey.endTime || '23:59'}:00`);
      if (now > deadline) return NextResponse.json({ error: '제출 기한이 만료되었습니다.' }, { status: 403 });
      
      const newResponse = await prisma.deliveryResponse.upsert({
        where: { surveyId_userEmail: { surveyId, userEmail: secureEmail } },
        update: { answers: answers || {}, submittedAt: new Date(), revisionCount: { increment: 1 } },
        create: {
          surveyId, userEmail: secureEmail, answers: answers || {}, submittedAt: new Date(),
          revisionCount: 0, isApproved: false, isRevoked: false
        }
      });
      return NextResponse.json(newResponse);
    }
     
    if (action === 'NUDGE') {
      if (!auth.isAdmin) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
      const { surveyId, targetEmails } = rest;
      const updatedSurvey = await prisma.deliverySurvey.update({
        where: { id: surveyId }, data: { nudgedUsers: targetEmails || [] }
      });
      return NextResponse.json(updatedSurvey);
    }
     
    if (!auth.isAdmin) return NextResponse.json({ error: '공고 관리 권한이 없습니다.' }, { status: 403 });

    const isNew = typeof id === 'string' && id.startsWith('D_');
    const sanitizedQuestions = rest.questions ? (typeof rest.questions === 'string' ? JSON.parse(rest.questions) : rest.questions) : [];
  
    let survey;
    if (isNew) {
      survey = await prisma.deliverySurvey.create({
        data: {
          code: rest.code, postNumber: Number(rest.postNumber) || 0, title: rest.title,
          description: rest.description || '', type: rest.type, deliveryType: rest.deliveryType,
          target: rest.target, postDate: rest.postDate, startDate: rest.startDate,
          endDate: rest.endDate, endTime: rest.endTime || '23:59', status: rest.status,
          hasBeenPublished: Boolean(rest.hasBeenPublished), questions: sanitizedQuestions 
        }
      });
    } else {
      const existingSurvey = await prisma.deliverySurvey.findUnique({ where: { id } });
      const finalQuestions = rest.questions ? sanitizedQuestions : (existingSurvey?.questions || []);
  
      survey = await prisma.deliverySurvey.update({
        where: { id: id },
        data: {
          code: rest.code ?? existingSurvey?.code, postNumber: rest.postNumber !== undefined ? Number(rest.postNumber) : existingSurvey?.postNumber,
          title: rest.title ?? existingSurvey?.title, description: rest.description ?? existingSurvey?.description,
          type: rest.type ?? existingSurvey?.type, deliveryType: rest.deliveryType ?? existingSurvey?.deliveryType,
          target: rest.target ?? existingSurvey?.target, postDate: rest.postDate ?? existingSurvey?.postDate,
          startDate: rest.startDate ?? existingSurvey?.startDate, endDate: rest.endDate ?? existingSurvey?.endDate,
          endTime: rest.endTime ?? existingSurvey?.endTime, status: rest.status ?? existingSurvey?.status,
          hasBeenPublished: rest.hasBeenPublished !== undefined ? Boolean(rest.hasBeenPublished) : existingSurvey?.hasBeenPublished,
          questions: finalQuestions
        }
      });
    }
    return NextResponse.json(survey);
  } catch (error) {
    console.error("Delivery Survey POST Master Error:", error);
    return NextResponse.json({ error: '데이터 인프라 저장 처리에 실패했습니다.' }, { status: 500 });
  }
}
     
export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuth();
    if (!auth.isAdmin) return NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: '삭제할 ID가 없습니다.' }, { status: 400 });
     
    await prisma.deliverySurvey.delete({ where: { id: id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delivery Survey DELETE Error:", error);
    return NextResponse.json({ error: '데이터 삭제에 실패했습니다.' }, { status: 500 });
  }
}