import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        in: ['adminlv1@kpcqa.or.kr', 'adminlv2@kpcqa.or.kr', 'adminlv3@kpcqa.or.kr'],
      },
    },
    select: {
      email: true,
      name: true,
      employee_no: true,
      must_reset_password: true,
      status: true,
      roles: true,
    },
  });
  console.log(JSON.stringify(users, null, 2));
}

main().finally(() => prisma.$disconnect());
