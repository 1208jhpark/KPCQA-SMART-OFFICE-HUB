/**
 * DB InterfaceConfig → prisma/menu-backup.json (UTF-8, no BOM, pretty)
 * 사용: npx tsx scripts/dump-menu-backup.ts
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.interfaceConfig.findMany({
    orderBy: [{ level: 'asc' }, { sort_order: 'asc' }],
  });
  const out = path.join(process.cwd(), 'prisma', 'menu-backup.json');
  fs.writeFileSync(out, JSON.stringify(rows, null, 2) + '\n', { encoding: 'utf8' });
  const b = fs.readFileSync(out);
  const bom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  console.log(`wrote ${rows.length} menus → ${out}`);
  console.log(`bytes=${b.length} bom=${bom}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
