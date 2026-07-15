import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import prisma from '@/lib/prisma';

// 💡 JWT_SECRET 통일 (auth/login과 동일한 fallback 적용)
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

// 🟢 [GET] 일반 설문 목록 조회
export async function GET() {
  try {
    const surveys = await prisma.generalSurvey.findMany({
      orderBy: { postNumber: 'asc' },
    });
    return NextResponse.json(surveys, {
      headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }
    });
  } catch (error) {
    console.error("❌ General Survey GET Error:", error);
    return NextResponse.json({ error: '데이터베이스 조회에 실패했습니다.' }, { status: 500 });
  }
}
     
// 🔵 [POST] 통합 제어 엔진 (공고 관리 & 사용자 응답/조회)
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuth();
    
    // 🚀 [안정성] 빈 Body 예외 처리 방어 (req.text 활용)
    const text = await req.text();
    if (!text) return NextResponse.json({ error: "Empty Request Body" }, { status: 400 });
    const data = JSON.parse(text);
    const { action, id, ...rest } = data;

    // 🚀 [신규 추가]: 외부 배포 페이지용 교차 인증 엔진 (bcrypt 적용)
    if (action === 'VERIFY_PASSWORD') {
      const { userEmail, password } = rest;
      const user = await prisma.user.findUnique({ where: { email: userEmail } });
      
      // 💡 상태 및 bcrypt 해시 비밀번호 완벽 검증
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
     
    // 🚀 [파이프라인 1]: 응답 대장 수거 (데이터 노출 최소화 격리)
    if (action === 'GET_RESPONSES') {
      // 🚀 [파이프라인 1.5]: 프론트엔드 UI용 통계 데이터 안전 제공 (민감 정보 제외)
    if (action === 'GET_STATS') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });

      const allResponses = await prisma.generalResponse.findMany({
        select: { surveyId: true, userEmail: true, answers: true }
      });

      const stockUsage: Record<string, Record<string, number>> = {};
      const participation: Record<string, boolean> = {};

      allResponses.forEach(r => {
        // 참여 여부 플래그 (누가 참여했는지만 전달, 답변 내용은 숨김)
        participation[`${r.surveyId}_${r.userEmail}`] = true;

        // 서버 사이드 재고 집계
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
      
      // 💡 관리자는 전체, 일반 임직원은 본인 데이터만 가져오도록 쿼리 분리
      const responses = await prisma.generalResponse.findMany({
        where: auth.isAdmin ? undefined : { userEmail: auth.email! },
        orderBy: { submittedAt: 'desc' }
      });
      return NextResponse.json(responses);
    }
  
    // 🚀 [파이프라인 2]: 임직원 설문 응답 제출 (서버 사이드 마감 검증)
    if (action === 'SUBMIT_RESPONSE') {
      if (!auth.isAuth || !auth.email) {
        return NextResponse.json({ error: '로그인 또는 본인 인증이 필요합니다.' }, { status: 401 });
      }
      
      const { surveyId, answers } = rest;
      const secureEmail = auth.email; // Body 조작 원천 차단, 토큰 이메일 고정
      
      // 💡 서버 사이드 비즈니스 로직 가드 (마감 및 상태 체크)
      const survey = await prisma.generalSurvey.findUnique({ where: { id: surveyId } });
      if (!survey) return NextResponse.json({ error: '존재하지 않는 설문입니다.' }, { status: 404 });
      if (survey.status === '완료') return NextResponse.json({ error: '이미 마감 처리된 설문입니다.' }, { status: 403 });
      
      const now = new Date();
      const deadline = new Date(`${survey.endDate}T${survey.endTime || '23:59'}:00`);
      if (now > deadline) return NextResponse.json({ error: '제출 기한이 만료되었습니다.' }, { status: 403 });

      const newResponse = await prisma.generalResponse.upsert({
        where: { surveyId_userEmail: { surveyId, userEmail: secureEmail } },
        update: { answers: answers || {}, submittedAt: new Date() },
        create: { surveyId, userEmail: secureEmail, answers: answers || {}, submittedAt: new Date() }
      });
      return NextResponse.json(newResponse);
    }
    
    // 🚀 [기능]: 관리자 독촉(NUDGE) (최고 관리자 전용)
    if (action === 'NUDGE') {
      if (!auth.isAdmin) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
      const { surveyId, targetEmails } = rest;
      const updatedSurvey = await prisma.generalSurvey.update({
        where: { id: surveyId },
        data: { nudgedUsers: targetEmails || [] }
      });
      return NextResponse.json(updatedSurvey);
    }
     
    // ⚙️ [파이프라인 3]: 관리자 설문 공고 생성 및 수정 (최고 관리자 전용)
    if (!auth.isAdmin) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

    const isNew = typeof id === 'string' && id.startsWith('S_');
    const sanitizedQuestions = rest.questions 
      ? (typeof rest.questions === 'string' ? JSON.parse(rest.questions) : rest.questions) 
      : undefined; 
  
    let resultSurvey;
    if (isNew) {
      resultSurvey = await prisma.generalSurvey.create({
        data: {
          code: rest.code, postNumber: Number(rest.postNumber) || 0, title: rest.title,
          description: rest.description || '', type: rest.type, isAnonymous: Boolean(rest.isAnonymous),
          target: rest.target, postDate: rest.postDate, startDate: rest.startDate,
          endDate: rest.endDate, endTime: rest.endTime || '23:59', status: rest.status,
          hasBeenPublished: Boolean(rest.hasBeenPublished), questions: sanitizedQuestions || [] 
        },
      });
    } else {
      const updateData: any = {
        code: rest.code, postNumber: rest.postNumber !== undefined ? Number(rest.postNumber) : undefined,
        title: rest.title, description: rest.description, type: rest.type,
        isAnonymous: rest.isAnonymous !== undefined ? Boolean(rest.isAnonymous) : undefined,
        target: rest.target, postDate: rest.postDate, startDate: rest.startDate,
        endDate: rest.endDate, endTime: rest.endTime, status: rest.status,
        hasBeenPublished: rest.hasBeenPublished !== undefined ? Boolean(rest.hasBeenPublished) : undefined,
      };
      if (sanitizedQuestions !== undefined) updateData.questions = sanitizedQuestions;
  
      resultSurvey = await prisma.generalSurvey.update({
        where: { id: id },
        data: updateData,
      });
    }
    return NextResponse.json(resultSurvey);
  } catch (error) {
    console.error("❌ General Survey POST Error:", error);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
     
// 🔴 [DELETE] 설문 영구 삭제 (최고 관리자 전용)
export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuth();
    if (!auth.isAdmin) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 파라미터 누락' }, { status: 400 });
     
    await prisma.generalSurvey.delete({ where: { id: id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ General Survey DELETE Error:", error);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}