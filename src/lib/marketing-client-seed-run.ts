import type { Prisma, PrismaClient } from '@prisma/client';
import { buildMarketingClientAddressData } from '@/lib/marketing-client-address';
import { SEED_MARKETING_CLIENTS } from '@/lib/marketing-client-seed';

export type SeedMarketingClientsResult = {
  created: number;
  updated: number;
  skipped: number;
  removed: number;
  seedCount: number;
};

function normalizeName(name: string) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * - fill: 동일 고객사명(대소문자 무시) 없으면 생성
 * - sync: 없으면 생성, 있으면 필드 갱신 + 시드목록에 없는 SEED행(지급 0건) 제거
 */
export async function runSeedMarketingClients(
  prisma: PrismaClient,
  mode: 'fill' | 'sync' = 'fill'
): Promise<SeedMarketingClientsResult> {
  const existing = await prisma.marketingClient.findMany({
    select: {
      id: true,
      name: true,
      creator_name: true,
      _count: { select: { distributions: true } },
    },
  });
  const byName = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    byName.set(normalizeName(row.name).toLowerCase(), row);
  }

  const seedNameKeys = new Set(
    SEED_MARKETING_CLIENTS.map((s) => normalizeName(s.name).toLowerCase()).filter(Boolean)
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let removed = 0;

  const baseTs = Date.now();

  for (let i = 0; i < SEED_MARKETING_CLIENTS.length; i++) {
    const seed = SEED_MARKETING_CLIENTS[i];
    const name = normalizeName(seed.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const found = byName.get(key);
    const departments = seed.departments as Prisma.InputJsonValue;
    const createdAt = new Date(baseTs - i * 1000);
    const addressData = buildMarketingClientAddressData({
      zip_code: seed.zip_code,
      address_road: seed.address_road,
      address_detail: seed.address_detail,
      location: seed.location,
    });

    if (!found) {
      await prisma.marketingClient.create({
        data: {
          name,
          ...addressData,
          category: seed.category,
          departments,
          is_active: true,
          is_archived: false,
          creator_name: 'SEED',
          creator_dept: 'SYSTEM',
          creator_email: null,
          createdAt,
        },
      });
      created += 1;
      continue;
    }

    if (mode === 'fill') {
      skipped += 1;
      continue;
    }

    await prisma.marketingClient.update({
      where: { id: found.id },
      data: {
        ...addressData,
        category: seed.category,
        departments,
        is_active: true,
        is_archived: false,
        createdAt,
      },
    });
    updated += 1;
  }

  if (mode === 'sync') {
    for (const row of existing) {
      const key = normalizeName(row.name).toLowerCase();
      if (seedNameKeys.has(key)) continue;
      if (String(row.creator_name || '') !== 'SEED') continue;
      if ((row._count?.distributions || 0) > 0) continue;
      await prisma.marketingClient.delete({ where: { id: row.id } });
      removed += 1;
    }
  }

  return {
    created,
    updated,
    skipped,
    removed,
    seedCount: SEED_MARKETING_CLIENTS.length,
  };
}
