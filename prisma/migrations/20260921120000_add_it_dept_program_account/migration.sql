-- CreateTable
CREATE TABLE IF NOT EXISTS "ITDeptProgramAccount" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "dept" TEXT,
    "person_name" TEXT NOT NULL,
    "registered_date" TEXT,
    "program_used" BOOLEAN NOT NULL DEFAULT false,
    "program_id" TEXT,
    "program_password" TEXT,
    "ip_address" TEXT,
    "mac_address" TEXT,
    "note1" TEXT,
    "note2" TEXT,
    "note3" TEXT,
    "created_by_name" TEXT,
    "created_by_email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ITDeptProgramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ITDeptProgramAccount_unit_id_idx" ON "ITDeptProgramAccount"("unit_id");
