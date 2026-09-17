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
  users.sort((a, b) =>
    compareUsersByDutyGrade(a, b, DEFAULT_USER_DUTY_OPTIONS, DEFAULT_USER_GRADE_OPTIONS)
  );
  console.log('count', users.length);
  console.log(
    users
      .slice(0, 15)
      .map((u) => `${u.duty || '-'} | ${u.grade || '-'} | ${u.name} <${u.email}>`)
      .join('\n')
  );
}

main()
  .finally(() => prisma.$disconnect());
