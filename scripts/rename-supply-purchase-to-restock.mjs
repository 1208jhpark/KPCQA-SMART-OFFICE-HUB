import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const oldPath = '/asset/supplies/master/purchase';
const newPath = '/asset/supplies/master/restock';

try {
  const neu = await prisma.interfaceConfig.findUnique({ where: { path: newPath } });
  const old = await prisma.interfaceConfig.findUnique({ where: { path: oldPath } });
  if (old && neu) {
    await prisma.interfaceConfig.delete({ where: { path: oldPath } });
    console.log('deleted old duplicate purchase menu');
  } else if (old && !neu) {
    await prisma.interfaceConfig.update({
      where: { path: oldPath },
      data: { path: newPath },
    });
    console.log('renamed Interface path purchase → restock');
  } else {
    console.log('already ok', { old: !!old, neu: !!neu });
  }
} finally {
  await prisma.$disconnect();
}
