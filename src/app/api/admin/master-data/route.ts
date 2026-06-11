import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const groupId = searchParams.get('groupId');

    if (type === 'groups') {
      const groups = await prisma.masterGroup.findMany({
        where: { is_active: true },
        select: { id: true, name: true, description: true },
        orderBy: { sort_order: 'asc' }
      });
      return NextResponse.json(groups || []);
    }

    if (type === 'subitems' && groupId) {
      const subItems = await prisma.masterCode.findMany({
        where: { group_id: groupId, is_active: true, is_visible: true, is_archived: false },
        orderBy: { sort_order: 'asc' }
      });
      return NextResponse.json(subItems || []);
    }

    const masterData = await prisma.masterGroup.findMany({
      where: { is_active: true },
      include: { codes: { orderBy: { sort_order: 'asc' } } },
      orderBy: { sort_order: 'asc' }
    });

    return NextResponse.json(masterData || []);
  } catch (error) {
    console.error("GET Master Data Error:", error);
    return NextResponse.json([]);
  }
}

// src/app/api/admin/master-data/route.ts 내부 DELETE 함수 교체

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get('groupId');
    
    if (!groupId) return NextResponse.json({ error: "ID 누락" }, { status: 400 });

    // 🚀 [신규 추가]: SystemConfig(환경 설정) 연동 여부 검증
    const config = await prisma.systemConfig.findFirst();
    if (config) {
      const inUseFields = [];
      if (config.client_category_group === groupId) inUseFields.push("고객사 업무범주");
      if (config.supply_category_group === groupId) inUseFields.push("일반 소모품 마스터 규격");
      if (config.unit_category_group === groupId) inUseFields.push("구입 단위");
      if (config.it_category_group === groupId) inUseFields.push("IT 자산 분류");

      if (inUseFields.length > 0) {
        return NextResponse.json({
          error: `해당 그룹은 [시스템 환경 설정]의 <${inUseFields.join(', ')}> 메뉴에 연동되어 있어 삭제할 수 없습니다. 설정 메뉴에서 연동을 해제한 후 다시 시도해 주세요.`
        }, { status: 400 });
      }
    }

    await prisma.$transaction(async (tx) => {
      // 1. 하위 항목 청소
      await tx.masterCode.deleteMany({ where: { group_id: groupId } });
      // 2. 그룹 본체 청소
      await tx.masterGroup.delete({ where: { id: groupId } });
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: "서버 오류로 삭제에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const groups = await req.json();
    if (!Array.isArray(groups)) return NextResponse.json({ message: "데이터 형식이 잘못되었습니다." }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      for (const group of groups) {
        let targetGroupId = group.id;

        // 🚀 [핵심 방어 로직]: ID로 먼저 찾고, 없으면 이름으로 찾아서 "절대" _761 같은 난수 복제본이 생기지 않도록 차단
        let existingGroup = await tx.masterGroup.findUnique({ where: { id: group.id } });
        
        if (!existingGroup) {
          existingGroup = await tx.masterGroup.findUnique({ where: { name: group.name.trim() } });
        }

        if (existingGroup) {
          // 존재하면 덮어쓰기
          await tx.masterGroup.update({
            where: { id: existingGroup.id },
            data: {
              description: group.description || "",
              sort_order: Number(group.sort_order) || 0,
              is_active: group.is_active ?? true,
            }
          });
          targetGroupId = existingGroup.id;
        } else {
          // 완전히 새로운 이름의 그룹일 때만 생성
          const generatedId = `GRP_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
          await tx.masterGroup.create({
            data: {
              id: generatedId,
              name: group.name.trim(),
              description: group.description || "",
              sort_order: Number(group.sort_order) || 0,
              is_active: true,
            }
          });
          targetGroupId = generatedId;
        }

        // 하위 코드(드롭다운 항목) 처리 - 필요 없는 필드(단가, 수량 등) 전부 제거됨
        if (group.codes && Array.isArray(group.codes)) {
          const incomingIds = group.codes.map((c: any) => c.id).filter((id: string) => id && !id.startsWith('NEW_'));
          
          await tx.masterCode.deleteMany({
            where: { group_id: targetGroupId, id: { notIn: incomingIds } }
          });

          for (const code of group.codes) {
            const isNewCode = !code.id || code.id.startsWith('NEW_');
            const finalLabel = code.label?.trim() || "미지정 옵션";

            if (isNewCode) {
              await tx.masterCode.create({
                data: {
                  group_id: targetGroupId,
                  label: finalLabel,
                  value: finalLabel,
                  sort_order: Number(code.sort_order) || 0,
                  orgs: code.orgs || ['전체'],
                  is_active: true,
                  is_visible: true,
                  is_archived: false,
                }
              });
            } else {
              await tx.masterCode.update({
                where: { id: code.id },
                data: {
                  label: finalLabel,
                  value: finalLabel,
                  sort_order: Number(code.sort_order) || 0,
                  orgs: code.orgs || [],
                  is_active: code.is_active ?? true,
                  is_visible: code.is_visible ?? true,
                  is_archived: code.is_archived ?? false,
                }
              });
            }
          }
        }
      }
    });

    return NextResponse.json({ message: "성공적으로 저장되었습니다." });
  } catch (error: any) {
    console.error("POST Error:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}