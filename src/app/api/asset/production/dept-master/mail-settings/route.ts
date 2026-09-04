import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  DEFAULT_PROD_MAIL_BODY,
  DEFAULT_PROD_MAIL_SUBJECT,
  resolveProdMailBodyTemplate,
  resolveProdMailSubjectTemplate,
} from '@/lib/production-mail-template';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/dept-master/inspection';
const READ_PATHS = [
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/archive',
];

type MailSettingsRow = {
  unitId: string;
  mailShortcutUrl: string | null;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
};

function serializeSettings(row: MailSettingsRow | null) {
  return {
    unitId: row?.unitId || '',
    mailShortcutUrl: String(row?.mailShortcutUrl || '').trim(),
    subjectTemplate: resolveProdMailSubjectTemplate(row?.subjectTemplate),
    bodyTemplate: resolveProdMailBodyTemplate(row?.bodyTemplate),
    defaults: {
      subjectTemplate: DEFAULT_PROD_MAIL_SUBJECT,
      bodyTemplate: DEFAULT_PROD_MAIL_BODY,
    },
  };
}

async function readSettings(unitId: string): Promise<MailSettingsRow | null> {
  if (!unitId) return null;
  try {
    const rows = await prisma.$queryRaw<MailSettingsRow[]>`
      SELECT "unitId", "mailShortcutUrl", "subjectTemplate", "bodyTemplate"
      FROM "ProductionDeptMailSettings"
      WHERE "unitId" = ${unitId}
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error) {
    console.error('[production/mail-settings read]', error);
    return null;
  }
}

async function upsertSettings(
  unitId: string,
  data: { mailShortcutUrl: string; subjectTemplate: string; bodyTemplate: string }
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductionDeptMailSettings"
      ("id", "unitId", "mailShortcutUrl", "subjectTemplate", "bodyTemplate", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT ("unitId") DO UPDATE SET
       "mailShortcutUrl" = EXCLUDED."mailShortcutUrl",
       "subjectTemplate" = EXCLUDED."subjectTemplate",
       "bodyTemplate" = EXCLUDED."bodyTemplate",
       "updatedAt" = NOW()`,
    `pdms_${unitId}`,
    unitId,
    data.mailShortcutUrl,
    data.subjectTemplate,
    data.bodyTemplate
  );
}

export async function GET() {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS);
    const unitId = String(auth.user.unit?.id || '').trim();
    const row = await readSettings(unitId);
    return NextResponse.json(serializeSettings(row ? { ...row, unitId } : { unitId, mailShortcutUrl: '', subjectTemplate: '', bodyTemplate: '' }), {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/mail-settings GET]', error);
    return NextResponse.json({ message: '메일 양식 설정 조회 실패' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const unitId = String(auth.user.unit?.id || '').trim();
    if (!unitId) {
      return NextResponse.json({ message: '소속 부서 정보가 없습니다.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const existing = await readSettings(unitId);

    const next = {
      mailShortcutUrl:
        body.mailShortcutUrl != null
          ? String(body.mailShortcutUrl || '').trim()
          : String(existing?.mailShortcutUrl || '').trim(),
      subjectTemplate:
        body.subjectTemplate != null
          ? String(body.subjectTemplate || '')
          : String(existing?.subjectTemplate || ''),
      bodyTemplate:
        body.bodyTemplate != null
          ? String(body.bodyTemplate || '')
          : String(existing?.bodyTemplate || ''),
    };

    await upsertSettings(unitId, next);
    const row = await readSettings(unitId);
    return NextResponse.json(
      serializeSettings(row ? { ...row, unitId } : { unitId, ...next })
    );
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
