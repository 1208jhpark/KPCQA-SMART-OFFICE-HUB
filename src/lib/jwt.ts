// 🔐 JWT 시크릿 중앙 관리 모듈
// - 프로덕션: JWT_SECRET 미설정 시 즉시 에러 (안전하지 않은 하드코딩 폴백 제거)
// - 개발: 편의를 위해 임시 시크릿 허용하되 콘솔 경고 출력
//
// ⚠ 절대 코드에 실제 시크릿을 하드코딩하지 마세요. 반드시 .env 의 JWT_SECRET 을 사용합니다.

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[JWT] JWT_SECRET 환경변수가 설정되지 않았습니다. 프로덕션 배포 시 반드시 .env 에 JWT_SECRET 을 지정해야 합니다.'
    );
  }

  console.warn(
    '[JWT] ⚠ JWT_SECRET 미설정 — 개발용 임시 시크릿을 사용합니다. 프로덕션 배포 전 반드시 .env 에 JWT_SECRET 을 설정하세요.'
  );
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

export const JWT_SECRET = resolveJwtSecret();
