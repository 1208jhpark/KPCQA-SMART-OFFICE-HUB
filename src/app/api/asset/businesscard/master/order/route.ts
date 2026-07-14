import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// 🚀 1. 발주 완료된 묶음(Batch) 대장 목록 불러오기 (GET) - [원본 유지]
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const isArchivedParam = searchParams.get('isArchived');

    let whereCondition: any = { isArchived: false };
    if (isArchivedParam === 'true') {
      whereCondition = { isArchived: true };
    }

    const batches = await prisma.businessCardOrderBatch.findMany({
      where: whereCondition,
      include: {
        items: true 
      },
      orderBy: {
        id: 'desc'
      }
    });

    return NextResponse.json(batches, {
      headers: { 'Cache-Control': 'no-store, max-age=0' }
    });
  } catch (error: any) {
    console.error("Batch GET Error:", error);
    return NextResponse.json({ message: '묶음 대장 로드 실패', error: error.message }, { status: 500 });
  }
}

// 🚀 2. 신규 묶음(Batch) 발주 생성하기 (POST) - [안전 매핑 및 트랜잭션 보강]
export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // 프론트엔드 파라미터 변수명 미스매치 방지 가드
    const batchId = body.batchId || body.id;
    const targetRequestIds = body.targetRequestIds || body.itemIds;
    const { deptHeadGroup } = body;

    if (!targetRequestIds || targetRequestIds.length === 0) {
      return NextResponse.json({ message: '발주할 명함이 선택되지 않았습니다.' }, { status: 400 });
    }

    // 동일 ID 중복 생성 요청 방어 가드
    const isExist = await prisma.businessCardOrderBatch.findUnique({
      where: { id: batchId }
    });
    if (isExist) {
      return NextResponse.json({ message: '이미 존재하는 발주 번호입니다. 잠시 후 다시 시도하세요.' }, { status: 400 });
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    const result = await prisma.$transaction(async (tx) => {
      // 부모(묶음) 대장 선행 생성
      const newBatch = await tx.businessCardOrderBatch.create({
        data: {
          id: batchId,
          orderDate: todayStr,
          totalCount: targetRequestIds.length,
          deptHeadGroup: deptHeadGroup || '전사종합',
          status: '발주완료',
          isArchived: false
        }
      });

      // 선택된 개별 명함들의 상태를 '발주완료'로 변경하고 orderGroupId 족보 연결
      // 💡 schema.prisma에 processedAt 필드가 없을 경우를 대비해 안전하게 제외하고 매핑
      await tx.businessCardRequest.updateMany({
        where: { id: { in: targetRequestIds } },
        data: {
          adminStatus: '발주완료',
          orderGroupId: batchId
        }
      });

      return newBatch;
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Batch POST Error:", error);
    return NextResponse.json({ message: '묶음 발주 생성 실패', error: error.message }, { status: 500 });
  }
}

// 🚀 3. 선택된 묶음(Batch)을 보관함(지급완료 + 숨김처리)으로 일괄 이관 처리 (PUT) - [원본 유지]
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { batchIds } = body;

    if (!batchIds || batchIds.length === 0) {
      return NextResponse.json({ message: '이관할 묶음 ID가 없습니다.' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.businessCardOrderBatch.updateMany({
        where: { id: { in: batchIds } },
        data: { 
          status: '지급완료',
          isArchived: true 
        }
      });

      await tx.businessCardRequest.updateMany({
        where: { orderGroupId: { in: batchIds } },
        data: { 
          adminStatus: '지급완료',
          isArchived: true
        }
      });

      return { success: true, count: batchIds.length };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Batch PUT Error:", error);
    return NextResponse.json({ message: '보관함 이관 처리 실패', error: error.message }, { status: 500 });
  }
}

// 🚀 4. 개별 묶음 현물 지급 완료 처리 (PATCH - 보관함 이동 없이 상태만 변경) - [원본 유지]
export async function PATCH(req: Request) {
  try {
    const { batchId } = await req.json();

    if (!batchId) {
      return NextResponse.json({ message: '묶음 ID가 없습니다.' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.businessCardOrderBatch.update({
        where: { id: batchId },
        data: { status: '지급완료' }
      });

      await tx.businessCardRequest.updateMany({
        where: { orderGroupId: batchId },
        data: { adminStatus: '지급완료' }
      });

      return { success: true };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Batch PATCH Error:", error);
    return NextResponse.json({ message: '지급 완료 처리 실패', error: error.message }, { status: 500 });
  }
}