import { PrismaClient } from '@prisma/client';
import { runSeedMarketingClients } from '../src/lib/marketing-client-seed-run';

/**
 * 마케팅 고객사 시드
 *   npm run db:seed:marketing-clients
 *   npm run db:seed:marketing-clients:sync
 */
export async function seedMarketingClients(
  prisma: PrismaClient,
  mode: 'fill' | 'sync' = 'fill'
) {
  console.log(
    `🏢 [Marketing Clients] ${mode === 'fill' ? '채우기' : '동기화'} 시작...`
  );
  const result = await runSeedMarketingClients(prisma, mode);
  console.log(
    `✅ [Marketing Clients] 생성 ${result.created} / 갱신 ${result.updated} / 유지 ${result.skipped}${
      result.removed ? ` / 제거 ${result.removed}` : ''
    } (시드 ${result.seedCount}건)`
  );
  return result;
}
