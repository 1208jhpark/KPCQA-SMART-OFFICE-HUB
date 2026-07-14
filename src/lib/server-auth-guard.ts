import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import prisma from '@/lib/prisma';
import { checkMenuPermission } from './permission-utils';

const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

export async function authorizeApi(menuPath: string) {
  const cleanPath = menuPath.replace(/\/$/, '').toLowerCase();
  
  // -------------------------------------------------------------------------
  // 🚀 [KPCQA 프리패스 가드]: 외부 배포 설문 링크 및 QR 코드 실사(Audit) 예외 처리
  // -------------------------------------------------------------------------
  const isSurveyOpenLink = cleanPath.includes('/survey/') && !cleanPath.includes('/admin') && !cleanPath.includes('/my-submissions');
  const isItAuditQrLink = cleanPath.includes('/asset/it/master/audit') || cleanPath.includes('/asset/it/audit');

  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  // 💡 토큰이 없거나(비로그인 외부인), QR코드로 접근한 유저 처리
  if (!token) {
    if (isSurveyOpenLink || isItAuditQrLink) {
      // 가상 오픈 참가자 권한 부여 (진입을 허용하고, 본인 자료만 다루도록 'OWN' 스콥 부여)
      return {
        user: { id: 'OPEN_LINK_USER', name: '링크 참여자', email: 'guest@kpcqa.kr', roles: ['GUEST'], unit_id: null, unit: null },
        permission: { hasAccess: true, isMaster: false, isEditor: true, isViewer: true, viewScope: 'OWN', editScope: 'OWN', myRole: 'GUEST' }
      };
    }
    throw new Error('UNAUTHORIZED');
  }

  // -------------------------------------------------------------------------
  // 🔒 내부 임직원 세션 정밀 권한 검증
  // -------------------------------------------------------------------------
  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    // 만약 토큰 만료 에러가 났어도 QR이나 외부 링크면 살려 보냅니다.
    if (isSurveyOpenLink || isItAuditQrLink) {
      return {
        user: { id: 'OPEN_LINK_USER', name: '링크 참여자', email: 'guest@kpcqa.kr', roles: ['GUEST'], unit_id: null, unit: null },
        permission: { hasAccess: true, isMaster: false, isEditor: true, isViewer: true, viewScope: 'OWN', editScope: 'OWN', myRole: 'GUEST' }
      };
    }
    throw new Error('UNAUTHORIZED_EXPIRED');
  }
  
  // 최신 유저 및 부서정보 Join 로드
  const user = await prisma.user.findUnique({
    where: { email: decoded.email },
    include: { unit: true }
  });
  if (!user) throw new Error('USER_NOT_FOUND');

  // 전체 메뉴 및 부서 위계 데이터 로드
  const allMenus = await prisma.interfaceConfig.findMany();
  const unitsList = await prisma.orgUnit.findMany({ where: { is_deleted: false, is_active: true } });

  const menu = allMenus.find(m => m.path?.toLowerCase() === cleanPath);
  
  // 만약 어드민 메뉴 등록이 안 된 경로라도 오픈 링크 성격이면 통과시켜 줌
  if (!menu) {
    if (isSurveyOpenLink || isItAuditQrLink) {
      return {
        user,
        permission: { hasAccess: true, isMaster: false, isEditor: true, isViewer: true, viewScope: 'OWN', editScope: 'OWN', myRole: 'LV_3' }
      };
    }
    throw new Error('MENU_NOT_CONFIGURED');
  }

  // ⚖️ 전사 공통 대법관 엔진 가동
  const permission = checkMenuPermission(
    { id: user.id, email: user.email, roles: user.roles, dept_id: user.unit_id, unit: user.unit },
    menu,
    allMenus,
    unitsList
  );

  return { user, permission };
}