-- 사번 중복(테스트 오염 등)은 가장 오래된 1건만 남기고 나머지는 비움
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "employee_no" ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "User"
  WHERE "employee_no" <> ''
)
UPDATE "User" u
SET "employee_no" = ''
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;

-- 사번이 비어 있지 않을 때만 유니크
CREATE UNIQUE INDEX IF NOT EXISTS "User_employee_no_nonempty_key"
  ON "User" ("employee_no")
  WHERE "employee_no" <> '';
