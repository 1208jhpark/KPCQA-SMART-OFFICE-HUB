/**
 *   npm run db:seed:equipment
 *   npm run db:seed:equipment:sync
 *   npm run db:seed:equipment -- safety
 *   npm run db:seed:equipment:sync -- performance
 */
import { PrismaClient } from '@prisma/client';
import { seedEquipmentPerformance } from '../prisma/seed-equipment-performance';

const mode = process.argv.includes('--sync') ? 'sync' : 'fill';
const categoryArg = process.argv
  .slice(2)
  .find((a) => a !== '--sync' && !a.startsWith('-'));

const prisma = new PrismaClient();
seedEquipmentPerformance(prisma, mode, categoryArg || null)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
