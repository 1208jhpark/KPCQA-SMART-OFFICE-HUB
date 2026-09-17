import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EMAILS = [
  'adminlv1@kpcqa.or.kr',
  'adminlv2@kpcqa.or.kr',
  'adminlv3@kpcqa.or.kr',
];

async function main() {
  const unit = await prisma.orgUnit.findFirst({
    where: { unit_name: '경영기획센터', is_deleted: false },
    select: { id: true, unit_name: true },
  });
  if (!unit) {
    throw new Error('경영기획센터 OrgUnit을 찾을 수 없습니다.');
  }

  const result = await prisma.user.updateMany({
    where: { email: { in: EMAILS } },
    data: { unit_id: unit.id },
  });

  console.log(`unit=${unit.unit_name} (${unit.id}), updated=${result.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
