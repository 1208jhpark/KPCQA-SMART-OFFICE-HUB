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
import {
  userInSurveyTarget,
  parseSurveyTargetUnitIds,
} from '@/lib/survey-target-match';
import { hashSurveyParticipantEmail } from '@/lib/survey-anonymous-hash';

const SURVEY_GENERAL_ADMIN_PATHS = [
  '/survey/general/admin/active-surveys',
  '/survey/general/admin/survey-history',
  '/survey/general/admin/survey-builder',
];

function normalizeMenuPath(path: string) {
  return String(path || '').replace(/\/$/, '').toLowerCase();
}

function isGeneralAdminPath(path: string | undefined | null) {
  if (!path) return false;
  const clean = normalizeMenuPath(path);
  return SURVEY_GENERAL_ADMIN_PATHS.some((p) => normalizeMenuPath(p) === clean);
}

/**
 * 익명 설문 응답 페이로드
 * - 참여: GeneralAnonymousParticipation (emailHash)
 * - 본문: GeneralAnonymousAnswer (신원 없음)
 * - 기명: GeneralResponse 그대로
 */
async function buildGeneralResponsesPayload(options: {
  viewerEmail: string | null;
  /** 기명 응답 where (undefined = 기명 전체) */
  namedWhere?: Record<string, unknown>;
  /** 관리자/매니저가 익명 답변 본문 포함 */
  revealAnonymousAnswers: boolean;
}) {
  const viewer = String(options.viewerEmail || '').trim();

  const namedResponses = await prisma.generalResponse.findMany({
    where: {
      survey: { isAnonymous: false },
      ...(options.namedWhere || {}),
    } as any,
    orderBy: { submittedAt: 'desc' },
  });

  const anonSurveys = await prisma.generalSurvey.findMany({
    where: { isAnonymous: true },
    select: { id: true },
  });
  const anonIds = anonSurveys.map((s) => s.id);

  const anonymousParticipationCounts: Record<string, number> = {};
  if (anonIds.length > 0) {
    const grouped = await prisma.generalAnonymousParticipation.groupBy({
      by: ['surveyId'],
      where: { surveyId: { in: anonIds } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      anonymousParticipationCounts[g.surveyId] = g._count._all;
    }
    for (const id of anonIds) {
      if (anonymousParticipationCounts[id] == null) anonymousParticipationCounts[id] = 0;
    }
  }

  const responses: any[] = [...namedResponses];

  // 본인 참여 stub — 허브/마이페이지 "제출 여부" 매칭용 (답변 본문 없음)
  if (viewer && anonIds.length > 0) {
    const wantedKeys = new Set(
      anonIds.map((id) => `${id}:${hashSurveyParticipantEmail(id, viewer)}`)
    );
    const hashList = anonIds.map((id) => hashSurveyParticipantEmail(id, viewer));
    const mine = await prisma.generalAnonymousParticipation.findMany({
      where: { surveyId: { in: anonIds }, emailHash: { in: hashList } },
    });
    for (const p of mine) {
      if (!wantedKeys.has(`${p.surveyId}:${p.emailHash}`)) continue;
      responses.push({
        id: p.id,
        surveyId: p.surveyId,
        userEmail: viewer,
        answers: {},
        submittedAt: p.submittedAt,
        isApproved: false,
        anonymousParticipationOnly: true,
      });
    }
  }

  // 관리자 추출용 익명 본문 — 마스킹 이메일만 부여 (DB 신원과 무관)
  if (options.revealAnonymousAnswers && anonIds.length > 0) {
    const answers = await prisma.generalAnonymousAnswer.findMany({
      where: { surveyId: { in: anonIds } },
      orderBy: { submittedAt: 'asc' },
    });
    const anonIndexBySurvey: Record<string, number> = {};
    for (const a of answers) {
      anonIndexBySurvey[a.surveyId] = (anonIndexBySurvey[a.surveyId] || 0) + 1;
      const n = anonIndexBySurvey[a.surveyId];
      responses.push({
        id: a.id,
        surveyId: a.surveyId,
        userEmail: `anonymous-${n}@masked.local`,
        answers: a.answers ?? {},
        submittedAt: a.submittedAt,
        isApproved: false,
        anonymousContent: true,
      });
    }
  }

  return { responses, anonymousParticipationCounts };
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

/** 설문 관리 메뉴 접근 — 하위 admin 경로 중 하나라도 Access면 통과 */
async function trySurveyManagerAuth(requireEditor = false) {
  try {
    return await authorizeAnyMenuPaths(
      SURVEY_GENERAL_ADMIN_PATHS,
      requireEditor ? { requireEditor: true } : undefined
    );
  } catch {
    return null;
  }
}

/**
 * 편집 권한은 “지금 보고 있는 메뉴 1곳” 기준만.
 * menuPath 누락 시 active로 폴백하면 Master(active)가 빌더 편집까지 열어버림 → 폴백 금지
 */
async function trySurveyEditorOnPath(menuPath?: string | null) {
  if (!isGeneralAdminPath(menuPath)) return null;
  try {
    return await authorizeApi(String(menuPath), { requireEditor: true });
  } catch {
    return null;
  }
}

/** Access(조회) 권한 — 긴급 게시중단 등 Edit 없이 허용할 때 */
async function trySurveyAccessOnPath(menuPath?: string | null) {
  if (!isGeneralAdminPath(menuPath)) return null;
  try {
    return await authorizeApi(String(menuPath));
  } catch {
    return null;
  }
}

/** viewScope 기준 조직 범위 (null = 전사) */
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

    const surveyManager = auth.isAdmin ? true : !!(await trySurveyManagerAuth(false));

    // LV_1·설문관리자: 전체 필드 / 일반: nudgedUsers에 본인 이메일만 남겨 타인 이메일 노출 차단
    const payload = surveyManager
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
      response.cookies.set('token', token, hubTokenCookieOptions());
      return response;
    }

    // 2. 🚀 [GET_RESPONSES] 응답 조회 (설문관리자: 기명 범위 / 익명: 참여해시+분리본문)
    // 익명 답변 원문: includeAnonymousAnswers=true (관리자·매니저)
    if (action === 'GET_RESPONSES') {
      if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });

      const wantAnonymousAnswers = rest.includeAnonymousAnswers === true;

      if (auth.isAdmin) {
        return NextResponse.json(
          await buildGeneralResponsesPayload({
            viewerEmail: auth.email,
            revealAnonymousAnswers: wantAnonymousAnswers,
          })
        );
      }

      const mgr = await trySurveyManagerAuth(false);
      if (!mgr) {
        return NextResponse.json(
          await buildGeneralResponsesPayload({
            viewerEmail: auth.email,
            namedWhere: {
              userEmail: { equals: auth.email!, mode: 'insensitive' },
            },
            revealAnonymousAnswers: false,
          })
        );
      }

      const scopedIds =
        mgr.permission.isMaster
          ? null
          : resolveScopedUnitIds(
              mgr.user,
              mgr.unitsList,
              String(mgr.permission.viewScope || 'TOTAL').toUpperCase() === 'OWN'
                ? 'DEPT'
                : mgr.permission.viewScope
            );

      let namedWhere: Record<string, unknown> | undefined;
      if (scopedIds) {
        const scopedUsers = await prisma.user.findMany({
          where: { unit_id: { in: scopedIds } },
          select: { email: true },
        });
        namedWhere = { userEmail: { in: scopedUsers.map((u) => u.email) } };
      }

      return NextResponse.json(
        await buildGeneralResponsesPayload({
          viewerEmail: auth.email,
          namedWhere,
          revealAnonymousAnswers: wantAnonymousAnswers,
        })
      );
    }

    // 2-b. 설문 관리 화면용 조직·사용자 명단 (LV_2 메뉴 권한 허용, /api/admin/users 대체)
    if (action === 'GET_ADMIN_CONTEXT') {
      const mgr = await trySurveyManagerAuth(false);
      if (!mgr) {
        return NextResponse.json({ error: '설문 관리 권한이 없습니다.' }, { status: 403 });
      }

      const scopedIds = auth.isAdmin || mgr.permission.isMaster
        ? null
        : resolveScopedUnitIds(
            mgr.user,
            mgr.unitsList,
            // OWN은 현황판용으로 연계 부서(DEPT) 범위로 확장
            String(mgr.permission.viewScope || 'TOTAL').toUpperCase() === 'OWN'
              ? 'DEPT'
              : mgr.permission.viewScope
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
        canEdit: !!(auth.isAdmin || (await trySurveyEditorOnPath(rest.menuPath))),
        permissionSummary: await buildInterfacePermissionSummary(
          rest.menuPath || '/survey/general/admin/active-surveys'
        ),
      });
    }

// 3. 🚀 [GET_STATS] 전사 통계 조회 (이메일 비노출 — 참여수 + 대상인원수만)
if (action === 'GET_STATS') {
  if (!auth.isAuth) return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 401 });

  const [allResponses, surveyRows, activeUsers, units] = await Promise.all([
    prisma.generalResponse.findMany({
      select: { surveyId: true, answers: true },
    }),
    prisma.generalSurvey.findMany({
      select: { id: true, target: true, target_unit_ids: true },
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

  surveyRows.forEach((s) => {
    targetCounts[s.id] = activeUsers.filter((u) =>
      userInSurveyTarget({
        userUnitId: u.unit_id || u.unit?.id,
        userDeptName: u.unit?.unit_name,
        target: s.target,
        targetUnitIds: (s as { target_unit_ids?: unknown }).target_unit_ids,
        units,
      })
    ).length;
  });

  return NextResponse.json({ stockUsage, participation, targetCounts });
}

    // 4. 설문 응답 제출 (서버 사이드 마감·대상 검증)
    if (action === 'SUBMIT_RESPONSE') {
      if (!auth.isAuth || !auth.email) {
        return NextResponse.json({ error: '로그인 또는 본인 인증이 필요합니다.' }, { status: 401 });
      }
      
      const { surveyId, answers } = rest;
      const secureEmail = auth.email; 
      
      const survey = await prisma.generalSurvey.findUnique({ where: { id: surveyId } });
      if (!survey) return NextResponse.json({ error: '존재하지 않는 설문입니다.' }, { status: 404 });
      if (survey.status !== '진행중') {
        return NextResponse.json({ error: '진행 중인 설문만 제출할 수 있습니다.' }, { status: 403 });
      }
      
      const deadline = parseKSTDeadline(survey.endDate, survey.endTime);
      if (Number.isNaN(deadline.getTime()) || Date.now() > deadline.getTime()) {
        return NextResponse.json({ error: '제출 기한이 만료되었습니다.' }, { status: 403 });
      }

      if (!auth.isAdmin) {
        const [dbUser, units] = await Promise.all([
          prisma.user.findFirst({
            where: { email: { equals: secureEmail, mode: 'insensitive' } },
            select: {
              unit_id: true,
              unit: { select: { id: true, unit_name: true, parent_id: true } },
            },
          }),
          prisma.orgUnit.findMany({
            where: { is_deleted: false, is_active: true },
            select: { id: true, unit_name: true, parent_id: true },
          }),
        ]);
        const allowed = userInSurveyTarget({
          userUnitId: dbUser?.unit_id || dbUser?.unit?.id,
          userDeptName: dbUser?.unit?.unit_name,
          target: survey.target,
          targetUnitIds: (survey as { target_unit_ids?: unknown }).target_unit_ids,
          units,
        });
        if (!allowed) {
          return NextResponse.json({ error: '설문 대상이 아닙니다.' }, { status: 403 });
        }
      }

      // 익명: 참여 해시 + 응답 본문 분리 저장 (평문 이메일·답변 매칭 불가)
      if (survey.isAnonymous) {
        const emailHash = hashSurveyParticipantEmail(surveyId, secureEmail);
        const existing = await prisma.generalAnonymousParticipation.findUnique({
          where: { surveyId_emailHash: { surveyId, emailHash } },
          select: { id: true },
        });
        if (existing) {
          return NextResponse.json(
            { error: '익명 설문은 제출 후 답변을 수정할 수 없습니다.' },
            { status: 403 }
          );
        }

        const created = await prisma.$transaction(async (tx) => {
          const participation = await tx.generalAnonymousParticipation.create({
            data: { surveyId, emailHash },
          });
          const answer = await tx.generalAnonymousAnswer.create({
            data: { surveyId, answers: answers || {} },
          });
          return { participationId: participation.id, answerId: answer.id, surveyId };
        });

        return NextResponse.json({
          success: true,
          surveyId: created.surveyId,
          anonymous: true,
        });
      }

      const newResponse = await prisma.generalResponse.upsert({
        where: { surveyId_userEmail: { surveyId, userEmail: secureEmail } },
        update: { answers: answers || {}, submittedAt: new Date() },
        create: {
          surveyId,
          userEmail: secureEmail,
          answers: answers || {},
          submittedAt: new Date(),
        },
      });
      return NextResponse.json(newResponse);
    }

    // --- 긴급 게시중단: Access만으로 허용 (Edit 불필요) ---
    if (action === 'PAUSE') {
      if (!auth.isAdmin) {
        const access = await trySurveyAccessOnPath(rest.menuPath);
        if (!access) {
          return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
        }
      }
      const surveyId = String(id || rest.surveyId || '').trim();
      if (!surveyId) {
        return NextResponse.json({ error: '설문 ID가 필요합니다.' }, { status: 400 });
      }
      const existing = await prisma.generalSurvey.findUnique({ where: { id: surveyId } });
      if (!existing) {
        return NextResponse.json({ error: '설문을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (existing.status !== '진행중') {
        return NextResponse.json(
          { error: '진행 중인 설문만 중단할 수 있습니다.' },
          { status: 400 }
        );
      }
      const paused = await prisma.generalSurvey.update({
        where: { id: surveyId },
        data: { status: '게시중단' },
      });
      return NextResponse.json(paused);
    }

    // --- 아래부터는 설문 관리자 전용 (LV_1 또는 해당 메뉴 편집 권한) ---
    if (!auth.isAdmin) {
      const editor = await trySurveyEditorOnPath(rest.menuPath);
      if (!editor) return NextResponse.json({ error: '편집 권한이 없습니다.' }, { status: 403 });
    }

    // 5. 관리자 독촉(NUDGE) — 익명은 서버에서 미참여자 이메일 산출(클라이언트에 신원 미노출)
    if (action === 'NUDGE') {
      const { surveyId } = rest;
      if (!surveyId) {
        return NextResponse.json({ error: '설문 ID가 필요합니다.' }, { status: 400 });
      }

      const survey = await prisma.generalSurvey.findUnique({ where: { id: surveyId } });
      if (!survey) return NextResponse.json({ error: '설문을 찾을 수 없습니다.' }, { status: 404 });

      let emails: string[] = Array.isArray(rest.targetEmails)
        ? rest.targetEmails.map((e: unknown) => String(e || '').trim()).filter(Boolean)
        : [];

      if (survey.isAnonymous || rest.resolveUnsubmittedOnServer === true) {
        const [units, users, submittedHashes] = await Promise.all([
          prisma.orgUnit.findMany({
            where: { is_deleted: false, is_active: true },
            select: { id: true, unit_name: true, parent_id: true },
          }),
          prisma.user.findMany({
            where: { status: 'Active' },
            select: {
              email: true,
              unit_id: true,
              unit: { select: { id: true, unit_name: true, parent_id: true } },
            },
          }),
          survey.isAnonymous
            ? prisma.generalAnonymousParticipation.findMany({
                where: { surveyId },
                select: { emailHash: true },
              })
            : prisma.generalResponse.findMany({
                where: { surveyId },
                select: { userEmail: true },
              }),
        ]);

        const submittedSet = survey.isAnonymous
          ? new Set(
              (submittedHashes as { emailHash: string }[]).map((r) => r.emailHash)
            )
          : new Set(
              (submittedHashes as { userEmail: string }[]).map((r) =>
                String(r.userEmail || '').trim().toLowerCase()
              )
            );

        emails = users
          .filter((u) =>
            userInSurveyTarget({
              userUnitId: u.unit_id || u.unit?.id,
              userDeptName: u.unit?.unit_name,
              target: survey.target,
              targetUnitIds: (survey as { target_unit_ids?: unknown }).target_unit_ids,
              units,
            })
          )
          .map((u) => u.email)
          .filter((email) => {
            if (!email) return false;
            if (survey.isAnonymous) {
              return !submittedSet.has(hashSurveyParticipantEmail(surveyId, email));
            }
            return !submittedSet.has(String(email).trim().toLowerCase());
          });
      }

      const prevNudged = Array.isArray(survey.nudgedUsers) ? survey.nudgedUsers : [];
      const merged = Array.from(new Set([...prevNudged, ...emails]));

      const updatedSurvey = await prisma.generalSurvey.update({
        where: { id: surveyId },
        data: { nudgedUsers: merged },
      });
      return NextResponse.json({
        ...updatedSurvey,
        nudgedCount: emails.length,
      });
    }

    // 6. 관리자 설문 공고 생성 및 수정
    const isNew = typeof id === 'string' && id.startsWith('S_');
    const sanitizedQuestions = rest.questions 
      ? (typeof rest.questions === 'string' ? JSON.parse(rest.questions) : rest.questions) 
      : undefined; 

    let resultSurvey;
    const targetStr = String(rest.target || '').trim();
    let targetUnitIds = parseSurveyTargetUnitIds(rest.target_unit_ids);
    if (targetStr === '전사' || !targetStr) {
      targetUnitIds = [];
    } else if (targetUnitIds.length === 0 && targetStr) {
      // FE가 명칭만 보낸 경우 id 해석
      const names = targetStr.split(',').map((t: string) => t.trim()).filter(Boolean);
      const allUnits = await prisma.orgUnit.findMany({
        where: { is_deleted: false },
        select: { id: true, unit_name: true },
      });
      targetUnitIds = names
        .map((n: string) => String(allUnits.find((u) => u.unit_name === n)?.id || '').trim())
        .filter(Boolean);
    }

    if (isNew) {
      resultSurvey = await prisma.generalSurvey.create({
        data: {
          code: rest.code, postNumber: Number(rest.postNumber) || 0, title: rest.title,
          description: rest.description || '', type: rest.type, isAnonymous: Boolean(rest.isAnonymous),
          target: rest.target, target_unit_ids: targetUnitIds,
          postDate: rest.postDate, startDate: rest.startDate,
          endDate: rest.endDate, endTime: rest.endTime || '23:59', status: rest.status,
          hasBeenPublished: Boolean(rest.hasBeenPublished), questions: sanitizedQuestions || [] 
        },
      });
    } else {
      const updateData: any = {
        code: rest.code, postNumber: rest.postNumber !== undefined ? Number(rest.postNumber) : undefined,
        title: rest.title, description: rest.description, type: rest.type,
        isAnonymous: rest.isAnonymous !== undefined ? Boolean(rest.isAnonymous) : undefined,
        target: rest.target, target_unit_ids: targetUnitIds,
        postDate: rest.postDate, startDate: rest.startDate,
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