import { PrismaClient } from '@prisma/client';
import {
  compareUsersByDutyGrade,
  DEFAULT_USER_DUTY_OPTIONS,
  DEFAULT_USER_GRADE_OPTIONS,
} from '../src/lib/user-job-options';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { email: true, name: true, duty: true, grade: true, roles: true },
  });
  const sample = users.filter((u) =>
    ['matthaekang@kpcqa.or.kr', 'skchoi@kpcqa.or.kr', 'adminlv1@kpcqa.or.kr', 'admin@kpcqa.or.kr'].includes(
      u.email
    )
  );
  for (const u of sample) {
    console.log(u.email, 'roles=', JSON.stringify(u.roles), 'duty=', u.duty, 'typeof roles', typeof u.roles, Array.isArray(u.roles));
  }

  const a = sample.find((u) => u.email.startsWith('matthaekang'))!;
  const b = sample.find((u) => u.email.startsWith('skchoi'))!;
  const c = sample.find((u) => u.email.startsWith('adminlv1'))!;
  console.log('원장 vs 센터장', compareUsersByDutyGrade(a, b, DEFAULT_USER_DUTY_OPTIONS, DEFAULT_USER_GRADE_OPTIONS));
  console.log('adminlv vs 원장', compareUsersByDutyGrade(c, a, DEFAULT_USER_DUTY_OPTIONS, DEFAULT_USER_GRADE_OPTIONS));
  console.log('adminlv vs 센터장', compareUsersByDutyGrade(c, b, DEFAULT_USER_DUTY_OPTIONS, DEFAULT_USER_GRADE_OPTIONS));
}

main().finally(() => prisma.$disconnect());
