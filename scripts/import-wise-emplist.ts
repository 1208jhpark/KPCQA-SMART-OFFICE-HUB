/**
 * WISE_empList_*.xls → User 테이블 upsert
 * 사용: npx tsx scripts/import-wise-emplist.ts "path/to/WISE_empList.xls"
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import path from 'path';

const prisma = new PrismaClient();
const COMPANY_EMAIL_DOMAIN = 'kpcqa.or.kr';

function normalizeEmail(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    if (!local || domain !== COMPANY_EMAIL_DOMAIN) return null;
    return `${local}@${COMPANY_EMAIL_DOMAIN}`;
  }
  return `${s}@${COMPANY_EMAIL_DOMAIN}`;
}

function normalizeStatus(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'active') return 'Active';
  if (s === 'suspended') return 'Suspended';
  if (s === 'pending') return 'Pending';
  return 'Active';
}

function normalizeEmployeeNo(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number') return String(Math.trunc(raw));
  return String(raw).trim();
}

function parseRoles(raw: unknown): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return ['LV_3'];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
  } catch {
    /* not JSON */
  }
  return [s];
}

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: npx tsx scripts/import-wise-emplist.ts <xls-path>');
    process.exit(1);
  }
  const filePath = path.resolve(fileArg);
  console.log('📂 reading', filePath);

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  console.log(`📄 rows: ${rows.length}`);

  const units = await prisma.orgUnit.findMany({
    where: { is_deleted: false },
    select: { id: true, unit_name: true },
  });
  const unitByName = new Map(units.map((u) => [u.unit_name, u.id]));

  const missingUnits = new Set<string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) {
      console.warn('⚠️ skip invalid email:', row.email);
      skipped += 1;
      continue;
    }

    const name = String(row.name ?? '').trim();
    if (!name) {
      console.warn('⚠️ skip empty name:', email);
      skipped += 1;
      continue;
    }

    const unitName = String(row.unit_name ?? '').trim();
    let unit_id: string | null = null;
    if (unitName) {
      unit_id = unitByName.get(unitName) ?? null;
      if (!unit_id) missingUnits.add(unitName);
    }

    const employee_no = normalizeEmployeeNo(row.employee_no);
    const roles = parseRoles(row.roles);
    const status = normalizeStatus(row.status);
    const name_en = String(row.name_en ?? '').trim();
    const duty = String(row.duty ?? '').trim();
    const duty_en = String(row.duty_en ?? '').trim();
    const grade = String(row.grade ?? '').trim();
    const grade_en = String(row.grade_en ?? '').trim();

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      await prisma.user.update({
        where: { email },
        data: {
          name,
          name_en,
          employee_no,
          roles,
          status,
          unit_id,
          duty,
          duty_en,
          grade,
          grade_en,
        },
      });
      updated += 1;
      continue;
    }

    const tempPassword = employee_no || 'password123';
    const hashed = await bcrypt.hash(tempPassword, 10);
    await prisma.user.create({
      data: {
        email,
        name,
        name_en,
        employee_no,
        password: hashed,
        roles,
        status,
        unit_id,
        duty,
        duty_en,
        grade,
        grade_en,
        must_reset_password: true,
      },
    });
    created += 1;
  }

  console.log('✅ done');
  console.log({ created, updated, skipped, total: rows.length });
  if (missingUnits.size) {
    console.warn('⚠️ unit_name not found in OrgUnit (unit_id left null):');
    for (const n of [...missingUnits].sort()) console.warn('  -', n);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
