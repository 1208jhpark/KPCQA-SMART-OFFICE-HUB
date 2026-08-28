/**
 * 개발 중 안전 실행용 — 제작물 마스터만 채웁니다.
 *
 *   npm run db:seed:production        # 없는 행만 추가 (기본)
 *   npm run db:seed:production:sync   # 시드 파일 기준으로 upsert
 *
 * ⚠️ npx prisma db seed 는 사용자·메뉴 등 전체 초기화이므로 개발 중에는 쓰지 마세요.
 */
import { PrismaClient } from '@prisma/client';
import { seedProductionMasters } from '../prisma/seed-production-masters';

const mode = process.argv.includes('--sync') ? 'sync' : 'fill';

const prisma = new PrismaClient();
seedProductionMasters(prisma, mode)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
