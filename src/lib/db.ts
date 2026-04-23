import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'], // 디버깅이 필요한 경우 켬
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;