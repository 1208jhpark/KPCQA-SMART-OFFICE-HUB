/**
 * 메뉴만 복구 (유저/조직 삭제 없음)
 * menu-backup.json → InterfaceConfig
 *
 * 사용: npx tsx scripts/restore-interface-menus.ts
 */
import { Prisma, PrismaClient } from '@prisma/client';
import menuData from '../prisma/menu-backup.json';

const prisma = new PrismaClient();

const ALLOWED_KEYS = new Set([
  'path',
  'level',
  'name',
  'description',
  'icon',
  'sort_order',
  'is_active',
  'is_visible',
  'parent_id',
  'view_scopes',
  'org_ids',
  'edit_role_ids',
  'edit_scopes',
  'task_masters',
  'view_role_ids',
  'task_accesses',
  'is_master',
  'master_editor_id',
  'entry_sidebar',
  'entry_index_view',
  'entry_l4_direct',
  'l2_entry_mode',
  'show_header',
  'page_title',
  'show_page_title',
  'page_description',
  'show_page_desc',
]);

const JSON_FIELDS = [
  'view_scopes',
  'org_ids',
  'edit_role_ids',
  'edit_scopes',
  'task_masters',
  'view_role_ids',
  'task_accesses',
];

function toSafeData(raw: Record<string, unknown>) {
  const safeData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (value === null) {
      if (JSON_FIELDS.includes(key)) safeData[key] = [];
    } else {
      safeData[key] = value;
    }
  }
  return safeData;
}

async function main() {
  const rootOrg = await prisma.orgUnit.findFirst({
    where: { unit_type: 'ORGANIZATION', is_deleted: false },
    orderBy: { sort_order: 'asc' },
  });
  if (!rootOrg) {
    throw new Error(
      'ORGANIZATION 단위가 없습니다. 조직 시드 후 다시 실행하거나 admin/units를 확인하세요.'
    );
  }

  const sorted = [...(menuData as any[])].sort((a, b) => a.level - b.level);
  console.log(
    `메뉴 복구 시작: ${sorted.length}건 (Access org → ${rootOrg.unit_name} / ${rootOrg.id})`
  );

  for (const m of sorted) {
    const { createdAt, updatedAt, id, ...rest } = m;
    const safeData = toSafeData(rest);
    // 백업 JSON의 옛 org_ids 무시 → 현재 ORGANIZATION
    safeData.org_ids = [rootOrg.id];

    await prisma.interfaceConfig.upsert({
      where: { path: m.path },
      update: safeData,
      create: { id: m.id, ...safeData } as Prisma.InterfaceConfigCreateInput,
    });
  }

  const count = await prisma.interfaceConfig.count();
  console.log(`✅ 메뉴 복구 완료: InterfaceConfig ${count}건`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
