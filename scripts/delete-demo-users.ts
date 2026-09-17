import { PrismaClient } from '@prisma/client';

/** 예전 데모 계정 제거 — 전사 WISE 시드만 유지 */
const prisma = new PrismaClient();
const DEMO = ['admin@kpcqa.or.kr', 'center@kpcqa.or.kr', 'user@kpcqa.or.kr'];

async function main() {
  const result = await prisma.user.deleteMany({ where: { email: { in: DEMO } } });
  console.log('deleted demo users', result.count);
}

main().finally(() => prisma.$disconnect());
