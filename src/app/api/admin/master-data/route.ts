import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAdminApi, authErrorToResponse, requireSessionUser } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

/** SystemConfig에 마스터 그룹 ID로 연동된 필드 → 삭제 가드 라벨 */
const CONFIG_GROUP_LINKS: { key: string; label: string }[] = [
  { key: 'client_category_group', label: '고객사 업무범주' },
  { key: 'supply_category_group', label: '일반 소모품 마스터 규격' },
  { key: 'unit_category_group', label: '구입 단위' },
  { key: 'it_category_group', label: 'IT·업무자산 대범주' },
  { key: 'it_rental_group', label: '조달 유형' },
  { key: 'it_master_group', label: 'IT·업무자산 품목' },
  { key: 'outsourcing_vendor_group', label: '외주 업체' },
  { key: 'outsourcing_item_group', label: '외주 품목' },
  { key: 'outsourcing_detail1_group', label: '외주 품목 상세1' },
  { key: 'outsourcing_detail2_group', label: '외주 품목 상세2' },
  { key: 'job_duty_group', label: '직책(레거시)' },
  { key: 'job_grade_group', label: '직급(레거시)' },
];

function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

/**
 * [GET] 마스터 데이터 불러오기
 * - 기본: 로그인 + 활성 그룹만 (서비스 드롭다운)
 * - ?admin=1: LV_1 + 비활성 그룹 포함 (관리 화면)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const adminView =
      searchParams.get('admin') === '1' || searchParams.get('admin') === 'true';

    if (adminView) {
      await authorizeAdminApi();
    } else {
      await requireSessionUser();
    }

    const type = searchParams.get('type');
    const groupId = searchParams.get('groupId');
    const activeOnly = !adminView;

    if (type === 'groups') {
      const groups = await prisma.masterGroup.findMany({
        where: activeOnly ? { is_active: true } : undefined,
        select: { id: true, name: true, description: true, is_active: true },
        orderBy: { sort_order: 'asc' },
      });
      return NextResponse.json(groups || []);
    }

    if (type === 'subitems' && groupId) {
      const subItems = await prisma.masterCode.findMany({
        where: {
          group_id: groupId,
          ...(activeOnly
            ? { is_active: true, is_visible: true, is_archived: false }
            : {}),
        },
        orderBy: { sort_order: 'asc' },
      });
      return NextResponse.json(subItems || []);
    }

    const masterData = await prisma.masterGroup.findMany({
      where: activeOnly ? { is_active: true } : undefined,
      include: { codes: { orderBy: { sort_order: 'asc' } } },
      orderBy: { sort_order: 'asc' },
    });

    return NextResponse.json(masterData || [], {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('GET Master Data Error:', error);
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

    if (!groupId) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const config = await prisma.systemConfig.findFirst();
    if (config) {
      const inUseFields: string[] = [];
      for (const link of CONFIG_GROUP_LINKS) {
        if ((config as any)[link.key] === groupId) {
          inUseFields.push(link.label);
        }
      }

      if (inUseFields.length > 0) {
        return NextResponse.json(
          {
            error: `해당 그룹은 [시스템 환경 설정]의 <${inUseFields.join(', ')}> 메뉴에 연동되어 있어 삭제할 수 없습니다. 설정 메뉴에서 연동 해제 후 시도해주세요.`,
          },
          { status: 400 }
        );
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
    return NextResponse.json({ error: '서버 오류로 삭제에 실패했습니다.' }, { status: 500 });
  }
}

// ==========================================
// [POST] 마스터 데이터 저장 — LV_1만 (단일/복수 그룹 배열)
// ==========================================
export async function POST(req: Request) {
  try {
    await authorizeAdminApi();
    const groups = await req.json();
    if (!Array.isArray(groups)) {
      return badRequest('데이터 형식이 잘못되었습니다.');
    }

    const namesInPayload = groups.map((g) => String(g.name || '').trim());
    if (namesInPayload.some((n) => !n)) {
      return badRequest('그룹 명칭을 입력해 주세요.');
    }
    if (new Set(namesInPayload).size !== namesInPayload.length) {
      return badRequest(
        '화면 내에 중복된 그룹 이름이 존재합니다. 각 그룹의 명칭을 다르게 설정해 주세요.'
      );
    }

    await prisma.$transaction(async (tx) => {
      for (const group of groups) {
        const trimmedName = String(group.name || '').trim();
        let targetGroupId = group.id;

        const existingGroupByName = await tx.masterGroup.findUnique({
          where: { name: trimmedName },
        });

        if (group.id.startsWith('GRP_NEW_')) {
          if (existingGroupByName) {
            const err = new Error(
              `그룹명 "${trimmedName}"은(는) 이미 사용 중입니다. 다른 이름을 사용하거나, 기존 그룹을 찾아 수정해 주세요.`
            );
            (err as Error & { code: string }).code = 'DUPLICATE_GROUP_NAME';
            throw err;
          }
          const generatedId = `GRP_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          await tx.masterGroup.create({
            data: {
              id: generatedId,
              name: trimmedName,
              description: group.description || '',
              sort_order: Number(group.sort_order) || 0,
              is_active: group.is_active ?? true,
            },
          });
          targetGroupId = generatedId;
        } else {
          if (existingGroupByName && existingGroupByName.id !== group.id) {
            const err = new Error(
              `그룹명 "${trimmedName}"은(는) 다른 그룹에서 이미 사용 중입니다.`
            );
            (err as Error & { code: string }).code = 'DUPLICATE_GROUP_NAME';
            throw err;
          }
          await tx.masterGroup.update({
            where: { id: group.id },
            data: {
              name: trimmedName,
              description: group.description || '',
              sort_order: Number(group.sort_order) || 0,
              is_active: group.is_active ?? true,
            },
          });
          targetGroupId = group.id;
        }

        if (group.codes && Array.isArray(group.codes)) {
          const incomingIds = group.codes
            .map((c: any) => c.id)
            .filter((id: string) => id && !id.startsWith('NEW_'));

          await tx.masterCode.deleteMany({
            where: { group_id: targetGroupId, id: { notIn: incomingIds } },
          });

          for (const code of group.codes) {
            const finalLabel = code.label?.trim() || '미지정 옵션';
            const finalValue = code.value?.trim() || finalLabel;
            const isNewCode = !code.id || code.id.startsWith('NEW_');

            if (isNewCode) {
              await tx.masterCode.create({
                data: {
                  group_id: targetGroupId,
                  label: finalLabel,
                  value: finalValue,
                  sort_order: Number(code.sort_order) || 0,
                  orgs: ['전체'],
                  is_active: code.is_active ?? true,
                  // 보이기(is_visible) UI 제거 — 활성과 동일하게 true 유지
                  is_visible: true,
                  is_archived: code.is_archived ?? false,
                },
              });
            } else {
              await tx.masterCode.update({
                where: { id: code.id },
                data: {
                  label: finalLabel,
                  value: finalValue,
                  sort_order: Number(code.sort_order) || 0,
                  // 노출 조직 UI 제거 — 저장 시 전체로 통일 (미사용 컬럼)
                  orgs: ['전체'],
                  is_active: code.is_active ?? true,
                  is_visible: true,
                  is_archived: code.is_archived ?? false,
                },
              });
            }
          }
        }
      }
    });

    return NextResponse.json({ message: '성공적으로 저장되었습니다.' });
  } catch (error: any) {
    if (error?.code === 'DUPLICATE_GROUP_NAME' || /이미 사용 중/.test(String(error?.message || ''))) {
      return badRequest(error.message);
    }
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    if (error?.code === 'P2002') {
      return badRequest('그룹명이 중복되어 저장할 수 없습니다.');
    }
    console.error('POST Transaction Crash Recovery:', error);
    return NextResponse.json({ message: error.message || '서버 내부 로직 처리 실패' }, { status: 500 });
  }
}
