import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROWS = [
  { email: 'adminlv1@kpcqa.or.kr', employee_no: 'WISELV001' },
  { email: 'adminlv2@kpcqa.or.kr', employee_no: 'WISELV002' },
  { email: 'adminlv3@kpcqa.or.kr', employee_no: 'WISELV003' },
];

async function main() {
  for (const row of ROWS) {
    const updated = await prisma.user.updateMany({
      where: { email: row.email },
      data: { employee_no: row.employee_no },
    });
    console.log(`${row.email} → ${row.employee_no} (updated=${updated.count})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
