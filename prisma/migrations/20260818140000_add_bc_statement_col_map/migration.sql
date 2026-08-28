-- 거래명세표에서 이름·소속·수량·공급가액을 찾을 칼럼 제목
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "bc_statement_col_map" JSONB;
