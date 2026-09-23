import { PrismaClient } from '@prisma/client';
import { runSeedEquipmentPerformance } from '../src/lib/equipment-seed-performance';

/**
 * 장비 시드 CLI
 *   npm run db:seed:equipment
 *   npm run db:seed:equipment:sync
 *   npm run db:seed:equipment -- safety
 *   npm run db:seed:equipment:sync -- performance
 */
export async function seedEquipmentPerformance(
  prisma: PrismaClient,
  mode: 'fill' | 'sync' = 'fill',
  categoryCode?: string | null
) {
  const label = categoryCode || 'all';
  console.log(
    `🧰 [Equipment Seed:${label}] ${mode === 'fill' ? '채우기' : '동기화'} 시작...`
  );
  const result = await runSeedEquipmentPerformance(prisma, mode, categoryCode);
  console.log(
    `✅ [Equipment Seed:${result.category}] 생성 ${result.created} / 갱신 ${result.updated} / 번호이전 ${result.renamed} / 유지 ${result.skipped} (시드 ${result.seedCount}건)`
  );
  if (result.missingDepts.length > 0) {
    console.warn(
      `⚠️ OrgUnit 미매칭 소속: ${result.missingDepts.join(', ')}`
    );
  }
  return result;
}
