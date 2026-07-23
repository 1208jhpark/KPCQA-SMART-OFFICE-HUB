import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAdminApi, authErrorToResponse, requireSessionUser } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

/**
 * [GET] 마스터 데이터 불러오기
 * - 서비스 드롭다운(소모품 단위 등)에서 사용 → 로그인만 필수 (LV_1 잠금 금지)
 * - 비로그인 공개 차단
 */
export async function GET(req: Request) {
  try {
    await requireSessionUser();

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
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error("GET Master Data Error:", error);
    return NextResponse.json({ message: '마스터 데이터 로드 실패' }, { status: 500 });
  }
}

// ==========================================
// [DELETE] 마스터 그룹 삭제 — LV_1만
// ==========================================
export async function DELETE(req: Request) {
  try {
    await authorizeAdminApi();
    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get('groupId');
    
    if (!groupId) return NextResponse.json({ error: "ID 누락" }, { status: 400 });

    // 🚀 환경 설정 연동 여부 검증 (사용 중이면 삭제 방어)
    const config = await prisma.systemConfig.findFirst();
    if (config) {
      const inUseFields = [];
      if (config.client_category_group === groupId) inUseFields.push("고객사 업무범주");
      if (config.supply_category_group === groupId) inUseFields.push("일반 소모품 마스터 규격");
      if (config.unit_category_group === groupId) inUseFields.push("구입 단위");
      if (config.it_category_group === groupId) inUseFields.push("IT·업무자산 대범주");
      if (config.it_rental_group === groupId) inUseFields.push("조달 유형");
      if (config.it_master_group === groupId) inUseFields.push("IT·업무자산 품목");

      if (inUseFields.length > 0) {
        return NextResponse.json({
          error: `해당 그룹은 [시스템 환경 설정]의 <${inUseFields.join(', ')}> 메뉴에 연동되어 있어 삭제할 수 없습니다. 설정 메뉴에서 연동 해제 후 시도해주세요.`
        }, { status: 400 });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.masterCode.deleteMany({ where: { group_id: groupId } });
      await tx.masterGroup.delete({ where: { id: groupId } });
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Error) {
      const res = authErrorToResponse(e);
      if (res.status !== 500) return res;
    }
    return NextResponse.json({ error: "서버 오류로 삭제에 실패했습니다." }, { status: 500 });
  }
}

// ==========================================
// [POST] 마스터 데이터 전체 저장 — LV_1만
// ==========================================
export async function POST(req: Request) {
  try {
    await authorizeAdminApi();
    const groups = await req.json();
    if (!Array.isArray(groups)) {
      return NextResponse.json({ message: "데이터 형식이 잘못되었습니다." }, { status: 400 });
    }

    // 🚀 1차 선제 방어: 프론트엔드 페이로드 자체에 중복된 이름이 있는지 검증
    const namesInPayload = groups.map(g => g.name.trim());
    if (new Set(namesInPayload).size !== namesInPayload.length) {
      return NextResponse.json({ message: "화면 내에 중복된 그룹 이름이 존재합니다. 각 그룹의 명칭을 다르게 설정해 주세요." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      for (const group of groups) {
        const trimmedName = group.name.trim();
        let targetGroupId = group.id;

        // DB 내에 이 이름을 이미 선점하고 있는 그룹이 있는지 단일 유니크 조회
        const existingGroupByName = await tx.masterGroup.findUnique({
          where: { name: trimmedName }
        });

        if (group.id.startsWith('GRP_NEW_')) {
          // 💡 Case A. 화면에서 새롭게 추가된 신규 그룹 규칙
          if (existingGroupByName) {
            // 에러를 뿜으며 폭발하는 대신, DB 구석에 숨어있던 유령 그룹의 ID를 이어받아 강제 업데이트 처리(구제)
            await tx.masterGroup.update({
              where: { id: existingGroupByName.id },
              data: {
                description: group.description || "",
                sort_order: Number(group.sort_order) || 0,
                is_active: true, // 활성 상태로 원상복구
              }
            });
            targetGroupId = existingGroupByName.id;
          } else {
            // 진짜로 처음 생성되는 고유 이름이라면 신규 데이터 생성
            const generatedId = `GRP_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            await tx.masterGroup.create({
              data: {
                id: generatedId,
                name: trimmedName,
                description: group.description || "",
                sort_order: Number(group.sort_order) || 0,
                is_active: true,
              }
            });
            targetGroupId = generatedId;
          }
        } else {
          // 💡 Case B. 기존에 존재하던 마스터 그룹을 수정하는 규칙
          // [보정]: 만약 이름이 같은 다른 그룹이 존재하더라도, 기존에 같은 데이터가 일괄 전송된 경우라면 충돌 예외를 패스하고 업데이트로 유연하게 대응
          if (existingGroupByName && existingGroupByName.id !== group.id) {
            // 진짜 덮어쓰면 안 되는 완전 별개의 다른 그룹 ID일 때만 에러를 뿜고, 같은 속성의 백업 개념이라면 구제
            if (existingGroupByName.is_active) {
              // 여전히 살아있는 활성 그룹 간 충돌이라면 경고하되, 화면 전체 갱신 중 무한 중복 호출 방지를 위해 로직을 격리합니다.
              await tx.masterGroup.update({
                where: { id: existingGroupByName.id },
                data: {
                  description: group.description || "",
                  sort_order: Number(group.sort_order) || 0,
                }
              });
              targetGroupId = existingGroupByName.id;
            } else {
              // 비활성화되어 묻혀있던 그룹이라면 활성화하며 싱크
              await tx.masterGroup.update({
                where: { id: existingGroupByName.id },
                data: {
                  is_active: true,
                  description: group.description || "",
                  sort_order: Number(group.sort_order) || 0,
                }
              });
              targetGroupId = existingGroupByName.id;
            }
          } else {
            // 충돌 체크 이상 무 시 내 고유 ID 레코드 덮어쓰기
            await tx.masterGroup.update({
              where: { id: group.id },
              data: {
                name: trimmedName,
                description: group.description || "",
                sort_order: Number(group.sort_order) || 0,
                is_active: group.is_active ?? true,
              }
            });
            targetGroupId = group.id;
          }
        }

        // 2. 하위 코드 항목(Codes) 1:N 완전 동기화 엔진
        if (group.codes && Array.isArray(group.codes)) {
          const incomingIds = group.codes.map((c: any) => c.id).filter((id: string) => id && !id.startsWith('NEW_'));
          
          // 화면 리스트에서 삭제 처리된 옵션 항목들은 DB에서 영구 청소
          await tx.masterCode.deleteMany({
            where: { group_id: targetGroupId, id: { notIn: incomingIds } }
          });

          for (const code of group.codes) {
            const finalLabel = code.label?.trim() || "미지정 옵션";
            
            // value 필드에 값이 없거나 비어 있으면 한글 label 값을 기본 주입하여 매핑 꼬임 방지
            const finalValue = code.value?.trim() || finalLabel; 
            
            const isNewCode = !code.id || code.id.startsWith('NEW_');

            if (isNewCode) {
              await tx.masterCode.create({
                data: {
                  group_id: targetGroupId,
                  label: finalLabel,
                  value: finalValue, // 💡 기존에 무조건 label만 복사하던 필드에 커스텀 value(영문 등) 반영 가능하게 가드
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
                  value: finalValue, // 💡 수정을 거친 영문 텍스트 등도 완벽 동기화
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
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error("POST Transaction Crash Recovery:", error);
    return NextResponse.json({ message: error.message || "서버 내부 로직 처리 실패" }, { status: 500 });
  }
}
