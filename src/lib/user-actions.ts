import prisma from "@/lib/prisma";
/**
 * [규칙 1] 사용자 및 조직(Unit) 상세 정보 조회
 * - 세션 email 기반으로 유저, 역할, 소속 조직의 모든 정보를 Join하여 읽어옵니다.
 */
export async function getUserWithOrg(email: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        unit: {
          include: {
            parent: true,   // 상위 조직 정보
            children: {     // [규칙 2] 하위 부서(Children)를 배열로 Join
              where: { is_active: true }
            }
          }
        },
      },
    });

    if (!user) return null;

    // 인터페이스 제어를 위해 Lvl 숫자만 추출 (예: "LV_1" -> 1)
    const userLvl = Array.isArray(user.roles) 
      ? parseInt((user.roles as string[])[0]?.replace(/[^0-9]/g, "") || "4")
      : 4;

    return {
      ...user,
      userLvl,
      departmentName: user.unit?.unit_name || "미소속",
    };
  } catch (error) {
    console.error("데이터 조회 중 오류 발생:", error);
    return null;
  }
}

/**
 * [규칙 3] Level 기반 서버 사이드 가드 로직
 * - 유저의 Lvl과 인터페이스의 요구 Level을 비교합니다.
 */
export async function checkAccess(userLvl: number, path: string) {
  const config = await prisma.interfaceConfig.findUnique({
    where: { path }
  });

  if (!config) return false;

  // 요구 Level보다 유저 Level 숫자가 작거나 같아야 통과 (1이 3보다 높음)
  return userLvl <= config.level;
}