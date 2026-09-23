-- AlterTable: 부서 인력별 프로그램사용 — 프로그램 종류
ALTER TABLE "ITDeptProgramAccount" ADD COLUMN IF NOT EXISTS "program_type" TEXT;
