import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import prisma from '@/lib/prisma';
import { parseKSTDeadline } from '@/utils/dateUtils';

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

// 🟢 [GET] 일반 설문 목록 조회 (로그인 필수 / 비관리자는 독촉 이메일 목록 최소화)
export async function GET() {
  try {
    const auth = await getAuth();
    if (!auth.isAuth || !auth.email) {
      return NextResponse.json({ error: '로그인 후 이용할 수 있습니다.' }, { status: 401 });
    }

    const surveys = await prisma.generalSurvey.findMany({
      orderBy: { postNumber: 'asc' },
    });

    // LV_1: 전체 필드 / 일반: nudgedUsers에 본인 이메일만 남겨 타인 이메일 노출 차단
    const payload = auth.isAdmin
      ? surveys
      : surveys.map((s: any) => {
          const nudged = Array.isArray(s.nudgedUsers) ? s.nudgedUsers : [];
          return {
            ...s,
            nudgedUsers: nudged.includes(auth.email!) ? [auth.email!] : [],
          };
        });

    return NextResponse.json(payload, {
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

    // 2. 🚀 [GET_RESPONSES] 응답 조회 (관리자는 전체, 일반 임직원은 본인 데이터만)
    if (action === 'GET_RESPONSES') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });
      
      const responses = await prisma.generalResponse.findMany({
        where: auth.isAdmin ? undefined : { userEmail: auth.email! },
        orderBy: { submittedAt: 'desc' }
      });
      return NextResponse.json(responses);
    }

// 3. 🚀 [GET_STATS] 전사 통계 조회 (이메일 노출 원천 차단 - 카운트만 제공)
if (action === 'GET_STATS') {
  if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });

  // 💡 이메일 정보를 아예 DB에서 가져오지 않음 (완벽한 익명 보안)
  const allResponses = await prisma.generalResponse.findMany({
    select: { surveyId: true, answers: true } 
  });

  const stockUsage: Record<string, Record<string, number>> = {};
  const participation: Record<string, number> = {};

  allResponses.forEach((r: any) => {
    // 이메일 대신 "해당 설문에 제출된 전체 응답 수(done)"만 +1 씩 누적
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

    // 4. 설문 응답 제출 (서버 사이드 마감 검증)
    if (action === 'SUBMIT_RESPONSE') {
      if (!auth.isAuth || !auth.email) {
        return NextResponse.json({ error: '로그인 또는 본인 인증이 필요합니다.' }, { status: 401 });
      }
      
      const { surveyId, answers } = rest;
      const secureEmail = auth.email; 
      
      const survey = await prisma.generalSurvey.findUnique({ where: { id: surveyId } });
      if (!survey) return NextResponse.json({ error: '존재하지 않는 설문입니다.' }, { status: 404 });
      if (survey.status === '완료') return NextResponse.json({ error: '이미 마감 처리된 설문입니다.' }, { status: 403 });
      
      const deadline = parseKSTDeadline(survey.endDate, survey.endTime);
      if (Number.isNaN(deadline.getTime()) || Date.now() > deadline.getTime()) {
        return NextResponse.json({ error: '제출 기한이 만료되었습니다.' }, { status: 403 });
      }

      const newResponse = await prisma.generalResponse.upsert({
        where: { surveyId_userEmail: { surveyId, userEmail: secureEmail } },
        update: { answers: answers || {}, submittedAt: new Date() },
        create: { surveyId, userEmail: secureEmail, answers: answers || {}, submittedAt: new Date() }
      });
      return NextResponse.json(newResponse);
    }

    // --- 아래부터는 관리자 전용 액션 (LV_1) ---
    if (!auth.isAdmin) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

    // 5. 관리자 독촉(NUDGE)
    if (action === 'NUDGE') {
      const { surveyId, targetEmails } = rest;
      const updatedSurvey = await prisma.generalSurvey.update({
        where: { id: surveyId },
        data: { nudgedUsers: targetEmails || [] }
      });
      return NextResponse.json(updatedSurvey);
    }

    // 6. 관리자 설문 공고 생성 및 수정
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