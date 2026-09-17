import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_USER_DUTY_OPTIONS,
  DEFAULT_USER_GRADE_OPTIONS,
} from '../src/lib/user-job-options';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SystemConfig" (id, "user_duty_options", "user_grade_options", "updatedAt")
     VALUES ('global', $1::jsonb, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "user_duty_options" = EXCLUDED."user_duty_options",
       "user_grade_options" = EXCLUDED."user_grade_options",
       "updatedAt" = NOW()`,
    JSON.stringify(DEFAULT_USER_DUTY_OPTIONS),
    JSON.stringify(DEFAULT_USER_GRADE_OPTIONS)
  );
  console.log(
    'updated duties:',
    DEFAULT_USER_DUTY_OPTIONS.map((d) => d.label).join(', ')
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
