-- 마케팅 그룹웨어 바로가기 경로 (지급 신청 화면)
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "mkt_groupware_shortcut_url" TEXT NOT NULL DEFAULT 'https://ep.kpcqa.or.kr/ea/edoc/eapproval/docCommonDrafWrite.do?template_key=8';
