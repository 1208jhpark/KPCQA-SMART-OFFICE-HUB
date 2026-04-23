import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// [GET] 모든 마스터 데이터 호출
export async function GET() {
  try {
    const masterData = await prisma.masterGroup.findMany({
      where: { is_active: true },
      include: {
        codes: {
          where: { is_archived: false },
          orderBy: { sort_order: 'asc' } // 항목 정렬 순서 반영
        }
      },
      orderBy: { sort_order: 'asc' } // 그룹 정렬 순서 반영
    });
    return NextResponse.json(masterData || []);
  } catch (error) {
    console.error("Master Data API GET Error:", error);
    return NextResponse.json([]);
  }
}

// [POST] 전체 데이터 일괄 저장 (Upsert 로직)
export async function POST(req: Request) {
  try {
    const groups = await req.json();

    // 🚀 트랜잭션을 사용하여 데이터 일관성 보장
    await prisma.$transaction(
      groups.map((group: any) =>
        prisma.masterGroup.upsert({
          where: { id: group.id },
          update: {
            name: group.name,
            description: group.description,
            sort_order: Number(group.sort_order),
            is_active: group.is_active,
            codes: {
              // 기존 항목을 지우고 새로 생성 (데이터 동기화의 가장 확실한 방법)
              // 만약 다른 테이블에서 Code ID를 직접 참조 중이라면 deleteMany 대신 개별 upsert가 필요합니다.
              deleteMany: {}, 
              create: group.codes.map((code: any) => ({
                label: code.label,
                sort_order: Number(code.sort_order),
                orgs: code.orgs,
                min_qty: code.min_qty?.toString() || null,
                unit: code.unit || null,
                price: code.price ? Number(code.price) : null,
                vendor: code.vendor || null,
                is_active: code.is_active,
                is_visible: code.is_visible,
                is_archived: code.is_archived,
                in_use: code.in_use
              }))
            }
          },
          create: {
            id: group.id,
            name: group.name,
            description: group.description,
            sort_order: Number(group.sort_order),
            codes: {
              create: group.codes.map((code: any) => ({
                label: code.label,
                sort_order: Number(code.sort_order),
                orgs: code.orgs,
                unit: code.unit,
                price: code.price ? Number(code.price) : null,
                vendor: code.vendor
              }))
            }
          }
        })
      )
    );

    return NextResponse.json({ message: "성공적으로 저장되었습니다." });
  } catch (error: any) {
    console.error("Master Data POST Error:", error);
    return NextResponse.json({ message: "저장 실패", error: error.message }, { status: 500 });
  }
}