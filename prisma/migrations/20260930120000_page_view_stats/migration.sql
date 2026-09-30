-- 페이지 접속 일별 집계
CREATE TABLE IF NOT EXISTS "PageViewDaily" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageViewDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PageViewDaily_path_year_month_day_key"
  ON "PageViewDaily"("path", "year", "month", "day");
CREATE INDEX IF NOT EXISTS "PageViewDaily_year_month_idx" ON "PageViewDaily"("year", "month");
CREATE INDEX IF NOT EXISTS "PageViewDaily_path_idx" ON "PageViewDaily"("path");

CREATE TABLE IF NOT EXISTS "PageViewVisitorDaily" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageViewVisitorDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PageViewVisitorDaily_path_year_month_day_userId_key"
  ON "PageViewVisitorDaily"("path", "year", "month", "day", "userId");
CREATE INDEX IF NOT EXISTS "PageViewVisitorDaily_year_month_idx"
  ON "PageViewVisitorDaily"("year", "month");
CREATE INDEX IF NOT EXISTS "PageViewVisitorDaily_path_idx" ON "PageViewVisitorDaily"("path");
