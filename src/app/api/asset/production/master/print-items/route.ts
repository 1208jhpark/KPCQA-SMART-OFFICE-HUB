import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/production/apply/request',
  '/asset/production/apply/history',
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/archive',
];

type PrintItemRow = {
  id: string;
  name: string;
  size: string;
  supplier: string;
  orderQty: number;
  unitValue: string;
  isCustom: boolean;
  sortOrder: number;
  isActive: boolean;
};

async function listPrintItems(): Promise<PrintItemRow[]> {
  try {
    return (await prisma.productionPrintItemMaster.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })) as PrintItemRow[];
  } catch {
    return (await prisma.$queryRawUnsafe(`
      SELECT id, name, size, supplier, "orderQty",
             COALESCE("unitValue", 'VAL_1') AS "unitValue",
             "isCustom", "sortOrder", "isActive"
      FROM "ProductionPrintItemMaster"
      WHERE "isActive" = true
      ORDER BY "sortOrder" ASC, name ASC
    `)) as PrintItemRow[];
  }
}

export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const items = await listPrintItems();
    return NextResponse.json(items);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('기타제작 품목 조회 오류:', error);
    return NextResponse.json({ message: '품목 조회 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const body = await req.json();
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ message: '제품명은 필수입니다.' }, { status: 400 });

    const data = {
      name,
      size: String(body.size || '').trim(),
      supplier: String(body.supplier || '').trim(),
      orderQty: Math.max(1, Number(body.orderQty) || 1),
      unitValue: String(body.unitValue || 'VAL_1').trim() || 'VAL_1',
      isCustom: body.isCustom === true || name === '기타소모품',
      sortOrder: Number(body.sortOrder) || 0,
      isActive: true,
    };

    let item: PrintItemRow;
    try {
      item = (await prisma.productionPrintItemMaster.create({ data })) as PrintItemRow;
    } catch {
      const id = `print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProductionPrintItemMaster"
          (id, name, size, supplier, "orderQty", "unitValue", "isCustom", "sortOrder", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())`,
        id,
        data.name,
        data.size,
        data.supplier,
        data.orderQty,
        data.unitValue,
        data.isCustom,
        data.sortOrder
      );
      item = { id, ...data };
    }

    return NextResponse.json({ message: '저장 완료', data: item }, { status: 201 });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('기타제작 품목 등록 오류:', error);
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS, { requireEditor: true });
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ message: '품목 ID가 필요합니다.' }, { status: 400 });
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ message: '제품명은 필수입니다.' }, { status: 400 });

    const data = {
      name,
      size: String(body.size || '').trim(),
      supplier: String(body.supplier || '').trim(),
      orderQty: Math.max(1, Number(body.orderQty) || 1),
      unitValue: String(body.unitValue || 'VAL_1').trim() || 'VAL_1',
      isCustom: body.isCustom === true || name === '기타소모품',
      sortOrder: Number(body.sortOrder) || 0,
    };

    let item: PrintItemRow;
    try {
      item = (await prisma.productionPrintItemMaster.update({
        where: { id },
        data,
      })) as PrintItemRow;
    } catch {
      await prisma.$executeRawUnsafe(
        `UPDATE "ProductionPrintItemMaster"
         SET name = $2, size = $3, supplier = $4, "orderQty" = $5,
             "unitValue" = $6, "isCustom" = $7, "sortOrder" = $8, "updatedAt" = NOW()
         WHERE id = $1`,
        id,
        data.name,
        data.size,
        data.supplier,
        data.orderQty,
        data.unitValue,
        data.isCustom,
        data.sortOrder
      );
      item = { id, ...data, isActive: true };
    }

    return NextResponse.json({ message: '저장 완료', data: item });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('기타제작 품목 수정 오류:', error);
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ message: '품목 ID가 필요합니다.' }, { status: 400 });

    try {
      const activeCount = await prisma.productionPrintItemMaster.count({
        where: { isActive: true },
      });
      if (activeCount <= 1) {
        return NextResponse.json(
          { message: '최소 한 개 이상의 주문 물품이 필요합니다.' },
          { status: 400 }
        );
      }
      await prisma.productionPrintItemMaster.update({
        where: { id },
        data: { isActive: false },
      });
    } catch {
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS c FROM "ProductionPrintItemMaster" WHERE "isActive" = true`
      )) as { c: number }[];
      if ((rows[0]?.c || 0) <= 1) {
        return NextResponse.json(
          { message: '최소 한 개 이상의 주문 물품이 필요합니다.' },
          { status: 400 }
        );
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "ProductionPrintItemMaster" SET "isActive" = false, "updatedAt" = NOW() WHERE id = $1`,
        id
      );
    }

    return NextResponse.json({ message: '삭제(비활성화) 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('기타제작 품목 삭제 오류:', error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}
