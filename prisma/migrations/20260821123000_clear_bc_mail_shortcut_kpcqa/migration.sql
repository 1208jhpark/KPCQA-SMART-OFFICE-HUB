-- 이전 기본값(쿼리스트링 포함)까지 메일 바로가기 URL 비우기
UPDATE "SystemConfig"
SET "bc_mail_shortcut_url" = ''
WHERE id = 'global'
  AND (
    COALESCE(TRIM("bc_mail_shortcut_url"), '') = ''
    OR "bc_mail_shortcut_url" LIKE '%ep.kpcqa.or.kr/mail2/writeMailView.do%'
  );
