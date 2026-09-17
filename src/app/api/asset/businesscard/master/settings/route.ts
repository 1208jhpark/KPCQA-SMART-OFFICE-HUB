import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';
import { DEFAULT_STATEMENT_COL_MAP, normalizeStatementColMap } from '@/lib/businesscard-statement-match';
import {
  resolveBcMailBodyTemplate,
  resolveBcMailSubjectTemplate,
} from '@/lib/businesscard-mail-template';
import {
  DEFAULT_USER_DUTY_OPTIONS,
  DEFAULT_USER_GRADE_OPTIONS,
  resolveUserDutyOptions,
  resolveUserGradeOptions,
} from '@/lib/user-job-options';

export const dynamic = 'force-dynamic';

const MENU_PATHS = [
  '/asset/businesscard/master/order',
  '/asset/businesscard/master/requests',
];
const READ_PATHS = [
  '/asset/businesscard/my-page',
  '/asset/businesscard/master/order',
  '/asset/businesscard/master/requests',
  '/asset/businesscard/master/archive',
];
const DEFAULT_SHEETS = 200;

function normalizeSheets(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SHEETS;
  return Math.max(1, Math.min(9999, Math.round(n)));
}

async function authorizeBcMasterEditor() {
  let lastError: unknown = null;
  for (const path of MENU_PATHS) {
    try {
      return await authorizeApi(path, { requireEditor: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function readSheetsPerPack() {
  const rows = await prisma.$queryRaw<Array<{ bc_sheets_per_pack: number | null }>>`
    SELECT "bc_sheets_per_pack" FROM "SystemConfig" WHERE id = 'global'
  `;
  const n = Number(rows[0]?.bc_sheets_per_pack);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_SHEETS;
}

async function writeSheetsPerPack(sheetsPerPack: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SystemConfig" (id, "bc_sheets_per_pack", "updatedAt")
     VALUES ('global', $1, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "bc_sheets_per_pack" = EXCLUDED."bc_sheets_per_pack",
       "updatedAt" = NOW()`,
    sheetsPerPack
  );
}

async function readStatementColMap() {
  try {
    const rows = await prisma.$queryRaw<Array<{ bc_statement_col_map: unknown }>>`
      SELECT "bc_statement_col_map" FROM "SystemConfig" WHERE id = 'global'
    `;
    return normalizeStatementColMap(rows[0]?.bc_statement_col_map || DEFAULT_STATEMENT_COL_MAP);
  } catch {
    return { ...DEFAULT_STATEMENT_COL_MAP };
  }
}

async function writeStatementColMap(colMap: ReturnType<typeof normalizeStatementColMap>) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SystemConfig" (id, "bc_statement_col_map", "updatedAt")
     VALUES ('global', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "bc_statement_col_map" = EXCLUDED."bc_statement_col_map",
       "updatedAt" = NOW()`,
    JSON.stringify(colMap)
  );
}

const DEFAULT_BC_MAIL_SHORTCUT_URL = 'https://ep.kpcqa.or.kr/mail2/writeMailView.do?';

async function readMailShortcutUrl() {
  try {
    const rows = await prisma.$queryRaw<Array<{ bc_mail_shortcut_url: string | null }>>`
      SELECT "bc_mail_shortcut_url" FROM "SystemConfig" WHERE id = 'global'
    `;
    return String(rows[0]?.bc_mail_shortcut_url || '').trim();
  } catch {
    return '';
  }
}

async function writeMailShortcutUrl(url: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SystemConfig" (id, "bc_mail_shortcut_url", "updatedAt")
     VALUES ('global', $1, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "bc_mail_shortcut_url" = EXCLUDED."bc_mail_shortcut_url",
       "updatedAt" = NOW()`,
    url
  );
}

async function readMailTemplates() {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        bc_mail_subject_template: string | null;
        bc_mail_body_template: string | null;
      }>
    >`
      SELECT "bc_mail_subject_template", "bc_mail_body_template"
      FROM "SystemConfig" WHERE id = 'global'
    `;
    return {
      subjectTemplate: resolveBcMailSubjectTemplate(rows[0]?.bc_mail_subject_template),
      bodyTemplate: resolveBcMailBodyTemplate(rows[0]?.bc_mail_body_template),
    };
  } catch {
    return {
      subjectTemplate: resolveBcMailSubjectTemplate(''),
      bodyTemplate: resolveBcMailBodyTemplate(''),
    };
  }
}

async function writeMailTemplates(subjectTemplate: string, bodyTemplate: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SystemConfig" (id, "bc_mail_subject_template", "bc_mail_body_template", "updatedAt")
     VALUES ('global', $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "bc_mail_subject_template" = EXCLUDED."bc_mail_subject_template",
       "bc_mail_body_template" = EXCLUDED."bc_mail_body_template",
       "updatedAt" = NOW()`,
    subjectTemplate,
    bodyTemplate
  );
}

async function readUserJobOptions() {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ user_duty_options: unknown; user_grade_options: unknown }>
    >`
      SELECT "user_duty_options", "user_grade_options"
      FROM "SystemConfig" WHERE id = 'global'
    `;
    return {
      duties: resolveUserDutyOptions(rows[0]?.user_duty_options),
      grades: resolveUserGradeOptions(rows[0]?.user_grade_options),
    };
  } catch {
    return {
      duties: [...DEFAULT_USER_DUTY_OPTIONS],
      grades: [...DEFAULT_USER_GRADE_OPTIONS],
    };
  }
}

async function buildSettingsPayload() {
  const storedMail = await readMailShortcutUrl();
  const mailTemplates = await readMailTemplates();
  const jobOptions = await readUserJobOptions();
  return {
    sheetsPerPack: await readSheetsPerPack(),
    statementColMap: await readStatementColMap(),
    mailShortcutUrl: storedMail || DEFAULT_BC_MAIL_SHORTCUT_URL,
    mailSubjectTemplate: mailTemplates.subjectTemplate,
    mailBodyTemplate: mailTemplates.bodyTemplate,
    /** /admin/users 직책·직급 옵션 — 명함 신청·마스터 편집 드롭다운 */
    duties: jobOptions.duties,
    grades: jobOptions.grades,
  };
}

export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    return NextResponse.json(await buildSettingsPayload(), {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/settings GET]', error);
    return NextResponse.json({ message: '설정 로드 실패' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await authorizeBcMasterEditor();
    const body = await req.json().catch(() => ({}));
    if (body.sheetsPerPack != null || body.bc_sheets_per_pack != null) {
      await writeSheetsPerPack(normalizeSheets(body.sheetsPerPack ?? body.bc_sheets_per_pack));
    }
    if (body.statementColMap != null) {
      await writeStatementColMap(normalizeStatementColMap(body.statementColMap));
    }
    if (body.mailShortcutUrl != null) {
      await writeMailShortcutUrl(String(body.mailShortcutUrl || '').trim());
    }
    if (body.mailSubjectTemplate != null || body.mailBodyTemplate != null) {
      const current = await readMailTemplates();
      await writeMailTemplates(
        resolveBcMailSubjectTemplate(
          body.mailSubjectTemplate != null ? body.mailSubjectTemplate : current.subjectTemplate
        ),
        resolveBcMailBodyTemplate(
          body.mailBodyTemplate != null ? body.mailBodyTemplate : current.bodyTemplate
        )
      );
    }
    return NextResponse.json(await buildSettingsPayload());
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) {
      const body = await authRes.json().catch(() => ({} as { error?: string; message?: string }));
      return NextResponse.json(
        { message: body.error || body.message || '저장 권한이 없습니다.' },
        { status: authRes.status }
      );
    }
    console.error('[businesscard/settings PUT]', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ message: '설정 저장 실패', detail }, { status: 500 });
  }
}
