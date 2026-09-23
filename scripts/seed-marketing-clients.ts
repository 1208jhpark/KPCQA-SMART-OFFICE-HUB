/**
 *   npm run db:seed:marketing-clients
 *   npm run db:seed:marketing-clients:sync
 */
import { PrismaClient } from '@prisma/client';
import { seedMarketingClients } from '../prisma/seed-marketing-clients';

const mode = process.argv.includes('--sync') ? 'sync' : 'fill';
const prisma = new PrismaClient();

seedMarketingClients(prisma, mode)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
