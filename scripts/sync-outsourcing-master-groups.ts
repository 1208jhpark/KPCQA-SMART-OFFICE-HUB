/**
 * 외주 마스터 그룹 + SystemConfig 매핑 동기화
 *   npx tsx scripts/sync-outsourcing-master-groups.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GROUPS = [
  {
    id: 'GRP_OUT_VENDOR',
    name: '외주 업체 마스터',
    sort_order: 90,
    codes: [
      { label: '아트로릭', value: 'VENDOR_ARTROLIC' },
      { label: '한생미디어', value: 'VENDOR_HANSAENG' },
      { label: '드림디포', value: 'VENDOR_DREAMDEPO' },
    ],
  },
  {
    id: 'GRP_OUT_ITEM',
    name: '외주 품목 리스트',
    sort_order: 91,
    codes: [
      { label: '현판/명판/상패', value: 'ITEM_SIGN' },
      { label: '제본', value: 'ITEM_JEBON' },
      { label: '기타 제작물', value: 'ITEM_PRINT' },
      { label: '사무문구류', value: 'ITEM_SUPPLIES' },
    ],
  },
  {
    id: 'GRP_OUT_DETAIL1',
    name: '외주 품목 상세1',
    sort_order: 92,
    codes: [
      { label: '표준', value: 'D1_STANDARD' },
      { label: '긴급', value: 'D1_URGENT' },
      { label: '재제작', value: 'D1_REMAKE' },
    ],
  },
  {
    id: 'GRP_OUT_DETAIL2',
    name: '외주 품목 상세2',
    sort_order: 93,
    codes: [
      { label: '컬러', value: 'D2_COLOR' },
      { label: '흑백', value: 'D2_BW' },
      { label: '혼합', value: 'D2_MIX' },
    ],
  },
];

async function main() {
  for (const group of GROUPS) {
    await prisma.masterGroup.upsert({
      where: { id: group.id },
      update: { name: group.name, sort_order: group.sort_order, is_active: true },
      create: {
        id: group.id,
        name: group.name,
        sort_order: group.sort_order,
        is_active: true,
      },
    });

    for (const [idx, code] of group.codes.entries()) {
      const existing = await prisma.masterCode.findFirst({
        where: { group_id: group.id, value: code.value },
      });
      if (existing) {
        await prisma.masterCode.update({
          where: { id: existing.id },
          data: {
            label: code.label,
            sort_order: idx + 1,
            is_active: true,
            is_visible: true,
            is_archived: false,
          },
        });
      } else {
        await prisma.masterCode.create({
          data: {
            group_id: group.id,
            label: code.label,
            value: code.value,
            sort_order: idx + 1,
            is_active: true,
            is_visible: true,
            is_archived: false,
            orgs: [],
          },
        });
      }
    }
    console.log('OK group', group.id);
  }

  await prisma.$executeRawUnsafe(`
    UPDATE "SystemConfig"
    SET
      "outsourcing_vendor_group" = 'GRP_OUT_VENDOR',
      "outsourcing_item_group" = 'GRP_OUT_ITEM',
      "outsourcing_detail1_group" = 'GRP_OUT_DETAIL1',
      "outsourcing_detail2_group" = 'GRP_OUT_DETAIL2',
      "updatedAt" = NOW()
    WHERE id = 'global'
  `);
  console.log('OK SystemConfig outsourcing mappings');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
