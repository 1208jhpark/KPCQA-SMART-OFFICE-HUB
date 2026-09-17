/**
 * 미사용 외주 MasterGroup 정리 + SystemConfig 매핑 비움
 *   npx tsx scripts/sync-outsourcing-master-groups.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REMOVE_IDS = [
  'GRP_OUT_VENDOR',
  'GRP_OUT_ITEM',
  'GRP_OUT_DETAIL1',
  'GRP_OUT_DETAIL2',
];

async function main() {
  for (const id of REMOVE_IDS) {
    await prisma.masterCode.deleteMany({ where: { group_id: id } });
    await prisma.masterGroup.deleteMany({ where: { id } });
    console.log('removed', id);
  }

  await prisma.$executeRawUnsafe(`
    UPDATE "SystemConfig"
    SET
      "outsourcing_vendor_group" = '',
      "outsourcing_item_group" = '',
      "outsourcing_detail1_group" = '',
      "outsourcing_detail2_group" = '',
      "updatedAt" = NOW()
    WHERE id = 'global'
  `);
  console.log('OK SystemConfig outsourcing mappings cleared');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
