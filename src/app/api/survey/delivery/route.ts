import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import prisma from '@/lib/prisma';
import { parseKSTDeadline } from '@/utils/dateUtils';
import { authorizeAnyMenuPaths, authorizeApi } from '@/lib/server-auth-guard';

import { JWT_SECRET } from '@/lib/jwt';
import { buildInterfacePermissionSummary } from '@/lib/interface-permission-summary';
import { hubTokenCookieOptions } from '@/lib/auth-cookie';

const SURVEY_DELIVERY_ADMIN_PATHS = [
  '/survey/delivery/admin/active-surveys',
  '/survey/delivery/admin/history',
  '/survey/delivery/admin/survey-builder',
];

function normalizeMenuPath(path: string) {
  return String(path || '').replace(/\/$/, '').toLowerCase();
}

function isDeliveryAdminPath(path: string | undefined | null) {
  if (!path) return false;
  const clean = normalizeMenuPath(path);
  return SURVEY_DELIVERY_ADMIN_PATHS.some((p) => normalizeMenuPath(p) === clean);
}

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

/** 배달 설문 관리 메뉴 접근 — 하위 admin 경로 중 하나라도 Access면 통과 */
async function tryDeliveryManagerAuth(requireEditor = false) {
  try {
    return await authorizeAnyMenuPaths(
      SURVEY_DELIVERY_ADMIN_PATHS,
      requireEditor ? { requireEditor: true } : undefined
    );
  } catch {
    return null;
  }
}

/**
 * 편집 권한은 “지금 보고 있는 메뉴 1곳” 기준으로만 판정.
 * menuPath 누락 시 active로 폴백하면 Master(active)가 빌더 편집까지 열어버림 → 폴백 금지
 */
async function tryDeliveryEditorOnPath(menuPath?: string | null) {
  if (!isDeliveryAdminPath(menuPath)) return null;
  try {
    return await authorizeApi(String(menuPath), { requireEditor: true });
  } catch {
    return null;
  }
}

function stripControlFields(payload: Record<string, any>) {
  const {
    menuPath: _menuPath,
    action: _action,
    id: _id,
    ...data
  } = payload;
  return data;
}

/** 기존 단건 DeliveryResponse → 이벤트 이력이 없을 때만 1회 합성 */
async function ensureDeliveryResponseEvents(surveyId: string, userEmail: string) {
  const count = await prisma.deliveryResponseEvent.count({
    where: { surveyId, userEmail },
  });
  if (count > 0) return;

  const resp = await prisma.deliveryResponse.findUnique({
    where: { surveyId_userEmail: { surveyId, userEmail } },
  });
  if (!resp) return;

  const rows: Array<{
    surveyId: string;
    userEmail: string;
    type: string;
    revisionNo: number | null;
    message: string | null;
    answers: any;
    actorEmail: string | null;
    createdAt: Date;
  }> = [];

  rows.push({
    surveyId,
    userEmail,
    type: 'USER_SUBMIT',
    revisionNo: resp.revisionCount || 1,
    message: null,
    answers: resp.answers ?? {},
    actorEmail: userEmail,
    createdAt: resp.submittedAt,
  });

  if (resp.feedbackAt && resp.feedbackMsg) {
    rows.push({
      surveyId,
      userEmail,
      type: resp.isRevoked ? 'ADMIN_CANCEL' : 'ADMIN_FEEDBACK',
      revisionNo: null,
      message: resp.feedbackMsg,
      answers: null,
      actorEmail: null,
      createdAt: resp.feedbackAt,
    });
  }

  if (resp.approvedAt && resp.isApproved) {
    rows.push({
      surveyId,
      userEmail,
      type: 'ADMIN_APPROVE',
      revisionNo: null,
      message: null,
      answers: null,
      actorEmail: null,
      createdAt: resp.approvedAt,
    });
  }

  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (rows.length > 0) {
    await prisma.deliveryResponseEvent.createMany({
      data: rows.map(({ answers, ...rest }) => ({
        ...rest,
        ...(answers != null ? { answers } : {}),
      })),
    });
  }
}

async function appendDeliveryResponseEvent(data: {
  surveyId: string;
  userEmail: string;
  type: string;
  revisionNo?: number | null;
  message?: string | null;
  answers?: any;
  actorEmail?: string | null;
  actorName?: string | null;
}) {
  return prisma.deliveryResponseEvent.create({
    data: {
      surveyId: data.surveyId,
      userEmail: data.userEmail,
      type: data.type,
      revisionNo: data.revisionNo ?? null,
      message: data.message ?? null,
      answers: data.answers ?? undefined,
      actorEmail: data.actorEmail ?? null,
      actorName: data.actorName ?? null,
    },
  });
}

function resolveScopedUnitIds(
  user: { unit_id?: string | null },
  unitsList: Array<{ id: string; parent_id?: string | null }>,
  viewScope: string
): string[] | null {
  const scope = String(viewScope || 'TOTAL').toUpperCase();
  if (scope === 'TOTAL') return null;
  if (!user.unit_id) return [];

  const ids = new Set<string>();
  const my = unitsList.find((u) => u.id === user.unit_id);
  if (my?.parent_id) ids.add(my.parent_id);
  ids.add(user.unit_id);

  const walk = (parentId: string) => {
    unitsList
      .filter((u) => u.parent_id === parentId)
      .forEach((c) => {
        ids.add(c.id);
        walk(c.id);
      });
  };
  walk(user.unit_id);
  return Array.from(ids);
}

function effectiveViewScope(viewScope: string) {
  return String(viewScope || 'TOTAL').toUpperCase() === 'OWN' ? 'DEPT' : viewScope;
}

// 🟢 [GET] 배달/조사 설문 목록 조회 (로그인 필수 / 비관리자는 독촉 이메일 목록 최소화)
export async function GET() {
  try {
    const auth = await getAuth();
    if (!auth.isAuth || !auth.email) {
      return NextResponse.json({ error: '로그인 후 이용할 수 있습니다.' }, { status: 401 });
    }

    const surveys = await prisma.deliverySurvey.findMany({
      orderBy: { postNumber: 'asc' },
    });

    const deliveryManager = auth.isAdmin ? true : !!(await tryDeliveryManagerAuth(false));

    // LV_1·배달관리자: 전체 필드 / 일반: nudgedUsers에 본인 이메일만
    const payload = deliveryManager
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
      response.cookies.set('token', token, hubTokenCookieOptions());
      return response;
    }

    // 2. 🚀 [GET_RESPONSES] 응답 조회 (배달관리자: 범위 내 / 일반: 본인만)
    if (action === 'GET_RESPONSES') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });

      if (auth.isAdmin) {
        const responses = await prisma.deliveryResponse.findMany({
          orderBy: { submittedAt: 'desc' },
        });
        return NextResponse.json(responses);
      }

      const mgr = await tryDeliveryManagerAuth(false);
      if (!mgr) {
        const responses = await prisma.deliveryResponse.findMany({
          where: { userEmail: auth.email! },
          orderBy: { submittedAt: 'desc' },
        });
        return NextResponse.json(responses);
      }

      const scopedIds = mgr.permission.isMaster
        ? null
        : resolveScopedUnitIds(
            mgr.user,
            mgr.unitsList,
            effectiveViewScope(mgr.permission.viewScope)
          );

      let where: any = undefined;
      if (scopedIds) {
        const scopedUsers = await prisma.user.findMany({
          where: { unit_id: { in: scopedIds } },
          select: { email: true },
        });
        where = { userEmail: { in: scopedUsers.map((u) => u.email) } };
      }

      const responses = await prisma.deliveryResponse.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
      });
      return NextResponse.json(responses);
    }

    // 2-a. 제출·관리자 의견 전 이력 타임라인
    if (action === 'GET_RESPONSE_EVENTS') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });
      const { surveyId, userEmail } = rest;
      if (!surveyId || !userEmail) {
        return NextResponse.json({ error: 'surveyId, userEmail이 필요합니다.' }, { status: 400 });
      }

      let canSee = auth.isAdmin || auth.email === userEmail;
      if (!canSee) {
        const mgr = await tryDeliveryManagerAuth(false);
        if (mgr) {
          if (mgr.permission.isMaster) {
            canSee = true;
          } else {
            const scopedIds = resolveScopedUnitIds(
              mgr.user,
              mgr.unitsList,
              effectiveViewScope(mgr.permission.viewScope)
            );
            const targetUser = await prisma.user.findUnique({
              where: { email: userEmail },
              select: { unit_id: true },
            });
            // null = TOTAL(전체) → 허용 / 배열 = 스코프 내 unit만
            canSee =
              scopedIds === null
                ? true
                : !!(targetUser?.unit_id && scopedIds.includes(targetUser.unit_id));
          }
        }
      }
      if (!canSee) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 403 });

      await ensureDeliveryResponseEvents(surveyId, userEmail);

      const events = await prisma.deliveryResponseEvent.findMany({
        where: { surveyId, userEmail },
        orderBy: { createdAt: 'asc' },
      });
      return NextResponse.json(events);
    }

    // 2-b. 배달 관리 화면용 조직·사용자 명단 (LV_2·3 + 부서 게이트)
    if (action === 'GET_ADMIN_CONTEXT') {
      const mgr = await tryDeliveryManagerAuth(false);
      if (!mgr) {
        return NextResponse.json({ error: '배달 설문 관리 권한이 없습니다.' }, { status: 403 });
      }

      const scopedIds = auth.isAdmin || mgr.permission.isMaster
        ? null
        : resolveScopedUnitIds(
            mgr.user,
            mgr.unitsList,
            effectiveViewScope(mgr.permission.viewScope)
          );

      const [units, users] = await Promise.all([
        prisma.orgUnit.findMany({
          where: { is_deleted: false, is_active: true },
          select: { id: true, unit_name: true, parent_id: true, sort_order: true },
          orderBy: { sort_order: 'asc' },
        }),
        prisma.user.findMany({
          where: {
            status: 'Active',
            ...(scopedIds ? { unit_id: { in: scopedIds } } : {}),
          },
          select: {
            id: true,
            name: true,
            email: true,
            unit_id: true,
            unit: { select: { id: true, unit_name: true } },
          },
          orderBy: { name: 'asc' },
        }),
      ]);

      const mappedUsers = users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        unit_id: u.unit_id,
        dept: u.unit?.unit_name || '소속없음',
      }));

      return NextResponse.json({
        users: mappedUsers,
        units,
        scopeDepts: scopedIds
          ? units.filter((u) => scopedIds.includes(u.id)).map((u) => u.unit_name)
          : units.map((u) => u.unit_name),
        viewScope: auth.isAdmin || mgr.permission.isMaster ? 'TOTAL' : mgr.permission.viewScope,
        // 편집은 요청 메뉴(path) 1곳 기준 — 형제 메뉴(빌더 등) OR 합산 금지
        canEdit: !!(auth.isAdmin || (await tryDeliveryEditorOnPath(rest.menuPath))),
        permissionSummary: await buildInterfacePermissionSummary(
          rest.menuPath || '/survey/delivery/admin/active-surveys'
        ),
      });
    }

    // 3. 🚀 [GET_STATS] 전사 통계 조회 (이메일 비노출 — 참여수 + 대상인원수만)
    if (action === 'GET_STATS') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });

      const [allResponses, surveyRows, activeUsers, units] = await Promise.all([
        prisma.deliveryResponse.findMany({
          select: { surveyId: true, answers: true },
        }),
        prisma.deliverySurvey.findMany({
          select: { id: true, target: true },
        }),
        prisma.user.findMany({
          where: { status: 'Active' },
          select: {
            unit_id: true,
            unit: { select: { id: true, unit_name: true, parent_id: true } },
          },
        }),
        prisma.orgUnit.findMany({
          where: { is_deleted: false },
          select: { id: true, unit_name: true, parent_id: true },
        }),
      ]);

      const stockUsage: Record<string, Record<string, number>> = {};
      const participation: Record<string, number> = {};
      const targetCounts: Record<string, number> = {};

      allResponses.forEach((r: any) => {
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

      const isDeptInTarget = (targetString: string, userDeptName: string | null | undefined) => {
        if (!targetString || targetString === '전사') return true;
        if (!userDeptName) return false;
        const targetDepts = targetString.split(',').map((t) => t.trim()).filter(Boolean);
        if (targetDepts.includes(userDeptName)) return true;
        let currentId = units.find((u) => u.unit_name === userDeptName)?.id as string | undefined;
        while (currentId) {
          const unit = units.find((u) => u.id === currentId);
          if (unit?.parent_id) {
            const parent = units.find((u) => u.id === unit.parent_id);
            if (parent && targetDepts.includes(parent.unit_name)) return true;
            currentId = unit.parent_id;
          } else break;
        }
        return false;
      };

      surveyRows.forEach((s) => {
        targetCounts[s.id] = activeUsers.filter((u) =>
          isDeptInTarget(s.target || '', u.unit?.unit_name)
        ).length;
      });

      return NextResponse.json({ stockUsage, participation, targetCounts });
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
  
  const deadline = parseKSTDeadline(survey.endDate, survey.endTime);
  if (Number.isNaN(deadline.getTime()) || Date.now() > deadline.getTime()) {
    return NextResponse.json({ error: '제출 기한이 만료되었습니다.' }, { status: 403 });
  }

  const existing = await prisma.deliveryResponse.findUnique({
    where: { surveyId_userEmail: { surveyId, userEmail: secureEmail } },
  });
  // 수정 제출 전에만 시드: 이번 upsert 이전 상태를 이력으로 보존
  if (existing) {
    await ensureDeliveryResponseEvents(surveyId, secureEmail);
  }

  const newResponse = await prisma.deliveryResponse.upsert({
    where: { surveyId_userEmail: { surveyId, userEmail: secureEmail } },
    update: { 
      answers: answers || {}, 
      submittedAt: new Date(),
      revisionCount: { increment: 1 },
      isApproved: false,
      approvedAt: null,
      isRevoked: false,
    },
    create: { 
      surveyId, 
      userEmail: secureEmail, 
      answers: answers || {}, 
      submittedAt: new Date(),
      revisionCount: 1
    }
  });

  await appendDeliveryResponseEvent({
    surveyId,
    userEmail: secureEmail,
    type: 'USER_SUBMIT',
    revisionNo: newResponse.revisionCount,
    answers: answers || {},
    actorEmail: secureEmail,
  });

  return NextResponse.json(newResponse);
}

// --- 아래부터는 배달 관리자 전용 (LV_1 또는 해당 메뉴 편집 권한) ---
if (!auth.isAdmin) {
  const editor = await tryDeliveryEditorOnPath(rest.menuPath);
  if (!editor) return NextResponse.json({ error: '편집 권한이 없습니다.' }, { status: 403 });
}

// 5. 🚀 [복구 및 스키마 싱크 패치]: 관리자 결재 및 상태 제어 (Prisma 스키마 완벽 연동)
if (['APPROVE', 'CANCEL', 'FEEDBACK'].includes(action)) {
  const { surveyId, userEmail, feedbackMsg } = rest;
  
  const updateData: any = {};
  let eventType = '';
  let eventMessage: string | null = null;
  
  if (action === 'APPROVE') {
    updateData.isApproved = true;
    updateData.approvedAt = new Date();
    updateData.isRevoked = false;
    eventType = 'ADMIN_APPROVE';
  } else if (action === 'CANCEL') {
    updateData.isApproved = false;
    updateData.approvedAt = null;
    updateData.isRevoked = true;
    if (feedbackMsg !== undefined) {
      updateData.feedbackMsg = feedbackMsg;
      updateData.feedbackAt = new Date();
    }
    eventType = 'ADMIN_CANCEL';
    eventMessage = feedbackMsg ?? null;
  } else if (action === 'FEEDBACK') {
    if (feedbackMsg !== undefined) {
      updateData.feedbackMsg = feedbackMsg;
      updateData.feedbackAt = new Date();
    }
    updateData.isApproved = false;
    updateData.approvedAt = null;
    eventType = 'ADMIN_FEEDBACK';
    eventMessage = feedbackMsg ?? null;
  }

  await ensureDeliveryResponseEvents(surveyId, userEmail);

  const updatedResponse = await prisma.deliveryResponse.update({
    where: { surveyId_userEmail: { surveyId, userEmail } },
    data: updateData
  });

  let actorName: string | null = null;
  if (auth.email) {
    const actor = await prisma.user.findUnique({
      where: { email: auth.email },
      select: { name: true },
    });
    actorName = actor?.name || null;
  }

  await appendDeliveryResponseEvent({
    surveyId,
    userEmail,
    type: eventType,
    message: eventMessage,
    actorEmail: auth.email,
    actorName,
  });

  return NextResponse.json(updatedResponse);
}

// 6. 관리자 독촉(NUDGE) — 기존 독촉 대상에 이번 미참여자를 merge
if (action === 'NUDGE') {
  const { surveyId } = rest;
  if (!surveyId) {
    return NextResponse.json({ error: '설문 ID가 필요합니다.' }, { status: 400 });
  }

  const survey = await prisma.deliverySurvey.findUnique({ where: { id: surveyId } });
  if (!survey) return NextResponse.json({ error: '설문을 찾을 수 없습니다.' }, { status: 404 });

  const emails: string[] = Array.isArray(rest.targetEmails)
    ? rest.targetEmails.map((e: unknown) => String(e || '').trim()).filter(Boolean)
    : [];

  const prevNudged = Array.isArray(survey.nudgedUsers) ? survey.nudgedUsers : [];
  const merged = Array.from(new Set([...prevNudged, ...emails]));

  const updatedSurvey = await prisma.deliverySurvey.update({
    where: { id: surveyId },
    data: { nudgedUsers: merged },
  });
  return NextResponse.json({
    ...updatedSurvey,
    nudgedCount: emails.length,
  });
}

// 7. 관리자 배송 공고 생성 및 수정 (🚀 ID 규칙을 D_ 로 복구)
const isNew = typeof id === 'string' && id.startsWith('D_');
const cleaned = stripControlFields(rest);
const sanitizedQuestions = cleaned.questions 
  ? (typeof cleaned.questions === 'string' ? JSON.parse(cleaned.questions) : cleaned.questions) 
  : undefined; 
  
const updateData: any = { ...cleaned };
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