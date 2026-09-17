import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ACCOUNTS: Array<{ email: string; password: string }> = [
  { email: 'adminlv1@kpcqa.or.kr', password: 'admin1password9073' },
  { email: 'adminlv2@kpcqa.or.kr', password: 'admin2password9073' },
  { email: 'adminlv3@kpcqa.or.kr', password: 'admin3password9073' },
];

async function main() {
  for (const row of ACCOUNTS) {
    const hashed = await bcrypt.hash(row.password, 10);
    const updated = await prisma.user.updateMany({
      where: { email: row.email },
      data: { password: hashed, must_reset_password: false },
    });
    console.log(`${row.email}: updated=${updated.count}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
