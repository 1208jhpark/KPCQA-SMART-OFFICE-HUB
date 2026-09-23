import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  DEFAULT_PROD_MAIL_BODY,
  DEFAULT_PROD_MAIL_SUBJECT,
  resolveProdMailBodyTemplate,
  resolveProdMailSubjectTemplate,
} from '@/lib/production-mail-template';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/settlement',
  '/asset/production/dept-master/archive',
];

type DeptMailRow = {
  unitId: string;
  mailShortcutUrl: string | null;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
};

type UserMailRow = {
  prod_mail_shortcut_url: string | null;
  prod_mail_subject_template: string | null;
  prod_mail_body_template: string | null;
};

async function readDeptSettings(unitId: string): Promise<DeptMailRow | null> {
  if (!unitId) return null;
  try {
    const rows = await prisma.$queryRaw<DeptMailRow[]>`
      SELECT "unitId", "mailShortcutUrl", "subjectTemplate", "bodyTemplate"
      FROM "ProductionDeptMailSettings"
      WHERE "unitId" = ${unitId}
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error) {
    console.error('[production/mail-settings dept read]', error);
    return null;
  }
}

async function readUserSettings(userId: string): Promise<UserMailRow | null> {
  if (!userId) return null;
  try {
    const rows = await prisma.$queryRaw<UserMailRow[]>`
      SELECT "prod_mail_shortcut_url", "prod_mail_subject_template", "prod_mail_body_template"
      FROM "User"
      WHERE id = ${userId}
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error) {
    console.error('[production/mail-settings user read]', error);
    return null;
  }
}

function serialize(opts: {
  unitId: string;
  personal: UserMailRow | null;
  dept: DeptMailRow | null;
}) {
  const pUrl = String(opts.personal?.prod_mail_shortcut_url || '').trim();
  const pSubject = String(opts.personal?.prod_mail_subject_template || '');
  const pBody = String(opts.personal?.prod_mail_body_template || '');
  const dUrl = String(opts.dept?.mailShortcutUrl || '').trim();
  const dSubject = String(opts.dept?.subjectTemplate || '');
  const dBody = String(opts.dept?.bodyTemplate || '');

  return {
    unitId: opts.unitId,
    mailShortcutUrl: pUrl || dUrl,
    subjectTemplate: resolveProdMailSubjectTemplate(pSubject || dSubject),
    bodyTemplate: resolveProdMailBodyTemplate(pBody || dBody),
    isPersonalUrl: !!pUrl,
    isPersonalTemplate: !!(pSubject.trim() || pBody.trim()),
    defaults: {
      subjectTemplate: DEFAULT_PROD_MAIL_SUBJECT,
      bodyTemplate: DEFAULT_PROD_MAIL_BODY,
    },
  };
}

/** GET: 로그인 사용자 개인 설정 (없으면 부서 설정·기본값 폴백) — Edit 불필요 */
export async function GET() {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS);
    const unitId = String(auth.user.unit?.id || '').trim();
    const [personal, dept] = await Promise.all([
      readUserSettings(auth.user.id),
      readDeptSettings(unitId),
    ]);
    return NextResponse.json(serialize({ unitId, personal, dept }), {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/mail-settings GET]', error);
    return NextResponse.json({ message: '메일 양식 설정 조회 실패' }, { status: 500 });
  }
}

/** PUT: 본인 User 행에만 저장 — Edit 불필요 (개인 페이지 설정) */
export async function PUT(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS);
    const unitId = String(auth.user.unit?.id || '').trim();
    const body = await req.json().catch(() => ({}));
    const existing = await readUserSettings(auth.user.id);

    const nextUrl =
      body.mailShortcutUrl != null
        ? String(body.mailShortcutUrl || '').trim()
        : String(existing?.prod_mail_shortcut_url || '').trim();
    const nextSubject =
      body.subjectTemplate != null
        ? String(body.subjectTemplate || '')
        : String(existing?.prod_mail_subject_template || '');
    const nextBody =
      body.bodyTemplate != null
        ? String(body.bodyTemplate || '')
        : String(existing?.prod_mail_body_template || '');

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET
         "prod_mail_shortcut_url" = $1,
         "prod_mail_subject_template" = $2,
         "prod_mail_body_template" = $3,
         "updatedAt" = NOW()
       WHERE id = $4`,
      nextUrl,
      nextSubject,
      nextBody,
      auth.user.id
    );

    const [personal, dept] = await Promise.all([
      readUserSettings(auth.user.id),
      readDeptSettings(unitId),
    ]);
    return NextResponse.json(serialize({ unitId, personal, dept }));
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) {
      const payload = await authRes.json().catch(() => ({} as { error?: string; message?: string }));
      return NextResponse.json(
        { message: payload.error || payload.message || '저장 권한이 없습니다.' },
        { status: authRes.status }
      );
    }
    console.error('[production/mail-settings PUT]', error);
    return NextResponse.json({ message: '메일 양식 설정 저장 실패' }, { status: 500 });
  }
}
